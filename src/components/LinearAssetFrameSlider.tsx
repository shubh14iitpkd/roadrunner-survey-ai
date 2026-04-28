import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import type { AssetRecord, LineKeypoint } from "@/types/asset";

interface LinearAssetFrameSliderProps {
  asset: AssetRecord | null;
  /** Called every time the user picks a different point. `idx` is the
   *  canonical identity (linear_unsided assets can carry two keypoints on
   *  the same frame, so frameNumber alone is ambiguous). */
  onFrameChange: (patch: {
    idx: number;
    frameNumber: number;
    box?: { x: number; y: number; width: number; height: number };
    lat: number;
    lng: number;
  }) => void;
  /** Controlled mode: when supplied the component uses these keypoints
   *  directly and skips the internal fetch. Useful for parents
   *  (QCLayer) that already own the keypoint list. */
  keypoints?: LineKeypoint[] | null;
  /** Parent-owned current index. Required for linear_unsided assets where
   *  two keypoints can share a frame; without it the slider falls back to
   *  frame-based lookup and lands on the first match. */
  idx?: number;
  className?: string;
}

/* Walks one observation point at a time along a linear asset. Display
 * unit is **point index** (`Point i of N`), never the raw frame number. */
export default function LinearAssetFrameSlider({
  asset,
  onFrameChange,
  keypoints: controlledKeypoints,
  idx: controlledIdx,
  className,
}: LinearAssetFrameSliderProps) {
  const qc = useQueryClient();
  const [internalKeypoints, setInternalKeypoints] = useState<LineKeypoint[] | null>(null);

  const isControlled = controlledKeypoints !== undefined;
  const keypoints = isControlled ? controlledKeypoints : internalKeypoints;

  const masterId = asset?.masterDisplayId;
  const side = asset?.side;

  useEffect(() => {
    if (isControlled) return;
    if (!masterId) {
      setInternalKeypoints(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const resp = await qc.fetchQuery({
          queryKey: qk.assets.keypoints(masterId),
          queryFn: () => api.assets.getMasterAssetKeypoints(masterId),
          staleTime: 5 * 60_000,
        });
        if (cancelled) return;
        const all: LineKeypoint[] = (resp as { keypoints?: LineKeypoint[] } | null)?.keypoints ?? [];
        const anyHasSide = all.some((kp) => !!kp.side);
        const filtered = (side && anyHasSide)
          ? all.filter((kp) => kp.side === side)
          : all;
        const sorted = [...filtered].sort((a, b) => a.frame - b.frame);
        setInternalKeypoints(sorted);
      } catch {
        if (!cancelled) setInternalKeypoints(null);
      }
    })();
    return () => { cancelled = true; };
  }, [isControlled, masterId, side, qc]);

  // Single source of truth: idx is owned by the parent. No internal idx
  // state — that lets a rejected commit (e.g. QC nav-guard cancel) snap
  // the thumb right back.
  // Two resolution modes:
  //  - Parent supplies `controlledIdx` → use it verbatim. Required for
  //    linear_unsided assets where two keypoints can share a frame number;
  //    findIndex-by-frame would always land on the first match.
  //  - Otherwise fall back to frame lookup. Read-only call sites
  //    (AssetLibrary detail panel, DefectLibrary) don't track an idx and
  //    accept this ambiguity since they don't navigate keypoints.
  const idx = useMemo(() => {
    if (!keypoints || keypoints.length === 0) return 0;
    if (controlledIdx != null) {
      return Math.max(0, Math.min(keypoints.length - 1, controlledIdx));
    }
    if (asset?.frameNumber == null) return 0;
    const i = keypoints.findIndex((kp) => kp.frame === asset.frameNumber);
    return i === -1 ? 0 : i;
  }, [keypoints, controlledIdx, asset?.frameNumber]);

  if (!asset || !keypoints || keypoints.length <= 1) return null;

  const total = keypoints.length;

  // Goto: route every navigation (chevron click OR slider change) through
  // a single function so behaviour can't drift between paths. Each call
  // = one onFrameChange. If parent rejects, derivedIdx stays put, thumb
  // snaps back next render.
  const goto = (next: number) => {
    const target = Math.max(0, Math.min(total - 1, Math.round(next)));
    if (target === idx) return;
    const kp = keypoints[target];
    if (!kp) return;
    onFrameChange({ idx: target, frameNumber: kp.frame, box: kp.box, lat: kp.lat, lng: kp.lng });
  };

  const atFirst = idx <= 0;
  const atLast = idx >= total - 1;

  return (
    <div className={`flex items-center gap-3 px-3 py-2 ${className ?? ""}`}>
      <button
        type="button"
        disabled={atFirst}
        onClick={() => goto(idx - 1)}
        className="h-7 w-7 shrink-0 rounded-full inline-flex items-center justify-center cursor-pointer text-muted-foreground hover:text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
        aria-label="Previous point"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <Slider
        min={0}
        max={total - 1}
        step={1}
        value={[idx]}
        onValueChange={([v]) => goto(v)}
        className="flex-1 cursor-pointer [&_[role=slider]]:cursor-grab [&_[role=slider]:active]:cursor-grabbing"
        aria-label={`Point ${idx + 1} of ${total}`}
      />
      <button
        type="button"
        disabled={atLast}
        onClick={() => goto(idx + 1)}
        className="h-7 w-7 shrink-0 rounded-full inline-flex items-center justify-center cursor-pointer text-muted-foreground hover:text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
        aria-label="Next point"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
      <span className="text-[11px] font-medium text-muted-foreground tabular-nums shrink-0 select-none">
        Point {idx + 1} of {total}
      </span>
    </div>
  );
}
