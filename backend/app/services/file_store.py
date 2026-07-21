"""
File-based store for image metadata + embeddings + feedback + the shared
embedding cache.

Replaces PostgreSQL (metadata/feedback tables), Qdrant (vector search), and
Redis (embedding cache) together. Three JSON files under `library_data_dir`
are the entire "database":

- metadata.json — one record per image, including its CLIP embedding(s) as
  plain fields (mirrors a SharePoint List column holding the embedding as
  JSON text).
- feedback.json — one record per up/down vote.
- embedding_cache.json — SHA-256(image bytes) -> embedding, shared across
  every worker process and persisted across restarts (unlike an in-process
  dict). Entries older than Settings.cache_ttl_days are pruned on write.

Search is brute-force: filter by any provided metadata fields, then rank
the remaining embeddings by dot product against the query vector (embeddings
are already L2-normalized elsewhere, so dot product == cosine similarity).

Concurrency: every write goes through a cross-platform advisory lock
(portalocker, which wraps fcntl on POSIX / msvcrt on Windows) around a
read-modify-write cycle, and lands via write-to-temp-then-os.replace()
(atomic on POSIX and Windows). This is safe across multiple processes (e.g.
multiple Gunicorn workers), not just within one — an in-process
asyncio.Lock alone would not be. Reads always re-read the file from disk
rather than trusting an in-memory cache, so every worker always sees the
latest committed state.
"""

import asyncio
import json
from contextlib import contextmanager
from dataclasses import asdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional
from uuid import UUID

import numpy as np
import portalocker

from app.core.config import settings
from app.core.logging_config import logger
from app.models.feedback import Feedback
from app.models.image import Image


def _image_to_record(
    image: Image, embedding: list[float], rerank_embedding: Optional[list[float]] = None
) -> dict:
    record = asdict(image)
    record["id"] = str(image.id)
    record["created_at"] = image.created_at.isoformat()
    record["updated_at"] = image.updated_at.isoformat()
    record["embedding"] = embedding
    record["rerank_embedding"] = rerank_embedding
    return record


_NON_IMAGE_FIELDS = {"embedding", "rerank_embedding"}


def _record_to_image(record: dict) -> Image:
    fields = {k: v for k, v in record.items() if k not in _NON_IMAGE_FIELDS}
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
    def __init__(self, data_dir: str, cache_ttl_days: int = 7):
        self._data_dir = Path(data_dir)
        self._images_file = self._data_dir / "metadata.json"
        self._feedback_file = self._data_dir / "feedback.json"
        self._cache_file = self._data_dir / "embedding_cache.json"
        self._lock_file = self._data_dir / ".lock"
        self._cache_ttl_days = cache_ttl_days

    def connect(self):
        self._data_dir.mkdir(parents=True, exist_ok=True)
        for f in (self._images_file, self._feedback_file):
            if not f.exists():
                f.write_text("[]")
        if not self._cache_file.exists():
            self._cache_file.write_text("{}")
        self._lock_file.touch(exist_ok=True)
        logger.info("File store ready", extra={"data_dir": str(self._data_dir)})

    def health_check(self) -> bool:
        return self._images_file.exists() and self._feedback_file.exists()

    @contextmanager
    def _locked(self):
        # portalocker wraps fcntl (POSIX) / msvcrt (Windows) behind one API,
        # so this lock is safe across multiple processes on either OS.
        with open(self._lock_file, "w") as fh:
            portalocker.lock(fh, portalocker.LOCK_EX)
            try:
                yield
            finally:
                portalocker.unlock(fh)

    def _read_json(self, path: Path, default=None) -> list[dict]:
        try:
            return json.loads(path.read_text())
        except (FileNotFoundError, json.JSONDecodeError):
            return [] if default is None else default

    def _write_json(self, path: Path, records) -> None:
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

    def _upsert_image_sync(
        self,
        image: Image,
        embedding: list[float],
        rerank_embedding: Optional[list[float]] = None,
    ) -> Image:
        with self._locked():
            records = self._read_json(self._images_file)
            records = [r for r in records if r["id"] != str(image.id)]
            records.append(_image_to_record(image, embedding, rerank_embedding))
            self._write_json(self._images_file, records)
        return image

    async def upsert_image(
        self,
        image: Image,
        embedding: list[float],
        rerank_embedding: Optional[list[float]] = None,
    ) -> Image:
        return await asyncio.to_thread(
            self._upsert_image_sync, image, embedding, rerank_embedding
        )

    def _get_rerank_embeddings_sync(
        self, image_ids: list[UUID]
    ) -> dict[UUID, list[float]]:
        wanted = {str(i) for i in image_ids}
        result: dict[UUID, list[float]] = {}
        for r in self._read_json(self._images_file):
            if r["id"] in wanted and r.get("rerank_embedding"):
                result[UUID(r["id"])] = r["rerank_embedding"]
        return result

    async def get_rerank_embeddings(
        self, image_ids: list[UUID]
    ) -> dict[UUID, list[float]]:
        return await asyncio.to_thread(self._get_rerank_embeddings_sync, image_ids)

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

    # --- Embedding cache (shared across processes, persists across restarts) ---

    def _prune_expired(self, cache: dict) -> dict:
        cutoff = datetime.now(timezone.utc) - timedelta(days=self._cache_ttl_days)
        kept = {}
        for key, entry in cache.items():
            try:
                cached_at = datetime.fromisoformat(entry["cached_at"])
            except (KeyError, ValueError, TypeError):
                continue  # malformed entry — drop it rather than keep it forever
            if cached_at > cutoff:
                kept[key] = entry
        return kept

    def _get_cached_embedding_sync(self, key: str) -> Optional[list[float]]:
        cache = self._read_json(self._cache_file, default={})
        entry = cache.get(key)
        return entry["embedding"] if entry else None

    async def get_cached_embedding(self, key: str) -> Optional[list[float]]:
        return await asyncio.to_thread(self._get_cached_embedding_sync, key)

    def _set_cached_embedding_sync(self, key: str, embedding: list[float]):
        with self._locked():
            cache = self._read_json(self._cache_file, default={})
            cache[key] = {
                "embedding": embedding,
                "cached_at": datetime.now(timezone.utc).isoformat(),
            }
            cache = self._prune_expired(cache)
            self._write_json(self._cache_file, cache)

    async def set_cached_embedding(self, key: str, embedding: list[float]):
        await asyncio.to_thread(self._set_cached_embedding_sync, key, embedding)


file_store_service = FileStoreService(
    data_dir=settings.library_data_dir, cache_ttl_days=settings.cache_ttl_days
)
