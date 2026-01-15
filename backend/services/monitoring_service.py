import os
import psutil
import shutil
from datetime import datetime, timedelta
from typing import Dict, List, Optional
from pymongo import DESCENDING

from db import get_db
from services.sagemaker_processor import SageMakerVideoProcessor

class MonitoringService:
    """
    Service for monitoring system health, active uploads, and processing jobs.
    """

    def __init__(self):
        self.db = get_db()
        self.sagemaker_processor = SageMakerVideoProcessor()

    def get_active_uploads(self) -> List[Dict]:
        """Get list of videos currently uploading."""
        cursor = self.db.videos.find(
            {"status": "uploading"},
            {"_id": 1, "title": 1, "progress": 1, "updated_at": 1, "size_bytes": 1}
        ).sort("updated_at", DESCENDING)
        
        uploads = []
        for doc in cursor:
            doc["_id"] = str(doc["_id"])
            uploads.append(doc)
        return uploads

    def get_active_processing(self) -> List[Dict]:
        """Get list of videos currently processing."""
        cursor = self.db.videos.find(
            {"status": "processing"},
            {"_id": 1, "title": 1, "progress": 1, "updated_at": 1, "eta": 1}
        ).sort("updated_at", DESCENDING)
        
        jobs = []
        for doc in cursor:
            doc["_id"] = str(doc["_id"])
            jobs.append(doc)
        return jobs

    def get_recent_failures(self, limit: int = 5) -> List[Dict]:
        """Get list of recently failed jobs."""
        cursor = self.db.videos.find(
            {"status": "failed"},
            {"_id": 1, "title": 1, "error": 1, "updated_at": 1}
        ).sort("updated_at", DESCENDING).limit(limit)
        
        failures = []
        for doc in cursor:
            doc["_id"] = str(doc["_id"])
            failures.append(doc)
        return failures

    def get_system_health(self) -> Dict:
        """Check system resources and external service health."""
        # Disk usage
        upload_dir = os.getenv("UPLOAD_DIR", "uploads")
        total, used, free = shutil.disk_usage(upload_dir if os.path.exists(upload_dir) else "/")
        disk_usage = {
            "total_gb": round(total / (1024**3), 2),
            "used_gb": round(used / (1024**3), 2),
            "free_gb": round(free / (1024**3), 2),
            "percent": round((used / total) * 100, 1)
        }

        # Memory usage
        mem = psutil.virtual_memory()
        memory_usage = {
            "total_gb": round(mem.total / (1024**3), 2),
            "available_gb": round(mem.available / (1024**3), 2),
            "percent": mem.percent
        }

        # SageMaker status
        sm_healthy, sm_msg = self.sagemaker_processor.check_endpoint_health()

        return {
            "disk": disk_usage,
            "memory": memory_usage,
            "sagemaker": {
                "status": "healthy" if sm_healthy else "unhealthy",
                "message": sm_msg
            },
            "timestamp": datetime.utcnow().isoformat()
        }

    def get_full_status(self) -> Dict:
        """Aggregate all monitoring data."""
        return {
            "uploads": self.get_active_uploads(),
            "processing": self.get_active_processing(),
            "failures": self.get_recent_failures(),
            "system": self.get_system_health()
        }
