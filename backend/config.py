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

