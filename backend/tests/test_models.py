"""Tests for SQLAlchemy ORM models."""

from app.models.image import Image
from app.models.base import Base


def test_image_model_columns():
    """Image model has all expected columns."""
    column_names = {c.name for c in Image.__table__.columns}
    expected = {
        "id", "dataset_source", "image_path", "diagnosis",
        "tissue_type", "benign_malignant", "age", "sex",
        "created_at", "updated_at",
        "anomaly_description", "anomaly_status", "anomaly_type",
        "identification", "wall_location", "run_number",
        "analysis_comment", "analyst",
    }
    assert column_names == expected


def test_image_model_primary_key():
    """id column is the primary key."""
    pk_cols = [c.name for c in Image.__table__.primary_key.columns]
    assert pk_cols == ["id"]


def test_image_model_nullable_fields():
    """image_path is not nullable; metadata fields are nullable."""
    cols = {c.name: c.nullable for c in Image.__table__.columns}
    assert cols["image_path"] is False
    assert cols["diagnosis"] is True
    assert cols["tissue_type"] is True
    assert cols["benign_malignant"] is True
    assert cols["age"] is True
    assert cols["sex"] is True
    assert cols["dataset_source"] is True


def test_base_metadata_tables():
    """Base.metadata contains the images table."""
    assert "images" in Base.metadata.tables


def test_image_model_indexes():
    """Image model has indexes on diagnosis and tissue_type."""
    index_names = {idx.name for idx in Image.__table__.indexes}
    assert "idx_diagnosis" in index_names
    assert "idx_tissue_type" in index_names
