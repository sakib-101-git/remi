from __future__ import annotations

from slowapi import Limiter
from starlette.requests import Request

from ..config import get_settings
from .deps import client_ip, workspace_id_from


def _key(request: Request) -> str:
    # Per-IP plus per-workspace keying: one visitor can't exhaust the budget for everyone behind the same NAT.
    return f"{client_ip(request)}|{workspace_id_from(request) or '-'}"


limiter = Limiter(key_func=_key, default_limits=[get_settings().rate_limit_default], headers_enabled=False)
