"""Tests for the similarity search endpoint."""

import io
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app
from app.models.image import Image


def _make_test_jpeg() -> bytes:
    """Create a minimal JPEG for testing."""
    from PIL import Image as PILImage
    img = PILImage.new("RGB", (64, 64), color="red")
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return buf.getvalue()


def _make_image(image_id) -> Image:
    return Image(
        id=image_id,
        dataset_source="custom_test",
        image_path="custom/test/test.jpg",
        diagnosis="test_label",
        created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        updated_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )


class TestSearchSimilar:
    def test_search_returns_results(self):
        """POST /search/similar returns results with proper structure."""
        image_id = uuid4()
        mock_image = _make_image(image_id)

        with (
            patch("app.api.v1.endpoints.search.embedding_service") as mock_embed,
            patch("app.api.v1.endpoints.search.file_store_service") as mock_store,
        ):
            mock_embed.get_embedding_with_cache_status = AsyncMock(return_value=([0.1] * 512, False))
            mock_store.search = AsyncMock(return_value=[(mock_image, 0.95, None)])
            mock_store.get_net_votes = AsyncMock(return_value={})

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
        """Empty search results return result_count: 0."""
        with (
            patch("app.api.v1.endpoints.search.embedding_service") as mock_embed,
            patch("app.api.v1.endpoints.search.file_store_service") as mock_store,
        ):
            mock_embed.get_embedding_with_cache_status = AsyncMock(return_value=([0.1] * 512, False))
            mock_store.search = AsyncMock(return_value=[])
            mock_store.get_net_votes = AsyncMock(return_value={})

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
            patch("app.api.v1.endpoints.search.file_store_service") as mock_store,
        ):
            mock_embed.get_embedding_with_cache_status = AsyncMock(return_value=([0.1] * 512, False))
            mock_store.search = AsyncMock(return_value=[])
            mock_store.get_net_votes = AsyncMock(return_value={})

            client = TestClient(app)
            response = client.post(
                "/api/v1/search/similar",
                files={"file": ("test.jpg", _make_test_jpeg(), "image/jpeg")},
            )

            data = response.json()
            assert data["query_processing_time_ms"] >= 0
            assert data["search_time_ms"] >= 0
            assert data["total_time_ms"] >= 0
            assert data["rerank_time_ms"] is None  # rerank disabled in tests by default


class TestSearchSimilarWithRerank:
    def test_rerank_reorders_results_and_reports_timing(self):
        """When rerank is enabled, the shortlist is re-scored using the
        rerank embedding and rerank_time_ms is populated."""
        id_a, id_b = uuid4(), uuid4()
        image_a, image_b = _make_image(id_a), _make_image(id_b)

        with (
            patch("app.api.v1.endpoints.search.settings") as mock_settings,
            patch("app.api.v1.endpoints.search.embedding_service") as mock_embed,
            patch("app.api.v1.endpoints.search.rerank_embedding_service") as mock_rerank_embed,
            patch("app.api.v1.endpoints.search.file_store_service") as mock_store,
            # rerank() (app/services/reranking.py) imported file_store_service
            # into its own module namespace, so it needs its own patch target
            # distinct from search.py's — mocking search.py's reference alone
            # doesn't affect what rerank() itself calls.
            patch("app.services.reranking.file_store_service") as mock_rerank_store,
        ):
            mock_settings.rerank_enabled = True
            mock_settings.rerank_candidates = 50

            mock_embed.get_embedding_with_cache_status = AsyncMock(return_value=([1.0, 0.0], False))
            # Primary search ranks A above B...
            mock_store.search = AsyncMock(
                return_value=[(image_a, 0.9, None), (image_b, 0.8, None)]
            )
            mock_store.get_net_votes = AsyncMock(return_value={})
            # ...but the rerank model's stored vectors flip that ordering.
            mock_rerank_store.get_rerank_embeddings = AsyncMock(
                return_value={id_a: [0.0, 1.0], id_b: [1.0, 0.0]}
            )
            mock_rerank_embed.get_embedding = AsyncMock(return_value=[1.0, 0.0])

            client = TestClient(app)
            response = client.post(
                "/api/v1/search/similar",
                files={"file": ("test.jpg", _make_test_jpeg(), "image/jpeg")},
            )

            assert response.status_code == 200
            data = response.json()
            assert data["rerank_time_ms"] is not None
            assert data["rerank_time_ms"] >= 0
            # B (rerank score 1.0) should now outrank A (rerank score 0.0)
            assert data["results"][0]["image"]["id"] == str(id_b)
            assert data["results"][1]["image"]["id"] == str(id_a)
