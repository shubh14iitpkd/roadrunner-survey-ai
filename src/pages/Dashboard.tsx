import { useState, useEffect, useCallback, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  TrendingUp, AlertTriangle, Package, Calendar,
  MapPin, Eye, ChevronLeft, ChevronRight, Map, ArrowUpRight, Activity, X, Download,
  BarChart, Loader2,
  PieChartIcon,
  Database,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
} from "lucide-react";
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Sector,
  Legend,
  Bar,
  XAxis,
  YAxis,
  BarChart as RechartsBarChart,
  CartesianGrid,
} from "recharts";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { CategoryBadge, getCategoryColorCode } from "@/components/CategoryBadge";
import { useLabelMap } from "@/contexts/LabelMapContext";
import {
  exportDefectByAssetTypeReport,
  exportDefectByRoadReport,
  exportRoadWiseAssetTypeReport,
} from "@/lib/reportGenerator";

const CONDITION_COLORS = {
  Good: "#16a34a",
  Damaged: "#ef4444",
};

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

// Active shape renderer for condition donut
const renderActiveConditionShape = (props: any) => {
  const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill, payload, value, percent } = props;
  return (
    <g>
      <Sector cx={cx} cy={cy} innerRadius={innerRadius - 3} outerRadius={outerRadius + 4} startAngle={startAngle} endAngle={endAngle} fill={fill} opacity={0.9} />
      <Sector cx={cx} cy={cy} innerRadius={outerRadius + 6} outerRadius={outerRadius + 9} startAngle={startAngle} endAngle={endAngle} fill={fill} opacity={0.4} />
      <text x={cx} y={cy - 10} textAnchor="middle" fill="currentColor" className="text-foreground" fontSize={22} fontWeight={700}>
        {value}
      </text>
      <text x={cx} y={cy + 8} textAnchor="middle" fill="currentColor" className="text-muted-foreground" fontSize={10}>
        {payload.condition}
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
  const [activeConditionIndex, setActiveConditionIndex] = useState<number | undefined>(undefined);
  const [selectedCondition, setSelectedCondition] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const onDonutEnter = useCallback((_: any, index: number) => setActiveDonutIndex(index), []);

  const [kpis, setKpis] = useState<any>({
    totalAssets: 0, totalAnomalies: 0, kmSurveyed: 0,
  });
  const [categoryChartData, setCategoryChartData] = useState<any[]>([]);
  const [topDefectRoads, setTopDefectRoads] = useState<any[]>([]);

  const conditionSummaryData = useMemo(() => [
    { condition: "Good", count: categoryChartData.reduce((s, d) => s + (d.good_count || 0), 0) },
    { condition: "Damaged", count: categoryChartData.reduce((s, d) => s + (d.damaged_count || 0), 0) },
  ].filter(d => d.count > 0), [categoryChartData]);

  // Compute the selected category's donut index
  const selectedDonutIndex = useMemo(() => {
    if (!selectedCategory) return undefined;
    const idx = categoryChartData.findIndex(d => d.category === selectedCategory);
    return idx >= 0 ? idx : undefined;
  }, [selectedCategory, categoryChartData]);

  // Show selected slice when not hovering
  const effectiveDonutIndex = activeDonutIndex !== undefined ? activeDonutIndex : selectedDonutIndex;

  // Compute the selected condition's donut index
  const selectedConditionDonutIndex = useMemo(() => {
    if (!selectedCondition) return undefined;
    const idx = conditionSummaryData.findIndex(d => d.condition === selectedCondition);
    return idx >= 0 ? idx : undefined;
  }, [selectedCondition, conditionSummaryData]);

  // Show selected condition slice when not hovering
  const effectiveConditionIndex = activeConditionIndex !== undefined ? activeConditionIndex : selectedConditionDonutIndex;

  const [defectPage, setDefectPage] = useState(1);
  const [defectPageSize] = useState(10);
  const [defectTableMeta, setDefectTableMeta] = useState({ total: 0, pages: 0 });
  const [defectSortBy, setDefectSortBy] = useState("defects");
  const [defectSortOrder, setDefectSortOrder] = useState<"asc" | "desc">("desc");

  const [roadPage, setRoadPage] = useState(1);
  const [roadPageSize] = useState(10);
  const [roadTableMeta, setRoadTableMeta] = useState({ total: 0, pages: 0 });
  const [roadSortBy, setRoadSortBy] = useState("defects");
  const [roadSortOrder, setRoadSortOrder] = useState<"asc" | "desc">("desc");

  // Anomaly data from API
  const [defectByAsset, setDefectByAsset] = useState<any[]>([]);

  // Export loading states
  const [exportingKeys, setExportingKeys] = useState<Set<string>>(new Set());
  const startExport = useCallback(async (key: string, fn: () => Promise<void>) => {
    setExportingKeys(prev => new Set(prev).add(key));
    try { await fn(); } catch (e) { console.error(e); } finally {
      setExportingKeys(prev => { const s = new Set(prev); s.delete(key); return s; });
    }
  }, []);

  // Helper: toggle sort for a table
  const handleDefectSort = useCallback((col: string) => {
    setDefectSortBy(prev => {
      if (prev === col) {
        setDefectSortOrder(o => o === "asc" ? "desc" : "asc");
        return col;
      }
      setDefectSortOrder("desc");
      return col;
    });
    setDefectPage(1);
  }, []);

  const handleRoadSort = useCallback((col: string) => {
    setRoadSortBy(prev => {
      if (prev === col) {
        setRoadSortOrder(o => o === "asc" ? "desc" : "asc");
        return col;
      }
      setRoadSortOrder("desc");
      return col;
    });
    setRoadPage(1);
  }, []);

  // Sort icon helper
  const SortIcon = ({ col, activeSortBy, activeSortOrder }: { col: string; activeSortBy: string; activeSortOrder: "asc" | "desc" }) => {
    if (activeSortBy !== col) return <ArrowUpDown className="h-3 w-3 ml-1 inline opacity-40" />;
    return activeSortOrder === "asc"
      ? <ArrowUp className="h-3 w-3 ml-1 inline" />
      : <ArrowDown className="h-3 w-3 ml-1 inline" />;
  };

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

  // Reset defect page when category changes
  useEffect(() => { setDefectPage(1); }, [selectedCategoryId]);

  // Load main dashboard data
  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const [kpisResp, assetsByCategoryResp] = await Promise.all([
          api.dashboard.kpis(timePeriod),
          api.dashboard.assetsByCategory(),
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
      } catch (err) {
        console.error("Failed to load dashboard data:", err);
      } finally {
        setLoading(false);
      }
    })();
  }, [timePeriod, labelMapData, getCategoryDisplayName]);

  // Load Defects by Asset Type data (paginated, sortable)
  useEffect(() => {
    (async () => {
      try {
        const resp = await api.dashboard.topAssetTypes(defectPage, defectPageSize, selectedCategoryId || undefined, "damaged", defectSortBy, defectSortOrder);
        if (resp?.items) {
          setDefectByAsset(
            resp.items.map((item: any) => ({
              asset_id: item.asset_id,
              type: getAssetDisplayName(item),
              type_id: item.asset_id,
              category: getCategoryDisplayName(item),
              category_id: item.category_id,
              defects: item.damaged_count,
              total: item.count,
            }))
          );
          setDefectTableMeta({ total: resp.total || 0, pages: resp.pages || 1 });
        }
      } catch (err) {
        console.error("Failed to load anomaly data:", err);
      }
    })();
  }, [labelMapData, selectedCategoryId, defectPage, defectPageSize, defectSortBy, defectSortOrder, getCategoryDisplayName, getAssetDisplayName]);

  // Load Roads (paginated, sortable)
  useEffect(() => {
    (async () => {
      try {
        const resp = await api.dashboard.topAnomalyRoads(roadPage, roadPageSize, roadSortBy, roadSortOrder);
        if (resp?.items) {
          setTopDefectRoads(resp.items);
          setRoadTableMeta({ total: resp.total || 0, pages: resp.pages || 1 });
        }
      } catch (err) {
        console.error("Failed to load roads data:", err);
      }
    })();
  }, [roadPage, roadPageSize, roadSortBy, roadSortOrder]);
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
            label="Total Route Length"
            value={loading ? "..." : Number(kpis.kmSurveyed).toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}
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
        {/* <div className="overflow-hidden">
          <QatarRoutesMap
            height="600px"
          />
        </div> */}
        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Donut */}
          <Card className="lg:col-span-1 p-0 border border-border bg-card overflow-hidden flex flex-col">
            <div className="px-5 pt-5 pb-3 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10 dark:bg-muted-secondary/10">
                <PieChartIcon className="h-4 w-4 text-primary dark:text-muted-secondary" />
              </div>
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-[0.15em]">Asset Distribution</p>
                <p className="text-sm font-semibold text-foreground mt-0.5">By Category</p>
              </div>
            </div>
            <div className="gradient-table-line" />
            <div className="flex items-center justify-center px-5" style={{ height: 300 }}>
              <div className="relative" style={{ width: 300, height: 300 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                    className="recharts-sector"
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
                      // strokeWidth={2}
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
                      style={{ cursor: 'pointer', outline: 'none', border: 'none' }}
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
                  key={d.category_id || `category-${i}`}
                  className={cn(
                    "flex items-center gap-2 text-xs px-2 py-1.5 rounded-md transition-colors cursor-pointer",
                    selectedCategory === d.category ? "bg-muted-secondary/10 ring-1 ring-muted-secondary/30" : activeDonutIndex === i ? "bg-muted/80" : "hover:bg-muted/40"
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
                  <span className="text-foreground font-medium text-sm">{d.category}</span>
                  <span className="font-bold text-foreground ml-auto tabular-nums text-[11px]">{d.count}</span>
                </div>
              ))}
            </div>
            <div className="px-5 pb-3">
              <Button
                variant="outline"
                size="sm"
                className="w-full h-7 text-sm gap-1.5"
                onClick={() => navigate(selectedCategory ? `/asset-library?category=${encodeURIComponent(selectedCategory)}` : '/asset-library')}
              >
                <MapPin className="h-3 w-3" />
                {selectedCategory ? `View ${selectedCategory} on Map` : "View All on Map"}
                <ArrowUpRight className="h-3 w-3" />
              </Button>
            </div>
          </Card>
          
          {/* Donut — Asset Distribution by Condition */}
          <Card className="p-0 border border-border bg-card overflow-hidden flex flex-col">
            <div className="px-5 pt-5 pb-3 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-500/10">
                <Activity className="h-4 w-4 text-amber-500" />
              </div>
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-[0.15em]">Asset Distribution</p>
                <p className="text-sm font-semibold text-foreground mt-0.5">By Condition</p>
              </div>
            </div>
            <div className="gradient-table-line" />
            <div className="flex items-center justify-center px-5" style={{ height: 300 }}>
              <div className="relative" style={{ width: 220, height: 300 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      className="recharts-sector"
                      activeIndex={effectiveConditionIndex !== undefined ? effectiveConditionIndex : undefined}
                      activeShape={effectiveConditionIndex !== undefined ? renderActiveConditionShape : undefined}
                      data={conditionSummaryData}
                      cx="50%"
                      cy="50%"
                      innerRadius={65}
                      outerRadius={95}
                      dataKey="count"
                      nameKey="condition"
                      paddingAngle={2}
                      stroke="hsl(var(--card))"
                      strokeWidth={2}
                      onMouseEnter={(_, index) => setActiveConditionIndex(index)}
                      onMouseLeave={() => setActiveConditionIndex(undefined)}
                      onClick={(_, index) => {
                        const item = conditionSummaryData[index];
                        const cond = item?.condition;
                        if (selectedCondition === cond) {
                          setSelectedCondition(null);
                        } else {
                          setSelectedCondition(cond);
                        }
                      }}
                      style={{ cursor: 'pointer', outline: 'none', border: 'none' }}
                    >
                      {conditionSummaryData.map((entry) => (
                        <Cell key={entry.condition} fill={CONDITION_COLORS[entry.condition] || "#fff"} />
                      ))}
                    </Pie>
                    {effectiveConditionIndex === undefined && (
                      <text x="50%" y="46%" textAnchor="middle" fill="currentColor" className="text-foreground" fontSize={22} fontWeight={700}>
                        {conditionSummaryData.reduce((sum, d) => sum + d.count, 0)}
                      </text>
                    )}
                    {effectiveConditionIndex === undefined && (
                      <text x="50%" y="56%" textAnchor="middle" fill="currentColor" className="text-muted-foreground" fontSize={10}>
                        Total Assets
                      </text>
                    )}
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
            {/* Legend */}
            <div className="px-5 pb-2 flex-1 flex flex-col justify-end gap-4">
              {conditionSummaryData.map((d, i) => {
                const total = conditionSummaryData.reduce((s, c) => s + c.count, 0);
                const pct = total > 0 ? Math.round((d.count / total) * 100) : 0;
                return (
                  <div
                    key={d.condition}
                    className={cn(
                      "flex items-center gap-2 text-xs px-2 py-1.5 rounded-md transition-colors cursor-pointer",
                      selectedCondition === d.condition ? "bg-muted-secondary/10 ring-1 ring-muted-secondary/30" : activeConditionIndex === i ? "bg-muted/80" : "hover:bg-muted/40"
                    )}
                    onMouseEnter={() => setActiveConditionIndex(i)}
                    onMouseLeave={() => setActiveConditionIndex(undefined)}
                    onClick={() => {
                      if (selectedCondition === d.condition) {
                        setSelectedCondition(null);
                      } else {
                        setSelectedCondition(d.condition);
                      }
                    }}
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: CONDITION_COLORS[d.condition] || "#888" }}
                    />
                    <span className="text-foreground font-medium text-sm capitalize">{d.condition}</span>
                    <span className="text-muted-foreground text-[11px] ml-1">{pct}%</span>
                    <span className="font-bold text-foreground ml-auto tabular-nums text-[11px]">{d.count}</span>
                  </div>
                );
              })}
            </div>
            <div className="px-5 pb-3">
              <Button
                variant="outline"
                size="sm"
                className="w-full h-7 text-sm gap-1.5"
                onClick={() => navigate(selectedCondition ? `/asset-library?condition=${encodeURIComponent(selectedCondition.toLowerCase())}` : '/asset-library')}
              >
                <MapPin className="h-3 w-3" />
                {selectedCondition ? `View ${selectedCondition} Assets on Map` : "View All on Map"}
                <ArrowUpRight className="h-3 w-3" />
              </Button>
            </div>
          </Card>
        </div>

        {/* <div className="grid grid-cols-1 lg:grid-cols-4 gap-4"> */}
        <div className="gap-4">
          {/* Grouped Bar Chart */}
          <Card className="lg:col-span-3 p-0 border border-border bg-card overflow-hidden">
            <div className="px-5 pt-5 pb-3 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-500/10">
                <Activity className="h-4 w-4 text-amber-500" />
              </div>
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-[0.15em]">Condition Breakdown</p>
                <p className="text-sm font-semibold text-foreground mt-0.5">By Category</p>
              </div>
            </div>
            <div className="gradient-table-line" />
            <div className="px-3 pb-4 pt-4" style={{ height: 340 }}>
              <ResponsiveContainer width="100%" height="100%">
                <RechartsBarChart data={categoryChartData} barGap={2} barCategoryGap="20%" margin={{ top: 10, bottom: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis
                    dataKey="category"
                    tick={({ x, y, payload }: any) => {
                      const words = (payload.value as string).split(' ');
                      return (
                        <text x={x} y={y} textAnchor="middle" fill="hsl(var(--foreground))" fontSize={9} fontWeight={500}>
                          {words.map((word: string, i: number) => (
                            <tspan key={i} x={x} dy={i === 0 ? 12 : 11}>{word}</tspan>
                          ))}
                        </text>
                      );
                    }}
                    axisLine={false}
                    tickLine={false}
                    height={60}
                    interval={0}
                  />
                  <YAxis tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11, color: 'hsl(var(--foreground))' }}
                    labelStyle={{ color: 'hsl(var(--foreground))', fontWeight: 600 }}
                    itemStyle={{ fontWeight: 500 }}
                    cursor={{ fill: "hsl(var(--muted) / 0.5)" }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="good_count" name="Good" fill="#16a34a" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="damaged_count" name="Damaged" fill="#ef4444" radius={[3, 3, 0, 0]} />
                </RechartsBarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>

        {/* Defects by Asset Type */}
        <Card className="p-0 border border-border bg-card overflow-hidden">
          <div className="px-5 pt-5 pb-3 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10 dark:bg-muted-secondary/10">
              <Database className="h-4 w-4 text-primary dark:text-muted-secondary" />
            </div>
            <div className="flex-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest">Asset Types</p>
              <p className="text-sm font-semibold text-foreground mt-0.5">{selectedCategory? selectedCategory: "All Categories"}</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-sm gap-1.5"
              disabled={exportingKeys.has("defect-asset-all")}
              onClick={() => startExport("defect-asset-all", () => exportDefectByAssetTypeReport(undefined, labelMapData))}
             >
              {exportingKeys.has("defect-asset-all") ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
              Export Report
            </Button>
          </div>
          <div className="gradient-table-line" />
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="top-0 z-10 bg-card">
                <TableRow className="border-b hover:bg-transparent">
                  <TableHead
                    className="text-sm font-semibold uppercase tracking-wider text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors"
                    onClick={() => handleDefectSort("type")}
                  >
                    Asset Type<SortIcon col="type" activeSortBy={defectSortBy} activeSortOrder={defectSortOrder} />
                  </TableHead>
                  <TableHead
                    className="text-sm font-semibold uppercase tracking-wider text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors"
                    onClick={() => handleDefectSort("category")}
                  >
                    Category<SortIcon col="category" activeSortBy={defectSortBy} activeSortOrder={defectSortOrder} />
                  </TableHead>
                  <TableHead
                    className="text-sm font-semibold uppercase tracking-wider text-muted-foreground text-right cursor-pointer select-none hover:text-foreground transition-colors"
                    onClick={() => handleDefectSort("total")}
                  >
                    Total<SortIcon col="total" activeSortBy={defectSortBy} activeSortOrder={defectSortOrder} />
                  </TableHead>
                  <TableHead
                    className="text-sm font-semibold uppercase tracking-wider text-muted-foreground text-right cursor-pointer select-none hover:text-foreground transition-colors"
                    onClick={() => handleDefectSort("defects")}
                  >
                    Defects<SortIcon col="defects" activeSortBy={defectSortBy} activeSortOrder={defectSortOrder} />
                  </TableHead>
                  <TableHead className="text-sm font-semibold uppercase tracking-wider text-muted-foreground text-right w-48">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {defectByAsset?.length > 0 ? defectByAsset.map((row, idx) => (
                  <TableRow key={row.asset_id || `defect-${idx}`} className="hover:bg-muted/40 border-b border-border/50" style={{ height: 36 }}>
                    <TableCell className="text-xs font-medium py-2.5">{row.type}</TableCell>
                    <TableCell className="py-2.5">
                      <CategoryBadge category={row.category} categoryId={row.category_id} />
                    </TableCell>
                    <TableCell className="text-right font-semibold text-xs tabular-nums py-2.5">{row.total}</TableCell>
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
                          disabled={exportingKeys.has(`defect-asset-${row.type_id}`)}
                          onClick={() => startExport(`defect-asset-${row.type_id}`, () => exportDefectByAssetTypeReport(row.type_id, labelMapData))}
                         >
                           {exportingKeys.has(`defect-asset-${row.type_id}`) ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
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
          <div className="flex items-center justify-between px-4 py-2 border-t border-border">
            <span className="text-sm text-muted-foreground tabular-nums">
              {defectTableMeta.total > 0
                ? `${(defectPage - 1) * defectPageSize + 1}–${Math.min(defectPage * defectPageSize, defectTableMeta.total)} of ${defectTableMeta.total}`
                : "No results"}
            </span>
            <div className="flex items-center gap-1">
              <span className="text-sm text-muted-foreground tabular-nums mr-1">{defectPage}/{defectTableMeta.pages || 1}</span>
              <Button variant="ghost" size="icon" className="h-7 w-7" disabled={defectPage <= 1} onClick={() => setDefectPage(p => p - 1)}>
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" disabled={defectPage >= (defectTableMeta.pages || 1)} onClick={() => setDefectPage(p => p + 1)}>
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </Card>

        {/* Defects by Route*/}
        <Card className="p-0 border border-border bg-card overflow-hidden">
          <div className="px-5 pt-5 pb-3 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10 dark:bg-muted-secondary/15">
              <Map className="h-4 w-4 text-primary dark:text-muted-secondary" />
            </div>
            <div className="flex-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest">Defects</p>
              <p className="text-sm font-semibold text-foreground mt-0.5">By Route</p>
            </div>
            <div className="flex gap-1.5">
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-sm gap-1.5"
                disabled={exportingKeys.has("defect-road-all")}
                onClick={() => startExport("defect-road-all", () => exportDefectByRoadReport(undefined, labelMapData))}
               >
                {exportingKeys.has("defect-road-all") ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                Export Report
              </Button>
              {/* <Button
                variant="outline"
                size="sm"
                className="h-7 text-[10px] gap-1.5"
                onClick={() => { exportRoadWiseAssetTypeReport(labelMapData).catch(console.error); }}
              >
                <Download className="h-3 w-3" />
                Road × Asset Type
              </Button> */}
            </div>
          </div>
          <div className="gradient-table-line" />
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="top-0 z-10 bg-card">
                <TableRow className="border-b border-border hover:bg-transparent">
                  <TableHead
                    className="text-sm font-semibold uppercase tracking-wider text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors"
                    onClick={() => handleRoadSort("road")}
                  >
                    Road<SortIcon col="road" activeSortBy={roadSortBy} activeSortOrder={roadSortOrder} />
                  </TableHead>
                  <TableHead
                    className="text-sm font-semibold uppercase tracking-wider text-muted-foreground text-right cursor-pointer select-none hover:text-foreground transition-colors"
                    onClick={() => handleRoadSort("total")}
                  >
                    Total<SortIcon col="total" activeSortBy={roadSortBy} activeSortOrder={roadSortOrder} />
                  </TableHead>
                  <TableHead
                    className="text-sm font-semibold uppercase tracking-wider text-muted-foreground text-right cursor-pointer select-none hover:text-foreground transition-colors"
                    onClick={() => handleRoadSort("defects")}
                  >
                    Defects<SortIcon col="defects" activeSortBy={roadSortBy} activeSortOrder={roadSortOrder} />
                  </TableHead>
                  <TableHead
                    className="text-sm font-semibold uppercase tracking-wider text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors"
                    onClick={() => handleRoadSort("last_survey")}
                  >
                    Last Survey<SortIcon col="last_survey" activeSortBy={roadSortBy} activeSortOrder={roadSortOrder} />
                  </TableHead>
                  <TableHead className="text-sm font-semibold uppercase tracking-wider text-muted-foreground text-right w-48">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topDefectRoads.map((row, idx) => (
                  <TableRow key={`${row.road}-${idx}`} className="hover:bg-muted/40 border-b border-border/50" style={{ height: 36 }}>
                    <TableCell className="text-xs font-medium py-2.5">{row.road}</TableCell>
                    <TableCell className="text-right font-semibold text-xs tabular-nums py-2.5">{row.total_count ?? "—"}</TableCell>
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
                          disabled={exportingKeys.has(`defect-road-${row.road}`)}
                          onClick={() => startExport(`defect-road-${row.road}`, () => exportDefectByRoadReport(row.road, labelMapData))}
                         >
                           {exportingKeys.has(`defect-road-${row.road}`) ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                           Report
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-[11px] gap-1 text-muted-foreground hover:text-foreground"
                          onClick={() => navigate(row.route_id != null ? `/defect-library?route_id=${row.route_id}` : `/defect-library?road=${encodeURIComponent(row.road)}`)}
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
          <div className="flex items-center justify-between px-4 py-2 border-t border-border">
            <span className="text-sm text-muted-foreground tabular-nums">
              {roadTableMeta.total > 0
                ? `${(roadPage - 1) * roadPageSize + 1}–${Math.min(roadPage * roadPageSize, roadTableMeta.total)} of ${roadTableMeta.total}`
                : "No results"}
            </span>
            <div className="flex items-center gap-1">
              <span className="text-sm text-muted-foreground tabular-nums mr-1">{roadPage}/{roadTableMeta.pages || 1}</span>
              <Button variant="ghost" size="icon" className="h-7 w-7" disabled={roadPage <= 1} onClick={() => setRoadPage(p => p - 1)}>
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" disabled={roadPage >= (roadTableMeta.pages || 1)} onClick={() => setRoadPage(p => p + 1)}>
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
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
      border: "border-l-primary dark:border-l-muted-secondary",
      iconBg: "bg-primary/10 text-primary dark:bg-muted-secondary/15 dark:text-muted-secondary",
      valueTint: "text-primary dark:text-muted-secondary",
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
          <p className="text-sm font-medium text-muted-foreground uppercase tracking-widest">{label}</p>
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
