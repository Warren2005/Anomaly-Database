"""
In-process embedding cache.

Replaces Redis: a plain dict keyed by SHA-256 hash of the image bytes.
This isn't shared across worker processes (each Gunicorn worker gets its
own cache), so the hit rate is lower with multiple workers than a shared
Redis would give — an acceptable trade for not running a separate service.
"""

import hashlib
from typing import Optional


class CacheService:
    def __init__(self):
        self._store: dict[str, list[float]] = {}

    async def connect(self):
        pass

    async def disconnect(self):
        pass

    async def health_check(self) -> bool:
        return True

    @staticmethod
    def hash_image(image_bytes: bytes) -> str:
        return hashlib.sha256(image_bytes).hexdigest()

    async def get_embedding(self, image_hash: str) -> Optional[list[float]]:
        return self._store.get(image_hash)

    async def set_embedding(self, image_hash: str, embedding: list[float]):
        self._store[image_hash] = embedding


cache_service = CacheService()
