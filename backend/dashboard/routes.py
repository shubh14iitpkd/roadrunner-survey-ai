from flask import Blueprint, jsonify, request
from pymongo import ASCENDING

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
	total_assets = db.assets.estimated_document_count()
	total_anomalies = db.assets.count_documents({"condition": "Poor"})
	good = db.assets.count_documents({"condition": "Good"})
	fair = db.assets.count_documents({"condition": "Fair"})
	poor = total_anomalies
	# Simple approx for kmSurveyed: distinct route_ids surveyed in timeframe not implemented, fallback total roads length
	km_surveyed = float(db.roads.aggregate([
		{"$group": {"_id": None, "km": {"$sum": {"$ifNull": ["$estimated_distance_km", 0]}}}}
	]).next().get("km", 0)) if db.roads.estimated_document_count() else 0.0
	return jsonify({
		"totalAssets": total_assets,
		"totalAnomalies": total_anomalies,
		"good": good,
		"fair": fair,
		"poor": poor,
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
	agg = db.assets.aggregate([
		{"$group": {"_id": "$category", "count": {"$sum": 1}}},
		{"$sort": {"count": -1}},
		{"$limit": 10},
	])
	items = [{"category": d.get("_id") or "Unknown", "count": d.get("count", 0)} for d in agg]
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
	agg = db.assets.aggregate([
		{"$match": {"condition": "Poor"}},
		{"$group": {"_id": "$category", "count": {"$sum": 1}}},
		{"$sort": {"count": -1}},
		{"$limit": 10},
	])
	items = [{"category": d.get("_id") or "Unknown", "count": d.get("count", 0)} for d in agg]
	return jsonify({"items": items})


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
	agg = db.assets.aggregate([
		{"$match": {"condition": "Poor"}},
		{"$group": {"_id": "$route_id", "count": {"$sum": 1}}},
		{"$sort": {"count": -1}},
		{"$limit": 5},
	])
	items = []
	for d in agg:
		route_id = d.get("_id")
		road = db.roads.find_one({"route_id": route_id})
		items.append({"road": road.get("road_name") if road else f"Route {route_id}", "count": d.get("count", 0)})
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
