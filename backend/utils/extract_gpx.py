import os
import subprocess
from pathlib import Path

basedir = Path(os.path.abspath(os.path.dirname(__file__)))
fmt_file = basedir / "gpx.fmt"

def extract_gpx(video_path, fmt_file=fmt_file):
    video_file = Path(video_path)
    gpx_path = video_file.with_suffix(".gpx")
    command = [
        "exiftool",
        "-ee",
        "-if", "$gpslatitude",
        '-if', '$gpslongitude',
        "-p", str(fmt_file),
        str(video_file)
    ]
    
    try:
        with open(gpx_path, 'w') as f:
            subprocess.run(command, stdout=f, stderr=subprocess.PIPE, text=True)
        return str(gpx_path)
    except Exception as e:
        print(f"Error: {e}")
        return None