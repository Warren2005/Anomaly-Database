"""
Optional second-pass re-ranking.

The primary search (file_store_service.search) returns a coarse shortlist
using the fast/primary embedding. This module re-scores that shortlist
using a second, heavier embedding (rerank_embedding, precomputed and
stored per-image at ingestion time — see Settings.rerank_enabled), so the
expensive model's cost is bounded to the shortlist size, not the corpus.

Images ingested before rerank_embedding existed simply fall back to their
primary-search score rather than being dropped.
"""

import numpy as np

from app.models.image import Image
from app.services.file_store import file_store_service


async def rerank(
    matches: list[tuple[Image, float]], rerank_query_vector: list[float]
) -> list[tuple[Image, float]]:
    """Re-score and re-sort a shortlist using the rerank embedding."""
    if not matches:
        return matches

    image_ids = [image.id for image, _ in matches]
    rerank_vectors = await file_store_service.get_rerank_embeddings(image_ids)

    query = np.array(rerank_query_vector, dtype=np.float32)
    rescored = []
    for image, primary_score in matches:
        vec = rerank_vectors.get(image.id)
        if vec is not None:
            score = float(np.dot(query, np.array(vec, dtype=np.float32)))
        else:
            score = primary_score
        rescored.append((image, score))

    rescored.sort(key=lambda pair: pair[1], reverse=True)
    return rescored
