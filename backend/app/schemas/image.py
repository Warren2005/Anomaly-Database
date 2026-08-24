"""Pydantic models for image metadata."""

from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class ImageBase(BaseModel):
    dataset_source: Optional[str] = None
    image_path: str
    diagnosis: Optional[str] = None
    tissue_type: Optional[str] = None
    benign_malignant: Optional[str] = None
    age: Optional[int] = None
    sex: Optional[str] = None
    anomaly_description: Optional[str] = None
    anomaly_status: Optional[str] = None
    anomaly_type: Optional[str] = None
    identification: Optional[str] = None
    anomaly_id: Optional[str] = None
    wall_location: Optional[str] = None
    crack_image_angles: Optional[str] = None
    run_number: Optional[str] = None
    analysis_comment: Optional[str] = None
    revision_history: Optional[list] = None
    classification_status: Optional[str] = None
    depth: Optional[float] = None
    width: Optional[float] = None
    length: Optional[float] = None
    is_qc_flag: Optional[bool] = None
    qc_raised_by: Optional[str] = None
    qc_reviewer: Optional[str] = None
    qc_decision_rationale: Optional[str] = None
    signal_description: Optional[str] = None
    differential_diagnosis: Optional[str] = None
    limitations_uncertainty: Optional[str] = None
    notes: Optional[str] = None
    panel_tags: Optional[list[str]] = None
    beamforming_types: Optional[list[str]] = None
    tags: Optional[list[str]] = None
    interacts_with_other_features: Optional[bool] = None
    interaction_related_items: Optional[list[str]] = None
    zero_angle_frame_index: Optional[int] = None
    track: Optional[int] = None
    additional_image_paths: Optional[list[str]] = None
    orientation_image_path: Optional[str] = None
    pipe_angle: Optional[float] = None
    video_paths: Optional[list[str]] = None


class ImageCreate(ImageBase):
    pass


class ImageResponse(ImageBase):
    id: UUID
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class LibraryUploadResponse(BaseModel):
    image: ImageResponse
    image_url: str
    media_urls: list[str] = []
    media_storage_paths: list[str] = []
    orientation_image_url: Optional[str] = None
    video_urls: list[str] = []
    message: str
