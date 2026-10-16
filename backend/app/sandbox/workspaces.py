from __future__ import annotations

from datetime import timedelta

from sqlalchemy import delete
from sqlmodel import Session, SQLModel, select

from ..audit import log as audit
from ..models import (
    AuditEntry, Beneficiary, Budget, ChatMessage, CreditTask, IdempotencyRecord, Invoice, JournalEntry, Notification,
    Obligation, PendingAction, RateAlert, Reminder, Transaction, User, Wallet, Workspace, utcnow,
)
from ..services.context import DomainError
from .seed import personas, seed_workspace

SCOPED: tuple[type[SQLModel], ...] = (
    JournalEntry, Transaction, PendingAction, IdempotencyRecord, AuditEntry, ChatMessage, Notification, RateAlert, Reminder,
    CreditTask, Budget, Obligation, Invoice, Beneficiary, Wallet, User,
)


def create(session: Session) -> Workspace:
    ws = Workspace()
    session.add(ws)
    session.flush()
    seed_workspace(session, ws)
    return ws


def _wipe(session: Session, ws_id: str) -> None:
    for model in SCOPED:
        session.exec(delete(model).where(model.workspace_id == ws_id))  # type: ignore[attr-defined,call-overload]


def reset(session: Session, ws: Workspace) -> Workspace:
    previous_head = audit.verify(session, ws.id).get("head")
    _wipe(session, ws.id)
    ws.clock_offset_seconds = 0
    ws.agent_paused = False
    ws.limits_override = {}
    session.flush()
    seed_workspace(session, ws)
    audit.append(session, ws.id, "user", "sandbox.reset", inputs={}, decision="ok", result={"previous_chain_head": previous_head})
    return ws


def switch_persona(session: Session, ws: Workspace, persona: str) -> User:
    if persona not in personas():
        raise DomainError(f"Unknown persona {persona}")
    user = session.exec(select(User).where(User.workspace_id == ws.id, User.persona == persona)).first()
    if user is None:
        raise DomainError("Persona missing; reset the sandbox")
    ws.active_user_id = user.id
    audit.append(session, ws.id, "user", "persona.switched", inputs={"persona": persona}, decision="ok")
    return user


def touch(ws: Workspace) -> None:
    ws.last_seen_at = utcnow()


def cleanup_idle(session: Session, idle_hours: int) -> int:
    cutoff = utcnow() - timedelta(hours=idle_hours)
    stale = [w for w in session.exec(select(Workspace)).all() if (w.last_seen_at.tzinfo and w.last_seen_at or w.last_seen_at.replace(tzinfo=cutoff.tzinfo)) < cutoff]
    for ws in stale:
        _wipe(session, ws.id)
        session.delete(ws)
    return len(stale)
