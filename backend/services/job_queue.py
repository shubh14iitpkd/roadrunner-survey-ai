"""
Central job queue for GPU-intensive video processing tasks.

Backed by MongoDB for persistence across restarts, with configurable
concurrency limits per job type via Flask app config.

Job types:
  "anonymization"  — video anonymization (face/plate blurring)
  "ai_processing"  — YOLO inference + frame extraction
  "asset_linking"  — linking detected assets to master catalogue

Config keys (set via env vars):
  MAX_CONCURRENT_ANONYMIZATION   (default 1)
  MAX_CONCURRENT_AI_PROCESSING   (default 1)
  MAX_CONCURRENT_ASSET_LINKING   (default 1)
"""

import threading
import traceback
from bson import ObjectId

JOB_ANONYMIZATION = "anonymization"
JOB_AI_PROCESSING = "ai_processing"
JOB_ASSET_LINKING = "asset_linking"

ALL_JOB_TYPES = [JOB_ANONYMIZATION, JOB_AI_PROCESSING, JOB_ASSET_LINKING]

_CONFIG_KEYS = {
    JOB_ANONYMIZATION: "MAX_CONCURRENT_ANONYMIZATION",
    JOB_AI_PROCESSING: "MAX_CONCURRENT_AI_PROCESSING",
    JOB_ASSET_LINKING: "MAX_CONCURRENT_ASSET_LINKING",
}


def _get_now_iso():
    from utils.ids import get_now_iso
    return get_now_iso()


class VideoJobQueue:
    """Thread-safe, MongoDB-backed job queue for video processing."""

    POLL_INTERVAL = 10

    def __init__(self):
        self._app = None
        self._lock = threading.Lock()
        self._stop_event = threading.Event()
        self._handlers = {}  # job_type -> callable(app, video_id, payload)

    # ── Public API ────────────────────────────────────────────────────────────

    def init_app(self, app):
        """Bind to Flask app and start background poller."""
        self._app = app
        self._ensure_indexes()
        self._recover_stuck_jobs()
        t = threading.Thread(target=self._worker_loop, daemon=True, name="job-queue-worker")
        t.start()
        print("[QUEUE] Job queue worker started")

    def register_handler(self, job_type: str, handler):
        """Register handler callable(app, video_id, payload) for a job type."""
        self._handlers[job_type] = handler

    def enqueue(self, job_type: str, video_id: str, payload: dict = None) -> str:
        """
        Insert a job into the queue and immediately try to dispatch.
        Does NOT touch video status — caller is responsible for setting it.
        Returns the inserted job _id as a string.
        """
        now = _get_now_iso()
        job = {
            "job_type": job_type,
            "video_id": video_id,
            "status": "pending",
            "payload": payload or {},
            "created_at": now,
            "updated_at": now,
        }
        with self._app.app_context():
            from db import get_client
            db = get_client(self._app)[self._app.config["MONGO_DB_NAME"]]
            result = db.processing_queue.insert_one(job)

        print(f"[QUEUE] Enqueued {job_type} for video {video_id}")
        # Trigger dispatch in a background thread so we don't block the caller.
        threading.Thread(target=self._try_dispatch, daemon=True,
                         name="queue-dispatch").start()
        return str(result.inserted_id)

    # ── Internal helpers ──────────────────────────────────────────────────────

    def _worker_loop(self):
        while not self._stop_event.is_set():
            try:
                self._try_dispatch()
            except Exception as e:
                print(f"[QUEUE] Worker loop error: {e}")
            self._stop_event.wait(self.POLL_INTERVAL)

    def _try_dispatch(self):
        """Atomically pick up pending jobs that fit within concurrency limits."""
        with self._lock:
            with self._app.app_context():
                from db import get_client
                db = get_client(self._app)[self._app.config["MONGO_DB_NAME"]]

                for job_type in ALL_JOB_TYPES:
                    max_c = self._max_concurrent(job_type)
                    running = db.processing_queue.count_documents(
                        {"job_type": job_type, "status": "running"}
                    )
                    slots = max_c - running
                    for _ in range(slots):
                        job = db.processing_queue.find_one_and_update(
                            {"job_type": job_type, "status": "pending"},
                            {"$set": {"status": "running",
                                      "started_at": _get_now_iso(),
                                      "updated_at": _get_now_iso()}},
                            sort=[("created_at", 1)],
                            return_document=True,
                        )
                        if job is None:
                            break
                        print(f"[QUEUE] Dispatching {job_type} job {job['_id']} "
                              f"for video {job['video_id']}")
                        threading.Thread(
                            target=self._execute_job,
                            args=(job,),
                            daemon=True,
                            name=f"job-{job_type}-{job['video_id']}",
                        ).start()

    def _execute_job(self, job):
        try:
            handler = self._handlers.get(job["job_type"])
            if handler is None:
                raise RuntimeError(f"No handler for job type: {job['job_type']}")
            handler(self._app, job["video_id"], job.get("payload", {}))
            self._mark_job(job["_id"], "completed")
            print(f"[QUEUE] Completed {job['job_type']} for video {job['video_id']}")
        except Exception as e:
            print(f"[QUEUE] Failed {job['job_type']} for video {job['video_id']}: {e}")
            traceback.print_exc()
            self._mark_job(job["_id"], "failed", error=str(e))
        finally:
            self._try_dispatch()

    def _mark_job(self, job_id, status: str, error: str = None):
        with self._app.app_context():
            from db import get_client
            db = get_client(self._app)[self._app.config["MONGO_DB_NAME"]]
            upd = {"status": status,
                   "completed_at": _get_now_iso(),
                   "updated_at": _get_now_iso()}
            if error:
                upd["error"] = error
            db.processing_queue.update_one({"_id": job_id}, {"$set": upd})

    def _max_concurrent(self, job_type: str) -> int:
        key = _CONFIG_KEYS.get(job_type, "MAX_CONCURRENT_AI_PROCESSING")
        return self._app.config.get(key, 1)

    def _ensure_indexes(self):
        with self._app.app_context():
            from db import get_client
            db = get_client(self._app)[self._app.config["MONGO_DB_NAME"]]
            db.processing_queue.create_index(
                [("job_type", 1), ("status", 1), ("created_at", 1)],
                name="idx_queue_dispatch",
            )

    def _recover_stuck_jobs(self):
        """Reset jobs that were left 'running' due to a previous crash."""
        with self._app.app_context():
            from db import get_client
            db = get_client(self._app)[self._app.config["MONGO_DB_NAME"]]
            stuck = list(db.processing_queue.find({"status": "running"}))
            for job in stuck:
                db.processing_queue.update_one(
                    {"_id": job["_id"]},
                    {"$set": {"status": "pending", "updated_at": _get_now_iso()}},
                )
                # Reset video to queued so the UI reflects waiting state
                db.videos.update_one(
                    {"_id": ObjectId(job["video_id"])},
                    {"$set": {"status": "queued", "progress": 0,
                              "updated_at": _get_now_iso()}},
                )
            if stuck:
                print(f"[QUEUE] Recovered {len(stuck)} stuck jobs on startup")


# Module-level singleton
job_queue = VideoJobQueue()
