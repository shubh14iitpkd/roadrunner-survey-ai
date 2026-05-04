"""Roads blueprint: CRUD + RBAC."""

from __future__ import annotations


def _make_road_payload(**overrides):
    payload = {
        "road_name": "Test Highway",
        "start_point_name": "A",
        "end_point_name": "B",
        "start_lat": 25.0,
        "start_lng": 51.0,
        "end_lat": 25.5,
        "end_lng": 51.5,
        "estimated_distance_km": 12.3,
        "road_side": "north",
    }
    payload.update(overrides)
    return payload


# ── list / get ────────────────────────────────────────────────────────────

def test_list_roads_empty(client, admin_headers):
    res = client.get("/api/roads/", headers=admin_headers)
    assert res.status_code == 200
    body = res.get_json()
    assert body == {"items": [], "count": 0}


def test_list_roads_requires_auth(client):
    res = client.get("/api/roads/")
    assert res.status_code == 401


def test_get_road_not_found(client, admin_headers):
    res = client.get("/api/roads/9999", headers=admin_headers)
    assert res.status_code == 404


# ── create ────────────────────────────────────────────────────────────────

def test_create_road_admin(client, admin_headers):
    res = client.post("/api/roads/", headers=admin_headers,
                      json=_make_road_payload())
    assert res.status_code == 201
    body = res.get_json()
    assert body["item"]["road_name"] == "Test Highway"
    assert body["item"]["route_id"] >= 1


def test_create_road_surveyor_allowed(client, surveyor_headers):
    res = client.post("/api/roads/", headers=surveyor_headers,
                      json=_make_road_payload())
    assert res.status_code == 201


def test_create_road_viewer_forbidden(client, viewer_headers):
    res = client.post("/api/roads/", headers=viewer_headers,
                      json=_make_road_payload())
    assert res.status_code == 403


def test_create_road_missing_required_fields(client, admin_headers):
    res = client.post("/api/roads/", headers=admin_headers,
                      json={"road_name": "Only Name"})
    assert res.status_code == 400
    body = res.get_json()
    assert "missing" in body["error"]


def test_create_road_duplicate_name_rejected(client, admin_headers):
    client.post("/api/roads/", headers=admin_headers,
                json=_make_road_payload(road_name="Dup Road"))
    res = client.post("/api/roads/", headers=admin_headers,
                      json=_make_road_payload(road_name="Dup Road"))
    assert res.status_code == 400


def test_create_then_get_road(client, admin_headers):
    create = client.post("/api/roads/", headers=admin_headers,
                         json=_make_road_payload(road_name="Get Me"))
    route_id = create.get_json()["item"]["route_id"]

    res = client.get(f"/api/roads/{route_id}", headers=admin_headers)
    assert res.status_code == 200
    body = res.get_json()
    assert body["item"]["road_name"] == "Get Me"


# ── update ────────────────────────────────────────────────────────────────

def test_update_road(client, admin_headers):
    create = client.post("/api/roads/", headers=admin_headers,
                         json=_make_road_payload(road_name="Renamable"))
    route_id = create.get_json()["item"]["route_id"]

    res = client.put(f"/api/roads/{route_id}", headers=admin_headers,
                     json={"road_name": "Renamed"})
    assert res.status_code == 200
    assert res.get_json()["ok"] is True


def test_update_road_not_found(client, admin_headers):
    res = client.put("/api/roads/99999", headers=admin_headers,
                     json={"road_name": "x"})
    assert res.status_code == 404


# ── delete ────────────────────────────────────────────────────────────────

def test_delete_road_admin(client, admin_headers):
    create = client.post("/api/roads/", headers=admin_headers,
                         json=_make_road_payload(road_name="Killable"))
    route_id = create.get_json()["item"]["route_id"]

    res = client.delete(f"/api/roads/{route_id}", headers=admin_headers)
    assert res.status_code == 200
    assert client.get(f"/api/roads/{route_id}",
                      headers=admin_headers).status_code == 404


def test_delete_road_surveyor_forbidden(client, admin_headers, surveyor_headers):
    create = client.post("/api/roads/", headers=admin_headers,
                         json=_make_road_payload(road_name="Survivor"))
    route_id = create.get_json()["item"]["route_id"]

    res = client.delete(f"/api/roads/{route_id}", headers=surveyor_headers)
    assert res.status_code == 403


def test_delete_road_not_found(client, admin_headers):
    res = client.delete("/api/roads/99999", headers=admin_headers)
    assert res.status_code == 404


# ── filters ───────────────────────────────────────────────────────────────

def test_list_roads_filter_by_side(client, admin_headers):
    client.post("/api/roads/", headers=admin_headers,
                json=_make_road_payload(road_name="N1", road_side="north"))
    client.post("/api/roads/", headers=admin_headers,
                json=_make_road_payload(
                    road_name="S1", road_side="south",
                    start_lat=10.0, start_lng=10.0,
                    end_lat=11.0, end_lng=11.0,
                ))

    res = client.get("/api/roads/?side=south", headers=admin_headers)
    assert res.status_code == 200
    items = res.get_json()["items"]
    assert all(r["road_side"] == "south" for r in items)
    assert len(items) == 1
