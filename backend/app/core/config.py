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
    # library_data_dir holds metadata.json, feedback.json, and an images/
    # subdirectory of raw image files. See app/services/file_store.py and
    # app/services/local_storage.py.
    library_data_dir: str = "./data/library"

    # CLIP Model Settings
    clip_model_name: str = "ViT-B/32"
    clip_device: str = "cpu"  # or "cuda" if GPU available
    inference_workers: int = 4

    # Logging
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"
    
    class Config:
        """Pydantic configuration."""
        env_file = ".env"
        env_file_encoding = "utf-8"
        case_sensitive = False  # DATABASE_URL and database_url both work


# Global settings instance
# This gets created once at import time
settings = Settings()