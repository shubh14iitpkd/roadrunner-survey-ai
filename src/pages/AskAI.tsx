import { useEffect, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MessageSquare, Send, Sparkles, MapPin, Waypoints, Loader2, X, Database, Brain, BarChart2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { VisualizationBlock } from "@/components/VisualizationBlock";
import { MapBlock } from "@/components/MapBlock";
import { ChatHistorySidebar } from "@/components/ChatHistorySidebar";
import { useChatContext } from "@/contexts/ChatContext";
import { useState } from "react";
import { useTheme } from "next-themes";

// ── Thinking indicator ────────────────────────────────────────────────────────

const logos = {
  light: "/RoadGPT - colored.png",
  // dark: "/RoadGPT - clear.png"
  dark: "/RoadGPT - colored.png"
}

const THINKING_STEPS = [
  { icon: Brain, label: "Understanding your question...", duration: 1800 },
  { icon: Database, label: "Querying road network data...", duration: 2500 },
  { icon: BarChart2, label: "Analysing results...", duration: 2000 },
  { icon: Sparkles, label: "Generating response...", duration: Infinity },
];

function useThinkingStep(busy: boolean) {
  const [stepIdx, setStepIdx] = useState(0);
  useEffect(() => {
    if (!busy) { setStepIdx(0); return; }
    let current = 0;
    function advance() {
      const next = current + 1;
      if (next >= THINKING_STEPS.length) return;
      current = next;
      setStepIdx(next);
      if (THINKING_STEPS[next].duration !== Infinity) {
        setTimeout(advance, THINKING_STEPS[next].duration);
      }
    }
    const t = setTimeout(advance, THINKING_STEPS[0].duration);
    return () => clearTimeout(t);
  }, [busy]);

  return THINKING_STEPS[stepIdx];
}

function ThinkingIndicator({ busy }: { busy: boolean }) {
  const step = useThinkingStep(busy);
  const Icon = step.icon;

  return (
    <div className="flex gap-3 justify-start">
      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
        <MessageSquare className="h-4 w-4 text-foreground" />
      </div>
      <Card className="p-4 bg-card">
        <div className="flex items-center gap-3">
          <div className="relative">
            <Icon className="h-4 w-4 text-primary dark:text-muted-secondary animate-pulse" />
          </div>
          <span className="text-sm text-muted-foreground transition-all duration-500">
            {step.label}
          </span>
          <span className="flex gap-1 ml-1">
            {[0, 1, 2].map(i => (
              <span
                key={i}
                className="block w-1.5 h-1.5 rounded-full bg-primary/60"
                style={{ animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite` }}
              />
            ))}
          </span>
        </div>
      </Card>
    </div>
  );
}

// ── Markdown components ───────────────────────────────────────────────────────

const markdownComponents = {
  // Let visualization / map blocks break out of the <pre> wrapper that
  // ReactMarkdown adds around fenced code blocks. Without this the chart
  // inherits `white-space: pre` and overflows the message card.
  pre({ children }: any) {
    // If the single child is a VisualizationBlock or MapBlock rendered by the
    // `code` override below, return it unwrapped so it can size itself.
    const child = Array.isArray(children) ? children[0] : children;
    if (child?.type === VisualizationBlock || child?.type === MapBlock) {
      return <>{children}</>;
    }
    return <pre className="overflow-x-auto max-w-full">{children}</pre>;
  },
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
      return <VisualizationBlock jsonString={content} />;
    }
    if (lang === "map") {
      return <MapBlock jsonString={content} />;
    }
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  },
};

// ── Page component ────────────────────────────────────────────────────────────

export default function AskAI() {
  const {
    messages,
    input,
    setInput,
    busy,
    chatId,
    routes,
    selectedRouteId,
    selectedRoute,
    handleRouteSelect,
    chats,
    chatsLoading,
    sidebarOpen,
    setSidebarOpen,
    handleSend,
    handleSelectChat,
    handleNewChat,
    handleDeleteChat,
  } = useChatContext();

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const { resolvedTheme } = useTheme();

  // useEffect(() => {
  //   console.log(theme);
  // }, [theme]);
  const samplePrompts = selectedRouteId ? [
    "What is the condition of assets on this route?",
    "How many surveys have been done?",
    "Show me a summary of road damage",
    "How many traffic signs are there?"
  ] : [
    "How many routes do we have?",
    "What's the condition of street lights?",
    "Which route has the most damage?",
  ];

  return (
    <div className="h-screen flex w-full overflow-hidden">
      <div className="flex-1 flex flex-col max-w-6xl mx-auto w-full">
        {/* Header with Selector */}
        <div className="p-6 border-b border-border space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex-1 select-none">
              <img src={logos[resolvedTheme] || logos.light} alt="RoadGPT" className="h-6" />
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
              <div className="unselect-route">
                <Button variant="destructive" size="sm" className="rounded-full" onClick={() => handleRouteSelect("")}>
                  <X />
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Messages */}
        <ScrollArea className="flex-1 p-6">
          <div className="space-y-4">
            {messages.map((message, idx) => {
              const hasChart = message.role === "assistant" && (
                message.content.includes("```visualization") || message.content.includes("```map")
              );
              return (
              <div key={idx} className={cn("flex gap-3", message.role === "user" ? "justify-end" : "justify-start")}>
                {message.role === "assistant" && (
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <MessageSquare className="h-4 w-4 text-foreground" />
                  </div>
                )}
                <div className={cn("space-y-2", message.role === "user" ? "max-w-[75%]" : hasChart ? "w-full" : "max-w-[82%]")}>
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
              );
            })}
            {/* Thinking indicator — shown while busy */}
            {busy && <ThinkingIndicator busy={busy} />}
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
