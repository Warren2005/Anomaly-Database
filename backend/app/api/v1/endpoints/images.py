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
    """Return distinct values for gallery and search filter dropdowns."""
    diagnoses = await file_store_service.get_distinct("diagnosis")
    tissue_types = await file_store_service.get_distinct("tissue_type")
    classifications = await file_store_service.get_distinct("benign_malignant")
    anomaly_types = await file_store_service.get_distinct("anomaly_type")
    run_numbers = await file_store_service.get_distinct("run_number")
    anomaly_statuses = await file_store_service.get_distinct("anomaly_status")
    classification_statuses = await file_store_service.get_distinct("classification_status")
    # Growing catalog for the "Anomaly Identification" dropdown — whatever
    # values have actually been used across entries so far. Grows on its
    # own as people fill in new ones; no separate admin "add" step needed
    # (unlike the Run catalog, which is more deliberately curated).
    identifications = await file_store_service.get_distinct("identification")

    return FiltersResponse(
        diagnoses=diagnoses,
        tissue_types=tissue_types,
        benign_malignant=classifications,
        anomaly_types=anomaly_types,
        run_numbers=run_numbers,
        anomaly_statuses=anomaly_statuses,
        classification_statuses=classification_statuses,
        identifications=identifications,
    )


@router.get("/{image_id}/file")
async def get_image_file(image_id: UUID):
    """Proxy the raw primary image bytes from local storage."""
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


@router.get("/{image_id}/media/{index}")
async def get_image_media(image_id: UUID, index: int):
    """Serve primary (0) or additional (1+) media for a library entry."""
    image = await file_store_service.get_image(image_id)
    if not image:
        raise NotFoundError(
            f"Image {image_id} not found",
            details={"image_id": str(image_id)},
        )

    if index == 0:
        path = image.image_path
    else:
        extras = image.additional_image_paths or []
        extra_idx = index - 1
        if extra_idx < 0 or extra_idx >= len(extras):
            raise NotFoundError(
                f"Media index {index} not found for image {image_id}",
                details={"image_id": str(image_id), "index": index},
            )
        path = extras[extra_idx]

    data = await local_storage_service.get_image(path)
    suffix = path.rsplit(".", 1)[-1].lower()
    media_type = "image/jpeg" if suffix in ("jpg", "jpeg") else f"image/{suffix}"
    return Response(content=data, media_type=media_type)


@router.get("/{image_id}", response_model=ImageDetailResponse)
async def get_image(image_id: UUID):
    """Fetch a single image's metadata and media URLs."""
    image = await file_store_service.get_image(image_id)
    if not image:
        raise NotFoundError(
            f"Image {image_id} not found",
            details={"image_id": str(image_id)},
        )
    media_urls = [f"/api/v1/images/{image_id}/file"]
    for i in range(len(image.additional_image_paths or [])):
        media_urls.append(f"/api/v1/images/{image_id}/media/{i + 1}")
    return ImageDetailResponse(
        image=ImageResponse.model_validate(image),
        image_url=media_urls[0],
        media_urls=media_urls,
    )
