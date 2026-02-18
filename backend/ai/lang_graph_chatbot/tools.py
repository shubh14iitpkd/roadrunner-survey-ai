"""
LangGraph Chatbot Tools
Simplified tool set for the LangGraph chatbot.
Queries MongoDB directly — demo data is now in the DB.
For demo videos we use video_key, for regular videos we use video_id.
"""

import os
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
    """Check if a video_id (basename without extension) is a demo video."""
    if not video_id:
        return False
    return is_demo(video_url=video_id + ".mp4")


def _get_asset_query_filter(video_id: str = "", route_id: Optional[int] = None) -> dict:
    """
    Build the correct MongoDB query filter for assets.
    Prioritizes video_id if present (specific video), otherwise filters by route_id (all videos on route).
    """
    query = {}
    if video_id:
        if _is_demo_video_id(video_id):
            query["video_key"] = video_id
        else:
            query["video_id"] = video_id
    
    if route_id is not None:
        query["route_id"] = route_id
        
    return query


# =============================================================================
# TOOLS
# =============================================================================


@tool
def list_videos(route_id: Optional[int] = None) -> str:
    """
    List uploaded videos, optionally filtered by route_id.
    Use this when the user asks to see videos for a specific route.

    Args:
        route_id: Optional route number to filter videos by

    Returns:
        Formatted list of videos with title, route, and upload date
    """
    db = get_db()
    query = {}
    if route_id is not None:
        query["route_id"] = route_id

    videos = list(db.videos.find(query).sort("created_at", -1).limit(30))

    if not videos:
        filter_msg = f" for route {route_id}" if route_id is not None else ""
        return f"No videos found{filter_msg}."

    lines = [f"Videos ({len(videos)} found)\n"]
    for v in videos:
        title = v.get("title", "Untitled")
        r_id = v.get("route_id", "—")
        created = v.get("created_at", "Unknown")
        storage_url = v.get("storage_url", "")
        video_key = get_video_key(storage_url) if storage_url else "—"
        lines.append(f"- **{title}** | Route {r_id} | Uploaded {created} | Key: `{video_key}`")

    return "\n".join(lines)


@tool
def list_surveys(status: str = "", route_id: Optional[int] = None) -> str:
    """
    List all surveys, optionally filtered by status and route.
    Use this when the user asks for surveys, survey list, or survey history.

    Args:
        status: Optional filter — "completed", "processing", "uploaded"
        route_id: Optional route number to filter surveys by

    Returns:
        Formatted list of surveys
    """
    db = get_db()

    query = {}
    if status and status.strip():
        query["status"] = {"$regex": status, "$options": "i"}
    if route_id is not None:
        query["route_id"] = route_id

    surveys = list(db.surveys.find(query).sort("survey_date", -1).limit(30))

    if not surveys:
        status_msg = f" with status '{status}'" if status else ""
        route_msg = f" for route {route_id}" if route_id is not None else ""
        return f"No surveys found{status_msg}{route_msg}."

    lines = [f"Surveys ({len(surveys)} found)\n"]
    for s in surveys:
        route = s.get("route_id", "?")
        date = s.get("survey_date", "Unknown")
        surveyor = s.get("surveyor_name", "Unknown")
        version = s.get("survey_version", 1)
        is_latest = "Latest" if s.get("is_latest") else ""
        lines.append(f"- Route **{route}** | {date} | {surveyor} | v{version} {is_latest}")

    return "\n".join(lines)


@tool
def get_asset_condition_summary(video_id: str = "", route_id: Optional[int] = None) -> str:
    """
    Get a summary of asset conditions (good vs damaged).
    Can summarize for a specific video OR an entire route.
    Use this when the user asks about asset conditions, asset health, damage breakdown,
    or requests a pie chart / visualization of asset conditions.

    Args:
        video_id: Optional specific video ID
        route_id: Optional route ID to summarize across all videos on that route

    Returns:
        Condition breakdown with counts and percentages for good and damaged assets
    """
    db = get_db()

    # If neither provided, try to find context or default to latest video
    if not video_id and route_id is None:
        # For now, default to latest video if nothing specified
        video = db.videos.find_one({}, sort=[("created_at", -1)])
        if not video:
            return "No data found."
        storage_url = video.get("storage_url", "")
        video_id = get_video_key(storage_url) if storage_url else str(video["_id"])

    # Build query
    asset_filter = _get_asset_query_filter(video_id, route_id)

    # Aggregate conditions
    pipeline = [
        {"$match": asset_filter},
        {"$group": {"_id": "$condition", "count": {"$sum": 1}}},
    ]

    results = list(db.assets.aggregate(pipeline))

    context_label = f"video `{video_id}`" if video_id else f"route {route_id}"
    if not results:
        return f"No assets found for {context_label}."

    total = sum(r["count"] for r in results)
    good = 0
    damaged = 0

    for r in results:
        condition = (r["_id"] or "").lower()
        if condition in GOOD_CONDITIONS:
            good += r["count"]
        elif condition in DAMAGED_CONDITIONS:
            damaged += r["count"]
        else:
            good += r["count"]  # default unknown to good

    good_pct = round(good / total * 100, 1) if total else 0
    damaged_pct = round(damaged / total * 100, 1) if total else 0

    lines = [
        f"Asset Condition Summary for {context_label}\n",
        f"- **Total assets**: {total:,}",
        f"- **Good condition**: {good:,} ({good_pct}%)",
        f"- **Damaged / Poor**: {damaged:,} ({damaged_pct}%)",
    ]

    return "\n".join(lines)


# =============================================================================
# TOOL REGISTRY
# =============================================================================

ALL_TOOLS = [
    list_videos,
    list_surveys,
    get_asset_condition_summary,
]
