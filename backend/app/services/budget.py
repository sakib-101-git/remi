"""Multi-currency budget, burn rate and runway.

normalised_amount = amount × rate(txn_ccy → reporting_ccy, txn_date)
daily_burn        = Σ normalised spend over trailing 60 days / 60
runway_days       = (liquid balances − upcoming one-off obligations) / daily_burn
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal
from typing import Any

from sqlmodel import col, select

from ..models import Budget, Obligation, Transaction
from ..money import D, q_money, q_pct
from ..sandbox import fx
from ..sandbox.clock import aware, today
from . import wallets
from .context import Ctx, DomainError

BURN_WINDOW_DAYS = 60
SPEND_KINDS = ("card_spend", "transfer_out")
CATEGORY_RULES: dict[str, tuple[str, ...]] = {
    "Rent": ("lettings", "rentals", "apartments", "rent"),
    "Groceries": ("mart", "grocer", "grocery", "market", "basket", "pantry", "bazaar", "fields"),
    "Eating out": ("cafe", "bar", "pizza", "kitchen", "poutine", "curry", "taco", "noodle", "restaurant"),
    "Transport": ("transit", "metro", "ride", "bus", "rail", "pass"),
    "Phone": ("mobile", "wireless", "telecom"),
    "Subscriptions": ("stream", "cloudnotes", "gym", "fitzone", "spotify", "netflix", "pro"),
    "Education": ("book", "print", "course", "library"),
    "Shopping": ("store", "shop", "online"),
}


def categorize(merchant: str | None, description: str = "") -> str | None:
    text = f"{merchant or ''} {description}".lower()
    for category, keywords in CATEGORY_RULES.items():
        if any(k in text for k in keywords):
            return category
    return None


def _normalise(t: Transaction, reporting: str) -> Decimal:
    return t.amount * fx.historical_rate(t.currency, reporting, aware(t.occurred_at).date())


def _spend_rows(ctx: Ctx, since: date) -> list[Transaction]:
    rows = ctx.session.exec(
        select(Transaction).where(
            Transaction.workspace_id == ctx.ws_id,
            Transaction.user_id == ctx.user.id,
            col(Transaction.kind).in_(SPEND_KINDS),
            col(Transaction.status).not_in(("failed", "reversed")),
        )
    ).all()
    out = []
    for t in rows:
        if aware(t.occurred_at).date() < since:
            continue
        if t.kind == "transfer_out" and t.category == "Tuition":
            continue
        out.append(t)
    return out


def _subscriptions(rows: list[Transaction], reporting: str) -> list[dict[str, Any]]:
    by_merchant: dict[str, set[tuple[int, str]]] = defaultdict(set)
    amounts: dict[str, Transaction] = {}
    for t in rows:
        if t.kind != "card_spend" or not t.merchant:
            continue
        by_merchant[t.merchant].add((aware(t.occurred_at).month, str(t.amount)))
        amounts[t.merchant] = t
    subs = []
    for merchant, seen in by_merchant.items():
        months = {m for m, _ in seen}
        distinct_amounts = {a for _, a in seen}
        t = amounts[merchant]
        if len(months) >= 2 and len(distinct_amounts) == 1 and t.category in ("Subscriptions", "Phone"):
            subs.append({"merchant": merchant, "amount": str(t.amount), "currency": t.currency, "monthly_in_reporting": str(q_money(_normalise(t, reporting), reporting))})
    return sorted(subs, key=lambda s: -D(s["monthly_in_reporting"]))


def obligations(ctx: Ctx, within_days: int = 90) -> list[dict[str, Any]]:
    start = today(ctx.ws)
    rows = ctx.session.exec(
        select(Obligation).where(Obligation.workspace_id == ctx.ws_id, Obligation.user_id == ctx.user.id, Obligation.status == "upcoming")
    ).all()
    out = []
    for o in rows:
        due = o.due_date
        if o.recurring == "monthly":
            while due < start:
                month = due.month % 12 + 1
                due = due.replace(year=due.year + (1 if month == 1 else 0), month=month)
        if due > start + timedelta(days=within_days):
            continue
        out.append({
            "id": o.id,
            "title": o.title,
            "kind": o.kind,
            "amount": str(o.amount),
            "currency": o.currency,
            "in_reporting": str(q_money(o.amount * fx.mid_rate(ctx.ws, o.currency, ctx.user.reporting_currency), ctx.user.reporting_currency)),
            "due_date": due.isoformat(),
            "days_left": (due - start).days,
            "recurring": o.recurring,
            "invoice_id": o.invoice_id,
        })
    return sorted(out, key=lambda x: x["due_date"])


def runway(ctx: Ctx) -> dict[str, Any]:
    reporting = ctx.user.reporting_currency
    start = today(ctx.ws)
    spend = _spend_rows(ctx, start - timedelta(days=BURN_WINDOW_DAYS))
    total = sum((_normalise(t, reporting) for t in spend), Decimal("0"))
    daily_burn = total / BURN_WINDOW_DAYS if total else Decimal("0")
    summary = wallets.summary(ctx)
    liquid = D(summary["total_in_reporting_currency"])
    one_off = [o for o in obligations(ctx, within_days=120) if not o["recurring"]]
    reserved = sum((D(o["in_reporting"]) for o in one_off), Decimal("0"))
    available = liquid - reserved
    days = int(available / daily_burn) if daily_burn > 0 and available > 0 else 0
    return {
        "reporting_currency": reporting,
        "liquid_balance": str(q_money(liquid, reporting)),
        "reserved_for_obligations": str(q_money(reserved, reporting)),
        "reserved_items": [{"title": o["title"], "amount": o["in_reporting"], "due_date": o["due_date"]} for o in one_off],
        "available_after_obligations": str(q_money(available, reporting)),
        "daily_burn": str(q_money(daily_burn, reporting)),
        "monthly_burn": str(q_money(daily_burn * 30, reporting)),
        "runway_days": days,
        "runway_until": (start + timedelta(days=days)).isoformat(),
        "formula": "runway_days = (liquid balances − upcoming one-off obligations) / trailing-60-day daily burn",
        "excludes": "Future income (e.g. family support, salary) is not counted - this is a conservative runway.",
        "data_timestamp": start.isoformat(),
    }


def summary(ctx: Ctx) -> dict[str, Any]:
    reporting = ctx.user.reporting_currency
    start = today(ctx.ws)
    rows = _spend_rows(ctx, start - timedelta(days=60))
    this_month: dict[str, Decimal] = defaultdict(Decimal)
    last_month: dict[str, Decimal] = defaultdict(Decimal)
    for t in rows:
        d = aware(t.occurred_at).date()
        bucket = this_month if d > start - timedelta(days=30) else last_month
        bucket[t.category or "Uncategorised"] += _normalise(t, reporting)
    categories = []
    for cat in sorted(set(this_month) | set(last_month), key=lambda c: -this_month.get(c, Decimal("0"))):
        now_v, prev_v = this_month.get(cat, Decimal("0")), last_month.get(cat, Decimal("0"))
        change = q_pct((now_v - prev_v) / prev_v * 100, 1) if prev_v > 0 else None
        categories.append({"category": cat, "last_30_days": str(q_money(now_v, reporting)), "previous_30_days": str(q_money(prev_v, reporting)), "change_pct": None if change is None else str(change)})
    budgets = []
    for b in ctx.session.exec(select(Budget).where(Budget.workspace_id == ctx.ws_id, Budget.user_id == ctx.user.id)).all():
        used = this_month.get(b.category, Decimal("0")) * fx.mid_rate(ctx.ws, reporting, b.currency)
        budgets.append({"category": b.category, "limit": str(b.monthly_limit), "currency": b.currency, "used": str(q_money(used, b.currency)), "used_pct": str(q_pct(used / b.monthly_limit * 100, 1)) if b.monthly_limit else "0"})
    subs = _subscriptions(_spend_rows(ctx, start - timedelta(days=90)), reporting)
    rw = runway(ctx)
    total_now = sum(this_month.values(), Decimal("0"))
    total_prev = sum(last_month.values(), Decimal("0"))
    by_currency: dict[str, Decimal] = defaultdict(Decimal)
    for t in rows:
        if aware(t.occurred_at).date() > start - timedelta(days=30):
            by_currency[t.currency] += t.amount
    return {
        "reporting_currency": reporting,
        "period": f"{(start - timedelta(days=29)).isoformat()} to {start.isoformat()}",
        "total_spend_30d": str(q_money(total_now, reporting)),
        "total_spend_prev_30d": str(q_money(total_prev, reporting)),
        "spend_by_original_currency": {c: str(q_money(v, c)) for c, v in by_currency.items()},
        "categories": categories,
        "budgets": budgets,
        "subscriptions": subs,
        "runway": rw,
        "obligations": obligations(ctx, within_days=60),
        "recommendations": recommendations(ctx, categories, subs, rw),
        "normalisation": f"All spending converted to {reporting} at the sandbox rate on each transaction date",
        "disclaimer": "Sandbox demo. Insights are informational, not financial advice.",
    }


def recommendations(ctx: Ctx, categories: list[dict[str, Any]], subs: list[dict[str, Any]], rw: dict[str, Any]) -> list[dict[str, Any]]:
    reporting = rw["reporting_currency"]
    burn = D(rw["daily_burn"])
    available = D(rw["available_after_obligations"])
    recs: list[dict[str, Any]] = []

    def days_gained(monthly_saving: Decimal) -> int:
        new_burn = burn - monthly_saving / 30
        if burn <= 0 or new_burn <= 0 or available <= 0:
            return 0
        return int(available / new_burn) - int(available / burn)

    growing = [c for c in categories if c["change_pct"] is not None and D(c["change_pct"]) >= 15 and c["category"] not in ("Rent", "Tuition")]
    if growing:
        c = max(growing, key=lambda x: D(x["change_pct"]))
        target = q_money(D(c["previous_30_days"]), reporting)
        saving = D(c["last_30_days"]) - target
        recs.append({
            "id": "trim_category",
            "title": f"{c['category']} is up {c['change_pct']}% vs last month",
            "detail": f"Bringing it back to {target} {reporting}/month saves about {q_money(saving, reporting)} {reporting} and extends your runway by ~{days_gained(saving)} days.",
            "action": {"tool": "create_budget", "args": {"category": c["category"], "monthly_limit": str(target), "currency": reporting}},
        })
    if subs:
        total = sum((D(s["monthly_in_reporting"]) for s in subs), Decimal("0"))
        names = ", ".join(s["merchant"] for s in subs[:4])
        recs.append({
            "id": "review_subscriptions",
            "title": f"{len(subs)} recurring bills & subscriptions ({q_money(total, reporting)} {reporting}/month)",
            "detail": f"Review {names}. Cancelling one you don't use adds days to your runway.",
            "action": None,
        })
    upcoming = [o for o in rw["reserved_items"]]
    if upcoming:
        o = upcoming[0]
        recs.append({
            "id": "plan_obligation",
            "title": f"{o['title']} due {o['due_date']}",
            "detail": f"{o['amount']} {reporting} is already set aside in your runway. Ask Remi to compare providers and pay before the deadline with a safety buffer.",
            "action": {"tool": "get_remittance_quotes", "args": {}},
        })
    if len(recs) < 3:
        recs.append({
            "id": "set_rate_alert",
            "title": "Avoid converting on a bad day",
            "detail": "Set a target-rate alert for your next family top-up; Remi will propose the conversion when it's hit (you still confirm).",
            "action": {"tool": "set_rate_alert", "args": {}},
        })
    return recs[:3]


def create_budget(ctx: Ctx, category: str, monthly_limit: Decimal, currency: str | None = None) -> dict[str, Any]:
    if monthly_limit <= 0:
        raise DomainError("Budget must be positive")
    ccy = (currency or ctx.user.reporting_currency).upper()
    existing = ctx.session.exec(select(Budget).where(Budget.user_id == ctx.user.id, Budget.category == category)).first()
    previous = str(existing.monthly_limit) if existing else None
    if existing:
        existing.monthly_limit, existing.currency = q_money(monthly_limit, ccy), ccy
        b = existing
    else:
        b = Budget(workspace_id=ctx.ws_id, user_id=ctx.user.id, category=category, monthly_limit=q_money(monthly_limit, ccy), currency=ccy)
        ctx.session.add(b)
    ctx.session.flush()
    return {"status": "saved", "budget_id": b.id, "category": category, "monthly_limit": str(b.monthly_limit), "currency": ccy, "undo": {"previous_limit": previous}}


def recategorize(ctx: Ctx, transaction_id: str, category: str) -> dict[str, Any]:
    t = ctx.session.get(Transaction, transaction_id)
    if t is None or t.workspace_id != ctx.ws_id or t.user_id != ctx.user.id:
        raise DomainError("Transaction not found")
    previous = t.category
    t.category, t.category_source = category, "user"
    return {"status": "saved", "transaction_id": t.id, "category": category, "undo": {"previous_category": previous}}
