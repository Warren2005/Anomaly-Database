"""
Shared test fixtures and mocks.

Mocks external services so tests run without touching real disk paths or
loading the CLIP model. cache_service is a plain in-process dict now, so
it needs no mocking — its real connect()/disconnect() are harmless no-ops.
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch


@pytest.fixture(autouse=True)
def mock_services():
    """Mock all external service singletons for every test.

    Patches at all import locations so the mocks are seen
    by both main.py (lifespan) and health.py (health checks).
    """
    with (
        patch("app.main.file_store_service") as mock_store_main,
        patch("app.main.local_storage_service") as mock_local_main,
        patch("app.main.embedding_service") as mock_embed_main,
        patch("app.api.v1.endpoints.health.file_store_service") as mock_store_health,
        patch("app.api.v1.endpoints.health.local_storage_service") as mock_local_health,
        patch("app.api.v1.endpoints.health.embedding_service") as mock_embed_health,
    ):
        # Main lifespan mocks
        mock_store_main.connect = MagicMock()
        mock_local_main.connect = MagicMock()
        mock_embed_main.load_model = AsyncMock()

        # Health check mocks
        mock_store_health.health_check = MagicMock(return_value=True)
        mock_local_health.health_check = MagicMock(return_value=True)
        mock_embed_health.health_check = MagicMock(return_value=True)

        yield {
            "store_main": mock_store_main,
            "local_main": mock_local_main,
            "embed_main": mock_embed_main,
            "store_health": mock_store_health,
            "local_health": mock_local_health,
            "embed_health": mock_embed_health,
        }
