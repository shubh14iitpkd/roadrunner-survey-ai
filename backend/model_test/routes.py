"""
Routes for standalone model testing.
Upload a video → run YOLO annotation → download annotated video.
Jobs tracked in MongoDB `test_videos` collection.
"""

import os
import uuid
import threading
from datetime import datetime
from pathlib import Path

from bson import ObjectId
from flask import Blueprint, request, jsonify, send_file, current_app

from flask import g
from db import get_db, get_client

model_test_bp = Blueprint("model_test", __name__)

# Base directory for model test uploads
UPLOAD_BASE = Path(__file__).resolve().parent.parent / "uploads" / "model_test"


def _get_annotator():
    """Lazy-load the annotator to avoid loading the model at import time."""
    if not hasattr(_get_annotator, "_instance"):
        from model_test.annotator import VideoAnnotator
        _get_annotator._instance = VideoAnnotator()
    return _get_annotator._instance


def _process_video_background(job_id: str, input_path: str, output_path: str, app):
    """Background thread: run annotation and update job status in DB."""
    with app.app_context():
        # Use get_client directly to avoid g._app dependency in background threads
        client = get_client(app)
        db = client[app.config["MONGO_DB_NAME"]]
        collection = db["test_videos"]

        try:
            annotator = _get_annotator()

            def on_progress(current, total):
                pct = int((current / total) * 100) if total > 0 else 0
                collection.update_one(
                    {"_id": ObjectId(job_id)},
                    {"$set": {
                        "progress": pct,
                        "message": f"Processing frame {current}/{total}",
                        "updated_at": datetime.utcnow(),
                    }},
                )

            summary = annotator.annotate_video(
                input_path=input_path,
                output_path=output_path,
                frame_interval=1,
                progress_callback=on_progress,
            )

            collection.update_one(
                {"_id": ObjectId(job_id)},
                {"$set": {
                    "status": "completed",
                    "progress": 100,
                    "message": "Annotation complete",
                    "summary": summary,
                    "output_path": output_path,
                    "updated_at": datetime.utcnow(),
                }},
            )
            print(f"[MODEL-TEST] Job {job_id} completed. Detections: {summary.get('total_detections', 0)}")

        except Exception as e:
            print(f"[MODEL-TEST] Job {job_id} failed: {e}")
            import traceback
            traceback.print_exc()
            collection.update_one(
                {"_id": ObjectId(job_id)},
                {"$set": {
                    "status": "failed",
                    "message": str(e),
                    "updated_at": datetime.utcnow(),
                }},
            )


@model_test_bp.route("/upload", methods=["POST"])
def upload_video():
    """
    Upload a video for model testing.
    ---
    tags:
      - Model Test
    consumes:
      - multipart/form-data
    parameters:
      - name: file
        in: formData
        type: file
        required: true
        description: Video file to annotate
    responses:
      200:
        description: Upload successful, processing started
      400:
        description: No file provided
    """
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    file = request.files["file"]
    if file.filename == "":
        return jsonify({"error": "No file selected"}), 400

    # Validate file extension
    allowed_ext = {".mp4", ".avi", ".mov", ".webm", ".mkv"}
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in allowed_ext:
        return jsonify({"error": f"Unsupported format. Allowed: {', '.join(allowed_ext)}"}), 400

    db = get_db()
    collection = db["test_videos"]

    # Create job document
    job_doc = {
        "status": "uploading",
        "progress": 0,
        "message": "Uploading video...",
        "original_filename": file.filename,
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow(),
    }
    result = collection.insert_one(job_doc)
    job_id = str(result.inserted_id)

    # Create job directory
    job_dir = UPLOAD_BASE / job_id
    job_dir.mkdir(parents=True, exist_ok=True)

    input_path = str(job_dir / f"input{ext}")
    output_path = str(job_dir / "annotated.mp4")

    # Save uploaded file
    file.save(input_path)
    file_size = os.path.getsize(input_path)

    # Update job status
    collection.update_one(
        {"_id": ObjectId(job_id)},
        {"$set": {
            "status": "processing",
            "message": "Starting annotation...",
            "input_path": input_path,
            "file_size": file_size,
            "updated_at": datetime.utcnow(),
        }},
    )

    # Start background processing
    app = current_app._get_current_object()
    thread = threading.Thread(
        target=_process_video_background,
        args=(job_id, input_path, output_path, app),
        daemon=True,
    )
    thread.start()

    return jsonify({
        "job_id": job_id,
        "status": "processing",
        "message": "Video uploaded, annotation started",
    })


@model_test_bp.route("/status/<job_id>", methods=["GET"])
def get_job_status(job_id: str):
    """
    Get the status of an annotation job.
    ---
    tags:
      - Model Test
    parameters:
      - name: job_id
        in: path
        type: string
        required: true
    responses:
      200:
        description: Job status
      404:
        description: Job not found
    """
    try:
        oid = ObjectId(job_id)
    except Exception:
        return jsonify({"error": "Invalid job ID"}), 400

    db = get_db()
    job = db["test_videos"].find_one({"_id": oid})
    if not job:
        return jsonify({"error": "Job not found"}), 404

    return jsonify({
        "job_id": job_id,
        "status": job.get("status", "unknown"),
        "progress": job.get("progress", 0),
        "message": job.get("message", ""),
        "summary": job.get("summary"),
        "original_filename": job.get("original_filename"),
        "created_at": job.get("created_at", "").isoformat() if job.get("created_at") else None,
    })


@model_test_bp.route("/download/<job_id>", methods=["GET"])
def download_annotated(job_id: str):
    """
    Download the annotated video.
    ---
    tags:
      - Model Test
    parameters:
      - name: job_id
        in: path
        type: string
        required: true
    responses:
      200:
        description: Annotated video file
      404:
        description: Job not found or not completed
    """
    try:
        oid = ObjectId(job_id)
    except Exception:
        return jsonify({"error": "Invalid job ID"}), 400

    db = get_db()
    job = db["test_videos"].find_one({"_id": oid})
    if not job:
        return jsonify({"error": "Job not found"}), 404

    if job.get("status") != "completed":
        return jsonify({"error": "Job not completed yet", "status": job.get("status")}), 400

    output_path = job.get("output_path")
    if not output_path or not os.path.exists(output_path):
        return jsonify({"error": "Annotated video file not found"}), 404

    # Generate download filename
    orig = job.get("original_filename", "video.mp4")
    name, _ = os.path.splitext(orig)
    download_name = f"{name}_annotated.mp4"

    return send_file(
        output_path,
        mimetype="video/mp4",
        as_attachment=True,
        download_name=download_name,
    )
