from __future__ import annotations

import re
from typing import Any

SECRET_KEYS = {"token", "confirm_token", "otp", "code", "secret", "api_key", "password", "token_hash", "otp_hash"}
ACCOUNT_KEYS = {"account_number", "iban", "account"}

_ACCOUNT_RE = re.compile(r"\b(?=[A-Z0-9]*\d)[A-Z]{0,4}\d[A-Z0-9]{8,30}\b")
_EMAIL_RE = re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.-]+\b")
_PHONE_RE = re.compile(r"(?<!\w)\+?\d[\d ()-]{8,}\d\b")


def mask_account(value: str) -> str:
    clean = re.sub(r"\s", "", value or "")
    if len(clean) <= 4:
        return "••••"
    return f"••••{clean[-4:]}"


def redact_text(text: str) -> str:
    text = _EMAIL_RE.sub("[email]", text)
    text = _ACCOUNT_RE.sub(lambda m: mask_account(m.group(0)), text)
    return _PHONE_RE.sub("[phone]", text)


def redact(obj: Any) -> Any:
    """Recursive redaction for audit logs and LLM-bound payloads: secrets removed, accounts masked."""
    if isinstance(obj, dict):
        out: dict[str, Any] = {}
        for key, value in obj.items():
            lowered = str(key).lower()
            if lowered in SECRET_KEYS:
                out[key] = "[REDACTED]"
            elif lowered in ACCOUNT_KEYS and isinstance(value, str):
                out[key] = mask_account(value)
            else:
                out[key] = redact(value)
        return out
    if isinstance(obj, list):
        return [redact(v) for v in obj]
    if isinstance(obj, str):
        return redact_text(obj)
    return obj
