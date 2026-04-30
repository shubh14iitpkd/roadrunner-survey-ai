import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api, API_BASE } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useLabelMap } from "@/contexts/LabelMapContext";
import { getCategoryColorCode } from "@/components/CategoryBadge";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  ArrowLeft, Square, Save, Layers, Search, Play, Pause,
  Undo2, Redo2, MousePointer, Trash2, Eye, EyeOff,
  ZoomIn, ZoomOut, RotateCcw,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────
interface Annotation {
  id: string;
  frameNumber: number;
  timestamp: number;
  label: string;
  category_id: string;
  condition: string;
  // Normalised 0-1 relative to video dimensions
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
}

// Active (selected) state — solid fill. Aligned with QC/AssetLibrary which
// use the `destructive` semantic token + emerald for dark-theme parity.
const CONDITION_COLORS_ACTIVE: Record<string, string> = {
  Good: "bg-emerald-500 text-white border-emerald-500",
  Fine: "bg-emerald-500 text-white border-emerald-500",
  Damaged: "bg-destructive text-destructive-foreground border-destructive",
  Defective: "bg-destructive text-destructive-foreground border-destructive",
  Dirty: "bg-amber-500 text-white border-amber-500",
  Overgrown: "bg-amber-500 text-white border-amber-500",
  NoDisplay: "bg-orange-500 text-white border-orange-500",
  FadedPaint: "bg-amber-500 text-white border-amber-500",
  PaintFaded: "bg-amber-500 text-white border-amber-500",
  Missing: "bg-destructive text-destructive-foreground border-destructive",
  MissingPanel: "bg-destructive text-destructive-foreground border-destructive",
  Broken: "bg-destructive text-destructive-foreground border-destructive",
  Bent: "bg-orange-500 text-white border-orange-500",
  Poor: "bg-destructive text-destructive-foreground border-destructive",
};

// Inactive — tinted, dark-mode friendly.
const CONDITION_COLORS: Record<string, string> = {
  Good: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  Fine: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  Damaged: "bg-destructive/10 text-destructive border-destructive/30",
  Defective: "bg-destructive/10 text-destructive border-destructive/30",
  Dirty: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30",
  Overgrown: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30",
  NoDisplay: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/30",
  FadedPaint: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30",
  PaintFaded: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30",
  Missing: "bg-destructive/10 text-destructive border-destructive/30",
  MissingPanel: "bg-destructive/10 text-destructive border-destructive/30",
  Broken: "bg-destructive/10 text-destructive border-destructive/30",
  Bent: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/30",
  Poor: "bg-destructive/10 text-destructive border-destructive/30",
};

const FPS = 30;

function generateId() {
  return Math.random().toString(36).substring(2, 10);
}

const conditionToStorage = (c: string): string => {
  if (c === "Defective") return "damaged";
  return c.toLowerCase();
};

// ─── Existing detection type (from AnnotatedVideoPlayer) ────────────
interface ExistingDetection {
  class_name: string;
  asset_id?: string;
  category_id?: string;
  confidence: number;
  box?: number[];
  bbox?: { x1: number; y1: number; x2: number; y2: number };
}

function getExistingBox(d: ExistingDetection): [number, number, number, number] | null {
  if (d.box && Array.isArray(d.box) && d.box.length >= 4) return [d.box[0], d.box[1], d.box[2], d.box[3]];
  if (d.bbox && typeof d.bbox === "object") return [d.bbox.x1, d.bbox.y1, d.bbox.x2, d.bbox.y2];
  return null;
}

// ─── Main Component ─────────────────────────────────────────────────
export default function VideoAnnotator() {
  const { videoId } = useParams<{ videoId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: labelMap, loading: labelMapLoading } = useLabelMap();

  // Video state
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const baseContainerRef = useRef<HTMLDivElement>(null);
  const [videoSrc, setVideoSrc] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [videoDims, setVideoDims] = useState({ w: 1920, h: 1080 });

  // Existing detections (AI-generated, read-only display)
  const [existingFrameMap, setExistingFrameMap] = useState<Map<number, ExistingDetection[]>>(new Map());
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  // Annotations (user-drawn)
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // History (undo/redo). Each entry carries the annotation list AND the frame
  // the change happened on, so undo/redo can jump the video back to where
  // the edit was — otherwise reverting a bbox on frame 240 while currently
  // looking at frame 80 leaves the user staring at unchanged pixels.
  const [history, setHistory] = useState<{ list: Annotation[]; frame: number | null }[]>([{ list: [], frame: null }]);
  const [historyIndex, setHistoryIndex] = useState(0);

  // Seeking overlay — set true on `seeking`, cleared on `seeked`. Drives
  // a blur+spinner over the video so jumping frames isn't a flash of
  // stale pixels behind a moved bbox.
  const [isSeeking, setIsSeeking] = useState(false);

  // Drawing state
  const [activeTool, setActiveTool] = useState<"select" | "rectangle">("select");
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [drawCurrent, setDrawCurrent] = useState<{ x: number; y: number } | null>(null);

  // Drag / resize on user annotations (new, pre-save only)
  const [dragState, setDragState] = useState<{ id: string; startX: number; startY: number; origX: number; origY: number } | null>(null);
  const [resizeState, setResizeState] = useState<{ id: string; handle: string; startX: number; startY: number; orig: { x: number; y: number; width: number; height: number } } | null>(null);

  // Zoom & visibility
  const [zoom, setZoom] = useState(1);
  const [showLabels, setShowLabels] = useState(true);

  // Label selection
  const [labelSearch, setLabelSearch] = useState("");
  const [selectedLabel, setSelectedLabel] = useState("");
  const [selectedCondition, setSelectedCondition] = useState("");

  // Saving
  const [saving, setSaving] = useState(false);

  // ─── History helpers ─────────────────────────────────────────────
  const pushHistory = useCallback((list: Annotation[], frame: number | null) => {
    setHistory(prev => {
      const newHist = prev.slice(0, historyIndex + 1);
      newHist.push({ list: JSON.parse(JSON.stringify(list)), frame });
      return newHist;
    });
    setHistoryIndex(prev => prev + 1);
  }, [historyIndex]);

  const seekTo = useCallback((frame: number | null) => {
    if (frame == null) return;
    const v = videoRef.current;
    if (!v) return;
    const t = frame / FPS;
    if (Math.abs(v.currentTime - t) < 1e-3) return;
    v.currentTime = t;
  }, []);

  const undo = useCallback(() => {
    if (historyIndex <= 0) return;
    const newIdx = historyIndex - 1;
    setHistoryIndex(newIdx);
    setAnnotations(JSON.parse(JSON.stringify(history[newIdx].list)));
    setSelectedId(null);
    // Jump to the frame where the change happened — the entry being undone
    // (history[historyIndex]) is the one with the relevant frame, not the
    // entry we're moving back to.
    seekTo(history[historyIndex].frame);
  }, [history, historyIndex, seekTo]);

  const redo = useCallback(() => {
    if (historyIndex >= history.length - 1) return;
    const newIdx = historyIndex + 1;
    setHistoryIndex(newIdx);
    setAnnotations(JSON.parse(JSON.stringify(history[newIdx].list)));
    setSelectedId(null);
    seekTo(history[newIdx].frame);
  }, [history, historyIndex, seekTo]);

  // ─── Label map helpers ────────────────────────────────────────────
  const { allLabels, labelToCategoryId } = useMemo(() => {
    if (!labelMap) return { allLabels: [] as string[], labelToCategoryId: {} as Record<string, string> };
    const seen = new Set<string>();
    const l2c: Record<string, string> = {};
    for (const label of Object.values(labelMap.labels)) {
      const catId = label.category_id || "";
      const groupId = label.group_id || label.display_name;
      seen.add(groupId);
      l2c[groupId] = catId;
    }
    const all = Array.from(seen).sort();
    return { allLabels: all, labelToCategoryId: l2c };
  }, [labelMap]);

  const getColorForLabel = useCallback((label: string): string => {
    const catId = labelToCategoryId[label];
    return catId ? getCategoryColorCode(catId) : "#6b7280";
  }, [labelToCategoryId]);

  const getConditionsForLabel = useCallback((label: string): string[] => {
    if (!labelMap) return ["Good", "Defective"];
    for (const item of Object.values(labelMap.labels)) {
      const groupId = item.group_id || item.display_name;
      if (groupId === label && item.attributes?.condition) {
        return [...item.attributes.condition];
      }
    }
    return ["Good", "Defective"];
  }, [labelMap]);

  const getDetectionDisplayName = useCallback((d: ExistingDetection): string => {
    const label = d.asset_id ? labelMap?.labels?.[d.asset_id] : undefined;
    if (label) return label.group_id || label.display_name;
    const name = (d.class_name ?? "").split("_AssetCondition_")[0];
    return name.toLowerCase().split("_").filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
  }, [labelMap]);

  // ─── Load video data ─────────────────────────────────────────────
  useEffect(() => {
    if (!videoId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [videoResp, detectionsResp] = await Promise.all([
          api.videos.get(videoId),
          api.videos.getFramesDetectionsOnly(videoId),
        ]);
        if (cancelled) return;
        if (videoResp?.storage_url) {
          const url = videoResp.storage_url.startsWith("http")
            ? videoResp.storage_url
            : `${API_BASE}${videoResp.storage_url}`;
          setVideoSrc(url);
        } else {
          setError("Video not found");
        }

        const map = new Map<number, ExistingDetection[]>();
        for (const frame of detectionsResp.items ?? []) {
          const dets: ExistingDetection[] = frame.detections ?? [];
          if (dets.length > 0) map.set(frame.frame_number, dets);
        }
        setExistingFrameMap(map);
      } catch (e) {
        console.error("Failed to load video data", e);
        if (!cancelled) setError("Failed to load video");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [videoId]);

  // ─── Video event handlers ────────────────────────────────────────
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTimeUpdate = () => setCurrentTime(v.currentTime);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => setIsPlaying(false);
    const onMeta = () => {
      setVideoDims({ w: v.videoWidth, h: v.videoHeight });
      setDuration(v.duration || 0);
    };
    const onSeeking = () => setIsSeeking(true);
    const onSeeked = () => setIsSeeking(false);
    v.addEventListener("timeupdate", onTimeUpdate);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("ended", onEnded);
    v.addEventListener("loadedmetadata", onMeta);
    v.addEventListener("seeking", onSeeking);
    v.addEventListener("seeked", onSeeked);
    return () => {
      v.removeEventListener("timeupdate", onTimeUpdate);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("ended", onEnded);
      v.removeEventListener("loadedmetadata", onMeta);
      v.removeEventListener("seeking", onSeeking);
      v.removeEventListener("seeked", onSeeked);
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

  const currentFrameNumber = Math.round(currentTime * FPS);

  // ─── Draw existing detections on canvas ──────────────────────────
  const drawExisting = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const base = baseContainerRef.current;
    if (!video || !canvas || !base) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = base.getBoundingClientRect();
    const displayW = Math.round(rect.width);
    const displayH = Math.round(rect.height);
    if (canvas.width !== displayW || canvas.height !== displayH) {
      canvas.width = displayW;
      canvas.height = displayH;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const frameNumber = Math.round(video.currentTime * FPS);
    const detections = existingFrameMap.get(frameNumber);
    if (!detections || detections.length === 0) return;

    const videoAspect = videoDims.w / videoDims.h;
    const containerAspect = displayW / displayH;
    let renderW: number, renderH: number, offsetX: number, offsetY: number;
    if (videoAspect > containerAspect) {
      renderW = displayW; renderH = displayW / videoAspect;
      offsetX = 0; offsetY = (displayH - renderH) / 2;
    } else {
      renderH = displayH; renderW = displayH * videoAspect;
      offsetX = (displayW - renderW) / 2; offsetY = 0;
    }
    const scaleX = renderW / videoDims.w;
    const scaleY = renderH / videoDims.h;

    for (const d of detections) {
      const box = getExistingBox(d);
      if (!box) continue;
      const x = offsetX + box[0] * scaleX;
      const y = offsetY + box[1] * scaleY;
      const w = (box[2] - box[0]) * scaleX;
      const h = (box[3] - box[1]) * scaleY;

      ctx.strokeStyle = "rgba(255,255,255,0.5)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(x, y, w, h);
      ctx.setLineDash([]);

      if (showLabels) {
        const label = getDetectionDisplayName(d);
        ctx.font = "bold 10px Inter, Arial, sans-serif";
        ctx.fillStyle = "rgba(255,255,255,0.6)";
        ctx.fillText(label, x + 3, y > 14 ? y - 4 : y + h + 12);
      }
    }
  }, [existingFrameMap, videoDims, getDetectionDisplayName, showLabels]);

  useEffect(() => {
    drawExisting();
    if (!isPlaying) return;
    let running = true;
    const tick = () => { if (!running) return; drawExisting(); rafRef.current = requestAnimationFrame(tick); };
    rafRef.current = requestAnimationFrame(tick);
    return () => { running = false; cancelAnimationFrame(rafRef.current); };
  }, [drawExisting, isPlaying]);

  useEffect(() => {
    const onResize = () => drawExisting();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [drawExisting]);

  // ─── Overlay position helper (letterbox-aware) ───────────────────
  const [overlayStyle, setOverlayStyle] = useState<React.CSSProperties>({});

  const updateOverlayStyle = useCallback(() => {
    const container = baseContainerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const displayW = rect.width;
    const displayH = rect.height;
    const videoAspect = videoDims.w / videoDims.h;
    const containerAspect = displayW / displayH;
    let renderW: number, renderH: number, offsetX: number, offsetY: number;
    if (videoAspect > containerAspect) {
      renderW = displayW; renderH = displayW / videoAspect;
      offsetX = 0; offsetY = (displayH - renderH) / 2;
    } else {
      renderH = displayH; renderW = displayH * videoAspect;
      offsetX = (displayW - renderW) / 2; offsetY = 0;
    }
    setOverlayStyle({
      position: "absolute",
      left: `${offsetX}px`, top: `${offsetY}px`,
      width: `${renderW}px`, height: `${renderH}px`,
    });
  }, [videoDims]);

  useEffect(() => {
    updateOverlayStyle();
    window.addEventListener("resize", updateOverlayStyle);
    return () => window.removeEventListener("resize", updateOverlayStyle);
  }, [updateOverlayStyle]);

  useEffect(() => { updateOverlayStyle(); }, [videoDims, updateOverlayStyle]);

  // ─── Relative position on overlay ────────────────────────────────
  const getRelativePos = (e: React.MouseEvent) => {
    const rect = overlayRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    };
  };

  // ─── Mouse handlers ──────────────────────────────────────────────
  const handleOverlayMouseDown = (e: React.MouseEvent) => {
    if (activeTool === "rectangle" && !isPlaying) {
      const pos = getRelativePos(e);
      setIsDrawing(true);
      setDrawStart(pos);
      setDrawCurrent(pos);
    } else if (activeTool === "select" && e.target === e.currentTarget) {
      setSelectedId(null);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDrawing) {
      setDrawCurrent(getRelativePos(e));
      return;
    }
    if (dragState) {
      const ann = annotations.find(a => a.id === dragState.id);
      if (!ann) return;
      const pos = getRelativePos(e);
      const dx = pos.x - dragState.startX;
      const dy = pos.y - dragState.startY;
      const nx = Math.max(0, Math.min(1 - ann.width, dragState.origX + dx));
      const ny = Math.max(0, Math.min(1 - ann.height, dragState.origY + dy));
      setAnnotations(prev => prev.map(a => a.id === dragState.id ? { ...a, x: nx, y: ny } : a));
      return;
    }
    if (resizeState) {
      const pos = getRelativePos(e);
      const { orig, handle, startX, startY, id } = resizeState;
      const dx = pos.x - startX;
      const dy = pos.y - startY;
      let newX = orig.x, newY = orig.y, newW = orig.width, newH = orig.height;
      if (handle.includes("e")) newW = Math.max(0.01, orig.width + dx);
      if (handle.includes("w")) { newX = orig.x + dx; newW = Math.max(0.01, orig.width - dx); }
      if (handle.includes("s")) newH = Math.max(0.01, orig.height + dy);
      if (handle.includes("n")) { newY = orig.y + dy; newH = Math.max(0.01, orig.height - dy); }
      setAnnotations(prev => prev.map(a => a.id === id ? { ...a, x: newX, y: newY, width: newW, height: newH } : a));
    }
  };

  const handleMouseUp = () => {
    if (isDrawing && drawStart && drawCurrent) {
      setIsDrawing(false);
      const x = Math.min(drawStart.x, drawCurrent.x);
      const y = Math.min(drawStart.y, drawCurrent.y);
      const w = Math.abs(drawCurrent.x - drawStart.x);
      const h = Math.abs(drawCurrent.y - drawStart.y);

      if (w > 0.01 && h > 0.01) {
        if (!selectedLabel) {
          toast.error("Please select a label from the sidebar first");
        } else {
          const catId = labelToCategoryId[selectedLabel] || "";
          const cond = selectedCondition || "Good";
          const newAnn: Annotation = {
            id: generateId(),
            frameNumber: currentFrameNumber,
            timestamp: currentTime,
            label: selectedLabel,
            category_id: catId,
            condition: cond,
            x, y, width: w, height: h,
            color: getCategoryColorCode(catId),
          };
          const next = [...annotations, newAnn];
          setAnnotations(next);
          pushHistory(next, newAnn.frameNumber);
          toast.success(`Added: ${selectedLabel} (${cond})`);
        }
        setActiveTool("select");
      }
      setDrawStart(null);
      setDrawCurrent(null);
      return;
    }
    if (dragState) {
      const target = annotations.find(a => a.id === dragState.id);
      pushHistory(annotations, target?.frameNumber ?? null);
      setDragState(null);
    }
    if (resizeState) {
      const target = annotations.find(a => a.id === resizeState.id);
      pushHistory(annotations, target?.frameNumber ?? null);
      setResizeState(null);
    }
  };

  const handleContainerMouseLeave = () => {
    if (isDrawing) { setIsDrawing(false); setDrawStart(null); setDrawCurrent(null); }
    if (dragState) {
      const target = annotations.find(a => a.id === dragState.id);
      pushHistory(annotations, target?.frameNumber ?? null);
      setDragState(null);
    }
    if (resizeState) {
      const target = annotations.find(a => a.id === resizeState.id);
      pushHistory(annotations, target?.frameNumber ?? null);
      setResizeState(null);
    }
  };

  // ─── Drag / resize starters ──────────────────────────────────────
  const startDrag = (e: React.MouseEvent, ann: Annotation) => {
    if (activeTool !== "select") return;
    e.stopPropagation();
    const pos = getRelativePos(e);
    setSelectedId(ann.id);
    setDragState({ id: ann.id, startX: pos.x, startY: pos.y, origX: ann.x, origY: ann.y });
  };

  const startResize = (e: React.MouseEvent, ann: Annotation, handle: string) => {
    e.stopPropagation();
    const pos = getRelativePos(e);
    setResizeState({ id: ann.id, handle, startX: pos.x, startY: pos.y, orig: { x: ann.x, y: ann.y, width: ann.width, height: ann.height } });
  };

  // ─── Annotation actions ──────────────────────────────────────────
  const handleDeleteAnnotation = (id: string) => {
    const target = annotations.find(a => a.id === id);
    const next = annotations.filter(a => a.id !== id);
    setAnnotations(next);
    pushHistory(next, target?.frameNumber ?? null);
    if (selectedId === id) setSelectedId(null);
  };

  const handleDeleteSelected = () => {
    if (!selectedId) return;
    handleDeleteAnnotation(selectedId);
  };

  // Sidebar IS the editor — clicking a label/condition while an annotation
  // is selected mutates that annotation in place. No modal.
  const applyAssetMeta = useCallback((id: string, patch: { label?: string; category_id?: string; condition?: string }) => {
    const target = annotations.find(a => a.id === id);
    if (!target) return;
    const newLabel = patch.label ?? target.label;
    const newCat = patch.category_id ?? target.category_id;
    const newCond = patch.condition ?? target.condition;
    if (newLabel === target.label && newCat === target.category_id && newCond === target.condition) {
      return;
    }
    const next = annotations.map(a =>
      a.id === id
        ? { ...a, label: newLabel, category_id: newCat, condition: newCond, color: getCategoryColorCode(newCat) }
        : a
    );
    setAnnotations(next);
    pushHistory(next, target.frameNumber);
  }, [annotations, pushHistory]);

  // ─── Zoom handlers ───────────────────────────────────────────────
  const handleZoomIn = () => setZoom(z => Math.min(5, z + 0.25));
  const handleZoomOut = () => setZoom(z => Math.max(0.5, z - 0.25));
  const handleZoomReset = () => setZoom(1);

  // ─── Annotations for current frame ──────────────────────────────
  const currentFrameAnnotations = useMemo(
    () => annotations.filter(a => a.frameNumber === currentFrameNumber),
    [annotations, currentFrameNumber]
  );

  const annotatedFrameSet = useMemo(
    () => new Set(annotations.map(a => a.frameNumber)),
    [annotations]
  );

  // ─── Save all annotations ────────────────────────────────────────
  const handleSaveAll = async () => {
    if (!videoId || !user || annotations.length === 0) return;
    setSaving(true);
    try {
      const payload = {
        video_id: videoId,
        name: `${user.first_name} ${user.last_name}`.trim(),
        user_id: user.id,
        annotations: annotations.map(a => ({
          frame_number: a.frameNumber,
          timestamp: a.timestamp,
          group_id: a.label,
          category_id: a.category_id,
          condition: conditionToStorage(a.condition),
          box: {
            x: a.x * videoDims.w,
            y: a.y * videoDims.h,
            width: a.width * videoDims.w,
            height: a.height * videoDims.h,
          },
        })),
      };
      const resp = await api.assets.saveManualAnnotations(payload);
      toast.success(`Saved ${resp.assets_created} annotation${resp.assets_created !== 1 ? "s" : ""}`);

      // Merge saved annotations into existingFrameMap so they show as dashed (read-only) detections
      setExistingFrameMap(prev => {
        const next = new Map(prev);
        for (const a of annotations) {
          const det: ExistingDetection = {
            class_name: a.label,
            category_id: a.category_id,
            confidence: 1.0,
            box: [
              a.x * videoDims.w,
              a.y * videoDims.h,
              (a.x + a.width) * videoDims.w,
              (a.y + a.height) * videoDims.h,
            ],
          };
          const existing = next.get(a.frameNumber) ?? [];
          next.set(a.frameNumber, [...existing, det]);
        }
        return next;
      });
      setAnnotations([]);
      setHistory([{ list: [], frame: null }]);
      setHistoryIndex(0);
      setSelectedId(null);
    } catch {
      toast.error("Failed to save annotations");
    } finally {
      setSaving(false);
    }
  };

  // ─── Filtered labels ─────────────────────────────────────────────
  const filteredLabels = useMemo(() => {
    if (!labelSearch.trim()) return allLabels;
    const q = labelSearch.toLowerCase();
    return allLabels.filter(l => l.toLowerCase().includes(q));
  }, [labelSearch, allLabels]);

  const isFullyLoading = loading || labelMapLoading;

  // ─── Render ──────────────────────────────────────────────────────
  return (
    <div className="h-full flex flex-col bg-muted/30">
      {/* ─── Top Toolbar ─── */}
      <div className="border-b border-border bg-card px-4 py-2 flex items-center gap-1">
        <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs mr-2" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </Button>
        <div className="flex items-center gap-2 mr-4">
          <Layers className="h-4 w-4 text-primary" />
          <span className="text-xs font-semibold">Add Missing Annotations</span>
        </div>

        <div className="h-5 w-px bg-border mx-1" />

        {/* Undo / Redo */}
        <Button
          variant="ghost" size="icon" className="h-8 w-8"
          onClick={undo} disabled={historyIndex <= 0}
          title="Undo"
        >
          <Undo2 className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost" size="icon" className="h-8 w-8"
          onClick={redo} disabled={historyIndex >= history.length - 1}
          title="Redo"
        >
          <Redo2 className="h-4 w-4" />
        </Button>

        <div className="h-5 w-px bg-border mx-1" />

        {/* Select tool */}
        <Button
          variant={activeTool === "select" ? "secondary" : "ghost"}
          size="icon" className="h-8 w-8"
          onClick={() => setActiveTool("select")}
          title="Select"
        >
          <MousePointer className="h-4 w-4" />
        </Button>

        {/* Rectangle tool */}
        <Button
          variant={activeTool === "rectangle" ? "default" : "ghost"}
          size="icon" className="h-8 w-8"
          onClick={() => { setActiveTool("rectangle"); if (isPlaying) videoRef.current?.pause(); }}
          title="Draw Rectangle (pauses video)"
        >
          <Square className="h-4 w-4" />
        </Button>

        <div className="h-5 w-px bg-border mx-1" />

        {/* Delete selected */}
        <Button
          variant="ghost" size="icon" className="h-8 w-8"
          onClick={handleDeleteSelected} disabled={!selectedId}
          title="Delete selected annotation"
        >
          <Trash2 className="h-4 w-4" />
        </Button>

        {/* Hide labels */}
        <Button
          variant={showLabels ? "ghost" : "secondary"}
          size="icon" className="h-8 w-8"
          onClick={() => setShowLabels(!showLabels)}
          title={showLabels ? "Hide Labels" : "Show Labels"}
        >
          {showLabels ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
        </Button>

        <div className="h-5 w-px bg-border mx-1" />

        {/* Zoom */}
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleZoomOut} title="Zoom Out">
          <ZoomOut className="h-4 w-4" />
        </Button>
        <span className="text-[10px] text-muted-foreground w-10 text-center font-mono">{Math.round(zoom * 100)}%</span>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleZoomIn} title="Zoom In">
          <ZoomIn className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleZoomReset} title="Reset Zoom">
          <RotateCcw className="h-3.5 w-3.5" />
        </Button>

        <div className="flex-1" />
        {annotations.length > 0 && (
          <Badge variant="secondary" className="text-[10px] mr-2">
            {annotations.length} annotation{annotations.length !== 1 ? "s" : ""}
          </Badge>
        )}
        <Button
          size="sm" className="h-8 text-xs gap-1"
          onClick={handleSaveAll}
          disabled={saving || annotations.length === 0}
        >
          <Save className="h-3.5 w-3.5" /> {saving ? "Saving..." : "Save All"}
        </Button>
      </div>

      {/* ─── Main: Center Canvas + Right Labels ─── */}
      <div className="flex-1 flex overflow-hidden">
        {/* ─── CENTER: Video + Overlay ─── */}
        <div className="flex-1 flex flex-col overflow-hidden bg-neutral-900">
          {isFullyLoading ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="space-y-2 text-center">
                <div className="h-6 w-6 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
                <p className="text-xs text-muted-foreground">Loading...</p>
              </div>
            </div>
          ) : error ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center space-y-2">
                <p className="text-sm text-destructive">{error}</p>
                <Button variant="outline" size="sm" onClick={() => navigate(-1)}>Go Back</Button>
              </div>
            </div>
          ) : (
            <>
              {/* Video area (zoom wrapper inside) */}
              <div
                ref={baseContainerRef}
                className="flex-1 relative min-h-0 overflow-hidden"
                onWheel={(e) => {
                  const delta = e.deltaY > 0 ? -0.15 : 0.15;
                  setZoom(z => Math.min(5, Math.max(0.5, z + delta)));
                }}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleContainerMouseLeave}
              >
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    transform: `scale(${zoom})`,
                    transformOrigin: "center center",
                    transition: "transform 0.15s ease",
                  }}
                >
                  <video
                    ref={videoRef}
                    src={videoSrc}
                    className="absolute inset-0 w-full h-full object-contain"
                    onClick={() => { if (activeTool === "select") togglePlay(); }}
                  />
                  {/* Canvas for existing AI detections (dashed, read-only) */}
                  <canvas
                    ref={canvasRef}
                    className="absolute inset-0 w-full h-full pointer-events-none"
                  />

                  {/* Overlay for drawing + user annotations (positioned over rendered video) */}
                  <div
                    ref={overlayRef}
                    style={overlayStyle}
                    className={cn(
                      "z-10",
                      activeTool === "rectangle" ? "cursor-crosshair" : ""
                    )}
                    onMouseDown={handleOverlayMouseDown}
                  >
                    {currentFrameAnnotations.map(ann => {
                      const isSelected = selectedId === ann.id;
                      return (
                        <div
                          key={ann.id}
                          className={cn(
                            "absolute border-2 pointer-events-auto",
                            !isSelected && "hover:ring-1 hover:ring-white/30",
                            !showLabels && "border-opacity-50",
                            activeTool === "select" ? "cursor-move" : ""
                          )}
                          style={{
                            left: `${ann.x * 100}%`, top: `${ann.y * 100}%`,
                            width: `${ann.width * 100}%`, height: `${ann.height * 100}%`,
                            borderColor: ann.color,
                            backgroundColor: isSelected ? `${ann.color}33` : `${ann.color}15`,
                          }}
                          onMouseDown={e => startDrag(e, ann)}
                          onClick={e => {
                            e.stopPropagation();
                            setSelectedId(ann.id);
                            setSelectedLabel(ann.label);
                            setSelectedCondition(ann.condition);
                          }}
                        >
                          {showLabels && (
                            <div
                              className="absolute -top-4 -left-0.5 px-1.5 py-0.5 text-[9px] select-none font-bold text-white whitespace-nowrap"
                              style={{ backgroundColor: ann.color }}
                            >
                              {ann.label}
                            </div>
                          )}
                          {/* Resize handles (only when selected in select mode) */}
                          {isSelected && activeTool === "select" && (
                            <>
                              {["nw","ne","sw","se","n","s","e","w"].map(h => (
                                <div
                                  key={h}
                                  className="absolute w-2 h-2 rounded-full bg-white border border-gray-600 z-10"
                                  style={{
                                    cursor: h === "nw" || h === "se" ? "nwse-resize" : h === "ne" || h === "sw" ? "nesw-resize" : h === "n" || h === "s" ? "ns-resize" : "ew-resize",
                                    top: h.includes("n") ? "-4px" : h.includes("s") ? "calc(100% - 4px)" : "calc(50% - 4px)",
                                    left: h.includes("w") ? "-4px" : h.includes("e") ? "calc(100% - 4px)" : "calc(50% - 4px)",
                                  }}
                                  onMouseDown={e => startResize(e, ann, h)}
                                />
                              ))}
                            </>
                          )}
                        </div>
                      );
                    })}

                    {/* Drawing preview */}
                    {isDrawing && drawStart && drawCurrent && (
                      <div
                        className="absolute border-2 border-dashed border-primary bg-primary/10 pointer-events-none"
                        style={{
                          left: `${Math.min(drawStart.x, drawCurrent.x) * 100}%`,
                          top: `${Math.min(drawStart.y, drawCurrent.y) * 100}%`,
                          width: `${Math.abs(drawCurrent.x - drawStart.x) * 100}%`,
                          height: `${Math.abs(drawCurrent.y - drawStart.y) * 100}%`,
                        }}
                      />
                    )}
                  </div>
                </div>

                {/* Drawing mode indicator (outside zoom wrapper) */}
                {activeTool === "rectangle" && (
                  <div className="absolute bottom-14 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground px-3 py-1.5 rounded-full text-xs font-medium shadow-lg flex items-center gap-2 z-20">
                    <Square className="h-3.5 w-3.5" />
                    {selectedLabel ? `Drawing: ${selectedLabel}` : "Select a label from sidebar first"}
                  </div>
                )}

                {/* Seeking overlay — blur + spinner during currentTime jumps
                 *  (annotation-list click, undo/redo). Hides the brief stale
                 *  frame behind a moved bbox until the new frame decodes. */}
                {isSeeking && (
                  <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/30 backdrop-blur-sm pointer-events-none">
                    <div className="flex flex-col items-center gap-2">
                      <div className="h-6 w-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span className="text-[10px] text-white/80 font-medium">Loading frame…</span>
                    </div>
                  </div>
                )}
              </div>

              {/* ─── Video Controls / Scrubber ─── */}
              <div className="flex items-center gap-2 px-3 py-2 bg-black/80 text-white text-xs select-none shrink-0">
                <button onClick={togglePlay} className="p-1 hover:text-blue-400 transition-colors">
                  {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                </button>

                <span className="tabular-nums w-[38px] text-center">{formatTime(currentTime)}</span>

                <div className="flex-1 relative">
                  <input
                    type="range"
                    min={0}
                    max={duration || 1}
                    step={0.01}
                    value={currentTime}
                    onChange={handleSeek}
                    style={{
                      background: `linear-gradient(to right, #3b82f6 ${
                        (currentTime / (duration || 1)) * 100
                      }%, #4b5563 ${(currentTime / (duration || 1)) * 100}%)`,
                    }}
                    className="w-full h-1 cursor-pointer appearance-none bg-transparent
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
                  {duration > 0 && Array.from(annotatedFrameSet).map(fn => (
                    <div
                      key={fn}
                      className="absolute top-0 w-1 h-1 bg-amber-400 rounded-full -translate-x-1/2 pointer-events-none"
                      style={{ left: `${(fn / FPS / duration) * 100}%` }}
                    />
                  ))}
                </div>

                <span className="tabular-nums w-[38px] text-center">{formatTime(duration)}</span>
              </div>
            </>
          )}
        </div>

        {/* ─── RIGHT: Labels + Annotations List ─── */}
        <div className="w-[280px] border-l border-border bg-card flex flex-col">
          <div className="px-3 py-2.5 border-b border-border">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
              Labels ({allLabels.length})
            </span>
          </div>
          <div className="px-2 py-2 border-b border-border">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
              <Input
                placeholder="Search labels..."
                value={labelSearch}
                onChange={e => setLabelSearch(e.target.value)}
                className="h-7 text-[10px] pl-7"
              />
            </div>
          </div>

          {/* Condition selector */}
          {selectedLabel && (
            <div className="px-2 py-2 border-b border-border">
              <div className="text-[9px] text-muted-foreground mb-1">Condition for <span className="font-semibold">{selectedLabel}</span>:</div>
              <div className="flex gap-1 flex-wrap">
                {getConditionsForLabel(selectedLabel).map(c => (
                  <button
                    key={c}
                    className={cn(
                      "rounded px-2 py-1 text-[9px] font-semibold border transition-all",
                      selectedCondition === c ? (CONDITION_COLORS_ACTIVE[c] || "bg-primary text-primary-foreground") : (CONDITION_COLORS[c] || "bg-muted")
                    )}
                    onClick={() => {
                      setSelectedCondition(c);
                      if (selectedId) applyAssetMeta(selectedId, { condition: c });
                    }}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Labels list */}
          <ScrollArea className="flex-1 min-h-0">
            <div className="p-2 space-y-0.5">
              {filteredLabels.map(label => {
                const color = getColorForLabel(label);
                const isActive = selectedLabel === label;
                const count = annotations.filter(a => a.label === label).length;
                return (
                  <div
                    key={label}
                    className={cn(
                      "flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer text-[11px] transition-all",
                      isActive ? "bg-primary/10 ring-1 ring-primary/30 font-medium" : "hover:bg-muted/50"
                    )}
                    onClick={() => {
                      // When an annotation is selected the sidebar is its
                      // editor — clicking a label rewrites that annotation's
                      // type. With nothing selected it's the draw-tool pick.
                      if (selectedId) {
                        const conds = getConditionsForLabel(label);
                        const nextCond = conds.includes(selectedCondition) ? selectedCondition : (conds[0] ?? "Good");
                        setSelectedLabel(label);
                        setSelectedCondition(nextCond);
                        applyAssetMeta(selectedId, {
                          label,
                          category_id: labelToCategoryId[label] || "",
                          condition: nextCond,
                        });
                      } else if (isActive) {
                        setSelectedLabel(""); setSelectedCondition("");
                      } else {
                        setSelectedLabel(label);
                        setSelectedCondition(getConditionsForLabel(label)[0]);
                        setActiveTool("rectangle");
                        if (isPlaying) videoRef.current?.pause();
                      }
                    }}
                  >
                    <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                    <span className="flex-1 truncate">{label}</span>
                    {/* {count > 0 && (
                      <Badge variant="secondary" className="text-[8px] h-4 min-w-[16px] px-1">{count}</Badge>
                    )} */}
                  </div>
                );
              })}
            </div>
          </ScrollArea>

          {/* ─── Annotations list ─── */}
          <div className="border-t border-border flex flex-col shrink-0" style={{ height: "40%", minHeight: 180 }}>
            <div className="px-3 py-2 border-b border-border flex items-center justify-between shrink-0">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                Annotations ({annotations.length})
              </span>
            </div>
            <ScrollArea className="flex-1 min-h-0">
              <div className="p-2 space-y-1">
                {annotations.length === 0 && (
                  <p className="text-[10px] text-muted-foreground text-center py-4">
                    Pause video and draw rectangles to annotate
                  </p>
                )}
                {annotations.map(ann => (
                  <div
                    key={ann.id}
                    className={cn(
                      "rounded-md border p-2 cursor-pointer transition-all",
                      selectedId === ann.id
                        ? "border-primary/40 bg-primary/5 ring-1 ring-primary/20"
                        : "border-transparent hover:bg-muted/50"
                    )}
                    onClick={() => {
                      setSelectedId(ann.id);
                      setSelectedLabel(ann.label);
                      setSelectedCondition(ann.condition);
                      seekTo(ann.frameNumber);
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: ann.color }} />
                      <span className="text-[11px] font-medium truncate flex-1">{ann.label}</span>
                    </div>
                    <div className="flex items-center gap-1 mt-1 ml-4">
                      <span className="text-[9px] text-muted-foreground">{ann.condition}</span>
                      <span className="flex-1" />
                      <button
                        className="text-[9px] text-destructive hover:bg-destructive/10 rounded px-1 py-0.5"
                        onClick={e => { e.stopPropagation(); handleDeleteAnnotation(ann.id); }}
                      >
                        <Trash2 className="h-3 w-3 inline mr-0.5" />Del
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        </div>
      </div>

    </div>
  );
}
