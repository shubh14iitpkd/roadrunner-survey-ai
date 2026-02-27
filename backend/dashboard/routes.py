from bson import ObjectId
from flask import Blueprint, jsonify, request
from pymongo import ASCENDING
from utils.is_demo_video import is_demo, get_video_key
from db import get_db


dashboard_bp = Blueprint("dashboard", __name__)


@dashboard_bp.get("/kpis")
def kpis():
	"""
	Get Dashboard KPIs
	---
	tags:
	  - Dashboard
	parameters:
	  - name: timeframe
	    in: query
	    type: string
	    default: week
	    description: Timeframe for KPI calculation
	responses:
	  200:
	    description: KPIs retrieved successfully
	    schema:
	      type: object
	      properties:
	        totalAssets:
	          type: integer
	        totalAnomalies:
	          type: integer
	        good:
	          type: integer
	        fair:
	          type: integer
	        poor:
	          type: integer
	        kmSurveyed:
	          type: number
	"""
	timeframe = request.args.get("timeframe", "week")
	db = get_db()
	
	agg = db.surveys.aggregate([
		{"$match" : { "is_latest" : True} },
		{"$group": {"_id": None, "total_assets": {"$sum": "$totals.total_assets"}, "damaged": {"$sum": "$totals.damaged"}, "good": {"$sum": "$totals.good"} }}
	])
	result = agg.next()
	total_assets = result.get("total_assets", 0)
	total_damaged = result.get("damaged", 0)
	good = result.get("good", 0)
	# Simple approx for kmSurveyed: distinct route_ids surveyed in timeframe not implemented, fallback total roads length
	km_surveyed = float(db.roads.aggregate([
		{"$group": {"_id": None, "km": {"$sum": {"$ifNull": ["$estimated_distance_km", 0]}}}}
	]).next().get("km", 0)) if db.roads.estimated_document_count() else 0.0
	return jsonify({
		"totalAssets": total_assets,
		"totalAnomalies": total_damaged,
		"good": good,
		"damaged": total_damaged,
		"kmSurveyed": round(km_surveyed, 1),
	})


@dashboard_bp.get("/charts/assets-by-category")
def assets_by_category():
	"""
	Get assets count by category
	---
	tags:
	  - Dashboard
	responses:
	  200:
	    description: Chart data retrieved successfully
	"""
	db = get_db()
	
	# 1. Identify latest surveys
	latest_surveys = list(db.surveys.find({"is_latest": True}, {"_id": 1}))
	latest_survey_ids = [ObjectId(s["_id"]) for s in latest_surveys]
	
	if not latest_survey_ids:
		return jsonify({"items": []})

	# 2. Get videos for these surveys to identify demo videos
	videos = list(db.videos.find({"survey_id": {"$in": latest_survey_ids}}))
	
	demo_video_keys = []
	
	for v in videos:
		storage_path = v.get("storage_url")
		if is_demo(video_url=storage_path):
			key = get_video_key(storage_path)
			if key:
				demo_video_keys.append(key)
	print("[DASHBOARD] demo_video_keys", demo_video_keys)
	# 3. Match assets by survey_id (real) OR video_key (demo)
	match_query = {
		"$or": [
			{"survey_id": {"$in": latest_survey_ids}},
			{"video_key": {"$in": demo_video_keys}}
		]
	}
	
	agg = db.assets.aggregate([
		{"$match": match_query},
		{"$group": {"_id": "$category_id", "count": {"$sum": 1}}},
		{"$sort": {"count": -1}},
		{"$limit": 10},
	])
	results = list(agg)
	print("[DASHBOARD] results", results)
	items = [{"category_id": d.get("_id") or "Unknown", "count": d.get("count", 0)} for d in results]
	return jsonify({"items": items})


@dashboard_bp.get("/charts/anomalies-by-category")
def anomalies_by_category():
	"""
	Get anomalies count by category
	
	tags:
	  - Dashboard
	responses:
	  200:
	    description: Chart data retrieved successfully
	"""
	db = get_db()
	
	# 1. Identify latest surveys
	latest_surveys = list(db.surveys.find({"is_latest": True}, {"_id": 1}))
	latest_survey_ids = [s["_id"] for s in latest_surveys]
	
	if not latest_survey_ids:
		return jsonify({"items": []})

	# 2. Get videos for these surveys to identify demo videos
	videos = list(db.videos.find({"survey_id": {"$in": latest_survey_ids}}))
	
	demo_video_keys = []
	for v in videos:
		storage_path = v.get("storage_path")
		if is_demo(video_url=storage_path):
			key = get_video_key(storage_path)
			if key:
				demo_video_keys.append(key)
	
	# 3. Match assets by survey_id (real) OR video_key (demo) AND condition=damaged
	match_query = {
		"$and": [
			{"condition": "damaged"},
			{"$or": [
				{"survey_id": {"$in": latest_survey_ids}},
				{"video_key": {"$in": demo_video_keys}}
			]}
		]
	}

	agg = db.assets.aggregate([
		{"$match": match_query},
		{"$group": {"_id": "$category_id", "count": {"$sum": 1}}},
		{"$sort": {"count": -1}},
		{"$limit": 10},
	])
	
	items = [{"category_id": d.get("_id") or "Unknown", "count": d.get("count", 0)} for d in agg]
	return jsonify({"items": items})


@dashboard_bp.get("/tables/top-asset-types")
def top_asset_types():
	"""
	Get top asset types by count (paginated)
	---
	tags:
	  - Dashboard
	parameters:
	  - name: page
	    in: query
	    type: integer
	    default: 1
	  - name: limit
	    in: query
	    type: integer
	    default: 5
	responses:
	  200:
	    description: Table data retrieved successfully
	"""
	page = request.args.get("page", 1, type=int)
	limit = request.args.get("limit", 5, type=int)
	category_id = request.args.get("category_id", None)
	condition = request.args.get("condition", None)
	skip = (page - 1) * limit

	db = get_db()
	
	# 1. Identify latest surveys
	latest_surveys = list(db.surveys.find({"is_latest": True}, {"_id": 1}))
	latest_survey_ids = [s["_id"] for s in latest_surveys]
	
	if not latest_survey_ids:
		return jsonify({"items": [], "total": 0, "page": page, "pages": 0})

	# 2. Get videos for these surveys to identify demo videos
	videos = list(db.videos.find({"survey_id": {"$in": latest_survey_ids}}))
	
	demo_video_keys = []
	for v in videos:
		storage_path = v.get("storage_url") or v.get("storage_path")
		if is_demo(video_url=storage_path):
			key = get_video_key(storage_path)
			if key:
				demo_video_keys.append(key)
	
	# 3. Match assets by survey_id (real) OR video_key (demo)
	match_query = {
		"$or": [
			{"survey_id": {"$in": latest_survey_ids}},
			{"video_key": {"$in": demo_video_keys}}
		]
	}

	# 4. Optionally filter by category_id
	if category_id:
		match_query = {"$and": [match_query, {"category_id": category_id}]}

	# 5. Optionally filter by condition (e.g. "damaged")
	if condition:
		match_query = {"$and": [match_query, {"condition": condition}]}

	# Group by group_id (fall back to asset_id when group_id is absent)
	group_key = {"$ifNull": ["$group_id", "$asset_id"]}

	# Count total distinct groups (for pagination)
	total_agg = db.assets.aggregate([
		{"$match": match_query},
		{"$group": {"_id": group_key}},
		{"$count": "total"}
	])
	
	try:
		total_count = total_agg.next().get("total", 0)
	except StopIteration:
		total_count = 0

	# Get paginated data — keep first asset_id per group for label lookup
	agg = db.assets.aggregate([
		{"$match": match_query},
		{"$group": {
			"_id": group_key,
			"asset_id": {"$first": "$asset_id"},
			"asset_type": {"$first": "$asset_type"}, 
			"count": {"$sum": 1}
		}},
		{"$sort": {"count": -1}},
		{"$skip": skip},
		{"$limit": limit}
	])
	
	results = list(agg)
	
	# Fetch display names from system_asset_labels using the first asset_id per group
	asset_ids = [r["asset_id"] for r in results if r.get("asset_id")]
	labels_map = {}
	if asset_ids:
		labels = list(db.system_asset_labels.find({"asset_id": {"$in": asset_ids}}))
		for l in labels:
			labels_map[l["asset_id"]] = { "display_name": l.get("display_name") or l.get("default_name"), "category_id": l.get("category_id")}

	items = []
	for d in results:
		aid = d.get("asset_id")
		atype = d.get("asset_type") or "Unknown"
		obj = labels_map.get(aid)
		display_name = obj.get("display_name", atype) if obj else atype
		category_id_val = obj.get("category_id") if obj else None

		items.append({
			"asset_id": aid,
			"type": atype,
			"category_id": category_id_val,
			"display_name": display_name,
			"count": d.get("count", 0)
		})
	
	import math
	total_pages = math.ceil(total_count / limit)
	
	return jsonify({
		"items": items,
		"total": total_count,
		"page": page,
		"pages": total_pages
	})


@dashboard_bp.get("/tables/top-anomaly-roads")
def top_anomaly_roads():
	"""
	Get top roads with anomalies

	tags:
	  - Dashboard
	responses:
	  200:
	    description: Table data retrieved successfully
	"""
	db = get_db()
	
	# 1. Identify latest surveys
	latest_surveys = list(db.surveys.find({"is_latest": True}, {"_id": 1}))
	latest_survey_ids = [s["_id"] for s in latest_surveys]
	
	if not latest_survey_ids:
		return jsonify({"items": []})

	# 2. Get videos for these surveys to identify demo videos
	videos = list(db.videos.find({"survey_id": {"$in": latest_survey_ids}}))
	
	demo_video_keys = []
	for v in videos:
		storage_path = v.get("storage_path")
		if is_demo(video_url=storage_path):
			key = get_video_key(storage_path)
			if key:
				demo_video_keys.append(key)
	
	# 3. Match assets by survey_id (real) OR video_key (demo) AND condition=damaged
	match_query = {
		"$and": [
			{"condition": "damaged"},
			{"$or": [
				{"survey_id": {"$in": latest_survey_ids}},
				{"video_key": {"$in": demo_video_keys}}
			]}
		]
	}

	agg = db.assets.aggregate([
		{"$match": match_query},
		{"$group": {"_id": "$route_id", "count": {"$sum": 1}}},
		{"$sort": {"count": -1}},
		{"$limit": 5},
	])
	
	items = []
	for d in agg:
		route_id = d.get("_id")
		road = db.roads.find_one({"route_id": route_id})
		# Find latest survey date for this route
		latest_survey = db.surveys.find_one(
			{"route_id": route_id, "is_latest": True},
			{"survey_date": 1}
		)
		survey_date = latest_survey.get("survey_date") if latest_survey else None
		items.append({
			"road": road.get("road_name") if road else f"Route {route_id}",
			"count": d.get("count", 0),
			"lastSurvey": survey_date,
		})
	return jsonify({"items": items})


@dashboard_bp.get("/recent-surveys")
def recent_surveys():
	"""
	Get recent surveys list
	---
	tags:
	  - Dashboard
	responses:
	  200:
	    description: Recent surveys retrieved successfully
	"""
	db = get_db()
	cursor = db.surveys.find().sort("survey_date", -1).limit(5)
	items = []
	for s in cursor:
		road = db.roads.find_one({"route_id": s.get("route_id")})
		items.append({
			"road": road.get("road_name") if road else f"Route {s.get('route_id')}",
			"date": s.get("survey_date"),
			"assets": s.get("totals", {}).get("total_assets", 0),
			"surveyor": s.get("surveyor_name"),
		})
	return jsonify({"items": items})


@dashboard_bp.get("/monitoring/status")
def monitoring_status():
	"""
	Get system monitoring status only

	tags:
	  - Dashboard
	responses:
	  200:
	    description: System status retrieved successfully
	"""
	from services.monitoring_service import MonitoringService
	service = MonitoringService()
	return jsonify(service.get_full_status())


@dashboard_bp.get("/monitoring/jobs")
def monitoring_jobs():
	"""
	Get active monitoring jobs

	tags:
	  - Dashboard
	responses:
	  200:
	    description: Active jobs retrieved successfully
	"""
	from services.monitoring_service import MonitoringService
	service = MonitoringService()
	return jsonify({
		"uploads": service.get_active_uploads(),
		"processing": service.get_active_processing()
	})
