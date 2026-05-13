"""
LangGraph Chatbot Tools
All tools return raw JSON data — the agent LLM forms natural responses.
"""

import json
import os
from datetime import datetime, timedelta
from typing import Optional
from langchain.tools import tool
from rapidfuzz import process, fuzz

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
        gid = (info.get("group_id") or "").lower()
        if gid == name_lower:
            return info["group_id"]
    return None

FUZZY_THRESHOLD = 90

def _resolve_asset_ids(asset_name: str) -> list[str]:
    """
    Resolve an asset name (group_id) to ALL matching asset_ids.
    E.g. "Guardrail" → [type_asset_102, type_asset_103, type_asset_104]
    Matches on group_id first, then default_name. Falls back to fuzzy matching
    so near-matches like "Traffic Light" → "Traffic Lights" still resolve.

    Ambiguity guard: if the input exactly matches a known CATEGORY display/default
    name (e.g. "Directional Signage", "Structures"), treat it as a category and
    refuse to resolve it as an asset type — avoids fuzzy-collisions between
    similarly-named categories and asset types (e.g. category "Directional
    Signage" vs asset "Directional Structures").
    """
    rm = get_resolved_map()
    name_lower = asset_name.strip().lower()

    # Category-name collision guard
    for info in rm["categories"].values():
        if info["display_name"].lower() == name_lower or info["default_name"].lower() == name_lower:
            return []

    exact = []
    prefix_matches = []
    for aid, info in rm["labels"].items():
        gid = (info.get("group_id") or "").lower()
        defn = info["default_name"].lower()
        if gid == name_lower or defn == name_lower:
            exact.append(aid)
        elif (gid.startswith(name_lower + " ")
              or defn.startswith(name_lower.replace(" ", "_") + "_")):
            prefix_matches.append(aid)

    if exact or prefix_matches:
        return exact + prefix_matches

    # Fuzzy fallback: find the best-matching group_id, then return all asset_ids in that group
    group_id_to_aids: dict[str, list[str]] = {}
    for aid, info in rm["labels"].items():
        gid = (info.get("group_id") or "").lower()
        if gid:
            group_id_to_aids.setdefault(gid, []).append(aid)

    # Require high score AND a clear gap over runner-up to avoid sibling-name
    # collisions like "Directional Signage" vs "Directional Structures".
    matches = process.extract(name_lower, group_id_to_aids.keys(), scorer=fuzz.WRatio, limit=3)
    if matches and matches[0][1] >= FUZZY_THRESHOLD:
        top_score = matches[0][1]
        runner_up = matches[1][1] if len(matches) > 1 else 0
        if top_score - runner_up >= 5 or top_score >= 97:
            return group_id_to_aids[matches[0][0]]

    return []



def _get_category_id_for_group(group_id: str) -> str:
    """Resolve a group_id to its category_id."""
    rm = get_resolved_map()
    gid_lower = (group_id or "").lower()
    for info in rm["labels"].values():
        if (info.get("group_id") or "").lower() == gid_lower:
            return info.get("category_id", "")
    return ""


def _cat_name(category_id: str) -> str:
    rm = get_resolved_map()
    info = rm["categories"].get(category_id)
    return info["display_name"] if info else category_id


def _label_name(asset_id: str) -> str:
    """Return the display name for an asset_id. Uses group_id as the authoritative name."""
    rm = get_resolved_map()
    info = rm["labels"].get(asset_id)
    if info:
        return info.get("group_id") or info.get("display_name") or asset_id
    # Fallback: asset_id might actually be a group_id value (e.g. from aggregations
    # that group by $group_id) — return it directly.
    for label in rm["labels"].values():
        if (label.get("group_id") or "").lower() == asset_id.lower():
            return label["group_id"]
    return asset_id


def _road_name(route_id) -> Optional[str]:
    """Look up the road_name for a route_id from db.roads. Returns None if unknown."""
    if route_id is None:
        return None
    try:
        db = get_db()
        r = db.roads.find_one({"route_id": route_id}, {"road_name": 1, "_id": 0})
        return r.get("road_name") if r else None
    except Exception:
        return None


ROAD_NAME_FUZZY_THRESHOLD = 80
ROAD_NAME_TIE_WINDOW = 5


def _resolve_route_ids_from_name(name: str) -> list[dict]:
    """
    Fuzzy-match a road name against db.roads.road_name.

    Returns a list of dicts: [{"route_id": int, "road_name": str, "score": int}, ...]
    Behavior:
    - If no match scores >= ROAD_NAME_FUZZY_THRESHOLD → returns [].
    - Otherwise returns all matches within ROAD_NAME_TIE_WINDOW of the top score
      (so if "Al Wakrah Road" and "Al Wakrah Bypass Road" both score high, both are
      returned; if only one road clearly matches, only that one is returned).
    """
    if not name or not name.strip():
        return []

    db = get_db()
    roads = list(db.roads.find({}, {"route_id": 1, "road_name": 1, "_id": 0}))
    if not roads:
        return []

    name_lower = name.strip().lower()
    scored = []
    for r in roads:
        rn = (r.get("road_name") or "").strip()
        if not rn:
            continue
        score = fuzz.WRatio(name_lower, rn.lower())
        scored.append({"route_id": r.get("route_id"), "road_name": rn, "score": int(score)})

    if not scored:
        return []

    scored.sort(key=lambda x: x["score"], reverse=True)
    top = scored[0]["score"]
    if top < ROAD_NAME_FUZZY_THRESHOLD:
        return []

    cutoff = top - ROAD_NAME_TIE_WINDOW
    return [s for s in scored if s["score"] >= cutoff]


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


@tool(description="""List uploaded videos, optionally filtered by route_id.
Use when user asks about videos on a route.

Args:
    route_id: Optional route number to filter by

Returns:
    JSON array of videos""")
def list_videos(route_id: Optional[int] = None) -> str:
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


@tool(description="""List surveys, optionally filtered by status and route.
Use when user asks for surveys or survey list.

Args:
    status: Optional — "completed", "processing", "uploaded"
    route_id: Optional route number

Returns:
    JSON array of surveys""")
def list_surveys(status: str = "", route_id: Optional[int] = None) -> str:
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


@tool(description="""Get survey statistics: count by time period and top surveyors.
Use for "How many surveys this month?", "Who did the most surveys?", etc.

Args:
    period: "today", "week", "month", "year", or "all"
    route_id: Optional route to filter by

Returns:
    JSON with survey count, period, and surveyor rankings""")
def get_survey_stats(period: str = "all", route_id: Optional[int] = None) -> str:
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


@tool(description="""Get details about a specific route.
Use when user asks "Describe route 258", "Tell me about this route", etc.

Args:
    route_id: The route number

Returns:
    JSON with route metadata (name, distance, endpoints, type, survey count, asset count)""")
def describe_route(route_id: int) -> str:
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


@tool(description="""Overall good vs damaged summary for all assets on a route.
Use for general asset health / condition overview.

Args:
    route_id: Optional route ID

Returns:
    JSON with total, good, damaged counts and percentages""")
def get_asset_condition_summary(route_id: Optional[int] = None) -> str:
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
        "route_id": route_id, "road_name": _road_name(route_id),
        "total": total,
        "good": good,
        "good_pct": round(good / total * 100, 1) if total else 0,
        "damaged": damaged,
        "damaged_pct": round(damaged / total * 100, 1) if total else 0,
    })


@tool(description="""List all asset categories, optionally with the labels under each.
Use for "What are the asset categories?" or "What labels are in category X?".

Args:
    with_labels: Include the list of labels per category

Returns:
    JSON array of categories""")
def list_asset_categories(with_labels: bool = False) -> str:
    rm = get_resolved_map()

    cat_labels: dict[str, set[str]] = {}
    for info in rm["labels"].values():
        cid = info.get("category_id", "unknown")
        name = info.get("group_id") or info["display_name"]
        cat_labels.setdefault(cid, set()).add(name)

    categories = []
    for cid, cat_info in rm["categories"].items():
        labels = sorted(cat_labels.get(cid, set()))
        entry: dict = {
            "category_id": cid,
            "name": cat_info["display_name"],
            "label_count": len(labels),
        }
        if with_labels:
            entry["labels"] = labels
        categories.append(entry)

    return json.dumps({"total_categories": len(categories), "categories": categories})


@tool(description="""Detected assets within a category with good/damaged counts.
Use for "List assets in Roadway Lighting", "Show pavement assets".

Args:
    category_name: Category display name (e.g. "Roadway Lighting")
    route_id: Optional route ID to filter by

Returns:
    JSON array of detected asset types with condition counts""")
def list_assets_in_category(category_name: str, route_id: Optional[int] = None) -> str:
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
    results = list(db.master_assets.aggregate(pipeline))

    if not results:
        return json.dumps({"category": category_name, "route_id": route_id, "road_name": _road_name(route_id), "assets": [], "total": 0})

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
        "route_id": route_id, "road_name": _road_name(route_id),
        "assets": assets,
        "total": sum(r["count"] for r in results),
    })


@tool(description="""Good vs damaged breakdown for a specific category.
Use for "Condition of traffic signs", "How are pavement assets?".

Args:
    category_name: Category display name (e.g. "Directional Signage")
    route_id: Optional route ID

Returns:
    JSON with good/damaged counts and percentages for the category""")
def get_category_condition_breakdown(category_name: str, route_id: Optional[int] = None) -> str:
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
        return json.dumps({"category": _cat_name(cid), "route_id": route_id, "road_name": _road_name(route_id), "error": "No assets found"})

    total = sum(r["count"] for r in results)
    good = sum(r["count"] for r in results if _classify_condition(r["_id"]) == "good")
    damaged = total - good

    return json.dumps({
        "category": _cat_name(cid),
        "route_id": route_id, "road_name": _road_name(route_id),
        "total": total,
        "good": good,
        "good_pct": round(good / total * 100, 1) if total else 0,
        "damaged": damaged,
        "damaged_pct": round(damaged / total * 100, 1) if total else 0,
    })


@tool(description="""Condition breakdown for a specific asset type (not category).
Use for "Condition of street lights", "How many guardrails are damaged?".

Args:
    asset_name: Asset type display name (e.g. "Street Light Pole", "Guardrail", "Traffic Sign")
    route_id: Optional route ID

Returns:
    JSON with good/damaged counts for that specific asset type""")
def get_asset_type_condition(asset_name: str, route_id: Optional[int] = None) -> str:
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
        return json.dumps({"asset": asset_name, "route_id": route_id, "road_name": _road_name(route_id), "total": 0, "error": "No detections found"})

    total = sum(r["count"] for r in results)
    good = sum(r["count"] for r in results if _classify_condition(r["_id"]) == "good")
    damaged = total - good

    return json.dumps({
        "asset": asset_name,
        "category": _cat_name(label_info.get("category_id", "")),
        "route_id": route_id, "road_name": _road_name(route_id),
        "total": total,
        "good": good,
        "good_pct": round(good / total * 100, 1) if total else 0,
        "damaged": damaged,
        "damaged_pct": round(damaged / total * 100, 1) if total else 0,
    })


@tool(description="""All detected asset types with counts and condition, grouped by category.
Use for "What assets were detected?", "Show all assets on this route".

Args:
    route_id: Optional route ID

Returns:
    JSON with assets grouped by category""")
def list_detected_assets(route_id: Optional[int] = None) -> str:
    db = get_db()
    query: dict = {}
    if route_id is not None:
        query["route_id"] = route_id

    pipeline = [
        {"$match": query},
        {"$group": {
            "_id": {"group_id": {"$ifNull": ["$group_id", "$asset_id"]}, "category_id": "$category_id"},
            "count": {"$sum": 1},
            "good": {"$sum": {"$cond": [{"$eq": ["$latest_condition", "good"]}, 1, 0]}},
            "damaged": {"$sum": {"$cond": [{"$ne": ["$latest_condition", "good"]}, 1, 0]}},
        }},
    ]
    results = list(db.master_assets.aggregate(pipeline))

    if not results:
        return json.dumps({"route_id": route_id, "road_name": _road_name(route_id), "categories": [], "grand_total": 0})

    by_category: dict[str, list] = {}
    for r in results:
        cid = r["_id"]["category_id"]
        by_category.setdefault(cid, []).append({
            "name": _label_name(r["_id"]["group_id"]),
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

    return json.dumps({"route_id": route_id, "road_name": _road_name(route_id), "categories": categories, "grand_total": grand_total})


@tool(description="""Get locations (lat/lng) where assets were detected and listing assets.
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
    JSON array of assets with lat/lng and condition

Instruction: if response contains list of data, format result in tabular form and include the message if provided.""")
def get_asset_locations(asset_name: str = "", category_name: str = "", route_id: Optional[int] = None, condition: str = "", limit: int = 20) -> str:
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
            })

    result = {
        "filter": {"asset_name": asset_name or None, "category_name": category_name or None,
                   "route_id": route_id, "road_name": _road_name(route_id), "condition": condition or None},
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


@tool(description="""Find locations with the highest concentration of damaged assets.
Use for "Where are the damage hotspots?", "Where are most defects?", "Which areas have most defects".

Args:
    route_id: Route to analyze
    top_n: Number of hotspot clusters to return (default 5)

Returns:
    JSON array of hotspot areas with damage counts and center coordinates""")
def get_damage_hotspots(route_id: int, top_n: int = 5) -> str:
    db = get_db()
    query: dict = {
        "route_id": route_id,
        "latest_condition": {"$ne": "good"},
        "canonical_location": {"$exists": True},
    }

    damaged_assets = list(db.master_assets.find(query))

    if not damaged_assets:
        return json.dumps({"route_id": route_id, "road_name": _road_name(route_id), "hotspots": [], "total_damaged": 0})

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
        "route_id": route_id, "road_name": _road_name(route_id),
        "total_damaged": len(damaged_assets),
        "hotspots": hotspots,
    })


@tool(description="""Get condition (good/damaged/total) for every distinct asset type on a route,
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
    total_types in the DB, and a truncation message if results were capped.""")
def get_asset_type_conditions_for_chart(route_id: Optional[int] = None, top_n: int = 10, sort_by: str = "total") -> str:
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
        return json.dumps({"route_id": route_id, "road_name": _road_name(route_id), "assets": [], "total_types": 0})

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
        "road_name": _road_name(route_id),
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


@tool(description="""Asset types ranked by damage count/rate.
Use for "Which assets have the most defects?", "Most damaged asset types".

Args:
    route_id: Optional route ID
    limit: Max asset types to return (default 10)

Returns:
    JSON array of asset types sorted by damage rate""")
def get_most_damaged_types(route_id: Optional[int] = None, limit: int = 10) -> str:
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
        return json.dumps({"route_id": route_id, "road_name": _road_name(route_id), "assets": []})

    # Sort by damage count descending, only include those with damage > 0
    ranked = []
    for r in results:
        if r["damaged"] > 0:
            ranked.append({
                "asset": _label_name(r["_id"]),
                "category": _cat_name(_get_category_id_for_group(r["_id"])),
                "damaged": r["damaged"],
                "good": r["good"],
                "total": r["count"],
                "damage_rate_pct": round(r["damaged"] / r["count"] * 100, 1) if r["count"] else 0,
            })

    ranked.sort(key=lambda x: x["damaged"], reverse=True)
    return json.dumps({"route_id": route_id, "road_name": _road_name(route_id), "assets": ranked[:limit]})


@tool(description="""List all routes that have been surveyed, with survey count and latest survey date.
Use for "How many routes have we surveyed?", "Which routes have surveys?", "List surveyed routes".

Args:
    period: "today", "week", "month", "year", or "all"

Returns:
    JSON with list of surveyed routes and their survey counts""")
def list_surveyed_routes(period: str = "all") -> str:
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


@tool(description="""Rank all routes by number of damaged assets to find which route has the most damage.
Use for "Which route has the most damage?", "Route with most defects", "Compare damage across routes".

Args:
    limit: Max routes to return (default 10)

Returns:
    JSON array of routes ranked by damage count, with good/damaged/total and damage percentage""")
def rank_routes_by_damage(limit: int = 10) -> str:
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


@tool(description="""Get surveys conducted within a specific time range or period.
Use for "Which routes were surveyed this month?", "Surveys conducted today", "Surveys from Jan to March".

Args:
    start_date: Optional start date as YYYY-MM-DD
    end_date: Optional end date as YYYY-MM-DD
    period: Alternative to dates — "today", "week", "month", "year"

Returns:
    JSON with surveys grouped by route, including surveyor info and dates""")
def get_surveys_in_time_range(start_date: str = "", end_date: str = "", period: str = "") -> str:
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


@tool(description="""Comprehensive condition report for a route, including damage breakdown by category,
most damaged asset types, and damage hotspot summary.
Use for "Condition of route 258", "What should we improve on this route?",
"Advice for improving route", "What's wrong with this route?".

The agent should use this data to provide actionable improvement recommendations.

Args:
    route_id: The route to analyze

Returns:
    JSON with overall condition, damage by category, top damaged assets, and hotspot info""")
def get_route_condition_report(route_id: int) -> str:
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
        return json.dumps({"route_id": route_id, "road_name": _road_name(route_id), "error": "No assets found for this route"})

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
            "_id": {"$ifNull": ["$group_id", "$asset_id"]},
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


@tool(description="""Aggregate summary of what was found during surveys — total assets detected
grouped by category, with good/damaged counts.
Use for "What did we find in surveys?", "Show survey findings", "Survey results summary".

Args:
    route_id: Optional route to filter by
    period: "today", "week", "month", "year", or "all"

Returns:
    JSON with asset aggregates from surveyed routes""")
def get_survey_findings(route_id: Optional[int] = None, period: str = "all") -> str:
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
            "route_id": route_id, "road_name": _road_name(route_id),
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
        "route_id": route_id, "road_name": _road_name(route_id),
        "surveys_matched": survey_count,
        "routes_covered": len(surveyed_route_ids),
        "categories": categories,
        "grand_total": grand_total,
    })



# =============================================================================
# CATALOG / INVENTORY TOOLS
# (query system_asset_categories + system_asset_labels, NOT detected assets)
# =============================================================================


@tool(description="""Get the master catalog info for a category: how many asset label types exist
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
    JSON with label_count and full labels list from the master catalog""")
def get_catalog_category_info(category_name: str) -> str:
    cid = _resolve_category_id(category_name)
    if not cid:
        return json.dumps({"error": f"Category '{category_name}' not found in catalog"})

    rm = get_resolved_map()
    labels = set(
        info.get("group_id") or info["display_name"]
        for aid, info in rm["labels"].items()
        if info.get("category_id") == cid
    )
    labels_sorted = sorted(labels)

    return json.dumps({
        "category": _cat_name(cid),
        "label_count": len(labels_sorted),
        "labels": labels_sorted,
    })


@tool(description="""Identify which asset category a given asset type belongs to.
Looks up the master catalog (system_asset_labels).

Use for:
- "What category is CCTV?"
- "Identify asset category for Guardrail"
- "Which category does Kerb belong to?"
- "What category is Tunnel in?"

Args:
    asset_name: Asset display name to look up, e.g. "CCTV", "Guardrail", "Kerb", "Tunnel"

Returns:
    JSON with the asset name and its category""")
def find_asset_category(asset_name: str) -> str:
    rm = get_resolved_map()
    name_lower = asset_name.strip().lower()

    matches = []
    for info in rm["labels"].values():
        dn = info["display_name"].lower()
        defn = info["default_name"].lower()
        gid = (info.get("group_id") or "").lower()
        if name_lower in dn or name_lower in defn or name_lower in gid or dn.startswith(name_lower):
            cid = info.get("category_id", "")
            asset_display = info.get("group_id") or info["display_name"]
            matches.append({
                "asset": asset_display,
                "category": _cat_name(cid),
                "category_id": cid,
            })

    if not matches:
        return json.dumps({"error": f"Asset '{asset_name}' not found in catalog"})

    # Deduplicate by category for a clean summary
    seen_cats: dict[str, set] = {}
    for m in matches:
        seen_cats.setdefault(m["category"], set()).add(m["asset"])

    return json.dumps({
        "query": asset_name,
        "results": [
            {"category": cat, "matching_assets": sorted(assets)}
            for cat, assets in seen_cats.items()
        ],
    })


@tool(description="""Count detected assets by label and condition for a category.

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
    JSON with per-label good/damaged counts""")
def get_inventory_counts_by_category(category_name: str, route_id: Optional[int] = None) -> str:
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
            "_id": {"$ifNull": ["$group_id", "$asset_id"]},
            "count": {"$sum": 1},
            "good": {"$sum": {"$cond": [{"$eq": ["$latest_condition", "good"]}, 1, 0]}},
            "damaged": {"$sum": {"$cond": [{"$ne": ["$latest_condition", "good"]}, 1, 0]}},
        }},
    ]
    results = list(db.master_assets.aggregate(pipeline))

    if not results:
        return json.dumps({
            "category": _cat_name(cid),
            "route_id": route_id, "road_name": _road_name(route_id),
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
        "route_id": route_id, "road_name": _road_name(route_id),
        "assets": assets,
        "total": sum(r["count"] for r in results),
    })


# =============================================================================
# ANALYTICS TOOLS
# =============================================================================


@tool(description="""Rank routes by damaged asset count within a specific category.
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
    Each entry includes damaged count, total count, damage rate %, and road name.""")
def get_category_route_risk(category_name: str, top_n: int = 5) -> str:
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


@tool(description="""Rank corridors by damaged count for a SPECIFIC asset type (not just a category).
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
    Each entry includes road name, damaged count, total count, and damage rate %.""")
def get_asset_type_route_risk(asset_name: str, top_n: int = 5) -> str:
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
# GAP #1: SURVEY COMPARISON (TEMPORAL CHANGE)
# =============================================================================

@tool(description="""Compare asset condition between surveys on the same route.
Shows what changed: new assets, condition changes, overall trend.
Use for "How has route X changed?", "Compare surveys on route X",
"What's different since last survey?", "Show changes over time on this route".

Args:
    route_id: The route to compare surveys on

Returns:
    JSON with survey-by-survey comparison, condition changes, and new detections""")
def compare_surveys_on_route(route_id: int) -> str:
    db = get_db()

    surveys = list(db.surveys.find({"route_id": route_id}).sort("survey_date", 1))
    if not surveys:
        return json.dumps({"error": f"No surveys found for route {route_id}"})
    if len(surveys) < 2:
        # Single survey — show summary instead
        s = surveys[0]
        sid = s["_id"]
        total = db.assets.count_documents({"survey_id": sid})
        good = db.assets.count_documents({"survey_id": sid, "condition": "good"})
        damaged = total - good
        return json.dumps({
            "route_id": route_id, "road_name": _road_name(route_id),
            "note": "Only one survey exists for this route — comparison not possible yet.",
            "single_survey": {
                "survey_id": s.get("survey_display_id", str(sid)),
                "date": s.get("survey_date"),
                "total_assets": total,
                "good": good,
                "damaged": damaged,
            }
        })

    # Compare the two most recent surveys
    older = surveys[-2]
    newer = surveys[-1]

    def _survey_stats(survey):
        sid = survey["_id"]
        obs = list(db.assets.find({"survey_id": sid}, {"master_asset_id": 1, "condition": 1, "group_id": 1, "asset_id": 1}))
        total = len(obs)
        good = sum(1 for o in obs if o.get("condition") == "good")
        damaged = total - good
        by_master = {}
        for o in obs:
            mid = o.get("master_asset_id")
            if mid:
                by_master[str(mid)] = o.get("condition", "unknown")
        return {"total": total, "good": good, "damaged": damaged, "by_master": by_master}

    old_stats = _survey_stats(older)
    new_stats = _survey_stats(newer)

    # Find condition changes
    improved = 0
    worsened = 0
    unchanged = 0
    for mid, new_cond in new_stats["by_master"].items():
        old_cond = old_stats["by_master"].get(mid)
        if old_cond is None:
            continue  # new detection
        old_is_good = old_cond == "good"
        new_is_good = new_cond == "good"
        if old_is_good and not new_is_good:
            worsened += 1
        elif not old_is_good and new_is_good:
            improved += 1
        else:
            unchanged += 1

    new_detections = len([mid for mid in new_stats["by_master"] if mid not in old_stats["by_master"]])
    missing = len([mid for mid in old_stats["by_master"] if mid not in new_stats["by_master"]])

    road = db.roads.find_one({"route_id": route_id})
    road_name = road.get("road_name", f"Route {route_id}") if road else f"Route {route_id}"

    return json.dumps({
        "route_id": route_id,
        "road_name": road_name,
        "older_survey": {
            "survey_id": older.get("survey_display_id", str(older["_id"])),
            "date": older.get("survey_date"),
            "total_assets": old_stats["total"],
            "good": old_stats["good"],
            "damaged": old_stats["damaged"],
        },
        "newer_survey": {
            "survey_id": newer.get("survey_display_id", str(newer["_id"])),
            "date": newer.get("survey_date"),
            "total_assets": new_stats["total"],
            "good": new_stats["good"],
            "damaged": new_stats["damaged"],
        },
        "changes": {
            "improved": improved,
            "worsened": worsened,
            "unchanged": unchanged,
            "new_detections": new_detections,
            "no_longer_detected": missing,
        },
    })


@tool(description="""Compare two or more surveys side-by-side using their stored totals
(total_assets / good / damaged) plus the top-k most damaged and top-k
most common good asset types for each survey.

Call this whenever the user asks to compare surveys — by survey IDs
("compare SURV-000005 and SURV-000012"), by route ("compare all surveys
on route 216"), or by timeframe phrasing like "how did route X change
between surveys".

Args:
    survey_display_ids: Optional list of survey_display_id strings (e.g.
        ["SURV-000005", "SURV-000012"]). If given, ONLY these surveys are
        compared, ignoring route_id.
    route_id: Optional route to pull all surveys from (sorted by date).
        Used only if survey_display_ids is not provided.
    top_k: Number of top damaged and top good asset types to return per
        survey. Default 3. Hard-capped at 10.

Returns:
    JSON:
    {
      "surveys": [
        {
          "survey_display_id": str,
          "survey_date": str,
          "route_id": int,
          "road_name": str,
          "totals": {"total_assets": int, "good": int, "damaged": int, "damage_rate_pct": float},
          "top_damaged_types": [{"asset_type": str, "damaged": int, "total": int}, ...],
          "top_good_types":    [{"asset_type": str, "good":    int, "total": int}, ...]
        },
        ...
      ],
      "deltas": {  # present when exactly 2 surveys compared (older → newer)
        "total_assets": int, "good": int, "damaged": int, "damage_rate_pct": float
      }
    }""")
def compare_surveys(survey_display_ids: Optional[list[str]] = None, route_id: Optional[int] = None, top_k: int = 3) -> str:
    db = get_db()
    top_k = max(1, min(int(top_k), 10))

    surveys: list = []
    if survey_display_ids:
        norm_ids = [s.strip().upper() for s in survey_display_ids if s and s.strip()]
        surveys = list(db.surveys.find({"survey_display_id": {"$in": norm_ids}}).sort("survey_date", 1))
        found_ids = {s.get("survey_display_id") for s in surveys}
        missing = [sid for sid in norm_ids if sid not in found_ids]
        if missing:
            return json.dumps({"error": f"Survey(s) not found: {', '.join(missing)}"})
    elif route_id is not None:
        surveys = list(db.surveys.find({"route_id": route_id}).sort("survey_date", 1))
        if not surveys:
            return json.dumps({
                "route_id": route_id, "road_name": _road_name(route_id),
                "error": f"No surveys found for route {route_id}",
            })
    else:
        return json.dumps({"error": "Provide either survey_display_ids or route_id."})

    if len(surveys) < 2:
        only = surveys[0] if surveys else None
        return json.dumps({
            "note": "Need at least two surveys to compare.",
            "surveys_found": [only.get("survey_display_id") for only in surveys] if surveys else [],
        })

    def _top_types_for_survey(sid) -> tuple[list[dict], list[dict]]:
        pipeline = [
            {"$match": {"survey_id": sid}},
            {"$group": {
                "_id": {"$ifNull": ["$group_id", "$asset_id"]},
                "good":    {"$sum": {"$cond": [{"$eq": ["$condition", "good"]}, 1, 0]}},
                "damaged": {"$sum": {"$cond": [{"$ne": ["$condition", "good"]}, 1, 0]}},
                "total":   {"$sum": 1},
            }},
        ]
        rows = list(db.assets.aggregate(pipeline))
        enriched = [{
            "asset_type": _label_name(r["_id"]) if r["_id"] else "Unknown",
            "good":    r["good"],
            "damaged": r["damaged"],
            "total":   r["total"],
        } for r in rows if r["_id"]]
        top_damaged = sorted([r for r in enriched if r["damaged"] > 0], key=lambda x: x["damaged"], reverse=True)[:top_k]
        top_good    = sorted([r for r in enriched if r["good"]    > 0], key=lambda x: x["good"],    reverse=True)[:top_k]
        return (
            [{"asset_type": r["asset_type"], "damaged": r["damaged"], "total": r["total"]} for r in top_damaged],
            [{"asset_type": r["asset_type"], "good": r["good"], "total": r["total"]} for r in top_good],
        )

    items = []
    for s in surveys:
        totals = s.get("totals") or {}
        t_total = int(totals.get("total_assets") or 0)
        t_good = int(totals.get("good") or 0)
        t_damaged = int(totals.get("damaged") or 0)
        damage_rate = round(t_damaged / t_total * 100, 1) if t_total else 0.0

        top_damaged, top_good = _top_types_for_survey(s["_id"])

        rid = s.get("route_id")
        items.append({
            "survey_display_id": s.get("survey_display_id", str(s["_id"])),
            "survey_date": s.get("survey_date"),
            "route_id": rid,
            "road_name": _road_name(rid),
            "totals": {
                "total_assets": t_total,
                "good": t_good,
                "damaged": t_damaged,
                "damage_rate_pct": damage_rate,
            },
            "top_damaged_types": top_damaged,
            "top_good_types": top_good,
        })

    result: dict = {"surveys": items}
    if len(items) == 2:
        a, b = items[0]["totals"], items[1]["totals"]
        result["deltas"] = {
            "total_assets": b["total_assets"] - a["total_assets"],
            "good": b["good"] - a["good"],
            "damaged": b["damaged"] - a["damaged"],
            "damage_rate_pct": round(b["damage_rate_pct"] - a["damage_rate_pct"], 1),
        }
    return json.dumps(result)


# =============================================================================
# GAP #2: INDIVIDUAL ASSET DETAILS / HISTORY
# =============================================================================

@tool(description="""Get full details of a specific master asset by its display ID.
Use for "Show me asset MAST-000125", "Details of MAST-000125",
"What is the condition history of MAST-000125?".

Args:
    master_display_id: The master display ID (e.g. "MAST-000125")

Returns:
    JSON with asset details, location, survey history, and condition logs""")
def get_asset_details(master_display_id: str) -> str:
    db = get_db()
    ma = db.master_assets.find_one({"master_display_id": master_display_id.upper().strip()})
    if not ma:
        return json.dumps({"error": f"Asset '{master_display_id}' not found"})

    # Get observation history from assets collection
    observations = list(
        db.assets.find(
            {"master_asset_id": ma["_id"]},
            {"condition": 1, "confidence": 1, "survey_display_id": 1, "survey_id": 1, "created_at": 1, "frame_number": 1, "video_id": 1, "location": 1}
        ).sort("created_at", 1)
    )

    obs_list = []
    for o in observations:
        loc = o.get("location", {})
        coords = loc.get("coordinates", [])
        obs_list.append({
            "survey_id": o.get("survey_display_id", str(o.get("survey_id", ""))),
            "condition": o.get("condition"),
            "confidence": round(o.get("confidence", 0), 3) if o.get("confidence") else None,
            "date": o.get("created_at"),
            "frame_number": o.get("frame_number"),
            "lat": coords[1] if len(coords) >= 2 else None,
            "lng": coords[0] if len(coords) >= 2 else None,
        })

    loc = ma.get("canonical_location", {})
    coords = loc.get("coordinates", [])

    return json.dumps({
        "master_display_id": ma.get("master_display_id"),
        "asset_type": _label_name(ma.get("asset_id", "")),
        "group": ma.get("group_id"),
        "category": _cat_name(ma.get("category_id", "")),
        "current_condition": ma.get("latest_condition"),
        "route_id": ma.get("route_id"),
        "route_name": ma.get("route_name"),
        "zone": ma.get("zone"),
        "side": ma.get("side"),
        "lat": coords[1] if len(coords) >= 2 else None,
        "lng": coords[0] if len(coords) >= 2 else None,
        "first_seen": ma.get("first_seen_date"),
        "last_seen": ma.get("last_seen_date"),
        "total_surveys_detected": ma.get("total_surveys_detected", 1),
        "issue": ma.get("issue"),
        "observation_history": obs_list,
    })


# =============================================================================
# GAP #3: VIDEO & FRAME DATA
# =============================================================================

@tool(description="""Get detailed information about a video including processing status,
frame count, and detection statistics.
Use for "Show me video details", "What's the status of the latest video?",
"How many frames had detections?", "Video processing status for route X".

Args:
    video_id: Optional specific video ID
    route_id: Optional route ID to get the latest video for

Returns:
    JSON with video metadata, processing status, and frame/detection stats""")
def get_video_details(video_id: str = "", route_id: Optional[int] = None) -> str:
    db = get_db()

    if video_id:
        from bson import ObjectId as ObjId
        try:
            video = db.videos.find_one({"_id": ObjId(video_id)})
        except Exception:
            video = None
    elif route_id is not None:
        video = db.videos.find_one({"route_id": route_id}, sort=[("created_at", -1)])
    else:
        video = db.videos.find_one({}, sort=[("created_at", -1)])

    if not video:
        return json.dumps({"error": "No video found"})

    vid = str(video["_id"])
    # Frame stats
    total_frames = db.assets.distinct("frame_number", {"video_id": vid})
    frames_with_detections = len(total_frames)
    total_detections = db.assets.count_documents({"video_id": vid})

    return json.dumps({
        "video_id": vid,
        "title": video.get("title"),
        "route_id": video.get("route_id"),
        "survey_id": video.get("survey_display_id", str(video.get("survey_id", ""))),
        "status": video.get("status"),
        "progress": video.get("progress"),
        "duration_seconds": video.get("duration_seconds"),
        "size_bytes": video.get("size_bytes"),
        "created_at": str(video.get("created_at", "")),
        "frames_with_detections": frames_with_detections,
        "total_detections": total_detections,
    })


# =============================================================================
# GAP #4: USER & WORKFLOW DATA
# =============================================================================

@tool(description="""Get statistics about surveyors: who surveyed what, how many surveys each did.
Use for "Who surveyed route X?", "Which surveyor did the most surveys?",
"Show me surveyor activity", "List all surveyors".

Returns:
    JSON with surveyor statistics""")
def get_surveyor_stats() -> str:
    db = get_db()

    pipeline = [
        {"$group": {
            "_id": "$surveyor_name",
            "survey_count": {"$sum": 1},
            "routes": {"$addToSet": "$route_id"},
            "latest_date": {"$max": "$survey_date"},
        }},
        {"$sort": {"survey_count": -1}},
    ]
    results = list(db.surveys.aggregate(pipeline))

    surveyors = []
    for r in results:
        name = r["_id"] or "Unknown"
        surveyors.append({
            "surveyor": name,
            "surveys_completed": r["survey_count"],
            "routes_covered": len(r["routes"]),
            "latest_survey_date": r["latest_date"],
        })

    return json.dumps({
        "total_surveyors": len(surveyors),
        "surveyors": surveyors,
    })


# =============================================================================
# GAP #5: GEOGRAPHIC / SPATIAL QUERIES (zone, side)
# =============================================================================

@tool(description="""Filter and count assets by zone and/or side of the road.
Use for "Defects in zone 3", "Assets on the left side", "What's on the RHS?",
"Condition by zone", "Which zone has the most defects?",
"List assets on the left side of route 235".

Args:
    route_id: Optional route ID
    zone: Optional zone filter (e.g. "overhead", "roadside", "pavement")
    side: Optional side filter (e.g. "LHS", "RHS", "median", "center")
    condition: Optional "good" or "damaged"

Returns:
    JSON with asset counts grouped by zone and side""")
def get_assets_by_zone_and_side(route_id: Optional[int] = None, zone: str = "", side: str = "", condition: str = "") -> str:
    db = get_db()
    query: dict = {}
    if route_id is not None:
        query["route_id"] = route_id
    if zone:
        query["zone"] = {"$regex": zone, "$options": "i"}
    if side:
        query["side"] = {"$regex": side, "$options": "i"}
    if condition:
        norm = condition.strip().lower()
        if norm == "damaged":
            query["latest_condition"] = {"$ne": "good"}
        elif norm == "good":
            query["latest_condition"] = "good"

    # If no zone/side filter, group by zone and side
    if not zone and not side:
        pipeline = [
            {"$match": query},
            {"$group": {
                "_id": {"zone": {"$ifNull": ["$zone", "unknown"]}, "side": {"$ifNull": ["$side", "unknown"]}},
                "total": {"$sum": 1},
                "good": {"$sum": {"$cond": [{"$eq": ["$latest_condition", "good"]}, 1, 0]}},
                "damaged": {"$sum": {"$cond": [{"$ne": ["$latest_condition", "good"]}, 1, 0]}},
            }},
            {"$sort": {"_id.zone": 1, "_id.side": 1}},
        ]
        results = list(db.master_assets.aggregate(pipeline))
        breakdown = []
        for r in results:
            breakdown.append({
                "zone": r["_id"]["zone"],
                "side": r["_id"]["side"],
                "total": r["total"],
                "good": r["good"],
                "damaged": r["damaged"],
                "damage_rate_pct": round(r["damaged"] / r["total"] * 100, 1) if r["total"] else 0,
            })
        return json.dumps({
            "route_id": route_id, "road_name": _road_name(route_id),
            "filter": {"zone": zone or None, "side": side or None, "condition": condition or None},
            "breakdown": breakdown,
            "total": sum(b["total"] for b in breakdown),
        })
    else:
        # Specific filter — return counts and top asset types
        total = db.master_assets.count_documents(query)
        pipeline = [
            {"$match": query},
            {"$group": {
                "_id": {"$ifNull": ["$group_id", "$asset_id"]},
                "count": {"$sum": 1},
                "damaged": {"$sum": {"$cond": [{"$ne": ["$latest_condition", "good"]}, 1, 0]}},
            }},
            {"$sort": {"count": -1}},
            {"$limit": 15},
        ]
        types = list(db.master_assets.aggregate(pipeline))
        asset_types = [{"asset_type": _label_name(t["_id"]), "count": t["count"], "damaged": t["damaged"]} for t in types]

        return json.dumps({
            "route_id": route_id, "road_name": _road_name(route_id),
            "filter": {"zone": zone or None, "side": side or None, "condition": condition or None},
            "total_matching": total,
            "top_asset_types": asset_types,
        })


# =============================================================================
# GAP #7: SPECIFIC CONDITION TYPES
# =============================================================================

@tool(description="""Find assets by condition. The platform exposes only two conditions:
"good" and "defective". Any other value is normalized to one of these two —
do NOT promise data for narrower defect sub-types (broken, bent, missing,
etc.); the platform does not expose those externally.

Args:
    condition_type: "good" or "defective" (other values coerced to "defective").
    route_id: Optional route filter
    asset_name: Optional asset type filter (e.g. "Guardrail", "Traffic Sign")
    limit: Max results (default 20)

Returns:
    JSON with count and list of assets matching the condition.""")
def get_assets_by_specific_condition(condition_type: str, route_id: Optional[int] = None, asset_name: str = "", limit: int = 20) -> str:
    db = get_db()
    norm = (condition_type or "").strip().lower()
    wants_good = norm == "good"
    query: dict = {"latest_condition": "good"} if wants_good else {"latest_condition": {"$ne": "good"}}

    if route_id is not None:
        query["route_id"] = route_id

    if asset_name:
        aids = _resolve_asset_ids(asset_name)
        if aids:
            query["asset_id"] = {"$in": aids}

    total = db.master_assets.count_documents(query)
    assets = list(db.master_assets.find(query).limit(limit))

    items = []
    for a in assets:
        loc = a.get("canonical_location", {})
        coords = loc.get("coordinates", [])
        items.append({
            "master_display_id": a.get("master_display_id"),
            "asset_type": _label_name(a.get("asset_id", "")),
            "condition": "good" if _classify_condition(a.get("latest_condition", "")) == "good" else "defective",
            "route_id": a.get("route_id"),
            "lat": coords[1] if len(coords) >= 2 else None,
            "lng": coords[0] if len(coords) >= 2 else None,
        })

    result = {
        "condition_filter": "good" if wants_good else "defective",
        "route_id": route_id, "road_name": _road_name(route_id),
        "asset_name": asset_name or None,
        "total_matching": total,
        "showing": len(items),
        "assets": items,
    }
    if total > limit:
        result["message"] = f"Showing {limit} of {total} total. Use the Asset Library for the full list."
    return json.dumps(result)


# =============================================================================
# GAP #8: CROSS-ROUTE AGGREGATION WITH ASSET/CATEGORY FILTER
# =============================================================================

@tool(description="""Rank routes by damage count filtered by a specific asset type or category.
Use for "Which routes have the most defective traffic signs?",
"Compare guardrail condition across routes",
"Rank routes by defective street lights",
"Routes with most defective pavement assets".

Args:
    asset_name: Optional specific asset type (e.g. "Guardrail", "Street Light Pole")
    category_name: Optional category (e.g. "Roadway Lighting", "Signage")
    limit: Max routes to return (default 10)

Returns:
    JSON with routes ranked by damaged count for the filtered asset type/category""")
def rank_routes_by_asset_damage(asset_name: str = "", category_name: str = "", limit: int = 10) -> str:
    db = get_db()
    query: dict = {}

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

    pipeline = [
        {"$match": query},
        {"$group": {
            "_id": "$route_id",
            "total": {"$sum": 1},
            "good": {"$sum": {"$cond": [{"$eq": ["$latest_condition", "good"]}, 1, 0]}},
            "damaged": {"$sum": {"$cond": [{"$ne": ["$latest_condition", "good"]}, 1, 0]}},
        }},
        {"$sort": {"damaged": -1}},
    ]
    results = list(db.master_assets.aggregate(pipeline))

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
            "total": r["total"],
            "damage_rate_pct": round(r["damaged"] / r["total"] * 100, 1) if r["total"] else 0,
        })

    return json.dumps({
        "filter": {"asset_name": asset_name or None, "category_name": category_name or None},
        "routes": ranked[:limit],
        "total_routes": len(ranked),
    })


# =============================================================================
# GAP #9: TREND / TIME-SERIES ANALYSIS
# =============================================================================

@tool(description="""Show asset detection trend over time — how many assets were detected per time period.
Use for "Detection trend over last 6 months", "How many assets detected each month?",
"Are we finding more defects over time?", "Show monthly survey activity".

Args:
    route_id: Optional route filter
    group_by: Time bucket — "day", "week", or "month" (default "month")

Returns:
    JSON with time-series data of asset detections""")
def get_detection_trend(route_id: Optional[int] = None, group_by: str = "month") -> str:
    db = get_db()
    query: dict = {}
    if route_id is not None:
        query["route_id"] = route_id

    # Group surveys by time period
    if group_by == "day":
        date_format = "%Y-%m-%d"
    elif group_by == "week":
        date_format = "%Y-W%V"
    else:
        date_format = "%Y-%m"

    surveys = list(db.surveys.find(query, {"survey_date": 1, "route_id": 1, "_id": 1}).sort("survey_date", 1))

    if not surveys:
        return json.dumps({"route_id": route_id, "road_name": _road_name(route_id), "trend": [], "note": "No surveys found"})

    # Build time buckets
    from collections import defaultdict
    buckets = defaultdict(lambda: {"surveys": 0, "routes": set()})

    for s in surveys:
        date_str = s.get("survey_date", "")
        if not date_str:
            continue
        # Parse to get bucket key
        try:
            from datetime import datetime as dt
            d = dt.strptime(date_str[:10], "%Y-%m-%d")
            key = d.strftime(date_format)
        except Exception:
            key = date_str[:7]  # fallback to YYYY-MM
        buckets[key]["surveys"] += 1
        buckets[key]["routes"].add(s.get("route_id"))

    # Get asset counts per survey
    survey_ids = [s["_id"] for s in surveys]

    trend = []
    for key in sorted(buckets.keys()):
        b = buckets[key]
        trend.append({
            "period": key,
            "surveys": b["surveys"],
            "routes_surveyed": len(b["routes"]),
        })

    # Also get overall asset detection trend from master_assets.first_seen_date
    asset_pipeline = [
        {"$match": {**query, "first_seen_date": {"$exists": True}}},
        {"$group": {
            "_id": {"$substr": ["$first_seen_date", 0, 7]},  # YYYY-MM
            "new_assets": {"$sum": 1},
            "new_damaged": {"$sum": {"$cond": [{"$ne": ["$latest_condition", "good"]}, 1, 0]}},
        }},
        {"$sort": {"_id": 1}},
    ]
    asset_trend = list(db.master_assets.aggregate(asset_pipeline))

    # Merge into trend
    asset_by_period = {a["_id"]: a for a in asset_trend}
    for t in trend:
        period_key = t["period"][:7]  # match YYYY-MM
        at = asset_by_period.get(period_key, {})
        t["new_assets_detected"] = at.get("new_assets", 0)
        t["new_defective"] = at.get("new_damaged", 0)

    return json.dumps({
        "route_id": route_id, "road_name": _road_name(route_id),
        "group_by": group_by,
        "trend": trend,
    })


# =============================================================================
# GAP #10: MAP OUTPUT FOR SPATIAL QUERIES
# =============================================================================

@tool(description="""Get asset locations formatted for map display. Returns data with a ```map code block.
Use for "Show guardrails on the map", "Map all defective assets on route 235",
"Show me defects on a map", "Map all assets in this category".

Args:
    asset_name: Optional specific asset type name
    category_name: Optional category name
    route_id: Optional route filter
    condition: Optional "good" or "damaged"
    limit: Max markers (default 50)

Returns:
    Markdown with a map code block containing markers""")
def get_assets_for_map(asset_name: str = "", category_name: str = "", route_id: Optional[int] = None, condition: str = "", limit: int = 50) -> str:
    db = get_db()
    query: dict = {"canonical_location": {"$exists": True}}

    if asset_name:
        aids = _resolve_asset_ids(asset_name)
        if aids:
            query["asset_id"] = {"$in": aids}
    if category_name:
        cid = _resolve_category_id(category_name)
        if cid:
            query["category_id"] = cid
    if route_id is not None:
        query["route_id"] = route_id
    if condition:
        norm = condition.strip().lower()
        if norm == "damaged":
            query["latest_condition"] = {"$ne": "good"}
        elif norm == "good":
            query["latest_condition"] = "good"

    total = db.master_assets.count_documents(query)
    assets = list(db.master_assets.find(query).limit(limit))

    markers = []
    for a in assets:
        loc = a.get("canonical_location", {})
        coords = loc.get("coordinates", [])
        if len(coords) >= 2:
            cond = a.get("latest_condition", "unknown")
            color = "green" if cond == "good" else "red"
            marker = {
                "lat": coords[1],
                "lng": coords[0],
                "label": _label_name(a.get("asset_id", "")),
                "color": color,
                "popup": f"{_label_name(a.get('asset_id', ''))} — {cond} ({a.get('master_display_id', '')})",
            }
            # Add video/frame info for popup image
            vid_id = a.get("latest_video_id")
            frame_num = a.get("latest_frame_number")
            box = a.get("latest_box")
            if vid_id and frame_num is not None:
                marker["video_id"] = str(vid_id)
                marker["frame_number"] = frame_num
                if box:
                    marker["box"] = {"x": box.get("x", 0), "y": box.get("y", 0), "w": box.get("width", 0), "h": box.get("height", 0)}
            markers.append(marker)

    description = []
    if asset_name:
        description.append(asset_name)
    if category_name:
        description.append(category_name)
    if condition:
        description.append(f"{condition} condition")
    if route_id:
        road = db.roads.find_one({"route_id": route_id})
        rname = road.get("road_name", f"Route {route_id}") if road else f"Route {route_id}"
        description.append(f"on {rname}")
    desc = " ".join(description) if description else "assets"

    intro = f"Here are {len(markers)} {desc} shown on the map."
    if total > limit:
        intro += f" (Showing {limit} of {total} total.)"

    map_data = json.dumps({"type": "circle", "markers": markers}, indent=2)
    return f"{intro}\n\n```map\n{map_data}\n```"

@tool(description="""Resolve a road/route NAME (e.g. "Al Wakrah", "Corniche", "D-Ring") to one or
more route_ids using fuzzy matching against the roads collection.

ALWAYS call this first when the user references a road by name instead of by
route_id. If the result contains multiple matches, call the relevant data
tool ONCE PER route_id and combine the results in your final answer —
present per-route sections so the user can see each matching road.

Args:
    name: Road name or partial name from the user's question.

Returns JSON:
    {
      "query": <input>,
      "matches": [{"route_id": int, "road_name": str, "score": int}, ...],
      "match_count": int
    }
    If no road name scores above the fuzzy threshold, "matches" is empty —
    inform the user no road with that name was found.""")
def find_routes_by_name(name: str) -> str:
    matches = _resolve_route_ids_from_name(name)
    return json.dumps({
        "query": name,
        "matches": matches,
        "match_count": len(matches),
    })


# =============================================================================
# TOOL REGISTRY
# =============================================================================


ALL_TOOLS = [
    find_routes_by_name,
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
    # Gap-fill tools
    compare_surveys_on_route,
    compare_surveys,
    get_asset_details,
    get_video_details,
    get_surveyor_stats,
    get_assets_by_zone_and_side,
    get_assets_by_specific_condition,
    rank_routes_by_asset_damage,
    get_detection_trend,
    get_assets_for_map,
]