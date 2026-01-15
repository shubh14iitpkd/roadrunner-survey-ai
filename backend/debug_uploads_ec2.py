"""
Debug script for EC2 upload issues
Run this on EC2 to diagnose why annotated videos return 404 errors
"""
import os
import sys
from pathlib import Path
from pymongo import MongoClient
from dotenv import load_dotenv

# Load environment
load_dotenv()

print("=" * 80)
print("EC2 UPLOAD DIRECTORY DEBUG")
print("=" * 80)
print()

# 1. Check environment variables
print("1. ENVIRONMENT VARIABLES:")
print("-" * 80)
upload_dir = os.getenv("UPLOAD_DIR")
mongo_uri = os.getenv("MONGO_URI", "mongodb://localhost:27017")
mongo_db = os.getenv("MONGO_DB_NAME", "roadrunner")

print(f"UPLOAD_DIR from env: {upload_dir}")
print(f"MONGO_URI: {mongo_uri}")
print(f"MONGO_DB_NAME: {mongo_db}")
print()

# 2. Check actual upload directory
print("2. UPLOAD DIRECTORY STATUS:")
print("-" * 80)
if upload_dir:
    upload_path = Path(upload_dir)
    print(f"Path: {upload_path}")
    print(f"Exists: {upload_path.exists()}")
    print(f"Is directory: {upload_path.is_dir() if upload_path.exists() else 'N/A'}")

    if upload_path.exists() and upload_path.is_dir():
        print(f"\nSubdirectories:")
        for subdir in ['original_videos', 'annotated_videos', 'frames', 'metadata', 'gpx']:
            subdir_path = upload_path / subdir
            exists = subdir_path.exists()
            count = len(list(subdir_path.iterdir())) if exists and subdir_path.is_dir() else 0
            print(f"  - {subdir}: {'EXISTS' if exists else 'MISSING'} ({count} files)")
else:
    print("ERROR: UPLOAD_DIR not set in environment!")
print()

# 3. Check MongoDB videos
print("3. MONGODB VIDEO RECORDS:")
print("-" * 80)
try:
    client = MongoClient(mongo_uri)
    db = client[mongo_db]

    videos = list(db.videos.find({
        "status": "completed",
        "annotated_video_url": {"$exists": True, "$ne": None}
    }).limit(5))

    print(f"Found {len(videos)} completed videos with annotated URLs:\n")

    for v in videos:
        video_id = str(v['_id'])
        annotated_url = v.get('annotated_video_url', '')
        storage_url = v.get('storage_url', '')

        print(f"Video ID: {video_id}")
        print(f"  Title: {v.get('title', 'N/A')}")
        print(f"  Status: {v.get('status', 'N/A')}")
        print(f"  Storage URL: {storage_url}")
        print(f"  Annotated URL: {annotated_url}")

        # Check if files actually exist
        if upload_dir:
            # Original video
            orig_filename = storage_url.lstrip('/').replace('uploads/', '')
            orig_path = Path(upload_dir) / orig_filename
            print(f"  Original file: {orig_path}")
            print(f"    Exists: {orig_path.exists()}")

            # Annotated video
            anno_filename = annotated_url.lstrip('/').replace('uploads/', '')
            anno_path = Path(upload_dir) / anno_filename
            print(f"  Annotated file: {anno_path}")
            print(f"    Exists: {anno_path.exists()}")

            if anno_path.exists():
                size_mb = anno_path.stat().st_size / (1024 * 1024)
                print(f"    Size: {size_mb:.2f} MB")

        print()

    client.close()

except Exception as e:
    print(f"ERROR connecting to MongoDB: {e}")
    import traceback
    traceback.print_exc()

print()

# 4. Check backend process
print("4. BACKEND PROCESS CHECK:")
print("-" * 80)
print("Run this command to see where backend is running from:")
print("  ps aux | grep python | grep -E 'app.py|run2.py'")
print()
print("Check which .env file is being loaded:")
print("  cat /proc/<PID>/environ | tr '\\0' '\\n' | grep UPLOAD_DIR")
print()

# 5. Recommendations
print("5. RECOMMENDATIONS:")
print("-" * 80)
print("If annotated videos don't exist:")
print("  - Video processing may have failed")
print("  - Check backend logs for processing errors")
print("  - Try re-processing the video using 'Process with AI' button")
print()
print("If UPLOAD_DIR is wrong:")
print("  - Update .env file with correct path")
print("  - Restart backend: sudo systemctl restart roadrunner")
print("  - Or kill Python process and restart manually")
print()
print("If files exist but still 404:")
print("  - Check nginx configuration")
print("  - Verify /uploads/ route in Flask app")
print("  - Check file permissions: ls -la <upload_dir>/annotated_videos/")
print()
print("=" * 80)
