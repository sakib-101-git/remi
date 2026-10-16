from __future__ import annotations

from decimal import Decimal
from typing import Any

from sqlmodel import select

from ..models import RateAlert, Reminder
from ..money import D, q_rate
from ..sandbox import fx
from ..sandbox.clock import now
from .context import Ctx, DomainError


def to_dict(a: RateAlert) -> dict[str, Any]:
    return {
        "id": a.id,
        "pair": f"{a.base}/{a.quote}",
        "direction": a.direction,
        "target_rate": str(a.target_rate),
        "convert_amount": None if a.convert_amount is None else str(a.convert_amount),
        "convert_currency": a.convert_currency,
        "status": a.status,
        "triggered_rate": None if a.triggered_rate is None else str(a.triggered_rate),
        "proposal_id": a.proposal_id,
    }


def set_alert(
    ctx: Ctx, base: str, quote: str, target_rate: Decimal, direction: str | None = None,
    convert_amount: Decimal | None = None, convert_currency: str | None = None,
) -> dict[str, Any]:
    base, quote = base.upper(), quote.upper()
    current = q_rate(fx.mid_rate(ctx.ws, base, quote))
    target = q_rate(target_rate)
    if target <= 0:
        raise DomainError("Target rate must be positive")
    direction = direction or ("below" if target < current else "above")
    if direction not in ("below", "above"):
        raise DomainError("Direction must be 'below' or 'above'")
    alert = RateAlert(
        workspace_id=ctx.ws_id, user_id=ctx.user.id, base=base, quote=quote, direction=direction, target_rate=target,
        convert_amount=None if convert_amount is None else D(convert_amount), convert_currency=convert_currency.upper() if convert_currency else None,
        created_at=now(ctx.ws),
    )
    ctx.session.add(alert)
    ctx.session.flush()
    ctx.emit("alert", to_dict(alert))
    return {"status": "saved", **to_dict(alert), "current_rate": str(current), "undo": {"cancel_alert_id": alert.id}}


def list_alerts(ctx: Ctx) -> list[dict[str, Any]]:
    return [to_dict(a) for a in ctx.session.exec(select(RateAlert).where(RateAlert.workspace_id == ctx.ws_id, RateAlert.user_id == ctx.user.id)).all()]


def cancel(ctx: Ctx, alert_id: str) -> dict[str, Any]:
    a = ctx.session.get(RateAlert, alert_id)
    if a is None or a.workspace_id != ctx.ws_id:
        raise DomainError("Alert not found")
    a.status = "cancelled"
    return to_dict(a)


def check(ctx: Ctx) -> list[RateAlert]:
    """Fire alerts whose target is reached at the current sandbox rate."""
    fired = []
    for a in ctx.session.exec(select(RateAlert).where(RateAlert.workspace_id == ctx.ws_id, RateAlert.user_id == ctx.user.id, RateAlert.status == "active")).all():
        rate = q_rate(fx.mid_rate(ctx.ws, a.base, a.quote))
        hit = rate <= a.target_rate if a.direction == "below" else rate >= a.target_rate
        if hit:
            a.status, a.triggered_at, a.triggered_rate = "triggered", now(ctx.ws), rate
            fired.append(a)
    return fired


def create_reminder(ctx: Ctx, title: str, due_date: str) -> dict[str, Any]:
    from datetime import date

    try:
        due = date.fromisoformat(due_date)
    except ValueError as exc:
        raise DomainError("due_date must be YYYY-MM-DD") from exc
    r = Reminder(workspace_id=ctx.ws_id, user_id=ctx.user.id, title=title[:200], due_date=due, created_at=now(ctx.ws))
    ctx.session.add(r)
    ctx.session.flush()
    return {"status": "saved", "reminder_id": r.id, "title": r.title, "due_date": due.isoformat(), "undo": {"delete_reminder_id": r.id}}
