"""Sandbox control panel operations (demo only)."""
from __future__ import annotations

from decimal import Decimal
from typing import Any

from ..audit import log as audit
from ..models import Transaction
from ..money import D, q_money
from ..services import automation, wallets
from ..services.context import Ctx, DomainError
from . import fx, ledger
from .clock import now
from .seed import suspicious_invoice_text

HOME_CCY = {"BD": "BDT", "NG": "NGN", "IN": "INR"}


def advance_time(ctx: Ctx, hours: int) -> dict[str, Any]:
    if not 0 < hours <= 24 * 60:
        raise DomainError("Advance between 1 hour and 60 days")
    ctx.ws.clock_offset_seconds += hours * 3600
    automation.housekeeping(ctx)
    audit.append(ctx.session, ctx.ws_id, "user", "sandbox.time_advanced", inputs={"hours": hours}, decision="ok", result={"sim_now": now(ctx.ws).isoformat(timespec="seconds")})
    ctx.emit("clock", {"sim_now": now(ctx.ws).isoformat(timespec="seconds"), "offset_seconds": ctx.ws.clock_offset_seconds})
    return {"sim_now": now(ctx.ws).isoformat(timespec="seconds")}


def tick(ctx: Ctx, steps: int = 1, shock_currency: str | None = None, shock_pct: Decimal | None = None) -> dict[str, Any]:
    shock = None
    if shock_currency:
        pct = D(shock_pct if shock_pct is not None else fx.fx_config()["tick"]["shock"])
        if abs(pct) > Decimal("0.05"):
            raise DomainError("Shock limited to ±5% per step")
        shock = (shock_currency.upper(), pct)
    result = automation.tick_rates(ctx, steps=max(1, min(steps, 50)), shock=shock)
    audit.append(ctx.session, ctx.ws_id, "user", "sandbox.fx_tick", inputs={"steps": steps, "shock": [shock_currency, str(shock_pct)] if shock else None}, decision="ok", result={"tick": result["tick"], "alerts_fired": len(result["alerts_fired"])})
    return result


def inject_remittance(ctx: Ctx, amount: Decimal | None = None, currency: str | None = None) -> dict[str, Any]:
    ccy = (currency or HOME_CCY.get(ctx.user.home_country, ctx.user.reporting_currency)).upper()
    w = wallets.wallet_for(ctx, ccy)
    value = q_money(amount if amount is not None else {"BDT": Decimal("150000"), "NGN": Decimal("400000"), "INR": Decimal("50000")}.get(ccy, Decimal("500")), ccy)
    if value <= 0 or value * fx.mid_rate(ctx.ws, ccy, "USD") > 20000:
        raise DomainError("Injected remittance must be positive and under $20,000")
    at = now(ctx.ws)
    t = Transaction(
        workspace_id=ctx.ws_id, user_id=ctx.user.id, kind="transfer_in", status="settled", occurred_at=at,
        description="Incoming family remittance (sandbox)", category="Family support", amount=value, currency=ccy, wallet_id=w.id,
        reference=f"INC-{at:%Y%m%d%H%M%S}", details={"amount_usd": str(q_money(value * fx.mid_rate(ctx.ws, ccy, "USD"), "USD"))},
    )
    ctx.session.add(t)
    ctx.session.flush()
    ledger.post(ctx.session, t, [(ledger.wallet_account(w.id), ccy, value), ("external:income", ccy, -value)])
    audit.append(ctx.session, ctx.ws_id, "system", "sandbox.remittance_injected", inputs={"amount": str(value), "currency": ccy}, decision="ok")
    ctx.notify("incoming", "Money received", f"{value:,} {ccy} arrived from family (sandbox).", {"transaction_id": t.id})
    ctx.emit("transaction", {"id": t.id, "status": "settled", "kind": "transfer_in"})
    return {"transaction_id": t.id, "amount": str(value), "currency": ccy}


def inject_suspicious_invoice(ctx: Ctx) -> dict[str, Any]:
    text = suspicious_invoice_text(ctx.ws, ctx.user)
    audit.append(ctx.session, ctx.ws_id, "system", "sandbox.document_injected", inputs={"kind": "suspicious_invoice"}, decision="ok")
    ctx.notify("document", "New document received", "An email attachment claims your university's bank details changed. Ask Remi to review it before paying.", {"document_text": text, "title": "Urgent tuition invoice.pdf"})
    return {"document_text": text, "title": "Urgent tuition invoice.pdf"}
