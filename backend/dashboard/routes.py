import math
from datetime import datetime, timezone

from flask import Blueprint, jsonify, request

from db import get_db

dashboard_bp = Blueprint("dashboard", __name__)


def _get_cached_or_compute(db, key: str, compute_fn, ttl_seconds: int = 300):
    """Return cached dashboard data or recompute and store it."""
    cached = db.dashboard_cache.find_one({"key": key})
    if cached:
        age = (datetime.now(timezone.utc) - cached["cached_at"].replace(tzinfo=timezone.utc)).total_seconds()
        if age < ttl_seconds:
            return cached["data"]
    result = compute_fn()
    db.dashboard_cache.replace_one(
        {"key": key},
        {"key": key, "timeframe": "current", "data": result, "cached_at": datetime.now(timezone.utc)},
        upsert=True,
    )
    return result


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

	def _compute():
		# Single aggregation replaces two count_documents calls
		counts_agg = list(db.master_assets.aggregate([
			{"$group": {
				"_id": None,
				"total": {"$sum": 1},
				"good": {"$sum": {"$cond": [{"$eq": ["$latest_condition", "good"]}, 1, 0]}},
			}},
		]))
		total_assets = counts_agg[0]["total"] if counts_agg else 0
		good = counts_agg[0]["good"] if counts_agg else 0
		damaged = total_assets - good

		km_surveyed = 0.0
		if db.roads.estimated_document_count():
			km_agg = db.roads.aggregate([
				{"$group": {"_id": None, "km": {"$sum": {"$ifNull": ["$estimated_distance_km", 0]}}}}
			])
			try:
				km_surveyed = float(km_agg.next().get("km", 0))
			except StopIteration:
				pass

		return {
			"totalAssets": total_assets,
			"totalAnomalies": damaged,
			"good": good,
			"damaged": damaged,
			"kmSurveyed": round(km_surveyed, 1),
		}

	return jsonify(_get_cached_or_compute(db, "kpis", _compute, ttl_seconds=300))


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

	def _compute():
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
		return [{"category_id": d.get("_id") or "Unknown", "count": d.get("count", 0),
		         "damaged_count": d.get("damaged_count", 0), "good_count": d.get("good_count", 0)}
		        for d in agg]

	return jsonify({"items": _get_cached_or_compute(db, "assets_by_category", _compute, ttl_seconds=300)})


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

	def _compute():
		agg = db.master_assets.aggregate([
			{"$match": {"latest_condition": {"$ne": "good"}}},
			{"$group": {"_id": "$category_id", "count": {"$sum": 1}}},
			{"$sort": {"count": -1}},
			{"$limit": 10},
		])
		return [{"category_id": d.get("_id") or "Unknown", "count": d.get("count", 0)} for d in agg]

	return jsonify({"items": _get_cached_or_compute(db, "anomalies_by_category", _compute, ttl_seconds=300)})


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
	sort_by = request.args.get("sort_by", "damaged_count")  # type, category, count, damaged_count
	sort_order = request.args.get("sort_order", "desc")  # asc | desc
	skip = (page - 1) * limit

	db = get_db()

	# Map frontend sort keys to MongoDB field names
	SORT_FIELD_MAP = {
		"type": "asset_type",
		"category": "category_id",
		"total": "count",
		"defects": "damaged_count",
		# allow raw field names as fallback
		"count": "count",
		"damaged_count": "damaged_count",
	}
	sort_field = SORT_FIELD_MAP.get(sort_by, "damaged_count")
	sort_dir = 1 if sort_order == "asc" else -1

	# Build match query on master_assets
	match_query: dict = {}
	if category_id:
		match_query["category_id"] = category_id

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
			"category_id": {"$first": "$category_id"},
			"count": {"$sum": 1},
			"damaged_count": {
				"$sum": {"$cond": [{"$ne": ["$latest_condition", "good"]}, 1, 0]}
			},
		}},
		{"$sort": {sort_field: sort_dir }},
		{"$skip": skip},
		{"$limit": limit},
	])

	results = list(agg)

	# Fetch display names from system_asset_labels (group_id is authoritative)
	asset_ids = [r["asset_id"] for r in results if r.get("asset_id")]
	labels_map: dict = {}
	if asset_ids:
		labels = list(db.system_asset_labels.find({"asset_id": {"$in": asset_ids}}))
		for l in labels:
			labels_map[l["asset_id"]] = {
				"display_name": l.get("group_id") or l.get("display_name") or l.get("default_name"),
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
			"group_id": d.get("_id", aid),
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
	Get roads with anomalies (paginated, sortable)

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
	    default: 10
	  - name: sort_by
	    in: query
	    type: string
	    description: Field to sort by (road, total, defects, last_survey)
	  - name: sort_order
	    in: query
	    type: string
	    description: Sort direction (asc | desc)
	responses:
	  200:
	    description: Table data retrieved successfully
	"""
	page = request.args.get("page", 1, type=int)
	limit = request.args.get("limit", 10, type=int)
	sort_by = request.args.get("sort_by", "defects")  # road, route_id, road_side, total, defects, last_survey
	sort_order = request.args.get("sort_order", "desc")  # asc | desc
	skip = (page - 1) * limit

	db = get_db()

	# Single aggregation combines defect + total counts per route (was 2 separate scans)
	counts_agg = db.master_assets.aggregate([
		{"$group": {
			"_id": "$route_id",
			"defect_count": {"$sum": {"$cond": [{"$ne": ["$latest_condition", "good"]}, 1, 0]}},
			"total_count": {"$sum": 1},
		}},
	])
	counts_map = {d["_id"]: d for d in counts_agg}

	# Fetch all roads
	all_roads = list(db.roads.find({}, {"route_id": 1, "road_name": 1, "road_side": 1}))

	# Batch fetch latest survey dates — replaces N+1 find_one loop (uses idx_surveys_route_latest)
	route_ids = [r.get("route_id") for r in all_roads if r.get("route_id") is not None]
	latest_surveys_cursor = db.surveys.find(
		{"route_id": {"$in": route_ids}, "is_latest": True},
		{"route_id": 1, "survey_date": 1},
	)
	survey_date_map = {s["route_id"]: s.get("survey_date") for s in latest_surveys_cursor}

	# Map sort field names to item keys
	SORT_FIELD_MAP = {
		"road": ("road", False),
		"route_id": ("route_id", False),
		"road_side": ("road_side", False),
		"total": ("total_count", False),
		"last_survey": ("lastSurvey", False),
	}

	items_raw = []
	for road in all_roads:
		route_id = road.get("route_id")
		counts = counts_map.get(route_id, {})
		items_raw.append({
			"road": road.get("road_name") or f"Route {route_id}",
			"route_id": route_id,
			"road_side": road.get("road_side"),
			"count": counts.get("defect_count", 0),
			"total_count": counts.get("total_count", 0),
			"lastSurvey": survey_date_map.get(route_id),
		})

	# Sort in Python (small list — road count is bounded)
	reverse = sort_order != "asc"
	if sort_by == "road":
		items_raw.sort(key=lambda x: (x["road"] or "").lower(), reverse=reverse)
	elif sort_by == "route_id":
		items_raw.sort(key=lambda x: x["route_id"] or 0, reverse=reverse)
	elif sort_by == "road_side":
		items_raw.sort(key=lambda x: (x["road_side"] or "").lower(), reverse=reverse)
	elif sort_by == "total":
		items_raw.sort(key=lambda x: x["total_count"] or 0, reverse=reverse)
	elif sort_by == "last_survey":
		items_raw.sort(key=lambda x: x["lastSurvey"] or "", reverse=reverse)
	else:  # defects (default)
		items_raw.sort(key=lambda x: x["count"] or 0, reverse=reverse)

	total_count = len(items_raw)
	total_pages = math.ceil(total_count / limit) if limit else 0
	paged_items = items_raw[skip: skip + limit]

	return jsonify({
		"items": paged_items,
		"total": total_count,
		"page": page,
		"pages": total_pages,
	})


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
	surveys = list(db.surveys.find().sort("survey_date", -1).limit(5))
	# Batch fetch road names — replaces 5 individual find_one calls
	s_route_ids = [s.get("route_id") for s in surveys if s.get("route_id") is not None]
	roads_map = {
		r["route_id"]: r.get("road_name")
		for r in db.roads.find({"route_id": {"$in": s_route_ids}}, {"route_id": 1, "road_name": 1})
	}
	items = []
	for s in surveys:
		rid = s.get("route_id")
		items.append({
			"road": roads_map.get(rid) or f"Route {rid}",
			"route_id": rid,
			"date": s.get("survey_date"),
			"assets": s.get("totals", {}).get("total_assets", 0),
			"surveyor": s.get("surveyor_name"),
		})
	return jsonify({"items": items})
