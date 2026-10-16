from decimal import Decimal

from app.money import D, q_money, q_money_up, q_pct, rate_display


def test_float_input_is_exact_decimal():
    assert D(0.1) == Decimal("0.1")
    assert D(0.1) + D(0.2) == Decimal("0.3")


def test_money_rounds_half_up_to_minor_units():
    assert q_money(Decimal("10.005"), "GBP") == Decimal("10.01")
    assert q_money(Decimal("10.004"), "GBP") == Decimal("10.00")


def test_round_up_never_short_changes_target():
    assert q_money_up(Decimal("100.001"), "BDT") == Decimal("100.01")
    assert q_money_up(Decimal("100.00"), "BDT") == Decimal("100.00")


def test_pct_places():
    assert q_pct(Decimal("66.7405"), 1) == Decimal("66.7")


def test_rate_display_inverts_small_rates():
    assert rate_display("BDT", "GBP", Decimal("0.0060816")) == "1 GBP = 164.4304 BDT"
    assert rate_display("GBP", "BDT", Decimal("164.43")) == "1 GBP = 164.4300 BDT"

