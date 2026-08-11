"""Tests for the library delete endpoint's passkey requirement."""

from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app
from app.models.image import Image


def _make_image(image_id, **overrides) -> Image:
    defaults = dict(
        id=image_id,
        dataset_source="library",
        image_path="library/test.jpg",
        additional_image_paths=[],
        panel_tags=[],
        anomaly_name="Original name",
        analyst="original-analyst",
        created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        updated_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )
    defaults.update(overrides)
    return Image(**defaults)


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


class TestUpdateLibraryEntry:
    def test_update_without_passkey_is_forbidden(self):
        image_id = uuid4()
        with patch("app.api.v1.endpoints.library.file_store_service") as mock_store:
            client = TestClient(app)
            response = client.put(
                f"/api/v1/library/{image_id}", data={"anomaly_name": "New name"}
            )

            assert response.status_code == 403
            assert response.json()["error"]["code"] == "FORBIDDEN"
            mock_store.get_image.assert_not_called()

    def test_update_with_wrong_passkey_is_forbidden(self):
        image_id = uuid4()
        with patch("app.api.v1.endpoints.library.file_store_service") as mock_store:
            client = TestClient(app)
            response = client.put(
                f"/api/v1/library/{image_id}",
                data={"anomaly_name": "New name"},
                headers={"X-Delete-Passkey": "wrong-passkey"},
            )

            assert response.status_code == 403
            mock_store.get_image.assert_not_called()

    def test_update_without_panel_tags_does_not_crash_response_validation(self):
        """Regression test: panel_tags padding must use "" not None —
        ImageResponse.panel_tags is list[str], not nullable, so a request
        that edits fields without touching panel_tags must not produce a
        response with a None entry in that list."""
        image_id = uuid4()
        existing = _make_image(
            image_id, image_path="library/only.jpg", panel_tags=["Image Panel"]
        )
        raw_record = {
            "embedding": [0.1],
            "rerank_embedding": None,
            "embedding_model": "ViT-L-14/openai",
            "rerank_embedding_model": None,
        }
        with (
            patch("app.api.v1.endpoints.library.file_store_service") as mock_store,
            patch("app.api.v1.endpoints.library.local_storage_service"),
        ):
            mock_store.get_image = AsyncMock(return_value=existing)
            mock_store.get_raw_record = AsyncMock(return_value=raw_record)
            mock_store.upsert_image = AsyncMock(return_value=existing)

            client = TestClient(app)
            response = client.put(
                f"/api/v1/library/{image_id}",
                data={"anomaly_name": "Renamed only"},
                headers={"X-Delete-Passkey": "admin123"},
            )

            assert response.status_code == 200
            assert response.json()["image"]["panel_tags"] == [""]

    def test_update_nonexistent_entry_is_not_found(self):
        image_id = uuid4()
        with patch("app.api.v1.endpoints.library.file_store_service") as mock_store:
            mock_store.get_image = AsyncMock(return_value=None)

            client = TestClient(app)
            response = client.put(
                f"/api/v1/library/{image_id}",
                data={"anomaly_name": "New name"},
                headers={"X-Delete-Passkey": "admin123"},
            )

            assert response.status_code == 404

    def test_update_fields_only_reuses_existing_embedding_and_does_not_recompute(self):
        """Editing metadata without touching images shouldn't touch the
        primary image at all — no re-fetch, no re-embed."""
        image_id = uuid4()
        existing = _make_image(
            image_id,
            image_path="library/primary.jpg",
            additional_image_paths=["library/extra.jpg"],
            panel_tags=["Image Panel", "Beamforming Panel"],
        )
        raw_record = {
            "embedding": [0.1, 0.2, 0.3],
            "rerank_embedding": [0.4, 0.5],
            "embedding_model": "ViT-L-14/openai",
            "rerank_embedding_model": "ViT-H-14/laion2b_s32b_b79k",
        }
        with (
            patch("app.api.v1.endpoints.library.file_store_service") as mock_store,
            patch("app.api.v1.endpoints.library.local_storage_service") as mock_local,
            patch("app.api.v1.endpoints.library.embedding_service") as mock_embed,
        ):
            mock_store.get_image = AsyncMock(return_value=existing)
            mock_store.get_raw_record = AsyncMock(return_value=raw_record)
            mock_store.upsert_image = AsyncMock(return_value=existing)
            mock_local.get_image = AsyncMock()
            mock_embed.get_embedding = AsyncMock()

            client = TestClient(app)
            response = client.put(
                f"/api/v1/library/{image_id}",
                data={
                    "anomaly_name": "Updated name",
                    "panel_tags": "Image Panel,Beamforming Panel",
                },
                headers={"X-Delete-Passkey": "admin123"},
            )

            assert response.status_code == 200
            assert response.json()["image"]["anomaly_name"] == "Updated name"
            # Primary image never re-fetched or re-embedded since it didn't change
            mock_local.get_image.assert_not_called()
            mock_embed.get_embedding.assert_not_called()
            # The reused embedding/rerank_embedding came straight from the raw record
            call = mock_store.upsert_image.call_args
            assert call.args[1] == raw_record["embedding"]
            assert call.args[2] == raw_record["rerank_embedding"]
            assert call.kwargs["embedding_model"] == raw_record["embedding_model"]

    def test_update_cannot_remove_last_image_without_replacement(self):
        image_id = uuid4()
        existing = _make_image(image_id, image_path="library/only.jpg", additional_image_paths=[])
        with (
            patch("app.api.v1.endpoints.library.file_store_service") as mock_store,
            patch("app.api.v1.endpoints.library.local_storage_service") as mock_local,
        ):
            mock_store.get_image = AsyncMock(return_value=existing)
            mock_local.delete_image = AsyncMock()

            client = TestClient(app)
            response = client.put(
                f"/api/v1/library/{image_id}",
                data={"remove_media": "0"},
                headers={"X-Delete-Passkey": "admin123"},
            )

            assert response.status_code == 400
            mock_store.upsert_image.assert_not_called()
            mock_local.delete_image.assert_not_called()

    def test_update_removing_primary_and_adding_replacement_recomputes_embedding(self):
        image_id = uuid4()
        existing = _make_image(
            image_id,
            image_path="library/old_primary.jpg",
            additional_image_paths=["library/extra.jpg"],
            panel_tags=["Image Panel", "Beamforming Panel"],
        )
        new_embedding = [0.9, 0.8, 0.7]
        with (
            patch("app.api.v1.endpoints.library.file_store_service") as mock_store,
            patch("app.api.v1.endpoints.library.local_storage_service") as mock_local,
            patch("app.api.v1.endpoints.library.embedding_service") as mock_embed,
        ):
            mock_store.get_image = AsyncMock(return_value=existing)
            mock_store.upsert_image = AsyncMock(return_value=existing)
            mock_local.delete_image = AsyncMock()
            mock_local.upload_image = AsyncMock()
            mock_local.get_image = AsyncMock(return_value=b"new-primary-bytes")
            mock_embed.get_embedding = AsyncMock(return_value=new_embedding)
            mock_embed.model_tag = "ViT-L-14/openai"

            client = TestClient(app)
            response = client.put(
                f"/api/v1/library/{image_id}",
                data={"remove_media": "0", "panel_tags": "Beamforming Panel,New Panel"},
                files={"new_files": ("replacement.jpg", b"fake-bytes", "image/jpeg")},
                headers={"X-Delete-Passkey": "admin123"},
            )

            assert response.status_code == 200
            # Old primary removed, new primary embedded fresh
            mock_local.delete_image.assert_called_once_with("library/old_primary.jpg")
            mock_embed.get_embedding.assert_called_once_with(b"new-primary-bytes")
            call = mock_store.upsert_image.call_args
            assert call.args[1] == new_embedding
            updated_image = call.args[0]
            # Surviving extra.jpg is promoted to primary position... no —
            # remove_media=0 removes the primary, so surviving=[extra.jpg],
            # then the new upload is appended: final = [extra.jpg, new upload]
            assert updated_image.image_path == "library/extra.jpg"
            assert updated_image.additional_image_paths[0].startswith("library/")
