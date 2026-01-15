import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, Play, CheckCircle, Clock, AlertCircle, Video, Cloud, FileVideo, Database, TrendingUp, Calendar, MapPin, Loader2, Trash2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Link } from "react-router-dom";
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
import { useUpload, VideoStatus } from "@/contexts/UploadContext";
import VideoLibraryUpload from "@/components/VideoLibraryUpload";
import { set } from "date-fns";
import { LibraryVideoItem } from "@/contexts/UploadContext";

export default function SurveyUpload() {
  const { videos, isUploading, uploadFiles, uploadFromLibrary, uploadGpxForVideo, processWithAI, resetVideoStatus } = useUpload();
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
  // isUploading state removed (using context)

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

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!selectedRoute) {
      toast.error("Please select a route first");
      return;
    }
    if (!surveyorName) {
      toast.error("Please enter surveyor name");
      return;
    }

    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    await uploadFiles(files, selectedRoute, surveyDate, surveyorName, selectedGpxFile);

    setIsUploadDialogOpen(false);
    setSelectedGpxFile(null);
  };

  const handleLibraryFileSelect = async (item: LibraryVideoItem) => {
    const func = async () => {
      const id = await uploadFromLibrary(
        item.video_path,
        item.size_bytes,
        selectedRoute,
        surveyDate,
        surveyorName,
        item.thumb_url
      );

      // processWithAI(id);
    }
    func();
    setIsUploadDialogOpen(false);
    setSelectedGpxFile(null);
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
        <div className="absolute inset-0 bg-primary"></div>
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
            <Dialog open={isUploadDialogOpen} onOpenChange={(open) => !isUploading && setIsUploadDialogOpen(open)}>
              <DialogTrigger asChild>
                <Button className="gap-2 bg-white text-primary hover:bg-white/90 shadow-lg">
                  <Upload className="h-4 w-4" />
                  Upload Survey Data
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Upload Survey Data</DialogTitle>
                  <DialogDescription>
                    Upload video and GPX files for road survey processing
                  </DialogDescription>
                </DialogHeader>

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
                      <VideoLibraryUpload selectedRoute={selectedRoute} handleFileSelect={handleLibraryFileSelect} />
                    </div>
                  </TabsContent>
                </Tabs>
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

            {videos.length === 0 ? (
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
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gradient-to-r from-blue-50 via-indigo-50 to-purple-50 dark:from-blue-950/30 dark:via-indigo-950/30 dark:to-purple-950/30 border-b border-border">
                      <th className="text-left p-4 font-semibold text-sm">Thumbnail</th>
                      <th className="text-left p-4 font-semibold text-sm">Route ID</th>
                      <th className="text-left p-4 font-semibold text-sm">Road Name</th>
                      <th className="text-left p-4 font-semibold text-sm">Video File</th>
                      <th className="text-left p-4 font-semibold text-sm">Survey Date</th>
                      <th className="text-left p-4 font-semibold text-sm">Surveyor</th>
                      <th className="text-left p-4 font-semibold text-sm">GPX File</th>
                      <th className="text-left p-4 font-semibold text-sm">Progress / Action</th>
                      <th className="text-left p-4 font-semibold text-sm">Status</th>
                      <th className="text-left p-4 font-semibold text-sm">Delete</th>
                    </tr>
                  </thead>
                  <tbody>
                    {videos.map((video, index) => {
                      const road = roads.find(r => r.route_id === video.routeId);
                      // Use backendId first (from DB), then id, then fallback to index
                      const uniqueKey = video.backendId || video.id || `video-temp-${index}`;

                      return (
                        <tr
                          key={uniqueKey}
                          className="border-b border-border hover:bg-blue-50/70 dark:hover:bg-blue-950/30 transition-colors duration-200"
                        >
                          <td className="p-4">
                            {video.thumbnailUrl ? (
                              <div className="w-24 h-16 rounded-lg overflow-hidden shadow-md border border-border bg-muted">
                                <img
                                  src={`${API_BASE}${video.thumbnailUrl}`}
                                  alt={`Thumbnail for ${video.name}`}
                                  className="w-full h-full object-cover"
                                  onError={(e) => {
                                    e.currentTarget.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="60" viewBox="0 0 100 60"%3E%3Crect fill="%23ddd" width="100" height="60"/%3E%3Ctext x="50%25" y="50%25" fill="%23999" font-family="Arial" font-size="12" text-anchor="middle" dominant-baseline="middle"%3ENo Image%3C/text%3E%3C/svg%3E';
                                  }}
                                />
                              </div>
                            ) : (
                              <div className="w-24 h-16 rounded-lg overflow-hidden shadow-md border border-border bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-800 dark:to-gray-900 flex items-center justify-center">
                                <Video className="h-8 w-8 text-gray-400 dark:text-gray-600" />
                              </div>
                            )}
                          </td>
                          <td className="p-4">
                            <Badge variant="outline" className="font-mono font-semibold border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-400 bg-blue-50/50 dark:bg-blue-950/30">
                              #{video.routeId}
                            </Badge>
                          </td>
                          <td className="p-4">
                            <div className="font-medium">{road?.road_name || `Road ${video.routeId}`}</div>
                          </td>
                          <td className="p-4">
                            <div className="flex items-center gap-2 w-40">
                              <Video className="h-4 w-4 text-purple-500 dark:text-purple-400" />
                              <span className="font-medium truncate">{video.name}</span>
                            </div>
                          </td>
                          <td className="p-4">
                            <div className="flex items-center gap-2 text-sm">
                              <Calendar className="h-4 w-4 text-muted-foreground" />
                              <span className="text-foreground">{video.surveyDate}</span>
                            </div>
                          </td>
                          <td className="p-4 text-sm">{video.surveyorName}</td>
                          <td className="p-4">
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
                          <td className="p-4">
                            {/* Show progress when uploading/processing */}
                            {(video.status === "uploading" || video.status === "processing") && (
                              <div className="space-y-1.5 min-w-[160px]">
                                <Progress value={video.progress} className="h-2" />
                                <div className="flex items-center justify-between text-xs">
                                  <span className="font-semibold text-blue-600 dark:text-blue-400">{video.progress}%</span>
                                  {video.eta && <span className="text-muted-foreground">ETA: {video.eta}</span>}
                                </div>
                              </div>
                            )}

                            {/* Show action buttons when ready for next step */}
                            {video.status === "queue" && (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled
                                className="h-8 shadow-sm"
                              >
                                <Clock className="h-3 w-3 mr-1.5" />
                                Queued
                              </Button>
                            )}

                            {/* Show uploading status button (disabled) */}
                            {video.status === "uploading" && (
                              <Button
                                size="sm"
                                disabled
                                className="h-8 bg-gradient-to-r from-purple-500 to-purple-600 text-white shadow-sm opacity-70 cursor-not-allowed"
                              >
                                <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
                                Uploading...
                              </Button>
                            )}

                            {video.status === "uploaded" && (
                              <Button
                                size="sm"
                                onClick={() => processWithAI(video.id)}
                                className="h-8 bg-gradient-to-r from-purple-500 to-purple-600 hover:from-purple-600 hover:to-purple-700 text-white shadow-sm"
                              >
                                <Play className="h-3 w-3 mr-1.5" />
                                Process with AI
                              </Button>
                            )}

                            {/* Show processing status button (disabled) with cancel option */}
                            {video.status === "processing" && (
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  disabled
                                  className="h-8 bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-sm opacity-70 cursor-not-allowed"
                                >
                                  <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
                                  Processing...
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    resetVideoStatus(video.id);
                                    toast.info(`Reset ${video.name} to uploaded state`);
                                  }}
                                  className="h-8 border-red-300 text-red-600 hover:bg-red-50"
                                >
                                  Cancel
                                </Button>
                              </div>
                            )}

                            {/* Show retry button for errors */}
                            {video.status === "error" && (
                              <Button
                                size="sm"
                                onClick={() => processWithAI(video.id)}
                                className="h-8 bg-gradient-to-r from-orange-500 to-red-600 hover:from-orange-600 hover:to-red-700 text-white shadow-sm"
                              >
                                <Play className="h-3 w-3 mr-1.5" />
                                Retry Processing
                              </Button>
                            )}

                            {video.status === "completed" && (
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  asChild
                                  className="h-8 border-green-300 dark:border-green-800 text-green-700 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-950/30"
                                >
                                  <Link to="/assets">
                                    <Database className="h-3 w-3 mr-1.5" />
                                    Reports
                                  </Link>
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  asChild
                                  className="h-8 border-green-300 dark:border-green-800 text-green-700 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-950/30"
                                >
                                  <Link to="/videos">
                                    <Video className="h-3 w-3 mr-1.5" />
                                    Video
                                  </Link>
                                </Button>
                              </div>
                            )}
                          </td>
                          <td className="p-4">
                            <div className="flex items-center gap-2">
                              <div className="flex-shrink-0">
                                {getStatusIcon(video.status)}
                              </div>
                              <Badge
                                variant="secondary"
                                className={cn(
                                  "text-xs font-medium px-2.5 py-1",
                                  video.status === "completed" && "bg-green-100 dark:bg-green-950/30 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800",
                                  video.status === "processing" && "bg-blue-100 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800",
                                  video.status === "uploading" && "bg-purple-100 dark:bg-purple-950/30 text-purple-700 dark:text-purple-400 border-purple-200 dark:border-purple-800",
                                  video.status === "uploaded" && "bg-amber-100 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800",
                                  video.status === "queue" && "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700",
                                  video.status === "error" && "bg-red-100 dark:bg-red-950/30 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800"
                                )}
                              >
                                {getStatusLabel(video.status)}
                              </Badge>
                            </div>
                          </td>
                          <td className="p-4">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                // Normalize surveyId - handle MongoDB ObjectId format
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
                              className="h-8 w-8 p-0 text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
                              disabled={video.status === "uploading" || video.status === "processing" || isDeleting || !video.surveyId}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
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
    </div>
  );
}

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}
