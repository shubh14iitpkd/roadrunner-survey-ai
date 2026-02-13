from pathlib import Path
import json
import random
from pymongo import MongoClient
from gpx_helpers import parse_gpx, interpolate_gpx

"""
interpolate_gpx: interpolate_gpx(total_frames, fps, gpx_data, frame_interval = 1, time_offset=0) -> array of interpolated gpx { 'lat' : value , 'lon' : value}
parse_gpx: parse(gpx_path) -> array of gpx { 'lat' : value , 'lon' : value}
"""
json_files = [
    "its.json",
    "oia.json",
    "roadway-lighting.json",
    "directional-signage.json",
    "corridor-structures.json",
    "corridor-pavement.json",
]


NAME_FIX_MAP = {
    "StreetLightPole-AssetCondition-Good": "STREET_LIGHT_POLE_AssetCondition_Good",
    "StreetLight-AssetCondition-Good": "STREET_LIGHT_AssetCondition_Good",
    "TrafficSign-AssetCondition-Good": "Traffic_Sign_AssetCondition_Good",
    "Kerb-AssetCondition-Good": "Kerb_AssetCondition_Good",
    "TRAFFIC_SIGNAL_HEAD_AssetCondition_Good": "TRAFFIC_SIGNAL_HEAD_AssetCondition_Good",
    "PoleDirectionalSign-AssetCondition-Good": "Pole_Directional_Sign_AssetCondition_Good",
    "Fence_AssetCondition_Good": "Fence_AssetCondition_Good",
    "Guardrail_AssetCondition_Good": "Guardrail_AssetCondition_Good",
    "TRAFFIC_SIGNAL_AssetCondition_Good": "TRAFFIC_SIGNAL_AssetCondition_Good",
    "TrafficSign-AssetCondition-Damaged": "Traffic_Sign_AssetCondition_Damaged",
    "ITS_FEEDER_PILLAR_AssetCondition_Good": "ITS_FEEDER_PILLAR_AssetCondition_Good",
    "Traffic_Bollard_AssetCondition_Good": "Traffic_Bollard_AssetCondition_Good",
    "StreetLightFeederPillar-AssetCondition-Good": "STREET_LIGHT_FEEDER_PILLAR_AssetCondition_Good",
    "Flyover-AssetCondition-Good": "Flyover_AssetCondition_Good",
    "ITS_ENCLOSURE_AssetCondition_Visible": "ITS_ENCLOSURE_AssetCondition_Visible",
    "Traffic_Bollard_AssetCondition_Bent": "Traffic_Bollard_AssetCondition_Bent",
    "PoleDirectionalSign-AssetCondition-Damaged": "Pole_Directional_Sign_AssetCondition_Damaged",
    "Guardrail_AssetCondition_Damaged": "Guardrail_AssetCondition_Damaged",
    "TrafficSign-AssetCondition-Overgrown": "Traffic_Sign_AssetCondition_Overgrown",
    "TrafficSign-AssetCondition-Dirty": "Traffic_Sign_AssetCondition_Dirty",
    "StreetSign-AssetCondition-Good": "Street_Sign_AssetCondition_Good",
    "Traffic_Bollard_AssetCondition_Broken": "Traffic_Bollard_AssetCondition_Broken",
    "Fence_AssetCondition_Missing": "Fence_AssetCondition_Missing",
    "StreetLight-AssetCondition-Damaged": "STREET_LIGHT_AssetCondition_Damaged",
    "Kerb-AssetCondition-Damaged": "Kerb_AssetCondition_Damaged",
    "RoadMarkingLine-AssetCondition-Good": "Road_Marking_Line_AssetCondition_Good",
    "RoadMarkingLine-AssetCondition-Damaged": "Road_Marking_Line_AssetCondition_Damaged",
    "RoadMarkingPolygon-AssetCondition-Good": "Road_Marking_Polygon_AssetCondition_Good",
    "RoadMarkingPolygon-AssetCondition-Damaged": "Road_Marking_Polygon_AssetCondition_Damaged",
    "RoadMarkingPolygon-AssetCondition-FadedPaint": "Road_Marking_Polygon_AssetCondition_FadedPaint",
    "RoadMarkingPoint-AssetCondition-Good": "Road_Marking_Point_AssetCondition_Good",
    "Carriageway-AssetCondition-Good": "Carriageway_AssetCondition_Good",
    "Carriageway-AssetCondition-Damaged": "Carriageway_AssetCondition_Damaged",
    "Accessway-AssetCondition-Good": "Accessway_AssetCondition_Good",
    "Shoulder-AssetCondition-Good": "Shoulder_AssetCondition_Good",
    "Median-AssetCondition-Good": "Median_AssetCondition_Good",
    "RumbleStrip-AssetCondition-Good": "Rumble_Strip_AssetCondition_Good",
    "ParkingBay-AssetCondition-Good": "Parking_Bay_AssetCondition_Good",
    "Footpath-AssetCondition-Good": "Footpath_AssetCondition_Good",
    "CentralRoundaboutIsland-AssetCondition-Good": "Central_Roundabout_Island_AssetCondition_Good",
    "SeparatorIsland-AssetCondition-Good": "Separator_Island_AssetCondition_Good",
    "JunctionIsland-AssetCondition-Good": "Junction_Island_AssetCondition_Good"
}

# Constants
ROUTE_ID = 258
CREATED_AT = "2026-02-10T10:09:52.844357"
MONGO_URI = "mongodb://localhost:27017"
MONGO_DB = "roadrunner"
ASSET_LABELS_COLLECTION = "system_asset_labels"

path_map = {
    "2025_0817_115147_F": {
        "path": "/home/ns/Code/roadvision/roadsight/roadrunner-survey-ai/backend/uploads/video_library/2025_0817_115147_F.mp4",
        "gpx_file": "/home/ns/Code/roadvision/roadsight/roadrunner-survey-ai/backend/uploads/video_library/2025_0817_115147_F.gpx"
    },
    "2025_0817_115647_F": {
        "path": "/home/ns/Code/roadvision/roadsight/roadrunner-survey-ai/backend/uploads/video_library/2025_0817_115647_F.mp4",
        "gpx_file": "/home/ns/Code/roadvision/roadsight/roadrunner-survey-ai/backend/uploads/video_library/2025_0817_115647_F.gpx"
    },
    "2025_0817_120147_F": {
        "path": "/home/ns/Code/roadvision/roadsight/roadrunner-survey-ai/backend/uploads/video_library/2025_0817_120147_F.mp4",
        "gpx_file": "/home/ns/Code/roadvision/roadsight/roadrunner-survey-ai/backend/uploads/video_library/2025_0817_120147_F.gpx"
    }
}


def load_asset_labels_map():
    """
    Connect to MongoDB and build a lookup map from default_name -> {asset_id, category_id}
    from the system_asset_labels collection.
    
    Returns:
        dict: Mapping of default_name -> {"asset_id": ..., "category_id": ...}
    """
    client = MongoClient(MONGO_URI)
    db = client[MONGO_DB]
    collection = db[ASSET_LABELS_COLLECTION]
    
    labels_map = {}
    for doc in collection.find():
        default_name = doc.get("default_name", "")
        labels_map[default_name] = {
            "asset_id": doc.get("asset_id", ""),
            "category_id": doc.get("category_id", "")
        }
    
    client.close()
    print(f"Loaded {len(labels_map)} asset labels from MongoDB")
    return labels_map


def get_base_asset_name(asset_type):
    """
    Extract the base asset name from the full asset_type string.
    e.g., 'TrafficSignalHead-AssetCondition-Good' -> 'TrafficSignalHead'
          'ITSFeederPillar-AssetCondition-Good' -> 'ITSFeederPillar'
    
    Args:
        asset_type: Full asset type string like 'TrafficSignalHead-AssetCondition-Good'
    
    Returns:
        str: Base asset name (first part before the first '-')
    """
    parts = asset_type.split("-")
    return parts[0] if parts else asset_type


def generate_confidence(asset_type):
    """
    Generate a random confidence value between 0 and 1 (never exactly 1).
    If the asset condition contains 'Bad' or 'Damaged', confidence < 0.20.
    Otherwise, confidence >= 0.20.
    
    Args:
        asset_type: Full asset type string like 'TrafficSignalHead-AssetCondition-Good'
    
    Returns:
        float: Random confidence value
    """
    asset_lower = asset_type.lower()
    if "bad" in asset_lower or "damaged" in asset_lower:
        return round(random.uniform(0, 0.19999), 5)
    else:
        return round(random.uniform(0.20, 0.99999), 5)


def should_include_asset(sequence):
    """
    Determine if an asset should be included based on the enabled status of the first two frames.
    
    Rules:
    - If sequence has 2+ frames: Both first two frames must have enabled=True
    - If sequence has 1 frame: That frame must have enabled=True
    - If sequence is empty: Skip
    
    Args:
        sequence: List of frame dictionaries
        
    Returns:
        bool: True if asset should be included
    """
    if not sequence:
        return False
    
    if len(sequence) == 1:
        # Single frame: include if enabled
        return sequence[0].get("enabled", False)
    
    # Two or more frames: first two must be enabled
    return (sequence[0].get("enabled", False) and 
            sequence[1].get("enabled", False))


def extract_asset_info(result_item, video_name, interpolated_gpx, fps, labels_map):
    """
    Extract asset information from a result item.
    
    Args:
        result_item: A single result dictionary from annotations
        video_name: Name of the video file
        interpolated_gpx: Array of interpolated GPX data
        fps: Frames per second of the video
        labels_map: Mapping of default_name -> {asset_id, category_id} from MongoDB
        
    Returns:
        dict or None: Asset information in the required format or None if should be skipped
    """
    value = result_item.get("value", {})
    sequence = value.get("sequence", [])
    
    # Check if asset should be included based on first two frames
    if not should_include_asset(sequence):
        return None
    
    # Get the first frame for position information
    first_frame = sequence[0]
    frame_number = first_frame.get("frame", 1)
    
    # Get label/asset type
    labels = value.get("choices") or value.get("labels", [])
    asset_type = NAME_FIX_MAP.get(labels[0], labels[0]) if labels else "UNKNOWN"
    # Extract base asset name and look up in MongoDB labels
    # base_name = get_base_asset_name(asset_type)
    label_info = labels_map.get(asset_type)
    # print(f"Asset type: {asset_type}")
    # print(f"Label info: {label_info}")
    
    if not label_info:
        raise Exception(f"Label not found for asset type: {asset_type}")
    
    mongo_asset_id = label_info.get("asset_id", asset_type)
    category_id = label_info.get("category_id", "")
    
    # Get GPX coordinates for this frame (frame_number - 1 for 0-indexed array)
    frame_index = max(0, min(frame_number - 1, len(interpolated_gpx) - 1))
    gpx_point = interpolated_gpx[frame_index] if frame_index < len(interpolated_gpx) else {"lat": 0, "lon": 0}
    
    # Generate confidence based on condition
    confidence = generate_confidence(asset_type)
    
    # Calculate time
    time_val = first_frame.get("time", 0)
    
    # Create asset document in the required format
    asset = {
        "asset_id": mongo_asset_id,
        "category_id": category_id,
        "asset_type":asset_type,
        "type": asset_type,
        "video_key": video_name,
        "frame_number": frame_number,
        "route_id": ROUTE_ID,
        "time": time_val,
        "confidence": confidence,
        "condition": "good" if confidence  >= 0.2 else "damaged",
        "box": {
            "x": first_frame.get("x", 0),
            "y": first_frame.get("y", 0),
            "width": first_frame.get("width", 0),
            "height": first_frame.get("height", 0),
        },
        "location": {
            "type": "Point",
            "coordinates": [gpx_point.get("lon", 0), gpx_point.get("lat", 0)]  # [longitude, latitude] for GeoJSON
        },
        "created_at": CREATED_AT,
    }
    
    return asset


def main():
    # Load asset labels from MongoDB
    print("Connecting to MongoDB...")
    labels_map = load_asset_labels_map()
    
    if not labels_map:
        print("WARNING: No asset labels found in MongoDB. asset_id and category_id will use defaults.")
    else:
        pass
        # print(f"Asset labels loaded: {list(labels_map.keys())}")
    
    all_assets = []    
    for in_file in json_files:
        # Load the annotations data
        with open(in_file, "r") as f:
            data = json.load(f)
        
        
        # Process each record (video)
        for record in data:
            # Extract video name
            video_path = record.get("data", {}).get("video", "")
            video_name = video_path.split("/")[-1].split(".")[0]
            
            # Get paths for this video
            ppaths = path_map.get(video_name)
            
            if not ppaths:
                print(f"Warning: No path mapping found for video: {video_name}")
                continue
            
            # print(f"\n{'='*60}")
            # print(f"Processing video: {video_name}")
            # print(f"Video path: {ppaths.get('path')}")
            # print(f"GPX file: {ppaths.get('gpx_file')}")
            
            # Check if files exist
            video_exists = Path(ppaths.get("path")).exists()
            gpx_exists = Path(ppaths.get("gpx_file")).exists()
            
            # print(f"Video exists: {video_exists}")
            # print(f"GPX exists: {gpx_exists}")
            
            if not video_exists or not gpx_exists:
                print(f"Skipping {video_name} - missing files")
                continue
            
            # Parse GPX file
            try:
                gpx_data = parse_gpx(Path(ppaths.get("gpx_file")))
                # print(f"GPX points loaded: {len(gpx_data)}")
            except Exception as e:
                print(f"Error parsing GPX file: {e}")
                continue
            
            # Get video metadata
            annotations_list = record.get("annotations", [])
            if not annotations_list:
                print(f"No annotations found for {video_name}")
                continue
            
            # Get first annotation to extract video metadata
            first_annotation = annotations_list[0]
            first_result = first_annotation.get("result", [])
            
            if not first_result:
                print(f"No results in annotation for {video_name}")
                continue
            
            # Extract frames count and duration from first result
            first_value = first_result[0].get("value", {})
            total_frames = first_value.get("framesCount", 9000)
            duration = first_value.get("duration", 300)
            fps = total_frames / duration if duration > 0 else 30
            
            # print(f"Total frames: {total_frames}, Duration: {duration}s, FPS: {fps:.2f}")
            
            # Interpolate GPX data
            try:
                interpolated_gpx = interpolate_gpx(
                    total_frames=total_frames,
                    fps=fps,
                    gpx_data=gpx_data,
                    frame_interval=1,
                    time_offset=0
                )
                # print(f"Interpolated GPX points: {len(interpolated_gpx)}")
            except Exception as e:
                print(f"Error interpolating GPX: {e}")
                continue
            
            # Process all annotations for this video
            video_asset_count = 0
            video_skipped_count = 0
            
            for annotation in annotations_list:
                results = annotation.get("result", [])
                
                for result_item in results:
                    # Only process choices types
                    if result_item.get("type") != "choices":
                        continue
                    
                    # Extract asset information
                    asset = extract_asset_info(result_item, video_name, interpolated_gpx, fps, labels_map)
                    
                    if asset:
                        all_assets.append(asset)
                        video_asset_count += 1
                    else:
                        video_skipped_count += 1
            
            # print(f"Assets extracted: {video_asset_count}")
            # print(f"Assets skipped (first 2 frames not enabled): {video_skipped_count}")
        
    # Save all assets to JSON file
    output_file = f"all_assets_extracted.json"
    with open(output_file, "w") as f:
        json.dump(all_assets, f, indent=2)
        
    client = MongoClient(MONGO_URI)
    db = client[MONGO_DB]
    collection = db["assets"]
    collection.insert_many(all_assets)
    
    print(f"\n{'='*60}")
    print(f"Total assets extracted: {len(all_assets)}")
    print(f"Assets saved to: {output_file}")
    print(f"Assets saved to MongoDB")
        
    # Print summary by asset type
    asset_types = {}
    for asset in all_assets:
        asset_type = f"{asset.get('asset_type', 'UNKNOWN')} - {asset.get('category_id', 'UNKNOWN')}"
        asset_types[asset_type] = asset_types.get(asset_type, 0) + 1
    
    print(f"\nAsset breakdown by type:")
    for asset_type, count in sorted(asset_types.items(), key=lambda x: x[1], reverse=True):
        print(f"  {asset_type}: {count}")


if __name__ == "__main__":
    main()