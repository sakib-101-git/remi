from __future__ import annotations

from datetime import timedelta
from decimal import Decimal
from typing import Any

from sqlmodel import col, select

from ..config import load_yaml
from ..models import Transaction
from ..money import D
from ..sandbox.clock import aware, now
from ..services.context import Ctx

MONEY_KINDS = ("transfer_out", "fx_conversion")
LIMIT_KEYS = (
    "per_transaction_max_usd",
    "step_up_threshold_usd",
    "verified_institution_step_up_usd",
    "daily_soft_limit_usd",
    "daily_max_usd",
    "monthly_max_usd",
)


def effective_limits(ctx: Ctx) -> dict[str, Any]:
    base = dict(load_yaml("limits.yaml"))
    for key, value in (ctx.ws.limits_override or {}).items():
        if key in LIMIT_KEYS:
            base[key] = value
    return {**base, **{k: D(base[k]) for k in LIMIT_KEYS}}


def usage(ctx: Ctx) -> dict[str, Any]:
    """USD-equivalent money movement already executed (failed/reversed excluded)."""
    current = now(ctx.ws)
    since_month = current - timedelta(days=30)
    rows = ctx.session.exec(
        select(Transaction).where(
            Transaction.workspace_id == ctx.ws_id,
            Transaction.user_id == ctx.user.id,
            col(Transaction.kind).in_(MONEY_KINDS),
            col(Transaction.status).not_in(("failed", "reversed")),
            Transaction.occurred_at >= since_month,
        )
    ).all()
    day = month = Decimal("0")
    last_hour = last_day = 0
    for t in rows:
        amount_usd = D(t.details.get("amount_usd", "0"))
        occurred = aware(t.occurred_at)
        month += amount_usd
        if occurred >= current - timedelta(days=1):
            day += amount_usd
            last_day += 1
        if occurred >= current - timedelta(hours=1):
            last_hour += 1
    return {"day_usd": day, "month_usd": month, "count_last_hour": last_hour, "count_last_day": last_day}


def to_public(ctx: Ctx) -> dict[str, Any]:
    limits = effective_limits(ctx)
    used = usage(ctx)
    return {
        "limits": {k: str(limits[k]) for k in LIMIT_KEYS},
        "velocity": limits["velocity"],
        "risk": limits["risk"],
        "usage": {k: str(v) for k, v in used.items()},
        "overridden": sorted((ctx.ws.limits_override or {}).keys()),
    }
