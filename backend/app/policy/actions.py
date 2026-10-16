"""Pending-action lifecycle: propose → confirm (token) → [step-up OTP] → [cooling-off] → execute.

The agent can only call propose(). confirm()/step_up() are reachable solely from human-facing API
endpoints and need the server-issued token, which never appears in any LLM-visible tool output.
"""
from __future__ import annotations

from datetime import timedelta
from typing import Any

from sqlmodel import col, select

from ..audit import log as audit
from ..config import get_settings
from ..models import Beneficiary, PendingAction
from ..sandbox.clock import aware, now
from ..security.redact import mask_account
from ..services import conversions, payments
from ..services.context import Ctx, DomainError
from . import engine, tokens

OPEN_STATES = ("awaiting_confirmation", "awaiting_step_up", "scheduled")


class PolicyViolation(DomainError):
    pass


def _get(ctx: Ctx, action_id: str) -> PendingAction:
    a = ctx.session.get(PendingAction, action_id)
    if a is None or a.workspace_id != ctx.ws_id or a.user_id != ctx.user.id:
        raise DomainError("Action not found")
    return a


def _evaluate(ctx: Ctx, kind: str, payload: dict[str, Any], source_flags: list[str] | None) -> engine.Decision:
    if kind == "payment":
        return engine.evaluate_payment(ctx, payload, source_flags)
    if kind == "fx_conversion":
        return engine.evaluate_conversion(ctx, payload)
    if kind == "add_beneficiary":
        return engine.evaluate_new_beneficiary(ctx, payload, source_flags)
    raise DomainError(f"Unknown action kind {kind}")


def propose(
    ctx: Ctx,
    kind: str,
    payload: dict[str, Any],
    summary: dict[str, Any],
    *,
    created_by: str = "agent",
    source_flags: list[str] | None = None,
) -> tuple[PendingAction, str | None]:
    """Returns (action, confirm_token). The token goes to the UI card only - never back to the LLM."""
    decision = _evaluate(ctx, kind, payload, source_flags)
    at = now(ctx.ws)
    action = PendingAction(
        workspace_id=ctx.ws_id,
        user_id=ctx.user.id,
        kind=kind,
        payload=payload,
        payload_hash=tokens.payload_hash(payload),
        summary=summary,
        tier=decision.tier,
        risk_score=decision.risk.score,
        risk_reasons=decision.risk.reasons,
        policy_reasons=decision.block_reasons + decision.escalations,
        status="blocked" if decision.blocked else "awaiting_confirmation",
        requires_step_up=decision.requires_step_up,
        not_before=decision.not_before,
        created_by=created_by,
        created_at=at,
    )
    ctx.session.add(action)
    ctx.session.flush()
    token = None
    if not decision.blocked:
        token, token_hash, expires = tokens.issue_token(action.id, action.payload_hash, at)
        action.token_hash, action.token_expires_at = token_hash, expires
    audit.append(
        ctx.session, ctx.ws_id, created_by, "action.proposed", tool=f"propose_{kind}", tier=decision.tier,
        inputs={"action_id": action.id, "kind": kind, "payload": payload},
        decision=decision.outcome,
        result={"risk": decision.risk.to_dict(), "reasons": action.policy_reasons},
    )
    if decision.blocked:
        flagged = any(r["rule"] in ("registry_mismatch", "injection_in_source") for r in decision.risk.reasons)
        ctx.notify("blocked", "Possible fraud blocked" if flagged else "Action blocked by policy", "; ".join(decision.block_reasons), {"action_id": action.id})
    ctx.emit("action", public(ctx, action))
    return action, token


def confirm(ctx: Ctx, action_id: str, token: str, actor: str = "user") -> dict[str, Any]:
    a = _get(ctx, action_id)
    at = now(ctx.ws)
    if a.status != "awaiting_confirmation":
        raise PolicyViolation(f"Action is {a.status}; it cannot be confirmed")
    reason = None
    if a.token_used:
        reason = "token already used"
    elif a.token_expires_at is None or aware(a.token_expires_at) < at:
        reason = "token expired"
    elif tokens.payload_hash(a.payload) != a.payload_hash:
        reason = "payload changed after proposal"
    elif not tokens.token_matches(token, a.id, a.payload_hash, a.token_hash):
        reason = "invalid token"
    if reason:
        if reason == "token expired":
            a.status = "expired"
        audit.append(ctx.session, ctx.ws_id, actor, "action.confirm_rejected", tier=a.tier, inputs={"action_id": a.id}, decision="rejected", result={"reason": reason})
        ctx.emit("action", public(ctx, a))
        raise PolicyViolation(f"Confirmation rejected: {reason}")

    a.token_used = True
    decision = _evaluate(ctx, a.kind, a.payload, None)
    if decision.blocked:
        a.status = "blocked"
        a.policy_reasons = decision.block_reasons
        audit.append(ctx.session, ctx.ws_id, "system", "action.blocked_at_confirm", tier=a.tier, inputs={"action_id": a.id}, decision="blocked", result={"reasons": decision.block_reasons})
        ctx.emit("action", public(ctx, a))
        raise PolicyViolation("Blocked at confirmation: " + "; ".join(decision.block_reasons))
    if decision.requires_step_up and not a.requires_step_up:
        a.requires_step_up, a.tier = True, "T3"
    audit.append(ctx.session, ctx.ws_id, actor, "action.confirmed", tier=a.tier, inputs={"action_id": a.id}, decision="confirmed")

    if a.requires_step_up:
        code, otp_hash, expires = tokens.issue_otp(a.id, at)
        a.otp_hash, a.otp_expires_at, a.otp_attempts = otp_hash, expires, 0
        a.status = "awaiting_step_up"
        audit.append(ctx.session, ctx.ws_id, "system", "stepup.challenge_sent", tier=a.tier, inputs={"action_id": a.id, "channel": "sandbox_phone"}, decision="challenge")
        # The simulated OTP travels on a separate "sandbox phone" channel, mimicking an SMS to the user's device.
        ctx.emit("sandbox_phone", {"action_id": a.id, "code": code, "expires_at": expires.isoformat(timespec="seconds"), "message": f"Remi sandbox code: {code}. Never share this code. It confirms {a.summary.get('title', a.kind)}."})
        ctx.emit("action", public(ctx, a))
        return public(ctx, a)
    return _release(ctx, a, actor)


def step_up(ctx: Ctx, action_id: str, code: str, actor: str = "user") -> dict[str, Any]:
    a = _get(ctx, action_id)
    at = now(ctx.ws)
    if a.status != "awaiting_step_up":
        raise PolicyViolation(f"Action is {a.status}; no step-up pending")
    if a.otp_expires_at is None or aware(a.otp_expires_at) < at:
        a.status = "expired"
        audit.append(ctx.session, ctx.ws_id, actor, "stepup.failed", tier=a.tier, inputs={"action_id": a.id}, decision="expired")
        ctx.emit("action", public(ctx, a))
        raise PolicyViolation("Verification code expired")
    if not tokens.otp_matches(code, a.id, a.otp_hash):
        a.otp_attempts += 1
        if a.otp_attempts >= 3:
            a.status = "cancelled"
        audit.append(ctx.session, ctx.ws_id, actor, "stepup.failed", tier=a.tier, inputs={"action_id": a.id, "attempt": a.otp_attempts}, decision="rejected")
        ctx.emit("action", public(ctx, a))
        raise PolicyViolation("Incorrect verification code" + (" - action cancelled after 3 attempts" if a.status == "cancelled" else ""))
    a.otp_hash = None
    audit.append(ctx.session, ctx.ws_id, actor, "stepup.passed", tier=a.tier, inputs={"action_id": a.id}, decision="verified")
    return _release(ctx, a, actor)


def _release(ctx: Ctx, a: PendingAction, actor: str) -> dict[str, Any]:
    if a.kind == "add_beneficiary":
        return _execute(ctx, a, actor)
    if a.not_before and aware(a.not_before) > now(ctx.ws):
        a.status = "scheduled"
        audit.append(ctx.session, ctx.ws_id, "system", "action.scheduled", tier=a.tier, inputs={"action_id": a.id}, decision="cooling_off", result={"not_before": a.not_before.isoformat()})
        ctx.emit("action", public(ctx, a))
        return public(ctx, a)
    return _execute(ctx, a, actor)


def _execute(ctx: Ctx, a: PendingAction, actor: str) -> dict[str, Any]:
    if a.status in ("executed", "cancelled", "blocked", "expired", "failed"):
        raise PolicyViolation(f"Action already {a.status}")
    if tokens.payload_hash(a.payload) != a.payload_hash:
        raise PolicyViolation("Payload integrity check failed")
    try:
        if a.kind == "payment":
            result = payments.execute(ctx, a.payload, a.id)
        elif a.kind == "fx_conversion":
            result = conversions.execute(ctx, a.payload, a.id)
        else:
            result = _add_beneficiary(ctx, a)
    except DomainError as exc:
        a.status = "failed"
        a.result = {"error": str(exc)}
        audit.append(ctx.session, ctx.ws_id, "system", "action.failed", tier=a.tier, inputs={"action_id": a.id}, decision="failed", result={"error": str(exc)})
        ctx.emit("action", public(ctx, a))
        raise
    a.status = "executed"
    a.executed_at = now(ctx.ws)
    a.result = result
    entry = audit.append(ctx.session, ctx.ws_id, actor, "action.executed", tool=f"execute_{a.kind}", tier=a.tier, inputs={"action_id": a.id, "payload": a.payload}, decision="executed", result=result)
    a.result = {**result, "audit_hash": entry.hash}
    ctx.emit("action", public(ctx, a))
    return public(ctx, a)


def _add_beneficiary(ctx: Ctx, a: PendingAction) -> dict[str, Any]:
    p = a.payload
    cooling = timedelta(seconds=get_settings().cooling_off_seconds)
    b = Beneficiary(
        workspace_id=ctx.ws_id, user_id=ctx.user.id, name=p["name"], nickname=p.get("nickname"), kind=p["kind"],
        country=p["country"], currency=p["currency"], bank_name=p["bank_name"], account_number=p["account_number"],
        verified=True, created_at=now(ctx.ws), active_after=now(ctx.ws) + cooling,
    )
    ctx.session.add(b)
    ctx.session.flush()
    ctx.notify("beneficiary", "New payee added", f"{b.name} can receive payments after the cooling-off period.", {"beneficiary_id": b.id, "active_after": b.active_after.isoformat()})
    return {"status": "executed", "beneficiary_id": b.id, "active_after": b.active_after.isoformat(timespec="seconds"), "cooling_off_seconds": int(cooling.total_seconds())}


def reissue_token(ctx: Ctx, action_id: str) -> dict[str, Any]:
    """Human UI only: mint a fresh single-use token (old one is invalidated) after re-running policy."""
    a = _get(ctx, action_id)
    if a.status not in ("awaiting_confirmation", "expired") or a.token_used:
        raise PolicyViolation(f"Action is {a.status}; nothing to confirm")
    decision = _evaluate(ctx, a.kind, a.payload, None)
    if decision.blocked:
        a.status, a.policy_reasons = "blocked", decision.block_reasons
        ctx.emit("action", public(ctx, a))
        raise PolicyViolation("Blocked: " + "; ".join(decision.block_reasons))
    if a.kind != "add_beneficiary":
        a.tier, a.requires_step_up = decision.tier, decision.requires_step_up
    token, token_hash, expires = tokens.issue_token(a.id, a.payload_hash, now(ctx.ws))
    a.token_hash, a.token_expires_at, a.status = token_hash, expires, "awaiting_confirmation"
    audit.append(ctx.session, ctx.ws_id, "user", "action.token_reissued", tier=a.tier, inputs={"action_id": a.id}, decision="reissued")
    return public(ctx, a, token)


def cancel(ctx: Ctx, action_id: str, actor: str = "user") -> dict[str, Any]:
    a = _get(ctx, action_id)
    if a.status not in OPEN_STATES:
        raise PolicyViolation(f"Action is {a.status}; nothing to cancel")
    a.status = "cancelled"
    audit.append(ctx.session, ctx.ws_id, actor, "action.cancelled", tier=a.tier, inputs={"action_id": a.id}, decision="cancelled")
    ctx.emit("action", public(ctx, a))
    return public(ctx, a)


def run_scheduled(ctx: Ctx) -> list[str]:
    """Execute confirmed actions whose cooling-off has ended; expire stale proposals."""
    done = []
    at = now(ctx.ws)
    for a in ctx.session.exec(
        select(PendingAction).where(
            PendingAction.workspace_id == ctx.ws_id, PendingAction.user_id == ctx.user.id, col(PendingAction.status).in_(OPEN_STATES)
        )
    ).all():
        if a.status == "scheduled" and a.not_before and aware(a.not_before) <= at:
            try:
                _execute(ctx, a, "system")
                done.append(a.id)
                ctx.notify("executed", "Scheduled payment released", f"{a.summary.get('title', 'Payment')} was released after cooling-off.", {"action_id": a.id})
            except DomainError:
                pass
        elif a.status == "awaiting_confirmation" and a.token_expires_at and aware(a.token_expires_at) < at:
            a.status = "expired"
            ctx.emit("action", public(ctx, a))
    return done


def public(ctx: Ctx, a: PendingAction, token: str | None = None) -> dict[str, Any]:
    payload = dict(a.payload)
    if "beneficiary_account" in payload:
        payload["beneficiary_account"] = mask_account(payload["beneficiary_account"])
    if "account_number" in payload:
        payload["account_number"] = mask_account(payload["account_number"])
    out = {
        "id": a.id,
        "kind": a.kind,
        "status": a.status,
        "tier": a.tier,
        "summary": a.summary,
        "payload": payload,
        "risk_score": a.risk_score,
        "risk_reasons": a.risk_reasons,
        "policy_reasons": a.policy_reasons,
        "requires_step_up": a.requires_step_up,
        "not_before": aware(a.not_before).isoformat(timespec="seconds") if a.not_before else None,
        "expires_at": aware(a.token_expires_at).isoformat(timespec="seconds") if a.token_expires_at else None,
        "created_at": aware(a.created_at).isoformat(timespec="seconds"),
        "result": a.result,
    }
    if token:
        out["confirm_token"] = token
    return out


def for_agent(a: PendingAction) -> dict[str, Any]:
    """What the LLM is allowed to see about a proposal: no token, masked accounts, explicit non-execution."""
    return {
        "action_id": a.id,
        "kind": a.kind,
        "status": a.status,
        "tier": a.tier,
        "executed": False,
        "summary": {k: v for k, v in a.summary.items() if k != "recipient_account"},
        "risk_score": a.risk_score,
        "risk_reasons": [r["reason"] for r in a.risk_reasons],
        "policy_reasons": a.policy_reasons,
        "requires_step_up": a.requires_step_up,
        "next_step": "blocked - explain why and suggest a safe alternative" if a.status == "blocked" else "the user must review and confirm the action card in the UI; do NOT claim it is done",
    }
