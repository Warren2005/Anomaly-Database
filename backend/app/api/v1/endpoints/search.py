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

from app.core.errors import ValidationError
from app.schemas.search import SearchResponse, SearchResult
from app.schemas.image import ImageResponse
from app.services.embedding import embedding_service
from app.services.file_store import file_store_service

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
    embedding = await embedding_service.get_embedding(image_bytes)
    embed_time = (time.time() - embed_start) * 1000

    # Brute-force cosine search against the file store
    search_start = time.time()
    matches = await file_store_service.search(
        vector=embedding,
        limit=limit,
        diagnosis=diagnosis,
        tissue_type=tissue_type,
        benign_malignant=benign_malignant,
    )
    search_time = (time.time() - search_start) * 1000

    # Feedback-adjusted scores
    image_ids = [image.id for image, _ in matches]
    feedback_scores = await file_store_service.get_net_votes(image_ids)

    FEEDBACK_WEIGHT = 0.02
    results = []
    for image, score in matches:
        net_vote = feedback_scores.get(image.id, 0)
        adjusted_score = score + (net_vote * FEEDBACK_WEIGHT)
        adjusted_score = max(0.0, min(1.0, adjusted_score))
        results.append(
            SearchResult(
                image=ImageResponse.model_validate(image),
                similarity_score=round(adjusted_score, 6),
                image_url=f"/api/v1/images/{image.id}/file",
            )
        )

    # Re-sort by adjusted score
    results.sort(key=lambda r: r.similarity_score, reverse=True)

    total_time = (time.time() - total_start) * 1000
    return SearchResponse(
        query_processing_time_ms=round(embed_time, 1),
        search_time_ms=round(search_time, 1),
        total_time_ms=round(total_time, 1),
        results=results,
        result_count=len(results),
    )
