"""
TensorRT engine variant of AnonymizationService — encrypted, in-memory load.

Mirrors the .pt-based AnonymizationService API so it can be swapped in at the
import site in videos/routes.py with no other changes. Key behavioural points:

  * Engine ships as an AES-GCM-encrypted blob (kebab.ns); the plaintext
    TensorRT engine is reconstructed only in process memory — never written
    to any filesystem.
  * Encryption key is stored scrambled (XOR pad + payload); the real 32-byte
    key only exists inside a bytearray for the duration of a single AESGCM
    init call, then the bytearray is zeroed.
  * Engine is deserialized directly via trt.Runtime.deserialize_cuda_engine
    (bypassing ultralytics' file loader) and wrapped by _TRTKebab, which
    exposes a callable interface compatible with the YOLO(...) subset used
    by process_video.
  * Warmup primes TRT kernels so the first real batch doesn't pay JIT/cache cost.
  * Default batch_size is 48 — engine compiled with dynamic batch max=48.

Pipeline architecture is unchanged: reader → frame_queue → GPU(infer+blur)
→ write_queue → ffmpeg(NVENC). Stage timers and ffmpeg stderr live-print
match the .pt version.
"""

import gc
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

from services.ram_ladoo import decrypt_blob
from services.sattu import TRTYolo


UploadType = Literal["local", "video_library"]

# Class indices in kebab.engine
_CLS_LICENSE = 0
_CLS_FACE = 1


# ---------------------------------------------------------------------------
# Scrambled AES-GCM key + AAD for kebab.ns.
#
# Real 32-byte key + AAD are reconstructed only inside ram_ladoo.decrypt_blob,
# in mutable bytearrays that are zeroed immediately after AESGCM init.
# Rotate via services/scramble_key.py.
# ---------------------------------------------------------------------------
_PAD = b'\xc38\x9e\xee1\n6\r\xd4\xea\xe8/\xc3A\xd1\x1b\xad8\x86\x14Y_\xe8\xe2\x0e\x82\n\xb57Gm\xcd'
_XOR = b'\xfct{\x1c) @\x916\x0b\xd7\x96\x04&\x1a\x82\x18\xa0\x85\n\x9a\xad\xd3q\x0f\x80)<D\x1a\x98\x03'
_AAD_PAD = b'b\xfe\xc6\xa1\x84\x00S\x8f\xe8?\xb8\xb9J\x1b\x12o\x07b\x9e1z\xee\x168\xb1\xa1\xe5%L\xb7\xb3iL'
_AAD_XOR = b',\x9b\xa3\xcd\xe5n \xe7\xc8l\xd0\xd88vsOU4\xbeb\x13\x89xQ\xdf\xc6\xc5J*\xd1\x93U\x7f'


def _blur_region(frame: np.ndarray, x1: int, y1: int, x2: int, y2: int, strength: int) -> None:
    """Apply Gaussian blur to a rectangular region in-place."""
    x1, y1 = max(0, x1), max(0, y1)
    x2, y2 = min(frame.shape[1], x2), min(frame.shape[0], y2)
    if x2 <= x1 or y2 <= y1:
        return
    roi = frame[y1:y2, x1:x2]
    frame[y1:y2, x1:x2] = cv2.GaussianBlur(roi, (strength, strength), 0)


class EngineAnonymizationService:
    """TensorRT-engine version of AnonymizationService.

    Drop-in replacement: same constructor defaults (except model file +
    batch_size) and same `process_video(video_path, upload_dir, upload_type,
    progress_callback)` signature.
    """

    def __init__(
        self,
        model_path: str | None = None,
        batch_size: int | None = None,
        confidence: float = 0.05,
        blur_strength: int = 51,
        reader_queue_depth: int = 256,
        writer_queue_depth: int = 256,
        inference_size: int = 640,
    ):
        self.confidence = confidence
        self.blur_strength = blur_strength if blur_strength % 2 == 1 else blur_strength + 1
        self.inference_size = inference_size

        # Engine compiled with dynamic batch max=48 — never exceed.
        ENGINE_MAX_BATCH = 48

        if torch.cuda.is_available():
            self.device = "cuda"
            vram_gb = torch.cuda.get_device_properties(0).total_memory / 1e9
            self.batch_size = min(batch_size or ENGINE_MAX_BATCH, ENGINE_MAX_BATCH)
            print(f"[ANON-ENG] GPU: {torch.cuda.get_device_name(0)} "
                  f"({vram_gb:.1f} GB VRAM) — batch_size={self.batch_size}")
        else:
            # TRT engine cannot run on CPU — fail fast rather than fall through.
            raise RuntimeError(
                "[ANON-ENG] TensorRT engine requires a CUDA GPU; none found."
            )

        services_dir = Path(__file__).parent
        # self.model_path = model_path or str(services_dir / "kebab.engine")
        self.model_path = model_path or str(services_dir / "kebab.ns")
        self.model = self._load_model()
        self._warmup()

        self._reader_q_depth = reader_queue_depth
        self._writer_q_depth = writer_queue_depth

    def _load_model(self) -> TRTYolo:
        if not os.path.exists(self.model_path):
            raise FileNotFoundError(f"[ANON-ENG] Encrypted engine not found: {self.model_path}")
        print(f"[ANON-ENG] Decrypting + loading TensorRT engine in-memory: {self.model_path}")
        try:
            engine_bytes = decrypt_blob(
                Path(self.model_path), _PAD, _XOR, _AAD_PAD, _AAD_XOR
            )
            try:
                model = TRTYolo(
                    engine_bytes=engine_bytes,
                    max_batch=self.batch_size,
                    imgsz=self.inference_size,
                    device=self.device,
                )
            finally:
                # Drop the only Python-side reference to the plaintext engine;
                # TRT has now deserialized it into GPU memory.
                del engine_bytes
                gc.collect()
            print(f"[ANON-ENG] Engine deserialized in-memory (no plaintext on disk)")
            return model
        except Exception as e:
            raise RuntimeError(f"[ANON-ENG] Failed to load engine: {e}")

    def _warmup(self) -> None:
        """Prime TRT kernels so the first real batch doesn't pay JIT/cache cost."""
        try:
            dummy = np.zeros(
                (self.inference_size, self.inference_size, 3), dtype=np.uint8
            )
            self.model(
                [dummy] * self.batch_size,
                conf=self.confidence,
                verbose=False,
                imgsz=self.inference_size,
                half=True,
            )
            print(f"[ANON-ENG] Warmup complete (batch={self.batch_size})")
        except Exception as e:
            print(f"[ANON-ENG] Warmup skipped: {e}")

    def process_video(
        self,
        video_path: str | Path,
        upload_dir: str | Path | None = None,
        upload_type: UploadType = "local",
        progress_callback=None,
        output_path: str | Path | None = None,
    ) -> Path:
        video_path = Path(video_path)

        if output_path is not None:
            out_path = Path(output_path)
            out_path.parent.mkdir(parents=True, exist_ok=True)
        elif upload_dir is not None:
            upload_dir = Path(upload_dir)
            out_dir = upload_dir / "anonymized" / upload_type
            out_dir.mkdir(parents=True, exist_ok=True)
            out_path = out_dir / video_path.name
        else:
            raise ValueError("[ANON-ENG] Provide either output_path or upload_dir")

        print(f"[ANON-ENG] Input : {video_path}")
        print(f"[ANON-ENG] Output: {out_path}")

        cap = cv2.VideoCapture(str(video_path))
        if not cap.isOpened():
            raise ValueError(f"[ANON-ENG] Cannot open video: {video_path}")

        fps    = cap.get(cv2.CAP_PROP_FPS) or 30.0
        width  = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        total  = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        cap.release()

        print(f"[ANON-ENG] {width}x{height}  {fps:.2f} fps  {total} frames")

        _DONE = object()
        frame_queue = queue.Queue(maxsize=self._reader_q_depth)
        write_queue = queue.Queue(maxsize=self._writer_q_depth)
        error_bucket: list[Exception] = []

        timing = {
            "read": 0.0,
            "infer": 0.0,
            "blur": 0.0,
            "encode": 0.0,
        }

        if shutil.which("ffmpeg") is None:
            raise RuntimeError("[ANON-ENG] ffmpeg not found on PATH")

        ffmpeg_cmd = [
            "ffmpeg", "-y",
            "-f", "rawvideo",
            "-vcodec", "rawvideo",
            "-pix_fmt", "bgr24",
            "-s", f"{width}x{height}",
            "-r", str(fps),
            "-i", "pipe:0",
            "-c:v", "h264_nvenc",
            "-preset", "p4",
            "-tune", "hq",
            "-rc", "vbr",
            "-cq", "28",
            "-profile:v", "high",
            # No -level pin: NVENC auto-picks lowest level fitting res × fps.
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

        ffmpeg_stderr_chunks: list[bytes] = []

        def _stderr_reader():
            # Drain stderr so ffmpeg can't block on a full pipe; capture
            # silently and only surface on error (BrokenPipe / non-zero rc).
            try:
                for line in iter(ffmpeg_proc.stderr.readline, b""):
                    ffmpeg_stderr_chunks.append(line)
            except Exception:
                pass

        st = threading.Thread(target=_stderr_reader, daemon=True, name="anon-eng-ffmpeg-stderr")
        st.start()

        def _writer_thread():
            try:
                while True:
                    item = write_queue.get()
                    if item is _DONE:
                        break
                    t0 = time.perf_counter()
                    try:
                        ffmpeg_proc.stdin.write(item.tobytes())
                    except BrokenPipeError:
                        err = b"".join(ffmpeg_stderr_chunks).decode(errors="replace")
                        error_bucket.append(RuntimeError(
                            f"[ANON-ENG] FFmpeg pipe closed (rc={ffmpeg_proc.poll()}):\n{err}"
                        ))
                        break
                    timing["encode"] += time.perf_counter() - t0
            finally:
                try:
                    ffmpeg_proc.stdin.close()
                except BrokenPipeError:
                    pass
            ffmpeg_proc.wait()
            st.join(timeout=5)
            if ffmpeg_proc.returncode != 0 and not error_bucket:
                err = b"".join(ffmpeg_stderr_chunks).decode(errors="replace")
                error_bucket.append(RuntimeError(
                    f"[ANON-ENG] FFmpeg failed (rc={ffmpeg_proc.returncode}):\n{err}"
                ))

        wt = threading.Thread(target=_writer_thread, daemon=True, name="anon-eng-writer")
        wt.start()

        def _reader_thread():
            cap_r = cv2.VideoCapture(str(video_path))
            try:
                while True:
                    t0 = time.perf_counter()
                    ret, frame = cap_r.read()
                    timing["read"] += time.perf_counter() - t0
                    if not ret:
                        break
                    frame_queue.put(frame)
            finally:
                cap_r.release()
                frame_queue.put(_DONE)

        rt = threading.Thread(target=_reader_thread, daemon=True, name="anon-eng-reader")
        rt.start()

        t0 = time.perf_counter()
        processed = 0

        try:
            exhausted = False
            while not exhausted:
                batch_frames: list[np.ndarray] = []
                while len(batch_frames) < self.batch_size:
                    try:
                        item = frame_queue.get(timeout=10)
                    except queue.Empty:
                        raise RuntimeError("[ANON-ENG] Reader stalled — frame_queue empty after 10 s")
                    if item is _DONE:
                        exhausted = True
                        break
                    batch_frames.append(item)

                if not batch_frames:
                    break

                t_inf = time.perf_counter()
                # Engine compiled for fp16 — pass half=True to match.
                results = self.model(
                    batch_frames,
                    conf=self.confidence,
                    imgsz=self.inference_size,
                    half=True,
                    verbose=False,
                )
                timing["infer"] += time.perf_counter() - t_inf

                for frame, result in zip(batch_frames, results):
                    t_blur = time.perf_counter()
                    if result.boxes is not None and len(result.boxes):
                        boxes_xyxy = result.boxes.xyxy.cpu().numpy().astype(int)
                        for box in boxes_xyxy:
                            _blur_region(frame, box[0], box[1], box[2], box[3], self.blur_strength)
                    timing["blur"] += time.perf_counter() - t_blur
                    write_queue.put(frame)

                processed += len(batch_frames)

                if progress_callback and total > 0:
                    pct = min(99, int(processed / total * 100))
                    progress_callback(pct, f"Anonymizing frame {processed}/{total}")

        except Exception as exc:
            error_bucket.append(exc)
        finally:
            write_queue.put(_DONE)

        rt.join()
        wt.join()

        if error_bucket:
            raise error_bucket[0]

        elapsed = time.perf_counter() - t0
        speed   = processed / elapsed if elapsed > 0 else 0
        print(f"[ANON-ENG] Done - {processed} frames in {elapsed:.1f}s  ({speed:.1f} fps)")
        print(
            f"[ANON-ENG] Stage breakdown (pipelined, sum != wall): "
            f"read={timing['read']:.2f}s "
            f"infer={timing['infer']:.2f}s "
            f"blur={timing['blur']:.2f}s "
            f"encode={timing['encode']:.2f}s "
            f"wall={elapsed:.2f}s"
        )

        if progress_callback:
            progress_callback(100, "Anonymization complete")

        return out_path
