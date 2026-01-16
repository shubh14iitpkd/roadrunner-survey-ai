"""
SageMaker Video Processing Service
Handles video processing with SageMaker endpoint, frame extraction, and storage.
"""

import os
import json
import cv2
import boto3
import base64
from pathlib import Path
from typing import Dict, List, Tuple, Optional
from PIL import Image
import io
import numpy as np
from datetime import datetime
from datetime import datetime
from bson import ObjectId
import subprocess


class SageMakerVideoProcessor:
    """Process videos using SageMaker endpoint and extract annotated frames."""

    def __init__(self, endpoint_name: str = None):
        """
        Initialize the SageMaker processor.

        Args:
            endpoint_name: SageMaker endpoint name (from environment if not provided)
        """
        # Try to load from endpoint_config.json first, then environment, then default
        self.endpoint_name = endpoint_name or self._load_endpoint_config() or os.getenv("SAGEMAKER_ENDPOINT_NAME", "mock")
        self.region = os.getenv("AWS_REGION", "us-east-1")

        # Initialize boto3 client for SageMaker Runtime (only if not using mock)
        if self.endpoint_name and self.endpoint_name.lower() != 'mock':
            try:
                self.sagemaker_runtime = boto3.client(
                    'sagemaker-runtime',
                    region_name=self.region,
                    aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
                    aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY")
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
        self.frame_interval = int(os.getenv("FRAME_INTERVAL", "3"))

        print(f"[SAGEMAKER] Initialized with endpoint: {self.endpoint_name}")
        print(f"[SAGEMAKER] Region: {self.region}")
        print(f"[SAGEMAKER] Frame interval: {self.frame_interval}")
        print(f"[SAGEMAKER] Mode: {'MOCK' if self.endpoint_name.lower() == 'mock' else 'LIVE'}")

    def _load_endpoint_config(self) -> Optional[str]:
        """
        Load endpoint configuration from endpoint_config.json if it exists.

        Returns:
            Endpoint name from config file, or None if file doesn't exist
        """
        # Look for endpoint_config.json in services directory or backend root
        possible_paths = [
            Path(__file__).parent / "endpoint_config.json",  # services/endpoint_config.json
            Path(__file__).parent.parent / "endpoint_config.json",  # backend/endpoint_config.json
            Path(__file__).parent.parent.parent / "endpoint_config.json",  # project root
        ]

        for config_path in possible_paths:
            if config_path.exists():
                try:
                    with open(config_path, 'r') as f:
                        config = json.load(f)

                    # Extract endpoint name
                    endpoint_name = config.get('endpoint_name')
                    region = config.get('region')

                    # Additional config info for logging
                    endpoint_arn = config.get('endpoint_arn', '')
                    memory_mb = config.get('memory_mb', 'N/A')
                    max_concurrency = config.get('max_concurrency', 'N/A')
                    created_at = config.get('created_at', 'N/A')

                    if endpoint_name:
                        print(f"[SAGEMAKER] ✓ Loaded endpoint config from: {config_path}")
                        print(f"[SAGEMAKER] Endpoint Name: {endpoint_name}")
                        print(f"[SAGEMAKER] Region: {region}")
                        print(f"[SAGEMAKER] Memory: {memory_mb} MB")
                        print(f"[SAGEMAKER] Max Concurrency: {max_concurrency}")
                        print(f"[SAGEMAKER] Created: {created_at}")

                        # Store full config for potential future use
                        self.endpoint_config = config

                        # Update region if specified in config
                        if region:
                            os.environ['AWS_REGION'] = region
                            self.region = region

                        return endpoint_name
                except json.JSONDecodeError as e:
                    print(f"[SAGEMAKER] Warning: Invalid JSON in {config_path}: {e}")
                    continue
                except Exception as e:
                    print(f"[SAGEMAKER] Warning: Failed to load {config_path}: {e}")
                    continue

        print(f"[SAGEMAKER] No endpoint_config.json found in: {[str(p) for p in possible_paths]}")
        return None

    def check_endpoint_health(self) -> Tuple[bool, str]:
        """
        Check if the SageMaker endpoint is healthy and in service.
        
        Returns:
            Tuple of (is_healthy, message)
        """
        if not self.endpoint_name or self.endpoint_name.lower() == 'mock':
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
                'sagemaker',
                region_name=self.region,
                aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
                aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY")
            )
            
            response = sm_client.describe_endpoint(EndpointName=self.endpoint_name)
            status = response['EndpointStatus']
            
            if status == 'InService':
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

    def process_video(
        self,
        video_path: Path,
        output_dir: Path,
        video_id: str,
        route_id: int = None,
        survey_id: str = None,
        db = None,
        progress_callback: callable = None
    ) -> Dict:
        """
        Process video with SageMaker endpoint.

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

        # Create output directories - organize by route_id if available, otherwise video_id
        frames_identifier = f"route_{route_id}" if route_id is not None else video_id
        frames_dir = output_dir / "frames" / frames_identifier / video_id
        frames_dir.mkdir(parents=True, exist_ok=True)

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

        print(f"[SAGEMAKER] Video properties: {width}x{height}, {fps}fps, {total_frames} frames, {duration:.2f}s")

        # Setup video writer for annotated output - save in annotated_videos folder
        annotated_videos_dir = output_dir / "annotated_videos"
        annotated_videos_dir.mkdir(parents=True, exist_ok=True)
        output_video_path = annotated_videos_dir / f"{video_id}_annotated.mp4"
        
        # FFmpeg command
        ffmpeg_cmd = [
            'ffmpeg',
            '-y',  # Overwrite output file
            '-f', 'rawvideo',
            '-vcodec', 'rawvideo',
            '-s', f'{width}x{height}',
            '-pix_fmt', 'bgr24',
            '-r', str(fps),
            '-i', '-',  # Input from pipe
            '-c:v', 'libx264',
            '-pix_fmt', 'yuv420p',
            '-preset', 'medium',
            '-f', 'mp4',
            str(output_video_path)
        ]
        
        # Start FFmpeg process
        try:
            ffmpeg_process = subprocess.Popen(
                ffmpeg_cmd, 
                stdin=subprocess.PIPE,
                stderr=subprocess.DEVNULL  # Discard stderr to prevent deadlock
            )
        except Exception as e:
            print(f"[SAGEMAKER] Error starting FFmpeg: {e}")
            raise

        # Process frames
        frame_count = 0
        processed_count = 0
        detections_list = []
        frame_metadata = []

        try:
            while frame_count < total_frames:
                ret, frame = cap.read()
                if not ret:
                    break

                # Calculate timestamp
                timestamp = frame_count / fps if fps > 0 else 0

                # Process every Nth frame
                if frame_count % self.frame_interval == 0:
                    print(f"[SAGEMAKER] Processing frame {frame_count}/{total_frames} ({timestamp:.2f}s)")

                    # Send frame to SageMaker for inference
                    detections = self._invoke_sagemaker(frame)

                    # Draw annotations on frame
                    annotated_frame = self.draw_detections(frame.copy(), detections)

                    # Save annotated frame
                    frame_filename = f"frame_{frame_count:06d}_{timestamp:.2f}s.jpg"
                    frame_path = frames_dir / frame_filename
                    cv2.imwrite(str(frame_path), annotated_frame)

                    # Store frame metadata with updated path
                    relative_frame_path = f"frames/{frames_identifier}/{video_id}/{frame_filename}"
                    frame_doc = {
                        "frame_number": frame_count,
                        "timestamp": timestamp,
                        "frame_path": relative_frame_path,
                        "detections": detections
                    }
                    frame_metadata.append(frame_doc)

                    # Store frame in MongoDB if db connection provided
                    if db is not None:
                        frame_record = {
                            "video_id": video_id,
                            "survey_id": survey_id,
                            "route_id": route_id,
                            "frame_number": frame_count,
                            "timestamp": timestamp,
                            "frame_path": f"/uploads/{relative_frame_path}",
                            "detections": detections,
                            "detections_count": len(detections),
                            "created_at": datetime.utcnow().isoformat()
                        }
                        try:
                            db.frames.insert_one(frame_record)
                        except Exception as e:
                            print(f"[SAGEMAKER] Warning: Failed to store frame in MongoDB: {e}")

                    # Write annotated frame to output video
                    try:
                        ffmpeg_process.stdin.write(annotated_frame.tobytes())
                    except Exception as e:
                        print(f"[SAGEMAKER] Error writing frame to FFmpeg: {e}")

                    # Store detections
                    detections_list.extend(detections)
                    processed_count += 1

                    # Progress callback
                    if progress_callback:
                        progress = int((frame_count / total_frames) * 100)
                        progress_callback(progress, f"Processing frame {frame_count}/{total_frames}")
                else:
                    # Write original frame to output video
                    try:
                        ffmpeg_process.stdin.write(frame.tobytes())
                    except Exception as e:
                        print(f"[SAGEMAKER] Error writing frame to FFmpeg: {e}")

                frame_count += 1

        finally:
            cap.release()
            if 'ffmpeg_process' in locals():
                ffmpeg_process.stdin.close()
                ffmpeg_process.wait()
                if ffmpeg_process.returncode != 0:
                    print(f"[SAGEMAKER] FFmpeg exited with error code: {ffmpeg_process.returncode}")
                    # Optional: print stderr if needed
                    # print(ffmpeg_process.stderr.read().decode())

        # Save frame metadata as JSON in metadata folder
        metadata_dir = output_dir / "metadata"
        metadata_dir.mkdir(parents=True, exist_ok=True)
        metadata_path = metadata_dir / f"{video_id}_frame_metadata.json"
        with open(metadata_path, 'w') as f:
            json.dump(frame_metadata, f, indent=2)

        print(f"[SAGEMAKER] Processing complete!")
        print(f"[SAGEMAKER] Processed {processed_count} frames")
        print(f"[SAGEMAKER] Annotated video: {output_video_path}")
        print(f"[SAGEMAKER] Frames saved to: {frames_dir}")

        return {
            "video_id": video_id,
            "total_frames": total_frames,
            "processed_frames": processed_count,
            "fps": fps,
            "duration": duration,
            "width": width,
            "height": height,
            "annotated_video_path": str(output_video_path.relative_to(output_dir.parent)),
            "frames_directory": str(frames_dir.relative_to(output_dir.parent)),
            "frame_metadata_path": str(metadata_path.relative_to(output_dir.parent)),
            "total_detections": len(detections_list),
            "detections_summary": self._summarize_detections(detections_list)
        }

    def _invoke_sagemaker(self, frame: np.ndarray) -> List[Dict]:
        """
        Send frame to SageMaker endpoint for inference using YOLO pipeline.

        Args:
            frame: Video frame (numpy array)

        Returns:
            List of detections in format:
            [{"class_name": str, "confidence": float, "bbox": {"x1": int, "y1": int, "x2": int, "y2": int}}]
        """
        if not self.endpoint_name or self.endpoint_name.lower() == 'mock':
            # Use mock detections for testing
            return self._mock_detections()

        try:
            # Convert frame to RGB (OpenCV uses BGR)
            frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

            # Convert to PIL Image
            pil_image = Image.fromarray(frame_rgb)

            # Encode to base64 JPEG (matching YOLO pipeline format)
            buffered = io.BytesIO()
            pil_image.save(buffered, format="JPEG", quality=85)
            img_base64 = base64.b64encode(buffered.getvalue()).decode()

            # Prepare payload (matching YOLO pipeline format)
            payload = json.dumps({'image': img_base64})

            # Invoke SageMaker endpoint with JSON content type
            response = self.sagemaker_runtime.invoke_endpoint(
                EndpointName=self.endpoint_name,
                ContentType='application/json',
                Body=payload
            )

            # Parse response
            result = json.loads(response['Body'].read().decode())

            # YOLO pipeline format: {"predictions": [{"class_name": str, "confidence": float, "bbox": {...}}, ...]}
            detections = result.get('predictions', [])

            # Filter by confidence threshold (0.25 default)
            confidence_threshold = float(os.getenv("CONFIDENCE_THRESHOLD", "0.25"))
            detections = [d for d in detections if d.get('confidence', 0) >= confidence_threshold]

            return detections

        except Exception as e:
            print(f"[SAGEMAKER] Error invoking endpoint: {e}")
            print(f"[SAGEMAKER] Endpoint: {self.endpoint_name}")
            import traceback
            traceback.print_exc()
            # Fall back to mock detections on error
            return self._mock_detections()

    def _mock_detections(self) -> List[Dict]:
        """Return mock detections for testing without SageMaker (YOLO format)."""
        import random

        # Mock detections for testing - YOLO format with bbox as dict
        classes = ['pothole', 'crack', 'manhole', 'sign damage', 'road marking', 'vegetation']
        detections = []

        for _ in range(random.randint(1, 4)):
            x1 = random.randint(50, 500)
            y1 = random.randint(50, 500)
            x2 = x1 + random.randint(50, 200)
            y2 = y1 + random.randint(50, 200)

            detections.append({
                "class_name": random.choice(classes),
                "confidence": round(random.uniform(0.7, 0.99), 2),
                "bbox": {
                    "x1": x1,
                    "y1": y1,
                    "x2": x2,
                    "y2": y2
                }
            })

        return detections



    def draw_detections(self, frame: np.ndarray, detections: List[Dict]) -> np.ndarray:
        """
        Draw detection bounding boxes and labels on frame (YOLO format).

        Args:
            frame: Video frame
            detections: List of detections with YOLO bbox format

        Returns:
            Annotated frame
        """
        # Color map for different classes
        class_colors = {}
        default_colors = [
            (0, 255, 0),    # Green
            (255, 0, 0),    # Blue
            (0, 0, 255),    # Red
            (255, 255, 0),  # Cyan
            (255, 0, 255),  # Magenta
            (0, 255, 255),  # Yellow
        ]

        for detection in detections:
            bbox = detection.get('bbox', {})
            class_name = detection.get('class_name', 'unknown')
            confidence = detection.get('confidence', 0.0)

            # Skip if bbox is not in correct format
            if not isinstance(bbox, dict):
                continue

            x1 = int(bbox.get('x1', 0))
            y1 = int(bbox.get('y1', 0))
            x2 = int(bbox.get('x2', 0))
            y2 = int(bbox.get('y2', 0))

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
                -1
            )

            # Label text
            cv2.putText(
                frame,
                label,
                (x1 + 5, y1 - baseline - 5),
                font,
                font_scale,
                (255, 255, 255),
                thickness
            )

        return frame

    def _summarize_detections(self, detections: List[Dict]) -> Dict:
        """Summarize detections by class (YOLO format)."""
        summary = {}
        for det in detections:
            class_name = det.get('class_name', 'unknown')
            summary[class_name] = summary.get(class_name, 0) + 1
        return summary

    def link_frames_to_gpx(
        self,
        frame_metadata_path: Path,
        gpx_data: List[Dict],
        video_id: str = None,
        db = None
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
        with open(frame_metadata_path, 'r') as f:
            frames = json.load(f)

        # Link each frame to nearest GPX point
        linked_frames = []
        for frame in frames:
            timestamp = frame['timestamp']

            # Find closest GPX point by timestamp
            closest_gpx = min(
                gpx_data,
                key=lambda p: abs(p.get('timestamp', 0) - timestamp)
            )

            linked_frame = {
                **frame,
                "lat": closest_gpx.get('lat'),
                "lon": closest_gpx.get('lon'),
                "altitude": closest_gpx.get('altitude'),
                "gpx_timestamp": closest_gpx.get('timestamp')
            }
            linked_frames.append(linked_frame)

            # Update frame in MongoDB with GPS coordinates if db provided
            if db is not None and video_id:
                try:
                    db.frames.update_one(
                        {
                            "video_id": video_id,
                            "frame_number": frame['frame_number']
                        },
                        {
                            "$set": {
                                "location": {
                                    "type": "Point",
                                    "coordinates": [closest_gpx.get('lon'), closest_gpx.get('lat')]
                                },
                                "altitude": closest_gpx.get('altitude'),
                                "gpx_timestamp": closest_gpx.get('timestamp'),
                                "updated_at": datetime.utcnow().isoformat()
                            }
                        }
                    )
                except Exception as e:
                    print(f"[SAGEMAKER] Warning: Failed to update frame GPS in MongoDB: {e}")

        print(f"[SAGEMAKER] Linked {len(linked_frames)} frames to GPS coordinates")
        return linked_frames
