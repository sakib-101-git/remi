import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, ShoppingBag } from "lucide-react";
import { TRANSFER_STATUS } from "../lib/copy";
import { dateTime, money } from "../lib/format";
import { ListRow, RowIcon, StatusDot } from "../ui";

/** One transaction, used on Home and Wallets. */
export function TxnRow({ t }: { t: any }) {
  const incoming = t.kind === "income" || t.kind === "transfer_in";
  const icon = incoming ? <ArrowDownLeft className="h-5 w-5" /> : t.kind === "fx_conversion" ? <ArrowLeftRight className="h-5 w-5" /> : t.kind === "transfer_out" ? <ArrowUpRight className="h-5 w-5" /> : <ShoppingBag className="h-5 w-5" />;
  const status = t.kind === "transfer_out" && t.status !== "settled" ? TRANSFER_STATUS[t.status] : null;
  return (
    <ListRow
      data-testid="txn-row"
      leading={<RowIcon tone={incoming ? "success" : "muted"}>{icon}</RowIcon>}
      title={t.description}
      subtitle={status ? <StatusDot tone={status.tone}>{status.label}</StatusDot> : `${dateTime(t.occurred_at)}${t.category ? ` · ${t.category}` : ""}`}
      trailing={<span className={incoming ? "text-success" : undefined}>{incoming ? "+" : "−"}{money(t.amount, t.currency)}</span>}
      trailingSub={t.counter_amount ? `→ ${money(t.counter_amount, t.counter_currency)}` : undefined}
    />
  );
}
