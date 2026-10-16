from datetime import date, datetime, timezone
from decimal import Decimal

from app.money import q_money
from app.sandbox import fx
from app.services import quotes


def _p(pid):
    return quotes.get_provider(pid)


def test_forward_quote_formula(ctx):
    p = _p("alpha_remit")
    q = quotes.quote_provider(ctx.ws, p, "GBP", "BDT", send_amount=Decimal("100"))
    mid = q.mid_rate
    offered = q.offered_rate
    assert offered == (mid * (1 - p.markup)).quantize(Decimal("0.0000000001"))
    fee = q_money(p.fee_fixed_usd * fx.mid_rate(ctx.ws, "USD", "GBP") + p.fee_pct * Decimal("100"), "GBP")
    assert q.fee == fee
    assert q.receive_amount == q_money((Decimal("100") - fee) * offered, "BDT")
    assert q.landed_cost == q_money(Decimal("100") - q.receive_amount / mid, "GBP")


def test_reverse_quote_delivers_exact_target(ctx):
    for pid in ("campus_pay", "bank_wire", "alpha_remit"):
        q = quotes.quote_provider(ctx.ws, _p(pid), "BDT", "GBP", receive_amount=Decimal("9250"))
        assert q.receive_amount == Decimal("9250.00")
        # Sending the reverse-quoted amount forward must deliver at least the target.
        fwd = quotes.quote_provider(ctx.ws, _p(pid), "BDT", "GBP", send_amount=q.send_amount)
        assert fwd.receive_amount >= Decimal("9250.00")
        one_less = quotes.quote_provider(ctx.ws, _p(pid), "BDT", "GBP", send_amount=q.send_amount - Decimal("1"))
        assert one_less.receive_amount < Decimal("9250.00")


def test_reverse_quote_with_percentage_fee(ctx):
    p = _p("alpha_remit")
    q = quotes.quote_provider(ctx.ws, p, "GBP", "BDT", receive_amount=Decimal("15000"))
    assert q.fee == q_money(p.fee_fixed_usd * fx.mid_rate(ctx.ws, "USD", "GBP") + p.fee_pct * q.send_amount, "GBP")
    assert (q.send_amount - q.fee) * q.offered_rate >= Decimal("15000")


def test_tuition_routes_away_from_low_limit_providers(ctx):
    res = quotes.compare(ctx.ws, "BDT", "GBP", receive_amount=Decimal("9250"), deadline=date(2026, 11, 4), is_tuition=True, payee_is_registry=True)
    assert res["recommended"]["provider_id"] == "campus_pay"
    rejected = {r["provider_id"]: r["reasons"] for r in res["rejected"]}
    assert "alpha_remit" in rejected and any("never splits" in r for r in rejected["alpha_remit"])
    assert "beta_express" in rejected


def test_deadline_makes_slow_provider_infeasible(ctx):
    res = quotes.compare(ctx.ws, "BDT", "GBP", receive_amount=Decimal("9250"), deadline=date(2026, 10, 22), is_tuition=True, payee_is_registry=True)
    rejected = {r["provider_id"] for r in res["rejected"]}
    assert "bank_wire" in rejected
    assert res["recommended"]["provider_id"] == "campus_pay"


def test_no_feasible_option_when_deadline_too_close(ctx):
    res = quotes.compare(ctx.ws, "BDT", "GBP", receive_amount=Decimal("9250"), deadline=date(2026, 10, 15), is_tuition=True, payee_is_registry=True)
    assert res["no_feasible_option"] is True
    assert res["recommended"] is None


def test_fastest_goal_prefers_same_day(ctx):
    res = quotes.compare(ctx.ws, "GBP", "BDT", send_amount=Decimal("100"), goal="fastest")
    assert res["recommended"]["provider_id"] == "beta_express"
    cheapest = quotes.compare(ctx.ws, "GBP", "BDT", send_amount=Decimal("100"), goal="cheapest")
    assert cheapest["recommended"]["provider_id"] == "alpha_remit"


def test_balanced_goal_scores_all_options(ctx):
    res = quotes.compare(ctx.ws, "GBP", "BDT", send_amount=Decimal("500"), goal="balanced")
    assert all(o["score"] is not None for o in res["options"])
    scores = [Decimal(o["score"]) for o in res["options"]]
    assert scores == sorted(scores)


def test_cutoff_pushes_arrival(ctx):
    p = _p("campus_pay")
    before = datetime(2026, 10, 14, 10, tzinfo=timezone.utc)
    after = datetime(2026, 10, 14, 16, tzinfo=timezone.utc)
    _, late_before = quotes.arrival_window(p, before)
    _, late_after = quotes.arrival_window(p, after)
    assert late_after > late_before


def test_explanation_object_is_complete(ctx):
    res = quotes.compare(ctx.ws, "GBP", "BDT", send_amount=Decimal("100"))
    exp = res["explanation"]
    for key in ("inputs", "formula", "alternatives", "assumptions", "data_timestamp", "sources", "disclaimer"):
        assert key in exp
