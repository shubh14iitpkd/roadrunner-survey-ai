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
  { key: "id", header: "Asset ID", className: "font-mono text-[11px] py-1.5 px-1.5 whitespace-nowrap text-center", render: (a) => a.id?.toUpperCase() },
  { key: "assetType", header: "Asset Type", className: "text-[10px] leading-tight py-1.5 px-1.5 min-w-[180px] max-w-[220px] text-center", render: (a) => <span className="line-clamp-2">{a.assetType}</span> },
  { key: "category", header: "Category", className: "py-1.5 px-1.5 text-center", render: (a) => <CategoryBadge category={a.assetCategory} categoryId={a.category_id} /> },
  { key: "condition", header: "Condition", className: "py-1.5 px-1.5 text-center", render: (a) => (
    <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[9px] font-semibold leading-tight ${
      DAMAGED_CONDITIONS.has((a.condition ?? '').toLowerCase())
        ? 'bg-destructive/10 text-destructive'
        : a.condition?.toLowerCase() === 'good'
          ? 'bg-emerald-500/10 text-emerald-600'
          : 'bg-amber-500/10 text-amber-600'
    }`}>{a.condition ?? '—'}</span>
  )},
  { key: "coords", header: "Coordinates", className: "font-mono text-[10px] py-1.5 px-1.5 whitespace-nowrap text-center", render: (a) => `${a.lat.toFixed(4)}, ${a.lng.toFixed(4)}` },
  { key: "road", header: "Road", className: "text-[11px] py-1.5 px-1.5 whitespace-nowrap text-center", render: (a) => a.roadName },
  { key: "side", header: "Road Side", className: "text-[11px] py-1.5 px-1.5 text-center", render: (a) => a.side },
  { key: "zone", header: "Zone", className: "text-[11px] py-1.5 px-1.5 text-center", render: (a) => a.zone },
  { key: "survey", header: "Survey", className: "text-[11px] py-1.5 px-1.5 whitespace-nowrap text-center", render: (a) => a.lastSurveyDate },
];

export default function AssetLibrary() {
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const { data: labelMapData } = useLabelMap();

  const [selectedAssetTypes, setSelectedAssetTypes] = useState<string[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [directionFilter, setDirectionFilter] = useState<"all" | "LHS" | "RHS">("all");
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

      if (masterResp?.items) {
        const mapped: AssetRecord[] = masterResp.items.map((asset: any, idx: number) => {
          const coords = asset.location?.coordinates || [];
          const lng = coords[0] || 0;
          const lat = coords[1] || 0;
          const categoryId = asset.category_id || '';
          const categoryName = getCategoryDisplayName(categoryId);
          const assetTypeName = getAssetDisplayName(asset);
          const condition: string = asset.condition || 'unknown';

          const rawVideoId = asset.video_id
            ? (typeof asset.video_id === 'object' && (asset.video_id as any)?.$oid
              ? (asset.video_id as any).$oid
              : asset.video_id)
            : asset.video_key;

          const mongoId = asset._id
            ? (typeof asset._id === 'object' && (asset._id as any)?.$oid
              ? (asset._id as any).$oid
              : String(asset._id))
            : `AST-${idx}`;

          const surveyId = asset.survey_id
            ? (typeof asset.survey_id === 'object' && (asset.survey_id as any)?.$oid
              ? (asset.survey_id as any).$oid
              : String(asset.survey_id))
            : undefined;

          return {
            id: mongoId,
            // anomalyId is used as the unique row key — use defect_id if available, else mongo _id
            anomalyId: asset.defect_id || mongoId,
            assetId: asset.asset_id || '',
            category_id: asset.category_id,
            assetType: assetTypeName,
            assetCategory: categoryName,
            condition,
            markerColor: conditionToColor(condition),
            lat,
            lng,
            surveyId,
            roadName: asset.route_name,
            side: asset.side || 'Shoulder',
            zone: asset.zone || 'Unknown',
            lastSurveyDate: asset.survey_date || asset.created_at?.split('T')[0] || '—',
            issue: asset.issue || '',
            severity: asset.severity || 'Low',
            videoId: rawVideoId ? String(rawVideoId) : undefined,
            frameNumber: asset.frame_number,
            box: asset.box ? {
              x: asset.box.x,
              y: asset.box.y,
              width: asset.box.width ?? asset.box.w ?? 0,
              height: asset.box.height ?? asset.box.h ?? 0,
            } : undefined,
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
    if (typeParam) setSelectedAssetTypes([typeParam]);
    if (categoryParam) setCategoryFilter(categoryParam);
  }, [searchParams]);

  // ── Filtering ──
  const filteredAssets = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return assets.filter((a) => {
      if (categoryFilter !== "all" && a.assetCategory !== categoryFilter) return false;
      if (directionFilter !== "all" && a.side !== directionFilter) return false;
      if (selectedAssetTypes.length > 0 && !selectedAssetTypes.includes(a.assetType)) return false;
      if (zoneFilter !== "all" && a.zone !== zoneFilter) return false;
      if (q && !(
        a.defectId.toLowerCase().includes(q) ||
        (a.id ?? '').toLowerCase().includes(q) ||
        a.assetId.toLowerCase().includes(q) ||
        a.assetType.toLowerCase().includes(q) ||
        a.roadName.toLowerCase().includes(q)
      )) return false;
      return true;
    });
  }, [assets, categoryFilter, selectedAssetTypes, directionFilter, zoneFilter, searchQuery]);

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
      a.id?.toUpperCase(), a.assetType, a.assetCategory, a.condition,
      a.lat, a.lng, a.roadName, a.side, a.zone, a.lastSurveyDate,
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

  const selectedRoadName = searchParams.get("road");
  const selectedRoadAssets = useMemo(() => {
    if (!selectedRoadName) return [];
    return filteredAssets.filter(a => a.roadName === selectedRoadName);
  }, [filteredAssets, selectedRoadName]);

  const clearFilters = useCallback(() => {
    setCategoryFilter("all");
    setSelectedAssetTypes([]);
    setDirectionFilter("all");
    setZoneFilter("all");
    setSearchQuery("");
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
        onCategoryChange={setCategoryFilter}
        selectedAssetTypes={selectedAssetTypes}
        onAssetTypesChange={setSelectedAssetTypes}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        categoryOptions={categoryOptions}
        assetTypeOptions={assetTypeOptions}
        selectedRoadName={selectedRoadName}
        selectedRoadCount={selectedRoadAssets.length}
        onClearFilters={clearFilters}
      />

      {/* Map + Sidebar */}
      <div className="flex min-h-0" style={{ flex: "1 1 45%" }}>
        <div className="flex-1 relative min-w-0" style={{ zIndex: 0, isolation: 'isolate' }}>
          <LibraryMapView
            assets={filteredAssets}
            selectedId={selectedAsset?.id ?? null}
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
        <DialogContent className="max-w-3xl w-[90vw] max-h-[90vh] overflow-auto p-0" style={{ zIndex: 9999 }}>
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

          {/* Survey Information */}
          {selectedAsset && (() => {
            const condition = selectedAsset.condition?.toLowerCase() ?? '';
            const isDamaged = DAMAGED_CONDITIONS.has(condition);
            const isGood = condition === 'good';
            const surveyHistory = [
              { surveyId: selectedAsset.surveyId ?? "—", date: selectedAsset.lastSurveyDate, condition: selectedAsset.condition ?? 'unknown' },
            ];
            const reversed = [...surveyHistory].reverse();

            return (
              <div className="px-5 py-3">
                {(() => {
                  return (
                    <div className="flex items-center gap-2 mb-3">
                      <Database className={cn("h-3.5 w-3.5", isDamaged ? "text-destructive" : "text-emerald-600")} />
                      <span className={cn("text-xs font-semibold capitalize", isDamaged ? "text-destructive" : "text-emerald-600")}>
                        Condition: {selectedAsset.condition}
                      </span>
                      <span className="text-[9px] text-muted-foreground ml-auto">Asset: {selectedAsset.assetId} · {selectedAsset.id}</span>
                    </div>
                  );
                })()}

                <div className="relative">
                  <div className="absolute left-[9px] top-[6px] bottom-[6px] w-px bg-border z-0" />
                  <div className="space-y-2 relative z-10">
                    {reversed.map((survey) => {
                      const surveyCondition = survey.condition?.toLowerCase() ?? '';
                      const surveyIsDamaged = DAMAGED_CONDITIONS.has(surveyCondition);
                      const originalIdx = surveyHistory.indexOf(survey);
                      const isSelected = selectedSurveyIdx === originalIdx;
                      const borderColor = surveyIsDamaged ? "border-destructive/20" : "border-emerald-500/30";
                      const bgColor = surveyIsDamaged ? "bg-destructive/5" : "bg-emerald-500/5";
                      const dotColor = surveyIsDamaged ? "bg-destructive" : "bg-emerald-500";

                      return (
                        <div key={survey.surveyId} className="flex items-start gap-3">
                          <div className="flex flex-col items-center shrink-0 pt-4">
                            <div className={cn("h-[18px] w-[18px] rounded-full border-[3px] border-background shadow-sm", dotColor)} />
                          </div>
                          <button
                            onClick={() => setSelectedSurveyIdx(originalIdx)}
                            className={cn(
                              "flex-1 text-left border rounded-lg px-5 py-3 transition-all",
                              bgColor, borderColor,
                              isSelected && "ring-2 ring-primary/30 shadow-sm"
                            )}
                          >
                            <div className="grid grid-cols-5 gap-3 text-xs">
                              <div>
                                <p className="text-muted-foreground text-[9px] uppercase tracking-wider">Survey</p>
                                <p className="font-mono font-semibold text-foreground">{survey.surveyId?.slice(-8)}</p>
                              </div>
                              <div>
                                <p className="text-muted-foreground text-[9px] uppercase tracking-wider">Condition</p>
                                <p className={cn("font-semibold capitalize", surveyIsDamaged ? "text-destructive" : "text-emerald-600")}>{survey.condition}</p>
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
                                <p className="font-semibold text-foreground">{survey.date}</p>
                              </div>
                            </div>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
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
        selectedId={selectedAsset?.id ?? null}
        onRowClick={handleRowClick}
        onRetry={loadData}
        idField="id"
        onClearFilters={clearFilters}
        columns={ASSET_COLUMNS}
      />
    </div>
  );
}
