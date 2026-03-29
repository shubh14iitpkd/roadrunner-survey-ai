import os
import queue
import shutil
import subprocess
import threading
import time
from pathlib import Path
from typing import Literal

import cv2
import numpy as np
import torch
from ultralytics import YOLO


UploadType = Literal["local", "video_library"]

# Class indices in face_and_plate_blur.pt
_CLS_LICENSE = 0
_CLS_FACE = 1


def _blur_region(frame: np.ndarray, x1: int, y1: int, x2: int, y2: int, strength: int) -> None:
    """Apply Gaussian blur to a rectangular region in-place."""
    x1, y1 = max(0, x1), max(0, y1)
    x2, y2 = min(frame.shape[1], x2), min(frame.shape[0], y2)
    if x2 <= x1 or y2 <= y1:
        return
    roi = frame[y1:y2, x1:x2]
    frame[y1:y2, x1:x2] = cv2.GaussianBlur(roi, (strength, strength), 0)


class AnonymizationService:
    """
    Anonymizes faces and license plates in dashcam videos using a YOLO detection
    model. Designed for maximum throughput on GPU-equipped servers.

    Architecture — three-stage pipeline running on separate threads:
      1. Reader  : decodes frames from disk → frame_queue
      2. GPU     : batches frames, runs YOLO inference, applies blur → write_queue
      3. Writer  : encodes blurred frames to the output file

    On an NVIDIA L4 (23 GB VRAM) a batch_size of 64 saturates the GPU while
    keeping peak VRAM usage well under budget.  On CPU it falls back gracefully
    with a smaller batch.
    """

    # ------------------------------------------------------------------
    # Construction
    # ------------------------------------------------------------------

    def __init__(
        self,
        model_path: str | None = None,
        batch_size: int | None = None,
        confidence: float = 0.05,
        blur_strength: int = 51,         # must be odd; larger = stronger blur
        reader_queue_depth: int = 256,   # frames buffered before GPU
        writer_queue_depth: int = 256,   # frames buffered before writer
    ):
        self.confidence = confidence
        self.blur_strength = blur_strength if blur_strength % 2 == 1 else blur_strength + 1

        # ── device ────────────────────────────────────────────────────
        if torch.cuda.is_available():
            self.device = "cuda"
            vram_gb = torch.cuda.get_device_properties(0).total_memory / 1e9
            # 350 MB per batch-64 at 640px; leave 4 GB headroom
            auto_batch = max(1, int((vram_gb - 4) / 0.35) * 64)
            self.batch_size = batch_size or min(auto_batch, 128)
            print(f"[ANON] GPU: {torch.cuda.get_device_name(0)} "
                  f"({vram_gb:.1f} GB VRAM) — batch_size={self.batch_size}")
        else:
            self.device = "cpu"
            self.batch_size = batch_size or 4
            print(f"[ANON] No GPU found, running on CPU — batch_size={self.batch_size}")

        # ── model ─────────────────────────────────────────────────────
        services_dir = Path(__file__).parent
        self.model_path = model_path or str(services_dir / "face_and_plate_blur.pt")
        self.model = self._load_model()

        self._reader_q_depth = reader_queue_depth
        self._writer_q_depth = writer_queue_depth

    def _load_model(self) -> YOLO:
        if not os.path.exists(self.model_path):
            raise FileNotFoundError(f"[ANON] Model not found: {self.model_path}")
        print(f"[ANON] Loading model: {self.model_path}")
        model = YOLO(self.model_path)
        model.to(self.device)
        print(f"[ANON] Model ready. Classes: {model.names}")
        return model

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def process_video(
        self,
        video_path: str | Path,
        upload_dir: str | Path,
        upload_type: UploadType = "local",
        progress_callback=None,
    ) -> Path:
        """
        Anonymize *video_path* and write the result to
        ``<upload_dir>/anonymized/<upload_type>/<original_filename>``.

        Args:
            video_path:        Path to the source video file.
            upload_dir:        Root upload directory (UPLOAD_DIR env var).
            upload_type:       ``"local"`` or ``"video_library"``.
            progress_callback: Optional ``(pct: int, msg: str) -> None``.

        Returns:
            Path to the anonymized output video.
        """
        video_path = Path(video_path)
        upload_dir = Path(upload_dir)

        # ── output path ───────────────────────────────────────────────
        out_dir = upload_dir / "anonymized" / upload_type
        out_dir.mkdir(parents=True, exist_ok=True)
        out_path = out_dir / video_path.name

        print(f"[ANON] Input : {video_path}")
        print(f"[ANON] Output: {out_path}")

        # ── open source video ─────────────────────────────────────────
        cap = cv2.VideoCapture(str(video_path))
        if not cap.isOpened():
            raise ValueError(f"[ANON] Cannot open video: {video_path}")

        fps    = cap.get(cv2.CAP_PROP_FPS) or 30.0
        width  = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        total  = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        cap.release()

        print(f"[ANON] {width}x{height}  {fps:.2f} fps  {total} frames")

        # ── shared queues & sentinel ──────────────────────────────────
        _DONE = object()  # sentinel value
        frame_queue = queue.Queue(maxsize=self._reader_q_depth)
        write_queue = queue.Queue(maxsize=self._writer_q_depth)
        error_bucket: list[Exception] = []

        # ── writer thread — pipes BGR frames into FFmpeg (H.264/MP4) ──
        if shutil.which("ffmpeg") is None:
            raise RuntimeError("[ANON] ffmpeg not found on PATH — required for H.264 encoding")

        ffmpeg_cmd = [
            "ffmpeg", "-y",
            "-f", "rawvideo",
            "-vcodec", "rawvideo",
            "-pix_fmt", "bgr24",
            "-s", f"{width}x{height}",
            "-r", str(fps),
            "-i", "pipe:0",
            "-c:v", "libx264",
            "-preset", "veryfast",
            "-crf", "28",
            "-pix_fmt", "yuv420p",
            "-movflags", "+faststart",
            str(out_path),
        ]
        ffmpeg_proc = subprocess.Popen(
            ffmpeg_cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )

        def _writer_thread():
            try:
                while True:
                    item = write_queue.get()
                    if item is _DONE:
                        break
                    ffmpeg_proc.stdin.write(item.tobytes())
            finally:
                ffmpeg_proc.stdin.close()
            ffmpeg_proc.wait()
            if ffmpeg_proc.returncode != 0:
                err = ffmpeg_proc.stderr.read().decode(errors="replace")
                error_bucket.append(RuntimeError(f"[ANON] FFmpeg failed:\n{err}"))

        wt = threading.Thread(target=_writer_thread, daemon=True, name="anon-writer")
        wt.start()

        # ── reader thread ─────────────────────────────────────────────
        def _reader_thread():
            cap_r = cv2.VideoCapture(str(video_path))
            try:
                while True:
                    ret, frame = cap_r.read()
                    if not ret:
                        break
                    frame_queue.put(frame)
            finally:
                cap_r.release()
                frame_queue.put(_DONE)

        rt = threading.Thread(target=_reader_thread, daemon=True, name="anon-reader")
        rt.start()

        # ── GPU inference loop (main thread) ──────────────────────────
        t0 = time.perf_counter()
        processed = 0
        use_half = self.device == "cuda"

        try:
            exhausted = False
            while not exhausted:
                # collect a batch ──────────────────────────────────────
                batch_frames: list[np.ndarray] = []
                while len(batch_frames) < self.batch_size:
                    try:
                        item = frame_queue.get(timeout=10)
                    except queue.Empty:
                        # stalled reader is an error
                        raise RuntimeError("[ANON] Reader stalled — frame_queue empty after 10 s")
                    if item is _DONE:
                        exhausted = True
                        break
                    batch_frames.append(item)

                if not batch_frames:
                    break

                # YOLO batch inference ─────────────────────────────────
                results = self.model.predict(
                    batch_frames,
                    conf=self.confidence,
                    imgsz=640,
                    device=self.device,
                    half=use_half,
                    verbose=False,
                    stream=False,
                )

                # apply blurs & enqueue for writing ───────────────────
                for frame, result in zip(batch_frames, results):
                    if result.boxes is not None and len(result.boxes):
                        boxes_xyxy = result.boxes.xyxy.cpu().numpy().astype(int)
                        for box in boxes_xyxy:
                            _blur_region(frame, box[0], box[1], box[2], box[3], self.blur_strength)
                    write_queue.put(frame)

                processed += len(batch_frames)

                if progress_callback and total > 0:
                    pct = min(99, int(processed / total * 100))
                    progress_callback(pct, f"Anonymizing frame {processed}/{total}")

        except Exception as exc:
            error_bucket.append(exc)
        finally:
            # always signal writer to stop
            write_queue.put(_DONE)

        rt.join()
        wt.join()

        if error_bucket:
            raise error_bucket[0]

        elapsed = time.perf_counter() - t0
        speed   = processed / elapsed if elapsed > 0 else 0
        print(f"[ANON] Done - {processed} frames in {elapsed:.1f}s  ({speed:.1f} fps)")

        if progress_callback:
            progress_callback(100, "Anonymization complete")

        return out_path
