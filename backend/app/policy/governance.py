"""T4 governance actions. Never exposed to the agent: only reachable from Settings endpoints, always with step-up."""
from __future__ import annotations

from typing import Any

from ..audit import log as audit
from ..models import PendingAction
from ..money import D
from ..sandbox.clock import aware, now
from ..services.context import Ctx, DomainError
from . import limits as lim
from . import tokens
from .actions import PolicyViolation

MAX_RAISE_FACTOR = 5


def request_limit_change(ctx: Ctx, changes: dict[str, str]) -> dict[str, Any]:
    current = lim.effective_limits(ctx)
    clean: dict[str, str] = {}
    for key, value in changes.items():
        if key not in lim.LIMIT_KEYS:
            raise DomainError(f"Unknown limit {key}")
        amount = D(value)
        if amount <= 0:
            raise DomainError("Limits must be positive")
        base = D(lim.load_yaml("limits.yaml")[key])
        if amount > base * MAX_RAISE_FACTOR:
            raise DomainError(f"{key} can be raised to at most {MAX_RAISE_FACTOR}× the default (${base * MAX_RAISE_FACTOR:,}) in the sandbox")
        clean[key] = str(amount)
    at = now(ctx.ws)
    action = PendingAction(
        workspace_id=ctx.ws_id, user_id=ctx.user.id, kind="governance_limits", payload={"changes": clean, "previous": {k: str(current[k]) for k in clean}},
        payload_hash=tokens.payload_hash({"changes": clean}), summary={"title": "Change transfer limits", "changes": clean}, tier="T4",
        status="awaiting_step_up", requires_step_up=True, created_by="user", created_at=at,
    )
    ctx.session.add(action)
    ctx.session.flush()
    code, otp_hash, expires = tokens.issue_otp(action.id, at)
    action.otp_hash, action.otp_expires_at = otp_hash, expires
    audit.append(ctx.session, ctx.ws_id, "user", "governance.limit_change_requested", tier="T4", inputs={"action_id": action.id, "changes": clean}, decision="step_up_required")
    ctx.emit("sandbox_phone", {"action_id": action.id, "code": code, "expires_at": expires.isoformat(timespec="seconds"), "message": f"Remi sandbox code: {code}. It approves a CHANGE TO YOUR LIMITS. If you didn't ask for this, ignore it."})
    return {"action_id": action.id, "status": "awaiting_step_up", "changes": clean}


def verify_limit_change(ctx: Ctx, action_id: str, code: str) -> dict[str, Any]:
    a = ctx.session.get(PendingAction, action_id)
    if a is None or a.workspace_id != ctx.ws_id or a.kind != "governance_limits":
        raise DomainError("Request not found")
    if a.status != "awaiting_step_up":
        raise PolicyViolation(f"Request is {a.status}")
    if a.otp_expires_at is None or aware(a.otp_expires_at) < now(ctx.ws):
        a.status = "expired"
        raise PolicyViolation("Verification code expired")
    if not tokens.otp_matches(code, a.id, a.otp_hash):
        a.otp_attempts += 1
        if a.otp_attempts >= 3:
            a.status = "cancelled"
        audit.append(ctx.session, ctx.ws_id, "user", "governance.step_up_failed", tier="T4", inputs={"action_id": a.id}, decision="rejected")
        raise PolicyViolation("Incorrect verification code")
    ctx.ws.limits_override = {**(ctx.ws.limits_override or {}), **a.payload["changes"]}
    a.status, a.executed_at = "executed", now(ctx.ws)
    audit.append(ctx.session, ctx.ws_id, "user", "governance.limits_changed", tier="T4", inputs={"action_id": a.id, "changes": a.payload["changes"], "previous": a.payload["previous"]}, decision="executed")
    return {"status": "executed", "limits": lim.to_public(ctx)}


def reset_limits(ctx: Ctx) -> dict[str, Any]:
    previous = dict(ctx.ws.limits_override or {})
    ctx.ws.limits_override = {}
    audit.append(ctx.session, ctx.ws_id, "user", "governance.limits_reset", tier="T4", inputs={"previous": previous}, decision="executed")
    return lim.to_public(ctx)


def set_kill_switch(ctx: Ctx, paused: bool) -> dict[str, Any]:
    ctx.ws.agent_paused = paused
    audit.append(ctx.session, ctx.ws_id, "user", "governance.kill_switch", tier="T4", inputs={"paused": paused}, decision="executed")
    ctx.emit("settings", {"agent_paused": paused})
    return {"agent_paused": paused}
