"""Pure unit tests for utility modules — no app context needed."""

from __future__ import annotations

import pytest


# ── utils.security ────────────────────────────────────────────────────────

class TestSecurity:
    def test_hash_password_returns_bcrypt_hash(self):
        from utils.security import hash_password, is_bcrypt_hash
        h = hash_password("hunter2")
        assert is_bcrypt_hash(h)
        assert h != "hunter2"

    def test_verify_password_accepts_correct(self):
        from utils.security import hash_password, verify_password
        h = hash_password("hunter2")
        assert verify_password("hunter2", h) is True

    def test_verify_password_rejects_wrong(self):
        from utils.security import hash_password, verify_password
        h = hash_password("hunter2")
        assert verify_password("wrong", h) is False

    def test_verify_password_handles_empty_hash(self):
        from utils.security import verify_password
        assert verify_password("anything", "") is False

    def test_verify_password_handles_garbage_hash(self):
        from utils.security import verify_password
        # bcrypt raises on malformed; helper must swallow.
        assert verify_password("x", "not-a-hash") is False

    def test_hash_password_coerces_non_string(self):
        from utils.security import hash_password, verify_password
        h = hash_password(None)  # type: ignore[arg-type]
        # None coerces to empty string per implementation
        assert verify_password("", h) is True


# ── utils.roles ────────────────────────────────────────────────────────────

class TestRoles:
    @pytest.mark.parametrize("input_role,expected", [
        ("admin", "admin"),
        ("Admin", "admin"),
        ("Road Surveyor", "road_surveyor"),
        ("road_surveyor", "road_surveyor"),
        ("surveyor", "road_surveyor"),
        ("Asset Manager", "asset_manager"),
        ("viewer", "viewer"),
        ("super_admin", "super_admin"),
        ("Super Admin", "super_admin"),
    ])
    def test_normalize_to_canonical(self, input_role, expected):
        from utils.roles import normalize_to_canonical
        assert normalize_to_canonical(input_role) == expected

    def test_normalize_default(self):
        from utils.roles import normalize_to_canonical
        assert normalize_to_canonical(None) == "road_surveyor"
        assert normalize_to_canonical("") == "road_surveyor"
        assert normalize_to_canonical("nonsense") == "road_surveyor"

    @pytest.mark.parametrize("canonical,display", [
        ("admin", "Admin"),
        ("road_surveyor", "Road Surveyor"),
        ("asset_manager", "Asset Manager"),
        ("viewer", "Viewer"),
        ("super_admin", "Super Admin"),
    ])
    def test_to_display_role(self, canonical, display):
        from utils.roles import to_display_role
        assert to_display_role(canonical) == display


# ── utils.ids ──────────────────────────────────────────────────────────────

class TestIds:
    def test_get_now_iso_format(self):
        from utils.ids import get_now_iso
        s = get_now_iso()
        assert s.endswith("Z")
        # Parseable as ISO date (without Z)
        from datetime import datetime
        datetime.fromisoformat(s.rstrip("Z"))

    def test_next_sequence_increments(self, db):
        from utils.ids import next_sequence
        a = next_sequence("test_seq", db=db)
        b = next_sequence("test_seq", db=db)
        c = next_sequence("test_seq", db=db)
        assert (a, b, c) == (1, 2, 3)

    def test_next_sequence_independent_keys(self, db):
        from utils.ids import next_sequence
        assert next_sequence("alpha", db=db) == 1
        assert next_sequence("beta", db=db) == 1
        assert next_sequence("alpha", db=db) == 2

    def test_generate_defect_id_format(self, db):
        from utils.ids import generate_defect_id
        v = generate_defect_id(db=db)
        assert v.startswith("DEF-")
        assert len(v) == 10  # DEF- + 6 digits

    def test_generate_survey_id_format(self, db):
        from utils.ids import generate_survey_id
        v = generate_survey_id(db=db)
        assert v.startswith("SUR-")

    def test_generate_asset_display_id_format(self, db):
        from utils.ids import generate_asset_display_id
        v = generate_asset_display_id(db=db)
        assert v.startswith("AST-")


# ── utils.response ─────────────────────────────────────────────────────────

class TestResponse:
    def test_mongo_response_serializes_objectid(self, app):
        from bson import ObjectId
        from utils.response import mongo_response
        with app.app_context():
            resp = mongo_response({"id": ObjectId("507f1f77bcf86cd799439011")})
        assert resp.status_code == 200
        body = resp.get_data(as_text=True)
        assert "507f1f77bcf86cd799439011" in body

    def test_mongo_response_status_override(self, app):
        from utils.response import mongo_response
        with app.app_context():
            resp = mongo_response({"error": "nope"}, 404)
        assert resp.status_code == 404
