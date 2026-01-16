#!/usr/bin/env python3
"""
Helper script to add annotated video URL to a video in the database.

Usage:
    python add_annotated_video.py <video_title> <annotated_video_filename>

Example:
    python add_annotated_video.py "my_video.mp4" "annotated_my_video.mp4"
"""

import sys
from pymongo import MongoClient
from config import Config

def add_annotated_video(video_title: str, annotated_filename: str):
    config = Config()
    client = MongoClient(config.MONGO_URI)
    db = client[config.MONGO_DB_NAME]

    # Find video by title
    video = db.videos.find_one({"title": video_title})

    if not video:
        print(f"❌ Video '{video_title}' not found!")
        print("\nAvailable videos:")
        for v in db.videos.find({}, {"title": 1, "_id": 1}):
            print(f"  - {v.get('title', 'Untitled')} (ID: {v['_id']})")
        return

    # Update with annotated video URL
    annotated_url = f"/uploads/{annotated_filename}"

    result = db.videos.update_one(
        {"_id": video["_id"]},
        {"$set": {"annotated_video_url": annotated_url}}
    )

    if result.modified_count > 0:
        print(f"✅ Successfully added annotated video URL to '{video_title}'")
        print(f"   Original: {video.get('storage_url', 'N/A')}")
        print(f"   Annotated: {annotated_url}")
    else:
        print(f"⚠️ Video already had this annotated URL or no changes made")

    client.close()

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python add_annotated_video.py <video_title> <annotated_video_filename>")
        print("\nExample: python add_annotated_video.py 'my_video.mp4' 'annotated_my_video.mp4'")
        sys.exit(1)

    video_title = sys.argv[1]
    annotated_filename = sys.argv[2]

    add_annotated_video(video_title, annotated_filename)
