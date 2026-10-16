from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from sqlmodel import Session, select

from .. import events
from ..models import Notification, User, Workspace


class DomainError(ValueError):
    """A user-facing, expected failure (bad input, not found, not allowed)."""


@dataclass
class Ctx:
    session: Session
    ws: Workspace
    user: User
    outbox: list[tuple[str, dict[str, Any]]] = field(default_factory=list)
    attachment: str | None = None
    source_flags: list[str] | None = None

    @property
    def ws_id(self) -> str:
        return self.ws.id

    def emit(self, event: str, data: dict[str, Any]) -> None:
        """Queue an SSE event; delivered by flush() after the DB transaction commits."""
        self.outbox.append((event, data))

    def notify(self, kind: str, title: str, body: str = "", data: dict[str, Any] | None = None) -> Notification:
        n = Notification(workspace_id=self.ws_id, user_id=self.user.id, kind=kind, title=title, body=body, data=data or {})
        self.session.add(n)
        self.session.flush()
        self.emit("notification", {"id": n.id, "kind": kind, "title": title, "body": body, "data": n.data})
        return n

    def flush(self) -> None:
        for event, data in self.outbox:
            events.publish(self.ws_id, event, data)
        self.outbox.clear()


def load_ctx(session: Session, workspace_id: str) -> Ctx:
    ws = session.get(Workspace, workspace_id)
    if ws is None or ws.active_user_id is None:
        raise DomainError("Workspace not found")
    user = session.get(User, ws.active_user_id)
    if user is None or user.workspace_id != ws.id:
        raise DomainError("User not found in workspace")
    return Ctx(session=session, ws=ws, user=user)


def users_in(session: Session, workspace_id: str) -> list[User]:
    return list(session.exec(select(User).where(User.workspace_id == workspace_id)).all())
