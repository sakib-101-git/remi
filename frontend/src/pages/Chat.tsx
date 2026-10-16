import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { ArrowUp, Bot, BookOpen, FileText, Loader2, Paperclip, ShieldCheck, Sparkles, Wrench, X } from "lucide-react";
import { api, streamChat } from "../lib/api";
import { cx } from "../lib/format";
import { useStore } from "../lib/store";
import { CardList, type CardT } from "../components/cards/CardRenderer";
import { Badge, Button, Modal, TierBadge } from "../components/ui";

type Msg = {
  id: string | number;
  role: "user" | "assistant";
  content: string;
  cards: CardT[];
  meta?: any;
  pending?: boolean;
  tools?: { name: string; tier: string; state: string; ok?: boolean }[];
  attachment?: boolean;
  error?: string;
};

const SUGGESTIONS: Record<string, string[]> = {
  rahim: [
    "Pay my £9,250 tuition before the deadline, cheapest safe way",
    "My university must receive exactly £9,250 — how much BDT do I send?",
    "Send 15,000 BDT to my mom",
    "How am I doing this month? How long will my money last?",
    "I just arrived in the UK and have no credit history",
    "Tell me when GBP/BDT is better than 163.5, then convert 500 GBP",
    "Send 800,000 BDT to my dad with Alpha Remit. If it's over the limit just split it into smaller payments.",
    "What documents do I usually need to pay tuition from abroad?",
    "Raise my daily limit to 1,000,000",
    "How do I send money without it being reported?",
  ],
  ada: [
    "Pay my winter tuition instalment before the deadline",
    "Send 150,000 NGN to my mum",
    "How am I doing this month? How long will my money last?",
    "I'm new in Canada and want to build credit",
    "Tell me when CAD/NGN is above 1120, then convert 200 CAD",
    "What are common scams targeting international students?",
  ],
  priya: [
    "Pay my student fees at Lakeshore",
    "Send 20,000 INR to my mom",
    "How long will my money last?",
    "How do I start building credit in the US?",
    "What is an FX markup?",
  ],
};

function kbify(text: string): string {
  return text.replace(/\[KB:\s*([^\]]+)\]/g, (_m, t) => `\`KB·${t.trim()}\``);
}

function Bubble({ m }: { m: Msg }) {
  const { openKb } = useStore();
  const sources: any[] = m.cards.find((c) => c.type === "sources")?.data ?? [];
  if (m.role === "user") {
    return (
      <div className="flex justify-end animate-slide-up">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-brand-500 px-4 py-2.5 text-sm text-white shadow-sm shadow-brand-500/20">
          {m.content}
          {m.attachment && <div className="mt-1 flex items-center gap-1 text-[11px] opacity-90"><FileText className="h-3 w-3" /> document attached (treated as untrusted data)</div>}
        </div>
      </div>
    );
  }
  const provider = m.meta?.provider;
  return (
    <div className="flex gap-3 animate-slide-up">
      <div className="brand-gradient mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl text-white"><Bot className="h-4 w-4" /></div>
      <div className="min-w-0 flex-1 space-y-3">
        {m.tools && m.tools.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {m.tools.map((t, i) => (
              <span key={`${t.name}-${i}`} className="panel-2 inline-flex items-center gap-1.5 rounded-lg border border-soft px-2 py-1 text-[11px]">
                {t.state === "running" ? <Loader2 className="h-3 w-3 animate-spin text-brand-500" /> : <Wrench className={cx("h-3 w-3", t.ok === false ? "text-rose-500" : "text-brand-500")} />}
                <span className="font-mono">{t.name}</span>
                <TierBadge tier={t.tier} short />
              </span>
            ))}
          </div>
        )}
        {m.pending && !m.content && (
          <div className="text-muted flex items-center gap-2 text-sm"><span className="flex gap-1"><span className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand-500" /><span className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand-500 [animation-delay:120ms]" /><span className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand-500 [animation-delay:240ms]" /></span> Remi is working…</div>
        )}
        {m.content && (
          <div className="panel prose-chat rounded-2xl rounded-tl-md px-4 py-3 text-sm leading-relaxed" data-testid="assistant-message">
            <ReactMarkdown
              components={{
                code: ({ children }) => {
                  const text = String(children);
                  if (text.startsWith("KB·")) {
                    const title = text.slice(3);
                    const src = sources.find((s) => s.title.toLowerCase() === title.toLowerCase());
                    return (
                      <button onClick={() => src && openKb(src.slug)} className="mx-0.5 inline-flex items-center gap-1 rounded-md bg-brand-500/10 px-1.5 py-0.5 align-baseline text-[11px] font-medium text-brand-700 hover:bg-brand-500/20 dark:text-brand-300">
                        <BookOpen className="h-3 w-3" />{title}
                      </button>
                    );
                  }
                  return <code className="rounded bg-black/5 px-1 font-mono text-xs dark:bg-white/10">{children}</code>;
                },
              }}
            >
              {kbify(m.content)}
            </ReactMarkdown>
          </div>
        )}
        {m.error && <div className="rounded-xl bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">{m.error}</div>}
        {m.cards.length > 0 && <CardList cards={m.cards} />}
        {m.meta && !m.pending && (
          <div className="text-muted flex flex-wrap items-center gap-2 text-[11px]">
            <Badge tone={provider === "guardrail" ? "violet" : provider === "mock" ? "neutral" : "brand"}>
              {provider === "guardrail" ? <ShieldCheck className="h-3 w-3" /> : <Sparkles className="h-3 w-3" />}
              {provider === "guardrail" ? "deterministic guardrail" : `${provider} · ${m.meta.model}`}{m.meta.cached ? " · replay" : ""}
            </Badge>
            {m.meta.demo_mode && provider === "mock" && <span>demo mode (offline agent)</span>}
            {typeof m.meta.latency_ms === "number" && <span>{(m.meta.latency_ms / 1000).toFixed(1)}s</span>}
          </div>
        )}
      </div>
    </div>
  );
}

export default function Chat() {
  const { session, chatDraft, consumeDraft, bump, pushToast } = useStore();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [attachment, setAttachment] = useState<string | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const persona = session?.persona ?? "rahim";

  useEffect(() => {
    setLoaded(false);
    api.get<any[]>("/chat/history").then((rows) => {
      setMessages(rows.map((r) => ({ id: r.id, role: r.role, content: r.content.replace(" [document attached]", ""), attachment: r.content.endsWith("[document attached]"), cards: r.cards ?? [], meta: r.meta })));
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, [persona]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (chatDraft && loaded && !busy) {
      const d = chatDraft;
      consumeDraft();
      if (d.autoSend) send(d.message, d.attachment);
      else {
        setInput(d.message);
        if (d.attachment) setAttachment(d.attachment);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatDraft, loaded]);

  async function send(text: string, doc?: string | null) {
    const message = text.trim();
    if (!message || busy) return;
    const attach = doc ?? attachment ?? undefined;
    setInput("");
    setAttachment(null);
    setBusy(true);
    const uid = `u${Date.now()}`;
    const aid = `a${Date.now()}`;
    setMessages((prev) => [...prev, { id: uid, role: "user", content: message, cards: [], attachment: !!attach }, { id: aid, role: "assistant", content: "", cards: [], pending: true, tools: [] }]);
    const patch = (fn: (m: Msg) => Msg) => setMessages((prev) => prev.map((m) => (m.id === aid ? fn(m) : m)));
    try {
      await streamChat({ message, attachment_text: attach }, {
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
      });
    } catch (e: any) {
      patch((m) => ({ ...m, pending: false, error: e.status === 429 ? "You're sending messages quickly. Wait a moment and try again." : e.message }));
      if (e.status !== 429) pushToast({ kind: "blocked", title: "Chat failed", body: e.message });
    } finally {
      patch((m) => ({ ...m, pending: false }));
      setBusy(false);
      bump();
    }
  }

  const suggestions = SUGGESTIONS[persona] ?? SUGGESTIONS.rahim;

  return (
    <div className="-my-6 flex h-[calc(100dvh-4rem)] flex-col">
      <div ref={scrollRef} className="scrollbar-thin flex-1 overflow-y-auto py-6">
        <div className="mx-auto max-w-3xl space-y-6">
          {loaded && messages.length === 0 && (
            <div className="py-6 text-center">
              <div className="brand-gradient mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl text-white shadow-lg shadow-brand-500/30"><Bot className="h-7 w-7" /></div>
              <h1 className="font-display text-2xl font-semibold tracking-tight">Hi {session?.user.name.split(" ")[0]}, what should I take care of?</h1>
              <p className="text-muted mx-auto mt-2 max-w-lg text-sm">I can compare providers and pay tuition, send money home, convert between your wallets, watch exchange rates, plan your budget and credit, and check suspicious invoices. You approve every money movement.</p>
            </div>
          )}
          {messages.map((m) => <Bubble key={m.id} m={m} />)}
        </div>
      </div>
      <div className="border-t border-soft bg-[var(--bg)] pb-4 pt-3">
        <div className="mx-auto max-w-3xl">
          <div className="scrollbar-thin -mx-1 mb-2 flex gap-2 overflow-x-auto px-1 pb-1">
            {suggestions.map((s) => (
              <button key={s} disabled={busy} onClick={() => send(s)} className="panel shrink-0 rounded-full px-3 py-1.5 text-xs transition-colors hover:border-brand-400 hover:text-brand-700 disabled:opacity-50 dark:hover:text-brand-300">{s.length > 60 ? `${s.slice(0, 58)}…` : s}</button>
            ))}
          </div>
          {attachment && (
            <div className="mb-2 flex items-center gap-2 rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
              <FileText className="h-4 w-4" /> Document attached ({attachment.length} chars) - Remi treats it as untrusted data.
              <button className="ml-auto" onClick={() => setAttachment(null)} aria-label="Remove attachment"><X className="h-3.5 w-3.5" /></button>
            </div>
          )}
          <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="panel flex items-end gap-2 rounded-2xl p-2 shadow-sm focus-within:border-brand-400">
            <button type="button" onClick={() => setAttachOpen(true)} className="text-muted rounded-xl p-2 hover:bg-black/5 hover:text-[var(--text)] dark:hover:bg-white/5" aria-label="Attach document"><Paperclip className="h-5 w-5" /></button>
            <textarea
              data-testid="chat-input"
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
              placeholder="Ask Remi to pay, send, convert, plan or check something…"
              className="max-h-40 min-h-[40px] flex-1 resize-none bg-transparent px-1 py-2 text-sm outline-none placeholder:text-[var(--muted)]"
              maxLength={2000}
            />
            <Button type="submit" data-testid="chat-send" disabled={!input.trim()} loading={busy} className="h-10 w-10 !px-0" aria-label="Send">{!busy && <ArrowUp className="h-4 w-4" />}</Button>
          </form>
          <p className="text-muted mt-2 text-center text-[11px]">Sandbox demo · not financial advice. Every number comes from sandbox tools; nothing moves without your confirmation.</p>
        </div>
      </div>
      <AttachModal open={attachOpen} onClose={() => setAttachOpen(false)} onAttach={(t) => { setAttachment(t); setAttachOpen(false); }} />
    </div>
  );
}

function AttachModal({ open, onClose, onAttach }: { open: boolean; onClose: () => void; onAttach: (t: string) => void }) {
  const [text, setText] = useState("");
  const loadSample = async (kind: "suspicious" | "genuine") => {
    if (kind === "suspicious") {
      const out = await api.post<any>("/sandbox/inject-invoice");
      setText(out.document_text);
    } else {
      const inv = await api.get<any[]>("/invoices");
      setText(inv[0]?.raw_text ?? "");
    }
  };
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 20000) return setText("File too large for the demo (max 20 KB of text).");
    setText(await f.text());
  };
  return (
    <Modal open={open} onClose={onClose} title="Attach a document" wide>
      <p className="text-muted mb-3 text-sm">Paste invoice or email text, or load a .txt file. Remi reviews it for fraud and injected instructions. Document text is never treated as instructions.</p>
      <div className="mb-3 flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => loadSample("genuine")}>Load genuine invoice</Button>
        <Button size="sm" variant="outline" onClick={() => loadSample("suspicious")}>Load suspicious "bank details changed" invoice</Button>
        <label className="inline-flex h-8 cursor-pointer items-center rounded-xl border border-soft px-3 text-xs hover:border-brand-400">Upload .txt<input type="file" accept=".txt,.md,text/plain" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} /></label>
      </div>
      <textarea data-testid="attach-text" value={text} onChange={(e) => setText(e.target.value)} rows={9} className="focus-ring panel-2 w-full rounded-xl border border-soft p-3 font-mono text-xs" placeholder="Paste document text…" maxLength={20000} />
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button data-testid="attach-confirm" disabled={!text.trim()} onClick={() => onAttach(text)}>Attach</Button>
      </div>
    </Modal>
  );
}
