import { useState, useEffect, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MessageSquare, Send, Sparkles, Video, Clock, MapPin, Loader2, Image as ImageIcon, ChevronDown, Upload, X } from "lucide-react";
import { api } from "@/lib/api";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { MarkdownMessage } from "@/components/MarkdownMessage";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { VisualizationBlock } from "@/components/VisualizationBlock";

interface Message {
  role: "user" | "assistant";
  content: string;
  frames?: FrameData[];
  timestamp?: string;
}

interface FrameData {
  frame_id: string;
  frame_number: number;
  timestamp: number;
  image_url?: string;
  detections: Detection[];
  location?: { lat: number; lon: number };
}

interface Detection {
  class_name: string;
  confidence: number;
  bbox?: number[];
}

interface VideoInfo {
  _id: string;
  title: string;
  route_id: number;
  status: string;
  duration_seconds?: number;
  thumbnail_url?: string;
}

// Send message to backend API
async function sendMessageToBackend(
  chatId: string,
  question: string,
  videoId?: string
): Promise<string> {
  const response = await api.ai.sendMessage(chatId, "user", question, videoId);
  // Backend returns { user_message: {...}, assistant_message: {...} }
  console.log(response);
  return response.assistant_message?.content || response.content || "(No response)";
}

// Parse timestamp from user query (e.g., "at 2:30", "at 150 seconds", "frame 45")
function parseTimestampFromQuery(query: string): { timestamp?: number; frameNumber?: number } {
  // Match "at X:XX" or "X:XX"
  const timeMatch = query.match(/(?:at\s+)?(\d+):(\d{2})/i);
  if (timeMatch) {
    const minutes = parseInt(timeMatch[1]);
    const seconds = parseInt(timeMatch[2]);
    return { timestamp: minutes * 60 + seconds };
  }

  // Match "at X seconds" or "X seconds"
  const secondsMatch = query.match(/(?:at\s+)?(\d+)\s*(?:seconds?|sec|s)\b/i);
  if (secondsMatch) {
    return { timestamp: parseInt(secondsMatch[1]) };
  }

  // Match "frame X" or "frame number X"
  const frameMatch = query.match(/frame\s*(?:number\s*)?(\d+)/i);
  if (frameMatch) {
    return { frameNumber: parseInt(frameMatch[1]) };
  }

  return {};
}

const markdownComponents = {
  code({ className, children, ...props }: any) {
    const match = /language-(\w+)/.exec(className || "");
    const lang = match?.[1];
    const content = String(children).replace(/\n$/, "");
    if (lang === "visualization") {
      return (
        <VisualizationBlock
          jsonString={content}
        />
      );
    }
    // Default code block rendering
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  },
};

export default function AskAI() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content: "Hello! I'm RoadSight AI Assistant. Select a processed video above to start analyzing its content. I can answer questions about detected assets, specific timestamps, and provide insights from the survey data.",
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [chatId, setChatId] = useState<string | null>(null);
  // Video selection
  const [videos, setVideos] = useState<VideoInfo[]>([]);
  const [selectedVideoId, setSelectedVideoId] = useState<string>("");
  const [selectedVideo, setSelectedVideo] = useState<VideoInfo | null>(null);
  const [videoFrames, setVideoFrames] = useState<FrameData[]>([]);
  const [loadingFrames, setLoadingFrames] = useState(false);

  // Upload states
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadRouteId, setUploadRouteId] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploading, setUploading] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Debug: wrapper for setSelectedVideoId
  const handleVideoSelect = (value: string) => {
    console.log("Video selected:", value);
    setSelectedVideoId(value);
  };

  // Load completed videos
  useEffect(() => {
    (async () => {
      try {
        const resp = await api.videos.list({ status: "completed" });
        if (resp?.items) {
          // Parse the response properly
          const videoList = resp.items.map((v: any) => ({
            _id: typeof v._id === 'object' ? v._id.$oid : v._id,
            title: v.title,
            route_id: v.route_id,
            status: v.status,
            duration_seconds: v.duration_seconds,
            thumbnail_url: v.thumbnail_url,
          }));
          setVideos(videoList);
          console.log("Loaded videos:", videoList);
        }
      } catch (err) {
        console.error("Failed to load videos:", err);
      }
    })();
  }, []);

  // Load frames when video is selected
  useEffect(() => {
    console.log("Selected video ID:", selectedVideoId);
    if (!selectedVideoId) {
      setVideoFrames([]);
      setSelectedVideo(null);
      return;
    }

    const video = videos.find(v => v._id === selectedVideoId);
    setSelectedVideo(video || null);
    console.log(selectedVideoId);
    (async () => {
      setLoadingFrames(true);
      try {
        // Use the getAllFrames endpoint with has_detections filter
        const resp = await api.videos.getAllFrames(selectedVideoId, true);
        console.log(resp);
        if (resp?.items) {
          const frames: FrameData[] = resp.items.map((f: any) => {
            // Flatten detections from all endpoints (detections is an object with endpoint names as keys)
            const allDetections: Detection[] = [];
            if (f.detections && typeof f.detections === 'object') {
              Object.values(f.detections).forEach((endpointDets: any) => {
                if (Array.isArray(endpointDets)) {
                  endpointDets.forEach((d: any) => {
                    allDetections.push({
                      class_name: d.class_name,
                      confidence: d.confidence,
                      bbox: d.box || d.bbox,
                    });
                  });
                }
              });
            }

            // Extract location from GeoJSON Point format or direct lat/lon
            let location: { lat: number; lon: number } | undefined;
            if (f.location?.coordinates) {
              // GeoJSON format: [lon, lat]
              location = { lat: f.location.coordinates[1], lon: f.location.coordinates[0] };
            } else if (f.lat && f.lon) {
              location = { lat: f.lat, lon: f.lon };
            }

            return {
              frame_id: typeof f._id === 'object' ? f._id.$oid : String(f._id),
              frame_number: f.frame_number,
              timestamp: f.timestamp || f.frame_number,
              image_url: f.frame_path,
              detections: allDetections,
              location,
            };
          });
          setVideoFrames(frames);

          // Add a system message about the loaded video
          if (video) {
            setMessages(prev => [...prev, {
              role: "assistant",
              content: `Loaded video "${video.title}" (Route ${video.route_id}).\nYou can now ask me about:\n* What assets are at a specific timestamp (e.g., "What's at 2:30?")\n* Asset summaries (e.g., "How many traffic signs are there?")\n* Condition analysis\n* Location-based queries`,
            }]);
          }
        }
      } catch (err) {
        console.error("Failed to load frames:", err);
      } finally {
        setLoadingFrames(false);
      }
    })();
  }, [selectedVideoId, videos]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const ensureChat = async () => {
    if (chatId) return chatId;
    try {
      const title = input.trim().slice(0, 60) || "Video Analysis Chat";
      const resp = await api.ai.createChat(title, selectedVideoId);
      setChatId(resp.chat._id);
      return resp.chat._id as string;
    } catch {
      return null;
    }
  };

  // Find frames near a timestamp
  const findFramesNearTimestamp = (targetTimestamp: number, count: number = 3): FrameData[] => {
    if (videoFrames.length === 0) return [];

    // Sort by distance to target timestamp
    const sorted = [...videoFrames].sort((a, b) =>
      Math.abs(a.timestamp - targetTimestamp) - Math.abs(b.timestamp - targetTimestamp)
    );

    return sorted.slice(0, count);
  };

  // Find frame by number
  const findFrameByNumber = (frameNumber: number): FrameData | undefined => {
    return videoFrames.find(f => f.frame_number === frameNumber);
  };

  // Build context strings for Gemini
  const buildVideoContext = (): string => {
    if (!selectedVideo) return "No video selected.";
    return `Current Video: "${selectedVideo.title}"
Route ID: ${selectedVideo.route_id}
Duration: ${selectedVideo.duration_seconds ? `${Math.floor(selectedVideo.duration_seconds / 60)}:${(selectedVideo.duration_seconds % 60).toString().padStart(2, '0')}` : 'Unknown'}
Total frames with detections: ${videoFrames.length}`;
  };

  const buildFramesContext = (): string => {
    if (videoFrames.length === 0) return "No frames loaded.";

    // Summarize detections
    const detectionCounts: Record<string, number> = {};
    videoFrames.forEach(frame => {
      frame.detections.forEach(det => {
        detectionCounts[det.class_name] = (detectionCounts[det.class_name] || 0) + 1;
      });
    });

    const sortedDetections = Object.entries(detectionCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([name, count]) => `${name}: ${count}`)
      .join(", ");

    // Sample frames for context
    const sampleFrames = videoFrames.slice(0, 20).map(f => {
      const dets = f.detections.map(d => d.class_name).join(", ");
      return `Frame ${f.frame_number} (${formatTimestamp(f.timestamp)}): ${dets || "No detections"}`;
    }).join("\n");

    return `Detection Summary: ${sortedDetections}

Sample Frames:
${sampleFrames}`;
  };

  const formatTimestamp = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleUpload = async () => {
    if (!uploadFile || !uploadTitle.trim() || !uploadRouteId) {
      toast.error("Please fill all fields and select a file");
      return;
    }

    // Check if user is authenticated
    const authTokens = localStorage.getItem("auth_tokens");
    if (!authTokens) {
      toast.error("You must be logged in to upload videos");
      return;
    }
    try {
      const parsed = JSON.parse(authTokens);
      if (!parsed.access_token) {
        toast.error("Authentication token invalid. Please login again.");
        return;
      }
    } catch {
      toast.error("Authentication error. Please login again.");
      return;
    }

    setUploading(true);
    setUploadProgress(0);

    try {
      // Create video entry first (backend will create temp survey if needed)
      const videoEntry = await api.videos.create({
        route_id: parseInt(uploadRouteId),
        title: uploadTitle,
        status: "uploading",
        progress: 0,
      } as any);

      const videoId = videoEntry.video._id;

      // Upload the file with progress tracking
      await api.videos.upload(
        uploadFile,
        videoId,
        "", // Let backend create survey
        parseInt(uploadRouteId),
        uploadTitle,
        (progress) => setUploadProgress(progress)
      );

      toast.success("Video uploaded successfully! Processing will start automatically.");

      // Reset upload form
      setUploadFile(null);
      setUploadTitle("");
      setUploadRouteId("");
      setUploadProgress(0);
      setUploadDialogOpen(false);

      // Refresh video list
      const resp = await api.videos.list({ status: "completed" });
      if (resp?.items) {
        const videoList = resp.items.map((v: any) => ({
          _id: typeof v._id === 'object' ? v._id.$oid : v._id,
          title: v.title,
          route_id: v.route_id,
          status: v.status,
          duration_seconds: v.duration_seconds,
          thumbnail_url: v.thumbnail_url,
        }));
        setVideos(videoList);
      }
    } catch (error: any) {
      console.error("Upload failed:", error);
      toast.error(`Upload failed: ${error.message || "Unknown error"}`);
    } finally {
      setUploading(false);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || busy) return;

    const userMessage: Message = { role: "user", content: input };
    setMessages(prev => [...prev, userMessage]);
    setInput("");
    setBusy(true);

    const cid = await ensureChat();
    // No need to persist manually - backend does it in sendMessageToBackend

    try {
      // Send message to backend - pass video_id for demo chatbot detection
      // This persists both the user message and the generated response
      const reply = await sendMessageToBackend(cid, input, selectedVideoId || undefined);

      const aiMessage: Message = {
        role: "assistant",
        content: reply,
      };

      setMessages(prev => [...prev, aiMessage]);
      // No need to persist manually - backend already saved it
    } catch (e: any) {
      const aiMessage: Message = {
        role: "assistant",
        content: `Error: ${e?.message || e}`,
      };
      setMessages(prev => [...prev, aiMessage]);
      // Only persist error messages if backend didn't save them? 
      // Actually, if the backend errored, it might not have saved properly.
      // But typically we don't save client-side error generation in DB unless we have a specific endpoint.
      // For now, removing persistence to match standard behavior.
    } finally {
      setBusy(false);
    }
  };

  const samplePrompts = selectedVideoId ? [
    "What assets were detected in this video?",
    "What's at timestamp 1:30?",
    "How many traffic signs are there?",
    "Are there any damaged or poor condition assets?",
    "Summarize the road infrastructure",
    "What's at frame 60?",
  ] : [
    "How many routes we have surveyed?",
    "Tell me about route 258",
    "How many surveys we have conducted this month?",
    "Who conducted most surveys?",
    "What dates were surveys conducted?",
    "What is the condition of Street Lights?"
  ];

  const roadReportMarkdown = `
To improve the road shown in \`2025_0817_115147_F\`

Found **183** damaged assets requiring attention.

**Recommended Actions:**

* **Carriageway** (70 items)
  * Recommendation: Fill potholes, repair cracks, resurface if needed

* **Road Marking Line** (68 items)
  * Recommendation: Repaint faded or damaged road markings

* **Road Marking Point** (17 items)
  * Recommendation: Replace damaged road studs or markings

* **Kerb** (6 items)
  * Recommendation: Repair cracked or damaged kerb sections

* **Fence** (5 items)
  * Recommendation: Repair or replace damaged fence panels for safety

* **STREET LIGHT** (5 items)
  * Recommendation: Replace bulbs, check electrical connections, or replace fixtures

* **Traffic Sign** (5 items)
  * Recommendation: Clean, repaint, or replace damaged signs for visibility

* **Road Marking Polygon** (3 items)
  * Recommendation: Inspect and repair damaged road marking polygon

* **Traffic Bollard** (2 items)
  * Recommendation: Replace missing or broken bollards

* **STREET LIGHT FEEDER PILLAR** (2 items)
  * Recommendation: Check electrical components, repair enclosure damage
`;

  return (
    <div className="h-screen flex w-full overflow-hidden">
      <div className="flex-1 flex flex-col max-w-4xl mx-auto w-full">
        {/* Header with Video Selector */}
        <div className="p-6 border-b border-border space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center">
              <Sparkles className="h-5 w-5 text-white" />
            </div>
            <div className="flex-1">
              <h1 className="text-2xl font-bold">Ask AI</h1>
              <p className="text-sm text-muted-foreground">Query video data with natural language</p>
            </div>
          </div>

          {/* Video Selector */}
          <div className="flex items-center gap-3">
            <Video className="h-5 w-5 text-muted-foreground" />
            <Select value={selectedVideoId} onValueChange={handleVideoSelect}>
              <SelectTrigger className="flex-1">
                <SelectValue placeholder="Select a processed video to analyze..." />
              </SelectTrigger>
              <SelectContent>
                {videos.length === 0 ? (
                  <SelectItem value="none" disabled>No processed videos available</SelectItem>
                ) : (
                  videos.map((video) => (
                    <SelectItem key={video._id} value={video._id}>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{video.title}</span>
                        <Badge variant="outline" className="text-xs">Route {video.route_id}</Badge>
                      </div>
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>

            {/* Uploa/d Button */}
            {/* <Dialog open={uploadDialogOpen} onOpenChange={setUploadDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="icon">
                  <Upload className="h-4 w-4" />
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Upload Video</DialogTitle>
                  <DialogDescription>
                    Upload a new video for AI analysis
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="video-file">Video File</Label>
                    <Input
                      id="video-file"
                      type="file"
                      accept="video/*"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          setUploadFile(file);
                          if (!uploadTitle) {
                            setUploadTitle(file.name.replace(/\.[^/.]+$/, ""));
                          }
                        }
                      }}
                      disabled={uploading}
                    />
                    {uploadFile && (
                      <p className="text-xs text-muted-foreground">
                        {uploadFile.name} ({(uploadFile.size / 1024 / 1024).toFixed(2)} MB)
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="video-title">Title</Label>
                    <Input
                      id="video-title"
                      value={uploadTitle}
                      onChange={(e) => setUploadTitle(e.target.value)}
                      placeholder="Enter video title"
                      disabled={uploading}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="route-id">Route ID</Label>
                    <Input
                      id="route-id"
                      type="number"
                      value={uploadRouteId}
                      onChange={(e) => setUploadRouteId(e.target.value)}
                      placeholder="Enter route ID"
                      disabled={uploading}
                    />
                  </div>

                  {uploading && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Uploading...</span>
                        <span className="font-medium">{uploadProgress.toFixed(0)}%</span>
                      </div>
                      <Progress value={uploadProgress} className="h-2" />
                    </div>
                  )}

                  <div className="flex gap-2 justify-end">
                    <Button
                      variant="outline"
                      onClick={() => setUploadDialogOpen(false)}
                      disabled={uploading}
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={handleUpload}
                      disabled={uploading || !uploadFile || !uploadTitle || !uploadRouteId}
                    >
                      {uploading ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Uploading...
                        </>
                      ) : (
                        <>
                          <Upload className="h-4 w-4 mr-2" />
                          Upload
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog> */}

            {loadingFrames && <Loader2 className="h-5 w-5 animate-spin text-primary" />}
          </div>

          {/* Video Info Badge */}
          {selectedVideo && videoFrames.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              {/* <Badge variant="secondary" className="gap-1">
                <ImageIcon className="h-3 w-3" />
                {videoFrames.length} frames
              </Badge> */}
              {/* <Badge variant="secondary" className="gap-1">
                <Clock className="h-3 w-3" />
                {selectedVideo.duration_seconds ? formatTimestamp(selectedVideo.duration_seconds) : "Unknown duration"}
              </Badge> */}
              <Badge variant="secondary" className="gap-1">
                <MapPin className="h-3 w-3" />
                Route {selectedVideo.route_id}
              </Badge>
            </div>
          )}
        </div>

        {/* Messages */}
        <ScrollArea className="flex-1 p-6">
          <div className="space-y-4">
            {messages.map((message, idx) => (
              <div key={idx} className={cn("flex gap-3", message.role === "user" ? "justify-end" : "justify-start")}>
                {message.role === "assistant" && (
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <MessageSquare className="h-4 w-4 text-foreground" />
                  </div>
                )}
                <div className="max-w-[80%] space-y-2">
                  <Card className={cn("ask-ai-markdown-container", "p-4", message.role === "user" ? "bg-primary text-primary-foreground" : "bg-card")}>
                    {message.role === "user" ? (
                      <p className="text-sm">{message.content}</p>
                    ) : (
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={markdownComponents}
                      >
                        {message.content}
                      </ReactMarkdown>
                    )}
                  </Card>

                  {/* Show relevant frames if available */}
                  {message.frames && message.frames.length > 0 && (
                    <Collapsible>
                      <CollapsibleTrigger asChild>
                        <Button variant="ghost" size="sm" className="gap-1 text-xs">
                          <ImageIcon className="h-3 w-3" />
                          View {message.frames.length} related frame{message.frames.length > 1 ? "s" : ""}
                          <ChevronDown className="h-3 w-3" />
                        </Button>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="grid grid-cols-3 gap-2 mt-2">
                          {message.frames.map((frame, fidx) => (
                            <Card key={fidx} className="p-2 text-xs">
                              <div className="font-semibold mb-1">
                                Frame {frame.frame_number} • {formatTimestamp(frame.timestamp)}
                              </div>
                              <div className="text-muted-foreground">
                                {frame.detections.length > 0
                                  ? frame.detections.slice(0, 3).map(d => d.class_name).join(", ")
                                  : "No detections"}
                                {frame.detections.length > 3 && ` +${frame.detections.length - 3} more`}
                              </div>
                            </Card>
                          ))}
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  )}
                </div>
                {message.role === "user" && (
                  <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center flex-shrink-0">
                    <span className="text-accent font-semibold text-sm">U</span>
                  </div>
                )}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        </ScrollArea>

        {/* Sample Prompts */}
        {samplePrompts.length > 0 && messages.length <= 2 && (
          <div className="px-6 pb-4">
            <p className="text-sm font-medium mb-2 text-muted-foreground">Try these:</p>
            <div className="flex flex-wrap gap-2">
              {samplePrompts.map((prompt, idx) => (
                <Button
                  key={idx}
                  variant="outline"
                  size="sm"
                  className="text-xs h-7"
                  onClick={() => setInput(prompt)}
                >
                  {prompt}
                </Button>
              ))}
            </div>
          </div>
        )}

        {/* Input */}
        <div className="p-6 border-t border-border">
          <div className="flex gap-2">
            <Input
              placeholder={selectedVideoId ? "Ask about assets, timestamps, conditions..." : "Ask about assets, timestamps, conditions... (Select a video for specific analysis)"}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
              className="flex-1"
              disabled={busy}
            />
            <Button
              onClick={handleSend}
              size="icon"
              disabled={busy}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

