import { useEffect, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import {
  ArrowLeftRight, BellRing, BookOpen, Bot, ChevronDown, Clock3, CreditCard, FileWarning, FlaskConical, LayoutDashboard, Menu, Moon, PauseCircle,
  PieChart, ScrollText, Settings, ShieldCheck, Smartphone, Sun, Wifi, WifiOff, X,
} from "lucide-react";
import { api } from "../lib/api";
import { cx, date, initials } from "../lib/format";
import { type Route, useStore } from "../lib/store";
import { Badge, Button, Drawer, Modal } from "./ui";

const NAV: { route: Route; label: string; icon: any }[] = [
  { route: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { route: "chat", label: "Ask Remi", icon: Bot },
  { route: "transfers", label: "Transfers", icon: ArrowLeftRight },
  { route: "budget", label: "Budget", icon: PieChart },
  { route: "credit", label: "Credit", icon: CreditCard },
  { route: "knowledge", label: "Knowledge", icon: BookOpen },
  { route: "audit", label: "Audit log", icon: ScrollText },
  { route: "settings", label: "Safety & limits", icon: Settings },
  { route: "sandbox", label: "Sandbox panel", icon: FlaskConical },
];

export function Logo({ small }: { small?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className={cx("brand-gradient grid place-items-center rounded-xl text-white shadow-lg shadow-brand-500/20", small ? "h-8 w-8" : "h-9 w-9")}>
        <svg viewBox="0 0 64 64" className="h-5 w-5"><path d="M22 46V18h12.5c6 0 9.5 3.4 9.5 8.6 0 3.9-2.1 6.6-5.6 7.7L45 46h-7.2l-6-11H29v11h-7Zm7-17h5c2.4 0 3.8-1.1 3.8-3.2S36.4 22.7 34 22.7h-5V29Z" fill="currentColor" /></svg>
      </div>
      <div className="leading-tight">
        <div className="font-display text-[17px] font-bold tracking-tight">Remi</div>
        {!small && <div className="text-muted text-[10px] font-medium uppercase tracking-[0.14em]">money agent · sandbox</div>}
      </div>
    </div>
  );
}

function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { route, navigate, session } = useStore();
  return (
    <>
      {open && <div className="fixed inset-0 z-30 bg-slate-950/40 lg:hidden" onClick={onClose} />}
      <aside className={cx("panel fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-y-0 border-l-0 px-3 py-4 transition-transform lg:translate-x-0", open ? "translate-x-0" : "-translate-x-full")}>
        <div className="flex items-center justify-between px-2 pb-5">
          <Logo />
          <button className="lg:hidden" onClick={onClose} aria-label="Close menu"><X className="h-4 w-4" /></button>
        </div>
        <nav className="flex-1 space-y-0.5">
          {NAV.map((n) => {
            const active = route === n.route;
            return (
              <button key={n.route} data-testid={`nav-${n.route}`} onClick={() => { navigate(n.route); onClose(); }} className={cx("focus-ring flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors", active ? "bg-brand-500/10 text-brand-700 dark:text-brand-300" : "text-muted hover:bg-black/[0.03] hover:text-[var(--text)] dark:hover:bg-white/[0.04]")}>
                <n.icon className="h-4 w-4" />
                {n.label}
                {n.route === "chat" && <span className="ml-auto rounded-md bg-brand-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">AI</span>}
              </button>
            );
          })}
        </nav>
        <div className="panel-2 mt-4 rounded-xl p-3 text-[11px]">
          <div className="flex items-center gap-1.5 font-medium"><ShieldCheck className="h-3.5 w-3.5 text-brand-500" /> You approve every payment</div>
          <p className="text-muted mt-1 leading-relaxed">Remi proposes; deterministic policy decides what's allowed; only you can confirm.{session?.agent_paused ? " Agent money-movement is paused." : ""}</p>
        </div>
      </aside>
    </>
  );
}

function PersonaSwitcher() {
  const { session, setSession, bump, pushToast } = useStore();
  const [open, setOpen] = useState(false);
  if (!session) return null;
  const switchTo = async (p: string) => {
    setOpen(false);
    if (p === session.persona) return;
    const s = await api.post<any>("/session/persona", { persona: p });
    setSession(s);
    bump();
    pushToast({ kind: "info", title: `Switched to ${s.user.name}`, body: s.user.tagline });
  };
  return (
    <div className="relative">
      <button data-testid="persona-switcher" onClick={() => setOpen((v) => !v)} className="focus-ring flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-black/[0.04] dark:hover:bg-white/[0.05]">
        <div className="brand-gradient grid h-8 w-8 place-items-center rounded-full text-xs font-semibold text-white">{initials(session.user.name)}</div>
        <div className="hidden text-left leading-tight sm:block">
          <div className="text-sm font-medium">{session.user.name}</div>
          <div className="text-muted text-[11px]">{session.user.tagline}</div>
        </div>
        <ChevronDown className="text-muted h-4 w-4" />
      </button>
      {open && (
        <div className="panel absolute right-0 top-12 z-30 w-72 animate-slide-up rounded-2xl p-2 shadow-xl">
          <div className="text-muted px-2 pb-1 pt-1 text-[11px] font-medium uppercase tracking-wider">Demo personas</div>
          {session.personas.map((p) => (
            <button key={p.persona} onClick={() => switchTo(p.persona)} className={cx("flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-black/[0.04] dark:hover:bg-white/[0.05]", p.persona === session.persona && "bg-brand-500/8")}>
              <div className="panel-2 grid h-8 w-8 place-items-center rounded-full text-xs font-semibold">{initials(p.name)}</div>
              <div className="flex-1"><div className="text-sm font-medium">{p.name}</div><div className="text-muted text-[11px]">{p.tagline}</div></div>
              <Badge tone="neutral">{p.reporting_currency}</Badge>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Topbar({ onMenu }: { onMenu: () => void }) {
  const { session, theme, toggleTheme, connected, setPhoneOpen, phone, navigate } = useStore();
  const primary = session?.llm.providers.find((p) => p.available && p.name !== "mock");
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-soft bg-[var(--bg)]/80 px-4 backdrop-blur-md sm:px-6">
      <button className="lg:hidden" onClick={onMenu} aria-label="Open menu"><Menu className="h-5 w-5" /></button>
      <div className="hidden items-center gap-2 md:flex">
        <Badge tone="warning"><FlaskConical className="h-3 w-3" /> Sandbox</Badge>
        {session && <Badge tone="neutral"><Clock3 className="h-3 w-3" /> {date(session.sim_now, true)}{session.clock_offset_seconds > 0 ? " (simulated)" : ""}</Badge>}
        {session && (
          <Badge tone={primary ? "brand" : "violet"}>
            <Bot className="h-3 w-3" /> {session.llm.cache_mode === "replay" ? "replay + " : ""}{primary ? `${primary.name} · ${primary.model}` : "demo mode · offline agent"}
          </Badge>
        )}
        {session?.agent_paused && <Badge tone="danger"><PauseCircle className="h-3 w-3" /> agent paused</Badge>}
      </div>
      <div className="ml-auto flex items-center gap-1">
        <span title={connected ? "Live updates connected" : "Reconnecting…"} className={cx("mr-1 hidden sm:inline-flex", connected ? "text-emerald-500" : "text-amber-500")}>{connected ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}</span>
        <button data-testid="phone-toggle" onClick={() => setPhoneOpen(true)} className="focus-ring relative rounded-xl p-2 hover:bg-black/[0.04] dark:hover:bg-white/[0.05]" aria-label="Sandbox phone">
          <Smartphone className="h-5 w-5" />
          {phone.length > 0 && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-rose-500" />}
        </button>
        <button onClick={() => navigate("audit")} className="focus-ring rounded-xl p-2 hover:bg-black/[0.04] dark:hover:bg-white/[0.05]" aria-label="Audit log"><ScrollText className="h-5 w-5" /></button>
        <button onClick={toggleTheme} className="focus-ring rounded-xl p-2 hover:bg-black/[0.04] dark:hover:bg-white/[0.05]" aria-label="Toggle theme">{theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}</button>
        <PersonaSwitcher />
      </div>
    </header>
  );
}

export function SandboxPhone() {
  const { phone, phoneOpen, setPhoneOpen } = useStore();
  if (!phoneOpen) return null;
  return (
    <div data-testid="sandbox-phone" className="fixed bottom-4 right-4 z-50 w-[290px] animate-slide-up">
      <div className="rounded-[2.2rem] border-[6px] border-slate-900 bg-slate-950 p-2 shadow-2xl dark:border-slate-700">
        <div className="mx-auto mb-2 h-1.5 w-16 rounded-full bg-slate-800" />
        <div className="h-[340px] overflow-y-auto rounded-[1.6rem] bg-gradient-to-b from-slate-100 to-slate-200 p-3 text-slate-900 dark:from-slate-800 dark:to-slate-900 dark:text-slate-100">
          <div className="mb-3 flex items-center justify-between text-[11px] font-medium">
            <span>Sandbox phone</span>
            <button onClick={() => setPhoneOpen(false)} className="rounded-full bg-black/10 p-1 dark:bg-white/10" aria-label="Close phone"><X className="h-3 w-3" /></button>
          </div>
          {phone.length === 0 && <p className="mt-16 text-center text-xs text-slate-500">No messages yet. Step-up codes for high-risk actions arrive here, like an SMS.</p>}
          {phone.map((m) => (
            <div key={m.id} className="mb-2 animate-slide-up rounded-2xl bg-white p-3 text-xs shadow-sm dark:bg-slate-700">
              <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-300"><BellRing className="h-3 w-3" /> Remi · now</div>
              <div className="leading-relaxed">{m.message}</div>
              <div data-testid="otp-code" className="num mt-2 text-center font-mono text-2xl font-semibold tracking-[0.3em] text-brand-600 dark:text-brand-300">{m.code}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function KnowledgeDrawer() {
  const { kbSlug, openKb } = useStore();
  const [art, setArt] = useState<any>(null);
  useEffect(() => {
    if (!kbSlug) return;
    setArt(null);
    api.get<any>(`/knowledge/${kbSlug}`).then(setArt).catch(() => setArt({ title: "Not found", body: "This article could not be loaded." }));
  }, [kbSlug]);
  return (
    <Drawer open={!!kbSlug} onClose={() => openKb(null)} title={<span className="flex items-center gap-2"><BookOpen className="h-4 w-4 text-brand-500" /> Knowledge base</span>}>
      {!art ? <div className="text-muted text-sm">Loading…</div> : (
        <div data-testid="kb-article">
          <div className="mb-3 flex flex-wrap gap-1.5">
            {art.illustrative && <Badge tone="warning">illustrative - verify with official sources</Badge>}
            {art.region && <Badge tone="neutral">region: {art.region}</Badge>}
            {art.last_reviewed && <Badge tone="neutral">reviewed {art.last_reviewed}</Badge>}
          </div>
          <div className="prose-kb"><ReactMarkdown>{art.body}</ReactMarkdown></div>
          <p className="text-muted mt-6 border-t border-soft pt-3 text-[11px]">Written by Team Git Push Pray for the Remi sandbox. General information, not financial, legal or tax advice.</p>
        </div>
      )}
    </Drawer>
  );
}

const TOAST_ICON: Record<string, any> = { fraud: FileWarning, rate_alert: BellRing, blocked: ShieldCheck, settled: ShieldCheck, executed: ShieldCheck };

export function Toasts() {
  const { toasts, dismissToast, navigate } = useStore();
  return (
    <div className="pointer-events-none fixed left-1/2 top-20 z-50 flex w-full max-w-md -translate-x-1/2 flex-col gap-2 px-4">
      {toasts.map((t) => {
        const Icon = TOAST_ICON[t.kind] ?? BellRing;
        const danger = t.kind === "fraud" || t.kind === "blocked";
        return (
          <div key={t.id} data-testid={`toast-${t.kind}`} className={cx("panel pointer-events-auto flex animate-slide-up items-start gap-3 rounded-2xl p-3 shadow-xl", danger && "border-rose-500/50")}>
            <div className={cx("grid h-8 w-8 shrink-0 place-items-center rounded-xl", danger ? "bg-rose-500/15 text-rose-600" : "bg-brand-500/12 text-brand-600 dark:text-brand-300")}><Icon className="h-4 w-4" /></div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{t.title}</div>
              {t.body && <div className="text-muted text-xs">{t.body}</div>}
              {t.kind === "rate_alert" && t.data?.action?.id && <button className="mt-1 text-xs font-medium text-brand-600 underline dark:text-brand-300" onClick={() => navigate("dashboard")}>Review the proposed conversion →</button>}
              {t.kind === "document" && <button className="mt-1 text-xs font-medium text-brand-600 underline dark:text-brand-300" onClick={() => navigate("sandbox")}>Open in Sandbox panel →</button>}
            </div>
            <button onClick={() => dismissToast(t.id)} className="text-muted" aria-label="Dismiss"><X className="h-3.5 w-3.5" /></button>
          </div>
        );
      })}
    </div>
  );
}

export function Onboarding() {
  const { session, setSession } = useStore();
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!session || session.consent_given) return null;
  const accept = async () => {
    setBusy(true);
    setSession(await api.post<any>("/session/consent", { accepted: true }));
    setBusy(false);
  };
  return (
    <Modal open onClose={() => undefined} wide>
      <div data-testid="onboarding" className="space-y-5">
        <Logo />
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Your AI money agent that actually acts.</h1>
          <p className="text-muted mt-2 text-sm leading-relaxed">Remi compares providers on true landed cost, pays tuition before deadlines, manages your multi-currency wallets, watches exchange rates and builds a credit plan, while <b className="text-[var(--text)]">you approve every money movement</b>.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            [ShieldCheck, "You stay in control", "Payments need your confirmation; high-risk ones also need a code from your Sandbox phone."],
            [ScrollText, "Every step is audited", "A tamper-evident, hash-chained log you can verify any time."],
            [FlaskConical, "100% sandbox", "Fictional people, banks and providers. No real money, no real accounts."],
          ].map(([Icon, title, body]: any) => (
            <div key={title} className="panel-2 rounded-xl p-3">
              <Icon className="mb-2 h-5 w-5 text-brand-500" />
              <div className="text-sm font-medium">{title}</div>
              <div className="text-muted text-xs">{body}</div>
            </div>
          ))}
        </div>
        <div className="panel-2 rounded-xl p-3 text-xs leading-relaxed">
          <b>Privacy & data.</b> This demo uses fictional sandbox data only. Messages may be processed by a free third-party AI model; account numbers are masked and personal data is redacted before anything is sent. Do not enter real personal or financial information. Your sandbox is private to this browser and is deleted after 24 hours of inactivity.
        </div>
        <label className="flex cursor-pointer items-start gap-3 text-sm">
          <input data-testid="consent-checkbox" type="checkbox" className="mt-1 h-4 w-4 accent-[#0ea5a0]" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          <span>I understand this is a sandbox demo and <b>not financial, legal or tax advice</b>, and I agree to the data notice above.</span>
        </label>
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted text-xs">You'll start as <b>Rahim</b> (Bangladesh → UK). Switch personas any time.</span>
          <Button data-testid="consent-accept" onClick={accept} disabled={!agree} loading={busy}>Get started</Button>
        </div>
      </div>
    </Modal>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const [menu, setMenu] = useState(false);
  const { session } = useStore();
  return (
    <div className="min-h-full">
      <Sidebar open={menu} onClose={() => setMenu(false)} />
      <div className="flex min-h-screen flex-col lg:pl-64">
        <Topbar onMenu={() => setMenu(true)} />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">{children}</main>
        <footer className="text-muted border-t border-soft px-6 py-3 text-center text-[11px]">
          {session?.disclaimer ?? "Sandbox demo. Not financial, legal or tax advice."} All people, banks, providers and universities are fictional. · Team Git Push Pray · FinTechathon 2026
        </footer>
      </div>
      <SandboxPhone />
      <KnowledgeDrawer />
      <Toasts />
      <Onboarding />
    </div>
  );
}
