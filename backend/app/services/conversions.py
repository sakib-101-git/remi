"""Own-wallet FX conversions and the FX conversion helper (no price prediction)."""
from __future__ import annotations

from decimal import Decimal
from typing import Any

from ..models import Transaction
from ..money import D, q_money, q_money_up, q_pct, q_rate
from ..sandbox import fx, ledger
from ..sandbox.clock import now
from .context import Ctx, DomainError
from . import wallets


def _cfg() -> dict[str, Any]:
    return fx.fx_config()["remi_conversion"]


def quote(ctx: Ctx, from_ccy: str, to_ccy: str, *, sell_amount: Decimal | None = None, buy_amount: Decimal | None = None) -> dict[str, Any]:
    from_ccy, to_ccy = from_ccy.upper(), to_ccy.upper()
    if from_ccy == to_ccy:
        raise DomainError("Pick two different currencies")
    if (sell_amount is None) == (buy_amount is None):
        raise DomainError("Specify either the amount to sell or the amount to buy")
    wallets.wallet_for(ctx, from_ccy)
    wallets.wallet_for(ctx, to_ccy)
    markup = D(_cfg()["markup"])
    mid = q_rate(fx.mid_rate(ctx.ws, from_ccy, to_ccy))
    offered = q_rate(mid * (Decimal("1") - markup))
    if buy_amount is not None:
        buy = q_money(buy_amount, to_ccy)
        sell = q_money_up(buy / offered, from_ccy)
    else:
        sell = q_money(sell_amount, from_ccy)
        buy = q_money(sell * offered, to_ccy)
    if sell <= 0 or buy <= 0:
        raise DomainError("Amount must be positive")
    cost_vs_mid = q_money(sell - buy / mid, from_ccy)
    return {
        "from_currency": from_ccy,
        "to_currency": to_ccy,
        "sell_amount": str(sell),
        "buy_amount": str(buy),
        "mid_rate": str(mid),
        "offered_rate": str(offered),
        "markup_pct": str(q_pct(markup * 100)),
        "fee": "0",
        "cost_vs_mid": str(cost_vs_mid),
        "amount_usd": str(q_money(sell * fx.mid_rate(ctx.ws, from_ccy, "USD"), "USD")),
        "provider": _cfg()["name"],
        "rate_timestamp": now(ctx.ws).isoformat(timespec="seconds"),
        "rates_label": "sandbox rates",
    }


def helper(ctx: Ctx, from_ccy: str, to_ccy: str, *, sell_amount: Decimal | None = None, buy_amount: Decimal | None = None, weeks: int = 4) -> dict[str, Any]:
    q = quote(ctx, from_ccy, to_ccy, sell_amount=sell_amount, buy_amount=buy_amount)
    weeks = max(2, min(weeks, 12))
    tranche = q_money(D(q["sell_amount"]) / weeks, q["from_currency"])
    return {
        "convert_now": q,
        "options": [
            {"id": "now", "title": "Convert now", "detail": f"Lock {q['offered_rate']} today; cost vs mid-market {q['cost_vs_mid']} {q['from_currency']}."},
            {"id": "alert", "title": "Set a target-rate alert", "detail": "Remi watches the rate and proposes the conversion when your target is hit. You still confirm it."},
            {"id": "tranches", "title": f"Convert in {weeks} equal weekly tranches", "detail": f"About {tranche} {q['from_currency']} per week averages your rate over time."},
        ],
        "risk_statement": "Nobody can reliably predict exchange rates. Waiting can make the rate better or worse; splitting into tranches reduces the impact of a single bad day but does not guarantee a better average.",
        "no_prediction": True,
        "disclaimer": "Sandbox demo. Not financial advice. Remi does not forecast or speculate on FX rates.",
    }


def execute(ctx: Ctx, payload: dict[str, Any], action_id: str) -> dict[str, Any]:
    from_ccy, to_ccy = payload["from_currency"], payload["to_currency"]
    sell, buy = D(payload["sell_amount"]), D(payload["buy_amount"])
    src, dst = wallets.wallet_for(ctx, from_ccy), wallets.wallet_for(ctx, to_ccy)
    if ledger.wallet_balance(ctx.session, src) < sell:
        raise DomainError(f"Insufficient {from_ccy} balance")
    at = now(ctx.ws)
    reference = f"FXC-{at:%Y%m%d}-{action_id[:6].upper()}"
    txn = Transaction(
        workspace_id=ctx.ws_id,
        user_id=ctx.user.id,
        kind="fx_conversion",
        status="settled",
        occurred_at=at,
        description=f"Convert {from_ccy} → {to_ccy}",
        category="Transfers",
        amount=sell,
        currency=from_ccy,
        wallet_id=src.id,
        counter_amount=buy,
        counter_currency=to_ccy,
        provider="remi_fx",
        reference=reference,
        details={"rate": payload["offered_rate"], "mid_rate": payload["mid_rate"], "amount_usd": payload["amount_usd"], "action_id": action_id, "via_remi": True},
    )
    ctx.session.add(txn)
    ctx.session.flush()
    ledger.post(
        ctx.session,
        txn,
        [
            (ledger.wallet_account(src.id), from_ccy, -sell),
            ("clearing:fx:remi", from_ccy, sell),
            ("clearing:fx:remi", to_ccy, -buy),
            (ledger.wallet_account(dst.id), to_ccy, buy),
        ],
    )
    ctx.emit("transaction", {"id": txn.id, "status": "settled", "kind": "fx_conversion", "reference": reference})
    return {
        "status": "executed",
        "transaction_id": txn.id,
        "reference": reference,
        "sold": f"{sell} {from_ccy}",
        "bought": f"{buy} {to_ccy}",
        "rate": payload["offered_rate"],
        "new_balances": {from_ccy: str(ledger.wallet_balance(ctx.session, src)), to_ccy: str(ledger.wallet_balance(ctx.session, dst))},
    }
