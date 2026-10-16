"""Free-provider LLM abstraction: one OpenAI-compatible client, a fallback chain, and a record/replay cache."""
from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Protocol

from ..config import EVALS_DIR, get_settings

log = logging.getLogger("remi.llm")

PROVIDERS: dict[str, dict[str, str]] = {
    "gemini": {"base_url": "https://generativelanguage.googleapis.com/v1beta/openai/", "key_env": "GEMINI_API_KEY", "model_env": "GEMINI_MODEL", "default_model": "gemini-3.5-flash-lite"},
    "groq": {"base_url": "https://api.groq.com/openai/v1", "key_env": "GROQ_API_KEY", "model_env": "GROQ_MODEL", "default_model": "openai/gpt-oss-20b"},
    "openrouter": {"base_url": "https://openrouter.ai/api/v1", "key_env": "OPENROUTER_API_KEY", "model_env": "OPENROUTER_MODEL", "default_model": "openai/gpt-oss-20b:free"},
    "ollama": {"base_url_env": "OLLAMA_BASE_URL", "base_url": "http://localhost:11434/v1", "key_env": "", "model_env": "OLLAMA_MODEL", "default_model": "qwen3:4b"},
}


@dataclass
class ToolCall:
    id: str
    name: str
    arguments: str
    # Provider-specific data that must be echoed back with the call (Gemini 3 thought_signature lives here).
    extra: dict[str, Any] | None = None


@dataclass
class ChatResult:
    content: str
    tool_calls: list[ToolCall] = field(default_factory=list)
    provider: str = "mock"
    model: str = "remi-mock-1"
    cached: bool = False


class ChatBackend(Protocol):
    name: str
    model: str

    def available(self) -> bool: ...

    def chat(self, messages: list[dict[str, Any]], tools: list[dict[str, Any]]) -> ChatResult: ...


class ProviderError(RuntimeError):
    pass


class OpenAICompatBackend:
    def __init__(self, name: str) -> None:
        spec = PROVIDERS[name]
        self.name = name
        self.base_url = os.environ.get(spec.get("base_url_env", ""), "") or spec["base_url"]
        self.api_key = os.environ.get(spec["key_env"], "") if spec["key_env"] else "ollama"
        self.model = os.environ.get(spec["model_env"], "") or spec["default_model"]
        self._client: Any = None

    def available(self) -> bool:
        if self.name == "ollama":
            return bool(os.environ.get("OLLAMA_BASE_URL") or os.environ.get("OLLAMA_MODEL"))
        return bool(self.api_key)

    def _get_client(self) -> Any:
        if self._client is None:
            from openai import OpenAI

            self._client = OpenAI(base_url=self.base_url, api_key=self.api_key, timeout=get_settings().llm_timeout_seconds, max_retries=0)
        return self._client

    def chat(self, messages: list[dict[str, Any]], tools: list[dict[str, Any]]) -> ChatResult:
        kwargs: dict[str, Any] = {"model": self.model, "messages": messages, "temperature": 0.2}
        if tools:
            kwargs["tools"] = tools
            kwargs["tool_choice"] = "auto"
        try:
            resp = self._get_client().chat.completions.create(**kwargs)
        except Exception as exc:  # network, 429, 5xx, bad tool schema - all trigger fallback
            raise ProviderError(f"{self.name}: {type(exc).__name__}: {str(exc)[:200]}") from exc
        if not resp.choices:
            raise ProviderError(f"{self.name}: empty response")
        msg = resp.choices[0].message
        calls = [
            ToolCall(id=c.id or f"call_{i}", name=c.function.name, arguments=c.function.arguments or "{}", extra=(c.model_extra or {}).get("extra_content"))
            for i, c in enumerate(msg.tool_calls or [])
        ]
        return ChatResult(content=_strip_thinking(msg.content or ""), tool_calls=calls, provider=self.name, model=self.model)


def _strip_thinking(text: str) -> str:
    return re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()


# ---- record / replay cache -------------------------------------------------

_MASKS = [
    (re.compile(r"\b[0-9a-f]{16}\b"), "<id>"),
    (re.compile(r"\b\d{4}-\d{2}-\d{2}(T[\d:.+-]+)?\b"), "<date>"),
    (re.compile(r"\bRMI-\d{8}-[A-Z0-9]+\b"), "<ref>"),
]


def _mask(text: str) -> str:
    for rx, repl in _MASKS:
        text = rx.sub(repl, text)
    return text


def cache_key(messages: list[dict[str, Any]], tools: list[dict[str, Any]]) -> str:
    """Key on the conversation shape (user text + tool-call sequence), not volatile tool output."""
    shape: list[Any] = [sorted(t["function"]["name"] for t in tools)]
    for m in messages:
        role = m.get("role")
        if role == "system":
            continue
        if role == "tool":
            shape.append(["tool", m.get("name")])
        elif role == "assistant" and m.get("tool_calls"):
            shape.append(["call", [(c["function"]["name"], _mask(c["function"]["arguments"])) for c in m["tool_calls"]]])
        else:
            shape.append([role, _mask(str(m.get("content", "")))])
    return hashlib.sha256(json.dumps(shape, sort_keys=True).encode()).hexdigest()


class ReplayCache:
    def __init__(self, path: Any = None) -> None:
        self.path = path or (EVALS_DIR / "replay_cache.json")
        self._lock = threading.Lock()
        self._data: dict[str, Any] | None = None

    def _load(self) -> dict[str, Any]:
        if self._data is None:
            try:
                self._data = json.loads(self.path.read_text()) if self.path.exists() else {}
            except (OSError, json.JSONDecodeError):
                self._data = {}
        return self._data

    def get(self, key: str) -> ChatResult | None:
        hit = self._load().get(key)
        if not hit:
            return None
        return ChatResult(content=hit["content"], tool_calls=[ToolCall(**c) for c in hit["tool_calls"]], provider=hit["provider"], model=hit["model"], cached=True)

    def put(self, key: str, result: ChatResult) -> None:
        with self._lock:
            data = self._load()
            data[key] = {"content": result.content, "tool_calls": [c.__dict__ for c in result.tool_calls], "provider": result.provider, "model": result.model, "recorded_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self.path.write_text(json.dumps(data, indent=1, sort_keys=True))

    def __len__(self) -> int:
        return len(self._load())


# ---- fallback chain --------------------------------------------------------


class FallbackChain:
    def __init__(self, backends: list[ChatBackend], cache_mode: str = "off", cache: ReplayCache | None = None) -> None:
        self.backends = backends
        self.cache_mode = cache_mode
        self.cache = cache or ReplayCache()
        self.last_errors: list[str] = []

    def chat(self, messages: list[dict[str, Any]], tools: list[dict[str, Any]], *, allow_live: bool = True) -> ChatResult:
        key = cache_key(messages, tools)
        if self.cache_mode == "replay":
            hit = self.cache.get(key)
            if hit:
                return hit
        self.last_errors = []
        for backend in self.backends:
            if not backend.available():
                continue
            if backend.name != "mock" and not allow_live:
                continue
            for attempt in range(2):
                try:
                    result = backend.chat(messages, tools)
                    if self.cache_mode == "record" and backend.name != "mock":
                        self.cache.put(key, result)
                    return result
                except ProviderError as exc:
                    self.last_errors.append(str(exc))
                    log.warning("LLM provider failed: %s", exc)
                    if attempt == 0:
                        time.sleep(get_settings().llm_retry_seconds)
        raise ProviderError("All LLM providers failed: " + " | ".join(self.last_errors[-4:]))


def build_chain(mock: ChatBackend) -> FallbackChain:
    settings = get_settings()
    order = [settings.llm_provider] + [p for p in settings.llm_fallback if p != settings.llm_provider]
    backends: list[ChatBackend] = []
    for name in order:
        if name == "mock":
            backends.append(mock)
        elif name in PROVIDERS:
            backends.append(OpenAICompatBackend(name))
    if not any(b.name == "mock" for b in backends):
        backends.append(mock)
    return FallbackChain(backends, cache_mode=settings.llm_cache)


def provider_status(chain: FallbackChain) -> list[dict[str, Any]]:
    return [{"name": b.name, "model": b.model, "available": b.available()} for b in chain.backends]
