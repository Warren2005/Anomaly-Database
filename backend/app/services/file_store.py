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

pgvector upgrade trigger: brute-force search re-parses the whole
metadata.json (JSON parsing dominates over the numpy dot-product ranking
itself) on every call, so cost scales ~linearly with corpus size. Measured
on this machine (scripts/benchmark_search.py, ViT-L/14-sized 768-dim
vectors): ~19ms p95 at 100 records, ~190ms at 1,000, ~1,000ms at 5,000,
~2,000ms at 10,000. Our real corpus is 30 records today. Treat a p95
search latency crossing ~300ms (roughly the 1,000-2,000 record range) as
the trigger to migrate to pgvector (a Postgres extension, not a new
service) — well before it becomes a user-visible problem.
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
    image: Image,
    embedding: list[float],
    rerank_embedding: Optional[list[float]] = None,
    embedding_model: Optional[str] = None,
    rerank_embedding_model: Optional[str] = None,
) -> dict:
    record = asdict(image)
    record["id"] = str(image.id)
    record["created_at"] = image.created_at.isoformat()
    record["updated_at"] = image.updated_at.isoformat()
    record["embedding"] = embedding
    record["rerank_embedding"] = rerank_embedding
    # Tags identifying exactly which model/checkpoint produced each vector
    # (e.g. "ViT-L-14/openai") — see EmbeddingService.model_tag. Without
    # this, swapping the configured model would silently compare old and
    # new embeddings as if they lived in the same vector space, which they
    # don't, even at matching dimensionality.
    record["embedding_model"] = embedding_model
    record["rerank_embedding_model"] = rerank_embedding_model
    return record


_NON_IMAGE_FIELDS = {
    "embedding",
    "rerank_embedding",
    "embedding_model",
    "rerank_embedding_model",
}


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
        embedding_model: Optional[str] = None,
        rerank_embedding_model: Optional[str] = None,
    ) -> Image:
        with self._locked():
            records = self._read_json(self._images_file)
            records = [r for r in records if r["id"] != str(image.id)]
            records.append(
                _image_to_record(
                    image, embedding, rerank_embedding, embedding_model, rerank_embedding_model
                )
            )
            self._write_json(self._images_file, records)
        return image

    async def upsert_image(
        self,
        image: Image,
        embedding: list[float],
        rerank_embedding: Optional[list[float]] = None,
        embedding_model: Optional[str] = None,
        rerank_embedding_model: Optional[str] = None,
    ) -> Image:
        return await asyncio.to_thread(
            self._upsert_image_sync,
            image,
            embedding,
            rerank_embedding,
            embedding_model,
            rerank_embedding_model,
        )

    def _get_rerank_embeddings_sync(
        self, image_ids: list[UUID], rerank_embedding_model: Optional[str] = None
    ) -> dict[UUID, list[float]]:
        wanted = {str(i) for i in image_ids}
        result: dict[UUID, list[float]] = {}
        excluded = 0
        for r in self._read_json(self._images_file):
            if r["id"] not in wanted or not r.get("rerank_embedding"):
                continue
            if rerank_embedding_model is not None and r.get("rerank_embedding_model") != rerank_embedding_model:
                excluded += 1
                continue
            result[UUID(r["id"])] = r["rerank_embedding"]
        if excluded:
            logger.warning(
                "Excluded rerank embeddings from a different model version",
                extra={"excluded_count": excluded, "expected_model": rerank_embedding_model},
            )
        return result

    async def get_rerank_embeddings(
        self, image_ids: list[UUID], rerank_embedding_model: Optional[str] = None
    ) -> dict[UUID, list[float]]:
        return await asyncio.to_thread(
            self._get_rerank_embeddings_sync, image_ids, rerank_embedding_model
        )

    def _get_model_tag_counts_sync(self) -> dict:
        """Count records per embedding_model / rerank_embedding_model tag —
        a quick way to confirm a re-ingest actually backfilled every record
        after a model swap, rather than leaving some silently excluded from
        search."""
        embedding_counts: dict[str, int] = {}
        rerank_counts: dict[str, int] = {}
        for r in self._read_json(self._images_file):
            tag = r.get("embedding_model") or "(untagged)"
            embedding_counts[tag] = embedding_counts.get(tag, 0) + 1
            if r.get("rerank_embedding"):
                rtag = r.get("rerank_embedding_model") or "(untagged)"
                rerank_counts[rtag] = rerank_counts.get(rtag, 0) + 1
        return {"embedding_model": embedding_counts, "rerank_embedding_model": rerank_counts}

    async def get_model_tag_counts(self) -> dict:
        return await asyncio.to_thread(self._get_model_tag_counts_sync)

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
        embedding_model: Optional[str] = None,
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
        if embedding_model is not None:
            before = len(records)
            records = [r for r in records if r.get("embedding_model") == embedding_model]
            excluded = before - len(records)
            if excluded:
                # Comparing vectors from different CLIP models/checkpoints is
                # meaningless even when dimensionality matches by coincidence
                # (e.g. two different ViT-L/14 checkpoints) — silently
                # excluding them is correct, but worth surfacing so a stale
                # corpus (not yet re-ingested after a model swap) is visible
                # rather than just quietly returning fewer/no results.
                logger.warning(
                    "Excluded images with a different embedding model version from search",
                    extra={"excluded_count": excluded, "expected_model": embedding_model},
                )
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
        embedding_model: Optional[str] = None,
    ) -> list[tuple[Image, float]]:
        return await asyncio.to_thread(
            self._search_sync,
            vector,
            limit,
            diagnosis,
            tissue_type,
            benign_malignant,
            embedding_model,
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
