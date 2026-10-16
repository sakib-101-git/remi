import { useMemo, useState } from "react";
import { BadgeCheck, ChevronDown, Download, Eye, HandCoins, KeyRound, Lock, ShieldAlert, Undo2 } from "lucide-react";
import { api } from "../lib/api";
import { auditSentence, PERMISSION_LADDER, type AuditEntry } from "../lib/copy";
import { cx, dateTime, money } from "../lib/format";
import { useApi, useStore } from "../lib/store";
import { Badge, Button, Card, CardHeader, Chips, Dialog, ErrorState, Field, Input, Meter, Note, PageHeader, Select, Skeleton, SkeletonRows, StatusDot, TierTag, Toggle } from "../ui";

const LADDER_ICON = [Eye, Undo2, HandCoins, KeyRound, Lock];
const LIMITS: { key: string; label: string }[] = [
  { key: "per_transaction_max_usd", label: "Per payment" },
  { key: "daily_max_usd", label: "Each day" },
  { key: "monthly_max_usd", label: "Every 30 days" },
  { key: "step_up_threshold_usd", label: "Extra check above" },
];
const usd = (v: string | number) => money(v, "USD", { whole: true });

export default function Security() {
  const settings = useApi<any>("/settings");
  const audit = useApi<any>("/audit?limit=300");
  const { session, setSession, pushToast } = useStore();
  const [filter, setFilter] = useState<"all" | "money" | "safety" | "remi" | "you">("all");
  const [open, setOpen] = useState<number | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [limitOpen, setLimitOpen] = useState(false);

  const entries = useMemo(() => {
    const rows: { e: AuditEntry; text: string; kind: string }[] = [];
    for (const e of (audit.data?.entries ?? []) as AuditEntry[]) {
      const s = auditSentence(e);
      if (s) rows.push({ e, ...s });
    }
    return rows;
  }, [audit.data]);
  const shown = entries.filter((r) => filter === "all" || r.kind === filter).slice(0, 60);

  const kill = async (paused: boolean) => {
    await api.post("/settings/kill-switch", { paused });
    if (session) setSession({ ...session, agent_paused: paused });
    pushToast({ kind: paused ? "blocked" : "executed", title: paused ? "Remi's payment actions are paused" : "Remi can prepare payments again", body: paused ? "Remi can still answer questions and look things up." : undefined });
    settings.reload();
  };
  const verify = async () => {
    setVerifying(true);
    await api.get("/audit/verify");
    audit.reload();
    window.setTimeout(() => setVerifying(false), 500);
  };

  const lim = settings.data?.limits;
  const v = audit.data?.verification;
  return (
    <div>
      <PageHeader title="Security" description="What Remi can do on its own, and what always needs you." />
      <div className="space-y-6">
        <Card data-testid="permission-ladder">
          <CardHeader title="What Remi can do" description="Fixed rules decide this, not the AI." />
          <div className="divide-y divide-line">
            {PERMISSION_LADDER.map((p, i) => {
              const Icon = LADDER_ICON[i];
              return (
                <div key={p.tier} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center">
                  <span className={cx("grid h-11 w-11 shrink-0 place-items-center rounded-full", i < 2 ? "bg-surface-muted" : i === 4 ? "bg-primary text-on-primary" : i === 3 ? "bg-danger-soft text-danger" : "bg-warning-soft text-warning")}><Icon className="h-5 w-5" /></span>
                  <div className="min-w-0 flex-1">
                    <div className="text-body-strong">{p.title}</div>
                    <div className="text-small text-ink-muted">{p.detail}</div>
                  </div>
                  <div className="flex items-center gap-2 sm:justify-end">
                    <Badge tone={p.tone}>{p.control}</Badge>
                    <TierTag tier={p.tier} />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        <div className="grid items-start gap-6 lg:grid-cols-[1fr_380px]">
          <Card>
            <CardHeader title="Your limits" description="In US dollars, across all your wallets" action={<Button size="sm" variant="secondary" onClick={() => setLimitOpen(true)} disabled={!lim}>Edit</Button>} />
            {!lim ? <Skeleton className="h-40" /> : (
              <>
                <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
                  {LIMITS.map((l) => (
                    <div key={l.key} className="rounded-input bg-surface-muted p-4">
                      <div className="text-caption text-ink-muted">{l.label}</div>
                      <div className="text-h2 tabular">{usd(lim.limits[l.key])}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-6 space-y-4">
                  <div>
                    <div className="mb-2 flex justify-between text-small"><span>Used today</span><span className="tabular">{usd(lim.usage.day_usd)} of {usd(lim.limits.daily_max_usd)}</span></div>
                    <Meter value={Number(lim.usage.day_usd)} max={Number(lim.limits.daily_max_usd)} label="Used today" />
                  </div>
                  <div>
                    <div className="mb-2 flex justify-between text-small"><span>Used in the last 30 days</span><span className="tabular">{usd(lim.usage.month_usd)} of {usd(lim.limits.monthly_max_usd)}</span></div>
                    <Meter value={Number(lim.usage.month_usd)} max={Number(lim.limits.monthly_max_usd)} label="Used in 30 days" />
                  </div>
                </div>
                <p className="mt-4 text-caption text-ink-muted">Payments to your verified university need the extra check only above {usd(lim.limits.verified_institution_step_up_usd)}.</p>
              </>
            )}
          </Card>
          <Card tone={session?.agent_paused ? "warning" : "surface"} className="flex flex-col">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-h2">Pause Remi's payment actions</h2>
                <p className="mt-2 text-small text-ink-muted">Remi stops preparing payments and conversions. It can still answer questions and look things up.</p>
              </div>
              <Toggle checked={!!session?.agent_paused} onChange={kill} label="Pause Remi's payment actions" testId="kill-switch" />
            </div>
            {session?.agent_paused ? (
              <Note tone="warning" className="mt-4">Paused. Turn it off to let Remi prepare payments again.</Note>
            ) : (
              <div className="mt-4"><StatusDot tone="success">Active · Remi can prepare payments for your approval</StatusDot></div>
            )}
          </Card>
        </div>

        <Card>
          <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-h2">Activity log</h2>
              <p className="mt-1 text-small text-ink-muted">Every step Remi or you take is written here and can't be changed without it showing.</p>
            </div>
            <div className="flex items-center gap-2">
              <a href="/api/audit/export" className="inline-flex h-10 items-center gap-2 rounded-full px-4 text-small font-semibold text-primary hover:bg-surface-muted"><Download className="h-4 w-4" /> Export</a>
              <Button size="sm" variant="secondary" loading={verifying} onClick={verify} data-testid="verify-log">Verify now</Button>
            </div>
          </div>
          {audit.error && <ErrorState message={audit.error} onRetry={audit.reload} />}
          {v && (
            <div data-testid="chain-status" className={cx("mb-4 flex items-center gap-3 rounded-input px-4 py-3", v.valid ? "bg-success-soft text-success" : "bg-danger-soft text-danger")}>
              {v.valid ? <BadgeCheck className="h-5 w-5" /> : <ShieldAlert className="h-5 w-5" />}
              <span className="text-small font-semibold">{v.valid ? `Log verified · ${v.entries} entries, unchanged` : `Log changed at entry ${v.broken_at}: someone edited it`}</span>
            </div>
          )}
          <Chips value={filter} onChange={setFilter} items={[{ value: "all", label: "All" }, { value: "money", label: "Payments" }, { value: "safety", label: "Safety" }, { value: "remi", label: "Remi" }, { value: "you", label: "You" }]} />
          {!audit.data ? <div className="mt-6"><SkeletonRows rows={6} /></div> : (
            <div className="mt-4 divide-y divide-line">
              {shown.map(({ e, text }) => (
                <div key={e.seq} data-testid="audit-row">
                  <button className="flex w-full items-center gap-4 py-3 text-left" onClick={() => setOpen(open === e.seq ? null : e.seq)} aria-expanded={open === e.seq}>
                    <span className="min-w-0 flex-1">
                      <span className="block text-body">{text}</span>
                      <span className="block text-caption text-ink-muted">{dateTime(e.ts)}</span>
                    </span>
                    {e.tier && <TierTag tier={e.tier} />}
                    <ChevronDown className={cx("h-4 w-4 shrink-0 text-ink-muted transition-transform", open === e.seq && "rotate-180")} />
                  </button>
                  {open === e.seq && (
                    <div className="mb-3 rounded-input bg-surface-muted p-4">
                      <div className="text-caption text-ink-muted">Technical details</div>
                      <dl className="mt-2 space-y-1 break-all text-caption">
                        <div><dt className="inline text-ink-muted">Entry </dt><dd className="inline">#{e.seq} · {e.action}{e.tool ? ` · ${e.tool}` : ""} · {e.actor}</dd></div>
                        <div><dt className="inline text-ink-muted">Hash </dt><dd className="inline font-mono">{e.hash}</dd></div>
                        <div><dt className="inline text-ink-muted">Previous </dt><dd className="inline font-mono">{e.prev_hash}</dd></div>
                      </dl>
                      <pre className="scroll-thin mt-3 max-h-56 overflow-auto whitespace-pre-wrap font-mono text-caption">{JSON.stringify({ inputs: e.inputs, result: e.result }, null, 2)}</pre>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
      {lim && <LimitDialog open={limitOpen} onClose={() => setLimitOpen(false)} limits={lim.limits} onDone={() => { settings.reload(); audit.reload(); }} />}
    </div>
  );
}

function LimitDialog({ open, onClose, limits, onDone }: { open: boolean; onClose: () => void; limits: Record<string, string>; onDone: () => void }) {
  const { pushToast } = useStore();
  const [key, setKey] = useState(LIMITS[1].key);
  const [value, setValue] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const close = () => {
    setPending(null);
    setCode("");
    setErr(null);
    onClose();
  };
  const request = async () => {
    setBusy(true);
    setErr(null);
    try {
      const out = await api.post<any>("/settings/limits", { changes: { [key]: value || limits[key] } });
      setPending(out.action_id);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  const verify = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api.post(`/settings/limits/${pending}/verify`, { code });
      pushToast({ kind: "executed", title: "Limit changed", body: `${LIMITS.find((l) => l.key === key)?.label}: ${usd(value)}` });
      onDone();
      close();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onClose={close}>
      <h2 className="text-h2">Change a limit</h2>
      <p className="mt-2 text-small text-ink-muted">Only you can do this, and it needs a one-time code. Remi has no way to change limits.</p>
      {!pending ? (
        <div className="mt-6 space-y-4">
          <Field label="Limit">
            <Select value={key} onChange={(e) => { setKey(e.target.value); setValue(""); }}>{LIMITS.map((l) => <option key={l.key} value={l.key}>{l.label} (now {usd(limits[l.key])})</option>)}</Select>
          </Field>
          <Field label="New amount in US dollars" hint="In this sandbox, at most 5 times the default.">
            <Input inputMode="decimal" value={value} placeholder={limits[key]} onChange={(e) => setValue(e.target.value.replace(/[^\d.]/g, ""))} />
          </Field>
          {err && <Note tone="danger">{err}</Note>}
          <Button block loading={busy} onClick={request} disabled={!value}>Send me a code</Button>
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          <Field label="Enter the 6-digit code we sent to your phone">
            <Input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="••••••" className="text-center tracking-widest" />
          </Field>
          {err && <Note tone="danger">{err}</Note>}
          <Button block loading={busy} onClick={verify} disabled={code.length !== 6}>Confirm change</Button>
        </div>
      )}
    </Dialog>
  );
}
