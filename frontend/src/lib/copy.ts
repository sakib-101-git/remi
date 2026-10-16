// Plain-language copy: everything technical is translated here before it reaches the UI.
import type { Tone } from "../ui";
import { money, moneyText } from "./format";

export const ACTION_STATUS: Record<string, { label: string; tone: Tone }> = {
  awaiting_confirmation: { label: "Needs your approval", tone: "warning" },
  awaiting_step_up: { label: "Enter your code", tone: "warning" },
  scheduled: { label: "Waiting period", tone: "warning" },
  executed: { label: "Done", tone: "success" },
  blocked: { label: "Blocked", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  expired: { label: "Expired", tone: "neutral" },
  failed: { label: "Failed", tone: "danger" },
  rejected: { label: "Not approved", tone: "danger" },
};

export const TRANSFER_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: "Sent", tone: "warning" },
  processing: { label: "On its way", tone: "warning" },
  settled: { label: "Arrived", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  reversed: { label: "Returned", tone: "neutral" },
};

/** What Remi is doing while a tool runs ("Comparing 4 providers…"). */
export const TOOL_PROGRESS: Record<string, string> = {
  get_wallets: "Checking your balances",
  get_transactions: "Reading your transactions",
  get_fx_rates: "Checking exchange rates",
  get_remittance_quotes: "Comparing 4 providers",
  reverse_quote: "Working out the exact amount",
  explain_fee_breakdown: "Breaking down the fees",
  get_budget_summary: "Looking at your spending",
  get_runway: "Working out how long your money lasts",
  get_credit_plan: "Building your credit plan",
  create_credit_plan: "Saving your credit plan",
  update_credit_task: "Updating your credit plan",
  get_obligations: "Checking what's due",
  get_compliance_checklist: "Listing the documents you need",
  search_knowledge: "Searching the help articles",
  analyze_document: "Checking the document for fraud",
  create_budget: "Setting your budget",
  categorize_transaction: "Updating a category",
  set_rate_alert: "Setting your rate alert",
  create_reminder: "Adding a reminder",
  draft_payment: "Drafting the payment",
  fx_conversion_options: "Comparing ways to convert",
  propose_fx_conversion: "Preparing the conversion",
  propose_payment: "Preparing the payment for your approval",
  propose_add_beneficiary: "Preparing the new recipient",
  list_beneficiaries: "Checking your recipients",
};

export const PERMISSION_LADDER = [
  { tier: "T0", title: "Looks up information", detail: "Balances, quotes, rates, help articles.", control: "Automatic", tone: "neutral" as Tone },
  { tier: "T1", title: "Makes reversible changes", detail: "Budgets, rate alerts, reminders, drafts.", control: "Automatic · you can undo", tone: "neutral" as Tone },
  { tier: "T2", title: "Moves money", detail: "Payments to saved recipients and conversions between your wallets.", control: "Always needs your approval", tone: "warning" as Tone },
  { tier: "T3", title: "High-risk payments", detail: "A new recipient, a large amount or an unusual pattern.", control: "Approval + a one-time code + waiting period", tone: "danger" as Tone },
  { tier: "T4", title: "Changes your limits or this log", detail: "Limits, permissions and the activity log.", control: "Remi can never do this", tone: "primary" as Tone },
];

export type AuditEntry = { seq: number; ts: string; actor: string; action: string; tool: string | null; tier: string | null; decision: string | null; inputs: any; result: any; hash: string; prev_hash: string };

/** Turns one audit entry into a sentence a student understands. Returns null for entries hidden from the readable log. */
export function auditSentence(e: AuditEntry): { text: string; kind: "money" | "remi" | "you" | "safety" | "system" } | null {
  const r = e.result ?? {};
  const i = e.inputs ?? {};
  const who = e.actor === "agent" ? "Remi" : e.actor === "user" ? "You" : "The system";
  switch (e.action) {
    case "action.proposed": {
      const what = describePayload(i.kind, i.payload);
      const by = e.actor === "agent" ? "Remi" : "You";
      if (e.decision === "blocked") return { text: `${by} tried to prepare ${what} · blocked by the safety rules`, kind: "safety" };
      return { text: `${by} prepared ${what} · waiting for your approval`, kind: "money" };
    }
    case "action.confirmed": return { text: "You approved it", kind: "money" };
    case "action.executed": return { text: `Done: ${describePayload(i.payload?.kind ?? (i.payload?.beneficiary_name ? "payment" : i.payload?.to_currency ? "fx_conversion" : "add_beneficiary"), i.payload)}${r.receipt?.reference ? ` · ${r.receipt.reference}` : ""}`, kind: "money" };
    case "action.scheduled": return { text: "Payment scheduled until the waiting period ends", kind: "money" };
    case "action.cancelled": return { text: "You cancelled an action · nothing moved", kind: "money" };
    case "action.failed": return { text: "An action failed · nothing moved", kind: "money" };
    case "action.blocked_at_confirm": return { text: "Blocked at approval: the rules no longer allowed it", kind: "safety" };
    case "action.confirm_rejected": return { text: "An approval was rejected (wrong, used or expired link)", kind: "safety" };
    case "action.token_reissued": return { text: "You asked for a fresh approval link", kind: "you" };
    case "stepup.challenge_sent": return { text: "A one-time code was sent to your phone", kind: "safety" };
    case "stepup.passed": return { text: "You entered the correct code", kind: "safety" };
    case "stepup.failed": return { text: "A wrong code was entered", kind: "safety" };
    case "document.reviewed": return { text: e.decision === "flagged" ? "A document was flagged as possible fraud" : "A document was checked and looks genuine", kind: "safety" };
    case "guardrail.refused": return { text: "Remi refused a request it isn't allowed to help with", kind: "safety" };
    case "guardrail.redirected": return { text: "Remi steered an off-topic question back to money", kind: "remi" };
    case "tool.called": return { text: `${who} ${toolPhrase(e.tool)}`, kind: "remi" };
    case "tool.rejected": return { text: `Remi tried a tool it isn't allowed to use here · stopped`, kind: "safety" };
    case "tool.invalid_args": return { text: "Remi sent incomplete details · stopped and asked again", kind: "safety" };
    case "tool.error": return { text: "A tool returned an error", kind: "remi" };
    case "agent.tool_cap": return { text: "Remi hit its limit of 8 steps for one request · stopped", kind: "safety" };
    case "chat.message": return { text: "You asked Remi something", kind: "you" };
    case "chat.reply": return { text: "Remi replied", kind: "remi" };
    case "alert.triggered": return { text: `Rate alert hit ${i.pair ?? r.pair ?? ""}`.trim(), kind: "remi" };
    case "alert.cancelled": return { text: "You cancelled a rate alert", kind: "you" };
    case "budget.saved": return { text: `Budget set for ${i.category ?? "a category"}`, kind: "you" };
    case "credit.plan_created": return { text: "Credit plan started", kind: "you" };
    case "credit.task_updated": return { text: `Credit step marked as ${i.status === "done" ? "done" : "to do"}`, kind: "you" };
    case "consent.recorded": return { text: "You accepted the sandbox terms", kind: "you" };
    case "persona.switched": return { text: "Demo profile switched", kind: "system" };
    case "governance.kill_switch": return { text: i.paused ? "You paused Remi's payment actions" : "You resumed Remi's payment actions", kind: "safety" };
    case "governance.limit_change_requested": return { text: "You asked to change a limit · code sent", kind: "safety" };
    case "governance.limits_changed": return { text: "Your limits were changed after code check", kind: "safety" };
    case "governance.limits_reset": return { text: "Limits restored to defaults", kind: "safety" };
    case "governance.step_up_failed": return { text: "A wrong code was entered for a limit change", kind: "safety" };
    case "sandbox.seeded": return { text: "Your private sandbox was created", kind: "system" };
    case "sandbox.reset": return { text: "Sandbox reset · a new log started", kind: "system" };
    case "sandbox.time_advanced": return { text: `Demo clock moved forward ${i.hours === 24 ? "1 day" : i.hours % 24 === 0 ? `${i.hours / 24} days` : `${i.hours} hours`}`, kind: "system" };
    case "sandbox.fx_tick": return { text: "Demo exchange rates moved", kind: "system" };
    case "sandbox.remittance_injected": return { text: "Money arrived from family (demo)", kind: "system" };
    case "sandbox.document_injected": return { text: "A suspicious invoice arrived (demo)", kind: "system" };
    default: return { text: e.action.replace(/[._]/g, " "), kind: "system" };
  }
}

/** "a payment of £9,250 to Northbridge University (demo)" */
function describePayload(kind: string | undefined, p: any): string {
  if (!p) return "an action";
  if (kind === "payment" || p.beneficiary_name) return `a payment of ${money(p.receive_amount, p.receive_currency, { whole: true })} to ${p.beneficiary_name}`;
  if (kind === "fx_conversion" || p.to_currency) return `a conversion to ${money(p.buy_amount, p.to_currency, { whole: true })}`;
  if (kind === "add_beneficiary" || p.name) return `a new recipient, ${p.name}`;
  return "an action";
}

function lower(s: string): string {
  return s ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

function toolPhrase(tool: string | null): string {
  const p = tool ? TOOL_PROGRESS[tool] : null;
  return p ? lower(p).replace(/^checking/, "checked").replace(/^comparing/, "compared").replace(/^reading/, "read").replace(/^looking at/, "looked at").replace(/^searching/, "searched").replace(/^working out/, "worked out").replace(/^breaking down/, "broke down").replace(/^listing/, "listed").replace(/^preparing/, "prepared").replace(/^setting/, "set").replace(/^building/, "built").replace(/^saving/, "saved").replace(/^updating/, "updated").replace(/^drafting/, "drafted").replace(/^adding/, "added") : "used a tool";
}

/** "You pay £38 in fees and exchange-rate markup" */
export function costSentence(landed: string | number, currency: string): string {
  return `You pay ${money(landed, currency, { whole: Number(landed) >= 100 })} in fees and exchange-rate markup`;
}

export { moneyText };
