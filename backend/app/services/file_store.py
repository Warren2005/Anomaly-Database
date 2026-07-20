"""
File-based store for image metadata + embeddings + feedback.

Replaces PostgreSQL (metadata/feedback tables) and Qdrant (vector search)
together. Two JSON files under `library_data_dir` are the entire "database":

- metadata.json — one record per image, including its 512-float CLIP
  embedding as a plain field (mirrors a SharePoint List column holding the
  embedding as JSON text).
- feedback.json — one record per up/down vote.

Search is brute-force: filter by any provided metadata fields, then rank
the remaining embeddings by dot product against the query vector (embeddings
are already L2-normalized elsewhere, so dot product == cosine similarity).

Concurrency: every write goes through an OS-level advisory lock (fcntl.flock
on a `.lock` file) around a read-modify-write cycle, and lands via
write-to-temp-then-os.replace() (atomic on POSIX). This is safe across
multiple processes (e.g. multiple Gunicorn workers), not just within one —
an in-process asyncio.Lock alone would not be. Reads always re-read the
file from disk rather than trusting an in-memory cache, so every worker
always sees the latest committed state.
"""

import asyncio
import fcntl
import json
from contextlib import contextmanager
from dataclasses import asdict
from datetime import datetime
from pathlib import Path
from typing import Optional
from uuid import UUID

import numpy as np

from app.core.config import settings
from app.core.logging_config import logger
from app.models.feedback import Feedback
from app.models.image import Image


def _image_to_record(image: Image, embedding: list[float]) -> dict:
    record = asdict(image)
    record["id"] = str(image.id)
    record["created_at"] = image.created_at.isoformat()
    record["updated_at"] = image.updated_at.isoformat()
    record["embedding"] = embedding
    return record


def _record_to_image(record: dict) -> Image:
    fields = {k: v for k, v in record.items() if k != "embedding"}
    fields["id"] = UUID(fields["id"])
    fields["created_at"] = datetime.fromisoformat(fields["created_at"])
    fields["updated_at"] = datetime.fromisoformat(fields["updated_at"])
    return Image(**fields)


def _feedback_to_record(feedback: Feedback) -> dict:
    record = asdict(feedback)
    record["id"] = str(feedback.id)
    record["result_image_id"] = str(feedback.result_image_id)
    record["query_image_id"] = (
        str(feedback.query_image_id) if feedback.query_image_id else None
    )
    record["created_at"] = feedback.created_at.isoformat()
    return record


class FileStoreService:
    def __init__(self, data_dir: str):
        self._data_dir = Path(data_dir)
        self._images_file = self._data_dir / "metadata.json"
        self._feedback_file = self._data_dir / "feedback.json"
        self._lock_file = self._data_dir / ".lock"

    def connect(self):
        self._data_dir.mkdir(parents=True, exist_ok=True)
        for f in (self._images_file, self._feedback_file):
            if not f.exists():
                f.write_text("[]")
        self._lock_file.touch(exist_ok=True)
        logger.info("File store ready", extra={"data_dir": str(self._data_dir)})

    def health_check(self) -> bool:
        return self._images_file.exists() and self._feedback_file.exists()

    @contextmanager
    def _locked(self):
        with open(self._lock_file, "w") as fh:
            fcntl.flock(fh, fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(fh, fcntl.LOCK_UN)

    def _read_json(self, path: Path) -> list[dict]:
        try:
            return json.loads(path.read_text())
        except (FileNotFoundError, json.JSONDecodeError):
            return []

    def _write_json(self, path: Path, records: list[dict]):
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(records, indent=2))
        tmp.replace(path)  # atomic on POSIX

    # --- Images -----------------------------------------------------------

    def _get_all_images_sync(self) -> list[Image]:
        return [_record_to_image(r) for r in self._read_json(self._images_file)]

    async def get_all_images(self) -> list[Image]:
        return await asyncio.to_thread(self._get_all_images_sync)

    def _get_image_sync(self, image_id: UUID) -> Optional[Image]:
        for r in self._read_json(self._images_file):
            if r["id"] == str(image_id):
                return _record_to_image(r)
        return None

    async def get_image(self, image_id: UUID) -> Optional[Image]:
        return await asyncio.to_thread(self._get_image_sync, image_id)

    def _upsert_image_sync(self, image: Image, embedding: list[float]) -> Image:
        with self._locked():
            records = self._read_json(self._images_file)
            records = [r for r in records if r["id"] != str(image.id)]
            records.append(_image_to_record(image, embedding))
            self._write_json(self._images_file, records)
        return image

    async def upsert_image(self, image: Image, embedding: list[float]) -> Image:
        return await asyncio.to_thread(self._upsert_image_sync, image, embedding)

    def _get_distinct_sync(self, field: str) -> list[str]:
        values: set[str] = set()
        for r in self._read_json(self._images_file):
            value = r.get(field)
            if value:
                values.add(value)
        return sorted(values)

    async def get_distinct(self, field: str) -> list[str]:
        return await asyncio.to_thread(self._get_distinct_sync, field)

    def _search_sync(
        self,
        vector: list[float],
        limit: int,
        diagnosis: Optional[str],
        tissue_type: Optional[str],
        benign_malignant: Optional[str],
    ) -> list[tuple[Image, float]]:
        records = self._read_json(self._images_file)
        if diagnosis:
            records = [r for r in records if r.get("diagnosis") == diagnosis]
        if tissue_type:
            records = [r for r in records if r.get("tissue_type") == tissue_type]
        if benign_malignant:
            records = [
                r for r in records if r.get("benign_malignant") == benign_malignant
            ]
        if not records:
            return []

        embeddings = np.array([r["embedding"] for r in records], dtype=np.float32)
        query = np.array(vector, dtype=np.float32)
        scores = embeddings @ query

        top_n = min(limit, len(records))
        top_idx = np.argpartition(-scores, top_n - 1)[:top_n]
        top_idx = top_idx[np.argsort(-scores[top_idx])]

        return [(_record_to_image(records[i]), float(scores[i])) for i in top_idx]

    async def search(
        self,
        vector: list[float],
        limit: int = 10,
        diagnosis: Optional[str] = None,
        tissue_type: Optional[str] = None,
        benign_malignant: Optional[str] = None,
    ) -> list[tuple[Image, float]]:
        return await asyncio.to_thread(
            self._search_sync, vector, limit, diagnosis, tissue_type, benign_malignant
        )

    # --- Feedback -----------------------------------------------------------

    def _add_feedback_sync(self, feedback: Feedback) -> Feedback:
        with self._locked():
            records = self._read_json(self._feedback_file)
            records.append(_feedback_to_record(feedback))
            self._write_json(self._feedback_file, records)
        return feedback

    async def add_feedback(self, feedback: Feedback) -> Feedback:
        return await asyncio.to_thread(self._add_feedback_sync, feedback)

    def _get_net_votes_sync(self, image_ids: list[UUID]) -> dict[UUID, int]:
        wanted = {str(i) for i in image_ids}
        totals: dict[UUID, int] = {}
        for r in self._read_json(self._feedback_file):
            if r["result_image_id"] in wanted:
                key = UUID(r["result_image_id"])
                totals[key] = totals.get(key, 0) + r["vote"]
        return totals

    async def get_net_votes(self, image_ids: list[UUID]) -> dict[UUID, int]:
        return await asyncio.to_thread(self._get_net_votes_sync, image_ids)

    def _get_feedback_stats_sync(self) -> dict:
        records = self._read_json(self._feedback_file)
        return {
            "total": len(records),
            "upvotes": sum(1 for r in records if r["vote"] == 1),
            "downvotes": sum(1 for r in records if r["vote"] == -1),
        }

    async def get_feedback_stats(self) -> dict:
        return await asyncio.to_thread(self._get_feedback_stats_sync)


file_store_service = FileStoreService(data_dir=settings.library_data_dir)
