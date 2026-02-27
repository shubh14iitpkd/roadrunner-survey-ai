import { useState, useMemo, useEffect, useCallback } from "react";
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

// Dummy issue types by category (until DB has real defect data)
const DUMMY_ISSUES: Record<string, string[]> = {
  "DIRECTIONAL SIGNAGE": ["Faded text/symbol", "Sign face damaged", "Post tilted >15°"],
  "ITS": ["Device offline", "Lens obscured", "Housing damaged"],
  "OTHER INFRASTRUCTURE ASSETS": ["Guardrail deformed", "Surface cracking >5mm", "Corrosion >30%"],
  "ROADWAY LIGHTING": ["Lamp not operational", "Pole leaning >5°", "Cable exposed"],
  "STRUCTURES": ["Concrete spalling", "Expansion joint damaged", "Crack width >2mm"],
  "BEAUTIFICATION": ["Tree dead/dying", "Planter damaged", "Fence broken"],
};

// ── Table columns for Defect Library ──────────────────────
const DEFECT_COLUMNS: ColumnDef[] = [
  { key: "defectId", header: "Defect ID", className: "font-mono text-[11px] font-semibold py-1.5 px-1.5 whitespace-nowrap text-center", render: (a) => a.defectId },
  { key: "assetId", header: "Asset ID", className: "font-mono text-[11px] py-1.5 px-1.5 whitespace-nowrap text-center", render: (a) => a.id?.toUpperCase() },
  { key: "assetType", header: "Asset Type", className: "text-[10px] leading-tight py-1.5 px-1.5 min-w-[180px] max-w-[220px] text-center", render: (a) => <span className="line-clamp-2">{a.assetType}</span> },
  { key: "category", header: "Category", className: "py-1.5 px-1.5 text-center", render: (a) => <CategoryBadge category={a.assetCategory} categoryId={a.category_id} /> },
  { key: "coords", header: "Coordinates", className: "font-mono text-[10px] py-1.5 px-1.5 whitespace-nowrap text-center", render: (a) => `${a.lat.toFixed(4)}, ${a.lng.toFixed(4)}` },
  { key: "road", header: "Road", className: "text-[11px] py-1.5 px-1.5 whitespace-nowrap text-center", render: (a) => a.roadName },
  { key: "side", header: "Road Side", className: "text-[11px] py-1.5 px-1.5 text-center", render: (a) => a.side },
  { key: "zone", header: "Zone", className: "text-[11px] py-1.5 px-1.5 text-center", render: (a) => a.zone },
  { key: "survey", header: "Survey", className: "text-[11px] py-1.5 px-1.5 whitespace-nowrap text-center", render: (a) => a.lastSurveyDate },
  { key: "issue", header: "Issue", className: "py-1.5 px-1.5 min-w-[100px] text-center", render: (a) => (
    <span className="inline-flex items-center rounded-md bg-destructive/10 text-destructive px-1.5 py-0.5 text-[9px] font-semibold leading-tight line-clamp-2">{a.issue}</span>
  )},
];

export default function DefectLibrary() {
  const [searchParams] = useSearchParams();
  const [roads, setRoads] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const { data: labelMapData } = useLabelMap();

  const [selectedAssetTypes, setSelectedAssetTypes] = useState<string[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [directionFilter, setDirectionFilter] = useState<"all" | "LHS" | "RHS">("all");
  const [zoneFilter, setZoneFilter] = useState<"all" | "shoulder" | "median" | "pavement" | "overhead">("all");
  const [surveyYear, setSurveyYear] = useState<string>("2025");

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

          const mongoId = asset._id
            ? (typeof asset._id === 'object' && (asset._id as any)?.$oid ? (asset._id as any).$oid : String(asset._id))
            : `AST-${idx}`;

          const surveyId = asset.survey_id
            ? (typeof asset.survey_id === 'object' && (asset.survey_id as any)?.$oid ? (asset.survey_id as any).$oid : String(asset.survey_id))
            : `SUR-${idx}`;
          return {
            id: mongoId,
            defectId: asset.defect_id || `ANM-${String(idx + 1).padStart(4, '0')}`,
            assetId: asset.asset_id,
            category_id: asset.category_id,
            assetType: assetTypeName,
            assetCategory: categoryName,
            lat,
            lng,
            surveyId: surveyId,
            roadName: asset.route_name,
            side: asset.side || 'Shoulder',
            zone: asset.zone || 'Unknown',
            lastSurveyDate: asset.survey_date || asset.created_at?.split('T')[0] || '—',
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
        setDefects(mapped);
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
    const categoryParam = searchParams.get("category");
    if (typeParam) setSelectedAssetTypes([typeParam]);
    if (categoryParam) setCategoryFilter(categoryParam);
  }, [searchParams]);

  // ── Filtering ──
  const filteredDefects = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return defects.filter((a) => {
      if (categoryFilter !== "all" && a.assetCategory !== categoryFilter) return false;
      if (directionFilter !== "all" && a.side !== directionFilter) return false;
      if (selectedAssetTypes.length > 0 && !selectedAssetTypes.includes(a.assetType)) return false;
      if (zoneFilter !== "all" && a.zone !== zoneFilter) return false;
      if (q && !(
        a.defectId.toLowerCase().includes(q) ||
        a.assetId.toLowerCase().includes(q) ||
        a.assetType.toLowerCase().includes(q) ||
        a.roadName.toLowerCase().includes(q) ||
        a.issue.toLowerCase().includes(q)
      )) return false;
      return true;
    });
  }, [defects, categoryFilter, selectedAssetTypes, directionFilter, zoneFilter, searchQuery]);

  // ── Navigation ──
  const navigateDefects = useCallback((direction: 'prev' | 'next') => {
    if (!selectedDefect) return;
    const idx = filteredDefects.findIndex(a => a.defectId === selectedDefect.defectId);
    if (idx === -1) return;
    const nextIdx = direction === 'prev' ? idx - 1 : idx + 1;
    if (nextIdx >= 0 && nextIdx < filteredDefects.length) {
      setSelectedDefect(filteredDefects[nextIdx]);
      setSelectedSurveyIdx(0);
      setMarkerPopup(null);
    }
  }, [selectedDefect, filteredDefects]);



  const handleRowClick = useCallback((defect: AssetRecord) => {
    setSelectedDefect(defect);
    setSelectedSurveyIdx(0);
    setMarkerPopup(null);
  }, []);

  const handleExportExcel = () => {
    const headers = [
      "Defect ID", "Asset ID", "Asset Type", "Category", "Latitude", "Longitude",
      "Road Name", "Side", "Zone", "Last Survey Date", "Issue Type",
    ];
    const rows = filteredDefects.map((a) => [
      a.defectId, a.id?.toUpperCase(), a.assetType, a.assetCategory,
      a.lat, a.lng, a.roadName, a.side,
      a.zone, a.lastSurveyDate, a.issue,
    ]);
    exportToExcel({
      filename: `Defects Library Report.xlsx`,
      sheetName: "Defects",
      title: "RoadSight AI — Defect Library Report",
      subtitle: `Generated: ${new Date().toLocaleDateString()} | ${filteredDefects.length} defects`,
      headers,
      rows,
    });
    toast.success("Defects report exported as Excel");
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
            <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1.5" onClick={handleExportExcel}>
              <Download className="h-3 w-3" />
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
        selectedRoadName={selectedRoadName}
        selectedRoadCount={selectedRoadDefects.length}
        onClearFilters={clearFilters}
      />

      {/* Map + Sidebar */}
      <div className="flex min-h-0" style={{ flex: "1 1 45%" }}>
        <div className="flex-1 relative min-w-0" style={{ zIndex: 0, isolation: 'isolate' }}>
          <LibraryMapView
            assets={filteredDefects}
            selectedId={selectedDefect?.id ?? null}
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
          filteredAssets={filteredDefects}
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
        <DialogContent className="max-w-3xl w-[90vw] max-h-[90vh] overflow-auto p-0" style={{ zIndex: 9999 }}>
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

              {/* Survey Information */}
              {selectedDefect && (() => {
                const baseDate = new Date(selectedDefect.lastSurveyDate);
                const surveyHistory = [
                  { surveyId: selectedDefect.surveyId ?? "SRV-2025-Q3-01", date: selectedDefect.lastSurveyDate, detected: true, issue: selectedDefect.issue },
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
                            {isDetected ? `Defect Detected — ${latestSurvey.issue}` : `No Defect Detected`}
                          </span>
                          <span className="text-[9px] text-muted-foreground ml-auto">Asset: {selectedDefect.assetId} · {selectedDefect.defectId}</span>
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
                                    <p className="font-mono font-semibold text-foreground">{survey.surveyId?.slice(-8)}</p>
                                  </div>
                                  <div>
                                    <p className="text-muted-foreground text-[9px] uppercase tracking-wider">Issue</p>
                                    <p className={cn("font-semibold", survey.detected ? "text-destructive" : "text-emerald-600")}>{survey.detected ? survey.issue : "—"}</p>
                                  </div>
                                  <div>
                                    <p className="text-muted-foreground text-[9px] uppercase tracking-wider">Asset Type</p>
                                    <p className="font-semibold text-foreground">{selectedDefect.assetType}</p>
                                  </div>
                                  <div>
                                    <p className="text-muted-foreground text-[9px] uppercase tracking-wider">Side / Zone</p>
                                    <p className="font-semibold text-foreground">{selectedDefect.side} · {selectedDefect.zone}</p>
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
        items={filteredDefects}
        loading={loading}
        loadError={loadError}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        selectedId={selectedDefect?.defectId ?? null}
        onRowClick={handleRowClick}
        onRetry={loadData}
        onClearFilters={clearFilters}
        columns={DEFECT_COLUMNS}
      />
    </div>
  );
}
