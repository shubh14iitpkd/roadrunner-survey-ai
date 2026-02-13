import { useState, useEffect, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Search, MapPin, TrendingUp, CheckCircle, AlertTriangle,
  FileText, ArrowLeft, Calendar, User, Layers, Map as MapIcon, Package, BarChart3,
  ChevronLeft, ChevronRight, Loader2
} from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useLabelMap } from "@/contexts/LabelMapContext";

interface Asset {
  _id: string;
  asset_id?: string;
  category_id?: string;
  asset_type?: string;
  type?: string;
  condition: string;
  confidence?: number;
  route_id?: number;
  survey_id?: string;
  video_id?: string;
  video_key?: string;
  frame_number?: number;
  timestamp?: number;
  time?: number;
  location?: { type: string; coordinates: [number, number] };
}

interface Survey {
  _id: string;
  route_id: number;
  survey_date: string;
  surveyor_name: string;
  status: string;
  totals?: {
    total_assets: number;
    good: number;
    damaged: number;
  };
}

interface Road {
  route_id: number;
  road_name: string;
  start_point_name?: string;
  end_point_name?: string;
  estimated_distance_km?: number;
}

export default function AssetRegister() {
  const [searchParams] = useSearchParams();
  const routeIdFromUrl = searchParams.get('route_id');

  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [roads, setRoads] = useState<Road[]>([]);
  const [selectedSurveyId, setSelectedSurveyId] = useState<string | null>(null);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(routeIdFromUrl);
  const [isDetailDialogOpen, setIsDetailDialogOpen] = useState(false);
  const [detailAssets, setDetailAssets] = useState<Asset[]>([]);
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [filterCondition, setFilterCondition] = useState<string>("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [loadingSurveyId, setLoadingSurveyId] = useState<string | null>(null);
  const itemsPerPage = 50;
  const { data: labelMapData } = useLabelMap();

  // Reset page when filters or detail assets change
  useEffect(() => {
    setCurrentPage(1);
  }, [filterCategory, filterCondition, detailAssets]);

  // Update selectedRouteId if URL changes
  useEffect(() => {
    setSelectedRouteId(routeIdFromUrl);
  }, [routeIdFromUrl]);

  // Auto-load survey assets when route_id is in URL
  useEffect(() => {
    if (routeIdFromUrl && !loading && surveys.length > 0) {
      const matchingSurvey = surveys.find(s => s.route_id.toString() === routeIdFromUrl);
      if (matchingSurvey) {
        loadSurveyAssets(matchingSurvey._id);
      }
    }
  }, [routeIdFromUrl, loading, surveys]);

  // Load initial data
  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [surveysResp, roadsResp] = await Promise.all([
        api.Surveys.list({ latest_only: true }),
        api.roads.list(),
      ]);

      // Normalize survey IDs to strings (handle MongoDB ObjectId format)
      const normalizedSurveys = (surveysResp?.items || []).map((survey: any) => ({
        ...survey,
        _id: typeof survey._id === 'object' && survey._id.$oid
          ? survey._id.$oid
          : String(survey._id)
      }));

      setSurveys(normalizedSurveys);
      setRoads(roadsResp?.items || []);
    } catch (err: any) {
      toast.error("Failed to load data: " + (err?.message || "Unknown error"));
    } finally {
      setLoading(false);
    }
  };

  const loadSurveyAssets = async (surveyId: string) => {
    try {
      setLoadingSurveyId(surveyId);

      const resp = await api.assets.list({ survey_id: surveyId });
      const items: Asset[] = (resp?.items || []).map((asset: any) => ({
        ...asset,
        _id: typeof asset._id === 'object' && asset._id.$oid
          ? asset._id.$oid
          : String(asset._id),
      }));

      if (items.length === 0) {
        toast.info("No AI detections found for this survey. Process the video with AI first.");
      }

      setDetailAssets(items);
      setSelectedSurveyId(surveyId);
      setFilterCategory("all");
      setFilterCondition("all");
      setIsDetailDialogOpen(true);
    } catch (err: any) {
      toast.error("Failed to load assets: " + (err?.message || "Unknown error"));
    } finally {
      setLoadingSurveyId(null);
    }
  };

  // Group surveys by route_id (get latest survey for each road)
  const surveyByRouteMap = surveys.reduce((acc, survey) => {
    if (!acc[survey.route_id] || new Date(survey.survey_date) > new Date(acc[survey.route_id].survey_date)) {
      acc[survey.route_id] = survey;
    }
    return acc;
  }, {} as Record<number, Survey>);

  // Create enriched road data - only for roads that have surveys
  const enrichedRoads = roads
    .filter((road) => surveyByRouteMap[road.route_id]) // Only roads with surveys
    .map((road) => {
      const latestSurvey = surveyByRouteMap[road.route_id];

      return {
        route_id: road.route_id,
        roadName: road.road_name,
        lengthKm: road.estimated_distance_km || 0,
        surveyId: latestSurvey?._id || null,
        surveyDate: latestSurvey?.survey_date || null,
        surveyorName: latestSurvey?.surveyor_name || null,
        hasSurvey: !!latestSurvey,
      };
    });

  // Filter enriched roads based on search
  const filteredRoads = enrichedRoads.filter((road) => {
    // If route_id is specified in URL, only show that road
    if (selectedRouteId && road.route_id.toString() !== selectedRouteId) {
      return false;
    }

    const matchesSearch =
      road.roadName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      road.route_id.toString().includes(searchQuery.toLowerCase()) ||
      (road.surveyorName && road.surveyorName.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesSearch;
  });

  // Calculate KPIs from survey totals
  const totalRoads = roads.length;
  const surveyedRoads = enrichedRoads.length;
  const latestSurveys = Object.values(surveyByRouteMap);
  const totalAssets = latestSurveys.reduce((sum, s) => sum + (s.totals?.total_assets || 0), 0);
  const totalGood = latestSurveys.reduce((sum, s) => sum + (s.totals?.good || 0), 0);
  const totalDamaged = latestSurveys.reduce((sum, s) => sum + (s.totals?.damaged || 0), 0);

  const selectedSurvey = surveys.find(s => s._id === selectedSurveyId);
  const selectedRoad = roads.find(r => r.route_id === selectedSurvey?.route_id);

  const getConditionColor = (condition: string) => {
    const cond = condition?.toLowerCase();
    switch (cond) {
      case "good":
        return "bg-gradient-to-r from-green-500/10 to-green-600/10 text-green-700 dark:text-green-400 border-green-500/30";
      case "damaged":
        return "bg-gradient-to-r from-red-500/10 to-red-600/10 text-red-700 dark:text-red-400 border-red-500/30";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  // Helper to resolve category display name from category_id
  const getCategoryDisplayName = (categoryId: string) => {
    return labelMapData?.categories?.[categoryId]?.display_name
      || labelMapData?.categories?.[categoryId]?.default_name
      || categoryId;
  };

  // Helper to resolve asset display name from asset_id
  const getAssetDisplayName = (asset: Asset) => {
    if (asset.asset_id && labelMapData?.labels?.[asset.asset_id]?.display_name) {
      return labelMapData.labels[asset.asset_id].display_name;
    }
    return asset.asset_type || asset.type || 'Unknown';
  };

  // Unique category_ids from detail assets for tabs
  const detailCategories = useMemo(() => {
    const cats = new Set<string>();
    detailAssets.forEach(a => {
      if (a.category_id) cats.add(a.category_id);
    });
    return Array.from(cats);
  }, [detailAssets]);

  return (
    <div className="space-y-6">
      {/* Hero Header */}
      <div className="relative overflow-hidden gradient-primary p-8 shadow-elevated">
        <div className="absolute page-header dark:bg-primary inset-0"></div>
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
                <p className="text-sm font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wide">Total Roads</p>
                <p className="text-5xl font-bold bg-gradient-to-br from-blue-600 to-blue-400 bg-clip-text text-transparent">{totalRoads}</p>
                <p className="text-xs font-medium text-muted-foreground">{surveyedRoads} with surveys</p>
              </div>
              <div className="p-4 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 shadow-lg">
                <MapIcon className="h-7 w-7 text-white" />
              </div>
            </div>
          </Card>

          <Card className="p-6 shadow-elevated border-0 bg-gradient-to-br from-purple-50 to-white dark:from-purple-950/20 dark:to-card animate-fade-in hover:shadow-glow transition-all duration-300">
            <div className="flex items-start justify-between">
              <div className="space-y-2">
                <p className="text-sm font-semibold text-purple-600 dark:text-purple-400 uppercase tracking-wide">Total Assets</p>
                <p className="text-5xl font-bold bg-gradient-to-br from-purple-600 to-purple-400 bg-clip-text text-transparent">{totalAssets.toLocaleString("en-US")}</p>
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
                <p className="text-5xl font-bold bg-gradient-to-br from-green-600 to-green-400 bg-clip-text text-transparent">{totalGood.toLocaleString("en-US")}</p>
              </div>
              <div className="p-4 rounded-2xl bg-gradient-to-br from-green-500 to-green-600 shadow-lg">
                <CheckCircle className="h-7 w-7 text-white" />
              </div>
            </div>
          </Card>

          <Card className="p-6 shadow-elevated border-0 bg-gradient-to-br from-red-50 to-white dark:from-red-950/20 dark:to-card animate-fade-in hover:shadow-glow transition-all duration-300">
            <div className="flex items-start justify-between">
              <div className="space-y-2">
                <p className="text-sm font-semibold text-red-600 dark:text-red-400 uppercase tracking-wide">Damaged Condition</p>
                <p className="text-5xl font-bold bg-gradient-to-br from-red-600 to-red-400 bg-clip-text text-transparent">{totalDamaged.toLocaleString("en-US")}</p>
              </div>
              <div className="p-4 rounded-2xl bg-gradient-to-br from-red-500 to-red-600 shadow-lg">
                <AlertTriangle className="h-7 w-7 text-white" />
              </div>
            </div>
          </Card>
        </div>

        {/* Search & Filters */}
        <Card className="p-4 shadow-elevated border-0 gradient-card animate-fade-in">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
              <Input
                placeholder="Search by route ID, road name, or surveyor..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-11 h-12"
              />
            </div>
            <div className="w-full md:w-64">
              <Select
                value={selectedRouteId || "all"}
                onValueChange={(val) => setSelectedRouteId(val === "all" ? null : val)}
              >
                <SelectTrigger className="h-12">
                  <SelectValue placeholder="Filter by Route" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Routes</SelectItem>
                  {roads.map((road) => (
                    <SelectItem key={road.route_id} value={road.route_id.toString()}>
                      #{road.route_id} - {road.road_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selectedRouteId && (
              <Button
                variant="outline"
                onClick={() => setSelectedRouteId(null)}
                className="h-12"
              >
                Clear Filter
              </Button>
            )}
          </div>
        </Card>

        {/* Summary Table */}
        <Card className="shadow-elevated border-0 gradient-card overflow-hidden animate-fade-in">
          {loading ? (
            <div className="p-12 text-center text-muted-foreground">
              Loading assets...
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gradient-to-r from-primary/5 via-accent/5 to-primary/5 border-b-2 border-primary/20">
                  <tr>
                    <th className="text-left p-5 font-bold text-sm uppercase tracking-wide">Route ID</th>
                    <th className="text-left p-5 font-bold text-sm uppercase tracking-wide">Road Name</th>
                    <th className="text-left p-5 font-bold text-sm uppercase tracking-wide">Length (km)</th>
                    <th className="text-left p-5 font-bold text-sm uppercase tracking-wide">Surveyor</th>
                    <th className="text-left p-5 font-bold text-sm uppercase tracking-wide">Survey Date</th>
                    <th className="text-left p-5 font-bold text-sm uppercase tracking-wide">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRoads.map((road, index) => (
                    <tr
                      key={road.route_id}
                      className="border-b hover:bg-gradient-to-r hover:from-primary/5 hover:to-transparent transition-all duration-200"
                      style={{ animationDelay: `${index * 50}ms` }}
                    >
                      <td className="p-5">
                        {road.surveyId ? (
                          <Button
                            variant="link"
                            className="font-mono font-bold text-primary hover:text-primary/80 p-0"
                            disabled={loadingSurveyId === road.surveyId}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              loadSurveyAssets(road.surveyId!);
                            }}
                          >
                            {loadingSurveyId === road.surveyId ? (
                              <Loader2 className="h-4 w-4 animate-spin mr-1" />
                            ) : (
                              "#"
                            )}
                            {road.route_id}
                          </Button>
                        ) : (
                          <span className="font-mono font-bold text-muted-foreground">#{road.route_id}</span>
                        )}
                      </td>
                      <td className="p-5 font-semibold">{road.roadName}</td>
                      <td className="p-5 font-mono">{road.lengthKm.toFixed(1)}</td>
                      <td className="p-5">
                        {road.surveyorName ? (
                          <div className="flex items-center gap-2">
                            <User className="h-4 w-4 text-muted-foreground" />
                            <span className="text-sm">{road.surveyorName}</span>
                          </div>
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="p-5">
                        {road.surveyDate ? (
                          <div className="flex items-center gap-2">
                            <Calendar className="h-4 w-4 text-muted-foreground" />
                            <span className="text-sm">{new Date(road.surveyDate).toLocaleDateString()}</span>
                          </div>
                        ) : (
                          <span className="text-sm text-muted-foreground">Not surveyed</span>
                        )}
                      </td>
                      <td className="p-5">
                        <div className="flex gap-2">
                          {road.surveyId ? (
                            <Button
                              size="sm"
                              disabled={loadingSurveyId === road.surveyId}
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                loadSurveyAssets(road.surveyId!);
                              }}
                              className="h-9 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white shadow-md min-w-[90px]"
                            >
                              {loadingSurveyId === road.surveyId ? (
                                <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                              ) : (
                                <BarChart3 className="h-3 w-3 mr-2" />
                              )}
                              {loadingSurveyId === road.surveyId ? "Loading..." : "Details"}
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled
                              className="h-9"
                            >
                              <BarChart3 className="h-3 w-3 mr-2" />
                              No Survey
                            </Button>
                          )}
                          <Link to={`/gis?road=${encodeURIComponent(road.roadName)}`}>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-9 border-primary/30 text-primary hover:bg-primary/10 dark:text-foreground dark:hover:bg-foreground/10 dark:border-foreground"
                            >
                              <MapPin className="h-3 w-3 mr-2 dark:text-foreground" />
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
          )}

          {!loading && filteredRoads.length === 0 && (
            <div className="text-center py-16">
              <div className="inline-flex p-6 rounded-full bg-primary/10 mb-4">
                <Layers className="h-16 w-16 text-primary" />
              </div>
              <p className="text-xl font-semibold mb-2">No roads found</p>
              <p className="text-muted-foreground mb-6">Try adjusting your search criteria or add roads in Road Register</p>
              <Button onClick={() => setSearchQuery("")} className="gradient-primary text-white">
                Clear Search
              </Button>
            </div>
          )}
        </Card>
      </div>

      {/* Detailed Assets Dialog with Analytics */}
      <Dialog open={isDetailDialogOpen} onOpenChange={setIsDetailDialogOpen}>
        <DialogContent className="max-w-[95vw] max-h-[90vh] overflow-y-auto">
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
                  {selectedRoad?.road_name || `Route ${selectedSurvey?.route_id}`} - AI Detection Analytics
                </DialogTitle>
                <DialogDescription className="text-base">
                  Route #{selectedSurvey?.route_id} • Surveyed on {selectedSurvey?.survey_date ? new Date(selectedSurvey.survey_date).toLocaleDateString() : ''} by {selectedSurvey?.surveyor_name}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {detailAssets.length > 0 ? (
            <>
              {/* Category Tabs Navigation */}
              <Tabs value={filterCategory} onValueChange={setFilterCategory} className="w-full">
                <div className="flex items-center justify-between mb-4">
                  <TabsList className="bg-muted/50 p-1 h-auto flex-wrap">
                    <TabsTrigger value="all" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                      All Categories
                      <Badge variant="secondary" className="ml-2 text-xs">{detailAssets.length}</Badge>
                    </TabsTrigger>
                    {detailCategories.map(categoryId => {
                      const count = detailAssets.filter(a => a.category_id === categoryId).length;
                      return (
                        <TabsTrigger key={categoryId} value={categoryId} className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                          {getCategoryDisplayName(categoryId)}
                          <Badge variant="secondary" className="ml-2 text-xs">{count}</Badge>
                        </TabsTrigger>
                      );
                    })}
                  </TabsList>
                </div>

                {/* Dynamic Content Based on Selected Category */}
                {(() => {
                  const categoryAssets = filterCategory === 'all'
                    ? detailAssets
                    : detailAssets.filter(a => a.category_id === filterCategory);

                  const filteredAssets = categoryAssets.filter(
                    asset => filterCondition === 'all' || asset.condition?.toLowerCase() === filterCondition
                  );

                  // Get unique asset types grouped by asset_id (or asset_type fallback)
                  const typeMap: Map<string, Asset[]> = new Map();
                  filteredAssets.forEach(a => {
                    const key = a.asset_id || a.asset_type || a.type || 'Unknown';
                    if (!typeMap.has(key)) typeMap.set(key, []);
                    typeMap.get(key)!.push(a);
                  });

                  const typeStats = Array.from(typeMap.entries()).map(([key, assets]) => ({
                    key,
                    asset_id: assets[0]?.asset_id,
                    displayName: getAssetDisplayName(assets[0]),
                    total: assets.length,
                    good: assets.filter(a => a.condition?.toLowerCase() === 'good').length,
                    damaged: assets.filter(a => a.condition?.toLowerCase() === 'damaged').length,
                    avgConfidence: assets.reduce((sum, a) => sum + (a.confidence || 0), 0) / (assets.length || 1),
                  })).sort((a, b) => b.total - a.total);

                  const catTotalGood = filteredAssets.filter(a => a.condition?.toLowerCase() === 'good').length;
                  const catTotalDamaged = filteredAssets.filter(a => a.condition?.toLowerCase() === 'damaged').length;

                  return (
                    <div className="space-y-6">
                      {/* Category Overview KPIs */}
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <Card className="p-4 bg-gradient-to-br from-purple-50 to-white dark:from-purple-950/20 dark:to-card border-purple-200">
                          <p className="text-xs font-semibold text-purple-600 dark:text-purple-400 uppercase tracking-wide">Total Assets</p>
                          <p className="text-3xl font-bold bg-gradient-to-br from-purple-600 to-purple-400 bg-clip-text text-transparent">
                            {filteredAssets.length}
                          </p>
                          <p className="text-xs text-muted-foreground">{typeStats.length} types</p>
                        </Card>

                        <Card className="p-4 bg-gradient-to-br from-green-50 to-white dark:from-green-950/20 dark:to-card border-green-200">
                          <p className="text-xs font-semibold text-green-600 dark:text-green-400 uppercase tracking-wide">Good</p>
                          <p className="text-3xl font-bold bg-gradient-to-br from-green-600 to-green-400 bg-clip-text text-transparent">
                            {catTotalGood}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {filteredAssets.length > 0 ? ((catTotalGood / filteredAssets.length) * 100).toFixed(0) : 0}%
                          </p>
                        </Card>

                        <Card className="p-4 bg-gradient-to-br from-red-50 to-white dark:from-red-950/20 dark:to-card border-red-200">
                          <p className="text-xs font-semibold text-red-600 dark:text-red-400 uppercase tracking-wide">Damaged</p>
                          <p className="text-3xl font-bold bg-gradient-to-br from-red-600 to-red-400 bg-clip-text text-transparent">
                            {catTotalDamaged}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {filteredAssets.length > 0 ? ((catTotalDamaged / filteredAssets.length) * 100).toFixed(0) : 0}%
                          </p>
                        </Card>

                        <Card className="p-4 bg-gradient-to-br from-blue-50 to-white dark:from-blue-950/20 dark:to-card border-blue-200">
                          <p className="text-xs font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wide">Avg Confidence</p>
                          <p className="text-3xl font-bold bg-gradient-to-br from-blue-600 to-blue-400 bg-clip-text text-transparent">
                            {(filteredAssets.reduce((sum, a) => sum + (a.confidence || 0), 0) / (filteredAssets.length || 1) * 100).toFixed(0)}%
                          </p>
                          <p className="text-xs text-muted-foreground">AI detection</p>
                        </Card>
                      </div>

                      {/* Asset Types Breakdown for Selected Category */}
                      <Card className="p-6">
                        <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                          <BarChart3 className="h-5 w-5 text-primary dark:text-foreground" />
                          {filterCategory === 'all' ? 'Asset Types Overview' : `${getCategoryDisplayName(filterCategory)} - Asset Types`}
                        </h3>

                        {typeStats.length > 0 ? (
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {typeStats.map(stat => (
                              <Card key={stat.key} className="p-4 bg-muted/20 hover:bg-muted/40 transition-colors">
                                <div className="flex items-center justify-between mb-3">
                                  <h4 className="font-semibold text-sm truncate flex-1" title={stat.displayName}>{stat.displayName}</h4>
                                  <Badge variant="secondary" className="ml-2 font-bold">{stat.total}</Badge>
                                </div>

                                {/* Condition breakdown bar */}
                                <div className="flex h-3 rounded-full overflow-hidden mb-2">
                                  {stat.good > 0 && (
                                    <div
                                      className="bg-green-500 transition-all"
                                      style={{ width: `${(stat.good / stat.total) * 100}%` }}
                                      title={`Good: ${stat.good}`}
                                    />
                                  )}
                                  {stat.damaged > 0 && (
                                    <div
                                      className="bg-red-500 transition-all"
                                      style={{ width: `${(stat.damaged / stat.total) * 100}%` }}
                                      title={`Damaged: ${stat.damaged}`}
                                    />
                                  )}
                                </div>

                                {/* Condition labels */}
                                <div className="flex justify-between text-xs text-muted-foreground">
                                  <span className="flex items-center gap-1">
                                    <span className="w-2 h-2 rounded-full bg-green-500"></span>
                                    {stat.good}
                                  </span>
                                  <span className="flex items-center gap-1">
                                    <span className="w-2 h-2 rounded-full bg-red-500"></span>
                                    {stat.damaged}
                                  </span>
                                  <span className="text-primary dark:text-foreground font-medium">
                                    {(stat.avgConfidence * 100).toFixed(0)}% conf
                                  </span>
                                </div>
                              </Card>
                            ))}
                          </div>
                        ) : (
                          <p className="text-muted-foreground text-center py-8">No assets found for the selected filters</p>
                        )}
                      </Card>

                      {/* Detailed Assets Table */}
                      <Card className="overflow-hidden">
                        <div className="p-4 border-b bg-muted/30 flex items-center justify-between">
                          <h3 className="font-bold flex items-center gap-2">
                            <FileText className="h-5 w-5" />
                            Detailed Asset List
                            <Badge variant="outline" className="ml-2">{filteredAssets.length} items</Badge>
                          </h3>
                          <Select value={filterCondition} onValueChange={setFilterCondition}>
                            <SelectTrigger className="w-[160px]">
                              <SelectValue placeholder="All Conditions" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">All Conditions</SelectItem>
                              <SelectItem value="good">Good</SelectItem>
                              <SelectItem value="damaged">Damaged</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="overflow-x-auto">
                          <table className="w-full">
                            <thead className="bg-gradient-to-r from-primary/5 via-accent/5 to-primary/5 border-b">
                              <tr>
                                <th className="text-left p-3 font-bold text-xs uppercase tracking-wide">Asset Type</th>
                                <th className="text-left p-3 font-bold text-xs uppercase tracking-wide">Category</th>
                                <th className="text-left p-3 font-bold text-xs uppercase tracking-wide">Location</th>
                                <th className="text-left p-3 font-bold text-xs uppercase tracking-wide">Confidence</th>
                                <th className="text-left p-3 font-bold text-xs uppercase tracking-wide">Condition</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(() => {
                                const totalPages = Math.ceil(filteredAssets.length / itemsPerPage);
                                const startIndex = (currentPage - 1) * itemsPerPage;
                                const paginatedAssets = filteredAssets.slice(startIndex, startIndex + itemsPerPage);

                                return paginatedAssets.map((asset) => {
                                  const assetDisplayName = getAssetDisplayName(asset);
                                  const lat = asset.location?.coordinates?.[1];
                                  const lng = asset.location?.coordinates?.[0];

                                  return (
                                    <tr key={asset._id} className="border-b hover:bg-primary/5 transition-colors">
                                      <td className="p-3">
                                        <div className="flex items-center gap-2">
                                          <span className="font-semibold text-sm">{assetDisplayName}</span>
                                        </div>
                                      </td>
                                      <td className="p-3">
                                        <Badge variant="outline" className="text-xs bg-primary/5">
                                          {asset.category_id ? getCategoryDisplayName(asset.category_id) : (asset.asset_type || '—')}
                                        </Badge>
                                      </td>
                                      <td className="p-3">
                                        {lat && lng ? (
                                          <div className="flex items-center gap-1 text-xs font-mono text-muted-foreground">
                                            <MapPin className="h-3 w-3" />
                                            {lat.toFixed(4)}, {lng.toFixed(4)}
                                          </div>
                                        ) : (
                                          <span className="text-xs text-muted-foreground">—</span>
                                        )}
                                      </td>
                                      <td className="p-3">
                                        <div className="flex items-center gap-2">
                                          <div className="w-12 h-2 bg-muted rounded-full overflow-hidden">
                                            <div
                                              className="h-full bg-gradient-to-r from-primary to-accent"
                                              style={{ width: `${(asset.confidence || 0) * 100}%` }}
                                            />
                                          </div>
                                          <span className="text-xs font-bold">
                                            {((asset.confidence || 0) * 100).toFixed(0)}%
                                          </span>
                                        </div>
                                      </td>
                                      <td className="p-3">
                                        <Badge variant="outline" className={cn("font-semibold capitalize text-xs", getConditionColor(asset.condition))}>
                                          {asset.condition || "Unknown"}
                                        </Badge>
                                      </td>
                                    </tr>
                                  );
                                });
                              })()}
                            </tbody>
                          </table>
                        </div>

                        {/* Pagination */}
                        {(() => {
                          const totalPages = Math.ceil(filteredAssets.length / itemsPerPage);
                          const startIndex = (currentPage - 1) * itemsPerPage;
                          const endIndex = Math.min(startIndex + itemsPerPage, filteredAssets.length);

                          if (totalPages <= 1) return null;

                          return (
                            <div className="flex items-center justify-between px-4 py-3 border-t bg-muted/30">
                              <div className="text-sm text-muted-foreground">
                                Showing {startIndex + 1} - {endIndex} of {filteredAssets.length} assets
                              </div>
                              <div className="flex items-center gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                  disabled={currentPage === 1}
                                  className="h-8"
                                >
                                  <ChevronLeft className="h-4 w-4 mr-1" />
                                  Previous
                                </Button>
                                <span className="text-sm font-medium px-3">
                                  Page {currentPage} of {totalPages}
                                </span>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                  disabled={currentPage === totalPages}
                                  className="h-8"
                                >
                                  Next
                                  <ChevronRight className="h-4 w-4 ml-1" />
                                </Button>
                              </div>
                            </div>
                          );
                        })()}
                      </Card>
                    </div>
                  );
                })()}
              </Tabs>
            </>
          ) : (
            <Card className="p-12 text-center border-2 border-dashed">
              <div className="inline-flex p-6 rounded-full bg-primary/10 mb-4">
                <Package className="h-16 w-16 text-primary" />
              </div>
              <h3 className="text-xl font-semibold mb-2">No Assets Detected</h3>
              <p className="text-muted-foreground mb-4">
                No AI-detected assets found for this survey yet.
              </p>
              <p className="text-sm text-muted-foreground">
                Assets will appear here after processing survey videos with AI detection.
              </p>
            </Card>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
