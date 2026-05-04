"""User blueprint: list users (admin only), update password."""

from __future__ import annotations

from bson import ObjectId


def test_list_users_admin(client, admin_headers, make_user):
    make_user(role="road_surveyor", email="a@test.local")
    make_user(role="viewer", email="b@test.local")

    res = client.get("/api/users/", headers=admin_headers)
    assert res.status_code == 200


def test_list_users_surveyor_forbidden(client, surveyor_headers):
    res = client.get("/api/users/", headers=surveyor_headers)
    assert res.status_code == 403


def test_list_users_requires_auth(client):
    res = client.get("/api/users/")
    assert res.status_code == 401


def test_update_password_self(app, client, db, make_user):
    user_id = make_user(email="pw@test.local", password="OldPass123!")
    from tests.conftest import _make_token
    headers = {"Authorization": f"Bearer {_make_token(app, user_id, 'road_surveyor', email='pw@test.local')}"}

    res = client.put(
        f"/api/users/{user_id}/password",
        headers=headers,
        json={"current_password": "OldPass123!", "new_password": "NewPass456!"},
    )
    assert res.status_code == 200

    # verify new password works on login
    login = client.post("/api/auth/login",
                        json={"email": "pw@test.local", "password": "NewPass456!"})
    assert login.status_code == 200


def test_update_password_wrong_current(app, client, make_user):
    user_id = make_user(email="pw2@test.local", password="OldPass123!")
    from tests.conftest import _make_token
    headers = {"Authorization": f"Bearer {_make_token(app, user_id, 'road_surveyor', email='pw2@test.local')}"}

    res = client.put(
        f"/api/users/{user_id}/password",
        headers=headers,
        json={"current_password": "wrong", "new_password": "NewPass456!"},
    )
    assert res.status_code == 400


def test_update_password_other_user_forbidden(app, client, make_user):
    me = make_user(email="me@test.local", password="MyPass123!")
    other = make_user(email="other@test.local", password="OtherPass123!")
    from tests.conftest import _make_token
    headers = {"Authorization": f"Bearer {_make_token(app, me, 'road_surveyor', email='me@test.local')}"}

    res = client.put(
        f"/api/users/{other}/password",
        headers=headers,
        json={"current_password": "MyPass123!", "new_password": "x"},
    )
    assert res.status_code == 401
