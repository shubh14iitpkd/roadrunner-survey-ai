import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import LibraryMapView from "@/components/asset-library/LibraryMapView";
import FrameComparisonPopup from "@/components/FrameComparisonPopup";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { exportToExcel } from "@/lib/excelExport";
import { Download, Database, Loader2, RotateCcw, Tag, AlertCircle, CheckCircle2, AlertTriangle } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
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
import LinearAssetFrameSlider from "@/components/LinearAssetFrameSlider";
import { buildAssetFromMapData, withConditionPatch } from "@/lib/mapData";
import AssetFilterStrip from "@/components/asset-library/AssetFilterStrip";
import AssetDetailSidebar from "@/components/asset-library/AssetDetailSidebar";
import AssetTable, { type ColumnDef } from "@/components/asset-library/AssetTable";
import capitalize from "@/helpers/capitalize";

// ── Description keys to exclude from the Detailed view ──────────
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

// ── Table columns for Asset Library (no Issue / Defect ID) ──
const BASE_ASSET_COLUMNS: ColumnDef[] = [
  { key: "assetDisplayId", header: "Asset ID", className: "font-mono text-[11px] py-1.5 px-1.5 whitespace-nowrap text-center", render: (a) => a.assetDisplayId, getValue: (a) => a.assetDisplayId },
  { key: "assetType", header: "Asset Type", className: "text-[10px] leading-tight py-1.5 px-1.5 min-w-[180px] max-w-[220px] text-center", render: (a) => <span className="line-clamp-2">{a.assetType}</span>, getValue: (a) => a.assetType },
  { key: "category", header: "Category", className: "py-1.5 px-1.5 text-center", render: (a) => <CategoryBadge category={a.assetCategory} categoryId={a.category_id} />, getValue: (a) => a.assetCategory },
  {
    key: "condition", header: "Condition", className: "py-1.5 px-1.5 text-center", getValue: (a) => a.condition ?? '', render: (a) => (
      <span className={`inline-flex capitalize items-center rounded-md px-1.5 py-0.5 text-[9px] font-semibold leading-tight ${DAMAGED_CONDITIONS.has((a.condition ?? '').toLowerCase())
        ? 'bg-destructive/10 text-destructive'
        : a.condition?.toLowerCase() === 'good'
          ? 'bg-emerald-500/10 text-emerald-600'
          : 'bg-amber-500/10 text-amber-600'
        }`}>{displayCondition(a.condition)}</span>
    )
  },
  { key: "coords", header: "Coordinates", className: "font-mono text-[10px] py-1.5 px-1.5 whitespace-nowrap text-center", render: (a) => `${a.lat.toFixed(4)}, ${a.lng.toFixed(4)}` },
  { key: "road", header: "Route", className: "text-[11px] py-1.5 px-1.5 whitespace-nowrap text-center", render: (a) => a.roadName, getValue: (a) => a.roadName },
  { key: "side", header: "Asset Side", className: "text-[11px] py-1.5 px-1.5 text-center", render: (a) => a.side, getValue: (a) => a.side },
  { key: "zone", header: "Zone", className: "text-[11px] capitalize py-1.5 px-1.5 text-center", render: (a) => a.zone, getValue: (a) => a.zone },
  { key: "survey", header: "Survey", className: "text-[11px] py-1.5 px-1.5 whitespace-nowrap text-center", render: (a) => a.lastSurveyDate, getValue: (a) => a.lastSurveyDate },
];

/** Builds column definitions including the interactive "Mark Condition" column. */
function buildAssetColumns(
  savingSet: Set<string>,
  onMarkGood: (a: AssetRecord) => void,
  onMarkDefective: (a: AssetRecord) => void,
): ColumnDef[] {
  return [
    ...BASE_ASSET_COLUMNS,
    {
      key: "markCondition",
      header: "Mark",
      className: "py-1.5 px-2 text-center",
      render: (a) => {
        const assetKey = a.assetDisplayId ?? a.id;
        const isSaving = savingSet.has(assetKey);
        const isDamaged = DAMAGED_CONDITIONS.has((a.condition ?? '').toLowerCase());
        const isGood = a.condition?.toLowerCase() === 'good';
        return (
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (isSaving) return;
              if (isDamaged) onMarkGood(a);
              else if (isGood) onMarkDefective(a);
            }}
            disabled={isSaving || (!isDamaged && !isGood)}
            title={isDamaged ? "Mark this asset as good" : isGood ? "Mark this asset as defective" : ""}
            className={cn(
              "inline-flex items-center justify-center w-6 h-6 rounded-full transition-all",
              isSaving
                ? "text-muted-foreground cursor-not-allowed"
                : isDamaged
                ? "text-muted-foreground/40 hover:text-emerald-600 hover:bg-emerald-500/10 cursor-pointer"
                : isGood
                ? "text-emerald-600 bg-emerald-500/10 hover:text-destructive hover:bg-destructive/10 cursor-pointer"
                : "text-muted-foreground/20 cursor-not-allowed"
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

// Minimal map point from the /map-points endpoint.
// Map view consumes the columnar MapData shape directly (see
// src/types/asset.ts). The legacy per-row `MapPoint` interface used to
// live here — it was removed when LibraryMapView switched to indexing the
// parallel arrays in place, so we no longer pay one allocation per row.

export default function AssetLibrary() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [searchParams] = useSearchParams();
  const [conditionLogs, setConditionLogs] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const { data: labelMapData } = useLabelMap();

  // Eager-eject: when sidebar nav fires the page-eject event we drop the
  // entire heavy subtree (LibraryMapView + tableAssets) synchronously,
  // *before* React Router commits the route change. This converts a
  // multi-second blocking unmount into a near-instant one because Leaflet,
  // ResizeObservers, and the ~70k AssetRecord state graph are all torn down
  // while the user is already looking at the loader overlay shown by Layout.
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
  const [conditionFilter, setConditionFilter] = useState<"all" | "good"| "damaged">(() => {
    const c = searchParams.get("condition");
    return c==="defective" ? "damaged" : (c === "good" || c === "damaged") ? c : "all";
  });
  const [zoneFilter, setZoneFilter] = useState<"all" | "shoulder" | "median" | "pavement" | "overhead">("all");
  const [attributes, setAttributes] = useState<Record<string, readonly string[]>>({});

  const [sortKey, setSortKey] = useState<string | null>("assetDisplayId");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const [selectedAsset, setSelectedAsset] = useState<AssetRecord | null>(null);
  const [selectedSurveyIdx, setSelectedSurveyIdx] = useState(0);

  const [markerPopup, setMarkerPopup] = useState<{
    frameData: any;
    trackTitle: string;
    pointIndex: number;
    totalPoints: number;
  } | null>(null);
  const [showFullView, setShowFullView] = useState(false);
  const [fullViewLoading, setFullViewLoading] = useState(false);

  // Latest tableAssets kept in a ref so navigate prev/next can resolve without
  // re-creating the callback on every sort/filter change.
  const tableAssetsRef = useRef<AssetRecord[]>([]);

  // Debounced search query — drives the /master/search useQuery key.
  const [debouncedSearchQ, setDebouncedSearchQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearchQ(searchQuery.trim()), 350);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // ── Server-side table pagination state ──
  const [tablePage, setTablePage] = useState(1);
  const [tablePageSize, setTablePageSize] = useState(10);

  // ── Map transition loading state ──
  const [mapTransitioning, setMapTransitioning] = useState(false);
  const mapTransitionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Mark condition state ──
  const [markingSaving, setMarkingSaving] = useState<Set<string>>(new Set());
  const [confirmMarkGoodAsset, setConfirmMarkGoodAsset] = useState<AssetRecord | null>(null);
  const [confirmMarkDefectiveAsset, setConfirmMarkDefectiveAsset] = useState<AssetRecord | null>(null);

  const { imageUrl, frameWidth, frameHeight, loading: imageLoading } = useFrameImage({
    videoId: selectedAsset?.videoId,
    frameNumber: selectedAsset?.frameNumber,
  });

  // Full-resolution frame, fetched lazily — only when the detail dialog
  // opens or the user expands the sidebar image. Falls back to the thumb
  // URL while the full payload is in flight.
  const [requestFullRes, setRequestFullRes] = useState(false);
  useEffect(() => { setRequestFullRes(false); }, [selectedAsset?.id]);
  const fullEnabled = showFullView || requestFullRes;
  const { imageUrl: fullImageUrl } = useFrameImage({
    videoId: fullEnabled ? selectedAsset?.videoId : undefined,
    frameNumber: fullEnabled ? selectedAsset?.frameNumber : undefined,
    variant: "full",
  });

  // Track which asset's image has actually finished loading.
  // Must be state (not a ref) so it triggers a re-render when updated.
  // Must be in an effect (not the render body) so it runs AFTER useFrameImage
  // has had a chance to process the new videoId/frameNumber — otherwise stale
  // imageUrl from the previous asset causes an immediate false-positive.
  const [loadedForAssetId, setLoadedForAssetId] = useState<string | null>(null);
  useEffect(() => {
    if (!imageLoading && selectedAsset) {
      if (imageUrl || !selectedAsset.videoId) {
        setLoadedForAssetId(selectedAsset.id);
      }
    }
  }, [imageLoading, imageUrl, selectedAsset]);

  // True when we're waiting for the new point's image — covers both the
  // useFrameImage loading state AND the 1-frame gap before it kicks in.
  // Assets without a videoId skip the loading state entirely.
  const pointImageLoading = selectedAsset != null
    && !!selectedAsset.videoId
    && (imageLoading || loadedForAssetId !== selectedAsset.id);

  const getCategoryDisplayName = useCallback((categoryId: string) => {
    if (!categoryId) return 'Unknown';
    return labelMapData?.categories?.[categoryId]?.display_name
      || labelMapData?.categories?.[categoryId]?.default_name
      || categoryId;
  }, [labelMapData]);

  const getAssetDisplayName = useCallback((asset: any) => {
    const label = labelMapData?.labels?.[asset.asset_id ?? asset.assetId];
    if (label) return label.group_id || label.display_name;
    return asset.asset_type || asset.type || 'Unknown';
  }, [labelMapData]);

  // Store label-map callbacks in refs so data loading has a stable identity.
  const getCategoryNameRef = useRef(getCategoryDisplayName);
  getCategoryNameRef.current = getCategoryDisplayName;
  const getAssetNameRef = useRef(getAssetDisplayName);
  getAssetNameRef.current = getAssetDisplayName;

  // ── Build filter params for server requests ──
  // categoryFilter stores the display name (from the Select), but the backend
  // expects category_id. Look it up via categoryOptions.
  const categoryOptionsRef = useRef<{id: string; name: string}[]>([]);

  const buildFilterParams = useCallback(() => {
    const params: Record<string, any> = {};
    if (selectedRouteId !== null) params.route_id = selectedRouteId;
    if (categoryFilter !== "all") {
      const match = categoryOptionsRef.current.find(c => c.name === categoryFilter);
      if (match) params.category = match.id;
    }
    if (conditionFilter !== "all") params.condition = conditionFilter;
    if (directionFilter !== "all") params.side = directionFilter;
    if (zoneFilter !== "all") params.zone = zoneFilter;
    if (selectedAssetType !== "all") params.asset_type = selectedAssetType;
    if (searchQuery.trim()) params.search = searchQuery.trim();
    return params;
  }, [selectedRouteId, categoryFilter, conditionFilter, directionFilter, zoneFilter, selectedAssetType, searchQuery]);

  // ── Data sources via React Query ──
  // All facet filters (route, category, condition, zone, side, type, search)
  // are sent to the server. Map clustering happens client-side via
  // supercluster, so /map-points fires once per filter combo and pan/zoom
  // never re-hits the network.
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

  // Server filter params (one source of truth for both map and table queries).
  const serverFilters = useMemo<Record<string, any>>(() => {
    const f: Record<string, any> = {};
    if (selectedRouteId !== null) f.route_id = selectedRouteId;
    if (categoryFilter !== "all") {
      const m = categoryOptionsRef.current.find(c => c.name === categoryFilter);
      if (m) f.category = m.id;
    }
    if (conditionFilter !== "all") f.condition = conditionFilter;
    if (directionFilter !== "all") f.side = directionFilter;
    if (zoneFilter !== "all") f.zone = zoneFilter;
    if (selectedAssetType !== "all") f.asset_type = selectedAssetType;
    if (debouncedSearchQ) f.search = debouncedSearchQ;
    return f;
  }, [selectedRouteId, categoryFilter, conditionFilter, directionFilter, zoneFilter, selectedAssetType, debouncedSearchQ]);

  const mapPointsQuery = useQuery({
    queryKey: qk.assets.mapPoints(serverFilters),
    queryFn: () => api.assets.getMasterMapPoints(serverFilters),
    staleTime: 60_000*5, // map points are relatively expensive to fetch and update, so cache aggressively
    gcTime: 30 * 60_000,  
    placeholderData: (prev) => prev,
  });
  const mapData: MapData = (mapPointsQuery.data as MapData | undefined) ?? EMPTY_MAP_DATA;

  // Reset table page whenever filters change so the user doesn't land on an
  // empty page-N of the new filter set. Also drop the current selection —
  // a filtered-out asset still pinned in the sidebar would desync the map
  // highlight, page-of jumping, and prev/next navigation.
  useEffect(() => {
    setTablePage(1);
    setSelectedAsset(null);
  }, [serverFilters]);

  // Jump the table to the page containing the given asset. Called explicitly
  // on user-initiated selections that may land off the current page (map
  // click, sidebar prev/next). NOT called for table row clicks — the row is
  // by definition already on the current page.
  // Tracks the in-flight token so rapid clicks discard stale resolutions.
  const jumpTokenRef = useRef(0);
  const jumpTablePageToAsset = useCallback(async (masterDisplayId: string) => {
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

  // Server-paginated table. Filters + sort + page round-trip; results are
  // already filtered/sorted/sliced — frontend renders as-is.
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
  const loadError = mapPointsQuery.isError;

  // Map view consumes the columnar `mapData` directly — we do NOT build
  // an AssetRecord per row. At 1M assets that allocation alone burned
  // ~150 MB of JS heap. AssetRecord is materialized on demand only when
  // the user actually selects an asset (see handleSelectFromMap below).

  // ── Table records: server-paginated page-of-results ──
  const tableAssets = useMemo<AssetRecord[]>(() => {
    const items: any[] = paginatedQuery.data?.items ?? [];
    return items.map((raw) => {
      const coords = (raw.canonical_location?.coordinates ?? []) as number[];
      const lat = coords[1] ?? 0;
      const lng = coords[0] ?? 0;
      const lastDate = raw.last_seen_date
        ? String(raw.last_seen_date).split('T')[0]
        : '';
      return {
        id: raw._id ? String(raw._id) : raw.master_display_id,
        assetDisplayId: raw.master_display_id,
        masterDisplayId: raw.master_display_id,
        assetId: raw.asset_id ?? '',
        assetType: getAssetNameRef.current({ asset_id: raw.asset_id, asset_type: raw.asset_type }) || raw.asset_type || '',
        assetCategory: getCategoryNameRef.current(raw.category_id ?? ''),
        defectId: raw.latest_defect_id ?? '',
        lat, lng,
        condition: raw.latest_condition ?? 'unknown',
        markerColor: conditionToColor(raw.latest_condition ?? 'unknown'),
        groupId: raw.group_id ?? undefined,
        routeId: raw.route_id,
        side: raw.side || 'Unknown',
        zone: raw.zone || 'Unknown',
        roadName: raw.route_name || '',
        roadSide: raw.road_side || undefined,
        lastSurveyDate: lastDate,
        issue: raw.issue || '',
        severity: 'Low',
        kind: 'point',
      } as AssetRecord;
    });
  }, [paginatedQuery.data]);
  tableAssetsRef.current = tableAssets;
  const tableTotalCount = paginatedQuery.data?.total_count ?? 0;
  const tableTotalPages = paginatedQuery.data?.total_pages ?? 1;

  // Server-aware prev/next availability for the sidebar nav buttons.
  // navigateAsset hits /master/neighbor regardless of page, so we only need
  // to disable at the absolute boundaries of the filtered set. When the
  // selected asset isn't on the current page, assume both directions are
  // available (server will no-op at true boundaries).
  const selectedIdxOnPage = selectedAsset
    ? tableAssets.findIndex(a => a.assetDisplayId === selectedAsset.assetDisplayId)
    : -1;
  const hasPrevAsset = !selectedAsset
    ? false
    : selectedIdxOnPage === -1
      ? true
      : !(tablePage === 1 && selectedIdxOnPage === 0);
  const hasNextAsset = !selectedAsset
    ? false
    : selectedIdxOnPage === -1
      ? true
      : !(tablePage === tableTotalPages && selectedIdxOnPage === tableAssets.length - 1);

  // ── Lazy detail loader ──
  // Fetches survey_history + full description/issue for one selected asset.
  // Results are cached in detailCacheRef so repeated clicks are instant.
  // For a line asset, the user's click on the polyline already supplied
  // frameNumber/box/lat/lng from the nearest keypoint. The lazy detail
  // loader returns latest_frame_number / latest_box (the anchor frame),
  // which would otherwise clobber that override. Strip those fields out of
  // the merge when the selection is a line.
  const mergeDetailIntoSelection = useCallback((
    prev: AssetRecord | null,
    masterDisplayId: string,
    detail: Partial<AssetRecord>,
  ): AssetRecord | null => {
    if (prev?.masterDisplayId !== masterDisplayId) return prev;
    if (prev.kind === "line") {
      // Map-click has already set frameNumber via the nearest-keypoint snap
      // — strip the detail's anchor frame so we don't clobber that choice.
      // Table-click leaves frameNumber undefined, so merge the anchor frame
      // in; otherwise useFrameImage never resolves and the loader hangs.
      if (prev.frameNumber != null) {
        const { frameNumber: _f, box: _b, ...rest } = detail;
        return { ...prev, ...rest } as AssetRecord;
      }
      return { ...prev, ...detail } as AssetRecord;
    }
    return { ...prev, ...detail } as AssetRecord;
  }, []);

  // Imperative cache-aware detail fetcher. Uses React Query's cache so repeat
  // calls (row click → mutation → row click) hit the cache, and a single
  // invalidation in the mark mutation flushes both this and any other
  // consumer (e.g. resolveMarkIds).
  const fetchAssetDetail = useCallback(async (masterDisplayId: string): Promise<Partial<AssetRecord> | null> => {
    return qc.fetchQuery({
      queryKey: qk.assets.detail(masterDisplayId),
      queryFn: async (): Promise<Partial<AssetRecord> | null> => {
        const resp = await api.assets.getMasterByDisplayId(masterDisplayId);
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
          issue: raw.issue || '',
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
      const detail = await fetchAssetDetail(asset.masterDisplayId);
      if (detail) {
        setSelectedAsset(prev =>
          mergeDetailIntoSelection(prev, asset.masterDisplayId!, detail)
        );
      }
    } catch {
      // silently ignore — user still sees slim data (type, location, condition, road)
    }
  }, [fetchAssetDetail, mergeDetailIntoSelection]);

  useEffect(() => {
    const typeParam = searchParams.get("type");
    const categoryParam = searchParams.get("category");
    const routeIdParam = searchParams.get("route_id");

    if (typeParam) {
      setSelectedAssetType(typeParam)
    };
    if (categoryParam) setCategoryFilter(categoryParam);
    const conditionParam = searchParams.get("condition");
    if (conditionParam && (conditionParam === "good" || conditionParam === "damaged")) setConditionFilter(conditionParam);
    if (routeIdParam) setSelectedRouteId(Number(routeIdParam));
  }, [searchParams]);

  // Navigate prev/next across the full server-filtered sorted set (not just
  // the current page). Server resolves the neighbor and returns its row;
  // we then fetch detail to populate the sidebar exactly like row click.
  const navigateAsset = useCallback(async (direction: 'prev' | 'next') => {
    if (!selectedAsset?.masterDisplayId) return;
    try {
      const sortParams = {
        filters: serverFilters,
        sort_key: sortKey ?? 'lastSurveyDate',
        sort_dir: sortDir,
      };
      const resp = await qc.fetchQuery({
        queryKey: qk.assets.neighbor(selectedAsset.masterDisplayId, direction, sortParams),
        queryFn: () => api.assets.getMasterNeighbor(selectedAsset.masterDisplayId!, direction, {
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
        roadName: raw.route_name || '',
        lastSurveyDate: raw.last_seen_date ? String(raw.last_seen_date).split('T')[0] : '',
        issue: raw.issue || '',
        severity: 'Low',
        kind: 'point',
      };
      setSelectedAsset(next);
      setSelectedSurveyIdx(0);
      setMarkerPopup(null);
      fetchAndMergeDetail(next);
      jumpTablePageToAsset(next.masterDisplayId!);
    } catch {
      // Neighbor fetch failed — silently no-op (user can keep navigating later).
    }
  }, [selectedAsset, sortKey, sortDir, serverFilters, fetchAndMergeDetail, qc, jumpTablePageToAsset]);

  const handleRowClick = useCallback((asset: AssetRecord) => {
    setSelectedAsset(asset);
    setSelectedSurveyIdx(0);
    setMarkerPopup(null);
    fetchAndMergeDetail(asset);
    // Show blur overlay while map repositions
    setMapTransitioning(true);
    if (mapTransitionTimer.current) clearTimeout(mapTransitionTimer.current);
    mapTransitionTimer.current = setTimeout(() => setMapTransitioning(false), 400);
  }, [fetchAndMergeDetail]);

  // Map-side click: receives a master_display_id (and optional line-snap
  // overrides) instead of a full AssetRecord. We materialize the record
  // from the columnar payload at the indexed position — once per click,
  // not once per row in the dataset.
  const handleSelectFromMap = useCallback((id: string, overrides?: { frameNumber?: number; box?: any; lat?: number; lng?: number }) => {
    const idx = mapData.idIndex.get(id);
    if (idx === undefined) return;
    const rec = buildAssetFromMapData(mapData, idx, {
      getAssetDisplayName: getAssetNameRef.current,
      getCategoryDisplayName: getCategoryNameRef.current,
    });
    if (overrides) {
      if (overrides.frameNumber !== undefined) rec.frameNumber = overrides.frameNumber;
      if (overrides.box) rec.box = overrides.box;
      if (overrides.lat !== undefined) rec.lat = overrides.lat;
      if (overrides.lng !== undefined) rec.lng = overrides.lng;
    }
    handleRowClick(rec);
    if (rec.masterDisplayId) jumpTablePageToAsset(rec.masterDisplayId);
  }, [mapData, handleRowClick, jumpTablePageToAsset]);

  const [exporting, setExporting] = useState(false);
  const handleExportExcel = async () => {
    setExporting(true);
    try {
      // Fetch all filtered assets for export via the fast master endpoint
      const filters = buildFilterParams();
      const resp = await api.assets.getMaster(filters);
      const allItems: any[] = resp?.items || [];
      const headers = [
        "Asset ID", "Asset Type", "Category", "Condition",
        "Latitude", "Longitude", "Route Name", "Route Side", "Asset Side", "Asset Zone", "Survey Date",
      ];
      const rows = allItems.map((a: any) => {
        const coords = a.location?.coordinates || a.canonical_location?.coordinates || [];
        const condition = a.condition || a.latest_condition || 'unknown';
        const lastDate = a.last_seen_date ? String(a.last_seen_date).split('T')[0] : a.created_at?.split?.('T')?.[0] || '—';
        return [
          a.master_display_id, getAssetDisplayName(a), getCategoryDisplayName(a.category_id || ''), capitalize(displayCondition(condition)),
          coords[1] || 0, coords[0] || 0, a.route_name || '', a.road_side ?? "—", capitalize(a.side || 'Unknown'), capitalize(a.zone || 'Unknown'), lastDate,
        ];
      });
      exportToExcel({
        filename: "Asset_Library_Report.xlsx",
        sheetName: "Assets",
        title: "RoadSight AI - Asset Library Report",
        subtitle: `Generated: ${new Date().toLocaleDateString()} | ${allItems.length} assets`,
        headers,
        rows,
      });
      toast.success("Asset report exported as Excel");
    } catch (err: any) {
      toast.error("Failed to export: " + (err?.message || "Unknown error"));
    } finally {
      setExporting(false);
    }
  };

  // ── Mark as Good (defective → good) ──
  const handleMarkGood = useCallback((asset: AssetRecord) => {
    if (user?.role === "Viewer") {
      toast.error("You do not have permission to mark assets as good.");
      return;
    }
    setConfirmMarkGoodAsset(asset);
  }, [user]);

  // Resolve the mongo _id + surveyId needed by the mark endpoints. In-memory
  // assets only carry master_display_id; full IDs come from the detail cache
  // (populated on row/marker click) or a fresh /master/<id> fetch.
  const resolveMarkIds = useCallback(async (asset: AssetRecord): Promise<{ mongoId: string | null; surveyId: string | undefined }> => {
    if (asset.id && asset.id !== asset.masterDisplayId) {
      return { mongoId: asset.id, surveyId: asset.surveyId };
    }
    if (!asset.masterDisplayId) return { mongoId: null, surveyId: undefined };
    try {
      const detail = await fetchAssetDetail(asset.masterDisplayId);
      if (!detail) return { mongoId: null, surveyId: undefined };
      return { mongoId: detail.id ?? null, surveyId: detail.surveyId };
    } catch {
      return { mongoId: null, surveyId: undefined };
    }
  }, [fetchAssetDetail]);

  // Shared optimistic-update helper for the mark-condition mutations.
  // Flips a single asset's condition in every active /map-points payload
  // (filter combos may have multiple cached entries) so the marker recolors
  // immediately. The paginated table is invalidated separately in onSuccess.
  // Works on the columnar MapData shape — `withConditionPatch` clones only
  // the `conditions` array (≈8 MB at 1M, vs. recreating row objects).
  const optimisticallySetCondition = useCallback((masterDisplayId: string, condition: string) => {
    const snapshots: Array<{ key: any; data: MapData | undefined }> = [];
    const queries = qc.getQueriesData<MapData>({ queryKey: ["assets", "map"] });
    for (const [key, data] of queries) {
      snapshots.push({ key, data });
      if (!data) continue;
      qc.setQueryData<MapData>(key, withConditionPatch(data, masterDisplayId, condition));
    }
    return { snapshots };
  }, [qc]);

  const rollbackMapSnapshots = (snapshots: Array<{ key: any; data: any }>) => {
    for (const { key, data } of snapshots) qc.setQueryData(key, data);
  };

  const markGoodMutation = useMutation({
    mutationFn: (vars: { mongoId: string; modifier: any; masterDisplayId: string }) =>
      api.assets.markAsGood(vars.mongoId, vars.modifier),
    onMutate: async ({ masterDisplayId }) => {
      await qc.cancelQueries({ queryKey: ["assets", "map"] });
      return optimisticallySetCondition(masterDisplayId, "good");
    },
    onError: (_err, _vars, ctx) => {
      if (ctx) rollbackMapSnapshots(ctx.snapshots);
    },
    onSuccess: (_data, { masterDisplayId }) => {
      qc.invalidateQueries({ queryKey: qk.assets.detail(masterDisplayId) });
      // Refetch map + paginated so server truth replaces optimistic state.
      qc.invalidateQueries({ queryKey: ["assets", "map"] });
      qc.invalidateQueries({ queryKey: ["assets", "paginated"] });
      // Position-dependent caches: condition flip can shift a row's place
      // in the sort order (under condition filters) and adds a log entry.
      qc.invalidateQueries({ queryKey: ["assets", "pageOf"] });
      qc.invalidateQueries({ queryKey: ["assets", "neighbor"] });
      qc.invalidateQueries({ queryKey: ["assets", "conditionLogs"] });
    },
  });

  const markDefectiveMutation = useMutation({
    mutationFn: (vars: { mongoId: string; modifier: any; masterDisplayId: string }) =>
      api.assets.unmarkGood(vars.mongoId, vars.modifier),
    onMutate: async ({ masterDisplayId }) => {
      await qc.cancelQueries({ queryKey: ["assets", "map"] });
      return optimisticallySetCondition(masterDisplayId, "damaged");
    },
    onError: (_err, _vars, ctx) => {
      if (ctx) rollbackMapSnapshots(ctx.snapshots);
    },
    onSuccess: (_data, { masterDisplayId }) => {
      qc.invalidateQueries({ queryKey: qk.assets.detail(masterDisplayId) });
      qc.invalidateQueries({ queryKey: ["assets", "map"] });
      qc.invalidateQueries({ queryKey: ["assets", "paginated"] });
      qc.invalidateQueries({ queryKey: ["assets", "pageOf"] });
      qc.invalidateQueries({ queryKey: ["assets", "neighbor"] });
      qc.invalidateQueries({ queryKey: ["assets", "conditionLogs"] });
    },
  });

  const handleConfirmMarkGood = useCallback(async () => {
    const asset = confirmMarkGoodAsset;
    if (!asset) return;
    setConfirmMarkGoodAsset(null);

    const assetKey = asset.assetDisplayId ?? asset.id ?? "";
    const surveyorName = user ? `${user.first_name} ${user.last_name}`.trim() || user.email : "Unknown";
    const surveyorId = user?.id ?? "";

    setMarkingSaving((prev) => new Set(prev).add(assetKey));
    try {
      const { mongoId, surveyId } = await resolveMarkIds(asset);
      if (!mongoId || !asset.masterDisplayId) { toast.error("Cannot update asset: missing ID"); return; }
      await markGoodMutation.mutateAsync({
        mongoId,
        modifier: { name: surveyorName, user_id: surveyorId, survey_id: surveyId },
        masterDisplayId: asset.masterDisplayId,
      });
      toast.success(`Asset ${asset.assetDisplayId} marked as good`);
      setSelectedAsset(prev => prev?.masterDisplayId === asset.masterDisplayId
        ? { ...prev, condition: "good", markerColor: conditionToColor("good") }
        : prev);
    } catch (err: any) {
      toast.error(err?.message || "Failed to mark asset as good");
    } finally {
      setMarkingSaving((prev) => { const s = new Set(prev); s.delete(assetKey); return s; });
    }
  }, [confirmMarkGoodAsset, user, resolveMarkIds, markGoodMutation]);

  // ── Mark as Defective (good → defective) ──
  const handleMarkDefective = useCallback((asset: AssetRecord) => {
    if (user?.role === "Viewer") {
      toast.error("You do not have permission to mark assets as defective.");
      return;
    }
    setConfirmMarkDefectiveAsset(asset);
  }, [user]);

  const handleConfirmMarkDefective = useCallback(async () => {
    const asset = confirmMarkDefectiveAsset;
    if (!asset) return;
    setConfirmMarkDefectiveAsset(null);

    const assetKey = asset.assetDisplayId ?? asset.id ?? "";
    const surveyorName = user ? `${user.first_name} ${user.last_name}`.trim() || user.email : "Unknown";
    const surveyorId = user?.id ?? "";

    setMarkingSaving((prev) => new Set(prev).add(assetKey));
    try {
      const { mongoId, surveyId } = await resolveMarkIds(asset);
      if (!mongoId || !asset.masterDisplayId) { toast.error("Cannot update asset: missing ID"); return; }
      await markDefectiveMutation.mutateAsync({
        mongoId,
        modifier: { name: surveyorName, user_id: surveyorId, survey_id: surveyId },
        masterDisplayId: asset.masterDisplayId,
      });
      toast.success(`Asset ${asset.assetDisplayId} marked as defective`);
      setSelectedAsset(prev => prev?.masterDisplayId === asset.masterDisplayId
        ? { ...prev, condition: "damaged", markerColor: conditionToColor("damaged") }
        : prev);
    } catch (err: any) {
      toast.error(err?.message || "Failed to mark asset as defective");
    } finally {
      setMarkingSaving((prev) => { const s = new Set(prev); s.delete(assetKey); return s; });
    }
  }, [confirmMarkDefectiveAsset, user, resolveMarkIds, markDefectiveMutation]);

  const assetColumns = useMemo(
    () => buildAssetColumns(markingSaving, handleMarkGood, handleMarkDefective),
    [markingSaving, handleMarkGood, handleMarkDefective]
  );

  const handleAssetTypeSelect = useCallback((assetType: string)=> {
    const assetGroup = Object.values(labelMapData?.labels || {}).find((label) => label.group_id === assetType);
    setAttributes(assetGroup?.attributes || {})
    setSelectedAssetType(assetType)
  }, [labelMapData])


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
    setAttributes({});
    setSelectedRouteId(null);
    setConditionFilter("all");
  }, []);

  // Eject branch must come after all hooks so hook order stays stable.
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
                  {selectedAsset ? (
                    <BreadcrumbLink className="cursor-pointer" onClick={() => setSelectedAsset(null)}>Asset Library</BreadcrumbLink>
                  ) : (
                    <BreadcrumbPage>Asset Library</BreadcrumbPage>
                  )}
                </BreadcrumbItem>
                {selectedAsset && (
                  <>
                    <BreadcrumbSeparator />
                    <BreadcrumbItem>
                      <BreadcrumbPage>{selectedAsset.roadName}</BreadcrumbPage>
                    </BreadcrumbItem>
                  </>
                )}
              </BreadcrumbList>
            </Breadcrumb>
            <div className="flex items-center gap-2">
              <Database className="h-4 w-4 text-primary" />
              <h1 className="text-sm font-bold text-foreground tracking-tight">Asset Library</h1>
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

      {/* Filter Strip */}
      <AssetFilterStrip
        filteredCount={tableTotalCount}
        countLabel="assets"
        directionFilter={directionFilter}
        onDirectionChange={setDirectionFilter}
        zoneFilter={zoneFilter}
        onZoneChange={setZoneFilter}
        categoryFilter={categoryFilter}
        conditionFilter={conditionFilter}
        onConditionChange={setConditionFilter}
        onCategoryChange={setCategoryFilter}
        selectedAssetType={selectedAssetType}
        onAssetTypesChange={handleAssetTypeSelect}
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
            selectedId={selectedAsset?.assetDisplayId ?? null}
            onSelect={handleSelectFromMap}
            getAssetDisplayName={getAssetDisplayName}
            onFetchLineKeypoints={async (id) => {
              const resp = await qc.fetchQuery({
                queryKey: qk.assets.keypoints(id),
                queryFn: () => api.assets.getMasterAssetKeypoints(id),
                staleTime: 5 * 60_000,
              });
              return resp?.keypoints ?? [];
            }}
            onFetchLineGeometry={async (id) => {
              const resp = await qc.fetchQuery({
                queryKey: qk.assets.geometry(id),
                queryFn: () => api.assets.getMasterAssetGeometry(id),
                staleTime: 5 * 60_000,
              });
              return resp?.geometry ?? null;
            }}
          />
          {/* Loading overlay — shown during initial data fetch or map transition. Sidebar handles its own frame-image loader. */}
          {(loading || mapTransitioning) && (
            <div className="absolute inset-0 bg-background/30 backdrop-blur-[2px] z-[1000] flex items-center justify-center transition-opacity duration-200">
              <div className="flex flex-col items-center gap-2 bg-background/80 rounded-xl px-5 py-3 shadow-lg">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                <span className="text-[10px] text-muted-foreground font-medium">
                  {loading ? "Loading assets…" : "Loading asset…"}
                </span>
              </div>
            </div>
          )}
        </div>

        <AssetDetailSidebar
          markerPopup={markerPopup}
          selectedAsset={selectedAsset}
          imageUrl={pointImageLoading ? null : imageUrl}
          fullImageUrl={fullImageUrl}
          onRequestFullImage={() => setRequestFullRes(true)}
          frameWidth={frameWidth}
          frameHeight={frameHeight}
          imageLoading={pointImageLoading}
          filteredAssets={tableAssets}
          hasPrev={hasPrevAsset}
          hasNext={hasNextAsset}
          onCloseAsset={() => setSelectedAsset(null)}
          getAssetDisplayName={getAssetDisplayName}
          onNavigate={navigateAsset}
          onFullView={async () => {
            if (selectedAsset) {
              setMarkerPopup({
                frameData: { gpx_point: { lat: selectedAsset.lat, lon: selectedAsset.lng } },
                trackTitle: selectedAsset.roadName,
                pointIndex: 0,
                totalPoints: 1,
              });
              setShowFullView(true);
              setFullViewLoading(true);
              try {
                const mongoId = selectedAsset.id ?? '';
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
          emptyLabel="asset"
        />
      </div>

      {/* Detailed View Dialog */}
      <Dialog open={showFullView} onOpenChange={async (open) => {
        if (!open) { setShowFullView(false); setConditionLogs([]); setFullViewLoading(false); }
      }}>
        <DialogHeader className="hidden">
          <DialogTitle>Detailed Asset View</DialogTitle>
          <DialogDescription>Full description of an asset</DialogDescription>
        </DialogHeader>
        <DialogContent className="max-w-[80vw] w-[70vw] h-[85vh] max-h-[90vh] overflow-auto p-0" style={{ zIndex: 9999 }}>
          {fullViewLoading && (
            <div className="flex items-center justify-center h-full w-full">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          )}
          {!fullViewLoading && selectedAsset && (() => {
            const assetFrameData = {
              videoId: selectedAsset.videoId || "",
              frame_number: selectedAsset.frameNumber ?? 0,
              baseUrl: "",
              width: frameWidth ?? 0,
              height: frameHeight ?? 0,
              image_data: fullImageUrl ?? imageUrl ?? undefined,
              timestamp: selectedAsset.lastSurveyDate,
              gpx_point: { lat: selectedAsset.lat, lon: selectedAsset.lng },
              detections: selectedAsset.box ? [
                {
                  class_name: selectedAsset.assetType,
                  confidence: 0.92,
                  bbox: {
                    x: selectedAsset.box.x,
                    y: selectedAsset.box.y,
                    width: selectedAsset.box.width,
                    height: selectedAsset.box.height,
                  },
                  condition: selectedAsset.condition,
                  category: selectedAsset.assetCategory,
                  category_id: selectedAsset.category_id,
                  asset_id: selectedAsset.assetId,
                },
              ] : [],
            };
            return (
              <div className="p-1">
                <FrameComparisonPopup
                  frameData={assetFrameData}
                  trackTitle={selectedAsset.roadName}
                  pointIndex={0}
                  totalPoints={1}
                  onClose={() => setShowFullView(false)}
                  loading={pointImageLoading}
                />
                <LinearAssetFrameSlider
                  asset={selectedAsset}
                  onFrameChange={(patch) => setSelectedAsset((prev) => prev ? { ...prev, ...patch } : prev)}
                />
              </div>
            );
          })()}

          {/* Description & Issue */}
          {!fullViewLoading && selectedAsset && (() => {
            const issue = selectedAsset.issue || null;
            const filteredDesc = selectedAsset.description
              ? Object.entries(selectedAsset.description).filter(([k]) => !DESCRIPTION_KEY_FILTER.has(k))
              : [];
            if (!issue && filteredDesc.length === 0) return null;
            // console.log("Asset Description:", selectedAsset.description);
            return (
              <div className="px-5 pt-4 pb-2 space-y-3">
                {/* {issue && (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5">
                    <AlertCircle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <p className="text-[9px] font-semibold uppercase tracking-wider text-amber-600 mb-0.5">Issue</p>
                      <p className="text-xs text-foreground leading-snug">{issue}</p>
                    </div>
                  </div>
                )} */}
                {filteredDesc.length > 0 && (
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
                )}
              </div>
            );
          })()}

          {/* Survey History Timeline */}
          {!fullViewLoading && selectedAsset && (() => {
            const condition = selectedAsset.condition?.toLowerCase() ?? '';
            const isDamaged = DAMAGED_CONDITIONS.has(condition);
            const history = selectedAsset.surveyHistory ?? [];
            const reversed = [...history].reverse();
            // conditionLogs are newest-first (from API sort)
            const isManuallyGood = condition === 'good' && conditionLogs.length > 0 && conditionLogs[0]?.action === 'marked_good';
            const latestMarkGood = isManuallyGood ? conditionLogs[0] : null;
            // console.log("Condition Logs:", conditionLogs);
            // console.log("Is Manually Marked Good?", isManuallyGood, "Latest Mark Good Log:", latestMarkGood);
            return (
              <div className="px-5 py-3">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Database className={cn("h-3.5 w-3.5", isDamaged ? "text-destructive" : "text-emerald-600")} />
                    <span className={cn("text-xs font-semibold", isDamaged ? "text-destructive" : "text-emerald-600")}>
                      {isDamaged? `Issue: ${capitalize(selectedAsset.issue)}`:`Condition: ${capitalize(displayCondition(selectedAsset.condition))}`}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground">
                      {selectedAsset.totalSurveysDetected ?? history.length} survey{(selectedAsset.totalSurveysDetected ?? history.length) !== 1 ? 's' : ''} detected
                    </span>
                  </div>
                </div>

                {/* Merged Timeline */}
                {(() => {
                  // Build unified timeline items newest-first
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
                  // console.log("Merged Timeline Items:", merged);
                  if (merged.length === 0) {
                    return <p className="text-xs text-muted-foreground italic">No survey history available.</p>;
                  }

                  // Track survey index for selection (only count survey items)
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

                          // Survey item
                          surveyCounter++;
                          const localSurveyIdx = surveyCounter;
                          const { entry } = item;
                          const entryCondition = entry.condition?.toLowerCase() ?? '';
                          const entryIsDamaged = DAMAGED_CONDITIONS.has(entryCondition);
                          const isLatest = item.rIdx === 0;
                          const isSelected = selectedSurveyIdx === localSurveyIdx;
                          const effectivelyGood = item.condition === 'good'
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
                                    <p className="font-semibold text-foreground">{selectedAsset.assetType}</p>
                                  </div>
                                  <div>
                                    <p className="text-muted-foreground text-[9px] uppercase tracking-wider">Side / Zone</p>
                                    <p className="font-semibold text-foreground capitalize">{selectedAsset.side} · {selectedAsset.zone}</p>
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

      {/* Confirm Mark as Defective Warning Dialog */}
      <Dialog open={!!confirmMarkDefectiveAsset} onOpenChange={(open) => !open && setConfirmMarkDefectiveAsset(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              Mark Asset as Defective?
            </DialogTitle>
            <DialogDescription>
              This will change the asset's condition from good to defective. This action is logged and visible to all team members.
            </DialogDescription>
          </DialogHeader>
          {confirmMarkDefectiveAsset && (
            <div className="flex flex-col gap-2 py-2">
              <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-xs space-y-2">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Asset ID</span>
                  <span className="font-mono font-semibold">{confirmMarkDefectiveAsset.assetDisplayId}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Type</span>
                  <span className="font-semibold">{confirmMarkDefectiveAsset.assetType}</span>
                </div>
                {confirmMarkDefectiveAsset.assetCategory && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Category</span>
                    <span className="font-semibold">{confirmMarkDefectiveAsset.assetCategory}</span>
                  </div>
                )}
                {confirmMarkDefectiveAsset.roadName && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Route</span>
                    <span className="font-semibold">{confirmMarkDefectiveAsset.roadName}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Current Condition</span>
                  <span className="font-semibold text-emerald-600">Good</span>
                </div>
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={() => setConfirmMarkDefectiveAsset(null)}>
              Cancel
            </Button>
            <Button size="sm" variant="destructive" onClick={handleConfirmMarkDefective}>
              <AlertTriangle className="h-3.5 w-3.5 mr-1" />
              Mark Defective
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Bottom Table — server-paginated against /master/paginated */}
      <AssetTable
        items={tableAssets}
        // Skeleton only on initial fetch. During refetches (page jump from
        // map click, sort/filter change) `placeholderData` keeps the prior
        // rows visible — otherwise the skeleton flashes and the row-level
        // selection highlight disappears mid-transition.
        loading={paginatedQuery.isLoading}
        loadError={paginatedQuery.isError}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        selectedId={selectedAsset?.assetDisplayId ?? null}
        onRowClick={handleRowClick}
        onRetry={() => paginatedQuery.refetch()}
        idField="assetDisplayId"
        onClearFilters={clearFilters}
        columns={assetColumns}
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
          setSelectedAsset(null);
        }}
        serverPage={tablePage}
        serverPageSize={tablePageSize}
        serverTotalPages={tableTotalPages}
        serverTotalCount={tableTotalCount}
        onPageChange={(p) => { setTablePage(p); setSelectedAsset(null); }}
        onPageSizeChange={(size) => { setTablePageSize(size); setTablePage(1); setSelectedAsset(null); }}
      />
    </div>
  );
}
