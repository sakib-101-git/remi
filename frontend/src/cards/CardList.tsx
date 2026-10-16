import type { ChatCard } from "../lib/chat";
import { ActionCard } from "./ActionCard";
import {
  AlertCard, ChecklistCard, CreditNextCard, DocumentOkCard, DraftCard, FeeCard, FraudCard, FxOptionsCard, FxRatesCard, InsightCard,
  ObligationsCard, RefusalCard, SavedCard, SourceChips, TransactionsMiniCard, WalletsMiniCard,
} from "./InfoCards";
import { QuoteCard } from "./QuoteCard";

// Most important first. A reply shows one main card (plus the quote when a payment is proposed, and source chips).
const PRIORITY = ["fraud", "refusal", "action", "quotes", "document_ok", "budget", "runway", "credit_plan", "alert", "fx_options", "checklist", "draft", "fee_breakdown", "obligations", "wallets", "fx_rates", "transactions", "saved"];

export function CardList({ cards }: { cards: ChatCard[] }) {
  const main = cards.filter((c) => c.type !== "sources").sort((a, b) => PRIORITY.indexOf(a.type) - PRIORITY.indexOf(b.type));
  const actions = main.filter((c) => c.type === "action");
  let shown: ChatCard[];
  if (actions.length) {
    const quote = main.find((c) => c.type === "quotes");
    shown = [...(quote ? [quote] : []), ...actions];
  } else {
    shown = main.slice(0, 1);
  }
  const sources = cards.find((c) => c.type === "sources");
  return (
    <div className="space-y-3">
      {shown.map((c, i) => <CardView key={`${c.type}-${c.data?.id ?? i}`} card={c} />)}
      {sources && <SourceChips data={sources.data} />}
    </div>
  );
}

export function CardView({ card }: { card: ChatCard }) {
  const d = card.data;
  switch (card.type) {
    case "action": return <ActionCard initial={d} />;
    case "quotes": return <QuoteCard data={d} />;
    case "budget": return <InsightCard data={d} />;
    case "runway": return <InsightCard data={{ runway: d }} />;
    case "credit_plan": return <CreditNextCard data={d} />;
    case "fraud": return <FraudCard data={d} />;
    case "document_ok": return <DocumentOkCard data={d} />;
    case "alert": return <AlertCard data={d} />;
    case "checklist": return <ChecklistCard data={d} />;
    case "wallets": return <WalletsMiniCard data={d} />;
    case "refusal": return <RefusalCard data={d} />;
    case "saved": return <SavedCard data={d} />;
    case "fx_options": return <FxOptionsCard data={d} />;
    case "fx_rates": return <FxRatesCard data={d} />;
    case "transactions": return <TransactionsMiniCard data={d} />;
    case "obligations": return <ObligationsCard data={d} />;
    case "draft": return <DraftCard data={d} />;
    case "fee_breakdown": return <FeeCard data={d} />;
    default: return null;
  }
}
