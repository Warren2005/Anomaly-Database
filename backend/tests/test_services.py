"""
Tests for the file-based storage services (file_store, local_storage,
cache) and health endpoint integration.
"""

import tempfile
from unittest.mock import patch
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.models.feedback import Feedback
from app.models.image import Image
from app.services.cache import CacheService
from app.services.file_store import FileStoreService
from app.services.local_storage import LocalStorageService


@pytest.mark.asyncio
async def test_file_store_upsert_and_get_image():
    with tempfile.TemporaryDirectory() as tmpdir:
        store = FileStoreService(tmpdir)
        store.connect()
        image = Image(id=uuid4(), image_path="test.jpg", diagnosis="test")
        await store.upsert_image(image, embedding=[0.1, 0.2, 0.3, 0.4])

        fetched = await store.get_image(image.id)
        assert fetched is not None
        assert fetched.diagnosis == "test"


@pytest.mark.asyncio
async def test_file_store_upsert_overwrites_existing():
    with tempfile.TemporaryDirectory() as tmpdir:
        store = FileStoreService(tmpdir)
        store.connect()
        image_id = uuid4()
        await store.upsert_image(
            Image(id=image_id, image_path="test.jpg", diagnosis="first"), [0.1] * 4
        )
        await store.upsert_image(
            Image(id=image_id, image_path="test.jpg", diagnosis="second"), [0.2] * 4
        )

        all_images = await store.get_all_images()
        assert len(all_images) == 1
        assert all_images[0].diagnosis == "second"


@pytest.mark.asyncio
async def test_file_store_search_ranks_by_similarity():
    with tempfile.TemporaryDirectory() as tmpdir:
        store = FileStoreService(tmpdir)
        store.connect()
        await store.upsert_image(Image(id=uuid4(), image_path="a.jpg"), [1.0, 0.0])
        await store.upsert_image(Image(id=uuid4(), image_path="b.jpg"), [0.0, 1.0])

        results = await store.search(vector=[1.0, 0.0], limit=2)
        assert len(results) == 2
        assert results[0][1] > results[1][1]


@pytest.mark.asyncio
async def test_file_store_search_applies_diagnosis_filter():
    with tempfile.TemporaryDirectory() as tmpdir:
        store = FileStoreService(tmpdir)
        store.connect()
        await store.upsert_image(
            Image(id=uuid4(), image_path="a.jpg", diagnosis="melanoma"), [1.0, 0.0]
        )
        await store.upsert_image(
            Image(id=uuid4(), image_path="b.jpg", diagnosis="nevus"), [1.0, 0.0]
        )

        results = await store.search(vector=[1.0, 0.0], limit=10, diagnosis="nevus")
        assert len(results) == 1
        assert results[0][0].diagnosis == "nevus"


@pytest.mark.asyncio
async def test_file_store_get_distinct_filters_none():
    with tempfile.TemporaryDirectory() as tmpdir:
        store = FileStoreService(tmpdir)
        store.connect()
        await store.upsert_image(
            Image(id=uuid4(), image_path="a.jpg", diagnosis="melanoma"), [0.1]
        )
        await store.upsert_image(
            Image(id=uuid4(), image_path="b.jpg", diagnosis=None), [0.1]
        )

        values = await store.get_distinct("diagnosis")
        assert values == ["melanoma"]


@pytest.mark.asyncio
async def test_file_store_feedback_net_votes():
    with tempfile.TemporaryDirectory() as tmpdir:
        store = FileStoreService(tmpdir)
        store.connect()
        result_id = uuid4()
        await store.add_feedback(Feedback(id=uuid4(), result_image_id=result_id, vote=1))
        await store.add_feedback(Feedback(id=uuid4(), result_image_id=result_id, vote=1))
        await store.add_feedback(Feedback(id=uuid4(), result_image_id=result_id, vote=-1))

        votes = await store.get_net_votes([result_id])
        assert votes[result_id] == 1


@pytest.mark.asyncio
async def test_file_store_feedback_stats():
    with tempfile.TemporaryDirectory() as tmpdir:
        store = FileStoreService(tmpdir)
        store.connect()
        await store.add_feedback(Feedback(id=uuid4(), result_image_id=uuid4(), vote=1))
        await store.add_feedback(Feedback(id=uuid4(), result_image_id=uuid4(), vote=-1))

        stats = await store.get_feedback_stats()
        assert stats == {"total": 2, "upvotes": 1, "downvotes": 1}


@pytest.mark.asyncio
async def test_local_storage_roundtrip():
    with tempfile.TemporaryDirectory() as tmpdir:
        storage = LocalStorageService(tmpdir)
        storage.connect()
        await storage.upload_image("custom/test.jpg", b"fake-bytes", "image/jpeg")
        data = await storage.get_image("custom/test.jpg")
        assert data == b"fake-bytes"


@pytest.mark.asyncio
async def test_cache_service_get_set():
    cache = CacheService()
    await cache.set_embedding("hash1", [0.1, 0.2])
    result = await cache.get_embedding("hash1")
    assert result == [0.1, 0.2]


@pytest.mark.asyncio
async def test_cache_service_miss_returns_none():
    cache = CacheService()
    result = await cache.get_embedding("nonexistent")
    assert result is None


def test_health_endpoint_reports_all_services():
    """Health endpoint should report status for all services."""
    from app.main import app

    client = TestClient(app)
    response = client.get("/api/v1/health")

    assert response.status_code == 200
    data = response.json()

    assert "services" in data
    services = data["services"]
    assert "api" in services
    assert "storage" in services
    assert "clip" in services


def test_health_healthy_when_all_up():
    """Status should be 'healthy' when all services are up."""
    from app.main import app

    client = TestClient(app)
    response = client.get("/api/v1/health")
    data = response.json()

    assert data["services"]["api"] == "up"
    assert "timestamp" in data
    assert "version" in data


def test_health_unhealthy_when_storage_down():
    """Storage is the only external service checked now, so it failing
    makes the overall status 'unhealthy' rather than 'degraded'."""
    from app.main import app

    with patch("app.api.v1.endpoints.health.file_store_service") as mock_store:
        mock_store.health_check.side_effect = ConnectionError("down")

        client = TestClient(app)
        response = client.get("/api/v1/health")
        data = response.json()

        assert data["status"] == "unhealthy"
        assert data["services"]["storage"] == "down"
