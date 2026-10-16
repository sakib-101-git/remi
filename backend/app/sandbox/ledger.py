from __future__ import annotations

from collections import defaultdict
from datetime import datetime
from decimal import Decimal

from sqlalchemy import func
from sqlmodel import Session, select

from ..models import JournalEntry, Transaction, Wallet


class LedgerError(ValueError):
    pass


Leg = tuple[str, str, Decimal]  # (account, currency, signed amount)


def wallet_account(wallet_id: str) -> str:
    return f"wallet:{wallet_id}"


def post(session: Session, txn: Transaction, legs: list[Leg], at: datetime | None = None) -> list[JournalEntry]:
    """Double-entry posting: legs must net to zero in every currency."""
    totals: dict[str, Decimal] = defaultdict(Decimal)
    for _, ccy, amount in legs:
        totals[ccy] += amount
    unbalanced = {c: t for c, t in totals.items() if t != 0}
    if unbalanced:
        raise LedgerError(f"Unbalanced posting for {txn.id}: {unbalanced}")
    entries = [
        JournalEntry(
            workspace_id=txn.workspace_id,
            user_id=txn.user_id,
            transaction_id=txn.id,
            account=account,
            currency=ccy,
            amount=amount,
            created_at=at or txn.occurred_at,
        )
        for account, ccy, amount in legs
    ]
    session.add_all(entries)
    session.flush()
    return entries


def account_balance(session: Session, workspace_id: str, account: str) -> Decimal:
    rows = session.exec(
        select(JournalEntry.amount).where(JournalEntry.workspace_id == workspace_id, JournalEntry.account == account)
    ).all()
    return sum(rows, Decimal("0"))


def wallet_balance(session: Session, wallet: Wallet) -> Decimal:
    return account_balance(session, wallet.workspace_id, wallet_account(wallet.id))


def wallet_balances(session: Session, workspace_id: str, user_id: str) -> dict[str, Decimal]:
    wallets = session.exec(select(Wallet).where(Wallet.workspace_id == workspace_id, Wallet.user_id == user_id)).all()
    return {w.currency: wallet_balance(session, w) for w in wallets}


def trial_balance(session: Session, workspace_id: str) -> dict[str, Decimal]:
    """Sum of all entries per currency; must be zero for a consistent ledger."""
    totals: dict[str, Decimal] = defaultdict(Decimal)
    for ccy, amount in session.exec(
        select(JournalEntry.currency, JournalEntry.amount).where(JournalEntry.workspace_id == workspace_id)
    ).all():
        totals[ccy] += amount
    return dict(totals)


def entry_count(session: Session, workspace_id: str) -> int:
    return session.exec(
        select(func.count()).select_from(JournalEntry).where(JournalEntry.workspace_id == workspace_id)
    ).one()
