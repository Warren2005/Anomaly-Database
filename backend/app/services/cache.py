"""
Shared embedding cache — file-backed, not in-process.

Replaces both Redis and the earlier in-process dict. Delegates to
file_store_service's embedding_cache.json (locked + atomic writes, same
pattern as metadata.json/feedback.json), so a cache hit from one worker
process or one user benefits every other one, and the cache survives a
backend restart. The `store` constructor param exists so tests can inject
an isolated FileStoreService instead of the real global one.
"""

import hashlib
from typing import Optional

from app.services.file_store import file_store_service as _default_store


class CacheService:
    def __init__(self, store=None):
        self._store = store or _default_store

    async def connect(self):
        pass

    async def disconnect(self):
        pass

    async def health_check(self) -> bool:
        return True

    @staticmethod
    def hash_image(image_bytes: bytes) -> str:
        return hashlib.sha256(image_bytes).hexdigest()

    async def get_embedding(self, cache_key: str) -> Optional[list[float]]:
        return await self._store.get_cached_embedding(cache_key)

    async def set_embedding(self, cache_key: str, embedding: list[float]):
        await self._store.set_cached_embedding(cache_key, embedding)


cache_service = CacheService()
