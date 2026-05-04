"""Shared pytest fixtures for backend API tests.

Strategy:
- Replace pymongo.MongoClient with mongomock.MongoClient before app import.
- Stub the job queue's init_app so background threads don't start during tests.
- Stub the SMTP mailer so signup/approval flows don't try to send mail.
- Each test function gets a freshly seeded in-memory database (function scope).
"""

from __future__ import annotations

import os
import sys
from datetime import timedelta
from pathlib import Path
from unittest.mock import MagicMock, patch

import mongomock
import pytest

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


# ---------------------------------------------------------------------------
# Environment — set BEFORE app/config imports
# ---------------------------------------------------------------------------

os.environ.setdefault("ENV", "test")
os.environ.setdefault("MONGO_URI", "mongodb://localhost:27017")
os.environ.setdefault("MONGO_DB_NAME", "roadrunner_test")
os.environ.setdefault("JWT_SECRET_KEY", "test-jwt-secret")
os.environ.setdefault("SECRET_KEY", "test-secret")
os.environ.setdefault("CORS_ORIGINS", "*")
os.environ.setdefault("GPX_SNAP_ENABLED", "false")
os.environ.setdefault("ENABLE_SWAGGER", "false")
os.environ.pop("REDIS_URL", None)


# ---------------------------------------------------------------------------
# Patches that must be active before `from app import create_app`
# ---------------------------------------------------------------------------

@pytest.fixture(scope="session", autouse=True)
def _patch_mongo_and_externals():
    """Patch MongoClient -> mongomock and stub external services."""
    # Patch the MongoClient symbol used inside db.py before it's imported.
    mongo_patch = patch("pymongo.MongoClient", mongomock.MongoClient)
    mongo_patch.start()

    # Stub the job queue so init_app() does not spawn worker threads.
    job_queue_stub = MagicMock()
    job_queue_stub.register_handler = MagicMock()
    job_queue_stub.init_app = MagicMock()
    job_queue_stub.enqueue = MagicMock(return_value="test-job-id")
    jq_patch = patch("services.job_queue.job_queue", job_queue_stub)
    jq_patch.start()

    # Stub SMTP mailer so signup_request_email() etc. do not connect.
    mailer = MagicMock()
    mailer.send_email = MagicMock(return_value=True)
    mailer_patch = patch(
        "services.email_templates.get_mailer", return_value=mailer
    )
    mailer_patch.start()

    yield

    mongo_patch.stop()
    jq_patch.stop()
    mailer_patch.stop()


# ---------------------------------------------------------------------------
# App + DB fixtures
# ---------------------------------------------------------------------------

@pytest.fixture()
def app(_patch_mongo_and_externals):
    """Create a fresh Flask app with an empty in-memory MongoDB per test."""
    # Reset cached singleton client in db.py so each test gets its own.
    import db as db_module
    db_module.client = None

    from app import create_app

    flask_app = create_app()
    flask_app.config.update(
        TESTING=True,
        JWT_SECRET_KEY="test-jwt-secret",
        PROPAGATE_EXCEPTIONS=True,
    )

    yield flask_app

    # Drop the test database so the next test starts clean.
    try:
        client = db_module.get_client(flask_app)
        client.drop_database(flask_app.config["MONGO_DB_NAME"])
    except Exception:
        pass
    db_module.client = None


@pytest.fixture()
def client(app):
    """Flask test client."""
    return app.test_client()


@pytest.fixture()
def db(app):
    """Direct handle to the mongomock database."""
    with app.app_context():
        from flask import g
        g._app = app
        from db import get_db
        yield get_db()


# ---------------------------------------------------------------------------
# Auth helpers
# ---------------------------------------------------------------------------

ROLE_ADMIN = "admin"
ROLE_SURVEYOR = "road_surveyor"
ROLE_VIEWER = "viewer"
ROLE_SUPER_ADMIN = "super_admin"


def _create_user(db_handle, email: str, role: str, approved: bool = True,
                 password: str = "Password123!") -> str:
    from utils.security import hash_password
    doc = {
        "email": email,
        "email_lower": email.lower(),
        "name": email.split("@")[0],
        "first_name": "Test",
        "last_name": "User",
        "organisation": "TestOrg",
        "password_hash": hash_password(password),
        "role": role,
        "is_verified": True,
        "is_approved": approved,
    }
    result = db_handle.users.insert_one(doc)
    return str(result.inserted_id)


def _make_token(app, user_id: str, role: str, email: str = "test@example.com",
                refresh: bool = False) -> str:
    """Mint a JWT directly so tests don't need a /login round-trip."""
    from flask_jwt_extended import create_access_token, create_refresh_token
    with app.app_context():
        claims = {"email": email, "role": role}
        if refresh:
            return create_refresh_token(identity=user_id, additional_claims=claims)
        return create_access_token(
            identity=user_id,
            expires_delta=timedelta(hours=12),
            additional_claims=claims,
        )


@pytest.fixture()
def make_user(db):
    """Factory: create_user(role=..., email=..., approved=...) -> user_id."""
    counter = {"n": 0}

    def _make(role: str = ROLE_SURVEYOR, email: str | None = None,
              approved: bool = True, password: str = "Password123!") -> str:
        counter["n"] += 1
        if email is None:
            email = f"user{counter['n']}@test.local"
        return _create_user(db, email, role, approved=approved, password=password)

    return _make


@pytest.fixture()
def auth_headers(app, db):
    """Factory: auth_headers(role) -> {Authorization: Bearer ...}."""
    counter = {"n": 0}

    def _build(role: str = ROLE_ADMIN, email: str | None = None) -> dict:
        counter["n"] += 1
        if email is None:
            email = f"{role}{counter['n']}@test.local"
        user_id = _create_user(db, email, role, approved=True)
        token = _make_token(app, user_id, role, email=email)
        return {"Authorization": f"Bearer {token}"}

    return _build


@pytest.fixture()
def admin_headers(auth_headers):
    return auth_headers(ROLE_ADMIN)


@pytest.fixture()
def surveyor_headers(auth_headers):
    return auth_headers(ROLE_SURVEYOR)


@pytest.fixture()
def viewer_headers(auth_headers):
    return auth_headers(ROLE_VIEWER)
