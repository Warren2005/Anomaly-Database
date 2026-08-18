"""
Image detail and filter endpoints.

GET /api/v1/images/filters — distinct filter values for UI dropdowns
GET /api/v1/images/{image_id} — single image metadata + proxy URL
GET /api/v1/images/{image_id}/file — raw image bytes
GET /api/v1/images/{image_id}/orientation — the optional reference-only
    orientation image (never part of search — see Image.orientation_image_path)
"""

from uuid import UUID

from fastapi import APIRouter
from fastapi.responses import Response

from app.core.errors import NotFoundError
from app.schemas.image import ImageResponse
from app.schemas.search import FiltersResponse, ImageDetailResponse
from app.services.file_store import file_store_service
from app.services.local_storage import local_storage_service
from app.services.tag_catalog import tag_catalog_service

router = APIRouter()

# These endpoints are stable, index-based URLs (.../file, .../media/{n})
# whose underlying bytes change whenever an entry's images are reordered,
# replaced, or removed — the URL itself never changes, only what it
# currently resolves to. Without this header, browsers are free to cache
# a response by URL and keep serving old bytes under a since-changed
# panel tag/primary label after an edit (see the panel-mislabeling bug
# this fixed: a viewer's browser cached "/media/1" from before a reorder,
# so they saw the new, correct label sitting on the old, stale picture).
NO_CACHE_HEADERS = {"Cache-Control": "no-store"}


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
    wall_locations = await file_store_service.get_distinct("wall_location")
    used_tags = await file_store_service.get_distinct_list_field("tags")
    catalog_tags = await tag_catalog_service.list_tags()
    seen: set[str] = set()
    tags: list[str] = []
    for tag in [*catalog_tags, *used_tags]:
        key = tag.lower()
        if key in seen:
            continue
        seen.add(key)
        tags.append(tag)
    tags.sort(key=lambda t: t.lower())

    return FiltersResponse(
        diagnoses=diagnoses,
        tissue_types=tissue_types,
        benign_malignant=classifications,
        anomaly_types=anomaly_types,
        run_numbers=run_numbers,
        anomaly_statuses=anomaly_statuses,
        classification_statuses=classification_statuses,
        identifications=identifications,
        tags=tags,
        wall_locations=wall_locations,
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
    return Response(content=data, media_type=media_type, headers=NO_CACHE_HEADERS)


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
    return Response(content=data, media_type=media_type, headers=NO_CACHE_HEADERS)


@router.get("/{image_id}/orientation")
async def get_image_orientation(image_id: UUID):
    """Serve the optional orientation reference image — never part of the
    searchable media set (see Image.orientation_image_path)."""
    image = await file_store_service.get_image(image_id)
    if not image or not image.orientation_image_path:
        raise NotFoundError(
            f"No orientation image for {image_id}",
            details={"image_id": str(image_id)},
        )
    data = await local_storage_service.get_image(image.orientation_image_path)
    suffix = image.orientation_image_path.rsplit(".", 1)[-1].lower()
    media_type = "image/jpeg" if suffix in ("jpg", "jpeg") else f"image/{suffix}"
    return Response(content=data, media_type=media_type, headers=NO_CACHE_HEADERS)


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
    orientation_url = (
        f"/api/v1/images/{image_id}/orientation" if image.orientation_image_path else None
    )
    return ImageDetailResponse(
        image=ImageResponse.model_validate(image),
        image_url=media_urls[0],
        media_urls=media_urls,
        orientation_image_url=orientation_url,
    )
