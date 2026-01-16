import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Search, MapPin, TrendingUp, CheckCircle, AlertTriangle,
  FileText, ArrowLeft, Calendar, User, Layers, Map, Package, BarChart3, PieChart
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
import { api } from "@/lib/api";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Asset {
  _id: string;
  route_id: number;
  survey_id: string;
  category: string;
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
    fair: number;
    poor: number;
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
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [roads, setRoads] = useState<Road[]>([]);
  const [selectedSurveyId, setSelectedSurveyId] = useState<string | null>(null);
  const [isDetailDialogOpen, setIsDetailDialogOpen] = useState(false);
  const [detailAssets, setDetailAssets] = useState<Asset[]>([]);
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [filterCondition, setFilterCondition] = useState<string>("all");

  // Load initial data
  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [framesResp, surveysResp, roadsResp] = await Promise.all([
        api.frames.list({ has_detections: true, limit: 1000 }),
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

      // Convert frames with detections to assets
      const assetsFromFrames: Asset[] = [];
      (framesResp?.items || []).forEach((frame: any) => {
        if (frame.detections && Array.isArray(frame.detections)) {
          frame.detections.forEach((detection: any, index: number) => {
            assetsFromFrames.push({
              _id: `${frame._id}_${index}`,
              route_id: frame.route_id,
              survey_id: frame.survey_id || '',
              category: detection.class_name || 'Unknown',
              type: detection.class_name || 'Unknown',
              condition: detection.confidence > 0.8 ? 'good' : detection.confidence > 0.5 ? 'fair' : 'poor',
              confidence: detection.confidence,
              lat: frame.latitude,
              lng: frame.longitude,
              detected_at: frame.created_at || new Date().toISOString(),
              image_url: frame.frame_path,
              description: `${detection.class_name} detected with ${(detection.confidence * 100).toFixed(0)}% confidence`
            });
          });
        }
      });

      setAssets(assetsFromFrames);
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
      // First, get videos for this survey
      const videosResp = await api.videos.list({ survey_id: surveyId });
      const videos = videosResp?.items || [];

      if (videos.length === 0) {
        toast.error("No videos found for this survey");
        return;
      }

      // Fetch metadata for all videos and combine detections
      const assetsFromMetadata: Asset[] = [];

      for (const video of videos) {
        const videoId = typeof video._id === 'object' && video._id.$oid
          ? video._id.$oid
          : String(video._id);

        try {
          const metadataResp = await api.videos.getMetadata(videoId);
          const metadata = metadataResp?.metadata || [];

          // Convert metadata frames to assets
          metadata.forEach((frame: any) => {
            if (frame.detections && Array.isArray(frame.detections)) {
              frame.detections.forEach((detection: any, index: number) => {
                assetsFromMetadata.push({
                  _id: `${videoId}_frame${frame.frame_number}_det${index}`,
                  route_id: video.route_id || 0,
                  survey_id: surveyId,
                  category: detection.class_name || 'Unknown',
                  type: detection.class_name || 'Unknown',
                  condition: detection.confidence > 0.8 ? 'good' : detection.confidence > 0.5 ? 'fair' : 'poor',
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
          // Continue with other videos even if one fails
        }
      }

      if (assetsFromMetadata.length === 0) {
        toast.info("No AI detections found in metadata for this survey");
      }

      setDetailAssets(assetsFromMetadata);
      setSelectedSurveyId(surveyId);
      setIsDetailDialogOpen(true);
    } catch (err: any) {
      toast.error("Failed to load assets: " + (err?.message || "Unknown error"));
    }
  };

  // Group assets by survey
  const surveyAssetMap = assets.reduce((acc, asset) => {
    const sid = asset.survey_id;
    if (!acc[sid]) acc[sid] = [];
    acc[sid].push(asset);
    return acc;
  }, {} as Record<string, Asset[]>);

  // Group surveys by route_id (get latest survey for each road)
  const surveyByRouteMap = surveys.reduce((acc, survey) => {
    if (!acc[survey.route_id] || new Date(survey.survey_date) > new Date(acc[survey.route_id].survey_date)) {
      acc[survey.route_id] = survey;
    }
    return acc;
  }, {} as Record<number, Survey>);

  // Create enriched road data with survey/asset information
  const enrichedRoads = roads.map((road) => {
    const latestSurvey = surveyByRouteMap[road.route_id];
    const surveyAssets = latestSurvey ? (surveyAssetMap[latestSurvey._id] || []) : [];

    const goodCount = surveyAssets.filter(a => a.condition?.toLowerCase() === 'good').length;
    const fairCount = surveyAssets.filter(a => a.condition?.toLowerCase() === 'fair').length;
    const poorCount = surveyAssets.filter(a => a.condition?.toLowerCase() === 'poor').length;

    return {
      route_id: road.route_id,
      roadName: road.road_name,
      lengthKm: road.estimated_distance_km || 0,
      surveyId: latestSurvey?._id || null,
      surveyDate: latestSurvey?.survey_date || null,
      surveyorName: latestSurvey?.surveyor_name || null,
      totalAssets: surveyAssets.length,
      goodCondition: goodCount,
      fairCondition: fairCount,
      poorCondition: poorCount,
      hasSurvey: !!latestSurvey,
    };
  });

  // Filter enriched roads
  const filteredRoads = enrichedRoads.filter((road) => {
    const matchesSearch =
      road.roadName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      road.route_id.toString().includes(searchQuery.toLowerCase()) ||
      (road.surveyorName && road.surveyorName.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesSearch;
  });

  // Calculate KPIs
  const totalRoads = roads.length;
  const surveyedRoads = enrichedRoads.filter(r => r.hasSurvey).length;
  const totalAssets = assets.length;
  const totalGood = assets.filter(a => a.condition?.toLowerCase() === 'good').length;
  const totalFair = assets.filter(a => a.condition?.toLowerCase() === 'fair').length;
  const totalPoor = assets.filter(a => a.condition?.toLowerCase() === 'poor').length;

  const selectedSurvey = surveys.find(s => s._id === selectedSurveyId);
  const selectedRoad = roads.find(r => r.route_id === selectedSurvey?.route_id);

  const getConditionColor = (condition: string) => {
    const cond = condition?.toLowerCase();
    switch (cond) {
      case "good":
        return "bg-gradient-to-r from-green-500/10 to-green-600/10 text-green-700 dark:text-green-400 border-green-500/30";
      case "fair":
        return "bg-gradient-to-r from-amber-500/10 to-amber-600/10 text-amber-700 dark:text-amber-400 border-amber-500/30";
      case "poor":
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
                <p className="text-5xl font-bold bg-gradient-to-br from-purple-600 to-purple-400 bg-clip-text text-transparent">{Math.round(totalAssets / 2).toLocaleString("en-US")}</p>
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
                <p className="text-sm font-semibold text-red-600 dark:text-red-400 uppercase tracking-wide">Needs Attention</p>
                <p className="text-5xl font-bold bg-gradient-to-br from-red-600 to-red-400 bg-clip-text text-transparent">{Number(totalPoor).toLocaleString("en-US")}</p>
                {/* <p className="text-xs font-medium text-muted-foreground">Poor condition</p> */}
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
                    <th className="text-left p-5 font-bold text-sm uppercase tracking-wide">Total Assets</th>
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
                        <Badge variant="secondary" className="font-bold text-lg px-3 py-1">
                          {road.totalAssets}
                        </Badge>
                      </td>
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
              {/* Analytics Dashboard */}
              <div className="space-y-6">
                {/* KPI Summary Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <Card className="p-4 bg-gradient-to-br from-purple-50 to-white dark:from-purple-950/20 dark:to-card border-purple-200">
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-purple-600 dark:text-purple-400 uppercase tracking-wide">Total Detected</p>
                      <p className="text-3xl font-bold bg-gradient-to-br from-purple-600 to-purple-400 bg-clip-text text-transparent">
                        {detailAssets.length}
                      </p>
                      <p className="text-xs text-muted-foreground">AI-detected assets</p>
                    </div>
                  </Card>

                  <Card className="p-4 bg-gradient-to-br from-green-50 to-white dark:from-green-950/20 dark:to-card border-green-200">
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-green-600 dark:text-green-400 uppercase tracking-wide">Good Condition</p>
                      <p className="text-3xl font-bold bg-gradient-to-br from-green-600 to-green-400 bg-clip-text text-transparent">
                        {detailAssets.filter(a => a.condition?.toLowerCase() === 'good').length}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {detailAssets.length > 0 ? ((detailAssets.filter(a => a.condition?.toLowerCase() === 'good').length / detailAssets.length) * 100).toFixed(0) : 0}% of total
                      </p>
                    </div>
                  </Card>

                  <Card className="p-4 bg-gradient-to-br from-amber-50 to-white dark:from-amber-950/20 dark:to-card border-amber-200">
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-amber-600 dark:text-amber-400 uppercase tracking-wide">Fair Condition</p>
                      <p className="text-3xl font-bold bg-gradient-to-br from-amber-600 to-amber-400 bg-clip-text text-transparent">
                        {detailAssets.filter(a => a.condition?.toLowerCase() === 'fair').length}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {detailAssets.length > 0 ? ((detailAssets.filter(a => a.condition?.toLowerCase() === 'fair').length / detailAssets.length) * 100).toFixed(0) : 0}% of total
                      </p>
                    </div>
                  </Card>

                  {/* <Card className="p-4 bg-gradient-to-br from-red-50 to-white dark:from-red-950/20 dark:to-card border-red-200">
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-red-600 dark:text-red-400 uppercase tracking-wide">Poor Condition</p>
                      <p className="text-3xl font-bold bg-gradient-to-br from-red-600 to-red-400 bg-clip-text text-transparent">
                        {detailAssets.filter(a => a.condition?.toLowerCase() === 'poor').length}
                      </p>
                      <p className="text-xs text-muted-foreground">Needs attention</p>
                    </div>
                  </Card> */}
                </div>

                {/* Charts Row */}
                <div className="grid grid-cols-1 md:grid-cols-1 gap-6">
                  {/* Condition Distribution Chart */}
                  {/* <Card className="p-6">
                    <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                      <PieChart className="h-5 w-5 text-primary" />
                      Condition Distribution
                    </h3>
                    <div className="space-y-3">
                      {[
                        { label: 'Good', count: detailAssets.filter(a => a.condition?.toLowerCase() === 'good').length, color: 'bg-green-500', textColor: 'text-green-700' },
                        { label: 'Fair', count: detailAssets.filter(a => a.condition?.toLowerCase() === 'fair').length, color: 'bg-amber-500', textColor: 'text-amber-700' },
                        { label: 'Poor', count: detailAssets.filter(a => a.condition?.toLowerCase() === 'poor').length, color: 'bg-red-500', textColor: 'text-red-700' },
                      ].map(item => {
                        const percentage = detailAssets.length > 0 ? (item.count / detailAssets.length) * 100 : 0;
                        return (
                          <div key={item.label}>
                            <div className="flex items-center justify-between mb-1">
                              <span className={`text-sm font-semibold ${item.textColor}`}>{item.label}</span>
                              <span className="text-sm font-bold">{item.count} ({percentage.toFixed(0)}%)</span>
                            </div>
                            <div className="w-full h-3 bg-muted rounded-full overflow-hidden">
                              <div
                                className={`h-full ${item.color} transition-all duration-500`}
                                style={{ width: `${percentage}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </Card> */}

                  {/* Category Distribution Chart */}
                  <Card className="p-6">
                    <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                      <BarChart3 className="h-5 w-5 text-primary dark:text-foreground" />
                      Asset Categories
                    </h3>
                    <div className="space-y-3">
                      {Array.from(new Set(detailAssets.map(a => a.category).filter(Boolean)))
                        .map(category => {
                          const count = detailAssets.filter(a => a.category === category).length;
                          const percentage = detailAssets.length > 0 ? (count / detailAssets.length) * 100 : 0;
                          return (
                            <div key={category}>
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-sm font-semibold text-primary dark:text-foreground">{category}</span>
                                <span className="text-sm font-bold">{count} ({percentage.toFixed(0)}%)</span>
                              </div>
                              <div className="w-full h-3 bg-muted rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-gradient-to-r from-blue-500 to-purple-500 transition-all duration-500"
                                  style={{ width: `${percentage}%` }}
                                />
                              </div>
                            </div>
                          );
                        })
                      }
                    </div>
                  </Card>
                </div>

                {/* Confidence Score Distribution */}
                <Card className="p-6">
                  <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                    <TrendingUp className="h-5 w-5 text-primary" />
                    AI Confidence Scores
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {[
                      { label: 'High Confidence (>80%)', min: 0.8, color: 'from-green-500 to-green-600' },
                      { label: 'Medium Confidence (50-80%)', min: 0.5, max: 0.8, color: 'from-amber-500 to-amber-600' },
                      { label: 'Low Confidence (<50%)', max: 0.5, color: 'from-red-500 to-red-600' },
                    ].map(range => {
                      const count = detailAssets.filter(a => {
                        const conf = a.confidence || 0;
                        if (range.max && range.min) return conf >= range.min && conf < range.max;
                        if (range.min) return conf >= range.min;
                        if (range.max) return conf < range.max;
                        return false;
                      }).length;
                      const avgConf = detailAssets.filter(a => {
                        const conf = a.confidence || 0;
                        if (range.max && range.min) return conf >= range.min && conf < range.max;
                        if (range.min) return conf >= range.min;
                        if (range.max) return conf < range.max;
                        return false;
                      }).reduce((sum, a) => sum + (a.confidence || 0), 0) / (count || 1);

                      return (
                        <Card key={range.label} className="p-4 bg-gradient-to-br from-slate-50 to-white dark:from-slate-950/20 dark:to-card">
                          <p className="text-xs font-semibold text-muted-foreground mb-2">{range.label}</p>
                          <p className="text-2xl font-bold mb-1">{count}</p>
                          <p className="text-xs text-muted-foreground">Avg: {(avgConf * 100).toFixed(0)}%</p>
                          <div className={`w-full h-2 bg-gradient-to-r ${range.color} rounded-full mt-2`}
                               style={{ opacity: count > 0 ? 1 : 0.2 }} />
                        </Card>
                      );
                    })}
                  </div>
                </Card>
              </div>

              {/* Filters */}
              <div className="flex gap-4 pt-4">
                <Select value={filterCategory} onValueChange={setFilterCategory}>
                  <SelectTrigger className="w-[200px]">
                    <SelectValue placeholder="All Categories" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Categories</SelectItem>
                    {categories.map((cat) => (
                      <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={filterCondition} onValueChange={setFilterCondition}>
                  <SelectTrigger className="w-[200px]">
                    <SelectValue placeholder="All Conditions" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Conditions</SelectItem>
                    <SelectItem value="good">Good</SelectItem>
                    <SelectItem value="fair">Fair</SelectItem>
                    <SelectItem value="poor">Poor</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          ) : null}

          {detailAssets.length > 0 ? (
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full">
                <thead className="bg-gradient-to-r from-primary/5 via-accent/5 to-primary/5 border-b-2 border-primary/20">
                  <tr>
                    <th className="text-left p-4 font-bold text-sm uppercase tracking-wide">Asset ID</th>
                    <th className="text-left p-4 font-bold text-sm uppercase tracking-wide">Category</th>
                    <th className="text-left p-4 font-bold text-sm uppercase tracking-wide">Type</th>
                    <th className="text-left p-4 font-bold text-sm uppercase tracking-wide">Location</th>
                    <th className="text-left p-4 font-bold text-sm uppercase tracking-wide">Confidence</th>
                    <th className="text-left p-4 font-bold text-sm uppercase tracking-wide">Condition</th>
                    <th className="text-left p-4 font-bold text-sm uppercase tracking-wide">Detected</th>
                  </tr>
                </thead>
                <tbody>
                  {detailAssets
                    .filter(asset => filterCategory === 'all' || asset.category === filterCategory)
                    .filter(asset => filterCondition === 'all' || asset.condition?.toLowerCase() === filterCondition)
                    .map((asset) => (
                    <tr
                      key={asset._id}
                      className="border-b hover:bg-primary/5 transition-colors"
                    >
                      <td className="p-4">
                        <Badge variant="outline" className="font-mono font-bold">
                          {asset._id.substring(0, 8)}
                        </Badge>
                      </td>
                      <td className="p-4">
                        <Badge variant="secondary" className="text-xs">
                          {asset.category || "Unknown"}
                        </Badge>
                      </td>
                      <td className="p-4 font-semibold">{asset.type || asset.category}</td>
                      <td className="p-4">
                        {asset.lat && asset.lng ? (
                          <div className="flex items-center gap-2">
                            <MapPin className="h-3 w-3 text-muted-foreground" />
                            <span className="text-xs font-mono">
                              {asset.lat.toFixed(4)}, {asset.lng.toFixed(4)}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="p-4">
                        {asset.confidence ? (
                          <div className="flex items-center gap-2">
                            <div className="w-16 h-2 bg-muted rounded-full overflow-hidden">
                              <div
                                className="h-full bg-gradient-to-r from-primary to-accent"
                                style={{ width: `${asset.confidence * 100}%` }}
                              />
                            </div>
                            <span className="text-xs font-bold text-primary dark:text-foreground">
                              {(asset.confidence * 100).toFixed(0)}%
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="p-4">
                        <Badge variant="outline" className={cn("font-semibold capitalize", getConditionColor(asset.condition))}>
                          {asset.condition || "Unknown"}
                        </Badge>
                      </td>
                      <td className="p-4 text-xs text-muted-foreground">
                        {new Date(asset.detected_at).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
