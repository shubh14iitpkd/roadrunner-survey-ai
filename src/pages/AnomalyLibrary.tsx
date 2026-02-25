import { useState, useMemo, useEffect, useCallback } from "react";
import { useSearchParams, Link } from "react-router-dom";
import LeafletMapView from "@/components/LeafletMapView";
import FrameComparisonPopup from "@/components/FrameComparisonPopup";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { exportToExcel } from "@/lib/excelExport";
import {
  MapPin, X, Filter, Download, Eye, Maximize2,
  ChevronLeft, ChevronRight, AlertTriangle, Map as MapIcon,
  Search, RefreshCw, AlertCircle
} from "lucide-react";
import {
  Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { CategoryBadge, getCategoryDotColor } from "@/components/CategoryBadge";
import { useLabelMap } from "@/contexts/LabelMapContext";

// Dummy issue types by category (until DB has real anomaly data)
const DUMMY_ISSUES: Record<string, string[]> = {
  "DIRECTIONAL SIGNAGE": ["Faded text/symbol", "Sign face damaged", "Post tilted >15°"],
  "ITS": ["Device offline", "Lens obscured", "Housing damaged"],
  "OTHER INFRASTRUCTURE ASSETS": ["Guardrail deformed", "Surface cracking >5mm", "Corrosion >30%"],
  "ROADWAY LIGHTING": ["Lamp not operational", "Pole leaning >5°", "Cable exposed"],
  "STRUCTURES": ["Concrete spalling", "Expansion joint damaged", "Crack width >2mm"],
  "BEAUTIFICATION": ["Tree dead/dying", "Planter damaged", "Fence broken"],
};

// Shape used throughout this page
interface AnomalyRecord {
  anomalyId: string;
  assetId: string;
  assetType: string;
  assetCategory: string;
  lat: number;
  lng: number;
  roadName: string;
  side: string;
  zone?: string;
  lastSurveyDate: string;
  issue: string;
  severity: string;
  imageUrl?: string;
}

export default function GISView() {
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

  const [selectedAnomaly, setSelectedAnomaly] = useState<AnomalyRecord | null>(null);
  const [selectedSurveyIdx, setSelectedSurveyIdx] = useState(0);

  const [markerPopup, setMarkerPopup] = useState<{
    frameData: any;
    trackTitle: string;
    pointIndex: number;
    totalPoints: number;
  } | null>(null);
  const [showFullView, setShowFullView] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  // Dynamic anomaly data from API
  const [anomalies, setAnomalies] = useState<AnomalyRecord[]>([]);

  // Helpers using labelMap
  const getCategoryDisplayName = useCallback((categoryId: string) => {
    if (!categoryId) return 'Unknown';
    const fromMap = labelMapData?.categories?.[categoryId]?.display_name;
    if (fromMap) return fromMap;
    const defaultName = labelMapData?.categories?.[categoryId]?.default_name;
    if (defaultName) return defaultName;
    return categoryId;
  }, [labelMapData]);

  const getAssetDisplayName = useCallback((asset: any) => {
    const fromMap = labelMapData?.labels?.[asset.asset_id]?.display_name;
    if (fromMap) return fromMap;
    return asset.display_name || asset.asset_type || asset.type || 'Unknown';
  }, [labelMapData]);

  // Get a dummy issue for an asset based on its category
  const getDummyIssue = useCallback((categoryId: string, index: number) => {
    const catName = getCategoryDisplayName(categoryId);
    const issues = DUMMY_ISSUES[catName] || DUMMY_ISSUES[categoryId] || ["Damaged"];
    return issues[index % issues.length];
  }, [getCategoryDisplayName]);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setLoadError(false);
      const [roadsResp, masterResp] = await Promise.all([
        api.roads.list(),
        api.assets.getMaster({ condition: "damaged" }),
      ]);
      if (roadsResp?.items) setRoads(roadsResp.items);

      // Build a route_id -> road_name lookup from the response
      const routeMap: Record<number, string> = {};
      if (masterResp?.routes) {
        for (const r of masterResp.routes) {
          if (r.route_id != null) routeMap[r.route_id] = r.road_name || `Route ${r.route_id}`;
        }
      }

      // Map raw assets to AnomalyRecord shape
      if (masterResp?.items) {
        const mapped: AnomalyRecord[] = masterResp.items.map((asset: any, idx: number) => {
          const coords = asset.location?.coordinates || [];
          const lng = coords[0] || 0;
          const lat = coords[1] || 0;
          const categoryId = asset.category_id || '';
          const categoryName = getCategoryDisplayName(categoryId);
          const assetTypeName = getAssetDisplayName(asset);

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



  const totalPages = Math.ceil(filteredAnomalies.length / pageSize);
  const pagedAnomalies = filteredAnomalies.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => { setPage(1); }, [categoryFilter, selectedAssetTypes, directionFilter, sideFilter, searchQuery]);

  // Navigate prev/next anomaly in sidebar
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

  // Auto-scroll to selected anomaly row and jump page if needed
  useEffect(() => {
    if (!selectedAnomaly) return;
    const idx = filteredAnomalies.findIndex(a => a.anomalyId === selectedAnomaly.anomalyId);
    if (idx === -1) return;
    const targetPage = Math.floor(idx / pageSize) + 1;
    if (targetPage !== page) setPage(targetPage);
    // Wait for page change to render, then scroll
    setTimeout(() => {
      document.getElementById(`anomaly-row-${selectedAnomaly.anomalyId}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 50);
  }, [selectedAnomaly]);

  const mapSelectedRoadNames = useMemo(() => {
    const roadParam = searchParams.get("road");
    return roadParam ? [roadParam] : [];
  }, [searchParams]);

  const handleRowClick = useCallback((anomaly: AnomalyRecord) => {
    setSelectedAnomaly(anomaly);
    setSelectedSurveyIdx(0);
    setMarkerPopup(null); // clear map popup so sidebar shows anomaly detail
  }, []);

  // When map marker is clicked, find matching anomaly and select it
  const handleMapMarkerClick = useCallback((data: { frameData: any; trackTitle: string; pointIndex: number; totalPoints: number }) => {
    setMarkerPopup(data);
    // Find anomaly closest to the clicked point
    const clickedLat = data.frameData?.gpx_point?.lat;
    const clickedLon = data.frameData?.gpx_point?.lon;
    if (clickedLat != null && clickedLon != null) {
      let closest: AnomalyRecord | null = null;
      let minDist = Infinity;
      for (const a of filteredAnomalies) {
        const dist = Math.abs(a.lat - clickedLat) + Math.abs(a.lng - clickedLon);
        if (dist < minDist) { minDist = dist; closest = a; }
      }
      if (closest && minDist < 0.01) {
        setSelectedAnomaly(closest);
      }
    }
  }, [filteredAnomalies]);

  // Derive selectedLatLng from selectedAnomaly
  const selectedLatLng = useMemo(() => {
    if (selectedAnomaly) return { lat: selectedAnomaly.lat, lng: selectedAnomaly.lng };
    return null;
  }, [selectedAnomaly]);

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
    const types = [...new Set(source.map((a) => a.assetType))];
    return types.sort();
  }, [anomalies, categoryFilter]);

  // Dynamic category list from loaded data
  const categoryOptions = useMemo(() => {
    return [...new Set(anomalies.map(a => a.assetCategory))].sort();
  }, [anomalies]);

  const selectedRoadName = searchParams.get("road");
  const selectedRoadAnomalies = useMemo(() => {
    if (!selectedRoadName) return [];
    return filteredAnomalies.filter(a => a.roadName === selectedRoadName);
  }, [filteredAnomalies, selectedRoadName]);

  const activeFilterTags = useMemo(() => {
    const tags: string[] = [];
    if (categoryFilter !== "all") tags.push(categoryFilter);
    // direction shown in toggle, not in tags
    if (sideFilter !== "all") tags.push(sideFilter);
    if (selectedAssetTypes.length > 0) tags.push(selectedAssetTypes[0]);
    return tags;
  }, [categoryFilter, directionFilter, sideFilter, selectedAssetTypes]);

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

      {/* Single-line Filter Strip */}
      <div className="px-4 py-1.5 border-b border-border bg-gradient-to-r from-card to-muted/30 shrink-0 flex items-center gap-2 flex-nowrap min-w-0">
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="inline-flex items-center rounded-md bg-destructive/10 text-destructive px-1.5 py-0.5 text-[10px] font-bold tabular-nums border border-destructive/20">
            {filteredAnomalies.length}
          </span>
          <span className="text-[9px] text-muted-foreground">anomalies</span>
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
            onClick={() => setDirectionFilter(prev => prev === "LHS" ? "RHS" : prev === "RHS" ? "all" : "LHS")}
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
        {(() => {
          const sideOptions = ["all", "Shoulder", "Median", "Pavement", "Overhead"] as const;
          const sideLabels = { all: "All", Shoulder: "Shoulder", Median: "Median", Pavement: "Pavement", Overhead: "Overhead" };
          const activeIdx = sideOptions.indexOf(sideFilter);
          const stepWidth = 56;
          return (
            <div className="flex items-center shrink-0">
              <div className="relative flex rounded-full bg-muted/80 border border-border p-[3px] shrink-0 shadow-sm" style={{ width: sideOptions.length * stepWidth + 6 }}>
                <span
                  className="absolute top-[3px] rounded-full bg-primary shadow-md z-10 transition-all duration-300 ease-in-out"
                  style={{ left: 3 + activeIdx * stepWidth, width: stepWidth, height: 18 }}
                />
                {sideOptions.map((s) => (
                  <button
                    key={s}
                    onClick={() => setSideFilter(s)}
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
          );
        })()}

        <div className="h-5 w-px bg-border/60 shrink-0" />

        {/* Dropdowns */}
        <Select value={categoryFilter} onValueChange={(v) => { setCategoryFilter(v); setSelectedAssetTypes([]); }}>
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

        <Select value={selectedAssetTypes[0] || "all"} onValueChange={(v) => setSelectedAssetTypes(v === "all" ? [] : [v])}>
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

        {(categoryFilter !== "all" || selectedAssetTypes.length > 0 || directionFilter !== "all" || sideFilter !== "all" || searchQuery) && (
          <button
            onClick={() => { setCategoryFilter("all"); setSelectedAssetTypes([]); setDirectionFilter("all"); setSideFilter("all"); setSearchQuery(""); }}
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
            <span className="text-[10px] text-muted-foreground shrink-0">({selectedRoadAnomalies.length})</span>
          </>
        )}
      </div>

      {/* Map + Sidebar — compact */}
      <div className="flex min-h-0" style={{ flex: "1 1 45%" }}>
        <div className="flex-1 relative min-w-0" style={{ zIndex: 0, isolation: 'isolate' }}>
          <LeafletMapView
            selectedRoadNames={mapSelectedRoadNames}
            roads={roads}
            selectedAssetTypes={selectedAssetTypes}
          />
          {/* <LeafletMapView
            selectedRoadNames={mapSelectedRoadNames}
            roads={roads}
            selectedAssetTypes={selectedAssetTypes}
            selectedLatLng={selectedLatLng}
            onMarkerClick={handleMapMarkerClick}
          /> */}
        </div>

        {/* Detail Sidebar — compact, no scroll */}
        <div className={cn("border-l border-border bg-card flex flex-col shrink-0 transition-all duration-300", (markerPopup || selectedAnomaly) ? "w-96" : "w-72")}>
          {markerPopup ? (
            <div className="flex flex-col h-full">
              {/* Image fills available space with overlay details */}
              <div className="flex-1 relative min-h-0 bg-muted">
                {markerPopup.frameData?.raw_image_url || markerPopup.frameData?.image_data ? (
                  <img
                    src={markerPopup.frameData.raw_image_url || markerPopup.frameData.image_data}
                    alt="Road view"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="flex items-center justify-center h-full">
                    <Eye className="h-8 w-8 text-muted-foreground/30" />
                  </div>
                )}
                {/* Overlay: title at bottom of image */}
                <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 via-black/50 to-transparent p-2.5 pt-8">
                  <p className="text-[10px] text-white/70 uppercase tracking-wider font-semibold mb-0.5">Road</p>
                  <p className="text-xs text-white font-semibold truncate">{markerPopup.trackTitle}</p>
                </div>
                {/* Close button */}
                <button
                  className="absolute top-1.5 right-1.5 bg-black/50 hover:bg-black/70 text-white rounded-full p-1 transition-colors"
                  onClick={() => setMarkerPopup(null)}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
              {/* Compact info strip + button */}
              <div className="p-2 space-y-1.5 shrink-0">
                <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
                  {[
                    ["Frame", `${markerPopup.pointIndex + 1}/${markerPopup.totalPoints}`],
                    ["Detections", `${markerPopup.frameData?.detections?.length || 0}`],
                    ["Position", markerPopup.frameData?.gpx_point ? `${markerPopup.frameData.gpx_point.lat.toFixed(4)}, ${markerPopup.frameData.gpx_point.lon.toFixed(4)}` : '—'],
                  ].map(([label, val]) => (
                    <div key={label as string}>
                      <p className="text-[7px] text-muted-foreground uppercase tracking-wider">{label as string}</p>
                      <p className="text-[10px] font-mono font-medium text-foreground leading-tight">{val as string}</p>
                    </div>
                  ))}
                </div>
                <Button
                  variant="default"
                  size="sm"
                  className="w-full h-6 text-[10px] gap-1"
                  onClick={() => setShowFullView(true)}
                >
                  <Maximize2 className="h-3 w-3" />
                  Full View
                </Button>
              </div>
            </div>
          ) : selectedAnomaly ? (
            <div className="flex flex-col h-full">
              {/* Image area — takes most space */}
              <div className="flex-1 relative min-h-0 bg-muted">
                {selectedAnomaly.imageUrl ? (
                  <img src={selectedAnomaly.imageUrl} alt="Anomaly" className="w-full h-full object-cover" />
                ) : (
                  <div className="flex items-center justify-center h-full">
                    <Eye className="h-8 w-8 text-muted-foreground/30" />
                  </div>
                )}
                <span className="absolute top-1.5 left-1.5 inline-flex items-center rounded bg-destructive/90 text-destructive-foreground px-1 py-0.5 text-[9px] font-semibold">
                  {selectedAnomaly.issue}
                </span>
                <button
                  className="absolute top-1.5 right-1.5 bg-black/50 hover:bg-black/70 text-white rounded-full p-0.5 transition-colors"
                  onClick={() => setSelectedAnomaly(null)}
                >
                  <X className="h-3 w-3" />
                </button>
                {/* Prev/Next buttons moved below */}
                <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 via-black/50 to-transparent px-2.5 pb-1.5 pt-6 pointer-events-none">
                  <p className="text-[9px] text-white/60 uppercase tracking-wider font-semibold">Road</p>
                  <p className="text-[11px] text-white font-semibold truncate">{selectedAnomaly.roadName}</p>
                </div>
              </div>
              {/* Compact info strip */}
              <div className="px-1.5 py-1.5 space-y-1 shrink-0">
                <div className="flex items-center gap-x-2">
                  <div className="min-w-0">
                    <p className="text-[6px] text-muted-foreground uppercase">ID</p>
                    <p className="text-[9px] font-medium text-foreground leading-none truncate">{selectedAnomaly.anomalyId}</p>
                  </div>
                  <div className="min-w-0">
                    <p className="text-[6px] text-muted-foreground uppercase">Asset</p>
                    <p className="text-[9px] font-medium text-foreground leading-none truncate">{selectedAnomaly.assetId}</p>
                  </div>
                  <div className="min-w-0">
                    <p className="text-[6px] text-muted-foreground uppercase">Type</p>
                    <p className="text-[9px] font-medium text-foreground leading-none truncate">{selectedAnomaly.assetType}</p>
                  </div>
                  <div className="min-w-0">
                    <p className="text-[6px] text-muted-foreground uppercase">Road Side</p>
                    <p className="text-[9px] font-medium text-foreground leading-none truncate">{selectedAnomaly.side}</p>
                  </div>
                  <div className="min-w-0">
                    <p className="text-[6px] text-muted-foreground uppercase">Zone</p>
                    <p className="text-[9px] font-medium text-foreground leading-none truncate">{selectedAnomaly.zone}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-6 w-6 shrink-0"
                    disabled={filteredAnomalies.findIndex(a => a.anomalyId === selectedAnomaly.anomalyId) <= 0}
                    onClick={() => navigateAnomaly('prev')}
                  >
                    <ChevronLeft className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="default"
                    size="sm"
                    className="flex-1 h-6 text-[10px] gap-1 px-2"
                    onClick={() => {
                      setMarkerPopup({
                        frameData: { gpx_point: { lat: selectedAnomaly.lat, lon: selectedAnomaly.lng } },
                        trackTitle: selectedAnomaly.roadName,
                        pointIndex: 0,
                        totalPoints: 1,
                      });
                      setShowFullView(true);
                    }}
                  >
                    <Maximize2 className="h-3 w-3" />
                    Full View
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-6 w-6 shrink-0"
                    disabled={filteredAnomalies.findIndex(a => a.anomalyId === selectedAnomaly.anomalyId) >= filteredAnomalies.length - 1}
                    onClick={() => navigateAnomaly('next')}
                  >
                    <ChevronRight className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center p-4">
              <div className="text-center text-muted-foreground">
                <MapPin className="h-8 w-8 mx-auto mb-1.5 opacity-20" />
                <p className="text-[11px] font-medium">Select an anomaly</p>
                <p className="text-[9px] mt-0.5">Click a row or map point</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Full Road View Dialog — NO map, just road images + info */}
      <Dialog open={showFullView && !!markerPopup} onOpenChange={(open) => !open && setShowFullView(false)}>
        <DialogContent className="max-w-3xl w-[90vw] max-h-[90vh] overflow-auto p-0" style={{ zIndex: 9999 }}>
          {markerPopup && (
            <>
              {(() => {
                const baseDate = selectedAnomaly ? new Date(selectedAnomaly.lastSurveyDate) : new Date();
                const surveyHistory = selectedAnomaly ? [
                  { surveyId: "SRV-2025-Q3-01", date: selectedAnomaly.lastSurveyDate, detected: true, issue: selectedAnomaly.issue },
                  { surveyId: "SRV-2025-Q3-02", date: new Date(baseDate.getTime() + 14 * 86400000).toISOString().slice(0, 10), detected: true, issue: selectedAnomaly.issue },
                  { surveyId: "SRV-2025-Q4-01", date: new Date(baseDate.getTime() + 42 * 86400000).toISOString().slice(0, 10), detected: false, issue: selectedAnomaly.issue },
                ] : [];
                const currentSurvey = surveyHistory[selectedSurveyIdx] || surveyHistory[0];
                const isDetected = currentSurvey?.detected ?? true;

                // Build survey-specific frameData: when not detected, no detections
                const surveyFrameData = {
                  ...markerPopup.frameData,
                  detections: isDetected ? (markerPopup.frameData.detections || [
                    { class_name: selectedAnomaly?.issue || "Anomaly", confidence: 0.92, bbox: { x: 20, y: 30, width: 25, height: 20 }, condition: "Detected", category: "Overhead Infrastructure Assets" },
                  ]) : [],
                  timestamp: currentSurvey?.date || markerPopup.frameData.timestamp,
                };

                return (
                  <div className="p-1">
                    <FrameComparisonPopup
                      frameData={surveyFrameData}
                      trackTitle={markerPopup.trackTitle}
                      pointIndex={markerPopup.pointIndex}
                      totalPoints={markerPopup.totalPoints}
                      onClose={() => setShowFullView(false)}
                    />
                  </div>
                );
              })()}

              {/* Survey History Timeline */}
              {selectedAnomaly && (() => {
                const baseDate = new Date(selectedAnomaly.lastSurveyDate);
                const surveyHistory = [
                  { surveyId: "SRV-2025-Q3-01", date: selectedAnomaly.lastSurveyDate, detected: true, issue: selectedAnomaly.issue },
                  { surveyId: "SRV-2025-Q3-02", date: new Date(baseDate.getTime() + 14 * 86400000).toISOString().slice(0, 10), detected: true, issue: selectedAnomaly.issue },
                  { surveyId: "SRV-2025-Q4-01", date: new Date(baseDate.getTime() + 42 * 86400000).toISOString().slice(0, 10), detected: false, issue: selectedAnomaly.issue },
                ];
                // Latest on top
                const reversed = [...surveyHistory].reverse();

                return (
                  <div className="px-5 py-3">
                    {/* Header always reflects the LATEST survey status */}
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

                    {/* Timeline cards */}
                    <div className="relative">
                      {/* Vertical timeline line */}
                      <div className="absolute left-[9px] top-[6px] bottom-[6px] w-px bg-border z-0" />

                      <div className="space-y-2 relative z-10">
                        {reversed.map((survey, rIdx) => {
                          const originalIdx = surveyHistory.indexOf(survey);
                          const isSelected = selectedSurveyIdx === originalIdx;
                          const borderColor = survey.detected ? "border-destructive/20" : "border-emerald-500/30";
                          const bgColor = survey.detected ? "bg-destructive/5" : "bg-emerald-500/5";
                          const statusLabel = survey.detected ? "Detected" : "Not Detected";
                          const statusClass = survey.detected ? "text-destructive" : "text-emerald-600";
                          const dotColor = survey.detected ? "bg-destructive" : "bg-emerald-500";

                          return (
                            <div key={survey.surveyId} className="flex items-start gap-3">
                              {/* Timeline dot */}
                              <div className="flex flex-col items-center shrink-0 pt-4">
                                <div className={cn("h-[18px] w-[18px] rounded-full border-[3px] border-background shadow-sm", dotColor)} />
                              </div>

                              {/* Card */}
                              <button
                                onClick={() => setSelectedSurveyIdx(originalIdx)}
                                className={cn(
                                  "flex-1 text-left border rounded-lg px-5 py-3 transition-all",
                                  bgColor, borderColor,
                                  isSelected && "ring-2 ring-primary/30 shadow-sm"
                                )}
                              >
                                {isSelected && (
                                  <div className="text-[8px] font-semibold text-primary uppercase tracking-wider mb-1.5">▸ Currently Viewing</div>
                                )}
                                <div className="grid grid-cols-6 gap-3 text-xs">
                                  <div>
                                    <p className="text-muted-foreground text-[9px] uppercase tracking-wider">Survey</p>
                                    <p className="font-mono font-semibold text-foreground">{survey.surveyId}</p>
                                  </div>
                                  <div>
                                    <p className="text-muted-foreground text-[9px] uppercase tracking-wider">Anomaly</p>
                                    <p className={cn("font-semibold", statusClass)}>{statusLabel}</p>
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
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Bottom Table */}
      <div className="border-t border-border bg-card flex flex-col" style={{ flex: "1 1 45%", minHeight: 0 }}>
        <div className="gradient-table-line" />
        {/* Search bar */}
        <div className="px-3 py-1.5 border-b border-border/50 shrink-0">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
            <Input
              placeholder="Search by Asset ID, Road, Type, Issue..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-7 pl-7 text-[11px] bg-muted/30 border-border/50"
            />
          </div>
        </div>
        <div className="overflow-auto" style={{ flex: 1, minHeight: 0 }}>
          {loading ? (
            /* Loading Skeleton */
            <div className="p-3 space-y-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="flex gap-3 items-center">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-10" />
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-4 w-24" />
                </div>
              ))}
            </div>
          ) : loadError ? (
            /* Error State */
            <div className="flex-1 flex items-center justify-center p-8">
              <div className="text-center">
                <AlertCircle className="h-10 w-10 mx-auto mb-2 text-destructive/40" />
                <p className="text-sm font-medium text-foreground mb-1">Something went wrong</p>
                <p className="text-[11px] text-muted-foreground mb-3">Failed to load data. Please try again.</p>
                <Button variant="outline" size="sm" className="gap-1.5 text-[11px]" onClick={loadData}>
                  <RefreshCw className="h-3 w-3" />
                  Retry
                </Button>
              </div>
            </div>
          ) : filteredAnomalies.length === 0 ? (
            /* Empty State */
            <div className="flex-1 flex items-center justify-center p-8">
              <div className="text-center">
                <Search className="h-10 w-10 mx-auto mb-2 text-muted-foreground/30" />
                <p className="text-sm font-medium text-foreground mb-1">No anomalies found</p>
                <p className="text-[11px] text-muted-foreground mb-3">No results match the current filters or search.</p>
                <Button variant="outline" size="sm" className="gap-1.5 text-[11px]" onClick={() => { setCategoryFilter("all"); setSelectedAssetTypes([]); setDirectionFilter("all"); setSideFilter("all"); setSearchQuery(""); }}>
                  <X className="h-3 w-3" />
                  Reset Filters
                </Button>
              </div>
            </div>
          ) : (
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow className="border-b border-border hover:bg-transparent">
                {["Anomaly ID", "Asset ID", "Asset Type", "Category", "Coordinates", "Road", "Road Side", "Zone", "Survey", "Issue"].map(h => (
                  <TableHead key={h} className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground px-1.5 py-1 whitespace-nowrap text-center">{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagedAnomalies.map((a) => (
                <TableRow
                  id={`anomaly-row-${a.anomalyId}`}
                  key={a.anomalyId}
                  className={cn(
                    "cursor-pointer hover:bg-muted/40 border-b border-border/50",
                    selectedAnomaly?.anomalyId === a.anomalyId && "bg-primary/5"
                  )}
                  onClick={() => handleRowClick(a)}
                >
                  <TableCell className="font-mono text-[11px] font-semibold py-1.5 px-1.5 whitespace-nowrap text-center">{a.anomalyId}</TableCell>
                  <TableCell className="font-mono text-[11px] py-1.5 px-1.5 whitespace-nowrap text-center">{a.assetId}</TableCell>
                  <TableCell className="text-[10px] leading-tight py-1.5 px-1.5 min-w-[180px] max-w-[220px] text-center"><span className="line-clamp-2">{a.assetType}</span></TableCell>
                  <TableCell className="py-1.5 px-1.5 text-center">
                    <CategoryBadge category={a.assetCategory} />
                  </TableCell>
                  <TableCell className="font-mono text-[10px] py-1.5 px-1.5 whitespace-nowrap text-center">{a.lat.toFixed(4)}, {a.lng.toFixed(4)}</TableCell>
                  <TableCell className="text-[11px] py-1.5 px-1.5 whitespace-nowrap text-center">{a.roadName}</TableCell>
                  <TableCell className="text-[11px] py-1.5 px-1.5 text-center">{a.side}</TableCell>
                  <TableCell className="text-[11px] py-1.5 px-1.5 text-center">{a.zone}</TableCell>
                  <TableCell className="text-[11px] py-1.5 px-1.5 whitespace-nowrap text-center">{a.lastSurveyDate}</TableCell>
                  <TableCell className="py-1.5 px-1.5 min-w-[100px] text-center">
                    <span className="inline-flex items-center rounded-md bg-destructive/10 text-destructive px-1.5 py-0.5 text-[9px] font-semibold leading-tight line-clamp-2">{a.issue}</span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          )}
        </div>
        {filteredAnomalies.length > 0 && (
        <div className="flex items-center justify-between px-4 py-1 border-t border-border text-[11px] text-muted-foreground">
          <div className="flex items-center gap-2">
            <span className="tabular-nums">
              {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, filteredAnomalies.length)} of {filteredAnomalies.length}
            </span>
            <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setPage(1); }}>
              <SelectTrigger className="h-5 w-14 text-[10px] border-border bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-card z-50">
                {[10, 25, 50].map(n => <SelectItem key={n} value={String(n)} className="text-xs">{n}</SelectItem>)}
              </SelectContent>
            </Select>
            <span className="text-[9px] text-muted-foreground">per page</span>
          </div>
          <div className="flex gap-1">
            <Button variant="ghost" size="icon" className="h-6 w-6" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft className="h-3 w-3" />
            </Button>
            <Button variant="ghost" size="icon" className="h-6 w-6" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              <ChevronRight className="h-3 w-3" />
            </Button>
          </div>
        </div>
        )}
      </div>
    </div>
  );
}
