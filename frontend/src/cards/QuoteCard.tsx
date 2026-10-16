import { Clock } from "lucide-react";
import { daysBetween, money, shortDate } from "../lib/format";
import { costSentence } from "../lib/copy";
import { Badge, Card, Disclosure, KeyValue } from "../ui";

export type Quote = {
  provider_id: string; provider_name: string; send_currency: string; receive_currency: string; send_amount: string; receive_amount: string;
  fee: string; fx_markup_cost: string; landed_cost: string; effective_cost_pct: string; arrival_latest: string; rate_display: string; mid_display: string;
  feasible: boolean; reasons: string[]; requires_documents: boolean;
};

/** Backend reasons are precise but long; this turns them into a short plain phrase. */
export function whyNot(text: string): string {
  return text
    .split(/;\s*/)
    .map((part) => {
      const limit = part.match(/per-transfer limit of (\$[\d,]+)/);
      if (limit) return `Over its ${limit[1]} limit per transfer`;
      if (/never splits/i.test(part)) return null;
      if (/approved channel for tuition/i.test(part)) return "Can't be used for tuition";
      const costs = part.match(/Costs ([\d,.]+) ([A-Z]{3}) more/);
      if (costs) return `Costs ${money(costs[1].replace(/,/g, ""), costs[2], { whole: true })} more`;
      if (/deadline/i.test(part)) return "Arrives too late for your deadline";
      if (/corridor|not support/i.test(part)) return "Doesn't send to this country";
      return part.replace(/\(sandbox\)/g, "").trim();
    })
    .filter(Boolean)
    .join(" · ");
}

export function arrivalSentence(arrival: string, deadline?: string | null): string {
  const base = `Arrives by ${shortDate(arrival)}`;
  const spare = daysBetween(arrival, deadline ?? null);
  if (spare === null) return base;
  return spare >= 0 ? `${base} · ${spare} ${spare === 1 ? "day" : "days"} before your deadline` : `${base} · after your deadline`;
}

/** The best option, with "compare others" and "fee breakdown" tucked away. Used on the Send page and in chat. */
export function QuoteCard({ data, flat = false }: { data: any; flat?: boolean }) {
  const best: Quote | null = data.recommended;
  const others: Quote[] = [...(data.options ?? []), ...(data.rejected ?? [])].filter((q: Quote) => q.provider_id !== best?.provider_id);
  const deadline: string | null = data.explanation?.inputs?.deadline ?? null;
  const why = new Map<string, string>((data.explanation?.alternatives ?? []).map((a: any) => [a.provider, a.why_not]));
  const body = (
    <div data-testid="quotes-card">
      {best ? (
        <>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-small text-ink-muted">Best option</div>
              <div className="text-h2">{best.provider_name.replace(" (sandbox)", "")}</div>
            </div>
            <Badge tone="accent">Recommended</Badge>
          </div>
          <p className="mt-3 text-body">{costSentence(best.landed_cost, best.send_currency)}.</p>
          <p className="mt-1 flex items-center gap-2 text-small text-ink-muted"><Clock className="h-4 w-4" /> {arrivalSentence(best.arrival_latest, deadline)}</p>
        </>
      ) : (
        <p className="text-body">No provider can send this amount on time. Try a smaller amount or a later date.</p>
      )}
      <div className="mt-4">
        {others.length > 0 && (
          <Disclosure summary={`Compare ${others.length} other ${others.length === 1 ? "option" : "options"}`} testId="quotes-compare">
            <div className="divide-y divide-line">
              {others.map((q) => (
                <div key={q.provider_id} className="flex items-start justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <div className="text-body-strong">{q.provider_name.replace(" (sandbox)", "")}</div>
                    <div className="text-small text-ink-muted">{q.feasible ? whyNot(why.get(q.provider_name) ?? "") || `Arrives by ${shortDate(q.arrival_latest)}` : `Not eligible · ${whyNot(q.reasons.join("; "))}`}</div>
                  </div>
                  <div className="shrink-0 text-right text-small tabular text-ink-muted">{money(q.landed_cost, q.send_currency, { whole: true })} total cost</div>
                </div>
              ))}
            </div>
          </Disclosure>
        )}
        {best && (
          <Disclosure summary="Fee breakdown" testId="quotes-fees">
            <KeyValue label="You send" value={money(best.send_amount, best.send_currency)} />
            <KeyValue label="Fee" value={money(best.fee, best.send_currency)} />
            {best.send_currency !== best.receive_currency && (
              <>
                <KeyValue label="Our rate" value={best.rate_display} />
                <KeyValue label="Mid-market rate" value={best.mid_display} />
                <KeyValue label="Exchange-rate markup" value={money(best.fx_markup_cost, best.send_currency)} />
              </>
            )}
            <KeyValue label="Total cost" value={`${money(best.landed_cost, best.send_currency)} (${best.effective_cost_pct}%)`} strong />
            {best.requires_documents && <p className="mt-2 text-caption text-ink-muted">This provider asks for tuition documents. Remi adds the purpose of payment for you.</p>}
          </Disclosure>
        )}
      </div>
    </div>
  );
  return flat ? body : <Card>{body}</Card>;
}
