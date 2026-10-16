from __future__ import annotations

from fastapi import FastAPI

from .config import get_settings
from .db import init_db

app = FastAPI(title="Remi API", version="0.1.0")


@app.on_event("startup")
def _startup() -> None:
    init_db()


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "env": get_settings().app_env}
