"""Tests for the similarity search endpoint."""

import io
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4
from datetime import datetime

from fastapi.testclient import TestClient
from qdrant_client.models import ScoredPoint

from app.main import app


def _make_test_jpeg() -> bytes:
    """Create a minimal JPEG for testing."""
    from PIL import Image
    img = Image.new("RGB", (64, 64), color="red")
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return buf.getvalue()


def _make_scored_point(id_str: str, score: float) -> ScoredPoint:
    return ScoredPoint(id=id_str, version=0, score=score, payload={}, vector=None)


def _make_image_orm(id_val):
    """Create a mock ORM-like object."""
    mock = MagicMock()
    mock.id = id_val
    mock.dataset_source = "custom_test"
    mock.image_path = "custom/test/test.jpg"
    mock.diagnosis = "test_label"
    mock.tissue_type = None
    mock.benign_malignant = None
    mock.age = None
    mock.sex = None
    mock.anomaly_description = None
    mock.anomaly_status = None
    mock.anomaly_type = None
    mock.identification = None
    mock.wall_location = None
    mock.run_number = None
    mock.analysis_comment = None
    mock.analyst = None
    mock.created_at = datetime(2026, 1, 1)
    mock.updated_at = datetime(2026, 1, 1)
    return mock


class TestSearchSimilar:
    def test_search_returns_results(self):
        """POST /search/similar returns results with proper structure."""
        image_id = uuid4()
        mock_image = _make_image_orm(image_id)

        with (
            patch("app.api.v1.endpoints.search.embedding_service") as mock_embed,
            patch("app.api.v1.endpoints.search.qdrant_service") as mock_qdrant,
            patch("app.api.v1.endpoints.search.db_service") as mock_db,
            patch("app.api.v1.endpoints.search.storage_service") as mock_storage,
        ):
            mock_embed.get_embedding = AsyncMock(return_value=[0.1] * 512)
            mock_qdrant.search = AsyncMock(
                return_value=[_make_scored_point(str(image_id), 0.95)]
            )

            # Mock the database session
            mock_session = AsyncMock()
            mock_result = MagicMock()
            mock_result.scalars.return_value.all.return_value = [mock_image]
            mock_session.execute = AsyncMock(return_value=mock_result)
            mock_session.__aenter__ = AsyncMock(return_value=mock_session)
            mock_session.__aexit__ = AsyncMock(return_value=None)
            mock_db.get_session = MagicMock(return_value=mock_session)

            mock_storage.get_presigned_url = MagicMock(
                return_value="http://minio/test.jpg"
            )

            client = TestClient(app)
            response = client.post(
                "/api/v1/search/similar",
                files={"file": ("test.jpg", _make_test_jpeg(), "image/jpeg")},
            )

            assert response.status_code == 200
            data = response.json()
            assert data["result_count"] == 1
            assert data["results"][0]["similarity_score"] == 0.95
            assert "query_processing_time_ms" in data
            assert "search_time_ms" in data
            assert "total_time_ms" in data

    def test_search_invalid_file_type(self):
        """Non-image files return 400."""
        client = TestClient(app)
        response = client.post(
            "/api/v1/search/similar",
            files={"file": ("test.txt", b"hello world", "text/plain")},
        )
        assert response.status_code == 400
        assert "VALIDATION_ERROR" in response.json()["error"]["code"]

    def test_search_no_results(self):
        """Empty Qdrant results return result_count: 0."""
        with (
            patch("app.api.v1.endpoints.search.embedding_service") as mock_embed,
            patch("app.api.v1.endpoints.search.qdrant_service") as mock_qdrant,
        ):
            mock_embed.get_embedding = AsyncMock(return_value=[0.1] * 512)
            mock_qdrant.search = AsyncMock(return_value=[])

            client = TestClient(app)
            response = client.post(
                "/api/v1/search/similar",
                files={"file": ("test.jpg", _make_test_jpeg(), "image/jpeg")},
            )

            assert response.status_code == 200
            data = response.json()
            assert data["result_count"] == 0
            assert data["results"] == []

    def test_search_timing_fields_positive(self):
        """All timing fields are positive numbers."""
        with (
            patch("app.api.v1.endpoints.search.embedding_service") as mock_embed,
            patch("app.api.v1.endpoints.search.qdrant_service") as mock_qdrant,
        ):
            mock_embed.get_embedding = AsyncMock(return_value=[0.1] * 512)
            mock_qdrant.search = AsyncMock(return_value=[])

            client = TestClient(app)
            response = client.post(
                "/api/v1/search/similar",
                files={"file": ("test.jpg", _make_test_jpeg(), "image/jpeg")},
            )

            data = response.json()
            assert data["query_processing_time_ms"] >= 0
            assert data["search_time_ms"] >= 0
            assert data["total_time_ms"] >= 0


class TestSearchHelpers:
    def test_build_filter_no_params(self):
        """No params returns None."""
        from app.services.search_helpers import build_qdrant_filter
        assert build_qdrant_filter() is None

    def test_build_filter_with_diagnosis(self):
        """Diagnosis param creates a filter."""
        from app.services.search_helpers import build_qdrant_filter
        f = build_qdrant_filter(diagnosis="melanoma")
        assert f is not None
        assert len(f.must) == 1

    def test_build_filter_multiple_params(self):
        """Multiple params create multiple conditions."""
        from app.services.search_helpers import build_qdrant_filter
        f = build_qdrant_filter(
            diagnosis="melanoma", tissue_type="skin", benign_malignant="malignant"
        )
        assert f is not None
        assert len(f.must) == 3
