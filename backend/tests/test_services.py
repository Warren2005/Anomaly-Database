"""
Tests for the file-based storage services (file_store, local_storage,
cache) and health endpoint integration.
"""

import json
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.models.feedback import Feedback
from app.models.image import Image
from app.services.cache import CacheService
from app.services.file_store import FileStoreService
from app.services.local_storage import LocalStorageService
from app.services.reranking import rerank


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
async def test_file_store_stores_and_returns_rerank_embeddings():
    with tempfile.TemporaryDirectory() as tmpdir:
        store = FileStoreService(tmpdir)
        store.connect()
        image_id = uuid4()
        await store.upsert_image(
            Image(id=image_id, image_path="a.jpg"), [1.0, 0.0], rerank_embedding=[0.5, 0.5]
        )

        vectors = await store.get_rerank_embeddings([image_id])
        assert vectors[image_id] == [0.5, 0.5]


@pytest.mark.asyncio
async def test_file_store_rerank_embedding_defaults_to_none():
    """Images upserted without a rerank_embedding (e.g. ingested before the
    feature existed) shouldn't show up in get_rerank_embeddings at all."""
    with tempfile.TemporaryDirectory() as tmpdir:
        store = FileStoreService(tmpdir)
        store.connect()
        image_id = uuid4()
        await store.upsert_image(Image(id=image_id, image_path="a.jpg"), [1.0, 0.0])

        vectors = await store.get_rerank_embeddings([image_id])
        assert image_id not in vectors


@pytest.mark.asyncio
async def test_rerank_reorders_by_rerank_vector():
    id_a, id_b = uuid4(), uuid4()
    image_a = Image(id=id_a, image_path="a.jpg")
    image_b = Image(id=id_b, image_path="b.jpg")

    with tempfile.TemporaryDirectory() as tmpdir:
        from app.services import reranking as reranking_module

        store = FileStoreService(tmpdir)
        store.connect()
        await store.upsert_image(image_a, [1.0, 0.0], rerank_embedding=[0.0, 1.0])
        await store.upsert_image(image_b, [0.9, 0.1], rerank_embedding=[1.0, 0.0])

        # reranking.py did `from app.services.file_store import
        # file_store_service`, so the name to patch lives in the
        # reranking module's namespace, not file_store's.
        with patch.object(reranking_module, "file_store_service", store):
            # Primary search ranked A first (score 1.0 > 0.9)...
            matches = [(image_a, 1.0), (image_b, 0.9)]
            # ...but the rerank query vector aligns with B's rerank vector.
            rescored = await rerank(matches, rerank_query_vector=[1.0, 0.0])

        assert rescored[0][0].id == id_b
        assert rescored[1][0].id == id_a


@pytest.mark.asyncio
async def test_rerank_falls_back_to_primary_score_when_no_rerank_vector():
    """An image with no stored rerank_embedding keeps its primary score
    instead of being dropped or crashing the re-scoring pass."""
    with tempfile.TemporaryDirectory() as tmpdir:
        from app.services import reranking as reranking_module

        store = FileStoreService(tmpdir)
        store.connect()
        image = Image(id=uuid4(), image_path="a.jpg")
        await store.upsert_image(image, [1.0, 0.0])  # no rerank_embedding
        matches = [(image, 0.77)]

        with patch.object(reranking_module, "file_store_service", store):
            rescored = await rerank(matches, rerank_query_vector=[1.0, 0.0])

        assert rescored == [(image, 0.77)]


@pytest.mark.asyncio
async def test_file_store_search_filters_out_mismatched_embedding_model():
    """A model swap must never silently compare embeddings from two
    different CLIP checkpoints — records from an old model version should
    be excluded from search results for the new one."""
    with tempfile.TemporaryDirectory() as tmpdir:
        store = FileStoreService(tmpdir)
        store.connect()
        await store.upsert_image(
            Image(id=uuid4(), image_path="old.jpg"), [1.0, 0.0], embedding_model="ViT-B-32/openai"
        )
        await store.upsert_image(
            Image(id=uuid4(), image_path="new.jpg"), [1.0, 0.0], embedding_model="ViT-L-14/openai"
        )

        results = await store.search(vector=[1.0, 0.0], limit=10, embedding_model="ViT-L-14/openai")

        assert len(results) == 1
        assert results[0][0].image_path == "new.jpg"


@pytest.mark.asyncio
async def test_file_store_search_without_model_filter_ignores_tags():
    """Passing no embedding_model (the default) keeps existing behavior —
    e.g. the embedding cache's own lookups don't care about model tags."""
    with tempfile.TemporaryDirectory() as tmpdir:
        store = FileStoreService(tmpdir)
        store.connect()
        await store.upsert_image(
            Image(id=uuid4(), image_path="old.jpg"), [1.0, 0.0], embedding_model="ViT-B-32/openai"
        )
        await store.upsert_image(
            Image(id=uuid4(), image_path="new.jpg"), [1.0, 0.0], embedding_model="ViT-L-14/openai"
        )

        results = await store.search(vector=[1.0, 0.0], limit=10)

        assert len(results) == 2


@pytest.mark.asyncio
async def test_file_store_get_rerank_embeddings_filters_by_model():
    with tempfile.TemporaryDirectory() as tmpdir:
        store = FileStoreService(tmpdir)
        store.connect()
        id_old, id_new = uuid4(), uuid4()
        await store.upsert_image(
            Image(id=id_old, image_path="old.jpg"),
            [1.0, 0.0],
            rerank_embedding=[0.5, 0.5],
            rerank_embedding_model="ViT-H-14/laion400m",
        )
        await store.upsert_image(
            Image(id=id_new, image_path="new.jpg"),
            [1.0, 0.0],
            rerank_embedding=[0.2, 0.8],
            rerank_embedding_model="ViT-H-14/laion2b_s32b_b79k",
        )

        vectors = await store.get_rerank_embeddings(
            [id_old, id_new], rerank_embedding_model="ViT-H-14/laion2b_s32b_b79k"
        )

        assert id_new in vectors
        assert id_old not in vectors


@pytest.mark.asyncio
async def test_file_store_get_model_tag_counts():
    with tempfile.TemporaryDirectory() as tmpdir:
        store = FileStoreService(tmpdir)
        store.connect()
        await store.upsert_image(
            Image(id=uuid4(), image_path="a.jpg"), [1.0, 0.0], embedding_model="ViT-L-14/openai"
        )
        await store.upsert_image(
            Image(id=uuid4(), image_path="b.jpg"), [1.0, 0.0], embedding_model="ViT-L-14/openai"
        )
        await store.upsert_image(Image(id=uuid4(), image_path="c.jpg"), [1.0, 0.0])  # untagged

        counts = await store.get_model_tag_counts()

        assert counts["embedding_model"]["ViT-L-14/openai"] == 2
        assert counts["embedding_model"]["(untagged)"] == 1


@pytest.mark.asyncio
async def test_rerank_falls_back_to_primary_score_on_model_mismatch():
    """A rerank_embedding stored under an old model version must fall back
    to the primary score, same as if no rerank_embedding existed at all —
    not get compared against a new-model query vector."""
    with tempfile.TemporaryDirectory() as tmpdir:
        from app.services import reranking as reranking_module

        store = FileStoreService(tmpdir)
        store.connect()
        image = Image(id=uuid4(), image_path="a.jpg")
        await store.upsert_image(
            image, [1.0, 0.0], rerank_embedding=[0.0, 1.0], rerank_embedding_model="old-model/v1"
        )

        with patch.object(reranking_module, "file_store_service", store):
            rescored = await rerank(
                [(image, 0.42)], rerank_query_vector=[1.0, 0.0], rerank_model_tag="new-model/v2"
            )

        assert rescored == [(image, 0.42)]


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
    with tempfile.TemporaryDirectory() as tmpdir:
        store = FileStoreService(tmpdir)
        store.connect()
        cache = CacheService(store=store)
        await cache.set_embedding("hash1", [0.1, 0.2])
        result = await cache.get_embedding("hash1")
        assert result == [0.1, 0.2]


@pytest.mark.asyncio
async def test_cache_service_miss_returns_none():
    with tempfile.TemporaryDirectory() as tmpdir:
        store = FileStoreService(tmpdir)
        store.connect()
        cache = CacheService(store=store)
        result = await cache.get_embedding("nonexistent")
        assert result is None


@pytest.mark.asyncio
async def test_cache_service_shared_across_instances():
    """Two CacheService instances backed by the same store (i.e. two
    worker processes) see each other's writes — the whole point of moving
    off the in-process dict."""
    with tempfile.TemporaryDirectory() as tmpdir:
        store = FileStoreService(tmpdir)
        store.connect()
        writer = CacheService(store=store)
        reader = CacheService(store=store)

        await writer.set_embedding("hash1", [0.9, 0.1])
        result = await reader.get_embedding("hash1")
        assert result == [0.9, 0.1]


@pytest.mark.asyncio
async def test_cache_service_prunes_expired_entries():
    with tempfile.TemporaryDirectory() as tmpdir:
        store = FileStoreService(tmpdir, cache_ttl_days=7)
        store.connect()
        cache = CacheService(store=store)
        await cache.set_embedding("fresh", [0.1])

        # Manually backdate the entry past the TTL and let the next write prune it.
        cache_file = Path(tmpdir) / "embedding_cache.json"
        data = json.loads(cache_file.read_text())
        data["fresh"]["cached_at"] = (
            datetime.now(timezone.utc) - timedelta(days=30)
        ).isoformat()
        cache_file.write_text(json.dumps(data))

        await cache.set_embedding("other", [0.2])  # triggers pruning as a side effect

        assert await cache.get_embedding("fresh") is None
        assert await cache.get_embedding("other") == [0.2]


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
