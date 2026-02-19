import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  TrendingUp, AlertTriangle, Package, Calendar,
  MapPin, Eye, ChevronLeft, ChevronRight, Map
} from "lucide-react";
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
} from "recharts";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { assetCategories, assetTypes } from "@/data/assetCategories";

// Donut chart colors for 6 categories
const CATEGORY_COLORS = [
  "hsl(217, 91%, 60%)",  // blue
  "hsl(271, 81%, 56%)",  // purple
  "hsl(38, 92%, 50%)",   // amber
  "hsl(48, 96%, 53%)",   // yellow
  "hsl(142, 76%, 36%)",  // green
  "hsl(330, 81%, 60%)",  // pink
];

const CustomPieTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-popover border border-border rounded-lg shadow-lg p-3 min-w-32">
        <p className="text-popover-foreground font-medium text-sm">{payload[0].name}</p>
        <p className="text-primary dark:text-foreground font-bold text-sm">{payload[0].value} assets</p>
      </div>
    );
  }
  return null;
};

export default function Dashboard() {
  const [timePeriod, setTimePeriod] = useState<"week" | "month">("week");
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  // Data state
  const [kpis, setKpis] = useState<any>({
    totalAssets: 0, totalAnomalies: 0, kmSurveyed: 0,
  });
  const [categoryChartData, setCategoryChartData] = useState<any[]>([]);
  const [topAnomalyRoads, setTopAnomalyRoads] = useState<any[]>([]);

  // Pagination for asset type table
  const [assetTypePage, setAssetTypePage] = useState(1);
  const assetTypePageSize = 10;

  // Build asset type counts from assetTypes data (demo)
  const assetTypeRows = assetTypes.map((at, idx) => ({
    type: at.type,
    category: at.category,
    code: at.code,
    count: Math.max(1, Math.floor(Math.random() * 30) + (idx < 10 ? 20 : 5)), // demo counts
  })).sort((a, b) => b.count - a.count);

  const assetTypeTotalPages = Math.ceil(assetTypeRows.length / assetTypePageSize);
  const pagedAssetTypes = assetTypeRows.slice(
    (assetTypePage - 1) * assetTypePageSize,
    assetTypePage * assetTypePageSize
  );

  // Demo anomaly data by asset type
  const [anomalyByAsset] = useState(() =>
    assetTypes
      .map((at, idx) => ({
        type: at.type,
        category: at.category,
        anomalies: Math.floor(Math.random() * 15),
      }))
      .filter(a => a.anomalies > 0)
      .sort((a, b) => b.anomalies - a.anomalies)
      .slice(0, 10)
  );

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
          setCategoryChartData(assetsByCategoryResp.items);
        } else {
          // Demo: distribute across 6 categories
          setCategoryChartData(
            assetCategories.map((cat, i) => ({
              category: cat,
              count: [35, 62, 48, 12, 28, 45][i] || 10,
            }))
          );
        }

        if (topRoadsResp?.items && topRoadsResp.items.length > 0) {
          setTopAnomalyRoads(topRoadsResp.items);
        } else {
          setTopAnomalyRoads([
            { road: "Al Corniche Street", count: 18, lastSurvey: "2025-11-10" },
            { road: "West Bay Road", count: 14, lastSurvey: "2025-11-09" },
            { road: "Salwa Road", count: 11, lastSurvey: "2025-11-08" },
            { road: "C Ring Road", count: 9, lastSurvey: "2025-11-07" },
            { road: "Lusail Expressway", count: 7, lastSurvey: "2025-11-06" },
          ]);
        }
      } catch (err) {
        console.error("Failed to load dashboard data:", err);
      } finally {
        setLoading(false);
      }
    })();
  }, [timePeriod]);

  const demoKpis = {
    totalAssets: loading ? 0 : (kpis.totalAssets || 230),
    totalAnomalies: loading ? 0 : (kpis.totalAnomalies || 34),
    kmSurveyed: loading ? 0 : (kpis.kmSurveyed || 42.8),
  };

  const totalDonut = categoryChartData.reduce((s, d) => s + d.count, 0);

  return (
    <div className="space-y-6">
      {/* Hero Header */}
      <div className="relative overflow-hidden bg-primary p-8 shadow-elevated">
        <div className="absolute bg-primary inset-0 opacity-30"></div>
        <div className="relative flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-4xl font-bold mb-2 text-white drop-shadow-lg">Dashboard</h1>
            <p className="text-white/90 text-lg">
              Network-level overview for situational awareness and decision-making
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
        {/* ── KPI Cards ── */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          {/* Total Road Network */}
          <Card className="p-6 shadow-elevated border-0 bg-gradient-to-br from-purple-50 to-white dark:from-purple-950/20 dark:to-card hover:shadow-glow transition-all duration-300">
            <div className="flex items-start justify-between">
              <div className="space-y-2">
                <p className="text-sm font-semibold text-purple-600 dark:text-purple-400 uppercase tracking-wide">
                  Total Road Network
                </p>
                <p className="text-5xl font-bold bg-gradient-to-br from-purple-600 to-purple-400 bg-clip-text text-transparent">
                  {loading ? "..." : Number(demoKpis.kmSurveyed).toLocaleString("en-US", { maximumFractionDigits: 1 })}
                </p>
                <p className="text-xs font-medium text-foreground">KMs Surveyed</p>
              </div>
              <div className="p-4 rounded-2xl bg-gradient-to-br from-purple-500 to-purple-600 shadow-lg">
                <TrendingUp className="h-7 w-7 text-white" />
              </div>
            </div>
          </Card>

          {/* Total Assets */}
          <Card className="p-6 shadow-elevated border-0 bg-gradient-to-br from-green-50 to-white dark:from-green-950/20 dark:to-card hover:shadow-glow transition-all duration-300">
            <div className="flex items-start justify-between">
              <div className="space-y-2">
                <p className="text-sm font-semibold text-green-600 dark:text-green-400 uppercase tracking-wide">Total Assets</p>
                <p className="text-5xl font-bold bg-gradient-to-br from-green-600 to-green-400 bg-clip-text text-transparent">
                  {loading ? "..." : demoKpis.totalAssets.toLocaleString()}
                </p>
                <p className="text-xs font-medium text-foreground">Detected across network</p>
              </div>
              <div className="p-4 rounded-2xl bg-gradient-to-br from-green-500 to-green-600 shadow-lg">
                <Package className="h-7 w-7 text-white" />
              </div>
            </div>
          </Card>

          {/* Total Anomalies */}
          <Card className="p-6 shadow-elevated border-0 bg-gradient-to-br from-red-50 to-white dark:from-red-950/20 dark:to-card hover:shadow-glow transition-all duration-300">
            <div className="flex items-start justify-between">
              <div className="space-y-2">
                <p className="text-sm font-semibold text-red-600 dark:text-red-400 uppercase tracking-wide">Total Anomalies</p>
                <p className="text-5xl font-bold bg-gradient-to-br from-red-600 to-red-400 bg-clip-text text-transparent">
                  {loading ? "..." : demoKpis.totalAnomalies}
                </p>
                <p className="text-xs font-medium text-foreground">Assets in poor condition</p>
              </div>
              <div className="p-4 rounded-2xl bg-gradient-to-br from-red-500 to-red-600 shadow-lg">
                <AlertTriangle className="h-7 w-7 text-white" />
              </div>
            </div>
          </Card>
        </div>

        {/* ── Asset Distribution by Category (Donut) + Top Asset Types Table ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Donut Chart */}
          <Card className="p-6 sm:p-8 shadow-elevated border-0 gradient-card">
            <h3 className="font-bold text-lg mb-4">Asset Distribution by Category</h3>
            <div className="relative" style={{ height: 300 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={categoryChartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={70}
                    outerRadius={120}
                    dataKey="count"
                    nameKey="category"
                    paddingAngle={2}
                    stroke="none"
                  >
                    {categoryChartData.map((_, i) => (
                      <Cell key={i} fill={CATEGORY_COLORS[i % CATEGORY_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomPieTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              {/* Center label */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="text-center">
                  <p className="text-3xl font-bold text-foreground">{totalDonut}</p>
                  <p className="text-xs text-muted-foreground">Total</p>
                </div>
              </div>
            </div>
            {/* Legend */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-4">
              {categoryChartData.map((d, i) => (
                <div key={d.category} className="flex items-center gap-2 text-xs">
                  <span
                    className="w-3 h-3 rounded-sm shrink-0"
                    style={{ backgroundColor: CATEGORY_COLORS[i % CATEGORY_COLORS.length] }}
                  />
                  <span className="truncate text-muted-foreground">{d.category}</span>
                  <span className="font-semibold text-foreground ml-auto">{d.count}</span>
                </div>
              ))}
            </div>
          </Card>

          {/* Top Asset Types Table */}
          <Card className="p-6 sm:p-8 shadow-elevated border-0 gradient-card flex flex-col">
            <h3 className="font-bold text-lg mb-4">Top Asset Types by Count</h3>
            <div className="flex-1 rounded-lg border border-border overflow-hidden overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="font-semibold">#</TableHead>
                    <TableHead className="font-semibold">Asset Type</TableHead>
                    <TableHead className="font-semibold">Category</TableHead>
                    <TableHead className="font-semibold text-right">Count</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagedAssetTypes.map((row, idx) => (
                    <TableRow key={row.code} className="hover:bg-muted/30">
                      <TableCell className="font-medium text-muted-foreground">
                        {(assetTypePage - 1) * assetTypePageSize + idx + 1}
                      </TableCell>
                      <TableCell className="text-sm font-medium">{row.type}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="text-xs">{row.category}</Badge>
                      </TableCell>
                      <TableCell className="text-right font-semibold">{row.count}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {/* Pagination */}
            <div className="flex items-center justify-between mt-3 text-sm text-muted-foreground">
              <span>
                Page {assetTypePage} of {assetTypeTotalPages}
              </span>
              <div className="flex gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  disabled={assetTypePage <= 1}
                  onClick={() => setAssetTypePage(p => p - 1)}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  disabled={assetTypePage >= assetTypeTotalPages}
                  onClick={() => setAssetTypePage(p => p + 1)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </Card>
        </div>

        {/* ── Anomalies (Asset-wise) ── */}
        <Card className="p-6 sm:p-8 shadow-elevated border-0 gradient-card">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-3 rounded-xl bg-gradient-to-br from-orange-500 to-red-500">
              <AlertTriangle className="h-6 w-6 text-white" />
            </div>
            <div>
              <h3 className="font-bold text-lg">Anomalies by Asset Type</h3>
              <p className="text-sm text-muted-foreground">Top asset types with anomalies detected</p>
            </div>
          </div>
          <div className="rounded-lg border border-border overflow-hidden overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="font-semibold">Asset Type</TableHead>
                  <TableHead className="font-semibold">Category</TableHead>
                  <TableHead className="font-semibold text-right">Anomalies</TableHead>
                  <TableHead className="font-semibold text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {anomalyByAsset.map((row) => (
                  <TableRow key={row.type} className="hover:bg-muted/30">
                    <TableCell className="font-medium text-sm">{row.type}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-xs">{row.category}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant="destructive" className="font-semibold">{row.anomalies}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-1 justify-end">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs gap-1"
                          onClick={() => navigate(`/anomalies?type=${encodeURIComponent(row.type)}`)}
                        >
                          <Eye className="h-3 w-3" />
                          Report
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs gap-1"
                          onClick={() => navigate(`/gis?type=${encodeURIComponent(row.type)}&condition=Poor`)}
                        >
                          <MapPin className="h-3 w-3" />
                          Map
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>

        {/* ── Anomalies (Road-wise) ── */}
        <Card className="p-6 sm:p-8 shadow-elevated border-0 gradient-card">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-3 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500">
              <Map className="h-6 w-6 text-white" />
            </div>
            <div>
              <h3 className="font-bold text-lg">Anomalies by Road</h3>
              <p className="text-sm text-muted-foreground">Roads with the most anomalies requiring attention</p>
            </div>
          </div>
          <div className="rounded-lg border border-border overflow-hidden overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="font-semibold">Road Name</TableHead>
                  <TableHead className="font-semibold text-right">Anomalies</TableHead>
                  <TableHead className="font-semibold">Last Survey</TableHead>
                  <TableHead className="font-semibold text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topAnomalyRoads.map((row) => (
                  <TableRow key={row.road} className="hover:bg-muted/30">
                    <TableCell className="font-medium text-sm">{row.road}</TableCell>
                    <TableCell className="text-right">
                      <Badge variant="destructive" className="font-semibold">{row.count}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {row.lastSurvey || row.date || "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-1 justify-end">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs gap-1"
                          onClick={() => navigate(`/anomalies?road=${encodeURIComponent(row.road)}`)}
                        >
                          <Eye className="h-3 w-3" />
                          Report
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs gap-1"
                          onClick={() => navigate(`/gis?road=${encodeURIComponent(row.road)}&condition=Poor`)}
                        >
                          <MapPin className="h-3 w-3" />
                          Map
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
