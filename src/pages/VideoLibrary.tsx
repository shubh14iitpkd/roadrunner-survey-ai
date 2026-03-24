import { useEffect, useMemo, useState } from "react";
import AnnotatedVideoPlayer from "@/components/AnnotatedVideoPlayer";
import VideoPlayer from "@/components/VideoPlayer";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Play, Download, Search, ArrowLeft, Video as VideoIcon, Columns2, X, MapPin, Loader2, Database } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Link } from "react-router-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format, parseISO } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { api, API_BASE } from "@/lib/api";
import { cn } from "@/lib/utils";

interface VideoData {
  id: string;
  title: string;
  routeId: number;
  roadName: string;
  surveyDate: string;
  surveyorName: string;
  surveyDisplayId: string;
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
  const [roads, setRoads] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPlayer, setShowPlayer] = useState(false);
  const [playerSrc, setPlayerSrc] = useState<string>("");
  const [playerVideoId, setPlayerVideoId] = useState<string>("");

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedRoute, setSelectedRoute] = useState<string>("all");
  const [selectedSurveyor, setSelectedSurveyor] = useState<string>("all");
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [compareMode, setCompareMode] = useState(false);
  const [selectedForCompare, setSelectedForCompare] = useState<string[]>([]);
  const [showCompareView, setShowCompareView] = useState(false);
  const [compareCats, setCompareCats] = useState<string[]>(["", ""]);

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

        const [roadsResp, videosResp] = await Promise.all([
          api.roads.list(),
          api.videos.list()
        ]);
        
        const fetchedRoads = roadsResp.items || [];
        if (!cancelled) setRoads(fetchedRoads);

        const items = videosResp.items as any[];
        const baseMapped: VideoData[] = items.map(v => {
          const videoIdStr = getIdString(v._id);
          const durationSeconds = v.duration_seconds || 0;
          const durMin = Math.floor(durationSeconds / 60);
          const durSec = String(durationSeconds % 60).padStart(2, "0");
          const sizeBytes = v.size_bytes || 0;
          const sizeMb = `${(sizeBytes / 1024 / 1024).toFixed(0)} MB`;
          const road = fetchedRoads.find((r: any) => r.route_id === v.route_id);

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
            surveyDisplayId: v.survey_display_id,
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
                surveyDisplayId: s?.display_id || v.surveyDisplayId,
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
    const matchesSearch = video.surveyDisplayId.toLowerCase().includes(searchQuery.toLowerCase()) ||
      video.roadName.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesRoute = selectedRoute === "all" || video.routeId.toString() === selectedRoute;
    const matchesSurveyor = selectedSurveyor === "all" || video.surveyorName === selectedSurveyor;
    
    let matchesDate = true;
    if (selectedDate && video.surveyDate) {
      try {
        const vDate = parseISO(video.surveyDate);
        matchesDate = format(vDate, "yyyy-MM-dd") === format(selectedDate, "yyyy-MM-dd");
      } catch (e) {
        matchesDate = false;
      }
    }

    return matchesSearch && matchesRoute && matchesSurveyor && matchesDate;
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
      const cats = selectedForCompare.map(id => {
        const v = videos.find(v => v.id === id);
        if (v?.categoryVideos && Object.keys(v.categoryVideos).length > 0) {
          return Object.keys(v.categoryVideos).sort()[0];
        }
        return "";
      });
      setCompareCats(cats);
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
    <div className="space-y-4 p-5">
      {/* Compact Header */}
      <div className="border-b border-border bg-header-strip -mx-5 -mt-5 mb-4">
        <div className="px-5 py-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <VideoIcon className="h-4 w-4 text-primary dark:text-muted-secondary" />
            <div>
              <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-[0.15em]">Project Management</p>
              <h1 className="text-sm font-bold text-foreground tracking-tight">Video Library</h1>
            </div>
          </div>
          <div className="flex gap-2">
            <Link to="/upload">
              <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1.5">
                <ArrowLeft className="h-3 w-3" />
                Surveys
              </Button>
            </Link>
            <Button
              variant={compareMode ? "default" : "outline"}
              size="sm"
              className="h-7 text-[11px] gap-1.5"
              onClick={() => {
                setCompareMode(!compareMode);
                setSelectedForCompare([]);
              }}
            >
              <Columns2 className="h-3 w-3" />
              {compareMode ? "Exit Compare" : "Compare"}
            </Button>
          </div>
        </div>
      </div>

      <div className="px-6 space-y-6">
        {/* Filters */}
        <Card className="p-4 shadow-elevated border-0 gradient-card animate-fade-in">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
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
                  {roads.map((road) => (
                    <SelectItem key={road.route_id} value={road.route_id.toString()}>
                      {road.route_id} - {road.road_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant={"outline"}
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !selectedDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {selectedDate ? format(selectedDate, "PPP") : <span>Filter by date</span>}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={selectedDate}
                    onSelect={setSelectedDate}
                    disabled={(date) => date > new Date()}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
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
                      setPlayerVideoId(video.id);
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
                    <h3 className="font-semibold mb-1">{video.surveyDisplayId}</h3>
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
                              setPlayerVideoId(video.id);
                              setShowPlayer(true);
                            }
                          }}
                          disabled={!video.storageUrl}
                        >
                          <Play className="h-3 w-3 mr-1" />
                          {video.storageUrl ? "Watch" : "No Video"}
                        </Button>
                        <Button size="sm" variant="outline" asChild disabled={!video.storageUrl}>
                          <a href={video.storageUrl} download title="Download">
                            <Download className="h-3 w-3"/>
                          </a>
                        </Button>
                        {video.gpxFileUrl && (
                          <Button size="sm" variant="outline" asChild>
                            <a href={`/asset-library?id=${video.routeId}`} title="View in Asset Library">
                              <Database className="h-3 w-3" />
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
      <Dialog open={showCompareView} onOpenChange={(open) => { if (!open) handleCloseComparison(); }}>
        <DialogContent className="max-w-[95vw] h-[90vh] p-0">
          <DialogHeader className="p-6 pb-4">
            <div className="flex items-center justify-between">
              <DialogTitle className="text-2xl font-bold">Video Comparison</DialogTitle>
            </div>
          </DialogHeader>


          <div className="grid grid-cols-2 gap-4 p-6 pt-0 h-[calc(90vh-100px)]">
            {selectedVideos.map((video, index) => {
              const hasCats = video.categoryVideos && Object.keys(video.categoryVideos).length > 0;
              const activeCat = compareCats[index] || "";
              const activeSrc = hasCats && activeCat && video.categoryVideos![activeCat]
                ? video.categoryVideos![activeCat]
                : (video.storageUrl || "");
              return (
                <div key={video.id} className="space-y-3 flex flex-col h-full">
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
                      </div>
                      <p className="text-xs text-muted-foreground">Surveyor: {video.surveyorName}</p>
                      {hasCats && (
                        <div className="flex flex-wrap gap-2 mt-1">
                          {Object.keys(video.categoryVideos!).sort().map(cat => (
                            <Button
                              key={cat}
                              size="sm"
                              variant={activeCat === cat ? "default" : "outline"}
                              className={`text-xs h-7 ${activeCat === cat ? "bg-blue-600 text-white" : ""}`}
                              onClick={() => {
                                const newCats = [...compareCats];
                                newCats[index] = cat;
                                setCompareCats(newCats);
                              }}
                            >
                              {CATEGORY_LABELS[cat] || cat}
                            </Button>
                          ))}
                        </div>
                      )}
                    </div>
                  </Card>

                  <div className="flex-1 min-h-0">
                    {activeSrc ? (
                      <AnnotatedVideoPlayer
                        videoSrc={activeSrc}
                        videoId={video.id}
                      />
                    ) : (
                      <Card className="h-full gradient-card border-0 flex items-center justify-center">
                        <VideoIcon className="h-24 w-24 text-muted-foreground/30" />
                      </Card>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>

      {/* Enhanced Video Player Dialog - Side by Side View */}
      <Dialog open={showPlayer} onOpenChange={(open) => {
        setShowPlayer(open);
        if (!open) { setPlayerSrc(""); setPlayerVideoId(""); }
      }}>
        <DialogContent className="max-w-[95vw] h-[90vh] p-0">
          <DialogHeader className="p-6 pb-4">
            <DialogTitle className="text-2xl font-bold">Video Viewer</DialogTitle>
          </DialogHeader>

          {/* Side-by-side Video Display */}
          <div className="grid grid-cols-2 gap-4 p-6 pt-0 h-[calc(90vh-100px)]">
            {/* Left: Original Video */}
            {playerSrc && (
              <VideoPlayer
                videoSrc={playerSrc}
                title="Original Survey Video"
                badge="Raw Footage"
                description="Unprocessed video from survey"
              />
            )}

            {/* Right: AI Annotated Video (Canvas Overlay) */}
            {playerVideoId && playerSrc && (
              <AnnotatedVideoPlayer
                videoSrc={playerSrc}
                videoId={playerVideoId}
              />
            )}

            {/* Fallback if no videos available */}
            {!playerSrc && (
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