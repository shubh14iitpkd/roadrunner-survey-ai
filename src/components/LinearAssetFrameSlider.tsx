import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import type { AssetRecord, LineKeypoint } from "@/types/asset";

interface LinearAssetFrameSliderProps {
  /** Currently selected asset. Component is a no-op unless `kind === "line"`. */
  asset: AssetRecord | null;
  /** Called with the next keypoint's anchor when the user steps/scrubs.
   *  Parent should merge the patch into its `selectedAsset` state — this
   *  re-drives `useFrameImage` and the popup's `frameData`. */
  onFrameChange: (patch: {
    frameNumber: number;
    box?: { x: number; y: number; width: number; height: number };
    lat: number;
    lng: number;
  }) => void;
  className?: string;
}

/* Frame slider shown below FrameComparisonPopup in the Detailed View dialog
 * for linear assets. Each tick = one observation point along the line, so
 * the slider walks `keypoints.length` discrete points (not raw frame
 * numbers, which are sparse). Side-filters keypoints to match the polyline
 * side the user clicked (linear_sided assets). */
export default function LinearAssetFrameSlider({
  asset,
  onFrameChange,
  className,
}: LinearAssetFrameSliderProps) {
  const qc = useQueryClient();
  const [keypoints, setKeypoints] = useState<LineKeypoint[] | null>(null);
  // Local idx — slider thumb tracks this directly so dragging is smooth even
  // while the parent is busy fetching frame images. Synced from the asset's
  // current frame number on external changes (e.g. map clicks a new point).
  const [idx, setIdx] = useState(0);

  // Fetch keypoints whenever the dialog opens for any asset — the table-row
  // click path doesn't carry an authoritative `kind` (the paginated endpoint
  // omits it for speed), so we treat the keypoints endpoint as the source of
  // truth: empty array = point asset → component renders nothing.
  const masterId = asset?.masterDisplayId;
  const side = asset?.side;

  useEffect(() => {
    if (!masterId) {
      setKeypoints(null);
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
        setKeypoints(sorted);
      } catch {
        if (!cancelled) setKeypoints(null);
      }
    })();
    return () => { cancelled = true; };
  }, [masterId, side, qc]);

  // Re-sync idx whenever the keypoint list changes (new asset / new side) or
  // the asset's frame number changes from outside (map click). When the
  // change came from this slider, idx already matches and the effect is a
  // no-op.
  useEffect(() => {
    if (!keypoints || keypoints.length === 0) return;
    if (asset?.frameNumber == null) {
      setIdx(0);
      return;
    }
    if (keypoints[idx]?.frame === asset.frameNumber) return;
    const i = keypoints.findIndex((kp) => kp.frame === asset.frameNumber);
    setIdx(i === -1 ? 0 : i);
    // idx intentionally omitted — we only re-sync on external changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keypoints, asset?.frameNumber]);

  if (!asset || !keypoints || keypoints.length <= 1) return null;

  const change = (next: number) => {
    const clamped = Math.max(0, Math.min(keypoints.length - 1, next));
    if (clamped === idx) return;
    const kp = keypoints[clamped];
    if (!kp) return;
    setIdx(clamped);
    onFrameChange({ frameNumber: kp.frame, box: kp.box, lat: kp.lat, lng: kp.lng });
  };

  return (
    <div className={`flex items-center gap-3 px-3 py-2 ${className ?? ""}`}>
      <button
        type="button"
        disabled={idx <= 0}
        onClick={() => change(idx - 1)}
        className="h-6 w-6 shrink-0 rounded-full inline-flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
      </button>
      <Slider
        min={0}
        max={keypoints.length - 1}
        step={1}
        value={[idx]}
        onValueChange={([v]) => change(v)}
        className="flex-1 [&_[role=slider]]:h-3 [&_[role=slider]]:w-3 [&_[role=slider]]:border [&>span:first-child]:h-1"
      />
      <button
        type="button"
        disabled={idx >= keypoints.length - 1}
        onClick={() => change(idx + 1)}
        className="h-6 w-6 shrink-0 rounded-full inline-flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
      <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
        Point {idx + 1} of {keypoints.length}
      </span>
    </div>
  );
}
