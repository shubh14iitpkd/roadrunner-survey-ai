"""
ML Pipeline Service
Separate microservice for AI video processing to avoid blocking main backend
"""

from flask import Flask, jsonify, request
from flask_cors import CORS
import os
import sys
from pathlib import Path
from threading import Thread
import time
from pymongo import MongoClient
from bson import ObjectId
from datetime import datetime

# Add parent directory to path to import video processor
sys.path.append(str(Path(__file__).resolve().parents[1] / 'backend'))
from services.video_processor import VideoProcessor

app = Flask(__name__)
CORS(app)

# MongoDB connection with optimized settings for concurrent access
MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017/")
DB_NAME = os.getenv("MONGO_DB_NAME", "roadrunner_survey")

# Configure connection pool for concurrent access with main backend
client = MongoClient(
    MONGO_URI,
    maxPoolSize=50,  # Allow multiple connections
    minPoolSize=10,
    maxIdleTimeMS=45000,
    serverSelectionTimeoutMS=5000,
    connectTimeoutMS=10000,
    socketTimeoutMS=45000,
    retryWrites=True,
    w='majority',
    appName='ml-pipeline-service'  # Helps identify connections in logs
)
db = client[DB_NAME]

# Upload directory
UPLOAD_DIR = os.getenv("UPLOAD_DIR", str(Path(__file__).resolve().parents[1] / "backend" / "uploads"))

# Processing worker status
worker_running = False


def get_now_iso():
    """Get current timestamp in ISO format"""
    return datetime.utcnow().isoformat() + 'Z'


def process_job(job_id):
    """Process a single video job"""
    try:
        job = db.processing_jobs.find_one({"_id": ObjectId(job_id)})
        if not job:
            print(f"Job {job_id} not found")
            return

        video_id = job.get("video_id")
        video = db.videos.find_one({"_id": ObjectId(video_id)})

        if not video:
            db.processing_jobs.update_one(
                {"_id": ObjectId(job_id)},
                {"$set": {"status": "failed", "error": "Video not found", "updated_at": get_now_iso()}}
            )
            return

        storage_url = video.get("storage_url")
        if not storage_url:
            db.processing_jobs.update_one(
                {"_id": ObjectId(job_id)},
                {"$set": {"status": "failed", "error": "No video file", "updated_at": get_now_iso()}}
            )
            return

        # Update job status to processing
        db.processing_jobs.update_one(
            {"_id": ObjectId(job_id)},
            {"$set": {"status": "processing", "started_at": get_now_iso(), "updated_at": get_now_iso()}}
        )

        # Update video status
        db.videos.update_one(
            {"_id": ObjectId(video_id)},
            {"$set": {"status": "processing", "progress": 0, "updated_at": get_now_iso()}}
        )

        # Get paths
        upload_root = Path(UPLOAD_DIR)
        input_path = upload_root / storage_url.lstrip("/uploads/")

        # Generate output filename
        input_filename = input_path.stem
        output_filename = f"annotated_{input_filename}.mp4"
        output_path = upload_root / output_filename

        # Progress callback
        def update_progress(progress, status_msg):
            db.processing_jobs.update_one(
                {"_id": ObjectId(job_id)},
                {"$set": {"progress": progress, "status_message": status_msg, "updated_at": get_now_iso()}}
            )
            db.videos.update_one(
                {"_id": ObjectId(video_id)},
                {"$set": {"progress": progress, "processing_message": status_msg, "updated_at": get_now_iso()}}
            )

        # Process video
        print(f"Processing video {video_id} for job {job_id}")
        processor = VideoProcessor()
        stats = processor.process_video(
            str(input_path),
            str(output_path),
            progress_callback=update_progress
        )

        # Update records with results
        annotated_url = f"/uploads/{output_filename}"

        db.processing_jobs.update_one(
            {"_id": ObjectId(job_id)},
            {"$set": {
                "status": "completed",
                "progress": 100,
                "completed_at": get_now_iso(),
                "updated_at": get_now_iso(),
                "result": {
                    "annotated_video_url": annotated_url,
                    "stats": stats
                }
            }}
        )

        db.videos.update_one(
            {"_id": ObjectId(video_id)},
            {"$set": {
                "annotated_video_url": annotated_url,
                "status": "completed",
                "progress": 100,
                "processing_stats": stats,
                "updated_at": get_now_iso()
            }}
        )

        print(f"Job {job_id} completed successfully")

    except Exception as e:
        print(f"Error processing job {job_id}: {e}")
        import traceback
        traceback.print_exc()

        # Update job status to failed
        db.processing_jobs.update_one(
            {"_id": ObjectId(job_id)},
            {"$set": {
                "status": "failed",
                "error": str(e),
                "updated_at": get_now_iso()
            }}
        )

        # Update video status
        if 'video_id' in locals():
            db.videos.update_one(
                {"_id": ObjectId(video_id)},
                {"$set": {
                    "status": "error",
                    "error_message": str(e),
                    "updated_at": get_now_iso()
                }}
            )


def worker():
    """Background worker that processes jobs from queue"""
    global worker_running
    worker_running = True

    print("ML Pipeline Worker started")

    while worker_running:
        try:
            # Find pending job
            job = db.processing_jobs.find_one_and_update(
                {"status": "pending"},
                {"$set": {"status": "claimed", "updated_at": get_now_iso()}},
                sort=[("created_at", 1)]
            )

            if job:
                print(f"Found job {job['_id']}")
                process_job(str(job["_id"]))
            else:
                # No jobs, sleep for a bit
                time.sleep(5)

        except Exception as e:
            print(f"Worker error: {e}")
            import traceback
            traceback.print_exc()
            time.sleep(10)

    print("ML Pipeline Worker stopped")


@app.route("/health", methods=["GET"])
def health():
    """Health check endpoint"""
    return jsonify({
        "status": "ok",
        "service": "ml-pipeline",
        "worker_running": worker_running
    })


@app.route("/jobs", methods=["POST"])
def create_job():
    """Create a new processing job"""
    data = request.get_json() or {}
    video_id = data.get("video_id")

    if not video_id:
        return jsonify({"error": "video_id required"}), 400

    # Check if video exists
    video = db.videos.find_one({"_id": ObjectId(video_id)})
    if not video:
        return jsonify({"error": "Video not found"}), 404

    # Create job
    job = {
        "video_id": ObjectId(video_id),
        "status": "pending",
        "progress": 0,
        "created_at": get_now_iso(),
        "updated_at": get_now_iso()
    }

    result = db.processing_jobs.insert_one(job)
    job["_id"] = str(result.inserted_id)
    job["video_id"] = str(job["video_id"])

    return jsonify({"job": job}), 201


@app.route("/jobs/<job_id>", methods=["GET"])
def get_job(job_id):
    """Get job status"""
    job = db.processing_jobs.find_one({"_id": ObjectId(job_id)})

    if not job:
        return jsonify({"error": "Job not found"}), 404

    job["_id"] = str(job["_id"])
    job["video_id"] = str(job["video_id"])

    return jsonify({"job": job})


@app.route("/jobs", methods=["GET"])
def list_jobs():
    """List all jobs"""
    status = request.args.get("status")

    query = {}
    if status:
        query["status"] = status

    jobs = list(db.processing_jobs.find(query).sort("created_at", -1).limit(100))

    for job in jobs:
        job["_id"] = str(job["_id"])
        job["video_id"] = str(job["video_id"])

    return jsonify({"jobs": jobs, "count": len(jobs)})


@app.route("/worker/start", methods=["POST"])
def start_worker():
    """Start the background worker"""
    global worker_running

    if worker_running:
        return jsonify({"message": "Worker already running"})

    thread = Thread(target=worker, daemon=True)
    thread.start()

    return jsonify({"message": "Worker started"})


@app.route("/worker/stop", methods=["POST"])
def stop_worker():
    """Stop the background worker"""
    global worker_running
    worker_running = False

    return jsonify({"message": "Worker stopping..."})


if __name__ == "__main__":
    # Start worker automatically
    worker_thread = Thread(target=worker, daemon=True)
    worker_thread.start()

    # Start Flask app
    port = int(os.getenv("PORT", 5002))
    app.run(host="0.0.0.0", port=port, debug=False)
