"""RBAC decorator behavior — independent of any specific blueprint."""

from __future__ import annotations


def test_admin_allowed_on_admin_only_route(client, admin_headers):
    # /api/users/ requires admin or super_admin
    res = client.get("/api/users/", headers=admin_headers)
    assert res.status_code == 200


def test_surveyor_blocked_on_admin_only(client, surveyor_headers):
    res = client.get("/api/users/", headers=surveyor_headers)
    assert res.status_code == 403


def test_viewer_blocked_on_writer_route(client, viewer_headers):
    # POST /api/roads requires admin/surveyor/super_admin — viewer must fail.
    res = client.post("/api/roads/", headers=viewer_headers, json={
        "road_name": "x", "estimated_distance_km": 1, "road_side": "north"
    })
    assert res.status_code == 403


def test_no_token_blocked_on_protected(client):
    res = client.get("/api/users/")
    assert res.status_code == 401


def test_options_bypasses_rbac(client):
    """CORS preflight must not require auth."""
    res = client.options("/api/users/", headers={
        "Origin": "http://localhost:8080",
        "Access-Control-Request-Method": "GET",
    })
    assert res.status_code == 204
