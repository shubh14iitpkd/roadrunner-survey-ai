import numpy as np
from datetime import datetime
from pathlib import Path
import cv2
import xml.etree.ElementTree as ET


def parse_gpx(gpx_path: Path):
    if not gpx_path.exists():
        print("[GPX PARSER] GPX file does not exist")
        return []

    tree = ET.parse(str(gpx_path))
    root = tree.getroot()
    ns = {"gpx": "http://www.topografix.com/GPX/1/1"}
    gpx_data = []
    trkpts = root.findall(".//gpx:trkpt", ns) or root.findall(".//trkpt")
    # lat_set = set()
    # lon_set = set()
    for idx, trkpt in enumerate(trkpts):
        lat = float(trkpt.get("lat", 0))
        lon = float(trkpt.get("lon", 0))
        # lat_set.add(lat)
        # lon_set.add(lon)
        ele = trkpt.find("gpx:ele", ns) or trkpt.find("ele")
        altitude = float(ele.text) if ele is not None and ele.text else None

        # Estimate timestamp based on position if not available
        # timestamp = idx / len(list(trkpts)) * duration

        timestamp = trkpt.get("timestamp")
        if not timestamp:
            timestamp = "2025:08:17 09:04:21Z"
            print("[GPX PARSER] No timestamp found, using default")

        dt = datetime.strptime(timestamp, "%Y:%m:%d %H:%M:%SZ")
        timestamp = dt.timestamp()  # float seconds

        gpx_data.append(
            {
                "timestamp": timestamp,
                "lat": lat,
                "lon": lon,
                "altitude": altitude,
            }
        )
    # print(lat_set)
    # print(lon_set)
    return gpx_data


def interpolate_gpx(total_frames, fps, gpx_data, frame_interval, time_offset=0):
    if not total_frames or total_frames <= 0:
        return {}

    # 2. Extract Raw GPX timestamps and coords
    gpx_times = np.array([p["timestamp"] for p in gpx_data], dtype=np.float64)
    lats = np.array([p["lat"] for p in gpx_data], dtype=np.float64)
    lons = np.array([p["lon"] for p in gpx_data], dtype=np.float64)
    # print(lats)
    # print(lons)

    if len(gpx_times) > 0:
        gpx_times = gpx_times - gpx_times[0]

    gps_lookup = {}

    # Range through the frames you actually care about
    for frame_number in range(0, total_frames + 1, 1):
        # Convert frame_number to real-world UTC time
        # frame_seconds = frame_number / fps
        # target_utc = video_start_utc + frame_seconds + time_offset

        # Relative video time in seconds
        relative_sec = (frame_number / fps) + time_offset

        # LINEAR INTERPOLATION
        # np.interp handles the "staircase" problem automatically
        interp_lat = np.interp(relative_sec, gpx_times, lats)
        interp_lon = np.interp(relative_sec, gpx_times, lons)

        gps_lookup[frame_number] = {
            "lat": interp_lat,
            "lon": interp_lon,
            "timestamp": relative_sec,
        }

    return gps_lookup

def get_video_metadata(video_path):
    cap = cv2.VideoCapture(str(video_path))
    fps = cap.get(cv2.CAP_PROP_FPS)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    cap.release()
    return fps, total_frames

if __name__ == "__main__":
    video_path = "/home/ns/Code/roadvision/roadsight/roadrunner-survey-ai/backend/uploads/video_library/2025_0817_120147_F.mp4"
    gpx_path = Path(
        "/home/ns/Code/roadvision/roadsight/roadrunner-survey-ai/backend/uploads/video_library/2025_0817_120147_F.gpx"
    )

    fps, total_frames = get_video_metadata(video_path)

    gpx_data = parse_gpx(gpx_path)
    gpx_interpolated = interpolate_gpx(total_frames, fps, gpx_data, 3, 0)

    print(gpx_interpolated)
    print(len(gpx_interpolated))
