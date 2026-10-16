from decimal import Decimal

import pytest

from app.models import Transaction
from app.sandbox import ledger
from app.services import wallets
from app.services.context import DomainError


def test_seed_balances_match_persona_targets(ctx):
    assert wallets.balance(ctx, "BDT") == Decimal("2400000.00")
    assert wallets.balance(ctx, "GBP") == Decimal("1240.00")
    assert wallets.balance(ctx, "USD") == Decimal("300.00")


def test_trial_balance_is_zero_in_every_currency(ctx):
    assert all(v == 0 for v in ledger.trial_balance(ctx.session, ctx.ws_id).values())


def test_unbalanced_posting_is_rejected(ctx):
    t = Transaction(workspace_id=ctx.ws_id, user_id=ctx.user.id, kind="income", amount=Decimal("1"), currency="GBP")
    ctx.session.add(t)
    ctx.session.flush()
    with pytest.raises(ledger.LedgerError):
        ledger.post(ctx.session, t, [("a", "GBP", Decimal("1")), ("b", "GBP", Decimal("-0.99"))])


def test_unknown_wallet_raises(ctx):
    with pytest.raises(DomainError):
        wallets.wallet_for(ctx, "EUR")
