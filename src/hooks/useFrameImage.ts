import { useState, useEffect, useRef } from "react";
import { api } from "@/lib/api";

/**
 * Module-level cache: keyed by "videoId:frameNumber" → frame API response.
 * Survives across component mounts so re-selecting the same asset is instant.
 */
const frameDataCache = new Map<string, { image_data: string; width: number; height: number }>();

interface UseFrameImageInput {
  videoId?: string;
  frameNumber?: number;
  box?: { x: number; y: number; width: number; height: number };
}

interface UseFrameImageResult {
  /** Raw base64 image URL from the API (no annotations baked in) */
  imageUrl: string | null;
  /** Original frame width in pixels */
  frameWidth: number;
  /** Original frame height in pixels */
  frameHeight: number;
  /** Whether the image is currently loading */
  loading: boolean;
}

function cacheKey(videoId: string, frameNumber: number): string {
  return `${videoId}:${frameNumber}`;
}

/**
 * Hook that fetches a frame image for an asset and caches the result.
 * Returns the raw image URL + dimensions so the consumer can draw annotations via a canvas overlay.
 */
export function useFrameImage({ videoId, frameNumber }: UseFrameImageInput): UseFrameImageResult {
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

    const key = cacheKey(videoId, frameNumber);

    // Cache hit — instant return, no loading state
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

        const frameData = await api.videos.getFrameWithDetections(
          videoId,
          undefined,
          frameNumber,
          undefined,
          false,
        );

        if (cancelled) return;

        if (frameData?.image_data) {
          const entry = {
            image_data: frameData.image_data,
            width: frameData.width || 1920,
            height: frameData.height || 1080,
          };
          // console.log(entry, "sdd");
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
  }, [videoId, frameNumber]);

  return { imageUrl, frameWidth, frameHeight, loading };
}
