from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from decimal import Decimal

from sqlalchemy import String, event
from sqlalchemy.engine import Engine
from sqlalchemy.types import TypeDecorator
from sqlmodel import Session, SQLModel, create_engine

from .config import get_settings


class DecimalText(TypeDecorator[Decimal]):
    """Stores Decimal as TEXT so SQLite never coerces money to binary floating point."""

    impl = String
    cache_ok = True

    def process_bind_param(self, value: Decimal | None, dialect: object) -> str | None:
        return None if value is None else str(value)

    def process_result_value(self, value: str | None, dialect: object) -> Decimal | None:
        return None if value is None else Decimal(value)


_engine: Engine | None = None


def get_engine() -> Engine:
    global _engine
    if _engine is None:
        settings = get_settings()
        if settings.db_url.startswith("sqlite:///"):
            settings.data_dir.mkdir(parents=True, exist_ok=True)
        _engine = create_engine(settings.db_url, connect_args={"check_same_thread": False})
        _install_sqlite_pragmas(_engine)
    return _engine


def set_engine(engine: Engine) -> None:
    global _engine
    _install_sqlite_pragmas(engine)
    _engine = engine


def _install_sqlite_pragmas(engine: Engine) -> None:
    if engine.dialect.name != "sqlite":
        return

    @event.listens_for(engine, "connect")
    def _pragmas(dbapi_conn, _record):  # type: ignore[no-untyped-def]
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA foreign_keys=ON")
        cur.close()


def init_db() -> None:
    from . import models  # noqa: F401

    SQLModel.metadata.create_all(get_engine())


@contextmanager
def session_scope() -> Iterator[Session]:
    with Session(get_engine(), expire_on_commit=False) as session:
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise
