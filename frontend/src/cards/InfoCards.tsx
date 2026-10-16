import { BellRing, BookOpen, CircleCheck, FileText, ShieldAlert, ShieldCheck } from "lucide-react";
import { date, humanizeAmounts, money, shortDate } from "../lib/format";
import { useStore } from "../lib/store";
import { BarList, Badge, Button, Card, Flag, KeyValue, Note, Ring } from "../ui";

/** S7: a document that looks like invoice fraud. */
export function FraudCard({ data }: { data: any }) {
  return (
    <Card tone="danger" data-testid="fraud-card" className="animate-rise">
      <div className="flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-full bg-danger-soft text-danger"><ShieldAlert className="h-5 w-5" /></span>
        <div>
          <Badge tone="danger">Blocked</Badge>
          <h3 className="mt-1 text-h2">This invoice looks like fraud</h3>
        </div>
      </div>
      <ul className="mt-4 space-y-2 text-small">
        {data.warnings.map((w: string) => <li key={w} className="flex gap-2"><span aria-hidden className="text-danger">•</span>{w}</li>)}
      </ul>
      <Note tone="neutral" className="mt-4">{data.safe_next_step}</Note>
      <p className="mt-3 text-caption text-ink-muted">No recipient was added and nothing was paid. This check is in your activity log.</p>
    </Card>
  );
}

export function DocumentOkCard({ data }: { data: any }) {
  return (
    <Card className="animate-rise">
      <Badge tone="success" icon={<CircleCheck className="h-4 w-4" />}>Matches your university's verified details</Badge>
      <p className="mt-3 text-body">{data.institution}</p>
      <p className="text-small text-ink-muted">{money(data.extracted?.amount, data.extracted?.currency)} · reference {data.extracted?.reference}</p>
    </Card>
  );
}

export function AlertCard({ data }: { data: any }) {
  return (
    <Card className="animate-rise" data-testid="alert-card">
      <div className="flex items-center justify-between gap-3">
        <Badge tone="primary" icon={<BellRing className="h-4 w-4" />}>Rate alert on</Badge>
        <span className="text-caption text-ink-muted">You can undo this</span>
      </div>
      <h3 className="mt-3 text-h2">{data.pair} {data.direction === "below" ? "below" : "above"} {data.target_rate}</h3>
      <p className="mt-1 text-small text-ink-muted">Now {data.current_rate} (sandbox rate)</p>
      {data.convert_amount && <p className="mt-3 text-body">When it hits, Remi prepares a {data.convert_amount} {data.convert_currency} conversion for you to approve.</p>}
    </Card>
  );
}

/** S4: how long the money lasts + where it goes. */
export function InsightCard({ data }: { data: any }) {
  const { navigate } = useStore();
  const rw = data.runway ?? data;
  const ccy = rw.reporting_currency;
  const cats = (data.categories ?? []).slice(0, 4).map((c: any) => ({ label: c.category, value: Number(c.last_30_days) }));
  const tip = data.recommendations?.[0];
  return (
    <Card className="animate-rise" data-testid="insight-card">
      <div className="text-small text-ink-muted">Your money lasts until</div>
      <div className="text-h1">{date(rw.runway_until)}</div>
      <p className="mt-2 text-small text-ink-muted">You spend about {money(rw.daily_burn, ccy, { whole: true })} a day. {money(rw.reserved_for_obligations, ccy, { whole: true })} is set aside for upcoming bills and tuition.</p>
      {cats.length > 0 && <div className="mt-5"><BarList rows={cats} format={(v) => money(v, ccy, { whole: true })} /></div>}
      {tip && <Note tone="mint" className="mt-5"><span className="font-semibold">{humanizeAmounts(tip.title)}.</span> {humanizeAmounts(tip.detail)}</Note>}
      <Button variant="ghost" size="sm" className="-ml-2 mt-3" onClick={() => navigate("insights")}>See all insights</Button>
    </Card>
  );
}

export function CreditNextCard({ data }: { data: any }) {
  const { navigate } = useStore();
  const next = data.next_steps?.[0];
  return (
    <Card className="animate-rise" data-testid="credit-card">
      <div className="flex items-center gap-5">
        <Ring value={data.readiness_score} size={88} />
        <div>
          <div className="text-small text-ink-muted">Credit readiness · {data.country_label}</div>
          <div className="text-h2">{data.readiness_label}</div>
        </div>
      </div>
      {next && (
        <div className="mt-5 rounded-input bg-surface-muted p-4">
          <div className="text-small text-ink-muted">Your next step</div>
          <div className="text-body-strong">{next.title}</div>
          <div className="text-small text-ink-muted">{next.description}</div>
        </div>
      )}
      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="text-caption text-ink-muted">Illustrative steps. Check official sources.</span>
        <Button size="sm" variant="secondary" onClick={() => navigate("credit")}>See my plan</Button>
      </div>
    </Card>
  );
}

export function RefusalCard({ data }: { data: any }) {
  const { navigate, setChatOpen } = useStore();
  return (
    <Card className="animate-rise" data-testid="refusal-card">
      <Badge tone="primary" icon={<ShieldCheck className="h-4 w-4" />}>Remi can't do this</Badge>
      <h3 className="mt-3 text-h2">{data.title}</h3>
      <p className="mt-1 text-small text-ink-muted">{data.detail}</p>
      {data.link && <Button size="sm" variant="secondary" className="mt-4" onClick={() => { setChatOpen(false); navigate("security"); }}>Open Security</Button>}
    </Card>
  );
}

export function SavedCard({ data }: { data: any }) {
  return <Note tone="mint" icon={<CircleCheck className="h-4 w-4" />}>{data.title}. You can undo this.</Note>;
}

export function ChecklistCard({ data }: { data: any }) {
  return (
    <Card className="animate-rise">
      <h3 className="text-h2">Documents you'll usually need</h3>
      <ul className="mt-3 space-y-2 text-body">
        {data.documents.map((d: string) => <li key={d} className="flex gap-3"><FileText className="mt-0.5 h-5 w-5 text-ink-muted" />{d}</li>)}
      </ul>
      <p className="mt-3 text-caption text-ink-muted">Illustrative. Check with your university and bank.</p>
    </Card>
  );
}

export function WalletsMiniCard({ data }: { data: any }) {
  return (
    <Card className="animate-rise">
      <div className="text-small text-ink-muted">Total balance</div>
      <div className="text-h1 tabular">{money(data.total_in_reporting_currency, data.reporting_currency, { whole: true })}</div>
      <div className="mt-4 space-y-3">
        {data.wallets.map((w: any) => (
          <div key={w.currency} className="flex items-center gap-3">
            <Flag currency={w.currency} size={28} />
            <span className="flex-1 text-body">{w.currency}</span>
            <span className="text-body-strong tabular">{money(w.balance, w.currency, { whole: true })}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function FxOptionsCard({ data }: { data: any }) {
  return (
    <Card className="animate-rise">
      <h3 className="text-h2">Three ways to convert</h3>
      <div className="mt-3 divide-y divide-line">
        {data.options.map((o: any) => (
          <div key={o.id} className="py-3">
            <div className="text-body-strong">{o.title}</div>
            <div className="text-small text-ink-muted">{humanizeAmounts(o.detail)}</div>
          </div>
        ))}
      </div>
      <p className="mt-2 text-caption text-ink-muted">{data.risk_statement}</p>
    </Card>
  );
}

export function FxRatesCard({ data }: { data: any }) {
  return (
    <Card className="animate-rise">
      <h3 className="text-h2">Exchange rates</h3>
      <div className="mt-2">{data.rates.map((r: any) => <KeyValue key={r.pair} label={r.pair} value={r.display} />)}</div>
      <p className="mt-2 text-caption text-ink-muted">Sandbox rates</p>
    </Card>
  );
}

export function ObligationsCard({ data }: { data: any[] }) {
  return (
    <Card className="animate-rise">
      <h3 className="text-h2">Coming up</h3>
      <div className="mt-2">{data.slice(0, 4).map((o) => <KeyValue key={o.id} label={`${o.title.split(" — ")[0]} · ${shortDate(o.due_date)}`} value={money(o.amount, o.currency, { whole: true })} />)}</div>
    </Card>
  );
}

export function DraftCard({ data }: { data: any }) {
  return (
    <Card className="animate-rise">
      <Badge tone="neutral">Draft · nothing sent</Badge>
      <h3 className="mt-3 text-h2">{money(data.amount, data.currency)} to {data.issuer}</h3>
      <p className="mt-1 text-small text-ink-muted">To the verified account {data.verified_account} · due {date(data.due_date)} · ref {data.reference}</p>
    </Card>
  );
}

export function FeeCard({ data }: { data: any }) {
  return (
    <Card className="animate-rise">
      <h3 className="text-h2">Fee breakdown · {String(data.provider).replace(" (sandbox)", "")}</h3>
      <div className="mt-2">
        <KeyValue label="Fee" value={data.fixed_and_pct_fee} />
        <KeyValue label="Exchange-rate markup" value={`${data.fx_markup_cost} (${Number(data.fx_markup_pct).toFixed(2)}%)`} />
        <KeyValue label="Total cost" value={data.landed_cost} strong />
      </div>
    </Card>
  );
}

export function TransactionsMiniCard({ data }: { data: any[] }) {
  return (
    <Card className="animate-rise">
      <h3 className="text-h2">Recent transactions</h3>
      <div className="mt-2">{data.slice(0, 6).map((t) => <KeyValue key={t.id} label={t.description} value={money(t.amount, t.currency)} />)}</div>
    </Card>
  );
}

/** "From: Paying tuition from abroad" chips under an answer. */
export function SourceChips({ data }: { data: any[] }) {
  const { openKb } = useStore();
  if (!data?.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {data.map((s) => (
        <button
          key={s.slug}
          data-testid="source-chip"
          onClick={() => openKb(s.slug)}
          className="inline-flex h-9 items-center gap-2 rounded-full border border-line bg-surface px-4 text-small transition-colors hover:border-primary"
        >
          <BookOpen className="h-4 w-4 text-ink-muted" /> From: {s.title}
        </button>
      ))}
    </div>
  );
}

