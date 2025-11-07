import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MessageSquare, Send, Sparkles } from "lucide-react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const samplePrompts = [
  "Show me roads with >50 poor assets last month",
  "List all traffic signs in Al Corniche",
  "Export inventory for Al Rayyan Road",
  "What's the condition summary for R001?",
];

export default function AskAI() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content: "Hello! I'm Tareeq AI Assistant. I can help you analyze road assets, search the inventory, and generate reports. Try asking me about asset conditions, specific roads, or data exports.",
    },
  ]);
  const [input, setInput] = useState("");

  const handleSend = () => {
    if (!input.trim()) return;

    const userMessage: Message = { role: "user", content: input };
    setMessages([...messages, userMessage]);

    // Mock AI response
    setTimeout(() => {
      const aiMessage: Message = {
        role: "assistant",
        content: "This is a demo response for Phase 1. In production, I'll connect to RoadGPT to analyze your query and provide detailed insights about road assets, conditions, and trends.",
      };
      setMessages((prev) => [...prev, aiMessage]);
    }, 500);

    setInput("");
  };

  return (
    <div className="h-screen flex w-full overflow-hidden">
      <div className="flex-1 flex flex-col max-w-4xl mx-auto w-full">
        {/* Header */}
        <div className="p-6 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center">
              <Sparkles className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Ask AI</h1>
              <p className="text-sm text-muted-foreground">
                Intelligent assistant for road asset analysis
              </p>
            </div>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {messages.map((message, idx) => (
            <div
              key={idx}
              className={cn(
                "flex gap-3",
                message.role === "user" ? "justify-end" : "justify-start"
              )}
            >
              {message.role === "assistant" && (
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <MessageSquare className="h-4 w-4 text-primary" />
                </div>
              )}
              <Card
                className={cn(
                  "p-4 max-w-[80%]",
                  message.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-card"
                )}
              >
                <p className="text-sm">{message.content}</p>
              </Card>
              {message.role === "user" && (
                <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center flex-shrink-0">
                  <span className="text-accent font-semibold text-sm">U</span>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Sample Prompts */}
        {messages.length === 1 && (
          <div className="p-6 border-t border-border">
            <p className="text-sm font-medium mb-3">Try these questions:</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {samplePrompts.map((prompt, idx) => (
                <Button
                  key={idx}
                  variant="outline"
                  size="sm"
                  className="justify-start text-left h-auto py-3"
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
              placeholder="Ask me anything about your road assets..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
              className="flex-1"
            />
            <Button onClick={handleSend} size="icon">
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
