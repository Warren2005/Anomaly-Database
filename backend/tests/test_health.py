"""
Tests for health check and root endpoints.
"""

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_info_endpoint():
    """Info endpoint (moved off "/" so that path can serve the built
    frontend instead) returns app info."""
    response = client.get("/api/v1/info")

    assert response.status_code == 200
    data = response.json()

    assert data["status"] == "ok"
    assert data["name"] == "Inspection Image Similarity Engine"
    assert data["version"] == "1.0.0"


def test_health_check_endpoint():
    """Health check returns 200 with service statuses."""
    response = client.get("/api/v1/health")

    assert response.status_code == 200
    data = response.json()

    assert data["status"] == "healthy"
    assert data["services"]["api"] == "up"
    assert data["services"]["storage"] == "up"
    assert data["services"]["clip"] == "up"


def test_health_check_response_structure():
    """Health response has all required fields."""
    response = client.get("/api/v1/health")
    data = response.json()

    required_fields = ["status", "services", "version", "environment", "timestamp"]
    for field in required_fields:
        assert field in data, f"Missing required field: {field}"

    assert isinstance(data["services"], dict)
    assert len(data["services"]) == 3


def test_api_documentation_accessible():
    """Swagger UI is accessible at /docs."""
    response = client.get("/docs")
    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]
