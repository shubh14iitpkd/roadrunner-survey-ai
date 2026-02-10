from services.MultiEndpointSageMaker import MultiEndpointSageMaker
import pymongo
import os
import time
from datetime import datetime
import boto3
import base64
from pathlib import Path
from werkzeug.utils import secure_filename
from flask import Blueprint, jsonify, request, Response, send_file
from bson import ObjectId, json_util
from pymongo import DESCENDING
import cv2
import io
from PIL import Image
from flask_jwt_extended import jwt_required
from flasgger import swag_from

from db import get_db
from utils.ids import get_now_iso
from utils.rbac import role_required
from utils.extract_gpx import extract_gpx

videos_bp = Blueprint("videos", __name__)
from config import Config

# from services.sagemaker_processor import SageMakerVideoProcessor

config = Config()
aws_session = boto3.Session(region_name=config.AWS_REGION)


@videos_bp.get("/")
@role_required(["admin", "surveyor", "viewer"])
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
@role_required(["admin", "surveyor", "viewer"])
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
@role_required(["admin", "surveyor"])
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

    doc = {
        "survey_id": survey_id,
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
@role_required(["admin", "surveyor"])
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

    # Extracting gpx from saved video here
    gpx_file = extract_gpx(str(save_path))
    gpx_created = gpx_file and os.path.exists(gpx_file)

    # verify gpx extraction
    if gpx_created:
        print(f"[UPLOAD] GPX extracted: {gpx_file}")
    else:
        print(f"[UPLOAD] No GPX data found in video: {filename}")

    storage_url = f"/uploads/{filename}"
    gpx_file_url = f"/uploads/{os.path.basename(gpx_file)}" if gpx_file else None
    file_size = save_path.stat().st_size

    # NOW update database with successful upload
    if video_id:
        db.videos.find_one_and_update(
            {"_id": ObjectId(video_id)},
            {
                "$set": {
                    "storage_url": storage_url,
                    "gpx_file_url": gpx_file_url,
                    "size_bytes": file_size,
                    "status": "uploaded",
                    "progress": 100,
                    "updated_at": get_now_iso(),
                }
            },
        )
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

    doc = {
        "survey_id": ObjectId(survey_id),
        "route_id": int(route_id),
        "title": title,
        "storage_url": storage_url,
        "gpx_file_url": gpx_file_url,
        "size_bytes": file_size,
        "status": "uploaded",
        "progress": 100,
        "created_at": get_now_iso(),
        "updated_at": get_now_iso(),
    }

    res = db.videos.insert_one(doc)
    return (
        jsonify(
            {
                "item": {
                    **doc,
                    "_id": str(res.inserted_id),
                    "survey_id": survey_id,
                    "gpx_created": gpx_created,
                }
            }
        ),
        201,
    )


@videos_bp.post("/presign")
@swag_from(None)
@role_required(["admin", "surveyor"])
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
@role_required(["admin", "surveyor"])
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
@role_required(["admin", "surveyor"])
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
@role_required(["admin", "surveyor"])
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

    demo_matches = []
    if annotated_lib_path.exists():
        search_pattern = f"*_{filename_no_ext}_annotated_compressed.mp4"
        demo_matches = list(annotated_lib_path.glob(search_pattern))

    # demo_matches = []
    if demo_matches:
        print(
            f"[PROCESS] DEMO MODE DETECTED for {video_id}. Found {len(demo_matches)} annotated files."
        )

        # Update to processing first
        db.videos.update_one(
            {"_id": ObjectId(video_id)},
            {
                "$set": {
                    "status": "processing",
                    "progress": 0,
                    "updated_at": get_now_iso(),
                }
            },
        )

        # Get Flask app for context
        from flask import current_app

        app = current_app._get_current_object()

        def process_demo_in_background():
            with app.app_context():
                try:
                    import time
                    from pymongo import MongoClient

                    mongo_client = MongoClient(app.config["MONGO_URI"])
                    mongo_db = mongo_client[app.config["MONGO_DB_NAME"]]

                    # Simulate progress
                    for i in range(1, 101, 7):
                        time.sleep(2.3)
                        print(f"[PROCESS] Updating progress to {i}%")
                        mongo_db.videos.update_one(
                            {"_id": ObjectId(video_id)},
                            {"$set": {"progress": i, "updated_at": get_now_iso()}},
                        )

                    # Construct category map
                    # Filename format: {CATEGORY}_{INDEX}_{ORIGINAL}_annotated_compressed.mp4
                    # e.g. corridor_fence_000_2025...
                    category_videos = {}

                    known_categories = [
                        "oia",
                        "corridor_pavement",
                        "corridor_structure",
                        "directional_signage",
                        "its",
                        "roadway_lighting",
                    ]

                    primary_annotated_url = None

                    for match in demo_matches:
                        match_name = match.name
                        # Try to match category
                        found_cat = "default"
                        for cat in known_categories:
                            if match_name.startswith(cat):
                                found_cat = cat
                                break

                        # Fix for categories that might be substrings of each other?
                        # In this list, they seem distinct enough.

                        # Build URL
                        # Path relative to uploads
                        rel_path = match.relative_to(upload_root)
                        url = f"/uploads/{rel_path}"

                        category_videos[found_cat] = url

                        if not primary_annotated_url:
                            primary_annotated_url = url

                    # Update DB completion
                    mongo_db.videos.update_one(
                        {"_id": ObjectId(video_id)},
                        {
                            "$set": {
                                "status": "completed",
                                "progress": 100,
                                "annotated_video_url": primary_annotated_url,
                                "category_videos": category_videos,
                                "updated_at": get_now_iso(),
                            }
                        },
                    )

                    print(f"[PROCESS] Demo processing complete for {video_id}")

                except Exception as e:
                    print(f"Error in demo processing: {e}")
                    import traceback

                    traceback.print_exc()

        thread = threading.Thread(target=process_demo_in_background, daemon=True)
        thread.start()

        return (
            jsonify(
                {
                    "ok": True,
                    "message": "Video processing started (DEMO MODE)",
                    "video_id": video_id,
                    "status": "processing",
                }
            ),
            202,
        )

    # Initialize processor and check health FIRST (Synchronous check)
    from services.sagemaker_processor import SageMakerVideoProcessor

    processor = SageMakerVideoProcessor()
    is_healthy, error_msg = processor.check_endpoint_health()

    # processor = MultiEndpointSageMaker()
    # processor.check_endpoints_health()

    if not is_healthy:
        return (
            jsonify(
                {
                    "error": f"SageMaker Error: {error_msg}. Processing aborted to prevent local overload."
                }
            ),
            400,
        )

    # Update status to processing
    db.videos.update_one(
        {"_id": ObjectId(video_id)},
        {"$set": {"status": "processing", "progress": 0, "updated_at": get_now_iso()}},
    )

    # Get Flask app for context
    from flask import current_app

    app = current_app._get_current_object()

    # Start background processing
    def process_in_background():
        with app.app_context():
            try:
                import json

                # Setup paths with absolute path
                upload_root = Path(
                    os.getenv("UPLOAD_DIR")
                    or str(Path(__file__).resolve().parents[1] / "uploads")
                )
                upload_root = upload_root.resolve()  # Ensure absolute path

                # Handle storage_url which might be relative or absolute
                storage_filename = storage_url.lstrip("/uploads/").lstrip("/")
                video_path = upload_root / storage_filename

                print(f"[PROCESS] Upload root: {upload_root}")
                print(f"[PROCESS] Storage URL: {storage_url}")
                print(f"[PROCESS] Video filename: {storage_filename}")
                print(f"[PROCESS] Video path: {video_path}")
                print(f"[PROCESS] Video exists: {video_path.exists()}")

                # Create output directories
                output_dirs = {
                    "original_videos": upload_root / "original_videos",
                    "annotated_videos": upload_root / "annotated_videos",
                    "frames": upload_root / "frames",
                    "metadata": upload_root / "metadata",
                }
                for dir_path in output_dirs.values():
                    dir_path.mkdir(parents=True, exist_ok=True)

                # Move original video to original_videos folder if not already there
                original_video_path = output_dirs["original_videos"] / f"{video_id}.mp4"
                if not original_video_path.exists():
                    if not video_path.exists():
                        raise FileNotFoundError(
                            f"Source video not found at: {video_path}"
                        )
                    import shutil

                    shutil.copy2(str(video_path), str(original_video_path))

                print(f"[PROCESS] Starting SageMaker processing for video {video_id}")

                # Initialize SageMaker processor
                processor = SageMakerVideoProcessor()  # MultiEndpointSageMaker()

                # Get MongoDB client directly (not using get_db() to avoid Flask context issues in callback)
                from pymongo import MongoClient

                mongo_client = MongoClient(app.config["MONGO_URI"])
                mongo_db = mongo_client[app.config["MONGO_DB_NAME"]]

                # Progress callback to update database
                def update_progress(progress: int, message: str):
                    mongo_db.videos.update_one(
                        {"_id": ObjectId(video_id)},
                        {"$set": {"progress": progress, "updated_at": get_now_iso()}},
                    )
                    print(f"[PROCESS] {message} ({progress}%)")

                # Process video
                gpx_path = upload_root / gpx_file_url.lstrip("/uploads/") if gpx_file_url else None
                result = processor.process_video(
                    video_path=original_video_path,
                    output_dir=upload_root,  # Pass upload_root directly
                    video_id=video_id,
                    route_id=route_id,  # Pass route_id for organizing frames by road
                    survey_id=survey_id,  # Pass survey_id for linking frames
                    gpx_path=gpx_path,
                    db=mongo_db,  # Pass MongoDB connection for frame storage
                    progress_callback=update_progress,
                )

                print(f"[PROCESS] Processing complete: {result}")

                # Link frames to GPX data if available
                if gpx_path:
                    try:
                        print(f"[PROCESS] GPX path: {gpx_path}")
                        print(f"[PROCESS] GPX exists: {gpx_path.exists()}")
                        if gpx_path.exists():
                            # Parse GPX file
                            import xml.etree.ElementTree as ET

                            tree = ET.parse(str(gpx_path))
                            root = tree.getroot()

                            # Extract GPX points with timestamps
                            ns = {"gpx": "http://www.topografix.com/GPX/1/1"}
                            gpx_data = []
                            for idx, trkpt in enumerate(
                                root.findall(".//gpx:trkpt", ns)
                                or root.findall(".//trkpt")
                            ):
                                lat = float(trkpt.get("lat", 0))
                                lon = float(trkpt.get("lon", 0))
                                ele = trkpt.find("gpx:ele", ns) or trkpt.find("ele")
                                altitude = (
                                    float(ele.text)
                                    if ele is not None and ele.text
                                    else None
                                )

                                # Estimate timestamp based on position if not available
                                timestamp = (
                                    idx
                                    / len(
                                        list(
                                            root.findall(".//gpx:trkpt", ns)
                                            or root.findall(".//trkpt")
                                        )
                                    )
                                    * result["duration"]
                                )

                                gpx_data.append(
                                    {
                                        "timestamp": timestamp,
                                        "lat": lat,
                                        "lon": lon,
                                        "altitude": altitude,
                                    }
                                )

                            # Link frames to GPX
                            metadata_path = (
                                output_dirs["metadata"]
                                / f"{video_id}_frame_metadata.json"
                            )
                            linked_frames = processor.link_frames_to_gpx(
                                metadata_path, gpx_data, video_id=video_id, db=mongo_db
                            )

                            # Save linked metadata
                            with open(metadata_path, "w") as f:
                                json.dump(linked_frames, f, indent=2)

                            print(
                                f"[PROCESS] Linked {len(linked_frames)} frames to GPX data"
                            )
                    except Exception as e:
                        print(f"[PROCESS] Warning: Could not link GPX data: {e}")

                # Update video record with results
                # Build paths from result - paths from processor already include 'uploads/' prefix
                # So we just need to add leading '/' if not present
                def normalize_path(path: str) -> str:
                    """Ensure path starts with / but doesn't have double /uploads/"""
                    if not path:
                        return path
                    # Remove any leading slashes
                    path = path.lstrip("/")
                    # Add single leading slash
                    return f"/{path}"

                annotated_video_url = normalize_path(
                    result.get(
                        "annotated_video_path",
                        f"uploads/annotated_videos/{video_id}_annotated.mp4",
                    )
                )
                frames_directory = normalize_path(
                    result.get(
                        "frames_directory",
                        (
                            f"uploads/frames/route_{route_id}/{video_id}"
                            if route_id
                            else f"uploads/frames/{video_id}"
                        ),
                    )
                )
                frame_metadata_url = normalize_path(
                    result.get(
                        "frame_metadata_path",
                        f"uploads/metadata/{video_id}_frame_metadata.json",
                    )
                )

                mongo_db.videos.update_one(
                    {"_id": ObjectId(video_id)},
                    {
                        "$set": {
                            "status": "completed",
                            "progress": 100,
                            "annotated_video_url": annotated_video_url,
                            "frames_directory": frames_directory,
                            "frame_metadata_url": frame_metadata_url,
                            "total_detections": result.get("total_detections", 0),
                            "detections_summary": result.get("detections_summary", {}),
                            "processed_frames": result.get("processed_frames", 0),
                            "updated_at": get_now_iso(),
                        }
                    },
                )

                print(f"[PROCESS] Video {video_id} processing completed successfully")

            except Exception as e:
                print(f"[PROCESS] Error processing video {video_id}: {e}")
                import traceback

                traceback.print_exc()

                # Update status to failed
                from pymongo import MongoClient

                mongo_client = MongoClient(app.config["MONGO_URI"])
                mongo_db = mongo_client[app.config["MONGO_DB_NAME"]]
                mongo_db.videos.update_one(
                    {"_id": ObjectId(video_id)},
                    {
                        "$set": {
                            "status": "failed",
                            "error": str(e),
                            "updated_at": get_now_iso(),
                        }
                    },
                )

    # Start background thread
    thread = threading.Thread(target=process_in_background, daemon=True)
    thread.start()
    # time.sleep(3)  # Simulate brief delay for demo purposes
    return (
        jsonify(
            {
                "ok": True,
                "message": "Video processing started with SageMaker",
                "video_id": video_id,
                "status": "processing",
            }
        ),
        202,
    )


@videos_bp.get("/<video_id>/frame_annotated")
def get_video_frame_annotated(video_id: str):
    db = get_db()
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
        resize_width = 640  # request.args.get("width", type=int)
        new_height = int(frame_height * (resize_width / frame_width))
        frame = cv2.resize(frame, (resize_width, new_height))

        # sgm = SageMakerVideoProcessor()
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
def get_video_annotated_frames(video_id: str):
    """
    Fetch all frames for a video (metadata only, no image data).
    Supports demo videos by matching storage_url basename with frame 'key'.

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

    # First try to find frames by key (for demo videos)
    frames = []
    is_demo = False

    if storage_basename:
        key_query = {"key": storage_basename}
        if has_detections:
            key_query["detections_count"] = {"$gt": 0}

        frames = list(db.frames.find(key_query).sort("frame_number", 1))
        if frames:
            is_demo = True
            print(f"[DEMO] Found {len(frames)} frames by key '{storage_basename}'")

    # Fall back to video_id-based lookup
    if not frames:
        query = {"video_id": video_id}
        if has_detections:
            query["detections_count"] = {"$gt": 0}

        frames = list(db.frames.find(query).sort("frame_number", 1))

    # Use bson.json_util for proper serialization
    return Response(
        json_util.dumps(
            {
                "video_id": video_id,
                "is_demo": is_demo,
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

    # Check if we should use annotated video
    use_annotated = request.args.get("annotated", "false").lower() == "true"

    # Get the appropriate video URL
    if use_annotated:
        video_url = video.get("annotated_video_url")
        if not video_url:
            # Fall back to raw video if annotated not available
            video_url = video.get("storage_url")
    else:
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
@role_required(["admin", "surveyor", "viewer"])
def get_video_metadata(video_id: str):
    """
    Fetch the frame metadata JSON file for a specific video.
    This contains all detections for each frame with timestamps and coordinates.
    """
    import json

    db = get_db()
    video = db.videos.find_one({"_id": ObjectId(video_id)})

    if not video:
        return jsonify({"error": "Video not found"}), 404

    # Check if video has metadata URL
    metadata_url = video.get("frame_metadata_url")
    if not metadata_url:
        return jsonify({"error": "No metadata available for this video"}), 404

    # Get the metadata file path
    upload_root = Path(
        os.getenv("UPLOAD_DIR", Path(__file__).resolve().parents[1] / "uploads")
    )

    # Handle the path - could be /uploads/metadata/... or uploads/metadata/...
    filename = metadata_url.replace("/uploads/", "").lstrip("/")
    metadata_path = upload_root / filename

    print(f"[METADATA] Looking for: {metadata_path}")

    if not metadata_path.exists():
        return jsonify({"error": "Metadata file not found on server"}), 404

    try:
        # Read and return the metadata JSON
        with open(metadata_path, "r") as f:
            metadata = json.load(f)

        return jsonify(
            {
                "video_id": video_id,
                "metadata": metadata,
                "total_frames": len(metadata),
                "detections_count": sum(
                    len(frame.get("detections", [])) for frame in metadata
                ),
            }
        )

    except Exception as e:
        print(f"Error reading metadata file {metadata_path}: {e}")
        return jsonify({"error": f"Failed to read metadata: {str(e)}"}), 500


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
@role_required(["admin", "surveyor"])
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

    # 5. Final Database Update
    update_doc = {
        "storage_url": storage_url,
        "gpx_file_url": gpx_file_url,
        "thumbnail_url": thumbnail_url,
        "size_bytes": file_size,
        "status": "uploaded",
        "progress": 100,
        "updated_at": get_now_iso(),
    }

    if video_id:
        res = db.videos.find_one_and_update(
            {"_id": ObjectId(video_id)}, {"$set": update_doc}
        )
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
    return (
        jsonify(
            {
                "id": str(res.inserted_id),
                "item": {
                    **doc,
                    "_id": str(res.inserted_id),
                    "survey_id": str(survey_id),
                },
                "gpx_created": gpx_created,
            }
        ),
        201,
    )
