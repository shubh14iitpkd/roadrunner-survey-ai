import { useState, useEffect, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MessageSquare, Send, Sparkles, Video, Clock, MapPin, Loader2, Image as ImageIcon, ChevronDown } from "lucide-react";
import { api } from "@/lib/api";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

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

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
const GEMINI_MODEL = "gemini-2.0-flash";

async function askGeminiWithContext(
  prompt: string, 
  videoContext: string,
  framesContext: string,
  conversationHistory: Message[]
): Promise<string> {
  if (!GEMINI_API_KEY) throw new Error("Missing VITE_GEMINI_API_KEY");
  
  const systemPrompt = `You are an AI assistant specialized in road asset analysis for RoadSight AI.
You have access to video survey data with frames extracted at regular intervals.
Each frame contains AI-detected road assets like traffic signs, street lights, guardrails, etc.

${videoContext}

${framesContext}

Answer questions about:
- Assets detected at specific timestamps
- Asset conditions and types
- Location-based queries
- Statistics and summaries
- Anomalies and issues

Be concise and reference specific timestamps/frame numbers when relevant.
If asked about a specific time, find the closest frame and describe what was detected.`;

  // Build conversation for context
  const messages = conversationHistory.slice(-6).map(m => 
    `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`
  ).join("\n\n");

  const fullPrompt = messages 
    ? `${systemPrompt}\n\nConversation history:\n${messages}\n\nUser: ${prompt}`
    : `${systemPrompt}\n\nUser: ${prompt}`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: fullPrompt }] }],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 1024,
        },
      }),
    }
  );
  
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  return text.trim() || "(No response)";
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
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

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
        }
      } catch (err) {
        console.error("Failed to load videos:", err);
      }
    })();
  }, []);

  // Load frames when video is selected
  useEffect(() => {
    if (!selectedVideoId) {
      setVideoFrames([]);
      setSelectedVideo(null);
      return;
    }

    const video = videos.find(v => v._id === selectedVideoId);
    setSelectedVideo(video || null);

    (async () => {
      setLoadingFrames(true);
      try {
        const resp = await api.frames.withDetections({ video_id: selectedVideoId, limit: 200 });
        if (resp?.items) {
          const frames: FrameData[] = resp.items.map((f: any) => ({
            frame_id: typeof f._id === 'object' ? f._id.$oid : f._id,
            frame_number: f.frame_number,
            timestamp: f.timestamp || f.frame_number, // seconds
            image_url: f.image_url,
            detections: f.detections || [],
            location: f.location,
          }));
          setVideoFrames(frames);
          
          // Add a system message about the loaded video
          if (video) {
            setMessages(prev => [...prev, {
              role: "assistant",
              content: `Loaded video "${video.title}" (Route ${video.route_id}). Found ${frames.length} frames with detections. You can now ask me about:\n• What assets are at a specific timestamp (e.g., "What's at 2:30?")\n• Asset summaries (e.g., "How many traffic signs are there?")\n• Condition analysis\n• Location-based queries`,
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
      const resp = await api.ai.createChat(title);
      setChatId(resp.chat._id);
      return resp.chat._id as string;
    } catch {
      return null;
    }
  };

  const persistMessage = async (cid: string, msg: Message) => {
    try {
      await api.ai.addMessage(cid, msg.role, msg.content);
    } catch {
      // ignore persistence errors
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

  const handleSend = async () => {
    if (!input.trim() || busy) return;

    const userMessage: Message = { role: "user", content: input };
    setMessages(prev => [...prev, userMessage]);
    setInput("");
    setBusy(true);

    const cid = await ensureChat();
    if (cid) persistMessage(cid, userMessage);

    try {
      // Check if user is asking about a specific timestamp
      const { timestamp, frameNumber } = parseTimestampFromQuery(input);
      let relevantFrames: FrameData[] = [];
      let additionalContext = "";

      if (timestamp !== undefined) {
        relevantFrames = findFramesNearTimestamp(timestamp);
        if (relevantFrames.length > 0) {
          additionalContext = `\n\nFrames near timestamp ${formatTimestamp(timestamp)}:\n` +
            relevantFrames.map(f => {
              const dets = f.detections.map(d => `${d.class_name} (${(d.confidence * 100).toFixed(1)}%)`).join(", ");
              return `Frame ${f.frame_number} at ${formatTimestamp(f.timestamp)}: ${dets || "No detections"}`;
            }).join("\n");
        }
      } else if (frameNumber !== undefined) {
        const frame = findFrameByNumber(frameNumber);
        if (frame) {
          relevantFrames = [frame];
          const dets = frame.detections.map(d => `${d.class_name} (${(d.confidence * 100).toFixed(1)}%)`).join(", ");
          additionalContext = `\n\nFrame ${frameNumber} at ${formatTimestamp(frame.timestamp)}: ${dets || "No detections"}`;
        }
      }

      const reply = await askGeminiWithContext(
        input,
        buildVideoContext(),
        buildFramesContext() + additionalContext,
        messages
      );

      const aiMessage: Message = { 
        role: "assistant", 
        content: reply,
        frames: relevantFrames.length > 0 ? relevantFrames : undefined,
        timestamp: timestamp !== undefined ? formatTimestamp(timestamp) : undefined,
      };
      
      setMessages(prev => [...prev, aiMessage]);
      if (cid) persistMessage(cid, aiMessage);
    } catch (e: any) {
      const aiMessage: Message = {
        role: "assistant",
        content: `Error: ${e?.message || e}`,
      };
      setMessages(prev => [...prev, aiMessage]);
      if (cid) persistMessage(cid, aiMessage);
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
    "What's at frame 50?",
  ] : [];

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
            <Select value={selectedVideoId} onValueChange={setSelectedVideoId}>
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
            {loadingFrames && <Loader2 className="h-5 w-5 animate-spin text-primary" />}
          </div>

          {/* Video Info Badge */}
          {selectedVideo && videoFrames.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              <Badge variant="secondary" className="gap-1">
                <ImageIcon className="h-3 w-3" />
                {videoFrames.length} frames
              </Badge>
              <Badge variant="secondary" className="gap-1">
                <Clock className="h-3 w-3" />
                {selectedVideo.duration_seconds ? formatTimestamp(selectedVideo.duration_seconds) : "Unknown duration"}
              </Badge>
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
                  <Card className={cn("p-4", message.role === "user" ? "bg-primary text-primary-foreground" : "bg-card")}> 
                    <p className="text-sm whitespace-pre-wrap">{message.content}</p>
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
              placeholder={selectedVideoId ? "Ask about assets, timestamps, conditions..." : "Select a video first..."}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
              className="flex-1"
              disabled={!selectedVideoId || busy}
            />
            <Button 
              onClick={handleSend} 
              size="icon" 
              disabled={busy || !GEMINI_API_KEY || !selectedVideoId}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}
