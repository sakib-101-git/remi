import { useState } from "react";
import { Award, Ban, Clock, Info, Scale } from "lucide-react";
import { cx, date, money } from "../../lib/format";
import { Badge } from "../ui";

type Quote = {
  provider_id: string; provider_name: string; send_currency: string; receive_currency: string; send_amount: string; receive_amount: string;
  fee: string; fx_markup_cost: string; landed_cost: string; effective_cost_pct: string; arrival_latest: string; rate_display: string; mid_display: string;
  feasible: boolean; reasons: string[]; requires_documents: boolean;
};

export function QuotesCard({ data }: { data: any }) {
  const [open, setOpen] = useState(false);
  const rows: Quote[] = [...(data.options ?? []), ...(data.rejected ?? [])];
  if (!rows.length) return null;
  const best = data.recommended as Quote | null;
  const max = Math.max(...rows.map((r) => Number(r.landed_cost)));
  const ccy = rows[0].send_currency;
  const exp = data.explanation ?? {};
  const lowestFee = rows.reduce((a, b) => (Number(b.fee) < Number(a.fee) ? b : a));
  return (
    <div data-testid="quotes-card" className="panel overflow-hidden rounded-2xl">
      <div className="flex items-center justify-between border-b border-soft px-4 py-3">
        <div className="flex items-center gap-2">
          <Scale className="h-4 w-4 text-brand-500" />
          <span className="font-display text-sm font-semibold">{rows.length} providers compared</span>
          <Badge tone="neutral">{data.mode === "reverse" ? "reverse quote · exact amount arrives" : "forward quote"}</Badge>
        </div>
        {rows[0].send_currency !== rows[0].receive_currency && <span className="text-muted hidden text-xs sm:block">mid-market {best?.mid_display ?? rows[0].mid_display}</span>}
      </div>
      <div className="divide-y divide-[var(--border)]">
        {rows.map((q) => {
          const isBest = best?.provider_id === q.provider_id;
          const fee = Number(q.fee), mk = Number(q.fx_markup_cost);
          return (
            <div key={q.provider_id} className={cx("px-4 py-3", !q.feasible && "opacity-60", isBest && "bg-brand-500/5")}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{q.provider_name}</span>
                    {isBest && <Badge tone="brand"><Award className="h-3 w-3" /> Recommended</Badge>}
                    {!q.feasible && <Badge tone="danger"><Ban className="h-3 w-3" /> Not eligible</Badge>}
                    {q.provider_id === lowestFee.provider_id && !isBest && best && Number(q.landed_cost) > Number(best.landed_cost) && <Badge tone="warning">lowest fee ≠ cheapest</Badge>}
                  </div>
                  <div className="text-muted mt-0.5 flex flex-wrap items-center gap-x-3 text-xs">
                    <span>send <b className="num text-[var(--text)]">{money(q.send_amount, q.send_currency)}</b></span>
                    {q.send_currency !== q.receive_currency && <span>{q.rate_display}</span>}
                    <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" /> by {date(q.arrival_latest)}</span>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="num text-sm font-semibold">{money(q.landed_cost, ccy)}</div>
                  <div className="text-muted text-[11px]">true cost · {q.effective_cost_pct}%</div>
                </div>
              </div>
              <div className="mt-2 flex h-1.5 w-full overflow-hidden rounded-full bg-black/5 dark:bg-white/10" title={`Fee ${money(fee, ccy)} + hidden FX markup ${money(mk, ccy)}`}>
                <div className="bg-sky-500" style={{ width: `${(fee / max) * 100}%` }} />
                <div className="bg-amber-500" style={{ width: `${(mk / max) * 100}%` }} />
              </div>
              {!q.feasible && <p className="mt-1.5 text-[11px] text-rose-600 dark:text-rose-300">{q.reasons.join(" · ")}</p>}
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-soft px-4 py-2.5 text-[11px]">
        <div className="text-muted flex items-center gap-3">
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-sky-500" /> upfront fee</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" /> hidden FX markup</span>
        </div>
        <button className="inline-flex items-center gap-1 font-medium text-brand-600 dark:text-brand-300" onClick={() => setOpen((v) => !v)}><Info className="h-3.5 w-3.5" /> {open ? "Hide" : "How Remi decided"}</button>
      </div>
      {open && (
        <div className="space-y-2 border-t border-soft bg-[var(--panel-2)] px-4 py-3 text-xs">
          <p><b>Formula:</b> <span className="font-mono">{exp.formula}</span></p>
          {exp.alternatives?.length > 0 && (
            <div><b>Why not the others:</b><ul className="text-muted ml-4 list-disc">{exp.alternatives.map((a: any) => <li key={a.provider}>{a.provider}: {a.why_not}</li>)}</ul></div>
          )}
          <div><b>Assumptions:</b><ul className="text-muted ml-4 list-disc">{exp.assumptions?.map((a: string) => <li key={a}>{a}</li>)}</ul></div>
          <p className="text-muted">Data: {exp.rates_label} at {date(exp.data_timestamp, true)} · {exp.disclaimer}</p>
        </div>
      )}
    </div>
  );
}
