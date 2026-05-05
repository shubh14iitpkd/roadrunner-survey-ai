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

	# Dashboard cache (optional)
	db["dashboard_cache"].create_index([("key", ASCENDING), ("timeframe", ASCENDING)], unique=True, name="uniq_cache_key_timeframe")

	# AI chats
	db["ai_chats"].create_index([("user_id", ASCENDING), ("updated_at", DESCENDING)], name="idx_ai_chats_user_updated")
	db["ai_messages"].create_index([("chat_id", ASCENDING), ("created_at", ASCENDING)], name="idx_ai_msgs_chat_created")
	db["ai_messages"].create_index([("user_id", ASCENDING)], name="idx_ai_msgs_user")

	# Counters (no unique flag on _id)
	db["counters"].create_index([("_id", ASCENDING)], name="idx_counter_id")

	# Master Assets — cross-survey asset identity
	db["master_assets"].create_index([("canonical_location", "2dsphere")], name="idx_master_geo")
	db["master_assets"].create_index([("asset_type", ASCENDING)], name="idx_master_asset_type")
	db["master_assets"].create_index([("route_id", ASCENDING)], name="idx_master_route")
	db["master_assets"].create_index([("master_display_id", ASCENDING)], unique=True, sparse=True, name="uniq_master_display_id")
	db["master_assets"].create_index([("latest_condition", ASCENDING)], name="idx_master_condition")
	db["master_assets"].create_index([("category_id", ASCENDING)], name="idx_master_category")
	db["master_assets"].create_index([("route_id", ASCENDING), ("latest_condition", ASCENDING)], name="idx_master_route_condition")
	db["master_assets"].create_index([("category_id", ASCENDING), ("latest_condition", ASCENDING)], name="idx_master_cat_condition")
	db["master_assets"].create_index([("zone", ASCENDING), ("side", ASCENDING)], name="idx_master_zone_side")
	db["master_assets"].create_index([("last_seen_date", DESCENDING)], name="idx_master_last_seen")
	db["master_assets"].create_index([("group_id", ASCENDING)], name="idx_master_group_id")
	# H3 cluster indexes were retired when map clustering moved client-side.
	# Drop on startup so writes aren't slowed maintaining unused indexes.
	for _idx in (
		"idx_master_h3_r8",
		"idx_master_h3_r10",
		"idx_master_h3r8_condition",
		"idx_master_h3r8_route",
	):
		try:
			db["master_assets"].drop_index(_idx)
		except Exception:
			pass
	# Search is served by an unanchored lookahead regex over multiple fields
	# ($or in _build_master_filter). No text index — it would have to be
	# kept in sync on every issue/group/route edit and the regex doesn't
	# use it anyway. Drop any text index from prior schemas.
	for _idx in ("idx_master_text", "idx_master_search_text"):
		try:
			db["master_assets"].drop_index(_idx)
		except Exception:
			pass

	# Assets — additional sort and linkage indexes
	db["assets"].create_index([("detected_at", DESCENDING)], name="idx_assets_detected")
	db["assets"].create_index([("created_at", DESCENDING)], name="idx_assets_created")
	db["assets"].create_index([("master_asset_id", ASCENDING), ("survey_id", ASCENDING)], name="idx_assets_master_survey")

	# Surveys — compound index for N+1-free latest-survey lookups
	db["surveys"].create_index([("route_id", ASCENDING), ("is_latest", ASCENDING)], name="idx_surveys_route_latest")

	# Dashboard cache — TTL expiry for auto-purging stale cache entries
	db["dashboard_cache"].create_index([("cached_at", ASCENDING)], expireAfterSeconds=300, name="ttl_cache_expiry")
