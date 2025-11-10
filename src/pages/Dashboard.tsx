import { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BarChart as BarChartIcon, TrendingUp, MapPin, Package, Calendar, Layers } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { mockDetectedAssets } from "@/data/mockAssetData";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default function Dashboard() {
  const [timePeriod, setTimePeriod] = useState<"week" | "month">("week");

  // Calculate KPIs based on time period
  const totalAssets = mockDetectedAssets.length;
  
  const kmSurveyedWeek = 89.5;
  const kmSurveyedMonth = 342.8;
  const kmSurveyed = timePeriod === "week" ? kmSurveyedWeek : kmSurveyedMonth;

  // Get unique roads from assets
  const uniqueRoads = useMemo(() => {
    const roadMap = new Map<string, { routeId: string; assetCount: number }>();
    mockDetectedAssets.forEach(asset => {
      if (!roadMap.has(asset.roadName)) {
        roadMap.set(asset.roadName, { routeId: asset.routeId, assetCount: 0 });
      }
      roadMap.get(asset.roadName)!.assetCount++;
    });
    return Array.from(roadMap.entries())
      .map(([name, data]) => ({ roadName: name, ...data }))
      .sort((a, b) => b.assetCount - a.assetCount)
      .slice(0, 5);
  }, []);

  // Asset distribution by category
  const categoryDistribution = useMemo(() => {
    const distribution = mockDetectedAssets
      .reduce((acc, asset) => {
        acc[asset.category] = (acc[asset.category] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

    return Object.entries(distribution)
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
  }, []);

  // Recent survey activity
  const recentSurveys = useMemo(() => 
    mockDetectedAssets
      .sort((a, b) => new Date(b.surveyDate).getTime() - new Date(a.surveyDate).getTime())
      .slice(0, 5)
      .map(asset => ({
        road: asset.roadName,
        date: asset.surveyDate,
        assets: Math.floor(Math.random() * 50) + 30,
        surveyor: asset.surveyorName
      })), []
  );

  // Road network paths for map - SVG path definitions
  const roadPaths = {
    "Doha Corniche": "M 10,30 Q 30,25 50,30 T 90,35",
    "Salwa Road": "M 5,50 L 95,55",
    "Al Shamal Road": "M 30,5 Q 32,30 35,50 T 40,95",
    "Lusail Expressway": "M 15,15 Q 40,20 60,25 T 90,30",
    "Dukhan Highway": "M 10,70 Q 50,68 90,70",
    "Al Khor Coastal Road": "M 60,10 Q 65,30 70,50 T 80,90",
    "Orbital Highway": "M 20,80 Q 50,75 80,80",
    "Al Rayyan Road": "M 5,40 L 95,45",
    "C-Ring Road": "M 50,10 Q 55,50 50,90",
    "D-Ring Road": "M 65,15 Q 68,50 65,85"
  };

  // Group assets by road for map positioning
  const assetsByRoad = useMemo(() => {
    const grouped: Record<string, typeof mockDetectedAssets> = {};
    mockDetectedAssets.forEach(asset => {
      if (!grouped[asset.roadName]) {
        grouped[asset.roadName] = [];
      }
      grouped[asset.roadName].push(asset);
    });
    return grouped;
  }, []);

  // Get position along a road path for an asset marker
  const getPositionOnRoad = (roadName: string, assetIndex: number, totalAssets: number) => {
    const path = roadPaths[roadName as keyof typeof roadPaths];
    if (!path) return { x: 50, y: 50 };
    
    const progress = totalAssets > 1 ? assetIndex / (totalAssets - 1) : 0.5;
    const matches = path.match(/M\s*([\d.]+),([\d.]+).*?([\d.]+),([\d.]+)/);
    if (matches) {
      const [, x1, y1, x2, y2] = matches.map(Number);
      return {
        x: x1 + (x2 - x1) * progress,
        y: y1 + (y2 - y1) * progress
      };
    }
    
    return { x: 50, y: 50 };
  };

  return (
    <div className="space-y-6">
      {/* Hero Header */}
      <div className="relative overflow-hidden gradient-primary p-8 rounded-2xl shadow-elevated">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImdyaWQiIHdpZHRoPSI2MCIgaGVpZ2h0PSI2MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTSAxMCAwIEwgMCAwIDAgMTAiIGZpbGw9Im5vbmUiIHN0cm9rZT0id2hpdGUiIHN0cm9rZS1vcGFjaXR5PSIwLjEiIHN0cm9rZS13aWR0aD0iMSIvPjwvcGF0dGVybj48L2RlZnM+PHJlY3Qgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIgZmlsbD0idXJsKCNncmlkKSIvPjwvc3ZnPg==')] opacity-30"></div>
        <div className="relative flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-4xl font-bold mb-2 text-white drop-shadow-lg">GIS Dashboard</h1>
            <p className="text-white/90 text-lg">
              Geospatial analysis and road asset inventory monitoring
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
                  KM Surveyed {timePeriod === "week" ? "(Week)" : "(Month)"}
                </p>
                <p className="text-5xl font-bold bg-gradient-to-br from-purple-600 to-purple-400 bg-clip-text text-transparent">
                  {kmSurveyed}
                </p>
                <p className="text-xs font-medium text-muted-foreground">
                  {timePeriod === "week" ? "+15.2 vs last week" : "+45.2 vs last month"}
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
                  {totalAssets.toLocaleString()}
                </p>
                <p className="text-xs font-medium text-muted-foreground">
                  {timePeriod === "week" ? "+48 this week" : "+187 this month"}
                </p>
              </div>
              <div className="p-4 rounded-2xl bg-gradient-to-br from-green-500 to-green-600 shadow-lg">
                <Package className="h-7 w-7 text-white" />
              </div>
            </div>
          </Card>

          <Card className="p-6 shadow-elevated border-0 bg-gradient-to-br from-blue-50 to-white dark:from-blue-950/20 dark:to-card animate-fade-in hover:shadow-glow transition-all duration-300">
            <div className="flex items-start justify-between">
              <div className="space-y-2">
                <p className="text-sm font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wide">Active Roads</p>
                <p className="text-5xl font-bold bg-gradient-to-br from-blue-600 to-blue-400 bg-clip-text text-transparent">
                  {uniqueRoads.length}
                </p>
                <p className="text-xs font-medium text-muted-foreground">Surveyed road networks</p>
              </div>
              <div className="p-4 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 shadow-lg">
                <Layers className="h-7 w-7 text-white" />
              </div>
            </div>
          </Card>
        </div>

        {/* GIS Map Overview */}
        <Card className="p-8 shadow-elevated border-0 gradient-card">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-3 rounded-xl bg-gradient-to-br from-primary to-accent">
              <MapPin className="h-6 w-6 text-white" />
            </div>
            <h3 className="font-bold text-xl">Road Network & Asset Distribution</h3>
          </div>
          <div className="bg-gradient-to-br from-muted/30 to-muted/10 rounded-xl border-2 border-border/50 p-4">
            <svg viewBox="0 0 100 100" className="w-full h-[400px]">
              {/* Background grid */}
              <defs>
                <pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse">
                  <path d="M 10 0 L 0 0 0 10" fill="none" stroke="hsl(var(--border))" strokeWidth="0.5" opacity="0.3"/>
                </pattern>
              </defs>
              <rect width="100" height="100" fill="url(#grid)" />
              
              {/* Road paths */}
              {Object.entries(roadPaths).map(([roadName, path]) => (
                <g key={roadName}>
                  <path
                    d={path}
                    fill="none"
                    stroke="hsl(var(--primary))"
                    strokeWidth="0.3"
                    opacity="0.6"
                  />
                </g>
              ))}
              
              {/* Asset markers */}
              {Object.entries(assetsByRoad).map(([roadName, assets]) =>
                assets.slice(0, 15).map((asset, idx) => {
                  const pos = getPositionOnRoad(roadName, idx, Math.min(assets.length, 15));
                  return (
                    <g key={`${asset.id}-${idx}`}>
                      <circle
                        cx={pos.x}
                        cy={pos.y}
                        r="0.8"
                        fill="hsl(var(--secondary))"
                        opacity="0.8"
                        className="transition-all hover:opacity-100"
                      />
                    </g>
                  );
                })
              )}
            </svg>
          </div>
          <div className="mt-4 text-sm text-muted-foreground text-center">
            Showing {mockDetectedAssets.length} detected assets across {Object.keys(assetsByRoad).length} road networks
          </div>
        </Card>

        {/* Analytics Section */}
        <div className="grid grid-cols-1 lg:grid-cols-1 gap-6">
          {/* Asset Distribution by Category */}
          <Card className="p-8 shadow-elevated border-0 gradient-card">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-3 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500">
                <BarChartIcon className="h-6 w-6 text-white" />
              </div>
              <h3 className="font-bold text-xl">Asset Distribution by Category</h3>
            </div>
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={categoryDistribution}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.1} />
                <XAxis 
                  dataKey="category" 
                  angle={-45}
                  textAnchor="end"
                  height={100}
                  tick={{ fontSize: 11 }}
                />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="count" fill="hsl(var(--primary))" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </div>

        {/* Tables Section */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Top Roads by Asset Count */}
          <Card className="p-8 shadow-elevated border-0 gradient-card">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-3 rounded-xl bg-gradient-to-br from-orange-500 to-red-500">
                <MapPin className="h-6 w-6 text-white" />
              </div>
              <h3 className="font-bold text-xl">Top Roads by Asset Count</h3>
            </div>
            <div className="rounded-lg border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="font-semibold">#</TableHead>
                    <TableHead className="font-semibold">Road Name</TableHead>
                    <TableHead className="font-semibold">Route ID</TableHead>
                    <TableHead className="font-semibold text-right">Assets</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {uniqueRoads.map((road, idx) => (
                    <TableRow key={road.roadName} className="hover:bg-muted/30">
                      <TableCell className="font-medium">{idx + 1}</TableCell>
                      <TableCell>{road.roadName}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="font-mono text-xs">
                          {road.routeId}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant="secondary" className="font-semibold">
                          {road.assetCount}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>

          {/* Recent Survey Activity */}
          <Card className="p-8 shadow-elevated border-0 gradient-card">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-3 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500">
                <Calendar className="h-6 w-6 text-white" />
              </div>
              <h3 className="font-bold text-xl">Recent Survey Activity</h3>
            </div>
            <div className="rounded-lg border border-border overflow-hidden">
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
                      <TableCell className="font-medium">{survey.road}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{survey.date}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant="secondary" className="font-semibold">
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

