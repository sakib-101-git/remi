import { useState } from "react";
import { BadgeDollarSign, Clock, FileWarning, FlaskConical, RotateCcw, TrendingDown, TrendingUp, Zap } from "lucide-react";
import { api } from "../lib/api";
import { date } from "../lib/format";
import { useApi, useStore } from "../lib/store";
import { Badge, Button, Card, CardHeader, Skeleton } from "../components/ui";

export default function Sandbox() {
  const { session, refreshSession, pushToast, askRemi, bump } = useStore();
  const rates = useApi<any>("/fx/rates");
  const [busy, setBusy] = useState<string | null>(null);
  const [lastDoc, setLastDoc] = useState<string | null>(null);
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
      pushToast({ kind: "blocked", title: "Sandbox action failed", body: e.message });
    } finally {
      setBusy(null);
    }
  };
  const home = ({ BD: "BDT", NG: "NGN", IN: "INR" } as Record<string, string>)[session?.user.home_country ?? "BD"];
  const rep = session?.user.reporting_currency ?? "GBP";
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display flex items-center gap-2 text-2xl font-semibold tracking-tight"><FlaskConical className="h-6 w-6 text-brand-500" /> Sandbox control panel</h1>
        <p className="text-muted text-sm">Drive the simulated world for the demo. Everything here affects only your private sandbox.</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Simulated time" subtitle={`Now: ${date(session?.sim_now, true)}`} icon={<Clock className="h-4 w-4" />} />
          <p className="text-muted mb-3 text-sm">Advancing time settles transfers, releases cooling-off payments and moves deadlines closer.</p>
          <div className="flex flex-wrap gap-2">
            {[[1, "+1 hour"], [24, "+1 day"], [72, "+3 days"], [168, "+1 week"]].map(([h, l]) => (
              <Button key={h} variant="secondary" size="sm" loading={busy === `t${h}`} onClick={() => run(`t${h}`, () => api.post("/sandbox/advance", { hours: h }), (r) => `Clock → ${date(r.sim_now, true)}`)}>{l}</Button>
            ))}
          </div>
        </Card>
        <Card>
          <CardHeader title="FX market (simulated)" subtitle={rates.data ? `tick #${rates.data.tick} · ${rates.data.label}, snapshot ${rates.data.snapshot_date}` : ""} icon={<TrendingUp className="h-4 w-4" />} />
          {!rates.data ? <Skeleton className="h-24" /> : (
            <div className="mb-3 grid grid-cols-2 gap-2">
              {rates.data.pairs.map((p: any) => {
                const delta = (Number(p.rate) / Number(p.snapshot) - 1) * 100;
                return <div key={p.pair} className="panel-2 rounded-xl p-2.5"><div className="text-muted text-[11px]">{p.pair}</div><div className="num font-semibold">{Number(p.rate).toLocaleString(undefined, { maximumFractionDigits: 4 })}</div><div className={`num text-[11px] ${delta >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{delta >= 0 ? "+" : ""}{delta.toFixed(2)}% vs snapshot</div></div>;
              })}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button data-testid="sb-tick" variant="secondary" size="sm" loading={busy === "tick"} onClick={() => run("tick", () => api.post("/sandbox/tick", { steps: 1 }), (r) => `Rates ticked (#${r.tick})${r.alerts_fired.length ? ` · ${r.alerts_fired.length} alert fired` : ""}`)}><Zap className="h-3.5 w-3.5" /> Tick rates</Button>
            <Button data-testid="sb-shock" variant="secondary" size="sm" loading={busy === "shock"} onClick={() => run("shock", () => api.post("/sandbox/tick", { steps: 1, shock_currency: rep, shock_pct: "0.01" }), (r) => `${rep} weakened 1%${r.alerts_fired.length ? ` · ${r.alerts_fired.length} alert fired` : ""}`)}><TrendingDown className="h-3.5 w-3.5" /> {rep} weakens 1%</Button>
            <Button variant="secondary" size="sm" loading={busy === "shock2"} onClick={() => run("shock2", () => api.post("/sandbox/tick", { steps: 1, shock_currency: rep, shock_pct: "-0.01" }), () => `${rep} strengthened 1%`)}><TrendingUp className="h-3.5 w-3.5" /> {rep} strengthens 1%</Button>
          </div>
        </Card>
        <Card>
          <CardHeader title="Incoming family remittance" subtitle={`Credits your ${home} wallet`} icon={<BadgeDollarSign className="h-4 w-4" />} />
          <Button variant="secondary" size="sm" loading={busy === "rem"} onClick={() => run("rem", () => api.post("/sandbox/inject-remittance", {}), (r) => `Received ${Number(r.amount).toLocaleString()} ${r.currency}`)}>Inject remittance</Button>
        </Card>
        <Card>
          <CardHeader title="Suspicious invoice" subtitle={'"Our bank details have changed" + injected AI instructions'} icon={<FileWarning className="h-4 w-4" />} right={<Badge tone="danger">S7</Badge>} />
          <div className="flex flex-wrap gap-2">
            <Button data-testid="sb-invoice" variant="secondary" size="sm" loading={busy === "inv"} onClick={async () => { const r = await run("inv", () => api.post("/sandbox/inject-invoice")); if (r) setLastDoc(r.document_text); }}>Receive suspicious invoice</Button>
            <Button data-testid="sb-review" size="sm" disabled={!lastDoc} onClick={() => lastDoc && askRemi("I got this updated invoice from my university, please pay it", { attachment: lastDoc })}>Ask Remi to pay it</Button>
          </div>
          {lastDoc && <pre className="panel-2 mt-3 max-h-40 overflow-auto whitespace-pre-wrap rounded-xl p-3 font-mono text-[11px]">{lastDoc}</pre>}
        </Card>
      </div>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><div className="font-display font-semibold">Reset to seed</div><div className="text-muted text-sm">Fresh balances, history, invoices and a new audit chain.</div></div>
          <Button variant="secondary" loading={busy === "reset"} onClick={() => run("reset", () => api.post("/session/reset"), () => "Sandbox reset")}><RotateCcw className="h-4 w-4" /> Reset my sandbox</Button>
        </div>
      </Card>
    </div>
  );
}
