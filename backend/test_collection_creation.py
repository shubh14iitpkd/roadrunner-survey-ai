#!/usr/bin/env python3
"""Test collection creation directly"""

import os
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'

from pymilvus import MilvusClient
from sentence_transformers import SentenceTransformer
from dotenv import load_dotenv

load_dotenv()

# Milvus configuration
MILVUS_DB_PATH = "./milvus_demo.db"
COLLECTION_NAME = "road_defects"

print("=" * 80)
print("TESTING COLLECTION CREATION")
print("=" * 80)

client = MilvusClient(uri=MILVUS_DB_PATH)
print(f"✓ Connected to Milvus at {MILVUS_DB_PATH}")

# Drop if exists
collections = client.list_collections()
if COLLECTION_NAME in collections:
    print(f"Dropping existing collection: {COLLECTION_NAME}")
    client.drop_collection(collection_name=COLLECTION_NAME)

print(f"\nCreating collection: {COLLECTION_NAME}")

try:
    # Use auto-schema (simpler approach for Milvus Lite)
    index_params = client.prepare_index_params()
    index_params.add_index(
        field_name="vector",
        index_type="FLAT",
        metric_type="COSINE"
    )
    
    # Create collection with auto-schema
    client.create_collection(
        collection_name=COLLECTION_NAME,
        dimension=768,
        index_params=index_params,
        enable_dynamic_field=True
    )
    print("✓ Collection created")
    
    # Load collection
    client.load_collection(collection_name=COLLECTION_NAME)
    print("✓ Collection loaded")
    
    # Verify with a test search
    embedder = SentenceTransformer('all-mpnet-base-v2')
    test_embedding = embedder.encode("test", convert_to_numpy=True).tolist()
    
    results = client.search(
        collection_name=COLLECTION_NAME,
        data=[test_embedding],
        anns_field="vector",
        limit=1
    )
    print("✓ Search works - index verified")
    
    print("\n" + "=" * 80)
    print("SUCCESS - Collection created and working!")
    print("=" * 80)
    
except Exception as e:
    print(f"\n❌ ERROR: {e}")
    import traceback
    traceback.print_exc()
    print("\n" + "=" * 80)
    print("FAILED")
    print("=" * 80)
