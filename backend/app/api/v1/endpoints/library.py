"""
Library upload endpoint.

POST /api/v1/library/upload
Accepts an image file with inspection metadata, stores it locally,
generates a CLIP embedding, and persists the record to the file store —
making it immediately searchable.
"""

from typing import Optional
from uuid import uuid4

from fastapi import APIRouter, File, Form, UploadFile

from app.core.config import settings
from app.core.errors import ValidationError
from app.models.image import Image
from app.schemas.image import ImageResponse, LibraryUploadResponse
from app.services.embedding import embedding_service, rerank_embedding_service
from app.services.event_log import event_log_service
from app.services.file_store import file_store_service
from app.services.local_storage import local_storage_service

router = APIRouter()

ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png", "image/tiff"}
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB
CONTENT_TYPE_EXT = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/tiff": ".tiff",
}


@router.post("/upload", response_model=LibraryUploadResponse)
async def upload_to_library(
    file: UploadFile = File(...),
    anomaly_description: Optional[str] = Form(None),
    anomaly_status: Optional[str] = Form(None),
    anomaly_type: Optional[str] = Form(None),
    identification: Optional[str] = Form(None),
    wall_location: Optional[str] = Form(None),
    run_number: Optional[str] = Form(None),
    analysis_comment: Optional[str] = Form(None),
    analyst: Optional[str] = Form(None),
):
    """Upload an image with inspection metadata and add it to the search index."""
    if file.content_type not in ALLOWED_CONTENT_TYPES:
        raise ValidationError(
            "Unsupported file type. Use JPEG, PNG, or TIFF.",
            details={"content_type": file.content_type},
        )

    image_bytes = await file.read()
    if len(image_bytes) > MAX_FILE_SIZE:
        raise ValidationError(
            f"File too large. Maximum size is {MAX_FILE_SIZE // (1024 * 1024)}MB.",
            details={"size_bytes": len(image_bytes)},
        )

    image_id = uuid4()
    ext = CONTENT_TYPE_EXT.get(file.content_type, ".jpg")
    object_name = f"library/{image_id}{ext}"

    await local_storage_service.upload_image(object_name, image_bytes, file.content_type)

    embedding = await embedding_service.get_embedding(image_bytes)
    rerank_embedding = (
        await rerank_embedding_service.get_embedding(image_bytes)
        if settings.rerank_enabled
        else None
    )

    record = Image(
        id=image_id,
        dataset_source="library",
        image_path=object_name,
        anomaly_description=anomaly_description,
        anomaly_status=anomaly_status,
        anomaly_type=anomaly_type,
        identification=identification,
        wall_location=wall_location,
        run_number=run_number,
        analysis_comment=analysis_comment,
        analyst=analyst,
    )
    await file_store_service.upsert_image(
        record,
        embedding,
        rerank_embedding,
        embedding_model=embedding_service.model_tag,
        rerank_embedding_model=rerank_embedding_service.model_tag if rerank_embedding is not None else None,
    )

    await event_log_service.log_event(
        "upload",
        image_id=str(image_id),
        analyst=analyst,
        anomaly_type=anomaly_type,
    )

    return LibraryUploadResponse(
        image=ImageResponse.model_validate(record),
        image_url=f"/api/v1/images/{image_id}/file",
        message="Image saved to library",
    )
