import math

from flask import Blueprint, jsonify, request

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
	        damaged:
	          type: integer
	        kmSurveyed:
	          type: number
	"""
	db = get_db()

	# Count directly from master_assets
	total_assets = db.master_assets.count_documents({})
	good = db.master_assets.count_documents({"latest_condition": "good"})
	damaged = total_assets - good  # everything not 'good' is damaged

	# km surveyed: sum of estimated_distance_km from all roads
	km_surveyed = 0.0
	if db.roads.estimated_document_count():
		km_agg = db.roads.aggregate([
			{"$group": {"_id": None, "km": {"$sum": {"$ifNull": ["$estimated_distance_km", 0]}}}}
		])
		try:
			km_surveyed = float(km_agg.next().get("km", 0))
		except StopIteration:
			pass

	return jsonify({
		"totalAssets": total_assets,
		"totalAnomalies": damaged,
		"good": good,
		"damaged": damaged,
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

	agg = db.master_assets.aggregate([
		{"$group": {
			"_id": "$category_id",
			"count": {"$sum": 1},
			"good_count": {
				"$sum": {"$cond": [{"$eq": ["$latest_condition", "good"]}, 1, 0]}
			},
			"damaged_count": {
				"$sum": {"$cond": [{"$ne": ["$latest_condition", "good"]}, 1, 0]}
			},
		}},
		{"$sort": {"count": -1}},
		{"$limit": 10},
	])

	items = [{
		"category_id": d.get("_id") or "Unknown",
		"count": d.get("count", 0),
		"damaged_count": d.get("damaged_count", 0),
		"good_count": d.get("good_count", 0),
	} for d in agg]

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

	agg = db.master_assets.aggregate([
		{"$match": {"latest_condition": {"$ne": "good"}}},
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
	  - name: category_id
	    in: query
	    type: string
	    description: Filter by category ID
	  - name: condition
	    in: query
	    type: string
	    description: Filter by condition (e.g. damaged)
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

	# Build match query on master_assets
	match_query: dict = {}
	if category_id:
		match_query["category_id"] = category_id
	if condition:
		if condition == "damaged":
			match_query["latest_condition"] = {"$ne": "good"}
		else:
			match_query["latest_condition"] = condition

	# Group by group_id (fall back to asset_id when group_id is absent)
	group_key = {"$ifNull": ["$group_id", "$asset_id"]}

	# Count total distinct groups (for pagination)
	total_agg = db.master_assets.aggregate([
		{"$match": match_query},
		{"$group": {"_id": group_key}},
		{"$count": "total"},
	])

	try:
		total_count = total_agg.next().get("total", 0)
	except StopIteration:
		total_count = 0

	# Get paginated data
	agg = db.master_assets.aggregate([
		{"$match": match_query},
		{"$group": {
			"_id": group_key,
			"asset_id": {"$first": "$asset_id"},
			"asset_type": {"$first": "$asset_type"},
			"count": {"$sum": 1},
			"damaged_count": {
				"$sum": {"$cond": [{"$ne": ["$latest_condition", "good"]}, 1, 0]}
			},
		}},
		{"$sort": {"count": -1}},
		{"$skip": skip},
		{"$limit": limit},
	])

	results = list(agg)

	# Fetch display names from system_asset_labels
	asset_ids = [r["asset_id"] for r in results if r.get("asset_id")]
	labels_map: dict = {}
	if asset_ids:
		labels = list(db.system_asset_labels.find({"asset_id": {"$in": asset_ids}}))
		for l in labels:
			labels_map[l["asset_id"]] = {
				"display_name": l.get("display_name") or l.get("default_name"),
				"category_id": l.get("category_id"),
			}

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
			"count": d.get("count", 0),
			"damaged_count": d.get("damaged_count", 0),
		})

	total_pages = math.ceil(total_count / limit) if limit else 0

	return jsonify({
		"items": items,
		"total": total_count,
		"page": page,
		"pages": total_pages,
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

	agg = db.master_assets.aggregate([
		{"$match": {"latest_condition": {"$ne": "good"}}},
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
			{"survey_date": 1},
		)
		survey_date = latest_survey.get("survey_date") if latest_survey else None
		items.append({
			"road": road.get("road_name") if road else f"Route {route_id}",
			"route_id": route_id,
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
			"route_id": s.get("route_id"),
			"date": s.get("survey_date"),
			"assets": s.get("totals", {}).get("total_assets", 0),
			"surveyor": s.get("surveyor_name"),
		})
	return jsonify({"items": items})
