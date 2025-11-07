import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, Play, CheckCircle, Clock, AlertCircle, Video, Cloud, FileVideo, Database, TrendingUp, Calendar, MapPin } from "lucide-react";
import { roadRegister } from "@/data/roadRegister";
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
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type VideoStatus = "queue" | "uploading" | "uploaded" | "processing" | "completed" | "error";

interface VideoFile {
  id: string;
  name: string;
  size: number;
  duration: number;
  status: VideoStatus;
  progress: number;
  eta?: string;
  routeId: number;
  surveyDate: string;
  surveyorName: string;
  gpxFile?: string;
}

export default function SurveyUpload() {
  const [selectedRoute, setSelectedRoute] = useState<string>("");
  const [videos, setVideos] = useState<VideoFile[]>([
    {
      id: "video-1",
      name: "Doha_Corniche_Morning.mp4",
      size: 450 * 1024 * 1024, // 450 MB
      duration: 420, // 7 minutes
      status: "completed",
      progress: 100,
      routeId: 1,
      surveyDate: "2025-01-10",
      surveyorName: "Ahmed Al-Kuwari",
      gpxFile: "Doha_Corniche.gpx"
    },
    {
      id: "video-2",
      name: "Salwa_Road_Section_A.mp4",
      size: 380 * 1024 * 1024, // 380 MB
      duration: 360, // 6 minutes
      status: "processing",
      progress: 65,
      eta: "~3 min",
      routeId: 2,
      surveyDate: "2025-01-10",
      surveyorName: "Ahmed Al-Kuwari",
      gpxFile: "Salwa_Road_A.gpx"
    },
    {
      id: "video-3",
      name: "Al_Shamal_Road_North.mp4",
      size: 520 * 1024 * 1024, // 520 MB
      duration: 480, // 8 minutes
      status: "uploaded",
      progress: 100,
      routeId: 3,
      surveyDate: "2025-01-12",
      surveyorName: "Fatima Al-Thani",
      gpxFile: "Al_Shamal_North.gpx"
    },
    {
      id: "video-4",
      name: "Lusail_Expressway_West.mp4",
      size: 340 * 1024 * 1024, // 340 MB
      duration: 300, // 5 minutes
      status: "uploading",
      progress: 45,
      eta: "~8 sec",
      routeId: 4,
      surveyDate: "2025-01-13",
      surveyorName: "Mohammed Al-Mansoori",
      gpxFile: "Lusail_West.gpx"
    },
    {
      id: "video-5",
      name: "Dukhan_Highway_Central.mp4",
      size: 280 * 1024 * 1024, // 280 MB
      duration: 240, // 4 minutes
      status: "queue",
      progress: 0,
      routeId: 5,
      surveyDate: "2025-01-14",
      surveyorName: "Nasser Al-Attiyah",
      gpxFile: "Dukhan_Central.gpx"
    },
    {
      id: "video-6",
      name: "Al_Khor_Coastal_Road.mp4",
      size: 490 * 1024 * 1024, // 490 MB
      duration: 540, // 9 minutes
      status: "queue",
      progress: 0,
      routeId: 6,
      surveyDate: "2025-01-10",
      surveyorName: "Ahmed Al-Kuwari"
    },
    {
      id: "video-7",
      name: "Orbital_Highway_East.mp4",
      size: 410 * 1024 * 1024, // 410 MB
      duration: 390, // 6.5 minutes
      status: "completed",
      progress: 100,
      routeId: 7,
      surveyDate: "2025-01-12",
      surveyorName: "Fatima Al-Thani",
      gpxFile: "Orbital_East.gpx"
    }
  ]);
  const [surveyDate, setSurveyDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [surveyorName, setSurveyorName] = useState<string>("");
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  const [s3BucketUrl, setS3BucketUrl] = useState("");
  const [gpxFiles, setGpxFiles] = useState<Map<string, File>>(new Map());

  // Calculate KPIs
  const totalUploaded = videos.filter(v => v.status === "uploaded" || v.status === "processing" || v.status === "completed").length;
  const totalProcessed = videos.filter(v => v.status === "completed").length;
  const inQueue = videos.filter(v => v.status === "queue").length;
  const processing = videos.filter(v => v.status === "uploading" || v.status === "processing").length;

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!selectedRoute) {
      toast.error("Please select a route first");
      return;
    }
    if (!surveyorName) {
      toast.error("Please enter surveyor name");
      return;
    }

    const files = Array.from(e.target.files || []);
    const newVideos: VideoFile[] = files.map((file, idx) => ({
      id: `video-${Date.now()}-${idx}`,
      name: file.name,
      size: file.size,
      duration: Math.floor(Math.random() * 600) + 60, // Mock duration 1-10 min
      status: "queue",
      progress: 0,
      routeId: parseInt(selectedRoute),
      surveyDate: surveyDate,
      surveyorName: surveyorName,
    }));
    setVideos([...videos, ...newVideos]);
    toast.success(`${files.length} video(s) added to queue`);
    setIsUploadDialogOpen(false);
  };

  const handleGpxFileSelect = (e: React.ChangeEvent<HTMLInputElement>, videoId: string) => {
    const file = e.target.files?.[0];
    if (file) {
      const newGpxFiles = new Map(gpxFiles);
      newGpxFiles.set(videoId, file);
      setGpxFiles(newGpxFiles);
      
      setVideos((prev) =>
        prev.map((v) =>
          v.id === videoId ? { ...v, gpxFile: file.name } : v
        )
      );
      toast.success(`GPX file ${file.name} added`);
    }
  };

  const handleCloudUpload = () => {
    if (!selectedRoute || !surveyorName || !s3BucketUrl) {
      toast.error("Please fill all fields");
      return;
    }
    toast.info("Cloud upload will be implemented in backend integration phase");
    setIsUploadDialogOpen(false);
  };

  const simulateUpload = (videoId: string) => {
    const video = videos.find(v => v.id === videoId);
    if (!video) return;

    const uploadTime = Math.ceil((video.size / 1024 / 1024) * 2); // 2 sec per MB
    const eta = `~${uploadTime} sec`;

    setVideos((prev) =>
      prev.map((v) =>
        v.id === videoId ? { ...v, status: "uploading" as VideoStatus, eta } : v
      )
    );

    // Simulate upload progress
    let progress = 0;
    const interval = setInterval(() => {
      progress += 10;
      setVideos((prev) =>
        prev.map((v) =>
          v.id === videoId ? { ...v, progress } : v
        )
      );

      if (progress >= 100) {
        clearInterval(interval);
        setVideos((prev) =>
          prev.map((v) =>
            v.id === videoId ? { ...v, status: "uploaded" as VideoStatus, progress: 100 } : v
          )
        );
        toast.success(`${video.name} uploaded successfully`);
      }
    }, (uploadTime * 100));
  };

  const simulateProcessing = (videoId: string) => {
    const video = videos.find((v) => v.id === videoId);
    if (!video) return;

    const processingTime = Math.ceil((video.duration / 60) * 2); // 2 min per video min  
    const eta = `~${processingTime} min`;

    setVideos((prev) =>
      prev.map((v) =>
        v.id === videoId ? { ...v, status: "processing" as VideoStatus, progress: 0, eta } : v
      )
    );

    // Simulate processing progress
    let progress = 0;
    const interval = setInterval(() => {
      progress += 5;
      setVideos((prev) =>
        prev.map((v) =>
          v.id === videoId ? { ...v, progress } : v
        )
      );

      if (progress >= 100) {
        clearInterval(interval);
        setVideos((prev) =>
          prev.map((v) =>
            v.id === videoId ? { ...v, status: "completed" as VideoStatus, progress: 100, eta: undefined } : v
          )
        );
        toast.success(`Report prepared for ${video.name}`);
      }
    }, (processingTime * 60 * 10)); // Spread over total time
  };

  const getStatusIcon = (status: VideoStatus) => {
    switch (status) {
      case "queue":
        return <Clock className="h-4 w-4 text-muted-foreground" />;
      case "uploading":
      case "processing":
        return <Play className="h-4 w-4 text-accent" />;
      case "uploaded":
      case "completed":
        return <CheckCircle className="h-4 w-4 text-success" />;
      case "error":
        return <AlertCircle className="h-4 w-4 text-danger" />;
    }
  };

  const getStatusLabel = (status: VideoStatus) => {
    const labels = {
      queue: "In Queue for Uploading",
      uploading: "Uploading",
      uploaded: "Uploaded",
      processing: "Processing with AI",
      completed: "Report Prepared",
      error: "Error",
    };
    return labels[status];
  };

  const startBatchUpload = () => {
    const queuedVideos = videos.filter(v => v.status === "queue");
    if (queuedVideos.length === 0) {
      toast.error("No videos in queue");
      return;
    }
    
    // Upload videos one by one
    queuedVideos.forEach((video, index) => {
      setTimeout(() => simulateUpload(video.id), index * 500);
    });
  };

  return (
    <div className="space-y-6">
      {/* Hero Header */}
      <div className="relative overflow-hidden gradient-primary p-8 rounded-2xl shadow-elevated">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImdyaWQiIHdpZHRoPSI2MCIgaGVpZ2h0PSI2MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTSAxMCAwIEwgMCAwIDAgMTAiIGZpbGw9Im5vbmUiIHN0cm9rZT0id2hpdGUiIHN0cm9rZS1vcGFjaXR5PSIwLjEiIHN0cm9rZS13aWR0aD0iMSIvPjwvcGF0dGVybj48L2RlZnM+PHJlY3Qgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIgZmlsbD0idXJsKCNncmlkKSIvPjwvc3ZnPg==')] opacity-30"></div>
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
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Upload Survey Data</DialogTitle>
                  <DialogDescription>
                    Upload video and GPX files for road survey processing
                  </DialogDescription>
                </DialogHeader>
                
                <Tabs defaultValue="local" className="w-full">
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="local">Local Device</TabsTrigger>
                    <TabsTrigger value="cloud">Cloud (S3)</TabsTrigger>
                  </TabsList>
                  
                  <TabsContent value="local" className="space-y-4 mt-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <Label htmlFor="route">Route ID *</Label>
                        <Select value={selectedRoute} onValueChange={setSelectedRoute}>
                          <SelectTrigger>
                            <SelectValue placeholder="Choose road..." />
                          </SelectTrigger>
                          <SelectContent>
                            {roadRegister.map((road) => (
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
                        />
                      </div>

                      <div>
                        <Label htmlFor="surveyor">Surveyor Name *</Label>
                        <Input
                          id="surveyor"
                          placeholder="Enter name"
                          value={surveyorName}
                          onChange={(e) => setSurveyorName(e.target.value)}
                        />
                      </div>
                    </div>

                    <label
                      htmlFor="video-upload"
                      className={cn(
                        "flex flex-col items-center justify-center w-full h-48 border-2 border-dashed rounded-lg cursor-pointer transition-all",
                        selectedRoute && surveyorName
                          ? "border-primary bg-primary/5 hover:bg-primary/10 hover:border-primary/60"
                          : "border-border bg-muted/30 cursor-not-allowed opacity-60"
                      )}
                    >
                      <div className="flex flex-col items-center justify-center pt-5 pb-6">
                        <Upload className="h-12 w-12 mb-3 text-primary" />
                        <p className="mb-2 text-sm font-medium">
                          {selectedRoute && surveyorName ? "Click to select videos" : "Complete the fields above first"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          MP4, WEBM up to 500MB each • Multiple files supported
                        </p>
                      </div>
                      <input
                        id="video-upload"
                        type="file"
                        accept="video/*"
                        multiple
                        className="hidden"
                        disabled={!selectedRoute || !surveyorName}
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
                            {roadRegister.map((road) => (
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
                      <Label htmlFor="s3-url">S3 Bucket URL *</Label>
                      <Input
                        id="s3-url"
                        placeholder="s3://bucket-name/path/to/videos"
                        value={s3BucketUrl}
                        onChange={(e) => setS3BucketUrl(e.target.value)}
                      />
                    </div>

                    <div className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-lg bg-muted/30">
                      <Cloud className="h-10 w-10 mb-2 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground mb-3">
                        Import videos from Amazon S3
                      </p>
                      <Button onClick={handleCloudUpload} disabled={!selectedRoute || !surveyorName || !s3BucketUrl}>
                        <Cloud className="h-4 w-4 mr-2" />
                        Connect to S3
                      </Button>
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
                <Button onClick={startBatchUpload} size="lg" className="gradient-primary text-white shadow-lg hover:shadow-glow">
                  <Play className="h-4 w-4 mr-2" />
                  Start Batch Upload ({inQueue})
                </Button>
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
                      <th className="text-left p-4 font-semibold text-sm">Route ID</th>
                      <th className="text-left p-4 font-semibold text-sm">Road Name</th>
                      <th className="text-left p-4 font-semibold text-sm">Video File</th>
                      <th className="text-left p-4 font-semibold text-sm">Survey Date</th>
                      <th className="text-left p-4 font-semibold text-sm">Surveyor</th>
                      <th className="text-left p-4 font-semibold text-sm">Size</th>
                      <th className="text-left p-4 font-semibold text-sm">Duration (min)</th>
                      <th className="text-left p-4 font-semibold text-sm">GPX File</th>
                      <th className="text-left p-4 font-semibold text-sm">Progress / Action</th>
                      <th className="text-left p-4 font-semibold text-sm">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {videos.map((video, index) => {
                      const road = roadRegister.find(r => r.route_id === video.routeId);
                      
                      return (
                        <tr
                          key={video.id}
                          className="border-b border-border hover:bg-blue-50/70 dark:hover:bg-blue-950/30 transition-colors duration-200"
                        >
                          <td className="p-4">
                            <Badge variant="outline" className="font-mono font-semibold border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-400 bg-blue-50/50 dark:bg-blue-950/30">
                              #{video.routeId}
                            </Badge>
                          </td>
                          <td className="p-4">
                            <div className="font-medium">{road?.road_name || `Road ${video.routeId}`}</div>
                          </td>
                          <td className="p-4">
                            <div className="flex items-center gap-2">
                              <Video className="h-4 w-4 text-purple-500 dark:text-purple-400" />
                              <span className="font-medium">{video.name}</span>
                            </div>
                          </td>
                          <td className="p-4">
                            <div className="flex items-center gap-2 text-sm">
                              <Calendar className="h-4 w-4 text-muted-foreground" />
                              <span className="text-foreground">{video.surveyDate}</span>
                            </div>
                          </td>
                          <td className="p-4 text-sm">{video.surveyorName}</td>
                          <td className="p-4 text-sm font-mono">
                            {(video.size / 1024 / 1024).toFixed(1)} MB
                          </td>
                          <td className="p-4 text-sm font-mono">
                            {Math.floor(video.duration / 60)}:{(video.duration % 60).toString().padStart(2, "0")}
                          </td>
                          <td className="p-4">
                            {video.gpxFile ? (
                              <Badge variant="secondary" className="gap-1.5 text-xs font-medium bg-teal-50 dark:bg-teal-950/30 text-teal-700 dark:text-teal-400 border-teal-200 dark:border-teal-800">
                                <MapPin className="h-3 w-3" />
                                {video.gpxFile}
                              </Badge>
                            ) : (
                              video.status === "queue" ? (
                                <label htmlFor={`gpx-${video.id}`}>
                                  <Button size="sm" variant="outline" className="gap-1.5 h-8 border-dashed hover:border-solid text-xs" asChild>
                                    <span>
                                      <MapPin className="h-3 w-3" />
                                      Add GPX
                                    </span>
                                  </Button>
                                  <input
                                    id={`gpx-${video.id}`}
                                    type="file"
                                    accept=".gpx"
                                    className="hidden"
                                    onChange={(e) => handleGpxFileSelect(e, video.id)}
                                  />
                                </label>
                              ) : (
                                <span className="text-xs text-muted-foreground">-</span>
                              )
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
                                onClick={() => simulateUpload(video.id)} 
                                className="h-8 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white shadow-sm"
                              >
                                <Upload className="h-3 w-3 mr-1.5" />
                                Start Upload
                              </Button>
                            )}
                            
                            {video.status === "uploaded" && (
                              <Button 
                                size="sm" 
                                onClick={() => simulateProcessing(video.id)} 
                                className="h-8 bg-gradient-to-r from-purple-500 to-purple-600 hover:from-purple-600 hover:to-purple-700 text-white shadow-sm"
                              >
                                <Play className="h-3 w-3 mr-1.5" />
                                Process with AI
                              </Button>
                            )}
                            
                            {video.status === "completed" && (
                              <Button 
                                size="sm" 
                                variant="outline" 
                                asChild 
                                className="h-8 border-green-300 dark:border-green-800 text-green-700 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-950/30"
                              >
                                <Link to="/videos">
                                  <Video className="h-3 w-3 mr-1.5" />
                                  View Report
                                </Link>
                              </Button>
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
                                  video.status === "queue" && "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700"
                                )}
                              >
                                {getStatusLabel(video.status)}
                              </Badge>
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
    </div>
  );
}

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}
