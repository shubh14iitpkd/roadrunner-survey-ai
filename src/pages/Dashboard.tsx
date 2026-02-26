import { useState, useEffect, useCallback, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  TrendingUp, AlertTriangle, Package, Calendar,
  MapPin, Eye, ChevronLeft, ChevronRight, Map, ArrowUpRight, Activity, X, Download
} from "lucide-react";
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Sector,
} from "recharts";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { CategoryBadge, getCategoryColorCode } from "@/components/CategoryBadge";
import { useLabelMap } from "@/contexts/LabelMapContext";
import {
  exportAnomalyByAssetTypeReport,
  exportAnomalyByRoadReport,
  exportRoadWiseAssetTypeReport,
} from "@/lib/reportGenerator";

const CATEGORY_COLORS = [
  "hsl(217, 91%, 60%)",   // DIRECTIONAL SIGNAGE - blue
  "hsl(187, 85%, 43%)",   // ITS - cyan
  "hsl(152, 69%, 40%)",   // OTHER INFRASTRUCTURE ASSETS - emerald
  "hsl(38, 92%, 50%)",    // ROADWAY LIGHTING - amber
  "hsl(271, 81%, 56%)",   // STRUCTURES - purple
  "hsl(330, 70%, 55%)",   // BEAUTIFICATION - pink
];

// Active shape renderer for interactive donut
const renderActiveShape = (props: any) => {
  const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill, payload, value, percent } = props;
  return (
    <g>
      <Sector cx={cx} cy={cy} innerRadius={innerRadius - 3} outerRadius={outerRadius + 4} startAngle={startAngle} endAngle={endAngle} fill={fill} opacity={0.9} />
      <Sector cx={cx} cy={cy} innerRadius={outerRadius + 6} outerRadius={outerRadius + 9} startAngle={startAngle} endAngle={endAngle} fill={fill} opacity={0.4} />
      <text x={cx} y={cy - 10} textAnchor="middle" fill="currentColor" className="text-foreground" fontSize={22} fontWeight={700}>
        {value}
      </text>
      <text x={cx} y={cy + 8} textAnchor="middle" fill="currentColor" className="text-muted-foreground" fontSize={10}>
        {payload.category}
      </text>
      <text x={cx} y={cy + 22} textAnchor="middle" fill="currentColor" className="text-muted-foreground" fontSize={10}>
        {(percent * 100).toFixed(0)}%
      </text>
    </g>
  );
};

// Center text when no slice is active
const renderCenterText = (cx: number, cy: number, total: number) => (
  <g>
    <text x={cx} y={cy - 10} textAnchor="middle" fill="currentColor" className="text-foreground" fontSize={22} fontWeight={700}>
      {total}
    </text>
    <text x={cx} y={cy + 10} textAnchor="middle" fill="currentColor" className="text-muted-foreground" fontSize={10}>
      Total Assets
    </text>
  </g>
);

export default function Dashboard() {
  const [timePeriod, setTimePeriod] = useState<"week" | "month">("week");
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const { data: labelMapData } = useLabelMap();
  const [activeDonutIndex, setActiveDonutIndex] = useState<number | undefined>(undefined);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const onDonutEnter = useCallback((_: any, index: number) => setActiveDonutIndex(index), []);

  const [kpis, setKpis] = useState<any>({
    totalAssets: 0, totalAnomalies: 0, kmSurveyed: 0,
  });
  const [categoryChartData, setCategoryChartData] = useState<any[]>([]);
  const [topDefectRoads, setTopDefectRoads] = useState<any[]>([]);

  // Compute the selected category's donut index
  const selectedDonutIndex = useMemo(() => {
    if (!selectedCategory) return undefined;
    const idx = categoryChartData.findIndex(d => d.category === selectedCategory);
    return idx >= 0 ? idx : undefined;
  }, [selectedCategory, categoryChartData]);

  // Show selected slice when not hovering
  const effectiveDonutIndex = activeDonutIndex !== undefined ? activeDonutIndex : selectedDonutIndex;

  const [assetTypePage, setAssetTypePage] = useState(1);
  const [assetTypePageSize] = useState(10);

  // Asset type table data from API
  const [assetTypeTableData, setAssetTypeTableData] = useState<any>({ items: [], total: 0, page: 1, pages: 0 });
  const [tableLoading, setTableLoading] = useState(false);

  // Anomaly data from API
  const [defectByAsset, setDefectByAsset] = useState<any[]>([]);

  // Helper to get category display name from labelMap
  const getCategoryDisplayName = useCallback((item) => {
    const fromMap = labelMapData?.categories?.[item.category_id]?.display_name;
    if (fromMap) return fromMap;
    const defaultName = labelMapData?.categories?.[item.category_id]?.default_name;
    if (defaultName) return defaultName;
    return "unknown";
  }, [labelMapData]);

  // Helper to get asset display name from labelMap
  const getAssetDisplayName = useCallback((item: any) => {
    const fromMap = labelMapData?.labels?.[item.asset_id]?.display_name;
    if (fromMap) return fromMap;
    return item.display_name || item.type;
  }, [labelMapData]);

  // Resolved asset type rows from API data
  const assetTypeRows = useMemo(() => {
    return assetTypeTableData.items.map((item: any) => ({
      asset_id: item.asset_id,
      type: getAssetDisplayName(item),
      category: getCategoryDisplayName(item),
      category_id: item.category_id,
      count: item.count,
    }));
  }, [assetTypeTableData, getAssetDisplayName, getCategoryDisplayName]);

  const assetTypeTotalPages = assetTypeTableData.pages || 1;
  const pagedAssetTypes = assetTypeRows;

  // Reset page when category changes
  useEffect(() => { setAssetTypePage(1); }, [selectedCategoryId]);

  // Load main dashboard data
  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const [kpisResp, assetsByCategoryResp, topRoadsResp] = await Promise.all([
          api.dashboard.kpis(timePeriod),
          api.dashboard.assetsByCategory(),
          api.dashboard.topAnomalyRoads(),
        ]);
        if (kpisResp) setKpis(kpisResp);
        if (assetsByCategoryResp?.items && assetsByCategoryResp.items.length > 0) {
          // Resolve category_id to display names using labelMap
          setCategoryChartData(
            assetsByCategoryResp.items.map((item: any) => ({
              ...item,
              category: getCategoryDisplayName(item),
            }))
          );
        }

        if (topRoadsResp?.items && topRoadsResp.items.length > 0) {
          setTopDefectRoads(topRoadsResp.items);
        }
      } catch (err) {
        console.error("Failed to load dashboard data:", err);
      } finally {
        setLoading(false);
      }
    })();
  }, [timePeriod, labelMapData, getCategoryDisplayName]);

  // Load Asset Types Table Data (paginated from API, filtered by category)
  useEffect(() => {
    (async () => {
      try {
        setTableLoading(true);
        const resp = await api.dashboard.topAssetTypes(assetTypePage, assetTypePageSize, selectedCategoryId || undefined);
        if (resp) setAssetTypeTableData(resp);
      } catch (err) {
        console.error("Failed to load asset types table:", err);
      } finally {
        setTableLoading(false);
      }
    })();
  }, [assetTypePage, assetTypePageSize, selectedCategoryId]);

  // Load Anomaly by Asset Type data (top damaged asset types)
  useEffect(() => {
    (async () => {
      try {
        const resp = await api.dashboard.topAssetTypes(1, 10, selectedCategoryId || undefined, "damaged");
        if (resp?.items) {
          setDefectByAsset(
            resp.items.map((item: any) => ({
              asset_id: item.asset_id,
              type: getAssetDisplayName(item),
              category: getCategoryDisplayName(item),
              category_id: item.category_id,
              defects: item.count,
            }))
          );
        }
      } catch (err) {
        console.error("Failed to load anomaly data:", err);
      }
    })();
  }, [labelMapData, selectedCategoryId, getCategoryDisplayName, getAssetDisplayName]);
  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-accent/10 to-background">
      {/* Header */}
      <div className="border-b border-border bg-header-strip">
        <div className="px-6 py-2 flex items-end justify-between">
          <div>
            <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-[0.15em] mb-0.5">Overview</p>
            <h1 className="text-sm font-bold text-foreground tracking-tight">Network Dashboard</h1>
          </div>
          {/* <div className="flex items-center gap-2">
            <Calendar className="h-3 w-3 text-muted-foreground" />
            <Select value={timePeriod} onValueChange={(v) => setTimePeriod(v as "week" | "month")}>
              <SelectTrigger className="w-24 h-6 text-[10px] border-border bg-card/80 backdrop-blur-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-card z-50">
                <SelectItem value="week">Last 7 days</SelectItem>
                <SelectItem value="month">Last 30 days</SelectItem>
              </SelectContent>
            </Select>
          </div> */}
        </div>
      </div>

      <div className="px-8 py-6 space-y-5 bg-grid-subtle">
        {/* KPI Strip */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <KPICard
            label="Road Network"
            value={loading ? "..." : Number(kpis.kmSurveyed).toLocaleString("en-US", { maximumFractionDigits: 1 })}
            unit="km"
            icon={<Activity className="h-4 w-4" />}
            accent="primary"
            trend={{ value: 12, direction: "up" }}
            lastSurvey="12 Feb 2025"
          />
          <KPICard
            label="Total Assets"
            value={loading ? "..." : kpis.totalAssets.toLocaleString()}
            icon={<Package className="h-4 w-4" />}
            accent="secondary"
            trend={{ value: 5, direction: "up" }}
            lastSurvey="12 Feb 2025"
          />
          <KPICard
            label="Defects"
            value={loading ? "..." : kpis.totalAnomalies.toLocaleString()}
            icon={<AlertTriangle className="h-4 w-4" />}
            accent="destructive"
            trend={{ value: 8, direction: "down" }}
            lastSurvey="12 Feb 2025"
          />
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          {/* Donut */}
          <Card className="lg:col-span-2 p-0 border border-border bg-card overflow-hidden flex flex-col">
            <div className="px-5 pt-4 pb-1">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-[0.15em]">Asset Distribution</p>
              <p className="text-sm font-semibold text-foreground mt-0.5">By Category</p>
            </div>
            <div className="flex items-center justify-center px-5" style={{ height: 300 }}>
              <div className="relative" style={{ width: 300, height: 300 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      activeIndex={effectiveDonutIndex !== undefined ? effectiveDonutIndex : undefined}
                      activeShape={effectiveDonutIndex !== undefined ? renderActiveShape : undefined}
                      data={categoryChartData}
                      cx="50%"
                      cy="50%"
                      innerRadius={65}
                      outerRadius={95}
                      dataKey="count"
                      nameKey="category"
                      paddingAngle={2}
                      stroke="hsl(var(--card))"
                      strokeWidth={2}
                      onMouseEnter={onDonutEnter}
                      onMouseLeave={() => setActiveDonutIndex(undefined)}
                      onClick={(_, index) => {
                        const item = categoryChartData[index];
                        const cat = item?.category;
                        const catId = item?.category_id;
                        if (selectedCategory === cat) {
                          setSelectedCategory(null);
                          setSelectedCategoryId(null);
                        } else {
                          setSelectedCategory(cat);
                          setSelectedCategoryId(catId);
                        }
                      }}
                      style={{ cursor: 'pointer' }}
                    >
                      {categoryChartData.map((item, i) => (
                        <Cell key={i} fill={getCategoryColorCode(item.category_id)} />
                      ))}
                    </Pie>
                    {effectiveDonutIndex === undefined && (
                      <text x="50%" y="46%" textAnchor="middle" fill="currentColor" className="text-foreground" fontSize={22} fontWeight={700}>
                        {categoryChartData.reduce((sum, d) => sum + d.count, 0)}
                      </text>
                    )}
                    {effectiveDonutIndex === undefined && (
                      <text x="50%" y="56%" textAnchor="middle" fill="currentColor" className="text-muted-foreground" fontSize={10}>
                        Total Assets
                      </text>
                    )}
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
            {/* Legend — single column, 6 rows, evenly spaced to fill remaining space */}
            <div className="px-5 pb-2 flex-1 flex flex-col justify-evenly">
              {categoryChartData.map((d, i) => (
                <div
                  key={d.category}
                  className={cn(
                    "flex items-center gap-2 text-xs px-2 py-1.5 rounded-md transition-colors cursor-pointer",
                    selectedCategory === d.category ? "bg-primary/10 ring-1 ring-primary/30" : activeDonutIndex === i ? "bg-muted/80" : "hover:bg-muted/40"
                  )}
                  onMouseEnter={() => setActiveDonutIndex(i)}
                  onMouseLeave={() => setActiveDonutIndex(undefined)}
                  onClick={() => {
                    if (selectedCategory === d.category) {
                      setSelectedCategory(null);
                      setSelectedCategoryId(null);
                    } else {
                      setSelectedCategory(d.category);
                      setSelectedCategoryId(d.category_id);
                    }
                  }}
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: getCategoryColorCode(d.category_id) }}
                  />
                  <span className="text-foreground font-medium text-[11px]">{d.category}</span>
                  <span className="font-bold text-foreground ml-auto tabular-nums text-[11px]">{d.count}</span>
                </div>
              ))}
            </div>
            <div className="px-5 pb-3">
              <Button
                variant="outline"
                size="sm"
                className="w-full h-7 text-[11px] gap-1.5"
                onClick={() => navigate(selectedCategory ? `/asset-library?category=${encodeURIComponent(selectedCategory)}` : '/asset-library')}
              >
                <MapPin className="h-3 w-3" />
                {selectedCategory ? `View ${selectedCategory} on Map` : "View All on Map"}
                <ArrowUpRight className="h-3 w-3" />
              </Button>
            </div>
          </Card>

          {/* Top Asset Types — filtered by selected category */}
          <Card className="lg:col-span-3 p-0 border border-border bg-card overflow-hidden flex flex-col">
            <div className="px-5 pt-5 pb-3 flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest">Asset Types</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <p className="text-sm font-semibold text-foreground">
                    {selectedCategory ? selectedCategory : "All Categories"}
                  </p>
                  {selectedCategory && (
                    <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[10px] text-muted-foreground" onClick={() => { setSelectedCategory(null); setSelectedCategoryId(null); }}>
                      <X className="h-3 w-3 mr-0.5" /> Clear
                    </Button>
                  )}
                </div>
              </div>
              <span className="text-xs text-muted-foreground tabular-nums">
                {assetTypePage}/{assetTypeTotalPages || 1}
              </span>
            </div>
            <div className="gradient-table-line" />
            {/* Fixed height table container */}
            <div className="flex-1 overflow-auto" style={{ height: assetTypePageSize * 36 + 36 }}>
              <Table>
                <TableHeader className="top-0 z-10 bg-card">
                  <TableRow className="border-b border-border hover:bg-transparent">
                    <TableHead className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground w-10">#</TableHead>
                    <TableHead className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Type</TableHead>
                    <TableHead className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Category</TableHead>
                    <TableHead className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-right">Count</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagedAssetTypes.map((row: any, idx: number) => (
                    <TableRow key={row.asset_id || idx} className="hover:bg-muted/40 border-b border-border/50" style={{ height: 36 }}>
                      <TableCell className="text-xs text-muted-foreground tabular-nums py-2">
                        {(assetTypePage - 1) * assetTypePageSize + idx + 1}
                      </TableCell>
                      <TableCell className="text-xs font-medium py-2">{row.type}</TableCell>
                      <TableCell className="py-2">
                        <CategoryBadge category={row.category} categoryId={row.category_id}/>
                      </TableCell>
                      <TableCell className="text-right font-semibold text-xs tabular-nums py-2">{row.count}</TableCell>
                    </TableRow>
                  ))}
                  {/* Fill empty rows to keep consistent height
                  {pagedAssetTypes.length < assetTypePageSize && Array.from({ length: assetTypePageSize - pagedAssetTypes.length }).map((_, i) => (
                    <TableRow key={`empty-${i}`} className="border-b border-border/50" style={{ height: 36 }}>
                      <TableCell colSpan={4}>&nbsp;</TableCell>
                    </TableRow>
                  ))} */}
                </TableBody>
              </Table>
            </div>
            <div className="flex items-center justify-between px-4 py-2 border-t border-border">
              <span className="text-[10px] text-muted-foreground tabular-nums">
                {(assetTypePage - 1) * assetTypePageSize + 1}–{Math.min(assetTypePage * assetTypePageSize, assetTypeTableData.total)} of {assetTypeTableData.total}
              </span>
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-muted-foreground tabular-nums mr-1">{assetTypePage}/{assetTypeTotalPages || 1}</span>
                <Button variant="ghost" size="icon" className="h-7 w-7" disabled={assetTypePage <= 1} onClick={() => setAssetTypePage(p => p - 1)}>
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7" disabled={assetTypePage >= assetTypeTotalPages} onClick={() => setAssetTypePage(p => p + 1)}>
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </Card>
        </div>

        {/* Defects by Asset Type */}
        <Card className="p-0 border border-border bg-card overflow-hidden">
          <div className="px-5 pt-5 pb-3 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-destructive/10">
              <AlertTriangle className="h-4 w-4 text-destructive" />
            </div>
            <div className="flex-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest">Defects</p>
              <p className="text-sm font-semibold text-foreground mt-0.5">By Asset Type</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-[10px] gap-1.5"
              onClick={() => exportAnomalyByAssetTypeReport()}
             >
              <Download className="h-3 w-3" />
              Export Report
            </Button>
          </div>
          <div className="gradient-table-line" />
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="top-0 z-10 bg-card">
                <TableRow className="border-b hover:bg-transparent">
                  <TableHead className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Defect Type</TableHead>
                  <TableHead className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Category</TableHead>
                  <TableHead className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-right">Count</TableHead>
                  <TableHead className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-right w-48">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {defectByAsset?.length > 0 ? defectByAsset.map((row) => (
                  <TableRow key={row.type} className="hover:bg-muted/40 border-b border-border/50" style={{ height: 36 }}>
                    <TableCell className="text-xs font-medium py-2.5">{row.type}</TableCell>
                    <TableCell className="py-2.5">
                      <CategoryBadge category={row.category} categoryId={row.category_id} />
                    </TableCell>
                    <TableCell className="text-right py-2.5">
                      <span className="inline-flex items-center justify-center rounded-md bg-destructive/10 text-destructive px-2 py-0.5 text-xs font-bold tabular-nums min-w-[2rem]">
                        {row.defects}
                      </span>
                    </TableCell>
                    <TableCell className="text-right py-2.5">
                      <div className="flex gap-1.5 justify-end">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-[11px] gap-1 text-muted-foreground hover:text-foreground"
                           onClick={() => exportAnomalyByAssetTypeReport(row.type)}
                         >
                           <Download className="h-3 w-3" />
                           Report
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-[11px] gap-1 text-muted-foreground hover:text-foreground"
                          onClick={() => navigate(`/defect-library?type=${encodeURIComponent(row.type)}`)}
                        >
                          <MapPin className="h-3 w-3" />
                          Map
                          <ArrowUpRight className="h-2.5 w-2.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )): (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center">
                      No data available.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </Card>

        {/* Anomalies by Road */}
        <Card className="p-0 border border-border bg-card overflow-hidden">
          <div className="px-5 pt-5 pb-3 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Map className="h-4 w-4 text-primary" />
            </div>
            <div className="flex-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest">Defects</p>
              <p className="text-sm font-semibold text-foreground mt-0.5">By Road</p>
            </div>
            <div className="flex gap-1.5">
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-[10px] gap-1.5"
                onClick={() => exportAnomalyByRoadReport()}
               >
                <Download className="h-3 w-3" />
                Export Report
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-[10px] gap-1.5"
                onClick={() => exportRoadWiseAssetTypeReport()}
              >
                <Download className="h-3 w-3" />
                Road × Asset Type
              </Button>
            </div>
          </div>
          <div className="gradient-table-line" />
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="top-0 z-10 bg-card">
                <TableRow className="border-b border-border hover:bg-transparent">
                  <TableHead className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Road</TableHead>
                  <TableHead className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-right">Count</TableHead>
                  <TableHead className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Last Survey</TableHead>
                  <TableHead className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-right w-48">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topDefectRoads.map((row) => (
                  <TableRow key={row.road} className="hover:bg-muted/40 border-b border-border/50" style={{ height: 36 }}>
                    <TableCell className="text-xs font-medium py-2.5">{row.road}</TableCell>
                    <TableCell className="text-right py-2.5">
                      <span className="inline-flex items-center justify-center rounded-md bg-destructive/10 text-destructive px-2 py-0.5 text-xs font-bold tabular-nums min-w-[2rem]">
                        {row.count}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground py-2.5">
                      {row.lastSurvey || row.date || "—"}
                    </TableCell>
                    <TableCell className="text-right py-2.5">
                      <div className="flex gap-1.5 justify-end">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-[11px] gap-1 text-muted-foreground hover:text-foreground"
                           onClick={() => exportAnomalyByRoadReport(row.road)}
                         >
                           <Download className="h-3 w-3" />
                           Report
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-[11px] gap-1 text-muted-foreground hover:text-foreground"
                          onClick={() => navigate(`/defect-library?road=${encodeURIComponent(row.road)}`)}
                        >
                          <MapPin className="h-3 w-3" />
                          Map
                          <ArrowUpRight className="h-2.5 w-2.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      </div>
    </div>
  );
}

/* ── KPI Card Component ── */
function KPICard({ label, value, unit, icon, accent, trend, lastSurvey }: {
  label: string;
  value: string;
  unit?: string;
  icon: React.ReactNode;
  accent: "primary" | "secondary" | "destructive";
  trend?: { value: number; direction: "up" | "down" };
  lastSurvey?: string;
}) {
  const styles = {
    primary: {
      border: "border-l-primary",
      iconBg: "bg-primary/10 text-primary",
      valueTint: "text-primary",
      gradFrom: "hsl(217, 64%, 31%)",
      gradTo: "hsl(198, 99%, 41%)",
    },
    secondary: {
      border: "border-l-secondary",
      iconBg: "bg-secondary/10 text-secondary",
      valueTint: "text-secondary",
      gradFrom: "hsl(198, 99%, 41%)",
      gradTo: "hsl(187, 85%, 43%)",
    },
    destructive: {
      border: "border-l-destructive",
      iconBg: "bg-destructive/10 text-destructive",
      valueTint: "text-destructive",
      gradFrom: "hsl(0, 84%, 60%)",
      gradTo: "hsl(38, 92%, 50%)",
    },
  };
  const s = styles[accent];

  return (
    <Card className={`p-0 border border-border bg-card overflow-hidden border-l-[3px] ${s.border} relative`}>
      <div className="absolute inset-0 bg-kpi-grid pointer-events-none" />
      <div className="absolute inset-0 pointer-events-none" style={{
        background: `linear-gradient(135deg, ${s.gradFrom}30 0%, ${s.gradFrom}12 40%, ${s.gradTo}18 70%, ${s.gradTo}28 100%)`
      }} />
      <div className="absolute right-0 top-2 bottom-2 w-[3px] rounded-full pointer-events-none" style={{
        background: `linear-gradient(180deg, ${s.gradFrom}, ${s.gradTo})`
      }} />
      <div className="relative px-5 py-5 flex items-center gap-4">
        <div className={`p-2.5 rounded-xl ${s.iconBg}`}>
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-widest">{label}</p>
          <div className="flex items-baseline gap-1.5 mt-1">
            <span className={`text-3xl font-bold tabular-nums tracking-tight ${s.valueTint}`}>{value}</span>
            {unit && <span className="text-sm text-muted-foreground font-medium">{unit}</span>}
            {/* {trend && (
              <span className={cn(
                "inline-flex items-center gap-0.5 text-[10px] font-bold ml-1 px-1.5 py-0.5 rounded-full",
                trend.direction === "up" ? "bg-emerald-500/10 text-emerald-600" : "bg-destructive/10 text-destructive"
              )}>
                {trend.direction === "up" ? <TrendingUp className="h-3 w-3" /> : <TrendingUp className="h-3 w-3 rotate-180" />}
                {trend.direction === "up" ? "+" : "-"}{Math.abs(trend.value)}%
              </span>
            )} */}
          </div>
          {/* {lastSurvey && (
            <p className="text-[9px] text-muted-foreground mt-1">Last Survey: {lastSurvey}</p>
          )} */}
        </div>
      </div>
    </Card>
  );
}
