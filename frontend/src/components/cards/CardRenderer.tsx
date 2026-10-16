import { ActionCard } from "./ActionCard";
import { QuotesCard } from "./QuotesCard";
import {
  AlertCard, BudgetCard, ChecklistCard, CreditPlanCard, DocumentOkCard, DraftCard, FeeBreakdownCard, FraudCard, FxOptionsCard,
  FxRatesCard, ObligationsCard, RefusalCard, RunwayGauge, SavedCard, SourcesCard, TransactionsCard, WalletsCard, Panel,
} from "./InsightCards";

export type CardT = { type: string; data: any };

/** Order cards so the decision (quotes) comes before the approval (action) and sources come last. */
const ORDER = ["refusal", "fraud", "document_ok", "wallets", "budget", "runway", "obligations", "quotes", "fee_breakdown", "action", "credit_plan", "alert", "fx_options", "fx_rates", "checklist", "draft", "saved", "transactions", "sources"];

export function CardList({ cards }: { cards: CardT[] }) {
  const visible = cards.filter((c) => !(c.type === "obligations" && cards.some((x) => x.type === "action")));
  const sorted = [...visible].sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type));
  return (
    <div className="space-y-3">
      {sorted.map((c, i) => (
        <CardView key={`${c.type}-${c.data?.id ?? i}`} card={c} />
      ))}
    </div>
  );
}

export function CardView({ card }: { card: CardT }) {
  const d = card.data;
  switch (card.type) {
    case "action": return <ActionCard initial={d} />;
    case "quotes": return <QuotesCard data={d} />;
    case "budget": return <BudgetCard data={d} />;
    case "runway": return <Panel><RunwayGauge runway={d} /></Panel>;
    case "credit_plan": return <CreditPlanCard data={d} />;
    case "fraud": return <FraudCard data={d} />;
    case "document_ok": return <DocumentOkCard data={d} />;
    case "alert": return <AlertCard data={d} />;
    case "sources": return <SourcesCard data={d} />;
    case "checklist": return <ChecklistCard data={d} />;
    case "wallets": return <WalletsCard data={d} />;
    case "refusal": return <RefusalCard data={d} />;
    case "saved": return <SavedCard data={d} />;
    case "fx_options": return <FxOptionsCard data={d} />;
    case "fx_rates": return <FxRatesCard data={d} />;
    case "transactions": return <TransactionsCard data={d} />;
    case "obligations": return <ObligationsCard data={d} />;
    case "draft": return <DraftCard data={d} />;
    case "fee_breakdown": return <FeeBreakdownCard data={d} />;
    default: return null;
  }
}
