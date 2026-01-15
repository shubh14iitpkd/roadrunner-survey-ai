"""
Video Processing Service
Processes videos using SageMaker YOLO endpoint and creates annotated videos
"""

import os
import json
import base64
import time
import cv2
from io import BytesIO
from PIL import Image
from pathlib import Path
import boto3
import sagemaker
from sagemaker.predictor import Predictor
from sagemaker.serializers import JSONSerializer
from sagemaker.deserializers import JSONDeserializer
import subprocess


class VideoProcessor:
    """Process videos with YOLO model on SageMaker"""

    def __init__(self):
        # Load endpoint configuration
        config_path = Path(__file__).resolve().parents[2] / "pipeline" / "endpoint_config.json"
        try:
            with open(config_path, 'r') as f:
                config = json.load(f)
            self.endpoint_name = config['endpoint_name']
            self.region = config['region']
        except FileNotFoundError:
            # Fallback to defaults
            self.endpoint_name = "yolo-v8-endpoint"
            self.region = "ap-south-1"

        # Processing parameters
        self.frame_interval = 3  # Process every 3rd frame
        self.confidence_threshold = 0.25

        # Color map for different classes
        self.class_colors = {}
        self.default_colors = [
            (0, 255, 0),    # Green
            (255, 0, 0),    # Blue
            (0, 0, 255),    # Red
            (255, 255, 0),  # Cyan
            (255, 0, 255),  # Magenta
            (0, 255, 255),  # Yellow
        ]

        # Initialize predictor
        self.predictor = None
        self._init_predictor()

    def _init_predictor(self):
        """Initialize SageMaker predictor"""
        try:
            self.predictor = Predictor(
                endpoint_name=self.endpoint_name,
                serializer=JSONSerializer(),
                deserializer=JSONDeserializer(),
                sagemaker_session=sagemaker.Session(
                    boto_session=boto3.Session(region_name=self.region)
                )
            )
        except Exception as e:
            print(f"Warning: Could not initialize SageMaker predictor: {e}")
            print("Video processing will continue without AI annotations")

    def process_video(self, input_path: str, output_path: str, progress_callback=None) -> dict:
        """
        Process a video file with YOLO detection

        Args:
            input_path: Path to input video file
            output_path: Path for output annotated video
            progress_callback: Optional callback function(progress_percent, status_message)

        Returns:
            dict with processing statistics
        """
        if not os.path.exists(input_path):
            raise FileNotFoundError(f"Video file not found: {input_path}")

        # Open video
        cap = cv2.VideoCapture(input_path)
        if not cap.isOpened():
            raise ValueError(f"Cannot open video file: {input_path}")

        # Get video properties
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        fps = int(cap.get(cv2.CAP_PROP_FPS))
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

        # Prepare output video writer
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
            str(output_path)
        ]
        
        # Start FFmpeg process
        try:
            ffmpeg_process = subprocess.Popen(
                ffmpeg_cmd, 
                stdin=subprocess.PIPE,
                stderr=subprocess.DEVNULL
            )
        except Exception as e:
            print(f"Error starting FFmpeg: {e}")
            raise

        frame_count = 0
        processed_count = 0
        detection_stats = {}

        if progress_callback:
            progress_callback(0, "Starting video processing...")

        try:
            while frame_count < total_frames:
                ret, frame = cap.read()

                if not ret:
                    break

                # Process every Nth frame
                if frame_count % self.frame_interval == 0 and self.predictor:
                    # Convert frame to PIL Image
                    frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                    pil_image = Image.fromarray(frame_rgb)

                    # Encode to base64
                    buffered = BytesIO()
                    pil_image.save(buffered, format="JPEG", quality=85)
                    img_base64 = base64.b64encode(buffered.getvalue()).decode()

                    # Send to endpoint
                    try:
                        payload = {'image': img_base64}
                        response = self.predictor.predict(payload)

                        # Parse predictions
                        if isinstance(response, dict):
                            predictions = response.get('predictions', [])
                        else:
                            predictions = response if isinstance(response, list) else []

                        # Filter by confidence threshold
                        predictions = [p for p in predictions
                                     if p.get('confidence', 0) >= self.confidence_threshold]

                        # Draw bounding boxes on frame
                        draw_frame = frame.copy()

                        for pred in predictions:
                            class_name = pred.get('class_name', 'Unknown')
                            confidence = pred.get('confidence', 0)
                            bbox = pred.get('bbox', {})

                            # Assign color to class
                            if class_name not in self.class_colors:
                                color_idx = len(self.class_colors) % len(self.default_colors)
                                self.class_colors[class_name] = self.default_colors[color_idx]

                            color = self.class_colors[class_name]

                            if isinstance(bbox, dict):
                                x1 = int(bbox.get('x1', 0))
                                y1 = int(bbox.get('y1', 0))
                                x2 = int(bbox.get('x2', 0))
                                y2 = int(bbox.get('y2', 0))

                                # Draw bounding box
                                cv2.rectangle(draw_frame, (x1, y1), (x2, y2), color, 3)

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
                                    draw_frame,
                                    (x1, y1 - label_h - baseline - 10),
                                    (x1 + label_w + 10, y1),
                                    color,
                                    -1
                                )

                                # Label text
                                cv2.putText(
                                    draw_frame,
                                    label,
                                    (x1 + 5, y1 - baseline - 5),
                                    font,
                                    font_scale,
                                    (255, 255, 255),
                                    thickness
                                )

                                # Track detection stats
                                detection_stats[class_name] = detection_stats.get(class_name, 0) + 1

                        # Write annotated frame
                        try:
                            ffmpeg_process.stdin.write(draw_frame.tobytes())
                        except Exception as e:
                            print(f"Error writing frame to FFmpeg: {e}")
                        processed_count += 1

                    except Exception as e:
                        print(f"Error processing frame {frame_count}: {e}")
                        # Write original frame on error
                        try:
                            ffmpeg_process.stdin.write(frame.tobytes())
                        except Exception as e:
                            print(f"Error writing frame to FFmpeg: {e}")
                else:
                    # Write original frame (not processed)
                    try:
                        ffmpeg_process.stdin.write(frame.tobytes())
                    except Exception as e:
                        print(f"Error writing frame to FFmpeg: {e}")

                frame_count += 1

                # Update progress
                if progress_callback and frame_count % 30 == 0:  # Update every 30 frames
                    progress = int((frame_count / total_frames) * 100)
                    progress_callback(progress, f"Processing frame {frame_count}/{total_frames}")

        finally:
            # Release resources
            cap.release()
            if 'ffmpeg_process' in locals():
                ffmpeg_process.stdin.close()
                ffmpeg_process.wait()

        if progress_callback:
            progress_callback(100, "Processing complete!")

        # Return statistics
        total_detections = sum(detection_stats.values())
        return {
            'total_frames': total_frames,
            'processed_frames': processed_count,
            'detection_stats': detection_stats,
            'total_detections': total_detections,
            'video_duration': total_frames / fps if fps > 0 else 0,
            'output_path': output_path
        }
