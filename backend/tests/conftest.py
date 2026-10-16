from __future__ import annotations

import os

os.environ.setdefault("SANDBOX_FIXED_NOW", "2026-10-14T10:00:00Z")
os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("LLM_PROVIDER", "mock")
os.environ.setdefault("LLM_FALLBACK", "mock")
os.environ.setdefault("LLM_CACHE", "off")
os.environ.setdefault("KB_USE_EMBEDDINGS", "false")
os.environ.setdefault("SECRET_KEY", "test-secret")
os.environ.setdefault("COOLING_OFF_SECONDS", "60")

from collections.abc import Iterator

import pytest
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app import db
from app.sandbox import workspaces
from app.services.context import Ctx, load_ctx


@pytest.fixture()
def engine():
    eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    db.set_engine(eng)
    from app import models  # noqa: F401

    SQLModel.metadata.create_all(eng)
    yield eng
    eng.dispose()


@pytest.fixture()
def session(engine) -> Iterator[Session]:
    with Session(engine, expire_on_commit=False) as s:
        yield s
        s.rollback()


@pytest.fixture()
def ctx(session: Session) -> Ctx:
    ws = workspaces.create(session)
    return load_ctx(session, ws.id)


def switch(ctx: Ctx, persona: str) -> Ctx:
    workspaces.switch_persona(ctx.session, ctx.ws, persona)
    return load_ctx(ctx.session, ctx.ws.id)
