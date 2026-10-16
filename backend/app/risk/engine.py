"""Rule-based, explainable risk score (0-100). Each rule adds weighted points and a plain-English reason."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import timedelta
from decimal import Decimal
from typing import Any
from zoneinfo import ZoneInfo

from sqlmodel import col, select

from ..config import load_yaml
from ..models import Beneficiary, PendingAction, Transaction
from ..money import D, q_money
from ..sandbox.clock import aware, now
from ..services import beneficiaries as bene
from ..services.context import Ctx

HOST_TZ = {"UK": "Europe/London", "CA": "America/Toronto", "US": "America/New_York"}


@dataclass
class RiskResult:
    score: int = 0
    reasons: list[dict[str, Any]] = field(default_factory=list)
    hard_block: bool = False

    def add(self, rule: str, points: int, reason: str, block: bool = False) -> None:
        self.reasons.append({"rule": rule, "points": points, "reason": reason})
        self.score = min(100, self.score + points)
        self.hard_block = self.hard_block or block

    @property
    def level(self) -> str:
        return "high" if self.score >= 50 else "medium" if self.score >= 25 else "low"

    def to_dict(self) -> dict[str, Any]:
        return {"score": self.score, "level": self.level, "reasons": self.reasons, "hard_block": self.hard_block}


def _cfg() -> dict[str, Any]:
    return load_yaml("risk.yaml")


def restricted_codes() -> dict[str, str]:
    return {j["code"]: j["name"] for j in load_yaml("restricted.yaml")["jurisdictions"]}


def max_historical_outgoing_usd(ctx: Ctx) -> Decimal:
    rows = ctx.session.exec(
        select(Transaction.details).where(
            Transaction.workspace_id == ctx.ws_id,
            Transaction.user_id == ctx.user.id,
            Transaction.kind == "transfer_out",
            Transaction.status == "settled",
        )
    ).all()
    values = [D(d.get("amount_usd", "0")) for d in rows]
    return max(values, default=Decimal("0"))


def corridor_used_before(ctx: Ctx, send_ccy: str, recv_ccy: str) -> bool:
    rows = ctx.session.exec(
        select(Transaction).where(
            Transaction.workspace_id == ctx.ws_id,
            Transaction.user_id == ctx.user.id,
            Transaction.kind == "transfer_out",
            Transaction.currency == send_ccy,
            Transaction.counter_currency == recv_ccy,
            col(Transaction.status).in_(("settled", "processing", "pending")),
        )
    ).first()
    return rows is not None


def _recent_movements(ctx: Ctx, kinds: tuple[str, ...], hours: int = 1) -> list[Transaction]:
    since = now(ctx.ws) - timedelta(hours=hours)
    rows = ctx.session.exec(
        select(Transaction).where(
            Transaction.workspace_id == ctx.ws_id,
            Transaction.user_id == ctx.user.id,
            col(Transaction.kind).in_(kinds),
        )
    ).all()
    return [t for t in rows if aware(t.occurred_at) >= since]


def _recent_payments_usd(ctx: Ctx, beneficiary_id: str | None, exclude_hash: str | None = None, hours: int = 24) -> list[Decimal]:
    since = now(ctx.ws) - timedelta(hours=hours)
    out: list[Decimal] = []
    for t in ctx.session.exec(
        select(Transaction).where(
            Transaction.workspace_id == ctx.ws_id,
            Transaction.user_id == ctx.user.id,
            Transaction.kind == "transfer_out",
            Transaction.beneficiary_id == beneficiary_id,
        )
    ).all():
        if aware(t.occurred_at) >= since and t.status not in ("failed", "reversed"):
            out.append(D(t.details.get("amount_usd", "0")))
    for a in ctx.session.exec(
        select(PendingAction).where(
            PendingAction.workspace_id == ctx.ws_id,
            PendingAction.user_id == ctx.user.id,
            PendingAction.kind == "payment",
            col(PendingAction.status).in_(("awaiting_confirmation", "awaiting_step_up", "scheduled")),
        )
    ).all():
        if a.payload_hash == exclude_hash:
            continue
        if a.payload.get("beneficiary_id") == beneficiary_id and aware(a.created_at) >= since:
            out.append(D(a.summary.get("amount_usd", "0")))
    return out


def assess_payment(
    ctx: Ctx,
    *,
    amount_usd: Decimal,
    beneficiary: Beneficiary,
    send_ccy: str,
    recv_ccy: str,
    limits: dict[str, Any],
    source_flags: list[str] | None = None,
    payload_hash: str | None = None,
) -> RiskResult:
    w = _cfg()["weights"]
    r = RiskResult()
    history_max = max_historical_outgoing_usd(ctx)
    if history_max > 0 and amount_usd > history_max * 3:
        r.add("large_vs_history", w["large_vs_history"], f"Amount ≈${q_money(amount_usd, 'USD'):,} is over 3× your largest past transfer (≈${q_money(history_max, 'USD'):,})")
    elif history_max > 0 and amount_usd > history_max * Decimal("1.5"):
        r.add("moderate_vs_history", w["moderate_vs_history"], "Amount is noticeably larger than your usual transfers")

    recent = _recent_movements(ctx, ("transfer_out", "fx_conversion"))
    if len(recent) >= 3:
        r.add("velocity", w["velocity"], f"{len(recent)} money movements in the last hour")

    if not bene.paid_before(ctx, beneficiary):
        r.add("new_beneficiary", w["new_beneficiary"], f"First payment to {beneficiary.name}")

    reg = bene.registry_check(beneficiary)
    if reg["applies"] and not reg["match"]:
        r.add("registry_mismatch", w["registry_mismatch"], f"Possible invoice fraud: {reg['reason']}", block=True)

    band = D(_cfg()["structuring_band"])
    thresholds = [limits["step_up_threshold_usd"], limits["daily_soft_limit_usd"]]
    previous = _recent_payments_usd(ctx, beneficiary.id, payload_hash)
    for threshold in thresholds:
        near = [p for p in previous if band * threshold <= p <= threshold]
        if band * threshold <= amount_usd <= threshold and len(near) >= 1:
            r.add("structuring", w["structuring"], f"Several payments just below the ${threshold:,} threshold in 24h (possible structuring)")
            break

    restricted = restricted_codes()
    if beneficiary.country in restricted:
        r.add("restricted_jurisdiction", w["restricted_jurisdiction"], f"Destination {restricted[beneficiary.country]} is on the restricted list", block=True)

    local = now(ctx.ws).astimezone(ZoneInfo(HOST_TZ.get(ctx.user.host_country, "UTC")))
    if local.hour in set(_cfg()["unusual_local_hours"]):
        r.add("unusual_time", w["unusual_time"], f"Unusual time of day ({local.strftime('%H:%M')} local)")

    if not corridor_used_before(ctx, send_ccy, recv_ccy):
        r.add("first_time_corridor", w["first_time_corridor"], f"First transfer on the {send_ccy}→{recv_ccy} corridor")

    if source_flags:
        r.add("injection_in_source", w["injection_in_source"], "Payment details came from a document containing suspicious instructions", block=True)
    return r


def assess_new_beneficiary(ctx: Ctx, *, country: str, kind: str, name: str, account_number: str, source_flags: list[str] | None = None) -> RiskResult:
    w = _cfg()["weights"]
    r = RiskResult()
    r.add("new_beneficiary", w["new_beneficiary"], f"Adding a new payee: {name}")
    restricted = restricted_codes()
    if country in restricted:
        r.add("restricted_jurisdiction", w["restricted_jurisdiction"], f"Destination {restricted[country]} is on the restricted list", block=True)
    if kind == "university":
        entry = bene.registry_by_name(name)
        if entry is None or entry["account_number"] != account_number:
            r.add("registry_mismatch", w["registry_mismatch"], "University payee does not match the verified registry", block=True)
    if source_flags:
        r.add("injection_in_source", w["injection_in_source"], "Payee details came from a document containing suspicious instructions", block=True)
    return r


def assess_conversion(ctx: Ctx, amount_usd: Decimal) -> RiskResult:
    r = RiskResult()
    recent = _recent_movements(ctx, ("fx_conversion",))
    if len(recent) >= 3:
        r.add("velocity", _cfg()["weights"]["velocity"], f"{len(recent)} conversions in the last hour")
    return r
