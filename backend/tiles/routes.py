import os
import sqlite3
from pathlib import Path
from flask import Blueprint, Response, jsonify
from functools import lru_cache

tiles_bp = Blueprint("tiles", __name__)

# Path to the SQLite tile database
# Default to the project root directory
DEFAULT_TILES_PATH = str(Path(__file__).resolve().parents[2] / "Unnamed atlas.sqlitedb")
TILES_DB_PATH = os.getenv("TILES_DB_PATH", DEFAULT_TILES_PATH)

print(f"[TILES] Looking for tiles database at: {TILES_DB_PATH}")
print(f"[TILES] Database exists: {os.path.exists(TILES_DB_PATH)}")

@lru_cache(maxsize=1)
def get_tile_db_connection():
    """
    Get a cached connection to the tiles database.
    Note: SQLite connections are not thread-safe, so we use check_same_thread=False
    and ensure read-only access.
    """
    if not os.path.exists(TILES_DB_PATH):
        print(f"[TILES ERROR] Database not found at: {TILES_DB_PATH}")
        return None

    try:
        conn = sqlite3.connect(TILES_DB_PATH, check_same_thread=False)
        # Set to read-only mode for safety
        conn.execute("PRAGMA query_only = ON")
        print(f"[TILES] Successfully connected to database")
        return conn
    except Exception as e:
        print(f"[TILES ERROR] Failed to connect to database: {e}")
        return None


@tiles_bp.get("/info")
def get_tile_info():
    """
    Get information about available tiles

    tags:
      - Tiles
    description: Returns zoom levels, tile counts, and bounds from the tile database
    responses:
      200:
        description: Tile information retrieved successfully
        schema:
          type: object
          properties:
            min_zoom:
              type: integer
            max_zoom:
              type: integer
            zoom_levels:
              type: array
              items:
                type: object
                properties:
                  zoom:
                    type: integer
                  tile_count:
                    type: integer
                  bounds:
                    type: object
            total_tiles:
              type: integer
            database_path:
              type: string
            database_exists:
              type: boolean
      404:
        description: Tile database not found or empty
      500:
        description: Internal server error
    """
    conn = get_tile_db_connection()
    if not conn:
        return jsonify({"error": "Tile database not found"}), 404

    try:
        cursor = conn.cursor()

        # Get min/max zoom levels
        cursor.execute("SELECT minzoom, maxzoom FROM info LIMIT 1")
        zoom_info = cursor.fetchone()

        if not zoom_info:
            return jsonify({"error": "No tile info found"}), 404

        min_zoom, max_zoom = zoom_info

        # Get tile count and bounds for each zoom level
        cursor.execute("""
            SELECT z, COUNT(*) as count,
                   MIN(x) as min_x, MAX(x) as max_x,
                   MIN(y) as min_y, MAX(y) as max_y
            FROM tiles
            GROUP BY z
            ORDER BY z
        """)

        zoom_levels = []
        for row in cursor.fetchall():
            z, count, min_x, max_x, min_y, max_y = row
            zoom_levels.append({
                "zoom": z,
                "tile_count": count,
                "bounds": {
                    "min_x": min_x,
                    "max_x": max_x,
                    "min_y": min_y,
                    "max_y": max_y
                }
            })

        return jsonify({
            "min_zoom": min_zoom,
            "max_zoom": max_zoom,
            "zoom_levels": zoom_levels,
            "total_tiles": sum(level["tile_count"] for level in zoom_levels),
            "database_path": TILES_DB_PATH,
            "database_exists": True
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@tiles_bp.get("/<int:z>/<int:x>/<int:y>.png")
def get_tile(z: int, x: int, y: int):
    """
    Serve a map tile

    tags:
      - Tiles
    description: Serve a map tile from the SQLite database (TMS format)
    parameters:
      - name: z
        in: path
        type: integer
        required: true
        description: Zoom level
      - name: x
        in: path
        type: integer
        required: true
        description: X coordinate
      - name: y
        in: path
        type: integer
        required: true
        description: Y coordinate (TMS format)
    responses:
      200:
        description: Tile image served successfully
        content:
          image/png:
            schema:
              type: string
              format: binary
      404:
        description: Tile not found
      500:
        description: Internal server error
    """
    conn = get_tile_db_connection()
    if not conn:
        return jsonify({"error": "Tile database not found"}), 404

    try:
        cursor = conn.cursor()

        # MOBAC uses s=0 for most tiles (s is for multiple tile sources)
        # Query for the tile image
        cursor.execute(
            "SELECT image FROM tiles WHERE z=? AND x=? AND y=? AND s=0 LIMIT 1",
            (z, x, y)
        )

        result = cursor.fetchone()

        if not result or not result[0]:
            # Return 404 with empty PNG for missing tiles
            return Response(status=404)

        tile_data = result[0]

        # Return the tile image with appropriate headers
        return Response(
            tile_data,
            mimetype='image/png',
            headers={
                'Cache-Control': 'public, max-age=86400',  # Cache for 24 hours
                'Access-Control-Allow-Origin': '*'
            }
        )

    except Exception as e:
        print(f"Error serving tile {z}/{x}/{y}: {e}")
        return Response(status=500)


@tiles_bp.get("/")
def tiles_home():
    """
    Check availability of tiles service

    tags:
      - Tiles
    responses:
      200:
        description: Tiles service is available
        schema:
          type: object
          properties:
            status:
              type: string
            message:
              type: string
            database_path:
              type: string
            endpoints:
              type: object
      404:
        description: Tile database not found
    """
    conn = get_tile_db_connection()
    if not conn:
        return jsonify({
            "status": "error",
            "message": "Tile database not found",
            "expected_path": TILES_DB_PATH
        }), 404

    return jsonify({
        "status": "ok",
        "message": "Offline tiles service available",
        "database_path": TILES_DB_PATH,
        "endpoints": {
            "info": "/api/tiles/info",
            "tile": "/api/tiles/{z}/{x}/{y}.png"
        }
    })
