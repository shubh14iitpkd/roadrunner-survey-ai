"""
Langchain Tools for RoadSight AI Chatbot
Provides tools for querying assets, surveys, roads, frames, and videos
Automatically handles both demo videos (JSON) and regular videos (MongoDB)
"""

import os
from typing import Optional
from langchain.tools import tool
from pymongo import MongoClient
from bson.objectid import ObjectId
from dotenv import load_dotenv

from ai.lang_chatbot.demo_data import get_demo_loader, DemoDataLoader
from ai.lang_chatbot.context import get_current_user_id

load_dotenv()

MONGO_URI = os.environ.get("MONGO_URI", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "roadrunner")

# Condition categories - simplified to just good and damaged/poor
GOOD_CONDITIONS = ["good", "fine", "visible"]
DAMAGED_CONDITIONS = ["damaged", "bad", "poor", "missing", "broken", "bent", "dirty", "overgrown"]

# MongoDB client singleton
_client = None


def get_db():
    """Get MongoDB database connection"""
    global _client
    if _client is None:
        _client = MongoClient(
            MONGO_URI,
            uuidRepresentation="standard",
            maxPoolSize=50,
            serverSelectionTimeoutMS=5000,
        )
    return _client[DB_NAME]


# =============================================================================
# RESOLVED MAP HELPERS FOR DISPLAY NAMES
# =============================================================================

# Cache for resolved map with TTL support
# Format: {cache_key: {"data": {...}, "timestamp": float}}
_resolved_map_cache = {}
# CACHE_TTL_SECONDS = 120  # 2 minutes
CACHE_TTL_SECONDS = 120


def clear_resolved_map_cache(user_id: str = None):
    """
    Clear the resolved map cache.
    
    Args:
        user_id: If provided, only clears cache for this user. 
                 If None, clears the entire cache.
    """
    global _resolved_map_cache
    if user_id:
        # Clear specific user's cache
        if user_id in _resolved_map_cache:
            del _resolved_map_cache[user_id]
    else:
        # Clear entire cache
        _resolved_map_cache = {}


def get_resolved_map(user_id: str = None) -> dict:
    """
    Load system categories and labels with user overrides for display name resolution.
    Uses caching with 2-minute TTL to avoid repeated DB queries.
    
    Args:
        user_id: Optional user ID for applying preference overrides. 
                 If not provided, uses the current user from agent context.
    
    Returns:
        dict with 'categories' and 'labels' mappings
    """
    import time
    
    # Use provided user_id or get from agent context
    if not user_id:
        user_id = get_current_user_id()
    
    cache_key = user_id or "system"
    current_time = time.time()
    
    # Check cache with TTL
    if cache_key in _resolved_map_cache:
        cache_entry = _resolved_map_cache[cache_key]
        if current_time - cache_entry["timestamp"] < CACHE_TTL_SECONDS:
            return cache_entry["data"]
        # Cache expired, will refresh below
    
    db = get_db()
    system_cats = list(db.system_asset_categories.find())
    system_labels = list(db.system_asset_labels.find())
    
    # Load user preferences if user_id provided
    prefs = {}
    if user_id:
        try:
            prefs = db.user_preferences.find_one({"user_id": ObjectId(user_id)}) or {}
        except:
            prefs = {}
    
    labels_override = prefs.get("label_overrides", {})
    cat_override = prefs.get("category_overrides", {})
    
    categories = {}
    for cat in system_cats:
        cid = cat["category_id"]
        categories[cid] = {
            "display_name": cat_override.get(cid, {}).get("display_name") or cat["display_name"],
            "default_name": cat["default_name"]
        }
    
    labels = {}
    for l in system_labels:
        aid = l["asset_id"]
        labels[aid] = {
            "display_name": labels_override.get(aid, {}).get("display_name") or l["display_name"],
            "default_name": l["default_name"],
            "category_id": l.get("category_id")
        }
    
    result = {"categories": categories, "labels": labels}
    _resolved_map_cache[cache_key] = {"data": result, "timestamp": current_time}
    return result


def get_asset_display_name(asset_id_or_class: str, resolved_map: dict = None) -> str:
    """
    Get display name for an asset, falling back to humanized class name.
    
    Args:
        asset_id_or_class: Either an asset_id (type_asset_XX) or class name (Fence, Traffic_Sign)
        resolved_map: Optional pre-loaded resolved map
    
    Returns:
        Human-readable display name
    """
    if not resolved_map:
        resolved_map = get_resolved_map()
    
    labels = resolved_map.get("labels", {})
    
    # Direct ID lookup (e.g., type_asset_98)
    if asset_id_or_class in labels:
        return labels[asset_id_or_class]["display_name"]
    
    # Try matching by default_name (e.g., Fence, Traffic_Sign)
    for aid, data in labels.items():
        if data.get("default_name") == asset_id_or_class:
            return data["display_name"]
    
    # Fallback: humanize the class name
    return asset_id_or_class.replace("_", " ").title()


def get_category_display_name(category_id_or_name: str, resolved_map: dict = None) -> str:
    """
    Get display name for a category.
    
    Args:
        category_id_or_name: Either a category_id (type_category_X) or name (OIA, ITS)
        resolved_map: Optional pre-loaded resolved map
    
    Returns:
        Human-readable display name
    """
    if not resolved_map:
        resolved_map = get_resolved_map()
    
    categories = resolved_map.get("categories", {})
    
    # Direct ID lookup
    if category_id_or_name in categories:
        return categories[category_id_or_name]["display_name"]
    
    # Try matching by default_name
    for cid, data in categories.items():
        if data.get("default_name") == category_id_or_name:
            return data["display_name"]
    
    # Fallback
    return category_id_or_name.replace("_", " ").title()


def _normalize_video_id(video_id: str) -> str:
    """Normalize video ID by removing extension"""
    if not video_id:
        return ""
    return video_id.replace(".mp4", "").replace(".MP4", "")


def get_most_recent_video() -> dict:
    """
    Get the most recently uploaded video from the database.
    Checks both 'videos' collection and returns video info.
    Also checks if it's a demo video.
    
    Returns:
        dict with 'video_id', 'is_demo', 'title', 'created_at' or None if no video found
    """
    db = get_db()
    
    # Query most recent video by created_at or _id (ObjectId has timestamp)
    video = db.videos.find_one(
        {},
        sort=[("created_at", -1)]  # Most recent first
    )
    
    if not video:
        # Fallback: try sorting by _id (ObjectId contains timestamp)
        video = db.videos.find_one(
            {},
            sort=[("_id", -1)]
        )
    
    if not video:
        return None
    
    # Extract video ID from storage_url or title
    import os
    storage_url = video.get("storage_url", "")
    title = video.get("title", "")
    
    # Try to get the base filename
    if storage_url:
        video_id = os.path.splitext(os.path.basename(storage_url))[0]
    elif title:
        video_id = os.path.splitext(title)[0]
    else:
        video_id = str(video["_id"])
    
    return {
        "video_id": video_id,
        "object_id": str(video["_id"]),
        "is_demo": DemoDataLoader.is_demo_video(video_id),
        "title": title or video_id,
        "created_at": video.get("created_at"),
        "route_id": video.get("route_id"),
    }


def _resolve_video_id(video_id: str = None) -> tuple:
    """
    Resolve video_id - if not provided, get most recent video.
    
    Args:
        video_id: Optional video ID
    
    Returns:
        tuple of (resolved_video_id, context_message)
        context_message is None if video_id was provided, otherwise describes the fallback
    """
    if video_id and video_id.strip():
        return _normalize_video_id(video_id), None
    
    # Get most recent video as fallback
    recent = get_most_recent_video()
    if not recent:
        return None, "No videos found in the database."
    
    context = f"(Using most recent video: {recent['title']})"
    return recent["video_id"], context


# =============================================================================
# ASSET TOOLS
# =============================================================================


@tool
def get_asset_categories(video_id: str = "") -> str:
    """
    Get category-wise breakdown of assets for a video.
    Use this when user asks about asset categories, types of assets, or category breakdown.
    If no video_id provided, uses the most recently uploaded video.
    
    Args:
        video_id: The video identifier (optional - defaults to most recent video)
    
    Returns:
        Formatted string with categories and their counts
    """
    video_id, context_msg = _resolve_video_id(video_id)
    if not video_id:
        return context_msg or "No video available to query."
    
    # Load resolved map for display names
    resolved_map = get_resolved_map()
    
    if DemoDataLoader.is_demo_video(video_id):
        # Use demo data
        loader = get_demo_loader()
        summary = loader.get_summary_for_video(video_id)
        by_category = summary.get("by_category", {})
        total = summary.get("total_assets", 0)
        
        if not by_category:
            return f"No asset categories found for video {video_id}"
        
        lines = [f"Asset Categories (Total: {total:,} assets)\n"]
        for cat, count in sorted(by_category.items(), key=lambda x: -x[1]):
            pct = round(count / total * 100, 1) if total else 0
            display_name = get_category_display_name(cat, resolved_map)
            lines.append(f"- {display_name}: {count:,} ({pct}%)")
        
        return "\n".join(lines)
    else:
        # Query MongoDB video_processing_results
        db = get_db()
        result = db.video_processing_results.find_one({"video_id": video_id})
        
        if not result:
            return f"No processing results found for video {video_id}"
        
        type_dist = result.get("type_distribution", {})
        total = result.get("total_defects", 0)
        
        lines = [f"Asset Categories (Total: {total:,} detections)\n"]
        for asset_type, count in sorted(type_dist.items(), key=lambda x: -x[1]):
            display_name = get_asset_display_name(asset_type, resolved_map)
            lines.append(f"- {display_name}: {count:,}")
        
        return "\n".join(lines)


@tool
def get_asset_list(video_id: str = "") -> str:
    """
    Get list of all asset types detected in a video with counts.
    Use this when user asks to list assets, show all assets, or get asset report.
    If no video_id provided, uses the most recently uploaded video.
    
    Args:
        video_id: The video identifier (optional - defaults to most recent video)
    
    Returns:
        Formatted list of asset types with detection counts
    """
    video_id, context_msg = _resolve_video_id(video_id)
    if not video_id:
        return context_msg or "No video available to query."
    
    # Load resolved map for display names
    resolved_map = get_resolved_map()
    
    if DemoDataLoader.is_demo_video(video_id):
        loader = get_demo_loader()
        summary = loader.get_summary_for_video(video_id)
        by_type = summary.get("by_type", {})
        by_condition = summary.get("by_condition", {})
        total = summary.get("total_assets", 0)
        
        if not by_type:
            return f"No assets found for video {video_id}"
        
        # Calculate condition summary
        good = sum(v for k, v in by_condition.items() if k.lower() in ["good", "fine", "visible"])
        bad = sum(v for k, v in by_condition.items() if k.lower() in ["damaged", "bad", "poor", "missing", "broken"])
        
        lines = [f"Asset Report (Total: {total:,} assets)\n"]
        lines.append(f"Condition Summary: Good: {good:,} | Needs Attention: {bad:,}\n")
        lines.append("Asset Types:")
        
        for asset_type, count in sorted(by_type.items(), key=lambda x: -x[1])[:20]:
            display = get_asset_display_name(asset_type, resolved_map)
            lines.append(f"- {display}: {count:,}")
        
        if len(by_type) > 20:
            lines.append(f"\n...and {len(by_type) - 20} more types")
        
        return "\n".join(lines)
    else:
        db = get_db()
        result = db.video_processing_results.find_one({"video_id": video_id})
        
        if not result:
            return f"No processing results found for video {video_id}"
        
        type_dist = result.get("type_distribution", {})
        severity_dist = result.get("severity_distribution", {})
        total = result.get("total_defects", 0)
        
        lines = [f"Asset Report (Total: {total:,} detections)\n"]
        lines.append(f"Severity: Minor: {severity_dist.get('minor', 0)} | Moderate: {severity_dist.get('moderate', 0)} | Severe: {severity_dist.get('severe', 0)}\n")
        lines.append("Asset Types:")
        
        for asset_type, count in sorted(type_dist.items(), key=lambda x: -x[1]):
            display = get_asset_display_name(asset_type, resolved_map)
            lines.append(f"- {display}: {count:,}")
        
        return "\n".join(lines)


@tool
def get_asset_by_type(video_id: str = "", asset_type: str = "") -> str:
    """
    Get condition breakdown for a specific asset type (e.g., traffic signs, street lights).
    Use this when user asks about:
    - Condition of a specific asset type (e.g., "condition of traffic signs")
    - How many of a certain asset (e.g., "how many street lights")
    - Status of specific assets (e.g., "are guardrails damaged")
    - Any question about a specific asset category
    
    Args:
        video_id: The video identifier (optional - defaults to most recent video)
        asset_type: Type of asset (e.g., "traffic sign", "street light", "kerb", "road marking", "guardrail")
    
    Returns:
        Total count, good count, damaged count, and damage rate percentage
    """
    if not asset_type:
        return "Please specify an asset type to search for."
    
    video_id, context_msg = _resolve_video_id(video_id)
    if not video_id:
        return context_msg or "No video available to query."
    
    if DemoDataLoader.is_demo_video(video_id):
        loader = get_demo_loader()
        breakdown = loader.get_condition_breakdown_for_type(asset_type, video_id)
        
        if breakdown["total"] == 0:
            return f"No {asset_type} assets found in video {video_id}"
        
        lines = [f"{asset_type.title()} Assets\n"]
        lines.append(f"- Total: {breakdown['total']:,}")
        lines.append(f"- Good condition: {breakdown['good']:,}")
        lines.append(f"- Damaged: {breakdown['damaged']:,}")
        lines.append(f"- Damage rate: {breakdown['damage_rate']}%")
        
        return "\n".join(lines)
    else:
        db = get_db()
        result = db.video_processing_results.find_one({"video_id": video_id})
        
        if not result:
            return f"No processing results found for video {video_id}"
        
        defects = result.get("defects", [])
        type_lower = asset_type.lower()
        
        matching = [d for d in defects if type_lower in d.get("asset_type", "").lower()]
        
        if not matching:
            return f"No {asset_type} found in video {video_id}"
        
        conditions = {}
        for d in matching:
            cond = d.get("condition", "Unknown")
            conditions[cond] = conditions.get(cond, 0) + 1
        
        lines = [f"{asset_type.title()} Assets (Total: {len(matching)})\n"]
        for cond, count in conditions.items():
            lines.append(f"- {cond}: {count}")
        
        return "\n".join(lines)


@tool
def get_damaged_assets(video_id: str = "") -> str:
    """
    Get all damaged assets requiring attention, grouped by type.
    Use this when user asks about damaged assets, what needs repair, poor condition, or improvement suggestions.
    If no video_id provided, uses the most recently uploaded video.
    
    Args:
        video_id: The video identifier (optional - defaults to most recent video)
    
    Returns:
        List of damaged assets grouped by type with counts
    """
    video_id, context_msg = _resolve_video_id(video_id)
    if not video_id:
        return context_msg or "No video available to query."
    
    # Load resolved map for display names
    resolved_map = get_resolved_map()
    
    if DemoDataLoader.is_demo_video(video_id):
        loader = get_demo_loader()
        damaged = loader.get_damaged_assets_grouped(video_id)
        
        if not damaged:
            return "No damaged assets found requiring attention."
        
        total = sum(d["count"] for d in damaged)
        lines = [f"Damaged Assets Requiring Attention (Total: {total:,})\n"]
        
        for item in damaged:
            display = get_asset_display_name(item["type"], resolved_map)
            lines.append(f"- {display}: {item['count']:,}")
        
        return "\n".join(lines)
    else:
        db = get_db()
        result = db.video_processing_results.find_one({"video_id": video_id})
        
        if not result:
            return f"No processing results found for video {video_id}"
        
        defects = result.get("defects", [])
        damaged = [d for d in defects if d.get("condition", "").lower() in ["damaged", "bad", "poor", "missing", "broken"]]
        
        if not damaged:
            return "No damaged assets found."
        
        # Group by type
        by_type = {}
        for d in damaged:
            t = d.get("asset_type", "Unknown")
            by_type[t] = by_type.get(t, 0) + 1
        
        lines = [f"Damaged Assets (Total: {len(damaged)})\n"]
        for t, c in sorted(by_type.items(), key=lambda x: -x[1]):
            display = get_asset_display_name(t, resolved_map)
            lines.append(f"- {display}: {c}")
        
        return "\n".join(lines)


@tool
def rank_assets_by_defects(video_id: str = "") -> str:
    """
    Rank asset types/categories by damage rate (percentage of defects).
    Use this when user asks:
    - Which assets have most defects
    - Rank assets by damage
    - Which category has worst condition
    - What needs most attention
    
    Args:
        video_id: The video identifier (optional - defaults to most recent video)
    
    Returns:
        Asset types ranked by defect/damage rate from worst to best
    """
    video_id, context_msg = _resolve_video_id(video_id)
    if not video_id:
        return context_msg or "No video available to query."
    
    # Load resolved map for display names
    resolved_map = get_resolved_map()
    
    if DemoDataLoader.is_demo_video(video_id):
        loader = get_demo_loader()
        assets = loader.get_assets_by_video(video_id)
        
        if not assets:
            return "No assets found."
        
        # Group by type and count conditions
        type_stats = {}
        for a in assets:
            asset_type = a.get("type", "Unknown")
            condition = a.get("condition", "").lower()
            
            if asset_type not in type_stats:
                type_stats[asset_type] = {"total": 0, "damaged": 0}
            
            type_stats[asset_type]["total"] += 1
            if condition in DAMAGED_CONDITIONS:
                type_stats[asset_type]["damaged"] += 1
        
        # Calculate damage rates and sort
        ranked = []
        for t, stats in type_stats.items():
            if stats["total"] >= 5:  # Only include types with at least 5 assets
                rate = round(stats["damaged"] / stats["total"] * 100, 1)
                ranked.append({
                    "type": t,
                    "total": stats["total"],
                    "damaged": stats["damaged"],
                    "rate": rate
                })
        
        ranked.sort(key=lambda x: -x["rate"])
        
        lines = ["Assets Ranked by Defect Rate\n"]
        lines.append("(Higher percentage = more defects)\n")
        
        for i, r in enumerate(ranked[:15], 1):
            display = get_asset_display_name(r["type"], resolved_map)
            lines.append(f"{i}. {display}: {r['rate']}% damaged ({r['damaged']}/{r['total']})")
        
        return "\n".join(lines)
    else:
        return "Defect ranking is only available for demo videos currently."


@tool
def get_asset_count(video_id: str = "", asset_type: str = "") -> str:
    """
    Get the count of a specific asset type.
    Use this when user asks "how many X are there" where X is an asset type.
    Examples: "how many road markings", "count of street lights", "number of traffic signs"
    
    Args:
        video_id: The video identifier (optional - defaults to most recent video)
        asset_type: Type of asset to count (e.g., "road marking", "street light", "traffic sign")
    
    Returns:
        Count of the specified asset type with condition breakdown
    """
    if not asset_type:
        return "Please specify an asset type to count."
    
    video_id, context_msg = _resolve_video_id(video_id)
    if not video_id:
        return context_msg or "No video available to query."
    
    if DemoDataLoader.is_demo_video(video_id):
        loader = get_demo_loader()
        matching = loader.get_assets_by_type(asset_type, video_id)
        
        if not matching:
            return f"No {asset_type} assets found."
        
        # Count conditions
        good = sum(1 for a in matching if a.get("condition", "").lower() in GOOD_CONDITIONS)
        damaged = sum(1 for a in matching if a.get("condition", "").lower() in DAMAGED_CONDITIONS)
        total = len(matching)
        
        lines = [f"{asset_type.title()} Count\n"]
        lines.append(f"- Total: {total:,}")
        lines.append(f"- Good condition: {good:,}")
        lines.append(f"- Damaged: {damaged:,}")
        
        if total > 0:
            good_pct = round(good / total * 100, 1)
            lines.append(f"- Condition: {good_pct}% good")
        
        return "\n".join(lines)
    else:
        db = get_db()
        # Query assets collection
        count = db.assets.count_documents({
            "type": {"$regex": asset_type, "$options": "i"}
        })
        return f"Found {count:,} {asset_type} assets."


@tool
def get_category_condition_summary(video_id: str = "") -> str:
    """
    Get condition summary for each asset category.
    Use this when user asks about:
    - Condition by category
    - Which categories need attention
    - Category-wise asset health
    
    Args:
        video_id: The video identifier (optional - defaults to most recent video)
    
    Returns:
        Each category with good/damaged counts and percentages
    """
    video_id, context_msg = _resolve_video_id(video_id)
    if not video_id:
        return context_msg or "No video available to query."
    
    # Load resolved map for display names
    resolved_map = get_resolved_map()
    
    if DemoDataLoader.is_demo_video(video_id):
        loader = get_demo_loader()
        assets = loader.get_assets_by_video(video_id)
        
        if not assets:
            return "No assets found."
        
        # Group by category
        cat_stats = {}
        for a in assets:
            cat = a.get("category", "Unknown")
            condition = a.get("condition", "").lower()
            
            if cat not in cat_stats:
                cat_stats[cat] = {"total": 0, "good": 0, "damaged": 0}
            
            cat_stats[cat]["total"] += 1
            if condition in GOOD_CONDITIONS:
                cat_stats[cat]["good"] += 1
            elif condition in DAMAGED_CONDITIONS:
                cat_stats[cat]["damaged"] += 1
        
        lines = ["Category Condition Summary\n"]
        
        for cat, stats in sorted(cat_stats.items(), key=lambda x: -x[1]["total"]):
            total = stats["total"]
            good = stats["good"]
            damaged = stats["damaged"]
            good_pct = round(good / total * 100, 1) if total else 0
            damaged_pct = round(damaged / total * 100, 1) if total else 0
            
            display_name = get_category_display_name(cat, resolved_map)
            lines.append(f"\n{display_name}:")
            lines.append(f"  Total: {total:,} | Good: {good:,} ({good_pct}%) | Damaged: {damaged:,} ({damaged_pct}%)")
        
        return "\n".join(lines)
    else:
        return "Category summary is only available for demo videos currently."


# =============================================================================
# ROAD CONDITION TOOL
# =============================================================================


@tool
def get_road_condition(video_id: str = "") -> str:
    """
    Assess overall road condition based on asset analysis.
    Use this when user asks about road condition, road health, or overall assessment.
    If no video_id provided, uses the most recently uploaded video.
    
    Args:
        video_id: The video identifier (optional - defaults to most recent video)
    
    Returns:
        Road condition assessment with good/damaged percentages and recommendations
    """
    video_id, context_msg = _resolve_video_id(video_id)
    if not video_id:
        return context_msg or "No video available to query."
    
    if DemoDataLoader.is_demo_video(video_id):
        loader = get_demo_loader()
        summary = loader.get_summary_for_video(video_id)
        by_condition = summary.get("by_condition", {})
        total = summary.get("total_assets", 0)
        
        if not total:
            return f"No asset data available for video {video_id}"
        
        good = sum(v for k, v in by_condition.items() if k.lower() in ["good", "fine", "visible"])
        damaged = sum(v for k, v in by_condition.items() if k.lower() in ["damaged", "bad", "poor", "missing", "broken", "bent"])
        
        good_pct = round(good / total * 100, 1)
        damaged_pct = round(damaged / total * 100, 1)
        
        if good_pct >= 80:
            assessment = "Good - Road infrastructure is well-maintained"
            recommendation = "Continue regular maintenance schedule"
        elif good_pct >= 60:
            assessment = "Fair - Some areas require attention"
            recommendation = "Schedule targeted repairs for damaged assets"
        else:
            assessment = "Poor - Significant maintenance required"
            recommendation = "Prioritize repair work on critical assets"
        
        lines = [f"Road Condition Assessment\n"]
        lines.append(f"Based on {total:,} detected assets:\n")
        lines.append(f"- Good condition: {good:,} ({good_pct}%)")
        lines.append(f"- Needs repair: {damaged:,} ({damaged_pct}%)")
        lines.append(f"\nOverall Assessment: {assessment}")
        lines.append(f"Recommendation: {recommendation}")
        
        # Add worst categories
        defects = loader.get_defects_by_category(video_id)
        if defects:
            lines.append("\nIssues by Category:")
            for cat, count in sorted(defects.items(), key=lambda x: -x[1])[:5]:
                lines.append(f"- {cat}: {count} issues")
        
        return "\n".join(lines)
    else:
        db = get_db()
        result = db.video_processing_results.find_one({"video_id": video_id})
        
        if not result:
            return f"No processing results found for video {video_id}"
        
        severity = result.get("severity_distribution", {})
        total = result.get("total_defects", 0)
        
        minor = severity.get("minor", 0)
        moderate = severity.get("moderate", 0)
        severe = severity.get("severe", 0)
        
        if total == 0:
            return "No defects detected - road appears to be in good condition."
        
        severe_pct = round(severe / total * 100, 1) if total else 0
        
        if severe_pct > 20:
            assessment = "Poor - Multiple severe issues detected"
        elif severe_pct > 5 or moderate > total * 0.3:
            assessment = "Fair - Some issues require attention"
        else:
            assessment = "Good - Mostly minor issues"
        
        lines = [f"Road Condition Assessment\n"]
        lines.append(f"Total Defects: {total}\n")
        lines.append(f"- Minor: {minor}")
        lines.append(f"- Moderate: {moderate}")
        lines.append(f"- Severe: {severe}")
        lines.append(f"\nAssessment: {assessment}")
        
        return "\n".join(lines)


# =============================================================================
# SURVEY TOOLS
# =============================================================================


@tool
def get_survey_status(route_id: int = 0) -> str:
    """
    Get survey status and summary. If route_id provided, gets status for that route.
    If not provided, returns the most recent survey status.
    Use this when user asks about survey status, survey date, or asset totals.
    
    Args:
        route_id: The route number (optional - if not provided, returns most recent survey)
    
    Returns:
        Survey status, date, surveyor, and asset totals
    """
    db = get_db()
    
    if route_id and route_id > 0:
        # Find latest survey for specific route
        survey = db.surveys.find_one(
            {"route_id": route_id},
            sort=[("survey_date", -1)]
        )
        if not survey:
            return f"No survey found for route {route_id}"
        header = f"Survey Status for Route {route_id}"
    else:
        # Find most recent survey overall
        survey = db.surveys.find_one({}, sort=[("survey_date", -1)])
        if not survey:
            return "No surveys found in the database."
        header = f"Most Recent Survey (Route {survey.get('route_id', 'Unknown')})"
    
    survey_id = survey.get("_id")
    survey_route_id = survey.get("route_id")
    
    lines = [f"{header}\n"]
    lines.append(f"- Route: {survey_route_id}")
    lines.append(f"- Survey Date: {survey.get('survey_date', 'Unknown')}")
    lines.append(f"- Surveyor: {survey.get('surveyor_name', 'Unknown')}")
    lines.append(f"- Version: {survey.get('survey_version', 1)}")
    lines.append(f"- Is Latest: {'Yes' if survey.get('is_latest') else 'No'}")
    
    # Check if survey is linked to a demo video
    video_id = survey.get("video_id")
    if not video_id and survey_route_id:
        # Try to get video from videos collection by route_id
        video_doc = db.videos.find_one({"route_id": survey_route_id}, sort=[("created_at", -1)])
        if video_doc:
            storage_url = video_doc.get("storage_url", "")
            title = video_doc.get("title", "")
            if storage_url:
                video_id = os.path.splitext(os.path.basename(storage_url))[0]
            elif title:
                video_id = os.path.splitext(title)[0]
    
    # Normalize video_id
    if video_id:
        video_id = video_id.replace(".mp4", "").replace(".MP4", "")
    
    # Check if demo video - use demo data loader
    if video_id and DemoDataLoader.is_demo_video(video_id):
        loader = get_demo_loader()
        summary = loader.get_summary_for_video(video_id)
        by_condition = summary.get("by_condition", {})
        total = summary.get("total_assets", 0)
        
        if total > 0:
            good = sum(v for k, v in by_condition.items() if k.lower() in GOOD_CONDITIONS)
            damaged = sum(v for k, v in by_condition.items() if k.lower() in DAMAGED_CONDITIONS)
            
            lines.append(f"\nAsset Totals (Demo Video: {video_id}):")
            lines.append(f"- Total: {total:,}")
            lines.append(f"- Good: {good:,}")
            lines.append(f"- Damaged/Poor: {damaged:,}")
            
            good_pct = round(good / total * 100, 1) if total else 0
            lines.append(f"- Condition Rate: {good_pct}% good")
        else:
            lines.append(f"\nNo assets found for demo video.")
    else:
        # Regular survey - fetch from assets collection
        asset_query = {}
        if survey_id:
            asset_query["survey_id"] = survey_id
        elif survey_route_id:
            asset_query["route_id"] = survey_route_id
        
        total_assets = db.assets.count_documents(asset_query)
        
        if total_assets > 0:
            good_count = db.assets.count_documents({
                **asset_query, 
                "condition": {"$regex": "|".join(GOOD_CONDITIONS), "$options": "i"}
            })
            damaged_count = db.assets.count_documents({
                **asset_query, 
                "condition": {"$regex": "|".join(DAMAGED_CONDITIONS), "$options": "i"}
            })
            
            lines.append(f"\nAsset Totals:")
            lines.append(f"- Total: {total_assets:,}")
            lines.append(f"- Good: {good_count:,}")
            lines.append(f"- Damaged/Poor: {damaged_count:,}")
            
            good_pct = round(good_count / total_assets * 100, 1)
            lines.append(f"- Condition Rate: {good_pct}% good")
        else:
            lines.append(f"\nNo assets found for this survey.")
    
    return "\n".join(lines)


@tool
def get_survey_assets(route_id: int = 0) -> str:
    """
    Get the assets/things detected in a survey, grouped by type.
    Use this when user asks what things were found, what was detected, or assets in a survey.
    If no route_id provided, uses the most recent survey.
    
    Args:
        route_id: The route number (optional - if not provided, uses most recent survey)
    
    Returns:
        List of asset types detected with counts
    """
    db = get_db()
    
    if route_id and route_id > 0:
        survey = db.surveys.find_one({"route_id": route_id}, sort=[("survey_date", -1)])
        if not survey:
            return f"No survey found for route {route_id}"
        header = f"Assets Detected in Route {route_id} Survey"
    else:
        survey = db.surveys.find_one({}, sort=[("survey_date", -1)])
        if not survey:
            return "No surveys found."
        header = f"Assets Detected in Most Recent Survey (Route {survey.get('route_id')})"
    
    survey_id = survey.get("_id")
    survey_route_id = survey.get("route_id")
    
    # Check for demo video
    video_id = survey.get("video_id")
    if not video_id and survey_route_id:
        video_doc = db.videos.find_one({"route_id": survey_route_id}, sort=[("created_at", -1)])
        if video_doc:
            storage_url = video_doc.get("storage_url", "")
            title = video_doc.get("title", "")
            if storage_url:
                video_id = os.path.splitext(os.path.basename(storage_url))[0]
            elif title:
                video_id = os.path.splitext(title)[0]
    
    if video_id:
        video_id = video_id.replace(".mp4", "").replace(".MP4", "")
    
    lines = [f"{header}\n"]
    lines.append(f"Survey Date: {survey.get('survey_date', 'Unknown')}")
    lines.append(f"Surveyor: {survey.get('surveyor_name', 'Unknown')}\n")
    
    # Use demo data if demo video
    if video_id and DemoDataLoader.is_demo_video(video_id):
        loader = get_demo_loader()
        summary = loader.get_summary_for_video(video_id)
        by_type = summary.get("by_type", {})
        by_condition = summary.get("by_condition", {})
        total = summary.get("total_assets", 0)
        
        if total == 0:
            lines.append("No assets detected.")
            return "\n".join(lines)
        
        # Condition summary
        good = sum(v for k, v in by_condition.items() if k.lower() in GOOD_CONDITIONS)
        damaged = sum(v for k, v in by_condition.items() if k.lower() in DAMAGED_CONDITIONS)
        
        lines.append(f"Total Assets: {total:,} (Good: {good:,} | Damaged: {damaged:,})\n")
        lines.append("Asset Types Detected:")
        
        for asset_type, count in sorted(by_type.items(), key=lambda x: -x[1])[:20]:
            display = asset_type.replace("_", " ").title()
            lines.append(f"- {display}: {count:,}")
        
        if len(by_type) > 20:
            lines.append(f"\n...and {len(by_type) - 20} more types")
    else:
        # Query from assets collection
        asset_query = {}
        if survey_id:
            asset_query["survey_id"] = survey_id
        elif survey_route_id:
            asset_query["route_id"] = survey_route_id
        
        # Aggregate by type
        pipeline = [
            {"$match": asset_query},
            {"$group": {"_id": "$type", "count": {"$sum": 1}}},
            {"$sort": {"count": -1}},
            {"$limit": 25}
        ]
        
        results = list(db.assets.aggregate(pipeline))
        total = db.assets.count_documents(asset_query)
        
        if not results:
            lines.append("No assets detected for this survey.")
            return "\n".join(lines)
        
        lines.append(f"Total Assets: {total:,}\n")
        lines.append("Asset Types Detected:")
        
        for r in results:
            asset_type = r.get("_id", "Unknown")
            count = r.get("count", 0)
            display = asset_type.replace("_", " ").title() if asset_type else "Unknown"
            lines.append(f"- {display}: {count:,}")
    
    return "\n".join(lines)


@tool  
def get_survey_list(status: str = "") -> str:
    """
    List all surveys with details, optionally filtered by status.
    Use this when user asks for all surveys, list surveys, completed surveys, or pending surveys.
    
    Args:
        status: Optional filter - "completed", "processing", "uploaded" (leave empty for all)
    
    Returns:
        List of surveys with route, date, surveyor, and status
    """
    db = get_db()
    
    query = {}
    if status and status.strip():
        query["status"] = {"$regex": status, "$options": "i"}
    
    surveys = list(db.surveys.find(query).sort("survey_date", -1).limit(30))
    
    if not surveys:
        filter_msg = f" with status '{status}'" if status else ""
        return f"No surveys found{filter_msg}"
    
    lines = [f"Survey List ({len(surveys)} surveys)\n"]
    for s in surveys:
        route = s.get("route_id", "?")
        date = s.get("survey_date", "Unknown")
        surveyor = s.get("surveyor_name", "Unknown")
        lines.append(f"- Route {route}: {date} | {surveyor}")
    
    return "\n".join(lines)


@tool
def get_survey_dates() -> str:
    """
    Get all survey dates with surveyor information.
    Use this when user asks about survey dates, when surveys were conducted, or survey timeline.
    Must display the surveyor name and route number for each survey date.
    Returns:
        List of survey dates with surveyor names
    """
    db = get_db()
    
    # Get surveys sorted by date
    surveys = list(db.surveys.find({}, {
        "survey_date": 1, 
        "surveyor_name": 1, 
        "route_id": 1
    }).sort("survey_date", -1).limit(30))
    
    if not surveys:
        return "No surveys found."
    
    # Group by date
    by_date = {}
    for s in surveys:
        date = s.get("survey_date", "Unknown")
        surveyor = s.get("surveyor_name", "Unknown")
        route = s.get("route_id", "?")
        
        if date not in by_date:
            by_date[date] = []
        by_date[date].append({"surveyor": surveyor, "route": route})
    
    lines = ["Survey Dates\n"]
    lines.append(f"Total: {len(surveys)} surveys across {len(by_date)} dates\n")
    
    for date, entries in by_date.items():
        surveyors = list(set(e["surveyor"] for e in entries))
        routes = [e["route"] for e in entries]
        surveyor_str = ", ".join(surveyors)
        lines.append(f"- {date}: {len(entries)} survey(s) by {surveyor_str} (Routes: {', '.join(map(str, routes))})")
    
    return "\n".join(lines)


@tool
def get_surveyor_stats() -> str:
    """
    Get statistics about surveyors - who conducted the most surveys.
    Use this when user asks about surveyors, who conducted surveys, or surveyor statistics.
    
    Returns:
        List of surveyors with survey counts
    """
    db = get_db()
    
    # Aggregate by surveyor_name
    pipeline = [
        {"$match": {"surveyor_name": {"$exists": True, "$ne": None, "$ne": ""}}},
        {"$group": {"_id": "$surveyor_name", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
        {"$limit": 20}
    ]
    
    results = list(db.surveys.aggregate(pipeline))
    
    if not results:
        return "No surveyor information found."
    
    total_surveys = sum(r.get("count", 0) for r in results)
    
    lines = ["Surveyor Statistics\n"]
    lines.append(f"Total: {total_surveys} surveys by {len(results)} surveyors\n")
    
    for i, r in enumerate(results, 1):
        surveyor = r.get("_id", "Unknown")
        count = r.get("count", 0)
        pct = round(count / total_surveys * 100, 1) if total_surveys else 0
        lines.append(f"{i}. {surveyor}: {count} surveys ({pct}%)")
    
    return "\n".join(lines)


@tool
def get_survey_summary() -> str:
    """
    Get overall summary of all surveys - total count, status breakdown, route coverage.
    Use this when user asks for survey summary, overall survey info, or survey statistics.
    
    Returns:
        Overall survey statistics and summary
    """
    db = get_db()
    
    total_surveys = db.surveys.count_documents({})
    
    if total_surveys == 0:
        return "No surveys found in the database."
    
    # Status breakdown
    status_pipeline = [
        {"$group": {"_id": "$status", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}}
    ]
    status_results = list(db.surveys.aggregate(status_pipeline))
    
    # Unique routes
    routes_pipeline = [
        {"$group": {"_id": "$route_id"}},
        {"$count": "total"}
    ]
    routes_result = list(db.surveys.aggregate(routes_pipeline))
    unique_routes = routes_result[0]["total"] if routes_result else 0
    
    # Latest survey info
    latest = db.surveys.find_one({}, sort=[("survey_date", -1)])
    
    lines = ["Survey Summary\n"]
    lines.append(f"- Total Surveys: {total_surveys:,}")
    lines.append(f"- Unique Routes: {unique_routes:,}")
    
    if latest:
        lines.append(f"- Latest Survey: Route {latest.get('route_id')} on {latest.get('survey_date')}")
    
    if status_results:
        lines.append("\nStatus Breakdown:")
        for s in status_results:
            status = s.get("_id", "Unknown")
            count = s.get("count", 0)
            pct = round(count / total_surveys * 100, 1)
            lines.append(f"- {status}: {count} ({pct}%)")
    
    return "\n".join(lines)


@tool
def get_surveys_by_period(period: str = "month") -> str:
    """
    Get count of surveys conducted in a specific time period.
    Use this when user asks about surveys this year, this month, today, or on a specific date.
    
    Args:
        period: Time period - "today", "week", "month", "year", or a specific date like "2026-01-20"
    
    Returns:
        Number of surveys conducted in the specified period with details
    """
    from datetime import datetime, timedelta
    
    db = get_db()
    
    # Parse the period
    period_lower = period.lower().strip()
    today = datetime.now()
    
    # Determine date range
    if period_lower in ["today", "now"]:
        start_date = today.strftime("%Y-%m-%d")
        end_date = start_date
        period_label = "Today"
    elif period_lower in ["week", "this week"]:
        start = today - timedelta(days=today.weekday())
        start_date = start.strftime("%Y-%m-%d")
        end_date = today.strftime("%Y-%m-%d")
        period_label = "This Week"
    elif period_lower in ["month", "this month"]:
        start_date = today.strftime("%Y-%m-01")
        end_date = today.strftime("%Y-%m-%d")
        period_label = f"This Month ({today.strftime('%B %Y')})"
    elif period_lower in ["year", "this year"]:
        start_date = today.strftime("%Y-01-01")
        end_date = today.strftime("%Y-%m-%d")
        period_label = f"This Year ({today.year})"
    elif period_lower in ["last month"]:
        first_of_month = today.replace(day=1)
        last_month_end = first_of_month - timedelta(days=1)
        start_date = last_month_end.strftime("%Y-%m-01")
        end_date = last_month_end.strftime("%Y-%m-%d")
        period_label = f"Last Month ({last_month_end.strftime('%B %Y')})"
    elif period_lower in ["yesterday"]:
        yesterday = today - timedelta(days=1)
        start_date = yesterday.strftime("%Y-%m-%d")
        end_date = start_date
        period_label = f"Yesterday ({start_date})"
    else:
        # Try to parse as a specific date
        try:
            for fmt in ["%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%Y/%m/%d"]:
                try:
                    parsed = datetime.strptime(period, fmt)
                    start_date = parsed.strftime("%Y-%m-%d")
                    end_date = start_date
                    period_label = f"On {start_date}"
                    break
                except ValueError:
                    continue
            else:
                return f"Could not parse date: {period}. Try 'today', 'week', 'month', 'year', or 'YYYY-MM-DD'."
        except Exception:
            return f"Invalid period: {period}. Use 'today', 'week', 'month', 'year', or a specific date."
    
    # Query surveys in date range
    query = {"survey_date": {"$gte": start_date, "$lte": end_date}}
    
    surveys = list(db.surveys.find(query).sort("survey_date", -1))
    count = len(surveys)
    
    if count == 0:
        return f"No surveys conducted {period_label.lower()}."
    
    lines = [f"Surveys {period_label}\n"]
    lines.append(f"Total: {count} survey(s)\n")
    
    # Group by surveyor
    surveyors = {}
    for s in surveys:
        surveyor = s.get("surveyor_name", "Unknown")
        surveyors[surveyor] = surveyors.get(surveyor, 0) + 1
    
    if surveyors:
        lines.append("By Surveyor:")
        for surveyor, c in sorted(surveyors.items(), key=lambda x: -x[1]):
            lines.append(f"- {surveyor}: {c}")
    
    # List survey details (up to 10)
    if count <= 10:
        lines.append("\nSurvey Details:")
        for s in surveys:
            route = s.get("route_id", "?")
            date = s.get("survey_date", "Unknown")
            surveyor = s.get("surveyor_name", "Unknown")
            lines.append(f"- Route {route} on {date} by {surveyor}")
    
    return "\n".join(lines)


# =============================================================================
# ROAD TOOLS
# =============================================================================


@tool
def get_road_info(route_id: int) -> str:
    """
    Get road information for a specific route.
    Use this when user asks about road name, distance, road type, or route details.
    
    Args:
        route_id: The route number (integer)
    
    Returns:
        Road name, type, distance, start/end points
    """
    db = get_db()
    
    road = db.roads.find_one({"route_id": route_id})
    
    if not road:
        return f"No road information found for route {route_id}"
    
    lines = [f"Road Information - Route {route_id}\n"]
    lines.append(f"- Road Name: {road.get('road_name', 'Unknown')}")
    lines.append(f"- Road Type: {road.get('road_type', 'Unknown')}")
    lines.append(f"- Distance: {road.get('estimated_distance_km', 'Unknown')} km")
    lines.append(f"- Road Side: {road.get('road_side', 'Unknown')}")
    lines.append(f"- Start: {road.get('start_point_name', 'Unknown')}")
    lines.append(f"- End: {road.get('end_point_name', 'Unknown')}")
    
    return "\n".join(lines)


@tool
def search_road_by_name(road_name: str) -> str:
    """
    Search for a road by name and get its route ID.
    Use this when user mentions a road name and wants to find the route.
    
    Args:
        road_name: Name of the road to search for
    
    Returns:
        Matching road(s) with route ID and details
    """
    db = get_db()
    
    # Case-insensitive search
    roads = list(db.roads.find({
        "$or": [
            {"road_name": {"$regex": road_name, "$options": "i"}},
            {"start_point_name": {"$regex": road_name, "$options": "i"}},
            {"end_point_name": {"$regex": road_name, "$options": "i"}}
        ]
    }).limit(10))
    
    if not roads:
        return f"No roads found matching '{road_name}'"
    
    lines = [f"Roads matching '{road_name}':\n"]
    for r in roads:
        lines.append(f"- Route {r.get('route_id')}: {r.get('road_name', 'Unknown')} ({r.get('road_type', 'Unknown')})")
    
    return "\n".join(lines)


# =============================================================================
# VIDEO TOOLS
# =============================================================================


@tool
def get_video_summary(video_id: str = "") -> str:
    """
    Get overall summary of video analysis including metadata and detection stats.
    Use this when user asks for video summary, video details, or overall analysis.
    If no video_id provided, uses the most recently uploaded video.
    
    Args:
        video_id: The video identifier (optional - defaults to most recent video)
    
    Returns:
        Comprehensive video summary with metadata and statistics
    """
    video_id, context_msg = _resolve_video_id(video_id)
    if not video_id:
        return context_msg or "No video available to query."
    
    if DemoDataLoader.is_demo_video(video_id):
        loader = get_demo_loader()
        video_info = loader.videos.get(video_id, {})
        summary = loader.get_summary_for_video(video_id)
        
        lines = [f"Video Summary: {video_id}\n"]
        lines.append(f"Duration: {video_info.get('duration', 'Unknown')} seconds")
        lines.append(f"Total Assets: {summary.get('total_assets', 0):,}\n")
        
        by_category = summary.get("by_category", {})
        if by_category:
            lines.append("Categories:")
            for cat, count in sorted(by_category.items(), key=lambda x: -x[1]):
                lines.append(f"- {cat}: {count:,}")
        
        by_condition = summary.get("by_condition", {})
        if by_condition:
            lines.append("\nCondition Breakdown:")
            for cond, count in by_condition.items():
                lines.append(f"- {cond.title()}: {count:,}")
        
        return "\n".join(lines)
    else:
        db = get_db()
        result = db.video_processing_results.find_one({"video_id": video_id})
        
        if not result:
            return f"No processing results found for video {video_id}"
        
        metadata = result.get("metadata", {})
        
        lines = [f"Video Summary: {video_id}\n"]
        lines.append(f"Status: {result.get('status', 'Unknown')}")
        lines.append(f"Road: {result.get('road_name', 'Unknown')}")
        lines.append(f"Duration: {metadata.get('duration_seconds', 'Unknown')} seconds")
        lines.append(f"Total Defects: {result.get('total_defects', 0):,}\n")
        
        severity = result.get("severity_distribution", {})
        if severity:
            lines.append("Severity Distribution:")
            for sev, count in severity.items():
                lines.append(f"- {sev.title()}: {count}")
        
        type_dist = result.get("type_distribution", {})
        if type_dist:
            lines.append("\nTop Defect Types:")
            for t, c in sorted(type_dist.items(), key=lambda x: -x[1])[:10]:
                lines.append(f"- {t}: {c}")
        
        return "\n".join(lines)


@tool
def get_video_status(video_id: str) -> str:
    """
    Get processing status and progress for a video.
    Use this when user asks about video processing status or progress.
    
    Args:
        video_id: The video identifier (ObjectId string)
    
    Returns:
        Processing status, progress percentage, and ETA
    """
    db = get_db()
    
    # Try video_processing_results first
    result = db.video_processing_results.find_one({"video_id": video_id})
    if result:
        return f"Video {video_id}: Status = {result.get('status', 'Unknown')}, Total Defects = {result.get('total_defects', 0)}"
    
    # Try videos collection
    try:
        video = db.videos.find_one({"_id": ObjectId(video_id)})
    except:
        video = db.videos.find_one({"title": {"$regex": video_id, "$options": "i"}})
    
    if not video:
        return f"No video found with ID {video_id}"
    
    lines = [f"Video Status: {video.get('title', video_id)}\n"]
    lines.append(f"- Status: {video.get('status', 'Unknown')}")
    lines.append(f"- Progress: {video.get('progress', 0)}%")
    if video.get('eta'):
        lines.append(f"- ETA: {video.get('eta')}")
    
    return "\n".join(lines)


@tool
def get_current_video() -> str:
    """
    Get the current/most recent video being used for queries.
    Use this when user asks what video is being analyzed or which video is active.
    
    Returns:
        Information about the current video being used
    """
    recent = get_most_recent_video()
    
    if not recent:
        return "No videos found in the database."
    
    is_demo = "Yes (Demo)" if recent["is_demo"] else "No"
    
    lines = [f"Current Video\n"]
    lines.append(f"- Title: {recent['title']}")
    lines.append(f"- Video ID: {recent['video_id']}")
    lines.append(f"- Demo Video: {is_demo}")
    if recent.get("route_id"):
        lines.append(f"- Route: {recent['route_id']}")
    
    return "\n".join(lines)


# =============================================================================
# EXPORT ALL TOOLS
# =============================================================================

ALL_TOOLS = [
    # Asset tools
    get_asset_categories,
    get_asset_list,
    get_asset_by_type,
    get_asset_count,
    get_damaged_assets,
    rank_assets_by_defects,
    get_category_condition_summary,
    get_road_condition,
    # Survey tools
    get_survey_status,
    get_survey_assets,
    get_survey_list,
    get_survey_dates,
    get_surveyor_stats,
    get_survey_summary,
    get_surveys_by_period,
    # Road tools
    get_road_info,
    search_road_by_name,
    # Video tools
    get_video_summary,
    get_video_status,
    get_current_video,
]
