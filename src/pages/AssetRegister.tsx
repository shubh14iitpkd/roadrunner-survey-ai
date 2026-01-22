import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Search, MapPin, TrendingUp, CheckCircle, AlertTriangle,
  FileText, ArrowLeft, Calendar, User, Layers, Map, Package, BarChart3,
  ChevronLeft, ChevronRight
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
import { isDemoVideo, loadDemoData, convertToAssets, ANNOTATION_CATEGORIES } from "@/services/demoDataService";

interface Asset {
  _id: string;
  route_id: number;
  survey_id: string;
  category: string;          // Annotation category: OIA, ITS, Roadway Lighting, etc.
  asset_type?: string;       // The specific asset label (e.g., "Guardrail")
  type?: string;
  condition: string;
  confidence?: number;
  lat?: number;
  lng?: number;
  detected_at: string;
  image_url?: string;
  description?: string;
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
  const [assets, setAssets] = useState<Asset[]>([]);
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [roads, setRoads] = useState<Road[]>([]);
  const [selectedSurveyId, setSelectedSurveyId] = useState<string | null>(null);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(routeIdFromUrl);
  const [isDetailDialogOpen, setIsDetailDialogOpen] = useState(false);
  const [detailAssets, setDetailAssets] = useState<Asset[]>([]);
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [filterCondition, setFilterCondition] = useState<string>("all");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 50;

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
      const [videosResp, surveysResp, roadsResp] = await Promise.all([
        api.videos.list(),
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

      // Get videos and group by survey_id
      const videos = (videosResp?.items || []) as any[];
      const videosBySurveyMap: Record<string, any[]> = {};
      const videosByRouteMap: Record<number, any[]> = {};

      videos.forEach((video: any) => {
        const surveyId = typeof video.survey_id === 'object' && video.survey_id.$oid
          ? video.survey_id.$oid
          : String(video.survey_id || '');

        if (!videosBySurveyMap[surveyId]) videosBySurveyMap[surveyId] = [];
        videosBySurveyMap[surveyId].push(video);

        const routeId = video.route_id;
        if (routeId) {
          if (!videosByRouteMap[routeId]) videosByRouteMap[routeId] = [];
          videosByRouteMap[routeId].push(video);
        }
      });

      // Filter surveys to only those that have videos
      const surveysWithVideos = normalizedSurveys.filter((survey: any) =>
        videosBySurveyMap[survey._id]?.length > 0
      );

      // Get the latest survey per route (for KPI counting)
      const latestSurveyByRoute: Record<number, any> = {};
      surveysWithVideos.forEach((survey: any) => {
        const routeId = survey.route_id;
        if (!latestSurveyByRoute[routeId] ||
          new Date(survey.survey_date) > new Date(latestSurveyByRoute[routeId].survey_date)) {
          latestSurveyByRoute[routeId] = survey;
        }
      });

      // Create a set of latest survey IDs for quick lookup
      const latestSurveyIds = new Set(Object.values(latestSurveyByRoute).map(s => s._id));

      // Pre-load demo data ONLY for videos belonging to the latest survey per route
      const allAssets: Asset[] = [];
      const processedDemoKeys = new Set<string>(); // Avoid duplicate demo data loading

      for (const video of videos) {
        const surveyId = typeof video.survey_id === 'object' && video.survey_id.$oid
          ? video.survey_id.$oid
          : String(video.survey_id || '');

        // Only process videos from the latest survey for each route
        if (!latestSurveyIds.has(surveyId)) {
          continue;
        }

        const demoKey = isDemoVideo(video.title || '');
        if (demoKey && !processedDemoKeys.has(demoKey)) {
          processedDemoKeys.add(demoKey); // Mark as processed to avoid duplicates

          try {
            const demoData = await loadDemoData(demoKey);
            if (demoData) {
              const demoAssets = convertToAssets(demoData, video.route_id || 0, surveyId);
              allAssets.push(...demoAssets as Asset[]);
            }
          } catch (err) {
            console.warn(`Failed to load demo data for ${demoKey}:`, err);
          }
        }
        // For non-demo videos, we could try to load metadata here too if needed
      }

      setAssets(allAssets);
      setSurveys(surveysWithVideos);
      setRoads(roadsResp?.items || []);
    } catch (err: any) {
      toast.error("Failed to load data: " + (err?.message || "Unknown error"));
    } finally {
      setLoading(false);
    }
  };

  const loadSurveyAssets = async (surveyId: string) => {
    try {
      // Get videos for this survey
      const videosResp = await api.videos.list({ survey_id: surveyId });
      const videos = videosResp?.items || [];

      if (videos.length === 0) {
        toast.error("No videos found for this survey");
        return;
      }

      // Fetch assets for all videos
      const allAssets: Asset[] = [];

      for (const video of videos) {
        const videoId = typeof video._id === 'object' && video._id.$oid
          ? video._id.$oid
          : String(video._id);

        // Check if this is a demo video
        const demoKey = isDemoVideo(video.title || '');

        if (demoKey) {
          // For demo videos, load data directly from JSON files
          console.log(`Loading demo data for video ${videoId} (key: ${demoKey})`);
          const demoData = await loadDemoData(demoKey);

          if (demoData) {
            const demoAssets = convertToAssets(demoData, video.route_id || 0, surveyId);
            allAssets.push(...demoAssets as Asset[]);
            console.log(`Loaded ${demoAssets.length} demo assets for ${demoKey}`);
          }
          continue;
        }

        // For non-demo videos, try to load from metadata
        try {
          const metadataResp = await api.videos.getMetadata(videoId);
          const metadata = metadataResp?.metadata || [];

          // Convert metadata frames to assets
          metadata.forEach((frame: any) => {
            if (frame.detections && Array.isArray(frame.detections)) {
              frame.detections.forEach((detection: any, index: number) => {
                allAssets.push({
                  _id: `${videoId}_frame${frame.frame_number}_det${index}`,
                  route_id: video.route_id || 0,
                  survey_id: surveyId,
                  category: detection.class_name || 'Unknown',
                  type: detection.class_name || 'Unknown',
                  condition: detection.confidence > 0.8 ? 'good' : 'damaged',
                  confidence: detection.confidence,
                  lat: frame.lat,
                  lng: frame.lon,
                  detected_at: video.created_at || new Date().toISOString(),
                  image_url: frame.frame_path,
                  description: `${detection.class_name} detected with ${(detection.confidence * 100).toFixed(0)}% confidence at timestamp ${frame.timestamp.toFixed(1)}s`
                });
              });
            }
          });
        } catch (metaErr: any) {
          console.warn(`No metadata for video ${videoId}:`, metaErr.message);
        }
      }

      if (allAssets.length === 0) {
        toast.info("No AI detections found for this survey. Process the video with AI first.");
      }

      setDetailAssets(allAssets);
      setSelectedSurveyId(surveyId);
      setIsDetailDialogOpen(true);
    } catch (err: any) {
      toast.error("Failed to load assets: " + (err?.message || "Unknown error"));
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

  // Calculate KPIs - based on pre-loaded assets
  const totalRoads = roads.length;
  const surveyedRoads = enrichedRoads.length; // Only roads with surveys/videos
  // Asset counts from pre-loaded demo data
  const totalAssets = assets.length;
  const totalGood = assets.filter(a => a.condition?.toLowerCase() === 'good').length;
  const totalDamaged = assets.filter(a => a.condition?.toLowerCase() === 'damaged').length;

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

  // Get unique categories for filter
  const categories = Array.from(new Set(assets.map(a => a.category).filter(Boolean)));

  return (
    <div className="space-y-6">
      {/* Hero Header */}
      <div className="relative overflow-hidden gradient-primary p-8 shadow-elevated">
        <div className="absolute bg-primary inset-0"></div>
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
                <Map className="h-7 w-7 text-white" />
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
                <p className="text-5xl font-bold bg-gradient-to-br from-green-600 to-green-400 bg-clip-text text-transparent">{Number(totalGood).toLocaleString("en-US")}</p>
                {/* <p className="text-xs font-medium text-muted-foreground">{totalAssets > 0 ? ((totalGood / totalAssets) * 100).toFixed(0) : 0}% of total</p> */}
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
                <p className="text-5xl font-bold bg-gradient-to-br from-red-600 to-red-400 bg-clip-text text-transparent">{Number(totalDamaged).toLocaleString("en-US")}</p>
                {/* <p className="text-xs font-medium text-muted-foreground">Poor condition</p> */}
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
                    {/* <th className="text-left p-5 font-bold text-sm uppercase tracking-wide">Asset Condition</th> */}
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
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              loadSurveyAssets(road.surveyId!);
                            }}
                          >
                            #{road.route_id}
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
                      {/* <td className="p-5">
                        {road.hasSurvey ? (
                          <div className="flex gap-2 flex-wrap">
                            <Badge variant="outline" className="bg-gradient-to-r from-green-500/10 to-green-600/10 text-green-700 dark:text-green-400 border-green-500/30 font-semibold">
                              {road.goodCondition} Good
                            </Badge>
                            <Badge variant="outline" className="bg-gradient-to-r from-amber-500/10 to-amber-600/10 text-amber-700 dark:text-amber-400 border-amber-500/30 font-semibold">
                              {road.fairCondition} Fair
                            </Badge>
                            <Badge variant="outline" className="bg-gradient-to-r from-red-500/10 to-red-600/10 text-red-700 dark:text-red-400 border-red-500/30 font-semibold">
                              {road.poorCondition} Poor
                            </Badge>
                          </div>
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground">
                            No data
                          </Badge>
                        )}
                      </td> */}
                      <td className="p-5">
                        <div className="flex gap-2">
                          {road.surveyId ? (
                            <Button
                              size="sm"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                loadSurveyAssets(road.surveyId!);
                              }}
                              className="h-9 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white shadow-md"
                            >
                              <BarChart3 className="h-3 w-3 mr-2" />
                              Details
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
                    {Object.values(ANNOTATION_CATEGORIES)
                      .filter(category => detailAssets.some(a => a.category === category))
                      .map(category => {
                        const count = detailAssets.filter(a => a.category === category).length;
                        return (
                          <TabsTrigger key={category} value={category} className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                            {category}
                            <Badge variant="secondary" className="ml-2 text-xs">{count}</Badge>
                          </TabsTrigger>
                        );
                      })
                    }
                  </TabsList>
                </div>

                {/* Dynamic Content Based on Selected Category */}
                {(() => {
                  const selectedCategory = filterCategory;
                  const categoryAssets = selectedCategory === 'all'
                    ? detailAssets
                    : detailAssets.filter(a => a.category === selectedCategory);

                  const filteredAssets = categoryAssets.filter(
                    asset => filterCondition === 'all' || asset.condition?.toLowerCase() === filterCondition
                  );

                  // Get unique asset types (labels) for this category - use asset_type or type
                  const assetTypes = Array.from(new Set(filteredAssets.map(a => a.asset_type || a.type || a.category).filter(Boolean)));

                  // Calculate stats by type
                  const typeStats = assetTypes.map(type => {
                    const typeAssets = filteredAssets.filter(a => (a.asset_type || a.type || a.category) === type);
                    return {
                      type,
                      total: typeAssets.length,
                      good: typeAssets.filter(a => a.condition?.toLowerCase() === 'good').length,
                      damaged: typeAssets.filter(a => a.condition?.toLowerCase() === 'damaged').length,
                      avgConfidence: typeAssets.reduce((sum, a) => sum + (a.confidence || 0), 0) / (typeAssets.length || 1),
                    };
                  }).sort((a, b) => b.total - a.total);

                  const totalGood = filteredAssets.filter(a => a.condition?.toLowerCase() === 'good').length;
                  const totalDamaged = filteredAssets.filter(a => a.condition?.toLowerCase() === 'damaged').length;

                  return (
                    <div className="space-y-6">
                      {/* Category Overview KPIs */}
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <Card className="p-4 bg-gradient-to-br from-purple-50 to-white dark:from-purple-950/20 dark:to-card border-purple-200">
                          <p className="text-xs font-semibold text-purple-600 dark:text-purple-400 uppercase tracking-wide">Total Assets</p>
                          <p className="text-3xl font-bold bg-gradient-to-br from-purple-600 to-purple-400 bg-clip-text text-transparent">
                            {filteredAssets.length}
                          </p>
                          <p className="text-xs text-muted-foreground">{assetTypes.length} types</p>
                        </Card>

                        <Card className="p-4 bg-gradient-to-br from-green-50 to-white dark:from-green-950/20 dark:to-card border-green-200">
                          <p className="text-xs font-semibold text-green-600 dark:text-green-400 uppercase tracking-wide">Good</p>
                          <p className="text-3xl font-bold bg-gradient-to-br from-green-600 to-green-400 bg-clip-text text-transparent">
                            {totalGood}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {filteredAssets.length > 0 ? ((totalGood / filteredAssets.length) * 100).toFixed(0) : 0}%
                          </p>
                        </Card>

                        <Card className="p-4 bg-gradient-to-br from-red-50 to-white dark:from-red-950/20 dark:to-card border-red-200">
                          <p className="text-xs font-semibold text-red-600 dark:text-red-400 uppercase tracking-wide">Damaged</p>
                          <p className="text-3xl font-bold bg-gradient-to-br from-red-600 to-red-400 bg-clip-text text-transparent">
                            {totalDamaged}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {filteredAssets.length > 0 ? ((totalDamaged / filteredAssets.length) * 100).toFixed(0) : 0}%
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
                          {selectedCategory === 'all' ? 'Asset Types Overview' : `${selectedCategory} - Asset Types`}
                        </h3>

                        {typeStats.length > 0 ? (
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {typeStats.map(stat => (
                              <Card key={stat.type} className="p-4 bg-muted/20 hover:bg-muted/40 transition-colors">
                                <div className="flex items-center justify-between mb-3">
                                  <h4 className="font-semibold text-sm truncate flex-1" title={stat.type}>{stat.type}</h4>
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
                                  const assetType = asset.asset_type || asset.type || 'Unknown';
                                  return (
                                    <tr key={asset._id} className="border-b hover:bg-primary/5 transition-colors">
                                      <td className="p-3">
                                        <div className="flex items-center gap-2">
                                          <span className="font-semibold text-sm">{assetType}</span>
                                        </div>
                                      </td>
                                      <td className="p-3">
                                        <Badge variant="outline" className="text-xs bg-primary/5">
                                          {asset.category}
                                        </Badge>
                                      </td>
                                      <td className="p-3">
                                        {asset.lat && asset.lng ? (
                                          <div className="flex items-center gap-1 text-xs font-mono text-muted-foreground">
                                            <MapPin className="h-3 w-3" />
                                            {asset.lat.toFixed(4)}, {asset.lng.toFixed(4)}
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
