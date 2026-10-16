"""Cross-border payment proposals, execution and settlement (sandbox ledger)."""
from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any

from sqlmodel import col, select

from ..config import get_settings
from ..models import Beneficiary, Invoice, Obligation, Transaction
from ..money import D, q_money, rate_display
from ..sandbox import ledger
from ..sandbox.clock import aware, now, real_now
from ..security.redact import mask_account
from . import beneficiaries as bene
from . import compliance, quotes, wallets
from .context import Ctx, DomainError


def choose_source_currency(ctx: Ctx, beneficiary: Beneficiary, is_tuition: bool) -> str:
    """Same-currency wallet first (no FX), else the home-currency wallet (tuition is typically funded from home)."""
    owned = {w.currency for w in wallets.wallets(ctx)}
    home = {"BD": "BDT", "NG": "NGN", "IN": "INR"}.get(ctx.user.home_country)
    if is_tuition and home in owned:
        return home
    if beneficiary.currency in owned:
        return beneficiary.currency
    return home or ctx.user.reporting_currency


def default_send_currency(ctx: Ctx, receive_currency: str) -> str:
    """Quote without a named payee: assume a cross-border transfer from home, unless home is where the money goes."""
    owned = {w.currency for w in wallets.wallets(ctx)}
    home = {"BD": "BDT", "NG": "NGN", "IN": "INR"}.get(ctx.user.home_country)
    if home and home in owned and home != receive_currency:
        return home
    return ctx.user.reporting_currency


def plan(
    ctx: Ctx,
    beneficiary: Beneficiary,
    *,
    amount: Decimal,
    amount_currency: str,
    from_currency: str | None = None,
    provider_id: str | None = None,
    goal: quotes.Goal = "cheapest",
    deadline: date | None = None,
    invoice_id: str | None = None,
    purpose_code: str | None = None,
    source_of_funds: str | None = None,
) -> dict[str, Any]:
    """Quote all providers, pick the best feasible one, and build the exact payload a human will confirm."""
    is_tuition = beneficiary.kind == "university"
    send_ccy = (from_currency or choose_source_currency(ctx, beneficiary, is_tuition)).upper()
    recv_ccy = beneficiary.currency
    amount_currency = amount_currency.upper()
    if amount_currency not in (send_ccy, recv_ccy):
        raise DomainError(f"Amount currency {amount_currency} must be the sending ({send_ccy}) or receiving ({recv_ccy}) currency")
    reg = bene.registry_check(beneficiary)
    kwargs: dict[str, Any] = {"receive_amount": amount} if amount_currency == recv_ccy else {"send_amount": amount}
    if deadline is None and invoice_id:
        inv = ctx.session.get(Invoice, invoice_id)
        deadline = inv.due_date if inv else None
    comparison = quotes.compare(
        ctx.ws, send_ccy, recv_ccy, deadline=deadline, goal=goal, is_tuition=is_tuition,
        payee_is_registry=reg["applies"] and reg["match"], **kwargs,
    )
    chosen = comparison["recommended"]
    routing_note = None
    if provider_id:
        requested = next((q for q in comparison["options"] + comparison["rejected"] if q["provider_id"] == provider_id), None)
        if requested is None:
            raise DomainError(f"Unknown provider {provider_id}")
        if requested["feasible"]:
            chosen = requested
        else:
            routing_note = (
                f"{requested['provider_name']} can't take this payment ({'; '.join(requested['reasons'])}). "
                + (f"Routing to {chosen['provider_name']} instead, which supports the full amount." if chosen else "")
            )
    if chosen is None:
        return {"feasible": False, "comparison": comparison, "routing_note": routing_note}

    rules_purpose = purpose_code or compliance.default_purpose(send_ccy, recv_ccy, is_tuition, beneficiary.kind)
    sof = source_of_funds or ("Family support" if ctx.user.home_country else "Personal savings")
    reference = None
    if invoice_id:
        inv = ctx.session.get(Invoice, invoice_id)
        reference = inv.reference if inv else None
    payload = {
        "beneficiary_id": beneficiary.id,
        "beneficiary_name": beneficiary.name,
        "beneficiary_account": beneficiary.account_number,
        "provider_id": chosen["provider_id"],
        "send_currency": send_ccy,
        "receive_currency": recv_ccy,
        "send_amount": chosen["send_amount"],
        "receive_amount": chosen["receive_amount"],
        "fee": chosen["fee"],
        "mid_rate": chosen["mid_rate"],
        "offered_rate": chosen["offered_rate"],
        "landed_cost": chosen["landed_cost"],
        "amount_usd": chosen["amount_usd"],
        "arrival_latest": chosen["arrival_latest"],
        "arrival_earliest": chosen["arrival_earliest"],
        "is_tuition": is_tuition,
        "invoice_id": invoice_id,
        "payment_reference": reference or (f"{ctx.user.profile.get('student_id', '')} tuition" if is_tuition else "Personal transfer"),
        "purpose_code": rules_purpose,
        "source_of_funds": sof,
        "mode": comparison["mode"],
    }
    return {"feasible": True, "payload": payload, "comparison": comparison, "routing_note": routing_note, "chosen": chosen}


def summary_for(ctx: Ctx, payload: dict[str, Any]) -> dict[str, Any]:
    b = bene.get(ctx, payload["beneficiary_id"])
    provider = quotes.get_provider(payload["provider_id"])
    return {
        "title": f"{'Pay tuition to' if payload['is_tuition'] else 'Send money to'} {b.name}",
        "recipient": b.name,
        "recipient_account": mask_account(b.account_number),
        "recipient_bank": b.bank_name,
        "provider": provider.name,
        "you_send": f"{payload['send_amount']} {payload['send_currency']}",
        "fee": f"{payload['fee']} {payload['send_currency']}",
        "rate": rate_display(payload["send_currency"], payload["receive_currency"], payload["offered_rate"]),
        "mid_rate": payload["mid_rate"],
        "they_receive": f"{payload['receive_amount']} {payload['receive_currency']}",
        "landed_cost": f"{payload['landed_cost']} {payload['send_currency']}",
        "arrival": payload["arrival_latest"],
        "purpose_code": payload["purpose_code"],
        "source_of_funds": payload["source_of_funds"],
        "reference": payload["payment_reference"],
        "amount_usd": payload["amount_usd"],
    }


def execute(ctx: Ctx, payload: dict[str, Any], action_id: str) -> dict[str, Any]:
    b = bene.get(ctx, payload["beneficiary_id"])
    if b.account_number != payload["beneficiary_account"]:
        raise DomainError("Beneficiary details changed since the payment was confirmed")
    send_ccy, recv_ccy = payload["send_currency"], payload["receive_currency"]
    send, recv, fee = D(payload["send_amount"]), D(payload["receive_amount"]), D(payload["fee"])
    src = wallets.wallet_for(ctx, send_ccy)
    if ledger.wallet_balance(ctx.session, src) < send:
        raise DomainError(f"Insufficient {send_ccy} balance")
    at = now(ctx.ws)
    provider = quotes.get_provider(payload["provider_id"])
    reference = f"RMI-{at:%Y%m%d}-{action_id[:6].upper()}"
    txn = Transaction(
        workspace_id=ctx.ws_id,
        user_id=ctx.user.id,
        kind="transfer_out",
        status="pending",
        occurred_at=at,
        description=("Tuition: " if payload["is_tuition"] else "Transfer: ") + b.name,
        category="Tuition" if payload["is_tuition"] else "Transfers",
        amount=send,
        currency=send_ccy,
        wallet_id=src.id,
        counter_amount=recv,
        counter_currency=recv_ccy,
        beneficiary_id=b.id,
        provider=provider.id,
        reference=reference,
        expected_arrival=datetime.fromisoformat(payload["arrival_latest"]),
        details={
            "amount_usd": payload["amount_usd"],
            "fee": payload["fee"],
            "rate": payload["offered_rate"],
            "mid_rate": payload["mid_rate"],
            "purpose_code": payload["purpose_code"],
            "source_of_funds": payload["source_of_funds"],
            "payment_reference": payload["payment_reference"],
            "beneficiary_name": b.name,
            "beneficiary_account": b.account_number,
            "invoice_id": payload.get("invoice_id"),
            "action_id": action_id,
            "via_remi": True,
            "executed_real_at": real_now().isoformat(),
        },
    )
    ctx.session.add(txn)
    ctx.session.flush()
    net = send - fee
    ledger.post(
        ctx.session,
        txn,
        [
            (ledger.wallet_account(src.id), send_ccy, -send),
            (f"revenue:fees:{provider.id}", send_ccy, fee),
            (f"clearing:in_transit:{provider.id}", send_ccy, net),
        ],
    )
    if payload.get("invoice_id"):
        inv = ctx.session.get(Invoice, payload["invoice_id"])
        if inv and inv.workspace_id == ctx.ws_id:
            inv.status = "paid"
            for ob in ctx.session.exec(select(Obligation).where(Obligation.invoice_id == inv.id)).all():
                ob.status = "paid"
    ctx.emit("transaction", {"id": txn.id, "status": "pending", "kind": "transfer_out", "reference": reference})
    return {"status": "executed", "transaction_id": txn.id, "receipt": receipt(ctx, txn)}


def receipt(ctx: Ctx, txn: Transaction) -> dict[str, Any]:
    provider = quotes.get_provider(txn.provider) if txn.provider else None
    return {
        "reference": txn.reference,
        "status": txn.status,
        "executed_at": aware(txn.occurred_at).isoformat(timespec="seconds"),
        "provider": provider.name if provider else txn.provider,
        "recipient": txn.details.get("beneficiary_name"),
        "recipient_account": mask_account(txn.details.get("beneficiary_account", "")),
        "sent": f"{q_money(txn.amount, txn.currency)} {txn.currency}",
        "fee": f"{txn.details.get('fee')} {txn.currency}",
        "rate": txn.details.get("rate"),
        "received": f"{txn.counter_amount} {txn.counter_currency}",
        "expected_arrival": aware(txn.expected_arrival).isoformat(timespec="seconds") if txn.expected_arrival else None,
        "purpose_code": txn.details.get("purpose_code"),
        "source_of_funds": txn.details.get("source_of_funds"),
        "payment_reference": txn.details.get("payment_reference"),
        "sandbox": True,
        "disclaimer": "Sandbox receipt. No real money moved.",
    }


def settle_due(ctx: Ctx) -> list[dict[str, Any]]:
    """pending → processing → settled. In demo mode transfers settle after a few real seconds."""
    settings = get_settings()
    changes: list[dict[str, Any]] = []
    sim_now = now(ctx.ws)
    rows = ctx.session.exec(
        select(Transaction).where(
            Transaction.workspace_id == ctx.ws_id,
            Transaction.user_id == ctx.user.id,
            Transaction.kind == "transfer_out",
            col(Transaction.status).in_(("pending", "processing")),
        )
    ).all()
    for txn in rows:
        executed_real = datetime.fromisoformat(txn.details.get("executed_real_at", real_now().isoformat()))
        elapsed = (real_now() - executed_real).total_seconds()
        arrived = txn.expected_arrival is not None and aware(txn.expected_arrival) <= sim_now
        demo_fast = settings.demo_mode and elapsed >= settings.demo_settle_seconds
        if txn.status == "pending" and (elapsed >= settings.demo_settle_seconds / 3 or arrived):
            txn.status = "processing"
            changes.append({"id": txn.id, "status": "processing", "reference": txn.reference})
        if txn.status == "processing" and (arrived or demo_fast):
            _settle(ctx, txn)
            changes.append({"id": txn.id, "status": "settled", "reference": txn.reference})
    for change in changes:
        ctx.emit("transaction", change)
        if change["status"] == "settled":
            ctx.notify("settled", "Transfer delivered", f"{change['reference']} has settled (sandbox).", change)
    return changes


def _settle(ctx: Ctx, txn: Transaction) -> None:
    provider = txn.provider or "unknown"
    net = q_money(txn.amount - D(txn.details.get("fee", "0")), txn.currency)
    ledger.post(
        ctx.session,
        txn,
        [
            (f"clearing:in_transit:{provider}", txn.currency, -net),
            (f"clearing:fx_pool:{provider}", txn.currency, net),
            (f"clearing:fx_pool:{provider}", txn.counter_currency or txn.currency, -(txn.counter_amount or Decimal("0"))),
            (f"external:beneficiary:{txn.beneficiary_id}", txn.counter_currency or txn.currency, txn.counter_amount or Decimal("0")),
        ],
        at=now(ctx.ws),
    )
    txn.status = "settled"
    txn.details = {**txn.details, "settled_at": now(ctx.ws).isoformat(timespec="seconds")}


def fail(ctx: Ctx, txn: Transaction, reason: str) -> None:
    """Reverse an in-flight transfer: return the net amount and refund the fee."""
    if txn.status not in ("pending", "processing"):
        raise DomainError("Only in-flight transfers can fail")
    provider = txn.provider or "unknown"
    fee = D(txn.details.get("fee", "0"))
    net = txn.amount - fee
    ledger.post(
        ctx.session,
        txn,
        [
            (f"clearing:in_transit:{provider}", txn.currency, -net),
            (f"revenue:fees:{provider}", txn.currency, -fee),
            (ledger.wallet_account(txn.wallet_id or ""), txn.currency, txn.amount),
        ],
        at=now(ctx.ws),
    )
    txn.status = "failed"
    txn.details = {**txn.details, "failure_reason": reason}
    ctx.emit("transaction", {"id": txn.id, "status": "failed", "reference": txn.reference})


def upcoming_due(ctx: Ctx, within_days: int = 60) -> list[Obligation]:
    horizon = now(ctx.ws).date() + timedelta(days=within_days)
    return [
        o for o in ctx.session.exec(
            select(Obligation).where(Obligation.workspace_id == ctx.ws_id, Obligation.user_id == ctx.user.id, Obligation.status == "upcoming")
        ).all()
        if o.due_date <= horizon
    ]
