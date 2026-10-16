from __future__ import annotations

from decimal import Decimal

from app.policy import actions
from app.services import beneficiaries as bene
from app.services import payments
from app.services.context import Ctx


def propose_payment(ctx: Ctx, who: str, amount: str, currency: str, **kw):
    b = bene.find(ctx, who)
    assert b is not None, who
    plan = payments.plan(ctx, b, amount=Decimal(amount), amount_currency=currency, **kw)
    assert plan["feasible"], plan
    return actions.propose(ctx, "payment", plan["payload"], payments.summary_for(ctx, plan["payload"]))
