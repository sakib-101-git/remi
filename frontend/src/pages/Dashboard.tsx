import { ArrowDownLeft, ArrowRightLeft, ArrowUpRight, BellRing, Bot, CalendarClock, CreditCard, Hourglass, ShieldCheck, Wallet } from "lucide-react";
import { cx, date, money } from "../lib/format";
import { useApi, useStore } from "../lib/store";
import { ActionCard } from "../components/cards/ActionCard";
import { RunwayGauge } from "../components/cards/InsightCards";
import { Badge, Button, Card, CardHeader, Empty, ErrorNote, Meter, Skeleton, StatusPill } from "../components/ui";

const FLAG_CCY: Record<string, string> = { BDT: "Bangladeshi taka", GBP: "British pound", USD: "US dollar", CAD: "Canadian dollar", NGN: "Nigerian naira", INR: "Indian rupee" };

export default function Dashboard() {
  const { session, askRemi, navigate, tokenCards } = useStore();
  const { data, error, loading, reload } = useApi<any>("/dashboard");
  if (error) return <ErrorNote message={error} onRetry={reload} />;
  const first = session?.user.name.split(" ")[0];
  const w = data?.wallets;
  const tuition = data?.obligations?.find((o: any) => o.kind === "tuition");
  const home = ({ BD: "BDT", NG: "NGN", IN: "INR" } as Record<string, string>)[session?.user.home_country ?? "BD"] ?? "USD";
  const rep = session?.user.reporting_currency ?? "GBP";
  const convertPrompt = `Convert ${({ BDT: "50,000", NGN: "200,000", INR: "20,000" } as Record<string, string>)[home] ?? "100"} ${home} to ${rep}`;
  const alertPrompt = session?.persona === "rahim" ? "Tell me when GBP/BDT is better than 163.5, then convert 500 GBP" : `Tell me when ${rep}/${home} is above ${session?.persona === "ada" ? "1120" : "90"}`;
  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-muted text-sm">{session?.user.university} · student ID {session?.user.student_id} · KYC <Badge tone="success">{session?.user.kyc_status} (simulated)</Badge></p>
          <h1 className="font-display mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Good to see you, {first}.</h1>
        </div>
        <Button data-testid="dash-ask" onClick={() => navigate("chat")}><Bot className="h-4 w-4" /> Ask Remi</Button>
      </div>

      {data?.open_actions?.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium"><ShieldCheck className="h-4 w-4 text-amber-500" /> Waiting for your approval</div>
          <div className="grid gap-3 lg:grid-cols-2">{data.open_actions.map((a: any) => <ActionCard key={`${a.id}-${tokenCards[a.id] ? "t" : "n"}`} initial={tokenCards[a.id] ? { ...a, confirm_token: tokenCards[a.id].confirm_token } : a} />)}</div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="brand-gradient relative overflow-hidden border-0 text-white lg:col-span-2">
          <div className="absolute -right-10 -top-16 h-56 w-56 rounded-full bg-white/10 blur-2xl" />
          <div className="relative">
            <div className="flex items-center gap-2 text-sm text-white/80"><Wallet className="h-4 w-4" /> Total across wallets</div>
            {loading || !w ? <Skeleton className="mt-2 h-10 w-56 bg-white/20" /> : <div data-testid="total-balance" className="num font-display mt-1 text-4xl font-semibold tracking-tight">{money(w.total_in_reporting_currency, w.reporting_currency)}</div>}
            <div className="mt-1 text-xs text-white/70">in {w?.reporting_currency} at sandbox mid-market rates</div>
            <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {(w?.wallets ?? []).map((x: any) => (
                <div key={x.currency} className="rounded-xl bg-white/12 p-3 backdrop-blur">
                  <div className="flex items-center justify-between text-xs text-white/80"><span className="font-semibold">{x.currency}</span><span className="hidden sm:inline">{FLAG_CCY[x.currency]}</span></div>
                  <div className="num mt-1 text-lg font-semibold">{money(x.balance, x.currency)}</div>
                  <div className="num text-[11px] text-white/70">≈ {money(x.in_reporting_currency, w.reporting_currency)}</div>
                </div>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button onClick={() => askRemi(convertPrompt)} className="rounded-xl bg-white/15 px-3 py-1.5 text-xs font-medium hover:bg-white/25"><ArrowRightLeft className="mr-1 inline h-3.5 w-3.5" />Convert</button>
              <button onClick={() => navigate("transfers")} className="rounded-xl bg-white/15 px-3 py-1.5 text-xs font-medium hover:bg-white/25"><ArrowUpRight className="mr-1 inline h-3.5 w-3.5" />Send money</button>
              <button onClick={() => askRemi(alertPrompt)} className="rounded-xl bg-white/15 px-3 py-1.5 text-xs font-medium hover:bg-white/25"><BellRing className="mr-1 inline h-3.5 w-3.5" />Rate alert</button>
            </div>
          </div>
        </Card>
        <Card>
          <CardHeader title="Runway" subtitle="How long your money lasts" icon={<Hourglass className="h-4 w-4" />} />
          {data ? <RunwayGauge runway={data.runway} /> : <Skeleton className="h-24" />}
          <Button variant="outline" size="sm" className="mt-4 w-full" onClick={() => navigate("budget")}>See budget & tips</Button>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Upcoming obligations" subtitle="Remi plans payments around these deadlines" icon={<CalendarClock className="h-4 w-4" />} />
          {!data ? <Skeleton className="h-28" /> : data.obligations.length === 0 ? <Empty title="Nothing due" body="No obligations in the next 90 days." /> : (
            <div className="divide-y divide-[var(--border)]">
              {data.obligations.map((o: any) => (
                <div key={o.id} className="flex items-center gap-3 py-3">
                  <div className={cx("grid h-10 w-10 shrink-0 place-items-center rounded-xl text-xs font-semibold", o.days_left <= 7 ? "bg-rose-500/12 text-rose-600" : o.kind === "tuition" ? "bg-amber-500/12 text-amber-700 dark:text-amber-300" : "panel-2 text-muted")}>{o.days_left}d</div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{o.title}</div>
                    <div className="text-muted text-xs">due {date(o.due_date)}{o.recurring ? " · monthly" : ""}</div>
                  </div>
                  <div className="num text-right text-sm font-semibold">{money(o.amount, o.currency)}</div>
                  {o.kind === "tuition" && <Button size="sm" data-testid="pay-tuition" onClick={() => askRemi("Pay my tuition before the deadline, cheapest safe way")}>Pay with Remi</Button>}
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card>
          <CardHeader title="Credit readiness" subtitle={data?.credit?.country ? `${data.credit.country} plan` : ""} icon={<CreditCard className="h-4 w-4" />} />
          {data ? (
            <>
              <div className="num font-display text-3xl font-semibold">{data.credit.readiness_score}<span className="text-muted text-base">/100</span></div>
              <div className="text-muted text-xs">{data.credit.readiness_label} · simulated</div>
              <Meter className="mt-3" value={data.credit.readiness_score} />
              <Button variant="outline" size="sm" className="mt-4 w-full" onClick={() => (data.credit.saved ? navigate("credit") : askRemi(`I just arrived in the ${session?.user.host_country} and have no credit history`))}>{data.credit.saved ? "Track my plan" : "Build my credit plan"}</Button>
            </>
          ) : <Skeleton className="h-24" />}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Recent activity" subtitle="Live settlement status" icon={<ArrowRightLeft className="h-4 w-4" />} right={<Button size="sm" variant="ghost" onClick={() => navigate("transfers")}>All</Button>} />
          {!data ? <Skeleton className="h-40" /> : (
            <div className="divide-y divide-[var(--border)]">
              {data.recent.map((t: any) => {
                const incoming = t.kind === "income" || t.kind === "transfer_in";
                return (
                  <div key={t.id} className="flex items-center gap-3 py-2.5" data-testid="txn-row">
                    <div className={cx("grid h-8 w-8 shrink-0 place-items-center rounded-lg", incoming ? "bg-emerald-500/12 text-emerald-600" : "panel-2 text-muted")}>{incoming ? <ArrowDownLeft className="h-4 w-4" /> : t.kind === "fx_conversion" ? <ArrowRightLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}</div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm">{t.description}</div>
                      <div className="text-muted text-[11px]">{date(t.occurred_at, true)}{t.category ? ` · ${t.category}` : ""}{t.reference && !t.reference.includes("SEED") ? ` · ${t.reference}` : ""}</div>
                    </div>
                    {t.kind === "transfer_out" && t.status !== "settled" && <StatusPill status={t.status} />}
                    <div className={cx("num text-right text-sm font-medium", incoming && "text-emerald-600 dark:text-emerald-400")}>{incoming ? "+" : "−"}{money(t.amount, t.currency)}{t.counter_amount && <div className="text-muted text-[11px] font-normal">→ {money(t.counter_amount, t.counter_currency)}</div>}</div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
        <Card>
          <CardHeader title="Rate alerts" subtitle="Remi proposes, you confirm" icon={<BellRing className="h-4 w-4" />} />
          {!data ? <Skeleton className="h-20" /> : data.alerts.length === 0 ? (
            <Empty title="No alerts yet" body="Ask Remi to watch a rate for you." action={<Button size="sm" variant="outline" onClick={() => askRemi(alertPrompt)}>Set one</Button>} />
          ) : (
            <div className="space-y-2">
              {data.alerts.map((a: any) => (
                <div key={a.id} className="panel-2 flex items-center justify-between rounded-xl px-3 py-2 text-sm">
                  <div><div className="font-medium">{a.pair} {a.direction} {a.target_rate}</div><div className="text-muted text-[11px]">{a.convert_amount ? `then convert ${a.convert_amount} ${a.convert_currency}` : "notify only"}{a.triggered_rate ? ` · hit at ${a.triggered_rate}` : ""}</div></div>
                  <StatusPill status={a.status} />
                </div>
              ))}
            </div>
          )}
          {tuition && <p className="text-muted mt-4 text-[11px]">Tip: tuition of {money(tuition.amount, tuition.currency)} is due in {tuition.days_left} days.</p>}
        </Card>
      </div>
    </div>
  );
}
