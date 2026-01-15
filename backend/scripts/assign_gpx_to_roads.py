#!/usr/bin/env python3
"""
Assign GPX files to existing roads in MongoDB
Run: python scripts/assign_gpx_to_roads.py
"""

import os
import sys
import glob
import random

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from flask import Flask
from config import Config
from db import get_client

def assign_gpx_to_roads():
    """Assign GPX files from gpx_files folder to roads"""
    app = Flask(__name__)
    app.config.from_object(Config())

    client = get_client(app)
    db = client[app.config["MONGO_DB_NAME"]]

    # Get GPX files
    gpx_folder = os.path.join(os.path.dirname(os.path.dirname(__file__)), "gpx_files")
    gpx_files = glob.glob(os.path.join(gpx_folder, "*.gpx"))

    if not gpx_files:
        print(f"❌ No GPX files found in {gpx_folder}")
        sys.exit(1)

    print("=" * 60)
    print("ASSIGN GPX FILES TO ROADS")
    print("=" * 60)
    print(f"\nFound {len(gpx_files)} GPX files")

    # Get all roads from database
    roads = list(db.roads.find())
    print(f"Found {len(roads)} roads in database")

    if len(roads) == 0:
        print("❌ No roads found in database!")
        sys.exit(1)

    print("\nAssigning GPX files to roads...")

    # Shuffle GPX files for random assignment
    random.shuffle(gpx_files)

    updated_count = 0

    # Assign GPX files to roads (cycling through GPX files if we have more roads)
    for i, road in enumerate(roads):
        # Get GPX file (cycle through if more roads than GPX files)
        gpx_file = gpx_files[i % len(gpx_files)]
        gpx_filename = os.path.basename(gpx_file)

        # Create relative URL path for GPX file
        gpx_url = f"/uploads/gpx/{gpx_filename}"

        # Update road with GPX file
        result = db.roads.update_one(
            {"_id": road["_id"]},
            {"$set": {"gpx_file_url": gpx_url}}
        )

        if result.modified_count > 0:
            updated_count += 1
            print(f"  [{i+1}/{len(roads)}] Route {road['route_id']}: {road['road_name'][:40]:40} -> {gpx_filename}")

    print(f"\n✅ Successfully updated {updated_count} roads with GPX files!")

    # Verify
    roads_with_gpx = db.roads.count_documents({"gpx_file_url": {"$exists": True, "$ne": None}})
    print(f"\n📊 Roads with GPX files: {roads_with_gpx}/{len(roads)}")

    print("\n" + "=" * 60)
    print("ASSIGNMENT COMPLETE!")
    print("=" * 60)
    print("\nNote: GPX files are referenced from /uploads/gpx/ path")
    print("Make sure GPX files are accessible via the backend at:")
    print(f"  {gpx_folder}")
    print("\nYou can now view roads with GPX tracks in:")
    print("  - GIS View: http://localhost:5173/gis")
    print("  - Roads Page: http://localhost:5173/roads")
    print("\n")

if __name__ == "__main__":
    try:
        assign_gpx_to_roads()
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
