from __future__ import annotations

from decimal import Decimal
from typing import Any

from sqlmodel import col, select

from ..models import Transaction, Wallet
from ..money import q_money
from ..sandbox import fx, ledger
from ..security.redact import mask_account
from .context import Ctx, DomainError


def wallets(ctx: Ctx) -> list[Wallet]:
    return list(
        ctx.session.exec(select(Wallet).where(Wallet.workspace_id == ctx.ws_id, Wallet.user_id == ctx.user.id)).all()
    )


def wallet_for(ctx: Ctx, currency: str) -> Wallet:
    for w in wallets(ctx):
        if w.currency == currency.upper():
            return w
    raise DomainError(f"You don't have a {currency.upper()} wallet")


def balance(ctx: Ctx, currency: str) -> Decimal:
    return ledger.wallet_balance(ctx.session, wallet_for(ctx, currency))


def summary(ctx: Ctx) -> dict[str, Any]:
    reporting = ctx.user.reporting_currency
    rows = []
    total = Decimal("0")
    for w in wallets(ctx):
        bal = ledger.wallet_balance(ctx.session, w)
        in_reporting = q_money(bal * fx.mid_rate(ctx.ws, w.currency, reporting), reporting)
        total += in_reporting
        rows.append(
            {
                "wallet_id": w.id,
                "currency": w.currency,
                "balance": str(q_money(bal, w.currency)),
                "in_reporting_currency": str(in_reporting),
                "mid_rate_to_reporting": str(fx.mid_rate(ctx.ws, w.currency, reporting).quantize(Decimal("0.000001"))),
            }
        )
    return {
        "reporting_currency": reporting,
        "total_in_reporting_currency": str(q_money(total, reporting)),
        "wallets": rows,
        "rates_label": "sandbox rates",
    }


def txn_to_dict(t: Transaction) -> dict[str, Any]:
    return {
        "id": t.id,
        "kind": t.kind,
        "status": t.status,
        "occurred_at": t.occurred_at.isoformat(timespec="seconds"),
        "description": t.description,
        "merchant": t.merchant,
        "category": t.category,
        "amount": str(t.amount),
        "currency": t.currency,
        "counter_amount": None if t.counter_amount is None else str(t.counter_amount),
        "counter_currency": t.counter_currency,
        "provider": t.provider,
        "reference": t.reference,
        "expected_arrival": t.expected_arrival.isoformat(timespec="seconds") if t.expected_arrival else None,
        "beneficiary": t.details.get("beneficiary_name"),
        "beneficiary_account": mask_account(t.details["beneficiary_account"]) if t.details.get("beneficiary_account") else None,
    }


def transactions(
    ctx: Ctx, limit: int = 20, currency: str | None = None, category: str | None = None, kind: str | None = None
) -> list[Transaction]:
    stmt = select(Transaction).where(Transaction.workspace_id == ctx.ws_id, Transaction.user_id == ctx.user.id)
    if currency:
        stmt = stmt.where(Transaction.currency == currency.upper())
    if category:
        stmt = stmt.where(col(Transaction.category).ilike(category))
    if kind:
        stmt = stmt.where(Transaction.kind == kind)
    stmt = stmt.order_by(col(Transaction.occurred_at).desc()).limit(max(1, min(limit, 200)))
    return list(ctx.session.exec(stmt).all())
