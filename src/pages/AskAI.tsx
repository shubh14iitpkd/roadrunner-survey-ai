import { useState, useEffect, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MessageSquare, Send, Sparkles, Plus, Trash2, ChevronLeft, ChevronRight, Video, Upload, Loader2, CheckCircle, AlertCircle } from "lucide-react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { MarkdownMessage } from "@/components/MarkdownMessage";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface Chat {
  _id: string;
  title: string;
  created_at: string;
  updated_at: string;
  last_message_preview?: string;
  videoCount?: number;
  videoInfo?: string;
}

const samplePrompts = [
  "How many street lights are on route 105?",
  "Show me videos from route 258",
  "What defects are available in the database?",
  "List all severe potholes found in videos",
  "Show me all road defects detected",
];

interface VideoProcessingStatus {
  processing: boolean;
  progress: number;
  status: string;
  error?: string;
  result?: any;
}

export default function AskAI() {
  const [chats, setChats] = useState<Chat[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingChats, setLoadingChats] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  
  // Video upload states
  const [showVideoUpload, setShowVideoUpload] = useState(false);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [roadName, setRoadName] = useState("");
  const [roadSection, setRoadSection] = useState("");
  const [surveyor, setSurveyor] = useState("");
  const [videoProcessing, setVideoProcessing] = useState<VideoProcessingStatus>({
    processing: false,
    progress: 0,
    status: 'idle'
  });
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load all chats on mount
  useEffect(() => {
    loadChats();
  }, []);

  // Load messages when chat changes
  useEffect(() => {
    if (currentChatId) {
      loadMessages(currentChatId);
    } else {
      setMessages([
        {
          role: "assistant",
          content:
            "Hello! I'm RoadRunner AI Assistant. I can help you analyze road survey data, search for detections, and query videos. Ask me about routes, street lights, road markings, or any other road assets in our database.",
        },
      ]);
    }
  }, [currentChatId]);

  const loadChats = async () => {
    try {
      setLoadingChats(true);
      const response = await api.ai.listChats();
      const chatList = response.items || [];
      
      // Fetch video info for each chat
      const chatsWithVideos = await Promise.all(
        chatList.map(async (chat: Chat) => {
          try {
            const videoResponse = await api.ai.getChatVideos(chat._id);
            const videos = videoResponse.videos || [];
            return {
              ...chat,
              videoCount: videos.length,
              videoInfo: videos.length > 0 
                ? `📹 ${videos[0].road_name || videos[0].video_id}${videos.length > 1 ? ` +${videos.length - 1}` : ''}`
                : undefined
            };
          } catch (err) {
            return chat;
          }
        })
      );
      
      setChats(chatsWithVideos);
    } catch (err) {
      console.error("Failed to load chats:", err);
    } finally {
      setLoadingChats(false);
    }
  };

  const loadMessages = async (chatId: string) => {
    try {
      setLoadingMessages(true);
      const response = await api.ai.listMessages(chatId);
      const msgs = response.items || [];
      setMessages(
        msgs.map((m: any) => ({
          role: m.role,
          content: m.content,
        }))
      );
    } catch (err) {
      console.error("Failed to load messages:", err);
      setMessages([]);
    } finally {
      setLoadingMessages(false);
    }
  };

  const createNewChat = async () => {
    try {
      const title = "New Chat";
      const response = await api.ai.createChat(title);
      const newChat = response.chat;
      setChats((prev) => [newChat, ...prev]);
      setCurrentChatId(newChat._id);
    } catch (err) {
      console.error("Failed to create chat:", err);
    }
  };

  const deleteChat = async (chatId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Delete this chat?")) return;

    try {
      await api.ai.deleteChat(chatId);
      setChats((prev) => prev.filter((c) => c._id !== chatId));
      if (currentChatId === chatId) {
        setCurrentChatId(null);
      }
    } catch (err) {
      console.error("Failed to delete chat:", err);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || busy) return;

    const userMessage: Message = { role: "user", content: input };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setBusy(true);

    try {
      // Create chat if needed
      let chatId = currentChatId;
      if (!chatId) {
        const title = input.trim().slice(0, 60) || "New Chat";
        const response = await api.ai.createChat(title);
        chatId = response.chat._id;
        setCurrentChatId(chatId);
        setChats((prev) => [response.chat, ...prev]);
      }

      // Send message to backend
      const response = await api.ai.addMessage(chatId, userMessage.content);

      // Backend returns { user_message, assistant_message }
      const aiMessage: Message = {
        role: "assistant",
        content: response.assistant_message.content,
      };

      setMessages((prev) => [...prev, aiMessage]);

      // Update chat list
      loadChats();
    } catch (e: any) {
      console.error("Error sending message:", e);
      const errorMessage: Message = {
        role: "assistant",
        content: `Error: ${e?.message || "Failed to get response. Please try again."}`,
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setBusy(false);
    }
  };

  const handleVideoUpload = async () => {
    if (!videoFile) {
      toast.error("Please select a video file");
      return;
    }

    // Create chat if needed
    let chatId = currentChatId;
    if (!chatId) {
      try {
        const response = await api.ai.createChat("Video Analysis");
        chatId = response.chat._id;
        setCurrentChatId(chatId);
        setChats((prev) => [response.chat, ...prev]);
      } catch (e: any) {
        toast.error("Failed to create chat");
        return;
      }
    }

    setVideoProcessing({ processing: true, progress: 5, status: 'Preparing upload...' });

    try {
      // Upload and process video with chat_id (with progress tracking)
      const result = await api.ai.processVideo(
        videoFile, 
        {
          road_name: roadName || 'Unknown Road',
          road_section: roadSection || 'Unknown Section',
          surveyor: surveyor || 'Unknown',
          chat_id: chatId
        },
        (progress) => {
          // Update progress: 0-80% = upload, 80-100% = processing
          const status = progress < 80 
            ? `Uploading to S3: ${Math.round(progress)}%`
            : progress < 90
            ? 'Processing video...'
            : 'Analyzing defects...';
          setVideoProcessing({ processing: true, progress, status });
        }
      );

      setVideoProcessing({ 
        processing: false, 
        progress: 100, 
        status: 'completed',
        result 
      });

      toast.success(`Video processed successfully! Found ${result.total_defects} defects.`);

      // Reload chat list to show video info
      await loadChats();

      // Add AI message with results
      const aiMessage: Message = {
        role: "assistant",
        content: `✅ Video processed successfully!\n\n📊 Results:\n- Total defects: ${result.total_defects}\n- Processing time: ${result.processing_time}\n- Severity distribution: ${JSON.stringify(result.severity_distribution)}\n- Type distribution: ${JSON.stringify(result.type_distribution)}\n\nYou can now ask me questions about the defects found in this video!`
      };
      setMessages((prev) => [...prev, aiMessage]);

      // Reset form
      setVideoFile(null);
      setRoadName("");
      setRoadSection("");
      setSurveyor("");
      setShowVideoUpload(false);

    } catch (e: any) {
      console.error("Error processing video:", e);
      setVideoProcessing({ 
        processing: false, 
        progress: 0, 
        status: 'error',
        error: e?.message 
      });
      toast.error(`Failed to process video: ${e?.message || 'Unknown error'}`);
    }
  };

  return (
    <div className="h-screen flex w-full overflow-hidden">
      {/* Sidebar */}
      <div
        className={cn(
          "border-r border-border bg-card transition-all duration-300",
          sidebarOpen ? "w-80" : "w-0"
        )}
      >
        {sidebarOpen && (
          <div className="flex flex-col h-full">
            {/* Sidebar Header */}
            <div className="p-4 border-b border-border">
              <Button onClick={createNewChat} className="w-full" size="sm">
                <Plus className="h-4 w-4 mr-2" />
                New Chat
              </Button>
            </div>

            {/* Chat List */}
            <div className="flex-1 overflow-y-auto p-2">
              {loadingChats ? (
                <div className="text-center text-sm text-muted-foreground p-4">Loading chats...</div>
              ) : chats.length === 0 ? (
                <div className="text-center text-sm text-muted-foreground p-4">No chats yet. Start a new one!</div>
              ) : (
                <div className="space-y-1">
                  {chats.map((chat) => (
                    <div
                      key={chat._id}
                      onClick={() => setCurrentChatId(chat._id)}
                      className={cn(
                        "p-3 rounded-lg cursor-pointer transition-colors group relative",
                        currentChatId === chat._id
                          ? "bg-primary/10 border border-primary/20"
                          : "hover:bg-accent/50"
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{chat.title}</p>
                          {chat.videoInfo && (
                            <p className="text-xs text-primary mt-1">{chat.videoInfo}</p>
                          )}
                          {chat.last_message_preview && (
                            <p className="text-xs text-muted-foreground truncate mt-1">
                              {chat.last_message_preview}
                            </p>
                          )}
                          <p className="text-xs text-muted-foreground mt-1">
                            {new Date(chat.updated_at).toLocaleDateString()}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={(e) => deleteChat(chat._id, e)}
                        >
                          <Trash2 className="h-3 w-3 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Toggle Sidebar Button */}
      <Button
        variant="ghost"
        size="icon"
        className="absolute left-2 top-4 z-10"
        onClick={() => setSidebarOpen(!sidebarOpen)}
      >
        {sidebarOpen ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      </Button>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col max-w-4xl mx-auto w-full">
        {/* Header */}
        <div className="p-6 border-b border-border">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center">
                <Sparkles className="h-5 w-5 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold">Ask AI</h1>
                <p className="text-sm text-muted-foreground">Intelligent assistant for road asset analysis & video defect detection</p>
              </div>
            </div>
            <Button 
              onClick={() => setShowVideoUpload(!showVideoUpload)} 
              variant={showVideoUpload ? "secondary" : "default"}
              size="sm"
            >
              <Video className="h-4 w-4 mr-2" />
              {showVideoUpload ? "Hide Upload" : "Upload Video"}
            </Button>
          </div>
        </div>

        {/* Video Upload Panel */}
        {showVideoUpload && (
          <Card className="m-6 p-6 bg-accent/50">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Upload className="h-5 w-5" />
              Upload Video for RAG Processing
            </h3>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-2 block">Video File</label>
                <Input
                  ref={fileInputRef}
                  type="file"
                  accept="video/*"
                  onChange={(e) => setVideoFile(e.target.files?.[0] || null)}
                  disabled={videoProcessing.processing}
                />
                {videoFile && (
                  <p className="text-sm text-muted-foreground mt-1">
                    Selected: {videoFile.name} ({(videoFile.size / (1024 * 1024)).toFixed(2)} MB)
                  </p>
                )}
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="text-sm font-medium mb-2 block">Road Name</label>
                  <Input
                    placeholder="e.g., Al Corniche"
                    value={roadName}
                    onChange={(e) => setRoadName(e.target.value)}
                    disabled={videoProcessing.processing}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-2 block">Road Section</label>
                  <Input
                    placeholder="e.g., Section A"
                    value={roadSection}
                    onChange={(e) => setRoadSection(e.target.value)}
                    disabled={videoProcessing.processing}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-2 block">Surveyor</label>
                  <Input
                    placeholder="e.g., John Doe"
                    value={surveyor}
                    onChange={(e) => setSurveyor(e.target.value)}
                    disabled={videoProcessing.processing}
                  />
                </div>
              </div>
              
              {videoProcessing.processing && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="text-sm">{videoProcessing.status}</span>
                  </div>
                  <div className="w-full bg-secondary rounded-full h-2">
                    <div 
                      className="bg-primary h-2 rounded-full transition-all duration-300"
                      style={{ width: `${videoProcessing.progress}%` }}
                    />
                  </div>
                </div>
              )}
              
              {videoProcessing.status === 'completed' && (
                <div className="flex items-center gap-2 text-green-600">
                  <CheckCircle className="h-4 w-4" />
                  <span className="text-sm">Processing completed!</span>
                </div>
              )}
              
              {videoProcessing.status === 'error' && (
                <div className="flex items-center gap-2 text-destructive">
                  <AlertCircle className="h-4 w-4" />
                  <span className="text-sm">{videoProcessing.error}</span>
                </div>
              )}

              <Button 
                onClick={handleVideoUpload} 
                disabled={!videoFile || videoProcessing.processing}
                className="w-full"
              >
                {videoProcessing.processing ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4 mr-2" />
                    Process Video with RAG
                  </>
                )}
              </Button>
            </div>
          </Card>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {loadingMessages ? (
            <div className="text-center text-muted-foreground">Loading messages...</div>
          ) : (
            messages.map((message, idx) => (
              <div key={idx} className={cn("flex gap-3", message.role === "user" ? "justify-end" : "justify-start")}>
                {message.role === "assistant" && (
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <MessageSquare className="h-4 w-4 text-foreground" />
                  </div>
                )}
                <Card className={cn("p-4 max-w-[80%]", message.role === "user" ? "bg-primary text-primary-foreground" : "bg-card")}>
                  {message.role === "assistant" ? (
                    <MarkdownMessage content={message.content} />
                  ) : (
                    <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                  )}
                </Card>
                {message.role === "user" && (
                  <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center flex-shrink-0">
                    <span className="text-accent font-semibold text-sm">U</span>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Sample Prompts */}
        {messages.length === 1 && !currentChatId && (
          <div className="p-6 border-t border-border">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {samplePrompts.map((prompt, idx) => (
                <Button key={idx} variant="outline" size="sm" className="justify-start text-left h-auto py-3" onClick={() => setInput(prompt)}>
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
              placeholder="Ask me anything about your road assets..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
              className="flex-1"
            />
            <Button onClick={handleSend} size="icon" disabled={busy}>
              <Send className="h-4 w-4" />
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
