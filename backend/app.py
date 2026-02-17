from flask import Flask, jsonify, send_from_directory
from flask_cors import CORS
from flask_jwt_extended import JWTManager, jwt_required, get_jwt_identity
from flasgger import Swagger
from flask_swagger_ui import get_swaggerui_blueprint
from dotenv import load_dotenv

from config import Config
from db import init_app_db

def create_app() -> Flask:
	import os
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
	from assets.open_routes import open_assets_bp, open_routes_bp, open_videos_bp, open_surveys_bp
	from dashboard.routes import dashboard_bp
	from categories.routes import categories_bp, master_bp
	from ai.routes import ai_bp
	from tiles.routes import tiles_bp
	from frames.routes import frames_bp
	from user.routes import user_bp

	app.register_blueprint(auth_bp, url_prefix="/api/auth")
	app.register_blueprint(roads_bp, url_prefix="/api/roads")
	app.register_blueprint(surveys_bp, url_prefix="/api/surveys")
	app.register_blueprint(videos_bp, url_prefix="/api/videos")
	app.register_blueprint(assets_bp, url_prefix="/api/assets")
	app.register_blueprint(open_assets_bp, url_prefix="/api/public/assets")
	app.register_blueprint(open_routes_bp, url_prefix="/api/public/roads")
	# app.register_blueprint(open_videos_bp, url_prefix="/api/public/videos")
	app.register_blueprint(open_surveys_bp, url_prefix="/api/public/surveys")
	app.register_blueprint(dashboard_bp, url_prefix="/api/dashboard")
	app.register_blueprint(categories_bp, url_prefix="/api/categories")
	app.register_blueprint(master_bp, url_prefix="/api/master")
	app.register_blueprint(ai_bp, url_prefix="/api/ai")
	app.register_blueprint(tiles_bp, url_prefix="/api/tiles")
	app.register_blueprint(frames_bp, url_prefix="/api/frames")
	app.register_blueprint(user_bp, url_prefix="/api/users")

	def pr(rule):
		# print(rule.endpoint)
		return rule.endpoint.startswith("pub_")
	enable_swagger = os.environ.get("ENABLE_SWAGGER", "false") == "true"
	app.config['SWAGGER'] = {
		'title': 'API Documentation',
		'uiversion': 3,
		'specs': [
			{
				'endpoint': 'apispec',
				'route': '/api/docs/swagger.json',
				'rule_filter': lambda rule: not pr(rule),
				'model_filter': lambda tag: True,
			},
			{
				"endpoint": "assets_spec",
				"route": "/api/docs/assets_raw.json",
				# "rule_filter": lambda rule: rule.endpoint.startswith("asset_"),
				"rule_filter": lambda rule: pr(rule),
				"model_filter": lambda tag: True,
        	},
    	],
    	'static_url_path': '/flasgger_static',
		'securityDefinitions': {
        	'Bearer': {
				'type': 'apiKey',
				'name': 'Authorization',
				'in': 'header',
				'description': 'JWT Authorization header using the Bearer scheme. Example: "Authorization: Bearer {token}"'
        	}
    	},
		'specs_route': '/api/docs/main-docs'
	}

	# 1. Blueprint for the Main API
	main_docs_ui = get_swaggerui_blueprint(
		'/api/docs/main',
		'/api/docs/swagger.json',
		config={'app_name': "Main API Docs"}
	)

	# 2. Blueprint for the Assets API
	assets_docs_ui = get_swaggerui_blueprint(
		'/api/docs/assets',
		'/api/docs/assets.json',
		config={'app_name': "Assets API Docs"}
	)

	if enable_swagger:
		Swagger(app, template={
			"swagger": "2.0"
		})
		app.register_blueprint(main_docs_ui, name="main_swagger", url_prefix='/api/docs/main')
		app.register_blueprint(assets_docs_ui, name="assets_swagger", url_prefix='/api/docs/assets')
		# To hide security options
		@app.route('/api/docs/assets.json')
		def assets_spec_json():
			# call the internally-generated assets spec
			with app.test_client() as c:
				resp = c.get('/api/docs/assets_raw.json')
			spec = resp.get_json()

			if not spec:
				# return whatever error/empty result is appropriate
				return jsonify({}), 500

			# Remove top-level securityDefinitions and security
			spec.pop('securityDefinitions', None)
			spec.pop('security', None)

			# Remove per-operation 'security' entries (defensive)
			for path_item in spec.get('paths', {}).values():
				if not isinstance(path_item, dict):
					continue
				for op_obj in path_item.values():
					if isinstance(op_obj, dict):
						op_obj.pop('security', None)

			return jsonify(spec)
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

