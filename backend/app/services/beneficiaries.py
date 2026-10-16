from __future__ import annotations

import re
from datetime import datetime
from typing import Any

from sqlmodel import select

from ..config import load_yaml
from ..models import Beneficiary, Transaction
from ..sandbox.clock import aware, now
from ..security.redact import mask_account
from .context import Ctx, DomainError


def registry() -> list[dict[str, Any]]:
    return list(load_yaml("registry.yaml")["institutions"])


def registry_entry(registry_id: str) -> dict[str, Any] | None:
    return next((r for r in registry() if r["id"] == registry_id), None)


def registry_by_name(name: str) -> dict[str, Any] | None:
    key = _norm(name)
    for entry in registry():
        entry_key = _norm(entry["name"])
        if key and (key in entry_key or entry_key in key or key.split()[0] == entry_key.split()[0]):
            return entry
    return None


def _norm(text: str) -> str:
    return re.sub(r"[^a-z0-9 ]", "", re.sub(r"\(demo\)", "", (text or "").lower())).strip()


def all_for_user(ctx: Ctx) -> list[Beneficiary]:
    return list(
        ctx.session.exec(
            select(Beneficiary).where(Beneficiary.workspace_id == ctx.ws_id, Beneficiary.user_id == ctx.user.id)
        ).all()
    )


def get(ctx: Ctx, beneficiary_id: str) -> Beneficiary:
    b = ctx.session.get(Beneficiary, beneficiary_id)
    if b is None or b.workspace_id != ctx.ws_id or b.user_id != ctx.user.id:
        raise DomainError("Beneficiary not found")
    return b


def find(ctx: Ctx, query: str) -> Beneficiary | None:
    """Resolve 'mom', 'my landlord', 'university' or a name to a saved beneficiary."""
    q = _norm(query).replace("my ", "").strip()
    if not q:
        return None
    candidates = all_for_user(ctx)
    aliases = {
        "mother": "mom", "mum": "mom", "mama": "mom", "ammu": "mom", "father": "dad", "papa": "dad", "abbu": "dad",
        "uni": "university", "college": "university", "school": "university",
    }
    q = aliases.get(q, q)
    for b in candidates:
        nick = _norm(b.nickname or "")
        nick = aliases.get(nick, nick)
        if q == nick or q == b.kind or (b.kind == "university" and q in {"university", "tuition"}):
            return b
    for b in candidates:
        if q in _norm(b.name) or _norm(b.name) in q:
            return b
    return None


def is_active(ctx: Ctx, b: Beneficiary, at: datetime | None = None) -> bool:
    current = at or now(ctx.ws)
    return b.active_after is None or aware(b.active_after) <= current


def paid_before(ctx: Ctx, b: Beneficiary) -> bool:
    return (
        ctx.session.exec(
            select(Transaction.id).where(
                Transaction.workspace_id == ctx.ws_id,
                Transaction.beneficiary_id == b.id,
                Transaction.status == "settled",
            )
        ).first()
        is not None
    )


def registry_check(b: Beneficiary) -> dict[str, Any]:
    """Universities must match the verified registry exactly (name AND account) or payment is blocked."""
    if b.kind != "university":
        return {"applies": False, "match": True}
    entry = registry_entry(b.registry_id) if b.registry_id else registry_by_name(b.name)
    if entry is None:
        return {"applies": True, "match": False, "reason": "Institution is not in the verified registry"}
    if entry["account_number"] != b.account_number:
        return {
            "applies": True,
            "match": False,
            "registry_id": entry["id"],
            "reason": f"Account {mask_account(b.account_number)} does not match the verified account for {entry['name']}",
        }
    return {"applies": True, "match": True, "registry_id": entry["id"], "institution": entry["name"]}


def to_dict(ctx: Ctx, b: Beneficiary) -> dict[str, Any]:
    active = is_active(ctx, b)
    return {
        "id": b.id,
        "name": b.name,
        "nickname": b.nickname,
        "kind": b.kind,
        "country": b.country,
        "currency": b.currency,
        "bank_name": b.bank_name,
        "account": mask_account(b.account_number),
        "verified": b.verified,
        "registry_verified": bool(b.registry_id) and registry_check(b)["match"],
        "active": active,
        "active_after": b.active_after.isoformat(timespec="seconds") if b.active_after and not active else None,
    }
