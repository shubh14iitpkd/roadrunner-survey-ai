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
	
	from pymongo import UpdateOne
	
	operations = []
	for a in assets:
		a.setdefault("detected_at", get_now_iso())
		# Use upsert to handle re-processing - update if exists, insert if not
		asset_id = a.pop("_id", None)
		if asset_id:
			operations.append(UpdateOne(
				{"_id": asset_id},
				{"$set": a},
				upsert=True
			))
		else:
			# No _id provided, generate one via insert
			operations.append(UpdateOne(
				{"_id": ObjectId()},
				{"$set": a},
				upsert=True
			))
	
	db = get_db()
	if operations:
		res = db.assets.bulk_write(operations)
		return jsonify({
			"inserted": res.upserted_count,
			"modified": res.modified_count,
			"total": len(operations)
		})
	return jsonify({"inserted": 0, "modified": 0, "total": 0})


@assets_bp.put("/<asset_id>")
@role_required(["admin", "surveyor"])
def update_asset(asset_id: str):
	body = request.get_json(silent=True) or {}
	db = get_db()
	res = db.assets.find_one_and_update({"_id": ObjectId(asset_id)}, {"$set": body})
	if not res:
		return jsonify({"error": "not found"}), 404
	return jsonify({"ok": True})

@assets_bp.get("/<user_id>/resolved-map")
def get_resolved_map(user_id: str):
	db = get_db()
	system_cats = list(db.system_asset_categories.find())
	system_labels = list(db.system_asset_labels.find())

	try:
		prefs = db.user_preferences.find_one({"user_id": ObjectId(user_id)}) or {}
	except:
		prefs = {}
	
	labels_override = prefs.get("label_overrides", {})
	cat_override = prefs.get("category_overrides", {})

	resolved_cats = {}
	for cat in system_cats:
		cid = cat["category_id"]
		resolved_cats[cid] = {
			"category_id": cid,
			"original_display_name": cat["display_name"],
			"display_name": cat_override.get(cid, {}).get("display_name") or cat["display_name"]
		}
		
	resolved_labels = {}
	for l in system_labels:
		aid = l["asset_id"]
		resolved_labels[aid] = {
			"asset_id": aid,
			"original_display_name": l["display_name"],
			"display_name": labels_override.get(aid, {}).get("display_name") or l["display_name"]
		}

	return {
		"categories": resolved_cats,
		"labels": resolved_labels
	}