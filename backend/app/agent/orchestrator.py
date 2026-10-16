"""Agent loop: guardrails → intent-scoped tools → LLM/tool iterations (max 8 calls) → output validation → persistence."""
from __future__ import annotations

import json
import re
import threading
import time
from typing import Any, Callable

from sqlmodel import col, select

from ..audit import log as audit
from ..config import get_settings
from ..knowledge import retrieval
from ..models import ChatMessage
from ..sandbox.clock import today
from ..security import injection
from ..security.redact import redact_text
from ..services.context import Ctx
from . import guardrails, prompts, tools
from .llm import ChatResult, FallbackChain, ProviderError, ToolCall, build_chain
from .mock import MockAgent

Emit = Callable[[str, dict[str, Any]], None]
HISTORY_TURNS = 10

GROUP_RULES: list[tuple[str, str]] = [
    ("payments", r"\b(send|transfer|pay|wire|remit|tuition|fees?|invoice|landlord|mom|mum|dad|university|college|recipient|payee|beneficiar|provider|quote|cheapest|receive|arrive|deadline|account)\b"),
    ("fx", r"\b(convert|exchange|rate|fx|currency|alert|notify|tell me when|tranche)\b"),
    ("budget", r"\b(budget|spend|spent|spending|runway|last|afford|doing|subscriptions?|transactions?|categor|bills?|obligations?|reminder|remind)\b"),
    ("credit", r"\b(credit|score|card|build)\b"),
    ("docs", r"\b(document|invoice|attached|pdf|email|letter)\b"),
    ("knowledge", r"\b(what|how|why|which|explain|documents|need|should|usually|kyc|scam|fraud|proof)\b"),
]


def classify_groups(text: str, has_attachment: bool) -> set[str]:
    groups = {g for g, rx in GROUP_RULES if re.search(rx, text, re.I)}
    if has_attachment:
        groups |= {"docs", "payments"}
    return groups or {g for g, _ in GROUP_RULES}


class _Budget:
    """Process-wide daily LLM-call budget protecting the free-tier quota on a public deployment."""

    def __init__(self) -> None:
        self.day = ""
        self.count = 0
        self.lock = threading.Lock()

    def take(self, limit: int) -> bool:
        with self.lock:
            d = time.strftime("%Y-%m-%d", time.gmtime())
            if d != self.day:
                self.day, self.count = d, 0
            if self.count >= limit:
                return False
            self.count += 1
            return True


_budget = _Budget()
_mock = MockAgent()
_chain: FallbackChain | None = None


def chain() -> FallbackChain:
    global _chain
    if _chain is None:
        _chain = build_chain(_mock)
    return _chain


def reset_chain() -> None:
    global _chain
    _chain = None


def _history(ctx: Ctx) -> tuple[list[dict[str, Any]], str]:
    rows = list(ctx.session.exec(
        select(ChatMessage).where(ChatMessage.workspace_id == ctx.ws_id, ChatMessage.user_id == ctx.user.id).order_by(col(ChatMessage.id).desc()).limit(HISTORY_TURNS * 2 + 20)
    ).all())[::-1]
    recent, older = rows[-HISTORY_TURNS * 2:], rows[:-HISTORY_TURNS * 2]
    summary = ""
    if older:
        asks = [r.content[:80] for r in older if r.role == "user"][-6:]
        summary = "Earlier in this conversation the user asked about: " + " | ".join(asks)
    return [{"role": r.role, "content": redact_text(r.content)} for r in recent], summary


def _call_message(call: ToolCall) -> dict[str, Any]:
    msg: dict[str, Any] = {"id": call.id, "type": "function", "function": {"name": call.name, "arguments": call.arguments}}
    if call.extra:
        msg["extra_content"] = call.extra
    return msg


def _source_chips(text: str, cards: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Ensure every [KB: title] citation in the answer becomes a clickable source chip."""
    titles = re.findall(r"\[KB:\s*([^\]]+)\]", text)
    existing = {s["slug"] for c in cards if c["type"] == "sources" for s in c["data"]}
    extra = []
    for title in dict.fromkeys(titles):
        slug = retrieval.slug_for_title(title)
        if slug and slug not in existing:
            art = retrieval.get_article(slug)
            extra.append({"slug": slug, "title": art["title"] if art else title, "illustrative": bool(art and art["illustrative"])})
            existing.add(slug)
    if not extra:
        return cards
    for c in cards:
        if c["type"] == "sources":
            c["data"].extend(extra)
            return cards
    return cards + [{"type": "sources", "data": extra}]


def run_turn(ctx: Ctx, text: str, *, attachment: str | None = None, emit: Emit | None = None, allow_live: bool = True) -> dict[str, Any]:
    emit = emit or (lambda _e, _d: None)
    settings = get_settings()
    started = time.time()
    text = (text or "").strip()[:2000]
    ctx.attachment = attachment[:20000] if attachment else None
    ctx.source_flags = [f["label"] for f in injection.scan(attachment).flags] if attachment else None

    history, summary = _history(ctx)
    ctx.session.add(ChatMessage(workspace_id=ctx.ws_id, user_id=ctx.user.id, role="user", content=text + (" [document attached]" if attachment else "")))
    audit.append(ctx.session, ctx.ws_id, "user", "chat.message", inputs={"text": text[:300], "attachment": bool(attachment)}, decision="received")

    pre = guardrails.precheck(text)
    if pre.kind:
        audit.append(ctx.session, ctx.ws_id, "system", "guardrail.refused" if pre.kind != "off_topic" else "guardrail.redirected", inputs={"kind": pre.kind}, decision="refused")
        return _finish(ctx, emit, pre.message, pre.cards, {"provider": "guardrail", "model": "deterministic", "cached": False, "tools": [], "guardrail": pre.kind}, started)

    groups = classify_groups(text, bool(attachment))
    schemas = tools.schemas_for(groups)
    allowed = {s["function"]["name"] for s in schemas}
    system = prompts.build_system(ctx.user, today(ctx.ws).isoformat())
    if summary:
        system += "\n" + summary
    if guardrails.is_speculation(text):
        system += "\nThe user is asking for a prediction: explain you don't forecast rates, then offer fx_conversion_options."
    user_content = text
    if attachment:
        user_content += "\n\n" + injection.wrap_untrusted("uploaded_document", attachment)
    messages: list[dict[str, Any]] = [{"role": "system", "content": system}, *history, {"role": "user", "content": user_content}]

    live_ok = allow_live
    if live_ok and not _budget.take(settings.llm_daily_budget):
        live_ok = False
    cards: list[dict[str, Any]] = []
    used: list[dict[str, Any]] = []
    executed = proposed = False
    result: ChatResult | None = None
    meta: dict[str, Any] = {"tools": used, "demo_mode": not live_ok}
    for _ in range(tools.MAX_TOOL_CALLS_PER_TURN + 1):
        emit("status", {"state": "thinking"})
        try:
            result = chain().chat(messages, schemas, allow_live=live_ok)
        except ProviderError as exc:
            meta["provider_errors"] = str(exc)[:300]
            result = _mock.chat(messages, schemas)
            result.provider, result.model = "mock", _mock.model
        meta.update({"provider": result.provider, "model": result.model, "cached": result.cached})
        if not result.tool_calls:
            break
        if len(used) + len(result.tool_calls) > tools.MAX_TOOL_CALLS_PER_TURN:
            audit.append(ctx.session, ctx.ws_id, "system", "agent.tool_cap", inputs={"calls": len(used)}, decision="stopped")
            result = ChatResult(content="I stopped here to stay within my safety limit of 8 tool calls per request. Could you narrow the request down?", provider=result.provider, model=result.model)
            break
        messages.append({"role": "assistant", "content": result.content or None, "tool_calls": [_call_message(c) for c in result.tool_calls]})
        for call in result.tool_calls:
            try:
                args = json.loads(call.arguments or "{}")
                if not isinstance(args, dict):
                    raise ValueError
            except ValueError:
                args = {}
            tier = tools.REGISTRY[call.name].tier if call.name in tools.REGISTRY else "?"
            emit("tool", {"name": call.name, "tier": tier, "state": "running"})
            out = tools.run_tool(ctx, call.name, args, allowed=allowed)
            cards.extend(out.cards)
            if call.name.startswith("propose_") and not out.data.get("error"):
                proposed = True
            if out.data.get("status") == "executed":
                executed = True
            used.append({"name": call.name, "tier": tier, "ok": "error" not in out.data})
            emit("tool", {"name": call.name, "tier": tier, "state": "done", "ok": "error" not in out.data})
            content = json.dumps(out.data, default=str)
            messages.append({"role": "tool", "tool_call_id": call.id, "name": call.name, "content": content[:12000]})
    final = (result.content if result else "") or "I couldn't complete that request."
    final = guardrails.validate_output(final, executed, proposed)
    if any(u["name"] == "search_knowledge" for u in used) and "[KB:" not in final:
        src = next((c for c in cards if c["type"] == "sources"), None)
        if src and src["data"]:
            final += "\n\nSources: " + " ".join(f"[KB: {s['title']}]" for s in src["data"][:2])
    illustrative = any(s.get("illustrative") for c in cards if c["type"] == "sources" for s in c["data"])
    if illustrative and not re.search(r"illustrative|verify|official", final, re.I):
        final += "\n\n_Illustrative general information - verify with your university, bank and official sources._"
    cards = _source_chips(final, cards)
    return _finish(ctx, emit, final, cards, meta, started)


def _finish(ctx: Ctx, emit: Emit, text: str, cards: list[dict[str, Any]], meta: dict[str, Any], started: float) -> dict[str, Any]:
    meta["latency_ms"] = int((time.time() - started) * 1000)
    emit("cards", {"cards": cards})
    for i in range(0, len(text), 24):
        emit("delta", {"text": text[i:i + 24]})
    msg = ChatMessage(workspace_id=ctx.ws_id, user_id=ctx.user.id, role="assistant", content=text, cards=_cards_for_storage(cards), meta=meta)
    ctx.session.add(msg)
    ctx.session.flush()
    audit.append(ctx.session, ctx.ws_id, "agent", "chat.reply", inputs={"tools": [u["name"] for u in meta.get("tools", [])]}, decision="replied", result={"provider": meta.get("provider"), "model": meta.get("model"), "cached": meta.get("cached")})
    out = {"message_id": msg.id, "text": text, "cards": cards, "meta": meta}
    emit("done", {"message_id": msg.id, "meta": meta})
    return out


def _cards_for_storage(cards: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Tokens are never persisted in chat history; a reloaded card fetches a fresh view of the action."""
    stored = []
    for c in cards:
        if c["type"] == "action":
            data = {k: v for k, v in c["data"].items() if k != "confirm_token"}
            stored.append({"type": "action", "data": data})
        else:
            stored.append(c)
    return json.loads(json.dumps(stored, default=str))

