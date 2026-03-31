import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { api } from "@/lib/api";
import { useLabelMap } from "@/contexts/LabelMapContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Maximize, Minimize, Play, Pause } from "lucide-react";

/* ── Types ───────────────────────────────────────────────── */

interface Detection {
  class_name: string;
  asset_id?: string;
  category_id?: string;
  confidence: number;
  box?: number[];
  bbox?: { x1: number; y1: number; x2: number; y2: number };
  coordinates?: { x1: number; y1: number; x2: number; y2: number };
}

interface AnnotatedVideoPlayerProps {
  videoSrc: string;
  videoId: string;
}

/* ── Helpers ──────────────────────────────────────────────── */

const FPS = 30;

function getBoundingBox(
  d: Detection
): [number, number, number, number] | null {
  if (d.box && Array.isArray(d.box) && d.box.length >= 4) {
    return [d.box[0], d.box[1], d.box[2], d.box[3]];
  }
  if (d.bbox && typeof d.bbox === "object") {
    return [d.bbox.x1, d.bbox.y1, d.bbox.x2, d.bbox.y2];
  }
  if (d.coordinates && typeof d.coordinates === "object") {
    return [d.coordinates.x1, d.coordinates.y1, d.coordinates.x2, d.coordinates.y2];
  }
  return null;
}

/** Deterministic pastel-ish colour from a string seed. */
function colorForClass(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = ((hash % 360) + 360) % 360;
  return `hsl(${hue}, 80%, 40%)`;
}

/* ── Component ───────────────────────────────────────────── */

export default function AnnotatedVideoPlayer({
  videoSrc,
  videoId,
}: AnnotatedVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);

  const { data: labelMapData } = useLabelMap();

  // frame_number → Detection[]
  const [frameMap, setFrameMap] = useState<Map<number, Detection[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState<string>("all");
  // Original video dimensions (from the <video> element's intrinsic size)
  const [origDims, setOrigDims] = useState<{ w: number; h: number }>({ w: 1920, h: 1080 });

  // Custom controls state
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isBuffering, setIsBuffering] = useState(false);

  /* ── 1. Fetch all detections upfront ─────────────────── */
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFrameMap(new Map());

    (async () => {
      try {
        const resp = await api.videos.getFramesDetectionsOnly(videoId);
        if (cancelled) return;

        const map = new Map<number, Detection[]>();
        for (const frame of resp.items ?? []) {
          const fn = frame.frame_number;
          const dets: Detection[] = frame.detections ?? [];
          if (dets.length > 0) {
            map.set(fn, dets);
          }
        }
        setFrameMap(map);
      } catch (err) {
        console.error("[AnnotatedVideoPlayer] Failed to fetch detections:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [videoId]);

  /* ── 2. Derive unique categories from the detections ── */
  const detectedCategories = useMemo(() => {
    const catSet = new Set<string>();
    for (const dets of frameMap.values()) {
      for (const d of dets) {
        if (d.category_id) catSet.add(d.category_id);
      }
    }
    return Array.from(catSet).sort();
  }, [frameMap]);

  /* ── 3. Label helpers ──────────────────────────────────── */
  const getCategoryDisplayName = useCallback(
    (catId: string): string => {
      return labelMapData?.categories?.[catId]?.display_name ?? catId;
    },
    [labelMapData]
  );

  const getDetectionDisplayName = useCallback(
    (d: Detection): string => {
      if (d.asset_id && labelMapData?.labels?.[d.asset_id]) {
        return labelMapData.labels[d.asset_id].display_name;
      }
      // Fallback: humanise class_name
      const name = (d.class_name ?? "").split("_AssetCondition_")[0];
      return name
        .toLowerCase()
        .split("_")
        .filter(Boolean)
        .map((w) => w[0].toUpperCase() + w.slice(1))
        .join(" ");
    },
    [labelMapData]
  );

  /* ── 4. Drawing loop ───────────────────────────────────── */
  const draw = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Sync canvas pixel size with its actual rendered size.
    // getBoundingClientRect() is correct in both normal mode (inside container)
    // and fullscreen mode (position:fixed over the viewport).
    const rect = canvas.getBoundingClientRect();
    const displayW = Math.round(rect.width);
    const displayH = Math.round(rect.height);

    // This will ensure that canvas matches the size set by css
    if (canvas.width !== displayW || canvas.height !== displayH) {
      canvas.width = displayW;
      canvas.height = displayH;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Current frame number
    const frameNumber = Math.round(video.currentTime * FPS);
    const detections = frameMap.get(frameNumber);
    if (!detections || detections.length === 0) return;

    // Compute the actual rendered video rect inside the container
    // object-contain centers the video and may add horizontal or vertical
    // letterbox bars. We need to know where the actual video pixels are.
    const videoAspect = origDims.w / origDims.h;
    const containerAspect = displayW / displayH;

    let renderW: number, renderH: number, offsetX: number, offsetY: number;

    if (videoAspect > containerAspect) {
      // Video is wider → horizontal fit, vertical letterbox
      renderW = displayW;
      renderH = displayW / videoAspect;
      offsetX = 0;
      offsetY = (displayH - renderH) / 2;
    } else {
      // Video is taller → vertical fit, horizontal letterbox
      renderH = displayH;
      renderW = displayH * videoAspect;
      offsetX = (displayW - renderW) / 2;
      offsetY = 0;
    }

    const scaleX = renderW / origDims.w;
    const scaleY = renderH / origDims.h;

    for (const d of detections) {
      // Category filtering
      if (activeCategory !== "all" && d.category_id !== activeCategory) continue;

      const box = getBoundingBox(d);
      if (!box) continue;

      const x = offsetX + box[0] * scaleX;
      const y = offsetY + box[1] * scaleY;
      const w = (box[2] - box[0]) * scaleX;
      const h = (box[3] - box[1]) * scaleY;

      const color = colorForClass(d.class_name);

      // Bounding box
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, h);

      // Label
      const label = getDetectionDisplayName(d);
      ctx.font = "bold 11px Inter, Arial, sans-serif";
      const tm = ctx.measureText(label);
      const labelH = 18;
      if ((y-labelH)>offsetY && x+tm.width+10 < renderW) {
          ctx.fillStyle = color;
          ctx.fillRect(x, y - labelH, tm.width + 10, labelH);
          ctx.fillStyle = "#ffffff";
          ctx.fillText(label, x + 5, y - 5);
      } else {
          ctx.fillStyle = color;
          ctx.fillRect(x, y, tm.width + 10, labelH);
          ctx.fillStyle = "#ffffff";
          ctx.fillText(label, x + 5, y + labelH - 5);
      }
    }
  }, [frameMap, origDims, activeCategory, getDetectionDisplayName]);

  /* ── 5. rAF loop ───────────────────────────────────────── */
  useEffect(() => {
    // Always draw once so paused/seeked frames are visible
    draw();

    if (!isPlaying) return;

    let running = true;
    const tick = () => {
      if (!running) return;
      draw();
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      running = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, [draw, isPlaying]);

  /* ── 6. Capture original dimensions on metadata load ─── */
  const handleLoadedMetadata = useCallback(() => {
    const v = videoRef.current;
    if (v) {
      setOrigDims({ w: v.videoWidth, h: v.videoHeight });
      setDuration(v.duration || 0);
    }
  }, []);

  /* ── 6b. Sync custom controls state with video ───────── */
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTimeUpdate = () => setCurrentTime(v.currentTime);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => { setIsPlaying(false); setIsBuffering(false); };
    const onEnded = () => { setIsPlaying(false); setIsBuffering(false); };
    const onWaiting = () => setIsBuffering(true);
    const onCanPlay = () => setIsBuffering(false);
    v.addEventListener("timeupdate", onTimeUpdate);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("ended", onEnded);
    v.addEventListener("waiting", onWaiting);
    v.addEventListener("canplay", onCanPlay);
    v.addEventListener("playing", onCanPlay);
    return () => {
      v.removeEventListener("timeupdate", onTimeUpdate);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("ended", onEnded);
      v.removeEventListener("waiting", onWaiting);
      v.removeEventListener("canplay", onCanPlay);
      v.removeEventListener("playing", onCanPlay);
    };
  }, [videoSrc]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  }, []);

  const handleSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Number(e.target.value);
  }, []);

  const formatTime = (t: number) => {
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  /* --- 7. Re-sync canvas on resize & fullscreen change --- */
  useEffect(() => {
    const onResize = () => draw();
    window.addEventListener("resize", onResize);
    document.addEventListener("fullscreenchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      document.removeEventListener("fullscreenchange", onResize);
    };
  }, [draw]);

  /* ── 8. Custom fullscreen toggle (container, not just video) ── */
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    if (!document.fullscreenElement) {
      container.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }, []);

  /* ── Render ─────────────────────────────────────────────── */
  return (
    <div className="space-y-3 flex flex-col h-full">
      {/* Header card — same height as the original video header */}
      <div className="p-4 gradient-card border-0 rounded-lg">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-lg">AI Annotated View</h3>
          <Badge className="bg-gradient-to-r from-blue-500 to-purple-500">AI Processed</Badge>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          Object detection with bounding boxes
        </p>
      </div>

      {/* Video + canvas container */}
      <div className="flex-1 overflow-hidden gradient-card border-0 rounded-lg flex items-center justify-center min-h-0 relative">
        {loading && (
          <div className="absolute inset-0 z-20 bg-background/60 backdrop-blur-sm flex flex-col items-center justify-center rounded-lg">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <span className="text-xs font-medium mt-2">Loading detections…</span>
          </div>
        )}

        {/* Category filter buttons — floating overlay */}
        {detectedCategories.length > 0 && (
          <div className="absolute top-0 left-0 right-2 z-10 flex flex-wrap gap-1.5">
            <Button
              size="default"
              variant={activeCategory === "all" ? "default" : "outline"}
              className={`text-xs h-6 px-2 ${activeCategory === "all" ? "bg-accent text-primary hover:bg-accent hover:text-primary" : "bg-background/80"}`}
              onClick={() => setActiveCategory("all")}
            >
              All
            </Button>
            {detectedCategories.map((catId) => (
              <Button
                key={catId}
                size="default"
                variant={activeCategory === catId ? "default" : "outline"}
                className={`text-xs h-6 px-2 hover ${activeCategory === catId ? "bg-accent text-primary hover:bg-accent hover:text-primary" : "bg-background/80"}`}
                onClick={() => setActiveCategory(catId)}
              >
                {getCategoryDisplayName(catId)}
              </Button>
            ))}
          </div>
        )}

        <div ref={containerRef} className="relative w-full h-full bg-background flex flex-col">
          {/* Video + canvas area */}
          <div className="relative flex-1 min-h-0">
            <video
              ref={videoRef}
              key={videoSrc}
              src={videoSrc}
              onLoadedMetadata={handleLoadedMetadata}
              onClick={togglePlay}
              onDoubleClick={(e) => e.preventDefault()}
              className="absolute inset-0 w-full h-full object-contain"
            />
            <canvas
              ref={canvasRef}
              className="absolute inset-0 w-full h-full pointer-events-none"
            />
            {isBuffering && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <Loader2 className="h-10 w-10 animate-spin text-white drop-shadow-lg" />
              </div>
            )}
              {/* Custom controls bar */}
              <div className="absolute left-0 right-0 bottom-0 flex items-center gap-2 px-3 py-2 bg-black/50 text-white text-xs select-none">
                <button onClick={togglePlay} className="p-1 hover:text-blue-400 transition-colors focus:outline-none focus:ring-none focus:border-none">
                  {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                </button>

                <span className="tabular-nums w-[38px] text-center">{formatTime(currentTime)}</span>

                <input
                  type="range"
                  min={0}
                  max={duration || 1}
                  step={0.01}
                  value={currentTime}
                  onChange={handleSeek}
                  style = {{
                    background: `linear-gradient(to right, #3b82f6 ${
                      (currentTime / duration) * 100
                    }%, #9ca3af ${(currentTime / duration) * 100}%)`,
                  }}
                  className="flex-1 h-1 cursor-pointer appearance-none bg-transparent
                            [&::-webkit-slider-runnable-track]:h-1
                            [&::-webkit-slider-thumb]:appearance-none
                            [&::-webkit-slider-thumb]:h-3
                            [&::-webkit-slider-thumb]:w-3
                            [&::-moz-range-thumb]:h-3
                            [&::-moz-range-thumb]:w-3
                            [&::-moz-range-thumb]:rounded-full
                            [&::-webkit-slider-thumb]:rounded-full
                            [&::-webkit-slider-thumb]:bg-blue-500
                            [&::-webkit-slider-thumb]:-mt-1"
                />

                <span className="tabular-nums w-[38px] text-center">{formatTime(duration)}</span>

                <button
                  onClick={toggleFullscreen}
                  className="p-1 hover:text-blue-400 transition-colors focus:outline-none focus:ring-none focus:border-none"
                  title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
                >
                  {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
                </button>
              </div>
          </div>
        </div>
      </div>
    </div>
  );
}
