"""
Global error handler middleware.

Catches all exceptions and formats them into consistent JSON responses.
This ensures users never see Python stack traces or inconsistent error formats.
"""

import traceback
from fastapi import Request, status
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.errors import AppException
from app.core.logging_config import logger
from app.services.event_log import event_log_service


async def app_exception_handler(request: Request, exc: AppException) -> JSONResponse:
    """
    Handle custom application exceptions.
    
    Converts AppException instances into standardized JSON responses.
    """
    logger.error(
        f"Application error: {exc.error_code}",
        extra={
            "error_code": exc.error_code,
            "status_code": exc.status_code,
            "error_message": exc.message,
            "details": exc.details,
            "path": request.url.path
        }
    )
    
    await event_log_service.log_event(
        "error",
        error_code=exc.error_code,
        status_code=exc.status_code,
        path=request.url.path,
    )

    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": {
                "code": exc.error_code,
                "message": exc.message,
                "details": exc.details
            }
        }
    )


async def validation_exception_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    """
    Handle FastAPI/Pydantic validation errors.
    
    These occur when request body, query params, or path params
    don't match the expected Pydantic model.
    """
    logger.warning(
        "Validation error",
        extra={
            "errors": exc.errors(),
            "path": request.url.path
        }
    )
    
    await event_log_service.log_event(
        "error",
        error_code="VALIDATION_ERROR",
        status_code=status.HTTP_400_BAD_REQUEST,
        path=request.url.path,
    )

    return JSONResponse(
        status_code=status.HTTP_400_BAD_REQUEST,
        content={
            "error": {
                "code": "VALIDATION_ERROR",
                "message": "Request validation failed",
                "details": {
                    "errors": exc.errors()
                }
            }
        }
    )


async def http_exception_handler(
    request: Request, exc: StarletteHTTPException
) -> JSONResponse:
    """
    Handle HTTP exceptions (404, 405, etc.).
    """
    logger.warning(
        f"HTTP error: {exc.status_code}",
        extra={
            "status_code": exc.status_code,
            "detail": exc.detail,
            "path": request.url.path
        }
    )
    
    await event_log_service.log_event(
        "error",
        error_code=f"HTTP_{exc.status_code}",
        status_code=exc.status_code,
        path=request.url.path,
    )

    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": {
                "code": f"HTTP_{exc.status_code}",
                "message": exc.detail,
                "details": {}
            }
        }
    )


async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """
    Catch-all handler for unexpected exceptions.
    
    Logs full stack trace for debugging but returns generic error to user.
    This prevents leaking internal details to API consumers.
    """
    # Log full stack trace for debugging
    logger.error(
        "Unhandled exception",
        extra={
            "exception_type": type(exc).__name__,
            "exception_message": str(exc),
            "path": request.url.path,
            "traceback": traceback.format_exc()
        }
    )
    
    await event_log_service.log_event(
        "error",
        error_code="INTERNAL_SERVER_ERROR",
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        path=request.url.path,
        exception_type=type(exc).__name__,
    )

    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "error": {
                "code": "INTERNAL_SERVER_ERROR",
                "message": "An unexpected error occurred. Please try again later.",
                "details": {}
            }
        }
    )