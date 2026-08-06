"""Tests for the library delete endpoint's passkey requirement."""

from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app
from app.models.image import Image


def _make_image(image_id) -> Image:
    return Image(
        id=image_id,
        dataset_source="library",
        image_path="library/test.jpg",
        created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        updated_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )


class TestDeleteLibraryEntryPasskey:
    def test_delete_without_passkey_is_forbidden(self):
        image_id = uuid4()
        with patch("app.api.v1.endpoints.library.file_store_service") as mock_store:
            mock_store.delete_image = AsyncMock(return_value=_make_image(image_id))

            client = TestClient(app)
            response = client.delete(f"/api/v1/library/{image_id}")

            assert response.status_code == 403
            assert response.json()["error"]["code"] == "FORBIDDEN"
            mock_store.delete_image.assert_not_called()

    def test_delete_with_wrong_passkey_is_forbidden(self):
        image_id = uuid4()
        with patch("app.api.v1.endpoints.library.file_store_service") as mock_store:
            mock_store.delete_image = AsyncMock(return_value=_make_image(image_id))

            client = TestClient(app)
            response = client.delete(
                f"/api/v1/library/{image_id}",
                headers={"X-Delete-Passkey": "wrong-passkey"},
            )

            assert response.status_code == 403
            mock_store.delete_image.assert_not_called()

    def test_delete_with_correct_passkey_succeeds(self):
        image_id = uuid4()
        with (
            patch("app.api.v1.endpoints.library.file_store_service") as mock_store,
            patch("app.api.v1.endpoints.library.local_storage_service") as mock_local,
        ):
            mock_store.delete_image = AsyncMock(return_value=_make_image(image_id))
            mock_local.delete_image = AsyncMock()

            client = TestClient(app)
            response = client.delete(
                f"/api/v1/library/{image_id}",
                headers={"X-Delete-Passkey": "admin123"},
            )

            assert response.status_code == 200
            assert response.json() == {"ok": True, "image_id": str(image_id)}
            mock_store.delete_image.assert_called_once_with(image_id)

    def test_delete_nonexistent_entry_with_correct_passkey_is_not_found(self):
        image_id = uuid4()
        with patch("app.api.v1.endpoints.library.file_store_service") as mock_store:
            mock_store.delete_image = AsyncMock(return_value=None)

            client = TestClient(app)
            response = client.delete(
                f"/api/v1/library/{image_id}",
                headers={"X-Delete-Passkey": "admin123"},
            )

            assert response.status_code == 404
