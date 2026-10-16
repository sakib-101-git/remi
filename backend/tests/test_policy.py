from datetime import timedelta
from decimal import Decimal

from app.models import Beneficiary
from app.policy import actions
from app.sandbox.clock import now
from app.services import beneficiaries as bene
from app.services import payments
from helpers import propose_payment


def test_small_payment_to_known_family_is_t2(ctx):
    action, token = propose_payment(ctx, "mom", "15000", "BDT")
    assert action.tier == "T2"
    assert action.status == "awaiting_confirmation"
    assert token


def test_tuition_to_verified_university_is_t2(ctx):
    action, _ = propose_payment(ctx, "university", "9250", "GBP", invoice_id=None)
    assert action.tier == "T2", action.policy_reasons
    assert action.payload["provider_id"] == "campus_pay"


def test_large_payment_requires_step_up(ctx):
    action, _ = propose_payment(ctx, "dad", "800000", "BDT")
    assert action.tier == "T3"
    assert any("step-up threshold" in r for r in action.policy_reasons)


def test_insufficient_funds_blocks(ctx):
    action, token = propose_payment(ctx, "mom", "3000000", "BDT", provider_id="bank_wire")
    assert action.status == "blocked"
    assert token is None
    assert any("Insufficient" in r for r in action.policy_reasons)


def test_kill_switch_blocks_agent_proposals(ctx):
    ctx.ws.agent_paused = True
    action, token = propose_payment(ctx, "mom", "1000", "BDT")
    assert action.status == "blocked" and token is None


def test_per_transaction_max_blocks(ctx):
    ctx.ws.limits_override = {"per_transaction_max_usd": "100"}
    action, _ = propose_payment(ctx, "mom", "15000", "BDT")
    assert action.status == "blocked"


def test_daily_soft_limit_escalates(ctx):
    ctx.ws.limits_override = {"daily_soft_limit_usd": "50"}
    action, _ = propose_payment(ctx, "mom", "15000", "BDT")
    assert action.tier == "T3"
    assert any("daily soft limit" in r for r in action.policy_reasons)


def test_registry_mismatch_is_blocked_as_fraud(ctx):
    uni = bene.find(ctx, "university")
    uni.account_number = "XX91QUIK00000000666777"
    plan = payments.plan(ctx, uni, amount=Decimal("9250"), amount_currency="GBP")
    action, token = actions.propose(ctx, "payment", plan["payload"], payments.summary_for(ctx, plan["payload"]))
    assert action.status == "blocked" and token is None
    assert any("invoice fraud" in r["reason"] for r in action.risk_reasons)


def test_restricted_jurisdiction_blocks(ctx):
    b = Beneficiary(workspace_id=ctx.ws_id, user_id=ctx.user.id, name="Test Payee", kind="other", country="XR", currency="GBP", bank_name="Demo", account_number="XR00000000000001", created_at=now(ctx.ws) - timedelta(days=30))
    ctx.session.add(b)
    ctx.session.flush()
    plan = payments.plan(ctx, b, amount=Decimal("100"), amount_currency="GBP", provider_id="bank_wire")
    action, _ = actions.propose(ctx, "payment", plan["payload"], payments.summary_for(ctx, plan["payload"]))
    assert action.status == "blocked"


def test_new_beneficiary_is_always_t3(ctx):
    payload = {"name": "Oak Street Rooms (demo)", "kind": "landlord", "country": "UK", "currency": "GBP", "bank_name": "Sandbox Bank UK", "account_number": "GB00SBUK40001112223334"}
    action, token = actions.propose(ctx, "add_beneficiary", payload, {"title": "Add payee"})
    assert action.tier == "T3" and action.requires_step_up and token


def test_requested_low_limit_provider_is_rerouted_not_split(ctx):
    dad = bene.find(ctx, "dad")
    plan = payments.plan(ctx, dad, amount=Decimal("800000"), amount_currency="BDT", provider_id="alpha_remit")
    assert plan["payload"]["provider_id"] == "bank_wire"
    assert "Routing to Sandbox Bank Wire" in plan["routing_note"]
