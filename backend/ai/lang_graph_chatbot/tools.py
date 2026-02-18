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


def _get_asset_query_filter(video_id: str) -> dict:
    """
    Build the correct MongoDB query filter for assets based on video type.
    Demo videos use video_key, regular videos use video_id.
    """
    if _is_demo_video_id(video_id):
        return {"video_key": video_id}
    return {"video_id": video_id}


# =============================================================================
# TOOLS
# =============================================================================


@tool
def list_videos() -> str:
    """
    List all uploaded videos from the database.
    Use this when the user asks to see their videos or wants to know what videos exist.

    Returns:
        Formatted list of videos with title, route, and upload date
    """
    db = get_db()
    videos = list(db.videos.find({}).sort("created_at", -1).limit(30))

    if not videos:
        return "No videos found in the database."

    lines = [f"Videos ({len(videos)} found)\n"]
    for v in videos:
        title = v.get("title", "Untitled")
        route_id = v.get("route_id", "—")
        created = v.get("created_at", "Unknown")
        storage_url = v.get("storage_url", "")
        video_key = get_video_key(storage_url) if storage_url else "—"
        demo_tag = " [Demo]" if is_demo(video_url=storage_url) else ""
        lines.append(f"- **{title}**{demo_tag} | Route {route_id} | Uploaded {created} | Key: `{video_key}`")

    return "\n".join(lines)


@tool
def list_surveys(status: str = "") -> str:
    """
    List all surveys, optionally filtered by status.
    Use this when the user asks for surveys, survey list, or survey history.

    Args:
        status: Optional filter — "completed", "processing", "uploaded" (leave empty for all)

    Returns:
        Formatted list of surveys
    """
    db = get_db()

    query = {}
    if status and status.strip():
        query["status"] = {"$regex": status, "$options": "i"}

    surveys = list(db.surveys.find(query).sort("survey_date", -1).limit(30))

    if not surveys:
        filter_msg = f" with status '{status}'" if status else ""
        return f"No surveys found{filter_msg}."

    lines = [f"Surveys ({len(surveys)} found)\n"]
    for s in surveys:
        route = s.get("route_id", "?")
        date = s.get("survey_date", "Unknown")
        surveyor = s.get("surveyor_name", "Unknown")
        version = s.get("survey_version", 1)
        is_latest = "✓ Latest" if s.get("is_latest") else ""
        lines.append(f"- Route **{route}** | {date} | {surveyor} | v{version} {is_latest}")

    return "\n".join(lines)


@tool
def get_asset_condition_summary(video_id: str = "") -> str:
    """
    Get a summary of asset conditions (good vs damaged) for a video.
    Use this when the user asks about asset conditions, asset health, damage breakdown,
    or requests a pie chart / visualization of asset conditions.
    If no video_id is provided, uses the most recently uploaded video.

    Args:
        video_id: The video identifier or key (optional — defaults to most recent video)

    Returns:
        Condition breakdown with counts and percentages for good and damaged assets
    """
    db = get_db()

    # Resolve video_id if not provided
    if not video_id or not video_id.strip():
        video = db.videos.find_one({}, sort=[("created_at", -1)])
        if not video:
            return "No videos found in the database."
        storage_url = video.get("storage_url", "")
        video_id = get_video_key(storage_url) if storage_url else str(video["_id"])

    # Build query based on demo vs regular
    asset_filter = _get_asset_query_filter(video_id)

    # Aggregate conditions
    pipeline = [
        {"$match": asset_filter},
        {"$group": {"_id": "$condition", "count": {"$sum": 1}}},
    ]

    results = list(db.assets.aggregate(pipeline))

    if not results:
        return f"No assets found for video `{video_id}`."

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
        f"Asset Condition Summary for `{video_id}`\n",
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
