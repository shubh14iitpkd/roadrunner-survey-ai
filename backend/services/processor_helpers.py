"""
Shared helpers for video processors (LocalVideoProcessor, EngineVideoProcessor).

Asset taxonomy classification + geometry helpers used to build per-frame
observations and polyline asset geometry. Kept here so both processors stay
self-contained and don't depend on each other.
"""

import os
import math
from typing import List, Tuple, Optional

from services.LatLongEstimator import LatLongEstimator


# ---------------------------------------------------------------------------
# Asset classification via default_group_id
#
# Mirrors the video-library extractor (extract_ll_with_linear.py →
# extract_kml.classify_label) but operates on default_group_id from
# system_asset_labels instead of default_name, because group_id is editable
# downstream while default_group_id is the immutable canonical grouping.
# ---------------------------------------------------------------------------

POINT_GROUPS = {
    "Street Light", "Street Light Pole", "Street Light Feeder Pillar",
    "Underpass Luminaire",
    "Traffic Signal", "Traffic Signal Head", "Traffic Signal Feeder Pillar",
    "Traffic Signal Junction",
    "Traffic Sign", "Street Sign",
    "Pole Directional Sign", "Directional Structure", "Gantry Directional Sign",
    "Dynamic Message Sign DMS", "Lane Control Signs LCS",
    "Small Dynamic Messaging Sign",
    "Closed Circuit Television CCTV",
    "Air Quality Monitoring System AQMS",
    "Road Weather Information System RWIS",
    "ITS Enclosure", "ITS Feeder Pillar", "ITS Structure",
    "Over Height Vehicle Detection System OVDS", "OVDS Speaker",
    "Emergency Phone", "Fire Extinguisher",
    "Traffic Bollard", "Tree", "Monument", "Crash Cushion",
    "Road Marking Point",
}

LINEAR_SIDED_GROUPS = {
    "Guardrail",
    "Kerb", "Kerbstone",
    "Vehicle Restraint System",
    "Fence", "Animal Fence", "Decorative Fence",
    "Hoarding", "Hedge",
    "Shoulder", "Footpath",
    "Culvert", "Retaining Wall", "Road Batter",
    "Parking Bay",
}

LINEAR_UNSIDED_GROUPS = {
    "Road Marking Line", "Road Marking Polygon",
    "Rumble Strip", "Road Studs",
    "Speed Humps", "Carriageway",
    "Median", "Central Roundabout Island",
    "Junction Island", "Separator Island",
    "Accessway",
    "Natural Grass", "Sand Area", "Gravel Area", "Interlock Area", "Garden",
    "Flyover", "Overpass OV", "Overpass OP Only Pedestrian",
    "Viaduct", "Underpass", "Pedestrian Underpass", "Tunnel",
    "Cable Bridge", "Footbridge",
}

_POINT_HINTS = (
    "light", "signal", "sign", "cctv", "bollard", "camera",
    "pillar", "enclosure", "aqms", "rwis", "ovds", "dms", "lcs",
    "phone", "extinguisher", "tree", "monument", "cushion",
    "point", "pole",
)
_LINEAR_SIDED_HINTS = (
    "rail", "kerb", "fence", "barrier", "restraint", "shoulder",
    "footpath", "wall", "hoarding", "hedge", "batter", "culvert",
    "parking bay",
)
_LINEAR_UNSIDED_HINTS = (
    "marking line", "marking polygon", "rumble", "stud",
    "carriageway", "median", "island", "crossing",
    "speed hump", "accessway", "grass", "sand area", "gravel",
    "interlock", "garden",
    "overpass", "flyover", "viaduct", "underpass", "tunnel",
    "bridge",
)


def classify_group(group_id: str) -> str:
    """Classify an asset as point | linear_sided | linear_unsided | other."""
    if not group_id:
        return "other"
    if group_id in POINT_GROUPS:
        return "point"
    if group_id in LINEAR_SIDED_GROUPS:
        return "linear_sided"
    if group_id in LINEAR_UNSIDED_GROUPS:
        return "linear_unsided"
    g = group_id.lower()
    if any(h in g for h in _LINEAR_UNSIDED_HINTS):
        return "linear_unsided"
    if any(h in g for h in _LINEAR_SIDED_HINTS):
        return "linear_sided"
    if any(h in g for h in _POINT_HINTS):
        return "point"
    return "other"


# ---------------------------------------------------------------------------
# Geometry helpers (mirror extract_kml.py)
# ---------------------------------------------------------------------------

R_EARTH = 6378137.0
SIDED_OFFSET_M = float(os.environ.get("SIDED_OFFSET_M", 3.0))
BEARING_SMOOTH_FRAMES = int(os.environ.get("BEARING_SMOOTH_FRAMES", 15))


def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R_EARTH * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _offset_latlng(lat: float, lon: float, heading_deg: float,
                   side: Optional[str], dist_m: float) -> Tuple[float, float]:
    if side not in ("LHS", "RHS") or dist_m <= 0:
        return lat, lon
    perp = (heading_deg - 90.0) if side == "LHS" else (heading_deg + 90.0)
    perp = perp % 360
    d_lat = dist_m * math.cos(math.radians(perp)) / R_EARTH
    d_lon = dist_m * math.sin(math.radians(perp)) / (R_EARTH * math.cos(math.radians(lat)))
    return lat + math.degrees(d_lat), lon + math.degrees(d_lon)


def _dedupe_polyline(coords: List[Tuple[float, float]],
                     min_m: float = 0.5) -> List[Tuple[float, float]]:
    out: List[Tuple[float, float]] = []
    for lat, lon in coords:
        if not out:
            out.append((lat, lon))
            continue
        if _haversine_m(out[-1][0], out[-1][1], lat, lon) < min_m:
            continue
        out.append((lat, lon))
    return out


def _vehicle_path_between(gpx_data: dict, f_a: int, f_b: int,
                          step: int = 3) -> List[Tuple[float, float]]:
    out: List[Tuple[float, float]] = []
    lo, hi = (f_a, f_b) if f_a <= f_b else (f_b, f_a)
    for f in range(lo, hi + 1, max(1, step)):
        p = gpx_data.get(f)
        if not p:
            continue
        out.append((float(p["lat"]), float(p["lon"])))
    return out


def _offset_path_between(estimator: LatLongEstimator, gpx_data: dict,
                         total_frames: int, f_a: int, f_b: int,
                         side: str, step: int = 3
                         ) -> List[Tuple[float, float]]:
    """Walk gpx between two frames and offset each sample by smoothed heading
    + side. Used by sided polyline construction so the line follows road
    curvature instead of cutting straight chords across curves."""
    out: List[Tuple[float, float]] = []
    lo, hi = (f_a, f_b) if f_a <= f_b else (f_b, f_a)
    for f in range(lo, hi + 1, max(1, step)):
        p = gpx_data.get(f)
        if not p:
            continue
        lat, lon = float(p["lat"]), float(p["lon"])
        heading = estimator.calculate_bearing_for_frame(
            frame_number=f, interpolated_gpx=gpx_data,
            total_frames=total_frames, frame_interval=BEARING_SMOOTH_FRAMES,
        ) or 0.0
        lat, lon = _offset_latlng(lat, lon, heading, side, SIDED_OFFSET_M)
        out.append((lat, lon))
    return out
