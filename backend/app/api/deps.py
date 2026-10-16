from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

from fastapi import Request, Response
from itsdangerous import BadSignature, URLSafeSerializer

from ..config import get_settings
from ..db import session_scope
from ..models import Workspace
from ..sandbox import workspaces
from ..services import automation
from ..services.context import Ctx, load_ctx

COOKIE = "remi_ws"
HEADER = "X-Remi-Workspace"


def _serializer() -> URLSafeSerializer:
    return URLSafeSerializer(get_settings().secret_key, salt="remi-workspace")


def sign(workspace_id: str) -> str:
    return _serializer().dumps(workspace_id)


def unsign(value: str | None) -> str | None:
    if not value:
        return None
    try:
        return str(_serializer().loads(value))
    except BadSignature:
        return None


def client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def workspace_id_from(request: Request) -> str | None:
    return unsign(request.headers.get(HEADER)) or unsign(request.cookies.get(COOKIE))


@contextmanager
def uow(request: Request, response: Response | None = None, *, housekeeping: bool = True) -> Iterator[Ctx]:
    """One request = one DB transaction scoped to the caller's signed workspace. SSE events go out after commit."""
    ctx: Ctx | None = None
    with session_scope() as session:
        ws_id = workspace_id_from(request)
        ws = session.get(Workspace, ws_id) if ws_id else None
        if ws is None:
            ws = workspaces.create(session)
            if response is not None:
                settings = get_settings()
                response.set_cookie(COOKIE, sign(ws.id), httponly=True, samesite="lax", secure=settings.cookie_secure, max_age=60 * 60 * 24 * 7)
                response.headers[HEADER] = sign(ws.id)
        workspaces.touch(ws)
        ctx = load_ctx(session, ws.id)
        if housekeeping:
            automation.housekeeping(ctx)
        yield ctx
    if ctx is not None:
        ctx.flush()
