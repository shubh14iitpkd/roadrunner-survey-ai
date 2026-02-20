import { useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  History,
  Plus,
  Trash2,
  MessageSquare,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { truncateString } from "@/helpers/truncateString";

export interface ChatItem {
  _id: string;
  title: string;
  updated_at: string;
  last_message_preview?: string;
}

interface ChatHistorySidebarProps {
  chats: ChatItem[];
  activeChatId: string | null;
  loading: boolean;
  onSelectChat: (chatId: string) => void;
  onNewChat: () => void;
  onDeleteChat: (chatId: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function timeAgo(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

export function ChatHistorySidebar({
  chats,
  activeChatId,
  loading,
  onSelectChat,
  onNewChat,
  onDeleteChat,
  open,
  onOpenChange,
}: ChatHistorySidebarProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDelete = async (e: React.MouseEvent, chatId: string) => {
    e.stopPropagation();
    setDeletingId(chatId);
    try {
      await api.ai.deleteChat(chatId);
      onDeleteChat(chatId);
    } catch (err) {
      console.error("Failed to delete chat:", err);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9"
          title="Chat History"
        >
          <History className="h-5 w-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-half sm:max-w-half p-0 flex flex-col">
        <SheetHeader className="p-4 pb-3 border-b border-border mt-6">
          <div className="flex items-center justify-between">
            <SheetTitle className="text-lg">Chat History</SheetTitle>
            <Button
              size="sm"
              onClick={() => {
                onNewChat();
                onOpenChange(false);
              }}
              className="gap-1.5 h-8"
            >
              <Plus className="h-3.5 w-3.5" />
              New Chat
            </Button>
          </div>
          <SheetDescription className="text-xs">
            {chats.length} conversation{chats.length !== 1 ? "s" : ""}
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="flex-1">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : chats.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
              <MessageSquare className="h-10 w-10 text-muted-foreground/40 mb-3" />
              <p className="text-sm text-muted-foreground">No conversations yet</p>
              <p className="text-xs text-muted-foreground/70 mt-1">Start a new chat to begin</p>
            </div>
          ) : (
            <div className="py-1">
              {chats.map((chat) => (
                <button
                  key={chat._id}
                  onClick={() => {
                    onSelectChat(chat._id);
                    onOpenChange(false);
                  }}
                  className={cn(
                    "w-full text-left px-4 py-3 flex items-start gap-3 transition-colors hover:bg-muted/50 group",
                    activeChatId === chat._id && "bg-muted"
                  )}
                >
                  <MessageSquare className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {truncateString(chat.title, 40) || "New Chat"}
                    </p>
                    {/* {chat.last_message_preview && (
                      <p className="text-xs text-muted-foreground text-wrap truncate mt-0.5">
                        {truncateString(chat.last_message_preview, 30)}
                      </p>
                    )} */}
                    <p className="text-xs text-muted-foreground/60 mt-1">
                      {timeAgo(chat.updated_at)}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={(e) => handleDelete(e, chat._id)}
                    disabled={deletingId === chat._id}
                  >
                    {deletingId === chat._id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
