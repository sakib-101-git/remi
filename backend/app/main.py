from __future__ import annotations

import asyncio
import logging
import threading
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from . import events
from .api.limiter import limiter
from .api.routes import router
from .config import FRONTEND_DIST, get_settings
from .db import init_db, session_scope
from .knowledge import retrieval
from .policy.actions import PolicyViolation
from .sandbox import workspaces
from .services import automation
from .services.context import DomainError, load_ctx

log = logging.getLogger("remi")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


async def _background() -> None:
    """Settle transfers, release cooling-off payments and clean idle workspaces for live visitors."""
    ticks = 0
    while True:
        await asyncio.sleep(2)
        ticks += 1
        for ws_id in list(events._subscribers.keys()):
            try:
                await asyncio.to_thread(_housekeep, ws_id)
            except Exception as exc:  # keep the loop alive no matter what one workspace does
                log.warning("housekeeping failed for %s: %s", ws_id[:6], exc)
        if ticks % 1800 == 0:
            await asyncio.to_thread(_cleanup)


def _housekeep(ws_id: str) -> None:
    ctx = None
    with session_scope() as s:
        ctx = load_ctx(s, ws_id)
        automation.housekeeping(ctx)
    ctx.flush()


def _cleanup() -> None:
    with session_scope() as s:
        removed = workspaces.cleanup_idle(s, get_settings().workspace_idle_hours)
    if removed:
        log.info("Removed %d idle workspaces", removed)


@asynccontextmanager
async def lifespan(app: FastAPI):  # type: ignore[no-untyped-def]
    init_db()
    events.bind_loop(asyncio.get_running_loop())
    threading.Thread(target=retrieval.get_index, daemon=True, name="kb-index").start()
    task = asyncio.create_task(_background())
    yield
    task.cancel()


app = FastAPI(title="Remi API", version="1.0.0", lifespan=lifespan, docs_url="/api/docs", openapi_url="/api/openapi.json")
app.state.limiter = limiter
app.add_middleware(SlowAPIMiddleware)
app.include_router(router)


@app.middleware("http")
async def security_headers(request: Request, call_next: Any) -> Any:
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
    if not request.url.path.startswith("/api/docs"):
        response.headers.setdefault(
            "Content-Security-Policy",
            "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; connect-src 'self'; frame-ancestors 'self' https://*.hf.space https://huggingface.co",
        )
    return response


@app.exception_handler(PolicyViolation)
async def _policy(_: Request, exc: PolicyViolation) -> JSONResponse:
    return JSONResponse({"error": str(exc), "kind": "policy"}, status_code=409)


@app.exception_handler(DomainError)
async def _domain(_: Request, exc: DomainError) -> JSONResponse:
    return JSONResponse({"error": str(exc)}, status_code=400)


@app.exception_handler(RateLimitExceeded)
async def _ratelimit(_: Request, exc: RateLimitExceeded) -> JSONResponse:
    return JSONResponse({"error": "Too many requests - slow down a little (sandbox rate limit).", "detail": str(exc.detail)}, status_code=429)


if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str) -> FileResponse:
        target = (FRONTEND_DIST / path).resolve()
        if path and target.is_file() and FRONTEND_DIST.resolve() in target.parents:
            return FileResponse(target)
        return FileResponse(FRONTEND_DIST / "index.html")
