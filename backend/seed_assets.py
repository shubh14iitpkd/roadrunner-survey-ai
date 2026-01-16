#!/usr/bin/env python3
"""
Seed script to insert dummy assets into MongoDB for demo purposes.
Run this script to populate the Asset Register with sample data.

Usage:
    python seed_assets.py
"""

import os
import sys
from datetime import datetime, timedelta
import random
from pymongo import MongoClient
from bson import ObjectId

# Add parent directory to path to import config
sys.path.insert(0, os.path.dirname(__file__))
from config import Config

def seed_assets():
    # Connect to MongoDB
    config = Config()
    client = MongoClient(config.MONGO_URI)
    db = client[config.MONGO_DB_NAME]

    print("🌱 Seeding dummy assets into MongoDB...")

    # Asset categories and types
    asset_data = [
        # Traffic Signs
        ("Traffic Signs", "Stop Sign", "good", 0.95),
        ("Traffic Signs", "Yield Sign", "fair", 0.88),
        ("Traffic Signs", "Speed Limit Sign", "good", 0.92),
        ("Traffic Signs", "No Entry Sign", "good", 0.94),
        ("Traffic Signs", "One Way Sign", "fair", 0.87),
        ("Traffic Signs", "Pedestrian Crossing Sign", "poor", 0.79),

        # Road Markings
        ("Road Markings", "Lane Lines", "good", 0.91),
        ("Road Markings", "Crosswalk", "fair", 0.86),
        ("Road Markings", "Stop Line", "good", 0.93),
        ("Road Markings", "Turn Arrows", "poor", 0.82),
        ("Road Markings", "Bike Lane Markings", "fair", 0.88),

        # Street Lighting
        ("Street Lighting", "LED Street Light", "good", 0.96),
        ("Street Lighting", "Lamp Post", "good", 0.94),
        ("Street Lighting", "High Mast Light", "fair", 0.85),
        ("Street Lighting", "Pedestrian Light", "good", 0.92),
        ("Street Lighting", "Bollard Light", "poor", 0.78),

        # Barriers
        ("Barriers", "Concrete Barrier", "good", 0.90),
        ("Barriers", "Metal Guardrail", "fair", 0.87),
        ("Barriers", "Cable Barrier", "good", 0.91),
        ("Barriers", "Crash Cushion", "fair", 0.84),
        ("Barriers", "Jersey Barrier", "good", 0.93),

        # Drainage
        ("Drainage", "Storm Drain", "fair", 0.86),
        ("Drainage", "Catch Basin", "good", 0.92),
        ("Drainage", "Culvert", "poor", 0.81),
        ("Drainage", "Gutter", "fair", 0.88),
        ("Drainage", "Drainage Pipe", "good", 0.89),

        # Utility Infrastructure
        ("Utility Infrastructure", "Utility Pole", "good", 0.94),
        ("Utility Infrastructure", "Manhole Cover", "fair", 0.87),
        ("Utility Infrastructure", "Fire Hydrant", "good", 0.95),
        ("Utility Infrastructure", "Electric Box", "fair", 0.83),
        ("Utility Infrastructure", "Traffic Signal Controller", "good", 0.91),

        # Pavement Features
        ("Pavement Features", "Rumble Strips", "good", 0.89),
        ("Pavement Features", "Speed Hump", "fair", 0.85),
        ("Pavement Features", "Pothole", "poor", 0.92),
        ("Pavement Features", "Crack", "poor", 0.88),
        ("Pavement Features", "Edge Joint", "fair", 0.86),

        # Traffic Control
        ("Traffic Control", "Traffic Light", "good", 0.96),
        ("Traffic Control", "Pedestrian Signal", "good", 0.94),
        ("Traffic Control", "Arrow Signal", "fair", 0.87),
        ("Traffic Control", "Countdown Timer", "good", 0.93),
        ("Traffic Control", "Traffic Camera", "good", 0.91),
    ]

    # Get existing surveys to link assets to
    surveys = list(db.surveys.find())
    if not surveys:
        print("❌ No surveys found. Please create surveys first.")
        return

    # Get existing roads
    roads = list(db.roads.find())

    print(f"Found {len(surveys)} surveys and {len(roads)} roads")

    # Clear existing assets (optional - comment out to keep existing data)
    # db.assets.delete_many({})
    # print("Cleared existing assets")

    assets_to_insert = []

    # Create assets for each survey
    for survey in surveys:
        route_id = survey.get("route_id")
        survey_id = survey.get("_id")

        # Get road info
        road = next((r for r in roads if r.get("route_id") == route_id), None)

        # Create 10-15 random assets per survey
        num_assets = random.randint(10, 15)

        for i in range(num_assets):
            # Pick a random asset
            category, asset_type, condition, confidence = random.choice(asset_data)

            # Generate random coordinates (Qatar area)
            lat = 25.2854 + (random.random() - 0.5) * 0.2
            lng = 51.531 + (random.random() - 0.5) * 0.2

            # Random detection time within the last 30 days
            days_ago = random.randint(0, 30)
            detected_at = (datetime.now() - timedelta(days=days_ago)).isoformat()

            asset = {
                "route_id": route_id,
                "survey_id": survey_id,
                "category": category,
                "type": asset_type,
                "condition": condition,
                "confidence": confidence + random.uniform(-0.05, 0.05),  # Add some variance
                "lat": lat,
                "lng": lng,
                "detected_at": detected_at,
                "description": f"{condition.capitalize()} condition {asset_type.lower()} detected",
                "image_url": None,  # Could add thumbnail URLs here
            }

            assets_to_insert.append(asset)

    # Insert all assets
    if assets_to_insert:
        result = db.assets.insert_many(assets_to_insert)
        print(f"✅ Successfully inserted {len(result.inserted_ids)} dummy assets!")

        # Print statistics
        total_good = sum(1 for a in assets_to_insert if a['condition'] == 'good')
        total_fair = sum(1 for a in assets_to_insert if a['condition'] == 'fair')
        total_poor = sum(1 for a in assets_to_insert if a['condition'] == 'poor')

        print(f"\n📊 Asset Statistics:")
        print(f"   Good condition: {total_good}")
        print(f"   Fair condition: {total_fair}")
        print(f"   Poor condition: {total_poor}")

        # Count by category
        categories = {}
        for asset in assets_to_insert:
            cat = asset['category']
            categories[cat] = categories.get(cat, 0) + 1

        print(f"\n📋 By Category:")
        for cat, count in sorted(categories.items(), key=lambda x: x[1], reverse=True):
            print(f"   {cat}: {count}")
    else:
        print("⚠️ No assets to insert")

    client.close()
    print("\n✨ Seeding complete!")

if __name__ == "__main__":
    seed_assets()
