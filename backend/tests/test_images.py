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


class TestGetImageVideo:
    def test_get_video_found(self, tmp_path):
        """GET /images/{id}/video/{index} streams the file via FileResponse
        (not the read-whole-file-into-memory Response the image endpoints
        use), which avoids loading a large video fully into memory —
        though this Starlette version's FileResponse doesn't add HTTP
        range-request support, see images.py's docstring on this route."""
        image_id = uuid4()
        video_file = tmp_path / "clip.mp4"
        video_file.write_bytes(b"fake-mp4-bytes")
        mock_image = Image(
            id=image_id,
            image_path="library/primary.jpg",
            video_paths=["library/clip.mp4"],
            created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
            updated_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        )

        with (
            patch("app.api.v1.endpoints.images.file_store_service") as mock_store,
            patch("app.api.v1.endpoints.images.local_storage_service") as mock_local,
        ):
            mock_store.get_image = AsyncMock(return_value=mock_image)
            mock_local.get_path = lambda _object_name: video_file

            client = TestClient(app)
            response = client.get(f"/api/v1/images/{image_id}/video/0")

            assert response.status_code == 200
            assert response.headers["content-type"] == "video/mp4"
            assert response.headers["cache-control"] == "no-store"
            assert response.content == b"fake-mp4-bytes"

    def test_get_video_index_out_of_range_is_not_found(self):
        image_id = uuid4()
        mock_image = Image(
            id=image_id,
            image_path="library/primary.jpg",
            video_paths=["library/clip.mp4"],
            created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
            updated_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        )
        with patch("app.api.v1.endpoints.images.file_store_service") as mock_store:
            mock_store.get_image = AsyncMock(return_value=mock_image)
            client = TestClient(app)
            response = client.get(f"/api/v1/images/{image_id}/video/5")
            assert response.status_code == 404

    def test_get_video_no_videos_is_not_found(self):
        image_id = uuid4()
        mock_image = _make_image(image_id)  # no video_paths
        with patch("app.api.v1.endpoints.images.file_store_service") as mock_store:
            mock_store.get_image = AsyncMock(return_value=mock_image)
            client = TestClient(app)
            response = client.get(f"/api/v1/images/{image_id}/video/0")
            assert response.status_code == 404


class TestGetFilters:
    def test_get_filters(self):
        """GET /images/filters returns distinct filter values."""
        with (
            patch("app.api.v1.endpoints.images.file_store_service") as mock_store,
            patch("app.api.v1.endpoints.images.tag_catalog_service") as mock_tags,
        ):
            mock_store.get_distinct = AsyncMock(
                side_effect=[
                    ["melanoma", "nevus"],          # diagnosis
                    ["skin"],                       # tissue_type
                    ["malignant", "benign"],        # benign_malignant
                    ["Metal Loss", "Crack"],        # anomaly_type
                    ["Run 42"],                     # run_number
                    ["Approved"],                   # anomaly_status
                    ["Confirmed", "Under QC"],       # classification_status
                    ["Corrosion", "Grinding"],      # identification
                    ["External", "N/A"],             # wall_location
                ]
            )
            mock_store.get_distinct_list_field = AsyncMock(return_value=["ili", "demo"])
            mock_tags.list_tags = AsyncMock(return_value=["Catalog Tag"])

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
            assert "Catalog Tag" in data["tags"]
            assert "External" in data["wall_locations"]

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