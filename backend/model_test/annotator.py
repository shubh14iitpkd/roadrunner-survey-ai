"""
Lightweight video annotator for model testing.
Loads YOLO model and draws bounding boxes on video frames.
No database writes, no tracking, no GPS — just raw inference + annotation.
"""

import os
import cv2
import subprocess
import numpy as np
from pathlib import Path
from typing import Callable, Dict, List, Optional
from ultralytics import YOLO


class VideoAnnotator:
    """Run YOLO inference on a video and produce an annotated output video."""

    # Color palette for different detection classes
    CLASS_COLORS = [
        (0, 255, 0),    # Green
        (255, 0, 0),    # Blue
        (0, 0, 255),    # Red
        (255, 255, 0),  # Cyan
        (255, 0, 255),  # Magenta
        (0, 255, 255),  # Yellow
        (128, 0, 255),  # Purple
        (255, 128, 0),  # Orange
    ]

    def __init__(self, model_path: Optional[str] = None):
        """
        Initialize the annotator.

        Args:
            model_path: Path to the .pt model file.
                        Defaults to services/multistage.pt
        """
        if model_path is None:
            services_dir = Path(__file__).resolve().parent.parent / "services"
            model_path = str(services_dir / "multistage.pt")

        if not os.path.exists(model_path):
            raise FileNotFoundError(f"Model file not found: {model_path}")

        print(f"[MODEL-TEST] Loading YOLO model from: {model_path}")
        self.model = YOLO(model_path)
        self.confidence_threshold = 0.25
        self.inference_size = 640
        print(f"[MODEL-TEST] Model loaded. Classes: {self.model.names}")

    def annotate_video(
        self,
        input_path: str,
        output_path: str,
        frame_interval: int = 1,
        progress_callback: Optional[Callable[[int, int], None]] = None,
    ) -> Dict:
        """
        Process a video file: run inference on each frame and write annotated output.

        Args:
            input_path: Path to the input video file
            output_path: Path where the annotated video will be saved
            frame_interval: Process every Nth frame (1 = every frame)
            progress_callback: Called with (current_frame, total_frames)

        Returns:
            Summary dict with detection counts
        """
        cap = cv2.VideoCapture(input_path)
        if not cap.isOpened():
            raise RuntimeError(f"Cannot open video: {input_path}")

        fps = int(cap.get(cv2.CAP_PROP_FPS)) or 30
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

        print(f"[MODEL-TEST] Video: {width}x{height} @ {fps}fps, {total_frames} frames")

        # Use ffmpeg subprocess for H.264 output (better compatibility)
        temp_raw = output_path + ".raw.mp4"
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        writer = cv2.VideoWriter(temp_raw, fourcc, fps, (width, height))

        if not writer.isOpened():
            cap.release()
            raise RuntimeError("Failed to create video writer")

        frame_num = 0
        total_detections = 0
        class_counts: Dict[str, int] = {}
        last_detections: List[Dict] = []

        try:
            while True:
                ret, frame = cap.read()
                if not ret:
                    break

                if frame_num % frame_interval == 0:
                    # Run inference on this frame
                    detections = self._run_inference(frame, width, height)
                    last_detections = detections
                    total_detections += len(detections)

                    # Count per class
                    for det in detections:
                        cn = det["class_name"]
                        class_counts[cn] = class_counts.get(cn, 0) + 1
                else:
                    # Reuse last detections for skipped frames
                    detections = last_detections

                # Draw annotations
                annotated = self._draw_detections(frame, detections)
                writer.write(annotated)

                frame_num += 1
                if progress_callback and frame_num % 10 == 0:
                    progress_callback(frame_num, total_frames)

            # Final progress update
            if progress_callback:
                progress_callback(total_frames, total_frames)

        finally:
            cap.release()
            writer.release()

        # Re-encode with ffmpeg for browser compatibility (H.264 + AAC)
        self._reencode_video(temp_raw, output_path)

        # Clean up temp raw file
        if os.path.exists(temp_raw):
            os.remove(temp_raw)

        return {
            "total_frames": total_frames,
            "frames_processed": frame_num,
            "total_detections": total_detections,
            "class_counts": class_counts,
        }

    def _run_inference(
        self, frame: np.ndarray, orig_width: int, orig_height: int
    ) -> List[Dict]:
        """Run YOLO inference on a single frame."""
        try:
            results = self.model(
                frame,
                conf=self.confidence_threshold,
                verbose=False,
                imgsz=self.inference_size,
            )

            detections = []
            if results and len(results) > 0:
                result = results[0]
                if result.boxes is not None and len(result.boxes) > 0:
                    boxes = result.boxes.xyxy.cpu().numpy()
                    confidences = result.boxes.conf.cpu().numpy()
                    class_ids = result.boxes.cls.cpu().numpy().astype(int)
                    class_names = self.model.names

                    for i in range(len(boxes)):
                        box = boxes[i]
                        detections.append({
                            "class_name": class_names.get(class_ids[i], f"class_{class_ids[i]}"),
                            "confidence": round(float(confidences[i]), 4),
                            "box": [float(box[0]), float(box[1]), float(box[2]), float(box[3])],
                        })

            return detections
        except Exception as e:
            print(f"[MODEL-TEST] Inference error: {e}")
            return []

    def _draw_detections(self, frame: np.ndarray, detections: List[Dict]) -> np.ndarray:
        """Draw bounding boxes and labels on a frame."""
        color_map: Dict[str, tuple] = {}

        for detection in detections:
            box = detection.get("box", [])
            class_name = detection.get("class_name", "unknown")
            confidence = detection.get("confidence", 0.0)

            if not isinstance(box, list) or len(box) != 4:
                continue

            x1, y1, x2, y2 = int(box[0]), int(box[1]), int(box[2]), int(box[3])

            # Assign color per class
            if class_name not in color_map:
                idx = len(color_map) % len(self.CLASS_COLORS)
                color_map[class_name] = self.CLASS_COLORS[idx]

            color = color_map[class_name]

            # Bounding box
            cv2.rectangle(frame, (x1, y1), (x2, y2), color, 3)

            # Label
            label = f"{class_name}: {confidence:.2f}"
            font = cv2.FONT_HERSHEY_SIMPLEX
            font_scale = 0.7
            thickness = 2
            (lw, lh), baseline = cv2.getTextSize(label, font, font_scale, thickness)
            cv2.rectangle(frame, (x1, y1 - lh - baseline - 10), (x1 + lw + 10, y1), color, -1)
            cv2.putText(frame, label, (x1 + 5, y1 - baseline - 5), font, font_scale, (255, 255, 255), thickness)

        return frame

    def _reencode_video(self, input_path: str, output_path: str) -> None:
        """Re-encode video with ffmpeg for browser-compatible H.264."""
        try:
            cmd = [
                "ffmpeg", "-y",
                "-i", input_path,
                "-c:v", "libx264",
                "-preset", "fast",
                "-crf", "23",
                "-pix_fmt", "yuv420p",
                "-movflags", "+faststart",
                output_path,
            ]
            subprocess.run(cmd, capture_output=True, check=True, timeout=600)
            print(f"[MODEL-TEST] Re-encoded video: {output_path}")
        except FileNotFoundError:
            print("[MODEL-TEST] ffmpeg not found, using raw mp4v output")
            os.rename(input_path, output_path)
        except subprocess.CalledProcessError as e:
            print(f"[MODEL-TEST] ffmpeg error: {e.stderr.decode()}")
            os.rename(input_path, output_path)
