from utils.gpx_helpers import parse_gpx, interpolate_gpx
import time
import os
import json
import cv2
import re
from ulid import ULID
from pathlib import Path
from typing import Dict, List, Tuple, Optional
import numpy as np
from datetime import datetime
from bson import ObjectId
from concurrent.futures import ThreadPoolExecutor, as_completed
from services.LatLongEstimator import LatLongEstimator
from services.ZoneMapper import ZoneMapper
from utils.ids import generate_defect_id, generate_asset_display_id

from deep_sort_realtime.deepsort_tracker import DeepSort
from ultralytics import YOLO


class LocalVideoProcessor:
    """Process videos using model loaded locally and extract annotated frames."""

    def __init__(self, model_path: str = None):
        """
        Initialize the local video processor.

        Args:
            model_path: Path to the YOLO model file (optional, reads from config if not provided)
        """
        # Load configuration from endpoint_config.json
        self.config = self._load_endpoint_config()
        
        # Get model file name from config
        model_file_name = self.config.get("model_file_name", "model.pt")
        
        # Model is located in the services folder
        services_dir = Path(__file__).parent
        self.model_path = model_path or str(services_dir / model_file_name)
        
        # Load the YOLO model
        self.model = self._load_model()

        # Frame extraction interval (process every Nth frame)
        self.frame_interval = int(self.config.get("frame_interval", "1"))

        # Max concurrent workers for processing
        self.max_concurrency = int(self.config.get("max_concurrency", "5"))
        self.damaged_conditions = {'overgrown', 'fadedpaint', 'dirty', 'missing', 'broken', 'bent', 'damaged'}
        # Inference image size (YOLO standard)
        self.inference_size = 640
        
        # Confidence threshold
        self.confidence_threshold = float(os.getenv("CONFIDENCE_THRESHOLD", "0.25"))

        self.chunk_size = int(self.config.get("chunk_size", "500"))

        self.tracker = DeepSort(
            max_age=30,
            n_init=3,
            embedder="mobilenet",
            max_iou_distance=0.7,
            nms_max_overlap=1,
        )

        self.lat_long_estimator = LatLongEstimator()
        
        # Label map for resolving class_name to asset_id and category_id
        # Will be loaded from MongoDB when db is provided to process_video
        self.label_map = {}
        self.zone_mapper = ZoneMapper()

        print(f"[LOCAL] Initialized with model: {self.model_path}")
        print(f"[LOCAL] Frame interval: {self.frame_interval}")
        print(f"[LOCAL] Max concurrency: {self.max_concurrency}")
        print(f"[LOCAL] Confidence threshold: {self.confidence_threshold}")

    def _load_model(self) -> YOLO:
        """
        Load the YOLO model from the specified path.
        Supports YOLOv8 (ultralytics) models.
        
        Returns:
            Loaded YOLO model instance
        """
        if not os.path.exists(self.model_path):
            raise FileNotFoundError(f"Model file not found: {self.model_path}")
        
        print(f"[LOCAL] Loading YOLO model from: {self.model_path}")
        try:
            model = YOLO(self.model_path)
            print(f"[LOCAL] Model loaded successfully")
            print(f"[LOCAL] Model class names: {model.names}")
            return model
        except Exception as e:
            raise RuntimeError(f"Failed to load YOLO model: {e}")
    
    def _load_label_map(self, db) -> Dict[str, Dict[str, str]]:
        """
        Load the system label map from MongoDB.
        Maps class_name (default_name) to asset_id and category_id.
        
        Args:
            db: MongoDB database connection
            
        Returns:
            Dict mapping class_name -> {"asset_id": str, "category_id": str}
        """
        if db is None:
            return {}
        
        try:
            labels = list(db.system_asset_labels.find())
            label_map = {}
            for label in labels:
                default_name = label.get("default_name", "")
                if default_name:
                    label_map[default_name] = {
                        "asset_id": label.get("asset_id"),
                        "group_id": label.get("group_id"),
                        "category_id": label.get("category_id")
                    }
            print(f"[LOCAL] Loaded label map with {len(label_map)} entries")
            return label_map
        except Exception as e:
            print(f"[LOCAL] Warning: Failed to load label map: {e}")
            return {}

    def _load_endpoint_config(self):
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
                    print(f"[LOCAL] Warning: Invalid JSON in {config_path}: {e}")
                    continue
                except Exception as e:
                    print(f"[LOCAL] Warning: Failed to load {config_path}: {e}")
                    continue

        print(
            f"[LOCAL] No endpoint_config.json found in: {[str(p) for p in possible_paths]}"
        )
        return {}

    def process_video(
        self,
        video_path: Path,
        output_dir: Path,
        video_id: str,
        route_id: int | None = None,
        survey_id: str | None = None,
        db=None,
        gpx_path: str | None = None,
        progress_callback: callable = None,
    ) -> Dict:
        """
        Process video with a local model using chunked two-phase architecture.

        Processes video in chunks of ~500 frames to minimize memory usage while
        maximizing inference parallelism. Each chunk:
        1. Phase 1: Read frames and submit all inference requests in parallel
        2. Phase 2: Write all frames (annotated + original) to FFmpeg in order (No longer done since we draw annotation at runtime but storing detections in DB)

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
        print(f"[LOCAL] Processing video: {video_path}")
        print(f"[LOCAL] Route ID: {route_id}, Video ID: {video_id}")
        
        # Load label map for resolving class names to asset_id and category_id
        self.label_map = self._load_label_map(db)

        # Chunk size for processing (configurable via environment)
        chunk_size = self.chunk_size

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
            f"[LOCAL] Video properties: {width}x{height}, {fps}fps, {total_frames} frames, {duration:.2f}s"
        )
        print(f"[LOCAL] Using chunk size: {chunk_size}")

        gpx_data = {}
        print(f"[LOCAL] GPX path: {gpx_path}")
        if gpx_path:
            gpx_path = Path(gpx_path)
            if not gpx_path.exists():
                print(f"[LOCAL] GPX file does not exist: {gpx_path}")
            gpx_parsed = parse_gpx(gpx_path)
            gpx_data = interpolate_gpx(total_frames, fps, gpx_parsed, frame_interval=self.frame_interval, time_offset=0)
            print("[LOCAL] GPX data extracted successfully", len(gpx_data))
        print(len(gpx_data))
        # Processing state
        processed_count = 0
        detections_list = []
        frame_metadata = []
        assets_detected = []
        seen_track_ids = set()
        summary = { "good": 0, "damaged": 0, "total_assets": 0 }

        try:
            with ThreadPoolExecutor(max_workers=self.max_concurrency) as executor:
                # Process video in chunks
                for chunk_start in range(0, total_frames, chunk_size):
                    chunk_end = min(chunk_start + chunk_size, total_frames)
                    print(
                        f"[LOCAL] Processing chunk: frames {chunk_start}-{chunk_end-1}"
                    )

                    # ========== PHASE 1: Read chunk and submit inference ==========
                    chunk_frames = []  # List of (frame_num, frame, timestamp)
                    futures = {}  # future -> chunk_index

                    for frame_num in range(chunk_start, chunk_end):
                        ret, frame = cap.read()
                        if not ret:
                            print(
                                f"[LOCAL] Warning: Could not read frame {frame_num}"
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
                            print(f"[LOCAL] Error in inference: {e}")
                            frame_num = chunk_frames[chunk_idx][0]
                            single_frame_results = (frame_num, [])
                        inference_results[chunk_idx] = single_frame_results

                    # ========== PHASE 2: Process inference results ==========
                    for chunk_idx, (frame_num, frame, timestamp) in enumerate(
                        chunk_frames
                    ):
                        if chunk_idx in inference_results:
                            _, detections = inference_results[chunk_idx]

                            # Store frame metadata
                            frame_metadata.append(
                                {
                                    "frame_num": frame_num,
                                    "timestamp": timestamp,
                                    "detections": detections,
                                }
                            )
                            # track assets and attach estimated locations
                            formatted_detections = []
                            car_heading = self.lat_long_estimator.calculate_bearing_for_frame(frame_number=frame_num, interpolated_gpx=gpx_data, total_frames=total_frames, frame_interval=self.frame_interval)
                            car_lon = gpx_data[frame_num]["lon"]
                            car_lat = gpx_data[frame_num]["lat"]
                            for det in detections:
                                box = det["box"]
                                w, h = box[2] - box[0], box[3] - box[1]
                                estimated = self.lat_long_estimator.estimate_location(car_lat, car_lon, car_heading, width, height, box)
                                det["location"] = { "type": "Point", "coordinates": [estimated["lon"], estimated["lat"]]}
                                # Add asset_id from label map
                                class_name = det.get("class_name", "")
                                label_info = self.label_map.get(class_name, {})
                                det["asset_id"] = label_info.get("asset_id")
                                det["category_id"] = label_info.get("category_id")
                                formatted_detections.append(([box[0], box[1], w, h],det["confidence"],det["class_name"]))

                            tracks = self.tracker.update_tracks(formatted_detections, frame=frame)

                            for track in tracks:
                                if not track.is_confirmed():
                                    continue

                                track_id = track.track_id
                                class_name = track.get_det_class()
                                ltwh_box = track.to_ltwh(orig=True)
                                if track_id in seen_track_ids:
                                    continue
                                seen_track_ids.add(track_id)
                                # returns the confidence of the latest YOLO detection for this track
                                confidence = track.get_det_conf()
                                if confidence is None:
                                    continue

                                confidence = float(confidence)
                                t_box = [ltwh_box[0], ltwh_box[1], ltwh_box[0]+ltwh_box[2], ltwh_box[1]+ltwh_box[3]]
                                estimated = self.lat_long_estimator.estimate_location(car_lat, car_lon, car_heading, width, height, t_box)
                                track_location = { "type": "Point", "coordinates": [estimated["lon"], estimated["lat"]]}

                                if db is not None:
                                    # Look up asset_id and category_id from label map
                                    label_info = self.label_map.get(class_name, {})
                                    cond = re.sub(r"\w+_AssetCondition_|\w+_VerticalClearance_", "", class_name).lower()
                                    condition = cond if cond in self.damaged_conditions else "good"
                                    
                                    # Update summary (consolidate all damaged types into 'damaged' key)
                                    summary_key = "good" if condition == "good" else "damaged"
                                    summary[summary_key] += 1
                                    summary["total_assets"] += 1
                                    
                                    zone = self.zone_mapper.resolve_zone(class_name, t_box, width, height)
                                    side = self.zone_mapper.get_road_side(t_box, width)

                                    assets_detected.append(
                                        {
                                            "track_id": track_id,
                                            "asset_type": class_name,
                                            "type": class_name,
                                            "asset_display_id": generate_asset_display_id(db=db),
                                            "defect_id": generate_defect_id(db=db) if condition != "good" else None,
                                            "asset_id": label_info.get("asset_id"),
                                            "category_id": label_info.get("category_id"),
                                            "group_id": label_info.get("group_id"),
                                            "confidence": confidence,
                                            "condition": condition,
                                            "frame_number": frame_num,
                                            "timestamp": timestamp,
                                            "video_id": video_id,
                                            "side": side,
                                            "zone": zone,
                                            "box": {
                                                "x": float(ltwh_box[0]),
                                                "y": float(ltwh_box[1]),
                                                "width": float(ltwh_box[2]),
                                                "height": float(ltwh_box[3]),
                                            },
                                            "survey_id": survey_id,
                                            "route_id": route_id,
                                            "location": track_location,
                                            "created_at": datetime.utcnow().isoformat(),
                                        }
                                    )
                                # if confidence is None or confidence < 0.5:
                                #     continue

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
                                    "location": {
                                            "type": "Point",
                                            "coordinates": [gpx_data[frame_num]["lon"], gpx_data[frame_num]["lat"]]
                                    } if gpx_data and gpx_data.get(frame_num) else None,
                                    "created_at": datetime.utcnow().isoformat(),
                                }
                                try:
                                    db.frames.insert_one(frame_record)
                                except Exception as e:
                                    print(f"[LOCAL] Warning: Failed to store frame in MongoDB: {e}")

                            # Store detections
                            detections_list.extend(detections)
                            processed_count += 1

                        # Progress callback
                        if progress_callback:
                            progress = int((frame_num / total_frames) * 100)
                            progress_callback(
                                progress, f"Processing frame {frame_num}/{total_frames}"
                            )

                    # Free memory for this chunk
                    del chunk_frames, futures, inference_results
            
            # Insert all assets into MongoDB
            db.assets.insert_many(assets_detected)
        finally:
            cap.release()


        print(f"[LOCAL] Processing complete!")
        print(f"[LOCAL] Processed {processed_count} inference frames")

        return {
            "video_id": video_id,
            "total_frames": total_frames,
            "processed_frames": processed_count,
            "fps": fps,
            "duration": duration,
            "width": width,
            "height": height,
            "assets_summary": summary,
            "total_detections": len(detections_list),
            "detections_summary": self._summarize_detections(detections_list),
        }

    def _run_local_inference(
        self, frame: np.ndarray, orig_width: int, orig_height: int
    ) -> List[Dict]:
        """
        Run inference on a single frame using the local YOLO model.
        
        Args:
            frame: Input frame (BGR format from OpenCV)
            orig_width: Original frame width
            orig_height: Original frame height
            
        Returns:
            List of detections with format:
            [{"class_name": str, "confidence": float, "box": [x1, y1, x2, y2]}, ...]
        """
        try:
            # Run inference using ultralytics YOLO
            # The model handles resizing internally
            results = self.model(
                frame,
                conf=self.confidence_threshold,
                verbose=False,
                imgsz=self.inference_size
            )
            
            detections = []
            
            # Process results - results[0] contains the first (and usually only) result
            if results and len(results) > 0:
                result = results[0]
                
                # Get boxes, confidences, and class IDs
                if result.boxes is not None and len(result.boxes) > 0:
                    boxes = result.boxes.xyxy.cpu().numpy()  # [x1, y1, x2, y2] format
                    confidences = result.boxes.conf.cpu().numpy()
                    class_ids = result.boxes.cls.cpu().numpy().astype(int)
                    
                    # Get class names from model
                    class_names = self.model.names
                    
                    for i in range(len(boxes)):
                        box = boxes[i]
                        confidence = float(confidences[i])
                        class_id = class_ids[i]
                        class_name = class_names.get(class_id, f"class_{class_id}")
                        
                        detections.append({
                            "class_name": class_name,
                            "confidence": round(confidence, 4),
                            "box": [float(box[0]), float(box[1]), float(box[2]), float(box[3])]
                        })
            
            return detections
            
        except Exception as e:
            print(f"[LOCAL] Error running inference: {e}")
            import traceback
            traceback.print_exc()
            return []

    def _process_single_frame(self, frame, width, height, frame_num):
        detections = self._run_local_inference(frame, width, height)
        return (frame_num, detections)

    def _summarize_detections(self, detections: List[Dict]) -> Dict:
        """Summarize detections by class (YOLO format)."""
        summary = {}
        for det in detections:
            class_name = det.get("class_name", "unknown")
            summary[class_name] = summary.get(class_name, 0) + 1
        return summary

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
