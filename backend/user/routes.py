from db import get_db
from flask import Blueprint, jsonify, request
from bson import ObjectId
from flask_jwt_extended import jwt_required, get_jwt_identity
from utils.security import hash_password, verify_password
from utils.rbac import role_required
from utils.roles import normalize_to_canonical, to_display_role
from services.email_templates import (
    get_mailer,
    account_approved_email,
    account_revoked_email,
    role_changed_email,
)

user_bp = Blueprint("user", __name__)

@user_bp.put("/<user_id>/preferences/category")
def update_category_preferences(user_id: str):
    """
    Update user category preferences
    ---
    tags:
      - User
    security:
      - Bearer: []
    parameters:
      - name: user_id
        in: path
        type: string
        required: true
        description: The ID of the user
      - name: body
        in: body
        required: true
        schema:
          type: object
          properties:
            category_id:
              type: string
              description: The ID of the category to update
            display_name:
              type: string
              description: The new display name for the category
    responses:
      200:
        description: Preferences updated successfully
        schema:
          type: object
          properties:
            ok:
              type: boolean
      500:
        description: Internal server error
    """
    data = request.get_json(silent=True) or {}
    category_id = data.get("category_id")
    display_name = data.get("display_name")
    
    try:
        db = get_db()
        db.user_preferences.update_one(
            {"user_id": ObjectId(user_id)},
            {"$set": {f"category_overrides.{category_id}.display_name": display_name}},
            upsert=True
        )
        return jsonify({"ok": True})
    except Exception as e:
        print(f"[PREFS] {e}")
        return jsonify({"error": str(e)}), 500

@user_bp.put("/<user_id>/preferences/label")
def update_label_preferences(user_id: str):
    """
    Update user label preferences
    ---
    tags:
      - User
    security:
      - Bearer: []
    parameters:
      - name: user_id
        in: path
        type: string
        required: true
        description: The ID of the user
      - name: body
        in: body
        required: true
        schema:
          type: object
          properties:
            asset_id:
              type: string
              description: The ID of the asset label to update
            display_name:
              type: string
              description: The new display name for the asset label
    responses:
      200:
        description: Preferences updated successfully
        schema:
          type: object
          properties:
            ok:
              type: boolean
      500:
        description: Internal server error
    """
    data = request.get_json(silent=True) or {}
    asset_ids = data.get("asset_ids") or []
    asset_id = data.get("asset_id")
    if asset_id and not asset_ids:
        asset_ids = [asset_id]
    display_name = data.get("display_name")
    
    try:
        db = get_db()
        update_fields = {f"label_overrides.{aid}.display_name": display_name for aid in asset_ids}
        db.user_preferences.update_one(
            {"user_id": ObjectId(user_id)},
            {"$set": update_fields},
            upsert=True
        )
        return jsonify({"ok": True})
    except Exception as e:
        print(f"[PREFS] {e}")
        return jsonify({"error": str(e)}), 500


@user_bp.put("/<user_id>/password")
@jwt_required()
def update_password(user_id: str):
    """
    Update user password
    ---
    tags:
      - User
    security:
      - Bearer: []
    parameters:
      - name: user_id
        in: path
        type: string
        required: true
        description: The ID of the user
      - name: body
        in: body
        required: true
        schema:
          type: object
          required:
            - current_password
            - new_password
          properties:
            current_password:
              type: string
            new_password:
              type: string
    responses:
      200:
        description: Password updated successfully
      400:
        description: Invalid request or incorrect current password
      401:
        description: Unauthorized
      404:
        description: User not found
      500:
        description: Internal server error
    """
    identity = get_jwt_identity()
    if identity != user_id:
        return jsonify({"error": "unauthorized"}), 401

    data = request.get_json(silent=True) or {}
    current_password = data.get("current_password")
    new_password = data.get("new_password")

    if not current_password or not new_password:
        return jsonify({"error": "current_password and new_password are required"}), 400

    try:
        db = get_db()
        user = db.users.find_one({"_id": ObjectId(user_id)})
        if not user:
            return jsonify({"error": "user not found"}), 404

        if not verify_password(current_password, user.get("password_hash", "")):
            return jsonify({"error": "incorrect current password"}), 400

        new_password_hash = hash_password(new_password)
        db.users.update_one(
            {"_id": ObjectId(user_id)},
            {"$set": {"password_hash": new_password_hash}}
        )
        return jsonify({"ok": True, "message": "password updated successfully"})
    except Exception as e:
        print(f"[USER] {e}")
        return jsonify({"error": str(e)}), 500


@user_bp.get("/")
@jwt_required()
@role_required(["super_admin", "admin"])
def list_users():
    """
    List all users (admin only)
    ---
    tags:
      - User
    security:
      - Bearer: []
    responses:
      200:
        description: List of all users
    """
    print("Listing 211")
    db = get_db()
    users = list(db.users.find({"role": {"$ne": "super_admin"}}, {
        "password_hash": 0,
    }))
    result = []
    for u in users:
        result.append({
            "_id": str(u["_id"]),
            "name": u.get("name", ""),
            "first_name": u.get("first_name", ""),
            "last_name": u.get("last_name", ""),
            "email": u.get("email", ""),
            "organisation": u.get("organisation", ""),
            "role": to_display_role(normalize_to_canonical(u.get("role"))),
            "is_approved": u.get("is_approved", False),
        })
    return jsonify({"users": result})


@user_bp.put("/<user_id>/approve")
@jwt_required()
@role_required(["super_admin","admin"])
def approve_user(user_id: str):
    """
    Approve a user account (admin only)
    ---
    tags:
      - User
    security:
      - Bearer: []
    parameters:
      - name: user_id
        in: path
        type: string
        required: true
    responses:
      200:
        description: User approved
      404:
        description: User not found
    """
    db = get_db()
    user = db.users.find_one({"_id": ObjectId(user_id)})
    if not user:
        return jsonify({"error": "user not found"}), 404

    db.users.update_one({"_id": ObjectId(user_id)}, {"$set": {"is_approved": True}})

    try:
        role = to_display_role(normalize_to_canonical(user.get("role")))
        subject, plain, html = account_approved_email(
            user.get("first_name") or user.get("name", ""),
            user.get("email", ""),
            role,
        )
        get_mailer().send_email(user["email"], subject, plain, html)
    except Exception as mail_err:
        print(f"[MAIL] account_approved failed: {mail_err}")

    return jsonify({"ok": True, "message": "user approved"})


@user_bp.put("/<user_id>/role")
@jwt_required()
@role_required(["super_admin","admin"])
def update_role(user_id: str):
    """
    Update a user's role (admin only)
    ---
    tags:
      - User
    security:
      - Bearer: []
    parameters:
      - name: user_id
        in: path
        type: string
        required: true
      - name: body
        in: body
        required: true
        schema:
          type: object
          properties:
            role:
              type: string
    responses:
      200:
        description: Role updated
      400:
        description: Missing role
      404:
        description: User not found
    """
    data = request.get_json(silent=True) or {}
    role_input = data.get("role")
    if not role_input:
        return jsonify({"error": "role is required"}), 400

    canonical = normalize_to_canonical(role_input)
    db = get_db()
    user = db.users.find_one({"_id": ObjectId(user_id)})
    if not user:
        return jsonify({"error": "user not found"}), 404

    old_canonical = normalize_to_canonical(user.get("role"))
    db.users.update_one({"_id": ObjectId(user_id)}, {"$set": {"role": canonical}})

    try:
        subject, plain, html = role_changed_email(
            user.get("first_name") or user.get("name", ""),
            user.get("email", ""),
            to_display_role(old_canonical),
            to_display_role(canonical),
        )
        get_mailer().send_email(user["email"], subject, plain, html)
    except Exception as mail_err:
        print(f"[MAIL] role_changed failed: {mail_err}")

    return jsonify({"ok": True, "message": "role updated", "role": to_display_role(canonical)})


@user_bp.delete("/<user_id>")
@jwt_required()
@role_required(["super_admin","admin"])
def revoke_user(user_id: str):
    """
    Revoke (delete) a user account (admin only)
    ---
    tags:
      - User
    security:
      - Bearer: []
    parameters:
      - name: user_id
        in: path
        type: string
        required: true
    responses:
      200:
        description: User revoked
      404:
        description: User not found
    """
    db = get_db()
    user = db.users.find_one({"_id": ObjectId(user_id), "role": {"$ne": "super_admin"}})
    if not user:
        return jsonify({"error": "user not found"}), 404

    db.users.delete_one({"_id": ObjectId(user_id)})

    try:
        subject, plain, html = account_revoked_email(
            user.get("first_name") or user.get("name", ""),
            user.get("email", ""),
        )
        get_mailer().send_email(user["email"], subject, plain, html)
    except Exception as mail_err:
        print(f"[MAIL] account_revoked failed: {mail_err}")

    return jsonify({"ok": True, "message": "user revoked"})


