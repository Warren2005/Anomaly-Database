"""
Similarity search endpoint.

POST /api/v1/search/similar
Accepts an image file, generates a CLIP embedding on-the-fly, and does a
brute-force cosine-similarity search against every stored image's embedding
(see app/services/file_store.py), returning results with feedback-adjusted
scores.
"""

import time
from typing import Optional

from fastapi import APIRouter, File, Query, Request, UploadFile
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.core.config import settings
from app.core.errors import ValidationError
from app.schemas.search import SearchResponse, SearchResult
from app.schemas.image import ImageResponse
from app.services.embedding import embedding_service, rerank_embedding_service
from app.services.event_log import event_log_service
from app.services.file_store import file_store_service
from app.services.reranking import rerank

router = APIRouter()
limiter = Limiter(key_func=get_remote_address)

ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png", "image/tiff"}
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB


@router.post("/similar", response_model=SearchResponse)
@limiter.limit("30/minute")
async def search_similar(
    request: Request,
    file: UploadFile = File(...),
    limit: int = Query(default=30, ge=1, le=100),
    diagnosis: Optional[str] = Query(default=None),
    tissue_type: Optional[str] = Query(default=None),
    benign_malignant: Optional[str] = Query(default=None),
    panel_tag: Optional[str] = Query(default=None),
):
    """Accept an image and return the top-N most visually similar images."""
    total_start = time.time()

    # Validate file type
    if file.content_type not in ALLOWED_CONTENT_TYPES:
        raise ValidationError(
            "Unsupported file type. Use JPEG, PNG, or TIFF.",
            details={"content_type": file.content_type},
        )

    # Read and validate size
    image_bytes = await file.read()
    if len(image_bytes) > MAX_FILE_SIZE:
        raise ValidationError(
            f"File too large. Maximum size is {MAX_FILE_SIZE // (1024 * 1024)}MB.",
            details={"size_bytes": len(image_bytes)},
        )

    # Generate embedding
    embed_start = time.time()
    embedding, cache_hit = await embedding_service.get_embedding_with_cache_status(image_bytes)
    embed_time = (time.time() - embed_start) * 1000

    scoped_panel = panel_tag.strip() if panel_tag else None
    if scoped_panel:
        # Legacy entries only stored a primary embedding — backfill the
        # tagged panel's media vector so we compare against that image.
        await file_store_service.ensure_panel_media_embeddings(
            scoped_panel,
            embedding_service.get_embedding,
        )

    # Brute-force cosine search against the file store. When re-ranking is
    # on, fetch a wider shortlist so the heavier model has real candidates
    # to re-score, then trim back to `limit` after re-ranking.
    # Panel-scoped search skips re-rank: stored rerank vectors are primary-
    # image only and would undo panel-specific scoring.
    search_start = time.time()
    use_rerank = (
        not scoped_panel
        and settings.rerank_enabled
        and rerank_embedding_service.health_check()
    )
    coarse_limit = (
        max(limit, settings.rerank_candidates)
        if use_rerank
        else limit
    )
    matches = await file_store_service.search(
        vector=embedding,
        limit=coarse_limit,
        diagnosis=diagnosis,
        tissue_type=tissue_type,
        benign_malignant=benign_malignant,
        embedding_model=embedding_service.model_tag,
        panel_tag=scoped_panel,
    )
    search_time = (time.time() - search_start) * 1000

    # Re-rank the shortlist with the heavier model, if enabled and loaded
    rerank_time = None
    if use_rerank and matches:
        rerank_start = time.time()
        rerank_query_vector = await rerank_embedding_service.get_embedding(image_bytes)
        # Drop media_index for the re-ranker; restore None after.
        primary_pairs = [(image, score) for image, score, _ in matches]
        primary_pairs = await rerank(
            primary_pairs, rerank_query_vector, rerank_embedding_service.model_tag
        )
        matches = [(image, score, None) for image, score in primary_pairs]
        rerank_time = (time.time() - rerank_start) * 1000
    matches = matches[:limit]

    # Feedback-adjusted scores
    image_ids = [image.id for image, _, _ in matches]
    feedback_scores = await file_store_service.get_net_votes(image_ids)

    FEEDBACK_WEIGHT = 0.02
    results = []
    for image, score, media_idx in matches:
        net_vote = feedback_scores.get(image.id, 0)
        adjusted_score = score + (net_vote * FEEDBACK_WEIGHT)
        adjusted_score = max(0.0, min(1.0, adjusted_score))
        if media_idx is not None:
            image_url = f"/api/v1/images/{image.id}/media/{media_idx}"
        else:
            image_url = f"/api/v1/images/{image.id}/file"
        results.append(
            SearchResult(
                image=ImageResponse.model_validate(image),
                similarity_score=round(adjusted_score, 6),
                image_url=image_url,
                media_index=media_idx,
                orientation_image_url=(
                    f"/api/v1/images/{image.id}/orientation"
                    if image.orientation_image_path
                    else None
                ),
            )
        )

    # Re-sort by adjusted score
    results.sort(key=lambda r: r.similarity_score, reverse=True)

    total_time = (time.time() - total_start) * 1000

    await event_log_service.log_event(
        "search",
        query_type="image",
        embed_ms=round(embed_time, 1),
        search_ms=round(search_time, 1),
        rerank_ms=round(rerank_time, 1) if rerank_time is not None else None,
        total_ms=round(total_time, 1),
        result_count=len(results),
        cache_hit=cache_hit,
    )

    return SearchResponse(
        query_processing_time_ms=round(embed_time, 1),
        search_time_ms=round(search_time, 1),
        rerank_time_ms=round(rerank_time, 1) if rerank_time is not None else None,
        total_time_ms=round(total_time, 1),
        results=results,
        result_count=len(results),
    )
