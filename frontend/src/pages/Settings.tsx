import { useState } from "react";
import { Gauge, KeyRound, PauseCircle, RotateCcw, ShieldCheck, Wrench } from "lucide-react";
import { api } from "../lib/api";
import { money } from "../lib/format";
import { useApi, useStore } from "../lib/store";
import { Badge, Button, Card, CardHeader, ErrorNote, Meter, Modal, Skeleton, TierBadge, Toggle } from "../components/ui";

const LIMIT_LABEL: Record<string, string> = {
  per_transaction_max_usd: "Per-transaction maximum (block)",
  step_up_threshold_usd: "Step-up above (ordinary payees)",
  verified_institution_step_up_usd: "Step-up above (verified institutions)",
  daily_soft_limit_usd: "Daily soft limit (step-up)",
  daily_max_usd: "Daily maximum (block)",
  monthly_max_usd: "30-day maximum (block)",
};

export default function Settings() {
  const { data, error, reload } = useApi<any>("/settings");
  const { session, setSession, setPhoneOpen, pushToast, refreshSession } = useStore();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [key, setKey] = useState("daily_soft_limit_usd");
  const [pending, setPending] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  if (error) return <ErrorNote message={error} onRetry={reload} />;
  if (!data) return <Skeleton className="h-96" />;
  const lim = data.limits;

  const kill = async (paused: boolean) => {
    await api.post("/settings/kill-switch", { paused });
    if (session) setSession({ ...session, agent_paused: paused });
    pushToast({ kind: paused ? "blocked" : "executed", title: paused ? "Agent money-movement paused" : "Agent resumed", body: paused ? "Remi can still answer and read, but can't propose payments or conversions." : undefined });
    reload();
  };
  const request = async () => {
    setErr(null);
    try {
      const out = await api.post<any>("/settings/limits", { changes: { [key]: value } });
      setPending(out.action_id);
      setPhoneOpen(true);
    } catch (e: any) {
      setErr(e.message);
    }
  };
  const verify = async () => {
    setErr(null);
    try {
      await api.post(`/settings/limits/${pending}/verify`, { code });
      setEditing(false);
      setPending(null);
      setCode("");
      pushToast({ kind: "executed", title: "Limit changed after step-up", body: `${LIMIT_LABEL[key]} → $${Number(value).toLocaleString()}` });
      reload();
    } catch (e: any) {
      setErr(e.message);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Safety & limits</h1>
        <p className="text-muted text-sm">Everything on this page is a T4 governance control: only you can change it, and Remi's AI has no tool to touch it.</p>
      </div>
      <Card className={session?.agent_paused ? "border-rose-500/50" : ""}>
        <div className="flex items-center gap-4">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-rose-500/12 text-rose-600"><PauseCircle className="h-5 w-5" /></div>
          <div className="flex-1">
            <div className="font-display font-semibold">Kill switch</div>
            <div className="text-muted text-sm">Instantly stop Remi from proposing any payment, conversion or new payee. Reading and advice keep working.</div>
          </div>
          <Toggle danger checked={!!session?.agent_paused} onChange={kill} label="Pause agent money movement" />
        </div>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Transfer limits (USD equivalent)" subtitle="Changing a limit requires step-up verification" icon={<Gauge className="h-4 w-4" />} right={<Button size="sm" variant="outline" onClick={() => { setEditing(true); setValue(lim.limits[key]); }}><KeyRound className="h-3.5 w-3.5" /> Change</Button>} />
          <div className="space-y-2">
            {Object.entries(lim.limits).map(([k, v]: any) => (
              <div key={k} className="flex items-center justify-between text-sm"><span className="text-muted">{LIMIT_LABEL[k] ?? k}</span><span className="num font-medium">${Number(v).toLocaleString()}{lim.overridden.includes(k) && <Badge tone="violet" className="ml-2">custom</Badge>}</span></div>
            ))}
          </div>
          <div className="mt-5 space-y-3">
            <div><div className="flex justify-between text-xs"><span>Used today</span><span className="num">{money(lim.usage.day_usd, "USD")} / ${Number(lim.limits.daily_soft_limit_usd).toLocaleString()}</span></div><Meter className="mt-1" value={Number(lim.usage.day_usd)} max={Number(lim.limits.daily_soft_limit_usd)} tone="warning" /></div>
            <div><div className="flex justify-between text-xs"><span>Used in 30 days</span><span className="num">{money(lim.usage.month_usd, "USD")} / ${Number(lim.limits.monthly_max_usd).toLocaleString()}</span></div><Meter className="mt-1" value={Number(lim.usage.month_usd)} max={Number(lim.limits.monthly_max_usd)} /></div>
          </div>
          <p className="text-muted mt-4 text-xs">Velocity: step-up after {lim.velocity.max_per_hour}/hour, block after {lim.velocity.max_per_day}/day · Risk score ≥ {lim.risk.step_up_score} → step-up, ≥ {lim.risk.block_score} → block.</p>
          {lim.overridden.length > 0 && <Button size="sm" variant="ghost" className="mt-2" onClick={async () => { await api.post("/settings/limits/reset"); reload(); }}><RotateCcw className="h-3.5 w-3.5" /> Restore defaults</Button>}
        </Card>
        <Card>
          <CardHeader title="Permission tiers" subtitle="Assigned by deterministic policy, never by the AI" icon={<ShieldCheck className="h-4 w-4" />} />
          <div className="space-y-2.5">
            {Object.entries(data.tiers).map(([t, d]: any) => <div key={t} className="flex items-start gap-3"><TierBadge tier={t} short /><span className="text-sm">{d}</span></div>)}
          </div>
          <div className="panel-2 mt-4 rounded-xl p-3 text-xs leading-relaxed">Confirmation tokens expire after {Math.round(data.confirmation_ttl_seconds / 60)} min and are bound to the exact payment details. New payees have a {data.cooling_off_seconds}s cooling-off in this demo (hours in production).</div>
        </Card>
      </div>
      <Card>
        <CardHeader title="Agent tools" subtitle={`${data.tools.length} typed tools · T4 actions are deliberately absent`} icon={<Wrench className="h-4 w-4" />} />
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {data.tools.map((t: any) => <div key={t.name} className="panel-2 flex items-start gap-2 rounded-xl p-2.5"><TierBadge tier={t.tier} short /><div className="min-w-0"><div className="truncate font-mono text-xs">{t.name}</div><div className="text-muted text-[11px]">{t.description}</div></div></div>)}
        </div>
      </Card>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><div className="font-display font-semibold">Reset my sandbox</div><div className="text-muted text-sm">Restore seed balances, history and personas. A new audit chain starts (it records the previous chain head).</div></div>
          <Button variant="secondary" onClick={async () => { await api.post("/session/reset"); await refreshSession(); pushToast({ kind: "info", title: "Sandbox reset" }); reload(); }}><RotateCcw className="h-4 w-4" /> Reset sandbox</Button>
        </div>
      </Card>
      <Modal open={editing} onClose={() => { setEditing(false); setPending(null); }} title="Change a limit (T4 · step-up)">
        {!pending ? (
          <div className="space-y-3">
            <select value={key} onChange={(e) => { setKey(e.target.value); setValue(lim.limits[e.target.value]); }} className="focus-ring panel-2 h-10 w-full rounded-xl border border-soft px-3 text-sm">
              {Object.keys(LIMIT_LABEL).map((k) => <option key={k} value={k}>{LIMIT_LABEL[k]}</option>)}
            </select>
            <input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value.replace(/[^\d.]/g, ""))} className="focus-ring panel-2 num h-10 w-full rounded-xl border border-soft px-3 text-sm" />
            <p className="text-muted text-xs">Sandbox cap: at most 5× the default. A code will be sent to your Sandbox phone.</p>
            {err && <ErrorNote message={err} />}
            <Button className="w-full" onClick={request} disabled={!value}>Send verification code</Button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm">Enter the 6-digit code from your Sandbox phone to approve this change.</p>
            <input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} className="focus-ring panel-2 num h-12 w-full rounded-xl border border-soft text-center font-mono text-xl tracking-[0.4em]" placeholder="••••••" />
            {err && <ErrorNote message={err} />}
            <Button className="w-full" onClick={verify} disabled={code.length !== 6}>Verify & apply</Button>
          </div>
        )}
      </Modal>
    </div>
  );
}
