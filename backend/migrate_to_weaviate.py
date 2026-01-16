#!/usr/bin/env python3
"""
Migrate video defects from MongoDB to Weaviate
Replaces Milvus with Weaviate for vector storage
"""

import os
from pymongo import MongoClient
from dotenv import load_dotenv
from ai.video import DefectVectorDB, Defect

load_dotenv()

# Connect to MongoDB
MONGO_URI = os.getenv('MONGO_URI', 'mongodb://localhost:27017/')
DB_NAME = os.getenv('DB_NAME', 'roadrunner')

client = MongoClient(MONGO_URI)
db = client[DB_NAME]

# Initialize Weaviate
vector_db = DefectVectorDB('RoadDefects')

print("=" * 60)
print("MIGRATING MONGODB DEFECTS TO WEAVIATE")
print("=" * 60)

# Get all videos with defects
videos = list(db.video_processing_results.find({'defects': {'$exists': True}}))

print(f"\nFound {len(videos)} videos with defects in MongoDB\n")

total_indexed = 0
failed_videos = []

for idx, video in enumerate(videos, 1):
    video_id = video.get('video_id', f'unknown_{idx}')
    chat_id = video.get('chat_id', '')
    defects_data = video.get('defects', [])
    
    if not defects_data:
        print(f"⚠️  {idx}. {video_id}: No defects array (skipping)")
        continue
    
    print(f"📹 {idx}. {video_id} ({len(defects_data)} defects)")
    print(f"   Chat ID: {chat_id or 'N/A'}")
    
    # Convert MongoDB defect dicts to Defect objects
    defects = []
    for defect_dict in defects_data:
        try:
            defect = Defect(
                timestamp=defect_dict.get('timestamp', '00:00'),
                timestamp_seconds=defect_dict.get('timestamp_seconds', 0.0),
                category=defect_dict.get('category', 'Unknown'),
                asset_type=defect_dict.get('asset_type', 'Unknown'),
                condition=defect_dict.get('condition', 'Unknown'),
                # severity is computed from condition via @property
                confidence=defect_dict.get('confidence', 0.5),
                position=defect_dict.get('position', 'center'),
                estimated_size=defect_dict.get('estimated_size', 'N/A'),
                description=defect_dict.get('description', ''),
                source=defect_dict.get('source', 'unknown'),
                segment_id=defect_dict.get('segment_id', 'seg_000'),
                bbox=defect_dict.get('bbox'),
                gps_coords=defect_dict.get('gps_coords'),
                chat_id=chat_id
            )
            defects.append(defect)
        except Exception as e:
            print(f"  ⚠️  Failed to parse defect: {e}")
            continue
    
    if not defects:
        print(f"  ⚠️  No valid defects to index (skipping)")
        continue
    
    # Index to Weaviate
    success = vector_db.index_defects(video_id, defects)
    
    if success:
        print(f"  ✅ Indexed {len(defects)} defects to Weaviate")
        total_indexed += len(defects)
    else:
        print(f"  ❌ Failed to index defects")
        failed_videos.append(video_id)
    
    print()

print("=" * 60)
print(f"✅ MIGRATION COMPLETE")
print(f"   Total defects indexed: {total_indexed}")
print(f"   Videos processed: {len(videos) - len(failed_videos)}/{len(videos)}")
if failed_videos:
    print(f"   Failed videos: {', '.join(failed_videos)}")
print("=" * 60)
print("\n📝 Next steps:")
print("   1. Test video queries in the chatbot")
print("   2. Upload a new video to verify end-to-end flow")
print("   3. Remove Milvus database files if migration successful:")
print("      rm -rf milvus_demo.db milvus_lite.db")
print("=" * 60)
