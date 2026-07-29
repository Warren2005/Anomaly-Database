"""
Pathologist feedback endpoints.

POST /api/v1/feedback — submit a vote on a search result
GET  /api/v1/feedback/stats — aggregate feedback statistics
"""

from typing import Optional
from uuid import UUID, uuid4

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.models.feedback import Feedback
from app.services.event_log import event_log_service
from app.services.file_store import file_store_service

router = APIRouter()


class FeedbackRequest(BaseModel):
    query_image_id: Optional[UUID] = None
    result_image_id: UUID
    vote: int = Field(..., ge=-1, le=1)


class FeedbackResponse(BaseModel):
    id: UUID
    query_image_id: Optional[UUID]
    result_image_id: UUID
    vote: int


class FeedbackStats(BaseModel):
    total: int
    upvotes: int
    downvotes: int


@router.post("", response_model=FeedbackResponse)
async def submit_feedback(body: FeedbackRequest):
    """Record a pathologist's vote on a search result."""
    fb = Feedback(
        id=uuid4(),
        query_image_id=body.query_image_id,
        result_image_id=body.result_image_id,
        vote=body.vote,
    )
    await file_store_service.add_feedback(fb)
    await event_log_service.log_event(
        "feedback",
        result_image_id=str(fb.result_image_id),
        query_image_id=str(fb.query_image_id) if fb.query_image_id else None,
        vote=fb.vote,
    )
    return FeedbackResponse(
        id=fb.id,
        query_image_id=fb.query_image_id,
        result_image_id=fb.result_image_id,
        vote=fb.vote,
    )


@router.get("/stats", response_model=FeedbackStats)
async def feedback_stats():
    """Return aggregate feedback statistics."""
    stats = await file_store_service.get_feedback_stats()
    return FeedbackStats(**stats)
