"""Smoke tests: app boots, public health endpoint, JWT-guarded /api/protected."""

from __future__ import annotations


def test_health_endpoint_returns_ok(client):
    res = client.get("/api/health")
    assert res.status_code == 200
    assert res.get_json() == {"status": "ok"}


def test_protected_requires_jwt(client):
    res = client.get("/api/protected")
    assert res.status_code == 401


def test_protected_accepts_valid_jwt(client, admin_headers):
    res = client.get("/api/protected", headers=admin_headers)
    assert res.status_code == 200
    body = res.get_json()
    assert body["message"] == "You are authenticated"
    assert body["user"]  # JWT identity is the user id string


def test_protected_rejects_malformed_token(client):
    res = client.get(
        "/api/protected",
        headers={"Authorization": "Bearer not-a-real-jwt"},
    )
    assert res.status_code in (401, 422)


def test_cors_preflight_returns_204(client):
    res = client.options(
        "/api/health",
        headers={
            "Origin": "http://localhost:8080",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert res.status_code == 204
