"""Agent tool registry. Every tool has a typed schema, a permission tier and a handler.

Handlers return a ToolResult: `data` is what the LLM sees (redacted, no tokens), `cards` are rendered by the
UI only. T2/T3 tools can only *propose*; the confirm token is attached to the card, never to `data`.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Any, Callable, Literal

from pydantic import BaseModel, Field, ValidationError, field_validator

from ..audit import log as audit
from ..knowledge import retrieval
from ..money import D, rate_display
from ..policy import actions
from ..sandbox import fx
from ..sandbox.clock import now
from ..security import injection
from ..security.redact import redact
from ..services import alerts, beneficiaries as bene, budget, compliance, conversions, credit, invoices, payments, quotes, wallets
from ..services.automation import conversion_summary
from ..services.context import Ctx, DomainError

Tier = Literal["T0", "T1", "T2", "T3"]


@dataclass
class ToolResult:
    data: dict[str, Any]
    cards: list[dict[str, Any]] = field(default_factory=list)
    untrusted: bool = False


@dataclass
class Tool:
    name: str
    tier: Tier
    description: str
    args: type[BaseModel]
    handler: Callable[[Ctx, Any], ToolResult]
    groups: tuple[str, ...]

    def schema(self) -> dict[str, Any]:
        params = self.args.model_json_schema()
        params.pop("title", None)
        for prop in params.get("properties", {}).values():
            prop.pop("title", None)
        return {"type": "function", "function": {"name": self.name, "description": f"[{self.tier}] {self.description}", "parameters": params}}


class Money(BaseModel):
    @field_validator("*", mode="before")
    @classmethod
    def _strip(cls, v: Any) -> Any:
        return v.strip() if isinstance(v, str) else v


def _dec(value: str | float | int | None, name: str = "amount") -> Decimal | None:
    if value in (None, ""):
        return None
    try:
        out = D(str(value).replace(",", "").replace("£", "").replace("$", ""))
    except InvalidOperation as exc:
        raise DomainError(f"{name} must be a number") from exc
    if out <= 0:
        raise DomainError(f"{name} must be positive")
    return out


def _ccy(value: str | None) -> str | None:
    if not value:
        return None
    v = value.strip().upper()
    aliases = {"POUND": "GBP", "POUNDS": "GBP", "£": "GBP", "TAKA": "BDT", "TK": "BDT", "NAIRA": "NGN", "RUPEE": "INR", "RUPEES": "INR", "DOLLAR": "USD", "DOLLARS": "USD", "$": "USD", "C$": "CAD"}
    v = aliases.get(v, v)
    if v not in fx.supported_currencies():
        raise DomainError(f"Unsupported currency {value}")
    return v


def _recipient(ctx: Ctx, name: str) -> Any:
    b = bene.find(ctx, name)
    if b is None:
        known = [x.nickname or x.name for x in bene.all_for_user(ctx)]
        raise DomainError(f"No saved recipient matches '{name}'. Saved recipients: {', '.join(known)}. A new payee must be added first (step-up + cooling-off).")
    return b


def _deadline(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise DomainError("deadline must be YYYY-MM-DD") from exc


# ---- argument schemas --------------------------------------------------------

class NoArgs(Money):
    pass


class TxArgs(Money):
    limit: int = Field(10, description="Max rows (1-50)")
    currency: str | None = None
    category: str | None = None


class FxArgs(Money):
    base: str | None = Field(None, description="e.g. GBP")
    quote: str | None = Field(None, description="e.g. BDT")


class QuoteArgs(Money):
    amount: str = Field(..., description="Amount as a number string")
    amount_currency: str = Field(..., description="Currency of `amount`")
    recipient: str | None = Field(None, description="Saved recipient name/nickname, e.g. 'mom', 'university'")
    receive_currency: str | None = Field(None, description="Needed if no recipient")
    from_currency: str | None = Field(None, description="Wallet to pay from. Set it whenever the user names a currency to send; otherwise chosen automatically")
    deadline: str | None = Field(None, description="YYYY-MM-DD")
    goal: Literal["cheapest", "fastest", "balanced"] = "cheapest"


class ReverseArgs(Money):
    target_amount: str = Field(..., description="Exact amount the recipient must receive")
    target_currency: str = Field(..., description="Currency the recipient receives")
    send_currency: str | None = Field(None, description="Currency the user sends, e.g. 'how much BDT do I send' -> BDT. Omit only if not stated")
    recipient: str | None = Field(None, description="Saved recipient name/nickname, e.g. 'university'")
    deadline: str | None = Field(None, description="YYYY-MM-DD")


class FeeArgs(Money):
    provider_id: str = Field(..., description="bank_wire | alpha_remit | beta_express | campus_pay")
    amount: str
    send_currency: str
    receive_currency: str


class ChecklistArgs(Money):
    send_currency: str
    receive_currency: str
    tuition: bool = True


class SearchArgs(Money):
    query: str = Field(..., description="Question in plain English")


class DocArgs(Money):
    document_text: str | None = Field(None, description="Leave empty to use the attached document")


class BudgetArgs(Money):
    category: str
    monthly_limit: str
    currency: str | None = None


class CategorizeArgs(Money):
    transaction_id: str
    category: str


class AlertArgs(Money):
    base: str = Field(..., description="Pair base, e.g. GBP for GBP/BDT")
    quote: str = Field(..., description="Pair quote, e.g. BDT")
    target_rate: str = Field(..., description="Units of quote per 1 base")
    direction: Literal["below", "above"] | None = Field(None, description="Omit unless the user literally says above/below; 'better than X' is inferred from the current rate")
    convert_amount: str | None = Field(None, description="Optional: amount to propose converting when hit")
    convert_currency: str | None = None


class ReminderArgs(Money):
    title: str
    due_date: str = Field(..., description="YYYY-MM-DD")


class CreditTaskArgs(Money):
    task_key: str
    status: Literal["todo", "in_progress", "done"]


class DraftArgs(Money):
    invoice_id: str | None = None


class ConvertArgs(Money):
    from_currency: str
    to_currency: str
    amount: str
    amount_currency: str = Field(..., description="Either from_currency (sell amount) or to_currency (buy amount)")


class FxHelperArgs(ConvertArgs):
    weeks: int = 4


class PayArgs(Money):
    recipient: str
    amount: str
    amount_currency: str
    from_currency: str | None = None
    provider_id: str | None = None
    goal: Literal["cheapest", "fastest", "balanced"] = "cheapest"
    invoice_id: str | None = None
    purpose_code: str | None = None
    source_of_funds: str | None = None


class AddPayeeArgs(Money):
    name: str
    kind: Literal["family", "landlord", "university", "other"]
    country: str = Field(..., description="2-letter code")
    currency: str
    bank_name: str
    account_number: str
    nickname: str | None = None


# ---- handlers ----------------------------------------------------------------

def h_wallets(ctx: Ctx, _: NoArgs) -> ToolResult:
    s = wallets.summary(ctx)
    return ToolResult(s, [{"type": "wallets", "data": s}])


def h_transactions(ctx: Ctx, a: TxArgs) -> ToolResult:
    rows = [wallets.txn_to_dict(t) for t in wallets.transactions(ctx, limit=min(a.limit, 50), currency=a.currency, category=a.category)]
    return ToolResult({"transactions": rows}, [{"type": "transactions", "data": rows}])


def h_fx(ctx: Ctx, a: FxArgs) -> ToolResult:
    home = {"BD": "BDT", "NG": "NGN", "IN": "INR"}.get(ctx.user.home_country, "USD")
    pairs = [(a.base, a.quote)] if a.base and a.quote else [(ctx.user.reporting_currency, home), ("USD", home), ("USD", ctx.user.reporting_currency)]
    out = []
    for base, quote_ in pairs:
        b, q = _ccy(base), _ccy(quote_)
        if b == q:
            continue
        mid = fx.mid_rate(ctx.ws, b, q)
        out.append({"pair": f"{b}/{q}", "mid_rate": str(mid.quantize(Decimal('0.0001'))), "display": rate_display(b, q, mid)})
    data = {"rates": out, "label": "sandbox rates (simulated, not live market data)", "timestamp": now(ctx.ws).isoformat(timespec="seconds")}
    return ToolResult(data, [{"type": "fx_rates", "data": data}])


def _compare(ctx: Ctx, *, amount: Decimal, amount_ccy: str, recipient: str | None, receive_ccy: str | None, from_ccy: str | None, deadline: date | None, goal: Any, reverse: bool) -> ToolResult:
    if recipient:
        b = _recipient(ctx, recipient)
        is_tuition = b.kind == "university"
        recv = b.currency
        send = from_ccy or payments.choose_source_currency(ctx, b, is_tuition)
        reg = bene.registry_check(b)
        registry_ok = reg["applies"] and reg["match"]
        if deadline is None and is_tuition:
            open_inv = invoices.open_invoices(ctx)
            deadline = open_inv[0].due_date if open_inv else None
    else:
        if not receive_ccy:
            raise DomainError("Tell me who receives the money or the receiving currency")
        forward_send = amount_ccy if not reverse and amount_ccy != receive_ccy else None
        recv, is_tuition, registry_ok = receive_ccy, False, False
        send = from_ccy or forward_send or payments.default_send_currency(ctx, receive_ccy)
    if reverse or amount_ccy == recv and amount_ccy != send:
        kwargs: dict[str, Any] = {"receive_amount": amount}
    else:
        kwargs = {"send_amount": amount}
    res = quotes.compare(ctx.ws, send, recv, deadline=deadline, goal=goal, is_tuition=is_tuition, payee_is_registry=registry_ok, **kwargs)
    best = res["recommended"]
    data = {
        "mode": res["mode"],
        "recommended": None if not best else {k: best[k] for k in ("provider_id", "provider_name", "send_amount", "send_currency", "receive_amount", "receive_currency", "fee", "rate_display", "mid_display", "landed_cost", "effective_cost_pct", "arrival_latest", "requires_documents")},
        "alternatives": res["explanation"]["alternatives"],
        "deadline": deadline.isoformat() if deadline else None,
        "assumptions": res["explanation"]["assumptions"],
        "no_feasible_option": res["no_feasible_option"],
        "sources": res["explanation"]["sources"],
        "disclaimer": res["explanation"]["disclaimer"],
    }
    return ToolResult(data, [{"type": "quotes", "data": res}])


def h_quotes(ctx: Ctx, a: QuoteArgs) -> ToolResult:
    amount, ccy = _dec(a.amount), _ccy(a.amount_currency)
    return _compare(ctx, amount=amount, amount_ccy=ccy, recipient=a.recipient, receive_ccy=_ccy(a.receive_currency), from_ccy=_ccy(a.from_currency), deadline=_deadline(a.deadline), goal=a.goal, reverse=False)


def h_reverse(ctx: Ctx, a: ReverseArgs) -> ToolResult:
    amount, ccy = _dec(a.target_amount, "target_amount"), _ccy(a.target_currency)
    return _compare(ctx, amount=amount, amount_ccy=ccy, recipient=a.recipient, receive_ccy=ccy, from_ccy=_ccy(a.send_currency), deadline=_deadline(a.deadline), goal="cheapest", reverse=True)


def h_fee(ctx: Ctx, a: FeeArgs) -> ToolResult:
    try:
        p = quotes.get_provider(a.provider_id)
    except KeyError as exc:
        raise DomainError("Unknown provider") from exc
    q = quotes.quote_provider(ctx.ws, p, _ccy(a.send_currency), _ccy(a.receive_currency), send_amount=_dec(a.amount))
    data = {
        "provider": p.name, "send": f"{q.send_amount} {q.send_currency}", "fixed_and_pct_fee": f"{q.fee} {q.send_currency}",
        "fx_markup_pct": str(p.markup * 100), "fx_markup_cost": f"{q.fx_markup_cost} {q.send_currency}", "received": f"{q.receive_amount} {q.receive_currency}",
        "landed_cost": f"{q.landed_cost} {q.send_currency}", "effective_cost_pct": str(q.effective_cost_pct),
        "explanation": "Total cost = upfront fee + hidden FX markup (the gap between the mid-market rate and the rate you get).",
        "sources": ["FX and fee glossary"],
    }
    return ToolResult(data, [{"type": "fee_breakdown", "data": data}])


def h_budget(ctx: Ctx, _: NoArgs) -> ToolResult:
    s = budget.summary(ctx)
    data = {k: s[k] for k in ("reporting_currency", "period", "total_spend_30d", "total_spend_prev_30d", "spend_by_original_currency", "subscriptions", "recommendations", "normalisation", "disclaimer")}
    data["top_categories"] = s["categories"][:6]
    data["runway"] = {k: s["runway"][k] for k in ("liquid_balance", "reserved_for_obligations", "available_after_obligations", "daily_burn", "monthly_burn", "runway_days", "runway_until", "excludes")}
    data["obligations"] = s["obligations"][:4]
    return ToolResult(data, [{"type": "budget", "data": s}])


def h_runway(ctx: Ctx, _: NoArgs) -> ToolResult:
    r = budget.runway(ctx)
    return ToolResult(r, [{"type": "runway", "data": r}])


def h_obligations(ctx: Ctx, _: NoArgs) -> ToolResult:
    obs = budget.obligations(ctx, within_days=90)
    open_inv = [invoices.to_dict(i) for i in invoices.open_invoices(ctx)]
    return ToolResult({"obligations": obs, "open_invoices": open_inv}, [{"type": "obligations", "data": obs}])


def h_credit(ctx: Ctx, _: NoArgs) -> ToolResult:
    p = credit.plan(ctx)
    return ToolResult(p, [{"type": "credit_plan", "data": p}])


def h_create_credit(ctx: Ctx, _: NoArgs) -> ToolResult:
    p = credit.create(ctx)
    return ToolResult(p, [{"type": "credit_plan", "data": p}])


def h_update_credit(ctx: Ctx, a: CreditTaskArgs) -> ToolResult:
    out = credit.update(ctx, a.task_key, a.status)
    return ToolResult(out, [{"type": "credit_plan", "data": credit.plan(ctx)}])


def h_checklist(ctx: Ctx, a: ChecklistArgs) -> ToolResult:
    c = compliance.checklist(_ccy(a.send_currency), _ccy(a.receive_currency), a.tuition, ctx.user.kyc_status)
    return ToolResult(c, [{"type": "checklist", "data": c}])


def h_search(ctx: Ctx, a: SearchArgs) -> ToolResult:
    hits = retrieval.search(a.query, k=4)
    chunks = [{"source_id": h["slug"], "title": h["title"], "illustrative": h["illustrative"], "score": h["score"], "text": injection.wrap_untrusted(f"kb:{h['slug']}", h["text"]), "flagged": h["flagged"]} for h in hits]
    data = {"results": chunks, "found": bool(chunks), "cite_as": "[KB: <title>]"}
    if not chunks:
        data["note"] = "No knowledge-base article is relevant enough. Say you don't know rather than guessing."
    sources = [{"slug": h["slug"], "title": h["title"], "illustrative": h["illustrative"]} for h in hits]
    return ToolResult(data, [{"type": "sources", "data": sources}] if sources else [], untrusted=True)


def h_document(ctx: Ctx, a: DocArgs) -> ToolResult:
    text = a.document_text or ctx.attachment or ""
    if not text.strip():
        raise DomainError("No document attached")
    result = invoices.analyze(ctx, text)
    return ToolResult(result, [{"type": "fraud" if result["fraud_suspected"] else "document_ok", "data": result}], untrusted=True)


def h_create_budget(ctx: Ctx, a: BudgetArgs) -> ToolResult:
    out = budget.create_budget(ctx, a.category.strip().capitalize(), _dec(a.monthly_limit, "monthly_limit"), _ccy(a.currency))
    return ToolResult(out, [{"type": "saved", "data": {"title": f"Budget saved: {out['category']} {out['monthly_limit']} {out['currency']}/month", **out}}])


def h_categorize(ctx: Ctx, a: CategorizeArgs) -> ToolResult:
    out = budget.recategorize(ctx, a.transaction_id, a.category)
    return ToolResult(out, [{"type": "saved", "data": {"title": f"Transaction re-categorised as {a.category}", **out}}])


def h_alert(ctx: Ctx, a: AlertArgs) -> ToolResult:
    out = alerts.set_alert(ctx, _ccy(a.base), _ccy(a.quote), _dec(a.target_rate, "target_rate"), a.direction, _dec(a.convert_amount, "convert_amount"), _ccy(a.convert_currency))
    out["note"] = "Alert saved. When it triggers, Remi will propose the conversion and the user must confirm it."
    return ToolResult(out, [{"type": "alert", "data": out}])


def h_reminder(ctx: Ctx, a: ReminderArgs) -> ToolResult:
    out = alerts.create_reminder(ctx, a.title, a.due_date)
    return ToolResult(out, [{"type": "saved", "data": {"title": f"Reminder set: {a.title} on {a.due_date}", **out}}])


def h_draft(ctx: Ctx, a: DraftArgs) -> ToolResult:
    out = invoices.draft_from_invoice(ctx, a.invoice_id)
    return ToolResult(out, [{"type": "draft", "data": out}] if out.get("status") == "drafted" else [])


def h_fx_helper(ctx: Ctx, a: FxHelperArgs) -> ToolResult:
    frm, to, ccy = _ccy(a.from_currency), _ccy(a.to_currency), _ccy(a.amount_currency)
    amt = _dec(a.amount)
    kwargs = {"buy_amount": amt} if ccy == to else {"sell_amount": amt}
    out = conversions.helper(ctx, frm, to, weeks=a.weeks, **kwargs)
    return ToolResult(out, [{"type": "fx_options", "data": out}])


def h_propose_conversion(ctx: Ctx, a: ConvertArgs) -> ToolResult:
    frm, to, ccy = _ccy(a.from_currency), _ccy(a.to_currency), _ccy(a.amount_currency)
    amt = _dec(a.amount)
    kwargs = {"buy_amount": amt} if ccy == to else {"sell_amount": amt}
    q = conversions.quote(ctx, frm, to, **kwargs)
    action, token = actions.propose(ctx, "fx_conversion", q, conversion_summary(q))
    return ToolResult(actions.for_agent(action), [{"type": "action", "data": actions.public(ctx, action, token)}])


def h_propose_payment(ctx: Ctx, a: PayArgs) -> ToolResult:
    b = _recipient(ctx, a.recipient)
    invoice_id = a.invoice_id
    if b.kind == "university" and not invoice_id:
        open_inv = [i for i in invoices.open_invoices(ctx) if i.registry_id == b.registry_id]
        invoice_id = open_inv[0].id if open_inv else None
    plan = payments.plan(
        ctx, b, amount=_dec(a.amount), amount_currency=_ccy(a.amount_currency), from_currency=_ccy(a.from_currency), provider_id=a.provider_id,
        goal=a.goal, invoice_id=invoice_id, purpose_code=a.purpose_code, source_of_funds=a.source_of_funds,
    )
    cards: list[dict[str, Any]] = [{"type": "quotes", "data": plan["comparison"]}]
    if not plan["feasible"]:
        return ToolResult({"status": "no_feasible_option", "routing_note": plan["routing_note"], "alternatives": plan["comparison"]["explanation"]["alternatives"], "executed": False}, cards)
    action, token = actions.propose(ctx, "payment", plan["payload"], payments.summary_for(ctx, plan["payload"]))
    data = actions.for_agent(action)
    data["routing_note"] = plan["routing_note"]
    data["why_this_provider"] = plan["comparison"]["explanation"]["alternatives"]
    if plan["payload"]["is_tuition"]:
        data["compliance"] = compliance.checklist(plan["payload"]["send_currency"], plan["payload"]["receive_currency"], True)["documents"]
    cards.append({"type": "action", "data": actions.public(ctx, action, token)})
    return ToolResult(data, cards)


def h_add_payee(ctx: Ctx, a: AddPayeeArgs) -> ToolResult:
    flags = ctx.source_flags
    payload = {"name": a.name, "nickname": a.nickname, "kind": a.kind, "country": a.country.upper()[:2], "currency": _ccy(a.currency), "bank_name": a.bank_name, "account_number": a.account_number.replace(" ", "").upper()}
    action, token = actions.propose(ctx, "add_beneficiary", payload, {"title": f"Add new payee {a.name}", "recipient": a.name, "bank": a.bank_name, "account": payload["account_number"][-4:].rjust(8, "•"), "kind": a.kind, "cooling_off": "Payments to a new payee are held for a cooling-off period"}, source_flags=flags)
    return ToolResult(actions.for_agent(action), [{"type": "action", "data": actions.public(ctx, action, token)}])


def h_beneficiaries(ctx: Ctx, _: NoArgs) -> ToolResult:
    rows = [bene.to_dict(ctx, b) for b in bene.all_for_user(ctx)]
    note = ("Payments to a payee in cooling-off can still be proposed now with propose_payment: once the user confirms, "
            "the payment is scheduled and released automatically when the cooling-off ends.")
    return ToolResult({"beneficiaries": rows, "note": note}, [])


REGISTRY: dict[str, Tool] = {t.name: t for t in [
    Tool("get_wallets", "T0", "Wallet balances and total in reporting currency.", NoArgs, h_wallets, ("general",)),
    Tool("get_transactions", "T0", "Recent transactions.", TxArgs, h_transactions, ("budget",)),
    Tool("get_fx_rates", "T0", "Sandbox mid-market FX rates.", FxArgs, h_fx, ("fx",)),
    Tool("get_remittance_quotes", "T0", "Compare all providers for a transfer (landed cost, fees, arrival vs deadline).", QuoteArgs, h_quotes, ("payments",)),
    Tool("reverse_quote", "T0", "How much to send so the recipient receives an exact amount.", ReverseArgs, h_reverse, ("payments",)),
    Tool("explain_fee_breakdown", "T0", "Break down fees and FX markup for one provider.", FeeArgs, h_fee, ("payments",)),
    Tool("get_budget_summary", "T0", "Multi-currency spending, categories, runway, obligations and 3 tips.", NoArgs, h_budget, ("budget",)),
    Tool("get_runway", "T0", "How long money lasts.", NoArgs, h_runway, ("budget",)),
    Tool("get_obligations", "T0", "Upcoming bills, tuition and open invoices.", NoArgs, h_obligations, ("budget", "payments")),
    Tool("get_credit_plan", "T0", "Preview the host-country credit-building plan.", NoArgs, h_credit, ("credit",)),
    Tool("get_compliance_checklist", "T0", "Purpose codes and documents for a corridor (illustrative).", ChecklistArgs, h_checklist, ("payments", "knowledge")),
    Tool("search_knowledge", "T0", "Search Remi's curated knowledge base; cite results as [KB: title].", SearchArgs, h_search, ("general", "knowledge")),
    Tool("analyze_document", "T0", "Review an attached invoice/document for fraud and injected instructions.", DocArgs, h_document, ("docs",)),
    Tool("list_beneficiaries", "T0", "Saved recipients (masked).", NoArgs, h_beneficiaries, ("payments",)),
    Tool("fx_conversion_options", "T0", "Convert-now vs alert vs tranches, without predicting rates.", FxHelperArgs, h_fx_helper, ("fx",)),
    Tool("create_budget", "T1", "Save a monthly budget for a category.", BudgetArgs, h_create_budget, ("budget",)),
    Tool("categorize_transaction", "T1", "Change a transaction's category.", CategorizeArgs, h_categorize, ("budget",)),
    Tool("set_rate_alert", "T1", "Watch an FX pair; optionally propose a conversion when hit.", AlertArgs, h_alert, ("fx",)),
    Tool("create_reminder", "T1", "Save a reminder.", ReminderArgs, h_reminder, ("budget", "payments")),
    Tool("create_credit_plan", "T1", "Save the 6-month credit plan as tracked tasks.", NoArgs, h_create_credit, ("credit",)),
    Tool("update_credit_task", "T1", "Mark a credit task todo/in_progress/done.", CreditTaskArgs, h_update_credit, ("credit",)),
    Tool("draft_payment", "T1", "Draft (not send) a payment from an open invoice using the verified registry account.", DraftArgs, h_draft, ("payments", "docs")),
    Tool("propose_fx_conversion", "T2", "Propose converting between the user's own wallets. Needs human confirmation in the UI.", ConvertArgs, h_propose_conversion, ("fx",)),
    Tool("propose_payment", "T2", "Propose a payment to a SAVED recipient. Needs human confirmation; policy may escalate to step-up.", PayArgs, h_propose_payment, ("payments",)),
    Tool("propose_add_beneficiary", "T3", "Propose adding a new payee (never from document text). Needs confirmation + OTP + cooling-off.", AddPayeeArgs, h_add_payee, ("payments",)),
]}

MAX_TOOL_CALLS_PER_TURN = 8


def schemas_for(groups: set[str]) -> list[dict[str, Any]]:
    wanted = groups | {"general"}
    return [t.schema() for t in REGISTRY.values() if set(t.groups) & wanted]


def run_tool(ctx: Ctx, name: str, raw_args: dict[str, Any], *, allowed: set[str], actor: str = "agent") -> ToolResult:
    """Allowlist + schema validation + audit for every tool call. Errors become data, never exceptions to the LLM."""
    tool = REGISTRY.get(name)
    if tool is None or name not in allowed:
        audit.append(ctx.session, ctx.ws_id, actor, "tool.rejected", tool=name, inputs={"args": raw_args}, decision="not_allowed")
        return ToolResult({"error": f"Tool '{name}' is not available for this request."})
    try:
        args = tool.args.model_validate(raw_args or {})
    except ValidationError as exc:
        audit.append(ctx.session, ctx.ws_id, actor, "tool.invalid_args", tool=name, tier=tool.tier, inputs={"args": raw_args}, decision="rejected", result={"errors": exc.errors(include_url=False)[:3]})
        return ToolResult({"error": "Invalid arguments", "details": [f"{'.'.join(map(str, e['loc']))}: {e['msg']}" for e in exc.errors()][:4]})
    try:
        nested = ctx.session.begin_nested()
        result = tool.handler(ctx, args)
        nested.commit()
    except DomainError as exc:
        nested.rollback()
        audit.append(ctx.session, ctx.ws_id, actor, "tool.error", tool=name, tier=tool.tier, inputs={"args": args.model_dump()}, decision="error", result={"error": str(exc)})
        return ToolResult({"error": str(exc)})
    if tool.tier in ("T0", "T1"):
        audit.append(ctx.session, ctx.ws_id, actor, "tool.called", tool=name, tier=tool.tier, inputs={"args": args.model_dump()}, decision="auto_allowed", result={"keys": sorted(result.data.keys())[:12]})
    result.data = redact(result.data)
    return result
