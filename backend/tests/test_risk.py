from decimal import Decimal

from app.policy import limits as lim
from app.risk import engine as risk
from app.services import beneficiaries as bene
from helpers import propose_payment


def _rules(r):
    return {x["rule"] for x in r.reasons}


def test_large_amount_vs_history_scores(ctx):
    dad = bene.find(ctx, "dad")
    r = risk.assess_payment(ctx, amount_usd=Decimal("20000"), beneficiary=dad, send_ccy="BDT", recv_ccy="BDT", limits=lim.effective_limits(ctx))
    assert "large_vs_history" in _rules(r)
    assert "new_beneficiary" in _rules(r)


def test_first_time_corridor_flagged(ctx):
    mom = bene.find(ctx, "mom")
    r = risk.assess_payment(ctx, amount_usd=Decimal("50"), beneficiary=mom, send_ccy="USD", recv_ccy="BDT", limits=lim.effective_limits(ctx))
    assert "first_time_corridor" in _rules(r)


def test_known_corridor_low_risk(ctx):
    mom = bene.find(ctx, "mom")
    r = risk.assess_payment(ctx, amount_usd=Decimal("120"), beneficiary=mom, send_ccy="BDT", recv_ccy="BDT", limits=lim.effective_limits(ctx))
    assert r.score < 25 and "first_time_corridor" not in _rules(r)


def test_structuring_pattern_detected(ctx):
    # Two proposals just under the $5,000 step-up threshold to the same payee within 24h.
    first, _ = propose_payment(ctx, "dad", "585000", "BDT", provider_id="bank_wire")
    second, _ = propose_payment(ctx, "dad", "590000", "BDT", provider_id="bank_wire")
    assert any(r["rule"] == "structuring" for r in second.risk_reasons)
    assert second.tier == "T3"


def test_score_is_capped_and_explained(ctx):
    r = risk.RiskResult()
    for i in range(5):
        r.add(f"rule{i}", 40, "reason")
    assert r.score == 100 and r.level == "high" and len(r.reasons) == 5
