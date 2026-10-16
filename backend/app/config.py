from __future__ import annotations

import os
import re
import secrets
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

ROOT_DIR = Path(__file__).resolve().parents[2]
CONFIG_DIR = ROOT_DIR / "config"
KNOWLEDGE_DIR = ROOT_DIR / "knowledge"
FRONTEND_DIST = ROOT_DIR / "frontend" / "dist"
EVALS_DIR = ROOT_DIR / "evals"
EVIDENCE_DIR = ROOT_DIR / "evidence"


def _load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), _dotenv_value(value))


def _dotenv_value(value: str) -> str:
    value = value.strip()
    if value[:1] in ('"', "'") and value.count(value[0]) >= 2:
        return value[1 : value.index(value[0], 1)]
    return re.split(r"\s+#", value, maxsplit=1)[0].strip()


_load_dotenv(ROOT_DIR / ".env")


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default)


def _env_bool(name: str, default: bool) -> bool:
    return _env(name, str(default)).lower() in {"1", "true", "yes", "on"}


def _secret_key() -> str:
    """Signs workspace cookies and token HMACs. Production without SECRET_KEY gets a random per-process key, never the public dev default."""
    key = _env("SECRET_KEY", "")
    if key:
        return key
    if _env("APP_ENV", "development") == "production":
        return secrets.token_hex(32)
    return "dev-only-insecure-secret-change-me"


@dataclass(frozen=True)
class Settings:
    app_env: str = field(default_factory=lambda: _env("APP_ENV", "development"))
    port: int = field(default_factory=lambda: int(_env("PORT", "8000")))
    data_dir: Path = field(default_factory=lambda: Path(_env("DATA_DIR", str(ROOT_DIR / "data"))))
    secret_key: str = field(default_factory=lambda: _secret_key())
    demo_mode: bool = field(default_factory=lambda: _env_bool("DEMO_MODE", True))
    cooling_off_seconds: int = field(default_factory=lambda: int(_env("COOLING_OFF_SECONDS", "60")))
    demo_settle_seconds: int = field(default_factory=lambda: int(_env("DEMO_SETTLE_SECONDS", "12")))
    confirmation_ttl_seconds: int = field(default_factory=lambda: int(_env("CONFIRMATION_TTL_SECONDS", "300")))
    workspace_idle_hours: int = field(default_factory=lambda: int(_env("WORKSPACE_IDLE_HOURS", "24")))
    llm_provider: str = field(default_factory=lambda: _env("LLM_PROVIDER", "gemini"))
    llm_fallback: tuple[str, ...] = field(
        default_factory=lambda: tuple(
            p.strip() for p in _env("LLM_FALLBACK", "gemini,groq,openrouter,ollama,mock").split(",") if p.strip()
        )
    )
    llm_cache: str = field(default_factory=lambda: _env("LLM_CACHE", "replay"))
    llm_timeout_seconds: float = field(default_factory=lambda: float(_env("LLM_TIMEOUT_SECONDS", "30")))
    llm_retry_seconds: float = field(default_factory=lambda: float(_env("LLM_RETRY_SECONDS", "0.8")))
    llm_daily_budget: int = field(default_factory=lambda: int(_env("LLM_DAILY_BUDGET", "400")))
    rate_limit_chat: str = field(default_factory=lambda: _env("RATE_LIMIT_CHAT", "20/minute"))
    rate_limit_default: str = field(default_factory=lambda: _env("RATE_LIMIT_DEFAULT", "120/minute"))
    kb_alpha: float = field(default_factory=lambda: float(_env("KB_ALPHA", "0.6")))
    kb_min_score: float = field(default_factory=lambda: float(_env("KB_MIN_SCORE", "0.35")))
    kb_use_embeddings: bool = field(default_factory=lambda: _env_bool("KB_USE_EMBEDDINGS", True))

    @property
    def db_url(self) -> str:
        return _env("DATABASE_URL", f"sqlite:///{self.data_dir / 'remi.db'}")

    @property
    def cookie_secure(self) -> bool:
        return self.app_env == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()


@lru_cache
def load_yaml(relative: str) -> Any:
    return yaml.safe_load((CONFIG_DIR / relative).read_text())
