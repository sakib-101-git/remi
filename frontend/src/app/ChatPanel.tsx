import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { ArrowUp, FileText, Paperclip, X } from "lucide-react";
import { api } from "../lib/api";
import { CardList } from "../cards/CardList";
import { type ChatMessage, useChat } from "../lib/chat";
import { TOOL_PROGRESS } from "../lib/copy";
import { cx, firstName, plain, shortDate } from "../lib/format";
import { useStore } from "../lib/store";
import { AppIcon, Button, Dialog, Dots, IconButton, Note, TextArea } from "../ui";

const SUGGESTIONS: Record<string, string[]> = {
  rahim: ["Pay my £9,250 tuition before the deadline, cheapest safe way", "How am I doing this month? How long will my money last?", "Send 15,000 BDT to my mom"],
  ada: ["Pay my winter tuition instalment before the deadline", "How am I doing this month? How long will my money last?", "Send 150,000 NGN to my mum"],
  priya: ["Pay my student fees at Lakeshore", "How long will my money last?", "Send 20,000 INR to my mom"],
};

/** `[KB: Title]` citations become inline links that open the article. */
function withCitations(text: string): string {
  return text.replace(/\[KB:\s*([^\]]+)\]/g, (_m, t) => ` \`KB·${t.trim()}\``);
}

/** Keeps live and replayed model answers in the same plain voice as the UI (the cards carry the exact figures). */
function tidy(text: string): string {
  return plain(text)
    .replace(/\b(20\d\d-\d\d-\d\d)(?:T[\d:+.Z-]+)?\b/g, (d) => shortDate(d))
    .replace(/\b(?:true )?landed cost\b/gi, (m) => (/^[A-Z]/.test(m) ? "Total cost" : "total cost"))
    .replace(/\bworst-case arrival\b/gi, (m) => (/^[A-Z]/.test(m) ? "Arrives by" : "arrives by"))
    .replace(/\b(a|an) \*{0,2}T[0-4]\*{0,2} action\b/g, "an action that needs your approval")
    .replace(/\s*\(?\*{0,2}\bT[0-4]\b\*{0,2}\)?(?=[\s.,:;])/g, "")
    .replace(/Sandbox phone/g, "phone");
}

function Message({ m }: { m: ChatMessage }) {
  const { openKb } = useStore();
  const sources: any[] = m.cards.find((c) => c.type === "sources")?.data ?? [];
  if (m.role === "user") {
    return (
      <div className="flex animate-rise justify-end" data-role="user">
        <div className="max-w-[85%] rounded-card rounded-br-input bg-primary-soft px-4 py-3 text-body text-ink">
          {m.content}
          {m.attachment && <div className="mt-1 flex items-center gap-1.5 text-caption text-ink-muted"><FileText className="h-4 w-4" /> Document attached</div>}
        </div>
      </div>
    );
  }
  const running = m.tools?.filter((t) => t.state === "running").slice(-1)[0] ?? (m.pending ? m.tools?.slice(-1)[0] : undefined);
  return (
    <div className="animate-rise space-y-3">
      {m.pending && !m.content && (
        <div className="flex items-center gap-3 text-small text-ink-muted" data-testid="chat-working">
          <Dots className="text-primary" />
          {running ? `${TOOL_PROGRESS[running.name] ?? "Working"}…` : "Thinking…"}
        </div>
      )}
      {m.content && (
        <div className="prose-remi text-body" data-testid="assistant-message">
          <ReactMarkdown
            components={{
              code: ({ children }) => {
                const text = String(children);
                if (!text.startsWith("KB·")) return <code>{children}</code>;
                const title = text.slice(3);
                const src = sources.find((s) => s.title.toLowerCase() === title.toLowerCase());
                return src ? <button onClick={() => openKb(src.slug)} className="text-small font-semibold text-primary underline underline-offset-4">{title}</button> : <span className="text-small text-ink-muted">({title})</span>;
              },
            }}
          >
            {withCitations(tidy(m.content))}
          </ReactMarkdown>
        </div>
      )}
      {m.error && <Note tone="danger">{m.error}</Note>}
      {m.cards.length > 0 && <CardList cards={m.cards} />}
    </div>
  );
}

export function ChatPanel() {
  const { chatOpen, setChatOpen, session, chatDraft, consumeDraft } = useStore();
  const { messages, busy, loaded, send } = useChat();
  const [input, setInput] = useState("");
  const [attachment, setAttachment] = useState<string | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // While Remi works, follow the bottom; once the reply is in, show it from the top (question first, then answer, then cards).
  const last = messages[messages.length - 1];
  useEffect(() => {
    const box = scrollRef.current;
    if (!box) return;
    const users = box.querySelectorAll<HTMLElement>("[data-role='user']");
    const anchor = users[users.length - 1];
    if (last?.pending || !anchor) box.scrollTo({ top: box.scrollHeight, behavior: "smooth" });
    else box.scrollTo({ top: anchor.offsetTop - 16, behavior: "smooth" });
  }, [messages.length, last?.pending, chatOpen]);
  useEffect(() => {
    if (!chatOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setChatOpen(false);
    window.addEventListener("keydown", onKey);
    window.setTimeout(() => inputRef.current?.focus(), 50);
    return () => window.removeEventListener("keydown", onKey);
  }, [chatOpen, setChatOpen]);

  // Drafts that shouldn't auto-send ("Add a recipient with Remi") just prefill the composer.
  useEffect(() => {
    if (chatDraft && !chatDraft.autoSend) {
      setInput(chatDraft.message);
      if (chatDraft.attachment) setAttachment(chatDraft.attachment);
      consumeDraft();
    }
  }, [chatDraft, consumeDraft]);

  if (!chatOpen) return null;
  const submit = (text: string) => {
    if (!text.trim() || busy) return;
    send(text, attachment);
    setInput("");
    setAttachment(null);
  };
  const suggestions = SUGGESTIONS[session?.persona ?? "rahim"] ?? SUGGESTIONS.rahim;

  return (
    <aside role="dialog" aria-label="Ask Remi" data-testid="chat-panel" className="fixed inset-0 z-40 flex animate-slide-in flex-col bg-surface lg:inset-y-3 lg:left-auto lg:right-3 lg:w-[480px] lg:rounded-card lg:border lg:border-line lg:shadow-float">
      <header className="flex items-center gap-3 border-b border-line px-5 py-4">
        <AppIcon size={36} />
        <div className="min-w-0 flex-1">
          <div className="text-body-strong">Ask Remi</div>
          <div className="text-caption text-ink-muted">Remi prepares, you approve</div>
        </div>
        <IconButton label="Close chat" onClick={() => setChatOpen(false)}><X className="h-5 w-5" /></IconButton>
      </header>

      <div ref={scrollRef} className="scroll-thin relative flex-1 space-y-6 overflow-y-auto px-5 py-6">
        {loaded && messages.length === 0 && (
          <div className="pt-6">
            <h2 className="text-h1">Hi {firstName(session?.user.name)}, what can I take care of?</h2>
            <p className="mt-2 text-body text-ink-muted">I can pay tuition, send money home, convert currencies, track your spending and spot scams. You approve every payment.</p>
            <div className="mt-6 flex flex-col items-start gap-2">
              {suggestions.map((s) => (
                <button key={s} onClick={() => submit(s)} className="rounded-full border border-line bg-surface px-4 py-2 text-left text-small transition-colors hover:border-primary">{s}</button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) => <Message key={m.id} m={m} />)}
      </div>

      <div className="border-t border-line px-4 pb-4 pt-3">
        {attachment && (
          <div className="mb-2 flex items-center gap-2 rounded-input bg-surface-muted px-3 py-2 text-small">
            <FileText className="h-4 w-4 text-ink-muted" /> Document attached · Remi checks it for fraud first
            <button className="ml-auto text-ink-muted" onClick={() => setAttachment(null)} aria-label="Remove attachment"><X className="h-4 w-4" /></button>
          </div>
        )}
        <form onSubmit={(e) => { e.preventDefault(); submit(input); }} className="flex items-end gap-2 rounded-card border border-line bg-surface p-2 focus-within:border-primary">
          <IconButton type="button" label="Attach document" onClick={() => setAttachOpen(true)}><Paperclip className="h-5 w-5" /></IconButton>
          <textarea
            ref={inputRef}
            data-testid="chat-input"
            rows={1}
            value={input}
            maxLength={2000}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(input); } }}
            placeholder="Ask Remi anything"
            aria-label="Message Remi"
            className="max-h-40 min-h-11 flex-1 resize-none bg-transparent px-1 py-2.5 text-body outline-none placeholder:text-ink-muted focus-visible:outline-none"
          />
          <button type="submit" data-testid="chat-send" disabled={!input.trim() || busy} aria-label="Send" className={cx("grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary text-on-primary transition-opacity", (!input.trim() || busy) && "opacity-40")}>
            {busy ? <Dots /> : <ArrowUp className="h-5 w-5" />}
          </button>
        </form>
        <p className="mt-2 text-center text-caption text-ink-muted">Remi can make mistakes. Nothing moves without your approval.</p>
      </div>
      <AttachDialog open={attachOpen} onClose={() => setAttachOpen(false)} onAttach={(t) => { setAttachment(t); setAttachOpen(false); }} />
    </aside>
  );
}

function AttachDialog({ open, onClose, onAttach }: { open: boolean; onClose: () => void; onAttach: (t: string) => void }) {
  const [text, setText] = useState("");
  const loadSample = async (kind: "suspicious" | "genuine") => {
    if (kind === "suspicious") setText((await api.post<any>("/sandbox/inject-invoice")).document_text);
    else setText((await api.get<any[]>("/invoices"))[0]?.raw_text ?? "");
  };
  return (
    <Dialog open={open} onClose={onClose} label="Attach a document">
      <h2 className="text-h2">Attach a document</h2>
      <p className="mt-2 text-small text-ink-muted">Paste an invoice or email. Remi checks it for fraud before reading it, and never follows instructions written inside it.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={() => loadSample("genuine")}>Use a real-looking invoice</Button>
        <Button size="sm" variant="secondary" onClick={() => loadSample("suspicious")}>Use a suspicious one</Button>
      </div>
      <TextArea data-testid="attach-text" value={text} onChange={(e) => setText(e.target.value)} rows={8} className="mt-4 text-small" placeholder="Paste document text" maxLength={20000} />
      <div className="mt-4 flex justify-end gap-3">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button data-testid="attach-confirm" disabled={!text.trim()} onClick={() => onAttach(text)}>Attach</Button>
      </div>
    </Dialog>
  );
}
