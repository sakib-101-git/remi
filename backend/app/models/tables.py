from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any

from sqlalchemy import JSON, Column, UniqueConstraint
from sqlmodel import Field, SQLModel

from ..db import DecimalText


def _uuid() -> str:
    return uuid.uuid4().hex[:16]


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def money_col(nullable: bool = False) -> Any:
    return Field(default=None if nullable else Decimal("0"), sa_column=Column(DecimalText(), nullable=nullable))


def json_col(default: Any = None) -> Any:
    factory = (lambda: {}) if default is None else (lambda: list(default) if isinstance(default, list) else dict(default))
    return Field(default_factory=factory, sa_column=Column(JSON, nullable=False))


class Workspace(SQLModel, table=True):
    id: str = Field(default_factory=_uuid, primary_key=True)
    active_user_id: str | None = None
    clock_offset_seconds: int = 0
    fx_tick: int = 0
    fx_rates: dict[str, str] = json_col()
    agent_paused: bool = False
    consent_given: bool = False
    limits_override: dict[str, str] = json_col()
    llm_calls_today: int = 0
    llm_calls_day: str = ""
    created_at: datetime = Field(default_factory=utcnow)
    last_seen_at: datetime = Field(default_factory=utcnow, index=True)


class User(SQLModel, table=True):
    id: str = Field(default_factory=_uuid, primary_key=True)
    workspace_id: str = Field(index=True, foreign_key="workspace.id", ondelete="CASCADE")
    persona: str
    name: str
    home_country: str
    host_country: str
    university: str
    reporting_currency: str
    kyc_status: str = "verified"
    preferred_language: str = "English"
    profile: dict[str, Any] = json_col()


class Wallet(SQLModel, table=True):
    __table_args__ = (UniqueConstraint("user_id", "currency"),)
    id: str = Field(default_factory=_uuid, primary_key=True)
    workspace_id: str = Field(index=True, foreign_key="workspace.id", ondelete="CASCADE")
    user_id: str = Field(index=True, foreign_key="user.id", ondelete="CASCADE")
    currency: str
    is_liquid: bool = True


class Transaction(SQLModel, table=True):
    id: str = Field(default_factory=_uuid, primary_key=True)
    workspace_id: str = Field(index=True, foreign_key="workspace.id", ondelete="CASCADE")
    user_id: str = Field(index=True, foreign_key="user.id", ondelete="CASCADE")
    kind: str  # card_spend | income | fx_conversion | transfer_out | transfer_in | fee
    status: str = "settled"  # pending | processing | settled | failed | reversed
    occurred_at: datetime = Field(default_factory=utcnow, index=True)
    description: str = ""
    merchant: str | None = None
    category: str | None = None
    category_source: str | None = None
    amount: Decimal = money_col()
    currency: str
    wallet_id: str | None = None
    counter_amount: Decimal | None = money_col(nullable=True)
    counter_currency: str | None = None
    beneficiary_id: str | None = None
    provider: str | None = None
    reference: str | None = None
    expected_arrival: datetime | None = None
    details: dict[str, Any] = json_col()


class JournalEntry(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    workspace_id: str = Field(index=True, foreign_key="workspace.id", ondelete="CASCADE")
    user_id: str = Field(index=True)
    transaction_id: str = Field(index=True)
    account: str = Field(index=True)
    currency: str
    amount: Decimal = money_col()
    created_at: datetime = Field(default_factory=utcnow)


class Beneficiary(SQLModel, table=True):
    id: str = Field(default_factory=_uuid, primary_key=True)
    workspace_id: str = Field(index=True, foreign_key="workspace.id", ondelete="CASCADE")
    user_id: str = Field(index=True, foreign_key="user.id", ondelete="CASCADE")
    name: str
    nickname: str | None = None
    kind: str  # family | university | landlord | other
    country: str
    currency: str
    bank_name: str
    account_number: str
    registry_id: str | None = None
    verified: bool = True
    created_at: datetime = Field(default_factory=utcnow)
    active_after: datetime | None = None


class Invoice(SQLModel, table=True):
    id: str = Field(default_factory=_uuid, primary_key=True)
    workspace_id: str = Field(index=True, foreign_key="workspace.id", ondelete="CASCADE")
    user_id: str = Field(index=True, foreign_key="user.id", ondelete="CASCADE")
    issuer: str
    registry_id: str | None = None
    amount: Decimal = money_col()
    currency: str
    due_date: date
    reference: str
    status: str = "open"  # open | paid | flagged
    raw_text: str = ""
    created_at: datetime = Field(default_factory=utcnow)


class Obligation(SQLModel, table=True):
    id: str = Field(default_factory=_uuid, primary_key=True)
    workspace_id: str = Field(index=True, foreign_key="workspace.id", ondelete="CASCADE")
    user_id: str = Field(index=True, foreign_key="user.id", ondelete="CASCADE")
    title: str
    kind: str  # tuition | rent | utility | visa | other
    amount: Decimal = money_col()
    currency: str
    due_date: date
    recurring: str | None = None  # monthly | None
    invoice_id: str | None = None
    status: str = "upcoming"  # upcoming | paid


class Budget(SQLModel, table=True):
    __table_args__ = (UniqueConstraint("user_id", "category"),)
    id: str = Field(default_factory=_uuid, primary_key=True)
    workspace_id: str = Field(index=True, foreign_key="workspace.id", ondelete="CASCADE")
    user_id: str = Field(index=True, foreign_key="user.id", ondelete="CASCADE")
    category: str
    monthly_limit: Decimal = money_col()
    currency: str
    created_at: datetime = Field(default_factory=utcnow)


class RateAlert(SQLModel, table=True):
    id: str = Field(default_factory=_uuid, primary_key=True)
    workspace_id: str = Field(index=True, foreign_key="workspace.id", ondelete="CASCADE")
    user_id: str = Field(index=True, foreign_key="user.id", ondelete="CASCADE")
    base: str
    quote: str
    direction: str  # below | above
    target_rate: Decimal = money_col()
    convert_amount: Decimal | None = money_col(nullable=True)
    convert_currency: str | None = None
    status: str = "active"  # active | triggered | cancelled
    created_at: datetime = Field(default_factory=utcnow)
    triggered_at: datetime | None = None
    triggered_rate: Decimal | None = money_col(nullable=True)
    proposal_id: str | None = None


class Reminder(SQLModel, table=True):
    id: str = Field(default_factory=_uuid, primary_key=True)
    workspace_id: str = Field(index=True, foreign_key="workspace.id", ondelete="CASCADE")
    user_id: str = Field(index=True, foreign_key="user.id", ondelete="CASCADE")
    title: str
    due_date: date
    status: str = "open"
    created_at: datetime = Field(default_factory=utcnow)


class CreditTask(SQLModel, table=True):
    __table_args__ = (UniqueConstraint("user_id", "task_key"),)
    id: str = Field(default_factory=_uuid, primary_key=True)
    workspace_id: str = Field(index=True, foreign_key="workspace.id", ondelete="CASCADE")
    user_id: str = Field(index=True, foreign_key="user.id", ondelete="CASCADE")
    task_key: str
    title: str
    description: str
    month: int
    points: int
    depends_on: list[str] = json_col([])
    status: str = "todo"  # todo | in_progress | done
    updated_at: datetime = Field(default_factory=utcnow)


class PendingAction(SQLModel, table=True):
    id: str = Field(default_factory=_uuid, primary_key=True)
    workspace_id: str = Field(index=True, foreign_key="workspace.id", ondelete="CASCADE")
    user_id: str = Field(index=True, foreign_key="user.id", ondelete="CASCADE")
    kind: str  # fx_conversion | payment | add_beneficiary
    payload: dict[str, Any] = json_col()
    payload_hash: str
    summary: dict[str, Any] = json_col()
    tier: str
    risk_score: int = 0
    risk_reasons: list[dict[str, Any]] = json_col([])
    policy_reasons: list[str] = json_col([])
    status: str = "awaiting_confirmation"
    token_hash: str | None = None
    token_expires_at: datetime | None = None
    token_used: bool = False
    requires_step_up: bool = False
    otp_hash: str | None = None
    otp_expires_at: datetime | None = None
    otp_attempts: int = 0
    not_before: datetime | None = None
    created_by: str = "agent"
    created_at: datetime = Field(default_factory=utcnow)
    executed_at: datetime | None = None
    result: dict[str, Any] = json_col()


class IdempotencyRecord(SQLModel, table=True):
    key: str = Field(primary_key=True)
    workspace_id: str = Field(index=True, foreign_key="workspace.id", ondelete="CASCADE")
    endpoint: str
    request_hash: str
    response: dict[str, Any] = json_col()
    created_at: datetime = Field(default_factory=utcnow)


class AuditEntry(SQLModel, table=True):
    __table_args__ = (UniqueConstraint("workspace_id", "seq"),)
    id: int | None = Field(default=None, primary_key=True)
    workspace_id: str = Field(index=True, foreign_key="workspace.id", ondelete="CASCADE")
    seq: int
    ts: str
    actor: str  # user | agent | system
    action: str
    tool: str | None = None
    tier: str | None = None
    inputs: dict[str, Any] = json_col()
    decision: str | None = None
    result: dict[str, Any] = json_col()
    prev_hash: str
    hash: str = Field(index=True)


class ChatMessage(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    workspace_id: str = Field(index=True, foreign_key="workspace.id", ondelete="CASCADE")
    user_id: str = Field(index=True)
    role: str  # user | assistant
    content: str
    cards: list[dict[str, Any]] = json_col([])
    meta: dict[str, Any] = json_col()
    created_at: datetime = Field(default_factory=utcnow)


class Notification(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    workspace_id: str = Field(index=True, foreign_key="workspace.id", ondelete="CASCADE")
    user_id: str | None = None
    kind: str
    title: str
    body: str = ""
    data: dict[str, Any] = json_col()
    read: bool = False
    created_at: datetime = Field(default_factory=utcnow)
