from flask import Blueprint, jsonify, request

from db import get_db
from utils.rbac import role_required

categories_bp = Blueprint("categories", __name__)
master_bp = Blueprint("master", __name__)


@categories_bp.get("/")
@role_required(["admin", "surveyor", "viewer"])
def list_categories():
	db = get_db()
	items = list(db.asset_categories.find({}))
	for it in items:
		it["_id"] = str(it["_id"])  # to string
	return jsonify({"items": items})


@categories_bp.post("/")
@role_required(["admin"])
def create_category():
	body = request.get_json(silent=True) or {}
	required = ["key", "name"]
	missing = [k for k in required if body.get(k) in (None, "")]
	if missing:
		return jsonify({"error": f"missing: {', '.join(missing)}"}), 400
	db = get_db()
	db.asset_categories.insert_one(body)
	return jsonify({"item": body}), 201


@categories_bp.put("/<key>")
@role_required(["admin"])
def update_category(key: str):
	body = request.get_json(silent=True) or {}
	db = get_db()
	res = db.asset_categories.find_one_and_update({"key": key}, {"$set": body})
	if not res:
		return jsonify({"error": "not found"}), 404
	return jsonify({"ok": True})


@categories_bp.delete("/<key>")
@role_required(["admin"])
def delete_category(key: str):
	db = get_db()
	res = db.asset_categories.delete_one({"key": key})
	if not res.deleted_count:
		return jsonify({"error": "not found"}), 404
	return jsonify({"ok": True})


@master_bp.get("/assets")
@role_required(["admin", "surveyor", "viewer"])
def list_master_assets():
	db = get_db()
	items = list(db.asset_master.find({}))
	for it in items:
		it["_id"] = str(it["_id"])  # to string
	return jsonify({"items": items})


@master_bp.post("/assets")
@role_required(["admin"])
def create_master_asset():
	body = request.get_json(silent=True) or {}
	required = ["code", "name", "category_key"]
	missing = [k for k in required if body.get(k) in (None, "")]
	if missing:
		return jsonify({"error": f"missing: {', '.join(missing)}"}), 400
	db = get_db()
	db.asset_master.insert_one(body)
	return jsonify({"item": body}), 201


@master_bp.put("/assets/<code>")
@role_required(["admin"])
def update_master_asset(code: str):
	body = request.get_json(silent=True) or {}
	db = get_db()
	res = db.asset_master.find_one_and_update({"code": code}, {"$set": body})
	if not res:
		return jsonify({"error": "not found"}), 404
	return jsonify({"ok": True})


@master_bp.delete("/assets/<code>")
@role_required(["admin"])
def delete_master_asset(code: str):
	db = get_db()
	res = db.asset_master.delete_one({"code": code})
	if not res.deleted_count:
		return jsonify({"error": "not found"}), 404
	return jsonify({"ok": True})

