"""
Explainability endpoint.

POST /api/v1/explain?image_id=<uuid>
Fetches the image from local storage, generates a GradCAM-style saliency
heatmap, and returns the overlay as a PNG.
"""

from uuid import UUID

from fastapi import APIRouter, Query
from fastapi.responses import Response

from app.core.errors import NotFoundError
from app.services.explainability import gradcam_service
from app.services.file_store import file_store_service
from app.services.local_storage import local_storage_service

router = APIRouter()


@router.post("")
async def explain_image(image_id: UUID = Query(...)):
    """Generate an attention heatmap for the given image."""

    image = await file_store_service.get_image(image_id)
    if not image:
        raise NotFoundError(
            f"Image {image_id} not found",
            details={"image_id": str(image_id)},
        )

    image_bytes = await local_storage_service.get_image(image.image_path)

    heatmap_bytes = await gradcam_service.generate_heatmap(image_bytes)

    return Response(content=heatmap_bytes, media_type="image/png")
