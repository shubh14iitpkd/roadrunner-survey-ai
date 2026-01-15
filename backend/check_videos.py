#!/usr/bin/env python3
"""
Check videos in database and their annotated video URLs.
"""

from pymongo import MongoClient
from config import Config
import os

def check_videos():
    config = Config()
    client = MongoClient(config.MONGO_URI)
    db = client[config.MONGO_DB_NAME]

    upload_dir = os.getenv("UPLOAD_DIR") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "uploads")

    print("=" * 80)
    print("VIDEO DATABASE CHECK")
    print("=" * 80)
    print(f"Upload Directory: {upload_dir}")
    print(f"Upload Directory Exists: {os.path.exists(upload_dir)}")
    print()

    videos = list(db.videos.find({}))

    if not videos:
        print("❌ No videos found in database!")
        client.close()
        return

    print(f"Found {len(videos)} video(s) in database:\n")

    for i, video in enumerate(videos, 1):
        print(f"{'=' * 80}")
        print(f"Video #{i}: {video.get('title', 'Untitled')}")
        print(f"{'=' * 80}")
        print(f"ID: {video['_id']}")
        print(f"Status: {video.get('status', 'N/A')}")
        print(f"Route ID: {video.get('route_id', 'N/A')}")
        print()

        # Original video
        storage_url = video.get('storage_url', '')
        print(f"Original Video URL: {storage_url}")
        if storage_url:
            # Remove leading /uploads/ if present
            file_path = storage_url.replace('/uploads/', '')
            full_path = os.path.join(upload_dir, file_path)
            exists = os.path.exists(full_path)
            print(f"  → Full Path: {full_path}")
            print(f"  → File Exists: {'✅ YES' if exists else '❌ NO'}")
            if exists:
                size_mb = os.path.getsize(full_path) / (1024 * 1024)
                print(f"  → File Size: {size_mb:.2f} MB")
        print()

        # Annotated video
        annotated_url = video.get('annotated_video_url', '')
        print(f"Annotated Video URL: {annotated_url}")
        if annotated_url:
            # Remove leading /uploads/ if present
            file_path = annotated_url.replace('/uploads/', '')
            full_path = os.path.join(upload_dir, file_path)
            exists = os.path.exists(full_path)
            print(f"  → Full Path: {full_path}")
            print(f"  → File Exists: {'✅ YES' if exists else '❌ NO'}")
            if exists:
                size_mb = os.path.getsize(full_path) / (1024 * 1024)
                print(f"  → File Size: {size_mb:.2f} MB")
        else:
            print(f"  → ⚠️ No annotated video URL set in database")
        print()

        # Processing info
        if video.get('total_detections'):
            print(f"Total Detections: {video.get('total_detections')}")
        if video.get('processed_frames'):
            print(f"Processed Frames: {video.get('processed_frames')}")
        if video.get('detections_summary'):
            print(f"Detections Summary: {video.get('detections_summary')}")

        print()

    # Check annotated_videos directory
    annotated_dir = os.path.join(upload_dir, 'annotated_videos')
    print(f"{'=' * 80}")
    print(f"ANNOTATED VIDEOS DIRECTORY CHECK")
    print(f"{'=' * 80}")
    print(f"Directory: {annotated_dir}")
    print(f"Exists: {os.path.exists(annotated_dir)}")

    if os.path.exists(annotated_dir):
        files = os.listdir(annotated_dir)
        print(f"Files found: {len(files)}")
        for f in files:
            file_path = os.path.join(annotated_dir, f)
            size_mb = os.path.getsize(file_path) / (1024 * 1024)
            print(f"  - {f} ({size_mb:.2f} MB)")
    else:
        print("⚠️ Directory does not exist - no annotated videos generated yet")

    client.close()

if __name__ == "__main__":
    check_videos()
