"""
TensorRT engine video processor.

Mirrors LocalVideoProcessor output exactly but runs inference through a
TensorRT .engine file with dynamic batching, on a 3-stage producer/consumer
pipeline:

    decoder thread  → decode_q → inferencer thread → infer_q → tracker thread

Decoder reads frames sequentially via cv2.VideoCapture. Inferencer batches
up to `batch_size` inference frames and runs a single TRT call per batch
(single IExecutionContext — never touched from another thread). Tracker
consumes frames in strict frame order, calls DeepSort.update_tracks (single
tracker instance — never reordered), and writes frame records / accumulates
track observations. Asset doc construction runs on the main thread after
all worker threads join.

Frame ordering is preserved end-to-end: decoder produces in order, infer-
encer drains its pending list in order on each batch flush, tracker pulls
FIFO. No `as_completed`, no parallel inference workers — that would
reorder detections and break tracker state.
"""

import os
import json
import re
import time
import queue
import threading
import cv2
import numpy as np
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Tuple, Optional
from datetime import datetime
from bson import ObjectId

from utils.gpx_helpers import parse_gpx, interpolate_gpx
from utils.ids import generate_defect_id, generate_asset_display_id
from services.LatLongEstimator import LatLongEstimator
from services.ZoneMapper import ZoneMapper

from deep_sort_realtime.deepsort_tracker import DeepSort
from ultralytics import YOLO

# Single-source helpers/constants — keep parity with LocalVideoProcessor.
# from services.local_processor import (
#     classify_group,
#     _offset_latlng,
#     _dedupe_polyline,
#     _vehicle_path_between,
#     _offset_path_between,
#     SIDED_OFFSET_M,
#     BEARING_SMOOTH_FRAMES,
# )
from services.processor_helpers import (
    classify_group,
    _offset_latlng,
    _dedupe_polyline,
    _vehicle_path_between,
    _offset_path_between,
    SIDED_OFFSET_M,
    BEARING_SMOOTH_FRAMES,
)

@dataclass
class _FrameWork:
    """In-flight frame as it moves through the decode → infer → track pipeline.

    `detections` is filled by the inferencer for frames where
    `needs_inference` is True; for skipped frames (frame_num %
    frame_interval != 0) it stays None and the tracker thread only fires
    progress_callback for them, matching the pre-pipeline behaviour where
    progress was called for every frame regardless of inference.
    """
    frame_num: int
    frame: np.ndarray
    timestamp: float
    needs_inference: bool
    detections: Optional[List[Dict]] = None


class EngineVideoProcessor:
    """Process videos using a TensorRT .engine model with dynamic batching."""

    def __init__(self, model_path: str = None):
        self.config = self._load_endpoint_config()

        model_file_name = self.config.get("model_file_name", "multistage.engine")
        services_dir = Path(__file__).parent
        self.model_path = model_path or str(services_dir / model_file_name)

        # Inference image size (must match engine build-time imgsz).
        self.inference_size = int(self.config.get("inference_size", 640))

        # Dynamic batch dimension — engine compiled with max=48 by default.
        self.batch_size = int(os.getenv("TRT_BATCH_SIZE",
                                        self.config.get("batch_size", 48)))

        # Frame extraction interval (process every Nth frame).
        self.frame_interval = int(self.config.get("frame_interval", "1"))

        # Confidence threshold.
        self.confidence_threshold = float(os.getenv("CONFIDENCE_THRESHOLD", "0.25"))

        # Chunk size for memory-bounded video reads.
        self.chunk_size = int(self.config.get("chunk_size", "500"))

        self.damaged_conditions = {
            'overgrown', 'fadedpaint', 'dirty', 'missing',
            'broken', 'bent', 'damaged',
        }

        # Load engine model (single instance, single context — used serially).
        self.model = self._load_model()
        self._warmup()

        self.tracker = DeepSort(
            max_age=30,
            n_init=3,
            embedder="mobilenet",
            embedder_gpu=True,
            max_iou_distance=0.7,
            nms_max_overlap=1,
        )

        self.lat_long_estimator = LatLongEstimator()
        self.label_map: Dict[str, Dict[str, str]] = {}
        self.zone_mapper = ZoneMapper()

        print(f"[ENGINE] Initialized with model: {self.model_path}")
        print(f"[ENGINE] Frame interval: {self.frame_interval}")
        print(f"[ENGINE] Batch size: {self.batch_size}")
        print(f"[ENGINE] Inference size: {self.inference_size}")
        print(f"[ENGINE] Confidence threshold: {self.confidence_threshold}")

    def _load_model(self) -> YOLO:
        if not os.path.exists(self.model_path):
            raise FileNotFoundError(f"Engine file not found: {self.model_path}")

        print(f"[ENGINE] Loading TensorRT engine from: {self.model_path}")
        try:
            model = YOLO(self.model_path, task="detect")
            print(f"[ENGINE] Engine loaded successfully")
            print(f"[ENGINE] Model class names: {model.names}")
            return model
        except Exception as e:
            raise RuntimeError(f"Failed to load TensorRT engine: {e}")

    def _warmup(self) -> None:
        """Prime TRT kernels so first real batch doesn't pay JIT/cache cost."""
        try:
            dummy = np.zeros(
                (self.inference_size, self.inference_size, 3), dtype=np.uint8
            )
            self.model(
                [dummy] * self.batch_size,
                conf=self.confidence_threshold,
                verbose=False,
                imgsz=self.inference_size,
            )
            print(f"[ENGINE] Warmup complete (batch={self.batch_size})")
        except Exception as e:
            print(f"[ENGINE] Warmup skipped: {e}")

    def _load_label_map(self, db) -> Dict[str, Dict[str, str]]:
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
                        "category_id": label.get("category_id"),
                        "default_group_id": label.get("default_group_id", ""),
                    }
            print(f"[ENGINE] Loaded label map with {len(label_map)} entries")
            return label_map
        except Exception as e:
            print(f"[ENGINE] Warning: Failed to load label map: {e}")
            return {}

    def _load_endpoint_config(self):
        possible_paths = [
            Path(__file__).parent / "endpoint_config.json",
            Path(__file__).parent.parent / "endpoint_config.json",
            Path(__file__).parent.parent.parent / "endpoint_config.json",
        ]

        for config_path in possible_paths:
            if config_path.exists():
                try:
                    with open(config_path, "r") as f:
                        return json.load(f)
                except json.JSONDecodeError as e:
                    print(f"[ENGINE] Warning: Invalid JSON in {config_path}: {e}")
                    continue
                except Exception as e:
                    print(f"[ENGINE] Warning: Failed to load {config_path}: {e}")
                    continue

        print(
            f"[ENGINE] No endpoint_config.json found in: "
            f"{[str(p) for p in possible_paths]}"
        )
        return {}

    def _run_batched_inference(
        self, frames: List[np.ndarray]
    ) -> List[List[Dict]]:
        """
        Run TRT inference on a batch of frames.

        Returns one detection list per input frame, in input order.
        """
        if not frames:
            return []

        try:
            results = self.model(
                frames,
                conf=self.confidence_threshold,
                verbose=False,
                imgsz=self.inference_size,
            )
        except Exception as e:
            print(f"[ENGINE] Error running batched inference: {e}")
            import traceback
            traceback.print_exc()
            return [[] for _ in frames]

        class_names = self.model.names
        out: List[List[Dict]] = []
        for result in results:
            dets: List[Dict] = []
            if result.boxes is not None and len(result.boxes) > 0:
                boxes = result.boxes.xyxy.cpu().numpy()
                confidences = result.boxes.conf.cpu().numpy()
                class_ids = result.boxes.cls.cpu().numpy().astype(int)

                for i in range(len(boxes)):
                    box = boxes[i]
                    confidence = float(confidences[i])
                    class_id = int(class_ids[i])
                    class_name = class_names.get(class_id, f"class_{class_id}")

                    dets.append({
                        "class_name": class_name,
                        "confidence": round(confidence, 4),
                        "box": [
                            float(box[0]), float(box[1]),
                            float(box[2]), float(box[3]),
                        ],
                    })
            out.append(dets)
        return out

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
        Process video with the TensorRT engine on a 3-stage pipeline.

        Memory-bounded by queue depth; throughput-bounded by max(stage). The
        decoder, inferencer, and tracker each run in their own thread; frame
        order is preserved end-to-end via FIFO queues + a single inferencer
        + a single tracker, so per-frame outputs and the resulting asset
        docs match the previous serial-chunked implementation byte-for-byte.
        """
        process_start_time = time.time()
        print(f"[ENGINE] Processing video: {video_path}")
        print(f"[ENGINE] Route ID: {route_id}, Video ID: {video_id}")

        # Coerce survey_id to ObjectId once at boundary so all downstream
        # writes (frames + assets) match the type that _recompute_survey_totals
        # and asset_linker query against. Storing as string silently breaks
        # the totals aggregation because MongoDB does not coerce types.
        survey_oid: Optional[ObjectId] = None
        if survey_id:
            try:
                survey_oid = (
                    survey_id if isinstance(survey_id, ObjectId)
                    else ObjectId(survey_id)
                )
            except Exception as e:
                print(f"[ENGINE] Warning: invalid survey_id {survey_id!r}: {e}")

        self.label_map = self._load_label_map(db)

        cap = cv2.VideoCapture(str(video_path))
        if not cap.isOpened():
            raise ValueError(f"Cannot open video: {video_path}")

        fps = int(cap.get(cv2.CAP_PROP_FPS))
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        duration = total_frames / fps if fps > 0 else 0

        print(
            f"[ENGINE] Video properties: {width}x{height}, {fps}fps, "
            f"{total_frames} frames, {duration:.2f}s"
        )
        print(f"[ENGINE] Pipeline batch size: {self.batch_size}")

        gpx_data = {}
        print(f"[ENGINE] GPX path: {gpx_path}")
        if gpx_path:
            gpx_path = Path(gpx_path)
            if not gpx_path.exists():
                print(f"[ENGINE] GPX file does not exist: {gpx_path}")
            gpx_parsed = parse_gpx(gpx_path)
            gpx_data = interpolate_gpx(
                total_frames, fps, gpx_parsed,
                frame_interval=self.frame_interval, time_offset=0,
            )
            print("[ENGINE] GPX data extracted successfully", len(gpx_data))
        print(len(gpx_data))

        detections_list: List[Dict] = []
        frame_metadata: List[Dict] = []
        tracks_state: Dict[str, Dict] = {}
        summary = {"good": 0, "damaged": 0, "total_assets": 0}

        # Stage timers — each key is written by exactly one thread (no locks
        # needed). Wall time != sum once pipelined; printed separately below.
        timing = {
            "decode": 0.0,      # decoder thread: cv2 frame read
            "infer": 0.0,       # inferencer thread: TRT batched call
            "tracker": 0.0,     # tracker thread: DeepSort.update_tracks
            "postproc": 0.0,    # tracker thread: full per-frame post-process body
            "dbwrite": 0.0,     # tracker thread: db.frames.insert_one
            "assetbuild": 0.0,  # main thread: _build_asset_docs + assets.insert_many
        }

        # Bounded queues cap memory; sentinel value = None (always sent in
        # finally so a downstream thread never deadlocks waiting for a frame
        # that will never arrive).
        Q_MAX = max(64, 2 * self.batch_size)
        decode_q: queue.Queue = queue.Queue(maxsize=Q_MAX)
        infer_q: queue.Queue = queue.Queue(maxsize=Q_MAX)

        # Shared error state: any thread crash sets the event and stashes the
        # exception. Other threads see the flag, drain to sentinel, and exit
        # without doing more real work. list.append is atomic under GIL.
        error_event = threading.Event()
        errors: List[BaseException] = []

        # Mutable counter — only the tracker thread writes; main reads post-join.
        processed_count_box = [0]

        def _safe_put(q: queue.Queue, item) -> bool:
            """Put with periodic error_event check so a crashed consumer
            cannot deadlock the producer on a full queue. Returns False on
            error so the caller can bail out early."""
            while True:
                if error_event.is_set():
                    return False
                try:
                    q.put(item, timeout=0.5)
                    return True
                except queue.Full:
                    continue

        def _decoder() -> None:
            """Stage 1: cv2.VideoCapture.read() in strict frame order, push
            into decode_q. Single thread → no race on cap state."""
            try:
                for frame_num in range(total_frames):
                    if error_event.is_set():
                        return
                    t0 = time.time()
                    ret, frame = cap.read()
                    timing["decode"] += time.time() - t0
                    if not ret:
                        print(f"[ENGINE] Warning: Could not read frame {frame_num}")
                        break
                    timestamp = frame_num / fps if fps > 0 else 0
                    needs = (frame_num % self.frame_interval) == 0
                    fw = _FrameWork(frame_num, frame, timestamp, needs)
                    if not _safe_put(decode_q, fw):
                        return
            except Exception as e:
                errors.append(e)
                error_event.set()
                print(f"[ENGINE] Decoder thread error: {e}")
                import traceback as _tb
                _tb.print_exc()
            finally:
                # Always send sentinel so the inferencer doesn't hang.
                try:
                    decode_q.put(None, timeout=10)
                except queue.Full:
                    pass

        def _inferencer() -> None:
            """Stage 2: pull frames from decode_q, batch up frames where
            needs_inference is True, run a single TRT call per batch, attach
            detections, and push every frame (inference + skipped) into
            infer_q in original order. Single thread → only thread that
            touches self.model / TRT context."""
            pending: List[_FrameWork] = []        # all frames in order
            pending_inf: List[_FrameWork] = []    # subset that needs inference

            def _flush() -> bool:
                """Run inference on pending_inf (if any) and push pending in
                order to infer_q. Returns False if put was aborted by error."""
                if pending_inf and not error_event.is_set():
                    t0 = time.time()
                    try:
                        results = self._run_batched_inference(
                            [f.frame for f in pending_inf]
                        )
                    finally:
                        timing["infer"] += time.time() - t0
                    for f, dets in zip(pending_inf, results):
                        f.detections = dets
                for f in pending:
                    if not _safe_put(infer_q, f):
                        return False
                pending.clear()
                pending_inf.clear()
                return True

            try:
                while True:
                    item = decode_q.get()
                    if item is None:
                        # Final flush of any partial batch.
                        _flush()
                        break
                    if error_event.is_set():
                        # Drop and keep draining until we see the sentinel,
                        # otherwise the decoder may block on a full decode_q.
                        continue
                    pending.append(item)
                    if item.needs_inference:
                        pending_inf.append(item)
                    if len(pending_inf) >= self.batch_size:
                        if not _flush():
                            return
            except Exception as e:
                errors.append(e)
                error_event.set()
                print(f"[ENGINE] Inferencer thread error: {e}")
                import traceback as _tb
                _tb.print_exc()
            finally:
                try:
                    infer_q.put(None, timeout=10)
                except queue.Full:
                    pass

        def _tracker_postproc() -> None:
            """Stage 3: pull frames from infer_q in order. For inference
            frames, run tracker + per-frame post-process + db.frames insert.
            For all frames (inference or not), fire progress_callback so we
            preserve pre-pipeline behaviour where every frame ticked the
            progress bar. Single thread → only thread that touches
            self.tracker, tracks_state, frame_metadata, detections_list."""
            try:
                while True:
                    item = infer_q.get()
                    if item is None:
                        break
                    if error_event.is_set():
                        continue

                    t_post = time.time()
                    if item.detections is not None:
                        frame_num = item.frame_num
                        frame = item.frame
                        timestamp = item.timestamp
                        detections = item.detections

                        frame_metadata.append({
                            "frame_num": frame_num,
                            "timestamp": timestamp,
                            "detections": detections,
                        })

                        formatted_detections = []
                        car_heading = self.lat_long_estimator.calculate_bearing_for_frame(
                            frame_number=frame_num,
                            interpolated_gpx=gpx_data,
                            total_frames=total_frames,
                            frame_interval=self.frame_interval,
                        )
                        gpx_point = gpx_data.get(frame_num) if gpx_data else None
                        car_lon = gpx_point["lon"] if gpx_point else None
                        car_lat = gpx_point["lat"] if gpx_point else None

                        for det in detections:
                            box = det["box"]
                            w, h = box[2] - box[0], box[3] - box[1]
                            if car_lat is not None and car_lon is not None:
                                estimated = self.lat_long_estimator.estimate_location(
                                    car_lat, car_lon, car_heading,
                                    width, height, box,
                                )
                                det["location"] = {
                                    "type": "Point",
                                    "coordinates": [estimated["lon"], estimated["lat"]],
                                }
                            class_name = det.get("class_name", "")
                            label_info = self.label_map.get(class_name, {})
                            det["asset_id"] = label_info.get("asset_id")
                            det["category_id"] = label_info.get("category_id")
                            formatted_detections.append((
                                [box[0], box[1], w, h],
                                det["confidence"],
                                det["class_name"],
                            ))

                        t_track = time.time()
                        tracks = self.tracker.update_tracks(
                            formatted_detections, frame=frame
                        )
                        timing["tracker"] += time.time() - t_track

                        for track in tracks:
                            if not track.is_confirmed():
                                continue

                            track_id = track.track_id
                            class_name = track.get_det_class()
                            ltwh_box = track.to_ltwh(orig=True)
                            confidence = track.get_det_conf()
                            if confidence is None:
                                continue
                            confidence = float(confidence)

                            if car_lat is None or car_lon is None:
                                continue

                            t_box = [
                                ltwh_box[0], ltwh_box[1],
                                ltwh_box[0] + ltwh_box[2],
                                ltwh_box[1] + ltwh_box[3],
                            ]
                            estimated = self.lat_long_estimator.estimate_location(
                                car_lat, car_lon, car_heading,
                                width, height, t_box,
                            )
                            cx = (t_box[0] + t_box[2]) / 2
                            centroid_side = "LHS" if cx < width / 2 else "RHS"

                            cond = re.sub(
                                r"\w+_AssetCondition_|\w+_VerticalClearance_",
                                "", class_name,
                            ).lower()
                            condition = (
                                cond if cond in self.damaged_conditions else "good"
                            )

                            zone = self.zone_mapper.resolve_zone(
                                class_name, t_box, width, height
                            )
                            road_side = self.zone_mapper.get_road_side(t_box, width)

                            obs = {
                                "frame_number": frame_num,
                                "timestamp": timestamp,
                                "confidence": confidence,
                                "condition": condition,
                                "ltwh": (
                                    float(ltwh_box[0]), float(ltwh_box[1]),
                                    float(ltwh_box[2]), float(ltwh_box[3]),
                                ),
                                "car_lat": float(car_lat),
                                "car_lon": float(car_lon),
                                "car_heading": float(car_heading or 0.0),
                                "est_lat": float(estimated["lat"]),
                                "est_lon": float(estimated["lon"]),
                                "est_dist": float(estimated["dist"]),
                                "est_bearing": float(estimated["bearing"]),
                                "centroid_side": centroid_side,
                                "road_side": road_side,
                                "zone": zone,
                            }

                            state = tracks_state.get(track_id)
                            if state is None:
                                label_info = self.label_map.get(class_name, {}) or {}
                                classification = classify_group(
                                    label_info.get("default_group_id", "")
                                )
                                tracks_state[track_id] = {
                                    "class_name": class_name,
                                    "label_info": label_info,
                                    "classification": classification,
                                    "observations": [obs],
                                }
                            else:
                                state["observations"].append(obs)

                        if db is not None:
                            frame_record = {
                                "video_id": video_id,
                                "survey_id": survey_oid,
                                "route_id": route_id,
                                "frame_number": frame_num,
                                "timestamp": timestamp,
                                "detections": detections,
                                "detections_count": len(detections),
                                "location": {
                                    "type": "Point",
                                    "coordinates": [
                                        gpx_data[frame_num]["lon"],
                                        gpx_data[frame_num]["lat"],
                                    ],
                                } if gpx_data and gpx_data.get(frame_num) else None,
                                "created_at": datetime.utcnow().isoformat(),
                            }
                            t_db = time.time()
                            try:
                                db.frames.insert_one(frame_record)
                            except Exception as e:
                                print(
                                    f"[ENGINE] Warning: Failed to store frame "
                                    f"in MongoDB: {e}"
                                )
                            timing["dbwrite"] += time.time() - t_db

                        detections_list.extend(detections)
                        processed_count_box[0] += 1

                    if progress_callback:
                        progress = int((item.frame_num / total_frames) * 100)
                        progress_callback(
                            progress,
                            f"Processing frame {item.frame_num}/{total_frames}",
                        )
                    timing["postproc"] += time.time() - t_post
            except Exception as e:
                errors.append(e)
                error_event.set()
                print(f"[ENGINE] Tracker thread error: {e}")
                import traceback as _tb
                _tb.print_exc()

        try:
            t_dec = threading.Thread(target=_decoder, name="engine-decoder", daemon=True)
            t_inf = threading.Thread(target=_inferencer, name="engine-inferencer", daemon=True)
            t_trk = threading.Thread(target=_tracker_postproc, name="engine-tracker", daemon=True)
            t_dec.start()
            t_inf.start()
            t_trk.start()

            # Join in pipeline order. Sentinel propagation guarantees forward
            # progress: decoder finishes → sentinel → inferencer drains and
            # finishes → sentinel → tracker drains and finishes.
            t_dec.join()
            t_inf.join()
            t_trk.join()

            if errors:
                # Surface the first thread error to the caller. cap.release()
                # still runs via the outer finally below.
                raise errors[0]

            if db is not None and tracks_state:
                t_phase = time.time()
                asset_docs = self._build_asset_docs(
                    tracks_state=tracks_state,
                    gpx_data=gpx_data,
                    total_frames=total_frames,
                    video_id=video_id,
                    survey_id=survey_oid,
                    route_id=route_id,
                    width=width,
                    summary=summary,
                    db=db,
                )
                if asset_docs:
                    db.assets.insert_many(asset_docs)
                timing["assetbuild"] = time.time() - t_phase
        finally:
            cap.release()

        processed_count = processed_count_box[0]
        decode_t = timing["decode"]
        infer_t = timing["infer"]
        tracker_t = timing["tracker"]
        postproc_t = timing["postproc"]
        dbwrite_t = timing["dbwrite"]
        assetbuild_t = timing["assetbuild"]

        elapsed = time.time() - process_start_time
        accounted = decode_t + infer_t + postproc_t + assetbuild_t
        # NOTE: stages run concurrently in pipelined mode — wall time ≈
        # max(stage), not sum. `other` reflects overlap (i.e. time NOT
        # accounted because stages waited on each other), not lost time.
        # The bottleneck stage's CPU time should approximate `elapsed`.
        other_t = max(0.0, elapsed - accounted)
        print(f"[ENGINE] Processing complete!")
        print(f"[ENGINE] Processed {processed_count} inference frames")
        print(
            f"[ENGINE] Total process_video time: {elapsed:.2f}s "
            f"({elapsed / 60:.2f} min) — "
            f"{(processed_count / elapsed) if elapsed > 0 else 0:.2f} fps"
        )
        print(
            f"[ENGINE] Stage breakdown (pipelined, sum != wall): "
            f"decode={decode_t:.2f}s "
            f"infer={infer_t:.2f}s "
            f"postproc={postproc_t:.2f}s "
            f"(tracker={tracker_t:.2f}s dbwrite={dbwrite_t:.2f}s) "
            f"assetbuild={assetbuild_t:.2f}s "
            f"other={other_t:.2f}s"
        )

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

    def _build_asset_docs(
        self,
        tracks_state: Dict[str, Dict],
        gpx_data: Dict,
        total_frames: int,
        video_id: str,
        survey_id: Optional[ObjectId],
        route_id: Optional[int],
        width: int,
        summary: Dict,
        db,
    ) -> List[Dict]:
        """One asset doc per track. Identical schema to LocalVideoProcessor."""
        now_iso = datetime.utcnow().isoformat()
        docs: List[Dict] = []

        for track_id, state in tracks_state.items():
            obs_list = state["observations"]
            if not obs_list:
                continue
            class_name = state["class_name"]
            label_info = state["label_info"] or {}
            classification = state["classification"]
            first_obs = obs_list[0]

            confidence = first_obs["confidence"]

            damaged_obs = [o for o in obs_list if o["condition"] != "good"]
            condition = damaged_obs[0]["condition"] if damaged_obs else "good"

            summary_key = "good" if condition == "good" else "damaged"
            summary[summary_key] += 1
            summary["total_assets"] += 1

            fx, fy, fw, fh = first_obs["ltwh"]
            base_doc = {
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
                "issue": None if condition == "good" else "Defective",
                "frame_number": first_obs["frame_number"],
                "timestamp": first_obs["timestamp"],
                "video_id": video_id,
                "side": first_obs["road_side"],
                "zone": first_obs["zone"],
                "box": {
                    "x": fx, "y": fy, "width": fw, "height": fh,
                },
                "survey_id": survey_id,
                "route_id": route_id,
                "location": {
                    "type": "Point",
                    "coordinates": [first_obs["est_lon"], first_obs["est_lat"]],
                },
                "vehicle_location": {
                    "type": "Point",
                    "coordinates": [first_obs["car_lon"], first_obs["car_lat"]],
                },
                "estimated_distance_meters": round(first_obs["est_dist"], 2),
                "estimated_bearing": round(first_obs["est_bearing"], 2),
                "created_at": now_iso,
                "kind": "point" if classification == "point" else "line",
                "classification": classification if classification != "other" else "point",
            }

            if classification in ("point", "other") or len(obs_list) < 2:
                if classification != "point" and classification != "other":
                    base_doc["kind"] = "point"
                    base_doc["classification"] = "point"
                docs.append(base_doc)
                continue

            sided = classification == "linear_sided"
            run_side = first_obs["centroid_side"] if sided else None

            coords: List[Tuple[float, float]] = []
            if sided:
                for i, o in enumerate(obs_list):
                    if i == 0:
                        heading = self.lat_long_estimator.calculate_bearing_for_frame(
                            frame_number=o["frame_number"],
                            interpolated_gpx=gpx_data,
                            total_frames=total_frames,
                            frame_interval=BEARING_SMOOTH_FRAMES,
                        ) or 0.0
                        lat, lon = _offset_latlng(
                            o["car_lat"], o["car_lon"], heading,
                            run_side, SIDED_OFFSET_M,
                        )
                        coords.append((lat, lon))
                    else:
                        prev = obs_list[i - 1]
                        coords.extend(
                            _offset_path_between(
                                self.lat_long_estimator, gpx_data, total_frames,
                                prev["frame_number"], o["frame_number"],
                                run_side, step=3,
                            )
                        )
            else:
                for i, o in enumerate(obs_list):
                    if i == 0:
                        coords.append((o["car_lat"], o["car_lon"]))
                        continue
                    prev = obs_list[i - 1]
                    coords.extend(
                        _vehicle_path_between(
                            gpx_data, prev["frame_number"],
                            o["frame_number"], step=3,
                        )
                    )
                    coords.append((o["car_lat"], o["car_lon"]))
            coords = _dedupe_polyline(coords)
            if len(coords) < 2:
                base_doc["kind"] = "point"
                base_doc["classification"] = "point"
                docs.append(base_doc)
                continue

            keypoints: List[Dict] = []
            for o in obs_list:
                ox, oy, ow, oh = o["ltwh"]
                if sided:
                    kp_lat, kp_lon = o["est_lat"], o["est_lon"]
                    kp_side = run_side
                else:
                    kp_lat, kp_lon = _offset_latlng(
                        o["car_lat"], o["car_lon"],
                        o["car_heading"], o["centroid_side"],
                        SIDED_OFFSET_M,
                    )
                    kp_side = o["centroid_side"]
                keypoints.append({
                    "frame": o["frame_number"],
                    "lat": round(kp_lat, 6),
                    "lng": round(kp_lon, 6),
                    "side": kp_side,
                    "box": {"x": ox, "y": oy, "width": ow, "height": oh},
                })

            frames = sorted({o["frame_number"] for o in obs_list})
            base_doc["geometry"] = {
                "type": "LineString",
                "coordinates": [
                    [round(lon, 6), round(lat, 6)] for lat, lon in coords
                ],
            }
            base_doc["frames"] = frames
            base_doc["first_frame"] = frames[0]
            base_doc["last_frame"] = frames[-1]
            base_doc["keypoints"] = keypoints
            docs.append(base_doc)

        return docs

    def _summarize_detections(self, detections: List[Dict]) -> Dict:
        summary: Dict[str, int] = {}
        for det in detections:
            class_name = det.get("class_name", "unknown")
            summary[class_name] = summary.get(class_name, 0) + 1
        return summary
