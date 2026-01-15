import os
from pathlib import Path
from flask import Blueprint, request
from bson import ObjectId
from pymongo import DESCENDING

from db import get_db
from utils.ids import get_now_iso
from utils.rbac import role_required
from utils.response import mongo_response

surveys_bp = Blueprint("surveys", __name__)

@surveys_bp.get("/")
@role_required(["admin", "surveyor", "viewer"])
def list_surveys():
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

@surveys_bp.get("/<survey_id>")
@role_required(["admin", "surveyor", "viewer"])
def get_survey(survey_id: str):
    db = get_db()
    s = db.surveys.find_one({"_id": ObjectId(survey_id)})
    if not s:
        return mongo_response({"error": "not found"}, 404)
    return mongo_response({"item": s})

@surveys_bp.post("/")
@role_required(["admin", "surveyor"])
def create_survey():
    body = request.get_json(silent=True) or {}
    required = ["route_id", "survey_date", "surveyor_name"]
    missing = [k for k in required if body.get(k) in (None, "")]
    if missing:
        return mongo_response({"error": f"missing: {', '.join(missing)}"}, 400)

    db = get_db()
    route_id = int(body["route_id"])
    road = db.roads.find_one({"route_id": route_id})

    # Calculate survey version for this route
    # Find the latest version for this route_id
    latest_survey = db.surveys.find_one(
        {"route_id": route_id},
        sort=[("survey_version", DESCENDING)]
    )
    survey_version = (latest_survey.get("survey_version", 0) + 1) if latest_survey else 1

    # Mark this as the latest version
    is_latest = True

    # Mark all previous surveys for this route as not latest
    db.surveys.update_many(
        {"route_id": route_id},
        {"$set": {"is_latest": False}}
    )

    doc = {
        "route_id": route_id,
        "road_id": str(road.get("_id")) if road and road.get("_id") is not None else None,
        "survey_date": body["survey_date"],
        "surveyor_name": body["surveyor_name"],
        "survey_version": survey_version,
        "is_latest": is_latest,
        "status": body.get("status", "uploaded"),
        "totals": body.get("totals", {"total_assets": 0, "good": 0, "fair": 0, "poor": 0}),
        "gpx_file_url": body.get("gpx_file_url"),
        "created_at": get_now_iso(),
        "updated_at": get_now_iso(),
    }
    res = db.surveys.insert_one(doc)
    doc["_id"] = res.inserted_id
    return mongo_response({"item": doc}, 201)

@surveys_bp.put("/<survey_id>")
@role_required(["admin", "surveyor"])
def update_survey(survey_id: str):
    body = request.get_json(silent=True) or {}
    db = get_db()
    res = db.surveys.find_one_and_update(
        {"_id": ObjectId(survey_id)},
        {"$set": {**body, "updated_at": get_now_iso()}}
    )
    if not res:
        return mongo_response({"error": "not found"}, 404)
    return mongo_response({"ok": True})

@surveys_bp.post("/<survey_id>/attach-gpx")
@role_required(["admin", "surveyor"])
def attach_gpx(survey_id: str):
    body = request.get_json(silent=True) or {}
    url = body.get("gpx_file_url")
    if not url:
        return mongo_response({"error": "gpx_file_url required"}, 400)

    db = get_db()
    res = db.surveys.find_one_and_update(
        {"_id": ObjectId(survey_id)},
        {"$set": {"gpx_file_url": url, "updated_at": get_now_iso()}}
    )
    if not res:
        return mongo_response({"error": "not found"}, 404)
    return mongo_response({"ok": True})

@surveys_bp.get("/route/<int:route_id>/history")
@role_required(["admin", "surveyor", "viewer"])
def get_survey_history(route_id: int):
    """Get all survey versions for a specific route"""
    db = get_db()
    surveys = list(db.surveys.find({"route_id": route_id}).sort("survey_version", DESCENDING))
    return mongo_response({"items": surveys, "count": len(surveys), "route_id": route_id})

@surveys_bp.delete("/<survey_id>")
@role_required(["admin", "surveyor"])
def delete_survey(survey_id: str):
    """Delete a survey and all associated videos/frames.
    
    For videos from video_library, only DB entries are deleted (files preserved).
    For uploaded videos, both DB entries and files are deleted.
    """
    db = get_db()
    
    # 1. Find the survey first
    survey = db.surveys.find_one({"_id": ObjectId(survey_id)})
    if not survey:
        return mongo_response({"error": "Survey not found"}, 404)
    
    route_id = survey.get("route_id")
    upload_root = Path(os.getenv("UPLOAD_DIR", Path(__file__).resolve().parents[1] / "uploads"))
    
    # 2. Find all videos for this survey
    videos = list(db.videos.find({"survey_id": ObjectId(survey_id)}))
    
    deleted_files = []
    preserved_files = []
    
    for video in videos:
        video_id = video["_id"]
        storage_url = video.get("storage_url", "")
        
        # 3. Delete frames associated with this video
        db.frames.delete_many({"video_id": ObjectId(video_id)})
        
        # 4. Check if video is from library (preserve library files)
        is_library_video = "video_library" in storage_url
        
        if not is_library_video and storage_url:
            # Delete the actual video file
            # storage_url is like /uploads/filename.mp4
            relative_path = storage_url.lstrip("/")
            if relative_path.startswith("uploads/"):
                relative_path = relative_path[8:]  # Remove 'uploads/' prefix
            file_path = upload_root / relative_path
            
            if file_path.exists():
                try:
                    file_path.unlink()
                    deleted_files.append(str(file_path))
                except Exception as e:
                    print(f"[DELETE] Failed to delete file {file_path}: {e}")
            
            # Also try to delete thumbnail if exists
            thumb_url = video.get("thumbnail_url", "")
            if thumb_url:
                thumb_rel = thumb_url.lstrip("/")
                if thumb_rel.startswith("uploads/"):
                    thumb_rel = thumb_rel[8:]
                thumb_path = upload_root / thumb_rel
                if thumb_path.exists():
                    try:
                        thumb_path.unlink()
                    except Exception:
                        pass
            
            # Delete GPX file if exists
            gpx_url = video.get("gpx_file_url", "")
            if gpx_url:
                gpx_rel = gpx_url.lstrip("/")
                if gpx_rel.startswith("uploads/"):
                    gpx_rel = gpx_rel[8:]
                gpx_path = upload_root / gpx_rel
                if gpx_path.exists():
                    try:
                        gpx_path.unlink()
                    except Exception:
                        pass
        else:
            preserved_files.append(storage_url)
    
    # 5. Delete all videos from DB
    videos_deleted = db.videos.delete_many({"survey_id": ObjectId(survey_id)})
    
    # 6. Delete the survey
    db.surveys.delete_one({"_id": ObjectId(survey_id)})
    
    # 7. Update is_latest flag for remaining surveys on this route
    if route_id:
        # Find the most recent survey for this route and mark it as latest
        latest = db.surveys.find_one(
            {"route_id": route_id},
            sort=[("survey_date", DESCENDING)]
        )
        if latest:
            db.surveys.update_one(
                {"_id": latest["_id"]},
                {"$set": {"is_latest": True}}
            )
    
    return mongo_response({
        "ok": True,
        "deleted_videos": videos_deleted.deleted_count,
        "deleted_files": len(deleted_files),
        "preserved_library_files": len(preserved_files)
    })
