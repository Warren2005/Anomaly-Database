"""
Text-based similarity search endpoint.

POST /api/v1/search/text
Accepts a text query, generates a CLIP text embedding, and does a
brute-force cosine-similarity search against every stored image's embedding.
"""

import time
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.core.config import settings
from app.schemas.search import SearchResponse, SearchResult
from app.schemas.image import ImageResponse
from app.services.embedding import embedding_service, rerank_embedding_service
from app.services.file_store import file_store_service
from app.services.reranking import rerank

router = APIRouter()


class TextSearchRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=500)
    top_k: int = Field(default=30, ge=1, le=100)
    diagnosis: Optional[str] = None
    tissue_type: Optional[str] = None
    benign_malignant: Optional[str] = None


@router.post("/text", response_model=SearchResponse)
async def search_by_text(body: TextSearchRequest):
    """Accept a text query and return the top-N most visually similar images."""
    total_start = time.time()

    # Generate text embedding
    embed_start = time.time()
    embedding = await embedding_service.get_text_embedding(body.query)
    embed_time = (time.time() - embed_start) * 1000

    # Brute-force cosine search against the file store
    search_start = time.time()
    coarse_limit = max(body.top_k, settings.rerank_candidates) if settings.rerank_enabled else body.top_k
    matches = await file_store_service.search(
        vector=embedding,
        limit=coarse_limit,
        diagnosis=body.diagnosis,
        tissue_type=body.tissue_type,
        benign_malignant=body.benign_malignant,
        embedding_model=embedding_service.model_tag,
    )
    search_time = (time.time() - search_start) * 1000

    rerank_time = None
    if settings.rerank_enabled and matches:
        rerank_start = time.time()
        rerank_query_vector = await rerank_embedding_service.get_text_embedding(body.query)
        matches = await rerank(matches, rerank_query_vector, rerank_embedding_service.model_tag)
        rerank_time = (time.time() - rerank_start) * 1000
    matches = matches[: body.top_k]

    results = [
        SearchResult(
            image=ImageResponse.model_validate(image),
            similarity_score=score,
            image_url=f"/api/v1/images/{image.id}/file",
        )
        for image, score in matches
    ]

    total_time = (time.time() - total_start) * 1000
    return SearchResponse(
        query_processing_time_ms=round(embed_time, 1),
        search_time_ms=round(search_time, 1),
        rerank_time_ms=round(rerank_time, 1) if rerank_time is not None else None,
        total_time_ms=round(total_time, 1),
        results=results,
        result_count=len(results),
    )
