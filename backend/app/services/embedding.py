"""
CLIP embedding service using open_clip.

Loads the configured model (see Settings.clip_model_name/clip_pretrained)
once at startup. Exposes get_embedding() to convert image bytes to an
L2-normalized vector — dimensionality depends on the model (512 for
ViT-B/32, 768 for ViT-L/14, etc).
"""

import asyncio
import io
import time
from typing import Optional

import open_clip
import torch
from PIL import Image

from app.core.config import settings
from app.core.logging_config import logger
from app.services.cache import cache_service, CacheService
from app.middleware.metrics import cache_hit_total, cache_miss_total


class EmbeddingService:
    def __init__(self, model_name: str, device: str, pretrained: str = "openai"):
        self._model_name = model_name
        self._device = device
        self._pretrained = pretrained
        self.model = None
        self._preprocess = None

    @property
    def clip_model_name(self) -> str:
        """Convert 'ViT-B/32' to 'ViT-B-32' for open_clip."""
        return self._model_name.replace("/", "-")

    @property
    def model_tag(self) -> str:
        """Identifies exactly which checkpoint produced an embedding, e.g.
        'ViT-L-14/openai'. Stored alongside every embedding in file_store.py
        so a config change (different model or different pretrained weights)
        can never be silently compared against incompatible old vectors —
        same dimensionality doesn't mean the same vector space."""
        return f"{self.clip_model_name}/{self._pretrained}"

    async def load_model(self):
        """Load the CLIP model. Called once at startup."""
        start = time.time()
        self.model, _, self._preprocess = open_clip.create_model_and_transforms(
            self.clip_model_name, pretrained=self._pretrained, device=self._device
        )
        self.model.eval()
        self._tokenizer = open_clip.get_tokenizer(self.clip_model_name)
        elapsed = time.time() - start
        logger.info(
            f"CLIP model loaded in {elapsed:.2f}s",
            extra={"model": self.clip_model_name, "device": self._device},
        )

    def _compute_embedding(self, image_bytes: bytes) -> list[float]:
        """Synchronous CLIP inference. Runs in a thread to avoid blocking the event loop."""
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        image_tensor = self._preprocess(image).unsqueeze(0).to(self._device)
        with torch.no_grad():
            embedding = self.model.encode_image(image_tensor)
            embedding = embedding / embedding.norm(dim=-1, keepdim=True)
        return embedding.squeeze().cpu().tolist()

    async def get_embedding(self, image_bytes: bytes) -> list[float]:
        """Convert image bytes to an L2-normalized embedding vector."""
        embedding, _cache_hit = await self.get_embedding_with_cache_status(image_bytes)
        return embedding

    async def get_embedding_with_cache_status(self, image_bytes: bytes) -> tuple[list[float], bool]:
        """Same as get_embedding, but also reports whether it was a cache
        hit — used by search endpoints for the cache_hit field in the
        event log (app/services/event_log.py). A plain instance attribute
        wouldn't be safe here: this EmbeddingService singleton is shared
        across concurrent requests, so per-call state has to be returned,
        not stored on self.
        """
        # Cache key includes the model name: two EmbeddingService instances
        # (primary + rerank) share one cache_service, and their embeddings
        # for the same bytes are different vectors, not interchangeable.
        cache_key = f"{self.clip_model_name}:{CacheService.hash_image(image_bytes)}"

        try:
            cached = await cache_service.get_embedding(cache_key)
            if cached is not None:
                cache_hit_total.inc()
                logger.debug("Cache hit for embedding", extra={"key": cache_key})
                return cached, True
        except Exception:
            logger.warning("Cache read failed, computing embedding", extra={"key": cache_key})

        cache_miss_total.inc()
        embedding = await asyncio.to_thread(self._compute_embedding, image_bytes)

        try:
            await cache_service.set_embedding(cache_key, embedding)
        except Exception:
            logger.warning("Cache write failed", extra={"key": cache_key})

        return embedding, False

    def _compute_text_embedding(self, text: str) -> list[float]:
        """Synchronous CLIP text inference."""
        tokens = self._tokenizer([text]).to(self._device)
        with torch.no_grad():
            embedding = self.model.encode_text(tokens)
            embedding = embedding / embedding.norm(dim=-1, keepdim=True)
        return embedding.squeeze().cpu().tolist()

    async def get_text_embedding(self, text: str) -> list[float]:
        """Convert text query to a 512-dim L2-normalized embedding vector."""
        return await asyncio.to_thread(self._compute_text_embedding, text)

    def health_check(self) -> bool:
        return self.model is not None


embedding_service = EmbeddingService(
    model_name=settings.clip_model_name,
    device=settings.clip_device,
    pretrained=settings.clip_pretrained,
)

# Second, heavier model used to re-score the primary search's shortlist.
# Only loaded at startup (see main.py) when settings.rerank_enabled is True.
rerank_embedding_service = EmbeddingService(
    model_name=settings.rerank_model_name,
    device=settings.clip_device,
    pretrained=settings.rerank_pretrained,
)
