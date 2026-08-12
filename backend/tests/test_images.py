"""Tests for the image detail and filter endpoints."""

from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app
from app.models.image import Image


def _make_image(image_id) -> Image:
    return Image(
        id=image_id,
        dataset_source="custom_test",
        image_path="custom/test/test.jpg",
        diagnosis="test_label",
        created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        updated_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )


class TestGetImage:
    def test_get_image_found(self):
        """GET /images/{id} returns image detail when found."""
        image_id = uuid4()
        mock_image = _make_image(image_id)

        with patch("app.api.v1.endpoints.images.file_store_service") as mock_store:
            mock_store.get_image = AsyncMock(return_value=mock_image)

            client = TestClient(app)
            response = client.get(f"/api/v1/images/{image_id}")

            assert response.status_code == 200
            data = response.json()
            assert data["image"]["id"] == str(image_id)
            assert data["image_url"] == f"/api/v1/images/{image_id}/file"

    def test_get_image_not_found(self):
        """GET /images/{id} returns 404 when not found."""
        image_id = uuid4()

        with patch("app.api.v1.endpoints.images.file_store_service") as mock_store:
            mock_store.get_image = AsyncMock(return_value=None)

            client = TestClient(app)
            response = client.get(f"/api/v1/images/{image_id}")

            assert response.status_code == 404
            assert response.json()["error"]["code"] == "NOT_FOUND"


class TestGetFilters:
    def test_get_filters(self):
        """GET /images/filters returns distinct filter values."""
        with patch("app.api.v1.endpoints.images.file_store_service") as mock_store:
            mock_store.get_distinct = AsyncMock(
                side_effect=[
                    ["melanoma", "nevus"],          # diagnosis
                    ["skin"],                       # tissue_type
                    ["malignant", "benign"],        # benign_malignant
                    ["Metal Loss", "Crack"],        # anomaly_type
                    ["Run 42"],                     # run_number
                    ["Approved"],                   # anomaly_status
                    ["Confirmed", "Edge Case"],     # classification_status
                    ["Corrosion", "Grinding"],      # identification
                ]
            )
            mock_store.get_distinct_list_field = AsyncMock(return_value=["ili", "demo"])

            client = TestClient(app)
            response = client.get("/api/v1/images/filters")

            assert response.status_code == 200
            data = response.json()
            assert "melanoma" in data["diagnoses"]
            assert "nevus" in data["diagnoses"]
            assert data["tissue_types"] == ["skin"]
            assert "malignant" in data["benign_malignant"]
            assert "Metal Loss" in data["anomaly_types"]
            assert data["run_numbers"] == ["Run 42"]
            assert data["anomaly_statuses"] == ["Approved"]
            assert "Confirmed" in data["classification_statuses"]
            assert "Corrosion" in data["identifications"]
            assert "ili" in data["tags"]

class TestGetImageMedia:
    def test_get_image_includes_media_urls(self):
        """GET /images/{id} includes media_urls for primary (+ extras)."""
        image_id = uuid4()
        mock_image = _make_image(image_id)
        mock_image.additional_image_paths = [f"library/{image_id}_1.png"]

        with patch("app.api.v1.endpoints.images.file_store_service") as mock_store:
            mock_store.get_image = AsyncMock(return_value=mock_image)

            client = TestClient(app)
            response = client.get(f"/api/v1/images/{image_id}")

            assert response.status_code == 200
            data = response.json()
            assert data["media_urls"] == [
                f"/api/v1/images/{image_id}/file",
                f"/api/v1/images/{image_id}/media/1",
            ]