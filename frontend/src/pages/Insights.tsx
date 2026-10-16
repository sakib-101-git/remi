import { useState } from "react";
import { Lightbulb } from "lucide-react";
import { api } from "../lib/api";
import { date, daysBetween, money, plain } from "../lib/format";
import { useApi, useStore } from "../lib/store";
import { Badge, BarList, Button, Card, CardHeader, ErrorState, KeyValue, Meter, PageHeader, Sheet, Skeleton, Stat, TextLink } from "../ui";

export default function Insights() {
  const { data, error, reload } = useApi<any>("/budget");
  const { session, navigate, askRemi, pushToast } = useStore();
  const [tipIndex, setTipIndex] = useState(0);
  const [allCats, setAllCats] = useState(false);
  const [allBills, setAllBills] = useState(false);
  const [saving, setSaving] = useState(false);

  const header = <PageHeader title="Insights" description="How long your money lasts, and where it goes." />;
  if (error) return <>{header}<ErrorState message={error} onRetry={reload} /></>;
  if (!data) return <>{header}<div className="space-y-6"><Skeleton className="h-48" /><Skeleton className="h-72" /></div></>;

  const ccy = data.reporting_currency;
  const rw = data.runway;
  const cats: any[] = data.categories ?? [];
  const top = cats.slice(0, 5);
  const otherTotal = cats.slice(5).reduce((s, c) => s + Number(c.last_30_days), 0);
  const bigMover = [...cats].filter((c) => c.change_pct !== null && Math.abs(Number(c.change_pct)) > 20).sort((a, b) => Number(b.change_pct) - Number(a.change_pct))[0];
  const rows = [
    ...top.map((c) => ({
      label: c.category,
      value: Number(c.last_30_days),
      badge: c.change_pct !== null && Math.abs(Number(c.change_pct)) > 20 ? <Badge tone={Number(c.change_pct) > 0 ? "accent" : "success"}>{Number(c.change_pct) > 0 ? "+" : "−"}{Math.abs(Math.round(Number(c.change_pct)))}% vs last month</Badge> : undefined,
    })),
    ...(otherTotal > 0 ? [{ label: "Other", value: otherTotal }] : []),
  ];
  const tips: any[] = data.recommendations ?? [];
  const tip = tips.length ? tips[tipIndex % tips.length] : null;
  const bills = [
    ...(data.obligations ?? []).filter((o: any) => o.recurring).map((o: any) => ({ name: o.title.split(" — ")[0], amount: Number(o.in_reporting) })),
    ...(data.subscriptions ?? []).map((s: any) => ({ name: s.merchant, amount: Number(s.monthly_in_reporting) })),
  ];
  const sinceToday = daysBetween(session?.sim_now?.slice(0, 10), rw.runway_until);

  const runTip = async () => {
    const a = tip?.action;
    if (!a) return;
    if (a.tool === "create_budget") {
      setSaving(true);
      try {
        await api.post("/budgets", { category: a.args.category, monthly_limit: String(a.args.monthly_limit), currency: a.args.currency });
        pushToast({ kind: "executed", title: "Budget set", body: `${a.args.category}: ${money(a.args.monthly_limit, a.args.currency, { whole: true })} a month` });
        reload();
      } catch (e: any) {
        pushToast({ kind: "blocked", title: "Couldn't set the budget", body: e.message });
      } finally {
        setSaving(false);
      }
    } else if (a.tool === "get_remittance_quotes") navigate("send");
    else askRemi("Help me set a rate alert");
  };
  const tipLabel = (a: any) =>
    a?.tool === "create_budget" ? `Set a ${money(a.args.monthly_limit, a.args.currency, { whole: true })} ${String(a.args.category).toLowerCase()} budget` : a?.tool === "get_remittance_quotes" ? "Plan it" : a?.tool === "set_rate_alert" ? "Set an alert" : null;

  return (
    <div>
      {header}
      <div className="space-y-6">
        <Card tone="mint" className="p-8" data-testid="runway-card">
          <Stat label="Your money lasts until" value={date(rw.runway_until)} />
          <p className="mt-3 max-w-xl text-body">
            You spend about <span className="font-semibold tabular">{money(rw.daily_burn, ccy, { whole: true })}</span> a day.{" "}
            <span className="font-semibold tabular">{money(rw.reserved_for_obligations, ccy, { whole: true })}</span> is set aside for tuition and other bills.
          </p>
          {sinceToday !== null && <Meter className="mt-6" value={Math.min(sinceToday, 365)} max={365} label="Days your money lasts, out of a year" />}
          {sinceToday !== null && <div className="mt-2 text-caption text-ink-muted">{sinceToday} days from today · doesn't count money you'll receive</div>}
        </Card>

        <div className="grid items-start gap-6 lg:grid-cols-[1fr_380px]">
          <Card>
            <CardHeader title="This month" description={`${money(data.total_spend_30d, ccy, { whole: true })} spent in the last 30 days`} action={<TextLink onClick={() => setAllCats(true)}>See all</TextLink>} />
            <BarList rows={rows} highlight={bigMover?.category} format={(v) => money(v, ccy, { whole: true })} />
          </Card>

          <div className="space-y-6">
            <Card data-testid="tip-card">
              <div className="flex items-center gap-2 text-small text-ink-muted"><Lightbulb className="h-4 w-4" /> Remi suggests</div>
              {tip ? (
                <>
                  <h3 className="mt-3 text-h2">{plain(tip.title)}</h3>
                  <p className="mt-2 text-small text-ink-muted">{plain(tip.detail)}</p>
                  <div className="mt-6 flex flex-wrap items-center gap-3">
                    {tipLabel(tip.action) && <Button size="sm" loading={saving} onClick={runTip}>{tipLabel(tip.action)}</Button>}
                    {tips.length > 1 && <Button size="sm" variant="ghost" onClick={() => setTipIndex((i) => i + 1)}>Next tip</Button>}
                  </div>
                </>
              ) : <p className="mt-3 text-body text-ink-muted">You're on track. Nothing to change right now.</p>}
            </Card>
            <Card>
              <CardHeader title="Bills and subscriptions" description="Every month" />
              {bills.length === 0 ? <p className="text-body text-ink-muted">No regular bills found.</p> : (
                <div className="divide-y divide-line">
                  {(allBills ? bills : bills.slice(0, 3)).map((b) => <KeyValue key={b.name} label={<span className="text-body text-ink">{b.name}</span>} value={money(b.amount, ccy)} className="py-3" />)}
                </div>
              )}
              {bills.length > 3 && <TextLink className="mt-3" onClick={() => setAllBills((v) => !v)}>{allBills ? "Show less" : `Show all ${bills.length}`}</TextLink>}
            </Card>
          </div>
        </div>
        {data.budgets?.length > 0 && (
            <Card>
              <CardHeader title="Your budgets" description="This month" />
              <div className="space-y-5">
                {data.budgets.map((b: any) => (
                  <div key={b.category}>
                    <div className="mb-2 flex justify-between text-small"><span>{b.category}</span><span className="tabular">{money(b.used, b.currency, { whole: true })} of {money(b.limit, b.currency, { whole: true })}</span></div>
                    <Meter value={Number(b.used_pct)} tone={Number(b.used_pct) > 100 ? "danger" : Number(b.used_pct) > 80 ? "warning" : "primary"} label={`${b.category} budget used`} />
                  </div>
                ))}
              </div>
            </Card>
          )}
        <p className="text-caption text-ink-muted">Everything is converted to {ccy} at the sandbox rate on each day. Information only, not financial advice.</p>
      </div>

      <Sheet open={allCats} onClose={() => setAllCats(false)} title="All categories" subtitle="Last 30 days, compared with the 30 days before">
        <div className="divide-y divide-line px-6 py-2">
          {cats.map((c) => (
            <div key={c.category} className="flex items-center justify-between gap-4 py-3">
              <span className="text-body">{c.category}</span>
              <span className="text-right">
                <span className="block text-body-strong tabular">{money(c.last_30_days, ccy, { whole: true })}</span>
                <span className="block text-caption text-ink-muted tabular">was {money(c.previous_30_days, ccy, { whole: true })}</span>
              </span>
            </div>
          ))}
        </div>
      </Sheet>
    </div>
  );
}
