"""
API v1 router — combines all endpoint modules.
"""

from fastapi import APIRouter
from app.api.v1.endpoints import (
    health,
    search,
    text_search,
    images,
    ws_search,
    batch_search,
    library,
)

api_router = APIRouter()

api_router.include_router(health.router, tags=["Health"])
api_router.include_router(search.router, prefix="/search", tags=["Search"])
api_router.include_router(text_search.router, prefix="/search", tags=["Search"])
api_router.include_router(batch_search.router, prefix="/search", tags=["Batch Search"])
api_router.include_router(images.router, prefix="/images", tags=["Images"])
api_router.include_router(ws_search.router, tags=["WebSocket"])
api_router.include_router(library.router, prefix="/library", tags=["Library"])
