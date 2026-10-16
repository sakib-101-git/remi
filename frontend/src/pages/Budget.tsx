import { PiggyBank, Repeat, Target } from "lucide-react";
import { money, pct } from "../lib/format";
import { useApi } from "../lib/store";
import { BudgetCard } from "../components/cards/InsightCards";
import { Card, CardHeader, Empty, ErrorNote, Meter, Skeleton } from "../components/ui";

export default function Budget() {
  const { data, error, reload } = useApi<any>("/budget");
  if (error) return <ErrorNote message={error} onRetry={reload} />;
  if (!data) return <div className="space-y-4"><Skeleton className="h-10 w-64" /><Skeleton className="h-80" /></div>;
  const ccy = data.reporting_currency;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Budget & runway</h1>
        <p className="text-muted text-sm">{data.normalisation}. Period {data.period}.</p>
      </div>
      <BudgetCard data={data} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Categories" subtitle="Last 30 days vs previous 30" icon={<PiggyBank className="h-4 w-4" />} />
          <div className="space-y-2.5">
            {data.categories.map((c: any) => (
              <div key={c.category}>
                <div className="flex justify-between text-sm"><span>{c.category}</span><span className="num">{money(c.last_30_days, ccy)}</span></div>
                <div className="text-muted flex justify-between text-[11px]"><span>prev {money(c.previous_30_days, ccy)}</span><span className={c.change_pct && Number(c.change_pct) >= 15 ? "font-medium text-amber-600" : ""}>{c.change_pct === null ? "new" : `${Number(c.change_pct) > 0 ? "+" : ""}${pct(c.change_pct)}`}</span></div>
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <CardHeader title="Budgets" subtitle="Set by you or by Remi (T1)" icon={<Target className="h-4 w-4" />} />
          {data.budgets.length === 0 ? <Empty title="No budgets yet" body="Use a tip above, or ask Remi: “Set a budget of £120 for Eating out”." /> : (
            <div className="space-y-3">
              {data.budgets.map((b: any) => (
                <div key={b.category}>
                  <div className="flex justify-between text-sm"><span>{b.category}</span><span className="num">{money(b.used, b.currency)} / {money(b.limit, b.currency)}</span></div>
                  <Meter className="mt-1" value={Number(b.used_pct)} tone={Number(b.used_pct) > 100 ? "danger" : Number(b.used_pct) > 80 ? "warning" : "brand"} />
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card>
          <CardHeader title="Recurring bills & subscriptions" subtitle="Detected from repeated amounts" icon={<Repeat className="h-4 w-4" />} />
          {data.subscriptions.length === 0 ? <Empty title="None detected" /> : (
            <div className="space-y-2 text-sm">
              {data.subscriptions.map((s: any) => <div key={s.merchant} className="flex justify-between"><span>{s.merchant}</span><span className="num">{money(s.amount, s.currency)}/mo</span></div>)}
            </div>
          )}
        </Card>
      </div>
      <p className="text-muted text-xs">{data.disclaimer}</p>
    </div>
  );
}
