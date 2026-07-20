"""Pydantic models for health check responses."""

from pydantic import BaseModel


class ServiceStatus(BaseModel):
    api: str
    storage: str
    clip: str


class HealthResponse(BaseModel):
    status: str  # "healthy" | "degraded" | "unhealthy"
    services: ServiceStatus
    version: str
    environment: str
    timestamp: str
