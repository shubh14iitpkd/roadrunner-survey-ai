import os
import re
import math

from flask import Blueprint, jsonify, request
from bson import ObjectId
from pymongo import ASCENDING, DESCENDING

from db import get_db
from utils.ids import get_now_iso
from utils.is_demo_video import is_demo
from utils.rbac import role_required
from utils.response import mongo_response

assets_bp = Blueprint("assets", __name__)

@assets_bp.get("/", endpoint="assets_list_paginated")
@role_required(["super_admin","admin", "surveyor", "viewer"])
def list_assets_paginated():
	"""
	List assets with filters and pagination
	---
	tags:
	  - Assets
	security:
	  - Bearer: []
	parameters:
	  - name: survey_id
	    in: query
	    type: string
	    description: Filter by survey ID
	  - name: route_id
	    in: query
	    type: integer
	    description: Filter by route ID
	  - name: category
	    in: query
	    type: string
	    description: Filter by category
	  - name: condition
	    in: query
	    type: string
	    description: Filter by condition
	  - name: side
	    in: query
	    type: string
	    description: Filter by road side
	  - name: zone
	    in: query
	    type: string
	    description: Filter by zone
	responses:
	  200:
	    description: Assets retrieved successfully
	    schema:
	      type: object
	      properties:
	        items:
	          type: array
	          items:
	            type: object
	        count:
	          type: integer
	"""
	query = {}
	survey_id = request.args.get("survey_id")
	route_id = request.args.get("route_id", type=int)
	category = request.args.get("category")
	condition = request.args.get("condition")
	zone = request.args.get("zone")
	road_side = request.args.get("side")
	page =  int(request.args.get("page", "1"))
	limit = int(request.args.get("limit", "10"))
	skip = limit*(page-1)
	
	db = get_db()

	if survey_id:
		# Find all videos belonging to this survey
		survey_videos = list(db.videos.find(
			{"survey_id": ObjectId(survey_id)},
			{"storage_url": 1}
		))

		# Collect video_keys (basenames) for any demo videos
		demo_video_keys = []
		has_real_videos = False
		for v in survey_videos:
			if is_demo(video_file=v):
				url = v.get("storage_url", "")
				basename = os.path.splitext(os.path.basename(url))[0]
				if basename:
					demo_video_keys.append(basename)
			else:
				has_real_videos = True

		# Build the survey/video_key filter using $or
		or_conditions = []
		if has_real_videos:
			or_conditions.append({"survey_id": ObjectId(survey_id)})
		if demo_video_keys:
			or_conditions.append({"video_key": {"$in": demo_video_keys}})

		if or_conditions:
			query["$or"] = or_conditions
		else:
			query["survey_id"] = ObjectId(survey_id)

	if route_id is not None:
		query["route_id"] = route_id
	if category:
		query["category"] = category
	if condition:
		query["condition"] = condition
	if zone:
		query["zone"] = zone
	if road_side:
		query["side"] = road_side

	items = list(db.assets.find(query).skip(skip).limit(limit).sort("created_at", DESCENDING))
	total_asstes = db.assets.count_documents(query)
	total_pages = math.ceil(total_asstes/limit)
	return mongo_response({"items": items, "total_count": total_asstes, "total_pages": total_pages, "page": page, "limit": limit})

@assets_bp.get("/all", endpoint="assets_list")
@role_required(["super_admin","admin", "surveyor", "viewer"])
def list_assets():
	"""
	List all assets with filters
	---
	tags:
	  - Assets
	security:
	  - Bearer: []
	parameters:
	  - name: survey_id
	    in: query
	    type: string
	    description: Filter by survey ID
	  - name: route_id
	    in: query
	    type: integer
	    description: Filter by route ID
	  - name: category
	    in: query
	    type: string
	    description: Filter by category
	  - name: condition
	    in: query
	    type: string
	    description: Filter by condition
	responses:
	  200:
	    description: Assets retrieved successfully
	    schema:
	      type: object
	      properties:
	        items:
	          type: array
	          items:
	            type: object
	        count:
	          type: integer
	"""
	query = {}
	survey_id = request.args.get("survey_id")
	route_id = request.args.get("route_id", type=int)
	category = request.args.get("category")
	condition = request.args.get("condition")
	zone = request.args.get("zone")
	road_side = request.args.get("side")

	db = get_db()

	if survey_id:
		# Find all videos belonging to this survey
		survey_videos = list(db.videos.find(
			{"survey_id": ObjectId(survey_id)},
			{"storage_url": 1}
		))

		# Collect video_keys (basenames) for any demo videos
		demo_video_keys = []
		has_real_videos = False
		for v in survey_videos:
			if is_demo(video_file=v):
				url = v.get("storage_url", "")
				basename = os.path.splitext(os.path.basename(url))[0]
				if basename:
					demo_video_keys.append(basename)
			else:
				has_real_videos = True

		# Build the survey/video_key filter using $or
		or_conditions = []
		if has_real_videos:
			or_conditions.append({"survey_id": ObjectId(survey_id)})
		if demo_video_keys:
			or_conditions.append({"video_key": {"$in": demo_video_keys}})

		if or_conditions:
			query["$or"] = or_conditions
		else:
			query["survey_id"] = ObjectId(survey_id)

	if route_id is not None:
		query["route_id"] = route_id
	if category:
		query["category"] = category
	if condition:
		query["condition"] = condition
	if zone:
		query["zone"] = zone
	if road_side:
		query["side"] = road_side

	items = list(db.assets.find(query).sort("detected_at", DESCENDING))
	return mongo_response({"items": items, "count": len(items)})


@assets_bp.get("/<asset_id>", endpoint="assets_get_id")
@role_required(["super_admin", "admin", "surveyor", "viewer"])
def get_asset(asset_id: str):
	"""
	Get asset details
	---
	tags:
	  - Assets
	security:
	  - Bearer: []
	parameters:
	  - name: asset_id
	    in: path
	    type: string
	    required: true
	    description: The ID of the asset
	responses:
	  200:
	    description: Asset details retrieved successfully
	  404:
	    description: Asset not found
	"""
	db = get_db()
	it = db.assets.find_one({"_id": ObjectId(asset_id)})
	if not it:
		return mongo_response({"error": "not found"}, 404)
	return mongo_response({"item": it})

@assets_bp.post("/master", endpoint="assets_master_lib")
@role_required(["super_admin","admin", "surveyor"])
def get_master_assets():
	"""
	List master assets with filters for master library.
	Reads from the master_assets collection which stores cross-survey
	asset identities linked via embeddings.
	---
	tags:
	  - Assets
	security:
	  - Bearer: []
	parameters:
	  - name: route_id
	    in: query
	    type: integer
	    description: Filter by route ID
	  - name: category
	    in: query
	    type: string
	    description: Filter by category
	  - name: condition
	    in: query
	    type: string
	    description: Filter by condition (latest)
	  - name: side
	    in: query
	    type: string
	    description: Filter by road side
	  - name: zone
	    in: query
	    type: string
	    description: Filter by zone
	responses:
	  200:
	    description: Master assets retrieved successfully
	    schema:
	      type: object
	      properties:
	        items:
	          type: array
	          items:
	            type: object
	        asset_count:
	          type: integer
	"""
	db = get_db()
	route_id = request.args.get("route_id", type=int)
	category = request.args.get("category")
	condition = request.args.get("condition")
	zone = request.args.get("zone")
	road_side = request.args.get("side")

	# Build query on master_assets
	query = {}
	if route_id is not None:
		query["route_id"] = route_id
	if category:
		query["category_id"] = category
	if condition:
		query["latest_condition"] = condition
	if zone:
		query["zone"] = zone
	if road_side:
		query["side"] = road_side

	# Lookup route names, exclude heavy fields (embedding, full survey_history)
	pipeline = [
		{"$match": query},
		{
			"$lookup": {
				"from": "roads",
				"localField": "route_id",
				"foreignField": "route_id",
				"as": "road_info"
			}
		},
		{
			"$addFields": {
				"route_name": {"$arrayElemAt": ["$road_info.road_name", 0]},
				# Expose denormalised fields under names the frontend expects
				"condition": "$latest_condition",
				"confidence": "$latest_confidence",
				"location": "$canonical_location",
			}
		},
		{
			"$project": {
				"road_info": 0,
				"embedding": 0,   # no need to send 512-d vector to the browser
			}
		},
	]
	all_assets = list(db.master_assets.aggregate(pipeline))

	# Also return routes + surveys metadata (as before)
	all_roads = list(db.roads.find({}))
	all_surveys = list(db.surveys.find({"is_latest": True}))

	return mongo_response({
		"items": all_assets,
		"asset_count": len(all_assets),
		"routes": all_roads,
		"route_count": len(all_roads),
		"surveys": all_surveys,
		"survey_count": len(all_surveys),
	})


@assets_bp.post("/bulk", endpoint="assets_bulk")
@role_required(["super_admin","admin", "surveyor"])
def bulk_insert():
	"""
	Bulk insert or update assets
	---
	tags:
	  - Assets
	security:
	  - Bearer: []
	parameters:
	  - name: body
	    in: body
	    required: true
	    schema:
	      type: object
	      required:
	        - assets
	      properties:
	        assets:
	          type: array
	          items:
	            type: object
	responses:
	  200:
	    description: Bulk operation successful
	  400:
	    description: Missing assets array
	"""
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


@assets_bp.put("/<asset_id>", endpoint="assets_update_id")
@role_required(["super_admin","admin", "surveyor"])
def update_asset(asset_id: str):
	"""
	Update an asset
	---
	tags:
	  - Assets
	security:
	  - Bearer: []
	parameters:
	  - name: asset_id
	    in: path
	    type: string
	    required: true
	    description: The ID of the asset
	  - name: body
	    in: body
	    required: true
	    schema:
	      type: object
	responses:
	  200:
	    description: Asset updated successfully
	  404:
	    description: Asset not found
	"""
	body = request.get_json(silent=True) or {}
	db = get_db()
	res = db.assets.find_one_and_update({"_id": ObjectId(asset_id)}, {"$set": body})
	if not res:
		return jsonify({"error": "not found"}), 404
	return jsonify({"ok": True})


@assets_bp.patch("/<asset_id>/mark-good", endpoint="assets_mark_good")
@role_required(["super_admin","admin", "surveyor"])
def mark_asset_good(asset_id: str):
	"""
	Mark a master asset's condition as good.
	Updates both the master_assets record and the underlying
	asset observation in db.assets.
	---
	tags:
	  - Assets
	security:
	  - Bearer: []
	parameters:
	  - name: asset_id
	    in: path
	    type: string
	    required: true
	    description: The MongoDB _id of the master asset
	  - name: body
	    in: body
	    required: true
	    schema:
	      type: object
	      required:
	        - name
	        - user_id
	      properties:
	        name:
	          type: string
	          description: Full name of the surveyor marking the asset
	        user_id:
	          type: string
	          description: ID of the surveyor
	responses:
	  200:
	    description: Asset marked as good
	  400:
	    description: Missing required fields
	  404:
	    description: Asset not found
	"""
	body = request.get_json(silent=True) or {}
	surveyor_name = (body.get("name") or "").strip()
	surveyor_user_id = (body.get("user_id") or "").strip()
	if not surveyor_name:
		return jsonify({"error": "name is required"}), 400

	db = get_db()
	now = get_now_iso()
	modifier_info = {
		"user_id": surveyor_user_id,
		"name": surveyor_name,
		"changed_at": now,
	}

	# 1. Update the master_assets record
	res = db.master_assets.find_one_and_update(
		{"_id": ObjectId(asset_id)},
		{
			"$set": {
				"latest_condition": "good",
				"issue": None,
				"modified_by": modifier_info,
				"updated_at": now,
			}
		},
	)
	if not res:
		# Fallback: try as a raw asset _id (backward compat)
		res = db.assets.find_one_and_update(
			{"_id": ObjectId(asset_id)},
			{"$set": {"condition": "good", "modified_by": modifier_info}},
		)
		if not res:
			return jsonify({"error": "not found"}), 404
		return jsonify({"ok": True})

	# 2. Also update the latest asset observation linked to this master
	survey_history = res.get("survey_history", [])
	if survey_history:
		latest_obs_id = survey_history[-1].get("asset_observation_id")
		if latest_obs_id:
			db.assets.update_one(
				{"_id": latest_obs_id},
				{"$set": {"condition": "good", "modified_by": modifier_info}},
			)

	return jsonify({"ok": True})


@assets_bp.patch("/<asset_id>/unmark-good", endpoint="assets_unmark_good")
@role_required(["super_admin","admin", "surveyor"])
def unmark_asset_good(asset_id: str):
	"""
	Revert a master asset's condition from good back to damaged.
	Updates both the master_assets record and the underlying asset observation.
	---
	tags:
	  - Assets
	security:
	  - Bearer: []
	parameters:
	  - name: asset_id
	    in: path
	    type: string
	    required: true
	    description: The MongoDB _id of the master asset
	responses:
	  200:
	    description: Asset unmarked (reverted to damaged)
	  404:
	    description: Asset not found
	"""
	db = get_db()
	now = get_now_iso()

	res = db.master_assets.find_one_and_update(
		{"_id": ObjectId(asset_id)},
		{
			"$set": {
				"latest_condition": "damaged",
				"updated_at": now,
			},
			"$unset": {"modified_by": ""},
		},
	)
	if not res:
		return jsonify({"error": "not found"}), 404

	# Also revert the latest asset observation
	survey_history = res.get("survey_history", [])
	if survey_history:
		latest_obs_id = survey_history[-1].get("asset_observation_id")
		if latest_obs_id:
			db.assets.update_one(
				{"_id": latest_obs_id},
				{"$set": {"condition": "damaged"}, "$unset": {"modified_by": ""}},
			)

	return jsonify({"ok": True})


@assets_bp.put("/icon-config", endpoint="update_icon_config")
@role_required(["admin"])
def update_icon_config():
	"""
	Update icon configuration for asset types (admin only).
	Updates icon_url, icon_size, icon_anchor on system_asset_labels.
	---
	tags:
	  - Assets
	security:
	  - Bearer: []
	parameters:
	  - name: body
	    in: body
	    required: true
	    schema:
	      type: object
	      required:
	        - asset_ids
	      properties:
	        asset_ids:
	          type: array
	          items:
	            type: string
	        icon_url:
	          type: string
	        icon_size:
	          type: array
	          items:
	            type: integer
	        icon_anchor:
	          type: array
	          items:
	            type: integer
	        display_name:
	          type: string
	        reset:
	          type: boolean
	          description: If true, removes icon overrides and resets display_name to default
	responses:
	  200:
	    description: Icon config updated
	  400:
	    description: Missing asset_ids
	"""
	data = request.get_json(silent=True) or {}
	asset_ids = data.get("asset_ids") or []
	if not asset_ids:
		return jsonify({"error": "asset_ids required"}), 400

	db = get_db()
	reset = data.get("reset", False)

	if reset:
		# Remove icon fields and reset display_name to default_name
		for aid in asset_ids:
			doc = db.system_asset_labels.find_one({"asset_id": aid})
			
			gid = doc.get("default_group_id", "")
			if doc:
				db.system_asset_labels.update_one(
					{"asset_id": aid},
					{
						"$unset": {"icon_url": "", "icon_size": "", "icon_anchor": ""},
						"$set": {"display_name": gid, "group_id": gid }
					}
				)
		return jsonify({"ok": True, "message": "icon config reset"})

	update_fields = {}
	if "icon_url" in data:
		update_fields["icon_url"] = data["icon_url"]
	if "icon_size" in data:
		update_fields["icon_size"] = data["icon_size"]
	if "icon_anchor" in data:
		update_fields["icon_anchor"] = data["icon_anchor"]
	if "display_name" in data:
		update_fields["display_name"] = data["display_name"]

	if not update_fields:
		return jsonify({"error": "no fields to update"}), 400

	for aid in asset_ids:
		db.system_asset_labels.update_one(
			{"asset_id": aid},
			{"$set": update_fields}
		)

	return jsonify({"ok": True})


@assets_bp.put("/move-category", endpoint="move_asset_category")
@role_required(["admin"])
def move_asset_category():
	"""
	Move asset types to a different category.
	Updates system_asset_labels, master_assets, and assets collections.
	---
	tags:
	  - Assets
	security:
	  - Bearer: []
	parameters:
	  - name: body
	    in: body
	    required: true
	    schema:
	      type: object
	      required:
	        - asset_ids
	        - new_category_id
	      properties:
	        asset_ids:
	          type: array
	          items:
	            type: string
	        new_category_id:
	          type: string
	responses:
	  200:
	    description: Asset category updated
	  400:
	    description: Missing required fields
	"""
	data = request.get_json(silent=True) or {}
	asset_ids = data.get("asset_ids") or []
	new_category_id = data.get("new_category_id")

	if not asset_ids:
		return jsonify({"error": "asset_ids required"}), 400
	if not new_category_id:
		return jsonify({"error": "new_category_id required"}), 400

	db = get_db()

	# Verify the target category exists
	cat = db.system_asset_categories.find_one({"category_id": new_category_id})
	if not cat:
		return jsonify({"error": "category not found"}), 404

	# Update system_asset_labels
	db.system_asset_labels.update_many(
		{"asset_id": {"$in": asset_ids}},
		{"$set": {"category_id": new_category_id}}
	)

	# Update master_assets
	db.master_assets.update_many(
		{"asset_id": {"$in": asset_ids}},
		{"$set": {"category_id": new_category_id}}
	)

	# Update individual asset observations
	db.assets.update_many(
		{"asset_id": {"$in": asset_ids}},
		{"$set": {"category_id": new_category_id}}
	)

	return jsonify({"ok": True, "updated_category": new_category_id})


@assets_bp.get("/available-icons", endpoint="available_icons")
@role_required(["admin", "surveyor", "viewer"])
def list_available_icons():
	"""
	List available icon files from UPLOAD_DIR/asset-map-icons/.
	---
	tags:
	  - Assets
	security:
	  - Bearer: []
	responses:
	  200:
	    description: List of available icons with their URLs
	"""
	from pathlib import Path
	upload_root = Path(os.getenv("UPLOAD_DIR", Path(__file__).resolve().parents[1] / "uploads"))
	icons_dir = upload_root / "asset-map-icons"
	icons = []
	if icons_dir.is_dir():
		for f in sorted(icons_dir.iterdir()):
			if f.suffix.lower() in (".png", ".svg", ".jpg", ".jpeg", ".webp"):
				icons.append({
					"filename": f.name,
					"icon_url": f"/uploads/asset-map-icons/{f.name}",
				})
	return jsonify({"icons": icons})


@assets_bp.post("/upload-icon", endpoint="upload_icon")
@role_required(["admin"])
def upload_icon():
	"""
	Upload a custom icon file for asset types (admin only).
	Saved to UPLOAD_DIR/asset-map-icons/ and served at /uploads/asset-map-icons/<filename>.
	---
	tags:
	  - Assets
	security:
	  - Bearer: []
	consumes:
	  - multipart/form-data
	parameters:
	  - name: icon
	    in: formData
	    type: file
	    required: true
	    description: Icon file (PNG, SVG, JPG, WEBP, max 500KB)
	responses:
	  200:
	    description: Icon uploaded successfully
	  400:
	    description: Invalid file
	"""
	from pathlib import Path
	if "icon" not in request.files:
		return jsonify({"error": "icon file required"}), 400

	file = request.files["icon"]
	if not file.filename:
		return jsonify({"error": "empty filename"}), 400

	# Validate extension
	allowed = {".png", ".svg", ".jpg", ".jpeg", ".webp"}
	ext = os.path.splitext(file.filename)[1].lower()
	if ext not in allowed:
		return jsonify({"error": f"invalid file type. Allowed: {', '.join(allowed)}"}), 400

	# Validate size (500KB max)
	file.seek(0, 2)
	size = file.tell()
	file.seek(0)
	if size > 500 * 1024:
		return jsonify({"error": "file too large (max 500KB)"}), 400

	# Save to UPLOAD_DIR/asset-map-icons/
	upload_root = Path(os.getenv("UPLOAD_DIR", Path(__file__).resolve().parents[1] / "uploads"))
	icons_dir = upload_root / "asset-map-icons"
	icons_dir.mkdir(parents=True, exist_ok=True)

	# Sanitize filename
	safe_name = re.sub(r"[^\w.\-]", "-", os.path.basename(file.filename))
	dest = icons_dir / safe_name
	file.save(dest)

	icon_url = f"/uploads/asset-map-icons/{safe_name}"
	return jsonify({"ok": True, "filename": safe_name, "icon_url": icon_url})


@assets_bp.get("/<user_id>/resolved-map", endpoint="resolved_map")
def get_resolved_map(user_id: str):
	"""
	Get resolved asset map for a user (including preferences)
	---
	tags:
	  - Assets
	parameters:
	  - name: user_id
	    in: path
	    type: string
	    required: false
	    description: The ID of the user
	responses:
	  200:
	    description: Resolved map retrieved successfully
	    schema:
	      type: object
	      properties:
	        categories:
	          type: object
	        labels:
	          type: object
	"""
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
			"default_name": cat["default_name"],
			"original_display_name": cat["display_name"],
			"display_name": cat_override.get(cid, {}).get("display_name") or cat["display_name"]
		}
		
	resolved_labels = {}
	for l in system_labels:
		aid = l["asset_id"]
		entry = {
			"asset_id": aid,
			"category_id": l.get("category_id"),
			"category_name": l.get("category_name"),  
			"default_name": l["default_name"],
			"group_id": l.get("group_id"),
			"default_group_id": l.get("default_group_id", ""),
			"original_display_name": l["display_name"],
			"display_name": labels_override.get(aid, {}).get("display_name") or l["display_name"]
		}
		
		# Include icon config if present
		if l.get("icon_url"):
			entry["icon_url"] = l["icon_url"]
		if l.get("icon_size"):
			entry["icon_size"] = l["icon_size"]
		if l.get("icon_anchor"):
			entry["icon_anchor"] = l["icon_anchor"]
		resolved_labels[aid] = entry

	return {
		"categories": resolved_cats,
		"labels": resolved_labels
	}