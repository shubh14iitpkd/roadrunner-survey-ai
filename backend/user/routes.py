from db import get_db
from flask import Blueprint, jsonify, request
from bson import ObjectId

user_bp = Blueprint("user", __name__)

@user_bp.put("/<user_id>/preferences/category")
def update_category_preferences(user_id: str):
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
        return jsonify({"ok": True})
    except Exception as e:
        print(f"[PREFS] {e}")
        return jsonify({"error": str(e)}), 500