"""
Application configuration using Pydantic BaseSettings.

This module centralizes all environment variables with:
- Type validation (catches config errors at startup)
- Default values
- Auto-loading from .env file
- IDE autocomplete support
"""

from pydantic_settings import BaseSettings
from typing import Literal


class Settings(BaseSettings):
    """
    Application settings loaded from environment variables.
    
    All settings can be overridden via .env file or environment variables.
    Validation happens at startup - app won't start with invalid config.
    """
    
    # Application Info
    app_name: str = "Inspection Image Similarity Engine"
    app_version: str = "1.0.0"
    environment: Literal["development", "production", "test"] = "development"
    
    # API Settings
    api_host: str = "0.0.0.0"
    api_port: int = 8000

    # Local file-based storage — replaces Postgres + Qdrant + MinIO + Redis.
    # library_data_dir holds metadata.json and an images/ subdirectory of
    # raw image files. See app/services/file_store.py and
    # app/services/local_storage.py.
    library_data_dir: str = "./data/library"

    # Primary embedding model: a frozen DINOv2 backbone (self-supervised,
    # no text/caption training) plus a small trained metric-learning head.
    # Adopted after scripts/evaluate.py + scripts/train_metric_head.py
    # measured it against the previous CLIP ViT-L/14 -> ViT-H/14 cascade on
    # the real anomaly library (not just a public benchmark) and it won on
    # every ranking-quality metric — see model_registry.json for the full,
    # dated record of every evaluation run that led here.
    primary_backbone_name: str = "vit_base_patch14_dinov2.lvd142m"
    # Path to the trained head's weights, relative to library_data_dir (so
    # it lives alongside metadata.json — versioned/backed up the same way,
    # via the shared Dropbox folder, with zero extra backup code).
    metric_head_path: str = "models/dinov2_base_head_v1.pt"
    metric_head_hidden_dim: int = 256
    metric_head_embed_dim: int = 128

    # CLIP settings — used only by the (currently disabled, see
    # rerank_enabled) second-stage rerank model below, not by the primary
    # embedding above.
    clip_model_name: str = "ViT-L/14"
    clip_pretrained: str = "openai"
    clip_device: str = "cpu"  # or "cuda" if GPU available
    inference_workers: int = 4

    # Re-ranking: a second, heavier model re-scores only the top
    # `rerank_candidates` results from the primary search, rather than
    # the whole corpus. Disabled by default: the CLIP L/14->H/14 cascade
    # this used to sit behind is exactly what the DINOv2+head primary was
    # measured against and beat outright, so there's no evidence this
    # still helps paired with the new primary — that combination has
    # never been evaluated. Re-enable only after measuring it.
    rerank_enabled: bool = False
    rerank_model_name: str = "ViT-H-14"
    rerank_pretrained: str = "laion2b_s32b_b79k"
    rerank_candidates: int = 50

    # Embedding cache: file-backed (embedding_cache.json, part of
    # file_store_service), shared across every worker process and
    # persistent across restarts. Entries older than this are pruned on
    # each write, since there's no Redis TTL to lean on anymore.
    cache_ttl_days: int = 7

    # Logging
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"

    # Passkey required to delete a library entry — a lightweight speed bump
    # against accidental deletes, not a real auth system (this app has none
    # by design; see RUNNING_INSTRUCTIONS.md). Change via .env if the
    # default ever needs to differ from the team-wide default.
    library_delete_passkey: str = "admin123"
    
    class Config:
        """Pydantic configuration."""
        env_file = ".env"
        env_file_encoding = "utf-8"
        case_sensitive = False  # DATABASE_URL and database_url both work


# Global settings instance
# This gets created once at import time
settings = Settings()