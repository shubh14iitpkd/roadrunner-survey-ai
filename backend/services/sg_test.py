"""
Note to self: We don't store frame afterwords so theres no need to
pass a copy of it to the executor. To optimize code I remove passing
a copy of frame but in future if we store or use frame, we might need that
"""

import time
import os
import sys
from pathlib import Path
from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv()
# Add backend to path so imports work
service_dir = os.path.dirname(os.path.abspath(__file__))
current_dir = os.path.dirname(service_dir)

if current_dir not in sys.path:
    sys.path.append(current_dir)

from services.sagemaker_processor import SageMakerVideoProcessor


import time


def format_execution_time(start_time: float, end_time: float) -> str:
    """Calculates duration and returns a human-readable string."""
    duration = end_time - start_time

    if duration < 60:
        return f"{duration:.2f} seconds"

    minutes = int(duration // 60)
    seconds = int(duration % 60)
    return f"{minutes} minute(s) and {seconds} second(s)"


def test_sagemaker_local():
    # User specified video
    video_path_str = "/home/ns/Code/roadvision/roadsight/roadrunner-survey-ai/backend/services/1_video.mp4"
    gpx_path_str = "/home/ns/Code/roadvision/roadsight/roadrunner-survey-ai/backend/services/1_gpx.gpx"
    # Custom DB name to avoid clutter
    custom_db_name = "roadrunner_test_tracking"

    video_path = Path(video_path_str)
    if not video_path.exists():
        print(f"Error: Video not found at {video_path}")
        # Try to find it in the current workspace just in case
        # alt_path = Path(current_dir) / "uploads" / "2025_0817_115147_F.mp4"
        # if alt_path.exists():
        #     print(f"Found video at alternative path: {alt_path}")
        #     video_path = alt_path
        # else:
        #     print("Could not find video file.")
        return

    print(f"Using video: {video_path}")

    # Connect to MongoDB
    mongo_uri = os.getenv("MONGO_URI", "mongodb://localhost:27017")
    try:
        client = MongoClient(mongo_uri)
        db = client[custom_db_name]
        print(f"Connected to test database: {custom_db_name}")
    except Exception as e:
        print(f"Failed to connect to MongoDB: {e}")
        return

    # Initialize Processor
    # The processor uses env vars or endpoint_config.json.
    # If endpoint_name is not set or 'mock', it uses mock.
    start = time.perf_counter()
    print(f"[*] Starting ML Pipeline at {time.strftime('%H:%M:%S')}...")
    processor = SageMakerVideoProcessor()

    # Output directory in the backend folder
    output_dir = Path(service_dir) / "test_output"
    output_dir.mkdir(parents=True, exist_ok=True)

    # Test parameters
    video_id = "test_video_local_01"

    print("\n--- Starting Processing ---\n")
    try:
        result = processor.process_video(
            video_path=video_path,
            output_dir=output_dir,
            video_id=video_id,
            db=db,  # Pass the test database
            gpx_path=gpx_path_str,
            progress_callback=lambda p, m: print(f"[{p}%] {m}"),
        )

        print("\n--- Processing Complete ---")
        print("Result Summary:")
        for key, value in result.items():
            if key != "detections_summary":
                print(f"  {key}: {value}")
        print("Detections Summary:", result.get("detections_summary"))

        print(f"\nCheck output in: {output_dir}")
        end = time.perf_counter()
        human_time = format_execution_time(start, end)
        print(f"\n[SUCCESS] Total Processing Time: {human_time}")
    except Exception as e:
        print(f"\nError during processing: {e}")
        import traceback

        traceback.print_exc()


if __name__ == "__main__":
    test_sagemaker_local()
