import os
import re
import math
import time
import gzip
import logging
import hashlib

from flask import Blueprint, Response, jsonify, request

log = logging.getLogger(__name__)
from bson import ObjectId
from pymongo import ASCENDING, DESCENDING

from db import get_db
from utils.ids import get_now_iso
from utils.is_demo_video import is_demo
from utils.rbac import role_required
from utils.response import mongo_response, fast_mongo_response
from cache import (
	cache_get_body,
	cache_set_body,
	make_key as cache_make_key,
	invalidate_assets_cache,
)

assets_bp = Blueprint("assets", __name__)


@assets_bp.after_request
def _invalidate_cache_after_writes(response):
	"""Wipe assets:* cache after every successful write. Catches every
	mutation route in this blueprint without per-handler boilerplate."""
	if request.method in ("POST", "PUT", "PATCH", "DELETE") and 200 <= response.status_code < 400:
		try:
			invalidate_assets_cache()
		except Exception:  # noqa: BLE001
			pass
	return response


def _propagate_group_rename(db, old_group_id: str, new_group_id: str):
	"""
	Propagate a group_id rename across all collections that store it.
	Called after system_asset_labels has already been updated.
	"""
	if not old_group_id or not new_group_id or old_group_id == new_group_id:
		return
	update = {"$set": {"group_id": new_group_id}}
	filt = {"group_id": old_group_id}
	db.assets.update_many(filt, update)
	db.master_assets.update_many(filt, update)
	db.video_lib_assets.update_many(filt, update)


def _propagate_category_move(db, asset_ids: list[str], new_category_id: str):
	"""
	Propagate a category_id change across all 6 collections.
	system_asset_labels is assumed to be updated already by the caller.
	For frames / frames_lib the category_id lives inside the detections array.
	"""
	if not asset_ids or not new_category_id:
		return
	filt = {"asset_id": {"$in": asset_ids}}
	update = {"$set": {"category_id": new_category_id}}

	# Top-level category_id collections
	db.assets.update_many(filt, update)
	db.master_assets.update_many(filt, update)
	db.video_lib_assets.update_many(filt, update)

	# Nested detections[].category_id in frames / frames_lib
	frame_filt = {"detections.asset_id": {"$in": asset_ids}}
	frame_update = {"$set": {"detections.$[elem].category_id": new_category_id}}
	array_filters = [{"elem.asset_id": {"$in": asset_ids}}]
	db.frames.update_many(frame_filt, frame_update, array_filters=array_filters)
	db.frames_lib.update_many(frame_filt, frame_update, array_filters=array_filters)


@assets_bp.get("/", endpoint="assets_list_paginated")
@role_required(["super_admin","admin", "surveyor", "viewer"])
def list_assets_paginated():
	"""
	List assets with filters and pagination
	---
	tags:
	  - Assets
	security:
	  - Bearer: []
	parameters:
	  - name: survey_id
	    in: query
	    type: string
	    description: Filter by survey ID
	  - name: route_id
	    in: query
	    type: integer
	    description: Filter by route ID
	  - name: category
	    in: query
	    type: string
	    description: Filter by category
	  - name: condition
	    in: query
	    type: string
	    description: Filter by condition
	  - name: side
	    in: query
	    type: string
	    description: Filter by road side
	  - name: zone
	    in: query
	    type: string
	    description: Filter by zone
	responses:
	  200:
	    description: Assets retrieved successfully
	    schema:
	      type: object
	      properties:
	        items:
	          type: array
	          items:
	            type: object
	        count:
	          type: integer
	"""
	query = {}
	survey_id = request.args.get("survey_id")
	route_id = request.args.get("route_id", type=int)
	category = request.args.get("category")
	condition = request.args.get("condition")
	zone = request.args.get("zone")
	road_side = request.args.get("side")
	page =  int(request.args.get("page", "1"))
	limit = int(request.args.get("limit", "10"))
	skip = limit*(page-1)
	
	db = get_db()

	if survey_id:
		# Find all videos belonging to this survey
		survey_videos = list(db.videos.find(
			{"survey_id": ObjectId(survey_id)},
			{"storage_url": 1}
		))

		# Collect video_keys (basenames) for any demo videos
		demo_video_keys = []
		has_real_videos = False
		for v in survey_videos:
			if is_demo(video_file=v):
				url = v.get("storage_url", "")
				basename = os.path.splitext(os.path.basename(url))[0]
				if basename:
					demo_video_keys.append(basename)
			else:
				has_real_videos = True

		# Build the survey/video_key filter using $or
		or_conditions = []
		if has_real_videos:
			or_conditions.append({"survey_id": ObjectId(survey_id)})
		if demo_video_keys:
			or_conditions.append({"video_key": {"$in": demo_video_keys}})

		if or_conditions:
			query["$or"] = or_conditions
		else:
			query["survey_id"] = ObjectId(survey_id)

	if route_id is not None:
		query["route_id"] = route_id
	if category:
		query["category"] = category
	if condition:
		query["condition"] = condition
	if zone:
		query["zone"] = zone
	if road_side:
		query["side"] = road_side

	items = list(db.assets.find(query, {"embedding": 0}).skip(skip).limit(limit).sort("created_at", DESCENDING))
	total_asstes = db.assets.count_documents(query)
	total_pages = math.ceil(total_asstes/limit)
	return mongo_response({"items": items, "total_count": total_asstes, "total_pages": total_pages, "page": page, "limit": limit})

@assets_bp.get("/all", endpoint="assets_list")
@role_required(["super_admin","admin", "surveyor", "viewer"])
def list_assets():
	"""
	List all assets with filters
	---
	tags:
	  - Assets
	security:
	  - Bearer: []
	parameters:
	  - name: survey_id
	    in: query
	    type: string
	    description: Filter by survey ID
	  - name: route_id
	    in: query
	    type: integer
	    description: Filter by route ID
	  - name: category
	    in: query
	    type: string
	    description: Filter by category
	  - name: condition
	    in: query
	    type: string
	    description: Filter by condition
	responses:
	  200:
	    description: Assets retrieved successfully
	    schema:
	      type: object
	      properties:
	        items:
	          type: array
	          items:
	            type: object
	        count:
	          type: integer
	"""
	query = {}
	survey_id = request.args.get("survey_id")
	route_id = request.args.get("route_id", type=int)
	category = request.args.get("category")
	condition = request.args.get("condition")
	zone = request.args.get("zone")
	road_side = request.args.get("side")

	db = get_db()

	if survey_id:
		# Find all videos belonging to this survey
		survey_videos = list(db.videos.find(
			{"survey_id": ObjectId(survey_id)},
			{"storage_url": 1}
		))

		# Collect video_keys (basenames) for any demo videos
		demo_video_keys = []
		has_real_videos = False
		for v in survey_videos:
			if is_demo(video_file=v):
				url = v.get("storage_url", "")
				basename = os.path.splitext(os.path.basename(url))[0]
				if basename:
					demo_video_keys.append(basename)
			else:
				has_real_videos = True

		# Build the survey/video_key filter using $or
		or_conditions = []
		if has_real_videos:
			or_conditions.append({"survey_id": ObjectId(survey_id)})
		if demo_video_keys:
			or_conditions.append({"video_key": {"$in": demo_video_keys}})

		if or_conditions:
			query["$or"] = or_conditions
		else:
			query["survey_id"] = ObjectId(survey_id)

	if route_id is not None:
		query["route_id"] = route_id
	if category:
		query["category"] = category
	if condition:
		query["condition"] = condition
	if zone:
		query["zone"] = zone
	if road_side:
		query["side"] = road_side

	# Sort by created_at — that's the field asset_linker actually writes;
	# detected_at is set by the manual-annotations path only, so sorting on
	# it returned legacy/AI-pipeline assets in undefined order.
	items = list(db.assets.find(query, {"embedding": 0}).sort("created_at", DESCENDING))
	return mongo_response({"items": items, "count": len(items)})


@assets_bp.get("/<asset_id>", endpoint="assets_get_id")
@role_required(["super_admin", "admin", "surveyor", "viewer"])
def get_asset(asset_id: str):
	"""
	Get asset details
	---
	tags:
	  - Assets
	security:
	  - Bearer: []
	parameters:
	  - name: asset_id
	    in: path
	    type: string
	    required: true
	    description: The ID of the asset
	responses:
	  200:
	    description: Asset details retrieved successfully
	  404:
	    description: Asset not found
	"""
	db = get_db()
	it = db.assets.find_one({"_id": ObjectId(asset_id)})
	if not it:
		return mongo_response({"error": "not found"}, 404)
	return mongo_response({"item": it})

@assets_bp.get("/master/<master_display_id>", endpoint="assets_master_single")
@role_required(["super_admin","admin", "surveyor", "viewer"])
def get_master_asset_by_display_id(master_display_id: str):
	"""
	Get a single master asset by its master_display_id.
	Returns the master asset document with the latest survey observation details.
	---
	tags:
	  - Assets
	security:
	  - Bearer: []
	parameters:
	  - name: master_display_id
	    in: path
	    type: string
	    required: true
	    description: The master display ID (e.g. MAST-000001)
	responses:
	  200:
	    description: Master asset document
	  404:
	    description: Not found
	"""
	db = get_db()
	master = db["master_assets"].find_one({"master_display_id": master_display_id})
	if not master:
		return mongo_response({"error": "Master asset not found"}, 404)
	# Exclude the heavy embedding vector — not needed by the frontend
	master.pop("embedding", None)
	return fast_mongo_response({"item": master})


@assets_bp.post("/master", endpoint="assets_master_lib")
@role_required(["super_admin","admin", "surveyor", "viewer"])
def get_master_assets():
	"""
	List master assets with filters for master library.
	Reads from the master_assets collection which stores cross-survey
	asset identities linked via embeddings.
	---
	tags:
	  - Assets
	security:
	  - Bearer: []
	parameters:
	  - name: route_id
	    in: query
	    type: integer
	    description: Filter by route ID
	  - name: category
	    in: query
	    type: string
	    description: Filter by category
	  - name: condition
	    in: query
	    type: string
	    description: Filter by condition (latest)
	  - name: side
	    in: query
	    type: string
	    description: Filter by road side
	  - name: zone
	    in: query
	    type: string
	    description: Filter by zone
	responses:
	  200:
	    description: Master assets retrieved successfully
	    schema:
	      type: object
	      properties:
	        items:
	          type: array
	          items:
	            type: object
	        asset_count:
	          type: integer
	"""
	db = get_db()
	query = _build_master_filter(request.args)

	# Slim list: route_name, road_side, latest_frame_number, latest_video_id, latest_box,
	# latest_defect_id, and latest_description are denormalized onto master_assets
	# (see asset_linker.py + migrate_denormalize_master_assets.py), so no $lookup needed.
	pipeline = [
		{"$match": query},
		{
			"$addFields": {
				"condition": "$latest_condition",
				"confidence": "$latest_confidence",
				"location": "$canonical_location",
				"description": {"$ifNull": ["$latest_description", None]},
				# survey_count replaces the full survey_history array for the list view
				"survey_count": {"$size": "$survey_history"},
				# Convert ObjectIds to strings so orjson can serialize them directly
				# and the frontend skips the {$oid: "..."} unwrapping.
				"_id": {"$toString": "$_id"},
				"latest_survey_id": {"$toString": "$latest_survey_id"},
				"latest_video_id": {"$toString": "$latest_video_id"},
			}
		},
		{
			"$project": {
				"embedding": 0,        # no need to send 512-d vector to the browser
				"modified_by": 0,      # legacy field, replaced by asset_condition_logs
				"mark_good_history": 0, # legacy field, replaced by asset_condition_logs
				"survey_history": 0,   # fetched on-demand via GET /api/assets/master/<id>
			}
		},
	]
	all_assets = list(db.master_assets.aggregate(pipeline))

	# Also return routes + surveys metadata (as before)
	all_roads = list(db.roads.find({}, {"route_id": 1, "road_name": 1, "road_side": 1}))
	all_surveys = list(db.surveys.find({"is_latest": True}))

	return fast_mongo_response({
		"items": all_assets,
		"asset_count": len(all_assets),
		"routes": all_roads,
		"route_count": len(all_roads),
		"surveys": all_surveys,
		"survey_count": len(all_surveys),
	})


# Damaged condition aliases — must match the frontend DAMAGED_CONDITIONS set
_DAMAGED_CONDITIONS = [
	"damaged", "overgrown", "fadedpaint", "dirty", "missing", "broken", "bent",
]


def _build_master_filter(args):
	"""Build a MongoDB query dict from the shared filter params used by
	paginated, map-points, and master library endpoints."""
	query = {}
	route_id = args.get("route_id", type=int)
	if route_id is not None:
		query["route_id"] = route_id
	category = args.get("category")
	if category:
		query["category_id"] = category
	condition = args.get("condition")
	if condition:
		# "damaged" in the UI means any of the damaged aliases
		if condition == "damaged":
			query["latest_condition"] = {"$in": _DAMAGED_CONDITIONS}
		else:
			query["latest_condition"] = condition
	zone = args.get("zone")
	if zone:
		query["zone"] = zone
	side = args.get("side")
	if side:
		query["side"] = side
	asset_type = args.get("asset_type")
	if asset_type:
		# Frontend sends group_id (display name from label map).
		# master_assets stores this in the group_id field.
		query["group_id"] = asset_type
	search = (args.get("search") or "").strip()
	if search:
		# Order-independent AND across all words. Lookahead per word lets a
		# user type "light head" or "head light" and match "Street Light Head"
		# either way. `group_id` carries the user-visible display name, so
		# searches against asset type land here (not on `asset_type`, which
		# is a raw token like "street_light_head" and was never the intended
		# search target).
		words = [re.escape(w) for w in search.split() if w]
		pattern = "".join(f"(?=.*{w})" for w in words) + ".*"
		regex = {"$regex": pattern, "$options": "is"}
		query["$or"] = [
			{"master_display_id": regex},
			{"group_id": regex},
			{"route_name": regex},
			{"issue": regex},
			{"latest_defect_id": regex},
		]
	return query


def _map_points_full(db, query, include_defect):
	"""Returns the full filtered dataset in columnar form.

	Map clustering is done client-side via supercluster — server just emits
	a flat columnar set of all points (and lines, with geometry) matching
	the filters. Pan/zoom never re-hits the server."""
	projection = {
		"_id": 0,
		"master_display_id": 1,
		"asset_id": 1,
		"canonical_location": 1,
		"latest_condition": 1,
		"group_id": 1,
		"side": 1,
		"zone": 1,
		"route_id": 1,
		"route_name": 1,
		"category_id": 1,
		# Linear-asset fields. keypoints fetched on-demand via /master/<id>/keypoints.
		# Bulk ships ONLY geometry_simplified (Douglas-Peucker ~2m). Full
		# `geometry` is fetched on-click via /master/<id>/geometry — no point
		# paying the wire cost for every line on initial paint.
		# first_frame/last_frame previously projected but never read by frontend.
		"kind": 1,
		"classification": 1,
		"geometry_simplified": 1,
	}
	if include_defect:
		projection["latest_defect_id"] = 1
		projection["issue"] = 1
	# batch_size(2000) cuts pymongo round-trips on large result sets — default
	# 101 means a 50k-asset scan does ~500 GETMOREs, dominated by network RTT.
	cursor = db.master_assets.find(query, projection).batch_size(2000)
	t0 = time.perf_counter()
	resp = _build_columnar_points(cursor, include_defect, mode="full")
	t1 = time.perf_counter()
	# Profiling: cursor drain + Python loop + orjson serialize, all-in. Pair
	# with the count from the response to spot loop-vs-network dominance.
	print(f"[map-points] build={t1 - t0:.3f}s bytes={len(resp.get_data())} query={query}", flush=True)
	return resp



def _build_columnar_points(cursor, include_defect, mode):
	"""Drain a master_assets cursor into a columnar JSON response.

	Columnar = parallel arrays per field (vs an array of objects). Smaller
	wire size + better gzip compression for repeated keys, and lets the
	frontend index by position without per-row deserialization.

	Payload trims at 1M-asset scale:
	  - `asset_type` dropped — frontend resolves display name from
	    `asset_id` via the label map; fallback handles the rare missing case.
	  - `kinds` dropped — replaced with `line_ids` (the small set of master
	    display IDs that are linear). Default is "point".
	  - `route_names` dropped — replaced with `route_dict` keyed by
	    `route_id`. Lots of rows share a handful of route names; the dict
	    deduplicates them on the wire and in the JS heap.
	  - `last_seen_date` dropped entirely — no map consumer reads it
	    (markers/lines don't display dates). The detail panel pulls dates
	    via the dedicated /master/<id> endpoint, so the map payload doesn't
	    need to carry them.
	"""
	ids: list[str] = []
	asset_ids: list[str] = []
	lats: list[float] = []
	lngs: list[float] = []
	conditions: list[str] = []
	group_ids: list[str | None] = []
	sides: list[str] = []
	zones: list[str] = []
	route_ids: list[int | None] = []
	category_ids: list[str] = []
	defect_ids: list[str] = []
	issues: list[str] = []
	line_ids: list[str] = []
	line_extras: dict[str, dict] = {}
	# Keys are stringified — orjson rejects non-str dict keys, and the
	# frontend already does `routeDict[String(rid)]` lookups.
	route_dict: dict[str, str] = {}

	for doc in cursor:
		coords = (doc.get("canonical_location") or {}).get("coordinates", [0, 0])
		kind = doc.get("kind") or "point"

		display_id = doc.get("master_display_id", "")
		ids.append(display_id)
		asset_ids.append(doc.get("asset_id", ""))
		lats.append(coords[1] if len(coords) > 1 else 0)
		lngs.append(coords[0] if len(coords) > 0 else 0)
		conditions.append(doc.get("latest_condition", "unknown"))
		group_ids.append(doc.get("group_id"))
		sides.append(doc.get("side", "Unknown"))
		zones.append(doc.get("zone", "Unknown"))
		rid = doc.get("route_id")
		route_ids.append(rid)
		# Build route_id → route_name dict (deduplicated on wire). Key
		# stringified so orjson can serialize, frontend stringifies on
		# lookup either way.
		rname = doc.get("route_name")
		if rid is not None and rname:
			rid_key = str(rid)
			if rid_key not in route_dict:
				route_dict[rid_key] = rname
		category_ids.append(doc.get("category_id", ""))
		if include_defect:
			defect_ids.append(doc.get("latest_defect_id") or "")
			issues.append(doc.get("issue") or "")

		if kind == "line":
			if display_id:
				line_ids.append(display_id)
			extras: dict = {}
			classification = doc.get("classification")
			if classification:
				extras["classification"] = classification
			# Simplified geometry only — full geometry fetched on-click via
			# /master/<id>/geometry. Lines without simplified geometry won't
			# render until clicked (data should be backfilled via
			# migrate_simplify_line_geometry.py).
			geom = doc.get("geometry_simplified")
			if geom:
				extras["geometry"] = geom
			if extras and display_id:
				line_extras[display_id] = extras

	columns: dict = {
		"ids": ids,
		"asset_ids": asset_ids,
		"lats": lats,
		"lngs": lngs,
		"conditions": conditions,
		"group_ids": group_ids,
		"sides": sides,
		"zones": zones,
		"route_ids": route_ids,
		"category_ids": category_ids,
	}
	if include_defect:
		columns["defect_ids"] = defect_ids
		columns["issues"] = issues

	return fast_mongo_response({
		"count": len(ids),
		"format": "columnar",
		"mode": mode,
		"columns": columns,
		"line_ids": line_ids,
		"line_extras": line_extras,
		"route_dict": route_dict,
	})



@assets_bp.get("/master/map-points", endpoint="assets_master_map_points")
@role_required(["super_admin", "admin", "surveyor", "viewer"])
def get_master_map_points():
	"""
	Returns the full filtered dataset in columnar form. Map clustering is
	done client-side via supercluster — pan/zoom never re-hits the server.
	---
	tags:
	  - Assets
	security:
	  - Bearer: []
	parameters:
	  - name: route_id
	    in: query
	    type: integer
	  - name: category
	    in: query
	    type: string
	  - name: condition
	    in: query
	    type: string
	  - name: side
	    in: query
	    type: string
	  - name: zone
	    in: query
	    type: string
	  - name: asset_type
	    in: query
	    type: string
	  - name: search
	    in: query
	    type: string
	  - name: include_defect
	    in: query
	    type: boolean
	responses:
	  200:
	    description: Map points retrieved successfully
	"""
	db = get_db()
	query = _build_master_filter(request.args)
	include_defect = request.args.get("include_defect") in ("1", "true", "yes")

	# Whitelist filter keys so junk params (cache-busters, future unrelated
	# params) don't fragment the cache. include_defect already passed
	# separately — kept out of the dict to avoid double-hashing.
	filter_keys = ("route_id", "category", "condition", "zone", "side", "asset_type", "search")
	cache_filters = {k: request.args.get(k) for k in filter_keys if request.args.get(k)}

	# Cache key namespace bumped (v3) — prior shape included zoom/bbox/cluster
	# variants that no longer exist. Stale entries under old keys would still
	# sit under the 600s TTL otherwise.
	# v4: response shape changed — `asset_type` and `kinds[]`/`route_names[]`
	# replaced with `line_ids` set + `route_dict`. Bump the namespace so the
	# old cached payloads don't poison the new client decoder.
	# v5: whitelisted filter keys (was dict(request.args)).
	# v6: store gzip-compressed body in Redis (was raw orjson). Skips the
	# Flask-Compress re-gzip on every cache hit (~22MB → 4MB takes ~150ms
	# of CPU each time; storing compressed amortizes that across the TTL).
	# v7: dropped full `geometry` fallback + first_frame/last_frame from
	# line_extras — frontend never read them. Bump so old payloads expire.
	cache_key = cache_make_key(
		"assets:map:v7",
		filters=cache_filters,
		include_defect=include_defect,
	)
	cached_gz = cache_get_body(cache_key)
	if cached_gz is not None:
		return _conditional_response_gz(cached_gz)

	resp = _map_points_full(db, query, include_defect)

	# Compress once. compresslevel=6 is the gzip default — good ratio/CPU
	# tradeoff; level 9 saves ~3% more bytes for ~2x the CPU.
	body = resp.get_data()
	body_gz = gzip.compress(body, compresslevel=6)
	# TTL 600s — payload depends only on master_assets state, invalidated on
	# every write via invalidate_assets_cache().
	cache_set_body(cache_key, body_gz, ttl=600)
	return _conditional_response_gz(body_gz)


def _conditional_response_gz(body_gz: bytes) -> Response:
	"""Serve a pre-gzipped body. ETag is computed from the compressed bytes
	(opaque per RFC 7232) so the same bytes always round-trip the same
	If-None-Match value. Sets Content-Encoding: gzip — Flask-Compress sees
	the header and skips its own pass.

	Falls back to decompression for the rare client that doesn't advertise
	gzip support (curl without -H, ancient bots). Modern browsers all do."""
	etag = hashlib.md5(body_gz).hexdigest()
	if request.headers.get("If-None-Match") == etag:
		resp = Response(status=304)
		resp.headers["ETag"] = etag
		resp.headers["Cache-Control"] = "private, no-cache"
		resp.headers["Vary"] = "Authorization, Accept-Encoding"
		return resp

	accept = request.headers.get("Accept-Encoding", "")
	if "gzip" in accept:
		resp = Response(body_gz, status=200, mimetype="application/json")
		resp.headers["Content-Encoding"] = "gzip"
		resp.headers["Content-Length"] = str(len(body_gz))
	else:
		raw = gzip.decompress(body_gz)
		resp = Response(raw, status=200, mimetype="application/json")
		resp.headers["Content-Length"] = str(len(raw))

	resp.headers["ETag"] = etag
	# no-cache (NOT no-store) — browser keeps body but revalidates every
	# request via If-None-Match. Avoids the staleness window a max-age would
	# create after a mutation: 304 still saves the payload on hit, 200
	# delivers fresh body the moment Redis was invalidated by a write.
	resp.headers["Cache-Control"] = "private, no-cache"
	# Vary on Authorization — same URL with different bearer tokens (user
	# logout/login in same browser) must not reuse the cached response.
	# Vary on Accept-Encoding — gzip vs raw bodies must not alias.
	resp.headers["Vary"] = "Authorization, Accept-Encoding"
	return resp


@assets_bp.get("/master/<master_display_id>/keypoints", endpoint="assets_master_keypoints")
@role_required(["super_admin", "admin", "surveyor", "viewer"])
def get_master_asset_keypoints(master_display_id: str):
	"""
	Return keypoints for a single master asset. Used on-demand when a line
	asset is clicked on the map — lets the map response itself stay small.
	---
	tags:
	  - Assets
	security:
	  - Bearer: []
	parameters:
	  - name: master_display_id
	    in: path
	    required: true
	    type: string
	responses:
	  200:
	    description: Keypoints for the given master asset
	"""
	db = get_db()
	doc = db.master_assets.find_one(
		{"master_display_id": master_display_id},
		{"_id": 0, "keypoints": 1},
	)
	if not doc:
		return jsonify({"error": "Master asset not found"}), 404
	return fast_mongo_response({"keypoints": doc.get("keypoints") or []})


@assets_bp.get("/master/<master_display_id>/geometry", endpoint="assets_master_geometry")
@role_required(["super_admin", "admin", "surveyor", "viewer"])
def get_master_asset_geometry(master_display_id: str):
	"""
	Return the FULL (un-simplified) GeoJSON geometry for a line master asset.
	/map-points ships the pre-simplified geometry to keep the payload small;
	call this endpoint when you need accurate coordinates at close zoom.
	---
	tags:
	  - Assets
	security:
	  - Bearer: []
	parameters:
	  - name: master_display_id
	    in: path
	    required: true
	    type: string
	responses:
	  200:
	    description: Full geometry for the given master asset
	"""
	db = get_db()
	doc = db.master_assets.find_one(
		{"master_display_id": master_display_id},
		{"_id": 0, "geometry": 1},
	)
	if not doc:
		return jsonify({"error": "Master asset not found"}), 404
	return fast_mongo_response({"geometry": doc.get("geometry")})


@assets_bp.get("/master/search", endpoint="assets_master_search")
@role_required(["super_admin", "admin", "surveyor", "viewer"])
def search_master_assets():
	"""
	Text search over master_assets. Returns only the matching master_display_ids
	so the client can intersect with in-memory facet-filtered sets.
	---
	tags:
	  - Assets
	security:
	  - Bearer: []
	parameters:
	  - name: q
	    in: query
	    type: string
	    required: true
	responses:
	  200:
	    description: List of matching master_display_ids
	"""
	q = (request.args.get("q") or "").strip()
	if not q:
		return fast_mongo_response({"ids": [], "count": 0})

	db = get_db()
	projection = {"_id": 0, "master_display_id": 1}

	# Same lookahead regex as _build_master_filter — order-independent AND
	# across the user's typed words. Same field set so search results align
	# with what the table-search filter would return.
	words = [re.escape(w) for w in q.split() if w]
	pattern = "".join(f"(?=.*{w})" for w in words) + ".*"
	regex = {"$regex": pattern, "$options": "is"}
	cursor = db.master_assets.find(
		{"$or": [
			{"master_display_id": regex},
			{"group_id": regex},
			{"route_name": regex},
			{"issue": regex},
			{"latest_defect_id": regex},
		]},
		projection,
	)
	ids = [d["master_display_id"] for d in cursor if d.get("master_display_id")]

	return fast_mongo_response({"ids": ids, "count": len(ids)})


# Valid sort keys and their corresponding MongoDB field names. Both the
# canonical names ("roadName", "lastSurveyDate") and the column-key aliases
# the frontend tables actually emit ("road", "survey") map to the same
# fields. "category" is intentionally omitted: it sorts on the display name
# resolved via system_asset_categories, not the raw category_id, so all three
# endpoints (paginated, page-of, neighbor) handle it via aggregation.
_SORT_KEY_MAP = {
	"assetDisplayId": "master_display_id",
	"defectId": "latest_defect_id",
	"assetType": "asset_type",
	"condition": "latest_condition",
	"roadName": "route_name",
	"road": "route_name",
	"side": "side",
	"zone": "zone",
	"lastSurveyDate": "last_seen_date",
	"survey": "last_seen_date",
}


def _category_sort_branches(db):
	"""Build the $switch branches that resolve `category_id` → display name.
	Used by paginated / page-of / neighbor when the client sorts by category,
	so all three agree on the same display-name ordering."""
	branches = []
	for cat in db.system_asset_categories.find({}, {"category_id": 1, "display_name": 1, "_id": 0}):
		branches.append({
			"case": {"$eq": ["$category_id", cat["category_id"]]},
			"then": cat.get("display_name", cat["category_id"]),
		})
	return branches


def _category_sort_value(db, category_id: str) -> str:
	"""Resolve a single asset's display-name sort value the same way the
	$switch above would. Used to anchor page-of / neighbor comparisons."""
	if not category_id:
		return ""
	doc = db.system_asset_categories.find_one(
		{"category_id": category_id}, {"display_name": 1, "_id": 0}
	)
	return (doc or {}).get("display_name") or category_id


@assets_bp.get("/master/paginated", endpoint="assets_master_paginated")
@role_required(["super_admin", "admin", "surveyor", "viewer"])
def get_master_assets_paginated():
	"""
	Paginated master assets for the table view.  Also returns sorted_ids
	(all matching master_display_ids in sort order) so the frontend can
	compute which page a map-clicked asset is on.
	---
	tags:
	  - Assets
	security:
	  - Bearer: []
	parameters:
	  - name: page
	    in: query
	    type: integer
	    default: 1
	  - name: limit
	    in: query
	    type: integer
	    default: 10
	  - name: sort_key
	    in: query
	    type: string
	  - name: sort_dir
	    in: query
	    type: string
	    enum: [asc, desc]
	  - name: route_id
	    in: query
	    type: integer
	  - name: category
	    in: query
	    type: string
	  - name: condition
	    in: query
	    type: string
	  - name: side
	    in: query
	    type: string
	  - name: zone
	    in: query
	    type: string
	  - name: asset_type
	    in: query
	    type: string
	  - name: search
	    in: query
	    type: string
	responses:
	  200:
	    description: Paginated master assets retrieved successfully
	"""
	db = get_db()
	query = _build_master_filter(request.args)

	page = max(1, request.args.get("page", 1, type=int))
	limit = min(100, max(1, request.args.get("limit", 10, type=int)))
	skip = (page - 1) * limit

	# Determine sort
	sort_key_param = request.args.get("sort_key", "lastSurveyDate")
	sort_dir_param = request.args.get("sort_dir", "desc")
	mongo_sort_dir = DESCENDING if sort_dir_param == "desc" else ASCENDING

	# Read-through cache. Search is unbounded keyspace — skip cache when a
	# free-text search is supplied (low repeat rate, would balloon Redis).
	# Mutations under /api/assets invalidate via _invalidate_cache_after_writes.
	search_param = request.args.get("search") or ""
	use_cache = not search_param
	cache_key = cache_make_key(
		"assets:paginated:v1",
		filters=dict(request.args),
		page=page,
		limit=limit,
		sort_key=sort_key_param,
		sort_dir=sort_dir_param,
	)
	if use_cache:
		cached_body = cache_get_body(cache_key)
		if cached_body is not None:
			return Response(cached_body, status=200, mimetype="application/json")

	# Table-only inclusion projection. Viewer-only fields (latest_box,
	# latest_frame_number, latest_video_id, latest_description) are fetched
	# on demand via GET /master/<display_id> when the user opens a row.
	projection = {
		"_id": 1,
		"master_display_id": 1,
		"asset_id": 1,
		"asset_type": 1,
		"group_id": 1,
		"category_id": 1,
		"side": 1,
		"zone": 1,
		"route_id": 1,
		"route_name": 1,
		"road_side": 1,
		"canonical_location": 1,
		"latest_condition": 1,
		"latest_survey_id": 1,
		"latest_survey_display_id": 1,
		"latest_defect_id": 1,
		"issue": 1,
		"last_seen_date": 1,
		"total_surveys_detected": 1,
	}

	total_count = db.master_assets.count_documents(query)
	total_pages = math.ceil(total_count / limit) if total_count > 0 else 1

	# Category sort runs through aggregation so the display name (not the raw
	# category_id) drives the order. _id ASC is the deterministic tiebreaker
	# that page-of / neighbor also use.
	if sort_key_param == "category":
		branches = _category_sort_branches(db)
		items_cursor = db.master_assets.aggregate([
			{"$match": query},
			{"$project": projection},
			{"$addFields": {"_cat_sort": {"$switch": {"branches": branches, "default": {"$ifNull": ["$category_id", ""]}}}}},
			{"$sort": {"_cat_sort": mongo_sort_dir, "_id": ASCENDING}},
			{"$skip": skip},
			{"$limit": limit},
			{"$project": {"_cat_sort": 0}},
		])
	else:
		mongo_sort_key = _SORT_KEY_MAP.get(sort_key_param, "last_seen_date")
		items_cursor = db.master_assets.find(query, projection) \
			.sort([(mongo_sort_key, mongo_sort_dir), ("_id", ASCENDING)]) \
			.skip(skip) \
			.limit(limit)

	items = []
	for doc in items_cursor:
		doc["_id"] = str(doc["_id"])
		if doc.get("latest_survey_id"):
			doc["latest_survey_id"] = str(doc["latest_survey_id"])
		items.append(doc)

	resp = fast_mongo_response({
		"items": items,
		"total_count": total_count,
		"total_pages": total_pages,
		"page": page,
		"limit": limit,
	})
	if use_cache:
		# 600s TTL — same as map-points. Mutation invalidator flushes on writes.
		cache_set_body(cache_key, resp.get_data(), ttl=600)
	return resp


def _and_combine(base_query: dict, extra_clause: dict) -> dict:
	"""Merge `extra_clause` into `base_query` so a top-level `$or` on either
	side survives. Plain dict-spread overwrites duplicate keys — the search
	regex puts `$or` into base_query and the page-of/neighbor tiebreaker also
	uses `$or`, so naive spread silently drops the search filter."""
	# Only $or actually collides today; if neither side has $or, fall back to
	# a cheap spread.
	if "$or" not in base_query and "$or" not in extra_clause:
		return {**base_query, **extra_clause}
	merged = {k: v for k, v in base_query.items() if k != "$or"}
	merged.update({k: v for k, v in extra_clause.items() if k != "$or"})
	clauses = []
	if "$or" in base_query:
		clauses.append({"$or": base_query["$or"]})
	if "$or" in extra_clause:
		clauses.append({"$or": extra_clause["$or"]})
	merged["$and"] = clauses
	return merged


def _resolve_sort_field(args):
	"""Resolve the frontend sort_key query param to the mongo field used by the
	paginated table. Returns (field_name, mongo_sort_dir). Falls back to
	last_seen_date on unknown keys, matching /master/paginated."""
	sort_key_param = args.get("sort_key", "lastSurveyDate")
	sort_dir_param = args.get("sort_dir", "desc")
	mongo_sort_dir = DESCENDING if sort_dir_param == "desc" else ASCENDING
	field = _SORT_KEY_MAP.get(sort_key_param, "last_seen_date")
	return field, mongo_sort_dir


@assets_bp.get("/master/<master_display_id>/page-of", endpoint="assets_master_page_of")
@role_required(["super_admin", "admin", "surveyor", "viewer"])
def get_master_page_of(master_display_id: str):
	"""
	Compute which table page a given master asset sits on, given the current
	filters + sort. Replaces the old `sorted_ids` array that the paginated
	endpoint used to return.
	---
	tags:
	  - Assets
	security:
	  - Bearer: []
	"""
	db = get_db()
	limit = min(100, max(1, request.args.get("limit", 10, type=int)))

	sort_key_param = request.args.get("sort_key", "lastSurveyDate")
	sort_dir_param = request.args.get("sort_dir", "desc")
	mongo_sort_dir = DESCENDING if sort_dir_param == "desc" else ASCENDING

	base_query = _build_master_filter(request.args)
	cmp_op = "$gt" if mongo_sort_dir == DESCENDING else "$lt"

	# Category sort needs the same display-name resolution paginated does, so
	# the page index this returns matches the row order rendered in the table.
	if sort_key_param == "category":
		clicked = db.master_assets.find_one(
			{"master_display_id": master_display_id},
			{"category_id": 1},
		)
		if not clicked:
			return jsonify({"error": "not found"}), 404
		clicked_cat_sort = _category_sort_value(db, clicked.get("category_id") or "")
		clicked_id = clicked["_id"]
		branches = _category_sort_branches(db)
		pipeline = [
			{"$match": base_query},
			{"$addFields": {"_cat_sort": {"$switch": {"branches": branches, "default": {"$ifNull": ["$category_id", ""]}}}}},
			{"$match": {"$or": [
				{"_cat_sort": {cmp_op: clicked_cat_sort}},
				{"_cat_sort": clicked_cat_sort, "_id": {"$lt": clicked_id}},
			]}},
			{"$count": "n"},
		]
		result = list(db.master_assets.aggregate(pipeline))
		before_count = result[0]["n"] if result else 0
		page = before_count // limit + 1
		return jsonify({"page": page})

	sort_field = _SORT_KEY_MAP.get(sort_key_param, "last_seen_date")
	clicked = db.master_assets.find_one(
		{"master_display_id": master_display_id},
		{sort_field: 1},
	)
	if not clicked:
		return jsonify({"error": "not found"}), 404

	sort_val = clicked.get(sort_field)
	clicked_id = clicked["_id"]

	# Count docs that sort strictly *before* the clicked asset under
	# (sort_field, _id) ordering — _id is the stable tiebreaker the paginated
	# endpoint also uses, so ties on non-unique sort fields don't undercount.
	if sort_val is None:
		# Nulls sort to the end (asc) / start (desc) in mongo — treat as 0 before.
		before_count = 0
	else:
		# Compose with base_query via $and so a search regex (which uses $or
		# inside _build_master_filter) isn't clobbered by the tiebreaker $or.
		sort_clause = {"$or": [
			{sort_field: {cmp_op: sort_val}},
			{sort_field: sort_val, "_id": {"$lt": clicked_id}},
		]}
		query = _and_combine(base_query, sort_clause)
		before_count = db.master_assets.count_documents(query)

	page = before_count // limit + 1
	return jsonify({"page": page})


@assets_bp.get("/master/<master_display_id>/neighbor", endpoint="assets_master_neighbor")
@role_required(["super_admin", "admin", "surveyor", "viewer"])
def get_master_neighbor(master_display_id: str):
	"""
	Return the next/prev master asset relative to `master_display_id` under
	the current filters + sort. Direction is 'next' or 'prev'.
	---
	tags:
	  - Assets
	security:
	  - Bearer: []
	"""
	db = get_db()
	direction = (request.args.get("direction") or "next").lower()
	if direction not in ("next", "prev"):
		return jsonify({"error": "direction must be 'next' or 'prev'"}), 400

	sort_key_param = request.args.get("sort_key", "lastSurveyDate")
	sort_dir_param = request.args.get("sort_dir", "desc")
	mongo_sort_dir = DESCENDING if sort_dir_param == "desc" else ASCENDING

	# direction=next moves with the current sort; direction=prev moves against
	# it. _id is the stable tiebreaker the paginated endpoint also uses, so
	# ties on non-unique sort fields (condition, side, zone, route, category,
	# …) don't strand or skip neighbors that share the current sort value.
	if direction == "next":
		cmp_op = "$lt" if mongo_sort_dir == DESCENDING else "$gt"
		scan_dir = mongo_sort_dir
		tie_id_op = "$gt"
		id_dir = ASCENDING
	else:
		cmp_op = "$gt" if mongo_sort_dir == DESCENDING else "$lt"
		scan_dir = ASCENDING if mongo_sort_dir == DESCENDING else DESCENDING
		tie_id_op = "$lt"
		id_dir = DESCENDING

	base_query = _build_master_filter(request.args)
	projection = {
		"_id": 1, "master_display_id": 1, "asset_id": 1, "asset_type": 1,
		"group_id": 1, "category_id": 1, "side": 1, "zone": 1,
		"route_id": 1, "route_name": 1, "road_side": 1,
		"canonical_location": 1, "latest_condition": 1,
		"latest_survey_id": 1, "latest_survey_display_id": 1,
		"latest_defect_id": 1, "issue": 1,
		"last_seen_date": 1, "total_surveys_detected": 1,
	}

	# Category sort uses the same display-name resolution paginated does, so
	# the neighbor returned matches the row that visually sits next to the
	# current one in the table.
	if sort_key_param == "category":
		current = db.master_assets.find_one(
			{"master_display_id": master_display_id},
			{"category_id": 1},
		)
		if not current:
			return jsonify({"error": "not found"}), 404
		current_cat_sort = _category_sort_value(db, current.get("category_id") or "")
		current_id = current["_id"]
		branches = _category_sort_branches(db)
		pipeline = [
			{"$match": base_query},
			{"$addFields": {"_cat_sort": {"$switch": {"branches": branches, "default": {"$ifNull": ["$category_id", ""]}}}}},
			{"$match": {"$or": [
				{"_cat_sort": {cmp_op: current_cat_sort}},
				{"_cat_sort": current_cat_sort, "_id": {tie_id_op: current_id}},
			]}},
			{"$sort": {"_cat_sort": scan_dir, "_id": id_dir}},
			{"$limit": 1},
			{"$project": projection},
		]
		docs = list(db.master_assets.aggregate(pipeline))
		if not docs:
			return jsonify({"item": None})
		neighbor = docs[0]
		neighbor["_id"] = str(neighbor["_id"])
		if neighbor.get("latest_survey_id"):
			neighbor["latest_survey_id"] = str(neighbor["latest_survey_id"])
		return fast_mongo_response({"item": neighbor})

	sort_field = _SORT_KEY_MAP.get(sort_key_param, "last_seen_date")
	current = db.master_assets.find_one(
		{"master_display_id": master_display_id},
		{sort_field: 1},
	)
	if not current:
		return jsonify({"error": "not found"}), 404

	sort_val = current.get(sort_field)
	if sort_val is None:
		return jsonify({"item": None})
	current_id = current["_id"]

	# Compose with base_query via $and so a search regex (which uses $or
	# inside _build_master_filter) isn't clobbered by the tiebreaker $or.
	sort_clause = {"$or": [
		{sort_field: {cmp_op: sort_val}},
		{sort_field: sort_val, "_id": {tie_id_op: current_id}},
	]}
	query = _and_combine(base_query, sort_clause)

	# Sort by (sort_field, _id) so the tiebreaker matches paginated row order.
	neighbor = db.master_assets.find_one(query, projection, sort=[(sort_field, scan_dir), ("_id", id_dir)])
	if not neighbor:
		return jsonify({"item": None})

	neighbor["_id"] = str(neighbor["_id"])
	if neighbor.get("latest_survey_id"):
		neighbor["latest_survey_id"] = str(neighbor["latest_survey_id"])

	return fast_mongo_response({"item": neighbor})


@assets_bp.post("/bulk", endpoint="assets_bulk")
@role_required(["super_admin","admin", "surveyor"])
def bulk_insert():
	"""
	Bulk insert or update assets
	---
	tags:
	  - Assets
	security:
	  - Bearer: []
	parameters:
	  - name: body
	    in: body
	    required: true
	    schema:
	      type: object
	      required:
	        - assets
	      properties:
	        assets:
	          type: array
	          items:
	            type: object
	responses:
	  200:
	    description: Bulk operation successful
	  400:
	    description: Missing assets array
	"""
	body = request.get_json(silent=True) or {}
	assets = body.get("assets", [])
	if not isinstance(assets, list) or not assets:
		return jsonify({"error": "assets array required"}), 400
	
	from pymongo import UpdateOne
	
	operations = []
	for a in assets:
		a.setdefault("detected_at", get_now_iso())
		# Use upsert to handle re-processing - update if exists, insert if not
		asset_id = a.pop("_id", None)
		if asset_id:
			operations.append(UpdateOne(
				{"_id": asset_id},
				{"$set": a},
				upsert=True
			))
		else:
			# No _id provided, generate one via insert
			operations.append(UpdateOne(
				{"_id": ObjectId()},
				{"$set": a},
				upsert=True
			))
	
	db = get_db()
	if operations:
		res = db.assets.bulk_write(operations)
		return jsonify({
			"inserted": res.upserted_count,
			"modified": res.modified_count,
			"total": len(operations)
		})
	return jsonify({"inserted": 0, "modified": 0, "total": 0})


@assets_bp.put("/<asset_id>", endpoint="assets_update_id")
@role_required(["super_admin","admin", "surveyor"])
def update_asset(asset_id: str):
	"""
	Update an asset
	---
	tags:
	  - Assets
	security:
	  - Bearer: []
	parameters:
	  - name: asset_id
	    in: path
	    type: string
	    required: true
	    description: The ID of the asset
	  - name: body
	    in: body
	    required: true
	    schema:
	      type: object
	responses:
	  200:
	    description: Asset updated successfully
	  404:
	    description: Asset not found
	"""
	body = request.get_json(silent=True) or {}
	# Whitelist editable fields — caller can't write _id, embedding,
	# master_asset_id, or other internal pointers even with admin auth.
	_ALLOWED = {
		"asset_type", "type", "category", "category_id", "group_id",
		"condition", "side", "zone", "issue", "description",
		"box", "location", "confidence", "frame_number",
		"timestamp", "annotated_by", "annotated_by_user_id",
	}
	update = {k: v for k, v in body.items() if k in _ALLOWED}
	if not update:
		return jsonify({"error": "no editable fields supplied"}), 400
	db = get_db()
	res = db.assets.find_one_and_update({"_id": ObjectId(asset_id)}, {"$set": update})
	if not res:
		return jsonify({"error": "not found"}), 404
	return jsonify({"ok": True})


@assets_bp.patch("/<asset_id>/issue", endpoint="assets_update_issue")
@role_required(["super_admin", "admin", "surveyor"])
def update_asset_issue(asset_id: str):
	"""
	Update the issue description on a master asset.
	---
	tags:
	  - Assets
	security:
	  - Bearer: []
	parameters:
	  - name: asset_id
	    in: path
	    type: string
	    required: true
	    description: The MongoDB _id of the master asset
	  - name: body
	    in: body
	    required: true
	    schema:
	      type: object
	      required:
	        - issue
	      properties:
	        issue:
	          type: string
	          description: The new issue description
	responses:
	  200:
	    description: Issue updated successfully
	  400:
	    description: Missing issue field
	  404:
	    description: Asset not found
	"""
	body = request.get_json(silent=True) or {}
	issue = (body.get("issue") or "").strip()
	if not issue:
		return jsonify({"error": "issue is required"}), 400

	db = get_db()
	now = get_now_iso()

	res = db.master_assets.find_one_and_update(
		{"_id": ObjectId(asset_id)},
		{"$set": {"issue": issue, "updated_at": now}},
	)
	if not res:
		# Fallback: try as a raw asset _id
		res = db.assets.find_one_and_update(
			{"_id": ObjectId(asset_id)},
			{"$set": {"issue": issue}},
		)
		if not res:
			return jsonify({"error": "not found"}), 404

	return jsonify({"ok": True})

@assets_bp.patch("/<asset_id>/mark-good", endpoint="assets_mark_good")
@role_required(["super_admin","admin", "surveyor"])
def mark_asset_good(asset_id: str):
	"""
	Mark a master asset's condition as good.
	Updates both the master_assets record and the underlying
	asset observation in db.assets.
	---
	tags:
	  - Assets
	security:
	  - Bearer: []
	parameters:
	  - name: asset_id
	    in: path
	    type: string
	    required: true
	    description: The MongoDB _id of the master asset
	  - name: body
	    in: body
	    required: true
	    schema:
	      type: object
	      required:
	        - name
	        - user_id
	      properties:
	        name:
	          type: string
	          description: Full name of the surveyor marking the asset
	        user_id:
	          type: string
	          description: ID of the surveyor
	responses:
	  200:
	    description: Asset marked as good
	  400:
	    description: Missing required fields
	  404:
	    description: Asset not found
	"""
	body = request.get_json(silent=True) or {}
	surveyor_name = (body.get("name") or "").strip()
	surveyor_user_id = (body.get("user_id") or "").strip()
	if not surveyor_name:
		return jsonify({"error": "name is required"}), 400

	db = get_db()
	now = get_now_iso()

	# Resolve survey reference if provided
	survey_id_raw = (body.get("survey_id") or "").strip()
	survey_oid = None
	survey_display_id = ""
	if survey_id_raw:
		try:
			survey_oid = ObjectId(survey_id_raw)
			survey_doc = db.surveys.find_one({"_id": survey_oid}, {"survey_display_id": 1})
			if survey_doc:
				survey_display_id = survey_doc.get("survey_display_id", "")
		except Exception:
			pass

	master_oid = ObjectId(asset_id)

	# 1. Update the master_assets record
	res = db.master_assets.find_one_and_update(
		{"_id": master_oid},
		{
			"$set": {
				"latest_condition": "good",
				"issue": None,
				"updated_at": now,
			},
		},
	)
	if not res:
		# Fallback: try as a raw asset _id (backward compat)
		res = db.assets.find_one_and_update(
			{"_id": master_oid},
			{"$set": {"condition": "good"}},
		)
		if not res:
			return jsonify({"error": "not found"}), 404
		return jsonify({"ok": True})

	# 2. Log the action to the audit collection
	db.asset_condition_logs.insert_one({
		"master_asset_id": master_oid,
		"master_display_id": res.get("master_display_id", ""),
		"action": "marked_good",
		"previous_condition": res.get("latest_condition", "unknown"),
		"new_condition": "good",
		"name": surveyor_name,
		"user_id": surveyor_user_id,
		"survey_id": survey_oid,
		"survey_display_id": survey_display_id,
		"changed_at": now,
	})

	# 3. Also update the latest asset observation linked to this master
	survey_history = res.get("survey_history", [])
	if survey_history:
		latest_obs_id = survey_history[-1].get("asset_observation_id")
		if latest_obs_id:
			db.assets.update_one(
				{"_id": latest_obs_id},
				{"$set": {"condition": "good"}},
			)

	return jsonify({"ok": True})

@assets_bp.patch("/<asset_id>/unmark-good", endpoint="assets_unmark_good")
@role_required(["super_admin","admin", "surveyor"])
def unmark_asset_good(asset_id: str):
	"""
	Revert a master asset's condition from good back to damaged.
	Logs the action to asset_condition_logs.
	---
	tags:
	  - Assets
	security:
	  - Bearer: []
	parameters:
	  - name: asset_id
	    in: path
	    type: string
	    required: true
	    description: The MongoDB _id of the master asset
	  - name: body
	    in: body
	    required: false
	    schema:
	      type: object
	      properties:
	        name:
	          type: string
	        user_id:
	          type: string
	responses:
	  200:
	    description: Asset unmarked (reverted to damaged)
	  404:
	    description: Asset not found
	"""
	body = request.get_json(silent=True) or {}
	
	sid = body.get("survey_id")
	sdid = ""
	surveyor_name = (body.get("name") or "").strip()
	surveyor_user_id = (body.get("user_id") or "").strip()

	db = get_db()
	now = get_now_iso()
	master_oid = ObjectId(asset_id)

	if sid:
		try:
			sid = ObjectId(sid)
			survey_doc = db.surveys.find_one({"_id": sid}, {"survey_display_id": 1})
			if survey_doc:
				sdid = survey_doc.get("survey_display_id", "")
		except Exception:
			sid = None

	res = db.master_assets.find_one_and_update(
		{"_id": master_oid},
		{"$set": {"latest_condition": "damaged", "updated_at": now}},
	)
	if not res:
		return jsonify({"error": "not found"}), 404

	# Log the mark-damaged action
	db.asset_condition_logs.insert_one({
		"master_asset_id": master_oid,
		"master_display_id": res.get("master_display_id", ""),
		"action": "marked_damaged",
		"previous_condition": "good",
		"new_condition": "damaged",
		"name": surveyor_name,
		"user_id": surveyor_user_id,
		"survey_id": sid,
		"survey_display_id": sdid,
		"changed_at": now,
	})

	# Also revert the latest asset observation
	survey_history = res.get("survey_history", [])
	if survey_history:
		latest_obs_id = survey_history[-1].get("asset_observation_id")
		if latest_obs_id:
			db.assets.update_one(
				{"_id": latest_obs_id},
				{"$set": {"condition": "damaged"}},
			)

	return jsonify({"ok": True})


@assets_bp.get("/<asset_id>/condition-logs", endpoint="assets_condition_logs")
@role_required(["super_admin", "admin", "surveyor", "viewer"])
def get_condition_logs(asset_id: str):
	"""
	Get condition change audit log for a master asset.
	Returns all mark-good / mark-damaged events, newest first.
	---
	tags:
	  - Assets
	security:
	  - Bearer: []
	parameters:
	  - name: asset_id
	    in: path
	    type: string
	    required: true
	responses:
	  200:
	    description: Condition logs retrieved
	"""
	db = get_db()
	logs = list(
		db.asset_condition_logs.find(
			{"master_asset_id": ObjectId(asset_id)},
			{"_id": 0, "master_asset_id": 0},
		).sort("changed_at", DESCENDING)
	)
	return mongo_response({"items": logs, "count": len(logs)})


@assets_bp.patch("/master/<master_display_id>/qc-update", endpoint="assets_qc_update")
@role_required(["super_admin", "admin", "surveyor"])
def qc_update_asset(master_display_id: str):
	"""
	Save QC layer edits for a master asset.
	Updates the master_assets and assets collections with the edited
	annotation data, and logs all changes to asset_condition_logs.
	---
	tags:
	  - Assets
	security:
	  - Bearer: []
	parameters:
	  - name: master_display_id
	    in: path
	    type: string
	    required: true
	  - name: body
	    in: body
	    required: true
	    schema:
	      type: object
	      required:
	        - name
	        - user_id
	        - box
	      properties:
	        name:
	          type: string
	        user_id:
	          type: string
	        group_id:
	          type: string
	        category_id:
	          type: string
	        condition:
	          type: string
	        box:
	          type: object
	          properties:
	            x:
	              type: number
	            y:
	              type: number
	            width:
	              type: number
	            height:
	              type: number
	responses:
	  200:
	    description: QC edits saved
	  400:
	    description: Missing required fields
	  404:
	    description: Asset not found
	"""
	body = request.get_json(silent=True) or {}

	surveyor_name = (body.get("name") or "").strip()
	surveyor_user_id = (body.get("user_id") or "").strip()
	if not surveyor_name or not surveyor_user_id:
		return jsonify({"error": "name and user_id are required"}), 400

	new_group_id = (body.get("group_id") or "").strip()
	new_category_id = (body.get("category_id") or "").strip()
	new_condition = (body.get("condition") or "").strip()
	new_box = body.get("box")

	if not new_box:
		return jsonify({"error": "box is required"}), 400

	db = get_db()
	now = get_now_iso()

	# Fetch current master asset
	master = db.master_assets.find_one({"master_display_id": master_display_id})
	if not master:
		return jsonify({"error": "not found"}), 404

	master_oid = master["_id"]

	# --- Determine what changed ---
	old_group_id = master.get("group_id", "")
	old_asset_id = master.get("asset_id", "")
	old_category_id = master.get("category_id", "")
	old_condition = master.get("latest_condition", "")
	old_box = master.get("latest_box") or {}

	type_changed = bool(new_group_id and new_group_id != old_group_id)
	condition_changed = bool(new_condition and new_condition.lower() != old_condition.lower())
	box_moved = bool(new_box and (
		new_box.get("x") != old_box.get("x") or
		new_box.get("y") != old_box.get("y") or
		new_box.get("width") != old_box.get("width") or
		new_box.get("height") != old_box.get("height")
	))

	if not type_changed and not condition_changed and not box_moved:
		return jsonify({"ok": True, "message": "no changes detected"})

	# --- Resolve new asset_id from system_asset_labels if type changed ---
	new_asset_id = old_asset_id
	if type_changed:
		label_doc = db.system_asset_labels.find_one({"group_id": new_group_id})
		if label_doc:
			new_asset_id = label_doc.get("asset_id", old_asset_id)

	# --- Build update for master_assets ---
	master_update = {"updated_at": now}
	if type_changed:
		master_update["group_id"] = new_group_id
		master_update["asset_type"] = new_group_id
		master_update["asset_id"] = new_asset_id
	if new_category_id and new_category_id != old_category_id:
		master_update["category_id"] = new_category_id
	if condition_changed:
		master_update["latest_condition"] = new_condition.lower()
	if box_moved:
		master_update["latest_box"] = new_box

	db.master_assets.update_one(
		{"_id": master_oid},
		{"$set": master_update},
	)

	# --- Update the latest asset observation ---
	survey_history = master.get("survey_history", [])
	if survey_history:
		latest_obs_id = survey_history[-1].get("asset_observation_id")
		if latest_obs_id:
			asset_update = {}
			if type_changed:
				asset_update["group_id"] = new_group_id
				asset_update["asset_type"] = new_group_id
				asset_update["asset_id"] = new_asset_id
			if new_category_id and new_category_id != old_category_id:
				asset_update["category_id"] = new_category_id
			if condition_changed:
				asset_update["condition"] = new_condition.lower()
			if box_moved:
				asset_update["box"] = new_box
			if asset_update:
				db.assets.update_one(
					{"_id": latest_obs_id},
					{"$set": asset_update},
				)

		# Also update the survey_history entry on the master
		sh_idx = len(survey_history) - 1
		sh_update = {}
		if box_moved:
			sh_update[f"survey_history.{sh_idx}.box"] = new_box
		if condition_changed:
			sh_update[f"survey_history.{sh_idx}.condition"] = new_condition.lower()
		if sh_update:
			db.master_assets.update_one(
				{"_id": master_oid},
				{"$set": sh_update},
			)

	# --- Regenerate CLIP embedding if bounding box changed ---
	if box_moved and survey_history:
		latest_obs = survey_history[-1]
		vid_id = latest_obs.get("video_id")
		frame_num = latest_obs.get("frame_number")
		if vid_id and frame_num is not None:
			video_doc = db.videos.find_one(
				{"_id": ObjectId(str(vid_id))},
				{"storage_url": 1},
			)
			if video_doc and video_doc.get("storage_url"):
				from pathlib import Path as _Path
				from services.asset_linker import regenerate_embedding

				upload_dir = _Path(os.environ.get("UPLOAD_DIR") or os.path.join(
					os.path.dirname(os.path.abspath(__file__)), "..", "uploads"
				))
				up = _Path("/uploads")
				video_path = upload_dir / _Path(video_doc["storage_url"]).relative_to(up)

				new_embedding = regenerate_embedding(video_path, int(frame_num), new_box)
				if new_embedding is not None:
					db.master_assets.update_one(
						{"_id": master_oid},
						{"$set": {"embedding": new_embedding}},
					)
					latest_obs_id = latest_obs.get("asset_observation_id")
					if latest_obs_id:
						db.assets.update_one(
							{"_id": latest_obs_id},
							{"$set": {"embedding": new_embedding}},
						)

	# --- Log to asset_condition_logs ---
	log_entry = {
		"master_asset_id": master_oid,
		"master_display_id": master_display_id,
		"action": "qc_edit",
		"name": surveyor_name,
		"user_id": surveyor_user_id,
		"changed_at": now,
		"type_changed": type_changed,
		"condition_changed": condition_changed,
		"box_moved": box_moved,
		# Store previous state for revert
		"previous_state": {
			"group_id": old_group_id,
			"asset_id": old_asset_id,
			"category_id": old_category_id,
			"condition": old_condition,
			"box": old_box,
		},
		# Store new state
		"new_state": {
			"group_id": new_group_id or old_group_id,
			"asset_id": new_asset_id,
			"category_id": new_category_id or old_category_id,
			"condition": new_condition.lower() if new_condition else old_condition,
			"box": new_box,
		},
	}
	db.asset_condition_logs.insert_one(log_entry)

	return jsonify({"ok": True})


@assets_bp.post("/manual-annotations", endpoint="assets_manual_annotations")
@role_required(["super_admin", "admin", "surveyor"])
def save_manual_annotations():
	"""
	Save manually drawn annotations from the video annotator.
	Creates asset docs, master_asset docs, generates embeddings,
	and updates the frames collection with new detections.
	---
	tags:
	  - Assets
	security:
	  - Bearer: []
	parameters:
	  - name: body
	    in: body
	    required: true
	    schema:
	      type: object
	      required:
	        - video_id
	        - annotations
	        - name
	        - user_id
	      properties:
	        video_id:
	          type: string
	        annotations:
	          type: array
	          items:
	            type: object
	            properties:
	              frame_number:
	                type: integer
	              box:
	                type: object
	              group_id:
	                type: string
	              category_id:
	                type: string
	              condition:
	                type: string
	              timestamp:
	                type: number
	        name:
	          type: string
	        user_id:
	          type: string
	responses:
	  200:
	    description: Annotations saved
	  400:
	    description: Missing required fields
	"""
	from pathlib import Path as _Path
	import cv2
	from services.asset_linker import regenerate_embedding, _generate_master_display_id
	from services.ZoneMapper import ZoneMapper
	from services.LatLongEstimator import LatLongEstimator
	from utils.gpx_helpers import parse_gpx, interpolate_gpx

	body = request.get_json(silent=True) or {}

	video_id = (body.get("video_id") or "").strip()
	annotations = body.get("annotations") or []
	surveyor_name = (body.get("name") or "").strip()
	surveyor_user_id = (body.get("user_id") or "").strip()

	if not video_id or not annotations or not surveyor_name:
		return jsonify({"error": "video_id, annotations, name are required"}), 400

	db = get_db()
	now = get_now_iso()

	# Fetch video to get survey context
	video_doc = db.videos.find_one({"_id": ObjectId(video_id)})
	if not video_doc:
		return jsonify({"error": "video not found"}), 404

	survey_id = video_doc.get("survey_id")
	route_id = video_doc.get("route_id")
	storage_url = video_doc.get("storage_url", "")

	# Fetch survey info
	survey_display_id = ""
	survey_date = None
	if survey_id:
		survey_doc = db.surveys.find_one(
			{"_id": survey_id},
			{"survey_display_id": 1, "survey_date": 1},
		)
		if survey_doc:
			survey_display_id = survey_doc.get("survey_display_id", "")
			survey_date = survey_doc.get("survey_date")

	# Fetch route info for denormalization
	route_name = ""
	road_side = ""
	if route_id:
		road_doc = db.roads.find_one({"route_id": route_id}, {"road_name": 1, "road_side": 1})
		if road_doc:
			route_name = road_doc.get("road_name", "")
			road_side = road_doc.get("road_side", "")

	# Resolve video path for embedding generation
	video_path = None
	if storage_url:
		upload_dir = _Path(os.environ.get("UPLOAD_DIR") or os.path.join(
			os.path.dirname(os.path.abspath(__file__)), "..", "uploads"
		))
		up = _Path("/uploads")
		try:
			video_path = upload_dir / _Path(storage_url).relative_to(up)
		except ValueError:
			video_path = None

	# --- Compute side, zone, and location for each annotation ---
	zone_mapper = ZoneMapper()
	lat_long_estimator = LatLongEstimator()

	# Get video dimensions and metadata for GPX interpolation
	video_width = 1920
	video_height = 1080
	gpx_data = {}
	fps = 30
	total_frames = 0

	if video_path and video_path.exists():
		cap = cv2.VideoCapture(str(video_path))
		if cap.isOpened():
			video_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
			video_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
			fps = cap.get(cv2.CAP_PROP_FPS) or 30
			total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
			cap.release()

	# Parse and interpolate GPX for location estimation
	gpx_file_url = video_doc.get("gpx_file_url")
	if gpx_file_url and video_path:
		upload_dir_gpx = _Path(os.environ.get("UPLOAD_DIR") or os.path.join(
			os.path.dirname(os.path.abspath(__file__)), "..", "uploads"
		))
		# removeprefix is a literal-string strip; lstrip strips ANY char in the
		# arg, which previously ate into filenames starting with /, u, p, l, o,
		# a, d, s (e.g. "/uploads/sdata.gpx" → "data.gpx" — wrong path).
		gpx_path = upload_dir_gpx / gpx_file_url.removeprefix("/uploads/")
		if gpx_path.exists():
			gpx_parsed = parse_gpx(gpx_path)
			if gpx_parsed and total_frames > 0:
				gpx_data = interpolate_gpx(total_frames, fps, gpx_parsed, frame_interval=1, time_offset=0)

	# Resolve asset_id from system_asset_labels by group_id
	label_cache = {}
	def resolve_label(group_id):
		if group_id not in label_cache:
			doc = db.system_asset_labels.find_one({"group_id": group_id})
			label_cache[group_id] = doc
		return label_cache[group_id]

	created_assets = []
	created_masters = []
	frames_updates = {}  # frame_number -> list of new detections

	for ann in annotations:
		frame_number = ann.get("frame_number")
		box = ann.get("box")
		group_id = (ann.get("group_id") or "").strip()
		category_id = (ann.get("category_id") or "").strip()
		condition = (ann.get("condition") or "good").strip().lower()
		timestamp = ann.get("timestamp", 0)

		if frame_number is None or not box or not group_id:
			continue

		# Resolve asset_id from label map
		label_doc = resolve_label(group_id)
		asset_id_str = label_doc.get("asset_id", "") if label_doc else ""

		# Generate display IDs
		from utils.ids import generate_asset_display_id, generate_defect_id
		asset_display_id = generate_asset_display_id(db=db)
		defect_id = generate_defect_id(db=db) if condition != "good" else None

		# Convert box {x, y, width, height} to xyxy for ZoneMapper/LatLongEstimator
		# (consistent with local_processor.py which passes xyxy to these services)
		box_x = box.get("x", 0)
		box_y = box.get("y", 0)
		box_w = box.get("width", 0)
		box_h = box.get("height", 0)
		xyxy_box = [box_x, box_y, box_x + box_w, box_y + box_h]

		# Compute side and zone using ZoneMapper
		asset_side = zone_mapper.get_road_side(xyxy_box, video_width)
		asset_zone = zone_mapper.resolve_zone(group_id, xyxy_box, video_width, video_height)

		# Compute location using GPX + LatLongEstimator
		asset_location = None
		if gpx_data and gpx_data.get(frame_number):
			car_lat = gpx_data[frame_number]["lat"]
			car_lon = gpx_data[frame_number]["lon"]
			car_heading = lat_long_estimator.calculate_bearing_for_frame(
				frame_number=frame_number,
				interpolated_gpx=gpx_data,
				total_frames=total_frames,
				frame_interval=1,
			)
			estimated = lat_long_estimator.estimate_location(
				car_lat, car_lon, car_heading, video_width, video_height, xyxy_box
			)
			asset_location = {
				"type": "Point",
				"coordinates": [estimated["lon"], estimated["lat"]],
			}

		# Create asset document
		asset_doc = {
			"asset_type": group_id,
			"type": group_id,
			"asset_display_id": asset_display_id,
			"defect_id": defect_id,
			"asset_id": asset_id_str,
			"category_id": category_id,
			"group_id": group_id,
			"confidence": 1.0,
			"condition": condition,
			"frame_number": frame_number,
			"timestamp": timestamp,
			"video_id": video_id,
			"survey_id": survey_id,
			"route_id": route_id,
			"side": asset_side,
			"zone": asset_zone,
			"box": box,
			"location": asset_location,
			"created_at": now,
			"detected_at": now,
			"source": "manual",
			"annotated_by": surveyor_name,
			"annotated_by_user_id": surveyor_user_id,
		}

		result = db.assets.insert_one(asset_doc)
		asset_doc["_id"] = result.inserted_id

		# Generate embedding
		embedding_list = None
		if video_path:
			embedding_list = regenerate_embedding(video_path, int(frame_number), box)
		if embedding_list:
			db.assets.update_one(
				{"_id": asset_doc["_id"]},
				{"$set": {"embedding": embedding_list}},
			)

		# Create master_asset document
		survey_history_entry = {
			"survey_id": survey_id,
			"survey_display_id": survey_display_id,
			"survey_date": survey_date,
			"asset_observation_id": asset_doc["_id"],
			"asset_display_id": asset_display_id,
			"condition": condition,
			"confidence": 1.0,
			"issue": None if condition == "good" else "Defective",
			"defect_id": defect_id,
			"location": asset_location,
			"video_id": video_id,
			"frame_number": frame_number,
			"time": timestamp,
			"box": box,
			"match_confidence": 1.0,
			"created_at": now,
		}

		master_doc = {
			"master_display_id": _generate_master_display_id(db),
			"asset_id": asset_id_str,
			"asset_type": group_id,
			"group_id": group_id,
			"category_id": category_id,
			"side": asset_side,
			"zone": asset_zone,
			"route_id": route_id,
			"route_name": route_name,
			"road_side": road_side,
			"canonical_location": asset_location,
			"embedding": embedding_list,
			"first_seen_date": survey_date,
			"last_seen_date": survey_date,
			"total_surveys_detected": 1,
			"latest_condition": condition,
			"latest_survey_id": survey_id,
			"latest_survey_display_id": survey_display_id,
			"latest_confidence": 1.0,
			"survey_history": [survey_history_entry],
			"issue": None if condition == "good" else "Defective",
			"latest_frame_number": frame_number,
			"latest_video_id": video_id,
			"latest_box": box,
			"latest_defect_id": defect_id,
			"latest_description": None,
			"source": "manual",
			"created_at": now,
			"updated_at": now,
		}

		master_result = db.master_assets.insert_one(master_doc)

		# Link asset to master
		db.assets.update_one(
			{"_id": asset_doc["_id"]},
			{"$set": {"master_asset_id": master_result.inserted_id}},
		)

		# Log to asset_condition_logs so manual additions are attributed to the user
		db.asset_condition_logs.insert_one({
			"master_asset_id": master_result.inserted_id,
			"master_display_id": master_doc["master_display_id"],
			"action": "manual_addition",
			"previous_condition": None,
			"new_condition": condition,
			"name": surveyor_name,
			"user_id": surveyor_user_id,
			"survey_id": survey_id,
			"changed_at": now,
		})

		created_assets.append(asset_display_id)
		created_masters.append(master_doc["master_display_id"])

		# Queue frame detection update
		if frame_number not in frames_updates:
			frames_updates[frame_number] = []
		frames_updates[frame_number].append({
			"class_name": group_id,
			"confidence": 1.0,
			"box": xyxy_box,
			"asset_id": asset_id_str,
			"category_id": category_id,
			"source": "manual",
		})

	# Update frames collection with new detections
	for frame_number, new_detections in frames_updates.items():
		db.frames.update_one(
			{"video_id": video_id, "frame_number": frame_number},
			{
				"$push": {"detections": {"$each": new_detections}},
				"$inc": {"detections_count": len(new_detections)},
			},
		)

	return jsonify({
		"ok": True,
		"assets_created": len(created_assets),
		"asset_ids": created_assets,
		"master_ids": created_masters,
	})


@assets_bp.put("/icon-config", endpoint="update_icon_config")
@role_required(["super_admin","admin"])
def update_icon_config():
	"""
	Update icon configuration for asset types (admin only).
	Updates icon_url, icon_size, icon_anchor on system_asset_labels.
	---
	tags:
	  - Assets
	security:
	  - Bearer: []
	parameters:
	  - name: body
	    in: body
	    required: true
	    schema:
	      type: object
	      required:
	        - asset_ids
	      properties:
	        asset_ids:
	          type: array
	          items:
	            type: string
	        icon_url:
	          type: string
	        icon_size:
	          type: array
	          items:
	            type: integer
	        icon_anchor:
	          type: array
	          items:
	            type: integer
	        display_name:
	          type: string
	        reset:
	          type: boolean
	          description: If true, removes icon overrides and resets display_name to default
	responses:
	  200:
	    description: Icon config updated
	  400:
	    description: Missing asset_ids
	"""
	data = request.get_json(silent=True) or {}
	asset_ids = data.get("asset_ids") or []
	if not asset_ids:
		return jsonify({"error": "asset_ids required"}), 400

	db = get_db()
	reset = data.get("reset", False)

	# Snapshot the current group_id before any mutation so we can propagate
	first_doc = db.system_asset_labels.find_one({"asset_id": asset_ids[0]})
	old_group_id = first_doc.get("group_id", "") if first_doc else ""

	if reset:
		# Reset group_id → default_group_id, category_id → default_category_id,
		# and remove icon fields
		default_gid = first_doc.get("default_group_id", "") if first_doc else ""
		default_cid = first_doc.get("default_category_id") if first_doc else None
		# Uniqueness: if the default group name was taken by another group, reject
		if default_gid and default_gid != old_group_id:
			conflict = db.system_asset_labels.find_one({"group_id": default_gid})
			if conflict:
				return jsonify({"error": f"Cannot reset: \"{default_gid}\" is already used by another group"}), 409

		# Resolve all asset_ids in this group (not just the ones sent)
		all_aids = asset_ids
		if first_doc and first_doc.get("group_id"):
			group_labels = db.system_asset_labels.find(
				{"group_id": first_doc["group_id"]}, {"asset_id": 1}
			)
			all_aids = list({l["asset_id"] for l in group_labels})

		# Batch fetch all docs then update individually (each may have different defaults)
		aid_docs = {
			d["asset_id"]: d
			for d in db.system_asset_labels.find({"asset_id": {"$in": all_aids}})
		}
		for aid in all_aids:
			doc = aid_docs.get(aid)
			if doc:
				dgid = doc.get("default_group_id", "")
				reset_set = {"display_name": dgid, "group_id": dgid}
				dcid = doc.get("default_category_id")
				if dcid:
					reset_set["category_id"] = dcid
				db.system_asset_labels.update_one(
					{"asset_id": aid},
					{
						"$unset": {"icon_url": "", "icon_size": "", "icon_anchor": ""},
						"$set": reset_set,
					}
				)

		# Propagate group_id reset
		_propagate_group_rename(db, old_group_id, default_gid)
		# Propagate category_id reset (if it was ever moved)
		if default_cid:
			_propagate_category_move(db, all_aids, default_cid)

		return jsonify({"ok": True, "message": "icon config reset"})

	update_fields = {}
	if "icon_url" in data:
		update_fields["icon_url"] = data["icon_url"]
	if "icon_size" in data:
		update_fields["icon_size"] = data["icon_size"]
	if "icon_anchor" in data:
		update_fields["icon_anchor"] = data["icon_anchor"]
	if "group_id" in data:
		new_gid = data["group_id"]
		# Uniqueness: reject if another group already uses this name
		if new_gid != old_group_id:
			conflict = db.system_asset_labels.find_one({"group_id": new_gid})
			if conflict:
				return jsonify({"error": f"An asset type named \"{new_gid}\" already exists"}), 409
		update_fields["group_id"] = new_gid
		update_fields["display_name"] = new_gid

	if not update_fields:
		return jsonify({"error": "no fields to update"}), 400

	db.system_asset_labels.update_many(
		{"asset_id": {"$in": asset_ids}},
		{"$set": update_fields}
	)

	# Propagate group_id rename if it changed
	if "group_id" in data:
		_propagate_group_rename(db, old_group_id, data["group_id"])

	return jsonify({"ok": True})


@assets_bp.put("/move-category", endpoint="move_asset_category")
@role_required(["super_admin","admin"])
def move_asset_category():
	"""
	Move asset types to a different category.
	Updates system_asset_labels, master_assets, and assets collections.
	---
	tags:
	  - Assets
	security:
	  - Bearer: []
	parameters:
	  - name: body
	    in: body
	    required: true
	    schema:
	      type: object
	      required:
	        - asset_ids
	        - new_category_id
	      properties:
	        asset_ids:
	          type: array
	          items:
	            type: string
	        new_category_id:
	          type: string
	responses:
	  200:
	    description: Asset category updated
	  400:
	    description: Missing required fields
	"""
	data = request.get_json(silent=True) or {}
	asset_ids = data.get("asset_ids") or []
	new_category_id = data.get("new_category_id")

	if not asset_ids:
		return jsonify({"error": "asset_ids required"}), 400
	if not new_category_id:
		return jsonify({"error": "new_category_id required"}), 400

	db = get_db()

	# Verify the target category exists
	cat = db.system_asset_categories.find_one({"category_id": new_category_id})
	if not cat:
		return jsonify({"error": "category not found"}), 404

	# Resolve ALL asset_ids sharing the same group as the provided ones
	first_label = db.system_asset_labels.find_one({"asset_id": asset_ids[0]})
	if first_label and first_label.get("group_id"):
		group_labels = db.system_asset_labels.find(
			{"group_id": first_label["group_id"]},
			{"asset_id": 1}
		)
		all_asset_ids = list({l["asset_id"] for l in group_labels})
	else:
		all_asset_ids = asset_ids

	# 1. Preserve original category as default_category_id (only on first move)
	db.system_asset_labels.update_many(
		{"asset_id": {"$in": all_asset_ids}, "default_category_id": {"$exists": False}},
		[{"$set": {"default_category_id": "$category_id"}}]
	)

	# 2. Update the label registry (source of truth)
	db.system_asset_labels.update_many(
		{"asset_id": {"$in": all_asset_ids}},
		{"$set": {"category_id": new_category_id}}
	)

	# 3. Propagate to assets, master_assets, video_lib_assets, frames, frames_lib
	_propagate_category_move(db, all_asset_ids, new_category_id)

	return jsonify({"ok": True, "updated_category": new_category_id})


@assets_bp.get("/available-icons", endpoint="available_icons")
@role_required(["super_admin","admin", "surveyor", "viewer"])
def list_available_icons():
	"""
	List available icon files from UPLOAD_DIR/asset-map-icons/.
	---
	tags:
	  - Assets
	security:
	  - Bearer: []
	responses:
	  200:
	    description: List of available icons with their URLs
	"""
	from pathlib import Path
	upload_root = Path(os.getenv("UPLOAD_DIR", Path(__file__).resolve().parents[1] / "uploads"))
	icons_dir = upload_root / "asset-map-icons"
	icons = []
	if icons_dir.is_dir():
		for f in sorted(icons_dir.iterdir()):
			if f.suffix.lower() in (".png", ".svg", ".jpg", ".jpeg", ".webp"):
				icons.append({
					"filename": f.name,
					"icon_url": f"/uploads/asset-map-icons/{f.name}",
				})
	return jsonify({"icons": icons})


@assets_bp.post("/upload-icon", endpoint="upload_icon")
@role_required(["super_admin","admin"])
def upload_icon():
	"""
	Upload a custom icon file for asset types (admin only).
	Saved to UPLOAD_DIR/asset-map-icons/ and served at /uploads/asset-map-icons/<filename>.
	---
	tags:
	  - Assets
	security:
	  - Bearer: []
	consumes:
	  - multipart/form-data
	parameters:
	  - name: icon
	    in: formData
	    type: file
	    required: true
	    description: Icon file (PNG, SVG, JPG, WEBP, max 500KB)
	responses:
	  200:
	    description: Icon uploaded successfully
	  400:
	    description: Invalid file
	"""
	from pathlib import Path
	if "icon" not in request.files:
		return jsonify({"error": "icon file required"}), 400

	file = request.files["icon"]
	if not file.filename:
		return jsonify({"error": "empty filename"}), 400

	# Validate extension
	allowed = {".png", ".svg", ".jpg", ".jpeg", ".webp"}
	ext = os.path.splitext(file.filename)[1].lower()
	if ext not in allowed:
		return jsonify({"error": f"invalid file type. Allowed: {', '.join(allowed)}"}), 400

	# Validate size (500KB max)
	file.seek(0, 2)
	size = file.tell()
	file.seek(0)
	if size > 500 * 1024:
		return jsonify({"error": "file too large (max 500KB)"}), 400

	# Save to UPLOAD_DIR/asset-map-icons/
	upload_root = Path(os.getenv("UPLOAD_DIR", Path(__file__).resolve().parents[1] / "uploads"))
	icons_dir = upload_root / "asset-map-icons"
	icons_dir.mkdir(parents=True, exist_ok=True)

	# Sanitize filename
	safe_name = re.sub(r"[^\w.\-]", "-", os.path.basename(file.filename))
	dest = icons_dir / safe_name
	# Avoid silent overwrite of an existing icon — append "-1", "-2", etc.
	# until we land on a free name. Caller gets the actual filename back.
	if dest.exists():
		stem, suffix = os.path.splitext(safe_name)
		n = 1
		while True:
			candidate = f"{stem}-{n}{suffix}"
			dest = icons_dir / candidate
			if not dest.exists():
				safe_name = candidate
				break
			n += 1
	file.save(dest)

	icon_url = f"/uploads/asset-map-icons/{safe_name}"
	return jsonify({"ok": True, "filename": safe_name, "icon_url": icon_url})


@assets_bp.get("/resolved-map", endpoint="resolved_map")
@role_required(["super_admin", "admin", "surveyor", "viewer"])
def get_resolved_map():
	"""
	Get resolved asset map (system-wide values, no per-user overrides)
	---
	tags:
	  - Assets
	parameters:
	  - name: user_id
	    in: path
	    type: string
	    required: false
	    description: The ID of the user (kept for URL compatibility, no longer used)
	responses:
	  200:
	    description: Resolved map retrieved successfully
	    schema:
	      type: object
	      properties:
	        categories:
	          type: object
	        labels:
	          type: object
	"""
	db = get_db()
	system_cats = list(db.system_asset_categories.find())
	system_labels = list(db.system_asset_labels.find())

	resolved_cats = {}
	for cat in system_cats:
		cid = cat["category_id"]
		resolved_cats[cid] = {
			"category_id": cid,
			"default_name": cat["default_name"],
			"display_name": cat["display_name"]
		}
		
	resolved_labels = {}
	for l in system_labels:
		aid = l["asset_id"]
		# group_id is the authoritative display name; display_name kept for compat
		gid = l.get("group_id") or l.get("display_name") or l["default_name"]
		entry = {
			"asset_id": aid,
			"category_id": l.get("category_id"),
			"category_name": l.get("category_name"),
			"default_name": l["default_name"],
			"group_id": gid,
			"default_group_id": l.get("default_group_id", ""),
			"default_category_id": l.get("default_category_id", ""),
			"display_name": gid,
		}

		if l.get("attributes"):
			entry["attributes"] = l["attributes"]
		if l.get("icon_url"):
			entry["icon_url"] = l["icon_url"]
		if l.get("icon_size"):
			entry["icon_size"] = l["icon_size"]
		if l.get("icon_anchor"):
			entry["icon_anchor"] = l["icon_anchor"]
		resolved_labels[aid] = entry

	return {
		"categories": resolved_cats,
		"labels": resolved_labels
	}


@assets_bp.put("/global-label", endpoint="global_label_update")
@role_required(["super_admin", "admin"])
def update_global_label():
	"""
	Globally rename an asset group (admin only).
	Renames group_id from old_group_id to new_group_id across all
	system_asset_labels sharing that group. display_name is kept in sync.
	The original value is preserved in default_group_id for revert.
	---
	tags:
	  - Assets
	security:
	  - Bearer: []
	parameters:
	  - name: body
	    in: body
	    required: true
	    schema:
	      type: object
	      required:
	        - old_group_id
	        - new_group_id
	      properties:
	        old_group_id:
	          type: string
	          description: Current group_id to rename from
	        new_group_id:
	          type: string
	          description: New group_id to rename to
	responses:
	  200:
	    description: Label updated globally
	  400:
	    description: Missing required fields
	"""
	data = request.get_json(silent=True) or {}
	old_group_id = data.get("old_group_id")
	new_group_id = data.get("new_group_id")

	if not new_group_id or not old_group_id:
		return jsonify({"error": "old_group_id and new_group_id required"}), 400
	if new_group_id == old_group_id:
		return jsonify({"ok": True})

	db = get_db()

	# Uniqueness: reject if another group already uses this name
	conflict = db.system_asset_labels.find_one({"group_id": new_group_id})
	if conflict:
		return jsonify({"error": f"An asset type named \"{new_group_id}\" already exists"}), 409

	# 1. Update the label registry (source of truth)
	db.system_asset_labels.update_many(
		{"group_id": old_group_id},
		{"$set": {"group_id": new_group_id, "display_name": new_group_id}}
	)

	# 2. Propagate to assets, master_assets, video_lib_assets
	_propagate_group_rename(db, old_group_id, new_group_id)

	return jsonify({"ok": True})


@assets_bp.put("/global-category", endpoint="global_category_update")
@role_required(["super_admin", "admin"])
def update_global_category():
	"""
	Globally update display name for an asset category (admin only).
	Writes directly to system_asset_categories.display_name.
	---
	tags:
	  - Assets
	security:
	  - Bearer: []
	parameters:
	  - name: body
	    in: body
	    required: true
	    schema:
	      type: object
	      required:
	        - category_id
	        - display_name
	      properties:
	        category_id:
	          type: string
	        display_name:
	          type: string
	responses:
	  200:
	    description: Category updated globally
	  400:
	    description: Missing required fields
	  404:
	    description: Category not found
	"""
	data = request.get_json(silent=True) or {}
	category_id = (data.get("category_id") or "").strip()
	display_name = (data.get("display_name") or "").strip()

	if not category_id:
		return jsonify({"error": "category_id required"}), 400
	if not display_name:
		return jsonify({"error": "display_name required"}), 400

	db = get_db()
	res = db.system_asset_categories.update_one(
		{"category_id": category_id},
		{"$set": {"display_name": display_name}}
	)
	if res.matched_count == 0:
		return jsonify({"error": "category not found"}), 404

	return jsonify({"ok": True})