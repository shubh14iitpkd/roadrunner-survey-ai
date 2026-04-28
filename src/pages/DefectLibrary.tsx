import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useSearchParams, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import LibraryMapView from "@/components/asset-library/LibraryMapView";
import FrameComparisonPopup from "@/components/FrameComparisonPopup";
import LinearAssetFrameSlider from "@/components/LinearAssetFrameSlider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { exportToExcel } from "@/lib/excelExport";
import { Textarea } from "@/components/ui/textarea";
import { Download, AlertTriangle, CheckCircle2, Loader2, Pencil, RotateCcw, Tag } from "lucide-react";
import {
  Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { CategoryBadge } from "@/components/CategoryBadge";
import { useLabelMap } from "@/contexts/LabelMapContext";
import { useFrameImage } from "@/hooks/useFrameImage";
import type { AssetRecord, MapData } from "@/types/asset";
import { EMPTY_MAP_DATA } from "@/types/asset";
import { buildAssetFromMapData, withConditionPatch, withIssuePatch } from "@/lib/mapData";
import AssetFilterStrip from "@/components/asset-library/AssetFilterStrip";
import AssetDetailSidebar from "@/components/asset-library/AssetDetailSidebar";
import AssetTable, { type ColumnDef } from "@/components/asset-library/AssetTable";
import { useAuth } from "@/contexts/AuthContext";
import capitalize from "@/helpers/capitalize";

// ── Description keys to exclude from the detailed view ──────────
const DESCRIPTION_KEY_FILTER = new Set([
  'Asset condition',
]);

// ── DAMAGED condition set (mirrors backend) ─────────────────
const DAMAGED_CONDITIONS = new Set([
  'overgrown', 'fadedpaint', 'dirty', 'missing', 'broken', 'bent', 'damaged',
]);

const displayCondition = (condition: string | undefined | null): string => {
  if (!condition) return '—';
  const c = condition.toLowerCase();
  if (DAMAGED_CONDITIONS.has(c)) return 'defective';
  return condition;
};

const conditionToColor = (condition: string): string => {
  const c = condition?.toLowerCase() ?? '';
  if (DAMAGED_CONDITIONS.has(c)) return '#ef4444'; // red-500
  if (c === 'good') return '#22c55e'; // green-500
  return '#f59e0b'; // amber for unknown
};

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
  { key: "road", header: "Route", className: "text-[11px] py-1.5 px-1.5 whitespace-nowrap text-center", render: (a) => a.roadName, getValue: (a) => a.roadName },
  { key: "side", header: "Asset Side", className: "text-[11px] py-1.5 px-1.5 text-center", render: (a) => a.side, getValue: (a) => a.side },
  { key: "zone", header: "Zone", className: "text-[11px] py-1.5 px-1.5 text-center capitalize", render: (a) => a.zone, getValue: (a) => a.zone },
  { key: "survey", header: "Survey", className: "text-[11px] py-1.5 px-1.5 whitespace-nowrap text-center", render: (a) => a.lastSurveyDate, getValue: (a) => a.lastSurveyDate },
  { key: "issue", header: "Issue", className: "py-1.5 px-1.5 min-w-[100px] text-center", getValue: (a) => a.issue, render: (a) => (
    <IssueCell issue={a.issue} />
  )},
];

/** Builds column definitions including the interactive "Mark as Good" / unmark column and edit issue. */
function buildDefectColumns(
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
        // Source of truth = the row's condition. After mark good the
        // optimistic update flips condition to 'good' so the green check
        // shows immediately; on next refetch the row falls outside the
        // damaged filter and disappears.
        const isMarked = (a.condition ?? '').toLowerCase() === 'good';
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
            title={isMarked ? "Revert to defective" : "Mark this asset as good"}
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

// Map view consumes the columnar MapData shape directly (see
// src/types/asset.ts). When the page uses include_defect=true on
// /master/map-points, MapData carries the optional `defect_ids` and
// `issues` parallel arrays alongside everything else.

export default function DefectLibrary() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [searchParams] = useSearchParams();
  const [searchQuery, setSearchQuery] = useState("");
  const { data: labelMapData } = useLabelMap();

  // Eager-eject on sidebar nav — drops the heavy Leaflet/table subtree
  // synchronously before Router commits, so users see the loader instead
  // of a frozen page during the unmount + lazy-chunk phase.
  const [ejected, setEjected] = useState(false);
  useEffect(() => {
    const handler = () => setEjected(true);
    window.addEventListener("page-eject", handler);
    return () => window.removeEventListener("page-eject", handler);
  }, []);

  const [selectedRouteId, setSelectedRouteId] = useState<number | null>(() => {
    const p = searchParams.get("route_id");
    return p ? Number(p) : null;
  });
  const [selectedAssetType, setSelectedAssetType] = useState<string>(() => searchParams.get("type") || "all");
  const [categoryFilter, setCategoryFilter] = useState<string>(() => searchParams.get("category") || "all");
  const [directionFilter, setDirectionFilter] = useState<"all" | "LHS" | "RHS">("all");
  const [zoneFilter, setZoneFilter] = useState<"all" | "shoulder" | "median" | "pavement" | "overhead">("all");

  const [sortKey, setSortKey] = useState<string | null>("defectId");
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
  const [fullViewLoading, setFullViewLoading] = useState(false);
  const [conditionLogs, setConditionLogs] = useState<any[]>([]);

  // ── Server-side table pagination state ──
  const [tablePage, setTablePage] = useState(1);
  const [tablePageSize, setTablePageSize] = useState(10);
  const tableAssetsRef = useRef<AssetRecord[]>([]);

  // Debounced text search for server-side filtering.
  const [debouncedSearchQ, setDebouncedSearchQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearchQ(searchQuery.trim()), 350);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // ── Mark as Good state ──
  const [markingGood, setMarkingGood] = useState<Set<string>>(new Set());
  const [confirmMarkGoodAsset, setConfirmMarkGoodAsset] = useState<AssetRecord | null>(null);

  // ── Edit Issue state ──
  const [editIssueAsset, setEditIssueAsset] = useState<AssetRecord | null>(null);
  const [editIssueValue, setEditIssueValue] = useState("");
  const [editIssueSaving, setEditIssueSaving] = useState(false);

  // ── Map transition loading state ──
  const [mapTransitioning, setMapTransitioning] = useState(false);
  const mapTransitionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Cached frame image via hook ──
  const { imageUrl, frameWidth, frameHeight, loading: imageLoading } = useFrameImage({
    videoId: selectedDefect?.videoId,
    frameNumber: selectedDefect?.frameNumber,
  });

  // Full-resolution frame, fetched lazily — only when the detail dialog
  // opens or the user expands the sidebar image. Falls back to the thumb
  // URL while the full payload is in flight.
  const [requestFullRes, setRequestFullRes] = useState(false);
  useEffect(() => { setRequestFullRes(false); }, [selectedDefect?.id]);
  const fullEnabled = showFullView || requestFullRes;
  const { imageUrl: fullImageUrl } = useFrameImage({
    videoId: fullEnabled ? selectedDefect?.videoId : undefined,
    frameNumber: fullEnabled ? selectedDefect?.frameNumber : undefined,
    variant: "full",
  });

  // Track which defect's image has actually finished loading.
  const [loadedForAssetId, setLoadedForAssetId] = useState<string | null>(null);
  useEffect(() => {
    if (!imageLoading && selectedDefect) {
      if (imageUrl || !selectedDefect.videoId) {
        setLoadedForAssetId(selectedDefect.id);
      }
    }
  }, [imageLoading, imageUrl, selectedDefect]);

  // True when we're waiting for the new point's image
  const pointImageLoading = selectedDefect != null
    && !!selectedDefect.videoId
    && (imageLoading || loadedForAssetId !== selectedDefect.id);

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
    const label = labelMapData?.labels?.[asset.asset_id ?? asset.assetId];
    if (label) return label.group_id || label.display_name;
    return asset.asset_type || asset.type || 'Unknown';
  }, [labelMapData]);

  // Store label-map callbacks in refs so loadData has a stable identity.
  const getCategoryNameRef = useRef(getCategoryDisplayName);
  getCategoryNameRef.current = getCategoryDisplayName;
  const getAssetNameRef = useRef(getAssetDisplayName);
  getAssetNameRef.current = getAssetDisplayName;

  // ── Build filter params for server requests ──
  // categoryFilter stores the display name (from the Select), but the backend
  // expects category_id. Look it up via categoryOptions.
  const categoryOptionsRef = useRef<{id: string; name: string}[]>([]);

  // ── Server filter params (one source of truth for both queries) ──
  // condition: "damaged" is always pinned — Defect Library by definition
  // shows only the damaged subset. Other filters mirror Asset Library.
  const serverFilters = useMemo<Record<string, any>>(() => {
    const f: Record<string, any> = { condition: "damaged" };
    if (selectedRouteId !== null) f.route_id = selectedRouteId;
    if (categoryFilter !== "all") {
      const m = categoryOptionsRef.current.find(c => c.name === categoryFilter);
      if (m) f.category = m.id;
    }
    if (directionFilter !== "all") f.side = directionFilter;
    if (zoneFilter !== "all") f.zone = zoneFilter;
    if (selectedAssetType !== "all") f.asset_type = selectedAssetType;
    if (debouncedSearchQ) f.search = debouncedSearchQ;
    return f;
  }, [selectedRouteId, categoryFilter, directionFilter, zoneFilter, selectedAssetType, debouncedSearchQ]);

  const buildFilterParams = useCallback(() => serverFilters, [serverFilters]);

  // ── React Query data sources (mirror AssetLibrary) ──
  const roadsQuery = useQuery({
    queryKey: qk.roads.list(),
    queryFn: () => api.roads.list(),
    staleTime: 5 * 60_000,
  });
  const roads = useMemo(
    () => ((roadsQuery.data?.items ?? []) as any[]).map((r) => ({
      route_id: r.route_id, name: r.road_name, side: r.road_side,
    })),
    [roadsQuery.data]
  );

  const mapPointsQuery = useQuery({
    queryKey: qk.assets.mapPoints({ ...serverFilters, include_defect: true }),
    queryFn: () => api.assets.getMasterMapPoints({ ...serverFilters, include_defect: true }),
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
  const mapData: MapData = (mapPointsQuery.data as MapData | undefined) ?? EMPTY_MAP_DATA;

  // Reset page + drop selection on filter change. A filtered-out defect
  // pinned in the sidebar would desync map highlight, page-of jumping, and
  // prev/next navigation.
  useEffect(() => {
    setTablePage(1);
    setSelectedDefect(null);
  }, [serverFilters]);

  const paginatedQuery = useQuery({
    queryKey: qk.assets.paginated({
      filters: serverFilters,
      page: tablePage,
      limit: tablePageSize,
      sort_key: sortKey ?? "lastSurveyDate",
      sort_dir: sortDir,
    }),
    queryFn: () => api.assets.getMasterPaginated({
      ...serverFilters,
      page: tablePage,
      limit: tablePageSize,
      sort_key: sortKey ?? "lastSurveyDate",
      sort_dir: sortDir,
    }),
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });

  const loading = mapPointsQuery.isLoading || mapPointsQuery.isFetching;

  // Map view consumes the columnar `mapData` directly. We do NOT build an
  // AssetRecord per row — that allocation alone burned ~150 MB at 1M.
  // Records are materialized on demand via buildAssetFromMapData when a
  // user clicks a marker (see handleSelectFromMap below).

  // ── Table records — server-paginated page ──
  const tableAssets = useMemo<AssetRecord[]>(() => {
    const items: any[] = paginatedQuery.data?.items ?? [];
    return items.map((raw) => {
      const coords = (raw.canonical_location?.coordinates ?? []) as number[];
      const lastDate = raw.last_seen_date ? String(raw.last_seen_date).split('T')[0] : '';
      return {
        id: raw._id ? String(raw._id) : raw.master_display_id,
        assetDisplayId: raw.master_display_id,
        masterDisplayId: raw.master_display_id,
        assetId: raw.asset_id ?? '',
        assetType: getAssetNameRef.current({ asset_id: raw.asset_id, asset_type: raw.asset_type }) || raw.asset_type || '',
        assetCategory: getCategoryNameRef.current(raw.category_id ?? ''),
        defectId: raw.latest_defect_id ?? '',
        lat: coords[1] ?? 0,
        lng: coords[0] ?? 0,
        condition: raw.latest_condition ?? 'unknown',
        markerColor: conditionToColor(raw.latest_condition ?? 'unknown'),
        groupId: raw.group_id ?? undefined,
        routeId: raw.route_id,
        side: raw.side || 'Unknown',
        zone: raw.zone || 'Unknown',
        category_id: raw.category_id ?? '',
        roadName: raw.route_name || '',
        roadSide: raw.road_side || undefined,
        lastSurveyDate: lastDate,
        issue: raw.issue ? capitalize(raw.issue) : 'Defective',
        severity: 'Low',
        surveyId: raw.latest_survey_id ? String(raw.latest_survey_id) : undefined,
      } as AssetRecord;
    });
  }, [paginatedQuery.data]);
  tableAssetsRef.current = tableAssets;
  const tableTotalCount = paginatedQuery.data?.total_count ?? 0;
  const tableTotalPages = paginatedQuery.data?.total_pages ?? 1;

  // Server-aware prev/next availability for the sidebar nav buttons.
  // navigateDefects hits /master/neighbor regardless of page, so we only need
  // to disable at the absolute boundaries of the filtered set. When the
  // selected defect isn't on the current page, assume both directions are
  // available (server will no-op at true boundaries).
  const selectedIdxOnPage = selectedDefect
    ? tableAssets.findIndex(a => a.assetDisplayId === selectedDefect.assetDisplayId)
    : -1;
  const hasPrevDefect = !selectedDefect
    ? false
    : selectedIdxOnPage === -1
      ? true
      : !(tablePage === 1 && selectedIdxOnPage === 0);
  const hasNextDefect = !selectedDefect
    ? false
    : selectedIdxOnPage === -1
      ? true
      : !(tablePage === tableTotalPages && selectedIdxOnPage === tableAssets.length - 1);

  // ── Lazy detail loader ──
  // Fetches survey_history + full description/issue for one selected defect
  // via React Query — repeated clicks hit the cache, mark mutations
  // invalidate via qk.assets.detail(id).
  const fetchDefectDetail = useCallback(async (asset: AssetRecord): Promise<Partial<AssetRecord> | null> => {
    if (!asset.masterDisplayId) return null;
    const fallbackIssue = asset.issue || 'Defective';
    return qc.fetchQuery({
      queryKey: qk.assets.detail(asset.masterDisplayId),
      queryFn: async (): Promise<Partial<AssetRecord> | null> => {
        const resp = await api.assets.getMasterByDisplayId(asset.masterDisplayId!);
        if (!resp?.item) return null;
        const raw = resp.item;
        const history: any[] = raw.survey_history || [];
        const lastDate = raw.last_seen_date
          ? String(raw.last_seen_date).split('T')[0]
          : raw.created_at?.split?.('T')?.[0] || '—';
        // Backend uses fast_mongo_response so all ObjectIds are plain strings already.
        return {
          surveyHistory: history.map((h: any) => ({
            survey_display_id: h.survey_display_id,
            survey_date: h.survey_date,
            condition: h.condition,
            confidence: h.confidence,
            asset_display_id: h.asset_display_id,
            match_confidence: h.match_confidence,
            location: h.location,
            video_id: h.video_id ? String(h.video_id) : undefined,
            frame_number: h.frame_number,
            box: h.box,
            created_at: h.created_at,
          })),
          totalSurveysDetected: raw.total_surveys_detected ?? history.length,
          issue: raw.issue ? capitalize(raw.issue) : fallbackIssue,
          ...((raw.description ?? raw.latest_description) && typeof (raw.description ?? raw.latest_description) === 'object' ? { description: raw.description ?? raw.latest_description } : {}),
          // Fields that map-point assets lack — fill from the full document
          // so clicking a map point loads the frame image just like a table click.
          id: raw._id ? String(raw._id) : undefined,
          videoId: raw.latest_video_id ? String(raw.latest_video_id) : undefined,
          frameNumber: raw.latest_frame_number,
          box: raw.latest_box ? {
            x: raw.latest_box.x, y: raw.latest_box.y,
            width: raw.latest_box.width ?? raw.latest_box.w ?? 0,
            height: raw.latest_box.height ?? raw.latest_box.h ?? 0,
          } : undefined,
          surveyId: raw.latest_survey_id ? String(raw.latest_survey_id) : undefined,
          roadName: raw.route_name || '',
          roadSide: raw.road_side || undefined,
          lastSurveyDate: lastDate,
          defectId: raw.latest_defect_id ?? '',
        };
      },
      staleTime: Infinity, // mutations explicitly invalidate
    });
  }, [qc]);

  const fetchAndMergeDetail = useCallback(async (asset: AssetRecord) => {
    if (!asset.masterDisplayId) return;
    try {
      const detail = await fetchDefectDetail(asset);
      if (detail) {
        setSelectedDefect(prev =>
          prev?.masterDisplayId === asset.masterDisplayId ? { ...prev, ...detail } : prev
        );
      }
    } catch {
      // silently ignore — user still sees slim data
    }
  }, [fetchDefectDetail]);

  useEffect(() => {
    const typeParam = searchParams.get("type");
    const categoryParam = searchParams.get("category");
    const routeIdParam = searchParams.get("route_id");
    if (typeParam) setSelectedAssetType(typeParam);
    if (categoryParam) setCategoryFilter(categoryParam);
    if (routeIdParam) setSelectedRouteId(Number(routeIdParam));
  }, [searchParams]);

  // Jump the table to the page containing the given defect. Called explicitly
  // on user-initiated selections that may land off the current page (map
  // click, sidebar prev/next). NOT called for table row clicks — the row is
  // by definition already on the current page.
  // Tracks the in-flight token so rapid clicks discard stale resolutions.
  const jumpTokenRef = useRef(0);
  const jumpTablePageToDefect = useCallback(async (masterDisplayId: string) => {
    const token = ++jumpTokenRef.current;
    const sortParams = {
      filters: serverFilters,
      limit: tablePageSize,
      sort_key: sortKey ?? "lastSurveyDate",
      sort_dir: sortDir,
    };
    try {
      const resp = await qc.fetchQuery({
        queryKey: qk.assets.pageOf(masterDisplayId, sortParams),
        queryFn: () => api.assets.getMasterPageOf(masterDisplayId, {
          limit: sortParams.limit,
          sort_key: sortParams.sort_key,
          sort_dir: sortParams.sort_dir,
          ...serverFilters,
        }),
        staleTime: 60_000,
      });
      if (token !== jumpTokenRef.current) return;
      const page = resp?.page;
      if (typeof page === "number" && page >= 1) setTablePage(page);
    } catch {
      // page-of resolution failed — leave current page alone
    }
  }, [serverFilters, tablePageSize, sortKey, sortDir, qc]);

  // Navigate prev/next across the full server-filtered + sorted set via the
  // /master/<id>/neighbor endpoint (same pattern as AssetLibrary).
  const navigateDefects = useCallback(async (direction: 'prev' | 'next') => {
    if (!selectedDefect?.masterDisplayId) return;
    try {
      const sortParams = {
        filters: serverFilters,
        sort_key: sortKey ?? "lastSurveyDate",
        sort_dir: sortDir,
      };
      const resp = await qc.fetchQuery({
        queryKey: qk.assets.neighbor(selectedDefect.masterDisplayId, direction, sortParams),
        queryFn: () => api.assets.getMasterNeighbor(selectedDefect.masterDisplayId!, direction, {
          sort_key: sortParams.sort_key,
          sort_dir: sortParams.sort_dir,
          ...serverFilters,
        }),
        staleTime: 60_000,
      });
      const raw = resp?.item;
      if (!raw?.master_display_id) return;
      const coords = (raw.canonical_location?.coordinates ?? []) as number[];
      const next: AssetRecord = {
        id: raw._id ? String(raw._id) : raw.master_display_id,
        assetDisplayId: raw.master_display_id,
        masterDisplayId: raw.master_display_id,
        assetId: raw.asset_id ?? '',
        assetType: getAssetNameRef.current({ asset_id: raw.asset_id, asset_type: raw.asset_type }) || raw.asset_type || '',
        assetCategory: getCategoryNameRef.current(raw.category_id ?? ''),
        defectId: raw.latest_defect_id ?? '',
        lat: coords[1] ?? 0,
        lng: coords[0] ?? 0,
        condition: raw.latest_condition ?? 'unknown',
        markerColor: conditionToColor(raw.latest_condition ?? 'unknown'),
        routeId: raw.route_id,
        side: raw.side || 'Unknown',
        zone: raw.zone || 'Unknown',
        category_id: raw.category_id ?? '',
        roadName: raw.route_name || '',
        lastSurveyDate: raw.last_seen_date ? String(raw.last_seen_date).split('T')[0] : '',
        issue: raw.issue ? capitalize(raw.issue) : 'Defective',
        severity: 'Low',
        surveyId: raw.latest_survey_id ? String(raw.latest_survey_id) : undefined,
      };
      setSelectedDefect(next);
      setSelectedSurveyIdx(0);
      setMarkerPopup(null);
      fetchAndMergeDetail(next);
      jumpTablePageToDefect(next.masterDisplayId!);
    } catch {
      // neighbor lookup failed — silently no-op
    }
  }, [selectedDefect, sortKey, sortDir, serverFilters, fetchAndMergeDetail, qc, jumpTablePageToDefect]);

  const handleRowClick = useCallback((defect: AssetRecord) => {
    setSelectedDefect(defect);
    setSelectedSurveyIdx(0);
    setMarkerPopup(null);
    fetchAndMergeDetail(defect);
    setMapTransitioning(true);
    if (mapTransitionTimer.current) clearTimeout(mapTransitionTimer.current);
    mapTransitionTimer.current = setTimeout(() => setMapTransitioning(false), 400);
  }, [fetchAndMergeDetail]);

  // Map-side click: id (and optional line snap overrides) → AssetRecord.
  // We materialize one record per click instead of one per row in the
  // dataset — see buildAssetFromMapData for the lazy construction.
  const handleSelectFromMap = useCallback((id: string, overrides?: { frameNumber?: number; box?: any; lat?: number; lng?: number }) => {
    const idx = mapData.idIndex.get(id);
    if (idx === undefined) return;
    const rec = buildAssetFromMapData(mapData, idx, {
      getAssetDisplayName: getAssetNameRef.current,
      getCategoryDisplayName: getCategoryNameRef.current,
    });
    // Defect Library convention: empty issue renders as "Defective".
    if (!rec.issue) rec.issue = "Defective";
    else rec.issue = capitalize(rec.issue);
    if (overrides) {
      if (overrides.frameNumber !== undefined) rec.frameNumber = overrides.frameNumber;
      if (overrides.box) rec.box = overrides.box;
      if (overrides.lat !== undefined) rec.lat = overrides.lat;
      if (overrides.lng !== undefined) rec.lng = overrides.lng;
    }
    handleRowClick(rec);
    if (rec.masterDisplayId) jumpTablePageToDefect(rec.masterDisplayId);
  }, [mapData, handleRowClick, jumpTablePageToDefect]);

  const handleMarkGood = useCallback((asset: AssetRecord) => {
    if (user.role === "Viewer") {
      toast.error("You do not have permission to mark assets as good.");
      return;
    }
    setConfirmMarkGoodAsset(asset);
  }, [user]);

  // Optimistically flip a master_display_id's condition in every active
  // /map-points cache entry (now columnar — see withConditionPatch) AND
  // in the current paginated table page. The paginated update is still
  // row-shaped because /master/paginated returns row-of-objects.
  const optimisticallySetCondition = useCallback((masterDisplayId: string, condition: string) => {
    const snapshots: Array<{ key: any; data: any }> = [];
    const mapEntries = qc.getQueriesData<MapData>({ queryKey: ["assets", "map"] });
    for (const [key, data] of mapEntries) {
      snapshots.push({ key, data });
      if (!data) continue;
      qc.setQueryData<MapData>(key, withConditionPatch(data, masterDisplayId, condition));
    }
    const pagEntries = qc.getQueriesData<any>({ queryKey: ["assets", "paginated"] });
    for (const [key, data] of pagEntries) {
      snapshots.push({ key, data });
      if (!data?.items) continue;
      qc.setQueryData<any>(key, {
        ...data,
        items: data.items.map((it: any) =>
          it.master_display_id === masterDisplayId ? { ...it, latest_condition: condition } : it
        ),
      });
    }
    return snapshots;
  }, [qc]);

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
    const snapshots = asset.masterDisplayId
      ? optimisticallySetCondition(asset.masterDisplayId, "good")
      : [];
    try {
      await api.assets.markAsGood(mongoId, { name: surveyorName, user_id: surveyorId, survey_id: asset.surveyId });
      toast.success(`Asset ${asset.assetDisplayId} marked as good`);
      if (asset.masterDisplayId) {
        qc.invalidateQueries({ queryKey: qk.assets.detail(asset.masterDisplayId) });
      }
      // Position-dependent caches: condition flip can shift sort order
      // (under condition filters) and adds a log entry.
      qc.invalidateQueries({ queryKey: ["assets", "pageOf"] });
      qc.invalidateQueries({ queryKey: ["assets", "neighbor"] });
      qc.invalidateQueries({ queryKey: ["assets", "conditionLogs"] });
      // Map cache holds the optimistic patch — invalidate so the next
      // refetch reconciles against server truth (catches fields the
      // optimistic patch can't predict, e.g. defect_id changes).
      qc.invalidateQueries({ queryKey: ["assets", "map"] });
    } catch (err: any) {
      // Roll back optimistic updates on failure.
      for (const { key, data } of snapshots) qc.setQueryData(key, data);
      toast.error(err?.message || "Failed to mark asset as good");
    } finally {
      setMarkingGood((prev) => { const s = new Set(prev); s.delete(assetKey); return s; });
    }
  }, [confirmMarkGoodAsset, user, optimisticallySetCondition, qc]);

  const handleUnmarkGood = useCallback(async (asset: AssetRecord) => {
    const assetKey = asset.assetDisplayId ?? asset.defectId;
    const mongoId = asset.id;
    if (!mongoId) {
      toast.error("Cannot update asset: missing ID");
      return;
    }
    const surveyorName = user ? `${user.first_name} ${user.last_name}`.trim() || user.email : "";
    const surveyorId = user?.id ?? "";
    const surveyId = asset.surveyId;
    setMarkingGood((prev) => new Set(prev).add(assetKey));
    const snapshots = asset.masterDisplayId
      ? optimisticallySetCondition(asset.masterDisplayId, "damaged")
      : [];
    try {
      await api.assets.unmarkGood(mongoId, { name: surveyorName, user_id: surveyorId, survey_id: surveyId });
      toast.success(`Asset ${asset.assetDisplayId} reverted to defective`);
      if (asset.masterDisplayId) {
        qc.invalidateQueries({ queryKey: qk.assets.detail(asset.masterDisplayId) });
      }
      qc.invalidateQueries({ queryKey: ["assets", "pageOf"] });
      qc.invalidateQueries({ queryKey: ["assets", "neighbor"] });
      qc.invalidateQueries({ queryKey: ["assets", "conditionLogs"] });
      qc.invalidateQueries({ queryKey: ["assets", "map"] });
    } catch (err: any) {
      for (const { key, data } of snapshots) qc.setQueryData(key, data);
      toast.error(err?.message || "Failed to revert asset");
    } finally {
      setMarkingGood((prev) => { const s = new Set(prev); s.delete(assetKey); return s; });
    }
  }, [user, optimisticallySetCondition, qc]);

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
      // Optimistically reflect the new issue in every active map-points
      // and paginated cache entry — same pattern as condition flips.
      const targetId = editIssueAsset.assetDisplayId;
      if (targetId) {
        const mapEntries = qc.getQueriesData<MapData>({ queryKey: ["assets", "map"] });
        for (const [key, data] of mapEntries) {
          if (!data) continue;
          qc.setQueryData<MapData>(key, withIssuePatch(data, targetId, trimmed));
        }
      }
      const pagEntries = qc.getQueriesData<any>({ queryKey: ["assets", "paginated"] });
      for (const [key, data] of pagEntries) {
        if (!data?.items) continue;
        qc.setQueryData<any>(key, {
          ...data,
          items: data.items.map((it: any) =>
            it.master_display_id === targetId ? { ...it, issue: trimmed } : it
          ),
        });
      }
      if (selectedDefect?.id === editIssueAsset.id) {
        setSelectedDefect((prev) => prev ? { ...prev, issue: trimmed } : prev);
      }
      // Detail cache holds the previous issue — invalidate so re-open
      // refetches the canonical value.
      if (editIssueAsset.masterDisplayId) {
        qc.invalidateQueries({ queryKey: qk.assets.detail(editIssueAsset.masterDisplayId) });
      }
      qc.invalidateQueries({ queryKey: ["assets", "map"] });
      toast.success("Issue updated");
      setEditIssueAsset(null);
    } catch (err: any) {
      toast.error(err?.message || "Failed to update issue");
    } finally {
      setEditIssueSaving(false);
    }
  }, [editIssueAsset, editIssueValue, selectedDefect, qc]);

  const defectColumns = useMemo(
    () => buildDefectColumns(markingGood, handleMarkGood, handleUnmarkGood, handleOpenEditIssue),
    [markingGood, handleMarkGood, handleUnmarkGood, handleOpenEditIssue]
  );

  const [exporting, setExporting] = useState(false);
  const handleExportExcel = async () => {
    setExporting(true);
    try {
      // Fetch all filtered defects for export via the fast master endpoint
      const filters = buildFilterParams();
      const resp = await api.assets.getMaster(filters);
      const allItems: any[] = resp?.items || [];
      const headers = [
        "Defect ID", "Asset ID", "Asset Type", "Category", "Latitude", "Longitude",
        "Route Name", "Route Side", "Asset Side", "Asset Zone", "Last Survey Date", "Issue",
      ];
      const rows = allItems.map((a: any) => {
        const coords = a.location?.coordinates || a.canonical_location?.coordinates || [];
        const lastDate = a.last_seen_date ? String(a.last_seen_date).split('T')[0] : a.created_at?.split?.('T')?.[0] || '—';
        return [
          a.latest_defect_id ?? '', a.master_display_id, getAssetDisplayName(a), getCategoryDisplayName(a.category_id || ''),
          coords[1] || 0, coords[0] || 0, a.route_name || '', a.road_side ?? "—", capitalize(a.side || 'Unknown'),
          capitalize(a.zone || 'Unknown'), lastDate, capitalize(a.issue || 'Defective'),
        ];
      });
      exportToExcel({
        filename: `Defects Library Report.xlsx`,
        sheetName: "Defects",
        title: "RoadSight AI - Defect Library Report",
        subtitle: `Generated: ${new Date().toLocaleDateString()} | ${allItems.length} defects`,
        headers,
        rows,
      });
      toast.success("Defects report exported as Excel");
    } catch (err: any) {
      toast.error("Failed to export: " + (err?.message || "Unknown error"));
    } finally {
      setExporting(false);
    }
  };

  const assetTypeOptions = useMemo(() => {
    const labels = Object.values(labelMapData?.labels || {});
    if (!labels) return [];
    const category = categoryFilter !== "all"
      ? Object.values(labelMapData?.categories || {}).find(c => c.display_name === categoryFilter)
      : null;
    const uniqueGroupIds = new Set(
      labels
        .filter(l => !category || l.category_id === category.category_id)
        .map(l => l.group_id)
    );
    return [...uniqueGroupIds].sort();
  }, [labelMapData, categoryFilter]);


  const categoryOptions = useMemo(() => {
    const categoryMap = labelMapData?.categories || {};
    const opts = []
    for (const [cat, cinfo] of Object.entries(categoryMap)) {
      opts.push({ id: cat, name: cinfo.display_name });
    }
    opts.sort((a, b) => a.name.localeCompare(b.name));
    return opts
  }, [labelMapData]);
  categoryOptionsRef.current = categoryOptions;

  const clearFilters = useCallback(() => {
    setCategoryFilter("all");
    setSelectedAssetType("all");
    setDirectionFilter("all");
    setZoneFilter("all");
    setSearchQuery("");
    setSelectedRouteId(null);
  }, []);

  if (ejected) return null;

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
            <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1.5" disabled={exporting} onClick={handleExportExcel}>
              {exporting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
              Export Report
            </Button>
          </div>
        </div>
      </div>

      {/* Filter Strip — count is "still defective" rows after any client
          mark-good mutations (mapData.conditions reflects current state). */}
      <AssetFilterStrip
        filteredCount={tableTotalCount}
        countLabel="defects"
        directionFilter={directionFilter}
        onDirectionChange={setDirectionFilter}
        zoneFilter={zoneFilter}
        onZoneChange={setZoneFilter}
        categoryFilter={categoryFilter}
        onCategoryChange={setCategoryFilter}
        selectedAssetType={selectedAssetType}
        onAssetTypesChange={setSelectedAssetType}
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
            data={mapData}
            selectedId={selectedDefect?.assetDisplayId ?? null}
            onSelect={handleSelectFromMap}
            getAssetDisplayName={getAssetDisplayName}
          />
          {/* Loading overlay — shown during initial data fetch or map transition. Sidebar handles its own frame-image loader. */}
          {(loading || mapTransitioning) && (
            <div className="absolute inset-0 bg-background/30 backdrop-blur-[2px] z-[1000] flex items-center justify-center transition-opacity duration-200">
              <div className="flex flex-col items-center gap-2 bg-background/80 rounded-xl px-5 py-3 shadow-lg">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                <span className="text-[10px] text-muted-foreground font-medium">
                  {loading ? "Loading defects…" : "Loading defect…"}
                </span>
              </div>
            </div>
          )}
        </div>

        <AssetDetailSidebar
          markerPopup={markerPopup}
          selectedAsset={selectedDefect}
          imageUrl={pointImageLoading ? null : imageUrl}
          fullImageUrl={fullImageUrl}
          onRequestFullImage={() => setRequestFullRes(true)}
          frameWidth={frameWidth}
          frameHeight={frameHeight}
          imageLoading={pointImageLoading}
          filteredAssets={tableAssets}
          hasPrev={hasPrevDefect}
          hasNext={hasNextDefect}
          onCloseAsset={() => setSelectedDefect(null)}
          getAssetDisplayName={getAssetDisplayName}
          onNavigate={navigateDefects}
          onFullView={async () => {
            if (selectedDefect) {
              setMarkerPopup({
                frameData: { gpx_point: { lat: selectedDefect.lat, lon: selectedDefect.lng } },
                trackTitle: selectedDefect.roadName,
                pointIndex: 0,
                totalPoints: 1,
              });
              setShowFullView(true);
              setFullViewLoading(true);
              try {
                const mongoId = selectedDefect.id ?? '';
                const resp = await qc.fetchQuery({
                  queryKey: qk.assets.conditionLogs(mongoId),
                  queryFn: () => api.assets.getConditionLogs(mongoId),
                  staleTime: 60_000,
                });
                setConditionLogs(resp?.items ?? []);
              } catch { setConditionLogs([]); }
              finally { setFullViewLoading(false); }
            }
          }}
          onCloseMarker={() => setMarkerPopup(null)}
          onShowFullView={() => setShowFullView(true)}
          emptyLabel="defect"
        />
      </div>

      {/* Full Road View Dialog */}
      <Dialog open={showFullView} onOpenChange={async (open) => {
        if (!open) { setShowFullView(false); setConditionLogs([]); setFullViewLoading(false); }
      }}>
        <DialogHeader className="hidden">
          <DialogTitle>Full Asset View</DialogTitle>
          <DialogDescription>
            Full description of an asset
          </DialogDescription>
        </DialogHeader>
        <DialogContent className="max-w-[80vw] w-[70vw] h-[85vh] max-h-[90vh] overflow-auto p-0" style={{ zIndex: 9999 }}>
          {fullViewLoading && (
            <div className="flex items-center justify-center h-full w-full">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          )}
              {!fullViewLoading && selectedDefect && (() => {
                const assetFrameData = {
                  videoId: selectedDefect.videoId || "",
                  frame_number: selectedDefect.frameNumber ?? 0,
                  baseUrl: "",
                  width: frameWidth ?? 0,
                  height: frameHeight ?? 0,
                  image_data: fullImageUrl ?? imageUrl ?? undefined,
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
                      asset_id: selectedDefect.assetId,
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
                      loading={pointImageLoading}
                    />
                    <LinearAssetFrameSlider
                      asset={selectedDefect}
                      idx={selectedDefect.kpIdx}
                      onFrameChange={({ idx, ...rest }) => setSelectedDefect((prev) => prev ? { ...prev, ...rest, kpIdx: idx } : prev)}
                    />
                  </div>
                );
              })()}

              {/* Attributes */}
              {!fullViewLoading && selectedDefect && (() => {
                const filteredDesc = selectedDefect.description
                  ? Object.entries(selectedDefect.description).filter(([k]) => !DESCRIPTION_KEY_FILTER.has(k))
                  : [];
                if (filteredDesc.length === 0) return null;
                return (
                  <div className="px-5 pt-4 pb-2">
                    <div className="rounded-lg border border-border bg-muted/30 px-4 py-3">
                      <div className="flex items-center gap-1.5 mb-3">
                        <Tag className="h-3 w-3 text-muted-foreground" />
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Attributes</p>
                      </div>
                      <div className="grid grid-cols-3 lg:grid-cols-4 gap-x-8 gap-y-3">
                        {filteredDesc.map(([key, val]) => (
                          <div key={key}>
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">{key}</p>
                            <p className="text-xs font-semibold text-foreground capitalize">{val}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Survey History Timeline */}
              {!fullViewLoading && selectedDefect && (() => {
                const condition = selectedDefect.condition?.toLowerCase() ?? '';
                const isDamaged = DAMAGED_CONDITIONS.has(condition);
                const history = selectedDefect.surveyHistory ?? [];
                const reversed = [...history].reverse();
                const isManuallyGood = condition === 'good' && conditionLogs.length > 0 && conditionLogs[0]?.action === 'marked_good';
                const latestMarkGood = isManuallyGood ? conditionLogs[0] : null;
                return (
                  <div className="px-5 py-3">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className={cn("h-3.5 w-3.5", isDamaged ? "text-destructive" : "text-emerald-600")} />
                        <span className={cn("text-xs font-semibold capitalize", isDamaged ? "text-destructive" : "text-emerald-600")}>
                          Defect Detected: {capitalize(selectedDefect.issue)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-muted-foreground">
                          {selectedDefect.totalSurveysDetected ?? history.length} survey{(selectedDefect.totalSurveysDetected ?? history.length) !== 1 ? 's' : ''} detected
                        </span>
                      </div>
                    </div>

                    {/* Merged Timeline */}
                    {(() => {
                      type SurveyItem = { kind: 'survey'; condition: string; entry: typeof reversed[0]; rIdx: number; date: string };
                      type LogItem = { kind: 'log'; condition: string; log: typeof conditionLogs[0]; date: string };
                      type TimelineItem = SurveyItem | LogItem;

                      const surveyItems: SurveyItem[] = reversed.map((entry, rIdx) => ({
                        kind: 'survey',
                        entry,
                        condition: entry.condition,
                        rIdx,
                        date: entry.created_at ?? entry.survey_date ?? '',
                      }));
                      const logItems: LogItem[] = conditionLogs.map((log) => ({
                        kind: 'log',
                        condition: log.action === 'marked_good' ? 'good'
                          : log.action === 'qc_edit' ? (log.new_state?.condition || 'unknown')
                          : log.action === 'manual_addition' ? (log.new_condition || 'good')
                          : 'damaged',
                        log,
                        date: log.changed_at ?? '',
                      }));

                      const merged: TimelineItem[] = [...surveyItems, ...logItems].sort((a, b) =>
                        String(b.date).localeCompare(String(a.date))
                      );

                      if (merged.length === 0) {
                        return <p className="text-xs text-muted-foreground italic">No survey history available.</p>;
                      }

                      let surveyCounter = -1;

                      return (
                        <div className="relative">
                          <div className="absolute left-[9px] top-[6px] bottom-[6px] w-px bg-border z-0" />
                          <div className="space-y-2 relative z-10">
                            {merged.map((item, mIdx) => {
                              const isGoodAction = item.condition === 'good';
                              if (item.kind === 'log') {
                                const isQcEdit = item.log.action === 'qc_edit';
                                const isManualAdd = item.log.action === 'manual_addition';
                                if (isQcEdit) {
                                  const changes: string[] = [];
                                  if (item.log.type_changed) changes.push(`Type: ${item.log.previous_state?.group_id} → ${item.log.new_state?.group_id}`);
                                  if (item.log.condition_changed) changes.push(`Condition: ${displayCondition(item.log.previous_state?.condition)} → ${displayCondition(item.log.new_state?.condition)}`);
                                  if (item.log.box_moved) changes.push('Bounding box adjusted');
                                  return (
                                    <div key={`log-${mIdx}`} className="flex items-start gap-3">
                                      <div className="shrink-0 flex items-center justify-center w-[18px] pt-1">
                                        <div className="h-2 w-2 rounded-full border-2 border-background bg-blue-500" />
                                      </div>
                                      <div className="py-1 text-xs text-muted-foreground">
                                        <div>
                                          <span className="font-semibold text-blue-600">QC Edit</span>
                                          <span className="text-border"> · </span>
                                          <span>by <span className="text-foreground font-medium">{item.log.name || '-'}</span></span>
                                          <span className="text-border"> · </span>
                                          <span>on {item.date ? new Date(item.date).toISOString().split('T')[0] : '-'}</span>
                                        </div>
                                        {changes.length > 0 && (
                                          <div className="mt-0.5 space-y-0.5">
                                            {changes.map((c, i) => (
                                              <div key={i} className="text-[10px] text-muted-foreground">{c}</div>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  );
                                }
                                if (isManualAdd) {
                                  return (
                                    <div key={`log-${mIdx}`} className="flex items-center gap-3">
                                      <div className="shrink-0 flex items-center justify-center w-[18px]">
                                        <div className="h-2 w-2 rounded-full border-2 border-background bg-violet-500" />
                                      </div>
                                      <div className="items-center gap-2 py-1 text-xs text-muted-foreground">
                                        <span className="font-semibold text-violet-600">Manually Added</span>
                                        <span className="text-border"> · </span>
                                        <span>by <span className="text-foreground font-medium">{item.log.name || '-'}</span></span>
                                        <span className="text-border"> · </span>
                                        <span>on {item.date ? new Date(item.date).toISOString().split('T')[0] : '-'}</span>
                                      </div>
                                    </div>
                                  );
                                }
                                return (
                                  <div key={`log-${mIdx}`} className="flex items-center gap-3">
                                    <div className="shrink-0 flex items-center justify-center w-[18px]">
                                      <div className={cn(
                                        "h-2 w-2 rounded-full border-2 border-background",
                                        isGoodAction ? "bg-emerald-500" : "bg-destructive"
                                      )} />
                                    </div>
                                    <div className="items-center gap-2 py-1 text-xs text-muted-foreground">
                                      <span className={cn("font-semibold", isGoodAction ? "text-emerald-600" : "text-destructive")}>
                                        {isGoodAction ? 'Marked Good' : 'Marked Defective'}
                                      </span>
                                      <span className="text-border">·</span>
                                      <span>by <span className="text-foreground font-medium">{item.log.name || '-'}</span></span>
                                      <span className="text-border">·</span>
                                      <span>on {item.date ? new Date(item.date).toISOString().split('T')[0] : '-'}</span>
                                    </div>
                                  </div>
                                );
                              }

                              surveyCounter++;
                              const localSurveyIdx = surveyCounter;
                              const { entry } = item;
                              const entryCondition = entry.condition?.toLowerCase() ?? '';
                              const entryIsDamaged = DAMAGED_CONDITIONS.has(entryCondition);
                              const isLatest = item.rIdx === 0;
                              const isSelected = selectedSurveyIdx === localSurveyIdx;
                              const effectivelyGood = item.condition === 'good';
                              const borderColor = (!effectivelyGood && entryIsDamaged) ? "border-destructive/20" : "border-emerald-500/30";
                              const bgColor = (!effectivelyGood && entryIsDamaged) ? "bg-destructive/5" : "bg-emerald-500/5";
                              const dotColor = (!effectivelyGood && entryIsDamaged) ? "bg-destructive" : "bg-emerald-500";

                              return (
                                <div key={`survey-${entry.survey_display_id}-${mIdx}`} className="flex items-start gap-3">
                                  <div className="flex flex-col items-center shrink-0 pt-4">
                                    <div className={cn("h-[18px] w-[18px] rounded-full border-[3px] border-background shadow-sm", dotColor)} />
                                  </div>
                                  <button
                                    onClick={() => setSelectedSurveyIdx(localSurveyIdx)}
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
                                        <p className={cn("font-semibold capitalize", (!effectivelyGood && entryIsDamaged) ? "text-destructive" : "text-emerald-600")}>
                                          {effectivelyGood ? 'Good' : displayCondition(entry.condition)}
                                        </p>
                                      </div>
                                      <div>
                                        <p className="text-muted-foreground text-[9px] uppercase tracking-wider">Asset Type</p>
                                        <p className="font-semibold text-foreground">{selectedDefect.assetType}</p>
                                      </div>
                                      <div>
                                        <p className="text-muted-foreground text-[9px] uppercase tracking-wider">Side / Zone</p>
                                        <p className="font-semibold text-foreground capitalize">{selectedDefect.side} · {selectedDefect.zone}</p>
                                      </div>
                                      <div>
                                        <p className="text-muted-foreground text-[9px] uppercase tracking-wider">Survey Date</p>
                                        <p className="font-semibold text-foreground">{entry.survey_date || '-'}</p>
                                      </div>
                                    </div>
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}
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
                    <span className="text-muted-foreground">Route</span>
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

      {/* Bottom Table — server-paginated against /master/paginated */}
      <AssetTable
        items={tableAssets}
        // Skeleton only on initial fetch. During refetches (page jump from
        // map click, sort/filter change) `placeholderData` keeps the prior
        // rows visible — otherwise the skeleton flashes and the row-level
        // selection highlight + auto-scroll disappear mid-transition.
        loading={paginatedQuery.isLoading}
        loadError={paginatedQuery.isError}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        selectedId={selectedDefect?.assetDisplayId ?? null}
        onRowClick={handleRowClick}
        onRetry={() => paginatedQuery.refetch()}
        idField="assetDisplayId"
        onClearFilters={clearFilters}
        columns={defectColumns}
        sortKey={sortKey}
        sortDir={sortDir}
        onSort={(colKey: string) => {
          if (sortKey === colKey) {
            setSortDir((d) => (d === "asc" ? "desc" : "asc"));
          } else {
            setSortKey(colKey);
            setSortDir("asc");
          }
          setTablePage(1);
          setSelectedDefect(null);
        }}
        serverPage={tablePage}
        serverPageSize={tablePageSize}
        serverTotalPages={tableTotalPages}
        serverTotalCount={tableTotalCount}
        onPageChange={(p) => { setTablePage(p); setSelectedDefect(null); }}
        onPageSizeChange={(size) => { setTablePageSize(size); setTablePage(1); setSelectedDefect(null); }}
      />
    </div>
  );
}
