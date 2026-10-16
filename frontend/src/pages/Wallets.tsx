import { useMemo, useState } from "react";
import { ArrowLeftRight, Plus, Search } from "lucide-react";
import { TxnRow } from "../app/TxnRow";
import { api } from "../lib/api";
import { CURRENCY_NAME, cx, money } from "../lib/format";
import { useApi, useStore } from "../lib/store";
import { AmountInput, Button, Card, EmptyState, ErrorState, Field, Flag, Input, KeyValue, PageHeader, Select, Sheet, Skeleton, SkeletonRows } from "../ui";

const MARKUP_PCT = 0.35; // config/fx_rates.yaml conversion markup, shown so the cost is never a surprise.

export default function Wallets() {
  const { param, navigate, pushToast, bump } = useStore();
  const { data, error, reload } = useApi<any>("/wallets");
  const [query, setQuery] = useState("");
  const [month, setMonth] = useState("all");
  const [convertOpen, setConvertOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const selected = param ?? data?.wallets?.[0]?.currency ?? null;
  const txns = useApi<any[]>(selected ? `/transactions?limit=200&currency=${selected}` : null, [selected]);
  const wallet = data?.wallets?.find((w: any) => w.currency === selected);

  const months = useMemo(() => {
    const set = new Map<string, string>();
    for (const t of txns.data ?? []) {
      const d = new Date(t.occurred_at);
      set.set(`${d.getFullYear()}-${d.getMonth()}`, d.toLocaleDateString("en-GB", { month: "long", year: "numeric" }));
    }
    return [...set.entries()];
  }, [txns.data]);
  const rows = (txns.data ?? []).filter((t) => {
    const d = new Date(t.occurred_at);
    return (month === "all" || `${d.getFullYear()}-${d.getMonth()}` === month) && (!query || `${t.description} ${t.category ?? ""}`.toLowerCase().includes(query.toLowerCase()));
  });

  if (error) return <ErrorState message={error} onRetry={reload} />;
  const addMoney = async () => {
    setAdding(true);
    try {
      const r = await api.post<any>("/sandbox/inject-remittance", { currency: selected });
      pushToast({ kind: "incoming", title: "Money added", body: `${money(r.amount, r.currency)} arrived (sandbox)` });
      bump();
    } catch (e: any) {
      pushToast({ kind: "blocked", title: "Couldn't add money", body: e.message });
    } finally {
      setAdding(false);
    }
  };

  return (
    <div>
      <PageHeader title="Wallets" description="Your money in each currency." />
      {!data ? <Skeleton className="h-40" /> : (
        <div className="grid gap-4 sm:grid-cols-3">
          {data.wallets.map((w: any) => {
            const active = w.currency === selected;
            return (
              <button
                key={w.currency}
                data-testid={`wallet-${w.currency}`}
                aria-pressed={active}
                onClick={() => navigate("wallets", w.currency)}
                className={cx("rounded-card border p-6 text-left transition-colors", active ? "border-primary bg-primary-soft" : "border-line bg-surface hover:border-ink-muted")}
              >
                <div className="flex items-center gap-3"><Flag currency={w.currency} size={36} /><span className="text-body-strong">{w.currency}</span></div>
                <div className="mt-5 text-h2 tabular">{money(w.balance, w.currency, { whole: true })}</div>
                <div className="text-small text-ink-muted tabular">{w.currency === data.reporting_currency ? CURRENCY_NAME[w.currency] : `≈ ${money(w.in_reporting_currency, data.reporting_currency, { whole: true })}`}</div>
              </button>
            );
          })}
        </div>
      )}

      {wallet && (
        <section className="mt-12">
          <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <Flag currency={wallet.currency} size={48} />
              <div>
                <h2 className="text-h2">{CURRENCY_NAME[wallet.currency] ?? wallet.currency}</h2>
                <div className="text-small text-ink-muted tabular">{money(wallet.balance, wallet.currency)}</div>
              </div>
            </div>
            <div className="flex gap-3">
              <Button variant="secondary" size="sm" icon={<ArrowLeftRight className="h-4 w-4" />} onClick={() => setConvertOpen(true)} data-testid="wallet-convert">Convert</Button>
              <Button variant="secondary" size="sm" icon={<Plus className="h-4 w-4" />} loading={adding} onClick={addMoney}>Add money (sandbox)</Button>
            </div>
          </div>
          <Card className="py-4">
            <div className="flex flex-col gap-3 pb-2 sm:flex-row">
              <Input leading={<Search className="h-5 w-5" />} placeholder="Search transactions" value={query} onChange={(e) => setQuery(e.target.value)} className="flex-1" aria-label="Search transactions" />
              <Select value={month} onChange={(e) => setMonth(e.target.value)} className="sm:w-56" aria-label="Filter by month">
                <option value="all">All months</option>
                {months.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </Select>
            </div>
            {!txns.data ? <div className="py-4"><SkeletonRows rows={6} /></div> : rows.length === 0 ? (
              <EmptyState className="mt-3" title={query || month !== "all" ? "No transactions match." : "No transactions in this wallet yet."} />
            ) : (
              <div className="divide-y divide-line">{rows.map((t) => <TxnRow key={t.id} t={t} />)}</div>
            )}
          </Card>
        </section>
      )}
      {wallet && data && <ConvertSheet key={wallet.currency} open={convertOpen} onClose={() => setConvertOpen(false)} from={wallet.currency} currencies={data.wallets.map((w: any) => w.currency)} />}
    </div>
  );
}

function ConvertSheet({ open, onClose, from, currencies }: { open: boolean; onClose: () => void; from: string; currencies: string[] }) {
  const { askRemi } = useStore();
  const rates = useApi<any>(open ? "/fx/rates" : null);
  const others = currencies.filter((c) => c !== from);
  const [to, setTo] = useState(others[0] ?? "");
  const [amount, setAmount] = useState("");
  const usd = rates.data?.usd_rates ?? {};
  const mid = usd[to] && usd[from] ? Number(usd[to]) / Number(usd[from]) : null;
  const getAmount = mid && Number(amount) > 0 ? Number(amount) * mid * (1 - MARKUP_PCT / 100) : null;
  const rateText = mid ? (mid >= 1 ? `1 ${from} = ${mid.toLocaleString("en-GB", { maximumFractionDigits: 4 })} ${to}` : `1 ${to} = ${(1 / mid).toLocaleString("en-GB", { maximumFractionDigits: 4 })} ${from}`) : "–";
  return (
    <Sheet open={open} onClose={onClose} title={`Convert ${from}`} subtitle="Remi prepares it, you approve it">
      <div className="space-y-4 p-6">
        <AmountInput label="You convert" value={amount} onChange={setAmount} currency={from} />
        <Field label="Into">
          <Select value={to} onChange={(e) => setTo(e.target.value)}>{others.map((c) => <option key={c} value={c}>{c}</option>)}</Select>
        </Field>
        <Card tone="muted" className="p-4">
          <KeyValue label="Mid-market rate" value={rateText} />
          <KeyValue label="Remi's markup" value={`${MARKUP_PCT}%`} />
          <KeyValue label="You get about" value={getAmount ? money(getAmount, to) : "–"} strong />
        </Card>
        <Button block disabled={!(Number(amount) > 0) || !to} onClick={() => { onClose(); askRemi(`Convert ${Number(amount).toLocaleString("en-GB")} ${from} to ${to}`); }}>Continue</Button>
      </div>
    </Sheet>
  );
}
