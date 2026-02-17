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
open_routes_bp = Blueprint("pub_routes", __name__)
open_videos_bp = Blueprint("pub_videos", __name__)
open_surveys_bp = Blueprint("pub_surveys", __name__)


@open_assets_bp.get("/", endpoint="pub_assets_list")
def list_assets():
	"""
	List assets with filters and pagination
	---
	tags:
	  - Assets
	parameters:
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


# @open_videos_bp.get("/videos", endpoint="pub_videos_list")
# def list_videos():
# 	"""
# 	List all videos (public)
# 	---
# 	tags:
# 	  - Videos
# 	responses:
# 	  200:
# 	    description: List of videos retrieved successfully
# 	    schema:
# 	      type: object
# 	      properties:
# 	        items:
# 	          type: array
# 	          items:
# 	            type: object
# 	        count:
# 	          type: integer
# 	"""
# 	query = {}
# 	route_id = request.args.get("route_id", type=int)
# 	survey_id = request.args.get("survey_id")
# 	status = request.args.get("status")

# 	if route_id is not None:
# 		query["route_id"] = route_id
# 	if survey_id:
# 		query["survey_id"] = ObjectId(survey_id)
# 	if status:
# 		query["status"] = status

# 	db = get_db()
# 	items = list(db.videos.find(query).sort("created_at", DESCENDING))

# 	return mongo_response({"items": items, "count": len(items)})


@open_surveys_bp.get("/", endpoint="pub_surveys_list")
def list_surveys():
	"""
	List surveys with filters
	---
	tags:
	  - Surveys
	parameters:
	  - name: latest_only
	    in: query
	    type: boolean
	    default: true
	    description: Filter by latest version only
	responses:
	  200:
	    description: List of surveys retrieved successfully
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
	route_id = request.args.get("route_id", type=int)
	status = request.args.get("status")
	latest_only = request.args.get("latest_only", "true").lower() == "true"  # Default to showing latest only

	if route_id is not None:
		query["route_id"] = route_id
	if status:
		query["status"] = status
	if latest_only:
		query["is_latest"] = True

	db = get_db()
	items = list(db.surveys.find(query).sort("survey_date", DESCENDING))
	return mongo_response({"items": items, "count": len(items)})

@open_routes_bp.get("/", endpoint="pub_roads_list")
def list_roads():
	"""
	List all roads
	---
	tags:
	  - Roads
	responses:
	  200:
	    description: List of roads retrieved successfully
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
	search = request.args.get("search")
	road_type = request.args.get("type")
	road_side = request.args.get("side")
	if search:
		query["$text"] = {"$search": search}
	if road_type:
		query["road_type"] = road_type
	if road_side:
		query["road_side"] = road_side

	db = get_db()
	cursor = db.roads.find(query).sort("route_id", ASCENDING)
	roads = []
	for r in cursor:
		roads.append({
			"route_id": r.get("route_id"),
			"road_name": r.get("road_name"),
			"start_point_name": r.get("start_point_name"),
			"start_lat": r.get("start_lat"),
			"start_lng": r.get("start_lng"),
			"end_point_name": r.get("end_point_name"),
			"end_lat": r.get("end_lat"),
			"end_lng": r.get("end_lng"),
			"estimated_distance_km": r.get("estimated_distance_km"),
			"road_type": r.get("road_type"),
			"road_side": r.get("road_side"),
			"gpx_file_url": r.get("gpx_file_url"),
		})
	return jsonify({"items": roads, "count": len(roads)})


@open_routes_bp.get("/<int:route_id>", endpoint="pub_roads_get_id")
def get_road(route_id: int):
	"""
	Get details of a specific road
	---
	tags:
	  - Roads
	parameters:
	  - name: route_id
	    in: path
	    type: integer
	    required: true
	    description: The route ID of the road
	responses:
	  200:
	    description: Road details retrieved successfully
	  404:
	    description: Road not found
	"""
	db = get_db()
	road = db.roads.find_one({"route_id": route_id})
	if not road:
		return jsonify({"error": "not found"}), 404
	return mongo_response({"item": road})