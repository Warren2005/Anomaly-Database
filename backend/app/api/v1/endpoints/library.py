"""
Library upload / browse / delete endpoints.

POST /api/v1/library/upload
GET  /api/v1/library/browse
DELETE /api/v1/library/{image_id}
"""

from typing import Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, File, Form, Header, UploadFile

from app.core.config import settings
from app.core.errors import ForbiddenError, NotFoundError, ValidationError
from app.models.image import Image
from app.schemas.image import ImageResponse, LibraryUploadResponse
from app.schemas.search import ImageDetailResponse, LibraryBrowseResponse
from app.services.embedding import embedding_service, rerank_embedding_service
from app.services.event_log import event_log_service
from app.services.file_store import file_store_service
from app.services.local_storage import local_storage_service

router = APIRouter()

ALLOWED_CONTENT_TYPES = {
    "image/jpeg",
    "image/png",
    "image/tiff",
    "image/gif",
    "image/webp",
}
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB
CONTENT_TYPE_EXT = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/tiff": ".tiff",
    "image/gif": ".gif",
    "image/webp": ".webp",
}


def _media_urls(image_id: UUID, image: Image) -> list[str]:
    urls = [f"/api/v1/images/{image_id}/file"]
    extras = image.additional_image_paths or []
    for i in range(len(extras)):
        urls.append(f"/api/v1/images/{image_id}/media/{i + 1}")
    return urls


def _detail(image: Image) -> ImageDetailResponse:
    return ImageDetailResponse(
        image=ImageResponse.model_validate(image),
        image_url=f"/api/v1/images/{image.id}/file",
        media_urls=_media_urls(image.id, image),
    )


async def _store_upload(upload: UploadFile, object_name: str) -> bytes:
    if upload.content_type not in ALLOWED_CONTENT_TYPES:
        raise ValidationError(
            "Unsupported file type. Use JPEG, PNG, TIFF, GIF, or WebP.",
            details={"content_type": upload.content_type, "filename": upload.filename},
        )
    image_bytes = await upload.read()
    if len(image_bytes) > MAX_FILE_SIZE:
        raise ValidationError(
            f"File too large. Maximum size is {MAX_FILE_SIZE // (1024 * 1024)}MB.",
            details={"size_bytes": len(image_bytes), "filename": upload.filename},
        )
    await local_storage_service.upload_image(
        object_name, image_bytes, upload.content_type or "image/jpeg"
    )
    return image_bytes


@router.post("/upload", response_model=LibraryUploadResponse)
async def upload_to_library(
    files: list[UploadFile] = File(...),
    anomaly_description: Optional[str] = Form(None),
    anomaly_status: Optional[str] = Form(None),
    anomaly_type: Optional[str] = Form(None),
    identification: Optional[str] = Form(None),
    wall_location: Optional[str] = Form(None),
    run_number: Optional[str] = Form(None),
    analysis_comment: Optional[str] = Form(None),
    analyst: Optional[str] = Form(None),
    anomaly_name: Optional[str] = Form(None),
    classification_status: Optional[str] = Form(None),
    depth: Optional[float] = Form(None),
    width: Optional[float] = Form(None),
    length: Optional[float] = Form(None),
    is_qc_flag: Optional[bool] = Form(None),
    qc_raised_by: Optional[str] = Form(None),
    qc_reviewer: Optional[str] = Form(None),
    qc_decision_rationale: Optional[str] = Form(None),
    signal_description: Optional[str] = Form(None),
    notes: Optional[str] = Form(None),
):
    """Upload one or more images with ILI metadata; first file is CLIP-indexed."""
    if not files:
        raise ValidationError("At least one image is required.")

    image_id = uuid4()
    primary = files[0]
    primary_ext = CONTENT_TYPE_EXT.get(primary.content_type or "", ".jpg")
    primary_path = f"library/{image_id}{primary_ext}"
    primary_bytes = await _store_upload(primary, primary_path)

    additional_paths: list[str] = []
    for idx, extra in enumerate(files[1:], start=1):
        ext = CONTENT_TYPE_EXT.get(extra.content_type or "", ".jpg")
        path = f"library/{image_id}_{idx}{ext}"
        await _store_upload(extra, path)
        additional_paths.append(path)

    embedding = await embedding_service.get_embedding(primary_bytes)
    rerank_embedding = (
        await rerank_embedding_service.get_embedding(primary_bytes)
        if settings.rerank_enabled
        else None
    )

    record = Image(
        id=image_id,
        dataset_source="library",
        image_path=primary_path,
        anomaly_description=anomaly_description,
        anomaly_status=anomaly_status,
        anomaly_type=anomaly_type,
        identification=identification,
        wall_location=wall_location,
        run_number=run_number,
        analysis_comment=analysis_comment,
        analyst=analyst,
        anomaly_name=anomaly_name,
        classification_status=classification_status,
        depth=depth,
        width=width,
        length=length,
        is_qc_flag=is_qc_flag,
        qc_raised_by=qc_raised_by,
        qc_reviewer=qc_reviewer,
        qc_decision_rationale=qc_decision_rationale,
        signal_description=signal_description,
        notes=notes,
        additional_image_paths=additional_paths,
    )
    await file_store_service.upsert_image(
        record,
        embedding,
        rerank_embedding,
        embedding_model=embedding_service.model_tag,
        rerank_embedding_model=rerank_embedding_service.model_tag
        if rerank_embedding is not None
        else None,
    )

    await event_log_service.log_event(
        "upload",
        image_id=str(image_id),
        analyst=analyst,
        anomaly_type=anomaly_type,
        media_count=len(files),
    )

    media = _media_urls(image_id, record)
    return LibraryUploadResponse(
        image=ImageResponse.model_validate(record),
        image_url=media[0],
        media_urls=media,
        message="Image saved to library",
    )


@router.get("/browse", response_model=LibraryBrowseResponse)
async def browse_library(
    anomaly_type: Optional[str] = None,
    anomaly_types: Optional[str] = None,
    run_number: Optional[str] = None,
    anomaly_status: Optional[str] = None,
    classification_status: Optional[str] = None,
    q: Optional[str] = None,
    depth_min: Optional[float] = None,
    depth_max: Optional[float] = None,
    width_min: Optional[float] = None,
    width_max: Optional[float] = None,
    length_min: Optional[float] = None,
    length_max: Optional[float] = None,
):
    """List library images with Zach-style filters (types, dims, status, search)."""
    images = await file_store_service.get_all_images()

    type_set = set()
    if anomaly_types:
        type_set.update(t.strip() for t in anomaly_types.split(",") if t.strip())
    if anomaly_type:
        type_set.add(anomaly_type)

    def in_range(value: Optional[float], lo: Optional[float], hi: Optional[float]) -> bool:
        if value is None:
            return lo is None and hi is None
        if lo is not None and value < lo:
            return False
        if hi is not None and value > hi:
            return False
        return True

    def matches(img: Image) -> bool:
        if type_set and img.anomaly_type not in type_set:
            return False
        if run_number and img.run_number != run_number:
            return False
        if anomaly_status and img.anomaly_status != anomaly_status:
            return False
        if classification_status and img.classification_status != classification_status:
            return False
        if depth_min is not None or depth_max is not None:
            if img.depth is None or not in_range(img.depth, depth_min, depth_max):
                return False
        if width_min is not None or width_max is not None:
            if img.width is None or not in_range(img.width, width_min, width_max):
                return False
        if length_min is not None or length_max is not None:
            if img.length is None or not in_range(img.length, length_min, length_max):
                return False
        if q:
            needle = q.strip().lower()
            hay = " ".join(
                filter(
                    None,
                    [
                        img.anomaly_name,
                        img.anomaly_description,
                        img.signal_description,
                        img.identification,
                        img.analysis_comment,
                        img.notes,
                        img.analyst,
                        img.run_number,
                        img.anomaly_type,
                        img.qc_decision_rationale,
                    ],
                )
            ).lower()
            if needle not in hay:
                return False
        return True

    filtered = [img for img in images if matches(img)]
    filtered.sort(key=lambda i: i.created_at, reverse=True)

    return LibraryBrowseResponse(
        images=[_detail(img) for img in filtered],
        total=len(filtered),
    )


@router.delete("/{image_id}")
async def delete_library_entry(image_id: UUID, x_delete_passkey: Optional[str] = Header(default=None)):
    """Remove a library entry and its stored media files.

    Requires the X-Delete-Passkey header to match Settings.library_delete_passkey
    — a lightweight speed bump against accidental/casual deletes, not a real
    auth system (this app deliberately has none — see RUNNING_INSTRUCTIONS.md).
    """
    if x_delete_passkey != settings.library_delete_passkey:
        raise ForbiddenError("Incorrect passkey.")

    deleted = await file_store_service.delete_image(image_id)
    if not deleted:
        raise NotFoundError(
            f"Image {image_id} not found",
            details={"image_id": str(image_id)},
        )

    paths = [deleted.image_path, *(deleted.additional_image_paths or [])]
    for path in paths:
        if path:
            try:
                await local_storage_service.delete_image(path)
            except Exception:
                pass

    await event_log_service.log_event("delete", image_id=str(image_id))
    return {"ok": True, "image_id": str(image_id)}
