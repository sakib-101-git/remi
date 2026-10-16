"""Background agent behaviour that runs without a chat turn: alert triggers, settlements, scheduled releases."""
from __future__ import annotations

from typing import Any

from ..audit import log as audit
from ..money import plain, rate_display
from ..policy import actions
from ..sandbox import fx
from . import alerts, conversions, payments, wallets
from .context import Ctx, DomainError


def on_rates_changed(ctx: Ctx) -> list[dict[str, Any]]:
    """When a target-rate alert fires, Remi PROPOSES the conversion; the human still has to confirm it."""
    out = []
    for alert in alerts.check(ctx):
        rate_text = rate_display(alert.base, alert.quote, alert.triggered_rate)
        audit.append(ctx.session, ctx.ws_id, "system", "alert.triggered", tool="set_rate_alert", tier="T1",
                     inputs={"alert_id": alert.id, "pair": f"{alert.base}/{alert.quote}", "target": plain(alert.target_rate)},
                     decision="triggered", result={"rate": str(alert.triggered_rate)})
        card: dict[str, Any] | None = None
        if alert.convert_amount and not ctx.ws.agent_paused:
            try:
                card = _propose_alert_conversion(ctx, alert)
            except DomainError as exc:
                card = {"error": str(exc)}
        ctx.notify(
            "rate_alert",
            f"Rate alert hit: {alert.base}/{alert.quote} {alert.direction} {plain(alert.target_rate)}",
            f"Now {rate_text}." + (" Remi prepared a conversion for you to review." if card and "id" in card else ""),
            {"alert": alerts.to_dict(alert), "action": card},
        )
        out.append({"alert": alerts.to_dict(alert), "action": card})
    return out


def _propose_alert_conversion(ctx: Ctx, alert: Any) -> dict[str, Any]:
    ccy = (alert.convert_currency or alert.base).upper()
    # Alert on BASE/QUOTE: the user converts from the currency they hold into the one they named.
    other = alert.quote if ccy == alert.base else alert.base
    held = {w.currency for w in wallets.wallets(ctx)}
    from_ccy, to_ccy = (other, ccy) if other in held else (ccy, other)
    kwargs = {"buy_amount": alert.convert_amount} if to_ccy == ccy else {"sell_amount": alert.convert_amount}
    q = conversions.quote(ctx, from_ccy, to_ccy, **kwargs)
    summary = conversion_summary(q, trigger=f"Rate alert {alert.base}/{alert.quote} {alert.direction} {plain(alert.target_rate)}")
    action, token = actions.propose(ctx, "fx_conversion", q, summary, created_by="agent")
    alert.proposal_id = action.id
    return actions.public(ctx, action, token)


def conversion_summary(q: dict[str, Any], trigger: str | None = None) -> dict[str, Any]:
    return {
        "title": f"Convert {q['from_currency']} → {q['to_currency']}",
        "you_sell": f"{q['sell_amount']} {q['from_currency']}",
        "you_get": f"{q['buy_amount']} {q['to_currency']}",
        "rate": rate_display(q["from_currency"], q["to_currency"], q["offered_rate"]),
        "mid_rate": rate_display(q["from_currency"], q["to_currency"], q["mid_rate"]),
        "cost_vs_mid": f"{q['cost_vs_mid']} {q['from_currency']}",
        "fee": "0",
        "provider": q["provider"],
        "amount_usd": q["amount_usd"],
        **({"trigger": trigger} if trigger else {}),
    }


def housekeeping(ctx: Ctx) -> None:
    payments.settle_due(ctx)
    actions.run_scheduled(ctx)


def tick_rates(ctx: Ctx, steps: int = 1, shock: tuple[str, Any] | None = None) -> dict[str, Any]:
    rates = fx.tick(ctx.ws, steps=steps, shock=shock)
    ctx.emit("fx", {"rates": {k: str(v) for k, v in rates.items()}, "tick": ctx.ws.fx_tick})
    fired = on_rates_changed(ctx)
    return {"tick": ctx.ws.fx_tick, "rates": {k: str(v) for k, v in rates.items()}, "alerts_fired": fired}
