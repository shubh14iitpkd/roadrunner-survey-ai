#!/usr/bin/env python3
"""
Bulk upload roads data to MongoDB
Run: python scripts/bulk_upload_roads.py
"""

import os
import sys
from datetime import datetime

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from flask import Flask
from config import Config
from db import get_client

# Qatar region boundaries (approximate)
# Doha center: 25.2854° N, 51.5310° E
QATAR_CENTER_LAT = 25.2854
QATAR_CENTER_LNG = 51.5310

# Roads data with names and distances
ROADS_DATA = [
    ("Al Corniche", 17),
    ("Omar Al Mukhtar St", 20),
    ("Al Istiqlal St", 14),
    ("Al Jamiaa St", 19),
    ("963 Street", 13),
    ("Salwa Rd", 47),
    ("Ak Khor Costal Rd", 54),
    ("7FGQ+QH5, Doha", 43),
    ("7FVP+JW Doha", 38),
    ("8G36+MQF, Doha", 9),
    ("D Ring Rd, Doha", 17),
    ("Grand Hammad St, Doha", 16),
    ("166 Rawdat Al Khail St", 9),
    ("Al Rayyan Rd 2", 6),
    ("Rawdat Al-Khail Street B Ring Rd", 11),
    ("Ras Bu Abboud Rd،", 21),
    ("Ibn Al Fardi St", 25),
    ("F Ring Rd", 19),
    ("G Ring Rd", 44),
    ("Al Najma Sr", 21),
    ("Al Wakra Rd", 25),
    ("6GQH+5WW", 8),
    ("Mesaieed Rd", 11),
    ("East Industrial St", 21),
    ("West Industrial St", 17),
    ("Industrial Area Foot over Bridge", 19),
    ("G Ring (2)Rd", 7),
    ("Street 502", 9),
    ("Wadi Al Wasah", 16),
    ("Salwa-Lusail Temporary Truck Rte", 34),
    ("Al Sadd Plaza", 18),
    ("1494 Al Rayyan Rd", 22),
    ("Abū Nakẖlah", 61),
    ("15 Al Amana", 23),
    ("Najma", 12),
    ("Wadi Al Gaeya, Qatar", 23),
    ("CG56+946", 31),
    ("Rawdat Al Habara", 15),
    ("Dukhan Hwy", 92),
    ("Ash Shahaniyah", 66),
    ("Al Khor Coastal Rd 2", 33),
    ("Al Khawr", 29),
    ("7C4J+C63", 15),
    ("6GH3+RPG,", 10),
    ("Sabah Al Ahmad Corridor (3)", 12),
    ("6G82+CQ4", 12),
    ("street 340", 18),
    ("856 Al Thumama St", 8),
    ("9F5V+3M6", 8),
    ("Al Muntazah, Ar Rayyan", 145),
    ("Al Amir St", 233),
    ("Ar Rayyan (3)", 13),
]

def get_road_type(distance_km):
    """Assign road type based on distance"""
    if distance_km >= 50:
        return "National/Expressway"
    elif distance_km >= 15:
        return "Municipal/Urban Road"
    else:
        return "Local Access Road"

def generate_coordinates(index, total, distance_km):
    """
    Generate reasonable start/end coordinates for roads in Qatar region
    Spreads roads around Doha center based on index and distance
    """
    import math

    # Spread roads in a circular pattern around Doha
    angle = (index / total) * 2 * math.pi

    # Base offset from center (scaled by distance)
    base_offset = min(distance_km / 100, 0.5)  # Max 0.5 degrees

    # Start point - offset in one direction
    start_lat = QATAR_CENTER_LAT + (base_offset * math.cos(angle))
    start_lng = QATAR_CENTER_LNG + (base_offset * math.sin(angle))

    # End point - offset in opposite direction (creates a road segment)
    end_offset = base_offset + (distance_km / 150)  # Longer roads have more offset
    end_lat = QATAR_CENTER_LAT + (end_offset * math.cos(angle + 0.2))
    end_lng = QATAR_CENTER_LNG + (end_offset * math.sin(angle + 0.2))

    return {
        "start_lat": round(start_lat, 6),
        "start_lng": round(start_lng, 6),
        "end_lat": round(end_lat, 6),
        "end_lng": round(end_lng, 6),
    }

def get_start_end_names(road_name):
    """Generate start and end point names based on road name"""
    # Simple logic: use road name with "Start" and "End"
    if "Rd" in road_name or "Road" in road_name:
        return f"{road_name} Start", f"{road_name} End"
    elif "St" in road_name or "Street" in road_name:
        return f"{road_name} North", f"{road_name} South"
    else:
        return f"{road_name} Point A", f"{road_name} Point B"

def get_next_route_id(db):
    """Get the next available route_id"""
    counter = db.counters.find_one({"_id": "route_id"})
    if not counter:
        # Initialize counter
        db.counters.insert_one({"_id": "route_id", "seq": 0})
        return 1

    result = db.counters.find_one_and_update(
        {"_id": "route_id"},
        {"$inc": {"seq": 1}},
        return_document=True
    )
    return result["seq"]

def bulk_upload_roads():
    """Main function to bulk upload roads"""
    app = Flask(__name__)
    app.config.from_object(Config())

    client = get_client(app)
    db = client[app.config["MONGO_DB_NAME"]]

    print("=" * 60)
    print("BULK ROAD UPLOAD SCRIPT")
    print("=" * 60)
    print(f"\nTotal roads to upload: {len(ROADS_DATA)}")
    print(f"Target database: {app.config['MONGO_DB_NAME']}")
    print("\nGenerating road entries...")

    roads_to_insert = []
    total = len(ROADS_DATA)

    for index, (road_name, distance_km) in enumerate(ROADS_DATA):
        # Get next route_id
        route_id = get_next_route_id(db)

        # Generate coordinates
        coords = generate_coordinates(index, total, distance_km)

        # Get start/end names
        start_name, end_name = get_start_end_names(road_name)

        # Determine road type
        road_type = get_road_type(distance_km)

        # Alternate between LHS and RHS
        road_side = "LHS" if index % 2 == 0 else "RHS"

        # Create road document
        road_doc = {
            "route_id": route_id,
            "road_name": road_name,
            "start_point_name": start_name,
            "start_lat": coords["start_lat"],
            "start_lng": coords["start_lng"],
            "end_point_name": end_name,
            "end_lat": coords["end_lat"],
            "end_lng": coords["end_lng"],
            "estimated_distance_km": distance_km,
            "road_type": road_type,
            "road_side": road_side,
            "created_at": datetime.utcnow().isoformat() + "Z",
            "updated_at": datetime.utcnow().isoformat() + "Z",
        }

        roads_to_insert.append(road_doc)

        print(f"  [{index+1}/{total}] {road_name} -> Route ID: {route_id}, {distance_km}km, {road_type}")

    print(f"\nInserting {len(roads_to_insert)} roads into database...")

    try:
        result = db.roads.insert_many(roads_to_insert, ordered=False)
        print(f"✅ Successfully inserted {len(result.inserted_ids)} roads!")
    except Exception as e:
        print(f"⚠️  Some roads may already exist or there was an error: {e}")
        print("Continuing with remaining roads...")

    # Verify count
    total_roads = db.roads.count_documents({})
    print(f"\n📊 Total roads in database: {total_roads}")

    print("\n" + "=" * 60)
    print("UPLOAD COMPLETE!")
    print("=" * 60)
    print("\nRoad Type Distribution:")
    for road_type in ["National/Expressway", "Municipal/Urban Road", "Local Access Road"]:
        count = db.roads.count_documents({"road_type": road_type})
        print(f"  - {road_type}: {count}")

    print("\nYou can now view these roads in the frontend at:")
    print("  http://localhost:5173/roads")
    print("\n")

if __name__ == "__main__":
    try:
        bulk_upload_roads()
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
