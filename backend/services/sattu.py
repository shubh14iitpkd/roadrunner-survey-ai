"""
Shared in-memory TensorRT YOLO inference wrapper.

Deserializes an ultralytics-exported YOLO engine from a bytes object (no file
on disk after decryption) and exposes a callable interface compatible with the
subset of `ultralytics.YOLO(...)` used by EngineAnonymizationService and
EngineVideoProcessor:

    wrapper.names: dict[int, str]      # class id → name
    results = wrapper(frames, conf=..., imgsz=..., half=True, verbose=False)
    for r in results:
        if r.boxes is not None and len(r.boxes):
            r.boxes.xyxy   # (N, 4) on device
            r.boxes.conf   # (N,)   on device
            r.boxes.cls    # (N,)   on device (int)

Two output formats are supported and dispatched on metadata:

  * **YOLOv8 raw** — output (B, 4+nc, anchors). Class scores stacked after
    cxcywh box; consumer does conf filter + class-aware NMS via torchvision.
    Used by kebab.engine (license/face detector).

  * **end2end** — output (B, max_det, 6) with columns (x1, y1, x2, y2, conf,
    cls). NMS already baked into the graph. Consumer just filters by conf
    and undoes the letterbox transform. Used by malai_kofta.engine
    (multi-class road-asset detector).

Pre-processing is identical for both: letterbox the frame to imgsz×imgsz with
gray (114) padding, BGR→RGB, /255, NHWC→NCHW.

All postprocess defaults (IoU 0.45 for NMS path, gray-114 letterbox) mirror
ultralytics' YOLOv8 defaults so this wrapper produces results comparable to
YOLO(...).__call__ on the same engine. See:
    ultralytics/utils/nms.py:non_max_suppression(iou_thres=0.45)
    ultralytics/data/augment.py: (114,114,114) letterbox fill
"""

import json

import cv2
import numpy as np
import tensorrt as trt
import torch
import torchvision


_IOU_THRESH = 0.45
_LETTERBOX_PAD = 114


class _Boxes:
    __slots__ = ("xyxy", "conf", "cls")

    def __init__(self, xyxy: torch.Tensor, conf: torch.Tensor, cls: torch.Tensor):
        self.xyxy = xyxy
        self.conf = conf
        self.cls = cls

    def __len__(self) -> int:
        return int(self.xyxy.shape[0])


class _Result:
    __slots__ = ("boxes",)

    def __init__(self, boxes: "_Boxes | None"):
        self.boxes = boxes


class TRTYolo:
    """Direct-TRT YOLO wrapper supporting both raw YOLOv8 and end2end outputs."""

    def __init__(self, engine_bytes: bytes, max_batch: int, imgsz: int, device: str = "cuda"):
        # ---- Parse ultralytics metadata header [4-byte len][JSON].
        meta: dict = {}
        engine_data = engine_bytes
        if len(engine_bytes) >= 4:
            ml = int.from_bytes(engine_bytes[:4], byteorder="little")
            if 0 < ml < 65536 and len(engine_bytes) > 4 + ml:
                try:
                    meta = json.loads(engine_bytes[4:4 + ml].decode("utf-8"))
                    engine_data = engine_bytes[4 + ml:]
                except (UnicodeDecodeError, json.JSONDecodeError):
                    pass

        raw_names = meta.get("names", {}) or {}
        # ultralytics serializes names with str keys — normalize back to int.
        try:
            self.names: dict[int, str] = {int(k): v for k, v in raw_names.items()}
        except (TypeError, ValueError):
            self.names = raw_names
        self._end2end = bool(meta.get("end2end", False))

        # ---- Deserialize engine, build context.
        logger = trt.Logger(trt.Logger.WARNING)
        runtime = trt.Runtime(logger)
        self._engine = runtime.deserialize_cuda_engine(engine_data)
        if self._engine is None:
            raise RuntimeError("[TRT-YOLO] deserialize_cuda_engine failed")
        self._context = self._engine.create_execution_context()
        self._device = device
        self.max_batch = max_batch
        self.imgsz = imgsz

        # Discover input/output tensor names (TRT 10 API).
        self._input_name: str | None = None
        self._output_names: list[str] = []
        for i in range(self._engine.num_io_tensors):
            n = self._engine.get_tensor_name(i)
            if self._engine.get_tensor_mode(n) == trt.TensorIOMode.INPUT:
                self._input_name = n
            else:
                self._output_names.append(n)
        if not self._input_name or not self._output_names:
            raise RuntimeError("[TRT-YOLO] engine missing input or output tensors")

        self._output_dtypes = {
            n: torch.from_numpy(
                np.empty(0, dtype=trt.nptype(self._engine.get_tensor_dtype(n)))
            ).dtype for n in self._output_names
        }
        self._input_dtype = torch.from_numpy(
            np.empty(0, dtype=trt.nptype(self._engine.get_tensor_dtype(self._input_name)))
        ).dtype

        # Dedicated stream avoids the default-stream sync warning.
        self._stream = torch.cuda.Stream(device=self._device)
        # Output buffer cache keyed by (name, shape) — TRT outputs identical
        # shape for identical input shape, so allocate once and reuse.
        self._out_cache: dict[tuple[str, tuple], torch.Tensor] = {}

    # ----------------------------------------------------------------- call

    def __call__(self, frames, conf: float = 0.25, imgsz: int | None = None,
                 half: bool = True, verbose: bool = False):
        if not frames:
            return []
        size = imgsz or self.imgsz
        b = len(frames)
        if b > self.max_batch:
            raise ValueError(f"batch {b} > engine max_batch {self.max_batch}")

        # ---- Preprocess: letterbox each frame into one NHWC uint8 array,
        # then a single host→device copy and on-GPU normalize/permute.
        host = np.full((b, size, size, 3), _LETTERBOX_PAD, dtype=np.uint8)
        metas: list[tuple[float, int, int, int, int]] = []
        for i, fr in enumerate(frames):
            h0, w0 = fr.shape[:2]
            gain = min(size / h0, size / w0)
            new_h, new_w = int(round(h0 * gain)), int(round(w0 * gain))
            top = int(round((size - new_h) / 2 - 0.1))
            left = int(round((size - new_w) / 2 - 0.1))
            resized = cv2.resize(fr, (new_w, new_h), interpolation=cv2.INTER_LINEAR)
            host[i, top:top + new_h, left:left + new_w] = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB)
            metas.append((gain, left, top, h0, w0))

        x_u8 = torch.from_numpy(host).to(self._device, non_blocking=True)
        x = x_u8.to(self._input_dtype).div_(255.0).permute(0, 3, 1, 2).contiguous()

        # ---- Bind I/O. Reuse cached output buffers per (name, shape).
        self._context.set_input_shape(self._input_name, tuple(x.shape))
        self._context.set_tensor_address(self._input_name, int(x.data_ptr()))
        out_buffers: dict[str, torch.Tensor] = {}
        for name in self._output_names:
            shape = tuple(self._context.get_tensor_shape(name))
            key = (name, shape)
            buf = self._out_cache.get(key)
            if buf is None:
                buf = torch.empty(shape, dtype=self._output_dtypes[name], device=self._device)
                self._out_cache[key] = buf
            out_buffers[name] = buf
            self._context.set_tensor_address(name, int(buf.data_ptr()))

        with torch.cuda.stream(self._stream):
            ok = self._context.execute_async_v3(stream_handle=self._stream.cuda_stream)
            if not ok:
                raise RuntimeError("[TRT-YOLO] execute_async_v3 failed")
        self._stream.synchronize()

        primary = max(out_buffers.values(), key=lambda t: t.numel())
        if primary.ndim != 3:
            raise RuntimeError(f"[TRT-YOLO] unexpected output shape {primary.shape}")

        if self._end2end:
            return self._postproc_end2end(primary[:b].float(), conf, metas)
        return self._postproc_v8raw(primary[:b].float(), conf, metas)

    # --------------------------------------------------------- postprocess

    def _postproc_v8raw(self, pred: torch.Tensor, conf: float,
                        metas: list[tuple]) -> list[_Result]:
        """YOLOv8 raw output: (B, 4+nc, A). Filter by conf, batched NMS,
        rescale to original frame."""
        # (B, 4+nc, A) → (B, A, 4+nc) so per-anchor columns are contiguous.
        if pred.shape[1] < pred.shape[2]:
            pred = pred.permute(0, 2, 1)
        boxes_xywh = pred[..., :4]
        scores = pred[..., 4:]
        cls_conf, cls_idx = scores.max(dim=-1)        # (B, A)
        keep_mask = cls_conf > conf                   # (B, A)

        b = pred.shape[0]
        results: list[_Result] = [_Result(None) for _ in range(b)]
        if not bool(keep_mask.any()):
            return results

        img_idx, anc_idx = keep_mask.nonzero(as_tuple=True)
        kbox = boxes_xywh[img_idx, anc_idx]
        kconf = cls_conf[img_idx, anc_idx]
        kcls = cls_idx[img_idx, anc_idx]

        cx, cy, w, h = kbox.unbind(dim=1)
        kxyxy = torch.stack([cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2], dim=1)

        # Class-aware NMS: separate per (image, class) suppression buckets.
        nc = scores.shape[-1]
        nms_idx = img_idx * nc + kcls
        keep = torchvision.ops.batched_nms(kxyxy, kconf, nms_idx, _IOU_THRESH)
        kxyxy = kxyxy[keep]
        kconf = kconf[keep]
        kcls = kcls[keep]
        img_idx = img_idx[keep]

        self._group_and_rescale(results, img_idx, kxyxy, kconf, kcls, metas)
        return results

    def _postproc_end2end(self, pred: torch.Tensor, conf: float,
                          metas: list[tuple]) -> list[_Result]:
        """end2end output: (B, max_det, 6) with cols (x1, y1, x2, y2, conf, cls).
        NMS already baked into the graph — just filter by conf + rescale."""
        if pred.shape[-1] != 6:
            raise RuntimeError(
                f"[TRT-YOLO] end2end expected last-dim 6, got {pred.shape}"
            )
        all_xyxy = pred[..., :4]                      # (B, K, 4)
        all_conf = pred[..., 4]                       # (B, K)
        all_cls = pred[..., 5].to(torch.int64)        # (B, K)

        keep_mask = all_conf > conf                   # (B, K)
        b = pred.shape[0]
        results: list[_Result] = [_Result(None) for _ in range(b)]
        if not bool(keep_mask.any()):
            return results

        img_idx, k_idx = keep_mask.nonzero(as_tuple=True)
        kxyxy = all_xyxy[img_idx, k_idx]
        kconf = all_conf[img_idx, k_idx]
        kcls = all_cls[img_idx, k_idx]

        self._group_and_rescale(results, img_idx, kxyxy, kconf, kcls, metas)
        return results

    def _group_and_rescale(self, results: list[_Result], img_idx: torch.Tensor,
                           kxyxy: torch.Tensor, kconf: torch.Tensor,
                           kcls: torch.Tensor, metas: list[tuple]) -> None:
        """Split kept rows by image, undo letterbox, write into results."""
        if img_idx.numel() == 0:
            return
        img_idx_cpu = img_idx.cpu().numpy()
        for i in range(len(results)):
            mask = img_idx_cpu == i
            if not mask.any():
                continue
            sel = torch.from_numpy(np.nonzero(mask)[0]).to(self._device)
            boxes_i = kxyxy.index_select(0, sel).clone()
            conf_i = kconf.index_select(0, sel)
            cls_i = kcls.index_select(0, sel)
            gain, pad_x, pad_y, h0, w0 = metas[i]
            boxes_i[:, [0, 2]] -= pad_x
            boxes_i[:, [1, 3]] -= pad_y
            boxes_i /= gain
            boxes_i[:, [0, 2]].clamp_(0, w0 - 1)
            boxes_i[:, [1, 3]].clamp_(0, h0 - 1)
            results[i] = _Result(_Boxes(boxes_i, conf_i, cls_i))
