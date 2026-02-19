import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BarChart as BarChartIcon, LineChart as LineChartIcon, MapIcon, TrendingUp, MapPin, AlertTriangle, CheckCircle, Activity, Package, Calendar, TrendingDown, Maximize2, ChevronLeft, ChevronRight, Hash } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useNavigate } from "react-router-dom";
import LeafletMapView from "@/components/LeafletMapView";
import { api } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { useLabelMap } from "@/contexts/LabelMapContext";

// Custom tooltip component for charts that adapts to dark mode
const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0];
    console.log(active, payload, label)
    return (
      <div className="bg-popover/80 backdrop-blur-sm border border-border/80 rounded-lg shadow-lg p-3 min-w-32">
        <div className="flex items-center justify-between pb-2">
          <span className="text-popover-foreground font-medium text-sm">{data.name || label}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground text-xs capitalize mr-2">{data.dataKey}: </span>
          <span className="text-primary dark:text-foreground font-bold text-sm">{data.value}</span>
        </div>
      </div>
    );
  }
  return null;
};

export default function Dashboard() {
  const [timePeriod, setTimePeriod] = useState<"week" | "month">("week");
  const [roads, setRoads] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const { data: labelMapData } = useLabelMap();

  // Dashboard data state
  const [kpis, setKpis] = useState<any>({
    totalAssets: 0,
    totalAnomalies: 0,
    good: 0,
    damaged: 0,
    kmSurveyed: 0,
  });
  const [categoryChartData, setCategoryChartData] = useState<any[]>([]);
  const [topAnomalyCategories, setTopAnomalyCategories] = useState<any[]>([]);
  const [topAnomalyRoads, setTopAnomalyRoads] = useState<any[]>([]);
  const [recentSurveys, setRecentSurveys] = useState<any[]>([]);
  
  // Asset Types Table State
  const [assetTypeTableData, setAssetTypeTableData] = useState<any>({ items: [], total: 0, page: 1, pages: 0 });
  const [assetTypePage, setAssetTypePage] = useState(1);
  const [tableLoading, setTableLoading] = useState(false);

  const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d'];

  // Load all dashboard data from backend
  useEffect(() => {
    (async () => {
      try {
        setLoading(true);

        const [roadsResp, kpisResp, categoryResp, recentSurveysResp] = await Promise.all([
          api.roads.list(),
          api.dashboard.kpis(timePeriod),
          api.dashboard.assetsByCategory(),
          api.dashboard.recentSurveys(),
        ]);

        if (roadsResp?.items) setRoads(roadsResp.items);

        // KPIs directly from backend
        if (kpisResp) {
          setKpis(kpisResp);
        }

        // Category chart data — resolve category_id to display names
        const rawCategoryData = categoryResp?.items || [];
        const resolvedChartData = rawCategoryData.map((item: any) => {
          const categoryId = item.category;
          const displayName = labelMapData?.categories?.[categoryId]?.display_name
            || labelMapData?.categories?.[categoryId]?.default_name
            || categoryId || 'Unknown';
          return { category: displayName, count: item.count };
        });
        setCategoryChartData(resolvedChartData.length > 0 ? resolvedChartData : [{ category: "No Data", count: 0 }]);

        // Recent surveys from API
        if (recentSurveysResp?.items && recentSurveysResp.items.length > 0) {
          setRecentSurveys(recentSurveysResp.items);
        } else {
          setRecentSurveys([]);
        }
      } catch (err) {
        console.error("Failed to load dashboard data:", err);
      } finally {
        setLoading(false);
      }
    })();
  }, [timePeriod, labelMapData]);

  // Load Asset Types Table Data
  useEffect(() => {
    (async () => {
      try {
        setTableLoading(true);
        const resp = await api.dashboard.topAssetTypes(assetTypePage, 4);
        if (resp) {
            setAssetTypeTableData(resp);
        }
      } catch (err) {
        console.error("Failed to load asset types table:", err);
      } finally {
        setTableLoading(false);
      }
    })();
  }, [assetTypePage]);

  // Helper to get asset display name safely
  const getAssetDisplayName = (item: any) => {
      const fromMap = labelMapData?.labels?.[item.asset_id]?.display_name;
      if (fromMap) return fromMap;
      return item.display_name || item.type;
  };

  return (
    <div className="space-y-6 mb-6">
      {/* Hero Header */}
      <div className="relative overflow-hidden bg-primary p-8 shadow-elevated">
        {/* <div className="absolute bg-primary inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImdyaWQiIHdpZHRoPSI2MCIgaGVpZ2h0PSI2MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTSAxMCAwIEwgMCAwIDAgMTAiIGZpbGw9Im5vbmUiIHN0cm9rZT0id2hpdGUiIHN0cm9rZS1vcGFjaXR5PSIwLjEiIHN0cm9rZS13aWR0aD0iMSIvPjwvcGF0dGVybj48L2RlZnM+PHJlY3Qgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIgZmlsbD0idXJsKCNncmlkKSIvPjwvc3ZnPg==')] opacity-30"></div> */}
        <div className="absolute page-header dark:bg-primary inset-0"></div>
        <div className="relative flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-4xl font-bold mb-2 text-white drop-shadow-lg">Dashboard</h1>
            <p className="text-white/90 text-lg">
              Overview of road asset inventory and condition monitoring
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-white/80" />
            <Select value={timePeriod} onValueChange={(v) => setTimePeriod(v as "week" | "month")}>
              <SelectTrigger className="w-32 bg-white/20 border-white/30 text-white backdrop-blur-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-background z-50">
                <SelectItem value="week">Last Week</SelectItem>
                <SelectItem value="month">Last Month</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div className="px-6 space-y-6">

        {/* KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          <Card className="p-6 shadow-elevated border-0 bg-gradient-to-br from-purple-50 to-white dark:from-purple-950/20 dark:to-card animate-fade-in hover:shadow-glow transition-all duration-300">
            <div className="flex items-start justify-between">
              <div className="space-y-2">
                <p className="text-sm font-semibold text-purple-600 dark:text-purple-400 uppercase tracking-wide">
                  Total road network
                </p>
                <p className="text-5xl font-bold bg-gradient-to-br from-purple-600 to-purple-400 bg-clip-text text-transparent">
                  {loading ? "..." : Number(kpis.kmSurveyed).toLocaleString("en-US", { maximumFractionDigits: 1 })}
                </p>
                <p className="text-xs font-medium text-foreground">
                  KMs Surveyed
                </p>
              </div>
              <div className="p-4 rounded-2xl bg-gradient-to-br from-purple-500 to-purple-600 shadow-lg">
                <TrendingUp className="h-7 w-7 text-white" />
              </div>
            </div>
          </Card>

          <Card className="p-6 shadow-elevated border-0 bg-gradient-to-br from-green-50 to-white dark:from-green-950/20 dark:to-card animate-fade-in hover:shadow-glow transition-all duration-300">
            <div className="flex items-start justify-between">
              <div className="space-y-2">
                <p className="text-sm font-semibold text-green-600 dark:text-green-400 uppercase tracking-wide">Total Assets</p>
                <p className="text-5xl font-bold bg-gradient-to-br from-green-600 to-green-400 bg-clip-text text-transparent">
                  {loading ? "..." : kpis.totalAssets.toLocaleString()}
                </p>
                <p className="text-xs font-medium text-foreground">
                  Detected across network
                </p>
              </div>
              <div className="p-4 rounded-2xl bg-gradient-to-br from-green-500 to-green-600 shadow-lg">
                <Package className="h-7 w-7 text-white" />
              </div>
            </div>
          </Card>

          <Card className="p-6 shadow-elevated border-0 bg-gradient-to-br from-red-50 to-white dark:from-red-950/20 dark:to-card animate-fade-in hover:shadow-glow transition-all duration-300">
            <div className="flex items-start justify-between">
              <div className="space-y-2">
                <p className="text-sm font-semibold text-red-600 dark:text-red-400 uppercase tracking-wide">Total Anomalies</p>
                <p className="text-5xl font-bold bg-gradient-to-br from-red-600 to-red-400 bg-clip-text text-transparent">
                  {loading ? "..." : kpis.totalAnomalies}
                </p>
                <p className="text-xs font-medium text-foreground flex items-center gap-1">
                  Assets in poor condition
                </p>
              </div>
              <div className="p-4 rounded-2xl bg-gradient-to-br from-red-500 to-red-600 shadow-lg">
                <AlertTriangle className="h-7 w-7 text-white" />
              </div>
            </div>
          </Card>
        </div>

        {/* GIS Map Overview */}
        <Card className="p-6 sm:p-8 shadow-elevated border-0 gradient-card">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500">
                <MapPin className="h-6 w-6 text-white" />
              </div>
              <h3 className="font-bold text-lg sm:text-xl">Geographic Overview</h3>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate('/gis')}
              className="gap-2"
            >
              <MapPin className="h-4 w-4" />
              <span className="hidden sm:inline">View Full Map</span>
              <span className="sm:hidden">Full View</span>
            </Button>
          </div>
          <div className="relative w-full rounded-xl overflow-hidden border border-border bg-muted/20" style={{ height: '400px' }}>
            <LeafletMapView selectedRoadNames={[]} roads={roads} />
          </div>
        </Card>

        {/* Charts & Tables Section */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Asset Distribution (Donut Chart) */}
          <Card className="p-6 sm:p-8 card pla shadow-elevated border-0 gradient-card">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-xl bg-gradient-to-br from-orange-500 to-amber-500">
                <Activity className="h-6 w-6 text-white" />
              </div>
              <h3 className="font-bold text-lg sm:text-xl">Asset Distribution</h3>
            </div>
             {loading ? (
               <div className="h-[280px] flex items-center justify-center">
                  <Skeleton className="w-[200px] h-[200px] rounded-full bg-primary/10" />
               </div>
            ) : (
              <div className="h-full grid place-items-center"> 
              <ResponsiveContainer width="100%" height={280} className={"grid place-items-center my-auto"}>
                <PieChart>
                  <Pie
                    data={categoryChartData.slice(0, 6)}
                    cx="50%"
                    cy="50%"
                    innerRadius={70}
                    outerRadius={100}
                    fill="#8884d8"
                    paddingAngle={0}
                    dataKey="count"
                    nameKey="category"
                  >
                    {categoryChartData.slice(0, 6).map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                  <Legend 
                      layout="vertical" 
                      verticalAlign="middle" 
                      align="right"
                      formatter={(value, entry: any) => <span className="text-sm font-medium text-foreground ml-2">{value}</span>}
                  />
                </PieChart>
              </ResponsiveContainer>
              </div>
            )}
          </Card>

          {/* Top Asset Types Table */}
          <Card className="shadow-elevated border-0 gradient-card overflow-hidden">
            <div className="p-6 sm:p-8 pb-4">
                <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                    <div className="p-3 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-500">
                        <TrendingUp className="h-6 w-6 text-white" />
                    </div>
                    <h3 className="font-bold text-lg sm:text-xl">Top Asset Types</h3>
                </div>
                </div>
            </div>
            
            <div className="border-t border-border/50">
              <Table>
                <TableHeader className="bg-muted/30">
                  <TableRow className="hover:bg-transparent border-border/50">
                    <TableHead className="w-[70%] pl-8">Asset Type</TableHead>
                    <TableHead className="text-right pr-8">Count</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tableLoading ? (
                     Array(4).fill(0).map((_, i) => (
                        <TableRow key={i} className="border-border/50">
                            <TableCell className="pl-8"><Skeleton className="min-h-5 w-[180px]" /></TableCell>
                            <TableCell className="text-right pr-8"><Skeleton className="min-h-5 w-[40px] ml-auto" /></TableCell>
                        </TableRow>
                     ))
                  ) : (
                    <>
                      {assetTypeTableData.items.length > 0 ? (
                        assetTypeTableData.items.map((item: any, i: number) => (
                          <TableRow key={i} className="hover:bg-muted/50 transition-colors border-border/50 group h-5">
                            <TableCell className="font-medium pl-8 py-4">
                                <div className="flex items-center gap-3">
                                    {/* <span className="bg-primary/10 text-primary p-1.5 rounded-md group-hover:bg-primary/20 transition-colors">
                                        <Hash className="h-4 w-4" />
                                    </span> */}
                                    <span className="text-base">{getAssetDisplayName(item)}</span>
                                </div>
                            </TableCell>
                            <TableCell className="text-right font-bold text-base pr-8">
                                <Badge variant="secondary" className="font-mono text-sm px-2.5 py-0.5">
                                    {item.count.toLocaleString()}
                                </Badge>
                            </TableCell>
                          </TableRow>
                        ))
                      ) : (
                        <TableRow className="h-[65px]">
                          <TableCell colSpan={2} className="text-center text-muted-foreground">
                            No asset types found.
                          </TableCell>
                        </TableRow>
                      )}
                      
                      {/* Fill empty rows to maintain height */}
                      {Array.from({ length: Math.max(0, 4 - assetTypeTableData.items.length) }).map((_, i) => (
                        <TableRow key={`empty-${i}`} className="border-border/50 !h-2">
                           <TableCell colSpan={2} className="p-0">&nbsp;</TableCell>
                        </TableRow>
                      ))}
                    </>
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between px-6 py-4 bg-muted/20 border-t border-border/50">
               <div className="text-sm font-medium text-muted-foreground">
                  Page {assetTypeTableData.page} of {assetTypeTableData.pages}
               </div>
               <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setAssetTypePage(prev => Math.max(prev - 1, 1))}
                  disabled={assetTypePage === 1 || tableLoading}
                >
                  <ChevronLeft className="h-4 w-4" />
                  <span className="sr-only">Previous</span>
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setAssetTypePage(prev => Math.min(prev + 1, assetTypeTableData.pages))}
                  disabled={assetTypePage >= assetTypeTableData.pages || tableLoading}
                >
                  <ChevronRight className="h-4 w-4" />
                  <span className="sr-only">Next</span>
                </Button>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}
