from db import get_db
from flask import Blueprint, jsonify, request
from bson import ObjectId
from flask_jwt_extended import jwt_required, get_jwt_identity
from utils.security import hash_password, verify_password

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


