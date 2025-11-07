import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Play, Download, Search, ArrowLeft, Video as VideoIcon, Columns2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { roadRegister } from "@/data/roadRegister";
import { Link } from "react-router-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

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
}

const mockVideos: VideoData[] = [
  {
    id: "1",
    title: "Survey_AlCorniche_2024_01",
    routeId: 1,
    roadName: "Al Corniche Street",
    surveyDate: "2024-03-15",
    surveyorName: "Ahmed Hassan",
    duration: "5:30",
    size: "245 MB",
    status: "Processed",
    thumbnail: ""
  },
  {
    id: "2",
    title: "Survey_AlCorniche_2024_02",
    routeId: 1,
    roadName: "Al Corniche Street",
    surveyDate: "2024-02-10",
    surveyorName: "Mohammed Ali",
    duration: "5:25",
    size: "238 MB",
    status: "Processed",
    thumbnail: ""
  },
  {
    id: "3",
    title: "Survey_AlRayyan_2024_01",
    routeId: 2,
    roadName: "Al Rayyan Road",
    surveyDate: "2024-03-14",
    surveyorName: "Fatima Ahmed",
    duration: "8:15",
    size: "380 MB",
    status: "Processed",
    thumbnail: ""
  },
  {
    id: "4",
    title: "Survey_SalwaRoad_2024_01",
    routeId: 3,
    roadName: "Salwa Road",
    surveyDate: "2024-03-12",
    surveyorName: "Ahmed Hassan",
    duration: "12:45",
    size: "520 MB",
    status: "Processed",
    thumbnail: ""
  },
];

export default function VideoLibrary() {
  const [videos] = useState<VideoData[]>(mockVideos);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedRoute, setSelectedRoute] = useState<string>("all");
  const [selectedSurveyor, setSelectedSurveyor] = useState<string>("all");
  const [compareMode, setCompareMode] = useState(false);
  const [selectedForCompare, setSelectedForCompare] = useState<string[]>([]);
  const [showCompareView, setShowCompareView] = useState(false);

  const filteredVideos = videos.filter((video) => {
    const matchesSearch = video.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         video.roadName.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesRoute = selectedRoute === "all" || video.routeId.toString() === selectedRoute;
    const matchesSurveyor = selectedSurveyor === "all" || video.surveyorName === selectedSurveyor;
    
    return matchesSearch && matchesRoute && matchesSurveyor;
  });

  const surveyors = Array.from(new Set(videos.map(v => v.surveyorName)));

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

  return (
    <div className="space-y-6">
      {/* Hero Header */}
      <div className="relative overflow-hidden gradient-primary p-8 rounded-2xl shadow-elevated">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImdyaWQiIHdpZHRoPSI2MCIgaGVpZ2h0PSI2MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTSAxMCAwIEwgMCAwIDAgMTAiIGZpbGw9Im5vbmUiIHN0cm9rZT0id2hpdGUiIHN0cm9rZS1vcGFjaXR5PSIwLjEiIHN0cm9rZS13aWR0aD0iMSIvPjwvcGF0dGVybj48L2RlZnM+PHJlY3Qgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIgZmlsbD0idXJsKCNncmlkKSIvPjwvc3ZnPg==')] opacity-30"></div>
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

        {/* Video Grid */}
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
                className="aspect-video bg-gradient-to-br from-muted to-muted/50 flex items-center justify-center relative group cursor-pointer"
                onClick={() => compareMode && toggleCompareSelection(video.id)}
              >
                <VideoIcon className="h-16 w-16 text-muted-foreground/30" />
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
                    <span>{video.duration}</span>
                    <span>•</span>
                    <span>{video.size}</span>
                  </div>
                </div>
                
                <div className="flex gap-2">
                  {!compareMode && (
                    <>
                      <Button size="sm" className="flex-1">
                        <Play className="h-3 w-3 mr-1" />
                        Watch
                      </Button>
                      <Button size="sm" variant="outline">
                        <Download className="h-3 w-3" />
                      </Button>
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

        {filteredVideos.length === 0 && (
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
                    <VideoIcon className="h-24 w-24 text-muted-foreground/30" />
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
    </div>
  );
}

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}
