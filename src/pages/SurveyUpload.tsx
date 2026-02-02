import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, Play, CheckCircle, Clock, AlertCircle, Video, Cloud, FileVideo, Database, TrendingUp, Calendar, MapPin, Loader2, Trash2, X, Map } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Link, useNavigate } from "react-router-dom";
import GpxMiniMap from "@/components/GpxMiniMap";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, API_BASE } from "@/lib/api";
import { useUpload, VideoStatus, VideoFile, demoDataCache } from "@/contexts/UploadContext";
import VideoLibraryUpload from "@/components/VideoLibraryUpload";
import { set } from "date-fns";
import { LibraryVideoItem } from "@/contexts/UploadContext";


export default function SurveyUpload() {
  const navigate = useNavigate();
  const { videos, isUploading, uploadFiles, uploadFromLibrary, uploadGpxForVideo, processWithAI, resetVideoStatus, loading } = useUpload();
  const [roads, setRoads] = useState<any[]>([]);
  const [selectedRoute, setSelectedRoute] = useState<string>("");
  // videos state removed (using context)
  const [surveyDate, setSurveyDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [surveyorName, setSurveyorName] = useState<string>("");
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  const [s3BucketUrl, setS3BucketUrl] = useState("");
  // gpxFiles state removed (not really needed if we just upload immediately, or we can keep local if needed for UI but context handles it)
  // Actually context doesn't expose gpxFiles map, but it updates video object.
  // The original code used gpxFiles map to store file objects for re-upload? Or just to show name?
  // It used it in handleGpxFileSelect to update state.
  // We can probably remove it and rely on video.gpxFile string.
  const [selectedGpxFile, setSelectedGpxFile] = useState<File | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [videoToDelete, setVideoToDelete] = useState<{ id: string; surveyId: string; name: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  // Video player dialog state
  const [showVideoPlayer, setShowVideoPlayer] = useState(false);
  const [selectedVideo, setSelectedVideo] = useState<VideoFile | null>(null);
  const [playerOriginalSrc, setPlayerOriginalSrc] = useState<string>("");
  const [playerAnnotatedSrc, setPlayerAnnotatedSrc] = useState<string>("");
  const [playerCategoryVideos, setPlayerCategoryVideos] = useState<Record<string, string>>({});
  const [activeCategory, setActiveCategory] = useState<string>("");
  // isUploading state removed (using context)

  // Function to open video player with category data
  const openVideoPlayer = async (video: VideoFile) => {
    setSelectedVideo(video);
    setPlayerOriginalSrc(video.backendId ? `${API_BASE}/api/videos/${video.backendId}/stream` : "");
    setPlayerAnnotatedSrc("");
    setPlayerCategoryVideos({});
    setActiveCategory("");
    setShowVideoPlayer(true);

    // Fetch video data to get category_videos if completed
    if (video.backendId && video.status === "completed") {
      try {
        const videoData = await api.videos.get(video.backendId);
        if (videoData.category_videos) {
          const catVideos: Record<string, string> = {};
          Object.entries(videoData.category_videos).forEach(([k, val]) => {
            const path = val as string;
            catVideos[k] = path.startsWith('http') ? path : `${API_BASE}${path}`;
          });
          setPlayerCategoryVideos(catVideos);
          // Set first category as active by default
          const firstCat = Object.keys(catVideos).sort()[0];
          if (firstCat) {
            setActiveCategory(firstCat);
            setPlayerAnnotatedSrc(catVideos[firstCat]);
          }
        } else if (videoData.annotated_video_url) {
          const url = videoData.annotated_video_url.startsWith('http')
            ? videoData.annotated_video_url
            : `${API_BASE}${videoData.annotated_video_url}`;
          setPlayerAnnotatedSrc(url);
        }
      } catch (err) {
        console.error("Failed to fetch video category data:", err);
      }
    }
  };

  const CATEGORY_LABELS: Record<string, string> = {
    "corridor_fence": "Corridor Fence",
    "corridor_pavement": "Pavement",
    "corridor_structure": "Structures",
    "directional_signage": "Signage",
    "its": "ITS",
    "roadway_lighting": "Lighting",
    "oia": "OIA",
    "default": "Default"
  };

  // Load roads from API
  useEffect(() => {
    (async () => {
      try {
        const resp = await api.roads.list();
        if (resp?.items) {
          setRoads(resp.items);
        }
      } catch (err: any) {
        toast.error("Failed to load roads");
      }
    })();
  }, []);

  // Load videos and polling effects removed (handled in context)

  // Calculate KPIs
  const totalUploaded = videos.filter(v => v.status === "uploaded" || v.status === "processing" || v.status === "completed").length;
  const totalProcessed = videos.filter(v => v.status === "completed").length;
  const inQueue = videos.filter(v => v.status === "queue").length;
  const processing = videos.filter(v => v.status === "uploading" || v.status === "processing").length;

  // Track uploads in progress for showing status
  const [uploadingItems, setUploadingItems] = useState<string[]>([]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!selectedRoute) {
      toast.error("Please select a route first");
      return;
    }
    if (!surveyorName?.trim()) {
      toast.error("Please enter surveyor name");
      return;
    }

    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    // Add file names to uploading list
    const fileNames = files.map(f => f.name);
    setUploadingItems(prev => [...prev, ...fileNames]);

    toast.success(`Started uploading ${files.length} video(s) in background`);

    // Don't close dialog - let user add more if needed
    // Upload runs in background
    uploadFiles(files, selectedRoute, surveyDate, surveyorName, selectedGpxFile)
      .then(() => {
        setUploadingItems(prev => prev.filter(name => !fileNames.includes(name)));
        toast.success(`Completed uploading ${files.length} video(s)`);
      })
      .catch(() => {
        setUploadingItems(prev => prev.filter(name => !fileNames.includes(name)));
      });

    // Reset file input
    e.target.value = '';
    setSelectedGpxFile(null);
  };

  const handleLibraryFileSelect = async (item: LibraryVideoItem) => {
    // Validate required fields
    if (!selectedRoute) {
      toast.error("Please select a Route ID before selecting a video");
      return;
    }
    if (!surveyorName?.trim()) {
      toast.error("Please enter Surveyor Name before selecting a video");
      return;
    }
    if (!surveyDate) {
      toast.error("Please enter Survey Date before selecting a video");
      return;
    }

    // Add to uploading list
    setUploadingItems(prev => [...prev, item.name]);
    toast.success(`Started processing "${item.name}" in background`);

    // Upload runs in background - don't close dialog
    uploadFromLibrary(
      item.video_path,
      item.size_bytes || 0,
      selectedRoute,
      surveyDate,
      surveyorName,
      item.thumb_url
    ).then(() => {
      setUploadingItems(prev => prev.filter(name => name !== item.name));
      toast.success(`Added "${item.name}" to processing queue`);
    }).catch(() => {
      setUploadingItems(prev => prev.filter(name => name !== item.name));
    });
  }

  const handleGpxFileSelect = async (e: React.ChangeEvent<HTMLInputElement>, videoId: string) => {
    const file = e.target.files?.[0];
    if (!file) return;

    await uploadGpxForVideo(file, videoId);
  };

  const handleCloudUpload = () => {
    if (!selectedRoute || !surveyorName || !s3BucketUrl) {
      toast.error("Please fill all fields");
      return;
    }
    toast.info("Cloud upload will be implemented in backend integration phase");
    setIsUploadDialogOpen(false);
  };

  const handleDeleteSurvey = async () => {
    if (!videoToDelete) return;

    setIsDeleting(true);
    try {
      await api.Surveys.delete(videoToDelete.surveyId);
      toast.success(`Successfully deleted survey and associated video: ${videoToDelete.name}`);
      // Refresh the page to reload videos
      window.location.reload();
    } catch (err: any) {
      toast.error(`Failed to delete: ${err?.message || "Unknown error"}`);
    } finally {
      setIsDeleting(false);
      setDeleteDialogOpen(false);
      setVideoToDelete(null);
    }
  };

  // simulateUpload removed

  // processWithAI removed (using context)

  const getStatusIcon = (status: VideoStatus) => {
    switch (status) {
      case "queue":
        return <Clock className="h-4 w-4 text-muted-foreground" />;
      case "uploading":
        return <Loader2 className="h-4 w-4 text-purple-500 animate-spin" />;
      case "processing":
        return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />;
      case "uploaded":
        return <CheckCircle className="h-4 w-4 text-amber-500" />;
      case "completed":
        return <CheckCircle className="h-4 w-4 text-success" />;
      case "error":
      case "failed":
        return <AlertCircle className="h-4 w-4 text-danger" />;
    }
  };

  const getStatusLabel = (status: VideoStatus) => {
    const labels: Record<string, string> = {
      queue: "In Queue for Processing",
      uploading: "Uploading",
      uploaded: "Uploaded",
      processing: "Processing with AI",
      completed: "Report Prepared",
      error: "Processing Failed - Retry",
      failed: "Processing Failed",
    };
    return labels[status] || status;
  };

  // startBatchUpload removed

  return (
    <div className="space-y-6">
      {/* Hero Header */}
      <div className="relative overflow-hidden gradient-primary p-8 shadow-elevated">
        <div className="absolute inset-0 page-header dark:bg-primary"></div>
        <div className="relative flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-4xl font-bold mb-2 text-white drop-shadow-lg">
              Survey Upload & Processing
            </h1>
            <p className="text-white/90 text-lg">
              Upload and process road survey videos with AI-powered analysis
            </p>
          </div>
          <div className="flex gap-3">
            <Link to="/videos">
              <Button variant="secondary" className="gap-2 bg-white/20 hover:bg-white/30 text-white border-white/30 backdrop-blur-sm">
                <FileVideo className="h-4 w-4" />
                Video Library
              </Button>
            </Link>
            <Dialog open={isUploadDialogOpen} onOpenChange={setIsUploadDialogOpen}>
              <DialogTrigger asChild>
                <Button className="gap-2 bg-white text-primary hover:bg-white/90 shadow-lg">
                  <Upload className="h-4 w-4" />
                  Upload Survey Data
                  {uploadingItems.length > 0 && (
                    <Badge variant="secondary" className="ml-1 bg-primary/20">
                      {uploadingItems.length}
                    </Badge>
                  )}
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    Upload Survey Data
                    {uploadingItems.length > 0 && (
                      <Badge variant="outline" className="text-xs font-normal">
                        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                        {uploadingItems.length} uploading
                      </Badge>
                    )}
                  </DialogTitle>
                  <DialogDescription>
                    Upload video and GPX files for road survey processing. You can add multiple videos - they will upload in parallel.
                  </DialogDescription>
                </DialogHeader>

                {/* Upload Queue Status */}
                {uploadingItems.length > 0 && (
                  <div className="p-3 rounded-lg bg-primary/5 border border-primary/20">
                    <div className="flex items-center gap-2 text-sm font-medium text-primary mb-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Uploading in progress...
                    </div>
                    <div className="space-y-1">
                      {uploadingItems.map((name, i) => (
                        <div key={i} className="text-xs text-muted-foreground flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                          {name}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <Tabs defaultValue="cloud" className="w-full">
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="local">Local Device</TabsTrigger>
                    <TabsTrigger value="cloud">Video Library</TabsTrigger>
                  </TabsList>

                  <TabsContent value="local" className="space-y-4 mt-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <Label htmlFor="route">Route ID *</Label>
                        <Select value={selectedRoute} onValueChange={setSelectedRoute} disabled={isUploading}>
                          <SelectTrigger>
                            <SelectValue placeholder="Choose road..." />
                          </SelectTrigger>
                          <SelectContent>
                            {roads.map((road) => (
                              <SelectItem key={road.route_id} value={road.route_id.toString()}>
                                {road.route_id} - {road.road_name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div>
                        <Label htmlFor="survey-date">Survey Date *</Label>
                        <Input
                          id="survey-date"
                          type="date"
                          value={surveyDate}
                          onChange={(e) => setSurveyDate(e.target.value)}
                          disabled={isUploading}
                        />
                      </div>

                      <div>
                        <Label htmlFor="surveyor">Surveyor Name *</Label>
                        <Input
                          id="surveyor"
                          placeholder="Enter name"
                          value={surveyorName}
                          onChange={(e) => setSurveyorName(e.target.value)}
                          disabled={isUploading}
                        />
                      </div>
                    </div>

                    <div>
                      <Label htmlFor="gpx-upload">GPX File (Optional)</Label>
                      <div className="flex items-center gap-3 mt-2">
                        <label
                          htmlFor="gpx-upload"
                          className={cn(
                            "flex items-center justify-center gap-2 px-4 py-2 border-2 border-dashed rounded-lg cursor-pointer transition-all flex-1",
                            selectedRoute && surveyorName && !isUploading
                              ? "border-teal-300 bg-teal-50/50 hover:bg-teal-100/50 dark:border-teal-700 dark:bg-teal-950/30"
                              : "border-border bg-muted/30 cursor-not-allowed opacity-60"
                          )}
                        >
                          <MapPin className="h-5 w-5 text-teal-600 dark:text-teal-400" />
                          <span className="text-sm font-medium">
                            {selectedGpxFile ? selectedGpxFile.name : "Choose GPX file"}
                          </span>
                          <input
                            id="gpx-upload"
                            type="file"
                            accept=".gpx"
                            className="hidden"
                            disabled={!selectedRoute || !surveyorName || isUploading}
                            onChange={(e) => setSelectedGpxFile(e.target.files?.[0] || null)}
                          />
                        </label>
                        {selectedGpxFile && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setSelectedGpxFile(null)}
                            disabled={isUploading}
                          >
                            Clear
                          </Button>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-2">
                        Upload a GPX file to associate GPS data with your videos
                      </p>
                    </div>

                    <label
                      htmlFor="video-upload"
                      className={cn(
                        "flex flex-col items-center justify-center w-full h-48 border-2 border-dashed rounded-lg cursor-pointer transition-all",
                        selectedRoute && surveyorName && !isUploading
                          ? "border-primary bg-primary/5 hover:bg-primary/10 hover:border-primary/60"
                          : "border-border bg-muted/30 cursor-not-allowed opacity-60"
                      )}
                    >
                      <div className="flex flex-col items-center justify-center pt-5 pb-6">
                        {isUploading ? (
                          <>
                            <Loader2 className="h-12 w-12 mb-3 text-primary animate-spin" />
                            <p className="mb-2 text-sm font-medium">Uploading files...</p>
                            <p className="text-xs text-muted-foreground">
                              Please wait while your files are being uploaded
                            </p>
                          </>
                        ) : (
                          <>
                            <Upload className="h-12 w-12 mb-3 text-primary" />
                            <p className="mb-2 text-sm font-medium">
                              {selectedRoute && surveyorName ? "Click to select videos" : "Complete the fields above first"}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              MP4, WEBM up to 500MB each • Multiple files supported
                            </p>
                          </>
                        )}
                      </div>
                      <input
                        id="video-upload"
                        type="file"
                        accept="video/*"
                        multiple
                        className="hidden"
                        disabled={!selectedRoute || !surveyorName || isUploading}
                        onChange={handleFileSelect}
                      />
                    </label>
                  </TabsContent>

                  <TabsContent value="cloud" className="space-y-4 mt-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <Label htmlFor="route-cloud">Route ID *</Label>
                        <Select value={selectedRoute} onValueChange={setSelectedRoute}>
                          <SelectTrigger>
                            <SelectValue placeholder="Choose road..." />
                          </SelectTrigger>
                          <SelectContent>
                            {roads.map((road) => (
                              <SelectItem key={road.route_id} value={road.route_id.toString()}>
                                {road.route_id} - {road.road_name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div>
                        <Label htmlFor="survey-date-cloud">Survey Date *</Label>
                        <Input
                          id="survey-date-cloud"
                          type="date"
                          value={surveyDate}
                          onChange={(e) => setSurveyDate(e.target.value)}
                        />
                      </div>

                      <div>
                        <Label htmlFor="surveyor-cloud">Surveyor Name *</Label>
                        <Input
                          id="surveyor-cloud"
                          placeholder="Enter name"
                          value={surveyorName}
                          onChange={(e) => setSurveyorName(e.target.value)}
                        />
                      </div>
                    </div>
                    <div>
                      <VideoLibraryUpload
                        selectedRoute={selectedRoute}
                        surveyorName={surveyorName}
                        surveyDate={surveyDate}
                        handleFileSelect={handleLibraryFileSelect}
                        uploadingItems={uploadingItems}
                      />
                    </div>
                  </TabsContent>
                </Tabs>

                {/* Footer with close button */}
                <div className="flex justify-end pt-4 border-t">
                  <Button variant="outline" onClick={() => setIsUploadDialogOpen(false)}>
                    {uploadingItems.length > 0 ? "Close (uploads continue in background)" : "Close"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </div>

      <div className="px-6 space-y-6">
        {/* KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <Card className="p-6 shadow-elevated border-0 bg-gradient-to-br from-blue-50 to-white dark:from-blue-950/20 dark:to-card animate-fade-in hover:shadow-glow transition-all duration-300">
            <div className="flex items-start justify-between">
              <div className="space-y-2">
                <p className="text-sm font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wide">Total Uploaded</p>
                <p className="text-5xl font-bold bg-gradient-to-br from-blue-600 to-blue-400 bg-clip-text text-transparent">{totalUploaded}</p>
                <p className="text-xs font-medium text-muted-foreground">Videos in system</p>
              </div>
              <div className="p-4 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 shadow-lg">
                <Database className="h-7 w-7 text-white" />
              </div>
            </div>
          </Card>

          <Card className="p-6 shadow-elevated border-0 bg-gradient-to-br from-green-50 to-white dark:from-green-950/20 dark:to-card animate-fade-in hover:shadow-glow transition-all duration-300">
            <div className="flex items-start justify-between">
              <div className="space-y-2">
                <p className="text-sm font-semibold text-green-600 dark:text-green-400 uppercase tracking-wide">AI Processed</p>
                <p className="text-5xl font-bold bg-gradient-to-br from-green-600 to-green-400 bg-clip-text text-transparent">{totalProcessed}</p>
                <p className="text-xs font-medium text-muted-foreground">Reports ready</p>
              </div>
              <div className="p-4 rounded-2xl bg-gradient-to-br from-green-500 to-green-600 shadow-lg">
                <CheckCircle className="h-7 w-7 text-white" />
              </div>
            </div>
          </Card>

          <Card className="p-6 shadow-elevated border-0 bg-gradient-to-br from-amber-50 to-white dark:from-amber-950/20 dark:to-card animate-fade-in hover:shadow-glow transition-all duration-300">
            <div className="flex items-start justify-between">
              <div className="space-y-2">
                <p className="text-sm font-semibold text-amber-600 dark:text-amber-400 uppercase tracking-wide">In Queue</p>
                <p className="text-5xl font-bold bg-gradient-to-br from-amber-600 to-amber-400 bg-clip-text text-transparent">{inQueue}</p>
                <p className="text-xs font-medium text-muted-foreground">Waiting to process</p>
              </div>
              <div className="p-4 rounded-2xl bg-gradient-to-br from-amber-500 to-amber-600 shadow-lg">
                <Clock className="h-7 w-7 text-white" />
              </div>
            </div>
          </Card>

          <Card className="p-6 shadow-elevated border-0 bg-gradient-to-br from-purple-50 to-white dark:from-purple-950/20 dark:to-card animate-fade-in hover:shadow-glow transition-all duration-300">
            <div className="flex items-start justify-between">
              <div className="space-y-2">
                <p className="text-sm font-semibold text-purple-600 dark:text-purple-400 uppercase tracking-wide">Processing</p>
                <p className="text-5xl font-bold bg-gradient-to-br from-purple-600 to-purple-400 bg-clip-text text-transparent">{processing}</p>
                <p className="text-xs font-medium text-muted-foreground">Active tasks</p>
              </div>
              <div className="p-4 rounded-2xl bg-gradient-to-br from-purple-500 to-purple-600 shadow-lg">
                <TrendingUp className="h-7 w-7 text-white" />
              </div>
            </div>
          </Card>
        </div>

        {/* Processing Queue - Always Visible */}
        {(
          <Card className="p-8 shadow-elevated border-0 gradient-card animate-fade-in">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="font-bold text-2xl mb-1">
                  {videos.length > 0 ? `Processing Queue` : 'Processing Queue'}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {videos.length > 0 ? `${videos.length} videos • ${inQueue} queued, ${processing} processing, ${totalProcessed} completed` : 'No data yet'}
                </p>
              </div>
              {inQueue > 0 && (
                <div className="text-sm text-muted-foreground">
                  {inQueue} videos in queue
                </div>
              )}
            </div>

            {loading ? (
              <div className="flex flex-col items-center justify-center py-20 animate-fade-in">
                <div className="relative w-16 h-16 mb-6">
                  <div className="absolute inset-0 border-4 border-primary/20 rounded-full" />
                  <div className="absolute inset-0 border-4 border-primary border-t-transparent rounded-full animate-spin" />
                </div>
                <h3 className="text-xl font-semibold mb-2">Loading Surveys...</h3>
                <p className="text-sm text-muted-foreground">Fetching latest survey data and AI processing status</p>
              </div>
            ) : videos.length === 0 ? (
              <div className="text-center py-16">
                <div className="inline-flex p-6 rounded-full bg-primary/10 mb-4">
                  <Database className="h-16 w-16 text-primary" />
                </div>
                <p className="text-xl font-semibold mb-2">No survey data uploaded yet</p>
                <p className="text-muted-foreground mb-6">Start by uploading your first road survey video</p>
                <Button size="lg" onClick={() => setIsUploadDialogOpen(true)} className="gradient-primary text-white">
                  <Upload className="h-4 w-4 mr-2" />
                  Upload Your First Video
                </Button>
              </div>
            ) : (
              <div className="rounded-xl border border-border overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gradient-to-r from-blue-50 via-indigo-50 to-purple-50 dark:from-blue-950/30 dark:via-indigo-950/30 dark:to-purple-950/30 border-b border-border">
                      <th className="text-left p-3 font-semibold text-sm w-24">Preview</th>
                      <th className="text-left p-3 font-semibold text-sm min-w-[140px] max-w-[200px]">Route</th>
                      <th className="text-left p-3 font-semibold text-sm w-24">Date</th>
                      <th className="text-left p-3 font-semibold text-sm w-20">Surveyor</th>
                      <th className="text-left p-3 font-semibold text-sm w-20">GPS</th>
                      <th className="text-left p-3 font-semibold text-sm w-32">Status</th>
                      <th className="text-left p-3 font-semibold text-sm">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {videos.map((video, index) => {
                      const road = roads.find(r => r.route_id === video.routeId);
                      const uniqueKey = video.backendId || video.id || `video-temp-${index}`;

                      return (
                        <tr
                          key={uniqueKey}
                          className="border-b border-border hover:bg-blue-50/70 dark:hover:bg-blue-950/30 transition-colors duration-200"
                        >
                          {/* Preview with video name tooltip */}
                          <td className="p-3">
                            <div className="relative group">
                              {video.thumbnailUrl ? (
                                <div
                                  className="w-20 h-14 rounded-lg overflow-hidden shadow-sm border border-border bg-muted cursor-pointer hover:ring-2 hover:ring-primary transition-all"
                                  onClick={() => openVideoPlayer(video)}
                                >
                                  <img
                                    src={`${API_BASE}${video.thumbnailUrl}`}
                                    alt={video.name}
                                    className="w-full h-full object-cover"
                                    onError={(e) => {
                                      e.currentTarget.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="60" viewBox="0 0 100 60"%3E%3Crect fill="%23ddd" width="100" height="60"/%3E%3Ctext x="50%25" y="50%25" fill="%23999" font-family="Arial" font-size="10" text-anchor="middle" dominant-baseline="middle"%3ENo Thumb%3C/text%3E%3C/svg%3E';
                                    }}
                                  />
                                </div>
                              ) : (
                                <div
                                  className="w-20 h-14 rounded-lg overflow-hidden shadow-sm border border-border bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-800 dark:to-gray-900 flex items-center justify-center cursor-pointer hover:ring-2 hover:ring-primary transition-all"
                                  onClick={() => openVideoPlayer(video)}
                                >
                                  <Video className="h-6 w-6 text-gray-400" />
                                </div>
                              )}
                              {/* Video name tooltip on hover */}
                              <div className="absolute left-0 bottom-full mb-1 hidden group-hover:block z-10">
                                <div className="bg-foreground text-background text-xs px-2 py-1 rounded shadow-lg whitespace-nowrap max-w-[200px] truncate">
                                  {video.name}
                                </div>
                              </div>
                            </div>
                          </td>

                          {/* Route (stacked layout with truncation) */}
                          <td className="p-3 max-w-[200px]">
                            <div className="flex flex-col gap-0.5">
                              <div className="flex items-center gap-1.5">
                                <span className="text-[10px] font-mono text-blue-600 dark:text-blue-400 uppercase tracking-wide">
                                  Route #{video.routeId}
                                </span>
                              </div>
                              <span
                                className="text-sm font-medium text-foreground leading-snug line-clamp-2"
                                title={road?.road_name || `Road ${video.routeId}`}
                              >
                                {road?.road_name || `Road ${video.routeId}`}
                              </span>
                            </div>
                          </td>

                          {/* Date */}
                          <td className="p-3">
                            <span className="text-sm text-muted-foreground">{video.surveyDate}</span>
                          </td>

                          {/* Surveyor */}
                          <td className="p-3">
                            <span className="text-sm truncate max-w-[80px] block" title={video.surveyorName}>
                              {video.surveyorName}
                            </span>
                          </td>

                          {/* GPS Mini Map */}
                          <td className="p-3">
                            {video.gpxFile ? (
                              <Link to={`/gis?id=${video.routeId}`} className="h-3 w-3">
                                <Badge variant="secondary" className="gap-1.5 text-xs font-medium bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800">
                                  <MapPin className="h-3 w-3" />
                                  Yes
                                </Badge>
                              </Link>
                            ) : (
                              <Badge variant="secondary" className="gap-1.5 text-xs font-medium bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800">
                                No
                              </Badge>
                            )}
                          </td>

                          {/* Status column */}
                          <td className="p-3">
                            <div className="flex flex-col gap-1">
                              <div className="flex items-center gap-1.5">
                                {getStatusIcon(video.status)}
                                <Badge
                                  variant="secondary"
                                  className={cn(
                                    "text-[10px] font-medium px-1.5 py-0.5",
                                    video.status === "completed" && "bg-green-100 dark:bg-green-950/30 text-green-700 dark:text-green-400",
                                    video.status === "processing" && "bg-blue-100 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400",
                                    video.status === "uploading" && "bg-purple-100 dark:bg-purple-950/30 text-purple-700 dark:text-purple-400",
                                    video.status === "uploaded" && "bg-amber-100 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400",
                                    video.status === "queue" && "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400",
                                    video.status === "error" && "bg-red-100 dark:bg-red-950/30 text-red-700 dark:text-red-400"
                                  )}
                                >
                                  {getStatusLabel(video.status)}
                                </Badge>
                              </div>
                              {/* Progress bar for uploading/processing */}
                              {(video.status === "uploading" || video.status === "processing") && (
                                <div className="flex items-center gap-2">
                                  <Progress value={video.progress} className="h-1.5 flex-1 max-w-[80px]" />
                                  <span className="text-[10px] font-medium text-primary">{video.progress}%</span>
                                </div>
                              )}
                              {/* Show detection count for completed demo videos */}
                              {video.status === "completed" && video.backendId && demoDataCache.has(video.backendId) && (
                                <span className="text-[10px] text-green-600 dark:text-green-400">
                                  {demoDataCache.get(video.backendId)?.totalDetections.toLocaleString()} detections
                                </span>
                              )}
                            </div>
                          </td>

                          {/* Actions column */}
                          <td className="p-3">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {video.status === "uploaded" && (
                                <Button
                                  size="sm"
                                  onClick={() => processWithAI(video.id)}
                                  className="h-7 text-xs bg-gradient-to-r from-purple-500 to-purple-600 hover:from-purple-600 hover:to-purple-700 text-white"
                                >
                                  <Play className="h-3 w-3 mr-1" />
                                  Process
                                </Button>
                              )}

                              {video.status === "processing" && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => {
                                    resetVideoStatus(video.id);
                                    toast.info(`Reset ${video.name}`);
                                  }}
                                  className="h-7 text-xs text-red-600 hover:bg-red-50"
                                >
                                  Cancel
                                </Button>
                              )}

                              {video.status === "error" && (
                                <Button
                                  size="sm"
                                  onClick={() => processWithAI(video.id)}
                                  className="h-7 text-xs bg-orange-500 hover:bg-orange-600 text-white"
                                >
                                  <Play className="h-3 w-3 mr-1" />
                                  Retry
                                </Button>
                              )}

                              {video.status === "completed" && (
                                <>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    asChild
                                    className="h-7 text-xs border-green-300 text-green-700 hover:bg-green-50"
                                  >
                                    <Link to={`/assets?route_id=${video.routeId}`}>
                                      <Database className="h-3 w-3 mr-1" />
                                      Reports
                                    </Link>
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    asChild
                                    className="h-7 text-xs border-blue-300 text-blue-700 hover:bg-blue-50"
                                  >
                                    <Link to={`/gis?id=${video.routeId}`}>
                                      <Map className="h-3 w-3 mr-1" />
                                      Map
                                    </Link>
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => openVideoPlayer(video)}
                                    className="h-7 w-7 p-0 text-purple-600 hover:bg-purple-50"
                                  >
                                    <Video className="h-3 w-3" />
                                  </Button>
                                </>
                              )}

                              {video.status === "queue" && (
                                <span className="text-xs text-muted-foreground">Waiting...</span>
                              )}

                              {/* Delete button */}
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  const surveyIdStr = typeof video.surveyId === 'object' && video.surveyId !== null
                                    ? ((video.surveyId as any).$oid || String(video.surveyId))
                                    : (video.surveyId || '');
                                  setVideoToDelete({
                                    id: video.id,
                                    surveyId: surveyIdStr,
                                    name: video.name
                                  });
                                  setDeleteDialogOpen(true);
                                }}
                                className="h-7 w-7 p-0 text-red-400 hover:text-red-600 hover:bg-red-50"
                                disabled={video.status === "uploading" || video.status === "processing" || isDeleting || !video.surveyId}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )}
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Survey</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this survey? This will permanently delete:
              <ul className="list-disc list-inside mt-2 space-y-1">
                <li>The survey record</li>
                <li>Associated video: <strong>{videoToDelete?.name}</strong></li>
                <li>All AI detection frames and data</li>
              </ul>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteSurvey}
              disabled={isDeleting}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete Survey
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Video Player Dialog - Side by Side View with Category Switching */}
      <Dialog open={showVideoPlayer} onOpenChange={setShowVideoPlayer}>
        <DialogContent className="max-w-[95vw] h-[90vh] p-0">
          <DialogHeader className="p-6 pb-4">
            <div className="flex items-center justify-between">
              <div>
                <DialogTitle className="text-xl font-bold">
                  {selectedVideo?.name || "Video Player"}
                </DialogTitle>
                {selectedVideo && (
                  <p className="text-sm text-muted-foreground mt-1">
                    Route #{selectedVideo.routeId} • {roads.find(r => r.route_id === selectedVideo.routeId)?.road_name || `Road ${selectedVideo.routeId}`}
                  </p>
                )}
              </div>
              {/* <Button variant="ghost" size="icon" onClick={() => setShowVideoPlayer(false)}>
                <X className="h-5 w-5" />
              </Button> */}
            </div>
          </DialogHeader>

          {/* Side-by-side Video Display */}
          <div className={playerAnnotatedSrc || Object.keys(playerCategoryVideos).length > 0 ? "grid grid-cols-1 gap-4 p-6 pt-0 h-[calc(90vh-120px)]" : "p-6 pt-0 h-[calc(90vh-120px)]"}>
            {/* Right: AI Annotated Video */}
            {(playerAnnotatedSrc || Object.keys(playerCategoryVideos).length > 0) && (
              <div className="space-y-3 flex flex-col h-full">
                <Card className="p-4 gradient-card border-0">
                  {/* <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-lg">AI Annotated Video</h3>
                    <Badge className="bg-gradient-to-r from-blue-500 to-purple-500">AI Processed</Badge>
                  </div> */}
                  <p className="text-sm text-muted-foreground mt-1">Object detection with bounding boxes</p>

                  {/* Category Buttons */}
                  {Object.keys(playerCategoryVideos).length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-3 min-h-[32px]">
                      {Object.keys(playerCategoryVideos).sort().map(cat => (
                        <Button
                          key={cat}
                          size="sm"
                          variant={activeCategory === cat ? "default" : "outline"}
                          className={`text-xs h-7 ${activeCategory === cat ? "bg-blue-600 text-white" : ""}`}
                          onClick={() => {
                            const videoEl = document.getElementById('survey-annotated-video-player') as HTMLVideoElement;
                            const currentTime = videoEl ? videoEl.currentTime : 0;
                            const isPlaying = videoEl ? !videoEl.paused : false;

                            setActiveCategory(cat);
                            setPlayerAnnotatedSrc(playerCategoryVideos[cat]);

                            // Restore state after render
                            requestAnimationFrame(() => {
                              const newVideoEl = document.getElementById('survey-annotated-video-player') as HTMLVideoElement;
                              if (newVideoEl) {
                                newVideoEl.onloadedmetadata = () => {
                                  newVideoEl.currentTime = currentTime;
                                  if (isPlaying) newVideoEl.play().catch(() => { });
                                };
                              }
                            });
                          }}
                        >
                          {CATEGORY_LABELS[cat] || cat}
                        </Button>
                      ))}
                    </div>
                  )}
                </Card>

                <Card className="flex-1 overflow-hidden gradient-card border-0 flex items-center justify-center min-h-0">
                  <div className="relative w-full h-full">
                    <video
                      id="survey-annotated-video-player"
                      key={playerAnnotatedSrc}
                      src={playerAnnotatedSrc}
                      controls
                      className="absolute inset-0 w-full h-full object-contain rounded-lg"
                      onError={(e) => {
                        console.error('[SurveyUpload] Error loading annotated video:', playerAnnotatedSrc);
                      }}
                    />
                  </div>
                </Card>
              </div>
            )}

            {/* Fallback if no annotated video and original not already shown*/}
            {!playerAnnotatedSrc && Object.keys(playerCategoryVideos).length === 0 && playerOriginalSrc && (
              <div className="text-center p-8 flex flex-col items-center justify-center">
                <p className="text-muted-foreground">No AI processed video available yet</p>
                <p className="text-sm text-muted-foreground mt-1">Process this video with AI to see annotated results</p>
              </div>
            )}
          </div>

          {/* Video Info Footer */}
          {selectedVideo && (
            <div className="px-6 pb-4 pt-2 border-t flex flex-wrap gap-4 text-sm text-muted-foreground">
              <span><strong>Surveyor:</strong> {selectedVideo.surveyorName}</span>
              <span><strong>Date:</strong> {selectedVideo.surveyDate}</span>
              <span><strong>Size:</strong> {(selectedVideo.size / 1024 / 1024).toFixed(1)} MB</span>
              <span><strong>Status:</strong> {selectedVideo.status}</span>
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