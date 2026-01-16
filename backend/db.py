from typing import Any

from flask import Flask, g
from pymongo import MongoClient, ASCENDING, DESCENDING, TEXT


client: MongoClient | None = None


def get_client(app: Flask) -> MongoClient:
	global client  # noqa: WPS420
	if client is None:
		# Configure connection pool and timeouts for multiple services
		client = MongoClient(
			app.config["MONGO_URI"],
			uuidRepresentation="standard",
			maxPoolSize=50,  # Allow more connections
			minPoolSize=10,
			maxIdleTimeMS=45000,
			serverSelectionTimeoutMS=5000,
			connectTimeoutMS=10000,
			socketTimeoutMS=45000,
			retryWrites=True,
			w='majority'
		)
	return client


def get_db() -> Any:
	app = g.get("_app")
	if app is None:
		raise RuntimeError("Application context not set for DB access")
	client_local = get_client(app)
	return client_local[app.config["MONGO_DB_NAME"]]


def init_app_db(app: Flask) -> None:
	@app.before_request
	def attach_app_to_g():  # type: ignore[no-redef]
		g._app = app  # noqa: WPS437

	# Ensure indexes at startup
	db = get_client(app)[app.config["MONGO_DB_NAME"]]
	# Users
	try:
		db["users"].update_many(
			{"$and": [
				{"email_lower": {"$exists": False}},
				{"email": {"$type": "string"}},
			]},
			[{"$set": {"email_lower": {"$toLower": "$email"}}}],
		)
	except Exception:
		for u in db["users"].find({"$and": [
			{"email_lower": {"$exists": False}},
			{"email": {"$type": "string"}},
		]}).limit(10000):
			eml = (u.get("email") or "").lower()
			if eml:
				db["users"].update_one({"_id": u["_id"]}, {"$set": {"email_lower": eml}})

	db["users"].create_index([("email", ASCENDING)], unique=True, name="uniq_email")
	db["users"].create_index(
		[("email_lower", ASCENDING)],
		unique=True,
		name="uniq_email_lower",
		partialFilterExpression={"email_lower": {"$type": "string"}},
	)
	db["users"].create_index([("role", ASCENDING)], name="idx_role")

	# Roads
	db["roads"].create_index([("route_id", ASCENDING)], unique=True, name="uniq_route")
	db["roads"].create_index([("road_type", ASCENDING)], name="idx_road_type")
	db["roads"].create_index([("road_side", ASCENDING)], name="idx_road_side")
	db["roads"].create_index(
		[("road_name", TEXT), ("start_point_name", TEXT), ("end_point_name", TEXT)],
		name="roads_text",
		default_language="english",
	)

	# Surveys
	db["surveys"].create_index([("route_id", ASCENDING)], name="idx_surveys_route")
	db["surveys"].create_index([("survey_date", DESCENDING)], name="idx_surveys_date")
	db["surveys"].create_index([("status", ASCENDING)], name="idx_surveys_status")

	# Videos
	db["videos"].create_index([("survey_id", ASCENDING)], name="idx_videos_survey")
	db["videos"].create_index([("route_id", ASCENDING)], name="idx_videos_route")
	db["videos"].create_index([("status", ASCENDING)], name="idx_videos_status")
	db["videos"].create_index([("created_at", DESCENDING)], name="idx_videos_created")

	# Assets
	db["assets"].create_index([("survey_id", ASCENDING)], name="idx_assets_survey")
	db["assets"].create_index([("route_id", ASCENDING)], name="idx_assets_route")
	db["assets"].create_index([("category", ASCENDING)], name="idx_assets_category")
	db["assets"].create_index([("condition", ASCENDING)], name="idx_assets_condition")
	# Geo index (2dsphere)
	db["assets"].create_index([("location", "2dsphere")], name="idx_assets_geo")

	# Master data
	db["asset_categories"].create_index([("key", ASCENDING)], unique=True, name="uniq_category_key")
	db["asset_master"].create_index([("code", ASCENDING)], unique=True, name="uniq_asset_code")
	db["asset_master"].create_index([("category_key", ASCENDING)], name="idx_asset_category_key")

	# Dashboard cache (optional)
	db["dashboard_cache"].create_index([("key", ASCENDING), ("timeframe", ASCENDING)], unique=True, name="uniq_cache_key_timeframe")

	# AI chats
	db["ai_chats"].create_index([("user_id", ASCENDING), ("updated_at", DESCENDING)], name="idx_ai_chats_user_updated")
	db["ai_messages"].create_index([("chat_id", ASCENDING), ("created_at", ASCENDING)], name="idx_ai_msgs_chat_created")
	db["ai_messages"].create_index([("user_id", ASCENDING)], name="idx_ai_msgs_user")

	# Counters (no unique flag on _id)
	db["counters"].create_index([("_id", ASCENDING)], name="idx_counter_id")

