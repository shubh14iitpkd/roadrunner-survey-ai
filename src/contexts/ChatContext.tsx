import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { api } from "@/lib/api";
import { type ChatItem } from "@/components/ChatHistorySidebar";

// ── Types ────────────────────────────────────────────────────────────────────

export interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp?: string;
}

export interface RouteInfo {
  route_id: number;
  road_name: string;
  road_type: string;
  estimated_distance_km?: number;
}

export const WELCOME_MESSAGE: Message = {
  role: "assistant",
  content:
    "Hello! I'm RoadSight AI Assistant. I can answer questions about survey history, asset totals, and conditions across the route.",
};

async function sendMessageToBackend(
  chatId: string,
  question: string,
  routeId?: number
): Promise<string> {
  const response = await api.ai.sendMessage(chatId, "user", question, undefined, routeId);
  console.log(response);
  return response.assistant_message?.content || response.content || "(No response)";
}

// ── Context value shape ───────────────────────────────────────────────────────

interface ChatContextValue {
  // Messages
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;

  // Input
  input: string;
  setInput: (v: string) => void;

  // Busy state
  busy: boolean;

  // Active chat
  chatId: string | null;

  // Routes
  routes: RouteInfo[];
  selectedRouteId: string;
  selectedRoute: RouteInfo | null;
  handleRouteSelect: (value: string) => void;

  // Chat history
  chats: ChatItem[];
  chatsLoading: boolean;
  sidebarOpen: boolean;
  setSidebarOpen: (v: boolean) => void;

  // Handlers
  handleSend: () => Promise<void>;
  handleSelectChat: (selectedChatId: string) => Promise<void>;
  handleNewChat: () => void;
  handleDeleteChat: (deletedChatId: string) => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

// ── Provider ─────────────────────────────────────────────────────────────────

export function ChatProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<Message[]>([WELCOME_MESSAGE]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [chatId, setChatId] = useState<string | null>(null);
  const [isFirstMessage, setIsFirstMessage] = useState(true);

  // Routes
  const [routes, setRoutes] = useState<RouteInfo[]>([]);
  const [selectedRouteId, setSelectedRouteId] = useState<string>("");
  const [selectedRoute, setSelectedRoute] = useState<RouteInfo | null>(null);

  // Chat history sidebar
  const [chats, setChats] = useState<ChatItem[]>([]);
  const [chatsLoading, setChatsLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Load roads once
  useEffect(() => {
    (async () => {
      try {
        const resp = await api.roads.list();
        if (resp?.items) {
          const routeList: RouteInfo[] = resp.items.map((r: any) => ({
            route_id: r.route_id,
            road_name: r.road_name,
            road_type: r.road_type,
            estimated_distance_km: r.estimated_distance_km,
          }));
          setRoutes(routeList);
        }
      } catch (err) {
        console.error("Failed to load routes:", err);
      }
    })();
  }, []);

  // Load chat history once
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

  const handleRouteSelect = (value: string) => {
    setSelectedRouteId(value);
    const route = routes.find((r) => r.route_id.toString() === value);
    setSelectedRoute(route || null);
  };

  const ensureChat = async (userInput: string): Promise<string | null> => {
    if (chatId) return chatId;
    try {
      const title = userInput.trim().slice(0, 60) || "Route Analysis Chat";
      const routeId = selectedRouteId ? parseInt(selectedRouteId) : undefined;
      const resp = await api.ai.createChat(title, undefined, routeId);
      const newChatId = resp.chat._id as string;
      setChatId(newChatId);
      setIsFirstMessage(true);
      setChats((prev) => [resp.chat, ...prev]);
      return newChatId;
    } catch {
      return null;
    }
  };

  const handleSend = async () => {
    if (!input.trim() || busy) return;

    const userInput = input;
    const userMessage: Message = { role: "user", content: userInput };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setBusy(true);

    const cid = await ensureChat(userInput);

    try {
      const routeId = selectedRouteId ? parseInt(selectedRouteId) : undefined;
      const reply = await sendMessageToBackend(cid!, userInput, routeId);

      const aiMessage: Message = { role: "assistant", content: reply };
      setMessages((prev) => [...prev, aiMessage]);

      if (isFirstMessage && cid) {
        const autoTitle = userInput.trim().slice(0, 60);
        try {
          await api.ai.renameChat(cid, autoTitle);
          setChats((prev) =>
            prev.map((c) =>
              c._id === cid
                ? { ...c, title: autoTitle, last_message_preview: userInput.slice(0, 200) }
                : c
            )
          );
        } catch {
          /* ignore */
        }
        setIsFirstMessage(false);
      } else if (cid) {
        setChats((prev) =>
          prev.map((c) =>
            c._id === cid
              ? {
                  ...c,
                  last_message_preview: userInput.slice(0, 200),
                  updated_at: new Date().toISOString(),
                }
              : c
          )
        );
      }
    } catch (e: any) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Error: ${e?.message || e}` },
      ]);
    } finally {
      setBusy(false);
    }
  };

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

  const handleNewChat = () => {
    setChatId(null);
    setIsFirstMessage(true);
    setMessages([WELCOME_MESSAGE]);
  };

  const handleDeleteChat = (deletedChatId: string) => {
    setChats((prev) => prev.filter((c) => c._id !== deletedChatId));
    if (deletedChatId === chatId) {
      handleNewChat();
    }
  };

  return (
    <ChatContext.Provider
      value={{
        messages,
        setMessages,
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
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useChatContext() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChatContext must be used inside <ChatProvider>");
  return ctx;
}
