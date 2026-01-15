import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BarChart as BarChartIcon, LineChart as LineChartIcon, MapIcon, TrendingUp, MapPin, AlertTriangle, CheckCircle, Activity, Package, Calendar, TrendingDown, Maximize2 } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useNavigate } from "react-router-dom";
import LeafletMapView from "@/components/LeafletMapView";
import { api } from "@/lib/api";

// Custom tooltip component for charts that adapts to dark mode
const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0];
    return (
      <div className="bg-popover border border-border rounded-lg shadow-lg p-3 min-w-32">
        <div className="flex items-center justify-between pb-2">
          <span className="text-popover-foreground font-medium text-sm">{label}</span>
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

  // Dashboard data state
  const [kpis, setKpis] = useState<any>({
    totalAssets: 0,
    totalAnomalies: 0,
    good: 0,
    fair: 0,
    poor: 0,
    kmSurveyed: 0,
  });
  const [categoryChartData, setCategoryChartData] = useState<any[]>([]);
  const [topAnomalyCategories, setTopAnomalyCategories] = useState<any[]>([]);
  const [topAnomalyRoads, setTopAnomalyRoads] = useState<any[]>([]);
  const [recentSurveys, setRecentSurveys] = useState<any[]>([]);

  // Load all dashboard data
  useEffect(() => {
    (async () => {
      try {
        setLoading(true);

        // Load all data in parallel
        const [roadsResp, kpisResp, assetsByCategoryResp, anomaliesByCategoryResp, topRoadsResp, recentSurveysResp] = await Promise.all([
          api.roads.list(),
          api.dashboard.kpis(timePeriod),
          api.dashboard.assetsByCategory(),
          api.dashboard.anomaliesByCategory(),
          api.dashboard.topAnomalyRoads(),
          api.dashboard.recentSurveys(),
        ]);

        if (roadsResp?.items) setRoads(roadsResp.items);
        if (kpisResp) setKpis(kpisResp);

        // Set chart data with demo fallbacks
        if (assetsByCategoryResp?.items && assetsByCategoryResp.items.length > 0) {
          setCategoryChartData(assetsByCategoryResp.items);
        } else {
          // Demo data for assets by category
          setCategoryChartData([
            { category: "Potholes", count: 45 },
            { category: "Cracks", count: 38 },
            { category: "Signs", count: 32 },
            { category: "Manholes", count: 22 },
            { category: "Markings", count: 13 },
          ]);
        }

        if (anomaliesByCategoryResp?.items && anomaliesByCategoryResp.items.length > 0) {
          setTopAnomalyCategories(anomaliesByCategoryResp.items);
        } else {
          // Demo data for anomalies by category
          setTopAnomalyCategories([
            { category: "Potholes", count: 12 },
            { category: "Cracks", count: 8 },
            { category: "Signs", count: 3 },
          ]);
        }

        if (topRoadsResp?.items && topRoadsResp.items.length > 0) {
          setTopAnomalyRoads(topRoadsResp.items);
        } else {
          // Demo data for top anomaly roads
          setTopAnomalyRoads([
            { road: "Al Corniche Street", count: 8 },
            { road: "West Bay Road", count: 6 },
            { road: "Salwa Road", count: 5 },
            { road: "C Ring Road", count: 4 },
          ]);
        }

        if (recentSurveysResp?.items && recentSurveysResp.items.length > 0) {
          setRecentSurveys(recentSurveysResp.items);
        } else {
          // Demo data for recent surveys
          setRecentSurveys([
            { road: "Al Corniche Street", date: "2025-11-10", assets: 42, surveyor: "Ahmed" },
            { road: "West Bay Road", date: "2025-11-09", assets: 38, surveyor: "Mohammed" },
            { road: "Salwa Road", date: "2025-11-08", assets: 35, surveyor: "Fatima" },
            { road: "C Ring Road", date: "2025-11-07", assets: 35, surveyor: "Ahmed" },
          ]);
        }
      } catch (err) {
        console.error("Failed to load dashboard data:", err);
      } finally {
        setLoading(false);
      }
    })();
  }, [timePeriod]);

  // Calculate health data - with demo hardcoded values
  const totalAssets = kpis.totalAssets || 150; // Demo: default to 150 assets
  const demoKpis = {
    totalAssets: loading ? 0 : (kpis.totalAssets || 150),
    totalAnomalies: loading ? 0 : (kpis.totalAnomalies || 23),
    good: loading ? 0 : (kpis.good || 98),
    fair: loading ? 0 : (kpis.fair || 29),
    poor: loading ? 0 : (kpis.poor || 23),
    kmSurveyed: loading ? 0 : (kpis.kmSurveyed || 42.8),
  };

  const healthData = [
    { name: "Good", value: demoKpis.good, percentage: Math.round((demoKpis.good / totalAssets) * 100), color: "#22c55e" },
    { name: "Fair", value: demoKpis.fair, percentage: Math.round((demoKpis.fair / totalAssets) * 100), color: "#f59e0b" },
    { name: "Poor", value: demoKpis.poor, percentage: Math.round((demoKpis.poor / totalAssets) * 100), color: "#ef4444" },
  ];

  return (
    <div className="space-y-6">
      {/* Hero Header */}
      <div className="relative overflow-hidden bg-primary p-8 shadow-elevated">
        {/* <div className="absolute bg-primary inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImdyaWQiIHdpZHRoPSI2MCIgaGVpZ2h0PSI2MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTSAxMCAwIEwgMCAwIDAgMTAiIGZpbGw9Im5vbmUiIHN0cm9rZT0id2hpdGUiIHN0cm9rZS1vcGFjaXR5PSIwLjEiIHN0cm9rZS13aWR0aD0iMSIvPjwvcGF0dGVybj48L2RlZnM+PHJlY3Qgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIgZmlsbD0idXJsKCNncmlkKSIvPjwvc3ZnPg==')] opacity-30"></div> */}
        <div className="absolute bg-primary inset-0 opacity-30"></div>
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
                {loading ? "..." : Number(demoKpis.kmSurveyed).toLocaleString("en-US", { maximumFractionDigits: 1 })}
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
                  {loading ? "..." : demoKpis.totalAssets.toLocaleString()}
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
                  {loading ? "..." : demoKpis.totalAnomalies}
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

          {/* <Card className="p-6 shadow-elevated border-0 bg-gradient-to-br from-blue-50 to-white dark:from-blue-950/20 dark:to-card animate-fade-in hover:shadow-glow transition-all duration-300">
            <div className="flex items-start justify-between">
              <div className="space-y-2">
                <p className="text-sm font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wide">Avg Condition</p>
                <p className="text-5xl font-bold bg-gradient-to-br from-blue-600 to-blue-400 bg-clip-text text-transparent">
                  {loading ? "..." : `${healthData[0].percentage}%`}
                </p>
                <p className="text-xs font-medium text-muted-foreground">Assets in good condition</p>
              </div>
              <div className="p-4 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 shadow-lg">
                <Activity className="h-7 w-7 text-white" />
              </div>
            </div>
          </Card> */}
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
          {/* <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 sm:p-4 bg-gradient-to-br from-blue-50 to-cyan-50 dark:from-blue-950/20 dark:to-cyan-950/20 rounded-lg border border-blue-200 dark:border-blue-800">
              <p className="text-xs sm:text-sm text-blue-600 dark:text-blue-400 font-medium">Total Roads</p>
              <p className="text-xl sm:text-2xl font-bold text-blue-700 dark:text-blue-300 mt-1">{roads.length}</p>
            </div>
            <div className="p-3 sm:p-4 bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-950/20 dark:to-emerald-950/20 rounded-lg border border-green-200 dark:border-green-800">
              <p className="text-xs sm:text-sm text-green-600 dark:text-green-400 font-medium">Good</p>
              <p className="text-xl sm:text-2xl font-bold text-green-700 dark:text-green-300 mt-1">{goodAssets}</p>
            </div>
            <div className="p-3 sm:p-4 bg-gradient-to-br from-amber-50 to-yellow-50 dark:from-amber-950/20 dark:to-yellow-950/20 rounded-lg border border-amber-200 dark:border-amber-800">
              <p className="text-xs sm:text-sm text-amber-600 dark:text-amber-400 font-medium">Fair</p>
              <p className="text-xl sm:text-2xl font-bold text-amber-700 dark:text-amber-300 mt-1">{fairAssets}</p>
            </div>
            <div className="p-3 sm:p-4 bg-gradient-to-br from-red-50 to-rose-50 dark:from-red-950/20 dark:to-rose-950/20 rounded-lg border border-red-200 dark:border-red-800">
              <p className="text-xs sm:text-sm text-red-600 dark:text-red-400 font-medium">Poor</p>
              <p className="text-xl sm:text-2xl font-bold text-red-700 dark:text-red-300 mt-1">{poorAssets}</p>
            </div>
          </div> */}
        </Card>

        {/* Charts Section */}
        <div className="grid grid-cols-1 lg:grid-cols-1 gap-6">
          {/* Asset Distribution by Category */}
          <Card className="p-6 sm:p-8 shadow-elevated border-0 gradient-card">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-3 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500">
                <BarChartIcon className="h-6 w-6 text-white" />
              </div>
              <h3 className="font-bold text-lg sm:text-xl">Assets by Category</h3>
            </div>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={categoryChartData}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.1} />
                <XAxis
                  dataKey="category"
                  angle={-45}
                  textAnchor="end"
                  height={80}
                  tick={{ fontSize: 10, fill: "hsl(var(--chart-axis))" }}
                />
                <YAxis tick={{ fontSize: 11, fill: "hsl(var(--chart-axis))" }} />
                <Tooltip cursor={false} content={<CustomTooltip />} />
                <Bar dataKey="count" fill="hsl(var(--primary))" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>

          {/* Categories with Most Anomalies */}
          {/* <Card className="p-6 sm:p-8 shadow-elevated border-0 gradient-card">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-3 rounded-xl bg-gradient-to-br from-red-500 to-orange-500">
                <AlertTriangle className="h-6 w-6 text-white" />
              </div>
              <h3 className="font-bold text-lg sm:text-xl">Anomalies by Category</h3>
            </div>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={topAnomalyCategories}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.1} />
                <XAxis
                  dataKey="category"
                  angle={-45}
                  textAnchor="end"
                  height={80}
                  tick={{ fontSize: 10 }}
                />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="count" fill="#ef4444" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card> */}
        </div>

        {/* Tables Section */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Roads with Most Anomalies */}
          <Card className="p-6 sm:p-8 shadow-elevated border-0 gradient-card">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-3 rounded-xl bg-gradient-to-br from-orange-500 to-red-500">
                <MapPin className="h-6 w-6 text-white" />
              </div>
              <h3 className="font-bold text-lg sm:text-xl">Roads with Most Anomalies</h3>
            </div>
            <div className="rounded-lg border border-border overflow-hidden overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="font-semibold">#</TableHead>
                    <TableHead className="font-semibold">Road Name</TableHead>
                    <TableHead className="font-semibold text-right">Anomalies</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topAnomalyRoads.map((item, idx) => (
                    <TableRow key={item.road} className="hover:bg-muted/30">
                      <TableCell className="font-medium">{idx + 1}</TableCell>
                      <TableCell className="text-sm sm:text-base">{item.road}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant="destructive" className="font-semibold text-xs sm:text-sm">
                          {item.count}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>

          {/* Recent Survey Activity */}
          <Card className="p-6 sm:p-8 shadow-elevated border-0 gradient-card">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-3 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500">
                <LineChartIcon className="h-6 w-6 text-white" />
              </div>
              <h3 className="font-bold text-lg sm:text-xl">Recent Survey Activity</h3>
            </div>
            <div className="rounded-lg border border-border overflow-hidden overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="font-semibold">Road</TableHead>
                    <TableHead className="font-semibold">Date</TableHead>
                    <TableHead className="font-semibold text-right">Assets</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentSurveys.map((survey, idx) => (
                    <TableRow key={idx} className="hover:bg-muted/30">
                      <TableCell className="font-medium text-sm sm:text-base">{survey.road}</TableCell>
                      <TableCell className="text-xs sm:text-sm text-muted-foreground">{survey.date}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant="secondary" className="font-semibold text-xs sm:text-sm">
                          {survey.assets}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
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
