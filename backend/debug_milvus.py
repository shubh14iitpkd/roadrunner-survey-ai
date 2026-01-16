#!/usr/bin/env python3
"""Debug script to inspect Milvus collection"""

from pymilvus import MilvusClient
import os
from dotenv import load_dotenv

load_dotenv()

# Milvus configuration
MILVUS_DB_PATH = "./milvus_demo.db"
COLLECTION_NAME = "road_defects"

client = MilvusClient(uri=MILVUS_DB_PATH)

print("=" * 80)
print("MILVUS DEBUG REPORT")
print("=" * 80)

# List all collections
collections = client.list_collections()
print(f"\n📦 Collections: {collections}")

if COLLECTION_NAME in collections:
    print(f"\n✓ Collection '{COLLECTION_NAME}' exists")
    
    # Get collection stats
    try:
        stats = client.get_collection_stats(collection_name=COLLECTION_NAME)
        print(f"\n📊 Collection Stats:")
        print(f"   Row Count: {stats.get('row_count', 'N/A')}")
    except Exception as e:
        print(f"\n❌ Error getting stats: {e}")
    
    # Load collection
    try:
        client.load_collection(collection_name=COLLECTION_NAME)
        print(f"\n✓ Collection loaded")
    except Exception as e:
        print(f"\n❌ Error loading collection: {e}")
    
    # Try to get ALL records (no filter)
    try:
        all_results = client.query(
            collection_name=COLLECTION_NAME,
            filter="",
            output_fields=["id", "defect_id", "chat_id", "video_id", "defect_type", "severity"],
            limit=100
        )
        print(f"\n📝 Total Records: {len(all_results)}")
        
        if all_results:
            print(f"\n📋 Sample Records (first 5):")
            for idx, record in enumerate(all_results[:5], 1):
                print(f"\n   Record {idx}:")
                for key, value in record.items():
                    if key != 'vector':  # Skip vector for readability
                        print(f"      {key}: {value}")
            
            # Group by chat_id
            chat_ids = {}
            for record in all_results:
                chat_id = record.get('chat_id', 'unknown')
                chat_ids[chat_id] = chat_ids.get(chat_id, 0) + 1
            
            print(f"\n📊 Defects by Chat ID:")
            for chat_id, count in chat_ids.items():
                print(f"   - {chat_id}: {count} defects")
        else:
            print(f"\n⚠️  Collection is EMPTY - no defects indexed!")
            
    except Exception as e:
        print(f"\n❌ Error querying records: {e}")
        import traceback
        traceback.print_exc()

else:
    print(f"\n❌ Collection '{COLLECTION_NAME}' does not exist")

print("\n" + "=" * 80)
print("END OF REPORT")
print("=" * 80)
