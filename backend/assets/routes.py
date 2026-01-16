from flask import Blueprint, jsonify, request
from bson import ObjectId
from pymongo import ASCENDING, DESCENDING

from db import get_db
from utils.ids import get_now_iso
from utils.rbac import role_required
from utils.response import mongo_response

assets_bp = Blueprint("assets", __name__)


@assets_bp.get("/")
@role_required(["admin", "surveyor", "viewer"])
def list_assets():
	query = {}
	survey_id = request.args.get("survey_id")
	route_id = request.args.get("route_id", type=int)
	category = request.args.get("category")
	condition = request.args.get("condition")
	if survey_id:
		query["survey_id"] = ObjectId(survey_id)
	if route_id is not None:
		query["route_id"] = route_id
	if category:
		query["category"] = category
	if condition:
		query["condition"] = condition
	db = get_db()
	items = list(db.assets.find(query).sort("detected_at", DESCENDING).limit(1000))
	return mongo_response({"items": items, "count": len(items)})


@assets_bp.get("/<asset_id>")
@role_required(["admin", "surveyor", "viewer"])
def get_asset(asset_id: str):
	db = get_db()
	it = db.assets.find_one({"_id": ObjectId(asset_id)})
	if not it:
		return mongo_response({"error": "not found"}, 404)
	return mongo_response({"item": it})


@assets_bp.post("/bulk")
@role_required(["admin", "surveyor"])
def bulk_insert():
	body = request.get_json(silent=True) or {}
	assets = body.get("assets", [])
	if not isinstance(assets, list) or not assets:
		return jsonify({"error": "assets array required"}), 400
	for a in assets:
		a.setdefault("detected_at", get_now_iso())
	db = get_db()
	res = db.assets.insert_many(assets)
	return jsonify({"inserted": len(res.inserted_ids)})


@assets_bp.put("/<asset_id>")
@role_required(["admin", "surveyor"])
def update_asset(asset_id: str):
	body = request.get_json(silent=True) or {}
	db = get_db()
	res = db.assets.find_one_and_update({"_id": ObjectId(asset_id)}, {"$set": body})
	if not res:
		return jsonify({"error": "not found"}), 404
	return jsonify({"ok": True})

