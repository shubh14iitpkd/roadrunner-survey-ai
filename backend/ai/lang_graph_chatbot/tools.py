"""
LangGraph Chatbot Tools
All tools return raw JSON data — the agent LLM forms natural responses.
"""

import json
import os
from datetime import datetime, timedelta
from typing import Optional
from langchain.tools import tool
from pymongo import MongoClient
from dotenv import load_dotenv

from utils.is_demo_video import is_demo, get_video_key
from ai.lang_graph_chatbot.get_resolved_map import get_resolved_map

load_dotenv()

MONGO_URI = os.environ.get("MONGO_URI", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "roadrunner")

GOOD_CONDITIONS = ["good", "fine", "visible"]
DAMAGED_CONDITIONS = ["damaged", "bad", "poor", "missing", "broken", "bent", "dirty", "overgrown"]

_client = None


def get_db():
    """Get MongoDB database connection."""
    global _client
    if _client is None:
        _client = MongoClient(
            MONGO_URI,
            uuidRepresentation="standard",
            maxPoolSize=50,
            serverSelectionTimeoutMS=5000,
        )
    return _client[DB_NAME]


def _is_demo_video_id(video_id: str) -> bool:
    if not video_id:
        return False
    return is_demo(video_url=video_id + ".mp4")


def _get_asset_query_filter(video_id: str = "", route_id: Optional[int] = None) -> dict:
    query = {}
    if video_id:
        if _is_demo_video_id(video_id):
            query["video_key"] = video_id
        else:
            query["video_id"] = video_id
    if route_id is not None:
        query["route_id"] = route_id
    return query


# ---------- helpers for display names ----------

def _resolve_category_id(category_name: str) -> str | None:
    rm = get_resolved_map()
    name_lower = category_name.strip().lower()
    for cid, info in rm["categories"].items():
        if info["display_name"].lower() == name_lower or info["default_name"].lower() == name_lower:
            return cid
    return None


def _resolve_asset_ids(asset_name: str) -> list[str]:
    """
    Resolve an asset display name to ALL matching asset_ids.
    E.g. "Guardrail" → [type_asset_102, type_asset_103, type_asset_104]
    This handles the case where label names include condition suffixes.
    """
    rm = get_resolved_map()
    name_lower = asset_name.strip().lower()

    # First try exact match
    exact = []
    prefix_matches = []
    for aid, info in rm["labels"].items():
        dn = info["display_name"].lower()
        defn = info["default_name"].lower()
        if dn == name_lower or defn == name_lower:
            exact.append(aid)
        elif dn.startswith(name_lower + " ") or defn.startswith(name_lower.replace(" ", "_") + "_"):
            prefix_matches.append(aid)

    return exact + prefix_matches if (exact or prefix_matches) else []



def _cat_name(category_id: str) -> str:
    rm = get_resolved_map()
    info = rm["categories"].get(category_id)
    return info["display_name"] if info else category_id


def _label_name(asset_id: str) -> str:
    rm = get_resolved_map()
    info = rm["labels"].get(asset_id)
    return info["display_name"] if info else asset_id


def _classify_condition(condition: str) -> str:
    c = (condition or "").lower()
    if c in DAMAGED_CONDITIONS:
        return "damaged"
    return "good"


# ---------- time helpers ----------

def _get_date_range(period: str) -> tuple[str, str]:
    """Return (start_date, end_date) as YYYY-MM-DD strings for a period."""
    today = datetime.now()
    if period == "today":
        start = today
    elif period == "week":
        start = today - timedelta(days=7)
    elif period == "month":
        start = today.replace(day=1)
    elif period == "year":
        start = today.replace(month=1, day=1)
    else:
        start = today.replace(month=1, day=1)
    return start.strftime("%Y-%m-%d"), today.strftime("%Y-%m-%d")


# =============================================================================
# TOOLS — All return raw JSON for the agent to narrate
# =============================================================================


@tool
def list_videos(route_id: Optional[int] = None) -> str:
    """
    List uploaded videos, optionally filtered by route_id.
    Use when user asks about videos on a route.

    Args:
        route_id: Optional route number to filter by

    Returns:
        JSON array of videos
    """
    db = get_db()
    query = {}
    if route_id is not None:
        query["route_id"] = route_id

    videos = list(db.videos.find(query).sort("created_at", -1).limit(30))

    data = []
    for v in videos:
        storage_url = v.get("storage_url", "")
        data.append({
            "title": v.get("title", "Untitled"),
            "route_id": v.get("route_id"),
            "uploaded": str(v.get("created_at", "")),
            "video_key": get_video_key(storage_url) if storage_url else None,
        })
    return json.dumps({"count": len(data), "videos": data})


@tool
def list_surveys(status: str = "", route_id: Optional[int] = None) -> str:
    """
    List surveys, optionally filtered by status and route.
    Use when user asks for surveys or survey list.

    Args:
        status: Optional — "completed", "processing", "uploaded"
        route_id: Optional route number

    Returns:
        JSON array of surveys
    """
    db = get_db()
    query = {}
    if status and status.strip():
        query["status"] = {"$regex": status, "$options": "i"}
    if route_id is not None:
        query["route_id"] = route_id

    surveys = list(db.surveys.find(query).sort("survey_date", -1).limit(30))

    data = []
    for s in surveys:
        data.append({
            "route_id": s.get("route_id"),
            "date": s.get("survey_date"),
            "surveyor": s.get("surveyor_name"),
            "version": s.get("survey_version", 1),
            "is_latest": s.get("is_latest", False),
            "status": s.get("status"),
        })
    return json.dumps({"count": len(data), "surveys": data})


@tool
def get_survey_stats(period: str = "all", route_id: Optional[int] = None) -> str:
    """
    Get survey statistics: count by time period and top surveyors.
    Use for "How many surveys this month?", "Who did the most surveys?", etc.

    Args:
        period: "today", "week", "month", "year", or "all"
        route_id: Optional route to filter by

    Returns:
        JSON with survey count, period, and surveyor rankings
    """
    db = get_db()
    query: dict = {}
    if route_id is not None:
        query["route_id"] = route_id

    if period != "all":
        start_date, end_date = _get_date_range(period)
        query["survey_date"] = {"$gte": start_date, "$lte": end_date}

    total = db.surveys.count_documents(query)

    # Top surveyors
    surveyor_pipeline = [
        {"$match": query},
        {"$group": {"_id": "$surveyor_name", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
        {"$limit": 10},
    ]
    surveyors = list(db.surveys.aggregate(surveyor_pipeline))

    # Surveys per route
    route_pipeline = [
        {"$match": query},
        {"$group": {"_id": "$route_id", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
        {"$limit": 10},
    ]
    routes = list(db.surveys.aggregate(route_pipeline))

    return json.dumps({
        "period": period,
        "total_surveys": total,
        "top_surveyors": [{"name": s["_id"], "count": s["count"]} for s in surveyors],
        "surveys_per_route": [{"route_id": r["_id"], "count": r["count"]} for r in routes],
    })


@tool
def describe_route(route_id: int) -> str:
    """
    Get details about a specific route.
    Use when user asks "Describe route 258", "Tell me about this route", etc.

    Args:
        route_id: The route number

    Returns:
        JSON with route metadata (name, distance, endpoints, type, survey count, asset count)
    """
    db = get_db()
    road = db.roads.find_one({"route_id": route_id})
    if not road:
        return json.dumps({"error": f"Route {route_id} not found"})

    survey_count = db.surveys.count_documents({"route_id": route_id})
    asset_count = db.assets.count_documents({"route_id": route_id})
    video_count = db.videos.count_documents({"route_id": route_id})

    return json.dumps({
        "route_id": route_id,
        "road_name": road.get("road_name"),
        "road_type": road.get("road_type"),
        "road_side": road.get("road_side"),
        "distance_km": road.get("estimated_distance_km"),
        "start_point": road.get("start_point_name"),
        "start_lat": road.get("start_lat"),
        "start_lng": road.get("start_lng"),
        "end_point": road.get("end_point_name"),
        "end_lat": road.get("end_lat"),
        "end_lng": road.get("end_lng"),
        "total_surveys": survey_count,
        "total_assets_detected": asset_count,
        "total_videos": video_count,
    })


@tool
def get_asset_condition_summary(video_id: str = "", route_id: Optional[int] = None) -> str:
    """
    Overall good vs damaged summary for all assets on a video or route.
    Use for general asset health / condition overview.

    Args:
        video_id: Optional specific video ID
        route_id: Optional route ID

    Returns:
        JSON with total, good, damaged counts and percentages
    """
    db = get_db()

    if not video_id and route_id is None:
        video = db.videos.find_one({}, sort=[("created_at", -1)])
        if not video:
            return json.dumps({"error": "No data found"})
        storage_url = video.get("storage_url", "")
        video_id = get_video_key(storage_url) if storage_url else str(video["_id"])

    asset_filter = _get_asset_query_filter(video_id, route_id)
    pipeline = [
        {"$match": asset_filter},
        {"$group": {"_id": "$condition", "count": {"$sum": 1}}},
    ]
    results = list(db.assets.aggregate(pipeline))

    if not results:
        return json.dumps({"error": "No assets found", "video_id": video_id, "route_id": route_id})

    total = sum(r["count"] for r in results)
    good = sum(r["count"] for r in results if _classify_condition(r["_id"]) == "good")
    damaged = total - good

    return json.dumps({
        "video_id": video_id or None,
        "route_id": route_id,
        "total": total,
        "good": good,
        "good_pct": round(good / total * 100, 1) if total else 0,
        "damaged": damaged,
        "damaged_pct": round(damaged / total * 100, 1) if total else 0,
    })


@tool
def list_asset_categories(with_labels: bool = False) -> str:
    """
    List all asset categories, optionally with the labels under each.
    Use for "What are the asset categories?" or "What labels are in category X?".

    Args:
        with_labels: Include the list of labels per category

    Returns:
        JSON array of categories
    """
    rm = get_resolved_map()

    cat_labels: dict[str, list[str]] = {}
    for aid, info in rm["labels"].items():
        cid = info.get("category_id", "unknown")
        cat_labels.setdefault(cid, []).append(info["display_name"])

    categories = []
    for cid, cat_info in rm["categories"].items():
        labels = sorted(cat_labels.get(cid, []))
        entry: dict = {
            "category_id": cid,
            "name": cat_info["display_name"],
            "label_count": len(labels),
        }
        if with_labels:
            entry["labels"] = labels
        categories.append(entry)

    return json.dumps({"total_categories": len(categories), "categories": categories})


@tool
def list_assets_in_category(category_name: str, route_id: Optional[int] = None) -> str:
    """
    Detected assets within a category with good/damaged counts.
    Use for "List assets in Roadway Lighting", "Show pavement assets".

    Args:
        category_name: Category display name (e.g. "Roadway Lighting")
        route_id: Optional route ID to filter by

    Returns:
        JSON array of detected asset types with condition counts
    """
    cid = _resolve_category_id(category_name)
    if not cid:
        return json.dumps({"error": f"Category '{category_name}' not found"})

    db = get_db()
    query: dict = {"category_id": cid}
    if route_id is not None:
        query["route_id"] = route_id

    pipeline = [
        {"$match": query},
        {"$group": {
            "_id": {"asset_id": "$asset_id", "condition": "$condition"},
            "count": {"$sum": 1}
        }},
    ]
    results = list(db.assets.aggregate(pipeline))

    if not results:
        return json.dumps({"category": category_name, "route_id": route_id, "assets": [], "total": 0})

    asset_data: dict[str, dict] = {}
    for r in results:
        aid = r["_id"]["asset_id"]
        entry = asset_data.setdefault(aid, {"good": 0, "damaged": 0, "total": 0})
        if _classify_condition(r["_id"]["condition"]) == "damaged":
            entry["damaged"] += r["count"]
        else:
            entry["good"] += r["count"]
        entry["total"] += r["count"]

    assets = []
    for aid, data in sorted(asset_data.items(), key=lambda x: x[1]["total"], reverse=True):
        assets.append({"name": _label_name(aid), "good": data["good"], "damaged": data["damaged"], "total": data["total"]})

    return json.dumps({
        "category": _cat_name(cid),
        "route_id": route_id,
        "assets": assets,
        "total": sum(d["total"] for d in asset_data.values()),
    })


@tool
def get_category_condition_breakdown(category_name: str, route_id: Optional[int] = None) -> str:
    """
    Good vs damaged breakdown for a specific category.
    Use for "Condition of traffic signs", "How are pavement assets?".

    Args:
        category_name: Category display name (e.g. "Directional Signage")
        route_id: Optional route ID

    Returns:
        JSON with good/damaged counts and percentages for the category
    """
    cid = _resolve_category_id(category_name)
    if not cid:
        return json.dumps({"error": f"Category '{category_name}' not found"})

    db = get_db()
    query: dict = {"category_id": cid}
    if route_id is not None:
        query["route_id"] = route_id

    pipeline = [
        {"$match": query},
        {"$group": {"_id": "$condition", "count": {"$sum": 1}}},
    ]
    results = list(db.assets.aggregate(pipeline))

    if not results:
        return json.dumps({"category": _cat_name(cid), "route_id": route_id, "error": "No assets found"})

    total = sum(r["count"] for r in results)
    good = sum(r["count"] for r in results if _classify_condition(r["_id"]) == "good")
    damaged = total - good

    return json.dumps({
        "category": _cat_name(cid),
        "route_id": route_id,
        "total": total,
        "good": good,
        "good_pct": round(good / total * 100, 1) if total else 0,
        "damaged": damaged,
        "damaged_pct": round(damaged / total * 100, 1) if total else 0,
    })


@tool
def get_asset_type_condition(asset_name: str, route_id: Optional[int] = None) -> str:
    """
    Condition breakdown for a specific asset type (not category).
    Use for "Condition of street lights", "How many guardrails are damaged?".

    Args:
        asset_name: Asset type display name (e.g. "Street Light Pole", "Guardrail", "Traffic Sign")
        route_id: Optional route ID

    Returns:
        JSON with good/damaged counts for that specific asset type
    """
    aids = _resolve_asset_ids(asset_name)
    if not aids:
        return json.dumps({"error": f"Asset type '{asset_name}' not found. Use list_asset_categories(with_labels=True) to see valid asset types."})

    rm = get_resolved_map()
    label_info = rm["labels"].get(aids[0], {})

    db = get_db()
    query: dict = {"asset_id": {"$in": aids}}
    if route_id is not None:
        query["route_id"] = route_id

    pipeline = [
        {"$match": query},
        {"$group": {"_id": "$condition", "count": {"$sum": 1}}},
    ]
    results = list(db.assets.aggregate(pipeline))

    if not results:
        return json.dumps({"asset": asset_name, "route_id": route_id, "total": 0, "error": "No detections found"})

    total = sum(r["count"] for r in results)
    good = sum(r["count"] for r in results if _classify_condition(r["_id"]) == "good")
    damaged = total - good

    return json.dumps({
        "asset": asset_name,
        "category": _cat_name(label_info.get("category_id", "")),
        "route_id": route_id,
        "total": total,
        "good": good,
        "good_pct": round(good / total * 100, 1) if total else 0,
        "damaged": damaged,
        "damaged_pct": round(damaged / total * 100, 1) if total else 0,
    })


@tool
def list_detected_assets(route_id: Optional[int] = None) -> str:
    """
    All detected asset types with counts and condition, grouped by category.
    Use for "What assets were detected?", "Show all assets on this route".

    Args:
        route_id: Optional route ID

    Returns:
        JSON with assets grouped by category
    """
    db = get_db()
    query: dict = {}
    if route_id is not None:
        query["route_id"] = route_id

    pipeline = [
        {"$match": query},
        {"$group": {
            "_id": {"asset_id": "$asset_id", "category_id": "$category_id", "condition": "$condition"},
            "count": {"$sum": 1}
        }},
    ]
    results = list(db.assets.aggregate(pipeline))

    if not results:
        return json.dumps({"route_id": route_id, "categories": [], "grand_total": 0})

    # Pivot: (category_id, asset_id) -> {good, damaged, total}
    asset_data: dict[tuple, dict] = {}
    for r in results:
        key = (r["_id"]["category_id"], r["_id"]["asset_id"])
        entry = asset_data.setdefault(key, {"good": 0, "damaged": 0, "total": 0})
        if _classify_condition(r["_id"]["condition"]) == "damaged":
            entry["damaged"] += r["count"]
        else:
            entry["good"] += r["count"]
        entry["total"] += r["count"]

    by_category: dict[str, list] = {}
    for (cid, aid), data in asset_data.items():
        by_category.setdefault(cid, []).append({
            "name": _label_name(aid),
            "good": data["good"],
            "damaged": data["damaged"],
            "total": data["total"],
        })

    categories = []
    grand_total = 0
    for cid in sorted(by_category.keys()):
        items = sorted(by_category[cid], key=lambda x: x["total"], reverse=True)
        cat_total = sum(i["total"] for i in items)
        grand_total += cat_total
        categories.append({
            "category": _cat_name(cid),
            "assets": items,
            "category_total": cat_total,
        })

    return json.dumps({"route_id": route_id, "categories": categories, "grand_total": grand_total})


@tool
def get_asset_locations(asset_name: str = "", category_name: str = "", route_id: Optional[int] = None, limit: int = 50) -> str:
    """
    Get locations (lat/lng) where assets were detected.
    Use for "Where were traffic signs detected?", "Show locations of guardrails".

    Args:
        asset_name: Optional specific asset type name (e.g. "Guardrail")
        category_name: Optional category name (e.g. "Roadway Lighting")
        route_id: Optional route ID
        limit: Max results (default 50)

    Returns:
        JSON array of assets with lat/lng, condition, and confidence
    """
    db = get_db()
    query: dict = {"location": {"$exists": True}}

    if asset_name:
        aids = _resolve_asset_ids(asset_name)
        if aids:
            query["asset_id"] = {"$in": aids}
        else:
            return json.dumps({"error": f"Asset type '{asset_name}' not found"})

    if category_name:
        cid = _resolve_category_id(category_name)
        if cid:
            query["category_id"] = cid
        else:
            return json.dumps({"error": f"Category '{category_name}' not found"})

    if route_id is not None:
        query["route_id"] = route_id

    assets = list(db.assets.find(query).limit(limit))

    locations = []
    for a in assets:
        loc = a.get("location", {})
        coords = loc.get("coordinates", [])
        if len(coords) >= 2:
            locations.append({
                "asset": _label_name(a.get("asset_id", "")),
                "condition": a.get("condition"),
                "lng": coords[0],
                "lat": coords[1],
                "confidence": a.get("confidence"),
            })

    return json.dumps({
        "filter": {"asset_name": asset_name or None, "category_name": category_name or None, "route_id": route_id},
        "count": len(locations),
        "locations": locations,
    })


@tool
def get_damage_hotspots(route_id: int, top_n: int = 5) -> str:
    """
    Find locations with the highest concentration of damaged assets.
    Use for "Where are the damage hotspots?", "Where are most defects?".

    Args:
        route_id: Route to analyze
        top_n: Number of hotspot clusters to return (default 5)

    Returns:
        JSON array of hotspot areas with damage counts and center coordinates
    """
    db = get_db()
    query: dict = {
        "route_id": route_id,
        "condition": {"$in": DAMAGED_CONDITIONS},
        "location": {"$exists": True},
    }

    damaged_assets = list(db.assets.find(query))

    if not damaged_assets:
        return json.dumps({"route_id": route_id, "hotspots": [], "total_damaged": 0})

    # Simple grid-based clustering: round coordinates to ~100m cells
    GRID_PRECISION = 3  # ~111m per 0.001 degree
    clusters: dict[tuple, dict] = {}

    for a in damaged_assets:
        loc = a.get("location", {})
        coords = loc.get("coordinates", [])
        if len(coords) < 2:
            continue

        lng, lat = coords[0], coords[1]
        cell = (round(lat, GRID_PRECISION), round(lng, GRID_PRECISION))

        entry = clusters.setdefault(cell, {
            "lats": [], "lngs": [], "count": 0, "asset_types": []
        })
        entry["lats"].append(lat)
        entry["lngs"].append(lng)
        entry["count"] += 1
        asset_name = _label_name(a.get("asset_id", ""))
        if asset_name not in entry["asset_types"]:
            entry["asset_types"].append(asset_name)

    # Sort by count, take top N
    sorted_clusters = sorted(clusters.values(), key=lambda c: c["count"], reverse=True)[:top_n]

    hotspots = []
    for c in sorted_clusters:
        hotspots.append({
            "center_lat": round(sum(c["lats"]) / len(c["lats"]), 6),
            "center_lng": round(sum(c["lngs"]) / len(c["lngs"]), 6),
            "damaged_count": c["count"],
            "asset_types_affected": c["asset_types"],
        })

    return json.dumps({
        "route_id": route_id,
        "total_damaged": len(damaged_assets),
        "hotspots": hotspots,
    })


@tool
def get_most_damaged_types(route_id: Optional[int] = None, limit: int = 10) -> str:
    """
    Asset types ranked by damage count/rate.
    Use for "Which assets have the most defects?", "Most damaged asset types".

    Args:
        route_id: Optional route ID
        limit: Max asset types to return (default 10)

    Returns:
        JSON array of asset types sorted by damage rate
    """
    db = get_db()
    query: dict = {}
    if route_id is not None:
        query["route_id"] = route_id

    pipeline = [
        {"$match": query},
        {"$group": {
            "_id": {"asset_id": "$asset_id", "condition": "$condition"},
            "count": {"$sum": 1}
        }},
    ]
    results = list(db.assets.aggregate(pipeline))

    if not results:
        return json.dumps({"route_id": route_id, "assets": []})

    # Pivot
    asset_data: dict[str, dict] = {}
    for r in results:
        aid = r["_id"]["asset_id"]
        entry = asset_data.setdefault(aid, {"good": 0, "damaged": 0, "total": 0})
        if _classify_condition(r["_id"]["condition"]) == "damaged":
            entry["damaged"] += r["count"]
        else:
            entry["good"] += r["count"]
        entry["total"] += r["count"]

    # Sort by damage count descending, only include those with damage > 0
    ranked = []
    for aid, data in asset_data.items():
        if data["damaged"] > 0:
            ranked.append({
                "asset": _label_name(aid),
                "category": _cat_name(get_resolved_map()["labels"].get(aid, {}).get("category_id", "")),
                "damaged": data["damaged"],
                "good": data["good"],
                "total": data["total"],
                "damage_rate_pct": round(data["damaged"] / data["total"] * 100, 1) if data["total"] else 0,
            })

    ranked.sort(key=lambda x: x["damaged"], reverse=True)
    return json.dumps({"route_id": route_id, "assets": ranked[:limit]})


# =============================================================================
# TOOL REGISTRY
# =============================================================================

ALL_TOOLS = [
    list_videos,
    list_surveys,
    get_survey_stats,
    describe_route,
    get_asset_condition_summary,
    list_asset_categories,
    list_assets_in_category,
    get_category_condition_breakdown,
    get_asset_type_condition,
    list_detected_assets,
    get_asset_locations,
    get_damage_hotspots,
    get_most_damaged_types,
]
