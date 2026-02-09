from flask import Blueprint, jsonify, request
from pymongo import ASCENDING, TEXT

from db import get_db
from utils.ids import next_sequence, get_now_iso
from utils.rbac import role_required

roads_bp = Blueprint("roads", __name__)


@roads_bp.get("/")
@role_required(["admin", "surveyor", "viewer"])
def list_roads():
	"""
	List all roads
	---
	tags:
	  - Roads
	security:
	  - Bearer: []
	parameters:
	  - name: search
	    in: query
	    type: string
	    description: Search term for road name
	  - name: type
	    in: query
	    type: string
	    description: Filter by road type
	  - name: side
	    in: query
	    type: string
	    description: Filter by road side
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


@roads_bp.get("/<int:route_id>")
@role_required(["admin", "surveyor", "viewer"])
def get_road(route_id: int):
	"""
	Get details of a specific road
	---
	tags:
	  - Roads
	security:
	  - Bearer: []
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
	return jsonify({"item": road})


@roads_bp.post("/")
@role_required(["admin", "surveyor"])
def create_road():
	"""
	Create a new road
	---
	tags:
	  - Roads
	security:
	  - Bearer: []
	parameters:
	  - name: body
	    in: body
	    required: true
	    schema:
	      type: object
	      required:
	        - road_name
	        - estimated_distance_km
	        - road_type
	        - road_side
	      properties:
	        road_name:
	          type: string
	        start_point_name:
	          type: string
	        end_point_name:
	          type: string
	        estimated_distance_km:
	          type: number
	        road_type:
	          type: string
	        road_side:
	          type: string
	responses:
	  201:
	    description: Road created successfully
	  400:
	    description: Missing required fields
	"""
	body = request.get_json(silent=True) or {}
	required = ["road_name", "estimated_distance_km", "road_type", "road_side"]
	missing = [k for k in required if body.get(k) in (None, "")]
	if missing:
		return jsonify({"error": f"missing: {', '.join(missing)}"}), 400

	db = get_db()
	db.roads.create_index([("road_name", TEXT), ("start_point_name", TEXT), ("end_point_name", TEXT)], name="roads_text", default_language="english")
	route_id = next_sequence("route_id")
	doc = {
		"route_id": route_id,
		"road_name": body.get("road_name"),
		"start_point_name": body.get("start_point_name"),
		"start_lat": body.get("start_lat"),
		"start_lng": body.get("start_lng"),
		"end_point_name": body.get("end_point_name"),
		"end_lat": body.get("end_lat"),
		"end_lng": body.get("end_lng"),
		"estimated_distance_km": body.get("estimated_distance_km"),
		"road_type": body.get("road_type"),
		"road_side": body.get("road_side"),
		"created_at": get_now_iso(),
		"updated_at": get_now_iso(),
	}
	db.roads.insert_one(doc)
	doc["_id"] = str(doc["_id"])
	return jsonify({"item": doc}), 201


@roads_bp.put("/<int:route_id>")
@role_required(["admin", "surveyor"])
def update_road(route_id: int):
	"""
	Update a road
	---
	tags:
	  - Roads
	security:
	  - Bearer: []
	parameters:
	  - name: route_id
	    in: path
	    type: integer
	    required: true
	    description: The route ID of the road
	  - name: body
	    in: body
	    required: true
	    schema:
	      type: object
	responses:
	  200:
	    description: Road updated successfully
	  404:
	    description: Road not found
	"""
	body = request.get_json(silent=True) or {}
	db = get_db()
	res = db.roads.find_one_and_update({"route_id": route_id}, {"$set": {**body, "updated_at": get_now_iso()}})
	if not res:
		return jsonify({"error": "not found"}), 404
	return jsonify({"ok": True})


@roads_bp.delete("/<int:route_id>")
@role_required(["admin"])
def delete_road(route_id: int):
	"""
	Delete a road
	---
	tags:
	  - Roads
	security:
	  - Bearer: []
	parameters:
	  - name: route_id
	    in: path
	    type: integer
	    required: true
	    description: The route ID of the road
	responses:
	  200:
	    description: Road deleted successfully
	  404:
	    description: Road not found
	"""
	db = get_db()
	res = db.roads.delete_one({"route_id": route_id})
	if not res.deleted_count:
		return jsonify({"error": "not found"}), 404
	return jsonify({"ok": True})
