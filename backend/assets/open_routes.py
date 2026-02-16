"""
This file contains routes we expose so that 
third parties can use our data
"""

import os

from flask import Blueprint, jsonify, request
from bson import ObjectId
from pymongo import ASCENDING, DESCENDING

from db import get_db
from utils.ids import get_now_iso
from utils.is_demo_video import is_demo
from utils.response import mongo_response

open_assets_bp = Blueprint("pub_assets", __name__)

@open_assets_bp.get("/", endpoint="pub_assets_list")
def list_assets():
	"""
	List assets with filters and pagination
	---
	tags:
	  - Assets
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
	  - name: page
	    in: query
	    type: integer
	    default: 1
	    description: Page number for pagination
	  - name: limit
	    in: query
	    type: integer
	    default: 100
	    description: Number of items per page
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
	        total:
	          type: integer
	        page:
	          type: integer
	        limit:
	          type: integer
	        total_pages:
	          type: integer
	"""
	query = {}
	survey_id = request.args.get("survey_id")
	route_id = request.args.get("route_id", type=int)
	category = request.args.get("category")
	condition = request.args.get("condition")
	
	# Pagination parameters
	page = request.args.get("page", type=int, default=1)
	limit = request.args.get("limit", type=int, default=100)
	if page < 1:
		page = 1
	offset = (page - 1) * limit

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

	# Execute query with pagination
	total = db.assets.count_documents(query)
	items = list(db.assets.find(query).sort([("detected_at", DESCENDING), ("_id", ASCENDING)]).skip(offset).limit(limit))
	
	import math
	total_pages = math.ceil(total / limit) if limit > 0 else 0

	return mongo_response({
		"items": items,
		"total": total,
		"page": page,
		"limit": limit,
		"total_pages": total_pages
	})


@open_assets_bp.get("/<asset_id>", endpoint="pub_assets_get_id")
def get_asset(asset_id: str):
	"""
	Get asset details
	---
	tags:
	  - Assets
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

@open_assets_bp.post("/bulk", endpoint="pub_assets_bulk")
def bulk_insert():
	"""
	Bulk insert or update assets
	---
	tags:
	  - Assets
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

@open_assets_bp.get("/<user_id>/resolved-map", endpoint="resolved_map")
def get_resolved_map(user_id: str):
	"""
	Get asset map for system or user which is used to resolve display name for asset
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
		resolved_labels[aid] = {
			"asset_id": aid,
			"category_id": l.get("category_id"),  # Include category_id for tree building
			"default_name": l["default_name"],
			"original_display_name": l["display_name"],
			"display_name": labels_override.get(aid, {}).get("display_name") or l["display_name"]
		}

	return {
		"categories": resolved_cats,
		"labels": resolved_labels
	}