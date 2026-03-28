"""
LangGraph Chatbot Tools
All tools return raw JSON data — the agent LLM forms natural responses.
"""

import json
import os
from datetime import datetime, timedelta
from typing import Optional
from langchain.tools import tool

from ai.lang_graph_chatbot.get_resolved_map import get_resolved_map
from db import get_db

GOOD_CONDITIONS = ["good", "fine", "visible"]
DAMAGED_CONDITIONS = ["damaged", "bad", "poor", "missing", "broken", "bent", "dirty", "overgrown"]


# ---------- helpers for display names ----------

def _resolve_category_id(category_name: str) -> str | None:
    rm = get_resolved_map()
    name_lower = category_name.strip().lower()
    for cid, info in rm["categories"].items():
        if info["display_name"].lower() == name_lower or info["default_name"].lower() == name_lower:
            return cid
    return None

def _resolve_group_id(group_name: str) -> str | None:
    rm = get_resolved_map()
    name_lower = group_name.strip().lower()
    for _, info in rm["labels"].items():
        if info["group_id"].lower() == name_lower or info["display_name"].lower() == name_lower:
            return info["group_id"]
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


def _is_damaged(condition: str) -> bool:
    """Return True if the condition is classified as damaged."""
    return _classify_condition(condition) == "damaged"


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
        data.append({
            "title": v.get("title", "Untitled"),
            "route_id": v.get("route_id"),
            "uploaded": str(v.get("created_at", "")),
            "video_id": str(v["_id"]),
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
    asset_count = db.master_assets.count_documents({"route_id": route_id})
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
def get_asset_condition_summary(route_id: Optional[int] = None) -> str:
    """
    Overall good vs damaged summary for all assets on a route.
    Use for general asset health / condition overview.

    Args:
        route_id: Optional route ID

    Returns:
        JSON with total, good, damaged counts and percentages
    """
    db = get_db()

    query: dict = {}
    if route_id is not None:
        query["route_id"] = route_id

    pipeline = [
        {"$match": query},
        {"$group": {"_id": "$latest_condition", "count": {"$sum": 1}}},
    ]
    results = list(db.master_assets.aggregate(pipeline))

    if not results:
        return json.dumps({"error": "No assets found", "route_id": route_id})

    total = sum(r["count"] for r in results)
    good = sum(r["count"] for r in results if _classify_condition(r["_id"]) == "good")
    damaged = total - good

    return json.dumps({
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
            "_id": "$group_id",
            "count": {"$sum": 1},
            "good": {"$sum": {"$cond": [{"$eq": ["$latest_condition", "good"]}, 1, 0]}},
            "damaged": {"$sum": {"$cond": [{"$ne": ["$latest_condition", "good"]}, 1, 0]}},
        }},
    ]

    """
    [
        {"$match": { "category_id": type_category_2 }},
        {"$group": {
            "_id": "$asset_id",
            "count": {"$sum": 1},
            "good": {"$sum": {"$cond": [{"$eq": ["$latest_condition", "good"]}, 1, 0]}},
            "damaged": {"$sum": {"$cond": [{"$ne": ["$latest_condition", "good"]}, 1, 0]}},
        }},
    ]
    """
    results = list(db.master_assets.aggregate(pipeline))

    if not results:
        return json.dumps({"category": category_name, "route_id": route_id, "assets": [], "total": 0})

    assets = []
    for r in results:
        assets.append({
            "name": _label_name(r["_id"]),
            "good": r["good"],
            "damaged": r["damaged"],
            "total": r["count"],
        })
    assets.sort(key=lambda x: x["total"], reverse=True)

    return json.dumps({
        "category": _cat_name(cid),
        "route_id": route_id,
        "assets": assets,
        "total": sum(r["count"] for r in results),
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
        {"$group": {"_id": "$latest_condition", "count": {"$sum": 1}}},
    ]
    results = list(db.master_assets.aggregate(pipeline))

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
        {"$group": {"_id": "$latest_condition", "count": {"$sum": 1}}},
    ]
    results = list(db.master_assets.aggregate(pipeline))

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
            "_id": {"asset_id": "$asset_id", "category_id": "$category_id"},
            "count": {"$sum": 1},
            "good": {"$sum": {"$cond": [{"$eq": ["$latest_condition", "good"]}, 1, 0]}},
            "damaged": {"$sum": {"$cond": [{"$ne": ["$latest_condition", "good"]}, 1, 0]}},
        }},
    ]
    results = list(db.master_assets.aggregate(pipeline))

    if not results:
        return json.dumps({"route_id": route_id, "categories": [], "grand_total": 0})

    by_category: dict[str, list] = {}
    for r in results:
        cid = r["_id"]["category_id"]
        by_category.setdefault(cid, []).append({
            "name": _label_name(r["_id"]["asset_id"]),
            "good": r["good"],
            "damaged": r["damaged"],
            "total": r["count"],
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
def get_asset_locations(asset_name: str = "", category_name: str = "", route_id: Optional[int] = None, condition: str = "", limit: int = 20) -> str:
    """
    Get locations (lat/lng) where assets were detected and listing assets.
    Use for "Where were traffic signs detected?", "Show locations of guardrails",
    "Show damaged sign locations", "Map all damaged ITS assets", "List of all street lights".

    Args:
        asset_name: Optional specific asset type name (e.g. "Guardrail")
        category_name: Optional category name (e.g. "Roadway Lighting")
        route_id: Optional route ID
        condition: Optional condition filter — pass "damaged" to return only damaged assets,
                   or "good" for good assets. Leave empty for all.
        limit: Max results (default 20)

    Returns:
        JSON array of assets with lat/lng, condition, and confidence

    Instruction: if response contains list of data, format result in tabular form and include the message if provided.
    """
    db = get_db()
    query: dict = {"canonical_location": {"$exists": True}}

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

    # Condition filter
    if condition:
        norm = condition.strip().lower()
        if norm == "damaged":
            query["latest_condition"] = {"$ne": "good"}
        elif norm == "good":
            query["latest_condition"] = "good"

    total_count = db.master_assets.count_documents(query)
    assets = list(db.master_assets.find(query).limit(limit))

    locations = []
    for a in assets:
        loc = a.get("canonical_location", {})
        coords = loc.get("coordinates", [])
        if len(coords) >= 2:
            locations.append({
                "asset": _label_name(a.get("asset_id", "")),
                "condition": a.get("latest_condition"),
                "lng": coords[0],
                "lat": coords[1],
                "confidence": a.get("latest_confidence"),
            })

    result = {
        "filter": {"asset_name": asset_name or None, "category_name": category_name or None,
                   "route_id": route_id, "condition": condition or None},
        "count": len(locations),
        "locations": locations,
    }

    if total_count > limit:
        result["message"] = (
            f"Showing {limit} of {total_count} total matching assets. "
            "RoadGPT can display a maximum of 20 assets at a time. "
            "Please use the Asset Library to view the full list."
        )

    return json.dumps(result)


@tool
def get_damage_hotspots(route_id: int, top_n: int = 5) -> str:
    """
    Find locations with the highest concentration of damaged assets.
    Use for "Where are the damage hotspots?", "Where are most defects?", "Which areas have most defects".

    Args:
        route_id: Route to analyze
        top_n: Number of hotspot clusters to return (default 5)

    Returns:
        JSON array of hotspot areas with damage counts and center coordinates
    """
    db = get_db()
    query: dict = {
        "route_id": route_id,
        "latest_condition": {"$ne": "good"},
        "canonical_location": {"$exists": True},
    }

    damaged_assets = list(db.master_assets.find(query))

    if not damaged_assets:
        return json.dumps({"route_id": route_id, "hotspots": [], "total_damaged": 0})

    # Simple grid-based clustering: round coordinates to ~100m cells
    GRID_PRECISION = 3  # ~111m per 0.001 degree
    clusters: dict[tuple, dict] = {}

    for a in damaged_assets:
        loc = a.get("canonical_location", {})
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
def get_asset_type_conditions_for_chart(route_id: Optional[int] = None, top_n: int = 10, sort_by: str = "total") -> str:
    """
    Get condition (good/damaged/total) for every distinct asset type on a route,
    sorted and capped at top_n for chart visualization.
    Use INSTEAD of list_detected_assets when the user asks for a chart of
    asset type conditions, e.g. "bar chart of all asset conditions on route X",
    "condition of all asset types as a chart".

    Args:
        route_id: Optional route ID to filter by
        top_n: Maximum number of asset types to return (default 10). Capped at 15.
        sort_by: Sort order — "total" (most assets first) or "damaged" (most damaged first)

    Returns:
        JSON with flat list of asset types with good/damaged/total counts,
        total_types in the DB, and a truncation message if results were capped.
    """
    top_n = min(top_n, 15)  # hard cap to prevent chart overflow

    db = get_db()
    query: dict = {}
    if route_id is not None:
        query["route_id"] = route_id

    pipeline = [
        {"$match": query},
        {"$group": {
            "_id": "$group_id",
            "count": {"$sum": 1},
            "good": {"$sum": {"$cond": [{"$eq": ["$latest_condition", "good"]}, 1, 0]}},
            "damaged": {"$sum": {"$cond": [{"$ne": ["$latest_condition", "good"]}, 1, 0]}},
        }},
    ]
    results = list(db.master_assets.aggregate(pipeline))

    if not results:
        return json.dumps({"route_id": route_id, "assets": [], "total_types": 0})

    sort_key = "damaged" if sort_by == "damaged" else "total"
    assets = []
    for r in results:
        total = r["count"]
        assets.append({
            "name": _label_name(r["_id"]),
            "good": r["good"],
            "damaged": r["damaged"],
            "total": total,
            "damage_rate_pct": round(r["damaged"] / total * 100, 1) if total else 0,
        })

    assets.sort(key=lambda x: x[sort_key], reverse=True)

    total_types = len(assets)
    truncated = total_types > top_n
    assets = assets[:top_n]

    result: dict = {
        "route_id": route_id,
        "assets": assets,
        "total_types": total_types,
        "showing": len(assets),
        "truncated": truncated,
    }
    if truncated:
        result["truncation_note"] = (
            f"Showing the top {top_n} asset types by {sort_key} count out of "
            f"{total_types} total asset types found on this route."
        )

    return json.dumps(result)


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
            "_id": "$group_id",
            "count": {"$sum": 1},
            "good": {"$sum": {"$cond": [{"$eq": ["$latest_condition", "good"]}, 1, 0]}},
            "damaged": {"$sum": {"$cond": [{"$ne": ["$latest_condition", "good"]}, 1, 0]}},
        }},
    ]
    results = list(db.master_assets.aggregate(pipeline))

    if not results:
        return json.dumps({"route_id": route_id, "assets": []})

    # Sort by damage count descending, only include those with damage > 0
    ranked = []
    for r in results:
        if r["damaged"] > 0:
            ranked.append({
                "asset": _label_name(r["_id"]),
                "category": _cat_name(get_resolved_map()["labels"].get(r["_id"], {}).get("category_id", "")),
                "damaged": r["damaged"],
                "good": r["good"],
                "total": r["count"],
                "damage_rate_pct": round(r["damaged"] / r["count"] * 100, 1) if r["count"] else 0,
            })

    ranked.sort(key=lambda x: x["damaged"], reverse=True)
    return json.dumps({"route_id": route_id, "assets": ranked[:limit]})


@tool
def list_surveyed_routes(period: str = "all") -> str:
    """
    List all routes that have been surveyed, with survey count and latest survey date.
    Use for "How many routes have we surveyed?", "Which routes have surveys?", "List surveyed routes".

    Args:
        period: "today", "week", "month", "year", or "all"

    Returns:
        JSON with list of surveyed routes and their survey counts
    """
    db = get_db()
    match_query: dict = {}

    if period != "all":
        start_date, end_date = _get_date_range(period)
        match_query["survey_date"] = {"$gte": start_date, "$lte": end_date}

    pipeline = [
        {"$match": match_query},
        {"$group": {
            "_id": "$route_id",
            "survey_count": {"$sum": 1},
            "latest_survey_date": {"$max": "$survey_date"},
            "surveyors": {"$addToSet": "$surveyor_name"},
        }},
        {"$sort": {"survey_count": -1}},
    ]
    results = list(db.surveys.aggregate(pipeline))

    # Enrich with road names
    route_ids = [r["_id"] for r in results]
    roads = {r["route_id"]: r for r in db.roads.find({"route_id": {"$in": route_ids}})}

    surveyed = []
    for r in results:
        rid = r["_id"]
        road = roads.get(rid, {})
        surveyed.append({
            "route_id": rid,
            "road_name": road.get("road_name", f"Route {rid}"),
            "road_type": road.get("road_type"),
            "distance_km": road.get("estimated_distance_km"),
            "survey_count": r["survey_count"],
            "latest_survey_date": r["latest_survey_date"],
            "surveyors": r["surveyors"],
        })

    return json.dumps({
        "period": period,
        "total_surveyed_routes": len(surveyed),
        "routes": surveyed,
    })


@tool
def rank_routes_by_damage(limit: int = 10) -> str:
    """
    Rank all routes by number of damaged assets to find which route has the most damage.
    Use for "Which route has the most damage?", "Route with most defects", "Compare damage across routes".

    Args:
        limit: Max routes to return (default 10)

    Returns:
        JSON array of routes ranked by damage count, with good/damaged/total and damage percentage
    """
    db = get_db()

    pipeline = [
        {"$group": {
            "_id": "$route_id",
            "count": {"$sum": 1},
            "good": {"$sum": {"$cond": [{"$eq": ["$latest_condition", "good"]}, 1, 0]}},
            "damaged": {"$sum": {"$cond": [{"$ne": ["$latest_condition", "good"]}, 1, 0]}},
        }},
    ]
    results = list(db.master_assets.aggregate(pipeline))

    if not results:
        return json.dumps({"routes": [], "message": "No asset data found"})

    # Get road names
    route_ids = [r["_id"] for r in results if r["_id"] is not None]
    roads = {r["route_id"]: r for r in db.roads.find({"route_id": {"$in": route_ids}})}

    ranked = []
    for r in results:
        rid = r["_id"]
        if rid is None:
            continue
        road = roads.get(rid, {})
        ranked.append({
            "route_id": rid,
            "road_name": road.get("road_name", f"Route {rid}"),
            "damaged": r["damaged"],
            "good": r["good"],
            "total": r["count"],
            "damage_rate_pct": round(r["damaged"] / r["count"] * 100, 1) if r["count"] else 0,
        })

    ranked.sort(key=lambda x: x["damaged"], reverse=True)
    return json.dumps({"routes": ranked[:limit]})


@tool
def get_surveys_in_time_range(start_date: str = "", end_date: str = "", period: str = "") -> str:
    """
    Get surveys conducted within a specific time range or period.
    Use for "Which routes were surveyed this month?", "Surveys conducted today", "Surveys from Jan to March".

    Args:
        start_date: Optional start date as YYYY-MM-DD
        end_date: Optional end date as YYYY-MM-DD
        period: Alternative to dates — "today", "week", "month", "year"

    Returns:
        JSON with surveys grouped by route, including surveyor info and dates
    """
    db = get_db()
    query: dict = {}

    if period:
        sd, ed = _get_date_range(period)
        query["survey_date"] = {"$gte": sd, "$lte": ed}
    elif start_date or end_date:
        date_filter: dict = {}
        if start_date:
            date_filter["$gte"] = start_date
        if end_date:
            date_filter["$lte"] = end_date
        if date_filter:
            query["survey_date"] = date_filter

    surveys = list(db.surveys.find(query).sort("survey_date", -1))

    # Group by route
    route_ids = list(set(s.get("route_id") for s in surveys if s.get("route_id")))
    roads = {r["route_id"]: r for r in db.roads.find({"route_id": {"$in": route_ids}})}

    by_route: dict[int, list] = {}
    for s in surveys:
        rid = s.get("route_id")
        by_route.setdefault(rid, []).append({
            "date": s.get("survey_date"),
            "surveyor": s.get("surveyor_name"),
            "status": s.get("status"),
            "version": s.get("survey_version", 1),
        })

    route_list = []
    for rid, survey_list in by_route.items():
        road = roads.get(rid, {})
        route_list.append({
            "route_id": rid,
            "road_name": road.get("road_name", f"Route {rid}"),
            "survey_count": len(survey_list),
            "surveys": survey_list,
        })

    route_list.sort(key=lambda x: x["survey_count"], reverse=True)

    return json.dumps({
        "period": period or f"{start_date or '...'} to {end_date or '...'}",
        "total_surveys": len(surveys),
        "total_routes": len(route_list),
        "routes": route_list,
    })


@tool
def get_route_condition_report(route_id: int) -> str:
    """
    Comprehensive condition report for a route, including damage breakdown by category,
    most damaged asset types, and damage hotspot summary.
    Use for "Condition of route 258", "What should we improve on this route?",
    "Advice for improving route", "What's wrong with this route?".

    The agent should use this data to provide actionable improvement recommendations.

    Args:
        route_id: The route to analyze

    Returns:
        JSON with overall condition, damage by category, top damaged assets, and hotspot info
    """
    db = get_db()

    # Overall condition
    cond_pipeline = [
        {"$match": {"route_id": route_id}},
        {"$group": {
            "_id": None,
            "total": {"$sum": 1},
            "good": {"$sum": {"$cond": [{"$eq": ["$latest_condition", "good"]}, 1, 0]}},
            "damaged": {"$sum": {"$cond": [{"$ne": ["$latest_condition", "good"]}, 1, 0]}},
        }},
    ]
    cond_results = list(db.master_assets.aggregate(cond_pipeline))

    if not cond_results:
        return json.dumps({"route_id": route_id, "error": "No assets found for this route"})

    overall = cond_results[0]
    total = overall["total"]
    good = overall["good"]
    damaged = overall["damaged"]

    # Damage by category
    cat_pipeline = [
        {"$match": {"route_id": route_id}},
        {"$group": {
            "_id": "$category_id",
            "total": {"$sum": 1},
            "damaged": {"$sum": {"$cond": [{"$ne": ["$latest_condition", "good"]}, 1, 0]}},
        }},
        {"$sort": {"damaged": -1}},
    ]
    cat_damage = list(db.master_assets.aggregate(cat_pipeline))

    categories_damaged = []
    for c in cat_damage:
        categories_damaged.append({
            "category": _cat_name(c["_id"]),
            "damaged": c["damaged"],
            "total": c["total"],
            "damage_rate_pct": round(c["damaged"] / c["total"] * 100, 1) if c["total"] else 0,
        })

    # Top damaged asset types
    asset_pipeline = [
        {"$match": {"route_id": route_id, "latest_condition": {"$ne": "good"}}},
        {"$group": {
            "_id": "$asset_id",
            "damaged_count": {"$sum": 1},
        }},
        {"$sort": {"damaged_count": -1}},
        {"$limit": 10},
    ]
    top_damaged = list(db.master_assets.aggregate(asset_pipeline))

    top_damaged_assets = []
    for a in top_damaged:
        top_damaged_assets.append({
            "asset": _label_name(a["_id"]),
            "damaged_count": a["damaged_count"],
        })

    # Road info
    road = db.roads.find_one({"route_id": route_id})
    road_name = road.get("road_name", f"Route {route_id}") if road else f"Route {route_id}"

    return json.dumps({
        "route_id": route_id,
        "road_name": road_name,
        "overall": {
            "total_assets": total,
            "good": good,
            "good_pct": round(good / total * 100, 1),
            "damaged": damaged,
            "damaged_pct": round(damaged / total * 100, 1),
        },
        "damage_by_category": categories_damaged,
        "top_damaged_assets": top_damaged_assets,
        "recommendation_hint": "Use the damage_by_category and top_damaged_assets data to suggest specific improvement actions like replacing damaged assets, scheduling maintenance for worst categories, and prioritizing hotspot areas.",
    })


@tool
def get_survey_findings(route_id: Optional[int] = None, period: str = "all") -> str:
    """
    Aggregate summary of what was found during surveys — total assets detected
    grouped by category, with good/damaged counts.
    Use for "What did we find in surveys?", "Show survey findings", "Survey results summary".

    Args:
        route_id: Optional route to filter by
        period: "today", "week", "month", "year", or "all"

    Returns:
        JSON with asset aggregates from surveyed routes
    """
    db = get_db()

    # Get survey scope for metadata
    survey_query: dict = {}
    if route_id is not None:
        survey_query["route_id"] = route_id
    if period != "all":
        start_date, end_date = _get_date_range(period)
        survey_query["survey_date"] = {"$gte": start_date, "$lte": end_date}

    survey_count = db.surveys.count_documents(survey_query)
    surveyed_route_ids = list(db.surveys.distinct("route_id", survey_query))

    # Get asset aggregates from master_assets for those routes
    asset_query: dict = {}
    if surveyed_route_ids:
        asset_query["route_id"] = {"$in": surveyed_route_ids}
    elif route_id is not None:
        asset_query["route_id"] = route_id

    pipeline = [
        {"$match": asset_query},
        {"$group": {
            "_id": "$category_id",
            "count": {"$sum": 1},
            "good": {"$sum": {"$cond": [{"$eq": ["$latest_condition", "good"]}, 1, 0]}},
            "damaged": {"$sum": {"$cond": [{"$ne": ["$latest_condition", "good"]}, 1, 0]}},
        }},
    ]
    results = list(db.master_assets.aggregate(pipeline))

    if not results:
        return json.dumps({
            "period": period,
            "route_id": route_id,
            "surveys_matched": survey_count,
            "categories": [],
            "grand_total": 0,
        })

    categories = []
    grand_total = 0
    for r in sorted(results, key=lambda x: x["count"], reverse=True):
        grand_total += r["count"]
        categories.append({
            "category": _cat_name(r["_id"]),
            "total": r["count"],
            "good": r["good"],
            "damaged": r["damaged"],
            "damage_rate_pct": round(r["damaged"] / r["count"] * 100, 1) if r["count"] else 0,
        })

    return json.dumps({
        "period": period,
        "route_id": route_id,
        "surveys_matched": survey_count,
        "routes_covered": len(surveyed_route_ids),
        "categories": categories,
        "grand_total": grand_total,
    })



# =============================================================================
# CATALOG / INVENTORY TOOLS
# (query system_asset_categories + system_asset_labels, NOT detected assets)
# =============================================================================


@tool
def get_catalog_category_info(category_name: str) -> str:
    """
    Get the master catalog info for a category: how many asset label types exist
    and the full list of label display names. Queries system_asset_labels — this
    is NOT about detected assets, it is the full inventory catalog.

    Use for:
    - "How many asset labels exist under Signage?"
    - "List all labels under Roadway Lighting"
    - "List all ITS asset types"
    - "Name three asset types under Pavement"
    - "Which assets are in category X?"
    - Semantic questions like "Identify assets installed at regular intervals",
      "Identify assets related to pedestrian movement", or
      "Identify assets supporting traffic flow" — call this tool for EACH
      relevant category and pick matching labels from the results.

    Args:
        category_name: Category display name, e.g. "Directional Signage",
                       "Roadway Lighting", "ITS", "Pavement",
                       "Other Infrastructure Assets", "Structures", "Beautification"

    Returns:
        JSON with label_count and full labels list from the master catalog
    """
    cid = _resolve_category_id(category_name)
    if not cid:
        return json.dumps({"error": f"Category '{category_name}' not found in catalog"})

    rm = get_resolved_map()
    labels = [
        info["display_name"]
        for aid, info in rm["labels"].items()
        if info.get("category_id") == cid
    ]
    labels_sorted = sorted(labels)

    return json.dumps({
        "category": _cat_name(cid),
        "label_count": len(labels_sorted),
        "labels": labels_sorted,
    })


@tool
def find_asset_category(asset_name: str) -> str:
    """
    Identify which asset category a given asset type belongs to.
    Looks up the master catalog (system_asset_labels).

    Use for:
    - "What category is CCTV?"
    - "Identify asset category for Guardrail"
    - "Which category does Kerb belong to?"
    - "What category is Tunnel in?"

    Args:
        asset_name: Asset display name to look up, e.g. "CCTV", "Guardrail", "Kerb", "Tunnel"

    Returns:
        JSON with the asset name and its category
    """
    rm = get_resolved_map()
    name_lower = asset_name.strip().lower()

    matches = []
    for aid, info in rm["labels"].items():
        dn = info["display_name"].lower()
        defn = info["default_name"].lower()
        if name_lower in dn or name_lower in defn or dn.startswith(name_lower):
            cid = info.get("category_id", "")
            matches.append({
                "asset": info["display_name"],
                "category": _cat_name(cid),
                "category_id": cid,
            })

    if not matches:
        return json.dumps({"error": f"Asset '{asset_name}' not found in catalog"})

    # Deduplicate by category for a clean summary
    seen_cats = {}
    for m in matches:
        seen_cats.setdefault(m["category"], []).append(m["asset"])

    return json.dumps({
        "query": asset_name,
        "results": [
            {"category": cat, "matching_assets": assets}
            for cat, assets in seen_cats.items()
        ],
    })


@tool
def get_inventory_counts_by_category(category_name: str, route_id: Optional[int] = None) -> str:
    """
    Count detected assets by label and condition for a category.

    Use for:
    - "Count Signage assets by label and condition"
    - "Count Roadway Lighting assets by label and condition"
    - "Count ITS assets by label and condition"
    - "Count Pavement assets by label and condition"
    - Any per-category breakdown of detected counts

    Args:
        category_name: Category display name (e.g. "Directional Signage", "ITS")
        route_id: Optional route ID to restrict to a single route

    Returns:
        JSON with per-label good/damaged counts
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
            "_id": "$asset_id",
            "count": {"$sum": 1},
            "good": {"$sum": {"$cond": [{"$eq": ["$latest_condition", "good"]}, 1, 0]}},
            "damaged": {"$sum": {"$cond": [{"$ne": ["$latest_condition", "good"]}, 1, 0]}},
        }},
    ]
    results = list(db.master_assets.aggregate(pipeline))

    if not results:
        return json.dumps({
            "category": _cat_name(cid),
            "route_id": route_id,
            "note": "No detected assets found for this category",
            "assets": [],
            "total": 0,
        })

    assets = sorted(
        [
            {
                "label": _label_name(r["_id"]),
                "good": r["good"],
                "damaged": r["damaged"],
                "total": r["count"],
            }
            for r in results
        ],
        key=lambda x: x["total"],
        reverse=True,
    )

    return json.dumps({
        "category": _cat_name(cid),
        "route_id": route_id,
        "assets": assets,
        "total": sum(r["count"] for r in results),
    })


# =============================================================================
# ANALYTICS TOOLS
# =============================================================================


@tool
def get_category_route_risk(category_name: str, top_n: int = 5) -> str:
    """
    Rank routes by damaged asset count within a specific category.
    Use for risk corridor / risk location / risk zone questions per category.

    Use for:
    - "Identify top 3 risk corridors based on Signage condition"
    - "Identify top risk locations due to poor lighting conditions"
    - "Identify top 5 pavement risk zones"
    - "Identify highest risk locations based on missing protective assets"
    - "Identify top 5 safety risks in ITS network"
    - "Identify highest risk structure type by route"
    - "Identify top 5 locations with degraded beautification"
    - Any question asking for worst routes/locations for a specific category

    Args:
        category_name: Category display name (e.g. "Directional Signage", "Roadway Lighting",
                       "ITS", "Pavement", "Other Infrastructure Assets", "Structures", "Beautification")
        top_n: Number of top risk routes to return (default 5)

    Returns:
        JSON with routes ranked by damaged count for the given category.
        Each entry includes damaged count, total count, damage rate %, and road name.
    """
    cid = _resolve_category_id(category_name)
    if not cid:
        return json.dumps({"error": f"Category '{category_name}' not found"})

    db = get_db()
    pipeline = [
        {"$match": {"category_id": cid}},
        {"$group": {
            "_id": "$route_id",
            "count": {"$sum": 1},
            "good": {"$sum": {"$cond": [{"$eq": ["$latest_condition", "good"]}, 1, 0]}},
            "damaged": {"$sum": {"$cond": [{"$ne": ["$latest_condition", "good"]}, 1, 0]}},
        }},
    ]
    results = list(db.master_assets.aggregate(pipeline))

    if not results:
        return json.dumps({
            "category": _cat_name(cid),
            "note": "No detected assets found",
            "routes": [],
        })

    route_ids = [r["_id"] for r in results if r["_id"] is not None]
    roads = {r["route_id"]: r for r in db.roads.find({"route_id": {"$in": route_ids}})}

    ranked = []
    for r in results:
        rid = r["_id"]
        if rid is None:
            continue
        road = roads.get(rid, {})
        ranked.append({
            "route_id": rid,
            "road_name": road.get("road_name", f"Route {rid}"),
            "damaged": r["damaged"],
            "good": r["good"],
            "total": r["count"],
            "damage_rate_pct": round(r["damaged"] / r["count"] * 100, 1) if r["count"] else 0,
        })

    ranked.sort(key=lambda x: x["damaged"], reverse=True)

    return json.dumps({
        "category": _cat_name(cid),
        "top_risk_routes": ranked[:top_n],
        "total_routes_with_data": len(ranked),
    })


@tool
def get_asset_type_route_risk(asset_name: str, top_n: int = 5) -> str:
    """
    Rank corridors by damaged count for a SPECIFIC asset type (not just a category).
    Use when the user asks about a specific asset label rather than an entire category.

    Use for:
    - "Identify top 5 corridors with damaged Guardrails"
    - "Identify corridors with highest faded road markings"
    - "Identify corridors with most damaged Street Light Poles"
    - "Identify top risk corridors for Road Marking Line damage"
    - Any corridor risk question mentioning a specific asset type by name

    Prefer get_category_route_risk when the question mentions an entire category
    (e.g. "Lighting", "Pavement", "ITS").

    Args:
        asset_name: Specific asset label (e.g. "Guardrail", "Road Marking Line",
                    "Street Light Pole", "CCTV Camera")
        top_n: Number of top risk corridors to return (default 5)

    Returns:
        JSON with corridors ranked by damaged count for the specific asset type.
        Each entry includes road name, damaged count, total count, and damage rate %.
    """
    db = get_db()
    aids = _resolve_asset_ids(asset_name)
    if not aids:
        return json.dumps({"error": f"Asset type '{asset_name}' not found in catalog"})

    pipeline = [
        {"$match": {"asset_id": {"$in": aids}}},
        {"$group": {
            "_id": "$route_id",
            "count": {"$sum": 1},
            "good": {"$sum": {"$cond": [{"$eq": ["$latest_condition", "good"]}, 1, 0]}},
            "damaged": {"$sum": {"$cond": [{"$ne": ["$latest_condition", "good"]}, 1, 0]}},
        }},
    ]
    results = list(db.master_assets.aggregate(pipeline))

    if not results:
        return json.dumps({
            "asset_type": asset_name,
            "note": "No detected assets found",
            "routes": [],
        })

    # Enrich with road names
    route_ids = [r["_id"] for r in results if r["_id"] is not None]
    roads = {r["route_id"]: r for r in db.roads.find({"route_id": {"$in": route_ids}})}

    ranked = []
    for r in results:
        rid = r["_id"]
        if rid is None:
            continue
        road = roads.get(rid, {})
        ranked.append({
            "route_id": rid,
            "road_name": road.get("road_name", f"Route {rid}"),
            "damaged": r["damaged"],
            "good": r["good"],
            "total": r["count"],
            "damage_rate_pct": round(r["damaged"] / r["count"] * 100, 1) if r["count"] else 0,
        })

    ranked.sort(key=lambda x: x["damaged"], reverse=True)

    return json.dumps({
        "asset_type": asset_name,
        "top_risk_corridors": ranked[:top_n],
        "total_corridors_with_data": len(ranked),
    })



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
    get_asset_type_conditions_for_chart,
    get_asset_locations,
    get_damage_hotspots,
    get_most_damaged_types,
    list_surveyed_routes,
    rank_routes_by_damage,
    get_surveys_in_time_range,
    get_route_condition_report,
    get_survey_findings,
    # Catalog / Inventory tools
    get_catalog_category_info,
    find_asset_category,
    get_inventory_counts_by_category,
    # Analytics & risk tools
    get_category_route_risk,
    get_asset_type_route_risk,
]
