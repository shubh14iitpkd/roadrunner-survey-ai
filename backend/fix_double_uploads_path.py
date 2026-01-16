#!/usr/bin/env python3
"""
Fix videos in database that have double /uploads/ prefix in their paths.

This script fixes paths like:
  /uploads/uploads/annotated_videos/xxx.mp4
To:
  /uploads/annotated_videos/xxx.mp4
"""

from pymongo import MongoClient
from config import Config

def fix_paths():
    config = Config()
    client = MongoClient(config.MONGO_URI)
    db = client[config.MONGO_DB_NAME]

    print("=" * 80)
    print("FIXING DOUBLE /uploads/ PATHS")
    print("=" * 80)

    # Find all videos with double /uploads/ in their paths
    videos = list(db.videos.find({}))

    if not videos:
        print("❌ No videos found in database!")
        client.close()
        return

    fixed_count = 0

    for video in videos:
        video_id = video['_id']
        title = video.get('title', 'Untitled')
        updated = False
        update_fields = {}

        # Check and fix annotated_video_url
        annotated_url = video.get('annotated_video_url')
        if annotated_url and '/uploads/uploads/' in annotated_url:
            # Fix: /uploads/uploads/xxx -> /uploads/xxx
            fixed_url = annotated_url.replace('/uploads/uploads/', '/uploads/')
            update_fields['annotated_video_url'] = fixed_url
            print(f"\n📹 {title}")
            print(f"  ❌ Old: {annotated_url}")
            print(f"  ✅ New: {fixed_url}")
            updated = True

        # Check and fix frames_directory
        frames_dir = video.get('frames_directory')
        if frames_dir and '/uploads/uploads/' in frames_dir:
            fixed_dir = frames_dir.replace('/uploads/uploads/', '/uploads/')
            update_fields['frames_directory'] = fixed_dir
            print(f"  Frames dir: {frames_dir} -> {fixed_dir}")
            updated = True

        # Check and fix frame_metadata_url
        metadata_url = video.get('frame_metadata_url')
        if metadata_url and '/uploads/uploads/' in metadata_url:
            fixed_metadata = metadata_url.replace('/uploads/uploads/', '/uploads/')
            update_fields['frame_metadata_url'] = fixed_metadata
            print(f"  Metadata: {metadata_url} -> {fixed_metadata}")
            updated = True

        # Update if any fixes were needed
        if updated:
            db.videos.update_one(
                {"_id": video_id},
                {"$set": update_fields}
            )
            fixed_count += 1

    print("\n" + "=" * 80)
    if fixed_count > 0:
        print(f"✅ Fixed {fixed_count} video(s) with double /uploads/ paths")
    else:
        print("✅ No videos needed fixing - all paths are correct!")
    print("=" * 80)

    client.close()

if __name__ == "__main__":
    fix_paths()
