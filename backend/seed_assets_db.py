import os
from pymongo import MongoClient, ASCENDING

ASSET_TYPES = {
    "beautification": [
        "Artificial_Grass",
        "Bench",
        "Bike_Rack",
        "Bin",
        "Decorative_Fence",
        "Fitness_Equipment",
        "Flower_Bed",
        "Fountain",
        "Garden",
        "Gravel_Area",
        "Hedge",
        "Hoarding",
        "Interlock_Area",
        "Jogger_Track",
        "Kerbstone",
        "Landscape_Light",
        "Natural_Grass",
        "Planter_Pot",
        "Recessed_Light",
        "Road_Batter",
        "Sand_Area",
        "Tree",
        "Treeguard",
    ],
    "directional_signage": [
        "Directional_Structure_AssetCondition_Good",
        "Directional_Structure_AssetCondition_Damaged",
        "Gantry_Directional_Sign_AssetCondition_Good",
        "Gantry_Directional_Sign_AssetCondition_Damaged",
        "Street_Sign_AssetCondition_Good",
        "Street_Sign_AssetCondition_Damaged",
        "Pole_Directional_Sign_AssetCondition_Good",
        "Pole_Directional_Sign_AssetCondition_Damaged",
        "Street_Sign",
        "Traffic_Sign",
        "Pole_Directional_Sign",
        "Traffic_Sign_AssetCondition_Good",
        "Traffic_Sign_AssetCondition_Damaged",
        "Traffic_Sign_AssetCondition_Dirty",
        "Traffic_Sign_AssetCondition_Overgrown",
    ],
    "its": [
        "AIR_QUALITY_MONITORING_SYSTEM_AQMS",
        "CLOSED_CIRCUIT_TELEVISION_CCTV",
        "DYNAMIC_MESSAGE_SIGN_DMS",
        "EMERGENCY_PHONE",
        "FIRE_EXTINGUISHER",
        "ITS_ENCLOSURE",
        "ITS_FEEDER_PILLAR",
        "ITS_STRUCTURE",
        "LANE_CONTROL_SIGNS_LCS",
        "OVER_HEIGHT_VEHICLE_DETECTION_SYSTEM_OVDS",
        "OVDS_SPEAKER",
        "ROAD_WEATHER_INFORMATION_SYSTEM_RWIS",
        "SMALL_DYNAMIC_MESSAGING_SIGN",
        "TRAFFIC_SIGNAL",
        "TRAFFIC_SIGNAL_FEEDER_PILLAR",
        "TRAFFIC_SIGNAL_HEAD",
        "TRAFFIC_SIGNAL_JUNCTION",
        "VEHICLE_RESTRAINT_SYSTEM",
        "AIR_QUALITY_MONITORING_SYSTEM_AQMS_AssetCondition_Good",
        "AIR_QUALITY_MONITORING_SYSTEM_AQMS_AssetCondition_Damaged",
        "DYNAMIC_MESSAGE_SIGN_DMS_AssetCondition_Good",
        "DYNAMIC_MESSAGE_SIGN_DMS_AssetCondition_Damaged",
        "DYNAMIC_MESSAGE_SIGN_DMS_AssetCondition_NoDisplay",
        "EMERGENCY_PHONE_AssetCondition_Good",
        "EMERGENCY_PHONE_AssetCondition_Damaged",
        "FIRE_EXTINGUISHER_AssetCondition_Fine",
        "FIRE_EXTINGUISHER_AssetCondition_Missing",
        "ITS_ENCLOSURE_AssetCondition_Visible",
        "ITS_FEEDER_PILLAR_AssetCondition_Good",
        "ITS_FEEDER_PILLAR_AssetCondition_Damaged",
        "ITS_STRUCTURE_AssetCondition_Good",
        "ITS_STRUCTURE_AssetCondition_Damaged",
        "LANE_CONTROL_SIGNS_LCS_AssetCondition_Good",
        "LANE_CONTROL_SIGNS_LCS_AssetCondition_Damaged",
        "LANE_CONTROL_SIGNS_LCS_AssetCondition_NoDisplay",
        "OVER_HEIGHT_VEHICLE_DETECTION_SYSTEM_OVDS_AssetCondition_Good",
        "OVER_HEIGHT_VEHICLE_DETECTION_SYSTEM_OVDS_AssetCondition_Damaged",
        "OVDS_SPEAKER_AssetCondition_Good",
        "OVDS_SPEAKER_AssetCondition_Damaged",
        "SMALL_DYNAMIC_MESSAGING_SIGN_AssetCondition_Good",
        "SMALL_DYNAMIC_MESSAGING_SIGN_AssetCondition_Damaged",
        "SMALL_DYNAMIC_MESSAGING_SIGN_AssetCondition_Display",
        "TRAFFIC_SIGNAL_AssetCondition_Good",
        "TRAFFIC_SIGNAL_AssetCondition_Damaged",
        "TRAFFIC_SIGNAL_FEEDER_PILLAR_AssetCondition_Good",
        "TRAFFIC_SIGNAL_FEEDER_PILLAR_AssetCondition_Damaged",
        "TRAFFIC_SIGNAL_HEAD_AssetCondition_Good",
        "TRAFFIC_SIGNAL_HEAD_AssetCondition_Damaged",
        "TRAFFIC_SIGNAL_JUNCTION_AssetCondition_Good",
        "VEHICLE_RESTRAINT_SYSTEM_AssetCondition_Good",
        "VEHICLE_RESTRAINT_SYSTEM_AssetCondition_Damaged",
    ],
    "oia": [
        "Animal_Fence",
        "Animal_Grid",
        "Crash_Cushion",
        "Fence",
        "Guardrail",
        "Traffic_Bollard",
        "Animal_Fence_AssetCondition_Good",
        "Animal_Fence_AssetCondition_Damaged",
        "Animal_Fence_AssetCondition_MissingPanel",
        "Animal_Grid_AssetCondition_Good",
        "Animal_Grid_AssetCondition_Damaged",
        "Crash_Cushion_AssetCondition_Good",
        "Crash_Cushion_AssetCondition_Damaged",
        "Crash_Cushion_AssetCondition_Missing",
        "Fence_AssetCondition_Good",
        "Fence_AssetCondition_Damaged",
        "Fence_AssetCondition_Missing",
        "Guardrail_AssetCondition_Good",
        "Guardrail_AssetCondition_Damaged",
        "Traffic_Bollard_AssetCondition_Good",
        "Traffic_Bollard_AssetCondition_Missing",
        "Traffic_Bollard_AssetCondition_Broken",
        "Traffic_Bollard_AssetCondition_Bent",
    ],
    "roadway_lighting": [
        "STREET_LIGHT_FEEDER_PILLAR",
        "STREET_LIGHT",
        "STREET_LIGHT_POLE",
        "UNDERPASS_LUMINAIRE",
        "STREET_LIGHT_FEEDER_PILLAR_AssetCondition_Good",
        "STREET_LIGHT_FEEDER_PILLAR_AssetCondition_Damaged",
        "STREET_LIGHT_AssetCondition_Good",
        "STREET_LIGHT_AssetCondition_Damaged",
        "STREET_LIGHT_POLE_AssetCondition_Good",
        "STREET_LIGHT_POLE_AssetCondition_Damaged",
        "UNDERPASS_LUMINAIRE_AssetCondition_Good",
        "UNDERPASS_LUMINAIRE_AssetCondition_Damaged",
    ],
    "structures": [
        "Bridge",
        "Cable_Bridge",
        "Camel_Crossing",
        "Culvert",
        "Flyover",
        "Footbridge",
        "Monument",
        "Overpass_OP_Only_Pedestrian",
        "Overpass_OV",
        "Pedestrian_Underpass",
        "Retaining_Wall",
        "Toll_Gate",
        "Tunnel",
        "Underpass",
        "Viaduct",
        "Bridge_AssetCondition_Good",
        "Bridge_AssetCondition_Damaged",
        "Cable_Bridge_AssetCondition_Good",
        "Cable_Bridge_AssetCondition_Damaged",
        "Camel_Crossing_AssetCondition_Good",
        "Camel_Crossing_AssetCondition_Damaged",
        "Culvert_AssetCondition_Good",
        "Culvert_AssetCondition_Damaged",
        "Flyover_AssetCondition_Good",
        "Flyover_AssetCondition_Damaged",
        "Footbridge_AssetCondition_Good",
        "Footbridge_AssetCondition_Damaged",
        "Monument_AssetCondition_Good",
        "Monument_AssetCondition_Damaged",
        "Overpass_OP_Only_Pedestrian_AssetCondition_Good",
        "Overpass_OP_Only_Pedestrian_AssetCondition_Damaged",
        "Overpass_OV_AssetCondition_Good",
        "Overpass_OV_AssetCondition_Damaged",
        "Pedestrian_Underpass_AssetCondition_Good",
        "Pedestrian_Underpass_AssetCondition_Damaged",
        "Retaining_Wall_AssetCondition_Good",
        "Retaining_Wall_AssetCondition_Damaged",
        "Toll_Gate_AssetCondition_Good",
        "Toll_Gate_AssetCondition_Damaged",
        "Tunnel_AssetCondition_Good",
        "Tunnel_AssetCondition_Damaged",
        "Underpass_AssetCondition_Good",
        "Underpass_AssetCondition_Damaged",
        "Viaduct_VerticalClearance_Good",
        "Viaduct_VerticalClearance_Damaged",
    ],
    "pavement": [
        "Kerb",
        "Road_Marking_Line",
        "Road_Marking_Point",
        "Road_Marking_Polygon",
        "Road_Studs",
        "Rumble_Strip",
        "Speed_Humps",
        "Accessway",
        "Carriageway",
        "Central_Roundabout_Island",
        "Footpath",
        "Junction_Island",
        "Median",
        "Parking_Bay",
        "Separator_Island",
        "Shoulder",
        "Kerb_AssetCondition_Good",
        "Kerb_AssetCondition_Damaged",
        "Road_Marking_Line_AssetCondition_Good",
        "Road_Marking_Line_AssetCondition_Damaged",
        "Road_Marking_Point_AssetCondition_Good",
        "Road_Marking_Point_AssetCondition_Damaged",
        "Road_Marking_Polygon_AssetCondition_Good",
        "Road_Marking_Polygon_AssetCondition_Damaged",
        "Road_Marking_Polygon_AssetCondition_FadedPaint",
        "Road_Studs_AssetCondition_Good",
        "Road_Studs_AssetCondition_Broken",
        "Road_Studs_AssetCondition_Missing",
        "Rumble_Strip_AssetCondition_Good",
        "Rumble_Strip_AssetCondition_Damaged",
        "Rumble_Strip_AssetCondition_PaintFaded",
        "Speed_Humps_AssetCondition_Good",
        "Speed_Humps_AssetCondition_Damaged",
        "Accessway_AssetCondition_Good",
        "Accessway_AssetCondition_Damaged",
        "Carriageway_AssetCondition_Good",
        "Carriageway_AssetCondition_Damaged",
        "Central_Roundabout_Island_AssetCondition_Good",
        "Central_Roundabout_Island_AssetCondition_Damaged",
        "Footpath_AssetCondition_Good",
        "Footpath_AssetCondition_Damaged",
        "Junction_Island_AssetCondition_Good",
        "Junction_Island_AssetCondition_Damaged",
        "Median_AssetCondition_Good",
        "Median_AssetCondition_Damaged",
        "Parking_Bay_AssetCondition_Good",
        "Parking_Bay_AssetCondition_Poor",
        "Separator_Island_AssetCondition_Good",
        "Separator_Island_AssetCondition_Damaged",
        "Shoulder_AssetCondition_Good",
        "Shoulder_AssetCondition_Damaged",
    ],
}

# --- CONFIGURATION ---
MONGO_URI = "mongodb://localhost:27017/"
DB_NAME = "roadrunner"

def seed_database():
    client = MongoClient(MONGO_URI)
    db = client[DB_NAME]
    
    col_categories = db["system_asset_categories"]
    col_labels = db["system_asset_labels"]

    print("Clearing old system data...")
    col_categories.delete_many({})
    col_labels.delete_many({})

    category_docs = []
    label_docs = []

    cat_counter = 1
    asset_counter = 1

    print("Processing Asset Types...")

    sorted_categories = sorted(ASSET_TYPES.keys())

    for cat_name in sorted_categories:
        cat_id = f"type_category_{cat_counter}"
        
        category_docs.append({
            "category_id": cat_id,
            "default_name": cat_name,
            "display_name": cat_name.replace("_", " ").title() 
        })

        # Process Assets within this Category
        asset_list = ASSET_TYPES[cat_name]
        # Sort assets too for deterministic IDs
        for asset_name in sorted(asset_list):
            asset_id = f"type_asset_{asset_counter}"
            
            label_docs.append({
                "asset_id": asset_id,
                "category_id": cat_id, # Link to parent category
                "default_name": asset_name,
                "display_name": asset_name.replace("_", " ") # A readable version
            })
            
            asset_counter += 1
        
        cat_counter += 1

    # Bulk Insert
    if category_docs:
        col_categories.insert_many(category_docs)
        print(f"Inserted {len(category_docs)} categories.")
    
    if label_docs:
        col_labels.insert_many(label_docs)
        print(f"Inserted {len(label_docs)} asset types (labels).")
    
    print("Creating indexes...")
    col_categories.create_index([("category_id", ASCENDING)], unique=True)
    col_labels.create_index([("asset_id", ASCENDING)], unique=True)
    col_labels.create_index([("category_id", ASCENDING)])

    print(f"Setup complete. {len(category_docs)} categories and {len(label_docs)} labels seeded.")

    print("\nSample Data Preview:")
    print("Category:", category_docs[0])
    print("Asset Type:", label_docs[0])

def get_resolved_config_map(user_id):
    db = MongoClient(MONGO_URI)[DB_NAME]
    db.user_asset_preferences.updateOne;

if __name__ == "__main__":
    seed_database()
    get_resolved_config_map("695b584f09bf77a99d8db315")