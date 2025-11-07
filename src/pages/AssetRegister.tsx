import { useState } from "react";
import { roadSurveySummaries, getDetailedRoadAssets } from "@/data/roadSurveyData";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  Search, MapPin, TrendingUp, CheckCircle, AlertTriangle, 
  FileText, ArrowLeft, Calendar, User, Layers, Map
} from "lucide-react";
import { Link } from "react-router-dom";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export default function AssetRegister() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedRoute, setSelectedRoute] = useState<string | null>(null);
  const [selectedSurveyDate, setSelectedSurveyDate] = useState<string>("");
  const [isDetailDialogOpen, setIsDetailDialogOpen] = useState(false);

  const filteredSummaries = roadSurveySummaries.filter((summary) => {
    const matchesSearch = summary.roadName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         summary.routeId.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         summary.surveyorName.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesSearch;
  });

  // Calculate KPIs
  const totalRoads = roadSurveySummaries.length;
  const totalAssets = roadSurveySummaries.reduce((sum, s) => sum + s.totalAssets, 0);
  const totalGood = roadSurveySummaries.reduce((sum, s) => sum + s.goodCondition, 0);
  const totalPoor = roadSurveySummaries.reduce((sum, s) => sum + s.poorCondition, 0);

  const handleViewDetails = (routeId: string) => {
    setSelectedRoute(routeId);
    const summary = roadSurveySummaries.find(s => s.routeId === routeId);
    setSelectedSurveyDate(summary?.surveyDate || "");
    setIsDetailDialogOpen(true);
  };

  const detailedData = selectedRoute 
    ? getDetailedRoadAssets(selectedRoute, selectedSurveyDate) 
    : null;

  const selectedSummary = roadSurveySummaries.find(s => s.routeId === selectedRoute);

  const getConditionColor = (condition: string) => {
    switch (condition) {
      case "Good":
        return "bg-gradient-to-r from-green-500/10 to-green-600/10 text-green-700 dark:text-green-400 border-green-500/30";
      case "Fair":
        return "bg-gradient-to-r from-amber-500/10 to-amber-600/10 text-amber-700 dark:text-amber-400 border-amber-500/30";
      case "Poor":
        return "bg-gradient-to-r from-red-500/10 to-red-600/10 text-red-700 dark:text-red-400 border-red-500/30";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  return (
    <div className="space-y-6">
      {/* Hero Header */}
      <div className="relative overflow-hidden gradient-primary p-8 rounded-2xl shadow-elevated">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImdyaWQiIHdpZHRoPSI2MCIgaGVpZ2h0PSI2MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTSAxMCAwIEwgMCAwIDAgMTAiIGZpbGw9Im5vbmUiIHN0cm9rZT0id2hpdGUiIHN0cm9rZS1vcGFjaXR5PSIwLjEiIHN0cm9rZS13aWR0aD0iMSIvPjwvcGF0dGVybj48L2RlZnM+PHJlY3Qgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIgZmlsbD0idXJsKCNncmlkKSIvPjwvc3ZnPg==')] opacity-30"></div>
        <div className="relative">
          <h1 className="text-4xl font-bold mb-2 text-white drop-shadow-lg">Asset Register</h1>
          <p className="text-white/90 text-lg">
            AI-detected road assets from survey analysis
          </p>
        </div>
      </div>

      <div className="px-6 space-y-6">
        {/* KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <Card className="p-6 shadow-elevated border-0 bg-gradient-to-br from-blue-50 to-white dark:from-blue-950/20 dark:to-card animate-fade-in hover:shadow-glow transition-all duration-300">
            <div className="flex items-start justify-between">
              <div className="space-y-2">
                <p className="text-sm font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wide">Surveyed Roads</p>
                <p className="text-5xl font-bold bg-gradient-to-br from-blue-600 to-blue-400 bg-clip-text text-transparent">{totalRoads}</p>
                <p className="text-xs font-medium text-muted-foreground">With AI reports</p>
              </div>
              <div className="p-4 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 shadow-lg">
                <Map className="h-7 w-7 text-white" />
              </div>
            </div>
          </Card>

          <Card className="p-6 shadow-elevated border-0 bg-gradient-to-br from-purple-50 to-white dark:from-purple-950/20 dark:to-card animate-fade-in hover:shadow-glow transition-all duration-300">
            <div className="flex items-start justify-between">
              <div className="space-y-2">
                <p className="text-sm font-semibold text-purple-600 dark:text-purple-400 uppercase tracking-wide">Total Assets</p>
                <p className="text-5xl font-bold bg-gradient-to-br from-purple-600 to-purple-400 bg-clip-text text-transparent">{totalAssets}</p>
                <p className="text-xs font-medium text-muted-foreground">AI Detected</p>
              </div>
              <div className="p-4 rounded-2xl bg-gradient-to-br from-purple-500 to-purple-600 shadow-lg">
                <Layers className="h-7 w-7 text-white" />
              </div>
            </div>
          </Card>

          <Card className="p-6 shadow-elevated border-0 bg-gradient-to-br from-green-50 to-white dark:from-green-950/20 dark:to-card animate-fade-in hover:shadow-glow transition-all duration-300">
            <div className="flex items-start justify-between">
              <div className="space-y-2">
                <p className="text-sm font-semibold text-green-600 dark:text-green-400 uppercase tracking-wide">Good Condition</p>
                <p className="text-5xl font-bold bg-gradient-to-br from-green-600 to-green-400 bg-clip-text text-transparent">{totalGood}</p>
                <p className="text-xs font-medium text-muted-foreground">{((totalGood / totalAssets) * 100).toFixed(0)}% of total</p>
              </div>
              <div className="p-4 rounded-2xl bg-gradient-to-br from-green-500 to-green-600 shadow-lg">
                <CheckCircle className="h-7 w-7 text-white" />
              </div>
            </div>
          </Card>

          <Card className="p-6 shadow-elevated border-0 bg-gradient-to-br from-red-50 to-white dark:from-red-950/20 dark:to-card animate-fade-in hover:shadow-glow transition-all duration-300">
            <div className="flex items-start justify-between">
              <div className="space-y-2">
                <p className="text-sm font-semibold text-red-600 dark:text-red-400 uppercase tracking-wide">Needs Attention</p>
                <p className="text-5xl font-bold bg-gradient-to-br from-red-600 to-red-400 bg-clip-text text-transparent">{totalPoor}</p>
                <p className="text-xs font-medium text-muted-foreground">Poor condition</p>
              </div>
              <div className="p-4 rounded-2xl bg-gradient-to-br from-red-500 to-red-600 shadow-lg">
                <AlertTriangle className="h-7 w-7 text-white" />
              </div>
            </div>
          </Card>
        </div>

        {/* Search */}
        <Card className="p-4 shadow-elevated border-0 gradient-card animate-fade-in">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
            <Input
              placeholder="Search by route ID, road name, or surveyor..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-11 h-12"
            />
          </div>
        </Card>

        {/* Summary Table */}
        <Card className="shadow-elevated border-0 gradient-card overflow-hidden animate-fade-in">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gradient-to-r from-primary/5 via-accent/5 to-primary/5 border-b-2 border-primary/20">
                <tr>
                  <th className="text-left p-5 font-bold text-sm uppercase tracking-wide">Route ID</th>
                  <th className="text-left p-5 font-bold text-sm uppercase tracking-wide">Road Name</th>
                  <th className="text-left p-5 font-bold text-sm uppercase tracking-wide">Length (km)</th>
                  <th className="text-left p-5 font-bold text-sm uppercase tracking-wide">Surveyor</th>
                  <th className="text-left p-5 font-bold text-sm uppercase tracking-wide">Survey Date</th>
                  <th className="text-left p-5 font-bold text-sm uppercase tracking-wide">Asset Condition</th>
                  <th className="text-left p-5 font-bold text-sm uppercase tracking-wide">Total Assets</th>
                  <th className="text-left p-5 font-bold text-sm uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredSummaries.map((summary, index) => (
                  <tr
                    key={summary.routeId}
                    className="border-b hover:bg-gradient-to-r hover:from-primary/5 hover:to-transparent transition-all duration-200"
                    style={{ animationDelay: `${index * 50}ms` }}
                  >
                    <td className="p-5">
                      <Button
                        variant="link"
                        className="font-mono font-bold text-primary hover:text-primary/80 p-0"
                        onClick={() => handleViewDetails(summary.routeId)}
                      >
                        {summary.routeId}
                      </Button>
                    </td>
                    <td className="p-5 font-semibold">{summary.roadName}</td>
                    <td className="p-5 font-mono">{summary.lengthKm.toFixed(1)}</td>
                    <td className="p-5">
                      <div className="flex items-center gap-2">
                        <User className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm">{summary.surveyorName}</span>
                      </div>
                    </td>
                    <td className="p-5">
                      <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm">{summary.surveyDate}</span>
                      </div>
                    </td>
                    <td className="p-5">
                      <div className="flex gap-2 flex-wrap">
                        <Badge variant="outline" className="bg-gradient-to-r from-green-500/10 to-green-600/10 text-green-700 dark:text-green-400 border-green-500/30 font-semibold">
                          {summary.goodCondition} Good
                        </Badge>
                        <Badge variant="outline" className="bg-gradient-to-r from-amber-500/10 to-amber-600/10 text-amber-700 dark:text-amber-400 border-amber-500/30 font-semibold">
                          {summary.averageCondition} Fair
                        </Badge>
                        <Badge variant="outline" className="bg-gradient-to-r from-red-500/10 to-red-600/10 text-red-700 dark:text-red-400 border-red-500/30 font-semibold">
                          {summary.poorCondition} Poor
                        </Badge>
                      </div>
                    </td>
                    <td className="p-5">
                      <Badge variant="secondary" className="font-bold text-lg px-3 py-1">
                        {summary.totalAssets}
                      </Badge>
                    </td>
                    <td className="p-5">
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={() => handleViewDetails(summary.routeId)}
                          className="h-9 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white shadow-md"
                        >
                          <FileText className="h-3 w-3 mr-2" />
                          Details
                        </Button>
                        <Link to="/gis">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-9 border-primary/30 text-primary hover:bg-primary/10"
                          >
                            <MapPin className="h-3 w-3 mr-2" />
                            GIS View
                          </Button>
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {filteredSummaries.length === 0 && (
            <div className="text-center py-16">
              <div className="inline-flex p-6 rounded-full bg-primary/10 mb-4">
                <Layers className="h-16 w-16 text-primary" />
              </div>
              <p className="text-xl font-semibold mb-2">No survey data found</p>
              <p className="text-muted-foreground mb-6">Try adjusting your search criteria</p>
              <Button onClick={() => setSearchQuery("")} className="gradient-primary text-white">
                Clear Search
              </Button>
            </div>
          )}
        </Card>
      </div>

      {/* Detailed Assets Dialog */}
      <Dialog open={isDetailDialogOpen} onOpenChange={setIsDetailDialogOpen}>
        <DialogContent className="max-w-7xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsDetailDialogOpen(false)}
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <div>
                <DialogTitle className="text-2xl">
                  {detailedData?.roadName} - Asset Details
                </DialogTitle>
                <DialogDescription className="text-base">
                  Route {detailedData?.routeId} • Surveyed on {detailedData?.surveyDate} by {detailedData?.surveyorName}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {selectedSummary && selectedSummary.surveys.length > 1 && (
            <Card className="p-4 bg-primary/5 border-primary/20">
              <div className="flex items-center gap-4">
                <Label className="font-semibold">Select Survey:</Label>
                <Select value={selectedSurveyDate} onValueChange={setSelectedSurveyDate}>
                  <SelectTrigger className="w-[280px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {selectedSummary.surveys.map((survey) => (
                      <SelectItem key={survey.surveyDate} value={survey.surveyDate}>
                        {survey.surveyDate} - {survey.surveyorName} ({survey.totalAssets} assets)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </Card>
          )}

          {detailedData && (
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full">
                <thead className="bg-gradient-to-r from-primary/5 via-accent/5 to-primary/5 border-b-2 border-primary/20">
                  <tr>
                    <th className="text-left p-4 font-bold text-sm uppercase tracking-wide">Asset ID</th>
                    <th className="text-left p-4 font-bold text-sm uppercase tracking-wide">Asset Name</th>
                    <th className="text-left p-4 font-bold text-sm uppercase tracking-wide">Category</th>
                    <th className="text-left p-4 font-bold text-sm uppercase tracking-wide">Type</th>
                    <th className="text-left p-4 font-bold text-sm uppercase tracking-wide">Location</th>
                    <th className="text-left p-4 font-bold text-sm uppercase tracking-wide">Confidence</th>
                    <th className="text-left p-4 font-bold text-sm uppercase tracking-wide">Condition</th>
                  </tr>
                </thead>
                <tbody>
                  {detailedData.assets.map((asset, idx) => (
                    <tr
                      key={asset.id}
                      className="border-b hover:bg-primary/5 transition-colors"
                    >
                      <td className="p-4">
                        <Badge variant="outline" className="font-mono font-bold">
                          {asset.assetCode}
                        </Badge>
                      </td>
                      <td className="p-4 font-semibold">{asset.type}</td>
                      <td className="p-4">
                        <Badge variant="secondary" className="text-xs">
                          {asset.category}
                        </Badge>
                      </td>
                      <td className="p-4 text-sm text-muted-foreground">{asset.type}</td>
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <MapPin className="h-3 w-3 text-muted-foreground" />
                          <span className="text-xs font-mono">
                            {asset.lat.toFixed(4)}, {asset.lng.toFixed(4)}
                          </span>
                        </div>
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-2 bg-muted rounded-full overflow-hidden">
                            <div 
                              className="h-full bg-gradient-to-r from-primary to-accent"
                              style={{ width: `${asset.confidence * 100}%` }}
                            />
                          </div>
                          <span className="text-xs font-bold text-primary">
                            {(asset.confidence * 100).toFixed(0)}%
                          </span>
                        </div>
                      </td>
                      <td className="p-4">
                        <Badge variant="outline" className={cn("font-semibold", getConditionColor(asset.condition))}>
                          {asset.condition}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

function Label({ children, className }: { children: React.ReactNode; className?: string }) {
  return <label className={cn("text-sm font-medium", className)}>{children}</label>;
}
