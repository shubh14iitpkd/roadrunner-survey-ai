import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BarChart as BarChartIcon, LineChart as LineChartIcon, PieChart as PieChartIcon, TrendingUp, MapPin, AlertTriangle, CheckCircle, Activity, Package, Calendar, TrendingDown } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";
import { mockDetectedAssets } from "@/data/mockAssetData";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default function Dashboard() {
  const [timePeriod, setTimePeriod] = useState<"week" | "month">("week");

  // Calculate KPIs based on time period
  const totalAssets = mockDetectedAssets.length;
  const totalAnomalies = mockDetectedAssets.filter(a => a.condition === "Poor").length;
  const goodAssets = mockDetectedAssets.filter(a => a.condition === "Good").length;
  const fairAssets = mockDetectedAssets.filter(a => a.condition === "Fair").length;
  const poorAssets = mockDetectedAssets.filter(a => a.condition === "Poor").length;
  
  const kmSurveyedWeek = 89.5;
  const kmSurveyedMonth = 342.8;
  const kmSurveyed = timePeriod === "week" ? kmSurveyedWeek : kmSurveyedMonth;

  // Asset health percentages
  const healthData = [
    { name: "Good", value: goodAssets, percentage: Math.round((goodAssets / totalAssets) * 100), color: "#22c55e" },
    { name: "Fair", value: fairAssets, percentage: Math.round((fairAssets / totalAssets) * 100), color: "#f59e0b" },
    { name: "Poor", value: poorAssets, percentage: Math.round((poorAssets / totalAssets) * 100), color: "#ef4444" },
  ];

  // Roads with most anomalies
  const roadAnomalies = mockDetectedAssets
    .filter(a => a.condition === "Poor")
    .reduce((acc, asset) => {
      acc[asset.roadName] = (acc[asset.roadName] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

  const topAnomalyRoads = Object.entries(roadAnomalies)
    .map(([road, count]) => ({ road, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // Categories with most anomalies
  const categoryAnomalies = mockDetectedAssets
    .filter(a => a.condition === "Poor")
    .reduce((acc, asset) => {
      acc[asset.category] = (acc[asset.category] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

  const topAnomalyCategories = Object.entries(categoryAnomalies)
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  // Asset distribution by category
  const categoryDistribution = mockDetectedAssets
    .reduce((acc, asset) => {
      acc[asset.category] = (acc[asset.category] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

  const categoryChartData = Object.entries(categoryDistribution)
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  // Recent survey activity
  const recentSurveys = mockDetectedAssets
    .sort((a, b) => new Date(b.surveyDate).getTime() - new Date(a.surveyDate).getTime())
    .slice(0, 5)
    .map(asset => ({
      road: asset.roadName,
      date: asset.surveyDate,
      assets: Math.floor(Math.random() * 50) + 30,
      surveyor: asset.surveyorName
    }));

  return (
    <div className="space-y-6">
      {/* Hero Header */}
      <div className="relative overflow-hidden gradient-primary p-8 rounded-2xl shadow-elevated">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImdyaWQiIHdpZHRoPSI2MCIgaGVpZ2h0PSI2MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTSAxMCAwIEwgMCAwIDAgMTAiIGZpbGw9Im5vbmUiIHN0cm9rZT0id2hpdGUiIHN0cm9rZS1vcGFjaXR5PSIwLjEiIHN0cm9rZS13aWR0aD0iMSIvPjwvcGF0dGVybj48L2RlZnM+PHJlY3Qgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIgZmlsbD0idXJsKCNncmlkKSIvPjwvc3ZnPg==')] opacity-30"></div>
        <div className="relative flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-4xl font-bold mb-2 text-white drop-shadow-lg">Dashboard</h1>
            <p className="text-white/90 text-lg">
              Real-time overview of road asset inventory and condition monitoring
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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
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

          <Card className="p-6 shadow-elevated border-0 bg-gradient-to-br from-red-50 to-white dark:from-red-950/20 dark:to-card animate-fade-in hover:shadow-glow transition-all duration-300">
            <div className="flex items-start justify-between">
              <div className="space-y-2">
                <p className="text-sm font-semibold text-red-600 dark:text-red-400 uppercase tracking-wide">Total Anomalies</p>
                <p className="text-5xl font-bold bg-gradient-to-br from-red-600 to-red-400 bg-clip-text text-transparent">
                  {totalAnomalies}
                </p>
                <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                  <TrendingDown className="h-3 w-3" />
                  -8 vs last {timePeriod}
                </p>
              </div>
              <div className="p-4 rounded-2xl bg-gradient-to-br from-red-500 to-red-600 shadow-lg">
                <AlertTriangle className="h-7 w-7 text-white" />
              </div>
            </div>
          </Card>

          <Card className="p-6 shadow-elevated border-0 bg-gradient-to-br from-blue-50 to-white dark:from-blue-950/20 dark:to-card animate-fade-in hover:shadow-glow transition-all duration-300">
            <div className="flex items-start justify-between">
              <div className="space-y-2">
                <p className="text-sm font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wide">Avg Condition</p>
                <p className="text-5xl font-bold bg-gradient-to-br from-blue-600 to-blue-400 bg-clip-text text-transparent">
                  {healthData[0].percentage}%
                </p>
                <p className="text-xs font-medium text-muted-foreground">Assets in good condition</p>
              </div>
              <div className="p-4 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 shadow-lg">
                <Activity className="h-7 w-7 text-white" />
              </div>
            </div>
          </Card>
        </div>

        {/* Asset Health Overview */}
        <Card className="p-8 shadow-elevated border-0 gradient-card">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-3 rounded-xl bg-gradient-to-br from-primary to-accent">
              <PieChartIcon className="h-6 w-6 text-white" />
            </div>
            <h3 className="font-bold text-xl">Asset Inventory Health</h3>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="flex items-center justify-center">
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie
                    data={healthData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {healthData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value: number) => `${value} assets`} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-4 flex flex-col justify-center">
              {healthData.map((item) => (
                <div key={item.name} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 rounded-full" style={{ backgroundColor: item.color }} />
                      <span className="text-sm font-medium">{item.name}</span>
                    </div>
                    <span className="font-semibold">{item.value} ({item.percentage}%)</span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-2.5">
                    <div
                      className="h-2.5 rounded-full transition-all"
                      style={{ width: `${item.percentage}%`, backgroundColor: item.color }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Card>

        {/* Charts Section */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Asset Distribution by Category */}
          <Card className="p-8 shadow-elevated border-0 gradient-card">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-3 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500">
                <BarChartIcon className="h-6 w-6 text-white" />
              </div>
              <h3 className="font-bold text-xl">Assets by Category</h3>
            </div>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={categoryChartData}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.1} />
                <XAxis 
                  dataKey="category" 
                  angle={-45}
                  textAnchor="end"
                  height={80}
                  tick={{ fontSize: 11 }}
                />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="count" fill="hsl(var(--primary))" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>

          {/* Categories with Most Anomalies */}
          <Card className="p-8 shadow-elevated border-0 gradient-card">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-3 rounded-xl bg-gradient-to-br from-red-500 to-orange-500">
                <AlertTriangle className="h-6 w-6 text-white" />
              </div>
              <h3 className="font-bold text-xl">Anomalies by Category</h3>
            </div>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={topAnomalyCategories}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.1} />
                <XAxis 
                  dataKey="category" 
                  angle={-45}
                  textAnchor="end"
                  height={80}
                  tick={{ fontSize: 11 }}
                />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="count" fill="#ef4444" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </div>

        {/* Tables Section */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Roads with Most Anomalies */}
          <Card className="p-8 shadow-elevated border-0 gradient-card">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-3 rounded-xl bg-gradient-to-br from-orange-500 to-red-500">
                <MapPin className="h-6 w-6 text-white" />
              </div>
              <h3 className="font-bold text-xl">Roads with Most Anomalies</h3>
            </div>
            <div className="rounded-lg border border-border overflow-hidden">
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
                      <TableCell>{item.road}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant="destructive" className="font-semibold">
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
          <Card className="p-8 shadow-elevated border-0 gradient-card">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-3 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500">
                <LineChartIcon className="h-6 w-6 text-white" />
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

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}
