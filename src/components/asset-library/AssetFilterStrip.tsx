import { X, Map as MapIcon } from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { getCategoryDotColor } from "@/components/CategoryBadge";

type DirectionFilter = "all" | "LHS" | "RHS";
type zoneFilter = "all" | "shoulder" | "median" | "pavement" | "overhead";

interface AssetFilterStripProps {
  filteredCount: number;
  countLabel?: string; // "anomalies" | "assets" etc.
  directionFilter: DirectionFilter;
  onDirectionChange: (v: DirectionFilter) => void;
  zoneFilter: zoneFilter;
  onZoneChange: (v: zoneFilter) => void;
  categoryFilter: string;
  onCategoryChange: (v: string) => void;
  selectedAssetTypes: string[];
  onAssetTypesChange: (v: string[]) => void;
  searchQuery: string;
  onSearchChange: (v: string) => void;
  categoryOptions: {id: string, name: string}[];
  assetTypeOptions: string[];
  selectedRoadName: string | null;
  selectedRoadCount: number;
  onClearFilters: () => void;
}

export default function AssetFilterStrip({
  filteredCount,
  countLabel = "anomalies",
  directionFilter,
  onDirectionChange,
  zoneFilter,
  onZoneChange,
  categoryFilter,
  onCategoryChange,
  selectedAssetTypes,
  onAssetTypesChange,
  searchQuery,
  onSearchChange,
  categoryOptions,
  assetTypeOptions,
  selectedRoadName,
  selectedRoadCount,
  onClearFilters,
}: AssetFilterStripProps) {
  const hasActiveFilters =
    categoryFilter !== "all" ||
    selectedAssetTypes.length > 0 ||
    directionFilter !== "all" ||
    zoneFilter !== "all" ||
    searchQuery !== "";

  const zoneOptions = ["all", "shoulder", "median", "pavement", "overhead"] as const;
  const zoneLabels: Record<string, string> = { all: "all", shoulder: "shoulder", median: "median", pavement: "pavement", overhead: "overhead" };
  const activeIdx = zoneOptions.indexOf(zoneFilter);
  const stepWidth = 56;

  const directionOptions = ["all", "LHS", "RHS"] as const;
  const directionActiveIdx = directionOptions.indexOf(directionFilter);
  const directionStepWidth = 40;

  return (
    <div className="px-4 py-1.5 border-b border-border bg-gradient-to-r from-card to-muted/30 shrink-0 flex items-center gap-2 flex-nowrap min-w-0">
      {/* Count badge */}
      <div className="flex items-center gap-1.5 shrink-0">
        <span className={cn(countLabel === "anomalies" ? "border-destructive bg-destructive/10 text-destructive":"border-primary/20 bg-primary/10 text-primary","inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold tabular-nums border")}>
          {filteredCount}
        </span>
        <span className="text-[9px] text-muted-foreground">{countLabel}</span>
        {(directionFilter !== "all" || zoneFilter !== "all") && (
          <div className="flex items-center gap-1 ml-1">
            {directionFilter !== "all" && (
              <span className="inline-flex items-center rounded-full bg-primary/10 text-primary px-1.5 py-0.5 text-[9px] font-semibold border border-primary/20">
                {directionFilter}
              </span>
            )}
            {zoneFilter !== "all" && (
              <span className="inline-flex items-center rounded-full bg-primary/10 text-primary px-1.5 py-0.5 text-[9px] font-semibold border border-primary/20">
                {zoneFilter}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="h-5 w-px bg-border/60 shrink-0" />

      {/* LHS / RHS toggle */}
      <div className="flex items-center shrink-0">
        <div className="relative flex rounded-full bg-muted/80 border border-border p-[3px] shrink-0 shadow-sm" style={{ width: directionOptions.length * directionStepWidth + 6 }}>
          <span
            className="absolute top-[3px] rounded-full bg-primary shadow-md z-10 transition-all duration-300 ease-in-out"
            style={{ left: 3 + directionActiveIdx * directionStepWidth, width: directionStepWidth, height: 18 }}
          />
          {directionOptions.map((d) => (
            <button
              key={d}
              onClick={() => onDirectionChange(d)}
              className={cn(
                "relative z-20 flex items-center justify-center text-[9px] font-semibold uppercase tracking-wide transition-colors duration-200 whitespace-nowrap",
                directionFilter === d ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              )}
              style={{ width: directionStepWidth, height: 18 }}
            >
              {d}
            </button>
          ))}
        </div>
      </div>

      <div className="h-5 w-px bg-border/60 shrink-0" />

      {/* Side sliding pill toggle */}
      <div className="flex items-center shrink-0">
        <div className="relative flex rounded-full bg-muted/80 border border-border p-[3px] shrink-0 shadow-sm" style={{ width: zoneOptions.length * stepWidth + 6 }}>
          <span
            className="absolute top-[3px] rounded-full bg-primary shadow-md z-10 transition-all duration-300 ease-in-out"
            style={{ left: 3 + activeIdx * stepWidth, width: stepWidth, height: 18 }}
          />
          {zoneOptions.map((s) => (
            <button
              key={s}
              onClick={() => onZoneChange(s)}
              className={cn(
                "relative z-20 flex items-center text-center pl-0.5 justify-center text-[9px] font-semibold uppercase tracking-wide transition-colors duration-200 whitespace-nowrap",
                zoneFilter === s ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              )}
              style={{ width: stepWidth, height: 18 }}
            >
              {zoneLabels[s]}
            </button>
          ))}
        </div>
      </div>

      <div className="h-5 w-px bg-border/60 shrink-0" />

      {/* Dropdowns */}
      <Select value={categoryFilter} onValueChange={(v) => { onCategoryChange(v); onAssetTypesChange([]); }}>
        <SelectTrigger className="w-[115px] h-6 text-[10px] border-border bg-background rounded-md shrink-0 shadow-sm overflow-hidden">
          <span className="truncate block"><SelectValue placeholder="Category" /></span>
        </SelectTrigger>
        <SelectContent className="bg-card z-50 max-h-64">
          <SelectItem value="all">All Categories</SelectItem>
          {categoryOptions.map((c) => (
            <SelectItem key={c.id} value={c.id} className="text-xs">
              <span className="flex items-center gap-1.5">
                <span className={`h-2 w-2 rounded-full ${getCategoryDotColor(c.id)}`} />
                {c.name}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={selectedAssetTypes[0] || "all"} onValueChange={(v) => onAssetTypesChange(v === "all" ? [] : [v])}>
        <SelectTrigger className="w-[115px] h-6 text-[10px] border-border bg-background rounded-md shrink-0 shadow-sm">
          <SelectValue placeholder="Asset Type" />
        </SelectTrigger>
        <SelectContent className="bg-card z-50 max-h-64">
          <SelectItem value="all">All Types</SelectItem>
          {assetTypeOptions.map((t) => (
            <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {hasActiveFilters && (
        <button
          onClick={onClearFilters}
          className="inline-flex items-center rounded-full bg-destructive/90 text-white px-2.5 py-1 text-[9px] font-bold hover:bg-destructive transition-colors shrink-0 shadow-sm"
        >
          <X className="h-2.5 w-2.5 mr-0.5" />Clear
        </button>
      )}

      {/* Road context */}
      {selectedRoadName && (
        <>
          <div className="h-4 w-px bg-border shrink-0" />
          <MapIcon className="h-3.5 w-3.5 text-primary shrink-0" />
          <span className="text-[11px] font-semibold text-foreground shrink-0">{selectedRoadName}</span>
          <span className="text-[10px] text-muted-foreground shrink-0">({selectedRoadCount})</span>
        </>
      )}
    </div>
  );
}
