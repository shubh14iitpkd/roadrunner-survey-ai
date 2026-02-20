import { useState, useEffect, useRef, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MessageSquare, Send, Sparkles, MapPin, ChevronDown, Waypoints, Loader2, Image as ImageIcon } from "lucide-react";
import { api } from "@/lib/api";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { VisualizationBlock } from "@/components/VisualizationBlock";
import { MapBlock } from "@/components/MapBlock";
import { ChatHistorySidebar, type ChatItem } from "@/components/ChatHistorySidebar";

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

interface RouteInfo {
  route_id: number;
  road_name: string;
  road_type: string;
  estimated_distance_km?: number;
}

// Send message to backend API
async function sendMessageToBackend(
  chatId: string,
  question: string,
  routeId?: number
): Promise<string> {
  const response = await api.ai.sendMessage(chatId, "user", question, undefined, routeId);
  // Backend returns { user_message: {...}, assistant_message: {...} }
  console.log(response);
  return response.assistant_message?.content || response.content || "(No response)";
}

const WELCOME_MESSAGE: Message = {
  role: "assistant",
  content: "Hello! I'm RoadSight AI Assistant. Select a route above to start analyzing. I can answer questions about survey history, asset totals, and conditions across the route.",
};

const markdownComponents = {
  table({ children }: any) {
    return (
      <div className="my-4 w-full overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm text-left border-collapse">
          {children}
        </table>
      </div>
    );
  },
  thead({ children }: any) {
    return <thead className="bg-muted text-center text-muted-foreground font-medium border-b border-border">{children}</thead>;
  },
  th({ children }: any) {
    return <th className="px-4 py-3 font-semibold border-r last:border-r-0">{children}</th>;
  },
  td({ children }: any) {
    return <td className="px-4 py-2 border-r text-center border-border/50 first:text-left last:border-r-0">{children}</td>;
  },
  tr({ children }: any) {
    return <tr className="hover:bg-muted/50 transition-colors border-b border-border/50 last:border-b-0">{children}</tr>;
  },
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
    if (lang === "map") {
      return (
        <MapBlock
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
  const [messages, setMessages] = useState<Message[]>([WELCOME_MESSAGE]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [chatId, setChatId] = useState<string | null>(null);
  
  // Route selection
  const [routes, setRoutes] = useState<RouteInfo[]>([]);
  const [selectedRouteId, setSelectedRouteId] = useState<string>(""); // Stored as string for Select component
  const [selectedRoute, setSelectedRoute] = useState<RouteInfo | null>(null);

  // Chat history sidebar
  const [chats, setChats] = useState<ChatItem[]>([]);
  const [chatsLoading, setChatsLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isFirstMessage, setIsFirstMessage] = useState(true);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const handleRouteSelect = (value: string) => {
    console.log("Route selected:", value);
    setSelectedRouteId(value);
    const route = routes.find(r => r.route_id.toString() === value);
    setSelectedRoute(route || null);
    
    // Add system message
    if (route) {
        setMessages(prev => [...prev, {
            role: "assistant",
            content: `Selected **${route.road_name}** (Route ${route.route_id}).\nYou can ask about:\n* "How many surveys for this route?"\n* "What is the condition of traffic signs?"\n* "Show me a list of videos"`,
        }]);
    }
  };

  // Load roads
  useEffect(() => {
    (async () => {
      try {
        const resp = await api.roads.list();
        if (resp?.items) {
          const routeList = resp.items.map((r: any) => ({
            route_id: r.route_id,
            road_name: r.road_name,
            road_type: r.road_type,
            estimated_distance_km: r.estimated_distance_km,
          }));
          setRoutes(routeList);
          console.log("Loaded routes:", routeList);
        }
      } catch (err) {
        console.error("Failed to load routes:", err);
      }
    })();
  }, []);

  // Load chat history on mount
  const loadChats = useCallback(async () => {
    setChatsLoading(true);
    try {
      const resp = await api.ai.listChats();
      setChats(resp?.items || []);
    } catch (err) {
      console.error("Failed to load chats:", err);
    } finally {
      setChatsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadChats();
  }, [loadChats]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const ensureChat = async () => {
    if (chatId) return chatId;
    try {
      const title = input.trim().slice(0, 60) || "Route Analysis Chat";
      // Pass route_id if selected
      const routeId = selectedRouteId ? parseInt(selectedRouteId) : undefined;
      const resp = await api.ai.createChat(title, undefined, routeId);
      const newChatId = resp.chat._id as string;
      setChatId(newChatId);
      setIsFirstMessage(true);
      // Add to local chat list immediately
      setChats(prev => [resp.chat, ...prev]);
      return newChatId;
    } catch {
      return null;
    }
  };

  const handleSend = async () => {
    if (!input.trim() || busy) return;

    const userMessage: Message = { role: "user", content: input };
    const userInput = input;
    setMessages(prev => [...prev, userMessage]);
    setInput("");
    setBusy(true);

    const cid = await ensureChat();

    try {
      // Send message to backend
      const routeId = selectedRouteId ? parseInt(selectedRouteId) : undefined;
      const reply = await sendMessageToBackend(cid!, userInput, routeId);

      const aiMessage: Message = {
        role: "assistant",
        content: reply,
      };

      setMessages(prev => [...prev, aiMessage]);

      // Auto-rename chat to first user message
      if (isFirstMessage && cid) {
        const autoTitle = userInput.trim().slice(0, 60);
        try {
          await api.ai.renameChat(cid, autoTitle);
          setChats(prev =>
            prev.map(c => c._id === cid ? { ...c, title: autoTitle, last_message_preview: userInput.slice(0, 200) } : c)
          );
        } catch { /* ignore rename errors */ }
        setIsFirstMessage(false);
      } else if (cid) {
        // Update last_message_preview in local state
        setChats(prev =>
          prev.map(c => c._id === cid ? { ...c, last_message_preview: userInput.slice(0, 200), updated_at: new Date().toISOString() } : c)
        );
      }
    } catch (e: any) {
      const aiMessage: Message = {
        role: "assistant",
        content: `Error: ${e?.message || e}`,
      };
      setMessages(prev => [...prev, aiMessage]);
    } finally {
      setBusy(false);
    }
  };

  // Switch to an existing chat
  const handleSelectChat = async (selectedChatId: string) => {
    if (selectedChatId === chatId) return;
    
    setChatId(selectedChatId);
    setIsFirstMessage(false);
    setBusy(true);

    try {
      const resp = await api.ai.listMessages(selectedChatId);
      const msgs: Message[] = (resp?.items || []).map((m: any) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
        timestamp: m.created_at,
      }));
      setMessages(msgs.length > 0 ? msgs : [WELCOME_MESSAGE]);
    } catch (err) {
      console.error("Failed to load messages:", err);
      setMessages([WELCOME_MESSAGE]);
    } finally {
      setBusy(false);
    }
  };

  // Start a new chat
  const handleNewChat = () => {
    setChatId(null);
    setIsFirstMessage(true);
    setMessages([WELCOME_MESSAGE]);
  };

  // Remove deleted chat from local list
  const handleDeleteChat = (deletedChatId: string) => {
    setChats(prev => prev.filter(c => c._id !== deletedChatId));
    // If we deleted the active chat, reset to new chat
    if (deletedChatId === chatId) {
      handleNewChat();
    }
  };

  console.log(selectedRouteId);
  const samplePrompts = selectedRouteId ? [
    "What is the condition of assets on this route?",
    "How many surveys have been done?",
    "List all videos for this route",
    "Show me a summary of road damage",
    "How many traffic signs are there?"
  ] : [
    "How many routes do we have?",
    "List all videos wth status completed",
    "Which route has the most damage?",
  ];

  return (
    <div className="h-screen flex w-full overflow-hidden">
      <div className="flex-1 flex flex-col max-w-4xl mx-auto w-full">
        {/* Header with Selector */}
        <div className="p-6 border-b border-border space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center">
              <Sparkles className="h-5 w-5 text-white" />
            </div>
            <div className="flex-1">
              <h1 className="text-2xl font-bold">Ask AI</h1>
              <p className="text-sm text-muted-foreground">Query road network data with natural language</p>
            </div>
            <ChatHistorySidebar
              chats={chats}
              activeChatId={chatId}
              loading={chatsLoading}
              onSelectChat={handleSelectChat}
              onNewChat={handleNewChat}
              onDeleteChat={handleDeleteChat}
              open={sidebarOpen}
              onOpenChange={setSidebarOpen}
            />
          </div>

          {/* Route Selector */}
          <div className="flex items-center gap-3">
            <Waypoints className="h-5 w-5 text-muted-foreground" />
            <Select value={selectedRouteId} onValueChange={handleRouteSelect}>
              <SelectTrigger className="flex-1">
                <SelectValue placeholder="Select a route to analyze..." />
              </SelectTrigger>
              <SelectContent>
                {routes.length === 0 ? (
                  <SelectItem value="none" disabled>No routes available</SelectItem>
                ) : (
                  routes.map((route) => (
                    <SelectItem key={route.route_id} value={route.route_id.toString()}>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{route.road_name}</span>
                        <Badge variant="outline" className="text-xs">ID: {route.route_id}</Badge>
                      </div>
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>

          </div>

          {/* Route Info Badge */}
          {selectedRoute && (
            <div className="flex gap-2 flex-wrap">
              <Badge variant="secondary" className="gap-1">
                <MapPin className="h-3 w-3" />
                {selectedRoute.road_type}
              </Badge>
              {selectedRoute.estimated_distance_km && (
                <Badge variant="secondary" className="gap-1">
                    {selectedRoute.estimated_distance_km} km
                </Badge>
              )}
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
              placeholder={selectedRouteId ? "Ask about surveys, conditions, assets..." : "Ask about global stats or select a route..."}
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
