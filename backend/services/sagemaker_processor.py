import time
import os
import json
import cv2
import boto3
import botocore.config
import base64
from pathlib import Path
from typing import Dict, List, Tuple, Optional
from PIL import Image
import io
import numpy as np
from datetime import datetime
from bson import ObjectId
import subprocess
from concurrent.futures import Executor, ThreadPoolExecutor, as_completed

# from deep_sort_realtime.deepsort_tracker import DeepSort


class SageMakerVideoProcessor:
    """Process videos using SageMaker endpoint and extract annotated frames."""

    def __init__(self, endpoint_name: str = None):
        """
        Initialize the SageMaker processor.

        Args:
            endpoint_name: SageMaker endpoint name (from environment if not provided)
        """
        # Try to load from endpoint_config.json first, then environment, then default
        self.config = self._load_endpoint_config()
        self.endpoint_name = endpoint_name or self.config.get("endpoint_name", "mock")
        self.region = self.config.get("region", "ap-south-1")

        # Initialize boto3 client for SageMaker Runtime (only if not using mock)
        config = botocore.config.Config(
            retries={
                "mode": "adaptive",
                "max_attempts": 10,  # Try harder before giving up
            },
            max_pool_connections=50,
        )
        if self.endpoint_name and self.endpoint_name.lower() != "mock":
            try:
                self.sagemaker_runtime = boto3.client(
                    "sagemaker-runtime",
                    region_name=self.region,
                    aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
                    aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
                    config=config,
                )
                print(f"[SAGEMAKER] Boto3 client initialized for region: {self.region}")
            except Exception as e:
                print(f"[SAGEMAKER] Warning: Failed to initialize boto3 client: {e}")
                print(f"[SAGEMAKER] Falling back to mock mode")
                self.endpoint_name = "mock"
                self.sagemaker_runtime = None
        else:
            self.sagemaker_runtime = None

        # Frame extraction interval (process every Nth frame)
        self.frame_interval = int(self.config.get("frame_interval", "3"))

        # Max concurrent requests to SageMaker
        self.max_concurrency = int(self.config.get("max_concurrency", "5"))

        # Inference image size (YOLO standard)
        self.inference_size = 640

        self.has_gpu = self._check_gpu_availability()
        self.chunk_size = int(self.config.get("chunk_size", "500"))
        # self.tracker = DeepSort(max_age=30, n_init=3, nms_max_overlap=0.9)

        print(f"[SAGEMAKER] Initialized with endpoint: {self.endpoint_name}")
        print(f"[SAGEMAKER] Region: {self.region}")
        print(f"[SAGEMAKER] Frame interval: {self.frame_interval}")
        print(f"[SAGEMAKER] Max concurrency: {self.max_concurrency}")
        print(
            f"[SAGEMAKER] Mode: {'MOCK' if self.endpoint_name.lower() == 'mock' else 'LIVE'}"
        )

    def _check_gpu_availability(self) -> bool:
        """Checks if an NVIDIA GPU is present and accessible via drivers."""
        try:
            # nvidia-smi returns 0 if GPU is working, non-zero if error/missing
            code = subprocess.check_call(
                ["nvidia-smi"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
            )

            if code == 0:
                print(
                    "[SAGEMAKER] Hardware Acceleration: ENABLED (NVIDIA GPU detected)"
                )
                return True
            else:
                print(
                    "[SAGEMAKER] Hardware Acceleration: DISABLED (Falling back to CPU)"
                )
                return False
        except (subprocess.CalledProcessError, FileNotFoundError):
            print("[SAGEMAKER] Hardware Acceleration: DISABLED (Falling back to CPU)")
            return False

    def _load_endpoint_config(self) -> Optional[str]:
        """
        Load endpoint configuration from endpoint_config.json if it exists.

        Returns:
            Endpoint name from config file, or None if file doesn't exist
        """
        # Look for endpoint_config.json in services directory or backend root
        possible_paths = [
            Path(__file__).parent
            / "endpoint_config.json",  # services/endpoint_config.json
            Path(__file__).parent.parent
            / "endpoint_config.json",  # backend/endpoint_config.json
            Path(__file__).parent.parent.parent
            / "endpoint_config.json",  # project root
        ]

        for config_path in possible_paths:
            print(config_path, config_path.exists())
            if config_path.exists():
                try:
                    with open(config_path, "r") as f:
                        config = json.load(f)

                    return config
                except json.JSONDecodeError as e:
                    print(f"[SAGEMAKER] Warning: Invalid JSON in {config_path}: {e}")
                    continue
                except Exception as e:
                    print(f"[SAGEMAKER] Warning: Failed to load {config_path}: {e}")
                    continue

        print(
            f"[SAGEMAKER] No endpoint_config.json found in: {[str(p) for p in possible_paths]}"
        )
        return {}

    def get_ffmpeg_command(
        self, width: int, height: int, fps: int, output_path: Path
    ) -> List[str]:
        """
        Generates the optimal FFmpeg command for the current hardware.
        """
        cmd = [
            "ffmpeg",
            "-y",
            "-f",
            "rawvideo",
            "-vcodec",
            "rawvideo",
            "-s",
            f"{width}x{height}",
            "-pix_fmt",
            "bgr24",
            "-r",
            str(fps),
            "-i",
            "-",
        ]

        if self.has_gpu:
            cmd.extend(
                [
                    "-c:v",
                    "h264_nvenc",
                    "-preset",
                    "p2",
                    "-tune",
                    "ull",
                    "-rc",
                    "vbr",
                    "-cq",
                    "24",
                ]
            )
        else:
            # --- CPU (x264) FALLBACK ---
            cmd.extend(
                [
                    "-c:v",
                    "libx264",
                    "-preset",
                    "ultrafast",
                    "-crf",
                    "25",
                    "-threads",
                    "0",
                ]
            )

        cmd.extend(["-pix_fmt", "yuv420p", str(output_path)])
        return cmd

    def process_video(
        self,
        video_path: Path,
        output_dir: Path,
        video_id: str,
        route_id: int = None,
        survey_id: str = None,
        db=None,
        progress_callback: callable = None,
    ) -> Dict:
        """
        Process video with SageMaker endpoint using chunked two-phase architecture.

        Processes video in chunks of ~500 frames to minimize memory usage while
        maximizing inference parallelism. Each chunk:
        1. Phase 1: Read frames and submit all inference requests in parallel
        2. Phase 2: Write all frames (annotated + original) to FFmpeg in order

        Args:
            video_path: Path to input video
            output_dir: Directory to store outputs
            video_id: Unique video identifier
            route_id: Route ID for organizing frames by road (optional, falls back to video_id)
            survey_id: Survey ID to link frames
            db: MongoDB database connection for storing frame metadata
            progress_callback: Optional callback for progress updates

        Returns:
            Dictionary with processing results
        """
        print(f"[SAGEMAKER] Processing video: {video_path}")
        print(f"[SAGEMAKER] Route ID: {route_id}, Video ID: {video_id}")

        # Chunk size for processing (configurable via environment)
        chunk_size = self.chunk_size

        # Create output directories - organize by route_id if available, otherwise video_id
        # frames_identifier = f"route_{route_id}" if route_id is not None else video_id
        # frames_dir = output_dir / "frames" / frames_identifier / video_id
        # frames_dir.mkdir(parents=True, exist_ok=True)

        # Open video
        cap = cv2.VideoCapture(str(video_path))
        if not cap.isOpened():
            raise ValueError(f"Cannot open video: {video_path}")

        # Get video properties
        fps = int(cap.get(cv2.CAP_PROP_FPS))
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        duration = total_frames / fps if fps > 0 else 0

        print(
            f"[SAGEMAKER] Video properties: {width}x{height}, {fps}fps, {total_frames} frames, {duration:.2f}s"
        )
        print(f"[SAGEMAKER] Using chunk size: {chunk_size}")

        # Setup video writer for annotated output - save in annotated_videos folder
        annotated_videos_dir = output_dir / "annotated_videos"
        annotated_videos_dir.mkdir(parents=True, exist_ok=True)
        output_video_path = annotated_videos_dir / f"{video_id}_annotated.mp4"

        # FFmpeg command
        ffmpeg_cmd = self.get_ffmpeg_command(width, height, fps, output_video_path)
        print(ffmpeg_cmd)

        # Start FFmpeg process
        try:
            ffmpeg_process = subprocess.Popen(
                ffmpeg_cmd,
                stdin=subprocess.PIPE,
                stderr=subprocess.DEVNULL,  # Discard stderr to prevent deadlock
            )
            if not ffmpeg_process.stdin:
                raise Exception("ffmpeg input stream not found")
        except Exception as e:
            print(f"[SAGEMAKER] Error starting FFmpeg: {e}")
            raise

        # Processing state
        processed_count = 0
        detections_list = []
        frame_metadata = []

        try:
            with ThreadPoolExecutor(max_workers=self.max_concurrency) as executor:
                # Process video in chunks
                for chunk_start in range(0, total_frames, chunk_size):
                    chunk_end = min(chunk_start + chunk_size, total_frames)
                    print(
                        f"[SAGEMAKER] Processing chunk: frames {chunk_start}-{chunk_end-1}"
                    )

                    # ========== PHASE 1: Read chunk and submit inference ==========
                    chunk_frames = []  # List of (frame_num, frame, timestamp)
                    futures = {}  # future -> chunk_index

                    for frame_num in range(chunk_start, chunk_end):
                        ret, frame = cap.read()
                        if not ret:
                            print(
                                f"[SAGEMAKER] Warning: Could not read frame {frame_num}"
                            )
                            break

                        timestamp = frame_num / fps if fps > 0 else 0
                        chunk_frames.append((frame_num, frame, timestamp))

                        # Submit inference for every Nth frame
                        if frame_num % self.frame_interval == 0:
                            future = executor.submit(
                                self._process_single_frame,
                                frame,
                                width,
                                height,
                                frame_num,
                            )
                            chunk_idx = len(chunk_frames) - 1  # Index within chunk
                            futures[future] = chunk_idx

                    # Wait for all chunk inference to complete
                    inference_results = {}  # chunk_index -> detections
                    for future in as_completed(futures):
                        chunk_idx = futures[future]
                        try:
                            single_frame_results = future.result()
                        except Exception as e:
                            print(f"[SAGEMAKER] Error in inference: {e}")
                            frame_num, frame, timestamp = chunk_frames[chunk_idx]
                            single_frame_results = (
                                None,
                                chunk_frames[chunk_idx][1],
                                [],
                            )
                        inference_results[chunk_idx] = single_frame_results

                    # ========== PHASE 2: Write all chunk frames to FFmpeg ==========
                    for chunk_idx, (frame_num, frame, timestamp) in enumerate(
                        chunk_frames
                    ):
                        if chunk_idx in inference_results:
                            # This is an inference frame - draw annotations
                            _, annotated_frame, detections = inference_results[
                                chunk_idx
                            ]
                            # annotated_frame = self.draw_detections(frame.copy(), detections)

                            # # Store frame metadata
                            # frame_doc = {
                            #     "frame_number": frame_num,
                            #     "timestamp": timestamp,
                            #     "detections": detections
                            # }
                            frame_metadata.append(
                                {
                                    "frame_num": frame_num,
                                    "timestamp": timestamp,
                                    "detections": detections,
                                }
                            )

                            # Store frame in MongoDB if db connection provided
                            if db is not None:
                                frame_record = {
                                    "video_id": video_id,
                                    "survey_id": survey_id,
                                    "route_id": route_id,
                                    "frame_number": frame_num,
                                    "timestamp": timestamp,
                                    "detections": detections,
                                    "detections_count": len(detections),
                                    "created_at": datetime.utcnow().isoformat(),
                                }
                                try:
                                    db.frames.insert_one(frame_record)
                                except Exception as e:
                                    print(
                                        f"[SAGEMAKER] Warning: Failed to store frame in MongoDB: {e}"
                                    )

                            # Write annotated frame to output video
                            try:
                                ffmpeg_process.stdin.write(annotated_frame.tobytes())
                            except Exception as e:
                                print(f"[SAGEMAKER] Error writing frame to FFmpeg: {e}")

                            # Store detections
                            detections_list.extend(detections)
                            processed_count += 1
                        else:
                            # Non-inference frame - write original
                            try:
                                ffmpeg_process.stdin.write(frame.tobytes())
                            except Exception as e:
                                print(f"[SAGEMAKER] Error writing frame to FFmpeg: {e}")

                        # Progress callback
                        if progress_callback:
                            progress = int((frame_num / total_frames) * 100)
                            progress_callback(
                                progress, f"Processing frame {frame_num}/{total_frames}"
                            )

                    # Free memory for this chunk
                    del chunk_frames, futures, inference_results

        finally:
            cap.release()
            if "ffmpeg_process" in locals():
                ffmpeg_process.stdin.close()
                ffmpeg_process.wait()
                if ffmpeg_process.returncode != 0:
                    print(
                        f"[SAGEMAKER] FFmpeg exited with error code: {ffmpeg_process.returncode}"
                    )

        # Save frame metadata as JSON in metadata folder
        metadata_dir = output_dir / "metadata"
        metadata_dir.mkdir(parents=True, exist_ok=True)
        metadata_path = metadata_dir / f"{video_id}_frame_metadata.json"
        with open(metadata_path, "w") as f:
            json.dump(frame_metadata, f, indent=2)

        print(f"[SAGEMAKER] Processing complete!")
        print(f"[SAGEMAKER] Processed {processed_count} inference frames")
        print(f"[SAGEMAKER] Annotated video: {output_video_path}")
        # print(f"[SAGEMAKER] Frames saved to: {frames_dir}")

        return {
            "video_id": video_id,
            "total_frames": total_frames,
            "processed_frames": processed_count,
            "fps": fps,
            "duration": duration,
            "width": width,
            "height": height,
            "annotated_video_path": str(
                output_video_path.relative_to(output_dir.parent)
            ),
            # "frames_directory": str(frames_dir.relative_to(output_dir.parent)),
            "frame_metadata_path": str(metadata_path.relative_to(output_dir.parent)),
            "total_detections": len(detections_list),
            "detections_summary": self._summarize_detections(detections_list),
        }

    def _invoke_sagemaker(
        self, frame: np.ndarray, orig_width: int, orig_height: int
    ) -> List[Dict]:
        resized_frame = cv2.resize(frame, (self.inference_size, self.inference_size))

        scale_x = orig_width / self.inference_size
        scale_y = orig_height / self.inference_size

        frame_rgb = cv2.cvtColor(resized_frame, cv2.COLOR_BGR2RGB)
        pil_image = Image.fromarray(frame_rgb)
        buffered = io.BytesIO()
        pil_image.save(buffered, format="JPEG", quality=85)
        img_base64 = base64.b64encode(buffered.getvalue()).decode()

        payload = json.dumps({"image": img_base64})

        try:
            if (
                not self.endpoint_name
                or self.endpoint_name.lower() == "mock"
                or not self.sagemaker_runtime
            ):
                det = self._mock_detections()

                # Filter by confidence threshold (0.25 default)
                confidence_threshold = float(os.getenv("CONFIDENCE_THRESHOLD", "0.25"))
                mock_detections = [
                    d for d in det if d.get("confidence", 0) >= confidence_threshold
                ]

                # Scale box back to original dimensions (accept both bbox and box, store as box)
                for d in mock_detections:
                    box = d.get("box") or d.get("bbox")
                    if isinstance(box, list) and len(box) == 4:
                        d["box"] = [
                            box[0] * scale_x,
                            box[1] * scale_y,
                            box[2] * scale_x,
                            box[3] * scale_y,
                        ]
                    elif isinstance(box, dict):
                        # Handle dict format (convert to array and scale)
                        d["box"] = [
                            box.get("x1", 0) * scale_x,
                            box.get("y1", 0) * scale_y,
                            box.get("x2", 0) * scale_x,
                            box.get("y2", 0) * scale_y,
                        ]
                    # Remove bbox key if present to ensure consistency
                    d.pop("bbox", None)
                return mock_detections

            response = self.sagemaker_runtime.invoke_endpoint(
                EndpointName=self.endpoint_name,
                ContentType="application/json",
                Body=payload,
            )

            result = json.loads(response["Body"].read().decode())
            detections = result.get("detections", [])

            confidence_threshold = float(os.getenv("CONFIDENCE_THRESHOLD", "0.25"))
            detections = [
                d for d in detections if d.get("confidence", 0) >= confidence_threshold
            ]

            # Scale bbox for original image
            for d in detections:
                box = d.get("box") or d.get("bbox")
                if isinstance(box, list) and len(box) == 4:
                    d["box"] = [
                        box[0] * scale_x,
                        box[1] * scale_y,
                        box[2] * scale_x,
                        box[3] * scale_y,
                    ]
                    d.pop("bbox", None)
                elif isinstance(box, dict):
                    # Handle dict format (convert to array and scale)
                    d["box"] = [
                        box.get("x1", 0) * scale_x,
                        box.get("y1", 0) * scale_y,
                        box.get("x2", 0) * scale_x,
                        box.get("y2", 0) * scale_y,
                    ]
            return detections

        except Exception as e:
            print(f"[SAGEMAKER] Error invoking endpoint: {e}")
            print(f"[SAGEMAKER] Endpoint: {self.endpoint_name}")
            import traceback

            traceback.print_exc()
            # Fall back to mock detections on error
            return self._mock_detections()

    def draw_detections(self, frame: np.ndarray, detections: List[Dict]) -> np.ndarray:
        """
        Draw detection bounding boxes and labels on frame (YOLO format).

        Args:
            frame: Video frame
            detections: List of detections with box format (accepts both box and bbox)

        Returns:
            Annotated frame
        """
        # Color map for different classes
        class_colors = {}
        default_colors = [
            (0, 255, 0),  # Green
            (255, 0, 0),  # Blue
            (0, 0, 255),  # Red
            (255, 255, 0),  # Cyan
            (255, 0, 255),  # Magenta
            (0, 255, 255),  # Yellow
        ]

        for detection in detections:
            # Accept both box and bbox formats
            box = detection.get("box") or detection.get("bbox", [])
            class_name = detection.get("class_name", "unknown")
            confidence = detection.get("confidence", 0.0)

            # Handle box as array [x1, y1, x2, y2] or dict {x1, y1, x2, y2}
            if isinstance(box, list) and len(box) == 4:
                x1, y1, x2, y2 = int(box[0]), int(box[1]), int(box[2]), int(box[3])
            elif isinstance(box, dict):
                x1 = int(box.get("x1", 0))
                y1 = int(box.get("y1", 0))
                x2 = int(box.get("x2", 0))
                y2 = int(box.get("y2", 0))
            else:
                continue  # Skip invalid box format

            # Assign color to class
            if class_name not in class_colors:
                color_idx = len(class_colors) % len(default_colors)
                class_colors[class_name] = default_colors[color_idx]

            color = class_colors[class_name]

            # Draw bounding box (thicker for visibility)
            cv2.rectangle(frame, (x1, y1), (x2, y2), color, 3)

            # Draw label with background
            label = f"{class_name}: {confidence:.2f}"
            font = cv2.FONT_HERSHEY_SIMPLEX
            font_scale = 0.7
            thickness = 2

            (label_w, label_h), baseline = cv2.getTextSize(
                label, font, font_scale, thickness
            )

            # Label background
            cv2.rectangle(
                frame,
                (x1, y1 - label_h - baseline - 10),
                (x1 + label_w + 10, y1),
                color,
                -1,
            )

            # Label text
            cv2.putText(
                frame,
                label,
                (x1 + 5, y1 - baseline - 5),
                font,
                font_scale,
                (255, 255, 255),
                thickness,
            )

        return frame

    def _process_single_frame(self, frame, width, height, frame_num):
        detections = self._invoke_sagemaker(frame, width, height)

        annotated_frame = self.draw_detections(frame, detections)

        return (frame_num, annotated_frame, detections)

    def _summarize_detections(self, detections: List[Dict]) -> Dict:
        """Summarize detections by class (YOLO format)."""
        summary = {}
        for det in detections:
            class_name = det.get("class_name", "unknown")
            summary[class_name] = summary.get(class_name, 0) + 1
        return summary

    def link_frames_to_gpx(
        self,
        frame_metadata_path: Path,
        gpx_data: List[Dict],
        video_id: str = "",
        db=None,
    ) -> List[Dict]:
        """
        Link video frames to GPX coordinates based on timestamps.

        Args:
            frame_metadata_path: Path to frame metadata JSON
            gpx_data: List of GPX points with timestamps
            video_id: Video ID to update frames in MongoDB
            db: MongoDB database connection

        Returns:
            List of frames with linked GPS coordinates
        """
        print(f"[SAGEMAKER] Linking frames to GPX data")

        # Load frame metadata
        with open(frame_metadata_path, "r") as f:
            frames = json.load(f)

        # Link each frame to nearest GPX point
        linked_frames = []
        for frame in frames:
            timestamp = frame["timestamp"]

            # Find closest GPX point by timestamp
            closest_gpx = min(
                gpx_data, key=lambda p: abs(p.get("timestamp", 0) - timestamp)
            )

            linked_frame = {
                **frame,
                "lat": closest_gpx.get("lat"),
                "lon": closest_gpx.get("lon"),
                "altitude": closest_gpx.get("altitude"),
                "gpx_timestamp": closest_gpx.get("timestamp"),
            }
            linked_frames.append(linked_frame)

            # Update frame in MongoDB with GPS coordinates if db provided
            if db is not None and video_id:
                try:
                    db.frames.update_one(
                        {"video_id": video_id, "frame_number": frame["frame_number"]},
                        {
                            "$set": {
                                "location": {
                                    "type": "Point",
                                    "coordinates": [
                                        closest_gpx.get("lon"),
                                        closest_gpx.get("lat"),
                                    ],
                                },
                                "altitude": closest_gpx.get("altitude"),
                                "gpx_timestamp": closest_gpx.get("timestamp"),
                                "updated_at": datetime.utcnow().isoformat(),
                            }
                        },
                    )
                except Exception as e:
                    print(
                        f"[SAGEMAKER] Warning: Failed to update frame GPS in MongoDB: {e}"
                    )

        print(f"[SAGEMAKER] Linked {len(linked_frames)} frames to GPS coordinates")
        return linked_frames

    def _mock_detections(self) -> List[Dict]:
        """Return mock detections for testing without SageMaker (YOLO format)."""
        import random
        import time  # <--- Make sure to import time

        # --- CALIBRATED LATENCY SIMULATION ---
        # Based on logs:
        # ~80% are between 0.6s and 0.9s
        # ~20% are spikes between 1.1s and 2.5s

        chance = random.random()
        if chance < 0.80:
            # Standard request
            simulated_time = random.uniform(0.65, 0.95)
        elif chance < 0.95:
            # Heavy request / Network jitter
            simulated_time = random.uniform(1.1, 1.8)
        else:
            # Major spike (like your 2.4s logs)
            simulated_time = random.uniform(2.0, 2.6)

        time.sleep(simulated_time)

        # Mock detections for testing - format with box as array [x1,y1,x2,y2]
        classes = [
            "pothole",
            "crack",
            "manhole",
            "sign damage",
            "road marking",
            "vegetation",
        ]
        detections = []

        for _ in range(random.randint(1, 4)):
            x1 = random.randint(50, 500)
            y1 = random.randint(50, 500)
            x2 = x1 + random.randint(50, 200)
            y2 = y1 + random.randint(50, 200)

            detections.append(
                {
                    "class_name": random.choice(classes),
                    "confidence": round(random.uniform(0.7, 0.99), 2),
                    "box": [x1, y1, x2, y2],
                }
            )
        return detections

    def check_endpoint_health(self) -> Tuple[bool, str]:
        """
        Check if the SageMaker endpoint is healthy and in service.

        Returns:
            Tuple of (is_healthy, message)
        """
        if not self.endpoint_name or self.endpoint_name.lower() == "mock":
            msg = f"Endpoint configuration is '{self.endpoint_name}' (Mock mode)"
            print(f"[SAGEMAKER] Health check failed: {msg}")
            return False, msg

        if not self.sagemaker_runtime:
            msg = "AWS credentials not found or invalid (boto3 client failed to initialize)"
            print(f"[SAGEMAKER] Health check failed: {msg}")
            return False, msg

        try:
            # We need a sagemaker client (not runtime) to check status
            sm_client = boto3.client(
                "sagemaker",
                region_name=self.region,
                aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
                aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
            )

            response = sm_client.describe_endpoint(EndpointName=self.endpoint_name)
            status = response["EndpointStatus"]

            if status == "InService":
                msg = f"SageMaker endpoint '{self.endpoint_name}' is InService"
                print(f"[SAGEMAKER] Health check passed: {msg}")
                return True, msg
            else:
                msg = f"SageMaker endpoint '{self.endpoint_name}' status is '{status}' (expected 'InService')"
                print(f"[SAGEMAKER] Health check failed: {msg}")
                return False, msg

        except Exception as e:
            msg = f"AWS Error: {str(e)}"
            print(f"[SAGEMAKER] Health check error: {msg}")
            return False, msg
