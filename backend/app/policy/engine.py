"""Policy engine: the ONLY gate between an agent proposal and money movement.

It assigns the permission tier (T2 or T3) from deterministic rules - never from the LLM - and decides
whether a proposal is blocked, needs confirmation only, needs step-up, or must wait out a cooling-off period.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from typing import Any

from ..money import D, q_money
from ..risk import engine as risk
from ..sandbox import ledger
from ..sandbox.clock import aware
from ..services import beneficiaries as bene
from ..services import wallets
from ..services.context import Ctx
from . import limits as lim
from . import tokens

TIERS = {
    "T0": "Read only - automatic, logged",
    "T1": "Low-risk write - automatic, logged, undo available",
    "T2": "Money movement - explicit human confirmation with a single-use token",
    "T3": "High risk - confirmation + step-up OTP (+ cooling-off for new payees)",
    "T4": "Governance - never available to the agent; human only, in Settings, with step-up",
}


@dataclass
class Decision:
    tier: str
    blocked: bool = False
    block_reasons: list[str] = field(default_factory=list)
    escalations: list[str] = field(default_factory=list)
    not_before: datetime | None = None
    risk: risk.RiskResult = field(default_factory=risk.RiskResult)

    @property
    def requires_step_up(self) -> bool:
        return self.tier == "T3"

    @property
    def outcome(self) -> str:
        if self.blocked:
            return "blocked"
        return "step_up_required" if self.requires_step_up else "confirmation_required"

    def block(self, reason: str) -> None:
        self.blocked = True
        self.block_reasons.append(reason)

    def escalate(self, reason: str) -> None:
        self.tier = "T3"
        self.escalations.append(reason)

    def to_dict(self) -> dict[str, Any]:
        return {
            "tier": self.tier,
            "outcome": self.outcome,
            "blocked": self.blocked,
            "block_reasons": self.block_reasons,
            "escalations": self.escalations,
            "requires_step_up": self.requires_step_up,
            "not_before": self.not_before.isoformat(timespec="seconds") if self.not_before else None,
            "risk": self.risk.to_dict(),
        }


def _common_limits(ctx: Ctx, d: Decision, amount_usd: Decimal, limits: dict[str, Any]) -> None:
    used = lim.usage(ctx)
    if ctx.ws.agent_paused:
        d.block("Agent money-movement is paused (kill switch is on)")
    if amount_usd > limits["per_transaction_max_usd"]:
        d.block(f"Above the per-transaction maximum of ${limits['per_transaction_max_usd']:,}")
    if used["day_usd"] + amount_usd > limits["daily_max_usd"]:
        d.block(f"Would exceed the daily maximum of ${limits['daily_max_usd']:,}")
    elif used["day_usd"] + amount_usd > limits["daily_soft_limit_usd"]:
        d.escalate(f"Takes today's total above ${limits['daily_soft_limit_usd']:,} (daily soft limit)")
    if used["month_usd"] + amount_usd > limits["monthly_max_usd"]:
        d.block(f"Would exceed the 30-day maximum of ${limits['monthly_max_usd']:,}")
    velocity = limits["velocity"]
    if used["count_last_day"] >= int(velocity["max_per_day"]):
        d.block("Daily transaction count limit reached")
    elif used["count_last_hour"] >= int(velocity["max_per_hour"]):
        d.escalate("Many transactions in the last hour (velocity)")


def _apply_risk(d: Decision, r: risk.RiskResult, limits: dict[str, Any]) -> None:
    d.risk = r
    if r.hard_block:
        for reason in r.reasons:
            if reason["rule"] in ("registry_mismatch", "restricted_jurisdiction", "injection_in_source"):
                d.block(reason["reason"])
    if r.score >= int(limits["risk"]["block_score"]):
        d.block(f"Risk score {r.score} is at or above the block threshold")
    elif r.score >= int(limits["risk"]["step_up_score"]):
        d.escalate(f"Risk score {r.score} requires step-up verification")


def evaluate_payment(ctx: Ctx, payload: dict[str, Any], source_flags: list[str] | None = None) -> Decision:
    limits = lim.effective_limits(ctx)
    d = Decision(tier="T2")
    b = bene.get(ctx, payload["beneficiary_id"])
    amount_usd = D(payload["amount_usd"])
    balance = ledger.wallet_balance(ctx.session, wallets.wallet_for(ctx, payload["send_currency"]))
    if balance < D(payload["send_amount"]):
        d.block(f"Insufficient {payload['send_currency']} balance ({q_money(balance, payload['send_currency']):,} available)")
    if not b.verified:
        d.block("Beneficiary is not verified")
    _common_limits(ctx, d, amount_usd, limits)
    reg = bene.registry_check(b)
    threshold = limits["verified_institution_step_up_usd"] if reg["applies"] and reg["match"] else limits["step_up_threshold_usd"]
    if amount_usd > threshold:
        d.escalate(f"Amount ≈${q_money(amount_usd, 'USD'):,} is above the ${threshold:,} step-up threshold")
    r = risk.assess_payment(
        ctx, amount_usd=amount_usd, beneficiary=b, send_ccy=payload["send_currency"], recv_ccy=payload["receive_currency"],
        limits=limits, source_flags=source_flags, payload_hash=tokens.payload_hash(payload),
    )
    if any(x["rule"] == "first_time_corridor" for x in r.reasons):
        d.escalate("First-time corridor")
    if not bene.is_active(ctx, b):
        d.escalate("New beneficiary still in cooling-off")
        d.not_before = aware(b.active_after)
    _apply_risk(d, r, limits)
    return d


def evaluate_conversion(ctx: Ctx, payload: dict[str, Any]) -> Decision:
    limits = lim.effective_limits(ctx)
    d = Decision(tier="T2")
    amount_usd = D(payload["amount_usd"])
    balance = ledger.wallet_balance(ctx.session, wallets.wallet_for(ctx, payload["from_currency"]))
    if balance < D(payload["sell_amount"]):
        d.block(f"Insufficient {payload['from_currency']} balance ({q_money(balance, payload['from_currency']):,} available)")
    _common_limits(ctx, d, amount_usd, limits)
    if amount_usd > limits["step_up_threshold_usd"]:
        d.escalate(f"Conversion above the ${limits['step_up_threshold_usd']:,} step-up threshold")
    _apply_risk(d, risk.assess_conversion(ctx, amount_usd), limits)
    return d


def evaluate_new_beneficiary(ctx: Ctx, payload: dict[str, Any], source_flags: list[str] | None = None) -> Decision:
    limits = lim.effective_limits(ctx)
    d = Decision(tier="T3", escalations=["Adding a payee always requires step-up and a cooling-off period"])
    if ctx.ws.agent_paused:
        d.block("Agent money-movement is paused (kill switch is on)")
    r = risk.assess_new_beneficiary(
        ctx, country=payload["country"], kind=payload["kind"], name=payload["name"], account_number=payload["account_number"],
        source_flags=source_flags,
    )
    _apply_risk(d, r, limits)
    d.tier = "T3"
    return d
