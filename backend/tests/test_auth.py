"""Auth blueprint: signup, login, refresh, /me."""

from __future__ import annotations


# ── signup ────────────────────────────────────────────────────────────────

def test_signup_creates_user_unapproved(client, db):
    res = client.post(
        "/api/auth/signup",
        json={
            "email": "Alice@Example.COM",
            "password": "Password123!",
            "first_name": "Alice",
            "last_name": "Smith",
            "organisation": "ACME",
            "role": "Road Surveyor",
        },
    )
    assert res.status_code == 201
    body = res.get_json()
    assert body["pending_approval"] is True

    user = db.users.find_one({"email_lower": "alice@example.com"})
    assert user is not None
    assert user["is_approved"] is False
    assert user["email"] == "Alice@Example.COM"  # original casing preserved
    assert user["role"] == "road_surveyor"  # normalized to canonical
    assert "password_hash" in user
    assert user["password_hash"] != "Password123!"  # hashed, not plain


def test_signup_rejects_missing_password(client):
    res = client.post("/api/auth/signup", json={"email": "a@b.com"})
    assert res.status_code == 400


def test_signup_rejects_missing_email(client):
    res = client.post("/api/auth/signup", json={"password": "x"})
    assert res.status_code == 400


def test_signup_rejects_duplicate_email_case_insensitive(client, make_user):
    make_user(email="dup@test.local")
    res = client.post(
        "/api/auth/signup",
        json={"email": "DUP@test.local", "password": "Password123!"},
    )
    assert res.status_code == 409


# ── login ─────────────────────────────────────────────────────────────────

def test_login_returns_tokens(client, make_user):
    make_user(email="login@test.local", password="Password123!", approved=True)
    res = client.post(
        "/api/auth/login",
        json={"email": "login@test.local", "password": "Password123!"},
    )
    assert res.status_code == 200
    body = res.get_json()
    assert "access_token" in body
    assert "refresh_token" in body
    assert body["user"]["email"] == "login@test.local"


def test_login_is_case_insensitive(client, make_user):
    make_user(email="case@test.local", password="Password123!", approved=True)
    res = client.post(
        "/api/auth/login",
        json={"email": "CASE@test.local", "password": "Password123!"},
    )
    assert res.status_code == 200


def test_login_wrong_password_returns_401(client, make_user):
    make_user(email="wp@test.local", password="Password123!", approved=True)
    res = client.post(
        "/api/auth/login",
        json={"email": "wp@test.local", "password": "wrong"},
    )
    assert res.status_code == 401


def test_login_unknown_user_returns_401(client):
    res = client.post(
        "/api/auth/login",
        json={"email": "ghost@test.local", "password": "x"},
    )
    assert res.status_code == 401


def test_login_unapproved_user_returns_403(client, make_user):
    make_user(email="pending@test.local", password="Password123!", approved=False)
    res = client.post(
        "/api/auth/login",
        json={"email": "pending@test.local", "password": "Password123!"},
    )
    assert res.status_code == 403


def test_login_missing_credentials_returns_400(client):
    res = client.post("/api/auth/login", json={})
    assert res.status_code == 400


# ── /me ────────────────────────────────────────────────────────────────────

def test_me_returns_current_user(client, admin_headers):
    res = client.get("/api/auth/me", headers=admin_headers)
    assert res.status_code == 200
    body = res.get_json()
    assert "user" in body
    assert body["user"]["role"] == "Admin"  # display form


def test_me_requires_auth(client):
    res = client.get("/api/auth/me")
    assert res.status_code == 401


# ── refresh ───────────────────────────────────────────────────────────────

def test_refresh_with_refresh_token_returns_new_access(app, client, make_user):
    user_id = make_user(email="refresh@test.local", approved=True)
    from tests.conftest import _make_token
    refresh_tok = _make_token(app, user_id, "admin",
                              email="refresh@test.local", refresh=True)
    res = client.post(
        "/api/auth/refresh",
        headers={"Authorization": f"Bearer {refresh_tok}"},
    )
    assert res.status_code == 200
    assert "access_token" in res.get_json()


def test_refresh_rejects_access_token(client, admin_headers):
    # /refresh requires a refresh token; access token must be rejected.
    res = client.post("/api/auth/refresh", headers=admin_headers)
    assert res.status_code in (401, 422)
