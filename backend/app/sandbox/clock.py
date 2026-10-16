from __future__ import annotations

import os
from datetime import date, datetime, timedelta, timezone

from ..models import Workspace


def real_now() -> datetime:
    # SANDBOX_FIXED_NOW pins the clock so tests and evals are reproducible (weekday, cut-offs, risk hours).
    fixed = os.environ.get("SANDBOX_FIXED_NOW")
    if fixed:
        return datetime.fromisoformat(fixed.replace("Z", "+00:00"))
    return datetime.now(timezone.utc)


def now(ws: Workspace) -> datetime:
    return real_now() + timedelta(seconds=ws.clock_offset_seconds)


def today(ws: Workspace) -> date:
    return now(ws).date()


def aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def add_business_days(start: datetime, days: int) -> datetime:
    current = start
    added = 0
    while added < days:
        current += timedelta(days=1)
        if current.weekday() < 5:
            added += 1
    return current
