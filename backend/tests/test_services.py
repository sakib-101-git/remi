from decimal import Decimal

import pytest

from app.money import D
from app.policy import actions
from app.sandbox import controls, workspaces
from app.services import alerts, budget, credit, wallets
from app.services.context import DomainError, load_ctx
from conftest import switch
from helpers import propose_payment


def test_runway_formula(ctx):
    rw = budget.runway(ctx)
    available = D(rw["liquid_balance"]) - D(rw["reserved_for_obligations"])
    assert D(rw["available_after_obligations"]) == available
    assert rw["runway_days"] == int(available / D(rw["daily_burn"])) or abs(rw["runway_days"] - int(available / D(rw["daily_burn"]))) <= 1
    assert rw["runway_days"] > 60


def test_budget_summary_normalises_and_gives_three_tips(ctx):
    s = budget.summary(ctx)
    assert s["reporting_currency"] == "GBP"
    assert "BDT" in s["spend_by_original_currency"] and "GBP" in s["spend_by_original_currency"]
    assert len(s["recommendations"]) == 3
    assert any(o["kind"] == "tuition" for o in s["obligations"])


def test_create_budget_and_undo_info(ctx):
    out = budget.create_budget(ctx, "Eating out", Decimal("90"))
    assert out["status"] == "saved" and out["undo"]["previous_limit"] is None
    again = budget.create_budget(ctx, "Eating out", Decimal("80"))
    assert again["undo"]["previous_limit"] == "90.00"


def test_credit_plan_create_and_dependencies(ctx):
    preview = credit.plan(ctx)
    assert not preview["saved"] and preview["country"] == "UK"
    created = credit.create(ctx)
    assert created["status"] == "created" and created["readiness_score"] == 0
    with pytest.raises(DomainError):
        credit.update(ctx, "bank_account", "done")
    credit.update(ctx, "address_proof", "done")
    out = credit.update(ctx, "bank_account", "done")
    assert out["readiness_score"] > 0


def test_credit_plan_uses_host_country(ctx):
    ada = switch(ctx, "ada")
    assert credit.plan(ada)["country"] == "CA"


def test_rate_alert_triggers_and_proposes_conversion(ctx):
    alerts.set_alert(ctx, "GBP", "BDT", Decimal("163.5"), convert_amount=Decimal("500"), convert_currency="GBP")
    result = controls.tick(ctx, shock_currency="GBP", shock_pct=Decimal("0.01"))
    assert len(result["alerts_fired"]) == 1
    card = result["alerts_fired"][0]["action"]
    assert card["status"] == "awaiting_confirmation" and card["tier"] == "T2"
    assert card["payload"]["buy_amount"] == "500.00" and card["payload"]["to_currency"] == "GBP"
    before = wallets.balance(ctx, "GBP")
    actions.confirm(ctx, card["id"], card["confirm_token"])
    assert wallets.balance(ctx, "GBP") == before + Decimal("500.00")


def test_alert_does_not_fire_when_rate_not_reached(ctx):
    alerts.set_alert(ctx, "GBP", "BDT", Decimal("150"))
    assert controls.tick(ctx)["alerts_fired"] == []


def test_inject_remittance_credits_home_wallet(ctx):
    before = wallets.balance(ctx, "BDT")
    controls.inject_remittance(ctx, Decimal("150000"))
    assert wallets.balance(ctx, "BDT") == before + Decimal("150000")


def test_workspace_isolation(session, ctx):
    other_ws = workspaces.create(session)
    other = load_ctx(session, other_ws.id)
    action, _ = propose_payment(ctx, "mom", "15000", "BDT")
    with pytest.raises(DomainError):
        actions.confirm(other, action.id, "x")
    from app.services import beneficiaries as bene

    mom = bene.find(ctx, "mom")
    with pytest.raises(DomainError):
        bene.get(other, mom.id)


def test_reset_restores_seed_state(session, ctx):
    action, token = propose_payment(ctx, "mom", "15000", "BDT")
    actions.confirm(ctx, action.id, token)
    workspaces.reset(session, ctx.ws)
    fresh = load_ctx(session, ctx.ws.id)
    assert wallets.balance(fresh, "BDT") == Decimal("2400000.00")


def test_one_off_transfer_does_not_inflate_burn_rate(ctx):
    before = budget.runway(ctx)
    action, token = propose_payment(ctx, "dad", "800000", "BDT")
    actions.confirm(ctx, action.id, token)
    code = next(d["code"] for e, d in reversed(ctx.outbox) if e == "sandbox_phone")
    actions.step_up(ctx, action.id, code)
    after = budget.runway(ctx)
    assert after["daily_burn"] == before["daily_burn"]
    assert after["runway_days"] < before["runway_days"]
    assert all(r["id"] != "trim_category" or "Transfers" not in r["title"] for r in budget.summary(ctx)["recommendations"])


def test_rate_alert_already_met_is_rejected_and_omitted_direction_is_inferred(ctx):
    with pytest.raises(DomainError, match="fire immediately"):
        alerts.set_alert(ctx, "GBP", "BDT", Decimal("163.5"), direction="above")
    out = alerts.set_alert(ctx, "GBP", "BDT", Decimal("163.5"))
    assert out["direction"] == "below"
