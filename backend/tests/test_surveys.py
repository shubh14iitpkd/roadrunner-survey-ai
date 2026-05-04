"""Surveys blueprint: list, get, create, RBAC."""

from __future__ import annotations


def _seed_road(client, admin_headers, name="SurveyRoad"):
    res = client.post("/api/roads/", headers=admin_headers, json={
        "road_name": name,
        "start_point_name": "A",
        "end_point_name": "B",
        "start_lat": 25.0,
        "start_lng": 51.0,
        "end_lat": 25.5,
        "end_lng": 51.5,
        "estimated_distance_km": 5.0,
        "road_side": "north",
    })
    assert res.status_code == 201
    return res.get_json()["item"]["route_id"]


def test_list_surveys_empty(client, admin_headers):
    res = client.get("/api/surveys/", headers=admin_headers)
    assert res.status_code == 200
    body = res.get_json()
    assert body == {"items": [], "count": 0}


def test_list_surveys_requires_auth(client):
    res = client.get("/api/surveys/")
    assert res.status_code == 401


def test_create_survey(client, admin_headers):
    route_id = _seed_road(client, admin_headers)
    res = client.post("/api/surveys/", headers=admin_headers, json={
        "route_id": route_id,
        "survey_date": "2026-05-01",
        "surveyor_name": "Inspector",
    })
    assert res.status_code == 201
    body = res.get_json()
    assert body["item"]["route_id"] == route_id
    assert body["item"]["survey_version"] == 1
    assert body["item"]["is_latest"] is True
    assert body["item"]["survey_display_id"].startswith("SUR-")


def test_create_survey_increments_version_and_marks_latest(client, admin_headers):
    route_id = _seed_road(client, admin_headers)
    payload = {
        "route_id": route_id,
        "survey_date": "2026-05-01",
        "surveyor_name": "Inspector",
    }
    a = client.post("/api/surveys/", headers=admin_headers, json=payload).get_json()["item"]
    b = client.post("/api/surveys/", headers=admin_headers, json=payload).get_json()["item"]

    assert a["survey_version"] == 1
    assert b["survey_version"] == 2

    listing = client.get(f"/api/surveys/?route_id={route_id}",
                         headers=admin_headers).get_json()["items"]
    latest = [s for s in listing if s["is_latest"]]
    assert len(latest) == 1
    assert latest[0]["survey_version"] == 2


def test_create_survey_missing_fields(client, admin_headers):
    res = client.post("/api/surveys/", headers=admin_headers, json={"route_id": 1})
    assert res.status_code == 400


def test_create_survey_viewer_forbidden(client, admin_headers, viewer_headers):
    route_id = _seed_road(client, admin_headers)
    res = client.post("/api/surveys/", headers=viewer_headers, json={
        "route_id": route_id,
        "survey_date": "2026-05-01",
        "surveyor_name": "Inspector",
    })
    assert res.status_code == 403


def test_get_survey_history_for_route(client, admin_headers):
    route_id = _seed_road(client, admin_headers)
    payload = {
        "route_id": route_id,
        "survey_date": "2026-05-01",
        "surveyor_name": "Inspector",
    }
    client.post("/api/surveys/", headers=admin_headers, json=payload)
    client.post("/api/surveys/", headers=admin_headers, json=payload)

    res = client.get(f"/api/surveys/route/{route_id}/history", headers=admin_headers)
    assert res.status_code == 200
    body = res.get_json()
    assert body["count"] == 2
    versions = [s["survey_version"] for s in body["items"]]
    assert versions == sorted(versions, reverse=True)
