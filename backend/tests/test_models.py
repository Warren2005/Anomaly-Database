"""Tests for the plain dataclass models (no ORM/database anymore)."""

from dataclasses import fields
from uuid import uuid4

from app.models.image import Image


def test_image_model_fields():
    """Image dataclass has all expected fields."""
    field_names = {f.name for f in fields(Image)}
    expected = {
        "id", "dataset_source", "image_path", "diagnosis",
        "tissue_type", "benign_malignant", "age", "sex",
        "created_at", "updated_at",
        "anomaly_description", "anomaly_status", "anomaly_type",
        "identification", "anomaly_id", "client_id", "wall_location", "crack_image_angles", "run_number",
        "analysis_comment", "revision_history",
        # ILI / Zach reference-library fields
        "classification_status",
        "depth", "width", "length",
        "is_qc_flag", "qc_raised_by", "qc_reviewer", "qc_decision_rationale",
        "signal_description", "differential_diagnosis", "limitations_uncertainty",
        "notes", "panel_tags", "beamforming_types", "tags",
        "interacts_with_other_features", "interaction_related_items",
        "zero_angle_frame_index", "track", "additional_image_paths",
        "orientation_image_path", "pipe_angle", "video_paths",
    }
    assert field_names == expected


def test_image_model_optional_fields_default_to_none():
    """Metadata fields default to None when not provided."""
    image = Image(id=uuid4(), image_path="test.jpg")
    assert image.diagnosis is None
    assert image.tissue_type is None
    assert image.benign_malignant is None
    assert image.age is None
    assert image.sex is None
    assert image.dataset_source is None


def test_image_model_timestamps_auto_set():
    """created_at/updated_at default to the current time if not provided."""
    image = Image(id=uuid4(), image_path="test.jpg")
    assert image.created_at is not None
    assert image.updated_at is not None
