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


# ─── EMBEDDING HELPERS ───────────────────────────────────────────────────────

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


def _cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    """Cosine similarity between two L2-normalised vectors."""
    return float(np.dot(a, b))


# ─── PER-ASSET EMBEDDING GENERATION ─────────────────────────────────────────

def _generate_embedding_for_asset(asset_doc: dict,
                                  video_base_path: Path) -> Optional[np.ndarray]:
    """
    Open the asset's video, extract the frame, crop the bbox, return embedding.
    Returns None on any failure so the caller can skip gracefully.
    """
    video_key = asset_doc.get("video_key") or asset_doc.get("video_id")
    frame_number = asset_doc.get("frame_number")
    box = asset_doc.get("box")

    if not video_key or frame_number is None or not box:
        log.warning("[LINKER] Asset %s missing video_key/frame_number/box — skipping",
                    asset_doc.get("_id"))
        return None

    video_path = video_base_path / f"{video_key}{VIDEO_EXTENSION}"
    if not video_path.exists():
        # Also try finding within uploads root directly (video_key might be the video_id)
        video_path = video_base_path.parent / f"{video_key}{VIDEO_EXTENSION}"
        if not video_path.exists():
            log.warning("[LINKER] Video not found for key %s", video_key)
            return None

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        log.warning("[LINKER] Cannot open video: %s", video_path)
        return None

    try:
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(frame_number))
        ret, frame = cap.read()
        if not ret:
            log.warning("[LINKER] Cannot read frame %d from %s", frame_number, video_path)
            return None

        crop = _crop_asset(frame, box)
        model, processor, device = _get_clip()
        return _get_embedding(model, processor, device, crop)

    except Exception as exc:
        log.warning("[LINKER] Embedding failed for asset %s: %s", asset_doc.get("_id"), exc)
        return None
    finally:
        cap.release()


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
                                 else asset_doc.get("condition"),
        "defect_id":             asset_doc.get("defect_id"),
        "location":              asset_doc.get("location"),
        "video_id":              video_id,
        "frame_number":          asset_doc.get("frame_number"),
        "time":                  asset_doc.get("timestamp"),
        "box":                   asset_doc.get("box"),
        "match_confidence":      round(match_confidence, 4),
    }


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

    db.master_assets.update_one(
        {"_id": master_doc["_id"]},
        {
            "$push": {"survey_history": entry},
            "$set": {
                "canonical_location":      {"type": "Point", "coordinates": new_coords},
                "last_seen_date":          survey_date,
                "latest_condition":        asset_doc.get("condition"),
                "latest_survey_id":        ObjectId(survey_id) if survey_id else None,
                "latest_survey_display_id": survey_display_id,
                "latest_confidence":       asset_doc.get("confidence"),
                "embedding":               embedding.tolist(),  # update to latest observation
                "issue":                   None if asset_doc.get("condition") == "good"
                                           else asset_doc.get("condition"),
                "updated_at":              datetime.now(timezone.utc),
            },
            "$inc": {"total_surveys_detected": 1},
        },
    )


def _create_master_asset(db, asset_doc: dict, embedding: np.ndarray,
                          survey_id, survey_display_id: str,
                          survey_date, match_confidence: float,
                          route_id) -> ObjectId:
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
                                   else asset_doc.get("condition"),
        "created_at":              datetime.now(timezone.utc),
        "updated_at":              datetime.now(timezone.utc),
    }

    result = db.master_assets.insert_one(doc)
    return result.inserted_id


# ─── MAIN ENTRY POINT ────────────────────────────────────────────────────────

def link_assets_for_video(
    db,
    video_id: str,
    survey_id,
    survey_display_id: str,
    route_id: int,
    survey_date,
    video_base_path: Path,
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

    embedding_ops: list[UpdateOne] = []

    for asset_doc in assets:
        asset_id = asset_doc["_id"]

        # ── 1. Get or generate embedding ──────────────────────────────────
        emb = asset_doc.get("embedding")
        if emb is not None:
            emb_np = np.array(emb, dtype=np.float32)
        else:
            emb_np = _generate_embedding_for_asset(asset_doc, video_base_path)
            if emb_np is None:
                skipped += 1
                continue
            # Queue a db write for the embedding on the asset doc
            embedding_ops.append(
                UpdateOne({"_id": asset_id}, {"$set": {"embedding": emb_np.tolist()}})
            )

        # ── 2. Geospatial + route pre-filter against PAST surveys ─────────
        location = asset_doc.get("location")
        candidates = []

        if location and location.get("coordinates"):
            # Only match master assets on the SAME route from PAST surveys.
            # Exclude master assets whose latest_survey_id is the CURRENT survey —
            # those were created/updated in this same run and are not from a past survey.
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

        # ── 3. Cosine similarity matching using master_assets.embedding ───
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

        # ── 4. Link or create ─────────────────────────────────────────────
        if best_master is not None and best_similarity >= min_similarity:
            # Match found — append to existing master asset
            full_master = db.master_assets.find_one({"_id": best_master["_id"]})
            _update_master_asset(
                db, full_master, asset_doc, emb_np,
                survey_id, survey_display_id, survey_date, best_similarity
            )
            master_id = best_master["_id"]
            linked += 1
            print(f"[LINKER] Asset {asset_id} → linked to master {master_id} (sim={best_similarity:.3f})")
        else:
            # No match — create a brand new master asset
            master_id = _create_master_asset(
                db, asset_doc, emb_np,
                survey_id, survey_display_id, survey_date,
                match_confidence=best_similarity if best_similarity > 0 else 0.0,
                route_id=route_id,
            )
            created += 1
            print(f"[LINKER] Asset {asset_id} → new master {master_id}")

        # Write master_asset_id back to the raw asset observation
        db.assets.update_one(
            {"_id": asset_id},
            {"$set": {"master_asset_id": master_id}}
        )

    # ── 5. Flush embedding writes to assets collection ────────────────────
    if embedding_ops:
        for i in range(0, len(embedding_ops), 100):
            db.assets.bulk_write(embedding_ops[i:i + 100], ordered=False)
        print(f"[LINKER] Wrote {len(embedding_ops)} new embeddings to assets")

    summary = {"linked": linked, "created": created, "skipped": skipped}
    print(f"[LINKER] Done for video {video_id}: {summary}")
    return summary
