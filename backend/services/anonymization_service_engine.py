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
import json
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
import tensorrt as trt
import torch
import torchvision
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


UploadType = Literal["local", "video_library"]

# Class indices in kebab.engine
_CLS_LICENSE = 0
_CLS_FACE = 1


# ---------------------------------------------------------------------------
# Scrambled AES-GCM key + AAD for the encrypted engine (.ns) bundle.
#
# The real 32-byte AES-256 key is never stored as a single literal. At decrypt
# time _xor_reconstruct XORs _PAD ^ _XOR into a bytearray, the bytes view is
# handed to AESGCM, then the bytearray is zeroed and refs dropped. Python's
# immutable bytes copies still linger until GC, so this is best-effort — but
# a memory scan won't find a contiguous 32-byte key sitting on the instance
# for the process lifetime.
#
# Regenerate via services/scramble_key.py (holds the source key + AAD).
# ---------------------------------------------------------------------------
_PAD = b'P\xf6a9\x99\xf1\xaf_\xd7L.\xadC\xd6v\xd1T\xe8\xcf\x9c\xaf\xddh\x15\xb7\xc3\xa10-2\xb3\xef'
_XOR = b'o\xba\x84\xcb\x81\xdb\xd9\xc35\xad\x11\x14\x84\xb1\xbdH\xe1p\xcc\x82l/S\x86\xb6\xc1\x82\xb9^oF!'
_AAD_PAD = b":\xfd\xbd\x14\x04\xed'u\x1f\xd5\xd0\x1c\xf9\x14\x00X\x8e\x9c\x7f\x95\xfa\xcfL\t\x100\xbc[\xbf\xb7\xf4\xfdN"
_AAD_XOR = b't\x98\xd8xe\x83T\x1d?\x86\xb8}\x8byax\xdc\xca_\xc6\x93\xa8"`~W\x9c4\xd9\xd1\xd4\xc1}'


def _xor_reconstruct(pad: bytes, xored: bytes) -> bytearray:
    """XOR two equal-length byte strings into a mutable bytearray so the caller
    can zero it after use. Returning bytes would make the secret immutable and
    un-wipeable."""
    if len(pad) != len(xored):
        raise ValueError("scrambled parts length mismatch")
    out = bytearray(len(pad))
    for i in range(len(pad)):
        out[i] = pad[i] ^ xored[i]
    return out


def _zero(ba: bytearray) -> None:
    for i in range(len(ba)):
        ba[i] = 0


def _decrypt_engine(enc_path: Path) -> bytes:
    """Read an AES-GCM .ns blob (iv || ct+tag) and return plaintext engine
    bytes. Key + AAD are reconstructed locally and zeroed before return."""
    with open(enc_path, "rb") as f:
        blob = f.read()
    if len(blob) < 12 + 16:
        raise ValueError(f"Encrypted engine too small: {enc_path}")
    iv, ct = blob[:12], blob[12:]

    key_ba = _xor_reconstruct(_PAD, _XOR)
    aad_ba = _xor_reconstruct(_AAD_PAD, _AAD_XOR)
    try:
        aesgcm = AESGCM(bytes(key_ba))
        plaintext = aesgcm.decrypt(iv, ct, bytes(aad_ba))
    finally:
        _zero(key_ba)
        _zero(aad_ba)
        del key_ba, aad_ba
        # gc.collect()
    return plaintext


def _blur_region(frame: np.ndarray, x1: int, y1: int, x2: int, y2: int, strength: int) -> None:
    """Apply Gaussian blur to a rectangular region in-place."""
    x1, y1 = max(0, x1), max(0, y1)
    x2, y2 = min(frame.shape[1], x2), min(frame.shape[0], y2)
    if x2 <= x1 or y2 <= y1:
        return
    roi = frame[y1:y2, x1:x2]
    frame[y1:y2, x1:x2] = cv2.GaussianBlur(roi, (strength, strength), 0)


class _TRTKebab:
    """Direct-TensorRT inference wrapper for kebab.engine — replaces the
    ultralytics YOLO wrapper so we can deserialize from an in-memory bytes
    object (engine never touches the filesystem after decryption).

    Exposes a callable interface compatible with the subset of ultralytics
    API used by EngineAnonymizationService:

        results = wrapper(frames, conf=..., imgsz=..., half=True, verbose=False)
        for result in results:
            if result.boxes is not None and len(result.boxes):
                boxes_xyxy = result.boxes.xyxy.cpu().numpy().astype(int)

    Pre/post-processing mirrors YOLOv8: letterbox to imgsz, BGR→RGB, /255,
    raw output (B, 4+nc, anchors) → confidence filter → class-aware NMS →
    rescale boxes back to the original frame.
    """

    # Both values mirror ultralytics' YOLOv8 postprocess defaults so this
    # wrapper produces results comparable to YOLO(...).__call__ on the same
    # engine. Don't tweak without a recalibration pass.
    #   _IOU_THRESH    → ultralytics/utils/nms.py: non_max_suppression(iou_thres=0.45)
    #   _LETTERBOX_PAD → ultralytics/data/augment.py: gray (114,114,114) fill
    _IOU_THRESH = 0.45
    _LETTERBOX_PAD = 114

    class _Boxes:
        __slots__ = ("xyxy",)

        def __init__(self, xyxy: torch.Tensor):
            self.xyxy = xyxy

        def __len__(self) -> int:
            return int(self.xyxy.shape[0])

    class _Result:
        __slots__ = ("boxes",)

        def __init__(self, xyxy: "torch.Tensor | None"):
            self.boxes = _TRTKebab._Boxes(xyxy) if xyxy is not None else None

    def __init__(self, engine_bytes: bytes, max_batch: int, imgsz: int, device: str = "cuda"):
        # Strip optional ultralytics header [4-byte len][JSON metadata] —
        # ultralytics-exported engines embed metadata, hand-built ones don't.
        engine_data = engine_bytes
        if len(engine_bytes) >= 4:
            meta_len = int.from_bytes(engine_bytes[:4], byteorder="little")
            if 0 < meta_len < 65536 and len(engine_bytes) > 4 + meta_len:
                try:
                    json.loads(engine_bytes[4:4 + meta_len].decode("utf-8"))
                    engine_data = engine_bytes[4 + meta_len:]
                except (UnicodeDecodeError, json.JSONDecodeError):
                    pass

        logger = trt.Logger(trt.Logger.WARNING)
        runtime = trt.Runtime(logger)
        self._engine = runtime.deserialize_cuda_engine(engine_data)
        if self._engine is None:
            raise RuntimeError("[ANON-ENG] TRT deserialize_cuda_engine failed")
        self._context = self._engine.create_execution_context()
        self._device = device
        self.max_batch = max_batch
        self.imgsz = imgsz

        # Discover input + output tensor names (TRT 10 API).
        self._input_name: str | None = None
        self._output_names: list[str] = []
        for i in range(self._engine.num_io_tensors):
            name = self._engine.get_tensor_name(i)
            mode = self._engine.get_tensor_mode(name)
            if mode == trt.TensorIOMode.INPUT:
                self._input_name = name
            else:
                self._output_names.append(name)
        if not self._input_name or not self._output_names:
            raise RuntimeError("[ANON-ENG] engine missing input or output tensors")

        # Map output names to dtypes once (needed for buffer allocation).
        self._output_dtypes = {
            n: torch.from_numpy(np.empty(0, dtype=trt.nptype(self._engine.get_tensor_dtype(n)))).dtype
            for n in self._output_names
        }
        self._input_dtype = torch.from_numpy(
            np.empty(0, dtype=trt.nptype(self._engine.get_tensor_dtype(self._input_name)))
        ).dtype

        # Dedicated CUDA stream so TRT enqueue isn't forced to sync on the
        # default stream every call (warning emitted otherwise).
        self._stream = torch.cuda.Stream(device=self._device)

    def __call__(self, frames, conf: float = 0.25, imgsz: int | None = None,
                 half: bool = True, verbose: bool = False):
        if not frames:
            return []
        size = imgsz or self.imgsz
        b = len(frames)
        if b > self.max_batch:
            raise ValueError(f"batch {b} > engine max_batch {self.max_batch}")

        # ---- Preprocess: letterbox each frame, build NCHW batch tensor.
        tensors: list[torch.Tensor] = []
        meta: list[tuple[float, int, int, int, int]] = []  # (gain, pad_x, pad_y, h0, w0)
        for fr in frames:
            t, m = self._letterbox(fr, size)
            tensors.append(t)
            meta.append(m)
        x = torch.stack(tensors, dim=0).to(self._device, dtype=self._input_dtype, non_blocking=True)
        x = x.contiguous()

        # ---- Bind I/O and run TRT.
        self._context.set_input_shape(self._input_name, tuple(x.shape))
        self._context.set_tensor_address(self._input_name, int(x.data_ptr()))

        out_buffers: dict[str, torch.Tensor] = {}
        for name in self._output_names:
            shape = tuple(self._context.get_tensor_shape(name))
            buf = torch.empty(shape, dtype=self._output_dtypes[name], device=self._device)
            out_buffers[name] = buf
            self._context.set_tensor_address(name, int(buf.data_ptr()))

        with torch.cuda.stream(self._stream):
            ok = self._context.execute_async_v3(stream_handle=self._stream.cuda_stream)
            if not ok:
                raise RuntimeError("[ANON-ENG] TRT execute_async_v3 failed")
        self._stream.synchronize()

        # ---- Postprocess: pick raw-detection output (largest tensor), decode.
        primary = max(out_buffers.values(), key=lambda t: t.numel())
        if primary.ndim != 3:
            raise RuntimeError(f"[ANON-ENG] unexpected output shape {primary.shape}")

        # YOLOv8 raw output is (B, 4+nc, anchors); 4+nc < anchors (e.g. 6 vs 8400).
        if primary.shape[1] < primary.shape[2]:
            pred = primary.permute(0, 2, 1).contiguous()  # (B, A, 4+nc)
        else:
            pred = primary  # already (B, A, 4+nc)

        results: list[_TRTKebab._Result] = []
        for i in range(b):
            results.append(self._decode_one(pred[i].float(), conf, meta[i]))
        return results

    def _decode_one(self, pred: torch.Tensor, conf: float,
                    meta: tuple[float, int, int, int, int]) -> "_TRTKebab._Result":
        # pred shape: (A, 4+nc) with box cx,cy,w,h then nc class scores.
        boxes_xywh = pred[:, :4]
        scores = pred[:, 4:]
        cls_conf, cls_idx = scores.max(dim=1)
        keep = cls_conf > conf
        if not keep.any():
            return _TRTKebab._Result(None)

        boxes_xywh = boxes_xywh[keep]
        cls_conf = cls_conf[keep]
        cls_idx = cls_idx[keep]

        # cxcywh → xyxy in letterboxed `size` space.
        cx, cy, w, h = boxes_xywh.unbind(dim=1)
        x1 = cx - w / 2
        y1 = cy - h / 2
        x2 = cx + w / 2
        y2 = cy + h / 2
        boxes_xyxy = torch.stack([x1, y1, x2, y2], dim=1)

        # Class-aware NMS: offset boxes by class id so per-class NMS is a single call.
        max_coord = boxes_xyxy.max()
        offset = cls_idx.float() * (max_coord + 1)
        keep_idx = torchvision.ops.nms(
            boxes_xyxy + offset.unsqueeze(1), cls_conf, self._IOU_THRESH
        )
        boxes_xyxy = boxes_xyxy[keep_idx]

        # Undo letterbox: subtract pad, divide by gain, clamp to original frame.
        gain, pad_x, pad_y, h0, w0 = meta
        boxes_xyxy[:, [0, 2]] -= pad_x
        boxes_xyxy[:, [1, 3]] -= pad_y
        boxes_xyxy /= gain
        boxes_xyxy[:, [0, 2]].clamp_(0, w0 - 1)
        boxes_xyxy[:, [1, 3]].clamp_(0, h0 - 1)

        return _TRTKebab._Result(boxes_xyxy)

    def _letterbox(self, frame: np.ndarray, size: int) -> tuple[torch.Tensor, tuple]:
        h0, w0 = frame.shape[:2]
        gain = min(size / h0, size / w0)
        new_h, new_w = int(round(h0 * gain)), int(round(w0 * gain))
        pad_w = (size - new_w) / 2
        pad_h = (size - new_h) / 2
        top = int(round(pad_h - 0.1))
        bot = int(round(pad_h + 0.1))
        left = int(round(pad_w - 0.1))
        right = int(round(pad_w + 0.1))

        resized = cv2.resize(frame, (new_w, new_h), interpolation=cv2.INTER_LINEAR)
        padded = cv2.copyMakeBorder(
            resized, top, bot, left, right,
            cv2.BORDER_CONSTANT,
            value=(self._LETTERBOX_PAD, self._LETTERBOX_PAD, self._LETTERBOX_PAD),
        )
        rgb = cv2.cvtColor(padded, cv2.COLOR_BGR2RGB)
        tensor = torch.from_numpy(rgb).permute(2, 0, 1).contiguous().float() / 255.0
        return tensor, (gain, left, top, h0, w0)


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

    def _load_model(self) -> "_TRTKebab":
        if not os.path.exists(self.model_path):
            raise FileNotFoundError(f"[ANON-ENG] Encrypted engine not found: {self.model_path}")
        print(f"[ANON-ENG] Decrypting + loading TensorRT engine in-memory: {self.model_path}")
        try:
            engine_bytes = _decrypt_engine(Path(self.model_path))
            try:
                model = _TRTKebab(
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
