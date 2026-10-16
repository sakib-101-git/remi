from datetime import timedelta
from decimal import Decimal

import pytest

from app.models import Transaction
from app.policy import actions, tokens
from app.policy.actions import PolicyViolation
from app.sandbox import controls
from app.services import beneficiaries as bene
from app.services import wallets
from helpers import propose_payment
from sqlmodel import select


def _otp(ctx, action_id):
    for event, data in reversed(ctx.outbox):
        if event == "sandbox_phone" and data["action_id"] == action_id:
            return data["code"]
    raise AssertionError("no OTP")


def test_valid_token_executes_payment_and_debits_wallet(ctx):
    before = wallets.balance(ctx, "BDT")
    action, token = propose_payment(ctx, "mom", "15000", "BDT")
    out = actions.confirm(ctx, action.id, token)
    assert out["status"] == "executed"
    assert out["result"]["receipt"]["reference"].startswith("RMI-")
    assert wallets.balance(ctx, "BDT") == before - Decimal(action.payload["send_amount"])


def test_token_is_single_use(ctx):
    action, token = propose_payment(ctx, "mom", "15000", "BDT")
    actions.confirm(ctx, action.id, token)
    with pytest.raises(PolicyViolation):
        actions.confirm(ctx, action.id, token)
    txns = ctx.session.exec(select(Transaction).where(Transaction.details["action_id"].as_string() == action.id)).all()
    assert len(txns) == 1


def test_wrong_token_rejected(ctx):
    action, _ = propose_payment(ctx, "mom", "15000", "BDT")
    with pytest.raises(PolicyViolation, match="invalid token"):
        actions.confirm(ctx, action.id, "forged-token")
    assert action.status == "awaiting_confirmation"


def test_token_from_other_action_rejected(ctx):
    a1, t1 = propose_payment(ctx, "mom", "15000", "BDT")
    a2, _ = propose_payment(ctx, "mom", "16000", "BDT")
    with pytest.raises(PolicyViolation):
        actions.confirm(ctx, a2.id, t1)


def test_expired_token_rejected(ctx):
    action, token = propose_payment(ctx, "mom", "15000", "BDT")
    ctx.ws.clock_offset_seconds += 301
    with pytest.raises(PolicyViolation, match="expired"):
        actions.confirm(ctx, action.id, token)
    assert action.status == "expired"


def test_tampered_payload_rejected(ctx):
    action, token = propose_payment(ctx, "mom", "15000", "BDT")
    action.payload = {**action.payload, "beneficiary_account": "XX00ATTACKER0000000001"}
    with pytest.raises(PolicyViolation, match="payload changed"):
        actions.confirm(ctx, action.id, token)


def test_token_hash_bound_to_payload():
    p1, p2 = tokens.payload_hash({"a": 1}), tokens.payload_hash({"a": 2})
    from datetime import datetime, timezone

    token, stored, _ = tokens.issue_token("act1", p1, datetime.now(timezone.utc))
    assert tokens.token_matches(token, "act1", p1, stored)
    assert not tokens.token_matches(token, "act1", p2, stored)
    assert not tokens.token_matches(token, "act2", p1, stored)


def test_step_up_required_and_wrong_otp_counts_attempts(ctx):
    action, token = propose_payment(ctx, "dad", "800000", "BDT")
    out = actions.confirm(ctx, action.id, token)
    assert out["status"] == "awaiting_step_up"
    for _ in range(2):
        with pytest.raises(PolicyViolation, match="Incorrect"):
            actions.step_up(ctx, action.id, "000000" if _otp(ctx, action.id) != "000000" else "111111")
    with pytest.raises(PolicyViolation, match="cancelled"):
        actions.step_up(ctx, action.id, "000000" if _otp(ctx, action.id) != "000000" else "111111")
    assert action.status == "cancelled"


def test_step_up_with_correct_otp_executes(ctx):
    action, token = propose_payment(ctx, "dad", "800000", "BDT")
    actions.confirm(ctx, action.id, token)
    out = actions.step_up(ctx, action.id, _otp(ctx, action.id))
    assert out["status"] == "executed"


def test_new_beneficiary_cooling_off_then_release(ctx):
    payload = {"name": "Oak Street Rooms (demo)", "kind": "landlord", "country": "UK", "currency": "GBP", "bank_name": "Sandbox Bank UK", "account_number": "GB00SBUK40001112223334"}
    add, token = actions.propose(ctx, "add_beneficiary", payload, {"title": "Add payee"})
    actions.confirm(ctx, add.id, token)
    res = actions.step_up(ctx, add.id, _otp(ctx, add.id))
    new_id = res["result"]["beneficiary_id"]
    b = bene.get(ctx, new_id)
    assert not bene.is_active(ctx, b)
    pay, ptoken = propose_payment(ctx, "Oak Street Rooms", "300", "GBP")
    assert pay.tier == "T3" and pay.not_before is not None
    actions.confirm(ctx, pay.id, ptoken)
    out = actions.step_up(ctx, pay.id, _otp(ctx, pay.id))
    assert out["status"] == "scheduled"
    controls.advance_time(ctx, 1)
    assert pay.status == "executed"


def test_settlement_lifecycle(ctx):
    action, token = propose_payment(ctx, "mom", "15000", "BDT")
    actions.confirm(ctx, action.id, token)
    txn = ctx.session.exec(select(Transaction).where(Transaction.reference == action.result["receipt"]["reference"])).one()
    assert txn.status == "pending"
    controls.advance_time(ctx, 24 * 7)
    assert txn.status == "settled"


def test_reissue_invalidates_old_token(ctx):
    action, old = propose_payment(ctx, "mom", "15000", "BDT")
    fresh = actions.reissue_token(ctx, action.id)["confirm_token"]
    with pytest.raises(PolicyViolation):
        actions.confirm(ctx, action.id, old)
    assert actions.confirm(ctx, action.id, fresh)["status"] == "executed"
