"""Tests for the image detail and filter endpoints."""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4
from datetime import datetime

from fastapi.testclient import TestClient

from app.main import app


def _make_image_orm(id_val):
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


class TestGetImage:
    def test_get_image_found(self):
        """GET /images/{id} returns image detail when found."""
        image_id = uuid4()
        mock_image = _make_image_orm(image_id)

        with patch("app.api.v1.endpoints.images.db_service") as mock_db:
            mock_session = AsyncMock()
            mock_session.get = AsyncMock(return_value=mock_image)
            mock_session.__aenter__ = AsyncMock(return_value=mock_session)
            mock_session.__aexit__ = AsyncMock(return_value=None)
            mock_db.get_session = MagicMock(return_value=mock_session)

            client = TestClient(app)
            response = client.get(f"/api/v1/images/{image_id}")

            assert response.status_code == 200
            data = response.json()
            assert data["image"]["id"] == str(image_id)
            assert data["image_url"] == f"/api/v1/images/{image_id}/file"

    def test_get_image_not_found(self):
        """GET /images/{id} returns 404 when not found."""
        image_id = uuid4()

        with patch("app.api.v1.endpoints.images.db_service") as mock_db:
            mock_session = AsyncMock()
            mock_session.get = AsyncMock(return_value=None)
            mock_session.__aenter__ = AsyncMock(return_value=mock_session)
            mock_session.__aexit__ = AsyncMock(return_value=None)
            mock_db.get_session = MagicMock(return_value=mock_session)

            client = TestClient(app)
            response = client.get(f"/api/v1/images/{image_id}")

            assert response.status_code == 404
            assert response.json()["error"]["code"] == "NOT_FOUND"


class TestGetFilters:
    def test_get_filters(self):
        """GET /images/filters returns distinct filter values."""
        with patch("app.api.v1.endpoints.images.db_service") as mock_db:
            mock_session = AsyncMock()

            # Mock three separate execute calls for the three queries
            mock_result1 = MagicMock()
            mock_result1.scalars.return_value.all.return_value = [
                "melanoma", "nevus", None
            ]
            mock_result2 = MagicMock()
            mock_result2.scalars.return_value.all.return_value = ["skin"]
            mock_result3 = MagicMock()
            mock_result3.scalars.return_value.all.return_value = [
                "malignant", "benign"
            ]

            mock_session.execute = AsyncMock(
                side_effect=[mock_result1, mock_result2, mock_result3]
            )
            mock_session.__aenter__ = AsyncMock(return_value=mock_session)
            mock_session.__aexit__ = AsyncMock(return_value=None)
            mock_db.get_session = MagicMock(return_value=mock_session)

            client = TestClient(app)
            response = client.get("/api/v1/images/filters")

            assert response.status_code == 200
            data = response.json()
            assert "melanoma" in data["diagnoses"]
            assert "nevus" in data["diagnoses"]
            # None should be filtered out
            assert None not in data["diagnoses"]
            assert data["tissue_types"] == ["skin"]
            assert "malignant" in data["benign_malignant"]
