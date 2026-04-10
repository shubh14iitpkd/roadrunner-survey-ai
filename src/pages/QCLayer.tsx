import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useLabelMap } from "@/contexts/LabelMapContext";
import { getCategoryColorCode } from "@/components/CategoryBadge";
import { useFrameImage } from "@/hooks/useFrameImage";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Trash2, ZoomIn, ZoomOut, RotateCcw, Eye, EyeOff, Save,
  Layers, ArrowLeft, Square, Undo2, Redo2, MousePointer,
  Search, Pencil,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

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

const CONDITION_COLORS_ACTIVE: Record<string, string> = {
  Good: "bg-emerald-500 text-white border-emerald-500",
  Fine: "bg-emerald-500 text-white border-emerald-500",
  Damaged: "bg-red-500 text-white border-red-500",
  Defective: "bg-red-500 text-white border-red-500",
  Dirty: "bg-amber-500 text-white border-amber-500",
  Overgrown: "bg-amber-500 text-white border-amber-500",
  NoDisplay: "bg-orange-500 text-white border-orange-500",
  FadedPaint: "bg-amber-500 text-white border-amber-500",
  PaintFaded: "bg-amber-500 text-white border-amber-500",
  Missing: "bg-red-500 text-white border-red-500",
  MissingPanel: "bg-red-500 text-white border-red-500",
  Broken: "bg-red-500 text-white border-red-500",
  Bent: "bg-orange-500 text-white border-orange-500",
  Poor: "bg-red-500 text-white border-red-500",
};

const CONDITION_COLORS: Record<string, string> = {
  Good: "bg-emerald-500/15 text-emerald-700 border-emerald-300",
  Fine: "bg-emerald-500/15 text-emerald-700 border-emerald-300",
  Damaged: "bg-red-500/15 text-red-700 border-red-300",
  Defective: "bg-red-500/15 text-red-700 border-red-300",
  Dirty: "bg-amber-500/15 text-amber-700 border-amber-300",
  Overgrown: "bg-amber-500/15 text-amber-700 border-amber-300",
  NoDisplay: "bg-orange-500/15 text-orange-700 border-orange-300",
  FadedPaint: "bg-amber-500/15 text-amber-700 border-amber-300",
  PaintFaded: "bg-amber-500/15 text-amber-700 border-amber-300",
  Missing: "bg-red-500/15 text-red-700 border-red-300",
  MissingPanel: "bg-red-500/15 text-red-700 border-red-300",
  Broken: "bg-red-500/15 text-red-700 border-red-300",
  Bent: "bg-orange-500/15 text-orange-700 border-orange-300",
  Poor: "bg-red-500/15 text-red-700 border-red-300",
};

function generateId() { return Math.random().toString(36).substring(2, 10); }

// ─── Main Component ─────────────────────────────────────────────────
export default function QCLayer() {
  const { masterDisplayId } = useParams<{ masterDisplayId: string }>();
  const navigate = useNavigate();
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

  // Fetch frame image using existing hook
  const { imageUrl: frameImageUrl, frameWidth, frameHeight, loading: imageLoading } = useFrameImage({
    videoId: latestObservation?.video_id,
    frameNumber: latestObservation?.frame_number,
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
  const [editingAnnotation, setEditingAnnotation] = useState<Annotation | null>(null);
  const [editCategoryId, setEditCategoryId] = useState("");
  const [editLabel, setEditLabel] = useState("");
  const [editCondition, setEditCondition] = useState("");

  // Pre-selected label from right sidebar (used when drawing new rectangle)
  const [selectedLabel, setSelectedLabel] = useState("");
  const [selectedCondition, setSelectedCondition] = useState("");

  // Dragging/resizing annotation
  const [dragState, setDragState] = useState<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const [resizeState, setResizeState] = useState<{ handle: string; startX: number; startY: number; orig: { x: number; y: number; width: number; height: number } } | null>(null);

  // ─── Derive labels and categories from LabelMapContext ────────────
  const { categories, labelsByCategory, allLabels, labelToCategoryId } = useMemo(() => {
    if (!labelMap) return { categories: {} as Record<string, string>, labelsByCategory: {} as Record<string, string[]>, allLabels: [] as string[], labelToCategoryId: {} as Record<string, string> };

    const cats: Record<string, string> = {};
    for (const [catId, cat] of Object.entries(labelMap.categories)) {
      cats[catId] = cat.display_name;
    }

    // Group labels by category using group_id for display
    const byCategory: Record<string, Set<string>> = {};
    const l2c: Record<string, string> = {};
    for (const label of Object.values(labelMap.labels)) {
      const catId = label.category_id || "";
      const groupId = label.group_id || label.display_name;
      if (!byCategory[catId]) byCategory[catId] = new Set();
      byCategory[catId].add(groupId);
      l2c[groupId] = catId;
    }

    const byCategoryArr: Record<string, string[]> = {};
    for (const [catId, labelSet] of Object.entries(byCategory)) {
      byCategoryArr[catId] = Array.from(labelSet).sort();
    }

    const all = Object.values(byCategoryArr).flat().sort();

    return { categories: cats, labelsByCategory: byCategoryArr, allLabels: all, labelToCategoryId: l2c };
  }, [labelMap]);

  const categoryIds = useMemo(() => Object.keys(categories), [categories]);

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
  useEffect(() => {
    if (!masterAsset || !latestObservation) { setAnnotation(null); return; }
    // Wait for the frame image to finish loading so we have dimensions
    if (imageLoading) return;

    const box = latestObservation.box || masterAsset.box;
    const groupId = masterAsset.group_id || masterAsset.asset_type || "Unknown";
    const catId = masterAsset.category_id || "";
    const condition = latestObservation.condition || masterAsset.latest_condition || "Good";

    let ann: Annotation | null = null;
    if (box) {
      // Normalise: if any coordinate > 1 treat as pixel values
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

    setAnnotation(ann);
    setIsAnnotationSelected(false);
    setHistory([ann ? JSON.parse(JSON.stringify(ann)) : null]);
    setHistoryIndex(0);
  }, [masterAsset, latestObservation, imageLoading, frameWidth, frameHeight]);

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
          toast.success(`Added: ${selectedLabel} (${cond})`);
        }
        setActiveTool("select");
      }
      setDrawStart(null);
      setDrawCurrent(null);
    }
    if (dragState) {
      pushHistory(annotation);
      setDragState(null);
    }
    if (resizeState) {
      pushHistory(annotation);
      setResizeState(null);
    }
    setIsPanning(false);
  };

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
    toast.success("Annotation deleted");
  };

  const openEditDialog = () => {
    if (!annotation) return;
    setEditingAnnotation(annotation);
    setEditCategoryId(annotation.category_id);
    setEditLabel(annotation.label);
    setEditCondition(annotation.condition);
  };

  const saveEdit = () => {
    if (!editingAnnotation || !annotation) return;
    const updated: Annotation = {
      ...annotation,
      label: editLabel,
      category_id: editCategoryId,
      condition: editCondition,
      color: getCategoryColorCode(editCategoryId),
      status: annotation.status === "ai" ? "edited" : annotation.status,
    };
    setAnnotation(updated);
    pushHistory(updated);
    setEditingAnnotation(null);
    toast.success("Annotation updated");
  };

  const handleSaveAll = () => {
    const {x, y, width, height, label} = annotation;
    console.log("Test: ", label )
    console.log("Saving annotation to backend:", { x, y, width, height });
    console.log(x*frameWidth, y*frameHeight, width*frameWidth, height*frameHeight)
    toast.success("Annotation saved");
  };

  // Zoom controls
  const handleZoomIn = () => setZoom(prev => Math.min(5, prev + 0.25));
  const handleZoomOut = () => setZoom(prev => Math.max(0.5, prev - 0.25));
  const handleZoomReset = () => { setZoom(1); setPan({ x: 0, y: 0 }); };

  // Filtered labels
  const filteredLabels = useMemo(() => {
    if (!labelSearch.trim()) return allLabels;
    const q = labelSearch.toLowerCase();
    return allLabels.filter(l => l.toLowerCase().includes(q));
  }, [labelSearch, allLabels]);

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
          <Layers className="h-4 w-4 text-primary" />
          <span className="text-xs font-semibold">QC Layer</span>
          {masterDisplayId && (
            <span className="text-[10px] text-muted-foreground">
              {masterDisplayId}
            </span>
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
          <Button size="sm" className="h-8 text-xs gap-1" onClick={handleSaveAll}>
            <Save className="h-3.5 w-3.5" /> Save
          </Button>
        )}
      </div>

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
            if (isDrawing) { setIsDrawing(false); setDrawStart(null); setDrawCurrent(null); }
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
                    onClick={e => { e.stopPropagation(); setIsAnnotationSelected(true); }}
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
          <div className="px-3 py-2.5 border-b border-border flex items-center justify-between">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
              Labels ({allLabels.length})
            </span>
            {selectedLabel && (
              <Badge className="text-[8px] bg-primary text-primary-foreground">{selectedLabel}</Badge>
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
                    onClick={() => setSelectedCondition(c)}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
          )}
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-0.5">
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
                      if (isActive) { setSelectedLabel(""); setSelectedCondition(""); }
                      else { setSelectedLabel(label); setSelectedCondition(getConditionsForLabel(label)[0]); }
                    }}
                  >
                    <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                    <span className="flex-1 truncate">{label}</span>
                    {isCurrentAnnotation && (
                      <Badge variant="secondary" className="text-[8px] h-4 min-w-[16px] px-1">1</Badge>
                    )}
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
                    onClick={() => setIsAnnotationSelected(!isAnnotationSelected)}
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: annotation.color }} />
                      <span className="text-[11px] font-medium truncate flex-1">{annotation.label}</span>
                      <Badge
                        variant="outline"
                        className={cn("text-[8px] px-1 py-0", {
                          "border-sky-400/30 text-sky-500": annotation.status === "ai",
                          "border-amber-400/30 text-amber-500": annotation.status === "edited",
                          "border-violet-400/30 text-violet-500": annotation.status === "added",
                        })}
                      >
                        {annotation.status.toUpperCase()}
                      </Badge>
                    </div>
                    <div className="text-[8px] text-muted-foreground mt-0.5 ml-4 font-mono">
                      x:{Math.round(annotation.x * 1000)/10} y:{Math.round(annotation.y * 1000)/10} w:{Math.round(annotation.width * 1000)/10} h:{Math.round(annotation.height * 1000)/10}
                    </div>
                    <div className="flex items-center gap-1 mt-1 ml-4">
                      <span className="text-[9px] text-muted-foreground">{annotation.condition}</span>
                      <span className="flex-1" />
                      <button className="text-[9px] text-muted-foreground hover:bg-muted rounded px-1 py-0.5" onClick={e => { e.stopPropagation(); openEditDialog(); }}>
                        <Pencil className="h-3 w-3 inline mr-0.5" />Edit
                      </button>
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

      {/* ─── Edit Annotation Dialog ─── */}
      <Dialog open={!!editingAnnotation} onOpenChange={open => { if (!open) setEditingAnnotation(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">Edit Annotation</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <div>
              <label className="text-[10px] font-semibold text-muted-foreground uppercase mb-1 block">Category</label>
              <Select value={editCategoryId} onValueChange={v => { setEditCategoryId(v); setEditLabel(""); }}>
                <SelectTrigger className="h-8 text-[11px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {categoryIds.map(catId => (
                    <SelectItem key={catId} value={catId} className="text-[11px]">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: getCategoryColorCode(catId) }} />
                        {categories[catId]}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-[10px] font-semibold text-muted-foreground uppercase mb-1 block">Asset Type</label>
              <Select value={editLabel} onValueChange={setEditLabel}>
                <SelectTrigger className="h-8 text-[11px]"><SelectValue placeholder="Select type..." /></SelectTrigger>
                <SelectContent className="max-h-52">
                  {(labelsByCategory[editCategoryId] || []).map(l => (
                    <SelectItem key={l} value={l} className="text-[11px]">{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-[10px] font-semibold text-muted-foreground uppercase mb-1 block">Condition</label>
              <div className="flex gap-2">
                {getConditionsForLabel(editLabel).map(c => (
                  <button
                    key={c}
                    className={cn(
                      "flex-1 rounded-md py-1.5 text-[11px] font-semibold border transition-all",
                      editCondition === c ? (CONDITION_COLORS_ACTIVE[c] || "bg-primary text-white") : (CONDITION_COLORS[c] || "bg-muted")
                    )}
                    onClick={() => setEditCondition(c)}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => setEditingAnnotation(null)}>Cancel</Button>
              <Button size="sm" onClick={saveEdit} disabled={!editLabel}>Save</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}