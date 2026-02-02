import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Play, Download, Search, ArrowLeft, Video as VideoIcon, Columns2, X, MapPin, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { roadRegister } from "@/data/roadRegister";
import { Link } from "react-router-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, API_BASE } from "@/lib/api";
import { cn } from "@/lib/utils";

interface VideoData {
  id: string;
  title: string;
  routeId: number;
  roadName: string;
  surveyDate: string;
  surveyorName: string;
  duration: string;
  size: string;
  status: string;
  thumbnail: string;
  thumbnailUrl?: string;
  storageUrl?: string;
  annotatedVideoUrl?: string;
  gpxFileUrl?: string;
  categoryVideos?: Record<string, string>;
}

export default function VideoLibrary() {
  const [videos, setVideos] = useState<VideoData[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPlayer, setShowPlayer] = useState(false);
  const [playerSrc, setPlayerSrc] = useState<string>("");
  const [playerAnnotatedSrc, setPlayerAnnotatedSrc] = useState<string>("");
  const [playerCategoryVideos, setPlayerCategoryVideos] = useState<Record<string, string>>({});
  const [activeCategory, setActiveCategory] = useState<string>("");

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedRoute, setSelectedRoute] = useState<string>("all");
  const [selectedSurveyor, setSelectedSurveyor] = useState<string>("all");
  const [compareMode, setCompareMode] = useState(false);
  const [selectedForCompare, setSelectedForCompare] = useState<string[]>([]);
  const [showCompareView, setShowCompareView] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Helper to extract string from MongoDB ObjectId
        const getIdString = (id: any): string => {
          if (!id) return '';
          if (typeof id === 'string') return id;
          if (id.$oid) return id.$oid;
          return String(id);
        };

        const resp = await api.videos.list();
        const items = resp.items as any[];
        const baseMapped: VideoData[] = items.map(v => {
          const videoIdStr = getIdString(v._id);
          const durationSeconds = v.duration_seconds || 0;
          const durMin = Math.floor(durationSeconds / 60);
          const durSec = String(durationSeconds % 60).padStart(2, "0");
          const sizeBytes = v.size_bytes || 0;
          const sizeMb = `${(sizeBytes / 1024 / 1024).toFixed(0)} MB`;
          const road = roadRegister.find(r => r.route_id === v.route_id);

          // Helper function to build full URL
          const buildUrl = (path: string | undefined) => {
            if (!path) return undefined;
            // If path already starts with http:// or https://, return as-is
            if (path.startsWith('http://') || path.startsWith('https://')) return path;
            // Otherwise prepend API_BASE
            return `${API_BASE}${path}`;
          };

          // Build category videos map
          const catVideos: Record<string, string> = {};
          if (v.category_videos) {
            Object.entries(v.category_videos).forEach(([k, val]) => {
              catVideos[k] = buildUrl(val as string)!;
            });
          }
          console.log(v)
          return {
            id: videoIdStr,
            title: v.title || `Video ${videoIdStr}`,
            routeId: v.route_id,
            roadName: road?.road_name || `Route #${v.route_id}`,
            surveyDate: "",
            surveyorName: "",
            duration: `${durMin}:${durSec}`,
            size: sizeMb,
            status: (v.status || "").toString(),
            thumbnail: "",
            thumbnailUrl: buildUrl(v.thumbnail_url),
            storageUrl: buildUrl(v.storage_url),
            annotatedVideoUrl: buildUrl(v.annotated_video_url),
            gpxFileUrl: buildUrl(v.gpx_file_url),
            categoryVideos: catVideos,
          } as VideoData;
        });
        if (!cancelled) setVideos(baseMapped);

        // Best-effort enrichment with surveys
        try {
          const surveysResp = await api.Surveys.list({ latest_only: false });
          const surveyMap = new Map<string, any>();
          (surveysResp.items as any[]).forEach(s => {
            const surveyIdStr = getIdString(s._id);
            surveyMap.set(surveyIdStr, s);
          });
          if (!cancelled) {
            setVideos(prev => prev.map(v => {
              const raw = items.find(it => getIdString(it._id) === v.id);
              const surveyIdStr = raw ? getIdString(raw.survey_id) : undefined;
              const s = surveyIdStr ? surveyMap.get(surveyIdStr) : undefined;
              return {
                ...v,
                surveyDate: s?.survey_date || v.surveyDate,
                surveyorName: s?.surveyor_name || v.surveyorName,
              };
            }));
          }
        } catch { }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const filteredVideos = videos.filter((video) => {
    const matchesSearch = video.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      video.roadName.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesRoute = selectedRoute === "all" || video.routeId.toString() === selectedRoute;
    const matchesSurveyor = selectedSurveyor === "all" || video.surveyorName === selectedSurveyor;

    return matchesSearch && matchesRoute && matchesSurveyor;
  });

  const surveyors = useMemo(() => Array.from(new Set(videos.map(v => v.surveyorName).filter(Boolean))), [videos]);

  const toggleCompareSelection = (videoId: string) => {
    if (selectedForCompare.includes(videoId)) {
      setSelectedForCompare(selectedForCompare.filter(id => id !== videoId));
    } else if (selectedForCompare.length < 2) {
      setSelectedForCompare([...selectedForCompare, videoId]);
    }
  };

  const selectedVideos = videos.filter(v => selectedForCompare.includes(v.id));

  const handleStartComparison = () => {
    if (selectedForCompare.length === 2) {
      setShowCompareView(true);
    }
  };

  const handleCloseComparison = () => {
    setShowCompareView(false);
    setCompareMode(false);
    setSelectedForCompare([]);
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

  return (
    <div className="space-y-6">
      {/* Hero Header */}
      <div className="relative overflow-hidden gradient-primary p-8 shadow-elevated">
        <div className="absolute inset-0 page-header dark:bg-primary"></div>
        <div className="relative flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <Link to="/upload">
                <Button variant="ghost" size="icon" className="bg-white/20 hover:bg-white/30 text-white">
                  <ArrowLeft className="h-5 w-5" />
                </Button>
              </Link>
              <h1 className="text-4xl font-bold text-white drop-shadow-lg">
                Video Library
              </h1>
            </div>
            <p className="text-white/90 text-lg pl-14">
              Browse and compare AI-processed survey videos
            </p>
          </div>
          <div className="flex gap-3">
            <Button
              variant={compareMode ? "default" : "secondary"}
              onClick={() => {
                setCompareMode(!compareMode);
                setSelectedForCompare([]);
              }}
              className={compareMode ? "gap-2 bg-white text-primary hover:bg-white/90 shadow-lg" : "gap-2 bg-white/20 hover:bg-white/30 text-white border-white/30 backdrop-blur-sm"}
            >
              <Columns2 className="h-4 w-4" />
              {compareMode ? "Exit Compare" : "Compare Videos"}
            </Button>
          </div>
        </div>
      </div>

      <div className="px-6 space-y-6">
        {/* Filters */}
        <Card className="p-4 shadow-elevated border-0 gradient-card animate-fade-in">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="md:col-span-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by road name or video title..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            <div>
              <Select value={selectedRoute} onValueChange={setSelectedRoute}>
                <SelectTrigger>
                  <SelectValue placeholder="All Routes" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Routes</SelectItem>
                  {roadRegister.map((road) => (
                    <SelectItem key={road.route_id} value={road.route_id.toString()}>
                      {road.route_id} - {road.road_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Select value={selectedSurveyor} onValueChange={setSelectedSurveyor}>
                <SelectTrigger>
                  <SelectValue placeholder="All Surveyors" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Surveyors</SelectItem>
                  {surveyors.map((surveyor) => (
                    <SelectItem key={surveyor} value={surveyor}>
                      {surveyor}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </Card>

        {/* Compare Mode Notice */}
        {compareMode && (
          <Card className="p-4 shadow-elevated border-0 bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-950/20 dark:to-purple-950/20 animate-fade-in">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">
                Select up to 2 videos to compare side-by-side • Selected: <span className="text-primary">{selectedForCompare.length}/2</span>
              </p>
              {selectedForCompare.length === 2 && (
                <Button onClick={handleStartComparison} size="sm" className="gap-2">
                  <Play className="h-4 w-4" />
                  Compare Now
                </Button>
              )}
            </div>
          </Card>
        )}

        {/* Video Grid or Loader */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 animate-fade-in content-card gradient-card rounded-2xl shadow-elevated border-0">
            <div className="relative w-16 h-16 mb-6">
              <div className="absolute inset-0 border-4 border-primary/20 rounded-full" />
              <div className="absolute inset-0 border-4 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
            <h3 className="text-xl font-semibold mb-2">Fetching Video Library...</h3>
            <p className="text-sm text-muted-foreground">Preparing your survey videos and AI processing results</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredVideos.map((video) => (
              <Card
                key={video.id}
                className={cn(
                  "overflow-hidden shadow-elevated border-0 gradient-card hover:shadow-glow transition-all duration-300 animate-fade-in",
                  compareMode && selectedForCompare.includes(video.id) && "ring-4 ring-primary shadow-glow"
                )}
              >
                <div
                  className="aspect-video bg-gradient-to-br from-muted to-muted/50 flex items-center justify-center relative group cursor-pointer overflow-hidden"
                  onClick={() => {
                    if (video.storageUrl) {
                      setPlayerSrc(video.storageUrl);
                      setPlayerAnnotatedSrc(video.annotatedVideoUrl || "");
                      setPlayerCategoryVideos(video.categoryVideos || {});
                      if (video.categoryVideos) {
                        const firstCat = Object.keys(video.categoryVideos).sort()[0];
                        if (firstCat) {
                          setActiveCategory(firstCat);
                          setPlayerAnnotatedSrc(video.categoryVideos[firstCat]);
                        }
                      }
                      setShowPlayer(true);
                    }
                  }}
                >
                  {video.thumbnailUrl ? (
                    <>
                      <img
                        src={video.thumbnailUrl}
                        alt={`Thumbnail for ${video.title}`}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                          e.currentTarget.nextElementSibling?.classList.remove('hidden');
                        }}
                      />
                      <div className="hidden">
                        <VideoIcon className="h-16 w-16 text-muted-foreground/30" />
                      </div>
                    </>
                  ) : (
                    <VideoIcon className="h-16 w-16 text-muted-foreground/30" />
                  )}
                  <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <Play className="h-12 w-12 text-white" />
                  </div>
                  {compareMode && selectedForCompare.includes(video.id) && (
                    <Badge className="absolute top-2 right-2">Selected</Badge>
                  )}
                </div>

                <div className="p-4 space-y-3">
                  <div>
                    <h3 className="font-semibold mb-1">{video.title}</h3>
                    <div className="flex flex-wrap gap-2 mb-2">
                      <Badge variant="outline" className="text-xs">
                        Route #{video.routeId}
                      </Badge>
                      <Badge variant="secondary" className="text-xs">
                        {video.status}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mb-1">{video.roadName}</p>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span>{video.surveyDate}</span>
                      <span>•</span>
                      <span>{video.surveyorName}</span>
                      <span>•</span>
                      <span>{video.size}</span>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    {!compareMode && (
                      <>
                        <Button
                          size="sm"
                          className="flex-1"
                          onClick={() => {
                            if (video.storageUrl) {
                              setPlayerSrc(video.storageUrl);
                              setPlayerAnnotatedSrc(video.annotatedVideoUrl || "");
                              setPlayerCategoryVideos(video.categoryVideos || {});
                              if (video.categoryVideos) {
                                const firstCat = Object.keys(video.categoryVideos).sort()[0];
                                if (firstCat) {
                                  setActiveCategory(firstCat);
                                  setPlayerAnnotatedSrc(video.categoryVideos[firstCat]);
                                }
                              }
                              setShowPlayer(true);
                            }
                          }}
                          disabled={!video.storageUrl}
                        >
                          <Play className="h-3 w-3 mr-1" />
                          {video.storageUrl ? "Watch" : "No Video"}
                        </Button>
                        <Button size="sm" variant="outline" asChild disabled={!video.storageUrl}>
                          <a href={video.storageUrl} download>
                            <Download className="h-3 w-3" />
                          </a>
                        </Button>
                        {video.gpxFileUrl && (
                          <Button size="sm" variant="outline" asChild>
                            <a href={`/gis?id=${video.routeId}`} title="View on GIS">
                              <MapPin className="h-3 w-3" />
                            </a>
                          </Button>
                        )}
                      </>
                    )}
                    {compareMode && (
                      <Button
                        size="sm"
                        className="flex-1"
                        variant={selectedForCompare.includes(video.id) ? "default" : "outline"}
                        onClick={() => toggleCompareSelection(video.id)}
                        disabled={!selectedForCompare.includes(video.id) && selectedForCompare.length >= 2}
                      >
                        {selectedForCompare.includes(video.id) ? "Selected" : "Select"}
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}

        {!loading && filteredVideos.length === 0 && (
          <Card className="p-16 text-center shadow-elevated border-0 gradient-card">
            <div className="inline-flex p-6 rounded-full bg-primary/10 mb-4">
              <VideoIcon className="h-16 w-16 text-primary" />
            </div>
            <h3 className="text-xl font-bold mb-2">No videos found</h3>
            <p className="text-muted-foreground">
              Try adjusting your filters or upload new survey videos
            </p>
          </Card>
        )}
      </div>

      {/* Side-by-Side Comparison Dialog */}
      <Dialog open={showCompareView} onOpenChange={setShowCompareView}>
        <DialogContent className="max-w-[95vw] h-[90vh] p-0">
          <DialogHeader className="p-6 pb-4">
            <div className="flex items-center justify-between">
              <DialogTitle className="text-2xl font-bold">Video Comparison</DialogTitle>
              <Button variant="ghost" size="icon" onClick={handleCloseComparison}>
                <X className="h-5 w-5" />
              </Button>
            </div>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-4 p-6 pt-0 h-[calc(90vh-100px)]">
            {selectedVideos.map((video, index) => (
              <div key={video.id} className="space-y-3 flex flex-col">
                <Card className="p-4 gradient-card border-0">
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-semibold text-lg">{video.title}</h3>
                      <Badge>Video {index + 1}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{video.roadName}</p>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline" className="text-xs">Route #{video.routeId}</Badge>
                      <Badge variant="secondary" className="text-xs">{video.surveyDate}</Badge>
                      <Badge variant="outline" className="text-xs">{video.duration}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">Surveyor: {video.surveyorName}</p>
                  </div>
                </Card>

                <Card className="flex-1 overflow-hidden gradient-card border-0">
                  <div className="relative w-full h-full bg-gradient-to-br from-muted to-muted/50 flex items-center justify-center group">
                    {video.thumbnailUrl ? (
                      <>
                        <img
                          src={video.thumbnailUrl}
                          alt={`Thumbnail for ${video.title}`}
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            e.currentTarget.style.display = 'none';
                            e.currentTarget.nextElementSibling?.classList.remove('hidden');
                          }}
                        />
                        <div className="hidden">
                          <VideoIcon className="h-24 w-24 text-muted-foreground/30" />
                        </div>
                      </>
                    ) : (
                      <VideoIcon className="h-24 w-24 text-muted-foreground/30" />
                    )}
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-3">
                      <Play className="h-16 w-16 text-white" />
                      <p className="text-white text-sm">Click to play video</p>
                    </div>
                    <div className="absolute top-4 left-4 right-4">
                      <div className="bg-black/70 backdrop-blur-sm rounded-lg p-3 text-white text-sm space-y-1">
                        <div className="flex justify-between">
                          <span>Time:</span>
                          <span>00:00 / {video.duration}</span>
                        </div>
                        <div className="w-full bg-white/20 rounded-full h-1">
                          <div className="bg-white rounded-full h-1 w-0"></div>
                        </div>
                      </div>
                    </div>
                  </div>
                </Card>

                <div className="flex gap-2">
                  <Button size="sm" className="flex-1 gap-2">
                    <Play className="h-4 w-4" />
                    Play
                  </Button>
                  <Button size="sm" variant="outline" className="gap-2">
                    <Download className="h-4 w-4" />
                    Download
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Enhanced Video Player Dialog - Side by Side View */}
      <Dialog open={showPlayer} onOpenChange={setShowPlayer}>
        <DialogContent className="max-w-[95vw] h-[90vh] p-0">
          <DialogHeader className="p-6 pb-4">
            <DialogTitle className="text-2xl font-bold">Video Viewer</DialogTitle>
          </DialogHeader>

          {/* Side-by-side Video Display */}
          <div className={playerAnnotatedSrc ? "grid grid-cols-2 gap-4 p-6 pt-0 h-[calc(90vh-100px)]" : "p-6 pt-0 h-[calc(90vh-100px)]"}>
            {/* Left: Original Video */}
            {playerSrc && (
              <div className="space-y-3 flex flex-col h-full">
                <Card className="p-4 gradient-card border-0">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-lg">Original Survey Video</h3>
                    <Badge variant="outline">Raw Footage</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">Unprocessed video from survey</p>
                  {/* Spacer to match height if categories exist on right */}
                  {Object.keys(playerCategoryVideos).length > 0 && <div className="mt-3 min-h-[32px]"></div>}
                </Card>

                <Card className="flex-1 overflow-hidden gradient-card border-0 flex items-center justify-center min-h-0">
                  <div className="relative w-full h-full">
                    <video
                      key={playerSrc}
                      src={playerSrc}
                      controls
                      className="absolute inset-0 w-full h-full object-contain rounded-lg"
                    />
                  </div>
                </Card>

                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="flex-1 gap-2" asChild>
                    <a href={playerSrc} download>
                      <Download className="h-4 w-4" />
                      Download Original
                    </a>
                  </Button>
                </div>
              </div>
            )}

            {/* Right: AI Annotated Video */}
            {(playerAnnotatedSrc || Object.keys(playerCategoryVideos).length > 0) && (
              <div className="space-y-3 flex flex-col h-full">
                <Card className="p-4 gradient-card border-0">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-lg">AI Annotated Video</h3>
                    <Badge className="bg-gradient-to-r from-blue-500 to-purple-500">AI Processed</Badge>
                  </div>
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
                            const videoEl = document.getElementById('annotated-video-player') as HTMLVideoElement;
                            const currentTime = videoEl ? videoEl.currentTime : 0;
                            const isPlaying = videoEl ? !videoEl.paused : false;

                            setActiveCategory(cat);
                            setPlayerAnnotatedSrc(playerCategoryVideos[cat]);

                            // Restore state after render
                            requestAnimationFrame(() => {
                              const newVideoEl = document.getElementById('annotated-video-player') as HTMLVideoElement;
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
                      id="annotated-video-player"
                      key={playerAnnotatedSrc}
                      src={playerAnnotatedSrc}
                      controls
                      className="absolute inset-0 w-full h-full object-contain rounded-lg"
                      onError={(e) => {
                        console.error('[VideoLibrary] Error loading annotated video:', playerAnnotatedSrc);
                      }}
                    />
                  </div>
                </Card>

                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="flex-1 gap-2" asChild>
                    <a href={playerAnnotatedSrc} download>
                      <Download className="h-4 w-4" />
                      Download Annotated
                    </a>
                  </Button>
                </div>
              </div>
            )}

            {/* Fallback if no videos available */}
            {!playerAnnotatedSrc && !playerSrc && (
              <div className="text-center p-8 col-span-2">
                <p className="text-muted-foreground">No video available</p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
