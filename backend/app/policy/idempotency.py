"""Idempotency keys for execute endpoints: replaying the same key returns the first response instead of paying twice."""
from __future__ import annotations

import hashlib
import json
from typing import Any

from sqlmodel import Session

from ..models import IdempotencyRecord
from ..services.context import DomainError


class IdempotencyConflict(DomainError):
    pass


def request_hash(body: dict[str, Any]) -> str:
    return hashlib.sha256(json.dumps(body, sort_keys=True, default=str).encode()).hexdigest()


def lookup(session: Session, workspace_id: str, key: str, endpoint: str, body: dict[str, Any]) -> dict[str, Any] | None:
    if not key or len(key) > 128:
        raise DomainError("Idempotency-Key header is required (max 128 chars)")
    rec = session.get(IdempotencyRecord, f"{workspace_id}:{key}")
    if rec is None:
        return None
    if rec.endpoint != endpoint or rec.request_hash != request_hash(body):
        raise IdempotencyConflict("Idempotency-Key was already used for a different request")
    return rec.response


def store(session: Session, workspace_id: str, key: str, endpoint: str, body: dict[str, Any], response: dict[str, Any]) -> None:
    session.add(IdempotencyRecord(key=f"{workspace_id}:{key}", workspace_id=workspace_id, endpoint=endpoint, request_hash=request_hash(body), response=json.loads(json.dumps(response, default=str))))
    session.flush()
