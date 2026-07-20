"""
Plain data model for an image record.

Backed by a JSON file (app/services/file_store.py) rather than a database
table — this dataclass just defines the shape of one record. Field names
match the JSON keys 1:1, and match app/schemas/image.py's ImageResponse
fields, so ImageResponse.model_validate(image) keeps working unchanged.
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID


@dataclass
class Image:
    id: UUID
    image_path: str
    dataset_source: Optional[str] = None
    diagnosis: Optional[str] = None
    tissue_type: Optional[str] = None
    benign_malignant: Optional[str] = None
    age: Optional[int] = None
    sex: Optional[str] = None
    anomaly_description: Optional[str] = None
    anomaly_status: Optional[str] = None
    anomaly_type: Optional[str] = None
    identification: Optional[str] = None
    wall_location: Optional[str] = None
    run_number: Optional[str] = None
    analysis_comment: Optional[str] = None
    analyst: Optional[str] = None
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
