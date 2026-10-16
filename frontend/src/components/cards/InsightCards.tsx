import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlarmClock, BellRing, BookOpen, Check, CheckCircle2, ClipboardList, CreditCard, FileWarning, Hourglass, Lightbulb, Lock, ShieldX, Sparkles, TrendingUp, Wallet } from "lucide-react";
import { cx, date, money, pct } from "../../lib/format";
import { useStore } from "../../lib/store";
import { Badge, Button, Meter } from "../ui";

export function Panel({ children, className, tone }: { children: React.ReactNode; className?: string; tone?: "danger" | "success" | "violet" }) {
  const border = tone === "danger" ? "border-rose-500/40" : tone === "success" ? "border-emerald-500/30" : tone === "violet" ? "border-violet-500/30" : "";
  return <div className={cx("panel rounded-2xl p-4", border, className)}>{children}</div>;
}

function Head({ icon, title, right }: { icon: React.ReactNode; title: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <div className="flex items-center gap-2 font-display text-sm font-semibold">{icon}{title}</div>
      {right}
    </div>
  );
}

export function RunwayGauge({ runway }: { runway: any }) {
  const days = runway.runway_days as number;
  const tone = days < 60 ? "danger" : days < 120 ? "warning" : "success";
  return (
    <div>
      <div className="flex items-end justify-between">
        <div>
          <div className="num font-display text-3xl font-semibold">{days}<span className="text-muted ml-1 text-base font-medium">days</span></div>
          <div className="text-muted text-xs">until {date(runway.runway_until)}</div>
        </div>
        <div className="text-right text-xs">
          <div className="num font-medium">{money(runway.daily_burn, runway.reporting_currency)}/day</div>
          <div className="text-muted">trailing 60-day burn</div>
        </div>
      </div>
      <Meter className="mt-3" value={Math.min(days, 365)} max={365} tone={tone as any} />
      <div className="text-muted mt-2 grid grid-cols-3 gap-2 text-[11px]">
        <div><div className="num font-medium text-[var(--text)]">{money(runway.liquid_balance, runway.reporting_currency, { compact: true })}</div>liquid</div>
        <div><div className="num font-medium text-[var(--text)]">−{money(runway.reserved_for_obligations, runway.reporting_currency, { compact: true })}</div>reserved</div>
        <div><div className="num font-medium text-[var(--text)]">{money(runway.available_after_obligations, runway.reporting_currency, { compact: true })}</div>available</div>
      </div>
    </div>
  );
}

export function BudgetCard({ data, compact }: { data: any; compact?: boolean }) {
  const { askRemi } = useStore();
  const ccy = data.reporting_currency;
  const cats = (data.categories ?? []).slice(0, 8).map((c: any) => ({ name: c.category, now: Number(c.last_30_days), prev: Number(c.previous_30_days), change: c.change_pct }));
  return (
    <Panel>
      <Head icon={<TrendingUp className="h-4 w-4 text-brand-500" />} title="Last 30 days" right={<Badge tone="neutral">normalised to {ccy}</Badge>} />
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <div className="num font-display text-2xl font-semibold">{money(data.total_spend_30d, ccy)}</div>
          <div className="text-muted text-xs">vs {money(data.total_spend_prev_30d, ccy)} the 30 days before · spent in {Object.keys(data.spend_by_original_currency ?? {}).join(" + ")}</div>
          <div className="mt-3 h-44">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={cats} layout="vertical" margin={{ left: 0, right: 8, top: 0, bottom: 0 }}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="name" width={86} tick={{ fontSize: 11, fill: "var(--muted)" }} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: "rgba(14,165,160,0.06)" }} contentStyle={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 12, fontSize: 12 }} formatter={(v: any) => money(v, ccy)} />
                <Bar dataKey="now" radius={[0, 6, 6, 0]} barSize={12}>
                  {cats.map((c: any) => <Cell key={c.name} fill={c.change && Number(c.change) >= 15 ? "#f59e0b" : "#0ea5a0"} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div>
          <div className="text-muted mb-2 flex items-center gap-1 text-xs font-medium uppercase tracking-wider"><Hourglass className="h-3.5 w-3.5" /> Runway</div>
          <RunwayGauge runway={data.runway} />
          <p className="text-muted mt-2 text-[11px]">{data.runway.excludes}</p>
        </div>
      </div>
      {!compact && data.recommendations?.length > 0 && (
        <div className="mt-4 space-y-2">
          <div className="text-muted flex items-center gap-1 text-xs font-medium uppercase tracking-wider"><Lightbulb className="h-3.5 w-3.5" /> Three things you could do</div>
          {data.recommendations.map((r: any, i: number) => (
            <div key={r.id} className="panel-2 flex items-start gap-3 rounded-xl p-3">
              <div className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-500/15 text-xs font-semibold text-brand-700 dark:text-brand-300">{i + 1}</div>
              <div className="flex-1 text-sm">
                <div className="font-medium">{r.title}</div>
                <div className="text-muted text-xs">{r.detail}</div>
              </div>
              {r.action?.tool === "create_budget" && (
                <Button size="sm" variant="outline" onClick={() => askRemi(`Set a budget of ${r.action.args.monthly_limit} ${r.action.args.currency} for ${r.action.args.category}`)}>Set budget</Button>
              )}
              {r.action?.tool === "get_remittance_quotes" && <Button size="sm" variant="outline" onClick={() => askRemi("Pay my tuition before the deadline, cheapest safe way")}>Plan it</Button>}
              {r.action?.tool === "set_rate_alert" && <Button size="sm" variant="outline" onClick={() => askRemi("Help me set a rate alert")}>Set alert</Button>}
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

export function CreditPlanCard({ data, onToggle }: { data: any; onToggle?: (key: string, status: string) => void }) {
  const score = data.readiness_score as number;
  return (
    <Panel>
      <Head icon={<CreditCard className="h-4 w-4 text-brand-500" />} title={`6-month credit plan · ${data.country_label}`} right={<Badge tone="warning">illustrative</Badge>} />
      <div className="mb-3 flex items-center gap-4">
        <div className="relative h-16 w-16">
          <svg viewBox="0 0 36 36" className="h-16 w-16 -rotate-90">
            <circle cx="18" cy="18" r="15.5" fill="none" stroke="currentColor" strokeWidth="3.5" className="text-black/5 dark:text-white/10" />
            <circle cx="18" cy="18" r="15.5" fill="none" stroke="url(#cg)" strokeWidth="3.5" strokeLinecap="round" strokeDasharray={`${(score / 100) * 97.4} 97.4`} className="transition-all duration-700" />
            <defs><linearGradient id="cg"><stop offset="0" stopColor="#0ea5a0" /><stop offset="1" stopColor="#6366f1" /></linearGradient></defs>
          </svg>
          <div className="num absolute inset-0 grid place-items-center font-display text-sm font-semibold">{score}</div>
        </div>
        <div>
          <div className="font-medium">{data.readiness_label}</div>
          <div className="text-muted text-xs">Simulated credit-readiness score · {data.saved ? "tracking" : "preview - not saved yet"}</div>
        </div>
      </div>
      <ol className="space-y-1.5">
        {data.tasks.map((t: any) => (
          <li key={t.task_key} className={cx("flex items-start gap-3 rounded-xl px-2 py-1.5", t.status === "done" && "opacity-70")}>
            <button
              disabled={!onToggle || (!t.unlocked && t.status !== "done")}
              onClick={() => onToggle?.(t.task_key, t.status === "done" ? "todo" : "done")}
              className={cx("mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border transition-colors", t.status === "done" ? "border-emerald-500 bg-emerald-500 text-white" : t.status === "in_progress" ? "border-amber-500" : "border-soft", onToggle && t.unlocked && "hover:border-brand-500")}
              aria-label={`Mark ${t.title}`}
            >
              {t.status === "done" ? <Check className="h-3.5 w-3.5" /> : !t.unlocked ? <Lock className="text-muted h-3 w-3" /> : null}
            </button>
            <div className="flex-1">
              <div className={cx("text-sm", t.status === "done" && "line-through")}>{t.title}</div>
              <div className="text-muted text-[11px]">Month {t.month} · {t.points} pts{!t.unlocked && t.status !== "done" ? " · unlocks after earlier steps" : ""}</div>
            </div>
          </li>
        ))}
      </ol>
      <p className="text-muted mt-3 text-[11px]">{data.disclaimer}</p>
    </Panel>
  );
}

export function FraudCard({ data }: { data: any }) {
  return (
    <Panel tone="danger" className="bg-rose-500/[0.04]">
      <div data-testid="fraud-card" className="flex items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-rose-500/15 text-rose-600"><FileWarning className="h-5 w-5" /></div>
        <div className="flex-1">
          <div className="font-display font-semibold text-rose-700 dark:text-rose-300">Possible invoice fraud - blocked</div>
          <ul className="mt-1.5 space-y-1 text-sm">{data.warnings.map((w: string) => <li key={w} className="flex gap-2"><ShieldX className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />{w}</li>)}</ul>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {data.injection_flags.map((f: string) => <Badge key={f} tone="danger">{f.replace(/_/g, " ")}</Badge>)}
            {data.registry_match === false && <Badge tone="danger">account ≠ verified registry</Badge>}
          </div>
          <p className="text-muted mt-3 text-xs">{data.safe_next_step}</p>
        </div>
      </div>
    </Panel>
  );
}

export function DocumentOkCard({ data }: { data: any }) {
  return (
    <Panel tone="success">
      <Head icon={<CheckCircle2 className="h-4 w-4 text-emerald-500" />} title="Document matches the verified registry" />
      <div className="text-muted text-sm">{data.institution} · {data.extracted?.amount} {data.extracted?.currency} · ref {data.extracted?.reference}</div>
    </Panel>
  );
}

export function AlertCard({ data }: { data: any }) {
  return (
    <Panel>
      <Head icon={<BellRing className="h-4 w-4 text-brand-500" />} title={`Watching ${data.pair}`} right={<Badge tone="info">T1 · saved</Badge>} />
      <div className="flex items-end justify-between">
        <div>
          <div className="text-muted text-xs">Alert when {data.direction}</div>
          <div className="num font-display text-2xl font-semibold">{data.target_rate}</div>
        </div>
        <div className="text-right">
          <div className="text-muted text-xs">Now (sandbox)</div>
          <div className="num text-lg font-medium">{data.current_rate}</div>
        </div>
      </div>
      {data.convert_amount && <p className="text-muted mt-2 text-xs">When it triggers, Remi prepares a conversion of <b>{data.convert_amount} {data.convert_currency}</b> for you to confirm.</p>}
      <p className="text-muted mt-1 text-[11px]">Try it: Sandbox → "GBP weakens 1%".</p>
    </Panel>
  );
}

export function SourcesCard({ data }: { data: any[] }) {
  const { openKb } = useStore();
  if (!data?.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-muted inline-flex items-center gap-1 text-[11px]"><BookOpen className="h-3.5 w-3.5" /> Sources</span>
      {data.map((s) => (
        <button key={s.slug} data-testid="source-chip" onClick={() => openKb(s.slug)} className="panel-2 inline-flex items-center gap-1 rounded-full border border-soft px-2.5 py-1 text-[11px] font-medium transition-colors hover:border-brand-400 hover:text-brand-700 dark:hover:text-brand-300">
          {s.title}{s.illustrative && <span className="text-amber-600">· illustrative</span>}
        </button>
      ))}
    </div>
  );
}

export function ChecklistCard({ data }: { data: any }) {
  return (
    <Panel>
      <Head icon={<ClipboardList className="h-4 w-4 text-brand-500" />} title={`Documents · ${data.corridor} ${data.payment_type}`} right={<Badge tone="warning">illustrative</Badge>} />
      <ul className="space-y-1 text-sm">{data.documents.map((d: string) => <li key={d} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 text-brand-500" />{d}</li>)}</ul>
      <p className="text-muted mt-2 text-[11px]">{data.disclaimer}</p>
    </Panel>
  );
}

export function WalletsCard({ data }: { data: any }) {
  return (
    <Panel>
      <Head icon={<Wallet className="h-4 w-4 text-brand-500" />} title="Wallets" right={<span className="num text-sm font-semibold">{money(data.total_in_reporting_currency, data.reporting_currency)}</span>} />
      <div className="grid grid-cols-3 gap-2">
        {data.wallets.map((w: any) => (
          <div key={w.currency} className="panel-2 rounded-xl p-2.5">
            <div className="text-muted text-[11px]">{w.currency}</div>
            <div className="num text-sm font-semibold">{money(w.balance, w.currency, { compact: true })}</div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

export function RefusalCard({ data }: { data: any }) {
  const { navigate } = useStore();
  return (
    <Panel tone="violet" className="bg-violet-500/[0.04]">
      <div className="flex items-start gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-violet-500/15 text-violet-600"><ShieldX className="h-5 w-5" /></div>
        <div className="flex-1">
          <div className="font-display text-sm font-semibold">{data.title}</div>
          <div className="text-muted text-xs">{data.detail}</div>
        </div>
        {data.link && <Button size="sm" variant="outline" onClick={() => navigate("settings")}>Open Settings</Button>}
      </div>
    </Panel>
  );
}

export function SavedCard({ data }: { data: any }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-xl bg-sky-500/8 px-3 py-2 text-xs text-sky-700 dark:text-sky-300">
      <Sparkles className="h-3.5 w-3.5" /> {data.title} <span className="opacity-70">· T1, undo available</span>
    </div>
  );
}

export function FxOptionsCard({ data }: { data: any }) {
  return (
    <Panel>
      <Head icon={<AlarmClock className="h-4 w-4 text-brand-500" />} title="Convert now, alert, or tranches" right={<Badge tone="neutral">no predictions</Badge>} />
      <div className="grid gap-2 sm:grid-cols-3">{data.options.map((o: any) => <div key={o.id} className="panel-2 rounded-xl p-3 text-xs"><div className="mb-1 text-sm font-medium">{o.title}</div><div className="text-muted">{o.detail}</div></div>)}</div>
      <p className="text-muted mt-2 text-[11px]">{data.risk_statement}</p>
    </Panel>
  );
}

export function FxRatesCard({ data }: { data: any }) {
  return (
    <Panel>
      <Head icon={<TrendingUp className="h-4 w-4 text-brand-500" />} title="Sandbox FX rates" right={<Badge tone="neutral">simulated</Badge>} />
      <div className="space-y-1 text-sm">{data.rates.map((r: any) => <div key={r.pair} className="flex justify-between"><span className="text-muted">{r.pair}</span><span className="num">{r.display}</span></div>)}</div>
    </Panel>
  );
}

export function TransactionsCard({ data }: { data: any[] }) {
  return (
    <Panel>
      <div className="space-y-1.5 text-sm">
        {data.slice(0, 8).map((t) => (
          <div key={t.id} className="flex justify-between gap-2"><span className="truncate">{t.description}</span><span className="num shrink-0">{money(t.amount, t.currency)}</span></div>
        ))}
      </div>
    </Panel>
  );
}

export function ObligationsCard({ data }: { data: any[] }) {
  return (
    <Panel>
      <Head icon={<AlarmClock className="h-4 w-4 text-brand-500" />} title="Upcoming obligations" />
      <div className="space-y-2 text-sm">
        {data.slice(0, 4).map((o) => (
          <div key={o.id} className="flex items-center justify-between gap-2">
            <div className="min-w-0"><div className="truncate">{o.title}</div><div className="text-muted text-[11px]">due {date(o.due_date)} · {o.days_left} days</div></div>
            <span className="num shrink-0 font-medium">{money(o.amount, o.currency)}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

export function DraftCard({ data }: { data: any }) {
  return (
    <Panel>
      <Head icon={<ClipboardList className="h-4 w-4 text-brand-500" />} title="Payment draft (nothing sent)" right={<Badge tone="info">T1</Badge>} />
      <div className="text-sm">{data.issuer} · {money(data.amount, data.currency)} · ref {data.reference}</div>
      <div className="text-muted text-xs">Verified registry account {data.verified_account} · due {date(data.due_date)}</div>
    </Panel>
  );
}

export function FeeBreakdownCard({ data }: { data: any }) {
  return (
    <Panel>
      <Head icon={<TrendingUp className="h-4 w-4 text-brand-500" />} title={`Fee breakdown · ${data.provider}`} />
      <div className="text-sm">Fee {data.fixed_and_pct_fee} + FX markup {data.fx_markup_cost} ({pct(data.fx_markup_pct, 2)}) = landed cost <b>{data.landed_cost}</b></div>
    </Panel>
  );
}
