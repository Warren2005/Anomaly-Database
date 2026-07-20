"""
FastAPI application entry point.

This file:
- Creates the FastAPI app with lifespan manager
- Configures middleware (CORS, error handling)
- Includes API routes
- Connects/disconnects services on startup/shutdown
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.routing import Route

from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from app.core.config import settings
from app.core.logging_config import logger
from app.core.errors import AppException
from app.middleware.error_handler import (
    app_exception_handler,
    validation_exception_handler,
    http_exception_handler,
    unhandled_exception_handler,
)
from app.middleware.metrics import PrometheusMiddleware, metrics_endpoint
from app.api.v1.endpoints.router import api_router
from app.services.file_store import file_store_service
from app.services.local_storage import local_storage_service
from app.services.embedding import embedding_service
from app.services.cache import cache_service

# Rate limiter
limiter = Limiter(key_func=get_remote_address)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage service connections on startup and shutdown."""
    # Startup
    logger.info(
        "Application starting",
        extra={
            "app_name": settings.app_name,
            "version": settings.app_version,
            "environment": settings.environment,
        },
    )

    # Connect services (failures are logged but don't prevent startup)
    try:
        file_store_service.connect()
    except Exception as e:
        logger.error(f"Failed to initialize file store: {e}")

    try:
        local_storage_service.connect()
    except Exception as e:
        logger.error(f"Failed to initialize local image storage: {e}")

    try:
        await embedding_service.load_model()
    except Exception as e:
        logger.error(f"Failed to load CLIP model: {e}")

    await cache_service.connect()

    yield

    # Shutdown
    logger.info("Application shutting down")
    await cache_service.disconnect()


# Create FastAPI application
app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description="REST API for industrial inspection image similarity search",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)


# Rate limiter state
app.state.limiter = limiter

# CORS middleware - allows frontend to call backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Prometheus metrics middleware
app.add_middleware(PrometheusMiddleware)


# Register exception handlers
app.add_exception_handler(AppException, app_exception_handler)
app.add_exception_handler(RequestValidationError, validation_exception_handler)
app.add_exception_handler(StarletteHTTPException, http_exception_handler)
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_exception_handler(Exception, unhandled_exception_handler)


# Include API routes
app.include_router(api_router, prefix="/api/v1")

# Prometheus metrics endpoint
app.routes.append(Route("/metrics", metrics_endpoint))


@app.get("/")
async def root():
    """Root endpoint - API information."""
    return {
        "name": settings.app_name,
        "version": settings.app_version,
        "status": "ok",
        "docs_url": "/docs",
        "health_url": "/api/v1/health",
    }
