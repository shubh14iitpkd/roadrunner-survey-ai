"""
asset_linker.py

Links newly detected asset observations to existing master_assets records
(or creates new ones) using:
  1. Route scoping: only compare within the same route_id
  2. Geospatial pre-filter: canonical_location within GEO_RADIUS_M metres
  3. Cosine-similarity on CLIP embeddings (distance_threshold)

Master assets store their own `embedding` field (the latest observation's
embedding) so matching never needs to chase back to db.assets.

Usage (called from routes.py after video processing completes):
    from services.asset_linker import link_assets_for_video
    link_assets_for_video(db, video_id, survey_id, survey_display_id,
                          route_id, survey_date, video_base_path)
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import cv2
import numpy as np
import torch
from bson import ObjectId
from PIL import Image
from pymongo import UpdateOne
from transformers import CLIPModel, CLIPProcessor

log = logging.getLogger(__name__)

# ─── CONFIG ──────────────────────────────────────────────────────────────────

CLIP_MODEL_ID = "openai/clip-vit-base-patch32"
CROP_PADDING = 20          # px around bbox before feeding to CLIP
VIDEO_EXTENSION = ".mp4"

# Geospatial pre-filter radius (metres) before computing cosine similarity.
# Wider than you think is necessary — GPS drift is real.
GEO_RADIUS_M = 150

# Cosine-similarity match threshold.
# distance_threshold=0.15 → similarity must be >= 0.85 to match.
DEFAULT_DISTANCE_THRESHOLD = 0.15

# CLIP forward-pass batch size. 32 is safe on CPU; bump on GPU.
EMBED_BATCH_SIZE = 32

# ─── CLIP SINGLETON ──────────────────────────────────────────────────────────

_clip_model: Optional[CLIPModel] = None
_clip_processor: Optional[CLIPProcessor] = None
_clip_device: Optional[str] = None


def _get_clip() -> tuple[CLIPModel, CLIPProcessor, str]:
    """Lazy-load CLIP once per process lifetime."""
    global _clip_model, _clip_processor, _clip_device
    if _clip_model is None:
        device = "cuda" if torch.cuda.is_available() else "cpu"
        log.info("[LINKER] Loading CLIP model: %s on %s", CLIP_MODEL_ID, device)
        _clip_model = CLIPModel.from_pretrained(CLIP_MODEL_ID).to(device)
        _clip_processor = CLIPProcessor.from_pretrained(CLIP_MODEL_ID)
        _clip_model.eval()
        _clip_device = device
        log.info("[LINKER] CLIP model loaded")
    return _clip_model, _clip_processor, _clip_device


def _get_embedding(model: CLIPModel, processor: CLIPProcessor,
                   device: str, pil_image: Image.Image) -> np.ndarray:
    """Return an L2-normalised 512-d CLIP embedding as a numpy array."""
    inputs = processor(images=pil_image, return_tensors="pt")
    pixel_values = inputs["pixel_values"].to(device)

    with torch.no_grad():
        vision_output = model.vision_model(pixel_values=pixel_values)
        embedding = model.visual_projection(vision_output.pooler_output)

    embedding = torch.nn.functional.normalize(embedding, p=2, dim=-1)
    return embedding.squeeze().cpu().numpy()  # shape: (512,)


def _get_embeddings_batch(model: CLIPModel, processor: CLIPProcessor,
                          device: str,
                          pil_images: list[Image.Image]) -> np.ndarray:
    """L2-normalised CLIP embeddings for a batch of PIL images.
    Returns array of shape (N, 512)."""
    inputs = processor(images=pil_images, return_tensors="pt")
    pixel_values = inputs["pixel_values"].to(device)
    with torch.no_grad():
        vision_output = model.vision_model(pixel_values=pixel_values)
        embeddings = model.visual_projection(vision_output.pooler_output)
    embeddings = torch.nn.functional.normalize(embeddings, p=2, dim=-1)
    return embeddings.cpu().numpy()


def _crop_asset(frame: np.ndarray, box: dict,
                padding: int = CROP_PADDING) -> Image.Image:
    """
    Crop a bounding box from a video frame (with padding).
    box format: {x, y, width, height}
    """
    h_frame, w_frame = frame.shape[:2]
    x1 = max(0, int(box["x"] - padding))
    y1 = max(0, int(box["y"] - padding))
    x2 = min(w_frame, int(box["x"] + box["width"] + padding))
    y2 = min(h_frame, int(box["y"] + box["height"] + padding))

    crop_bgr = frame[y1:y2, x1:x2]
    if crop_bgr.size == 0:
        raise ValueError(f"Empty crop for box {box}")

    return Image.fromarray(cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2RGB))


def regenerate_embedding(video_path: Path, frame_number: int,
                         box: dict) -> Optional[list]:
    """
    Generate a new CLIP embedding for a given video frame + bounding box.
    Returns the embedding as a list of floats, or None on failure.
    Used by the QC update endpoint when a bounding box is adjusted.
    """
    if not video_path.exists():
        log.warning("[LINKER] Video not found at %s", video_path)
        return None

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        log.warning("[LINKER] Cannot open video: %s", video_path)
        return None

    try:
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_number)
        ret, frame = cap.read()
        if not ret:
            log.warning("[LINKER] Cannot read frame %d from %s", frame_number, video_path)
            return None

        crop = _crop_asset(frame, box)
        model, processor, device = _get_clip()
        emb = _get_embedding(model, processor, device, crop)
        return emb.tolist()

    except Exception as exc:
        log.warning("[LINKER] Embedding regen failed: %s", exc)
        return None
    finally:
        cap.release()


def _cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    """Cosine similarity between two L2-normalised vectors."""
    return float(np.dot(a, b))


# ─── MASTER ASSET HELPERS ────────────────────────────────────────────────────

def _generate_master_display_id(db) -> str:
    from utils.ids import next_sequence
    seq = next_sequence("master_asset_id", db=db)
    return f"MAST-{str(seq).rjust(6, '0')}"


def _build_survey_history_entry(asset_doc: dict, survey_id, survey_display_id: str,
                                 survey_date, match_confidence: float) -> dict:
    video_id = asset_doc.get("video_id", "")
    return {
        "survey_id":              ObjectId(survey_id) if survey_id else None,
        "survey_display_id":     survey_display_id,
        "survey_date":           survey_date,
        "asset_observation_id":  asset_doc["_id"],
        "asset_display_id":      asset_doc.get("asset_display_id"),
        "condition":             asset_doc.get("condition"),
        "confidence":            asset_doc.get("confidence"),
        "issue":                 None if asset_doc.get("condition") == "good"
                                 else "Defective",
        "defect_id":             asset_doc.get("defect_id"),
        "location":              asset_doc.get("location"),
        "video_id":              video_id,
        "frame_number":          asset_doc.get("frame_number"),
        "time":                  asset_doc.get("timestamp"),
        "box":                   asset_doc.get("box"),
        "match_confidence":      round(match_confidence, 4),
    }


_LINEAR_FIELDS = ("kind", "classification", "geometry", "keypoints",
                  "first_frame", "last_frame", "frames")

# ~2m at the equator (1° ≈ 111km). Qatar latitude (~25°N) shrinks the
# longitudinal component slightly but the tolerance stays within ~2-2.2m.
# Chosen empirically: cuts ~50% of coordinates on typical road polylines
# while leaving curves visually faithful up to map zoom 16.
_SIMPLIFY_TOLERANCE_DEG = 0.00002


def _simplify_linestring(geom: dict | None,
                          tolerance_deg: float = _SIMPLIFY_TOLERANCE_DEG
                          ) -> dict | None:
    """Douglas-Peucker simplify a GeoJSON LineString. Returns a new GeoJSON
    dict with fewer coordinates, or None on invalid / too-short input."""
    if not geom or geom.get("type") != "LineString":
        return None
    coords = geom.get("coordinates") or []
    if len(coords) < 3:
        return {"type": "LineString", "coordinates": list(coords)}
    try:
        from shapely.geometry import LineString
        ls = LineString(coords)
        simp = ls.simplify(tolerance_deg, preserve_topology=True)
        return {
            "type": "LineString",
            "coordinates": [[float(x), float(y)] for x, y in simp.coords],
        }
    except Exception:
        return None


def _merge_linear_fields(target: dict, asset_doc: dict) -> None:
    """Copy linear-asset fields from `asset_doc` onto `target` only when the
    source doc carries them (kind == "line"). Point assets untouched.
    Also computes `geometry_simplified` alongside the full geometry so the
    /map-points endpoint can serve the small version without recomputing."""
    if asset_doc.get("kind") != "line":
        return
    for f in _LINEAR_FIELDS:
        v = asset_doc.get(f)
        if v is not None:
            target[f] = v
    geom = asset_doc.get("geometry")
    if geom:
        simplified = _simplify_linestring(geom)
        if simplified:
            target["geometry_simplified"] = simplified


def _update_master_asset(db, master_doc: dict, asset_doc: dict,
                          embedding: np.ndarray,
                          survey_id, survey_display_id: str,
                          survey_date, match_confidence: float) -> None:
    """Append new survey observation to an existing master_assets document."""
    entry = _build_survey_history_entry(
        asset_doc, survey_id, survey_display_id, survey_date, match_confidence
    )

    # Roll canonical_location towards the new observation (running average)
    existing_count = master_doc.get("total_surveys_detected", 1)
    old_coords = master_doc.get("canonical_location", {}).get("coordinates", [0, 0])
    new_coords = (asset_doc.get("location") or {}).get("coordinates", old_coords)
    # avg_lon = (old_coords[0] * existing_count + new_coords[0]) / (existing_count + 1)
    # avg_lat = (old_coords[1] * existing_count + new_coords[1]) / (existing_count + 1)

    new_canonical = {"type": "Point", "coordinates": new_coords}
    set_fields = {
        "canonical_location":      new_canonical,
        "last_seen_date":          survey_date,
        "latest_condition":        asset_doc.get("condition"),
        "latest_survey_id":        ObjectId(survey_id) if survey_id else None,
        "latest_survey_display_id": survey_display_id,
        "latest_confidence":       asset_doc.get("confidence"),
        "embedding":               embedding.tolist(),  # update to latest observation
        "issue":                   None if asset_doc.get("condition") == "good"
                                   else "Defective",
        "updated_at":              datetime.now(timezone.utc),
        # Denormalized fields for fast list queries (avoid $lookup)
        "latest_frame_number":     asset_doc.get("frame_number"),
        "latest_video_id":         asset_doc.get("video_id"),
        "latest_box":              asset_doc.get("box"),
        "latest_defect_id":        asset_doc.get("defect_id"),
        "latest_description":      asset_doc.get("description"),
    }
    # Refresh linear geometry from latest observation (if any) so the map
    # renders the newest polyline for this master asset.
    _merge_linear_fields(set_fields, asset_doc)

    db.master_assets.update_one(
        {"_id": master_doc["_id"]},
        {
            "$push": {"survey_history": entry},
            "$set": set_fields,
            "$inc": {"total_surveys_detected": 1},
        },
    )


def _create_master_asset(db, asset_doc: dict, embedding: np.ndarray,
                          survey_id, survey_display_id: str,
                          survey_date, match_confidence: float,
                          route_id, route_name: str = "",
                          road_side: str = "") -> ObjectId:
    """Insert a brand-new master_assets document."""
    entry = _build_survey_history_entry(
        asset_doc, survey_id, survey_display_id, survey_date, match_confidence
    )

    doc = {
        "master_display_id":       _generate_master_display_id(db),
        "asset_id":                asset_doc.get("asset_id"),
        "asset_type":              asset_doc.get("asset_type") or asset_doc.get("type"),
        "group_id":                asset_doc.get("group_id"),
        "category_id":             asset_doc.get("category_id"),
        "side":                    asset_doc.get("side"),
        "zone":                    asset_doc.get("zone"),
        "route_id":                route_id,
        # Denormalized from roads collection (avoid $lookup at query time)
        "route_name":              route_name,
        "road_side":               road_side,
        "canonical_location":      asset_doc.get("location"),
        "embedding":               embedding.tolist(),
        "first_seen_date":         survey_date,
        "last_seen_date":          survey_date,
        "total_surveys_detected":  1,
        "latest_condition":        asset_doc.get("condition"),
        "latest_survey_id":        ObjectId(survey_id) if survey_id else None,
        "latest_survey_display_id": survey_display_id,
        "latest_confidence":       asset_doc.get("confidence"),
        "survey_history":          [entry],
        "issue":                   None if asset_doc.get("condition") == "good"
                                   else "Defective",
        # Denormalized from latest asset observation (avoid $lookup at query time)
        "latest_frame_number":     asset_doc.get("frame_number"),
        "latest_video_id":         asset_doc.get("video_id"),
        "latest_box":              asset_doc.get("box"),
        "latest_defect_id":        asset_doc.get("defect_id"),
        "latest_description":      asset_doc.get("description"),
        "created_at":              datetime.now(timezone.utc),
        "updated_at":              datetime.now(timezone.utc),
    }

    # Linear-asset fields (only populated for kind == "line"). Carrying
    # these onto master_assets lets the map view render the polyline
    # directly from the lightweight /master/map-points endpoint.
    _merge_linear_fields(doc, asset_doc)

    result = db.master_assets.insert_one(doc)
    return result.inserted_id


def link_assets_for_video(
    db,
    video_id: str,
    survey_id,
    survey_display_id: str,
    route_id: int,
    survey_date,
    video_path: Path,
    distance_threshold: float = DEFAULT_DISTANCE_THRESHOLD,
) -> dict:
    """
    Generate CLIP embeddings for every asset from `video_id`, then match each
    against existing master_assets records on the SAME route from PAST surveys
    (geospatial pre-filter + cosine similarity).

    Creates or updates master_assets accordingly.
    Returns a summary dict with counts.
    """
    log.info("[LINKER] Starting asset linking for video %s", video_id)

    # Look up road name once for denormalization onto master_assets
    road_doc = db.roads.find_one({"route_id": route_id}, {"road_name": 1, "road_side": 1})
    _route_name = road_doc.get("road_name", "") if road_doc else ""
    _road_side = road_doc.get("road_side", "") if road_doc else ""

    # Fetch all assets for this video.
    assets = list(db.assets.find(
        {"video_id": video_id},
        {
            "_id": 1, "video_id": 1, "asset_display_id": 1, "asset_id": 1,
            "asset_type": 1, "type": 1, "group_id": 1, "category_id": 1,
            "side": 1, "zone": 1, "route_id": 1, "location": 1,
            "frame_number": 1, "timestamp": 1, "box": 1,
            "condition": 1, "confidence": 1, "defect_id": 1,
            "embedding": 1,
            # Linear-asset fields — carried onto master_assets so the map
            # view can render polylines directly.
            "kind": 1, "classification": 1, "geometry": 1, "keypoints": 1,
            "first_frame": 1, "last_frame": 1, "frames": 1,
        }
    ))

    if not assets:
        print(f"[LINKER] No assets found for video {video_id}")
        return {"linked": 0, "created": 0, "skipped": 0}

    print(f"[LINKER] Processing {len(assets)} assets for video {video_id}")

    min_similarity = 1.0 - distance_threshold
    linked = 0
    created = 0
    skipped = 0

    # Pre-compute the survey ObjectId once for the exclusion filter
    current_survey_oid = ObjectId(survey_id) if survey_id else None

    embedding_ops: list[UpdateOne] = []   # writes new embeddings to assets
    master_id_ops: list[UpdateOne] = []   # writes master_asset_id to assets

    # ── Phase A+B: stream through the video, embedding crops in batches ───
    # Decoding all frames into memory would blow up on long videos
    # (9k frames × ~6MB BGR ≈ 54GB). Instead we keep at most one decoded
    # frame plus EMBED_BATCH_SIZE small crops in memory at a time.
    by_frame: dict[int, list[int]] = {}
    for i, a in enumerate(assets):
        if a.get("embedding") is not None:
            continue
        if a.get("frame_number") is None or not a.get("box"):
            continue
        by_frame.setdefault(int(a["frame_number"]), []).append(i)

    if by_frame:
        model, processor, device = _get_clip()
        pending: list[tuple[int, Image.Image]] = []  # (asset index, crop)

        def _flush_pending() -> None:
            if not pending:
                return
            pil_imgs = [c for _, c in pending]
            try:
                embs = _get_embeddings_batch(model, processor, device, pil_imgs)
            except Exception as exc:
                log.warning("[LINKER] Batch embed failed (size=%d): %s",
                            len(pending), exc)
                pending.clear()
                return
            for (idx, _), emb_row in zip(pending, embs):
                emb_np = emb_row.astype(np.float32)
                assets[idx]["_embedding_np"] = emb_np
                embedding_ops.append(
                    UpdateOne({"_id": assets[idx]["_id"]},
                              {"$set": {"embedding": emb_np.tolist()}})
                )
            pending.clear()

        cap = cv2.VideoCapture(str(video_path)) if video_path.exists() else None
        if cap is None or not cap.isOpened():
            log.warning("[LINKER] Cannot open video: %s — skipping embed phase",
                        video_path)
            if cap is not None:
                cap.release()
        else:
            try:
                for fn in sorted(by_frame):
                    cap.set(cv2.CAP_PROP_POS_FRAMES, fn)
                    ret, frame = cap.read()
                    if not ret:
                        log.warning("[LINKER] Cannot read frame %d from %s",
                                    fn, video_path)
                        continue
                    for i in by_frame[fn]:
                        try:
                            crop = _crop_asset(frame, assets[i]["box"])
                        except Exception as exc:
                            log.warning("[LINKER] Crop failed for asset %s: %s",
                                        assets[i]["_id"], exc)
                            continue
                        pending.append((i, crop))
                        if len(pending) >= EMBED_BATCH_SIZE:
                            _flush_pending()
                    # frame dropped at end of loop iteration — GC reclaims
                _flush_pending()
            finally:
                cap.release()

    # ── Phase C: per-asset geo filter + cosine match + link/create ────────
    for asset_doc in assets:
        asset_id = asset_doc["_id"]

        emb = asset_doc.get("embedding")
        if emb is not None:
            emb_np = np.array(emb, dtype=np.float32)
        else:
            emb_np = asset_doc.get("_embedding_np")
            if emb_np is None:
                skipped += 1
                continue

        # Geospatial + route pre-filter against PAST surveys
        location = asset_doc.get("location")
        candidates = []

        if location and location.get("coordinates"):
            geo_filter = {
                "route_id": route_id,
                "asset_type": asset_doc.get("asset_type") or asset_doc.get("type"),
                "canonical_location": {
                    "$near": {
                        "$geometry": location,
                        "$maxDistance": GEO_RADIUS_M,
                    }
                },
            }
            if current_survey_oid is not None:
                geo_filter["latest_survey_id"] = {"$ne": current_survey_oid}

            candidates = list(db.master_assets.find(
                geo_filter,
                {"_id": 1, "canonical_location": 1, "total_surveys_detected": 1,
                 "embedding": 1},
            ).limit(10))

        # Cosine similarity matching using master_assets.embedding
        best_master = None
        best_similarity = -1.0

        for candidate in candidates:
            ref_emb = candidate.get("embedding")
            if not ref_emb:
                continue

            ref_emb_np = np.array(ref_emb, dtype=np.float32)
            sim = _cosine_similarity(emb_np, ref_emb_np)

            if sim > best_similarity:
                best_similarity = sim
                best_master = candidate

        # Link or create
        if best_master is not None and best_similarity >= min_similarity:
            full_master = db.master_assets.find_one({"_id": best_master["_id"]})
            _update_master_asset(
                db, full_master, asset_doc, emb_np,
                survey_id, survey_display_id, survey_date, best_similarity
            )
            master_id = best_master["_id"]
            linked += 1
            print(f"[LINKER] Asset {asset_id} → linked to master {master_id} (sim={best_similarity:.3f})")
        else:
            master_id = _create_master_asset(
                db, asset_doc, emb_np,
                survey_id, survey_display_id, survey_date,
                match_confidence=best_similarity if best_similarity > 0 else 0.0,
                route_id=route_id,
                route_name=_route_name,
                road_side=_road_side,
            )
            created += 1
            print(f"[LINKER] Asset {asset_id} → new master {master_id}")

        master_id_ops.append(
            UpdateOne({"_id": asset_id}, {"$set": {"master_asset_id": master_id}})
        )

    # ── Phase D: flush bulk writes ────────────────────────────────────────
    if embedding_ops:
        for i in range(0, len(embedding_ops), 100):
            db.assets.bulk_write(embedding_ops[i:i + 100], ordered=False)
        print(f"[LINKER] Wrote {len(embedding_ops)} new embeddings to assets")
    if master_id_ops:
        for i in range(0, len(master_id_ops), 100):
            db.assets.bulk_write(master_id_ops[i:i + 100], ordered=False)

    summary = {"linked": linked, "created": created, "skipped": skipped}
    print(f"[LINKER] Done for video {video_id}: {summary}")
    # Linker mutates master_assets (insert + update) — wipe cache so the
    # asset library reflects new/updated cells on next read.
    try:
        from cache import invalidate_assets_cache
        invalidate_assets_cache()
    except Exception:  # noqa: BLE001
        pass
    return summary
