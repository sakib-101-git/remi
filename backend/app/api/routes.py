from __future__ import annotations

import asyncio
import json
from decimal import Decimal
from typing import Any, Literal

from fastapi import APIRouter, Header, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse
from sqlmodel import col, select

from .. import events
from ..agent import orchestrator
from ..agent.llm import provider_status
from ..audit import log as audit
from ..config import get_settings
from ..db import session_scope
from ..knowledge import retrieval
from ..models import AuditEntry, ChatMessage, Notification, PendingAction
from ..policy import actions, governance, idempotency
from ..policy import limits as lim
from ..policy.engine import TIERS
from ..sandbox import controls, fx, workspaces
from ..sandbox.clock import now
from ..sandbox.seed import personas
from ..services import alerts, beneficiaries as bene, budget, credit, invoices, quotes, wallets
from ..services.context import Ctx, DomainError, users_in
from .deps import HEADER, sign, uow
from .limiter import limiter

router = APIRouter(prefix="/api")


def _session_payload(ctx: Ctx) -> dict[str, Any]:
    settings = get_settings()
    users = [
        {"persona": u.persona, "name": u.name, "tagline": u.profile.get("tagline"), "reporting_currency": u.reporting_currency, "host_country": u.host_country}
        for u in sorted(users_in(ctx.session, ctx.ws_id), key=lambda x: list(personas()).index(x.persona))
    ]
    return {
        "workspace_token": sign(ctx.ws_id),
        "persona": ctx.user.persona,
        "user": {"name": ctx.user.name, "tagline": ctx.user.profile.get("tagline"), "home_country": ctx.user.home_country, "host_country": ctx.user.host_country, "university": ctx.user.university, "reporting_currency": ctx.user.reporting_currency, "kyc_status": ctx.user.kyc_status, "student_id": ctx.user.profile.get("student_id")},
        "personas": users,
        "consent_given": ctx.ws.consent_given,
        "agent_paused": ctx.ws.agent_paused,
        "sim_now": now(ctx.ws).isoformat(timespec="seconds"),
        "clock_offset_seconds": ctx.ws.clock_offset_seconds,
        "demo_mode": settings.demo_mode,
        "llm": {"providers": provider_status(orchestrator.chain()), "cache_mode": settings.llm_cache, "primary": settings.llm_provider},
        "disclaimer": "Sandbox demo. Not financial, legal or tax advice. No real money moves.",
    }


# ---- session ---------------------------------------------------------------

@router.get("/session")
def get_session(request: Request, response: Response) -> dict[str, Any]:
    with uow(request, response) as ctx:
        return _session_payload(ctx)


class ConsentIn(BaseModel):
    accepted: bool


@router.post("/session/consent")
def consent(body: ConsentIn, request: Request, response: Response) -> dict[str, Any]:
    with uow(request, response) as ctx:
        ctx.ws.consent_given = body.accepted
        audit.append(ctx.session, ctx.ws_id, "user", "consent.recorded", inputs={"accepted": body.accepted}, decision="ok")
        return _session_payload(ctx)


class PersonaIn(BaseModel):
    persona: str


@router.post("/session/persona")
def switch_persona(body: PersonaIn, request: Request, response: Response) -> dict[str, Any]:
    with uow(request, response) as ctx:
        workspaces.switch_persona(ctx.session, ctx.ws, body.persona)
    with uow(request, response) as ctx:
        return _session_payload(ctx)


@router.post("/session/reset")
def reset(request: Request, response: Response) -> dict[str, Any]:
    with uow(request, response, housekeeping=False) as ctx:
        persona = ctx.user.persona
        consent_given = ctx.ws.consent_given
        workspaces.reset(ctx.session, ctx.ws)
        ctx.ws.consent_given = consent_given
        if persona != "rahim":
            workspaces.switch_persona(ctx.session, ctx.ws, persona)
        ctx.emit("reset", {})
    with uow(request, response) as ctx:
        return _session_payload(ctx)


# ---- read models (T0) --------------------------------------------------------

@router.get("/dashboard")
def dashboard(request: Request, response: Response) -> dict[str, Any]:
    with uow(request, response) as ctx:
        open_actions = ctx.session.exec(select(PendingAction).where(PendingAction.workspace_id == ctx.ws_id, PendingAction.user_id == ctx.user.id, col(PendingAction.status).in_(actions.OPEN_STATES))).all()
        return {
            "wallets": wallets.summary(ctx),
            "runway": budget.runway(ctx),
            "obligations": budget.obligations(ctx, within_days=90),
            "recent": [wallets.txn_to_dict(t) for t in wallets.transactions(ctx, limit=8)],
            "alerts": alerts.list_alerts(ctx),
            "open_actions": [actions.public(ctx, a) for a in open_actions],
            "credit": {k: v for k, v in credit.plan(ctx).items() if k in ("readiness_score", "readiness_label", "saved", "country")},
        }


@router.get("/wallets")
def get_wallets(request: Request, response: Response) -> dict[str, Any]:
    with uow(request, response) as ctx:
        return wallets.summary(ctx)


@router.get("/transactions")
def get_transactions(request: Request, response: Response, limit: int = 50, currency: str | None = None) -> list[dict[str, Any]]:
    with uow(request, response) as ctx:
        return [wallets.txn_to_dict(t) for t in wallets.transactions(ctx, limit=limit, currency=currency)]


@router.get("/beneficiaries")
def get_beneficiaries(request: Request, response: Response) -> list[dict[str, Any]]:
    with uow(request, response) as ctx:
        return [bene.to_dict(ctx, b) for b in bene.all_for_user(ctx)]


@router.get("/budget")
def get_budget(request: Request, response: Response) -> dict[str, Any]:
    with uow(request, response) as ctx:
        return budget.summary(ctx)


class BudgetIn(BaseModel):
    category: str = Field(..., max_length=40)
    monthly_limit: str
    currency: str | None = None


@router.post("/budgets")
def create_budget(body: BudgetIn, request: Request, response: Response) -> dict[str, Any]:
    with uow(request, response) as ctx:
        out = budget.create_budget(ctx, body.category, Decimal(body.monthly_limit), body.currency)
        audit.append(ctx.session, ctx.ws_id, "user", "budget.saved", tier="T1", inputs=body.model_dump(), decision="ok")
        return out


@router.get("/credit")
def get_credit(request: Request, response: Response) -> dict[str, Any]:
    with uow(request, response) as ctx:
        return credit.plan(ctx)


@router.post("/credit/create")
def create_credit(request: Request, response: Response) -> dict[str, Any]:
    with uow(request, response) as ctx:
        out = credit.create(ctx)
        audit.append(ctx.session, ctx.ws_id, "user", "credit.plan_created", tier="T1", decision="ok")
        return out


class CreditTaskIn(BaseModel):
    status: Literal["todo", "in_progress", "done"]


@router.post("/credit/tasks/{task_key}")
def update_credit_task(task_key: str, body: CreditTaskIn, request: Request, response: Response) -> dict[str, Any]:
    with uow(request, response) as ctx:
        credit.update(ctx, task_key, body.status)
        audit.append(ctx.session, ctx.ws_id, "user", "credit.task_updated", tier="T1", inputs={"task": task_key, "status": body.status}, decision="ok")
        return credit.plan(ctx)


@router.get("/fx/rates")
def get_rates(request: Request, response: Response) -> dict[str, Any]:
    with uow(request, response) as ctx:
        rates = fx.current_rates(ctx.ws)
        home = {"BD": "BDT", "NG": "NGN", "IN": "INR"}.get(ctx.user.home_country, "USD")
        rep = ctx.user.reporting_currency
        pairs = [(rep, home), ("USD", home), ("USD", rep), (rep, "USD")]
        return {
            "label": fx.fx_config()["label"], "snapshot_date": fx.fx_config()["snapshot_date"], "tick": ctx.ws.fx_tick, "timestamp": now(ctx.ws).isoformat(timespec="seconds"),
            "usd_rates": {k: str(v) for k, v in rates.items()},
            "pairs": [{"pair": f"{b}/{q}", "rate": str(fx.cross(rates, b, q).quantize(Decimal('0.0001'))), "snapshot": str(fx.cross(fx.snapshot_rates(), b, q).quantize(Decimal('0.0001')))} for b, q in pairs if b != q],
        }


class QuoteIn(BaseModel):
    recipient: str | None = None
    send_currency: str | None = None
    receive_currency: str | None = None
    amount: str
    amount_mode: Literal["send", "receive"] = "send"
    goal: Literal["cheapest", "fastest", "balanced"] = "cheapest"
    deadline: str | None = None


@router.post("/quotes")
def post_quotes(body: QuoteIn, request: Request, response: Response) -> dict[str, Any]:
    from datetime import date

    with uow(request, response) as ctx:
        is_tuition, registry_ok = False, False
        recv, send = body.receive_currency, body.send_currency
        deadline = date.fromisoformat(body.deadline) if body.deadline else None
        if body.recipient:
            b = bene.get(ctx, body.recipient) if len(body.recipient) == 16 else bene.find(ctx, body.recipient)
            if b is None:
                raise DomainError("Unknown recipient")
            from ..services.payments import choose_source_currency

            is_tuition = b.kind == "university"
            reg = bene.registry_check(b)
            registry_ok = reg["applies"] and reg["match"]
            recv = b.currency
            send = send or choose_source_currency(ctx, b, is_tuition)
            if is_tuition and deadline is None:
                inv = invoices.open_invoices(ctx)
                deadline = inv[0].due_date if inv else None
        if not send or not recv:
            raise DomainError("send_currency and receive_currency are required")
        amount = Decimal(body.amount)
        kwargs = {"receive_amount": amount} if body.amount_mode == "receive" else {"send_amount": amount}
        return quotes.compare(ctx.ws, send.upper(), recv.upper(), deadline=deadline, goal=body.goal, is_tuition=is_tuition, payee_is_registry=registry_ok, **kwargs)


@router.get("/providers")
def get_providers() -> list[dict[str, Any]]:
    return [{"id": p.id, "name": p.name, "channel": p.channel, "markup_pct": str(p.markup * 100), "fee_fixed_usd": str(p.fee_fixed_usd), "fee_pct": str(p.fee_pct * 100), "days": f"{p.min_days}-{p.max_days}", "max_amount_usd": str(p.max_amount_usd), "tuition": p.supports_tuition, "blurb": p.blurb} for p in quotes.providers()]


@router.get("/invoices")
def get_invoices(request: Request, response: Response) -> list[dict[str, Any]]:
    with uow(request, response) as ctx:
        return [{**invoices.to_dict(i), "raw_text": i.raw_text} for i in invoices.open_invoices(ctx)]


@router.get("/alerts")
def get_alerts(request: Request, response: Response) -> list[dict[str, Any]]:
    with uow(request, response) as ctx:
        return alerts.list_alerts(ctx)


@router.post("/alerts/{alert_id}/cancel")
def cancel_alert(alert_id: str, request: Request, response: Response) -> dict[str, Any]:
    with uow(request, response) as ctx:
        out = alerts.cancel(ctx, alert_id)
        audit.append(ctx.session, ctx.ws_id, "user", "alert.cancelled", tier="T1", inputs={"alert_id": alert_id}, decision="ok")
        return out


@router.get("/notifications")
def get_notifications(request: Request, response: Response) -> list[dict[str, Any]]:
    with uow(request, response) as ctx:
        rows = ctx.session.exec(select(Notification).where(Notification.workspace_id == ctx.ws_id).order_by(col(Notification.id).desc()).limit(30)).all()
        return [{"id": n.id, "kind": n.kind, "title": n.title, "body": n.body, "data": n.data, "created_at": n.created_at.isoformat(timespec="seconds")} for n in rows]


# ---- chat ----------------------------------------------------------------------

class ChatIn(BaseModel):
    message: str = Field(..., max_length=2000)
    attachment_text: str | None = Field(None, max_length=20000)


@router.get("/chat/history")
def chat_history(request: Request, response: Response) -> list[dict[str, Any]]:
    with uow(request, response) as ctx:
        rows = ctx.session.exec(select(ChatMessage).where(ChatMessage.workspace_id == ctx.ws_id, ChatMessage.user_id == ctx.user.id).order_by(col(ChatMessage.id))).all()
        out = []
        for r in rows[-60:]:
            cards = []
            for c in r.cards:
                if c["type"] == "action":
                    a = ctx.session.get(PendingAction, c["data"]["id"])
                    cards.append({"type": "action", "data": actions.public(ctx, a) if a else c["data"]})
                else:
                    cards.append(c)
            out.append({"id": r.id, "role": r.role, "content": r.content, "cards": cards, "meta": r.meta, "created_at": r.created_at.isoformat(timespec="seconds")})
        return out


@router.post("/chat")
@limiter.limit(lambda: get_settings().rate_limit_chat)
async def chat(request: Request, body: ChatIn) -> EventSourceResponse:
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()

    def emit(event: str, data: dict[str, Any]) -> None:
        loop.call_soon_threadsafe(queue.put_nowait, {"event": event, "data": json.dumps(data, default=str)})

    def work() -> None:
        try:
            with uow(request) as ctx:
                orchestrator.run_turn(ctx, body.message, attachment=body.attachment_text, emit=emit)
        except DomainError as exc:
            emit("error", {"message": str(exc)})
        except Exception as exc:  # never leak a stack trace to the client
            emit("error", {"message": "Something went wrong while handling that request.", "type": type(exc).__name__})
        finally:
            loop.call_soon_threadsafe(queue.put_nowait, None)

    async def stream():
        task = asyncio.create_task(asyncio.to_thread(work))
        while True:
            item = await queue.get()
            if item is None:
                break
            yield item
        await task

    return EventSourceResponse(stream(), ping=15)


# ---- actions (human-only endpoints) --------------------------------------------------

class ConfirmIn(BaseModel):
    token: str = Field(..., max_length=200)


class StepUpIn(BaseModel):
    code: str = Field(..., max_length=12)


def _idempotent(ctx: Ctx, key: str | None, endpoint: str, body: dict[str, Any], fn: Any) -> dict[str, Any]:
    cached = idempotency.lookup(ctx.session, ctx.ws_id, key or "", endpoint, body)
    if cached is not None:
        return {**cached, "idempotent_replay": True}
    try:
        result = fn()
    except actions.PolicyViolation as exc:
        result = {"error": str(exc), "status": "rejected"}
    idempotency.store(ctx.session, ctx.ws_id, key or "", endpoint, body, result)
    return result


@router.get("/actions")
def list_actions(request: Request, response: Response, open_only: bool = False) -> list[dict[str, Any]]:
    with uow(request, response) as ctx:
        stmt = select(PendingAction).where(PendingAction.workspace_id == ctx.ws_id, PendingAction.user_id == ctx.user.id)
        if open_only:
            stmt = stmt.where(col(PendingAction.status).in_(actions.OPEN_STATES))
        rows = ctx.session.exec(stmt.order_by(col(PendingAction.created_at).desc()).limit(40)).all()
        return [actions.public(ctx, a) for a in rows if a.kind != "governance_limits"]


@router.post("/actions/{action_id}/confirm")
def confirm_action(action_id: str, body: ConfirmIn, request: Request, response: Response, idempotency_key: str | None = Header(None)) -> JSONResponse:
    with uow(request, response) as ctx:
        out = _idempotent(ctx, idempotency_key, f"confirm:{action_id}", body.model_dump(), lambda: actions.confirm(ctx, action_id, body.token))
    return JSONResponse(out, status_code=409 if out.get("status") == "rejected" else 200)


@router.post("/actions/{action_id}/stepup")
def stepup_action(action_id: str, body: StepUpIn, request: Request, response: Response, idempotency_key: str | None = Header(None)) -> JSONResponse:
    with uow(request, response) as ctx:
        out = _idempotent(ctx, idempotency_key, f"stepup:{action_id}", body.model_dump(), lambda: actions.step_up(ctx, action_id, body.code))
    return JSONResponse(out, status_code=409 if out.get("status") == "rejected" else 200)


@router.post("/actions/{action_id}/cancel")
def cancel_action(action_id: str, request: Request, response: Response) -> dict[str, Any]:
    with uow(request, response) as ctx:
        return actions.cancel(ctx, action_id)


# ---- audit ---------------------------------------------------------------------

@router.get("/audit")
def get_audit(request: Request, response: Response, limit: int = 100) -> dict[str, Any]:
    with uow(request, response, housekeeping=False) as ctx:
        rows = ctx.session.exec(select(AuditEntry).where(AuditEntry.workspace_id == ctx.ws_id).order_by(col(AuditEntry.seq).desc()).limit(min(limit, 500))).all()
        return {"verification": audit.verify(ctx.session, ctx.ws_id), "entries": [e.model_dump(exclude={"id", "workspace_id"}) for e in rows]}


@router.get("/audit/verify")
def verify_audit(request: Request, response: Response) -> dict[str, Any]:
    with uow(request, response, housekeeping=False) as ctx:
        return audit.verify(ctx.session, ctx.ws_id)


@router.get("/audit/export")
def export_audit(request: Request, response: Response) -> JSONResponse:
    with uow(request, response, housekeeping=False) as ctx:
        data = audit.export(ctx.session, ctx.ws_id)
    return JSONResponse(json.loads(json.dumps(data, default=str)), headers={"Content-Disposition": "attachment; filename=remi_audit_export.json"})


# ---- settings / governance (T4, human only) ----------------------------------------------

@router.get("/settings")
def get_settings_view(request: Request, response: Response) -> dict[str, Any]:
    with uow(request, response) as ctx:
        from ..agent.tools import REGISTRY

        return {
            "limits": lim.to_public(ctx),
            "tiers": TIERS,
            "tools": [{"name": t.name, "tier": t.tier, "description": t.description} for t in REGISTRY.values()],
            "agent_paused": ctx.ws.agent_paused,
            "cooling_off_seconds": get_settings().cooling_off_seconds,
            "confirmation_ttl_seconds": get_settings().confirmation_ttl_seconds,
        }


class KillIn(BaseModel):
    paused: bool


@router.post("/settings/kill-switch")
def kill_switch(body: KillIn, request: Request, response: Response) -> dict[str, Any]:
    with uow(request, response) as ctx:
        return governance.set_kill_switch(ctx, body.paused)


class LimitsIn(BaseModel):
    changes: dict[str, str]


@router.post("/settings/limits")
def request_limits(body: LimitsIn, request: Request, response: Response) -> dict[str, Any]:
    with uow(request, response) as ctx:
        return governance.request_limit_change(ctx, body.changes)


@router.post("/settings/limits/{action_id}/verify")
def verify_limits(action_id: str, body: StepUpIn, request: Request, response: Response) -> dict[str, Any]:
    with uow(request, response) as ctx:
        return governance.verify_limit_change(ctx, action_id, body.code)


@router.post("/settings/limits/reset")
def reset_limits(request: Request, response: Response) -> dict[str, Any]:
    with uow(request, response) as ctx:
        return governance.reset_limits(ctx)


# ---- sandbox control panel -------------------------------------------------------------

class AdvanceIn(BaseModel):
    hours: int = Field(24, ge=1, le=1440)


class TickIn(BaseModel):
    steps: int = Field(1, ge=1, le=50)
    shock_currency: str | None = None
    shock_pct: str | None = None


class InjectIn(BaseModel):
    amount: str | None = None
    currency: str | None = None


@router.post("/sandbox/advance")
def sandbox_advance(body: AdvanceIn, request: Request, response: Response) -> dict[str, Any]:
    with uow(request, response) as ctx:
        return controls.advance_time(ctx, body.hours)


@router.post("/sandbox/tick")
def sandbox_tick(body: TickIn, request: Request, response: Response) -> dict[str, Any]:
    with uow(request, response) as ctx:
        return controls.tick(ctx, body.steps, body.shock_currency, Decimal(body.shock_pct) if body.shock_pct else None)


@router.post("/sandbox/inject-remittance")
def sandbox_inject(body: InjectIn, request: Request, response: Response) -> dict[str, Any]:
    with uow(request, response) as ctx:
        return controls.inject_remittance(ctx, Decimal(body.amount) if body.amount else None, body.currency)


@router.post("/sandbox/inject-invoice")
def sandbox_invoice(request: Request, response: Response) -> dict[str, Any]:
    with uow(request, response) as ctx:
        return controls.inject_suspicious_invoice(ctx)


# ---- knowledge -----------------------------------------------------------------

@router.get("/knowledge")
def kb_list() -> list[dict[str, Any]]:
    return retrieval.list_articles()


@router.get("/knowledge/{slug}")
def kb_get(slug: str) -> dict[str, Any]:
    art = retrieval.get_article(slug)
    if art is None:
        raise HTTPException(404, "Article not found")
    return art


# ---- live events (SSE) -----------------------------------------------------------

@router.get("/events")
async def live_events(request: Request) -> EventSourceResponse:
    from .deps import workspace_id_from

    ws_id = workspace_id_from(request)
    if not ws_id:
        raise HTTPException(401, "No workspace")
    queue = events.subscribe(ws_id)

    async def stream():
        try:
            yield {"event": "hello", "data": json.dumps({"workspace": "ok"})}
            while not await request.is_disconnected():
                try:
                    msg = await asyncio.wait_for(queue.get(), timeout=10)
                except asyncio.TimeoutError:
                    continue
                payload = json.loads(msg)
                yield {"event": payload["event"], "data": json.dumps(payload["data"], default=str)}
        finally:
            events.unsubscribe(ws_id, queue)

    return EventSourceResponse(stream(), ping=15)


@router.get("/health")
def health() -> dict[str, Any]:
    settings = get_settings()
    with session_scope() as s:
        s.exec(select(AuditEntry.id).limit(1)).all()
    return {"status": "ok", "env": settings.app_env, "demo_mode": settings.demo_mode, "llm_primary": settings.llm_provider, "cache_mode": settings.llm_cache, "header": HEADER}
