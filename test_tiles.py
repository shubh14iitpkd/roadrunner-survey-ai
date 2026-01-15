#!/usr/bin/env python3
"""Test script to verify MOBAC SQLite database tiles."""

import sqlite3
import os
from pathlib import Path

# Database path
db_path = Path(__file__).parent / "Unnamed atlas.sqlitedb"

print(f"Testing tiles database at: {db_path}")
print(f"Database exists: {db_path.exists()}")
print(f"Database size: {db_path.stat().st_size if db_path.exists() else 0} bytes\n")

if not db_path.exists():
    print("ERROR: Database not found!")
    exit(1)

# Connect to database
conn = sqlite3.connect(str(db_path))
cursor = conn.cursor()

# Get tile info
print("=== Tile Info ===")
cursor.execute("SELECT * FROM info")
info = cursor.fetchone()
print(f"Min zoom: {info[0]}, Max zoom: {info[1]}\n")

# Get tile distribution
print("=== Tile Distribution ===")
cursor.execute("""
    SELECT z, COUNT(*) as count, MIN(x), MAX(x), MIN(y), MAX(y)
    FROM tiles
    GROUP BY z
    ORDER BY z
""")

for row in cursor.fetchall():
    z, count, min_x, max_x, min_y, max_y = row
    print(f"Zoom {z}: {count} tiles | X: {min_x}-{max_x} | Y: {min_y}-{max_y}")

# Test fetching a specific tile
print("\n=== Testing Tile Fetch ===")
test_coords = [(8, 328, 217), (9, 164, 108), (4, 5249, 3477)]

for z, x, y in test_coords:
    cursor.execute("SELECT length(image) FROM tiles WHERE z=? AND x=? AND y=? AND s=0", (z, x, y))
    result = cursor.fetchone()
    if result:
        print(f"✓ Tile {z}/{x}/{y}: {result[0]} bytes")
    else:
        print(f"✗ Tile {z}/{x}/{y}: NOT FOUND")

# Calculate expected coordinates for Doha
print("\n=== Expected Coordinates for Doha (25.2854, 51.5310) ===")
import math

lat, lng = 25.2854, 51.5310
for zoom in range(4, 10):
    n = 2 ** zoom
    x = int((lng + 180) / 360 * n)
    y = int((1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n)

    # Check if this tile exists in database
    cursor.execute("SELECT COUNT(*) FROM tiles WHERE z=? AND x=? AND y=? AND s=0", (zoom, x, y))
    exists = cursor.fetchone()[0] > 0
    status = "✓ EXISTS" if exists else "✗ missing"
    print(f"Zoom {zoom}: x={x}, y={y} - {status}")

conn.close()
print("\n✓ Test complete!")
