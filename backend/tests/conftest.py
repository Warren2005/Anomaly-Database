"""
Shared test fixtures and mocks.

Mocks external services so tests run without touching real disk paths or
loading a CLIP model.

Re-ranking is disabled for the test session: it's exercised by its own
dedicated tests (with rerank_embedding_service explicitly mocked there),
not by every existing test — leaving it on by default would make every
test that hits /search/similar or /search/text try to load the real
(large, slow-to-download) rerank model.
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.core.config import settings


@pytest.fixture(autouse=True)
def disable_rerank_by_default():
    original = settings.rerank_enabled
    settings.rerank_enabled = False
    yield
    settings.rerank_enabled = original


@pytest.fixture(autouse=True)
def isolate_cache_service(tmp_path):
    """cache_service is now file-backed (embedding_cache.json, shared
    across processes, persists across restarts) instead of an in-process
    dict. That persistence is exactly why tests must NOT use the real
    global store — test_embedding.py's @pytest.mark.slow tests call the
    real (unmocked) get_embedding(), which would otherwise write into the
    actual production ./data/library/embedding_cache.json on every test
    run. Redirect the singleton's storage to an isolated temp dir instead.
    """
    from app.services.cache import cache_service
    from app.services.file_store import FileStoreService

    temp_store = FileStoreService(str(tmp_path / "test_cache"))
    temp_store.connect()
    original_store = cache_service._store
    cache_service._store = temp_store
    yield
    cache_service._store = original_store


@pytest.fixture(autouse=True)
def isolate_event_log(tmp_path):
    """event_log_service is a real file-writer (events.jsonl under
    library_data_dir/logs) — redirect it to a temp dir per test so tests
    never write into the actual production log."""
    from app.services.event_log import event_log_service, EventLogService

    temp_log = EventLogService(str(tmp_path / "test_events"))
    temp_log.connect()
    original_log_dir = event_log_service._log_dir
    original_log_file = event_log_service._log_file
    original_lock_file = event_log_service._lock_file
    event_log_service._log_dir = temp_log._log_dir
    event_log_service._log_file = temp_log._log_file
    event_log_service._lock_file = temp_log._lock_file
    yield
    event_log_service._log_dir = original_log_dir
    event_log_service._log_file = original_log_file
    event_log_service._lock_file = original_lock_file


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
        patch("app.main.rerank_embedding_service") as mock_rerank_main,
        patch("app.main.event_log_service") as mock_event_log_main,
        patch("app.api.v1.endpoints.health.file_store_service") as mock_store_health,
        patch("app.api.v1.endpoints.health.local_storage_service") as mock_local_health,
        patch("app.api.v1.endpoints.health.embedding_service") as mock_embed_health,
    ):
        # Main lifespan mocks
        mock_store_main.connect = MagicMock()
        mock_local_main.connect = MagicMock()
        mock_embed_main.load_model = AsyncMock()
        mock_rerank_main.load_model = AsyncMock()
        mock_event_log_main.connect = MagicMock()

        # Health check mocks
        mock_store_health.health_check = MagicMock(return_value=True)
        mock_local_health.health_check = MagicMock(return_value=True)
        mock_embed_health.health_check = MagicMock(return_value=True)

        yield {
            "store_main": mock_store_main,
            "local_main": mock_local_main,
            "embed_main": mock_embed_main,
            "rerank_main": mock_rerank_main,
            "store_health": mock_store_health,
            "local_health": mock_local_health,
            "embed_health": mock_embed_health,
        }
