from collections import defaultdict
import json
import os
from pathlib import Path
from pymongo import MongoClient

# Database connection
MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017/")
client = MongoClient(MONGO_URI)
db = client["roadrunner"]
system_asset_labels = db["system_asset_labels"]

# Category mapping (from demoDataService.ts updates)
ANNOTATION_CATEGORY_IDS = {
    "Beautification": 'type_category_1',
    "Directional Signage": 'type_category_2',
    "ITS": 'type_category_3',
    "OIA": 'type_category_4',
    "Pavement": 'type_category_5',
    "Roadway Lighting": 'type_category_6',
    "Structures": 'type_category_7',
    
    # Additional mappings if needed based on the file content "category" field
    "Directional Signage": 'type_category_2',
    "ITS": 'type_category_3',
    "OIA": 'type_category_4',
    "Corridor & Pavement": 'type_category_5',
    "Pavement": 'type_category_5',
    "Roadway Lighting": 'type_category_6',
    "Structures": 'type_category_7',
}

def load_label_map():
    """Load asset definitions from DB to map names/classes to asset_ids"""
    label_map = {} # Maps display_name/default_name -> asset_id
    
    # Fetch all system labels
    cursor = system_asset_labels.find({})
    for label in cursor:
        asset_id = label.get("asset_id")
        
        # Map original display name
        if label.get("default_name"):
            label_map[label["default_name"]] = asset_id
            
        # Map default name
        if label.get("default_name"):
            label_map[label["default_name"]] = asset_id
            
        # Also map ID itself just in case
        if asset_id:
            label_map[asset_id] = asset_id

    return label_map

def update_video_stats(data):
    """Update per-video statistics in the data object"""
    print("Updating video statistics...")
    
    # 1. Group assets by video_id
    assets_by_video = defaultdict(list)
    for asset in data.get("assets", []):
        video_id = asset.get("video_id")
        if video_id:
            # Normalize video_id to match keys in "videos" dict if necessary
            # The JSON keys have extension removed sometimes, need to check
            assets_by_video[video_id].append(asset)
    print(len(assets_by_video))
    # 2. Calculate stats for each video
    # videos_dict = data.get("videos", {}) # We don't want to update "videos" anymore
    
    # Initialize per_video if not present
    if "per_video" not in data:
        data["per_video"] = {}
    per_video_dict = data["per_video"]
    
    # helper for condition mapping
    bad_conditions = {"damaged", "bad", "poor", "missing", "broken", "bent", "dirty", "overgrown"}
    good_conditions = {"good", "fine", "visible", "excellent"}
    
    for video_id, assets in assets_by_video.items():
        # video_key might vary (with/without .mp4)
        target_key = video_id
            
        if target_key not in per_video_dict:
            per_video_dict[target_key] = {}
            
        # Aggregators
        by_category = defaultdict(int)
        by_condition = defaultdict(int)
        by_class = defaultdict(lambda: {"count": 0, "good": 0, "damaged": 0})
        
        for asset in assets:
            # Category - Use category_id
            cat_id = asset.get("category_id", "Unknown")
            by_category[cat_id] += 1
            
            # Condition
            cond = asset.get("condition", "unknown").lower()
            if cond in bad_conditions:
                cond_key = "damaged"
            elif cond in good_conditions:
                cond_key = "good"
            else:
                cond_key = "good" 
            
            by_condition[cond_key] += 1
            
            # Class - Use asset_id
            asset_id = asset.get("asset_id", "Unknown")
            by_class[asset_id]["count"] += 1
            if cond_key == "good":
                by_class[asset_id]["good"] += 1
            else:
                by_class[asset_id]["damaged"] += 1
                
        # Update per_video entry
        per_video_dict[target_key]["byCategory"] = dict(by_category)
        per_video_dict[target_key]["byCondition"] = dict(by_condition)
        per_video_dict[target_key]["byClass"] = dict(by_class)
        # per_video_dict[target_key]["total_assets"] = len(assets) # Optional, can keep in videos

def process_demo_data():
    base_dir = Path(__file__).resolve().parent
    # json_path = base_dir / "demo-data" / "demo-assets-processed.json"
    json_path = base_dir / "demo-data" / "demo-assets-processed.json"
    out_path = base_dir / "demo-data" / "demo-assets-processed-updated-ids.json"
    if not json_path.exists():
        print(f"Error: {json_path} not found.")
        return

    print(f"Loading data from {json_path}...")
    with open(json_path, "r") as f:
        data = json.load(f)
        
    assets = data.get("assets", [])
    print(f"Found {len(assets)} assets to process.")
    
    label_map = load_label_map()
    print(f"Loaded {len(label_map)} label mappings from DB.")
    
    stats = {"updated": 0, "missing_asset_id": 0, "missing_category_id": 0}
    
    for asset in assets:
        # 1. Resolve Asset ID
        # Try to match by className or type
        class_name = asset.get("className")
        asset_type = asset.get("type")
        
        asset_id = None
        
        # Try exact match against label definitions
        if class_name and class_name in label_map:
            asset_id = label_map[class_name]
        elif asset_type and asset_type in label_map:
            asset_id = label_map[asset_type]
            
        # If found, set it
        if asset_id:
            asset["asset_id"] = asset_id
            stats["updated"] += 1
        else:
            stats["missing_asset_id"] += 1
            # print(f"Warning: Could not find asset_id for {class_name}/{asset_type}")
            
        # 2. Resolve Category ID
        category_name = asset.get("category")
        category_id = ANNOTATION_CATEGORY_IDS.get(category_name)
        
        if category_id:
            asset["category_id"] = category_id
        else:
            stats["missing_category_id"] += 1
            # print(f"Warning: Could not find category_id for {category_name}")
            
    # 3. Update video statistics
    update_video_stats(data)
            
    # Save back to file
    print("Saving updated data...")
    with open(out_path, "w") as f:
        json.dump(data, f, indent=2)
        
    print("Done!")
    print(f"Stats: {stats}")

if __name__ == "__main__":
    process_demo_data()
