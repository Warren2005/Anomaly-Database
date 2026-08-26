"""
Health check endpoint.

Checks connectivity to all backend services:
- Local file store (metadata.json)
- Local image storage
- Primary embedding model
"""

from fastapi import APIRouter
from datetime import datetime

from app.core.config import settings
from app.schemas.health import HealthResponse, ServiceStatus
from app.services.file_store import file_store_service
from app.services.local_storage import local_storage_service
from app.services.embedding import embedding_service

router = APIRouter()


@router.get("/health", response_model=HealthResponse)
async def health_check():
    """
    Health check — returns status of all backend services.

    Overall status:
    - "healthy" if all services are up
    - "degraded" if some services are down
    - "unhealthy" if all external services are down
    """
    service_checks = {"api": "up"}

    # Check local storage (file store + image directory)
    try:
        storage_ok = file_store_service.health_check() and local_storage_service.health_check()
        service_checks["storage"] = "up" if storage_ok else "down"
    except Exception:
        service_checks["storage"] = "down"

    # Check primary embedding model
    try:
        service_checks["embedding_model"] = "up" if embedding_service.health_check() else "down"
    except Exception:
        service_checks["embedding_model"] = "down"

    # Determine overall status
    external_services = ["storage", "embedding_model"]
    up_count = sum(1 for s in external_services if service_checks[s] == "up")

    if up_count == len(external_services):
        overall = "healthy"
    elif up_count == 0:
        overall = "unhealthy"
    else:
        overall = "degraded"

    return HealthResponse(
        status=overall,
        services=ServiceStatus(**service_checks),
        version=settings.app_version,
        environment=settings.environment,
        timestamp=datetime.utcnow().isoformat() + "Z",
    )
