"""
Custom exception classes for the application.

These exceptions provide:
- Consistent error codes
- HTTP status code mapping
- Structured error details
- Clear error messages
"""

from typing import Any, Dict, Optional


class AppException(Exception):
    """
    Base exception for all application errors.
    
    All custom exceptions inherit from this to allow catching
    all app-specific errors with a single except block.
    """
    
    def __init__(
        self,
        message: str,
        error_code: str,
        status_code: int = 500,
        details: Optional[Dict[str, Any]] = None
    ):
        self.message = message
        self.error_code = error_code
        self.status_code = status_code
        self.details = details or {}
        super().__init__(self.message)


class ValidationError(AppException):
    """
    Raised when input validation fails.
    
    Example: Invalid file type, file too large, missing required field
    """
    
    def __init__(self, message: str, details: Optional[Dict[str, Any]] = None):
        super().__init__(
            message=message,
            error_code="VALIDATION_ERROR",
            status_code=400,
            details=details
        )


class NotFoundError(AppException):
    """
    Raised when a requested resource doesn't exist.
    
    Example: Image ID not found in database
    """
    
    def __init__(self, message: str, details: Optional[Dict[str, Any]] = None):
        super().__init__(
            message=message,
            error_code="NOT_FOUND",
            status_code=404,
            details=details
        )


class ConflictError(AppException):
    """
    Raised when a request conflicts with the resource's current state.

    Example: editing a library entry that someone else has since changed
    or deleted — the client's copy is stale.
    """

    def __init__(self, message: str, details: Optional[Dict[str, Any]] = None):
        super().__init__(
            message=message,
            error_code="CONFLICT",
            status_code=409,
            details=details
        )


class ForbiddenError(AppException):
    """
    Raised when a request is well-formed but not permitted.

    Example: missing or incorrect delete passkey.
    """

    def __init__(self, message: str, details: Optional[Dict[str, Any]] = None):
        super().__init__(
            message=message,
            error_code="FORBIDDEN",
            status_code=403,
            details=details
        )


class ServiceUnavailableError(AppException):
    """
    Raised when an external service is unavailable.
    
    Example: Qdrant is down, MinIO unreachable, PostgreSQL connection failed
    """
    
    def __init__(self, message: str, details: Optional[Dict[str, Any]] = None):
        super().__init__(
            message=message,
            error_code="SERVICE_UNAVAILABLE",
            status_code=503,
            details=details
        )