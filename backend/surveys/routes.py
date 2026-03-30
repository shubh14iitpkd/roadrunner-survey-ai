import os
from pathlib import Path
from flask import Blueprint, request
from bson import ObjectId
from pymongo import DESCENDING

from db import get_db
from utils.ids import get_now_iso, generate_survey_id
from utils.rbac import role_required
from utils.response import mongo_response
from utils.is_demo_video import is_demo, get_video_key

surveys_bp = Blueprint("surveys", __name__)

@surveys_bp.get("/")
@role_required(["super_admin", "admin", "surveyor", "viewer"])
def list_surveys():
    """
    List surveys
    ---
    tags:
      - Surveys
    security:
      - Bearer: []
    parameters:
      - name: route_id
        in: query
        type: integer
        description: Filter by route ID
      - name: status
        in: query
        type: string
        description: Filter by status
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

@surveys_bp.get("/<survey_id>")
@role_required(["super_admin","admin", "surveyor", "viewer"])
def get_survey(survey_id: str):
    """
    Get survey details
    ---
    tags:
      - Surveys
    security:
      - Bearer: []
    parameters:
      - name: survey_id
        in: path
        type: string
        required: true
        description: The ID of the survey
    responses:
      200:
        description: Survey details retrieved successfully
      404:
        description: Survey not found
    """
    db = get_db()
    s = db.surveys.find_one({"_id": ObjectId(survey_id)})
    if not s:
        return mongo_response({"error": "not found"}, 404)
    return mongo_response({"item": s})

@surveys_bp.post("/")
@role_required(["super_admin","admin", "surveyor"])
def create_survey():
    """
    Create a new survey
    ---
    tags:
      - Surveys
    security:
      - Bearer: []
    parameters:
      - name: body
        in: body
        required: true
        schema:
          type: object
          required:
            - route_id
            - survey_date
            - surveyor_name
          properties:
            route_id:
              type: integer
            survey_date:
              type: string
              format: date
            surveyor_name:
              type: string
            status:
              type: string
            totals:
              type: object
            gpx_file_url:
              type: string
    responses:
      201:
        description: Survey created successfully
      400:
        description: Missing required fields
    """
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
        "survey_display_id": generate_survey_id(db),
        "survey_version": survey_version,
        "is_latest": is_latest,
        "status": body.get("status", "uploaded"),
        "totals": body.get("totals", {"total_assets": 0, "good": 0, "damaged": 0}),
        "gpx_file_url": body.get("gpx_file_url"),
        "created_at": get_now_iso(),
        "updated_at": get_now_iso(),
    }
    res = db.surveys.insert_one(doc)
    doc["_id"] = res.inserted_id
    return mongo_response({"item": doc}, 201)

@surveys_bp.put("/<survey_id>")
@role_required(["super_admin", "admin", "surveyor"])
def update_survey(survey_id: str):
    """
    Update a survey
    ---
    tags:
      - Surveys
    security:
      - Bearer: []
    parameters:
      - name: survey_id
        in: path
        type: string
        required: true
        description: The ID of the survey
      - name: body
        in: body
        required: true
        schema:
          type: object
    responses:
      200:
        description: Survey updated successfully
      404:
        description: Survey not found
    """
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
@role_required(["super_admin","admin", "surveyor"])
def attach_gpx(survey_id: str):
    """
    Attach GPX file to a survey
    ---
    tags:
      - Surveys
    security:
      - Bearer: []
    parameters:
      - name: survey_id
        in: path
        type: string
        required: true
        description: The ID of the survey
      - name: body
        in: body
        required: true
        schema:
          type: object
          required:
            - gpx_file_url
          properties:
            gpx_file_url:
              type: string
    responses:
      200:
        description: GPX attached successfully
      400:
        description: Missing gpx_file_url
      404:
        description: Survey not found
    """
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
@role_required(["super_admin", "admin", "surveyor", "viewer"])
def get_survey_history(route_id: int):
    """
    Get all survey versions for a specific route
    ---
    tags:
      - Surveys
    security:
      - Bearer: []
    parameters:
      - name: route_id
        in: path
        type: integer
        required: true
        description: The ID of the route
    responses:
      200:
        description: Survey history retrieved successfully
        schema:
          type: object
          properties:
            items:
              type: array
            count:
              type: integer
            route_id:
              type: integer
    """
    """Get all survey versions for a specific route"""
    db = get_db()
    surveys = list(db.surveys.find({"route_id": route_id}).sort("survey_version", DESCENDING))
    return mongo_response({"items": surveys, "count": len(surveys), "route_id": route_id})

@surveys_bp.delete("/<survey_id>")
@role_required(["super_admin", "admin", "surveyor"])
def delete_survey(survey_id: str):
    """
    Delete a survey and all associated videos/frames
    ---
    tags:
      - Surveys
    security:
      - Bearer: []
    description: |
      Delete a survey and all associated videos/frames.
      For videos from video_library, only DB entries are deleted (files preserved).
      For uploaded videos, both DB entries and files are deleted.
    parameters:
      - name: survey_id
        in: path
        type: string
        required: true
        description: The ID of the survey
    responses:
      200:
        description: Survey deleted successfully
        schema:
          type: object
          properties:
            ok:
              type: boolean
            deleted_videos:
              type: integer
            deleted_files:
              type: integer
            preserved_library_files:
              type: integer
      404:
        description: Survey not found
    """
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
    reset_assets = 0       # demo video: good-marked assets reverted to damaged
    deleted_assets = 0     # real video: assets hard-deleted
    del_frames = 0

    for video in videos:
        video_id = video["_id"]
        storage_url = video.get("storage_url", "")
        
        # 3. Delete frames associated with this video
        db.frames.delete_many({"video_id": ObjectId(video_id)})
        
        # 4. Check if this video is a demo video
        demo_video = is_demo(video_file=video)

        # Real video: delete all associated assets from DB first
        del_res = db.assets.delete_many({"survey_id": ObjectId(survey_id)})
        del_f = db.frames.delete_many({"survey_id": ObjectId(survey_id)})
        deleted_assets += del_res.deleted_count
        del_frames += del_f.deleted_count

        # Check if video is from library (preserve library files)

        is_library_video = "video_library" in storage_url if storage_url else False

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

    # 5b. Clean up master_assets linked to this survey
    master_assets_deleted = 0
    master_assets_updated = 0
    try:
        survey_oid = ObjectId(survey_id)

        # Pull all survey_history entries that belong to this survey
        db.master_assets.update_many(
            {"survey_history.survey_id": survey_oid},
            {"$pull": {"survey_history": {"survey_id": survey_oid}}},
        )

        # Delete master_assets that now have an empty survey_history
        del_masters = db.master_assets.delete_many({"survey_history": {"$size": 0}})
        master_assets_deleted = del_masters.deleted_count

        # For surviving master_assets that were affected, re-derive denormalised fields
        # from the new latest (last) entry in survey_history
        affected = list(db.master_assets.find(
            {"latest_survey_id": survey_oid},
            {"_id": 1, "survey_history": {"$slice": -1}},
        ))
        for ma in affected:
            history = ma.get("survey_history", [])
            if history:
                last = history[-1]
                db.master_assets.update_one(
                    {"_id": ma["_id"]},
                    {
                        "$set": {
                            "latest_condition": last.get("condition"),
                            "latest_survey_id": last.get("survey_id"),
                            "latest_survey_display_id": last.get("survey_display_id"),
                            "latest_confidence": last.get("confidence"),
                            "last_seen_date": last.get("survey_date"),
                            "issue": None if last.get("condition") == "good"
                                     else last.get("condition"),
                            "updated_at": get_now_iso(),
                        },
                        "$inc": {"total_surveys_detected": -1},
                    },
                )
                master_assets_updated += 1
        print(f"[DELETE] Master assets: {master_assets_deleted} deleted, {master_assets_updated} updated")
    except Exception as e:
        print(f"[DELETE] Warning: master_assets cleanup failed: {e}")
    
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
        "preserved_library_files": len(preserved_files),
        "reset_good_assets": reset_assets,
        "deleted_assets": deleted_assets,
        "deleted_frames": del_frames,
        "master_assets_deleted": master_assets_deleted,
        "master_assets_updated": master_assets_updated,
    })


