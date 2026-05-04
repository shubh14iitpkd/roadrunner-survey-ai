"""Categories blueprint: list/create + RBAC."""

from __future__ import annotations

import pytest


def test_list_categories_empty(client, admin_headers):
    res = client.get("/api/categories/", headers=admin_headers)
    assert res.status_code == 200
    assert res.get_json() == {"items": []}


def test_list_categories_requires_auth(client):
    res = client.get("/api/categories/")
    assert res.status_code == 401


@pytest.mark.xfail(
    reason=(
        "BUG in categories/routes.py:create_category — pymongo "
        "insert_one mutates body to add an ObjectId _id, then "
        "jsonify({'item': body}) raises TypeError. Fix: serialize via "
        "mongo_response, or pop/_id-stringify before jsonify."
    ),
    strict=True,
)
def test_create_category_admin(client, admin_headers, db):
    res = client.post("/api/categories/", headers=admin_headers,
                      json={"key": "signs", "name": "Signs"})
    assert res.status_code == 201
    # Row is written even though response serialization fails today.
    assert db.asset_categories.find_one({"key": "signs"}) is not None


def test_create_category_missing_fields(client, admin_headers):
    res = client.post("/api/categories/", headers=admin_headers,
                      json={"key": "only-key"})
    assert res.status_code == 400


def test_create_category_surveyor_forbidden(client, surveyor_headers):
    res = client.post("/api/categories/", headers=surveyor_headers,
                      json={"key": "x", "name": "X"})
    assert res.status_code == 403


def test_list_categories_returns_seeded(client, admin_headers, db):
    db.asset_categories.insert_one({"key": "barrier", "name": "Barrier"})
    res = client.get("/api/categories/", headers=admin_headers)
    items = res.get_json()["items"]
    assert any(it["key"] == "barrier" for it in items)
    # _id should be serialized as a string
    assert all(isinstance(it["_id"], str) for it in items)
