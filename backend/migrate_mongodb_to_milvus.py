#!/usr/bin/env python3
"""
Migrate existing MongoDB video defects to Milvus
Run this to index all previously uploaded videos
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

# Initialize Milvus
vector_db = DefectVectorDB('road_defects')

print("=" * 60)
print("MIGRATING MONGODB DEFECTS TO MILVUS")
print("=" * 60)

# Get all videos with defects
videos = list(db.video_processing_results.find({'defects': {'$exists': True}}))

print(f"\nFound {len(videos)} videos with defects in MongoDB\n")

total_indexed = 0

for idx, video in enumerate(videos, 1):
    video_id = video.get('video_id', f'unknown_{idx}')
    chat_id = video.get('chat_id', '')
    defects_data = video.get('defects', [])
    
    if not defects_data:
        print(f"⚠️  {idx}. {video_id}: No defects array (skipping)")
        continue
    
    print(f"📹 {idx}. {video_id} ({len(defects_data)} defects)")
    
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
    
    # Index to Milvus
    success = vector_db.index_defects(video_id, defects)
    
    if success:
        print(f"  ✅ Indexed {len(defects)} defects to Milvus")
        total_indexed += len(defects)
    else:
        print(f"  ❌ Failed to index defects")
    
    print()

print("=" * 60)
print(f"✅ MIGRATION COMPLETE")
print(f"   Total defects indexed: {total_indexed}")
print("=" * 60)
