"""
GPX road snapper — hits the snapper backend (OSRM-compatible API) to pull a
raw track onto the Qatar road graph.

Ported from /home/ubuntu/processing/snap_gpx_batch.py. Trimmed for in-process
use: no batch driver, no geojson/stats sidecar files, no CLI.

Preserves the existing GPX shape produced by utils/extract_gpx.py + gpx.fmt:
    <trkpt lat="..." lon="..." timestamp="..." speed="..."></trkpt>

`snap_gpx_file(src, dst)` returns (ok, stats). `ok=False` means the caller
should fall back to the raw GPX.
"""

from __future__ import annotations

import math
import os
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Optional

import requests


# ── Env knobs (read at call time so tests / different deploys can override) ──

def _env_snapper_url() -> str:
    return os.getenv("SNAPPER_URL", "http://localhost:5000")


def _env_snap_enabled() -> bool:
    return os.getenv("GPX_SNAP_ENABLED", "true").lower() not in ("0", "false", "no")


def _env_snap_radius() -> float:
    return float(os.getenv("GPX_SNAP_RADIUS_M", "50"))


def _env_snap_min_confidence() -> float:
    return float(os.getenv("GPX_SNAP_MIN_CONFIDENCE", "0.3"))


def _env_snap_batch_size() -> int:
    return int(os.getenv("GPX_SNAP_BATCH_SIZE", "100"))


def _env_snap_batch_overlap() -> int:
    return int(os.getenv("GPX_SNAP_BATCH_OVERLAP", "5"))


def _env_snap_timeout() -> int:
    return int(os.getenv("GPX_SNAP_TIMEOUT_S", "30"))


# ── Data ─────────────────────────────────────────────────────────────────────

@dataclass
class GPXPoint:
    lat: float
    lon: float
    timestamp_str: Optional[str] = None
    speed: Optional[float] = None
    epoch: Optional[float] = None

    def distance_to(self, other: "GPXPoint") -> float:
        R = 6371000.0
        lat1, lat2 = math.radians(self.lat), math.radians(other.lat)
        dlat = math.radians(other.lat - self.lat)
        dlon = math.radians(other.lon - self.lon)
        a = (math.sin(dlat / 2) ** 2
             + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2)
        return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


# ── Parse ────────────────────────────────────────────────────────────────────

def _parse_timestamp(ts: str) -> Optional[float]:
    formats = (
        "%Y:%m:%d %H:%M:%SZ",
        "%Y:%m:%d %H:%M:%S",
        "%Y-%m-%dT%H:%M:%SZ",
        "%Y-%m-%dT%H:%M:%S",
        "%Y:%m:%d %H:%M:%S%z",
        "%Y-%m-%dT%H:%M:%S%z",
    )
    ts_clean = ts.strip()
    for fmt in formats:
        try:
            return datetime.strptime(ts_clean, fmt).timestamp()
        except ValueError:
            continue
    try:
        ts_iso = ts_clean.replace("Z", "+00:00")
        if len(ts_iso) > 10 and ts_iso[4] == ":":
            ts_iso = ts_iso[:4] + "-" + ts_iso[5:7] + "-" + ts_iso[8:]
        return datetime.fromisoformat(ts_iso).timestamp()
    except (ValueError, TypeError):
        return None


def parse_gpx(gpx_path: str) -> tuple[list[GPXPoint], str]:
    """Parse a trkpt-attribute-style GPX (exiftool output). Namespace-tolerant."""
    tree = ET.parse(gpx_path)
    root = tree.getroot()

    ns = ""
    if "}" in root.tag:
        ns = "{" + root.tag.split("}")[0].strip("{") + "}"

    track_name = ""
    name_elem = root.find(f".//{ns}name") if ns else root.find(".//name")
    if name_elem is not None and name_elem.text:
        track_name = name_elem.text

    points: list[GPXPoint] = []
    iterators = [root.iter(f"{ns}trkpt")] if ns else []
    iterators.append(root.iter("trkpt"))

    seen = False
    for it in iterators:
        for trkpt in it:
            try:
                lat = float(trkpt.attrib.get("lat", 0))
                lon = float(trkpt.attrib.get("lon", 0))
            except (ValueError, TypeError):
                continue
            if lat == 0.0 and lon == 0.0:
                continue

            ts_str = trkpt.attrib.get("timestamp")
            if not ts_str:
                time_elem = trkpt.find(f"{ns}time") if ns else trkpt.find("time")
                if time_elem is not None and time_elem.text:
                    ts_str = time_elem.text

            speed = None
            speed_str = trkpt.attrib.get("speed")
            if speed_str:
                try:
                    speed = float(speed_str)
                except (ValueError, TypeError):
                    pass

            epoch = _parse_timestamp(ts_str) if ts_str else None
            points.append(GPXPoint(lat=lat, lon=lon,
                                   timestamp_str=ts_str, speed=speed, epoch=epoch))
            seen = True
        if seen:
            break

    return points, track_name


# ── Write (format-preserving) ───────────────────────────────────────────────

def write_gpx(points: list[GPXPoint], output_path: str, track_name: str = "") -> None:
    """Emit a GPX compatible with utils/gpx.fmt — attribute-only trkpts, no ns."""
    root = ET.Element("gpx", {"version": "1.1", "creator": "RoadSightAI-GPXSnapper"})
    trk = ET.SubElement(root, "trk")
    name = ET.SubElement(trk, "name")
    name.text = track_name or Path(output_path).stem
    trkseg = ET.SubElement(trk, "trkseg")
    for pt in points:
        attribs = {"lat": f"{pt.lat:.8f}", "lon": f"{pt.lon:.8f}"}
        if pt.timestamp_str:
            attribs["timestamp"] = pt.timestamp_str
        if pt.speed is not None:
            attribs["speed"] = f"{pt.speed}"
        ET.SubElement(trkseg, "trkpt", attribs)
    tree = ET.ElementTree(root)
    ET.indent(tree, space="  ")
    with open(output_path, "w", encoding="utf-8") as f:
        f.write('<?xml version="1.0" encoding="UTF-8"?>\n')
        tree.write(f, encoding="unicode", xml_declaration=False)


# ── OSRM calls ──────────────────────────────────────────────────────────────

def snapper_health_check(snapper_url: Optional[str] = None) -> bool:
    url = snapper_url or _env_snapper_url()
    try:
        resp = requests.get(f"{url}/nearest/v1/driving/51.5,25.3", timeout=5)
        return resp.status_code == 200
    except requests.exceptions.RequestException:
        return False


def _match_batch(points: list[GPXPoint], osrm_url: str, radius: float,
                 min_confidence: float, timeout_s: int):
    coords = ";".join(f"{p.lon},{p.lat}" for p in points)
    params = {
        "overview": "false",
        "geometries": "geojson",
        "gaps": "ignore",
        "radiuses": ";".join([str(int(radius))] * len(points)),
    }
    if all(p.epoch for p in points):
        params["timestamps"] = ";".join(str(int(p.epoch)) for p in points)

    try:
        resp = requests.get(f"{osrm_url}/match/v1/driving/{coords}",
                            params=params, timeout=timeout_s)
        resp.raise_for_status()
        data = resp.json()
    except Exception:
        return None

    if data.get("code") != "Ok":
        return None

    matching_conf = [float(m.get("confidence", 1.0)) for m in data.get("matchings", []) or []]
    raw = data.get("tracepoints", [])
    if len(raw) != len(points):
        return None

    out = []
    for i, tp in enumerate(raw):
        if tp is None:
            out.append(None)
            continue
        mi = tp.get("matchings_index")
        if mi is not None and 0 <= mi < len(matching_conf):
            if matching_conf[mi] < min_confidence:
                out.append(None)
                continue
        loc = tp.get("location", [])
        if len(loc) == 2:
            dist = points[i].distance_to(GPXPoint(lat=loc[1], lon=loc[0]))
            out.append({"lat": loc[1], "lon": loc[0], "dist": dist})
        else:
            out.append(None)
    return out


def _nearest_snap(point: GPXPoint, osrm_url: str, timeout_s: int):
    try:
        resp = requests.get(
            f"{osrm_url}/nearest/v1/driving/{point.lon},{point.lat}",
            params={"number": 1}, timeout=min(timeout_s, 10),
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception:
        return None
    if data.get("code") != "Ok":
        return None
    wps = data.get("waypoints", [])
    if not wps:
        return None
    loc = wps[0].get("location", [])
    if len(loc) != 2:
        return None
    dist = point.distance_to(GPXPoint(lat=loc[1], lon=loc[0]))
    return {"lat": loc[1], "lon": loc[0], "dist": dist}


def snap_points(points: list[GPXPoint],
                osrm_url: Optional[str] = None,
                batch_size: Optional[int] = None,
                overlap: Optional[int] = None,
                search_radius: Optional[float] = None,
                min_confidence: Optional[float] = None,
                timeout_s: Optional[int] = None,
                ) -> tuple[list[GPXPoint], dict]:
    """Return 1:1 snapped points + stats. Unsnappable points keep original coords."""
    osrm_url = osrm_url or _env_snapper_url()
    batch_size = batch_size or _env_snap_batch_size()
    overlap = overlap if overlap is not None else _env_snap_batch_overlap()
    search_radius = search_radius or _env_snap_radius()
    min_confidence = min_confidence if min_confidence is not None else _env_snap_min_confidence()
    timeout_s = timeout_s or _env_snap_timeout()

    snapped: list[Optional[GPXPoint]] = [None] * len(points)
    snap_distances: list[float] = []
    stats = {
        "matched_trace": 0, "matched_nearest": 0, "kept_original": 0,
        "avg_snap_distance_m": 0.0, "max_snap_distance_m": 0.0,
    }

    i = 0
    while i < len(points):
        end = min(i + batch_size, len(points))
        batch = points[i:end]
        tps = _match_batch(batch, osrm_url, search_radius, min_confidence, timeout_s)
        if tps and len(tps) == len(batch):
            for j, tp in enumerate(tps):
                gi = i + j
                if tp is None:
                    continue
                snapped[gi] = GPXPoint(
                    lat=tp["lat"], lon=tp["lon"],
                    timestamp_str=points[gi].timestamp_str,
                    speed=points[gi].speed, epoch=points[gi].epoch,
                )
                snap_distances.append(tp["dist"])
                stats["matched_trace"] += 1
        i = end - overlap if end < len(points) else end

    # Fallback to /nearest for anything the /match layer rejected.
    for idx in [k for k, s in enumerate(snapped) if s is None]:
        pt = points[idx]
        near = _nearest_snap(pt, osrm_url, timeout_s)
        if near and near["dist"] <= search_radius:
            snapped[idx] = GPXPoint(
                lat=near["lat"], lon=near["lon"],
                timestamp_str=pt.timestamp_str, speed=pt.speed, epoch=pt.epoch,
            )
            snap_distances.append(near["dist"])
            stats["matched_nearest"] += 1
        else:
            snapped[idx] = pt
            stats["kept_original"] += 1

    if snap_distances:
        stats["avg_snap_distance_m"] = round(sum(snap_distances) / len(snap_distances), 2)
        stats["max_snap_distance_m"] = round(max(snap_distances), 2)

    return [s for s in snapped if s is not None], stats


# ── One-shot file-to-file entry point ───────────────────────────────────────

def snap_gpx_file(src_path: str, dst_path: str,
                  snapper_url: Optional[str] = None) -> tuple[bool, dict]:
    """
    Snap GPX at `src_path`, write result to `dst_path`.

    Returns (ok, stats). ok=False means caller should keep using the raw GPX;
    stats includes a `reason` key describing the failure.
    """
    if not _env_snap_enabled():
        return False, {"reason": "disabled"}

    url = snapper_url or _env_snapper_url()
    if not snapper_health_check(url):
        return False, {"reason": "snapper_unreachable", "snapper_url": url}

    try:
        points, track_name = parse_gpx(src_path)
    except Exception as e:
        return False, {"reason": "parse_failed", "error": str(e)}
    if len(points) < 2:
        return False, {"reason": "too_few_points", "count": len(points)}

    try:
        snapped, stats = snap_points(points, osrm_url=url)
    except Exception as e:
        return False, {"reason": "snap_failed", "error": str(e)}
    if len(snapped) < 2:
        return False, {"reason": "snap_empty", **stats}

    try:
        Path(dst_path).parent.mkdir(parents=True, exist_ok=True)
        write_gpx(snapped, dst_path, track_name=track_name)
    except Exception as e:
        return False, {"reason": "write_failed", "error": str(e)}

    stats["total_points"] = len(points)
    return True, stats
