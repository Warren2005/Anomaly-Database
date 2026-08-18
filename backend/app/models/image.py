"""
Plain data model for an image record.

Backed by a JSON file (app/services/file_store.py) rather than a database
table — this dataclass just defines the shape of one record. Field names
match the JSON keys 1:1, and match app/schemas/image.py's ImageResponse
fields, so ImageResponse.model_validate(image) keeps working unchanged.
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID


@dataclass
class Image:
    id: UUID
    image_path: str
    dataset_source: Optional[str] = None
    diagnosis: Optional[str] = None
    tissue_type: Optional[str] = None
    benign_malignant: Optional[str] = None
    age: Optional[int] = None
    sex: Optional[str] = None
    anomaly_description: Optional[str] = None
    anomaly_status: Optional[str] = None
    anomaly_type: Optional[str] = None
    # A reusable, catalog-style category label — not free-form per entry.
    # New values are simply whatever hasn't been typed before (see
    # /api/v1/images/filters' `identifications`, sourced from
    # FileStoreService.get_distinct("identification")); no separate admin
    # step needed to "add" one, unlike the Run catalog.
    identification: Optional[str] = None
    # Unique human-entered identifier for this specific anomaly (distinct
    # from `id`, the internal UUID) — enforced unique at the API layer via
    # FileStoreService.find_by_anomaly_id().
    anomaly_id: Optional[str] = None
    wall_location: Optional[str] = None
    # Crack-like only: which image angle polarity is present ("+", "−", "Both").
    crack_image_angles: Optional[str] = None
    run_number: Optional[str] = None
    analysis_comment: Optional[str] = None
    # Ordered log of who signed off on this entry, oldest first. V1 is
    # always the original creator; every subsequent edit appends (never
    # overwrites) a new {"version", "name", "comment", "timestamp"} entry —
    # see the upload/PUT endpoints in api/v1/endpoints/library.py. timestamp
    # is stored as an ISO string, not a datetime: file_store.py's
    # _image_to_record() only isoformat()s the top-level created_at/updated_at,
    # and a raw datetime nested in this list would break json.dumps on write.
    revision_history: Optional[list] = field(default_factory=list)
    # Zach / ILI reference-library fields
    classification_status: Optional[str] = None
    depth: Optional[float] = None
    width: Optional[float] = None
    length: Optional[float] = None
    is_qc_flag: Optional[bool] = None
    qc_raised_by: Optional[str] = None
    qc_reviewer: Optional[str] = None
    qc_decision_rationale: Optional[str] = None
    signal_description: Optional[str] = None  # Detection signature
    differential_diagnosis: Optional[str] = None  # Similar anomalies / differential diagnosis
    limitations_uncertainty: Optional[str] = None  # Limitations / uncertainty
    notes: Optional[str] = None
    # Panel view tags (e.g. Image Panel, Beamforming Panel) — multi-select
    panel_tags: Optional[list] = field(default_factory=list)
    # Per-image Beamforming surface mode, aligned 1:1 with
    # [image_path, *additional_image_paths] / panel_tags. Empty string
    # when the slot is not a Beamforming Panel. Display-only metadata —
    # search never reads this field.
    beamforming_types: Optional[list] = field(default_factory=list)
    # Free-form, user-growable tags for the anomaly as a whole (distinct
    # from panel_tags, which is per-image from a fixed vocabulary). New
    # values just get typed in — see /api/v1/images/filters' `tags`,
    # sourced from FileStoreService.get_distinct_list_field("tags").
    tags: Optional[list] = field(default_factory=list)
    # Whether this anomaly interacts with other features/components on the
    # pipe. When True, interaction_related_items lists which anomaly
    # types/components it interacts with (values drawn from ANOMALY_TYPES +
    # COMPONENT_OPTIONS on the frontend; forced to [] here when False/None).
    interacts_with_other_features: Optional[bool] = None
    interaction_related_items: Optional[list] = field(default_factory=list)
    # Optional ILI viewer metadata
    zero_angle_frame_index: Optional[int] = None
    track: Optional[int] = None
    # Extra media paths beyond image_path (primary / CLIP source)
    additional_image_paths: Optional[list] = field(default_factory=list)
    # A single optional reference image (team-specific "orientation" shot)
    # shown alongside an entry for context — deliberately NOT part of
    # image_path/additional_image_paths, so it's structurally impossible
    # for it to ever be embedded, searched, or promoted to primary: the
    # entire search/embedding pipeline only ever looks at those two fields.
    orientation_image_path: Optional[str] = None
    # Pipe angle in degrees, associated with the orientation image.
    pipe_angle: Optional[float] = None
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
