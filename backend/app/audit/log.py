from __future__ import annotations

import hashlib
import json
from decimal import Decimal
from typing import Any

from sqlalchemy import func
from sqlmodel import Session, select

from ..models import AuditEntry, utcnow
from ..security.redact import redact

GENESIS = "0" * 64


def canonical(obj: Any) -> str:
    def default(value: Any) -> str:
        if isinstance(value, Decimal):
            return str(value)
        return str(value)

    return json.dumps(obj, sort_keys=True, separators=(",", ":"), default=default, ensure_ascii=False)


def _jsonable(obj: Any) -> Any:
    return json.loads(canonical(obj))


def entry_digest(entry: AuditEntry) -> str:
    body = {
        "workspace_id": entry.workspace_id,
        "seq": entry.seq,
        "ts": entry.ts,
        "actor": entry.actor,
        "action": entry.action,
        "tool": entry.tool,
        "tier": entry.tier,
        "inputs": entry.inputs,
        "decision": entry.decision,
        "result": entry.result,
    }
    return hashlib.sha256((entry.prev_hash + canonical(body)).encode()).hexdigest()


def append(
    session: Session,
    workspace_id: str,
    actor: str,
    action: str,
    *,
    tool: str | None = None,
    tier: str | None = None,
    inputs: dict[str, Any] | None = None,
    decision: str | None = None,
    result: dict[str, Any] | None = None,
) -> AuditEntry:
    """Append-only: entries are never updated. Each hash covers the previous hash (SHA-256 chain)."""
    last = session.exec(
        select(AuditEntry).where(AuditEntry.workspace_id == workspace_id).order_by(AuditEntry.seq.desc()).limit(1)  # type: ignore[union-attr]
    ).first()
    entry = AuditEntry(
        workspace_id=workspace_id,
        seq=(last.seq + 1) if last else 1,
        ts=utcnow().isoformat(timespec="milliseconds"),
        actor=actor,
        action=action,
        tool=tool,
        tier=tier,
        inputs=_jsonable(redact(inputs or {})),
        decision=decision,
        result=_jsonable(redact(result or {})),
        prev_hash=last.hash if last else GENESIS,
        hash="",
    )
    entry.hash = entry_digest(entry)
    session.add(entry)
    session.flush()
    return entry


def verify(session: Session, workspace_id: str) -> dict[str, Any]:
    entries = session.exec(
        select(AuditEntry).where(AuditEntry.workspace_id == workspace_id).order_by(AuditEntry.seq)  # type: ignore[arg-type]
    ).all()
    prev = GENESIS
    for index, entry in enumerate(entries, start=1):
        if entry.seq != index:
            return {"valid": False, "entries": len(entries), "broken_at": entry.seq, "reason": "sequence gap"}
        if entry.prev_hash != prev:
            return {"valid": False, "entries": len(entries), "broken_at": entry.seq, "reason": "prev_hash mismatch"}
        if entry_digest(entry) != entry.hash:
            return {"valid": False, "entries": len(entries), "broken_at": entry.seq, "reason": "content hash mismatch"}
        prev = entry.hash
    return {"valid": True, "entries": len(entries), "head": prev, "broken_at": None, "reason": None}


def count(session: Session, workspace_id: str) -> int:
    return session.exec(select(func.count()).select_from(AuditEntry).where(AuditEntry.workspace_id == workspace_id)).one()


def export(session: Session, workspace_id: str) -> dict[str, Any]:
    entries = session.exec(
        select(AuditEntry).where(AuditEntry.workspace_id == workspace_id).order_by(AuditEntry.seq)  # type: ignore[arg-type]
    ).all()
    return {
        "workspace_id": workspace_id,
        "exported_at": utcnow().isoformat(),
        "verification": verify(session, workspace_id),
        "entries": [e.model_dump(exclude={"id"}) for e in entries],
    }
