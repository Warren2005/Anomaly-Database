"""
Library upload / browse / edit / delete endpoints.

POST   /api/v1/library/upload
GET    /api/v1/library/browse
GET    /api/v1/library/runs
POST   /api/v1/library/runs
PUT    /api/v1/library/{image_id}
DELETE /api/v1/library/{image_id}
"""

from datetime import datetime, timezone
from typing import Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, File, Form, Header, UploadFile
from pydantic import BaseModel, Field

from app.core.config import settings
from app.core.errors import ForbiddenError, NotFoundError, ValidationError
from app.models.image import Image
from app.schemas.image import ImageResponse, LibraryUploadResponse
from app.schemas.search import ImageDetailResponse, LibraryBrowseResponse
from app.services.embedding import embedding_service, rerank_embedding_service
from app.services.event_log import event_log_service
from app.services.file_store import file_store_service
from app.services.local_storage import local_storage_service
from app.services.run_catalog import run_catalog_service

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


def _orientation_url(image_id: UUID, image: Image) -> Optional[str]:
    return f"/api/v1/images/{image_id}/orientation" if image.orientation_image_path else None


def _detail(image: Image) -> ImageDetailResponse:
    return ImageDetailResponse(
        image=ImageResponse.model_validate(image),
        image_url=f"/api/v1/images/{image.id}/file",
        media_urls=_media_urls(image.id, image),
        orientation_image_url=_orientation_url(image.id, image),
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
    orientation_image: Optional[UploadFile] = File(None),
    pipe_angle: Optional[float] = Form(None),
    anomaly_description: Optional[str] = Form(None),
    anomaly_status: Optional[str] = Form(None),
    anomaly_type: Optional[str] = Form(None),
    identification: Optional[str] = Form(None),
    anomaly_id: Optional[str] = Form(None),
    wall_location: Optional[str] = Form(None),
    run_number: Optional[str] = Form(None),
    analysis_comment: Optional[str] = Form(None),
    contributor_name: Optional[str] = Form(None),
    contributor_comment: Optional[str] = Form(None),
    classification_status: Optional[str] = Form(None),
    depth: Optional[float] = Form(None),
    width: Optional[float] = Form(None),
    length: Optional[float] = Form(None),
    is_qc_flag: Optional[bool] = Form(None),
    qc_raised_by: Optional[str] = Form(None),
    qc_reviewer: Optional[str] = Form(None),
    qc_decision_rationale: Optional[str] = Form(None),
    signal_description: Optional[str] = Form(None),
    differential_diagnosis: Optional[str] = Form(None),
    limitations_uncertainty: Optional[str] = Form(None),
    notes: Optional[str] = Form(None),
    panel_tags: Optional[str] = Form(None),
    tags: Optional[str] = Form(None),
    interacts_with_other_features: Optional[bool] = Form(None),
    interaction_related_items: Optional[str] = Form(None),
    zero_angle_frame_index: Optional[int] = Form(None),
    track: Optional[int] = Form(None),
):
    """Upload one or more images with ILI metadata; first file is CLIP-indexed."""
    if not files:
        raise ValidationError("At least one image is required.")

    if track is not None and (track < 0 or track > 21):
        raise ValidationError("Track must be an integer between 0 and 21.")

    if not identification or not identification.strip():
        raise ValidationError("Anomaly Identification is required.")
    if not anomaly_id or not anomaly_id.strip():
        raise ValidationError("Anomaly ID is required.")
    anomaly_id = anomaly_id.strip()
    identification = identification.strip()

    if not contributor_name or not contributor_name.strip():
        raise ValidationError("Contributor name is required.")

    if await file_store_service.find_by_anomaly_id(anomaly_id):
        raise ValidationError(
            f"Anomaly ID '{anomaly_id}' is already in use by another entry.",
            details={"field": "anomaly_id"},
        )

    parsed_interaction_items = (
        _parse_tag_list(interaction_related_items) if interacts_with_other_features else []
    )
    if interacts_with_other_features and not parsed_interaction_items:
        raise ValidationError("Select at least one related anomaly type or component.")

    parsed_tags: list[str] = []
    if panel_tags:
        parsed_tags = [
            t.strip()
            for t in panel_tags.replace(";", ",").split(",")
            if t.strip()
        ]
    # Ordered 1:1 with media files when provided that way (primary, then extras).

    parsed_anomaly_tags = _parse_tag_list(tags)

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

    # Reference-only image (never embedded, never searched — see the
    # Image.orientation_image_path docstring). Stored and served through
    # entirely separate paths/endpoints from the searchable media above.
    orientation_path: Optional[str] = None
    if orientation_image is not None and orientation_image.filename:
        ext = CONTENT_TYPE_EXT.get(orientation_image.content_type or "", ".jpg")
        orientation_path = f"library/{image_id}_orientation{ext}"
        await _store_upload(orientation_image, orientation_path)

    embedding = await embedding_service.get_embedding(primary_bytes)
    rerank_embedding = None
    if settings.rerank_enabled and rerank_embedding_service.health_check():
        rerank_embedding = await rerank_embedding_service.get_embedding(primary_bytes)
    elif settings.rerank_enabled:
        # Rerank model failed to load at startup (common on SSL-blocked networks).
        # Still save the entry with primary CLIP only.
        pass

    record = Image(
        id=image_id,
        dataset_source="library",
        image_path=primary_path,
        anomaly_description=anomaly_description,
        anomaly_status=anomaly_status,
        anomaly_type=anomaly_type,
        identification=identification,
        anomaly_id=anomaly_id,
        wall_location=wall_location,
        run_number=run_number,
        analysis_comment=analysis_comment,
        revision_history=[_build_revision_entry(1, contributor_name, contributor_comment)],
        classification_status=classification_status,
        depth=depth,
        width=width,
        length=length,
        is_qc_flag=is_qc_flag,
        qc_raised_by=qc_raised_by,
        qc_reviewer=qc_reviewer,
        qc_decision_rationale=qc_decision_rationale,
        signal_description=signal_description,
        differential_diagnosis=differential_diagnosis,
        limitations_uncertainty=limitations_uncertainty,
        notes=notes,
        panel_tags=parsed_tags,
        tags=parsed_anomaly_tags,
        interacts_with_other_features=interacts_with_other_features,
        interaction_related_items=parsed_interaction_items,
        zero_angle_frame_index=zero_angle_frame_index,
        track=track,
        additional_image_paths=additional_paths,
        orientation_image_path=orientation_path,
        pipe_angle=pipe_angle,
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
        anomaly_id=anomaly_id,
        contributor=contributor_name,
        anomaly_type=anomaly_type,
        media_count=len(files),
    )

    media = _media_urls(image_id, record)
    return LibraryUploadResponse(
        image=ImageResponse.model_validate(record),
        image_url=media[0],
        media_urls=media,
        orientation_image_url=_orientation_url(image_id, record),
        message="Image saved to library",
    )


@router.get("/browse", response_model=LibraryBrowseResponse)
async def browse_library(
    anomaly_type: Optional[str] = None,
    anomaly_types: Optional[str] = None,
    run_number: Optional[str] = None,
    anomaly_status: Optional[str] = None,
    classification_status: Optional[str] = None,
    panel_tags: Optional[str] = None,
    q: Optional[str] = None,
    depth_min: Optional[float] = None,
    depth_max: Optional[float] = None,
    width_min: Optional[float] = None,
    width_max: Optional[float] = None,
    length_min: Optional[float] = None,
    length_max: Optional[float] = None,
):
    """List library images with Zach-style filters (types, panels, status, search)."""
    images = await file_store_service.get_all_images()

    type_set = set()
    if anomaly_types:
        type_set.update(t.strip() for t in anomaly_types.split(",") if t.strip())
    if anomaly_type:
        type_set.add(anomaly_type)

    panel_set = set()
    if panel_tags:
        panel_set.update(t.strip() for t in panel_tags.split(",") if t.strip())

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
        if panel_set:
            tags = set(img.panel_tags or [])
            if not panel_set.intersection(tags):
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
                        img.anomaly_id,
                        img.anomaly_description,
                        img.signal_description,
                        img.differential_diagnosis,
                        img.limitations_uncertainty,
                        img.identification,
                        img.analysis_comment,
                        img.notes,
                        " ".join(e.get("name", "") for e in (img.revision_history or [])),
                        img.run_number,
                        img.anomaly_type,
                        img.qc_decision_rationale,
                        " ".join(img.panel_tags or []),
                        " ".join(img.tags or []),
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


class RunEntry(BaseModel):
    run: str = Field(..., min_length=1, max_length=64)
    run_id: str = Field(..., min_length=1, max_length=128)


class RunsResponse(BaseModel):
    runs: list[RunEntry]


@router.get("/runs", response_model=RunsResponse)
async def list_runs():
    """Return the ILI run catalog (defaults + admin-added runs)."""
    return RunsResponse(runs=await run_catalog_service.list_runs())


@router.post("/runs", response_model=RunEntry)
async def add_run(
    body: RunEntry,
    x_delete_passkey: Optional[str] = Header(default=None),
):
    """Add a run + Run ID. Requires the same admin passkey as delete."""
    if x_delete_passkey != settings.library_delete_passkey:
        raise ForbiddenError("Incorrect passkey.")
    try:
        entry = await run_catalog_service.add_run(body.run, body.run_id)
    except ValueError as exc:
        raise ValidationError(str(exc)) from exc
    return RunEntry(**entry)


def _parse_tag_list(raw: Optional[str]) -> list[str]:
    """Comma-separated tags -> a clean, case-insensitively-deduped list,
    preserving the first-seen casing. Always authoritative (the caller —
    the edit form especially — is expected to resend the complete current
    list on every save, same convention as panel_tags), so there's no
    None-vs-blank ambiguity to resolve here: nothing/blank just means "no
    tags," on both create and edit.
    """
    if not raw:
        return []
    seen: set[str] = set()
    result: list[str] = []
    for t in raw.split(","):
        t = t.strip()
        if not t or t.lower() in seen:
            continue
        seen.add(t.lower())
        result.append(t)
    return result


def _build_revision_entry(version: int, name: str, comment: Optional[str]) -> dict:
    """timestamp is baked in as an ISO string here (not a datetime) because
    it ends up nested inside Image.revision_history, a plain list field —
    file_store.py's _image_to_record() only isoformat()s the top-level
    created_at/updated_at, so a raw datetime here would break json.dumps.
    """
    return {
        "version": version,
        "name": name.strip(),
        "comment": (comment or "").strip() or None,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


def _resolved(raw: Optional[str], existing):
    """Resolve a raw form value against the existing field value:
    - field absent from the form (raw is None)  -> keep existing
    - field present but blank ("")               -> clear to None
    - field present with a value                  -> use it
    Lets an edit form always resend every field (so blanking one out is a
    real "clear this" instead of accidentally reverting to autofill-once
    upload semantics, where an absent field just means "wasn't set yet").
    """
    if raw is None:
        return existing
    return raw if raw != "" else None


def _resolved_num(raw: Optional[str], existing, cast):
    if raw is None:
        return existing
    if raw == "":
        return None
    try:
        return cast(raw)
    except ValueError as exc:
        raise ValidationError(f"Invalid number: {raw!r}") from exc


@router.put("/{image_id}", response_model=LibraryUploadResponse)
async def update_library_entry(
    image_id: UUID,
    new_files: list[UploadFile] = File(default=[]),
    new_orientation_image: Optional[UploadFile] = File(None),
    remove_orientation_image: Optional[bool] = Form(None),
    pipe_angle: Optional[str] = Form(None),
    panel_tags: Optional[str] = Form(None),
    remove_media: Optional[str] = Form(None),
    anomaly_description: Optional[str] = Form(None),
    anomaly_status: Optional[str] = Form(None),
    anomaly_type: Optional[str] = Form(None),
    identification: Optional[str] = Form(None),
    anomaly_id: Optional[str] = Form(None),
    wall_location: Optional[str] = Form(None),
    run_number: Optional[str] = Form(None),
    analysis_comment: Optional[str] = Form(None),
    contributor_name: Optional[str] = Form(None),
    contributor_comment: Optional[str] = Form(None),
    classification_status: Optional[str] = Form(None),
    depth: Optional[str] = Form(None),
    width: Optional[str] = Form(None),
    length: Optional[str] = Form(None),
    is_qc_flag: Optional[bool] = Form(None),
    qc_raised_by: Optional[str] = Form(None),
    qc_reviewer: Optional[str] = Form(None),
    qc_decision_rationale: Optional[str] = Form(None),
    signal_description: Optional[str] = Form(None),
    differential_diagnosis: Optional[str] = Form(None),
    limitations_uncertainty: Optional[str] = Form(None),
    notes: Optional[str] = Form(None),
    tags: Optional[str] = Form(None),
    interacts_with_other_features: Optional[bool] = Form(None),
    interaction_related_items: Optional[str] = Form(None),
    zero_angle_frame_index: Optional[str] = Form(None),
    track: Optional[str] = Form(None),
    x_delete_passkey: Optional[str] = Header(default=None),
):
    """Edit an existing library entry's fields and/or its images.

    Requires the same X-Delete-Passkey header as deleting an entry — a
    lightweight speed bump against casual edits, not a real auth system
    (this app deliberately has none — see RUNNING_INSTRUCTIONS.md).

    Media handling: `remove_media` is a comma-separated list of indices
    into the entry's current [primary, *additional] media list (0 =
    primary). Those images are removed; `new_files` are appended after
    the survivors, with `panel_tags` (comma-separated, aligned to the
    final [survivors..., new...] order) giving every resulting image's
    panel tag. The resulting entry must end up with at least one image —
    if it wouldn't, the whole edit is rejected before anything is
    written or uploaded.
    """
    if x_delete_passkey != settings.library_delete_passkey:
        raise ForbiddenError("Incorrect passkey.")

    existing = await file_store_service.get_image(image_id)
    if not existing:
        raise NotFoundError(
            f"Image {image_id} not found", details={"image_id": str(image_id)}
        )

    track_val = _resolved_num(track, existing.track, int)
    if track_val is not None and (track_val < 0 or track_val > 21):
        raise ValidationError("Track must be an integer between 0 and 21.")

    identification_val = _resolved(identification, existing.identification)
    if not identification_val or not identification_val.strip():
        raise ValidationError("Anomaly Identification is required.")
    identification_val = identification_val.strip()

    anomaly_id_val = _resolved(anomaly_id, existing.anomaly_id)
    if not anomaly_id_val or not anomaly_id_val.strip():
        raise ValidationError("Anomaly ID is required.")
    anomaly_id_val = anomaly_id_val.strip()

    conflict = await file_store_service.find_by_anomaly_id(anomaly_id_val, exclude_id=image_id)
    if conflict:
        raise ValidationError(
            f"Anomaly ID '{anomaly_id_val}' is already in use by another entry.",
            details={"field": "anomaly_id"},
        )

    if not contributor_name or not contributor_name.strip():
        raise ValidationError("Contributor name is required.")
    next_revision_version = len(existing.revision_history or []) + 1
    revision_history_val = (existing.revision_history or []) + [
        _build_revision_entry(next_revision_version, contributor_name, contributor_comment)
    ]

    interacts_val = (
        interacts_with_other_features
        if interacts_with_other_features is not None
        else existing.interacts_with_other_features
    )
    interaction_items_val = _parse_tag_list(interaction_related_items) if interacts_val else []
    if interacts_val and not interaction_items_val:
        raise ValidationError("Select at least one related anomaly type or component.")

    current_paths = [existing.image_path, *(existing.additional_image_paths or [])]

    remove_indices: set[int] = set()
    if remove_media:
        for tok in remove_media.split(","):
            tok = tok.strip()
            if tok.isdigit():
                remove_indices.add(int(tok))

    surviving = [
        p for i, p in enumerate(current_paths) if i not in remove_indices
    ]

    if not surviving and not new_files:
        raise ValidationError(
            "An anomaly must have at least one image — add a replacement "
            "before removing the last one."
        )

    new_paths: list[str] = []
    for f in new_files:
        ext = CONTENT_TYPE_EXT.get(f.content_type or "", ".jpg")
        path = f"library/{image_id}_{uuid4().hex[:8]}{ext}"
        await _store_upload(f, path)
        new_paths.append(path)

    # Orientation reference image — handled entirely separately from the
    # searchable media above/below; never touches primary/embedding logic.
    # A replacement takes priority over a removal request in the same
    # submission (the frontend never sends both at once, but if it did,
    # "here's the new one" is the more sensible read than "delete it").
    orientation_path = existing.orientation_image_path
    if new_orientation_image is not None and new_orientation_image.filename:
        ext = CONTENT_TYPE_EXT.get(new_orientation_image.content_type or "", ".jpg")
        new_o_path = f"library/{image_id}_orientation_{uuid4().hex[:8]}{ext}"
        await _store_upload(new_orientation_image, new_o_path)
        if existing.orientation_image_path:
            try:
                await local_storage_service.delete_image(existing.orientation_image_path)
            except Exception:
                pass
        orientation_path = new_o_path
    elif remove_orientation_image and existing.orientation_image_path:
        try:
            await local_storage_service.delete_image(existing.orientation_image_path)
        except Exception:
            pass
        orientation_path = None

    final_paths = surviving + new_paths
    # Padded with "" rather than None: ImageResponse's panel_tags is
    # list[str] (not nullable), matching how the upload endpoint's own
    # parsing never produces None entries either.
    final_tags: list[str] = (
        [t.strip() for t in panel_tags.split(",")] if panel_tags else []
    )
    if len(final_tags) < len(final_paths):
        final_tags += [""] * (len(final_paths) - len(final_tags))
    final_tags = final_tags[: len(final_paths)]

    # Now that we know the edit is going through, remove the files that
    # dropped out (do this after storing new uploads, so a mid-request
    # failure never leaves an entry with zero retrievable images).
    removed_paths = [p for i, p in enumerate(current_paths) if i in remove_indices]
    for p in removed_paths:
        try:
            await local_storage_service.delete_image(p)
        except Exception:
            pass

    new_primary_path = final_paths[0]
    new_additional_paths = final_paths[1:]

    if new_primary_path != existing.image_path:
        primary_bytes = await local_storage_service.get_image(new_primary_path)
        embedding = await embedding_service.get_embedding(primary_bytes)
        rerank_embedding = None
        if settings.rerank_enabled and rerank_embedding_service.health_check():
            rerank_embedding = await rerank_embedding_service.get_embedding(primary_bytes)
        embedding_model = embedding_service.model_tag
        rerank_embedding_model = (
            rerank_embedding_service.model_tag if rerank_embedding is not None else None
        )
    else:
        # Primary image unchanged — carry the existing embedding forward
        # rather than recomputing it (same bytes, same vector).
        raw = await file_store_service.get_raw_record(image_id)
        embedding = raw.get("embedding") if raw else None
        rerank_embedding = raw.get("rerank_embedding") if raw else None
        embedding_model = raw.get("embedding_model") if raw else None
        rerank_embedding_model = raw.get("rerank_embedding_model") if raw else None
        if embedding is None:
            primary_bytes = await local_storage_service.get_image(new_primary_path)
            embedding = await embedding_service.get_embedding(primary_bytes)
            embedding_model = embedding_service.model_tag

    updated = Image(
        id=existing.id,
        dataset_source=existing.dataset_source,
        image_path=new_primary_path,
        anomaly_description=_resolved(anomaly_description, existing.anomaly_description),
        anomaly_status=_resolved(anomaly_status, existing.anomaly_status),
        anomaly_type=_resolved(anomaly_type, existing.anomaly_type),
        identification=identification_val,
        anomaly_id=anomaly_id_val,
        wall_location=_resolved(wall_location, existing.wall_location),
        run_number=_resolved(run_number, existing.run_number),
        analysis_comment=_resolved(analysis_comment, existing.analysis_comment),
        revision_history=revision_history_val,
        classification_status=_resolved(classification_status, existing.classification_status),
        depth=_resolved_num(depth, existing.depth, float),
        width=_resolved_num(width, existing.width, float),
        length=_resolved_num(length, existing.length, float),
        is_qc_flag=is_qc_flag if is_qc_flag is not None else existing.is_qc_flag,
        qc_raised_by=_resolved(qc_raised_by, existing.qc_raised_by),
        qc_reviewer=_resolved(qc_reviewer, existing.qc_reviewer),
        qc_decision_rationale=_resolved(qc_decision_rationale, existing.qc_decision_rationale),
        signal_description=_resolved(signal_description, existing.signal_description),
        differential_diagnosis=_resolved(
            differential_diagnosis, existing.differential_diagnosis
        ),
        limitations_uncertainty=_resolved(
            limitations_uncertainty, existing.limitations_uncertainty
        ),
        notes=_resolved(notes, existing.notes),
        panel_tags=final_tags,
        tags=_parse_tag_list(tags),
        interacts_with_other_features=interacts_val,
        interaction_related_items=interaction_items_val,
        zero_angle_frame_index=_resolved_num(
            zero_angle_frame_index, existing.zero_angle_frame_index, int
        ),
        track=track_val,
        additional_image_paths=new_additional_paths,
        orientation_image_path=orientation_path,
        pipe_angle=_resolved_num(pipe_angle, existing.pipe_angle, float),
        created_at=existing.created_at,
    )

    await file_store_service.upsert_image(
        updated,
        embedding,
        rerank_embedding,
        embedding_model=embedding_model,
        rerank_embedding_model=rerank_embedding_model,
    )

    await event_log_service.log_event(
        "update",
        image_id=str(image_id),
        media_count=len(final_paths),
        primary_changed=new_primary_path != existing.image_path,
    )

    media = _media_urls(image_id, updated)
    return LibraryUploadResponse(
        image=ImageResponse.model_validate(updated),
        image_url=media[0],
        media_urls=media,
        orientation_image_url=_orientation_url(image_id, updated),
        message="Entry updated",
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

    paths = [
        deleted.image_path,
        *(deleted.additional_image_paths or []),
        deleted.orientation_image_path,
    ]
    for path in paths:
        if path:
            try:
                await local_storage_service.delete_image(path)
            except Exception:
                pass

    await event_log_service.log_event("delete", image_id=str(image_id))
    return {"ok": True, "image_id": str(image_id)}
