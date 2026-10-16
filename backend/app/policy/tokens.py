"""Confirmation tokens and simulated OTPs.

A confirmation token is a 256-bit random secret handed only to the UI (never to the LLM). The server stores
HMAC(secret_key, token | action_id | payload_hash), so a token is bound to one exact action: changing any
field of the payload changes payload_hash and the token no longer verifies. Tokens are single-use and expire.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import secrets
from datetime import datetime, timedelta
from typing import Any

from ..config import get_settings


def payload_hash(payload: dict[str, Any]) -> str:
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str).encode()).hexdigest()


def _mac(*parts: str) -> str:
    return hmac.new(get_settings().secret_key.encode(), "|".join(parts).encode(), hashlib.sha256).hexdigest()


def issue_token(action_id: str, p_hash: str, at: datetime) -> tuple[str, str, datetime]:
    token = secrets.token_urlsafe(32)
    return token, _mac("confirm", token, action_id, p_hash), at + timedelta(seconds=get_settings().confirmation_ttl_seconds)


def token_matches(token: str, action_id: str, p_hash: str, stored: str | None) -> bool:
    if not stored or not token:
        return False
    return hmac.compare_digest(_mac("confirm", token, action_id, p_hash), stored)


def issue_otp(action_id: str, at: datetime, ttl_seconds: int = 180) -> tuple[str, str, datetime]:
    code = f"{secrets.randbelow(1_000_000):06d}"
    return code, _mac("otp", code, action_id), at + timedelta(seconds=ttl_seconds)


def otp_matches(code: str, action_id: str, stored: str | None) -> bool:
    if not stored or not code:
        return False
    return hmac.compare_digest(_mac("otp", code.strip(), action_id), stored)
