#!/usr/bin/env python3
"""
Utility script to populate 'key' field for demo video frames in MongoDB.

This script:
1. Connects to the MongoDB database
2. Looks for frames without a 'key' field
3. Allows you to set the 'key' based on a pattern (e.g., video filename)

Usage:
    python populate_demo_keys.py --key "my_demo_video" --video-id "abc123"
    python populate_demo_keys.py --key "my_demo_video" --route-id 1
    python populate_demo_keys.py --list  # List all unique video_ids in frames collection
"""

import os
import sys
import argparse
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv()


def get_db():
    """Get MongoDB database connection."""
    mongo_uri = os.getenv("MONGO_URI", "mongodb://localhost:27017")
    db_name = os.getenv("MONGO_DB_NAME", "roadrunner")
    
    client = MongoClient(mongo_uri)
    return client[db_name]


def list_frame_sources(db):
    """List all unique video_ids and route_ids in frames collection."""
    print("\n=== Frames Collection Summary ===\n")
    
    # Get unique video_ids
    video_ids = db.frames.distinct("video_id")
    print(f"Unique video_ids ({len(video_ids)}):")
    for vid in video_ids[:20]:  # Limit to first 20
        count = db.frames.count_documents({"video_id": vid})
        print(f"  - {vid}: {count} frames")
    if len(video_ids) > 20:
        print(f"  ... and {len(video_ids) - 20} more")
    
    # Get unique keys
    keys = db.frames.distinct("key")
    print(f"\nUnique keys ({len(keys)}):")
    for key in keys[:20]:
        if key:
            count = db.frames.count_documents({"key": key})
            print(f"  - {key}: {count} frames")
    
    # Get unique route_ids
    route_ids = db.frames.distinct("route_id")
    print(f"\nUnique route_ids ({len(route_ids)}):")
    for rid in route_ids[:20]:
        if rid is not None:
            count = db.frames.count_documents({"route_id": rid})
            print(f"  - {rid}: {count} frames")
    
    print(f"\nTotal frames: {db.frames.count_documents({})}")


def set_key_for_video(db, video_id: str, key: str, dry_run: bool = False):
    """Set key for all frames with given video_id."""
    query = {"video_id": video_id}
    count = db.frames.count_documents(query)
    
    if count == 0:
        print(f"No frames found with video_id: {video_id}")
        return 0
    
    print(f"Found {count} frames with video_id: {video_id}")
    
    if dry_run:
        print(f"[DRY RUN] Would set key='{key}' for {count} frames")
        return count
    
    result = db.frames.update_many(query, {"$set": {"key": key}})
    print(f"Updated {result.modified_count} frames with key='{key}'")
    return result.modified_count


def set_key_for_route(db, route_id: int, key: str, dry_run: bool = False):
    """Set key for all frames with given route_id."""
    query = {"route_id": route_id}
    count = db.frames.count_documents(query)
    
    if count == 0:
        print(f"No frames found with route_id: {route_id}")
        return 0
    
    print(f"Found {count} frames with route_id: {route_id}")
    
    if dry_run:
        print(f"[DRY RUN] Would set key='{key}' for {count} frames")
        return count
    
    result = db.frames.update_many(query, {"$set": {"key": key}})
    print(f"Updated {result.modified_count} frames with key='{key}'")
    return result.modified_count


def bulk_import_demo_frames(db, key: str, frames_data: list, dry_run: bool = False):
    """
    Bulk import demo frames with a specific key.
    
    frames_data should be a list of dicts with at least:
    - frame_number: int
    - detections: list of detection objects
    """
    if dry_run:
        print(f"[DRY RUN] Would insert {len(frames_data)} frames with key='{key}'")
        return len(frames_data)
    
    # Add key to each frame
    for frame in frames_data:
        frame["key"] = key
    
    result = db.frames.insert_many(frames_data)
    print(f"Inserted {len(result.inserted_ids)} frames with key='{key}'")
    return len(result.inserted_ids)


def main():
    parser = argparse.ArgumentParser(description="Populate 'key' field for demo video frames")
    parser.add_argument("--list", action="store_true", help="List all frame sources")
    parser.add_argument("--key", type=str, help="Key value to set (should match video filename without extension)")
    parser.add_argument("--video-id", type=str, help="Video ID to update")
    parser.add_argument("--route-id", type=int, help="Route ID to update")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be done without making changes")
    
    args = parser.parse_args()
    
    db = get_db()
    
    if args.list:
        list_frame_sources(db)
        return
    
    if not args.key:
        print("Error: --key is required when updating frames")
        parser.print_help()
        return
    
    if args.video_id:
        set_key_for_video(db, args.video_id, args.key, args.dry_run)
    elif args.route_id is not None:
        set_key_for_route(db, args.route_id, args.key, args.dry_run)
    else:
        print("Error: Either --video-id or --route-id is required")
        parser.print_help()


if __name__ == "__main__":
    main()
