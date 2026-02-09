from db import get_db
from flask import Blueprint, jsonify, request
from bson import ObjectId
from ai.lang_chatbot.tools import clear_resolved_map_cache

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
        # Invalidate cache for this user so chatbot uses updated preferences
        clear_resolved_map_cache(user_id)
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
    asset_id = data.get("asset_id")
    display_name = data.get("display_name")
    
    try:
        db = get_db()
        db.user_preferences.update_one(
            {"user_id": ObjectId(user_id)},
            {"$set": {f"label_overrides.{asset_id}.display_name": display_name}},
            upsert=True
        )
        # Invalidate cache for this user so chatbot uses updated preferences
        clear_resolved_map_cache(user_id)
        return jsonify({"ok": True})
    except Exception as e:
        print(f"[PREFS] {e}")
        return jsonify({"error": str(e)}), 500