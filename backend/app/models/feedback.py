"""Plain data model for a feedback (vote) record, backed by feedback.json."""

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID


@dataclass
class Feedback:
    id: UUID
    result_image_id: UUID
    vote: int
    query_image_id: Optional[UUID] = None
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
