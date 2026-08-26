"""
Embedding services.

EmbeddingService wraps open_clip (CLIP models) — used today only for the
disabled-by-default rerank stage (see Settings.rerank_enabled).

Dinov2HeadEmbeddingService is the primary production embedding model: a
frozen DINOv2 backbone (timm, self-supervised, no text/caption training)
plus a small trained metric-learning head (app/ml/projection_head.py).
See scripts/evaluate.py and scripts/train_metric_head.py for how it was
chosen and trained, and model_registry.json for the measured results.
"""

import asyncio
import io
import time
from pathlib import Path
from typing import Optional

import open_clip
import timm
import torch
from PIL import Image

from app.core.config import settings
from app.core.logging_config import logger
from app.ml.projection_head import ProjectionHead
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


class Dinov2HeadEmbeddingService:
    """Primary production embedding model: a frozen DINOv2 backbone (timm,
    self-supervised — no text/caption training, unlike CLIP) plus a small
    trained metric-learning head (ProjectionHead) on top.

    Implements the same public interface as EmbeddingService
    (get_embedding / get_embedding_with_cache_status / model_tag /
    health_check / load_model) so every existing call site — search.py,
    library.py, batch_search.py, ws_search.py — works unchanged. The one
    exception is get_text_embedding: DINOv2 has no text encoder and no
    joint text/image space at all, so there is no meaningful way to
    support text-to-image search once this is the primary model (see
    that method for the explicit failure this raises instead of silently
    returning nonsense).
    """

    def __init__(self, backbone_name: str, head_path: str, hidden_dim: int, embed_dim: int, device: str):
        self._backbone_name = backbone_name
        self._head_path = head_path
        self._hidden_dim = hidden_dim
        self._embed_dim = embed_dim
        self._device = device
        self.model = None  # frozen backbone
        self._transform = None
        self._head = None

    @property
    def model_tag(self) -> str:
        """Identifies exactly which backbone+head produced an embedding —
        same purpose as EmbeddingService.model_tag: a config change can
        never be silently compared against incompatible old vectors."""
        return f"{self._backbone_name}+{Path(self._head_path).stem}"

    async def load_model(self):
        start = time.time()
        self.model = timm.create_model(self._backbone_name, pretrained=True, num_classes=0)
        self.model.eval()
        self.model.to(self._device)
        data_cfg = timm.data.resolve_data_config({}, model=self.model)
        self._transform = timm.data.create_transform(**data_cfg)

        checkpoint = torch.load(self._head_path, map_location=self._device)
        in_dim = checkpoint.get("in_dim") or self.model.num_features
        head = ProjectionHead(
            in_dim=in_dim,
            hidden_dim=checkpoint.get("hidden_dim", self._hidden_dim),
            out_dim=checkpoint.get("embed_dim", self._embed_dim),
        )
        head.load_state_dict(checkpoint["state_dict"])
        head.eval()
        head.to(self._device)
        self._head = head

        elapsed = time.time() - start
        logger.info(
            f"DINOv2 backbone + trained head loaded in {elapsed:.2f}s",
            extra={"backbone": self._backbone_name, "head_path": self._head_path, "device": self._device},
        )

    def _compute_embedding(self, image_bytes: bytes) -> list[float]:
        if self.model is None or self._head is None or self._transform is None:
            from app.core.errors import ServiceUnavailableError

            raise ServiceUnavailableError(
                "Embedding model is not loaded — uploads and search are unavailable "
                "until the DINOv2 backbone and metric head finish loading. Check "
                "LIBRARY_DATA_DIR / models/dinov2_base_head_v2.pt and backend logs."
            )
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        tensor = self._transform(image).unsqueeze(0).to(self._device)
        with torch.no_grad():
            backbone_feat = self.model(tensor)
            projected = self._head(backbone_feat)  # ProjectionHead L2-normalizes internally
        return projected.squeeze().cpu().tolist()

    async def get_embedding(self, image_bytes: bytes) -> list[float]:
        embedding, _cache_hit = await self.get_embedding_with_cache_status(image_bytes)
        return embedding

    async def get_embedding_with_cache_status(self, image_bytes: bytes) -> tuple[list[float], bool]:
        # Cache key includes model_tag (backbone + head file), same reason
        # as EmbeddingService: this instance's cache entries must never be
        # confused with a CLIP instance's, or with a different head version's.
        cache_key = f"{self.model_tag}:{CacheService.hash_image(image_bytes)}"

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

    async def get_text_embedding(self, text: str) -> list[float]:
        """DINOv2 has no text encoder — there is no shared text/image space
        to search within, unlike CLIP. Raised explicitly (caught and
        translated to a clean 503 by text_search.py) rather than left to
        fail with an AttributeError, since this is a real, permanent
        capability gap of the current primary model, not a transient
        outage."""
        from app.core.errors import ServiceUnavailableError

        raise ServiceUnavailableError(
            "Text search is unavailable — the active embedding model (DINOv2) "
            "has no text encoder or shared text/image embedding space. This "
            "requires a CLIP-family primary model to support."
        )

    def health_check(self) -> bool:
        return self.model is not None and self._head is not None


embedding_service = Dinov2HeadEmbeddingService(
    backbone_name=settings.primary_backbone_name,
    head_path=str(Path(settings.library_data_dir) / settings.metric_head_path),
    hidden_dim=settings.metric_head_hidden_dim,
    embed_dim=settings.metric_head_embed_dim,
    device=settings.clip_device,
)

# Second, heavier model used to re-score the primary search's shortlist —
# only loaded at startup (see main.py) when settings.rerank_enabled is
# True, which is False by default now (see Settings.rerank_enabled).
rerank_embedding_service = EmbeddingService(
    model_name=settings.rerank_model_name,
    device=settings.clip_device,
    pretrained=settings.rerank_pretrained,
)
