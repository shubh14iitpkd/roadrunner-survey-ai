from services.local_processor import LocalVideoProcessor
import pymongo
import os
import shutil
import threading
import time
from datetime import datetime
import base64
from pathlib import Path
from werkzeug.utils import secure_filename
from flask import Blueprint, jsonify, request, Response, send_file, current_app
from bson import ObjectId, json_util
from pymongo import DESCENDING
import cv2
import io
from PIL import Image
from flask_jwt_extended import jwt_required
from flasgger import swag_from

from db import get_db, get_client
from utils.ids import get_now_iso
from utils.rbac import role_required
from utils.extract_gpx import extract_gpx
from utils.is_demo_video import DEMO_VIDEOS
from services.job_queue import job_queue

videos_bp = Blueprint("videos", __name__)
from config import Config

config = Config()

# ── Anonymization helpers ─────────────────────────────────────────────────────

_anonymization_service = None
_anonymization_lock = threading.Lock()


def _get_anonymizer():
    global _anonymization_service
    if _anonymization_service is None:
        with _anonymization_lock:
            if _anonymization_service is None:
                try:
                    from services.anonymization_service import AnonymizationService
                    _anonymization_service = AnonymizationService()
                except Exception as e:
                    print(f"[ANON] Failed to initialize AnonymizationService: {e}")
                    return None
    return _anonymization_service


def _run_local_anonymization(app, video_id: str, save_path: Path, upload_root: Path):
    """
    Background task for upload_direct:
    Anonymizes the video, replaces the original with the anonymized copy,
    then sets status → 'uploaded'.
    """
    with app.app_context():
        db = get_client(app)[app.config["MONGO_DB_NAME"]]

        # Mark as actively anonymizing now that this job has been picked up
        db.videos.update_one(
            {"_id": ObjectId(video_id)},
            {"$set": {"status": "anonymizing", "updated_at": get_now_iso()}},
        )

        last_pct = [-1]  # mutable cell so the closure can update it

        def _progress(pct: int, _msg: str):
            if pct != last_pct[0]:
                last_pct[0] = pct
                db.videos.update_one(
                    {"_id": ObjectId(video_id)},
                    {"$set": {"progress": pct, "updated_at": get_now_iso()}},
                )

        try:
            svc = _get_anonymizer()
            if svc is None:
                raise RuntimeError("AnonymizationService unavailable")
            anon_path = svc.process_video(
                video_path=save_path,
                upload_dir=upload_root,
                upload_type="local",
                progress_callback=_progress,
            )
            # Replace original with anonymized file (storage_url stays the same)
            shutil.move(str(anon_path), str(save_path))
            print(f"[ANON] local anonymization done for video {video_id}")
        except Exception as e:
            print(f"[ANON] local anonymization failed for video {video_id}: {e}")
            # Don't block the user — fall through to mark uploaded anyway
        finally:
            db.videos.find_one_and_update(
                {"_id": ObjectId(video_id)},
                {"$set": {"status": "uploaded", "progress": 100, "updated_at": get_now_iso()}},
            )


def _run_library_anonymization(app, video_id: str, full_path: Path, upload_root: Path):
    """
    Background task for upload_library_video:
    Anonymizes the video into anonymized/video_library/, updates storage_url,
    then sets status → 'uploaded'. Never deletes the original.
    """
    with app.app_context():
        db = get_client(app)[app.config["MONGO_DB_NAME"]]

        # Mark as actively anonymizing now that this job has been picked up
        db.videos.update_one(
            {"_id": ObjectId(video_id)},
            {"$set": {"status": "anonymizing", "updated_at": get_now_iso()}},
        )

        last_pct = [-1]

        def _progress(pct: int, _msg: str):
            if pct != last_pct[0]:
                last_pct[0] = pct
                db.videos.update_one(
                    {"_id": ObjectId(video_id)},
                    {"$set": {"progress": pct, "updated_at": get_now_iso()}},
                )

        try:
            # checking if blurred video already exists
            anon_dir = upload_root / "anonymized" / "video_library"
            video_name = full_path.stem
            matches = list(anon_dir.glob(f"*{video_name}_blurred.*"))
            if matches:
                print(f"[ANON] Blurred video already exists for {video_id}")
                anon_path = matches[0]
                for i in range(1, 100, 5):
                    _progress(i, "")
                    time.sleep(0.8)
            else:
                svc = _get_anonymizer()
                if svc is None:
                    raise RuntimeError("AnonymizationService unavailable")
                anon_path = svc.process_video(
                    video_path=full_path,
                    upload_dir=upload_root,
                    upload_type="video_library",
                    progress_callback=_progress,
                )
            rel = anon_path.relative_to(upload_root)
            new_storage_url = f"/uploads/{rel}"
            db.videos.find_one_and_update(
                {"_id": ObjectId(video_id)},
                {"$set": {
                    "status": "uploaded",
                    "storage_url": new_storage_url,
                    "progress": 100,
                    "updated_at": get_now_iso(),
                }},
            )
            print(f"[ANON] library anonymization done for video {video_id}, url={new_storage_url}")
        except Exception as e:
            print(f"[ANON] library anonymization failed for video {video_id}: {e}")
            db.videos.find_one_and_update(
                {"_id": ObjectId(video_id)},
                {"$set": {"status": "uploaded", "progress": 100, "updated_at": get_now_iso()}},
            )


# ── Job queue handlers ────────────────────────────────────────────────────────
# These are registered with job_queue in app.py and called by the queue worker.

def _handle_anonymization_job(app, video_id: str, payload: dict):
    """Queue handler: dispatch to local or library anonymization."""
    upload_type = payload["upload_type"]
    video_path = Path(payload["video_path"])
    upload_root = Path(payload["upload_root"])
    if upload_type == "local":
        _run_local_anonymization(app, video_id, video_path, upload_root)
    else:
        _run_library_anonymization(app, video_id, video_path, upload_root)


def _handle_ai_processing_job(app, video_id: str, payload: dict):
    """Queue handler: dispatch to demo or real AI processing."""
    if payload.get("is_demo", False):
        _run_demo_ai_processing(app, video_id, payload)
    else:
        _run_real_ai_processing(app, video_id, payload)


def _handle_asset_linking_job(app, video_id: str, payload: dict):
    """Queue handler: run asset linking and mark video completed."""
    _run_asset_linking(app, video_id, payload)


def _run_real_ai_processing(app, video_id: str, payload: dict):
    """
    Extracted module-level version of the former process_in_background closure.
    Runs YOLO inference, then enqueues an asset_linking job.
    """
    import traceback as _tb
    from pymongo import MongoClient

    storage_url = payload["storage_url"]
    gpx_file_url = payload.get("gpx_file_url")
    route_id = payload.get("route_id")
    survey_id = payload.get("survey_id")
    upload_root = Path(payload["upload_root"])

    storage_filename = storage_url.lstrip("/uploads/").lstrip("/")
    video_path = upload_root / storage_filename

    with app.app_context():
        mongo_client = MongoClient(app.config["MONGO_URI"])
        mongo_db = mongo_client[app.config["MONGO_DB_NAME"]]

        try:
            mongo_db.videos.update_one(
                {"_id": ObjectId(video_id)},
                {"$set": {"status": "processing", "progress": 0, "updated_at": get_now_iso()}},
            )

            print(f"[PROCESS] Video path: {video_path}, exists: {video_path.exists()}")

            if not video_path.exists():
                raise FileNotFoundError(f"Source video not found at: {video_path}")

            print(f"[PROCESS] Starting local processing for video {video_id}")

            processor = LocalVideoProcessor()

            def update_progress(progress: int, message: str):
                mongo_db.videos.update_one(
                    {"_id": ObjectId(video_id)},
                    {"$set": {"progress": progress, "updated_at": get_now_iso()}},
                )
                print(f"[PROCESS] {message} ({progress}%)")

            gpx_path = upload_root / gpx_file_url.lstrip("/uploads/") if gpx_file_url else None
            result = processor.process_video(
                video_path=video_path,
                output_dir=upload_root,
                video_id=video_id,
                route_id=route_id,
                survey_id=survey_id,
                gpx_path=gpx_path,
                db=mongo_db,
                progress_callback=update_progress,
            )

            print(f"[PROCESS] YOLO complete: {result}")

            mongo_db.videos.update_one(
                {"_id": ObjectId(video_id)},
                {
                    "$set": {
                        "status": "asset_linking",
                        "progress": 100,
                        "total_detections": result.get("total_detections", 0),
                        "detections_summary": result.get("detections_summary", {}),
                        "processed_frames": result.get("processed_frames", 0),
                        "updated_at": get_now_iso(),
                    }
                },
            )

            # Enqueue asset linking as a separate, independently-rate-limited job
            job_queue.enqueue("asset_linking", video_id, {
                "survey_id": str(survey_id) if survey_id else None,
                "route_id": route_id,
                "video_path": str(video_path),
            })

        except Exception as e:
            print(f"[PROCESS] Error processing video {video_id}: {e}")
            _tb.print_exc()
            mongo_db.videos.update_one(
                {"_id": ObjectId(video_id)},
                {"$set": {"status": "failed", "error": str(e), "updated_at": get_now_iso()}},
            )


def _run_demo_ai_processing(app, video_id: str, payload: dict):
    """
    Extracted module-level version of the former process_demo_in_background closure.
    Simulates processing progress, then enqueues an asset_linking job.
    """
    import time
    import traceback as _tb
    from pymongo import MongoClient

    up = Path("/uploads")
    storage_url = payload["storage_url"]
    survey_id = payload.get("survey_id")
    route_id = payload.get("route_id")
    upload_root = Path(payload["upload_root"])
    filename_no_ext = payload["filename_no_ext"]
    demo_matches = [Path(p) for p in payload.get("demo_matches", [])]
    print(f"[DEMO ASSET LINKING] path of video {storage_url}")
    storage_filename = storage_url.lstrip("/uploads/").lstrip("/")
    video_path = upload_root / Path(storage_url).relative_to(up)

    known_categories = [
        "oia", "corridor_pavement", "corridor_structure",
        "directional_signage", "its", "roadway_lighting",
    ]

    with app.app_context():
        mongo_client = MongoClient(app.config["MONGO_URI"])
        mongo_db = mongo_client[app.config["MONGO_DB_NAME"]]

        try:
            mongo_db.videos.update_one(
                {"_id": ObjectId(video_id)},
                {"$set": {"status": "processing", "progress": 0, "updated_at": get_now_iso()}},
            )

            # Simulate inference progress
            for i in range(1, 101, 10):
                time.sleep(2.3)
                print(f"[PROCESS] Demo progress {i}%")
                mongo_db.videos.update_one(
                    {"_id": ObjectId(video_id)},
                    {"$set": {"progress": i, "updated_at": get_now_iso()}},
                )

            # Build category → annotated video URL map
            category_videos = {}
            for match in demo_matches:
                found_cat = "default"
                for cat in known_categories:
                    if match.name.startswith(cat):
                        found_cat = cat
                        break
                rel_path = match.relative_to(upload_root)
                category_videos[found_cat] = f"/uploads/{rel_path}"

            mongo_db.videos.update_one(
                {"_id": ObjectId(video_id)},
                {
                    "$set": {
                        "status": "asset_linking",
                        "progress": 100,
                        "category_videos": category_videos,
                        "updated_at": get_now_iso(),
                    }
                },
            )
            print(f"[PROCESS] Demo processing complete for {video_id}")

            # Demo-specific: aggregate pre-computed asset counts for the survey
            try:
                if filename_no_ext:
                    pipeline = [
                        {"$match": {"video_key": filename_no_ext}},
                        {"$group": {
                            "_id": None,
                            "total_assets": {"$sum": 1},
                            "good": {"$sum": {"$cond": [{"$eq": ["$condition", "good"]}, 1, 0]}},
                            "damaged": {"$sum": {"$cond": [{"$eq": ["$condition", "damaged"]}, 1, 0]}}
                        }}
                    ]
                    agg_res = list(mongo_db.assets.aggregate(pipeline))
                    totals = {"total_assets": 0, "good": 0, "damaged": 0}
                    if agg_res:
                        r = agg_res[0]
                        totals["total_assets"] = r.get("total_assets", 0)
                        totals["good"] = r.get("good", 0)
                        totals["damaged"] = r.get("damaged", 0)
                    if survey_id:
                        mongo_db.surveys.update_one(
                            {"_id": ObjectId(survey_id)},
                            {"$set": {"totals": totals, "status": "processed"}}
                        )
            except Exception as agge:
                print(f"[PROCESS] Error calculating demo aggregates: {agge}")

            # Enqueue asset linking as a separate, independently-rate-limited job
            print(f"[DEMO ASSET LINKING] Enqueuing asset linking for video {video_path}")
            job_queue.enqueue("asset_linking", video_id, {
                "survey_id": str(survey_id) if survey_id else None,
                "route_id": route_id,
                "video_path": str(video_path),
                "filename_no_ext": filename_no_ext,
            })

        except Exception as e:
            print(f"[PROCESS] Error in demo processing for {video_id}: {e}")
            _tb.print_exc()


def _run_asset_linking(app, video_id: str, payload: dict):
    """
    Extracted module-level asset linking handler.
    Runs link_assets_for_video and marks the video completed.
    """
    import traceback as _tb
    from pymongo import MongoClient
    from services.asset_linker import link_assets_for_video

    survey_id = payload.get("survey_id")
    route_id = payload.get("route_id")
    video_path_str = payload.get("video_path")

    with app.app_context():
        mongo_client = MongoClient(app.config["MONGO_URI"])
        mongo_db = mongo_client[app.config["MONGO_DB_NAME"]]

        try:
            survey_doc = None
            if survey_id:
                survey_doc = mongo_db.surveys.find_one(
                    {"_id": ObjectId(survey_id)},
                    {"survey_display_id": 1, "survey_date": 1},
                )
            survey_display_id_str = survey_doc.get("survey_display_id") if survey_doc else None
            survey_date_val = survey_doc.get("survey_date") if survey_doc else None

            linker_summary = link_assets_for_video(
                db=mongo_db,
                video_id=video_id,
                survey_id=survey_id,
                survey_display_id=survey_display_id_str,
                route_id=route_id,
                survey_date=survey_date_val,
                video_path=Path(video_path_str) if video_path_str else None,
            )
            print(f"[QUEUE] Asset linking complete for video {video_id}: {linker_summary}")
        except Exception as link_err:
            print(f"[QUEUE] Warning: asset linking failed for video {video_id}: {link_err}")
            _tb.print_exc()

        # Always mark completed — linking failure is non-fatal
        mongo_db.videos.update_one(
            {"_id": ObjectId(video_id)},
            {"$set": {"status": "completed", "updated_at": get_now_iso()}},
        )
        if survey_id:
            mongo_db.surveys.update_one(
                {"_id": ObjectId(survey_id)},
                {"$set": {"status": "processed", "updated_at": get_now_iso()}},
            )


@videos_bp.get("/")
@role_required(["super_admin","admin", "surveyor", "viewer"])
def list_videos():
    """
    List all videos
    ---
    tags:
      - Videos
    security:
      - Bearer: []
    parameters:
      - name: route_id
        in: query
        type: integer
        description: Filter by route ID
      - name: survey_id
        in: query
        type: string
        description: Filter by survey ID
      - name: status
        in: query
        type: string
        description: Filter by video status
    responses:
      200:
        description: List of videos retrieved successfully
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
    survey_id = request.args.get("survey_id")
    status = request.args.get("status")

    if route_id is not None:
        query["route_id"] = route_id
    if survey_id:
        query["survey_id"] = ObjectId(survey_id)
    if status:
        query["status"] = status

    db = get_db()
    items = list(db.videos.find(query).sort("created_at", DESCENDING))

    # Use bson.json_util to safely handle ObjectId, datetime, etc.
    return Response(
        json_util.dumps({"items": items, "count": len(items)}),
        mimetype="application/json",
    )


@videos_bp.get("/<video_id>")
@role_required(["super_admin", "admin", "surveyor", "viewer"])
def get_video(video_id: str):
    """
    Get a specific video by ID
    ---
    tags:
      - Videos
    security:
      - Bearer: []
    parameters:
      - name: video_id
        in: path
        type: string
        required: true
        description: The ID of the video
    responses:
      200:
        description: Video details retrieved successfully
      404:
        description: Video not found
      400:
        description: Invalid video ID format
    """
    db = get_db()

    try:
        video = db.videos.find_one({"_id": ObjectId(video_id)})
        if not video:
            print(f"[VIDEO] Video not found in DB: {video_id}")
            return jsonify({"error": "Video not found"}), 404

        return Response(json_util.dumps(video), mimetype="application/json")
    except Exception as e:
        print(f"[VIDEO] Error retrieving video {video_id}: {e}")
        return jsonify({"error": f"Invalid video ID format: {str(e)}"}), 400


@videos_bp.post("/")
@role_required(["super_admin","admin", "surveyor"])
def create_video():
    """
    Create a new video entry
    ---
    tags:
      - Videos
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
            - title
          properties:
            route_id:
              type: integer
            title:
              type: string
            survey_id:
              type: string
            storage_url:
              type: string
            thumbnail_url:
              type: string
            gpx_file_url:
              type: string
            size_bytes:
              type: integer
            duration_seconds:
              type: number
            status:
              type: string
            progress:
              type: number
            eta:
              type: string
    responses:
      201:
        description: Video created successfully
      400:
        description: Missing required fields
    """
    body = request.get_json(silent=True) or {}
    required = ["route_id", "title"]
    missing = [k for k in required if body.get(k) in (None, "")]
    if missing:
        return jsonify({"error": f"missing: {', '.join(missing)}"}), 400

    db = get_db()

    # Handle survey_id - create a temporary one if not provided or invalid
    survey_id_value = body.get("survey_id")
    if survey_id_value:
        # Check if it's a valid ObjectId format
        try:
            if isinstance(survey_id_value, dict) and "$oid" in survey_id_value:
                survey_id_value = survey_id_value["$oid"]
            survey_id = ObjectId(survey_id_value)
        except:
            # Invalid ObjectId, create a temporary survey
            temp_survey = {
                "name": f"Temp Survey - {body['title']}",
                "route_id": int(body["route_id"]),
                "date": get_now_iso(),
                "status": "draft",
                "created_at": get_now_iso(),
                "updated_at": get_now_iso(),
            }
            survey_res = db.surveys.insert_one(temp_survey)
            survey_id = survey_res.inserted_id
    else:
        # No survey_id provided, create a temporary one
        temp_survey = {
            "name": f"Temp Survey - {body['title']}",
            "route_id": int(body["route_id"]),
            "date": get_now_iso(),
            "status": "draft",
            "created_at": get_now_iso(),
            "updated_at": get_now_iso(),
        }
        survey_res = db.surveys.insert_one(temp_survey)
        survey_id = survey_res.inserted_id

    # Look up survey_display_id from the survey
    survey_display_id = None
    survey_doc = db.surveys.find_one({"_id": survey_id}, {"survey_display_id": 1})
    if survey_doc:
        survey_display_id = survey_doc.get("survey_display_id")

    doc = {
        "survey_id": survey_id,
        "survey_display_id": survey_display_id,
        "route_id": int(body["route_id"]),
        "title": body["title"],
        "storage_url": body.get("storage_url"),
        "thumbnail_url": body.get("thumbnail_url"),
        "gpx_file_url": body.get("gpx_file_url"),
        "size_bytes": body.get("size_bytes"),
        "duration_seconds": body.get("duration_seconds", 0),
        "status": body.get("status", "queue"),
        "progress": body.get("progress", 0),
        "eta": body.get("eta"),
        "created_at": get_now_iso(),
        "updated_at": get_now_iso(),
    }

    res = db.videos.insert_one(doc)
    doc["_id"] = str(res.inserted_id)
    doc["survey_id"] = str(doc["survey_id"])

    return jsonify({"video": doc}), 201


@videos_bp.put("/<video_id>/status")
@role_required(["super_admin","admin", "surveyor"])
def update_status(video_id: str):
    """
    Update video status
    ---
    tags:
      - Videos
    security:
      - Bearer: []
    parameters:
      - name: video_id
        in: path
        type: string
        required: true
        description: The ID of the video
      - name: body
        in: body
        required: true
        schema:
          type: object
          properties:
            status:
              type: string
            progress:
              type: number
            eta:
              type: string
            storage_url:
              type: string
            thumbnail_url:
              type: string
    responses:
      200:
        description: Status updated successfully
      400:
        description: No valid fields provided
      404:
        description: Video not found
    """
    body = request.get_json(silent=True) or {}
    allowed = {"status", "progress", "eta", "storage_url", "thumbnail_url"}
    update = {k: v for k, v in body.items() if k in allowed}

    if not update:
        return jsonify({"error": "no fields"}), 400

    update["updated_at"] = get_now_iso()
    db = get_db()
    res = db.videos.find_one_and_update({"_id": ObjectId(video_id)}, {"$set": update})
    if not res:
        return jsonify({"error": "not found"}), 404

    return jsonify({"ok": True})


@videos_bp.post("/upload")
@jwt_required()
def upload_direct():
    """
    Direct video upload
    ---
    tags:
      - Videos
    security:
      - Bearer: []
    consumes:
      - multipart/form-data
    parameters:
      - name: file
        in: formData
        type: file
        required: true
        description: The video file to upload
      - name: video_id
        in: formData
        type: string
        description: Optional video ID to update existing record
      - name: survey_id
        in: formData
        type: string
        description: Survey ID (required if creating new video)
      - name: route_id
        in: formData
        type: integer
        description: Route ID (required if creating new video)
      - name: title
        in: formData
        type: string
        description: Video title
    responses:
      200:
        description: Video uploaded successfully (updated existing)
      201:
        description: Video uploaded successfully (created new)
      400:
        description: Missing file or required fields
      404:
        description: Video ID not found
      500:
        description: Upload failed
    """
    # Expect multipart form with fields: video_id (optional), survey_id, route_id, title, file
    print(f"[UPLOAD] Upload request received")
    print(f"[UPLOAD] Files: {list(request.files.keys())}")
    print(f"[UPLOAD] Form data: {list(request.form.keys())}")

    if "file" not in request.files:
        return jsonify({"error": "file is required", "gpx_created": False}), 400
    file = request.files["file"]
    if not file or file.filename == "":
        return jsonify({"error": "empty file", "gpx_created": False}), 400

    db = get_db()
    video_id = request.form.get("video_id")

    # If video_id provided, update status to uploading FIRST
    if video_id:
        result = db.videos.find_one_and_update(
            {"_id": ObjectId(video_id)},
            {
                "$set": {
                    "status": "uploading",
                    "progress": 0,
                    "updated_at": get_now_iso(),
                }
            },
        )
        if not result:
            return jsonify({"error": "video_id not found", "gpx_created": False}), 404

    upload_root = Path(
        os.getenv("UPLOAD_DIR", Path(__file__).resolve().parents[1] / "uploads")
    )
    upload_root.mkdir(parents=True, exist_ok=True)
    filename = secure_filename(file.filename)
    save_path = upload_root / filename
    # Avoid overwrite by appending number if exists
    counter = 1
    base, ext = os.path.splitext(filename)
    while save_path.exists():
        filename = f"{base}_{counter}{ext}"
        save_path = upload_root / filename
        counter += 1

    # Save file with error handling and streaming for large files
    try:
        # Stream file in chunks to avoid memory issues with large files
        chunk_size = 4096 * 1024  # 4MB chunks
        with open(str(save_path), "wb") as f:
            while True:
                chunk = file.read(chunk_size)
                if not chunk:
                    break
                f.write(chunk)

        # Verify file was written successfully
        if not save_path.exists() or save_path.stat().st_size == 0:
            raise IOError("File save verification failed")
    except Exception as e:
        # Cleanup partial file if exists
        if save_path.exists():
            save_path.unlink()

        # Update status to failed if video_id was provided
        if video_id:
            db.videos.find_one_and_update(
                {"_id": ObjectId(video_id)},
                {
                    "$set": {
                        "status": "failed",
                        "error": str(e),
                        "updated_at": get_now_iso(),
                    }
                },
            )

        return (
            jsonify({"error": f"File upload failed: {str(e)}", "gpx_created": False}),
            500,
        )

    # GPX handling: user-provided GPX takes priority over exiftool extraction
    if "gpx_file" in request.files and request.files["gpx_file"].filename:
        gpx_user_file = request.files["gpx_file"]
        gpx_filename = f"gpx_{secure_filename(gpx_user_file.filename)}"
        gpx_save_path = upload_root / gpx_filename
        counter = 1
        base, ext = os.path.splitext(gpx_filename)
        while gpx_save_path.exists():
            gpx_filename = f"{base}_{counter}{ext}"
            gpx_save_path = upload_root / gpx_filename
            counter += 1
        gpx_user_file.save(str(gpx_save_path))
        gpx_file = str(gpx_save_path)
        gpx_created = True
        print(f"[UPLOAD] Using user-provided GPX: {gpx_file}")
    else:
        gpx_file = extract_gpx(str(save_path))
        gpx_created = gpx_file is not None
        if gpx_created:
            print(f"[UPLOAD] GPX extracted: {gpx_file}")
        else:
            print(f"[UPLOAD] No GPX data found in video: {filename}")

    storage_url = f"/uploads/{filename}"
    gpx_file_url = f"/uploads/{os.path.basename(gpx_file)}" if gpx_file else None
    file_size = save_path.stat().st_size

    # NOW update database with successful upload
    if video_id:
        # Look up the survey_display_id for the existing video's survey
        existing_video = db.videos.find_one({"_id": ObjectId(video_id)}, {"survey_id": 1})
        survey_display_id = None
        if existing_video and existing_video.get("survey_id"):
            survey_doc = db.surveys.find_one({"_id": existing_video["survey_id"]}, {"survey_display_id": 1})
            if survey_doc:
                survey_display_id = survey_doc.get("survey_display_id")

        update_fields = {
            "storage_url": storage_url,
            "gpx_file_url": gpx_file_url,
            "size_bytes": file_size,
            "status": "queued" if gpx_created else "failed",
            "progress": 0,
            "updated_at": get_now_iso(),
        }
        if not gpx_created:
            update_fields["error"] = "No GPS data found. Upload a GPX file to enable processing."
        if survey_display_id:
            update_fields["survey_display_id"] = survey_display_id

        db.videos.find_one_and_update(
            {"_id": ObjectId(video_id)},
            {"$set": update_fields},
        )

        if gpx_created:
            job_queue.enqueue("anonymization", video_id, {
                "upload_type": "local",
                "video_path": str(save_path),
                "upload_root": str(upload_root),
            })

        return (
            jsonify(
                {
                    "storage_url": storage_url,
                    "size_bytes": file_size,
                    "gpx_created": gpx_created,
                }
            ),
            200,
        )

    # If no existing video row, create one minimal from form fields
    survey_id = request.form.get("survey_id")
    route_id = request.form.get("route_id", type=int)
    title = request.form.get("title") or filename
    if not (survey_id and route_id):
        # Clean up uploaded file if DB entry can't be created
        save_path.unlink()
        return (
            jsonify({"error": "missing survey_id or route_id", "gpx_created": False}),
            400,
        )

    # Look up survey_display_id
    survey_display_id = None
    survey_doc = db.surveys.find_one({"_id": ObjectId(survey_id)}, {"survey_display_id": 1})
    if survey_doc:
        survey_display_id = survey_doc.get("survey_display_id")

    doc = {
        "survey_id": ObjectId(survey_id),
        "survey_display_id": survey_display_id,
        "route_id": int(route_id),
        "title": title,
        "storage_url": storage_url,
        "gpx_file_url": gpx_file_url,
        "size_bytes": file_size,
        "status": "queued" if gpx_created else "failed",
        "progress": 0,
        "created_at": get_now_iso(),
        "updated_at": get_now_iso(),
    }
    if not gpx_created:
        doc["error"] = "No GPS data found. Upload a GPX file to enable processing."

    res = db.videos.insert_one(doc)
    new_video_id = str(res.inserted_id)

    if gpx_created:
        job_queue.enqueue("anonymization", new_video_id, {
            "upload_type": "local",
            "video_path": str(save_path),
            "upload_root": str(upload_root),
        })

    return (
        jsonify(
            {
                "item": {
                    **doc,
                    "_id": new_video_id,
                    "survey_id": survey_id,
                    "gpx_created": gpx_created,
                }
            }
        ),
        201,
    )


@videos_bp.post("/presign")
@swag_from(None)
@role_required(["super_admin","admin", "surveyor"])
def presign():

    """
    swagger: false
    Get presigned URL for upload

    tags:
      - Videos
    security:
      - Bearer: []
    responses:
      200:
        description: Presigned URL generated
        schema:
          type: object
          properties:
            url:
              type: string
            fields:
              type: object
    """
    return jsonify({"url": "https://example-presigned-url", "fields": {}})


@videos_bp.post("/gpx-upload")
@role_required(["super_admin","admin", "surveyor"])
def upload_gpx():
    """
    Upload GPX file for a video
    ---
    tags:
      - Videos
    security:
      - Bearer: []
    consumes:
      - multipart/form-data
    parameters:
      - name: file
        in: formData
        type: file
        required: true
        description: The GPX file
      - name: video_id
        in: formData
        type: string
        required: true
        description: The ID of the video
    responses:
      200:
        description: GPX uploaded successfully
      400:
        description: Missing file or video_id
    """
    # Expect multipart form with fields: video_id, file
    if "file" not in request.files:
        return jsonify({"error": "file is reqfuired"}), 400
    file = request.files["file"]
    if not file or file.filename == "":
        return jsonify({"error": "empty file"}), 400

    video_id = request.form.get("video_id")
    if not video_id:
        return jsonify({"error": "video_id is required"}), 400

    upload_root = Path(
        os.getenv("UPLOAD_DIR", Path(__file__).resolve().parents[1] / "uploads")
    )
    upload_root.mkdir(parents=True, exist_ok=True)
    filename = secure_filename(file.filename)
    # Add gpx_ prefix to distinguish from videos
    filename = f"gpx_{filename}"
    save_path = upload_root / filename
    # Avoid overwrite by appending number if exists
    counter = 1
    base, ext = os.path.splitext(filename)
    while save_path.exists():
        filename = f"{base}_{counter}{ext}"
        save_path = upload_root / filename
        counter += 1
    file.save(str(save_path))

    gpx_url = f"/uploads/{filename}"

    db = get_db()
    db.videos.find_one_and_update(
        {"_id": ObjectId(video_id)},
        {"$set": {"gpx_file_url": gpx_url, "updated_at": get_now_iso()}},
    )
    return jsonify({"gpx_file_url": gpx_url}), 200


@videos_bp.post("/thumbnail-upload")
@role_required(["super_admin","admin", "surveyor"])
def upload_thumbnail():
    """
    Upload thumbnail for a video
    ---
    tags:
      - Videos
    security:
      - Bearer: []
    consumes:
      - multipart/form-data
    parameters:
      - name: file
        in: formData
        type: file
        required: true
        description: The thumbnail image file
      - name: video_id
        in: formData
        type: string
        required: true
        description: The ID of the video
    responses:
      200:
        description: Thumbnail uploaded successfully
      400:
        description: Missing file or video_id
    """
    # Expect multipart form with fields: video_id, file
    if "file" not in request.files:
        return jsonify({"error": "file is required"}), 400
    file = request.files["file"]
    if not file or file.filename == "":
        return jsonify({"error": "empty file"}), 400

    video_id = request.form.get("video_id")
    if not video_id:
        return jsonify({"error": "video_id is required"}), 400

    upload_root = Path(
        os.getenv("UPLOAD_DIR", Path(__file__).resolve().parents[1] / "uploads")
    )
    upload_root.mkdir(parents=True, exist_ok=True)
    filename = secure_filename(file.filename)
    # Add thumb_ prefix to distinguish thumbnails
    filename = f"thumb_{filename}"
    save_path = upload_root / filename
    # Avoid overwrite by appending number if exists
    counter = 1
    base, ext = os.path.splitext(filename)
    while save_path.exists():
        filename = f"{base}_{counter}{ext}"
        save_path = upload_root / filename
        counter += 1
    file.save(str(save_path))

    thumbnail_url = f"/uploads/{filename}"

    db = get_db()
    db.videos.find_one_and_update(
        {"_id": ObjectId(video_id)},
        {"$set": {"thumbnail_url": thumbnail_url, "updated_at": get_now_iso()}},
    )
    return jsonify({"thumbnail_url": thumbnail_url}), 200


@videos_bp.post("/<video_id>/process")
@role_required(["super_admin","admin", "surveyor"])
def process_video_with_ai(video_id: str):
    """
    Process video with AI
    ---
    tags:
      - Videos
    security:
      - Bearer: []
    description: Extracts frames, runs inference, creates annotated video. Non-blocking.
    parameters:
      - name: video_id
        in: path
        type: string
        required: true
        description: The ID of the video to process
    responses:
      200:
        description: Video processing started
      404:
        description: Video not found
      400:
        description: Video file not uploaded yet or Processing error
    """
    import threading
    from pathlib import Path
    import glob

    db = get_db()
    video = db.videos.find_one({"_id": ObjectId(video_id)})
    print("here")
    if not video:
        return jsonify({"error": "Video not found"}), 404

    storage_url = video.get("storage_url")
    if not storage_url:
        return jsonify({"error": "Video file not uploaded yet"}), 400

    gpx_file_url = video.get("gpx_file_url")
    if not gpx_file_url:
        db.videos.update_one(
            {"_id": ObjectId(video_id)},
            {"$set": {"status": "failed", "error": "No GPS data found. Upload a GPX file to enable processing.", "updated_at": get_now_iso()}},
        )
        return jsonify({"error": "No GPS data found. Upload a GPX file to enable processing."}), 400
    route_id = video.get("route_id")
    survey_id = video.get("survey_id")

    # DEMO MODE CHECK
    # Check if this video exists in video_library and has corresponding annotated files in annotated_library
    upload_root = Path(
        os.getenv("UPLOAD_DIR") or str(Path(__file__).resolve().parents[1] / "uploads")
    ).resolve()

    # Extract filename from storage_url
    # storage_url is like /uploads/video_library/filename.mp4 or /uploads/filename.mp4
    filename = os.path.basename(storage_url)
    filename_no_ext = os.path.splitext(filename)[0]

    annotated_lib_path = upload_root / "annotated_library"
    print(f"[PROCESS] Looking for annotated files in {annotated_lib_path}")
    # Look for matching annotated files
    # Pattern: *_{filename_no_ext}_annotated_compressed.mp4
    # Example: corridor_fence_000_2025_0817_115147_F_annotated_compressed.mp4
    # where 2025_0817_115147_F is the filename_no_ext

    # Handle storage_url which might be relative or absolute
    storage_filename = storage_url.lstrip("/uploads/").lstrip("/")
    video_path = upload_root / storage_filename

    demo_matches = []
    # if annotated_lib_path.exists():
    #     search_pattern = f"*{filename_no_ext}*.mp4"
    #     demo_matches = list(annotated_lib_path.glob(search_pattern))

    # demo_matches = []
    if "video_library" in storage_url:
        print(
            f"[PROCESS] DEMO MODE DETECTED for {video_id}. Found {len(demo_matches)} annotated files."
        )
        db.videos.update_one(
            {"_id": ObjectId(video_id)},
            {"$set": {"status": "queued", "progress": 0, "updated_at": get_now_iso()}},
        )
        job_queue.enqueue("ai_processing", video_id, {
            "is_demo": True,
            "storage_url": storage_url,
            "survey_id": str(survey_id) if survey_id else None,
            "route_id": route_id,
            "upload_root": str(upload_root),
            "filename_no_ext": filename_no_ext,
            "demo_matches": [str(m) for m in demo_matches],
        })
        return (
            jsonify(
                {
                    "ok": True,
                    "message": "Video processing queued",
                    "video_id": video_id,
                    "status": "queued",
                }
            ),
            202,
        )

    # Queue real AI processing
    db.videos.update_one(
        {"_id": ObjectId(video_id)},
        {"$set": {"status": "queued", "progress": 0, "updated_at": get_now_iso()}},
    )
    job_queue.enqueue("ai_processing", video_id, {
        "is_demo": False,
        "storage_url": storage_url,
        "gpx_file_url": gpx_file_url,
        "route_id": route_id,
        "survey_id": str(survey_id) if survey_id else None,
        "upload_root": str(upload_root),
    })
    return (
        jsonify(
            {
                "ok": True,
                "message": "Video processing queued",
                "video_id": video_id,
                "status": "queued",
            }
        ),
        202,
    )


@videos_bp.get("/<video_id>/frame_annotated")
def get_video_frame_annotated(video_id: str):
    db = get_db()

    # Check if video_id is actually a demo video key (not an ObjectId)
    if video_id in DEMO_VIDEOS:
        # Demo asset: find video by matching storage_url basename
        all_videos = list(db.videos.find())
        video = None
        for v in all_videos:
            url = v.get("storage_url", "")
            basename = os.path.splitext(os.path.basename(url))[0] if url else ""
            if basename == video_id:
                video = v
                break
    else:
        video = db.videos.find_one({"_id": ObjectId(video_id)})

    if not video:
        return jsonify({"error": "Video not found"}), 404

    video_url = video.get("storage_url")
    route_id = video.get("route_id")
    # Get the video file path
    upload_root = Path(
        os.getenv("UPLOAD_DIR", Path(__file__).resolve().parents[1] / "uploads")
    )
    filename = video_url.replace("/uploads/", "")
    video_path = upload_root / filename
    print(video_path)
    if not video_path or not video_path.exists():
        return jsonify({"error": "Video found in db but not in storage"}), 404

    try:
        cap = cv2.VideoCapture(str(video_path))
        if not cap.isOpened():
            return jsonify({"error": "Failed to open video file"}), 500

        # Get video properties
        fps = cap.get(cv2.CAP_PROP_FPS)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

        # Determine which frame to extract
        timestamp = request.args.get("timestamp", type=float)
        frame_number = request.args.get("frame_number", type=int)

        if timestamp is not None:
            # Calculate frame number from timestamp
            frame_number = int(timestamp * fps)
        elif frame_number is None:
            # Default to first frame
            frame_number = 0

        # Validate frame number
        if frame_number < 0 or frame_number >= total_frames:
            frame_number = total_frames - 2
            # cap.release()
            # return jsonify({
            #     "error": f"Frame number {frame_number} out of range (0-{total_frames-1})"
            # }), 400
        print(f"Extracting frame number: {frame_number}")
        # Seek to the specific frame
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_number)
        ret, frame = cap.read()
        cap.release()

        if not ret or frame is None:
            return jsonify({"error": "Failed to read frame from video"}), 500

        # Scale to reduce the payload size
        frame_height = frame.shape[0]
        frame_width = frame.shape[1]
        if request.args.get("resize", "true").lower() == "true":
            resize_width = 640  # request.args.get("width", type=int)
            new_height = int(frame_height * (resize_width / frame_width))
            frame = cv2.resize(frame, (resize_width, new_height))

        # Check if this is a demo video by matching storage_url basename with frame 'key'
        storage_basename = (
            os.path.splitext(os.path.basename(video_url))[0] if video_url else None
        )

        # First try to find frame by key (for demo videos)
        frame_db_info = None
        print(storage_basename, "storage_basename")
        if storage_basename:
            key_query = {"key": storage_basename, "frame_number": frame_number}
            frame_db_info = db.frames.find_one(
                key_query, sort=[("created_at", pymongo.DESCENDING)]
            )
            if frame_db_info:
                print(
                    f"[DEMO] Found frame by key '{storage_basename}' for frame {frame_number}"
                )

        # Fall back to video_id-based lookup
        if not frame_db_info:
            query = {"video_id": video_id, "frame_number": frame_number}
            frame_db_info = db.frames.find_one(
                query, sort=[("created_at", pymongo.DESCENDING)]
            )

        detections = frame_db_info.get("detections", []) if frame_db_info else []
        annotclasses = request.args.getlist("class")
        # print(frame_db_info, "frame")
        print(f"Annotating frame for class: {annotclasses}")

        if not frame_db_info:
            print(f"No detection data found for frame {frame_number}")
            annotated_frame = frame
        else:
            if annotclasses:
                detections = [
                    det for det in detections if det.get("class_name") in annotclasses
                ]
            # print(f"Detections to annotate: {detections}")
            # annotated_frame = sgm.draw_detections(frame.copy(), detections)

        # Convert BGR to RGB
        # frame_rgb = cv2.cvtColor(annotated_frame, cv2.COLOR_BGR2RGB)
        frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

        # Convert to PIL Image and save to bytes
        pil_image = Image.fromarray(frame_rgb)
        img_io = io.BytesIO()
        pil_image.save(img_io, "JPEG", quality=85)
        img_io.seek(0)

        img_bytes = img_io.read()
        base64_image = base64.b64encode(img_bytes).decode("utf-8")

        # Note from Neelansh:
        # It is important to return the original frame dimensions on the frontend
        # because the bounding boxes are with respect to the original frame dimensions
        # and therefore the canvas will need original dimensions to scale boxes properly
        return jsonify(
            {
                "frame_number": frame_number,
                "width": frame_width,
                "height": frame_height,
                "image_data": f"data:image/jpeg;base64,{base64_image}",
                "detections": detections,
            }
        )

        # return send_file(
        #     img_io,
        #     mimetype='image/jpeg',
        #     as_attachment=False,
        #     download_name=f"frame_{frame_number}.jpg"
        # )

    except Exception as e:
        print(f"Error extracting frame from video {video_id}: {e}")
        return jsonify({"error": f"Failed to extract frame: {str(e)}"}), 500


@videos_bp.get("/<video_id>/frames")
def get_video_frames(video_id: str, detections_only=False):
    """
    Fetch all frames for a video (metadata only, no image data).

    Query parameters:
    - has_detections: If true, only return frames with detections
    """
    db = get_db()
    video = db.videos.find_one({"_id": ObjectId(video_id)})

    if not video:
        return jsonify({"error": "Video not found"}), 404

    video_url = video.get("storage_url")

    # Check if this is a demo video by matching storage_url basename with frame 'key'
    storage_basename = (
        os.path.splitext(os.path.basename(video_url))[0] if video_url else None
    )

    has_detections = request.args.get("has_detections", "").lower() == "true"
    detections_only = request.args.get("detections_only", "").lower() == "true"

    # First try to find frames by key (for demo videos)
    frames = []

    projections = {}
    if detections_only:
        projections = {"detections": 1, "frame_number": 1}
    # Fall back to video_id-based lookup
    if not frames:
        query = {"video_id": video_id}
        if has_detections:
            query["detections_count"] = {"$gt": 0}

        frames = list(db.frames.find(query, projections).sort("frame_number", 1))

    # Use bson.json_util for proper serialization
    return Response(
        json_util.dumps(
            {
                "video_id": video_id,
                "items": frames,
                "total": len(frames),
            }
        ),
        mimetype="application/json",
    )


@videos_bp.get("/<video_id>/frame")
def get_video_frame(video_id: str):
    """
    Extract and return a specific frame from a video.
    Query parameters:
    - timestamp: Time in seconds (float)
    - frame_number: Specific frame number (int)
    - width: Optional resize width (default: original)
    - height: Optional resize height (default: original)
    - annotated: Whether to use annotated video (default: false)

    Example: /api/videos/<id>/frame?timestamp=5.5
    Example: /api/videos/<id>/frame?frame_number=165&width=800
    Example: /api/videos/<id>/frame?timestamp=5.5&annotated=true
    """
    db = get_db()
    video = db.videos.find_one({"_id": ObjectId(video_id)})

    if not video:
        return jsonify({"error": "Video not found"}), 404

    video_url = video.get("storage_url")

    if not video_url:
        return jsonify({"error": "Video file not uploaded yet"}), 400

    # Get the video file path
    upload_root = Path(
        os.getenv("UPLOAD_DIR", Path(__file__).resolve().parents[1] / "uploads")
    )
    filename = video_url.replace("/uploads/", "")
    video_path = upload_root / filename

    if not video_path.exists():
        return jsonify({"error": "Video file not found on server"}), 404

    try:
        # Open video file
        cap = cv2.VideoCapture(str(video_path))
        if not cap.isOpened():
            return jsonify({"error": "Failed to open video file"}), 500

        # Get video properties
        fps = cap.get(cv2.CAP_PROP_FPS)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

        # Determine which frame to extract
        timestamp = request.args.get("timestamp", type=float)
        frame_number = request.args.get("frame_number", type=int)

        if timestamp is not None:
            # Calculate frame number from timestamp
            frame_number = int(timestamp * fps)
        elif frame_number is None:
            # Default to first frame
            frame_number = 0

        # Validate frame number
        if frame_number < 0 or frame_number >= total_frames:
            cap.release()
            return (
                jsonify(
                    {
                        "error": f"Frame number {frame_number} out of range (0-{total_frames-1})"
                    }
                ),
                400,
            )

        # Seek to the specific frame
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_number)
        ret, frame = cap.read()
        cap.release()

        if not ret or frame is None:
            return jsonify({"error": "Failed to read frame from video"}), 500

        # Optional resize
        width = request.args.get("width", type=int)
        height = request.args.get("height", type=int)
        if width or height:
            h, w = frame.shape[:2]
            if width and not height:
                height = int(h * (width / w))
            elif height and not width:
                width = int(w * (height / h))
            frame = cv2.resize(frame, (width, height))

        # Convert BGR to RGB
        frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

        # Convert to PIL Image and save to bytes
        pil_image = Image.fromarray(frame_rgb)
        img_io = io.BytesIO()
        pil_image.save(img_io, "JPEG", quality=85)
        img_io.seek(0)

        return send_file(
            img_io,
            mimetype="image/jpeg",
            as_attachment=False,
            download_name=f"frame_{frame_number}.jpg",
        )

    except Exception as e:
        print(f"Error extracting frame from video {video_id}: {e}")
        return jsonify({"error": f"Failed to extract frame: {str(e)}"}), 500


@videos_bp.get("/<video_id>/metadata")
@role_required(["super_admin", "admin", "surveyor", "viewer"])
def get_video_metadata(video_id: str):
    """
    Fetch detected assets for a specific video from the assets collection.
    """
    db = get_db()
    video = db.videos.find_one({"_id": ObjectId(video_id)})

    if not video:
        return jsonify({"error": "Video not found"}), 404

    assets = list(db.assets.find({"video_id": video_id}).sort("frame_number", 1))

    if not assets:
        return jsonify({"error": "No assets found for this video"}), 404

    return Response(
        json_util.dumps(
            {
                "video_id": video_id,
                "assets": assets,
                "total_assets": len(assets),
            }
        ),
        mimetype="application/json",
    )


@videos_bp.get("/library")
def list_from_library():
    upload_root = Path(
        os.getenv("UPLOAD_DIR", Path(__file__).resolve().parents[1] / "uploads")
    )
    library_path = upload_root / "video_library"

    # Ensure directory exists
    if not library_path.exists():
        library_path.mkdir(parents=True, exist_ok=True)

    folder_path = request.args.get("path", "")
    # Secure the path to prevent directory traversal
    if folder_path:
        # Remove leading/trailing slashes and join with library path
        sanitized_path = secure_filename(folder_path) if folder_path != "/" else ""
        current_search_path = library_path / sanitized_path
    else:
        current_search_path = library_path

    print(f"[LIBRARY] Looking for: {current_search_path}")
    if not current_search_path.exists():
        return jsonify({"error": "Path not found"}), 404

    # This dictionary will store our grouped data
    # Structure: { "filename": {"video": "...", "thumb": "..."} }
    grouped_data = {}
    folders = []

    try:
        for item in current_search_path.iterdir():
            if item.name.startswith("."):
                continue

            if item.is_dir():
                folders.append(item.name + "/")
                continue

            # Get base name and extension
            base_name = item.stem
            ext = item.suffix.lower()

            # Key for grouping (base filename without extension)
            group_key = base_name

            if group_key not in grouped_data:
                grouped_data[group_key] = {
                    "name": base_name,
                }

            # Construct relative path for URL
            # We need the path relative to uploads directory for the static server
            # library_path is usually .../uploads/video_library
            # item path is .../uploads/video_library/filename
            relative_path = f"video_library/{item.name}"

            if folder_path:
                relative_path = f"video_library/{folder_path}/{item.name}"

            url_path = f"/uploads/{relative_path}"

            if ext in [".mp4", ".mov", ".avi", ".mkv", ".webm"]:
                grouped_data[group_key]["video_path"] = relative_path
                grouped_data[group_key]["video_url"] = url_path
                grouped_data[group_key]["size_bytes"] = item.stat().st_size
                grouped_data[group_key]["last_modified"] = datetime.fromtimestamp(
                    item.stat().st_mtime
                ).isoformat()

            elif ext in [".jpg", ".jpeg", ".png", ".webp"]:
                grouped_data[group_key]["thumb_path"] = relative_path
                grouped_data[group_key]["thumb_url"] = url_path

    except Exception as e:
        print(f"Error listing library: {e}")
        return jsonify({"error": str(e)}), 500

    # Filter out items that don't have a video (if they are just orphan thumbnails, maybe fine, but let's see)
    # For now keep all
    items = list(grouped_data.values())

    return (
        jsonify(
            {
                "current_path": folder_path,
                "folders": sorted(folders),
                "items": sorted(items, key=lambda x: x["last_modified"], reverse=True),
            }
        ),
        200,
    )


@videos_bp.post("/library")
@role_required(["super_admin","admin", "surveyor", "viewer"])
def upload_library_video():
    # 1. Get details from JSON body
    data = request.json
    if not data:
        return jsonify({"error": "invalid JSON body", "gpx_created": False}), 400

    video_path_str = data.get("video_key")  # frontend sends path in video_key field
    thumb_path_str = data.get("thumb_path")
    video_id = data.get("video_id")
    survey_id = data.get("survey_id")
    route_id = data.get("route_id")

    if not video_path_str or not survey_id or not route_id:
        return (
            jsonify(
                {
                    "error": "video_key (path), survey_id, and route_id are required",
                    "gpx_created": False,
                }
            ),
            400,
        )

    db = get_db()

    # 2. Verify Local File Exists
    upload_root = Path(
        os.getenv("UPLOAD_DIR", Path(__file__).resolve().parents[1] / "uploads")
    )

    # Clean up path to avoid traversal attacks
    def clean_relative_path(p):
        clean = p.lstrip("/")
        if clean.startswith("uploads/"):
            clean = clean[8:]
        return clean

    clean_path = clean_relative_path(video_path_str)
    full_path = upload_root / clean_path

    print(f"[LIBRARY UPLOAD] Linking video from: {full_path}")

    if not full_path.exists():
        return (
            jsonify(
                {"error": f"Video file not found at {clean_path}", "gpx_created": False}
            ),
            404,
        )

    file_size = full_path.stat().st_size
    filename = full_path.name

    # Handle Thumbnail
    thumbnail_url = None
    if thumb_path_str:
        clean_thumb = clean_relative_path(thumb_path_str)
        thumb_full_path = upload_root / clean_thumb
        if thumb_full_path.exists():
            thumbnail_url = f"/uploads/{clean_thumb}"

    # 4. Extract GPX
    gpx_file = extract_gpx(str(full_path))
    gpx_created = gpx_file and os.path.exists(gpx_file)

    storage_url = f"/uploads/{clean_path}"

    gpx_file_url = None
    if gpx_file:
        gpx_path = Path(gpx_file)
        try:
            rel_gpx = gpx_path.relative_to(upload_root)
            gpx_file_url = f"/uploads/{rel_gpx}"
        except ValueError:
            gpx_file_url = f"/uploads/{gpx_path.name}"
    # 5. Look up survey_display_id from the survey
    survey_display_id = None
    survey_sid = survey_id["$oid"] if isinstance(survey_id, dict) else survey_id
    survey_doc = db.surveys.find_one({"_id": ObjectId(survey_sid)}, {"survey_display_id": 1})
    if survey_doc:
        survey_display_id = survey_doc.get("survey_display_id")

    # 6. Final Database Update
    update_doc = {
        "storage_url": storage_url,
        "gpx_file_url": gpx_file_url,
        "thumbnail_url": thumbnail_url,
        "size_bytes": file_size,
        "status": "queued",
        "progress": 0,
        "updated_at": get_now_iso(),
        "survey_display_id": survey_display_id,
    }

    key = os.path.splitext(os.path.basename(storage_url))[0]
    sid = None
    if isinstance(survey_id, dict):
        sid =  survey_id["$oid"]
    else:
        sid = survey_id
    
    # link the survey id with demo assets
    assets_lib = db.video_lib_assets.find({"video_key" : key })
    frames = db.frames_lib.find({ "video_key": key })
    assets_to_insert = []
    frames_to_insert = []
    for asset in assets_lib:
        asset.pop('_id', None) 
        asset['video_id'] = video_id
        asset['survey_id'] = ObjectId(sid)
        asset['route_id'] = int(route_id)
        asset['survey_display_id'] = survey_display_id
        assets_to_insert.append(asset)    
    
    for frame in frames:
        frame.pop('_id', None)
        frame['video_id'] = video_id
        frame['survey_id'] = ObjectId(sid)
        frame['route_id'] = int(route_id)
        # frame['survey_display_id'] = survey_display_id
        frames_to_insert.append(frame)
        
    if assets_to_insert:
        db.assets.insert_many(assets_to_insert)
    
    if frames_to_insert:
        db.frames.insert_many(frames_to_insert)

    if video_id:
        res = db.videos.find_one_and_update(
            {"_id": ObjectId(video_id)}, {"$set": update_doc}
        )
        job_queue.enqueue("anonymization", video_id, {
            "upload_type": "library",
            "video_path": str(full_path),
            "upload_root": str(upload_root),
        })
        return (
            jsonify(
                {
                    "id": str(res["_id"]),
                    "storage_url": storage_url,
                    "size_bytes": file_size,
                    "gpx_created": gpx_created,
                }
            ),
            200,
        )

    doc = {
        "survey_id": ObjectId(survey_id),
        "route_id": int(route_id),
        "title": data.get("title") or filename,
        **update_doc,
        "created_at": get_now_iso(),
    }

    res = db.videos.insert_one(doc)
    new_video_id = str(res.inserted_id)
    job_queue.enqueue("anonymization", new_video_id, {
        "upload_type": "library",
        "video_path": str(full_path),
        "upload_root": str(upload_root),
    })
    return (
        jsonify(
            {
                "id": new_video_id,
                "item": {
                    **doc,
                    "_id": new_video_id,
                    "survey_id": str(survey_id),
                },
                "gpx_created": gpx_created,
            }
        ),
        201,
    )
