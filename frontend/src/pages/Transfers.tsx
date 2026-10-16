import { useEffect, useState } from "react";
import { ArrowDownLeft, ArrowRightLeft, ArrowUpRight, Bot, Building2, Calculator, Clock, Users } from "lucide-react";
import { api } from "../lib/api";
import { cx, date, money } from "../lib/format";
import { useApi, useStore } from "../lib/store";
import { QuotesCard } from "../components/cards/QuotesCard";
import { Badge, Button, Card, CardHeader, Empty, ErrorNote, Skeleton, StatusPill } from "../components/ui";

export default function Transfers() {
  const { askRemi } = useStore();
  const bens = useApi<any[]>("/beneficiaries");
  const txns = useApi<any[]>("/transactions?limit=60");
  const providers = useApi<any[]>("/providers");
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<"send" | "receive">("receive");
  const [goal, setGoal] = useState("cheapest");
  const [result, setResult] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (bens.data && !recipient) {
      const uni = bens.data.find((b) => b.kind === "university") ?? bens.data[0];
      if (uni) setRecipient(uni.id);
    }
  }, [bens.data, recipient]);

  const selected = bens.data?.find((b) => b.id === recipient);
  const compare = async () => {
    setBusy(true);
    setErr(null);
    try {
      setResult(await api.post("/quotes", { recipient, amount, amount_mode: mode, goal }));
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  const pay = () => {
    if (!selected) return;
    const who = selected.kind === "university" ? "my university" : selected.nickname ? `my ${selected.nickname}` : selected.name;
    const ccy = mode === "receive" ? selected.currency : result?.recommended?.send_currency ?? selected.currency;
    askRemi(`Send ${amount} ${ccy} to ${who}${goal !== "cheapest" ? `, ${goal}` : ""}`);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Transfers</h1>
        <p className="text-muted text-sm">Compare every provider on true landed cost, then let Remi prepare the payment for your approval.</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader title="Compare providers" subtitle="Forward or reverse quote" icon={<Calculator className="h-4 w-4" />} />
          <div className="space-y-3">
            <label className="block text-xs font-medium">Recipient
              <select data-testid="t-recipient" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="focus-ring panel-2 mt-1 h-10 w-full rounded-xl border border-soft px-3 text-sm">
                {bens.data?.map((b) => <option key={b.id} value={b.id}>{b.name} · {b.currency}{b.kind === "university" ? " · verified" : ""}{!b.active ? " · cooling-off" : ""}</option>)}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2">
              {(["receive", "send"] as const).map((m) => (
                <button key={m} onClick={() => setMode(m)} className={cx("rounded-xl border px-3 py-2 text-xs font-medium", mode === m ? "border-brand-500 bg-brand-500/10 text-brand-700 dark:text-brand-300" : "border-soft")}>{m === "receive" ? "They must receive exactly" : "I want to send"}</button>
              ))}
            </div>
            <label className="block text-xs font-medium">Amount {mode === "receive" && selected ? `(${selected.currency})` : ""}
              <input data-testid="t-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} placeholder={selected?.kind === "university" ? "9250" : "15000"} className="focus-ring panel-2 num mt-1 h-10 w-full rounded-xl border border-soft px-3 text-sm" />
            </label>
            <label className="block text-xs font-medium">Optimise for
              <select value={goal} onChange={(e) => setGoal(e.target.value)} className="focus-ring panel-2 mt-1 h-10 w-full rounded-xl border border-soft px-3 text-sm">
                <option value="cheapest">Cheapest (lowest landed cost)</option>
                <option value="fastest">Fastest (earliest arrival)</option>
                <option value="balanced">Balanced (70% cost · 30% speed)</option>
              </select>
            </label>
            <div className="flex gap-2 pt-1">
              <Button data-testid="t-compare" onClick={compare} loading={busy} disabled={!amount || !recipient} className="flex-1">Compare</Button>
              <Button variant="outline" onClick={pay} disabled={!result?.recommended}><Bot className="h-4 w-4" /> Ask Remi to pay</Button>
            </div>
            {err && <ErrorNote message={err} />}
          </div>
        </Card>
        <div className="lg:col-span-3">
          {result ? <QuotesCard data={result} /> : (
            <Card><Empty icon={<ArrowRightLeft className="h-5 w-5" />} title="Run a comparison" body="Remi checks corridor support, limits, tuition eligibility and the deadline with a 2-day safety buffer, then ranks by your goal." /></Card>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader title="Saved recipients" subtitle="New payees need step-up + cooling-off" icon={<Users className="h-4 w-4" />} />
          {!bens.data ? <Skeleton className="h-32" /> : (
            <div className="space-y-2">
              {bens.data.map((b) => (
                <div key={b.id} className="panel-2 flex items-center gap-3 rounded-xl px-3 py-2.5">
                  <div className="grid h-8 w-8 place-items-center rounded-lg bg-brand-500/10 text-brand-600">{b.kind === "university" ? <Building2 className="h-4 w-4" /> : <Users className="h-4 w-4" />}</div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{b.name}</div>
                    <div className="text-muted text-[11px]">{b.bank_name} · <span className="font-mono">{b.account}</span> · {b.currency}</div>
                  </div>
                  {b.registry_verified ? <Badge tone="success">registry ✓</Badge> : !b.active ? <Badge tone="violet"><Clock className="h-3 w-3" /> cooling-off</Badge> : <Badge tone="neutral">{b.kind}</Badge>}
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card className="lg:col-span-3">
          <CardHeader title="Providers (fictional)" subtitle="Each has different trade-offs" icon={<Building2 className="h-4 w-4" />} />
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-muted"><tr><th className="py-1.5 font-medium">Provider</th><th className="font-medium">FX markup</th><th className="font-medium">Fee</th><th className="font-medium">Days</th><th className="font-medium">Max / transfer</th><th className="font-medium">Tuition</th></tr></thead>
              <tbody className="divide-y divide-[var(--border)]">
                {providers.data?.map((p) => (
                  <tr key={p.id}><td className="py-2 font-medium">{p.name}<div className="text-muted font-normal">{p.blurb}</div></td><td className="num">{Number(p.markup_pct).toFixed(2)}%</td><td className="num">${p.fee_fixed_usd}{Number(p.fee_pct) > 0 ? ` + ${Number(p.fee_pct).toFixed(1)}%` : ""}</td><td className="num">{p.days === "0-0" ? "same day" : p.days}</td><td className="num">${Number(p.max_amount_usd).toLocaleString()}</td><td>{p.tuition ? "✓" : "—"}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader title="All transactions" subtitle="Double-entry sandbox ledger" icon={<ArrowRightLeft className="h-4 w-4" />} />
        {txns.error && <ErrorNote message={txns.error} onRetry={txns.reload} />}
        {!txns.data ? <Skeleton className="h-48" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-muted text-xs"><tr><th className="py-2 font-medium">Date</th><th className="font-medium">Description</th><th className="font-medium">Category</th><th className="font-medium">Status</th><th className="text-right font-medium">Amount</th></tr></thead>
              <tbody className="divide-y divide-[var(--border)]">
                {txns.data.map((t) => {
                  const incoming = t.kind === "income" || t.kind === "transfer_in";
                  return (
                    <tr key={t.id}>
                      <td className="text-muted num whitespace-nowrap py-2 text-xs">{date(t.occurred_at)}</td>
                      <td className="max-w-[280px] truncate"><span className="mr-1.5 inline-block align-middle">{incoming ? <ArrowDownLeft className="h-3.5 w-3.5 text-emerald-500" /> : <ArrowUpRight className="text-muted h-3.5 w-3.5" />}</span>{t.description}{t.reference && !t.reference.includes("SEED") && <span className="text-muted ml-1 font-mono text-[10px]">{t.reference}</span>}</td>
                      <td className="text-muted text-xs">{t.category ?? "—"}</td>
                      <td><StatusPill status={t.status} /></td>
                      <td className={cx("num whitespace-nowrap text-right", incoming && "text-emerald-600 dark:text-emerald-400")}>{incoming ? "+" : "−"}{money(t.amount, t.currency)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
