"""Frame Management Routes"""

from flask import Blueprint, jsonify, request, Response
from bson import ObjectId, json_util
from db import get_db
from utils.rbac import role_required

frames_bp = Blueprint("frames", __name__)


@frames_bp.get("/")
@role_required(["admin", "surveyor", "viewer"])
def list_frames():
    """
    List frames with optional filters.
    Query parameters:
    - video_id: Filter by video
    - survey_id: Filter by survey
    - route_id: Filter by route
    - has_detections: Boolean, frames with detections only
    - limit: Number of results (default: 100)
    - offset: Pagination offset (default: 0)
    """
    db = get_db()

    # Build query from parameters
    query = {}

    video_id = request.args.get("video_id")
    if video_id:
        query["video_id"] = video_id

    survey_id = request.args.get("survey_id")
    if survey_id:
        query["survey_id"] = survey_id

    route_id = request.args.get("route_id", type=int)
    if route_id is not None:
        query["route_id"] = route_id

    has_detections = request.args.get("has_detections", type=bool)
    if has_detections:
        query["detections_count"] = {"$gt": 0}

    # Pagination
    limit = request.args.get("limit", type=int, default=100)
    offset = request.args.get("offset", type=int, default=0)

    # Execute query
    cursor = db.frames.find(query).sort("frame_number", 1).skip(offset).limit(limit)
    frames = list(cursor)

    total = db.frames.count_documents(query)

    # Use bson.json_util to handle ObjectId serialization
    return Response(
        json_util.dumps({
            "items": frames,
            "total": total,
            "limit": limit,
            "offset": offset
        }),
        mimetype="application/json"
    ), 200


@frames_bp.get("/<frame_id>")
@role_required(["admin", "surveyor", "viewer"])
def get_frame(frame_id: str):
    """Get a specific frame by ID."""
    db = get_db()

    try:
        frame = db.frames.find_one({"_id": ObjectId(frame_id)})
        if not frame:
            return jsonify({"error": "Frame not found"}), 404

        return Response(
            json_util.dumps(frame),
            mimetype="application/json"
        ), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 400


@frames_bp.get("/video/<video_id>")
@role_required(["admin", "surveyor", "viewer"])
def get_video_frames(video_id: str):
    """Get all frames for a specific video."""
    db = get_db()

    frames = list(db.frames.find({"video_id": video_id}).sort("frame_number", 1))

    return Response(
        json_util.dumps({
            "video_id": video_id,
            "frames": frames,
            "total": len(frames)
        }),
        mimetype="application/json"
    ), 200


@frames_bp.get("/route/<int:route_id>")
@role_required(["admin", "surveyor", "viewer"])
def get_route_frames(route_id: int):
    """Get all frames for a specific route."""
    db = get_db()

    limit = request.args.get("limit", type=int, default=100)
    offset = request.args.get("offset", type=int, default=0)

    frames = list(db.frames.find({"route_id": route_id}).sort("timestamp", 1).skip(offset).limit(limit))
    total = db.frames.count_documents({"route_id": route_id})

    return Response(
        json_util.dumps({
            "route_id": route_id,
            "items": frames,
            "total": total,
            "limit": limit,
            "offset": offset
        }),
        mimetype="application/json"
    ), 200


@frames_bp.get("/with-detections")
@role_required(["admin", "surveyor", "viewer"])
def get_frames_with_detections():
    """Get frames that have detections."""
    db = get_db()

    route_id = request.args.get("route_id", type=int)
    video_id = request.args.get("video_id")
    limit = request.args.get("limit", type=int, default=50)

    query = {"detections_count": {"$gt": 0}}
    if route_id is not None:
        query["route_id"] = route_id
    if video_id:
        query["video_id"] = video_id

    frames = list(db.frames.find(query).sort("detections_count", -1).limit(limit))

    return Response(
        json_util.dumps({
            "items": frames,
            "total": len(frames)
        }),
        mimetype="application/json"
    ), 200


@frames_bp.get("/stats/video/<video_id>")
@role_required(["admin", "surveyor", "viewer"])
def get_video_frame_stats(video_id: str):
    """Get statistics about frames for a video."""
    db = get_db()

    pipeline = [
        {"$match": {"video_id": video_id}},
        {
            "$group": {
                "_id": None,
                "total_frames": {"$sum": 1},
                "frames_with_detections": {
                    "$sum": {"$cond": [{"$gt": ["$detections_count", 0]}, 1, 0]}
                },
                "total_detections": {"$sum": "$detections_count"},
                "avg_detections_per_frame": {"$avg": "$detections_count"}
            }
        }
    ]

    result = list(db.frames.aggregate(pipeline))
    if not result:
        return jsonify({
            "video_id": video_id,
            "total_frames": 0,
            "frames_with_detections": 0,
            "total_detections": 0,
            "avg_detections_per_frame": 0
        }), 200

    stats = result[0]
    stats.pop("_id", None)
    stats["video_id"] = video_id

    return jsonify(stats), 200
