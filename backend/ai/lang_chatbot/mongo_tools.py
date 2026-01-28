"""
MongoDB Tools for Langchain Chatbot
Frame and video-specific queries from MongoDB
"""

import os
from typing import Optional, List, Dict
from langchain.tools import tool
from pymongo import MongoClient
from bson.objectid import ObjectId
from pymongo.database import Database
from pymongo.collection import Collection
from dotenv import load_dotenv

from ai.lang_chatbot.demo_data import get_demo_loader, DemoDataLoader

load_dotenv()

MONGO_URI = os.environ.get("MONGO_URI", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "roadrunner")

_client: Optional[MongoClient] = None


def get_collection(collection_name: str) -> Collection:
    """Get MongoDB collection"""
    global _client
    if _client is None:
        _client = MongoClient(
            MONGO_URI,
            uuidRepresentation="standard",
            maxPoolSize=50,
            minPoolSize=10,
            maxIdleTimeMS=45000,
            serverSelectionTimeoutMS=5000,
            connectTimeoutMS=10000,
            socketTimeoutMS=45000,
            retryWrites=True,
            w="majority",
        )
    db: Database = _client[DB_NAME]
    return db[collection_name]


def _normalize_video_id(video_id: str) -> str:
    """Remove .mp4 extension from video ID"""
    if not video_id:
        return ""
    return video_id.replace(".mp4", "").replace(".MP4", "")


def _get_most_recent_video() -> dict:
    """Get the most recently uploaded video from the database."""
    db: Database = get_collection("videos").database
    
    video = db.videos.find_one({}, sort=[("created_at", -1)])
    if not video:
        video = db.videos.find_one({}, sort=[("_id", -1)])
    
    if not video:
        return None
    
    storage_url = video.get("storage_url", "")
    title = video.get("title", "")
    
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
    }


def _resolve_video_id(video_id: str = None) -> tuple:
    """Resolve video_id - if not provided, get most recent video."""
    if video_id and video_id.strip():
        return _normalize_video_id(video_id), None
    
    recent = _get_most_recent_video()
    if not recent:
        return None, "No videos found in the database."
    
    return recent["video_id"], f"(Using most recent video: {recent['title']})"


def _format_detections(detections) -> List[str]:
    """Format detections from frame into readable list"""
    result = []
    
    if isinstance(detections, list):
        # Legacy array format
        for det in detections:
            class_name = det.get("class_name", "Unknown")
            result.append(_humanize_class_name(class_name))
    elif isinstance(detections, dict):
        # New nested format
        for endpoint_name, endpoint_dets in detections.items():
            if isinstance(endpoint_dets, list):
                for det in endpoint_dets:
                    class_name = det.get("class_name", "Unknown")
                    result.append(_humanize_class_name(class_name))
    
    return result


def _humanize_class_name(class_name: str) -> str:
    """Convert STREET_LIGHT_AssetCondition_Good -> Street Light (Good)"""
    import re
    match = re.match(r"^(.+?)_?AssetCondition_?(.+)$", class_name, re.IGNORECASE)
    if match:
        asset_part = match.group(1).replace("_", " ").title()
        condition = match.group(2).replace("_", " ").title()
        return f"{asset_part} ({condition})"
    return class_name.replace("_", " ").title()


def _format_timestamp(seconds: float) -> str:
    """Format seconds as MM:SS"""
    mins = int(seconds // 60)
    secs = int(seconds % 60)
    return f"{mins}:{secs:02d}"


@tool
def get_frame(video_id: str = "", frame_number: int = 0) -> str:
    """
    Get information about a specific frame by frame number.
    Use this when user asks about a specific frame, like "what's in frame 45".
    If no video_id provided, uses the most recently uploaded video.
    
    Args:
        video_id: The video identifier (optional - defaults to most recent video)
        frame_number: The frame number to retrieve
    
    Returns:
        Frame information including detections and timestamp
    """
    if not frame_number:
        return "Please specify a frame number."
    
    video_id_normalized, context_msg = _resolve_video_id(video_id)
    if not video_id_normalized:
        return context_msg or "No video available to query."
    
    frames_collection = get_collection("frames")
    video_collection = get_collection("videos")
    
    print(f"[get_frame] Fetching frame {frame_number} for video {video_id_normalized}")
    
    frame = None
    
    # Check if demo video
    if DemoDataLoader.is_demo_video(video_id_normalized):
        frame = frames_collection.find_one(
            {"key": video_id_normalized, "frame_number": frame_number}
        )
    else:
        # Try with ObjectId first
        try:
            video = video_collection.find_one({"_id": ObjectId(video_id)})
            if video:
                basename = os.path.splitext(os.path.basename(video.get("storage_url", "")))[0]
                frame = frames_collection.find_one(
                    {"key": basename, "frame_number": frame_number}
                )
        except:
            # Fall back to video_id field
            frame = frames_collection.find_one(
                {"video_id": video_id, "frame_number": frame_number}
            )
    
    if not frame:
        return f"Frame {frame_number} not found in video {video_id}"
    
    # Build response
    lines = [f"Frame {frame_number}\n"]
    
    timestamp = frame.get("timestamp", 0)
    lines.append(f"Timestamp: {_format_timestamp(timestamp)}")
    
    detections = _format_detections(frame.get("detections", []))
    if detections:
        # Count unique detections
        from collections import Counter
        det_counts = Counter(detections)
        lines.append(f"\nDetections ({len(detections)} total):")
        for det_type, count in det_counts.most_common(10):
            lines.append(f"- {det_type}: {count}")
    else:
        lines.append("\nNo detections in this frame")
    
    location = frame.get("location", {})
    coords = location.get("coordinates", [])
    if coords and len(coords) >= 2:
        lines.append(f"\nLocation: {coords[1]:.6f}, {coords[0]:.6f}")
    
    return "\n".join(lines)


@tool
def get_frame_at_timestamp(video_id: str = "", timestamp_str: str = "") -> str:
    """
    Get frame information at a specific timestamp.
    Use this when user asks about what's visible at a time, like "what's at 1:30".
    If no video_id provided, uses the most recently uploaded video.
    
    Args:
        video_id: The video identifier (optional - defaults to most recent video)
        timestamp_str: Time in format "MM:SS" or seconds (e.g., "1:30" or "90")
    
    Returns:
        Frame information at or near the specified timestamp
    """
    if not timestamp_str:
        return "Please specify a timestamp (e.g., '1:30' or '90')."
    
    video_id_normalized, context_msg = _resolve_video_id(video_id)
    if not video_id_normalized:
        return context_msg or "No video available to query."
    
    # Parse timestamp
    timestamp_seconds = 0
    if ":" in timestamp_str:
        parts = timestamp_str.split(":")
        try:
            timestamp_seconds = int(parts[0]) * 60 + int(parts[1])
        except:
            return f"Could not parse timestamp: {timestamp_str}. Use format MM:SS or seconds."
    else:
        try:
            timestamp_seconds = float(timestamp_str.replace("s", "").replace("sec", "").strip())
        except:
            return f"Could not parse timestamp: {timestamp_str}"
    
    frames_collection = get_collection("frames")
    
    # Query frames near timestamp
    if DemoDataLoader.is_demo_video(video_id_normalized):
        query = {
            "key": video_id_normalized,
            "timestamp": {
                "$gte": timestamp_seconds - 1.0,
                "$lte": timestamp_seconds + 1.0
            }
        }
    else:
        query = {
            "video_id": video_id,
            "timestamp": {
                "$gte": timestamp_seconds - 1.0,
                "$lte": timestamp_seconds + 1.0
            }
        }
    
    frames = list(frames_collection.find(query).sort("timestamp", 1).limit(5))
    
    if not frames:
        return f"No frames found at timestamp {_format_timestamp(timestamp_seconds)}"
    
    lines = [f"Frames at {_format_timestamp(timestamp_seconds)}\n"]
    
    for frame in frames:
        frame_num = frame.get("frame_number", "?")
        frame_ts = frame.get("timestamp", 0)
        detections = _format_detections(frame.get("detections", []))
        
        if detections:
            unique_dets = list(set(detections[:10]))
            det_str = ", ".join(unique_dets)
            lines.append(f"Frame {frame_num} ({_format_timestamp(frame_ts)}): {det_str}")
        else:
            lines.append(f"Frame {frame_num} ({_format_timestamp(frame_ts)}): No detections")
        
        location = frame.get("location", {})
        coords = location.get("coordinates", [])
        if coords and len(coords) >= 2:
            lines.append(f"  Location: {coords[1]:.6f}, {coords[0]:.6f}")
    
    return "\n".join(lines)


@tool
def get_frame_count(video_id: str) -> str:
    """
    Get total frame count for a video.
    Use this when user asks how many frames are in a video.
    
    Args:
        video_id: The video identifier
    
    Returns:
        Total number of frames
    """
    video_id_normalized = _normalize_video_id(video_id)
    frames_collection = get_collection("frames")
    
    if DemoDataLoader.is_demo_video(video_id_normalized):
        count = frames_collection.count_documents({"key": video_id_normalized})
    else:
        count = frames_collection.count_documents({"video_id": video_id})
    
    return f"Video {video_id} contains {count:,} frames"


# Export frame tools
FRAME_TOOLS = [
    get_frame,
    get_frame_at_timestamp,
    get_frame_count,
]
