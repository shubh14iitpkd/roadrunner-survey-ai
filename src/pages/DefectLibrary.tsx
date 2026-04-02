import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useSearchParams, Link } from "react-router-dom";
import LibraryMapView from "@/components/asset-library/LibraryMapView";
import FrameComparisonPopup from "@/components/FrameComparisonPopup";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api";
import { exportToExcel } from "@/lib/excelExport";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Download, AlertTriangle, CheckCircle2, Loader2, Pencil } from "lucide-react";
import {
  Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { CategoryBadge } from "@/components/CategoryBadge";
import { useLabelMap } from "@/contexts/LabelMapContext";
import { useFrameImage } from "@/hooks/useFrameImage";
import type { AssetRecord } from "@/types/asset";
import AssetFilterStrip from "@/components/asset-library/AssetFilterStrip";
import AssetDetailSidebar from "@/components/asset-library/AssetDetailSidebar";
import AssetTable, { type ColumnDef } from "@/components/asset-library/AssetTable";
import { useAuth } from "@/contexts/AuthContext";
import capitalize from "@/helpers/capitalize";

// function capitalizeFirstWord(str) {
//   if (!str) return "";
//   const [first, ...rest] = str.split(" ");
//   if (rest.length === 0) return capitalize(first);
//   return first.charAt(0).toUpperCase() + first.slice(1) + " " + rest.join(" ");
// }

// ── Custom tooltip cell for Issue column ──────────────────
const ISSUE_TRUNCATE_LEN = 18;

function IssueCell({ issue }: { issue: string }) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const badgeRef = useRef<HTMLSpanElement>(null);
  const isTruncated = issue.length > ISSUE_TRUNCATE_LEN;
  const display = isTruncated ? issue.slice(0, ISSUE_TRUNCATE_LEN) + "…" : issue;

  const handleMouseEnter = () => {
    if (isTruncated && badgeRef.current) {
      setRect(badgeRef.current.getBoundingClientRect());
    }
  };
  const handleMouseLeave = () => setRect(null);

  // Tooltip width for centering calculation
  const TOOLTIP_W = 200;

  return (
    <div className="inline-flex items-center justify-center" onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
      <span
        ref={badgeRef}
        className="inline-flex items-center rounded-md bg-destructive/10 text-destructive px-1.5 py-0.5 text-[9px] font-semibold leading-tight cursor-default"
      >
        {display}
      </span>
      {rect && isTruncated && createPortal(
        <div
          className="pointer-events-none"
          style={{
            position: "fixed",
            top: rect.top - 8,
            left: rect.left + rect.width / 2,
            transform: "translate(-50%, -100%)",
            zIndex: 99999,
          }}
        >
          {/* Tooltip box */}
          <div className="relative bg-popover border border-border rounded-md shadow-xl px-3 py-2 text-[11px] font-medium text-popover-foreground break-words"
            style={{ width: TOOLTIP_W, maxWidth: TOOLTIP_W }}
          >
            {issue}
          </div>
          {/* Downward caret centered on badge */}
          <span
            className="absolute w-3 h-3 bg-popover border-r border-b border-border"
            style={{
              bottom: "-7px",
              left: "50%",
              transform: "translateX(-50%) rotate(45deg)",
            }}
          />
        </div>,
        document.body
      )}
    </div>
  );
}

// ── Table columns for Defect Library ──────────────────────
const BASE_DEFECT_COLUMNS: ColumnDef[] = [
  { key: "defectId", header: "Defect ID", className: "font-mono text-[11px] font-semibold py-1.5 px-1.5 whitespace-nowrap text-center", render: (a) => a.defectId, getValue: (a) => a.defectId },
  { key: "assetDisplayId", header: "Asset ID", className: "font-mono text-[11px] py-1.5 px-1.5 whitespace-nowrap text-center", render: (a) => a.assetDisplayId, getValue: (a) => a.assetDisplayId },
  { key: "assetType", header: "Asset Type", className: "text-[10px] leading-tight py-1.5 px-1.5 min-w-[180px] max-w-[220px] text-center", render: (a) => <span className="line-clamp-2">{a.assetType}</span>, getValue: (a) => a.assetType },
  { key: "category", header: "Category", className: "py-1.5 px-1.5 text-center", render: (a) => <CategoryBadge category={a.assetCategory} categoryId={a.category_id} />, getValue: (a) => a.assetCategory },
  { key: "coords", header: "Coordinates", className: "font-mono text-[10px] py-1.5 px-1.5 whitespace-nowrap text-center", render: (a) => `${a.lat.toFixed(4)}, ${a.lng.toFixed(4)}` },
  { key: "road", header: "Road", className: "text-[11px] py-1.5 px-1.5 whitespace-nowrap text-center", render: (a) => a.roadName, getValue: (a) => a.roadName },
  { key: "side", header: "Road Side", className: "text-[11px] py-1.5 px-1.5 text-center", render: (a) => a.side, getValue: (a) => a.side },
  { key: "zone", header: "Zone", className: "text-[11px] py-1.5 px-1.5 text-center capitalize", render: (a) => a.zone, getValue: (a) => a.zone },
  { key: "survey", header: "Survey", className: "text-[11px] py-1.5 px-1.5 whitespace-nowrap text-center", render: (a) => a.lastSurveyDate, getValue: (a) => a.lastSurveyDate },
  { key: "issue", header: "Issue", className: "py-1.5 px-1.5 min-w-[100px] text-center", getValue: (a) => a.issue, render: (a) => (
    <IssueCell issue={a.issue} />
  )},
];

/** Builds column definitions including the interactive "Mark as Good" / unmark column and edit issue. */
function buildDefectColumns(
  goodSet: Set<string>,
  markingGood: Set<string>,
  onMarkGood: (a: AssetRecord) => void,
  onUnmarkGood: (a: AssetRecord) => void,
  onEditIssue: (a: AssetRecord) => void,
): ColumnDef[] {
  return [
    ...BASE_DEFECT_COLUMNS,
    {
      key: "editIssue",
      header: "",
      className: "py-1.5 px-1 text-center w-8",
      render: (a) => (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onEditIssue(a);
          }}
          title="Edit issue"
          className="inline-flex items-center justify-center w-6 h-6 rounded-full text-muted-foreground/40 dark:hover:text-muted-secondary dark:hover:bg-muted-secondary/10 hover:text-primary hover:bg-primary/10 transition-all cursor-pointer"
        >
          <Pencil className="h-3 w-3" />
        </button>
      ),
    },
    {
      key: "markGood",
      header: "Mark Good",
      className: "py-1.5 px-2 text-center",
      render: (a) => {
        const assetKey = a.assetDisplayId ?? a.defectId;
        const isMarked = goodSet.has(assetKey);
        const isSaving = markingGood.has(assetKey);
        return (
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (isSaving) return;
              if (isMarked) onUnmarkGood(a);
              else onMarkGood(a);
            }}
            disabled={isSaving}
            title={isMarked ? "Revert to damaged" : "Mark this asset as good"}
            className={cn(
              "inline-flex items-center justify-center w-6 h-6 rounded-full transition-all",
              isMarked
                ? "text-emerald-600 bg-emerald-500/10 hover:text-destructive hover:bg-destructive/10 cursor-pointer"
                : isSaving
                ? "text-muted-foreground cursor-not-allowed"
                : "text-muted-foreground/40 hover:text-emerald-600 hover:bg-emerald-500/10 cursor-pointer"
            )}
          >
            {isSaving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5" />
            )}
          </button>
        );
      },
    },
  ];
}

export default function DefectLibrary() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const [roads, setRoads] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const { data: labelMapData } = useLabelMap();

  const [selectedRouteId, setSelectedRouteId] = useState<number | null>(null);
  const [selectedAssetTypes, setSelectedAssetTypes] = useState<string[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [directionFilter, setDirectionFilter] = useState<"all" | "LHS" | "RHS">("all");
  const [zoneFilter, setZoneFilter] = useState<"all" | "shoulder" | "median" | "pavement" | "overhead">("all");
  const [surveyYear, setSurveyYear] = useState<string>("2025");

  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const [selectedDefect, setSelectedDefect] = useState<AssetRecord | null>(null);
  const [selectedSurveyIdx, setSelectedSurveyIdx] = useState(0);

  const [markerPopup, setMarkerPopup] = useState<{
    frameData: any;
    trackTitle: string;
    pointIndex: number;
    totalPoints: number;
  } | null>(null);
  const [showFullView, setShowFullView] = useState(false);

  // Dynamic defect data from API
  const [defects, setDefects] = useState<AssetRecord[]>([]);

  // ── Mark as Good state ──
  const [goodSet, setGoodSet] = useState<Set<string>>(new Set());
  const [markingGood, setMarkingGood] = useState<Set<string>>(new Set());
  const [confirmMarkGoodAsset, setConfirmMarkGoodAsset] = useState<AssetRecord | null>(null);

  // ── Edit Issue state ──
  const [editIssueAsset, setEditIssueAsset] = useState<AssetRecord | null>(null);
  const [editIssueValue, setEditIssueValue] = useState("");
  const [editIssueSaving, setEditIssueSaving] = useState(false);

  // ── Cached frame image via hook ──
  const { imageUrl, frameWidth, frameHeight, loading: imageLoading } = useFrameImage({
    videoId: selectedDefect?.videoId,
    frameNumber: selectedDefect?.frameNumber,
  });

  // ── Helpers using labelMap ──
  const getCategoryDisplayName = useCallback((categoryId: string) => {
    if (!categoryId) return 'Unknown';
    const fromMap = labelMapData?.categories?.[categoryId]?.display_name;
    if (fromMap) return fromMap;
    const defaultName = labelMapData?.categories?.[categoryId]?.default_name;
    if (defaultName) return defaultName;
    return categoryId;
  }, [labelMapData]);

  const getAssetDisplayName = useCallback((asset: any) => {
    const fromMap = labelMapData?.labels?.[asset.asset_id ?? asset.assetId]?.display_name;
    if (fromMap) return fromMap;
    return asset.display_name || asset.asset_type || asset.type || 'Unknown';
  }, [labelMapData]);


  // ── Data loading ──
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setLoadError(false);
      const [roadsResp, masterResp] = await Promise.all([
        api.roads.list(),
        api.assets.getMaster({ condition: "damaged" }),
      ]);
      if (roadsResp?.items) setRoads(roadsResp.items.map((r: any) => ({ route_id: r.route_id, name: r.road_name })));

      if (masterResp?.items) {
        const mapped: AssetRecord[] = masterResp.items.map((asset: any, idx: number) => {
          const coords = asset.location?.coordinates || asset.canonical_location?.coordinates || [];
          const lng = coords[0] || 0;
          const lat = coords[1] || 0;
          const categoryId = asset.category_id || '';
          const categoryName = getCategoryDisplayName(categoryId);
          const assetTypeName = getAssetDisplayName(asset);

          const mongoId = asset._id
            ? (typeof asset._id === 'object' && (asset._id as any)?.$oid ? (asset._id as any).$oid : String(asset._id))
            : `AST-${idx}`;

          // Extract latest survey_history entry for video/frame/box
          const history: any[] = asset.survey_history || [];
          const latestEntry = history.length > 0 ? history[history.length - 1] : null;

          const rawVideoId = latestEntry?.video_id
            ? (typeof latestEntry.video_id === 'object' && (latestEntry.video_id as any)?.$oid
              ? (latestEntry.video_id as any).$oid
              : latestEntry.video_id)
            : undefined;

          const surveyId = asset.latest_survey_id
            ? (typeof asset.latest_survey_id === 'object' && (asset.latest_survey_id as any)?.$oid
              ? (asset.latest_survey_id as any).$oid
              : String(asset.latest_survey_id))
            : undefined;

          // Format the last_seen_date
          const lastDate = asset.last_seen_date
            ? (typeof asset.last_seen_date === 'string'
              ? asset.last_seen_date.split('T')[0]
              : asset.last_seen_date)
            : asset.created_at?.split?.('T')?.[0] || '—';

          // Map survey_history for the timeline
          const surveyHistory = history.map((h: any) => ({
            survey_display_id: h.survey_display_id,
            survey_date: h.survey_date,
            condition: h.condition,
            confidence: h.confidence,
            asset_display_id: h.asset_display_id,
            match_confidence: h.match_confidence,
            location: h.location,
            video_id: h.video_id
              ? (typeof h.video_id === 'object' && (h.video_id as any)?.$oid
                ? (h.video_id as any).$oid
                : String(h.video_id))
              : undefined,
            frame_number: h.frame_number,
            box: h.box,
          }));

          const condition = asset.condition || asset.latest_condition || 'damaged';

          return {
            id: mongoId,
            defectId: latestEntry?.defect_id ?? `DEF-${String(idx).padStart(6, '0')}`,
            assetId: asset.asset_id || '',
            assetDisplayId: asset.master_display_id || '',
            masterDisplayId: asset.master_display_id || '',
            category_id: categoryId,
            assetType: assetTypeName,
            assetCategory: categoryName,
            condition,
            markerColor: '#ef4444',
            lat,
            lng,
            surveyId,
            roadName: asset.route_name || '',
            routeId: asset.route_id != null ? Number(asset.route_id) : undefined,
            side: asset.side || 'Unknown',
            zone: asset.zone || 'Unknown',
            lastSurveyDate: lastDate,
            issue: asset.issue ? capitalize(asset.issue) : "Damaged",
            severity: asset.severity || (idx % 3 === 0 ? 'High' : idx % 3 === 1 ? 'Medium' : 'Low'),
            videoId: rawVideoId ? String(rawVideoId) : undefined,
            frameNumber: latestEntry?.frame_number,
            box: latestEntry?.box ? {
              x: latestEntry.box.x,
              y: latestEntry.box.y,
              width: latestEntry.box.width ?? latestEntry.box.w ?? 0,
              height: latestEntry.box.height ?? latestEntry.box.h ?? 0,
            } : undefined,
            surveyHistory,
            totalSurveysDetected: asset.total_surveys_detected ?? history.length,
          };
        });
        setDefects(mapped);
      }
    } catch (err: any) {
      console.error("Failed to load data:", err);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [getCategoryDisplayName, getAssetDisplayName]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    const typeParam = searchParams.get("type");
    const categoryParam = searchParams.get("category");
    const routeIdParam = searchParams.get("route_id");
    if (typeParam) setSelectedAssetTypes([typeParam]);
    if (categoryParam) setCategoryFilter(categoryParam);
    if (routeIdParam) setSelectedRouteId(Number(routeIdParam));
  }, [searchParams]);

  // ── Filtering ──
  const filteredDefects = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    const fil = defects.filter((a) => {
      if (categoryFilter !== "all" && a.assetCategory !== categoryFilter) return false;
      if (directionFilter !== "all" && a.side !== directionFilter) return false;
      if (selectedAssetTypes.length > 0 && !selectedAssetTypes.includes(a.assetType)) return false;
      if (zoneFilter !== "all" && a.zone !== zoneFilter) return false;
      if (selectedRouteId !== null && a.routeId !== selectedRouteId) return false;
      if (q && !(
        a.defectId.toLowerCase().includes(q) ||
        a.assetDisplayId.toLowerCase().includes(q) ||
        a.assetType.toLowerCase().includes(q) ||
        (a.roadName ?? '').toLowerCase().includes(q) ||
        a.issue.toLowerCase().includes(q)
      )) return false;
      return true;
    });

    return fil;
  }, [defects, categoryFilter, selectedAssetTypes, directionFilter, zoneFilter, selectedRouteId, searchQuery]);

  // ── Sorting filtered defects ──
  const sortedAndFilteredDefects = useMemo(() => {
    if (!sortKey) return filteredDefects;
    const col = BASE_DEFECT_COLUMNS.find((c) => c.key === sortKey);
    if (!col?.getValue) return filteredDefects;
    const getter = col.getValue;
    return [...filteredDefects].sort((a, b) => {
      const va = getter(a);
      const vb = getter(b);
      let cmp: number;
      if (typeof va === "number" && typeof vb === "number") {
        cmp = va - vb;
      } else {
        cmp = String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: "base" });
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [filteredDefects, sortKey, sortDir]);

  // ── Navigation ──
  const navigateDefects = useCallback((direction: 'prev' | 'next') => {
    if (!selectedDefect) return;
    const idx = sortedAndFilteredDefects.findIndex(a => a.defectId === selectedDefect.defectId);
    if (idx === -1) return;
    const nextIdx = direction === 'prev' ? idx - 1 : idx + 1;
    if (nextIdx >= 0 && nextIdx < sortedAndFilteredDefects.length) {
      setSelectedDefect(sortedAndFilteredDefects[nextIdx]);
      setSelectedSurveyIdx(0);
      setMarkerPopup(null);
    }
  }, [selectedDefect, sortedAndFilteredDefects]);



  const handleRowClick = useCallback((defect: AssetRecord) => {
    setSelectedDefect(defect);
    setSelectedSurveyIdx(0);
    setMarkerPopup(null);
  }, []);

  const handleMarkGood = useCallback((asset: AssetRecord) => {
    if (user.role === "Viewer") {
      toast.error("You do not have permission to mark assets as good.");
      return;
    }
    setConfirmMarkGoodAsset(asset);
  }, [user]);

  const handleConfirmMarkGood = useCallback(async () => {
    const asset = confirmMarkGoodAsset;
    if (!asset) return;
    setConfirmMarkGoodAsset(null);

    const assetKey = asset.assetDisplayId ?? asset.defectId;
    const mongoId = asset.id;
    if (!mongoId) {
      toast.error("Cannot update asset: missing ID");
      return;
    }
    const surveyorName = user
      ? `${user.first_name} ${user.last_name}`.trim() || user.email
      : "Unknown";
    const surveyorId = user?.id ?? "";

    setMarkingGood((prev) => new Set(prev).add(assetKey));
    try {
      await api.assets.markAsGood(mongoId, { name: surveyorName, user_id: surveyorId });
      setGoodSet((prev) => new Set(prev).add(assetKey));
      toast.success(`Asset ${asset.assetDisplayId} marked as good`);
    } catch (err: any) {
      toast.error(err?.message || "Failed to mark asset as good");
    } finally {
      setMarkingGood((prev) => { const s = new Set(prev); s.delete(assetKey); return s; });
    }
  }, [confirmMarkGoodAsset, user]);

  const handleUnmarkGood = useCallback(async (asset: AssetRecord) => {
    const assetKey = asset.assetDisplayId ?? asset.defectId;
    const mongoId = asset.id;
    if (!mongoId) {
      toast.error("Cannot update asset: missing ID");
      return;
    }
    setMarkingGood((prev) => new Set(prev).add(assetKey));
    try {
      await api.assets.unmarkGood(mongoId);
      setGoodSet((prev) => { const s = new Set(prev); s.delete(assetKey); return s; });
      toast.success(`Asset ${asset.assetDisplayId} reverted to damaged`);
    } catch (err: any) {
      toast.error(err?.message || "Failed to revert asset");
    } finally {
      setMarkingGood((prev) => { const s = new Set(prev); s.delete(assetKey); return s; });
    }
  }, []);

  const handleOpenEditIssue = useCallback((asset: AssetRecord) => {
    if (user.role === "Viewer") {
      toast.error("You do not have permission to edit asset issues.");
    } else {
      setEditIssueAsset(asset);
      setEditIssueValue(asset.issue || "");
    }
  }, []);

  const handleSaveIssue = useCallback(async () => {
    if (!editIssueAsset?.id) return;
    const trimmed = editIssueValue.trim();
    if (!trimmed) { toast.error("Issue cannot be empty"); return; }
    setEditIssueSaving(true);
    try {
      await api.assets.updateIssue(editIssueAsset.id, trimmed);
      setDefects((prev) =>
        prev.map((d) => d.id === editIssueAsset.id ? { ...d, issue: trimmed } : d)
      );
      if (selectedDefect?.id === editIssueAsset.id) {
        setSelectedDefect((prev) => prev ? { ...prev, issue: trimmed } : prev);
      }
      toast.success("Issue updated");
      setEditIssueAsset(null);
    } catch (err: any) {
      toast.error(err?.message || "Failed to update issue");
    } finally {
      setEditIssueSaving(false);
    }
  }, [editIssueAsset, editIssueValue, selectedDefect]);

  const [exporting, setExporting] = useState(false);
  const handleExportExcel = async () => {
    setExporting(true);
    try {
      const headers = [
        "Defect ID", "Asset ID", "Asset Type", "Category", "Latitude", "Longitude",
        "Road Name", "Side", "Zone", "Last Survey Date", "Issue Type",
      ];
      const rows = filteredDefects.map((a) => [
        a.defectId, a.assetDisplayId, a.assetType, a.assetCategory,
        a.lat, a.lng, a.roadName, capitalize(a.side),
        capitalize(a.zone), a.lastSurveyDate, capitalize(a.issue),
      ]);
      exportToExcel({
        filename: `Defects Library Report.xlsx`,
        sheetName: "Defects",
        title: "RoadSight AI - Defect Library Report",
        subtitle: `Generated: ${new Date().toLocaleDateString()} | ${filteredDefects.length} defects`,
        headers,
        rows,
      });
      toast.success("Defects report exported as Excel");
    } finally {
      setExporting(false);
    }
  };

  const assetTypeOptions = useMemo(() => {
    let source = defects;
    if (categoryFilter !== "all") source = source.filter(a => a.assetCategory === categoryFilter);
    return [...new Set(source.map((a) => a.assetType))].sort();
  }, [defects, categoryFilter]);

  const categoryOptions = useMemo(() => {
    const unique = [
      ...new Map(
        defects.map(a => [
          `${a.assetCategory}-${a.category_id}`,
          { name: a.assetCategory, id: a.category_id }
        ])
      ).values()
    ].sort((a, b) => a.name.localeCompare(b.name));
    return unique;
  }, [defects]);

  const selectedRoadName = searchParams.get("road");
  const selectedRoadDefects = useMemo(() => {
    if (!selectedRoadName) return [];
    return filteredDefects.filter(a => a.roadName === selectedRoadName);
  }, [filteredDefects, selectedRoadName]);

  const clearFilters = useCallback(() => {
    setCategoryFilter("all");
    setSelectedAssetTypes([]);
    setDirectionFilter("all");
    setZoneFilter("all");
    setSearchQuery("");
    setSelectedRouteId(null);
  }, []);

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background">
      {/* Compact Header */}
      <div className="border-b border-border bg-header-strip shrink-0">
        <div className="px-5 py-2 flex items-center justify-between">
          <div className="flex flex-col gap-0.5">
            <Breadcrumb className="text-[8px]">
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbLink asChild><Link to="/">Dashboard</Link></BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  {selectedDefect ? (
                    <BreadcrumbLink className="cursor-pointer" onClick={() => setSelectedDefect(null)}>Defect Library</BreadcrumbLink>
                  ) : (
                    <BreadcrumbPage>Defect Library</BreadcrumbPage>
                  )}
                </BreadcrumbItem>
                {selectedDefect && (
                  <>
                    <BreadcrumbSeparator />
                    <BreadcrumbItem>
                      <BreadcrumbPage>{selectedDefect.roadName}</BreadcrumbPage>
                    </BreadcrumbItem>
                  </>
                )}
              </BreadcrumbList>
            </Breadcrumb>
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              <h1 className="text-sm font-bold text-foreground tracking-tight">Defect Library</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* <Select value={surveyYear} onValueChange={setSurveyYear}>
              <SelectTrigger className="h-7 w-[120px] text-[11px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="2025">Survey 2025</SelectItem>
                <SelectItem value="2026">Survey 2026</SelectItem>
              </SelectContent>
            </Select> */}
            <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1.5" disabled={exporting} onClick={handleExportExcel}>
              {exporting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
              Export Report
            </Button>
          </div>
        </div>
      </div>

      {/* Filter Strip */}
      <AssetFilterStrip
        filteredCount={filteredDefects.length}
        countLabel="defects"
        directionFilter={directionFilter}
        onDirectionChange={setDirectionFilter}
        zoneFilter={zoneFilter}
        onZoneChange={setZoneFilter}
        categoryFilter={categoryFilter}
        onCategoryChange={setCategoryFilter}
        selectedAssetTypes={selectedAssetTypes}
        onAssetTypesChange={setSelectedAssetTypes}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        categoryOptions={categoryOptions}
        assetTypeOptions={assetTypeOptions}
        roads={roads}
        selectedRouteId={selectedRouteId}
        onRouteChange={setSelectedRouteId}
        onClearFilters={clearFilters}
      />

      {/* Map + Sidebar */}
      <div className="flex min-h-0" style={{ flex: "1 1 45%" }}>
        <div className="flex-1 relative min-w-0" style={{ zIndex: 0, isolation: 'isolate' }}>
          <LibraryMapView
            assets={filteredDefects}
            selectedId={selectedDefect?.assetDisplayId ?? null}
            onSelect={handleRowClick}
          />
        </div>

        <AssetDetailSidebar
          markerPopup={markerPopup}
          selectedAsset={selectedDefect}
          imageUrl={imageUrl}
          frameWidth={frameWidth}
          frameHeight={frameHeight}
          imageLoading={imageLoading}
          filteredAssets={sortedAndFilteredDefects}
          onCloseAsset={() => setSelectedDefect(null)}
          getAssetDisplayName={getAssetDisplayName}
          onNavigate={navigateDefects}
          onFullView={() => {
            if (selectedDefect) {
              setMarkerPopup({
                frameData: { gpx_point: { lat: selectedDefect.lat, lon: selectedDefect.lng } },
                trackTitle: selectedDefect.roadName,
                pointIndex: 0,
                totalPoints: 1,
              });
              setShowFullView(true);
            }
          }}
          onCloseMarker={() => setMarkerPopup(null)}
          onShowFullView={() => setShowFullView(true)}
          emptyLabel="defect"
        />
      </div>

      {/* Full Road View Dialog */}
      <Dialog open={showFullView} onOpenChange={(open) => !open && setShowFullView(false)}>
        <DialogHeader className="hidden">
          <DialogTitle>Full Asset View</DialogTitle>
          <DialogDescription>
            Full description of an asset
          </DialogDescription>
        </DialogHeader>
        <DialogContent className="max-w-[80vw] w-[70vw] h-[85vh] max-h-[90vh] overflow-auto p-0" style={{ zIndex: 9999 }}>
              {selectedDefect && (() => {
                const assetFrameData = {
                  videoId: selectedDefect.videoId || "",
                  frame_number: selectedDefect.frameNumber ?? 0,
                  baseUrl: "",
                  width: frameWidth ?? 0,
                  height: frameHeight ?? 0,
                  image_data: imageUrl ?? undefined,
                  timestamp: selectedDefect.lastSurveyDate,
                  gpx_point: { lat: selectedDefect.lat, lon: selectedDefect.lng },
                  detections: selectedDefect.box ? [
                    {
                      class_name: selectedDefect.assetType,
                      confidence: 0.92,
                      bbox: {
                        x: selectedDefect.box.x,
                        y: selectedDefect.box.y,
                        width: selectedDefect.box.width,
                        height: selectedDefect.box.height,
                      },
                      condition: selectedDefect.issue,
                      category: selectedDefect.assetCategory,
                      category_id: selectedDefect.category_id,
                      asset_id: selectedDefect.asset_id,
                    },
                  ] : [],
                };

                return (
                  <div className="p-1">
                    <FrameComparisonPopup
                      frameData={assetFrameData}
                      trackTitle={selectedDefect.roadName}
                      pointIndex={0}
                      totalPoints={1}
                      onClose={() => setShowFullView(false)}
                    />
                  </div>
                );
              })()}

              {/* Survey History Timeline */}
              {selectedDefect && (() => {
                const history = selectedDefect.surveyHistory ?? [];
                const reversed = [...history].reverse();
                const latestIssue = selectedDefect.issue;

                return (
                  <div className="px-5 py-3">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
                        <span className="text-xs font-semibold text-destructive">
                          Defect Detected: <span>{capitalize(latestIssue)}</span>
                        </span>
                      </div>
                      <span className="text-[10px] text-muted-foreground">
                        {selectedDefect.totalSurveysDetected ?? history.length} survey{(selectedDefect.totalSurveysDetected ?? history.length) !== 1 ? 's' : ''} detected
                      </span>
                    </div>

                    {reversed.length === 0 ? (
                      <p className="text-xs text-muted-foreground italic">No survey history available.</p>
                    ) : (
                      <div className="relative">
                        <div className="absolute left-[9px] top-[6px] bottom-[6px] w-px bg-border z-0" />
                        <div className="space-y-2 relative z-10">
                          {reversed.map((entry, rIdx) => {
                            const entryCondition = entry.condition?.toLowerCase() ?? '';
                            const isDamaged = entryCondition !== 'good';
                            const isLatest = rIdx === 0;
                            const isSelected = selectedSurveyIdx === rIdx;
                            const borderColor = isDamaged ? "border-destructive/20" : "border-emerald-500/30";
                            const bgColor = isDamaged ? "bg-destructive/5" : "bg-emerald-500/5";
                            const dotColor = isDamaged ? "bg-destructive" : "bg-emerald-500";

                            return (
                              <div key={`${entry.survey_display_id}-${rIdx}`} className="flex items-start gap-3">
                                <div className="flex flex-col items-center shrink-0 pt-4">
                                  <div className={cn("h-[18px] w-[18px] rounded-full border-[3px] border-background shadow-sm", dotColor)} />
                                </div>
                                <button
                                  onClick={() => setSelectedSurveyIdx(rIdx)}
                                  className={cn(
                                    "flex-1 text-left border rounded-lg px-5 py-3 transition-all",
                                    bgColor, borderColor,
                                    isSelected && "ring-2 ring-primary/30 shadow-sm"
                                  )}
                                >
                                  <div className="flex items-center gap-2 mb-1">
                                    {isLatest && (
                                      <span className="text-[8px] font-bold uppercase tracking-wider text-primary bg-primary/10 dark:text-muted-secondary dark:bg-muted-secondary/10 rounded px-1.5 py-0.5">Latest</span>
                                    )}
                                  </div>
                                  <div className="grid grid-cols-5 gap-3 text-xs">
                                    <div>
                                      <p className="text-muted-foreground text-[9px] uppercase tracking-wider">Survey</p>
                                      <p className="font-mono font-semibold text-foreground">{entry.survey_display_id || '—'}</p>
                                    </div>
                                    <div>
                                      <p className="text-muted-foreground text-[9px] uppercase tracking-wider">Condition</p>
                                      <p className={cn("font-semibold capitalize", isDamaged ? "text-destructive" : "text-emerald-600")}>{isDamaged ? (entry.condition || '—') : "Good"}</p>
                                    </div>
                                    <div>
                                      <p className="text-muted-foreground text-[9px] uppercase tracking-wider">Asset Type</p>
                                      <p className="font-semibold text-foreground">{selectedDefect.assetType}</p>
                                    </div>
                                    <div>
                                      <p className="text-muted-foreground text-[9px] uppercase tracking-wider">Side / Zone</p>
                                      <p className="font-semibold text-foreground">{selectedDefect.side} · {selectedDefect.zone?.toUpperCase()}</p>
                                    </div>
                                    <div>
                                      <p className="text-muted-foreground text-[9px] uppercase tracking-wider">Survey Date</p>
                                      <p className="font-semibold text-foreground">{entry.survey_date || '—'}</p>
                                    </div>
                                  </div>
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
        </DialogContent>
      </Dialog>

      {/* Confirm Mark as Good Dialog */}
      <Dialog open={!!confirmMarkGoodAsset} onOpenChange={(open) => !open && setConfirmMarkGoodAsset(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              Mark Asset as Good?
            </DialogTitle>
            <DialogDescription>
              Please confirm you want to mark the following asset as good condition.
            </DialogDescription>
          </DialogHeader>
          {confirmMarkGoodAsset && (
            <div className="flex flex-col gap-2 py-2">
              <div className="rounded-lg border bg-muted/40 px-4 py-3 text-xs space-y-2">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Asset ID</span>
                  <span className="font-mono font-semibold">{confirmMarkGoodAsset.assetDisplayId}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Type</span>
                  <span className="font-semibold">{confirmMarkGoodAsset.assetType}</span>
                </div>
                {confirmMarkGoodAsset.assetCategory && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Category</span>
                    <span className="font-semibold">{confirmMarkGoodAsset.assetCategory}</span>
                  </div>
                )}
                {confirmMarkGoodAsset.roadName && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Road</span>
                    <span className="font-semibold">{confirmMarkGoodAsset.roadName}</span>
                  </div>
                )}
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={() => setConfirmMarkGoodAsset(null)}>
              Cancel
            </Button>
            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={handleConfirmMarkGood}>
              <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
              Confirm
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Issue Dialog */}
      <Dialog open={!!editIssueAsset} onOpenChange={(open) => !open && setEditIssueAsset(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit Issue</DialogTitle>
            <DialogDescription>
              {editIssueAsset?.assetDisplayId} | {editIssueAsset?.assetType}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 pt-1">
            <div className="flex flex-col gap-1">
              <Textarea
                value={editIssueValue}
                onChange={(e) => setEditIssueValue(e.target.value.slice(0, 100))}
                placeholder="Describe the issue…"
                className="text-sm resize-none"
                maxLength={100}
                rows={3}
                autoFocus
              />
              <span className={cn("text-[10px] text-right tabular-nums", editIssueValue.length >= 100 ? "text-destructive" : "text-muted-foreground")}>
                {editIssueValue.length}/100
              </span>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setEditIssueAsset(null)}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleSaveIssue} disabled={editIssueSaving}>
                {editIssueSaving && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                Save
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Bottom Table */}
      <AssetTable
        items={sortedAndFilteredDefects}
        loading={loading}
        loadError={loadError}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        selectedId={selectedDefect?.assetDisplayId ?? null}
        onRowClick={handleRowClick}
        onRetry={loadData}
        idField="assetDisplayId"
        onClearFilters={clearFilters}
        columns={buildDefectColumns(goodSet, markingGood, handleMarkGood, handleUnmarkGood, handleOpenEditIssue)}
        sortKey={sortKey}
        sortDir={sortDir}
        onSort={(colKey: string) => {
          if (sortKey === colKey) {
            setSortDir((d) => (d === "asc" ? "desc" : "asc"));
          } else {
            setSortKey(colKey);
            setSortDir("asc");
          }
        }}
      />
    </div>
  );
}
