from flask import Flask, jsonify, send_from_directory
from flask_cors import CORS
from flask_jwt_extended import JWTManager, jwt_required, get_jwt_identity
from dotenv import load_dotenv

from config import Config
from db import init_app_db


def create_app() -> Flask:
	load_dotenv()
	app = Flask(__name__)
	app.config.from_object(Config())

	CORS(
		app,
		resources={
        r"/api/*": {"origins": app.config.get("CORS_ORIGINS", "*")},
        r"/uploads/*": {"origins": app.config.get("CORS_ORIGINS", "*")},
    	},
		supports_credentials=True,
		allow_headers=["Content-Type", "Authorization"],
		expose_headers=["Content-Type", "Authorization"],
		methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
	)
	JWTManager(app)

	init_app_db(app)

	from auth.routes import auth_bp  # noqa: WPS433
	from roads.routes import roads_bp
	from surveys.routes import surveys_bp
	from videos.routes import videos_bp
	from assets.routes import assets_bp
	from dashboard.routes import dashboard_bp
	from categories.routes import categories_bp, master_bp
	from ai.routes import ai_bp
	from tiles.routes import tiles_bp
	from frames.routes import frames_bp

	app.register_blueprint(auth_bp, url_prefix="/api/auth")
	app.register_blueprint(roads_bp, url_prefix="/api/roads")
	app.register_blueprint(surveys_bp, url_prefix="/api/surveys")
	app.register_blueprint(videos_bp, url_prefix="/api/videos")
	app.register_blueprint(assets_bp, url_prefix="/api/assets")
	app.register_blueprint(dashboard_bp, url_prefix="/api/dashboard")
	app.register_blueprint(categories_bp, url_prefix="/api/categories")
	app.register_blueprint(master_bp, url_prefix="/api/master")
	app.register_blueprint(ai_bp, url_prefix="/api/ai")
	app.register_blueprint(tiles_bp, url_prefix="/api/tiles")
	app.register_blueprint(frames_bp, url_prefix="/api/frames")

	# Handle OPTIONS requests globally (CORS preflight)
	@app.before_request
	def handle_preflight():
		from flask import request, make_response
		if request.method == "OPTIONS":
			response = make_response()
			response.headers.add("Access-Control-Allow-Origin", request.headers.get("Origin", "*"))
			response.headers.add("Access-Control-Allow-Headers", "Content-Type,Authorization")
			response.headers.add("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS,PATCH")
			response.headers.add("Access-Control-Allow-Credentials", "true")
			return response, 204

	# Serve uploaded files statically from /uploads
	import os
	upload_dir = os.getenv("UPLOAD_DIR") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "uploads")
	print(f"[UPLOADS] Upload directory: {upload_dir}")
	print(f"[UPLOADS] Upload directory exists: {os.path.exists(upload_dir)}")

	@ app.route('/uploads/<path:filename>')
	def uploaded_file(filename: str):
		from flask import send_file, make_response
		import mimetypes

		# Construct the full path to handle subdirectories
		file_path = os.path.join(upload_dir, filename)
		print(f"[UPLOADS] Requested: {filename}")
		print(f"[UPLOADS] Full path: {file_path}")
		print(f"[UPLOADS] Exists: {os.path.exists(file_path)}")

		if os.path.exists(file_path) and os.path.isfile(file_path):
			# Determine MIME type based on file extension
			mimetype, _ = mimetypes.guess_type(file_path)

			# Force correct MIME types for video files (critical for Chromium browsers)
			if filename.lower().endswith('.mp4'):
				mimetype = 'video/mp4'
			elif filename.lower().endswith('.webm'):
				mimetype = 'video/webm'
			elif filename.lower().endswith('.avi'):
				mimetype = 'video/x-msvideo'
			elif filename.lower().endswith('.mov'):
				mimetype = 'video/quicktime'
			elif filename.lower().endswith('.jpg') or filename.lower().endswith('.jpeg'):
				mimetype = 'image/jpeg'
			elif filename.lower().endswith('.png'):
				mimetype = 'image/png'
			elif filename.lower().endswith('.gpx'):
				mimetype = 'application/gpx+xml'

			# Default to octet-stream if type is unknown
			if not mimetype:
				mimetype = 'application/octet-stream'

			print(f"[UPLOADS] Serving with MIME type: {mimetype}")

			# Send file with proper MIME type and headers for video streaming
			response = make_response(send_file(
				file_path,
				mimetype=mimetype,
				conditional=True  # Enable range requests for video streaming
			))

			# Add headers for better browser compatibility (especially Chromium)
			response.headers['Accept-Ranges'] = 'bytes'
			response.headers['Cache-Control'] = 'public, max-age=43200'  # Cache for 12 hours
			# Add CORS headers for cross-origin requests
			response.headers['Access-Control-Allow-Origin'] = '*'
			response.headers['Access-Control-Allow-Methods'] = 'GET, OPTIONS'
			response.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization'

			return response

		# File not found - provide detailed error for debugging
		parent_dir = os.path.dirname(file_path)
		error_msg = {
			"error": "File not found",
			"requested_file": filename,
			"full_path": file_path,
			"upload_dir": upload_dir,
			"parent_exists": os.path.exists(parent_dir)
		}

		# List files in parent directory if it exists
		if os.path.exists(parent_dir) and os.path.isdir(parent_dir):
			try:
				files_in_dir = os.listdir(parent_dir)
				error_msg["files_in_parent"] = files_in_dir[:20]  # Limit to 20 files
				error_msg["file_count"] = len(files_in_dir)
			except Exception as e:
				error_msg["listing_error"] = str(e)

		print(f"[UPLOADS] Error details: {error_msg}")
		return jsonify(error_msg), 404

	@app.get("/api/health")
	def health():
		return jsonify({"status": "ok"})

	@app.get("/api/protected")
	@jwt_required()
	def protected():
		identity = get_jwt_identity()
		return jsonify({"message": "You are authenticated", "user": identity})

	return app


app = create_app()

if __name__ == "__main__":
	app.run(host="0.0.0.0", port=5001, debug=True)

