import { useState, useMemo, useEffect, useCallback } from "react";
import { useSearchParams, Link } from "react-router-dom";
import LibraryMapView from "@/components/asset-library/LibraryMapView";
import FrameComparisonPopup from "@/components/FrameComparisonPopup";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { exportToExcel } from "@/lib/excelExport";
import { Download, Database } from "lucide-react";
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
import capitalize from "@/helpers/capitalize";

// ── DAMAGED condition set (mirrors backend) ─────────────────
const DAMAGED_CONDITIONS = new Set([
  'overgrown', 'fadedpaint', 'dirty', 'missing', 'broken', 'bent', 'damaged',
]);

const conditionToColor = (condition: string): string => {
  const c = condition?.toLowerCase() ?? '';
  if (DAMAGED_CONDITIONS.has(c)) return '#ef4444'; // red-500
  if (c === 'good') return '#22c55e'; // green-500
  return '#f59e0b'; // amber for unknown
};

// ── Table columns for Asset Library (no Issue / Defect ID) ──
const ASSET_COLUMNS: ColumnDef[] = [
  { key: "assetDisplayId", header: "Asset ID", className: "font-mono text-[11px] py-1.5 px-1.5 whitespace-nowrap text-center", render: (a) => a.assetDisplayId },
  { key: "assetType", header: "Asset Type", className: "text-[10px] leading-tight py-1.5 px-1.5 min-w-[180px] max-w-[220px] text-center", render: (a) => <span className="line-clamp-2">{a.assetType}</span> },
  { key: "category", header: "Category", className: "py-1.5 px-1.5 text-center", render: (a) => <CategoryBadge category={a.assetCategory} categoryId={a.category_id} /> },
  {
    key: "condition", header: "Condition", className: "py-1.5 px-1.5 text-center", render: (a) => (
      <span className={`inline-flex capitalize items-center rounded-md px-1.5 py-0.5 text-[9px] font-semibold leading-tight ${DAMAGED_CONDITIONS.has((a.condition ?? '').toLowerCase())
        ? 'bg-destructive/10 text-destructive'
        : a.condition?.toLowerCase() === 'good'
          ? 'bg-emerald-500/10 text-emerald-600'
          : 'bg-amber-500/10 text-amber-600'
        }`}>{a.condition ?? '—'}</span>
    )
  },
  { key: "coords", header: "Coordinates", className: "font-mono text-[10px] py-1.5 px-1.5 whitespace-nowrap text-center", render: (a) => `${a.lat.toFixed(4)}, ${a.lng.toFixed(4)}` },
  { key: "road", header: "Road", className: "text-[11px] py-1.5 px-1.5 whitespace-nowrap text-center", render: (a) => a.roadName },
  { key: "side", header: "Road Side", className: "text-[11px] py-1.5 px-1.5 text-center", render: (a) => a.side },
  { key: "zone", header: "Zone", className: "text-[11px] capitalize py-1.5 px-1.5 text-center", render: (a) => a.zone },
  { key: "survey", header: "Survey", className: "text-[11px] py-1.5 px-1.5 whitespace-nowrap text-center", render: (a) => a.lastSurveyDate },
];

export default function AssetLibrary() {
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const { data: labelMapData } = useLabelMap();

  const [roads, setRoads] = useState<{ route_id: number; name: string }[]>([]);
  const [selectedRouteId, setSelectedRouteId] = useState<number | null>(null);
  const [selectedAssetTypes, setSelectedAssetTypes] = useState<string[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [directionFilter, setDirectionFilter] = useState<"all" | "LHS" | "RHS">("all");
  const [conditionFilter, setConditionFilter] = useState<"all" | "good"| "damaged">("all");
  const [zoneFilter, setZoneFilter] = useState<"all" | "shoulder" | "median" | "pavement" | "overhead">("all");

  const [selectedAsset, setSelectedAsset] = useState<AssetRecord | null>(null);
  const [selectedSurveyIdx, setSelectedSurveyIdx] = useState(0);

  const [markerPopup, setMarkerPopup] = useState<{
    frameData: any;
    trackTitle: string;
    pointIndex: number;
    totalPoints: number;
  } | null>(null);
  const [showFullView, setShowFullView] = useState(false);

  const [assets, setAssets] = useState<AssetRecord[]>([]);

  const { imageUrl, frameWidth, frameHeight, loading: imageLoading } = useFrameImage({
    videoId: selectedAsset?.videoId,
    frameNumber: selectedAsset?.frameNumber,
  });

  const getCategoryDisplayName = useCallback((categoryId: string) => {
    if (!categoryId) return 'Unknown';
    return labelMapData?.categories?.[categoryId]?.display_name
      || labelMapData?.categories?.[categoryId]?.default_name
      || categoryId;
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
        api.assets.getMaster({}), // no condition filter = all assets
      ]);

      if (roadsResp?.items) {
        setRoads(roadsResp.items.map((r: any) => ({ route_id: r.route_id, name: r.road_name })));
      }

      if (masterResp?.items) {
        const mapped: AssetRecord[] = masterResp.items.map((asset: any, idx: number) => {
          const coords = asset.location?.coordinates || asset.canonical_location?.coordinates || [];
          const lng = coords[0] || 0;
          const lat = coords[1] || 0;
          const categoryId = asset.category_id || '';
          const categoryName = getCategoryDisplayName(categoryId);
          const assetTypeName = getAssetDisplayName(asset);
          const condition: string = asset.condition || asset.latest_condition || 'unknown';

          const mongoId = asset._id
            ? (typeof asset._id === 'object' && (asset._id as any)?.$oid
              ? (asset._id as any).$oid
              : String(asset._id))
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

          return {
            id: mongoId,
            anomalyId: mongoId,
            assetId: asset.asset_id || '',
            category_id: categoryId,
            assetType: assetTypeName,
            assetCategory: categoryName,
            assetDisplayId: asset.master_display_id || '',
            masterDisplayId: asset.master_display_id || '',
            defectId: latestEntry?.defect_id ?? `DEF-${String(idx).padStart(6, '0')}`,
            condition,
            markerColor: conditionToColor(condition),
            lat,
            lng,
            surveyId,
            roadName: asset.route_name || '',
            routeId: asset.route_id != null ? Number(asset.route_id) : undefined,
            groupId: asset.group_id ?? undefined,
            side: asset.side || 'Unknown',
            zone: asset.zone || 'Unknown',
            lastSurveyDate: lastDate,
            issue: asset.issue || '',
            severity: asset.severity || 'Low',
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
        setAssets(mapped);
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
  const filteredAssets = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return assets.filter((a) => {
      if (categoryFilter !== "all" && a.assetCategory !== categoryFilter) return false;
      if (conditionFilter !== "all" && a.condition !== conditionFilter) return false;
      if (directionFilter !== "all" && a.side !== directionFilter) return false;
      if (selectedAssetTypes.length > 0 && !selectedAssetTypes.includes(a.assetType)) return false;
      if (zoneFilter !== "all" && a.zone !== zoneFilter) return false;
      if (selectedRouteId !== null && a.routeId !== selectedRouteId) return false;
      if (q && !(
        (a.defectId ?? '').toLowerCase().includes(q) ||
        (a.assetDisplayId ?? '').toLowerCase().includes(q) ||
        a.assetId.toLowerCase().includes(q) ||
        a.assetType.toLowerCase().includes(q) ||
        (a.roadName ?? '').toLowerCase().includes(q)
      )) return false;
      return true;
    });
  }, [assets, conditionFilter, categoryFilter, selectedAssetTypes, directionFilter, zoneFilter, selectedRouteId, searchQuery]);

  const navigateAsset = useCallback((direction: 'prev' | 'next') => {
    if (!selectedAsset) return;
    const idx = filteredAssets.findIndex(a => a.defectId === selectedAsset.defectId);
    if (idx === -1) return;
    const nextIdx = direction === 'prev' ? idx - 1 : idx + 1;
    if (nextIdx >= 0 && nextIdx < filteredAssets.length) {
      setSelectedAsset(filteredAssets[nextIdx]);
      setSelectedSurveyIdx(0);
      setMarkerPopup(null);
    }
  }, [selectedAsset, filteredAssets]);

  const handleRowClick = useCallback((asset: AssetRecord) => {
    setSelectedAsset(asset);
    setSelectedSurveyIdx(0);
    setMarkerPopup(null);
  }, []);

  const handleExportExcel = () => {
    const headers = [
      "Asset ID", "Asset Type", "Category", "Condition",
      "Latitude", "Longitude", "Road Name", "Side", "Zone", "Survey Date",
    ];
    const rows = filteredAssets.map((a) => [
      a.assetDisplayId, a.assetType, a.assetCategory, capitalize(a.condition),
      a.lat, a.lng, a.roadName, capitalize(a.side), capitalize(a.zone), a.lastSurveyDate,
    ]);
    exportToExcel({
      filename: "Asset_Library_Report.xlsx",
      sheetName: "Assets",
      title: "RoadSight AI — Asset Library Report",
      subtitle: `Generated: ${new Date().toLocaleDateString()} | ${filteredAssets.length} assets`,
      headers,
      rows,
    });
    toast.success("Asset report exported as Excel");
  };

  const assetTypeOptions = useMemo(() => {
    let source = assets;
    if (categoryFilter !== "all") source = source.filter(a => a.assetCategory === categoryFilter);
    return [...new Set(source.map((a) => a.assetType))].sort();
  }, [assets, categoryFilter]);

  const categoryOptions = useMemo(() => {
    const unique = [
      ...new Map(
        assets.map(a => [
          `${a.assetCategory}-${a.category_id}`,
          { name: a.assetCategory, id: a.category_id }
        ])
      ).values()
    ].sort((a, b) => a.name.localeCompare(b.name));
    return unique;
  }, [assets]);

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
            <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1.5" onClick={handleExportExcel}>
              <Download className="h-3 w-3" />
              Export Report
            </Button>
          </div>
        </div>
      </div>

      {/* Filter Strip */}
      <AssetFilterStrip
        filteredCount={filteredAssets.length}
        countLabel="assets"
        directionFilter={directionFilter}
        onDirectionChange={setDirectionFilter}
        zoneFilter={zoneFilter}
        onZoneChange={setZoneFilter}
        categoryFilter={categoryFilter}
        conditionFilter={conditionFilter}
        onConditionChange={setConditionFilter}
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
            assets={filteredAssets}
            selectedId={selectedAsset?.assetDisplayId ?? null}
            onSelect={handleRowClick}
          />
        </div>

        <AssetDetailSidebar
          markerPopup={markerPopup}
          selectedAsset={selectedAsset}
          imageUrl={imageUrl}
          frameWidth={frameWidth}
          frameHeight={frameHeight}
          imageLoading={imageLoading}
          filteredAssets={filteredAssets}
          onCloseAsset={() => setSelectedAsset(null)}
          getAssetDisplayName={getAssetDisplayName}
          onNavigate={navigateAsset}
          onFullView={() => {
            if (selectedAsset) {
              setMarkerPopup({
                frameData: { gpx_point: { lat: selectedAsset.lat, lon: selectedAsset.lng } },
                trackTitle: selectedAsset.roadName,
                pointIndex: 0,
                totalPoints: 1,
              });
              setShowFullView(true);
            }
          }}
          onCloseMarker={() => setMarkerPopup(null)}
          onShowFullView={() => setShowFullView(true)}
          emptyLabel="asset"
        />
      </div>

      {/* Full View Dialog */}
      <Dialog open={showFullView} onOpenChange={(open) => !open && setShowFullView(false)}>
        <DialogHeader className="hidden">
          <DialogTitle>Full Asset View</DialogTitle>
          <DialogDescription>Full description of an asset</DialogDescription>
        </DialogHeader>
        <DialogContent className="max-w-[80vw] w-[70vw] h-[85vh] max-h-[90vh] overflow-auto p-0" style={{ zIndex: 9999 }}>
          {selectedAsset && (() => {
            const assetFrameData = {
              videoId: selectedAsset.videoId || "",
              frame_number: selectedAsset.frameNumber ?? 0,
              baseUrl: "",
              width: frameWidth ?? 0,
              height: frameHeight ?? 0,
              image_data: imageUrl ?? undefined,
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
                />
              </div>
            );
          })()}

          {/* Survey History Timeline */}
          {selectedAsset && (() => {
            const condition = selectedAsset.condition?.toLowerCase() ?? '';
            const isDamaged = DAMAGED_CONDITIONS.has(condition);
            // Build timeline from surveyHistory (most recent first)
            const history = selectedAsset.surveyHistory ?? [];
            const reversed = [...history].reverse();

            return (
              <div className="px-5 py-3">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Database className={cn("h-3.5 w-3.5", isDamaged ? "text-destructive" : "text-emerald-600")} />
                    <span className={cn("text-xs font-semibold capitalize", isDamaged ? "text-destructive" : "text-emerald-600")}>
                      Condition: {selectedAsset.condition}
                    </span>
                  </div>
                  <span className="text-[10px] text-muted-foreground">
                    {selectedAsset.totalSurveysDetected ?? history.length} survey{(selectedAsset.totalSurveysDetected ?? history.length) !== 1 ? 's' : ''} detected
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
                        const entryIsDamaged = DAMAGED_CONDITIONS.has(entryCondition);
                        const isLatest = rIdx === 0;
                        const isSelected = selectedSurveyIdx === rIdx;
                        const borderColor = entryIsDamaged ? "border-destructive/20" : "border-emerald-500/30";
                        const bgColor = entryIsDamaged ? "bg-destructive/5" : "bg-emerald-500/5";
                        const dotColor = entryIsDamaged ? "bg-destructive" : "bg-emerald-500";

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
                                  <p className={cn("font-semibold capitalize", entryIsDamaged ? "text-destructive" : "text-emerald-600")}>{entry.condition || '—'}</p>
                                </div>
                                <div>
                                  <p className="text-muted-foreground text-[9px] uppercase tracking-wider">Asset Type</p>
                                  <p className="font-semibold text-foreground">{selectedAsset.assetType}</p>
                                </div>
                                <div>
                                  <p className="text-muted-foreground text-[9px] uppercase tracking-wider">Side / Zone</p>
                                  <p className="font-semibold text-foreground">{selectedAsset.side} · {selectedAsset.zone}</p>
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

      {/* Bottom Table */}
      <AssetTable
        items={filteredAssets}
        loading={loading}
        loadError={loadError}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        selectedId={selectedAsset?.assetDisplayId ?? null}
        onRowClick={handleRowClick}
        onRetry={loadData}
        idField="assetDisplayId"
        onClearFilters={clearFilters}
        columns={ASSET_COLUMNS}
      />
    </div>
  );
}
