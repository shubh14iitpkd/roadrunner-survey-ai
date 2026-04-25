import os


class Config:
	def __init__(self) -> None:
		self.SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-change-me")
		self.JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "jwt-secret-change-me")
		self.MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
		self.MONGO_DB_NAME = os.getenv("MONGO_DB_NAME", "roadrunner")
		self.CORS_ORIGINS = os.getenv("CORS_ORIGINS", "*")
		# Explicit JWT config: headers only with Bearer tokens
		self.JWT_TOKEN_LOCATION = ["headers"]
		self.JWT_HEADER_NAME = "Authorization"
		self.JWT_HEADER_TYPE = "Bearer"
		# Allow large file uploads (10GB limit for videos)
		self.MAX_CONTENT_LENGTH = 10 * 1024 * 1024 * 1024  # 10GB in bytes
		self.AWS_REGION = os.getenv("AWS_REGION", "ap-south-1")
		self.AWS_ACCESS_KEY_ID = os.getenv("AWS_ACCESS_KEY_ID", "")
		self.AWS_SECRET_ACCESS_KEY = os.getenv("AWS_SECRET_ACCESS_KEY", "")
		# ── Job queue concurrency limits ──────────────────────────────────────
		# Set these env vars to control how many jobs of each type run in parallel.
		# Default is 1 for all (single GPU / single machine).
		self.MAX_CONCURRENT_ANONYMIZATION = int(os.getenv("MAX_CONCURRENT_ANONYMIZATION", "1"))
		self.MAX_CONCURRENT_AI_PROCESSING = int(os.getenv("MAX_CONCURRENT_AI_PROCESSING", "1"))
		self.MAX_CONCURRENT_ASSET_LINKING = int(os.getenv("MAX_CONCURRENT_ASSET_LINKING", "1"))
		# ── GPX road-snap (OSRM) ──────────────────────────────────────────────
		# Snapping runs synchronously during video upload. On any failure
		# (snapper unreachable, /match error, too few points) the raw GPX is
		# used unchanged — correction is best-effort.
		self.SNAPPER_URL = os.getenv("SNAPPER_URL", "http://localhost:5000")
		self.GPX_SNAP_ENABLED = os.getenv("GPX_SNAP_ENABLED", "true").lower() not in ("0", "false", "no")
		self.GPX_SNAP_RADIUS_M = float(os.getenv("GPX_SNAP_RADIUS_M", "50"))
		self.GPX_SNAP_MIN_CONFIDENCE = float(os.getenv("GPX_SNAP_MIN_CONFIDENCE", "0.3"))
		self.GPX_SNAP_BATCH_SIZE = int(os.getenv("GPX_SNAP_BATCH_SIZE", "100"))
		self.GPX_SNAP_BATCH_OVERLAP = int(os.getenv("GPX_SNAP_BATCH_OVERLAP", "5"))
		self.GPX_SNAP_TIMEOUT_S = int(os.getenv("GPX_SNAP_TIMEOUT_S", "30"))

