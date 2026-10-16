import { useState, type ReactNode } from "react";
import { BellRing, CircleCheck, Eye, FlaskConical, HandCoins, ShieldAlert, X } from "lucide-react";
import { api } from "../lib/api";
import { cx, dateTime, HOME_CURRENCY, initials } from "../lib/format";
import { useApi, useStore } from "../lib/store";
import { AppIcon, Button, Dialog, Sheet, Wordmark } from "../ui";

/** Demo controls: everything a judge needs to drive the sandbox, kept out of the student's way. */
export function DemoDrawer() {
  const { demoOpen, setDemoOpen, session, setSession, refreshSession, pushToast, askRemi, bump } = useStore();
  const rates = useApi<any>(demoOpen ? "/fx/rates" : null);
  const [busy, setBusy] = useState<string | null>(null);
  const [doc, setDoc] = useState<string | null>(null);
  if (!session) return null;
  const run = async (id: string, fn: () => Promise<any>, msg?: (r: any) => string) => {
    setBusy(id);
    try {
      const r = await fn();
      if (msg) pushToast({ kind: "info", title: msg(r) });
      await refreshSession();
      bump();
      rates.reload();
      return r;
    } catch (e: any) {
      pushToast({ kind: "blocked", title: "That didn't work", body: e.message });
    } finally {
      setBusy(null);
    }
  };
  const home = HOME_CURRENCY[session.user.home_country];
  const rep = session.user.reporting_currency;
  const live = session.llm.providers.filter((p) => p.available && p.name !== "mock");
  return (
    <Sheet open={demoOpen} onClose={() => setDemoOpen(false)} title="Demo controls" subtitle="Drive the sandbox. Only your private copy changes." testId="demo-drawer">
      <div className="space-y-8 p-6">
        <Group title="Profile">
          <div className="grid gap-2">
            {session.personas.map((p) => (
              <button
                key={p.persona}
                data-testid={`persona-${p.persona}`}
                onClick={() => run(`p-${p.persona}`, async () => { const s = await api.post<any>("/session/persona", { persona: p.persona }); setSession(s); return s; }, (s) => `You're now ${s.user.name.split(" ")[0]}`)}
                className={cx("flex items-center gap-3 rounded-input border px-3 py-2.5 text-left transition-colors", p.persona === session.persona ? "border-primary bg-primary-soft" : "border-line hover:border-ink-muted")}
              >
                <span className="grid h-9 w-9 place-items-center rounded-full bg-surface text-caption">{initials(p.name)}</span>
                <span className="min-w-0 flex-1"><span className="block text-small font-semibold">{p.name}</span><span className="block truncate text-caption text-ink-muted">{p.tagline}</span></span>
              </button>
            ))}
          </div>
        </Group>

        <Group title="Time" hint={`Sandbox clock: ${dateTime(session.sim_now)}`}>
          <div className="flex flex-wrap gap-2">
            {([[1, "+1 hour"], [24, "+1 day"], [168, "+1 week"]] as const).map(([h, l]) => (
              <Button key={h} size="sm" variant="secondary" loading={busy === `t${h}`} onClick={() => run(`t${h}`, () => api.post("/sandbox/advance", { hours: h }), (r) => `Clock moved to ${dateTime(r.sim_now)}`)}>{l}</Button>
            ))}
          </div>
        </Group>

        <Group title="Exchange rates" hint={rates.data ? `Sandbox rates · update #${rates.data.tick}` : undefined}>
          {rates.data && (
            <div className="mb-3 grid grid-cols-2 gap-2">
              {rates.data.pairs.slice(0, 2).map((p: any) => (
                <div key={p.pair} className="rounded-input bg-surface-muted px-3 py-2">
                  <div className="text-caption text-ink-muted">{p.pair}</div>
                  <div className="text-body-strong tabular">{Number(p.rate).toLocaleString("en-GB", { maximumFractionDigits: 4 })}</div>
                </div>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" data-testid="sb-tick" loading={busy === "tick"} onClick={() => run("tick", () => api.post("/sandbox/tick", { steps: 1 }), (r) => `Rates updated${r.alerts_fired.length ? " · a rate alert fired" : ""}`)}>Move rates</Button>
            <Button size="sm" variant="secondary" data-testid="sb-shock" loading={busy === "shock"} onClick={() => run("shock", () => api.post("/sandbox/tick", { steps: 1, shock_currency: rep, shock_pct: "0.01" }), (r) => `${rep} weakened 1%${r.alerts_fired.length ? " · a rate alert fired" : ""}`)}>{rep} weakens 1%</Button>
            <Button size="sm" variant="secondary" loading={busy === "shock2"} onClick={() => run("shock2", () => api.post("/sandbox/tick", { steps: 1, shock_currency: rep, shock_pct: "-0.01" }), () => `${rep} strengthened 1%`)}>{rep} strengthens 1%</Button>
          </div>
        </Group>

        <Group title="Money from family">
          <Button size="sm" variant="secondary" icon={<HandCoins className="h-4 w-4" />} loading={busy === "rem"} onClick={() => run("rem", () => api.post("/sandbox/inject-remittance", {}), (r) => `Received ${Number(r.amount).toLocaleString("en-GB")} ${r.currency}`)}>Receive {home} from family</Button>
        </Group>

        <Group title="Scam test" hint="An email says your university's bank details changed, with hidden instructions for the AI.">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" data-testid="sb-invoice" loading={busy === "inv"} onClick={async () => { const r = await run("inv", () => api.post("/sandbox/inject-invoice")); if (r) setDoc(r.document_text); }}>Receive suspicious invoice</Button>
            <Button size="sm" data-testid="sb-review" disabled={!doc} onClick={() => doc && askRemi("I got this updated invoice from my university, please pay it", { attachment: doc })}>Ask Remi to pay it</Button>
          </div>
        </Group>

        <Group title="AI model">
          <div className="space-y-1 text-small">
            <div className="flex justify-between gap-3"><span className="text-ink-muted">Answers</span><span>{session.llm.cache_mode === "replay" ? "Recorded demo answers first, then live" : "Live"}</span></div>
            <div className="flex justify-between gap-3"><span className="text-ink-muted">Live model</span><span className="text-right">{live.length ? live.map((p) => `${p.name} · ${p.model}`).join(", ") : "Offline agent (no key)"}</span></div>
            <div className="flex justify-between gap-3"><span className="text-ink-muted">Fallback</span><span>Offline agent, always available</span></div>
          </div>
        </Group>

        <Group title="Start over">
          <Button size="sm" variant="secondary" loading={busy === "reset"} onClick={() => run("reset", () => api.post("/session/reset"), () => "Your sandbox is fresh again")}>Reset my sandbox</Button>
        </Group>
      </div>
    </Sheet>
  );
}

function Group({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="text-body-strong">{title}</h3>
      {hint && <p className="mb-3 text-small text-ink-muted">{hint}</p>}
      <div className={hint ? "" : "mt-3"}>{children}</div>
    </section>
  );
}

/** The step-up code arrives like a phone notification. */
export function PhoneNotice() {
  const { phone, dismissPhone } = useStore();
  if (!phone) return null;
  return (
    <div data-testid="sandbox-phone" role="status" className="fixed inset-x-3 top-3 z-[60] animate-rise md:left-auto md:right-6 md:top-6 md:w-[360px]">
      <div className="rounded-card border border-line bg-surface p-4 shadow-float">
        <div className="flex items-center gap-2 text-caption text-ink-muted">
          <AppIcon size={20} /> <span className="font-semibold text-ink">Remi</span> · Messages · now
          <button onClick={dismissPhone} className="ml-auto" aria-label="Close phone"><X className="h-4 w-4" /></button>
        </div>
        <p className="mt-2 text-small">Your one-time code. Never share it, not even with Remi.</p>
        <div data-testid="otp-code" className="mt-2 text-h1 tracking-widest tabular">{phone.code}</div>
        <p className="mt-1 text-caption text-ink-muted">Sandbox phone · expires in 3 minutes</p>
      </div>
    </div>
  );
}

const TOAST_ICON: Record<string, ReactNode> = {
  fraud: <ShieldAlert className="h-5 w-5 text-danger" />,
  blocked: <ShieldAlert className="h-5 w-5 text-danger" />,
  rate_alert: <BellRing className="h-5 w-5 text-accent-text" />,
};

export function ToastHost() {
  const { toast, dismissToast, navigate, setChatOpen } = useStore();
  if (!toast) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[55] flex justify-center px-4 lg:bottom-auto lg:top-6">
      <div key={toast.id} data-testid={`toast-${toast.kind}`} role="status" className="pointer-events-auto flex w-full max-w-sm animate-rise items-start gap-3 rounded-card bg-ink p-4 text-on-primary shadow-float">
        <span className="mt-0.5">{TOAST_ICON[toast.kind] ?? <CircleCheck className="h-5 w-5 text-primary-soft" />}</span>
        <div className="min-w-0 flex-1">
          <div className="text-small font-semibold">{toast.title}</div>
          {toast.body && <div className="line-clamp-2 text-small opacity-80">{toast.body}</div>}
          {toast.kind === "rate_alert" && toast.data?.action?.id && (
            <button className="mt-1 text-small font-semibold text-primary-soft underline underline-offset-4" onClick={() => { dismissToast(); setChatOpen(false); navigate("home"); }}>Review the conversion</button>
          )}
        </div>
        <button onClick={dismissToast} aria-label="Dismiss" className="opacity-70 hover:opacity-100"><X className="h-4 w-4" /></button>
      </div>
    </div>
  );
}

export function Onboarding() {
  const { session, setSession } = useStore();
  const [busy, setBusy] = useState(false);
  if (!session || session.consent_given) return null;
  const accept = async () => {
    setBusy(true);
    try {
      setSession(await api.post<any>("/session/consent", { accepted: true }));
    } finally {
      setBusy(false);
    }
  };
  const points = [
    { icon: <FlaskConical className="h-5 w-5" />, title: "This is a sandbox", body: "Fictional people, banks and money. Nothing real moves." },
    { icon: <CircleCheck className="h-5 w-5" />, title: "You approve every payment", body: "Remi prepares and explains. Only you can confirm." },
    { icon: <Eye className="h-5 w-5" />, title: "What the AI sees", body: "Your questions and sandbox data, with account numbers masked. Please don't type real personal details." },
  ];
  return (
    <Dialog open onClose={() => undefined} dismissable={false} testId="onboarding" label="Welcome to Remi">
      <Wordmark height={32} />
      <h1 className="mt-8 text-h1">Welcome to Remi</h1>
      <p className="mt-2 text-body text-ink-muted">You're {session.user.name.split(" ")[0]}: {session.user.tagline}. You can switch profiles any time.</p>
      <ul className="mt-6 space-y-4">
        {points.map((p) => (
          <li key={p.title} className="flex gap-4">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary-soft text-primary">{p.icon}</span>
            <span><span className="block text-body-strong">{p.title}</span><span className="block text-small text-ink-muted">{p.body}</span></span>
          </li>
        ))}
      </ul>
      <Button block className="mt-8" onClick={accept} loading={busy} data-testid="consent-accept">I understand</Button>
      <p className="mt-3 text-center text-caption text-ink-muted">Not financial, legal or tax advice.</p>
    </Dialog>
  );
}
