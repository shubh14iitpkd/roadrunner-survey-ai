#!/usr/bin/env python3
"""Check what video data exists in MongoDB"""

from pymongo import MongoClient
import os
from dotenv import load_dotenv

load_dotenv()

# Connect directly to MongoDB
MONGO_URI = os.getenv('MONGO_URI', 'mongodb://localhost:27017/')
DB_NAME = os.getenv('DB_NAME', 'roadrunner')

client = MongoClient(MONGO_URI)
db = client[DB_NAME]

# Check video_processing_results collection
print("=" * 60)
print("VIDEO PROCESSING RESULTS IN MONGODB")
print("=" * 60)

results = list(db.video_processing_results.find({}, {
    'video_id': 1, 
    'chat_id': 1, 
    'road_name': 1, 
    'total_defects': 1,
    'status': 1,
    'created_at': 1
}))

print(f"\nTotal videos in MongoDB: {len(results)}\n")

for idx, result in enumerate(results, 1):
    print(f"{idx}. Video ID: {result.get('video_id', 'unknown')}")
    print(f"   Chat ID: {result.get('chat_id', 'N/A')}")
    print(f"   Road: {result.get('road_name', 'Unknown')}")
    print(f"   Status: {result.get('status', 'unknown')}")
    print(f"   Defects Found: {result.get('total_defects', 0)}")
    print(f"   Created: {result.get('created_at', 'N/A')}")
    print()

# Check if defects array exists
print("=" * 60)
print("CHECKING DEFECTS DATA")
print("=" * 60)

for result in results[:3]:  # Check first 3 videos
    video_id = result.get('video_id', 'unknown')
    full_result = db.video_processing_results.find_one({'video_id': video_id})
    
    if full_result and 'defects' in full_result:
        defects = full_result['defects']
        print(f"\n{video_id}: {len(defects)} defects in MongoDB")
        if defects:
            print(f"  Sample defect: {defects[0].get('asset_type', 'N/A')} - {defects[0].get('condition', 'N/A')}")
    else:
        print(f"\n{video_id}: No defects array found")

print("\n" + "=" * 60)
