/*
Rules of point asset QC:
- User can only have one annotation at a time, representing the latest observation.
- Need to regenerate embedding on box changes
- user can change condition

Rules of line asset QC:
- User can edit only one keypoint at a time and has to save before moving to next keypoint(we should show a dialog for save or discard before user moves)
- Changing condition changes condition of whole line (we don't store condition with keypoints) if any keypoint is damaged wole line becomes damaged
- for linear asset, we have to ensure that user can change its asset type to other linear assets only
- need to regenerate embedding when box changes are saved
*/
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { useAuth } from "@/contexts/AuthContext";
import { useLabelMap } from "@/contexts/LabelMapContext";
import { getCategoryColorCode } from "@/components/CategoryBadge";
import { useFrameImage } from "@/hooks/useFrameImage";
import LinearAssetFrameSlider from "@/components/LinearAssetFrameSlider";
import type { AssetRecord, LineKeypoint } from "@/types/asset";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Trash2, ZoomIn, ZoomOut, RotateCcw, Eye, EyeOff, Save,
  Layers, ArrowLeft, Square, Undo2, Redo2, MousePointer,
  Search,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

// ─── Types ───────────────────────────────────────────────────────────
interface Annotation {
  id: string;
  label: string;
  category_id: string;
  condition: string;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence?: number;
  status: "ai" | "edited" | "added";
  color: string;
}

// Active (selected) state — solid fill. Aligned with AssetLibrary/DefectLibrary
// which use the `destructive` semantic token + emerald for dark-theme parity.
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

function generateId() { return Math.random().toString(36).substring(2, 10); }

// Map DB condition values to display values and vice-versa
const conditionToDisplay = (c: string): string => {
  if (c.toLowerCase() === 'damaged') return 'Defective';
  // Capitalize first letter for other DB values (e.g. "good" → "Good")
  return c.charAt(0).toUpperCase() + c.slice(1).toLowerCase();
};
const conditionToStorage = (c: string): string => {
  if (c === 'Defective') return 'damaged';
  return c.toLowerCase();
};

// ─── Main Component ─────────────────────────────────────────────────
export default function QCLayer() {
  const { masterDisplayId } = useParams<{ masterDisplayId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: labelMap, loading: labelMapLoading } = useLabelMap();

  // Master asset state
  const [masterAsset, setMasterAsset] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Derive video_id and frame_number from the latest survey history entry
  const latestObservation = useMemo(() => {
    if (!masterAsset?.survey_history?.length) return null;
    return masterAsset.survey_history[masterAsset.survey_history.length - 1];
  }, [masterAsset]);

  const isLine = masterAsset?.kind === "line";

  // ─── Linear-asset keypoint state ──────────────────────────────
  // QC rule: edit ONE keypoint at a time. Save (or discard) before
  // navigating away. `dirtyKp` is the unsaved bbox for the current keypoint;
  // it gets cleared on save, on discard, and on confirmed navigation.
  const qc = useQueryClient();
  const [keypoints, setKeypoints] = useState<LineKeypoint[] | null>(null);
  const [currentKpIdx, setCurrentKpIdx] = useState(0);
  const [dirtyKp, setDirtyKp] = useState<{
    frame: number;
    box: { x: number; y: number; width: number; height: number };
  } | null>(null);
  // Pending navigation guard — set when user tries to move while dirtyKp
  // exists. Resolved by the dialog's Save/Discard/Cancel actions.
  const [pendingNavIdx, setPendingNavIdx] = useState<number | null>(null);
  // Asset-level edits (label / category / condition) live here so they
  // survive keypoint navigation — the annotation init effect rebuilds
  // annotation from masterAsset on every kp change, which would otherwise
  // wipe an in-memory edit.
  const [pendingMeta, setPendingMeta] = useState<{
    group_id?: string;
    category_id?: string;
    condition?: string;
  } | null>(null);

  // Label classifications cache — used to filter the type-picker for
  // linear assets. Single small payload, refreshed every 30 minutes.
  const labelClassQuery = useQuery({
    queryKey: qk.assets.labelClassifications(),
    queryFn: () => api.assets.getLabelClassifications(),
    staleTime: 30 * 60_000,
  });
  const labelClassifications = labelClassQuery.data?.classifications ?? {};

  useEffect(() => {
    if (!isLine || !masterDisplayId) {
      setKeypoints(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const resp = await qc.fetchQuery({
          queryKey: qk.assets.keypoints(masterDisplayId),
          queryFn: () => api.assets.getMasterAssetKeypoints(masterDisplayId),
          staleTime: 5 * 60_000,
        });
        if (cancelled) return;
        const all: LineKeypoint[] = (resp as { keypoints?: LineKeypoint[] } | null)?.keypoints ?? [];
        const masterSide = masterAsset?.side;
        const anyHasSide = all.some((kp) => !!kp.side);
        const filtered = (masterSide && anyHasSide)
          ? all.filter((kp) => kp.side === masterSide)
          : all;
        const sorted = [...filtered].sort((a, b) => a.frame - b.frame);
        setKeypoints(sorted);
        setCurrentKpIdx(0);
        setDirtyKp(null);
        setPendingMeta(null);
        setPendingNavIdx(null);
      } catch {
        if (!cancelled) setKeypoints(null);
      }
    })();
    return () => { cancelled = true; };
  }, [isLine, masterDisplayId, masterAsset?.side, qc]);

  const currentKeypoint = isLine && keypoints ? keypoints[currentKpIdx] ?? null : null;

  // Frame image source: line assets follow the current keypoint's frame;
  // point assets stay on the latest observation. videoId is shared across
  // all keypoints on a line (single survey).
  const frameForImage = isLine ? currentKeypoint?.frame : latestObservation?.frame_number;
  const { imageUrl: frameImageUrl, frameWidth, frameHeight, loading: imageLoading } = useFrameImage({
    videoId: latestObservation?.video_id,
    frameNumber: frameForImage,
  });

  // Annotation state — single annotation
  const [annotation, setAnnotation] = useState<Annotation | null>(null);
  const [isAnnotationSelected, setIsAnnotationSelected] = useState(false);
  const [showLabels, setShowLabels] = useState(true);

  // History (undo/redo)
  const [history, setHistory] = useState<(Annotation | null)[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  // Tools
  const [activeTool, setActiveTool] = useState<"select" | "rectangle">("select");
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [drawCurrent, setDrawCurrent] = useState<{ x: number; y: number } | null>(null);

  // Zoom & Pan
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const canvasRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Label search
  const [labelSearch, setLabelSearch] = useState("");

  // Edit dialog

  // Pre-selected label from right sidebar (used when drawing new rectangle)
  const [selectedLabel, setSelectedLabel] = useState("");
  const [selectedCondition, setSelectedCondition] = useState("");

  // Dragging/resizing annotation
  const [dragState, setDragState] = useState<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const [resizeState, setResizeState] = useState<{ handle: string; startX: number; startY: number; orig: { x: number; y: number; width: number; height: number } } | null>(null);

  // ─── Derive labels from LabelMapContext ────────────
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

  // Color helper using CategoryBadge's getCategoryColorCode
  const getColorForLabel = useCallback((label: string): string => {
    const catId = labelToCategoryId[label];
    return catId ? getCategoryColorCode(catId) : "#6b7280";
  }, [labelToCategoryId]);

  // ─── Push to history ──────────────────────────────────────────
  const pushHistory = useCallback((ann: Annotation | null) => {
    setHistory(prev => {
      const newHist = prev.slice(0, historyIndex + 1);
      newHist.push(ann ? JSON.parse(JSON.stringify(ann)) : null);
      return newHist;
    });
    setHistoryIndex(prev => prev + 1);
  }, [historyIndex]);

  const undo = useCallback(() => {
    if (historyIndex <= 0) return;
    const newIdx = historyIndex - 1;
    setHistoryIndex(newIdx);
    const prev = history[newIdx];
    setAnnotation(prev ? JSON.parse(JSON.stringify(prev)) : null);
  }, [history, historyIndex]);

  const redo = useCallback(() => {
    if (historyIndex >= history.length - 1) return;
    const newIdx = historyIndex + 1;
    setHistoryIndex(newIdx);
    const next = history[newIdx];
    setAnnotation(next ? JSON.parse(JSON.stringify(next)) : null);
  }, [history, historyIndex]);

  // ─── Load master asset ────────────────────────────────────────
  useEffect(() => {
    if (!masterDisplayId) return;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const resp = await api.assets.getMasterByDisplayId(masterDisplayId);
        if (resp?.item) {
          setMasterAsset(resp.item);
        } else {
          setError("Asset not found");
        }
      } catch {
        setError("Failed to load asset");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [masterDisplayId]);

  // ─── Build initial annotation once asset AND image are ready ───
  // For line assets the source bbox is `currentKeypoint.box` (or the user's
  // pending override for that frame). For point assets it stays the latest
  // observation's box.
  useEffect(() => {
    if (!masterAsset || !latestObservation) { setAnnotation(null); return; }
    // Wait for the frame image to finish loading so we have dimensions
    if (imageLoading) return;
    if (isLine && !currentKeypoint) { setAnnotation(null); return; }

    // Asset-level fields prefer the in-flight pendingMeta over the master
    // doc so navigating across keypoints doesn't undo a label/condition
    // edit the user has made but not yet saved.
    const groupId = pendingMeta?.group_id ?? masterAsset.group_id ?? masterAsset.asset_type ?? "Unknown";
    const catId = pendingMeta?.category_id ?? masterAsset.category_id ?? "";
    const rawCondition = pendingMeta?.condition
      ?? latestObservation.condition
      ?? masterAsset.latest_condition
      ?? "Good";
    const condition = conditionToDisplay(rawCondition);

    let ann: Annotation | null = null;
    if (isLine && currentKeypoint) {
      const fw = frameWidth || 2560;
      const fh = frameHeight || 1440;
      const isDirtyHere = dirtyKp && dirtyKp.frame === currentKeypoint.frame;
      let frac: { x: number; y: number; width: number; height: number } | null = null;
      if (isDirtyHere) {
        frac = dirtyKp.box;
      } else if (currentKeypoint.box) {
        const b = currentKeypoint.box;
        const isPixel = b.x > 1 || b.y > 1 || b.width > 1 || b.height > 1;
        frac = {
          x: isPixel ? (b.x ?? 0) / fw : (b.x ?? 0),
          y: isPixel ? (b.y ?? 0) / fh : (b.y ?? 0),
          width: isPixel ? (b.width ?? 0.05) / fw : (b.width ?? 0.05),
          height: isPixel ? (b.height ?? 0.05) / fh : (b.height ?? 0.05),
        };
      }
      if (frac) {
        ann = {
          id: generateId(),
          label: groupId,
          category_id: catId,
          condition,
          ...frac,
          status: isDirtyHere ? "edited" : "ai",
          color: getCategoryColorCode(catId),
        };
      }
    } else {
      const box = latestObservation.box || masterAsset.box;
      if (box) {
        const isPixel = box.x > 1 || box.y > 1 || box.width > 1 || box.height > 1;
        const fw = frameWidth || 2560;
        const fh = frameHeight || 1440;
        ann = {
          id: generateId(),
          label: groupId,
          category_id: catId,
          condition,
          x: isPixel ? (box.x ?? 0) / fw : (box.x ?? 0),
          y: isPixel ? (box.y ?? 0) / fh : (box.y ?? 0),
          width: isPixel ? (box.width ?? 0.05) / fw : (box.width ?? 0.05),
          height: isPixel ? (box.height ?? 0.05) / fh : (box.height ?? 0.05),
          confidence: latestObservation.confidence || masterAsset.latest_confidence,
          status: "ai",
          color: getCategoryColorCode(catId),
        };
      }
    }

    setAnnotation(ann);
    setIsAnnotationSelected(false);
    setHistory([ann ? JSON.parse(JSON.stringify(ann)) : null]);
    setHistoryIndex(0);
    // Sidebar is the editor — keep its selection in sync with the current
    // annotation's asset type + condition so the user can see (and change)
    // them in one place.
    if (ann) {
      setSelectedLabel(ann.label);
      setSelectedCondition(ann.condition);
    }
    // dirtyKp + pendingMeta are read on each rebuild but not driving it —
    // we only re-init when masterAsset / current keypoint / image dims
    // change. Listing them in deps would clear annotation history on every
    // tiny edit.
    // Identity is `currentKpIdx`, not `currentKeypoint?.frame` — linear_unsided
    // assets can have two keypoints sharing the same frame number, and a
    // frame-keyed dep would skip the rebuild when navigating between them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [masterAsset, latestObservation, imageLoading, frameWidth, frameHeight, isLine, currentKpIdx]);

  // ─── Canvas position helpers ──────────────────────────────────
  const getRelativePos = (e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    };
  };

  // ─── Mouse handlers ───────────────────────────────────────────
  const handleMouseDown = (e: React.MouseEvent) => {
    if (activeTool === "rectangle") {
      const pos = getRelativePos(e);
      setIsDrawing(true);
      setDrawStart(pos);
      setDrawCurrent(pos);
    } else if (activeTool === "select") {
      if (e.button === 1 || (zoom > 1 && e.target === canvasRef.current?.parentElement)) {
        setIsPanning(true);
        setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
      }
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDrawing) {
      setDrawCurrent(getRelativePos(e));
    } else if (dragState && annotation) {
      const pos = getRelativePos(e);
      const dx = pos.x - dragState.startX;
      const dy = pos.y - dragState.startY;
      setAnnotation({
        ...annotation,
        x: Math.max(0, Math.min(1 - annotation.width, dragState.origX + dx)),
        y: Math.max(0, Math.min(1 - annotation.height, dragState.origY + dy)),
      });
    } else if (resizeState && annotation) {
      const pos = getRelativePos(e);
      const { orig, handle, startX, startY } = resizeState;
      const dx = pos.x - startX;
      const dy = pos.y - startY;
      let newX = orig.x, newY = orig.y, newW = orig.width, newH = orig.height;
      if (handle.includes("e")) { newW = Math.max(0.01, orig.width + dx); }
      if (handle.includes("w")) { newX = orig.x + dx; newW = Math.max(0.01, orig.width - dx); }
      if (handle.includes("s")) { newH = Math.max(0.01, orig.height + dy); }
      if (handle.includes("n")) { newY = orig.y + dy; newH = Math.max(0.01, orig.height - dy); }
      setAnnotation({ ...annotation, x: newX, y: newY, width: newW, height: newH });
    } else if (isPanning) {
      setPan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
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
          toast.error("Please select a label from the right sidebar first");
        } else if (annotation) {
          toast.error("Only one annotation allowed. Delete the existing one first.");
        } else {
          const catId = labelToCategoryId[selectedLabel] || "";
          const cond = selectedCondition || "Good";
          const newAnn: Annotation = {
            id: generateId(),
            label: selectedLabel,
            category_id: catId,
            condition: cond,
            x, y, width: w, height: h,
            status: "added",
            color: getCategoryColorCode(catId),
          };
          setAnnotation(newAnn);
          pushHistory(newAnn);
          commitPendingKeypointBox(newAnn);
          toast.success(`Added: ${selectedLabel} (${cond})`);
        }
        setActiveTool("select");
      }
      setDrawStart(null);
      setDrawCurrent(null);
    }
    if (dragState) {
      // Only mark dirty if the bbox actually moved. Mere mouseDown+mouseUp
      // (clicking the bbox to select it) used to set dirtyKp, which then
      // blocked the slider's next button with the unsaved-changes dialog.
      const moved = !!annotation && (
        annotation.x !== dragState.origX || annotation.y !== dragState.origY
      );
      if (moved) {
        pushHistory(annotation);
        commitPendingKeypointBox(annotation);
      }
      setDragState(null);
    }
    if (resizeState) {
      const o = resizeState.orig;
      const resized = !!annotation && (
        annotation.x !== o.x || annotation.y !== o.y
        || annotation.width !== o.width || annotation.height !== o.height
      );
      if (resized) {
        pushHistory(annotation);
        commitPendingKeypointBox(annotation);
      }
      setResizeState(null);
    }
    setIsPanning(false);
  };

  // Stash the current annotation's bbox as the dirty edit for this
  // keypoint so the navigation guard can detect unsaved changes.
  // No-op for point assets — those save via the existing latest_box path.
  const commitPendingKeypointBox = useCallback((ann: Annotation | null) => {
    if (!isLine || !currentKeypoint || !ann) return;
    setDirtyKp({
      frame: currentKeypoint.frame,
      box: { x: ann.x, y: ann.y, width: ann.width, height: ann.height },
    });
  }, [isLine, currentKeypoint]);

  // ─── Annotation drag/resize starters ──────────────────────────
  const startDrag = (e: React.MouseEvent) => {
    if (activeTool !== "select" || !annotation) return;
    e.stopPropagation();
    const pos = getRelativePos(e);
    setDragState({ startX: pos.x, startY: pos.y, origX: annotation.x, origY: annotation.y });
    setIsAnnotationSelected(true);
  };

  const startResize = (e: React.MouseEvent, handle: string) => {
    if (!annotation) return;
    e.stopPropagation();
    const pos = getRelativePos(e);
    setResizeState({ handle, startX: pos.x, startY: pos.y, orig: { x: annotation.x, y: annotation.y, width: annotation.width, height: annotation.height } });
  };

  // ─── Annotation actions ───────────────────────────────────────
  const handleDelete = () => {
    if (!annotation) return;
    setAnnotation(null);
    pushHistory(null);
    setIsAnnotationSelected(false);
    // Drop any pending edits too — otherwise Save would still emit a
    // keypoint_update / meta change for the just-deleted state.
    if (isLine) {
      setDirtyKp(null);
      setPendingMeta(null);
    }
    toast.success("Annotation deleted");
  };

  // Mutate the current annotation's asset-level meta in place. Sidebar
  // (label list + condition strip) is the editor — no modal.
  // For line assets we also stash the diff in pendingMeta so the
  // annotation rebuild on keypoint nav preserves the edit.
  const applyAssetMeta = useCallback((patch: { label?: string; category_id?: string; condition?: string }) => {
    setAnnotation((prev) => {
      if (!prev) return prev;
      const newLabel = patch.label ?? prev.label;
      const newCat = patch.category_id ?? prev.category_id;
      const newCond = patch.condition ?? prev.condition;
      if (isLine && masterAsset) {
        const masterGroup = masterAsset.group_id ?? masterAsset.asset_type ?? "";
        const masterCat = masterAsset.category_id ?? "";
        const masterCondStored = conditionToStorage(masterAsset.latest_condition ?? "Good");
        const newCondStored = conditionToStorage(newCond);
        const meta: { group_id?: string; category_id?: string; condition?: string } = {};
        if (newLabel !== masterGroup) meta.group_id = newLabel;
        if (newCat !== masterCat) meta.category_id = newCat;
        if (newCondStored !== masterCondStored) meta.condition = newCondStored;
        setPendingMeta(Object.keys(meta).length ? meta : null);
      }
      const updated: Annotation = {
        ...prev,
        label: newLabel,
        category_id: newCat,
        condition: newCond,
        color: getCategoryColorCode(newCat),
        status: prev.status === "ai" ? "edited" : prev.status,
      };
      pushHistory(updated);
      return updated;
    });
  }, [isLine, masterAsset, pushHistory]);

  const [saving, setSaving] = useState(false);

  const handleSaveAll = async (): Promise<boolean> => {
    if (!masterDisplayId || !user) return false;
    // Hard-guard: a save without a bbox is meaningless — the asset *is* the
    // bbox. This catches the "delete then save" path where annotation is
    // null and any prior dirty edit must be discarded too.
    if (!annotation) {
      toast.error("Draw a bounding box before saving");
      return false;
    }
    // Refuse to save while we don't yet know the frame's pixel dims —
    // multiplying fractional bbox by a fallback (2560×1440) would emit
    // corrupt pixel coordinates for any other resolution.
    if (!frameWidth || !frameHeight) {
      toast.error("Frame not loaded yet — try again in a moment");
      return false;
    }
    const fw = frameWidth;
    const fh = frameHeight;

    // Snapshot the current annotation as the dirty kp if the user pressed
    // Save without a prior drag/resize finishing through mouseUp.
    let activeDirty = dirtyKp;
    if (isLine && currentKeypoint) {
      const same = activeDirty
        && activeDirty.frame === currentKeypoint.frame
        && activeDirty.box.x === annotation.x
        && activeDirty.box.y === annotation.y
        && activeDirty.box.width === annotation.width
        && activeDirty.box.height === annotation.height;
      if (!same) {
        activeDirty = {
          frame: currentKeypoint.frame,
          box: { x: annotation.x, y: annotation.y, width: annotation.width, height: annotation.height },
        };
      }
    }

    // Detect "no actual change" before we burn a network round-trip. Backend
    // also returns "no changes detected" defensively but this gives a
    // tighter, cheaper UX for the common case.
    const masterCondStored = conditionToStorage(masterAsset?.latest_condition ?? "Good");
    const newCondStored = conditionToStorage(annotation.condition);
    const groupChanged = annotation.label !== (masterAsset?.group_id ?? masterAsset?.asset_type ?? "");
    const categoryChanged = annotation.category_id !== (masterAsset?.category_id ?? "");
    const conditionChanged = newCondStored !== masterCondStored;
    const lineBoxChanged = isLine && !!activeDirty;
    const pointBoxChanged = !isLine; // points always send box; backend dedupes
    const anyChange = groupChanged || categoryChanged || conditionChanged || lineBoxChanged || pointBoxChanged;
    if (!anyChange) {
      toast.message("No changes to save");
      return false;
    }

    setSaving(true);
    try {
      const payload: Parameters<typeof api.assets.qcUpdate>[1] = {
        name: `${user.first_name} ${user.last_name}`.trim(),
        user_id: user.id,
        group_id: annotation.label,
        category_id: annotation.category_id,
        condition: newCondStored,
      };

      if (isLine) {
        if (activeDirty) {
          payload.keypoint_updates = [{
            frame: activeDirty.frame,
            box: {
              x: activeDirty.box.x * fw, y: activeDirty.box.y * fh,
              width: activeDirty.box.width * fw, height: activeDirty.box.height * fh,
            },
          }];
        }
      } else {
        payload.box = {
          x: annotation.x * fw,
          y: annotation.y * fh,
          width: annotation.width * fw,
          height: annotation.height * fh,
        };
      }

      const resp = await api.assets.qcUpdate(masterDisplayId, payload);
      // Backend returns `{ok: true, message: "no changes detected"}` when its
      // own diff says nothing changed. Don't lie to the user with a success
      // toast in that case.
      if (resp && (resp as { message?: string }).message === "no changes detected") {
        toast.message("No changes to save");
        return false;
      }
      if (isLine) {
        setDirtyKp(null);
        setPendingMeta(null);
        // Mirror the just-saved bbox into our local keypoints copy so
        // navigating back to this point reads the new box (not the stale
        // server payload from the initial fetch).
        if (activeDirty) {
          setKeypoints((prev) => {
            if (!prev) return prev;
            return prev.map((kp) =>
              kp.frame === activeDirty!.frame
                ? {
                    ...kp,
                    box: {
                      x: activeDirty!.box.x * fw,
                      y: activeDirty!.box.y * fh,
                      width: activeDirty!.box.width * fw,
                      height: activeDirty!.box.height * fh,
                    },
                  }
                : kp,
            );
          });
        }
      }
      // Refresh master so any type/category/condition change is reflected
      // immediately (label list, condition picker, default category).
      if (groupChanged || categoryChanged || conditionChanged) {
        try {
          const fresh = await api.assets.getMasterByDisplayId(masterDisplayId);
          if (fresh?.item) setMasterAsset(fresh.item);
        } catch { /* non-fatal — UI just stays on the old master snapshot */ }
      }
      // Wipe every assets-scoped React Query cache so AssetLibrary /
      // DefectLibrary / map / detail / conditionLogs / keypoints all
      // re-fetch fresh server truth the next time they read. QC edits can
      // touch type, category, condition, or bbox — any of which shifts
      // sort order, map markers, paginated rows, or detail fields. Backend
      // already drops its assets:* Redis cache via the assets blueprint
      // after_request hook, so the refetch returns up-to-date data.
      qc.invalidateQueries({ queryKey: qk.assets.all });
      toast.success("Annotation saved");
      return true;
    } catch {
      toast.error("Failed to save annotation");
      return false;
    } finally {
      setSaving(false);
    }
  };

  // Zoom controls
  const handleZoomIn = () => setZoom(prev => Math.min(5, prev + 0.25));
  const handleZoomOut = () => setZoom(prev => Math.max(0.5, prev - 0.25));
  const handleZoomReset = () => { setZoom(1); setPan({ x: 0, y: 0 }); };

  // Filtered labels — restrict the type-picker to compatible kinds:
  // linear masters → linear_sided ∪ linear_unsided (no point re-type),
  // point masters  → point (no linear re-type).
  // Falls back to the full list while the classifications query is in flight.
  const allowedLabels = useMemo(() => {
    if (Object.keys(labelClassifications).length === 0) return null;
    const allowed = new Set<string>();
    for (const label of allLabels) {
      const cls = labelClassifications[label];
      if (isLine) {
        if (cls === "linear_sided" || cls === "linear_unsided") allowed.add(label);
      } else {
        if (cls === "point") allowed.add(label);
      }
    }
    return allowed;
  }, [isLine, allLabels, labelClassifications]);

  const filteredLabels = useMemo(() => {
    let pool = allLabels;
    if (allowedLabels) pool = pool.filter((l) => allowedLabels.has(l));
    if (!labelSearch.trim()) return pool;
    const q = labelSearch.toLowerCase();
    return pool.filter(l => l.toLowerCase().includes(q));
  }, [labelSearch, allLabels, allowedLabels]);

  // Empty-state copy for the sidebar list — distinguishes "no compatible
  // labels available at all" from "search yields no matches" so the user
  // knows whether to clear the search or pick a different category.
  const sidebarEmptyLabel = useMemo(() => {
    const kind = isLine ? "linear" : "point";
    return labelSearch ? `No ${kind} assets match` : `No ${kind} assets available`;
  }, [isLine, labelSearch]);

  // Drop a previously-selected sidebar label that fell outside the
  // compatible filter (e.g. user navigated to a master of different kind).
  // Clearing also drops the dependent condition so the badge isn't stuck.
  useEffect(() => {
    if (!selectedLabel) return;
    if (allowedLabels && !allowedLabels.has(selectedLabel)) {
      setSelectedLabel("");
      setSelectedCondition("");
    }
  }, [selectedLabel, allowedLabels]);

  // Conditions for a label — derive from labelMap attributes or fallback
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

  const isFullyLoading = loading || labelMapLoading;

  // ─── Render ───────────────────────────────────────────────────
  return (
    <div className="h-full flex flex-col bg-muted/30">
      {/* ─── Top Toolbar ─── */}
      <div className="border-b border-border bg-card px-4 py-2 flex items-center gap-1">
        {/* Left: Back + Title */}
        <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs mr-2" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </Button>
        <div className="flex items-center gap-2 mr-4">
          <Layers className="h-4 w-4 text-primary dark:text-muted-secondary" />
          <span className="text-xs font-semibold">QC Layer</span>
          {masterDisplayId && (
            <span className="text-[10px] text-muted-foreground">
              {masterDisplayId}
            </span>
          )}
          {masterAsset && (
            <Badge
              variant="outline"
              className={cn(
                "text-[9px] h-5 px-1.5 uppercase tracking-wider font-semibold",
                isLine
                  ? "border-violet-500/40 text-violet-600 dark:text-violet-400 bg-violet-500/10"
                  : "border-sky-500/40 text-sky-600 dark:text-sky-400 bg-sky-500/10"
              )}
              title={isLine ? "Linear (continuous) asset — keypoints walk along the road" : "Point asset — single observation"}
            >
              {isLine ? "Linear" : "Point"}
            </Badge>
          )}
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
          title="Select / Pan"
        >
          <MousePointer className="h-4 w-4" />
        </Button>

        {/* Rectangle tool */}
        <Button
          variant={activeTool === "rectangle" ? "default" : "ghost"}
          size="icon" className="h-8 w-8"
          onClick={() => setActiveTool("rectangle")}
          title="Draw Rectangle"
        >
          <Square className="h-4 w-4" />
        </Button>

        <div className="h-5 w-px bg-border mx-1" />

        {/* Delete */}
        <Button
          variant="ghost" size="icon" className="h-8 w-8"
          onClick={handleDelete}
          disabled={!annotation}
          title="Delete annotation"
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

        {/* Right side: annotation count + save */}
        <div className="flex-1" />
        {annotation && (
          <Button size="sm" className="h-8 text-xs gap-1" onClick={() => { handleSaveAll(); }} disabled={saving}>
            <Save className="h-3.5 w-3.5" />
            {saving ? "Saving..." : (isLine && dirtyKp ? "Save Point" : "Save")}
          </Button>
        )}
      </div>

      {/* Linear-asset frame slider — walks all keypoints on the line so the
       *  user can review/edit the bbox at every observation. */}
      {isLine && keypoints && keypoints.length > 1 && (
        <div className="border-b border-border bg-card">
          <LinearAssetFrameSlider
            asset={{
              masterDisplayId: masterDisplayId,
              side: masterAsset?.side ?? "",
              frameNumber: currentKeypoint?.frame,
              kind: "line",
              // Fields below required by AssetRecord type but unused by slider.
              defectId: "", assetId: "", assetType: "", assetCategory: "",
              lat: currentKeypoint?.lat ?? 0, lng: currentKeypoint?.lng ?? 0,
              roadName: "", lastSurveyDate: "", issue: "", severity: "",
            } as AssetRecord}
            keypoints={keypoints}
            idx={currentKpIdx}
            onFrameChange={(patch) => {
              if (!keypoints) return;
              // Use idx from patch (canonical) — frame alone is ambiguous on
              // linear_unsided assets where two keypoints can share a frame.
              const i = patch.idx;
              if (i < 0 || i >= keypoints.length || i === currentKpIdx) return;
              // QC rule: any unsaved change (bbox or asset-level meta)
              // must be saved or discarded before navigating.
              if (dirtyKp || pendingMeta) {
                setPendingNavIdx(i);
                return;
              }
              setCurrentKpIdx(i);
            }}
          />
        </div>
      )}

      {/* ─── Main: Center Canvas + Right Labels ─── */}
      <div className="flex-1 flex overflow-hidden">
        {/* ─── CENTER: Image Canvas ─── */}
        <div
          ref={containerRef}
          className="flex-1 overflow-hidden flex items-center justify-center bg-neutral-900 relative"
          onWheel={(e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -0.15 : 0.15;
            setZoom(z => Math.min(5, Math.max(0.5, z + delta)));
          }}
          onMouseDown={(e) => {
            setIsAnnotationSelected(false);
            if (zoom > 1 && activeTool === "select") {
              setIsPanning(true);
              setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
            }
          }}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={() => {
            // Reset every transient interaction state so the user doesn't
            // come back to a stuck drag/resize from a mouseUp the canvas
            // never received.
            if (isDrawing) { setIsDrawing(false); setDrawStart(null); setDrawCurrent(null); }
            if (dragState) setDragState(null);
            if (resizeState) setResizeState(null);
            setIsPanning(false);
          }}
        >
          {isFullyLoading || imageLoading ? (
            <div className="space-y-2 text-center">
              <div className="h-6 w-6 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-xs text-muted-foreground">Loading...</p>
            </div>
          ) : error ? (
            <div className="text-center space-y-2">
              <p className="text-sm text-destructive">{error}</p>
              <Button variant="outline" size="sm" onClick={() => navigate(-1)}>Go Back</Button>
            </div>
          ) : (
            <div
              style={{
                transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`,
                transformOrigin: "center center",
                transition: isPanning ? "none" : "transform 0.15s ease",
              }}
            >
              <div
                ref={canvasRef}
                className={cn(
                  "relative select-none",
                  activeTool === "rectangle" ? "cursor-crosshair" : (zoom > 1 ? "cursor-grab" : "cursor-default")
                )}
                onMouseDown={handleMouseDown}
              >
                {/* Image */}
                {frameImageUrl ? (
                  <img
                    src={frameImageUrl}
                    alt={`Frame for ${masterDisplayId}`}
                    className="max-w-[900px] max-h-[calc(100vh-120px)] rounded"
                    draggable={false}
                    onError={e => { (e.target as HTMLImageElement).src = "/placeholder.svg"; }}
                  />
                ) : (
                  <div className="w-[900px] h-[506px] bg-gradient-to-br from-slate-600 via-slate-700 to-slate-800 rounded flex items-center justify-center">
                    <div className="text-center space-y-3">
                      <div className="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center mx-auto">
                        <Square className="h-8 w-8 text-white/30" />
                      </div>
                      <p className="text-white/40 text-sm">No frame image available</p>
                    </div>
                  </div>
                )}

                {/* Single annotation overlay */}
                {annotation && (
                  <div
                    className={cn(
                      "absolute border-2 pointer-events-auto",
                      !isAnnotationSelected && "hover:ring-1 hover:ring-white/30",
                      !showLabels && "border-opacity-50",
                      activeTool === "select" ? "cursor-move" : ""
                    )}
                    style={{
                      left: `${annotation.x * 100}%`, top: `${annotation.y * 100}%`,
                      width: `${annotation.width * 100}%`, height: `${annotation.height * 100}%`,
                      borderColor: annotation.color,
                      backgroundColor: isAnnotationSelected ? `${annotation.color}33` : `${annotation.color}15`,
                    }}
                    onMouseDown={e => { e.stopPropagation(); startDrag(e); }}
                    onClick={e => {
                      e.stopPropagation();
                      setIsAnnotationSelected(true);
                      if (annotation) {
                        setSelectedLabel(annotation.label);
                        setSelectedCondition(annotation.condition);
                      }
                    }}
                  >
                    {showLabels && (
                      <div
                        className="absolute -top-4 -left-0.5 px-1.5 py-0.5 text-[9px] font-bold text-white whitespace-nowrap"
                        style={{ backgroundColor: annotation.color, borderColor: annotation.color }}
                      >
                        {annotation.label}
                      </div>
                    )}
                    {/* Resize handles (only when selected) */}
                    {isAnnotationSelected && activeTool === "select" && (
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
                            onMouseDown={e => startResize(e, h)}
                          />
                        ))}
                      </>
                    )}
                  </div>
                )}

                {/* Drawing rectangle preview */}
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
          )}

          {/* Active tool indicator */}
          {activeTool === "rectangle" && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground px-3 py-1.5 rounded-full text-xs font-medium shadow-lg flex items-center gap-2">
              <Square className="h-3.5 w-3.5" />
              {selectedLabel ? `Drawing: ${selectedLabel}` : "Select a label from sidebar first"}
            </div>
          )}
        </div>

        {/* ─── RIGHT: Labels List ─── */}
        <div className="w-[280px] border-l border-border bg-card flex flex-col">
          <div className="px-3 py-2 border-b border-border">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                Labels ({filteredLabels.length})
              </span>
              {selectedLabel && (
                <Badge className="text-[8px] bg-primary text-primary-foreground">{selectedLabel}</Badge>
              )}
            </div>
            {masterAsset && (
              <p className="text-[9px] text-muted-foreground mt-1">
                Showing {isLine ? "linear" : "point"} asset types only.
              </p>
            )}
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
          {/* Condition selector when label is selected */}
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
                      if (annotation) applyAssetMeta({ condition: c });
                    }}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
          )}
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-0.5">
              {filteredLabels.length === 0 && (
                <div className="px-2 py-6 text-center text-[10px] text-muted-foreground italic">
                  {sidebarEmptyLabel}
                </div>
              )}
              {filteredLabels.map(label => {
                const color = getColorForLabel(label);
                const isCurrentAnnotation = annotation?.label === label;
                const isActive = selectedLabel === label;
                return (
                  <div
                    key={label}
                    className={cn(
                      "flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer text-[11px] transition-all",
                      isActive ? "bg-primary/10 ring-1 ring-primary/30 font-medium" : "hover:bg-muted/50"
                    )}
                    onClick={() => {
                      // Sidebar IS the editor when an annotation exists —
                      // never deselect (would orphan the annotation's
                      // displayed type). Clicking a different label rewrites
                      // the annotation's type. Without an annotation it's
                      // just the draw tool's pending pick (toggle allowed).
                      if (annotation) {
                        const conds = getConditionsForLabel(label);
                        const nextCond = conds.includes(selectedCondition) ? selectedCondition : (conds[0] ?? "Good");
                        setSelectedLabel(label);
                        setSelectedCondition(nextCond);
                        applyAssetMeta({
                          label,
                          category_id: labelToCategoryId[label] || "",
                          condition: nextCond,
                        });
                      } else if (isActive) {
                        setSelectedLabel(""); setSelectedCondition("");
                      } else {
                        setSelectedLabel(label);
                        setSelectedCondition(getConditionsForLabel(label)[0]);
                      }
                    }}
                  >
                    <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                    <span className="flex-1 truncate">{label}</span>
                    {/* {isCurrentAnnotation && (
                      <Badge variant="secondary" className="text-[8px] h-4 min-w-[16px] px-1">1</Badge>
                    )} */}
                  </div>
                );
              })}
            </div>
          </ScrollArea>

          {/* Current annotation detail */}
          <div className="border-t border-border">
            <div className="px-3 py-2 border-b border-border">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                Current Annotation
              </span>
            </div>
            <ScrollArea className="max-h-[240px]">
              <div className="p-2 space-y-1">
                {!annotation && (
                  <p className="text-[10px] text-muted-foreground text-center py-4">No annotation</p>
                )}
                {annotation && (
                  <div
                    className={cn(
                      "rounded-md border p-2 cursor-pointer transition-all",
                      isAnnotationSelected
                        ? "border-primary/40 bg-primary/5 ring-1 ring-primary/20"
                        : "border-transparent hover:bg-muted/50"
                    )}
                    onClick={() => {
                      setIsAnnotationSelected(!isAnnotationSelected);
                      setSelectedLabel(annotation.label);
                      setSelectedCondition(annotation.condition);
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: annotation.color }} />
                      <span className="text-[11px] font-medium truncate flex-1">{annotation.label}</span>
                      {/* <Badge
                        variant="outline"
                        className={cn("text-[8px] px-1 py-0", {
                          "border-sky-400/30 text-sky-500": annotation.status === "ai",
                          "border-amber-400/30 text-amber-500": annotation.status === "edited",
                          "border-violet-400/30 text-violet-500": annotation.status === "added",
                        })}
                      >
                        {annotation.status.toUpperCase()}
                      </Badge> */}
                    </div>
                    <div className="text-[8px] text-muted-foreground mt-0.5 ml-4 font-mono">
                      x:{Math.round(annotation.x * 1000)/10} y:{Math.round(annotation.y * 1000)/10} w:{Math.round(annotation.width * 1000)/10} h:{Math.round(annotation.height * 1000)/10}
                    </div>
                    <div className="flex items-center gap-1 mt-1 ml-4">
                      <span className="text-[9px] text-muted-foreground">{annotation.condition}</span>
                      <span className="flex-1" />
                      <button className="text-[9px] text-destructive hover:bg-destructive/10 rounded px-1 py-0.5" onClick={e => { e.stopPropagation(); handleDelete(); }}>
                        <Trash2 className="h-3 w-3 inline mr-0.5" />Del
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>
        </div>
      </div>

      {/* ─── Keypoint Navigation Guard Dialog ─── */}
      {/* Linear-asset rule: one keypoint at a time. If the user tries to
       *  navigate (slider / chevron) with an unsaved edit (bbox OR asset-
       *  level label/category/condition), force a decision: save it first,
       *  throw it away, or stay put. */}
      <Dialog open={pendingNavIdx !== null} onOpenChange={(open) => { if (!open) setPendingNavIdx(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">Unsaved changes</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            {dirtyKp && pendingMeta
              ? `You've edited the bbox and asset details for Point ${currentKpIdx + 1}.`
              : dirtyKp
                ? `You've edited the bbox for Point ${currentKpIdx + 1}.`
                : `You've changed the asset details.`}
            {" "}Save before moving to a different point, or discard these changes.
          </p>
          <div className="flex justify-end gap-2 mt-2">
            <Button
              variant="ghost" size="sm" className="h-8 text-xs"
              onClick={() => setPendingNavIdx(null)}
            >
              Cancel
            </Button>
            <Button
              variant="outline" size="sm" className="h-8 text-xs"
              onClick={() => {
                const target = pendingNavIdx;
                setDirtyKp(null);
                setPendingMeta(null);
                setPendingNavIdx(null);
                if (target !== null) setCurrentKpIdx(target);
              }}
            >
              Discard
            </Button>
            <Button
              size="sm" className="h-8 text-xs gap-1" disabled={saving}
              onClick={async () => {
                const target = pendingNavIdx;
                const ok = await handleSaveAll();
                if (ok) {
                  setPendingNavIdx(null);
                  if (target !== null) setCurrentKpIdx(target);
                }
              }}
            >
              <Save className="h-3.5 w-3.5" />
              {saving ? "Saving..." : "Save & Go"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}