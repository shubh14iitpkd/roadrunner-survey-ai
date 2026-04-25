import { useState, useEffect } from "react";
import { api } from "@/lib/api";

/**
 * Module-level cache: keyed by "videoId:frameNumber:variant" → frame API response.
 * Survives across component mounts so re-selecting the same asset is instant.
 * Variant is part of the key so thumb and full coexist independently.
 */
const frameDataCache = new Map<string, { image_data: string; width: number; height: number }>();

type Variant = "thumb" | "full";

interface UseFrameImageInput {
  videoId?: string;
  frameNumber?: number;
  box?: { x: number; y: number; width: number; height: number };
  /**
   * "thumb" — resized server-side (~800px wide JPEG), small payload, default.
   * "full"  — original frame, used for the detail dialog where pixels matter.
   */
  variant?: Variant;
}

interface UseFrameImageResult {
  imageUrl: string | null;
  /** Original frame width in pixels (always returned, used for bbox scaling) */
  frameWidth: number;
  /** Original frame height in pixels */
  frameHeight: number;
  loading: boolean;
}

const THUMB_WIDTH = 1280;

function cacheKey(videoId: string, frameNumber: number, variant: Variant): string {
  return `${videoId}:${frameNumber}:${variant}`;
}

export function useFrameImage({ videoId, frameNumber, variant = "thumb" }: UseFrameImageInput): UseFrameImageResult {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [frameWidth, setFrameWidth] = useState(0);
  const [frameHeight, setFrameHeight] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!videoId || frameNumber == null) {
      setImageUrl(null);
      setFrameWidth(0);
      setFrameHeight(0);
      return;
    }

    const key = cacheKey(videoId, frameNumber, variant);

    const cached = frameDataCache.get(key);
    if (cached) {
      setImageUrl(cached.image_data);
      setFrameWidth(cached.width);
      setFrameHeight(cached.height);
      setLoading(false);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        setImageUrl(null);

        const isFull = variant === "full";
        const frameData = await api.videos.getFrameWithDetections(
          videoId,
          undefined,
          frameNumber,
          isFull ? undefined : THUMB_WIDTH,
          !isFull,
        );

        if (cancelled) return;

        if (frameData?.image_data) {
          const entry = {
            image_data: frameData.image_data,
            width: frameData.width || 1920,
            height: frameData.height || 1080,
          };
          frameDataCache.set(key, entry);
          setImageUrl(entry.image_data);
          setFrameWidth(entry.width);
          setFrameHeight(entry.height);
        }
      } catch (err) {
        console.error("Failed to load frame image:", err);
        if (!cancelled) setImageUrl(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [videoId, frameNumber, variant]);

  return { imageUrl, frameWidth, frameHeight, loading };
}
