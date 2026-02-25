import { useState, useMemo, useEffect, useCallback } from "react";
import { useSearchParams, Link } from "react-router-dom";
import LeafletMapView from "@/components/LeafletMapView";
import FrameComparisonPopup from "@/components/FrameComparisonPopup";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api";
import { exportToExcel } from "@/lib/excelExport";
import { Download, AlertTriangle } from "lucide-react";
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

// Dummy issue types by category (until DB has real anomaly data)
const DUMMY_ISSUES: Record<string, string[]> = {
  "DIRECTIONAL SIGNAGE": ["Faded text/symbol", "Sign face damaged", "Post tilted >15°"],
  "ITS": ["Device offline", "Lens obscured", "Housing damaged"],
  "OTHER INFRASTRUCTURE ASSETS": ["Guardrail deformed", "Surface cracking >5mm", "Corrosion >30%"],
  "ROADWAY LIGHTING": ["Lamp not operational", "Pole leaning >5°", "Cable exposed"],
  "STRUCTURES": ["Concrete spalling", "Expansion joint damaged", "Crack width >2mm"],
  "BEAUTIFICATION": ["Tree dead/dying", "Planter damaged", "Fence broken"],
};

// ── Table columns for Anomaly Library ──────────────────────
const ANOMALY_COLUMNS: ColumnDef[] = [
  { key: "anomalyId", header: "Anomaly ID", className: "font-mono text-[11px] font-semibold py-1.5 px-1.5 whitespace-nowrap text-center", render: (a) => a.anomalyId },
  { key: "assetId", header: "Asset ID", className: "font-mono text-[11px] py-1.5 px-1.5 whitespace-nowrap text-center", render: (a) => a.assetId },
  { key: "assetType", header: "Asset Type", className: "text-[10px] leading-tight py-1.5 px-1.5 min-w-[180px] max-w-[220px] text-center", render: (a) => <span className="line-clamp-2">{a.assetType}</span> },
  { key: "category", header: "Category", className: "py-1.5 px-1.5 text-center", render: (a) => <CategoryBadge category={a.assetCategory} /> },
  { key: "coords", header: "Coordinates", className: "font-mono text-[10px] py-1.5 px-1.5 whitespace-nowrap text-center", render: (a) => `${a.lat.toFixed(4)}, ${a.lng.toFixed(4)}` },
  { key: "road", header: "Road", className: "text-[11px] py-1.5 px-1.5 whitespace-nowrap text-center", render: (a) => a.roadName },
  { key: "side", header: "Road Side", className: "text-[11px] py-1.5 px-1.5 text-center", render: (a) => a.side },
  { key: "zone", header: "Zone", className: "text-[11px] py-1.5 px-1.5 text-center", render: (a) => a.zone },
  { key: "survey", header: "Survey", className: "text-[11px] py-1.5 px-1.5 whitespace-nowrap text-center", render: (a) => a.lastSurveyDate },
  { key: "issue", header: "Issue", className: "py-1.5 px-1.5 min-w-[100px] text-center", render: (a) => (
    <span className="inline-flex items-center rounded-md bg-destructive/10 text-destructive px-1.5 py-0.5 text-[9px] font-semibold leading-tight line-clamp-2">{a.issue}</span>
  )},
];

export default function AnomalyLibrary() {
  const [searchParams] = useSearchParams();
  const [roads, setRoads] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const { data: labelMapData } = useLabelMap();

  const [selectedAssetTypes, setSelectedAssetTypes] = useState<string[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [directionFilter, setDirectionFilter] = useState<"all" | "LHS" | "RHS">("all");
  const [sideFilter, setSideFilter] = useState<"all" | "Shoulder" | "Median" | "Pavement" | "Overhead">("all");
  const [surveyYear, setSurveyYear] = useState<string>("2025");

  const [selectedAnomaly, setSelectedAnomaly] = useState<AssetRecord | null>(null);
  const [selectedSurveyIdx, setSelectedSurveyIdx] = useState(0);

  const [markerPopup, setMarkerPopup] = useState<{
    frameData: any;
    trackTitle: string;
    pointIndex: number;
    totalPoints: number;
  } | null>(null);
  const [showFullView, setShowFullView] = useState(false);

  // Dynamic anomaly data from API
  const [anomalies, setAnomalies] = useState<AssetRecord[]>([]);

  // ── Cached frame image via hook ──
  const { imageUrl, frameWidth, frameHeight, loading: imageLoading } = useFrameImage({
    videoId: selectedAnomaly?.videoId,
    frameNumber: selectedAnomaly?.frameNumber,
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

  const getDummyIssue = useCallback((categoryId: string, index: number) => {
    const catName = getCategoryDisplayName(categoryId);
    const issues = DUMMY_ISSUES[catName] || DUMMY_ISSUES[categoryId] || ["Damaged"];
    return issues[index % issues.length];
  }, [getCategoryDisplayName]);

  // ── Data loading ──
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setLoadError(false);
      const [roadsResp, masterResp] = await Promise.all([
        api.roads.list(),
        api.assets.getMaster({ condition: "damaged" }),
      ]);
      if (roadsResp?.items) setRoads(roadsResp.items);

      const routeMap: Record<number, string> = {};
      if (masterResp?.routes) {
        for (const r of masterResp.routes) {
          if (r.route_id != null) routeMap[r.route_id] = r.road_name || `Route ${r.route_id}`;
        }
      }

      if (masterResp?.items) {
        const mapped: AssetRecord[] = masterResp.items.map((asset: any, idx: number) => {
          const coords = asset.location?.coordinates || [];
          const lng = coords[0] || 0;
          const lat = coords[1] || 0;
          const categoryId = asset.category_id || '';
          const categoryName = getCategoryDisplayName(categoryId);
          const assetTypeName = getAssetDisplayName(asset);

          const rawVideoId = asset.video_id
            ? (typeof asset.video_id === 'object' && (asset.video_id as any)?.$oid
              ? (asset.video_id as any).$oid
              : asset.video_id)
            : asset.video_key;

          return {
            anomalyId: asset.anomaly_id || `ANM-${String(idx + 1).padStart(4, '0')}`,
            assetId: asset.asset_id || `AST-${idx}`,
            assetType: assetTypeName,
            assetCategory: categoryName,
            lat,
            lng,
            roadName: routeMap[asset.route_id] || `Route ${asset.route_id || '?'}`,
            side: asset.side || 'Shoulder',
            zone: asset.zone || 'Unknown',
            lastSurveyDate: asset.created_at?.split('T')[0] || asset.time?.split('T')[0] || '—',
            issue: asset.issue || getDummyIssue(categoryId, idx),
            severity: asset.severity || (idx % 3 === 0 ? 'High' : idx % 3 === 1 ? 'Medium' : 'Low'),
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
        setAnomalies(mapped);
      }
    } catch (err: any) {
      console.error("Failed to load data:", err);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [getCategoryDisplayName, getAssetDisplayName, getDummyIssue]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    const typeParam = searchParams.get("type");
    if (typeParam) setSelectedAssetTypes([typeParam]);
  }, [searchParams]);

  // ── Filtering ──
  const filteredAnomalies = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return anomalies.filter((a) => {
      if (categoryFilter !== "all" && a.assetCategory !== categoryFilter) return false;
      if (selectedAssetTypes.length > 0 && !selectedAssetTypes.includes(a.assetType)) return false;
      if (sideFilter !== "all" && a.side !== sideFilter) return false;
      if (q && !(
        a.anomalyId.toLowerCase().includes(q) ||
        a.assetId.toLowerCase().includes(q) ||
        a.assetType.toLowerCase().includes(q) ||
        a.roadName.toLowerCase().includes(q) ||
        a.issue.toLowerCase().includes(q)
      )) return false;
      return true;
    });
  }, [anomalies, categoryFilter, selectedAssetTypes, directionFilter, sideFilter, searchQuery]);

  // ── Navigation ──
  const navigateAnomaly = useCallback((direction: 'prev' | 'next') => {
    if (!selectedAnomaly) return;
    const idx = filteredAnomalies.findIndex(a => a.anomalyId === selectedAnomaly.anomalyId);
    if (idx === -1) return;
    const nextIdx = direction === 'prev' ? idx - 1 : idx + 1;
    if (nextIdx >= 0 && nextIdx < filteredAnomalies.length) {
      setSelectedAnomaly(filteredAnomalies[nextIdx]);
      setSelectedSurveyIdx(0);
      setMarkerPopup(null);
    }
  }, [selectedAnomaly, filteredAnomalies]);

  const mapSelectedRoadNames = useMemo(() => {
    const roadParam = searchParams.get("road");
    return roadParam ? [roadParam] : [];
  }, [searchParams]);

  const handleRowClick = useCallback((anomaly: AssetRecord) => {
    setSelectedAnomaly(anomaly);
    setSelectedSurveyIdx(0);
    setMarkerPopup(null);
  }, []);

  const handleExportExcel = () => {
    const headers = [
      "Anomaly ID", "Asset ID", "Asset Type", "Category", "Latitude", "Longitude",
      "Road Name", "Direction (LHS/RHS)", "Side", "Last Survey Date", "Issue Type",
    ];
    const rows = filteredAnomalies.map((a) => [
      a.anomalyId, a.assetId, a.assetType, a.assetCategory,
      a.lat, a.lng, a.roadName, a.side,
      a.zone, a.lastSurveyDate, a.issue,
    ]);
    exportToExcel({
      filename: "Anomaly_Library_Report.xlsx",
      sheetName: "Anomalies",
      title: "RoadSight AI — Anomaly Library Report",
      subtitle: `Generated: ${new Date().toLocaleDateString()} | ${filteredAnomalies.length} anomalies`,
      headers,
      rows,
    });
    toast.success("Anomaly report exported as Excel");
  };

  const assetTypeOptions = useMemo(() => {
    let source = anomalies;
    if (categoryFilter !== "all") source = source.filter(a => a.assetCategory === categoryFilter);
    return [...new Set(source.map((a) => a.assetType))].sort();
  }, [anomalies, categoryFilter]);

  const categoryOptions = useMemo(() => {
    return [...new Set(anomalies.map(a => a.assetCategory))].sort();
  }, [anomalies]);

  const selectedRoadName = searchParams.get("road");
  const selectedRoadAnomalies = useMemo(() => {
    if (!selectedRoadName) return [];
    return filteredAnomalies.filter(a => a.roadName === selectedRoadName);
  }, [filteredAnomalies, selectedRoadName]);

  const clearFilters = useCallback(() => {
    setCategoryFilter("all");
    setSelectedAssetTypes([]);
    setDirectionFilter("all");
    setSideFilter("all");
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
                  {selectedAnomaly ? (
                    <BreadcrumbLink className="cursor-pointer" onClick={() => setSelectedAnomaly(null)}>Anomaly Library</BreadcrumbLink>
                  ) : (
                    <BreadcrumbPage>Anomaly Library</BreadcrumbPage>
                  )}
                </BreadcrumbItem>
                {selectedAnomaly && (
                  <>
                    <BreadcrumbSeparator />
                    <BreadcrumbItem>
                      <BreadcrumbPage>{selectedAnomaly.roadName}</BreadcrumbPage>
                    </BreadcrumbItem>
                  </>
                )}
              </BreadcrumbList>
            </Breadcrumb>
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              <h1 className="text-sm font-bold text-foreground tracking-tight">Anomaly Library</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Select value={surveyYear} onValueChange={setSurveyYear}>
              <SelectTrigger className="h-7 w-[120px] text-[11px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="2025">Survey 2025</SelectItem>
                <SelectItem value="2026">Survey 2026</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1.5" onClick={handleExportExcel}>
              <Download className="h-3 w-3" />
              Export Report
            </Button>
          </div>
        </div>
      </div>

      {/* Filter Strip */}
      <AssetFilterStrip
        filteredCount={filteredAnomalies.length}
        countLabel="anomalies"
        directionFilter={directionFilter}
        onDirectionChange={setDirectionFilter}
        sideFilter={sideFilter}
        onSideChange={setSideFilter}
        categoryFilter={categoryFilter}
        onCategoryChange={setCategoryFilter}
        selectedAssetTypes={selectedAssetTypes}
        onAssetTypesChange={setSelectedAssetTypes}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        categoryOptions={categoryOptions}
        assetTypeOptions={assetTypeOptions}
        selectedRoadName={selectedRoadName}
        selectedRoadCount={selectedRoadAnomalies.length}
        onClearFilters={clearFilters}
      />

      {/* Map + Sidebar */}
      <div className="flex min-h-0" style={{ flex: "1 1 45%" }}>
        <div className="flex-1 relative min-w-0" style={{ zIndex: 0, isolation: 'isolate' }}>
          <LeafletMapView
            selectedRoadNames={mapSelectedRoadNames}
            roads={roads}
            selectedAssetTypes={selectedAssetTypes}
          />
        </div>

        <AssetDetailSidebar
          markerPopup={markerPopup}
          selectedAsset={selectedAnomaly}
          imageUrl={imageUrl}
          frameWidth={frameWidth}
          frameHeight={frameHeight}
          imageLoading={imageLoading}
          filteredAssets={filteredAnomalies}
          onCloseAsset={() => setSelectedAnomaly(null)}
          getAssetDisplayName={getAssetDisplayName}
          onNavigate={navigateAnomaly}
          onFullView={() => {
            if (selectedAnomaly) {
              setMarkerPopup({
                frameData: { gpx_point: { lat: selectedAnomaly.lat, lon: selectedAnomaly.lng } },
                trackTitle: selectedAnomaly.roadName,
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
        <DialogContent className="max-w-3xl w-[90vw] max-h-[90vh] overflow-auto p-0" style={{ zIndex: 9999 }}>
              {selectedAnomaly && (() => {
                const assetFrameData = {
                  videoId: selectedAnomaly.videoId || "",
                  frame_number: selectedAnomaly.frameNumber ?? 0,
                  baseUrl: "",
                  width: frameWidth ?? 0,
                  height: frameHeight ?? 0,
                  image_data: imageUrl ?? undefined,
                  timestamp: selectedAnomaly.lastSurveyDate,
                  gpx_point: { lat: selectedAnomaly.lat, lon: selectedAnomaly.lng },
                  detections: selectedAnomaly.box ? [
                    {
                      class_name: selectedAnomaly.assetType,
                      confidence: 0.92,
                      bbox: {
                        x: selectedAnomaly.box.x,
                        y: selectedAnomaly.box.y,
                        width: selectedAnomaly.box.width,
                        height: selectedAnomaly.box.height,
                      },
                      condition: selectedAnomaly.issue,
                      category: selectedAnomaly.assetCategory,
                    },
                  ] : [],
                };

                return (
                  <div className="p-1">
                    <FrameComparisonPopup
                      frameData={assetFrameData}
                      trackTitle={selectedAnomaly.roadName}
                      pointIndex={0}
                      totalPoints={1}
                      onClose={() => setShowFullView(false)}
                    />
                  </div>
                );
              })()}

              {/* Survey Information */}
              {selectedAnomaly && (() => {
                const baseDate = new Date(selectedAnomaly.lastSurveyDate);
                const surveyHistory = [
                  { surveyId: "SRV-2025-Q3-01", date: selectedAnomaly.lastSurveyDate, detected: true, issue: selectedAnomaly.issue },
                ];
                const reversed = [...surveyHistory].reverse();

                return (
                  <div className="px-5 py-3">
                    {(() => {
                      const latestSurvey = surveyHistory[surveyHistory.length - 1];
                      const isDetected = latestSurvey.detected;
                      return (
                        <div className="flex items-center gap-2 mb-3">
                          <AlertTriangle className={cn("h-3.5 w-3.5", isDetected ? "text-destructive" : "text-emerald-600")} />
                          <span className={cn("text-xs font-semibold", isDetected ? "text-destructive" : "text-emerald-600")}>
                            {isDetected ? `Anomaly Detected — ${latestSurvey.issue}` : `No Anomaly Detected`}
                          </span>
                          <span className="text-[9px] text-muted-foreground ml-auto">Asset: {selectedAnomaly.assetId} · {selectedAnomaly.anomalyId}</span>
                        </div>
                      );
                    })()}

                    <div className="relative">
                      <div className="absolute left-[9px] top-[6px] bottom-[6px] w-px bg-border z-0" />
                      <div className="space-y-2 relative z-10">
                        {reversed.map((survey) => {
                          const originalIdx = surveyHistory.indexOf(survey);
                          const isSelected = selectedSurveyIdx === originalIdx;
                          const borderColor = survey.detected ? "border-destructive/20" : "border-emerald-500/30";
                          const bgColor = survey.detected ? "bg-destructive/5" : "bg-emerald-500/5";
                          const statusLabel = survey.detected ? "Detected" : "Not Detected";
                          const statusClass = survey.detected ? "text-destructive" : "text-emerald-600";
                          const dotColor = survey.detected ? "bg-destructive" : "bg-emerald-500";

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
                                    <p className="font-mono font-semibold text-foreground">{survey.surveyId}</p>
                                  </div>
                                  <div>
                                    <p className="text-muted-foreground text-[9px] uppercase tracking-wider">Issue</p>
                                    <p className={cn("font-semibold", survey.detected ? "text-destructive" : "text-emerald-600")}>{survey.detected ? survey.issue : "—"}</p>
                                  </div>
                                  <div>
                                    <p className="text-muted-foreground text-[9px] uppercase tracking-wider">Asset Type</p>
                                    <p className="font-semibold text-foreground">{selectedAnomaly.assetType}</p>
                                  </div>
                                  <div>
                                    <p className="text-muted-foreground text-[9px] uppercase tracking-wider">Direction / Side</p>
                                    <p className="font-semibold text-foreground">{selectedAnomaly.side} · {selectedAnomaly.zone}</p>
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
        items={filteredAnomalies}
        loading={loading}
        loadError={loadError}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        selectedId={selectedAnomaly?.anomalyId ?? null}
        onRowClick={handleRowClick}
        onRetry={loadData}
        onClearFilters={clearFilters}
        columns={ANOMALY_COLUMNS}
      />
    </div>
  );
}
