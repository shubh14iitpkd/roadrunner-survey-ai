import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { MapPin, X, Eye, Maximize2, ChevronLeft, ChevronRight, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { toast } from "sonner";
import type { AssetRecord } from "@/types/asset";
import { getCategoryColorCode } from "@/components/CategoryBadge";

interface MarkerPopupData {
  frameData: any;
  trackTitle: string;
  pointIndex: number;
  totalPoints: number;
}

interface AssetDetailSidebarProps {
  markerPopup: MarkerPopupData | null;
  selectedAsset: AssetRecord | null;
  /** Raw base64 image URL (no annotations) */
  imageUrl: string | null;
  /** Original frame width in pixels */
  frameWidth: number;
  /** Original frame height in pixels */
  frameHeight: number;
  imageLoading: boolean;
  filteredAssets: AssetRecord[];
  onCloseAsset: () => void;
  onNavigate: (dir: "prev" | "next") => void;
  onFullView: () => void;
  onCloseMarker: () => void;
  onShowFullView: () => void;
  getAssetDisplayName: (asset: any) => string;
  /** Label shown in empty state, e.g. "anomaly" or "asset" */
  emptyLabel?: string;
}

export default function AssetDetailSidebar({
  markerPopup,
  selectedAsset,
  imageUrl,
  frameWidth,
  frameHeight,
  imageLoading,
  filteredAssets,
  onCloseAsset,
  onNavigate,
  onFullView,
  onCloseMarker,
  getAssetDisplayName,
  onShowFullView,
  emptyLabel = "anomaly",
}: AssetDetailSidebarProps) {
  const expanded = !!(markerPopup || selectedAsset);
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Counter incremented on image onLoad to trigger canvas re-draw
  const [drawTrigger, setDrawTrigger] = useState(0);

  const selectedIdx = selectedAsset
    ? filteredAssets.findIndex((a) => a.anomalyId === selectedAsset.anomalyId)
    : -1;

  // ── Draw bounding box annotation on canvas overlay ──
  // Depends on drawTrigger which is incremented after img.onLoad, ensuring valid dimensions
  useEffect(() => {
    if (!canvasRef.current || !imgRef.current || !selectedAsset?.box || !imageUrl) return;

    const canvas = canvasRef.current;
    const img = imgRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // img.clientWidth is only valid after the image has painted
    if (img.clientWidth === 0 || img.clientHeight === 0) return;

    // Match canvas to the container (same as the <img> element)
    const containerW = img.clientWidth;
    const containerH = img.clientHeight;
    canvas.width = containerW;
    canvas.height = containerH;
    ctx.clearRect(0, 0, containerW, containerH);

    // With object-contain, the image preserves aspect ratio and may have letterboxing.
    // Calculate where the image actually renders inside the container.
    const imgAspect = frameWidth / frameHeight;
    const containerAspect = containerW / containerH;

    let renderedW: number, renderedH: number, offsetX: number, offsetY: number;
    if (imgAspect > containerAspect) {
      // Image is wider than container — fits width, letterboxed top/bottom
      renderedW = containerW;
      renderedH = containerW / imgAspect;
      offsetX = 0;
      offsetY = (containerH - renderedH) / 2;
    } else {
      // Image is taller — fits height, letterboxed left/right
      renderedH = containerH;
      renderedW = containerH * imgAspect;
      offsetX = (containerW - renderedW) / 2;
      offsetY = 0;
    }

    const box = selectedAsset.box;
    const scaleX = renderedW / frameWidth;
    const scaleY = renderedH / frameHeight;

    const x = box.x * scaleX + offsetX;
    const y = box.y * scaleY + offsetY;
    const w = box.width * scaleX;
    const h = box.height * scaleY;
    const color = getCategoryColorCode(selectedAsset.category_id || 'Other');

    // Draw bounding box
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);

    // Draw label
    const label = getAssetDisplayName(selectedAsset);
    const fontSize = Math.max(8, Math.round(renderedW / 50));
    ctx.font = `bold ${fontSize}px sans-serif`;
    const textMetrics = ctx.measureText(label);
    const labelH = fontSize + 6;
    const labelY = y > labelH + 2 ? y - labelH - 2 : y + h + 2;

    ctx.fillStyle = color
    ctx.fillRect(x, labelY, textMetrics.width + 8, labelH);
    ctx.fillStyle = "#ffffff";
    ctx.textBaseline = "middle";
    ctx.fillText(label, x + 4, labelY + labelH / 2);
  }, [imageUrl, selectedAsset?.box, frameWidth, frameHeight, drawTrigger]);

  // Re-draw on resize
  useEffect(() => {
    if (!imageUrl || !selectedAsset?.box) return;
    const handleResize = () => {
      // Trigger a re-render to redraw canvas
      if (canvasRef.current && imgRef.current) {
        const canvas = canvasRef.current;
        const img = imgRef.current;
        canvas.width = img.clientWidth;
        canvas.height = img.clientHeight;
        // Re-trigger the drawing effect
        const event = new Event("resize-redraw");
        window.dispatchEvent(event);
      }
    };
    const observer = new ResizeObserver(handleResize);
    if (imgRef.current) observer.observe(imgRef.current);
    return () => observer.disconnect();
  }, [imageUrl, selectedAsset?.box]);

  // ── Download handler ──
  const handleDownload = useCallback(async () => {
    if (!imageUrl || !selectedAsset) return;

    toast.info("Preparing download…");

    try {
      // Fetch high-res frame (resize=false)
      let imageSrc = imageUrl;
      let imgW = frameWidth;
      let imgH = frameHeight;

      if (selectedAsset.videoId && selectedAsset.frameNumber != null) {
        try {
          const hiRes = await api.videos.getFrameWithDetections(
            selectedAsset.videoId,
            undefined,
            selectedAsset.frameNumber,
            undefined,
            false // resize=false for full resolution
          );
          if (hiRes?.image_data) {
            imageSrc = hiRes.image_data;
            imgW = hiRes.width || imgW;
            imgH = hiRes.height || imgH;
          }
        } catch {
          // Fall back to current image
        }
      }

      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = imageSrc;

      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = imgW;
        canvas.height = imgH;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        ctx.drawImage(img, 0, 0, imgW, imgH);

        // Draw annotation at full resolution
        if (selectedAsset.box) {
          const box = selectedAsset.box;
          const scale = Math.max(1, imgW / 1000);

          ctx.strokeStyle = "#ef4444";
          ctx.lineWidth = 3 * scale;
          ctx.strokeRect(box.x, box.y, box.width, box.height);

          const fontSize = 8;
          const padding = 4 * scale;
          const label = getAssetDisplayName(selectedAsset);
          ctx.font = `bold ${fontSize}px Arial`;
          const tm = ctx.measureText(label);

          ctx.fillStyle = "rgba(239, 68, 68, 0.85)";
          ctx.fillRect(box.x, box.y - fontSize - padding * 2, tm.width + padding * 2, fontSize + padding * 2);
          ctx.fillStyle = "#ffffff";
          ctx.fillText(label, box.x + padding, box.y - padding);
        }

        const dataUrl = canvas.toDataURL("image/png");
        const link = document.createElement("a");
        link.download = `asset_${selectedAsset.assetId}_frame_${selectedAsset.frameNumber || 0}.png`;
        link.href = dataUrl;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        toast.success("Image downloaded");
      };

      img.onerror = () => {
        toast.error("Failed to load image for download");
      };
    } catch {
      toast.error("Download failed");
    }
  }, [imageUrl, selectedAsset, frameWidth, frameHeight]);

  return (
    <div
      className={cn(
        "border-l border-border bg-card flex flex-col shrink-0 transition-all duration-300",
        expanded ? "w-96" : "w-72"
      )}
    >
      {selectedAsset ? (
        /* ── Selected Asset Detail ── */
        <div className="flex flex-col h-full">
          {/* Image area with canvas overlay for annotation */}
          <div className="flex-1 relative min-h-0 bg-muted">
            {imageLoading ? (
              <div className="flex flex-col items-center justify-center h-full gap-2">
                <div className="relative w-8 h-8">
                  <div className="absolute inset-0 border-3 border-primary/20 rounded-full" />
                  <div className="absolute inset-0 border-3 border-primary border-t-transparent rounded-full animate-spin" />
                </div>
                <span className="text-[9px] text-muted-foreground">Loading frame…</span>
              </div>
            ) : imageUrl ? (
              <div className="relative w-full h-full cursor-pointer group" onClick={handleDownload}>
                <img
                  ref={imgRef}
                  src={imageUrl}
                  alt="Asset"
                  className="w-full h-full object-contain"
                  onLoad={() => {
                    // Increment trigger to re-run canvas drawing effect with valid dimensions
                    setDrawTrigger((n) => n + 1);
                  }}
                />
                <canvas
                  ref={canvasRef}
                  className="absolute top-0 left-0 w-full h-full pointer-events-none"
                />
                {/* Download hint on hover */}
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                  <div className="bg-black/60 text-white rounded-full p-2">
                    <Download className="h-4 w-4" />
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-full">
                <Eye className="h-8 w-8 text-muted-foreground/30" />
              </div>
            )}
            <span className="absolute top-1.5 left-1.5 inline-flex items-center rounded bg-destructive/90 text-destructive-foreground px-1 py-0.5 text-[9px] font-semibold z-10">
              {selectedAsset.issue}
            </span>
            <button
              className="absolute top-1.5 right-1.5 bg-black/50 hover:bg-black/70 text-white rounded-full p-0.5 transition-colors z-10"
              onClick={onCloseAsset}
            >
              <X className="h-3 w-3" />
            </button>
            <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 via-black/50 to-transparent px-2.5 pb-1.5 pt-6 pointer-events-none z-10">
              <p className="text-[9px] text-white/60 uppercase tracking-wider font-semibold">Road</p>
              <p className="text-[11px] text-white font-semibold truncate">{selectedAsset.roadName}</p>
            </div>
          </div>
          {/* Info strip */}
          <div className="px-1.5 py-1.5 space-y-1 shrink-0">
            <div className="flex items-center gap-x-2">
              {([
                ["ID", selectedAsset.anomalyId],
                ["Asset ID", selectedAsset.id],
                ["Type", selectedAsset.assetType],
                ["Road Side", selectedAsset.side],
                ["Zone", selectedAsset.zone],
              ] as [string, string | undefined][]).map(([label, val]) => (
                <div key={label} className="min-w-0">
                  <p className="text-[6px] text-muted-foreground uppercase">{label}</p>
                  <p className="text-[9px] font-medium text-foreground leading-none truncate">{val}</p>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                className="h-6 w-6 shrink-0"
                disabled={selectedIdx <= 0}
                onClick={() => onNavigate("prev")}
              >
                <ChevronLeft className="h-3 w-3" />
              </Button>
              <Button
                variant="default"
                size="sm"
                className="flex-1 h-6 text-[10px] gap-1 px-2"
                onClick={onFullView}
              >
                <Maximize2 className="h-3 w-3" />
                Full View
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-6 w-6 shrink-0"
                disabled={selectedIdx >= filteredAssets.length - 1}
                onClick={() => onNavigate("next")}
              >
                <ChevronRight className="h-3 w-3" />
              </Button>
            </div>
          </div>
        </div>
      ) : (
        /* ── Empty State ── */
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="text-center text-muted-foreground">
            <MapPin className="h-8 w-8 mx-auto mb-1.5 opacity-20" />
            <p className="text-[11px] font-medium">Select an {emptyLabel}</p>
            <p className="text-[9px] mt-0.5">Click a row or map point</p>
          </div>
        </div>
      )}
    </div>
  );
}
