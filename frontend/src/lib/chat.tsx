import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, streamChat } from "./api";
import { useStore } from "./store";

export type ChatCard = { type: string; data: any };
export type ChatMessage = {
  id: string | number;
  role: "user" | "assistant";
  content: string;
  cards: ChatCard[];
  meta?: any;
  pending?: boolean;
  tools?: { name: string; tier: string; state: string; ok?: boolean }[];
  attachment?: boolean;
  error?: string;
};

type ChatState = { messages: ChatMessage[]; busy: boolean; loaded: boolean; send: (text: string, attachment?: string | null) => Promise<void> };

const ChatCtx = createContext<ChatState | null>(null);

export function ChatProvider({ children }: { children: ReactNode }) {
  const { session, chatDraft, consumeDraft, bump, pushToast } = useStore();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const busyRef = useRef(false);
  const persona = session?.persona;
  const token = session?.workspace_token;

  useEffect(() => {
    if (!persona) return;
    setLoaded(false);
    api
      .get<any[]>("/chat/history")
      .then((rows) =>
        setMessages(
          rows.map((r) => ({
            id: r.id, role: r.role, content: r.content.replace(" [document attached]", ""), attachment: r.content.endsWith("[document attached]"), cards: r.cards ?? [], meta: r.meta,
          })),
        ),
      )
      .catch(() => setMessages([]))
      .finally(() => setLoaded(true));
  }, [persona, token]);

  const send = useCallback(
    async (text: string, attachment?: string | null) => {
      const message = text.trim();
      if (!message || busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      const uid = `u${Date.now()}`;
      const aid = `a${Date.now()}`;
      setMessages((prev) => [...prev, { id: uid, role: "user", content: message, cards: [], attachment: !!attachment }, { id: aid, role: "assistant", content: "", cards: [], pending: true, tools: [] }]);
      const patch = (fn: (m: ChatMessage) => ChatMessage) => setMessages((prev) => prev.map((m) => (m.id === aid ? fn(m) : m)));
      try {
        await streamChat(
          { message, attachment_text: attachment ?? undefined },
          {
            onEvent: (event, data) => {
              if (event === "tool") {
                patch((m) => {
                  const tools = [...(m.tools ?? [])];
                  const idx = tools.findIndex((t) => t.name === data.name && t.state === "running");
                  if (data.state === "running") tools.push(data);
                  else if (idx >= 0) tools[idx] = data;
                  return { ...m, tools };
                });
              } else if (event === "cards") patch((m) => ({ ...m, cards: data.cards }));
              else if (event === "delta") patch((m) => ({ ...m, content: m.content + data.text }));
              else if (event === "done") patch((m) => ({ ...m, pending: false, meta: data.meta }));
              else if (event === "error") patch((m) => ({ ...m, pending: false, error: data.message }));
            },
          },
        );
      } catch (e: any) {
        patch((m) => ({ ...m, pending: false, error: e.status === 429 ? "You're sending messages quickly. Wait a moment and try again." : e.message }));
        if (e.status !== 429) pushToast({ kind: "blocked", title: "Remi couldn't answer", body: e.message });
      } finally {
        patch((m) => ({ ...m, pending: false }));
        busyRef.current = false;
        setBusy(false);
        bump();
      }
    },
    [bump, pushToast],
  );

  // Messages queued from anywhere in the app ("Plan it", "Review", demo controls) are sent once history has loaded.
  useEffect(() => {
    if (!chatDraft || !loaded || busyRef.current || !chatDraft.autoSend) return;
    const d = chatDraft;
    consumeDraft();
    send(d.message, d.attachment);
  }, [chatDraft, loaded, consumeDraft, send]);

  const value = useMemo(() => ({ messages, busy, loaded, send }), [messages, busy, loaded, send]);
  return <ChatCtx.Provider value={value}>{children}</ChatCtx.Provider>;
}

export function useChat(): ChatState {
  const c = useContext(ChatCtx);
  if (!c) throw new Error("useChat outside provider");
  return c;
}
