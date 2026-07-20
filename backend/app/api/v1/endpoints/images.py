"""
Image detail and filter endpoints.

GET /api/v1/images/filters — distinct filter values for UI dropdowns
GET /api/v1/images/{image_id} — single image metadata + proxy URL
GET /api/v1/images/{image_id}/file — raw image bytes
"""

from uuid import UUID

from fastapi import APIRouter
from fastapi.responses import Response

from app.core.errors import NotFoundError
from app.schemas.image import ImageResponse
from app.schemas.search import FiltersResponse, ImageDetailResponse
from app.services.file_store import file_store_service
from app.services.local_storage import local_storage_service

router = APIRouter()


@router.get("/filters", response_model=FiltersResponse)
async def get_filters():
    """Return distinct values for diagnosis, tissue_type, benign_malignant."""
    diagnoses = await file_store_service.get_distinct("diagnosis")
    tissue_types = await file_store_service.get_distinct("tissue_type")
    classifications = await file_store_service.get_distinct("benign_malignant")

    return FiltersResponse(
        diagnoses=diagnoses,
        tissue_types=tissue_types,
        benign_malignant=classifications,
    )


@router.get("/{image_id}/file")
async def get_image_file(image_id: UUID):
    """Proxy the raw image bytes from local storage."""
    image = await file_store_service.get_image(image_id)
    if not image:
        raise NotFoundError(
            f"Image {image_id} not found",
            details={"image_id": str(image_id)},
        )
    data = await local_storage_service.get_image(image.image_path)
    suffix = image.image_path.rsplit(".", 1)[-1].lower()
    media_type = "image/jpeg" if suffix in ("jpg", "jpeg") else f"image/{suffix}"
    return Response(content=data, media_type=media_type)


@router.get("/{image_id}", response_model=ImageDetailResponse)
async def get_image(image_id: UUID):
    """Fetch a single image's metadata and URL."""
    image = await file_store_service.get_image(image_id)
    if not image:
        raise NotFoundError(
            f"Image {image_id} not found",
            details={"image_id": str(image_id)},
        )
    return ImageDetailResponse(
        image=ImageResponse.model_validate(image),
        image_url=f"/api/v1/images/{image_id}/file",
    )
