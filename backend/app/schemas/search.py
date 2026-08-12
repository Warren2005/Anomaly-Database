"""Pydantic models for search request/response."""

from typing import Optional

from pydantic import BaseModel

from app.schemas.image import ImageResponse


class SearchResult(BaseModel):
    image: ImageResponse
    similarity_score: float
    image_url: str
    # Index into image.panel_tags (and [image_path, *additional_image_paths])
    # of the media that image_url actually points to. Set only for
    # panel-scoped searches, where image_url may be a non-primary media
    # file — the frontend needs this to label the shown image with its
    # real panel tag instead of assuming index 0.
    media_index: Optional[int] = None
    orientation_image_url: Optional[str] = None


class SearchResponse(BaseModel):
    query_processing_time_ms: float
    search_time_ms: float
    rerank_time_ms: Optional[float] = None
    total_time_ms: float
    results: list[SearchResult]
    result_count: int


class ImageDetailResponse(BaseModel):
    image: ImageResponse
    image_url: str
    media_urls: list[str] = []
    orientation_image_url: Optional[str] = None


class FiltersResponse(BaseModel):
    diagnoses: list[str]
    tissue_types: list[str]
    benign_malignant: list[str]
    anomaly_types: list[str] = []
    run_numbers: list[str] = []
    anomaly_statuses: list[str] = []
    classification_statuses: list[str] = []
    identifications: list[str] = []
    tags: list[str] = []


class LibraryBrowseResponse(BaseModel):
    images: list[ImageDetailResponse]
    total: int
