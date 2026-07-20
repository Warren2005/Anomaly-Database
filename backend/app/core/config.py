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
    
    # Database - PostgreSQL
    database_url: str = "postgresql://localhost:5432/medical_microscopy"
    
    # Vector Database - Qdrant
    qdrant_host: str = "localhost"
    qdrant_port: int = 6333
    qdrant_collection_name: str = "medical_images"
    
    # Object Storage - MinIO
    minio_endpoint: str = "localhost:9000"
    minio_public_endpoint: str = "localhost:9000"  # Used in presigned URLs — must be reachable by the browser
    minio_access_key: str = "minioadmin"
    minio_secret_key: str = "minioadmin"
    minio_bucket: str = "medical-images"
    minio_secure: bool = False  # False for local development (http), True for production (https)
    
    # CLIP Model Settings
    clip_model_name: str = "ViT-B/32"
    clip_device: str = "cpu"  # or "cuda" if GPU available
    inference_workers: int = 4
    
    # Redis Cache
    redis_url: str = "redis://localhost:6379/0"
    cache_ttl_hours: int = 24

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