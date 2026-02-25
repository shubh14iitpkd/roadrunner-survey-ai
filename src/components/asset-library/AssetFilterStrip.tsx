import { X, Map as MapIcon } from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { getCategoryDotColor } from "@/components/CategoryBadge";

type DirectionFilter = "all" | "LHS" | "RHS";
type SideFilter = "all" | "Shoulder" | "Median" | "Pavement" | "Overhead";

interface AssetFilterStripProps {
  filteredCount: number;
  countLabel?: string; // "anomalies" | "assets" etc.
  directionFilter: DirectionFilter;
  onDirectionChange: (v: DirectionFilter) => void;
  sideFilter: SideFilter;
  onSideChange: (v: SideFilter) => void;
  categoryFilter: string;
  onCategoryChange: (v: string) => void;
  selectedAssetTypes: string[];
  onAssetTypesChange: (v: string[]) => void;
  searchQuery: string;
  onSearchChange: (v: string) => void;
  categoryOptions: string[];
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
  sideFilter,
  onSideChange,
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
    sideFilter !== "all" ||
    searchQuery !== "";

  const sideOptions = ["all", "Shoulder", "Median", "Pavement", "Overhead"] as const;
  const sideLabels: Record<string, string> = { all: "All", Shoulder: "Shoulder", Median: "Median", Pavement: "Pavement", Overhead: "Overhead" };
  const activeIdx = sideOptions.indexOf(sideFilter);
  const stepWidth = 56;

  return (
    <div className="px-4 py-1.5 border-b border-border bg-gradient-to-r from-card to-muted/30 shrink-0 flex items-center gap-2 flex-nowrap min-w-0">
      {/* Count badge */}
      <div className="flex items-center gap-1.5 shrink-0">
        <span className="inline-flex items-center rounded-md bg-destructive/10 text-destructive px-1.5 py-0.5 text-[10px] font-bold tabular-nums border border-destructive/20">
          {filteredCount}
        </span>
        <span className="text-[9px] text-muted-foreground">{countLabel}</span>
        {(directionFilter !== "all" || sideFilter !== "all") && (
          <div className="flex items-center gap-1 ml-1">
            {directionFilter !== "all" && (
              <span className="inline-flex items-center rounded-full bg-primary/10 text-primary px-1.5 py-0.5 text-[9px] font-semibold border border-primary/20">
                {directionFilter}
              </span>
            )}
            {sideFilter !== "all" && (
              <span className="inline-flex items-center rounded-full bg-primary/10 text-primary px-1.5 py-0.5 text-[9px] font-semibold border border-primary/20">
                {sideFilter}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="h-5 w-px bg-border/60 shrink-0" />

      {/* LHS / RHS toggle */}
      <div className="flex items-center gap-1.5 shrink-0">
        <span className={cn("text-[10px] font-semibold transition-colors", directionFilter === "LHS" ? "text-primary" : "text-muted-foreground/60")}>LHS</span>
        <button
          onClick={() => onDirectionChange(directionFilter === "LHS" ? "RHS" : directionFilter === "RHS" ? "all" : "LHS")}
          className="relative w-9 h-5 rounded-full bg-muted border border-border shadow-inner transition-colors shrink-0"
        >
          <span className={cn(
            "absolute top-[3px] h-3.5 w-3.5 rounded-full bg-primary shadow-md transition-all duration-200",
            directionFilter === "LHS" ? "left-[3px]" : directionFilter === "RHS" ? "left-[16px]" : "left-[9px]"
          )} />
        </button>
        <span className={cn("text-[10px] font-semibold transition-colors", directionFilter === "RHS" ? "text-primary" : "text-muted-foreground/60")}>RHS</span>
      </div>

      <div className="h-5 w-px bg-border/60 shrink-0" />

      {/* Side sliding pill toggle */}
      <div className="flex items-center shrink-0">
        <div className="relative flex rounded-full bg-muted/80 border border-border p-[3px] shrink-0 shadow-sm" style={{ width: sideOptions.length * stepWidth + 6 }}>
          <span
            className="absolute top-[3px] rounded-full bg-primary shadow-md z-10 transition-all duration-300 ease-in-out"
            style={{ left: 3 + activeIdx * stepWidth, width: stepWidth, height: 18 }}
          />
          {sideOptions.map((s) => (
            <button
              key={s}
              onClick={() => onSideChange(s)}
              className={cn(
                "relative z-20 flex items-center justify-center text-[9px] font-semibold uppercase tracking-wide transition-colors duration-200 whitespace-nowrap",
                sideFilter === s ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              )}
              style={{ width: stepWidth, height: 18 }}
            >
              {sideLabels[s]}
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
            <SelectItem key={c} value={c} className="text-xs">
              <span className="flex items-center gap-1.5">
                <span className={`h-2 w-2 rounded-full ${getCategoryDotColor(c)}`} />
                {c}
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
