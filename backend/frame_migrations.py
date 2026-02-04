import os
from pymongo import MongoClient, UpdateOne

# --- CONFIGURATION ---
MONGO_URI = "mongodb://localhost:27017/"
DB_NAME = "roadrunner" 
FRAMES_COLLECTION = "frames"
SYSTEM_LABELS_COLLECTION = "system_asset_labels"

def run_migration():
    client = MongoClient(MONGO_URI)
    db = client[DB_NAME]
    col_frames = db[FRAMES_COLLECTION]
    col_labels = db[SYSTEM_LABELS_COLLECTION]

    # 1. Build Lookup Map (Name -> Asset ID)
    print("⏳ Building Asset ID Lookup Map...")
    asset_map = {}
    # We fetch only what we need to save memory
    for doc in col_labels.find({}, {"default_name": 1, "asset_id": 1}):
        if "default_name" in doc and "asset_id" in doc:
            asset_map[doc["default_name"]] = doc["asset_id"]
    
    print(f"✅ Map created with {len(asset_map)} entries.")

    # 2. Iterate Frames
    # Fetch all documents that have any detections
    cursor = col_frames.find({"detections": {"$exists": True}})
    
    bulk_ops = []
    BATCH_SIZE = 1000
    updated_count = 0
    processed_count = 0

    print("🚀 Starting Normalization & Enrichment...")

    for doc in cursor:
        original_detections = doc.get("detections")
        final_list = []
        is_modified = False 

        # --- STEP A: NORMALIZE (Flatten Dict to List) ---
        if isinstance(original_detections, dict):
            # OLD FORMAT: { "its": [...], "signs": [...] } -> Flatten it
            for endpoint_list in original_detections.values():
                if isinstance(endpoint_list, list):
                    final_list.extend(endpoint_list)
            
            # We changed the structure, so we must write to DB
            is_modified = True 
            
        elif isinstance(original_detections, list):
            # NEW FORMAT: Already a list. Keep it.
            final_list = original_detections
            
        else:
            # Skip corrupted/empty data
            continue

        # --- STEP B: ENRICH (Add Asset IDs) ---
        # Now iterate the clean list to inject IDs
        for det in final_list:
            if not isinstance(det, dict): continue

            class_name = det.get("class_name")
            found_id = asset_map.get(class_name)

            # If we found an ID in system_labels, ensure it exists in the detection
            if found_id and det.get("asset_id") != found_id:
                det["asset_id"] = found_id
                is_modified = True

        # --- STEP C: BATCH UPDATE ---
        if is_modified:
            # We overwrite 'detections' with the new flat list (including the new asset_ids)
            op = UpdateOne(
                {"_id": doc["_id"]},
                {"$set": {"detections": final_list}} 
            )
            bulk_ops.append(op)
            updated_count += 1

        processed_count += 1

        # Execute Batch
        if len(bulk_ops) >= BATCH_SIZE:
            col_frames.bulk_write(bulk_ops)
            print(f"   Saved batch. Total documents updated so far: {updated_count}")
            bulk_ops = []

    # Final Batch
    if bulk_ops:
        col_frames.bulk_write(bulk_ops)

    print(f"🎉 DONE! Processed {processed_count} frames. Updated {updated_count} documents.")

if __name__ == "__main__":
    run_migration()