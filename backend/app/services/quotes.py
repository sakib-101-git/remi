"""Remittance cost optimizer (forward + reverse quotes, feasibility, ranking).

For provider p with markup m_p, fixed fee F_p (send ccy) and percentage fee f_p:
    offered_rate = mid_rate × (1 − m_p)
    fee          = F_p + f_p × send
    received     = (send − fee) × offered_rate
    landed_cost  = send − received / mid_rate          (in send currency)
    effective_%  = landed_cost / send × 100
Reverse quote (recipient must receive exactly T):
    send = (T / offered_rate + F_p) / (1 − f_p)        (rounded UP to the minor unit)
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any, Literal

from ..config import load_yaml
from ..models import Workspace
from ..money import D, q_money, q_money_up, q_pct, q_rate, rate_display
from ..sandbox import fx
from ..sandbox.clock import add_business_days, now

Goal = Literal["cheapest", "fastest", "balanced"]
DISCLAIMER = "Sandbox demo. Not financial, legal or tax advice. Rates and fees are simulated."


@dataclass(frozen=True)
class Provider:
    id: str
    name: str
    channel: str
    markup: Decimal
    fee_fixed_usd: Decimal
    fee_pct: Decimal
    min_days: int
    max_days: int
    cutoff_hour_utc: int
    max_amount_usd: Decimal
    supports_tuition: bool
    requires_documents: bool
    corridors: tuple[str, ...]
    tuition_only: bool = False
    blurb: str = ""

    def supports(self, send_ccy: str, recv_ccy: str) -> bool:
        return "*" in self.corridors or f"{send_ccy}-{recv_ccy}" in self.corridors


def providers() -> list[Provider]:
    out = []
    for raw in load_yaml("providers.yaml")["providers"]:
        out.append(
            Provider(
                id=raw["id"],
                name=raw["name"],
                channel=raw["channel"],
                markup=D(raw["markup"]),
                fee_fixed_usd=D(raw["fee_fixed_usd"]),
                fee_pct=D(raw["fee_pct"]),
                min_days=int(raw["min_days"]),
                max_days=int(raw["max_days"]),
                cutoff_hour_utc=int(raw["cutoff_hour_utc"]),
                max_amount_usd=D(raw["max_amount_usd"]),
                supports_tuition=bool(raw["supports_tuition"]),
                requires_documents=bool(raw["requires_documents"]),
                corridors=tuple(raw["corridors"]),
                tuition_only=bool(raw.get("tuition_only", False)),
                blurb=raw.get("blurb", ""),
            )
        )
    return out


def get_provider(provider_id: str) -> Provider:
    for p in providers():
        if p.id == provider_id:
            return p
    raise KeyError(provider_id)


@dataclass
class Quote:
    provider_id: str
    provider_name: str
    channel: str
    send_currency: str
    receive_currency: str
    send_amount: Decimal
    receive_amount: Decimal
    fee: Decimal
    mid_rate: Decimal
    offered_rate: Decimal
    fx_markup_cost: Decimal
    landed_cost: Decimal
    effective_cost_pct: Decimal
    arrival_earliest: datetime
    arrival_latest: datetime
    amount_usd: Decimal
    requires_documents: bool
    feasible: bool = True
    reasons: list[str] = field(default_factory=list)
    score: Decimal | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "provider_id": self.provider_id,
            "provider_name": self.provider_name,
            "channel": self.channel,
            "send_currency": self.send_currency,
            "receive_currency": self.receive_currency,
            "send_amount": str(self.send_amount),
            "receive_amount": str(self.receive_amount),
            "fee": str(self.fee),
            "mid_rate": str(self.mid_rate),
            "offered_rate": str(self.offered_rate),
            "rate_display": rate_display(self.send_currency, self.receive_currency, self.offered_rate),
            "mid_display": rate_display(self.send_currency, self.receive_currency, self.mid_rate),
            "fx_markup_cost": str(self.fx_markup_cost),
            "landed_cost": str(self.landed_cost),
            "effective_cost_pct": str(self.effective_cost_pct),
            "arrival_earliest": self.arrival_earliest.isoformat(),
            "arrival_latest": self.arrival_latest.isoformat(),
            "amount_usd": str(q_money(self.amount_usd, "USD")),
            "requires_documents": self.requires_documents,
            "feasible": self.feasible,
            "reasons": self.reasons,
            "score": None if self.score is None else str(self.score),
        }


def fee_for(provider: Provider, send_amount: Decimal, send_ccy: str, usd_to_send: Decimal) -> Decimal:
    return q_money(provider.fee_fixed_usd * usd_to_send + provider.fee_pct * send_amount, send_ccy)


def arrival_window(provider: Provider, start: datetime) -> tuple[datetime, datetime]:
    if provider.max_days == 0:
        return start + timedelta(minutes=30), start + timedelta(hours=4)
    base = start
    if start.hour >= provider.cutoff_hour_utc or start.weekday() >= 5:
        # After the cut-off (or at weekends) processing starts on the next business day.
        base = add_business_days(start.replace(hour=9, minute=0, second=0, microsecond=0), 1)
    return add_business_days(base, provider.min_days), add_business_days(base, provider.max_days)


def quote_provider(
    ws: Workspace,
    provider: Provider,
    send_ccy: str,
    recv_ccy: str,
    *,
    send_amount: Decimal | None = None,
    receive_amount: Decimal | None = None,
    at: datetime | None = None,
    mid: Decimal | None = None,
) -> Quote:
    if (send_amount is None) == (receive_amount is None):
        raise ValueError("Provide exactly one of send_amount or receive_amount")
    send_ccy, recv_ccy = send_ccy.upper(), recv_ccy.upper()
    mid = q_rate(mid if mid is not None else fx.mid_rate(ws, send_ccy, recv_ccy))
    usd_to_send = fx.mid_rate(ws, "USD", send_ccy)
    offered = q_rate(mid * (Decimal("1") - provider.markup))
    fixed_fee = provider.fee_fixed_usd * usd_to_send

    if receive_amount is not None:
        received = q_money(receive_amount, recv_ccy)
        send = q_money_up((received / offered + fixed_fee) / (Decimal("1") - provider.fee_pct), send_ccy)
        fee = fee_for(provider, send, send_ccy, usd_to_send)
    else:
        send = q_money(send_amount, send_ccy)
        fee = fee_for(provider, send, send_ccy, usd_to_send)
        received = q_money(max(send - fee, Decimal("0")) * offered, recv_ccy)

    landed = q_money(send - received / mid, send_ccy)
    markup_cost = q_money(max(send - fee, Decimal("0")) * (mid - offered) / mid, send_ccy)
    pct = q_pct(landed / send * 100) if send > 0 else Decimal("0")
    start = at or now(ws)
    earliest, latest = arrival_window(provider, start)
    return Quote(
        provider_id=provider.id,
        provider_name=provider.name,
        channel=provider.channel,
        send_currency=send_ccy,
        receive_currency=recv_ccy,
        send_amount=send,
        receive_amount=received,
        fee=fee,
        mid_rate=mid,
        offered_rate=offered,
        fx_markup_cost=markup_cost,
        landed_cost=landed,
        effective_cost_pct=pct,
        arrival_earliest=earliest,
        arrival_latest=latest,
        amount_usd=send * fx.mid_rate(ws, send_ccy, "USD"),
        requires_documents=provider.requires_documents,
    )


def _check_feasibility(
    quote: Quote,
    provider: Provider,
    *,
    deadline: date | None,
    buffer_days: int,
    is_tuition: bool,
    payee_is_registry: bool,
) -> None:
    if not provider.supports(quote.send_currency, quote.receive_currency):
        quote.reasons.append(f"Does not support the {quote.send_currency}→{quote.receive_currency} corridor")
    if quote.amount_usd > provider.max_amount_usd:
        quote.reasons.append(
            f"Amount (≈${q_money(quote.amount_usd, 'USD'):,}) exceeds this provider's per-transfer limit of "
            f"${provider.max_amount_usd:,}; Remi never splits a payment to get around a limit"
        )
    if is_tuition and not provider.supports_tuition:
        quote.reasons.append("Not an approved channel for tuition payments")
    if provider.tuition_only and not (is_tuition and payee_is_registry):
        quote.reasons.append("Tuition-only rail: payee must be a verified institution")
    if deadline is not None:
        latest_ok = deadline - timedelta(days=buffer_days)
        if quote.arrival_latest.date() > latest_ok:
            quote.reasons.append(
                f"Worst-case arrival {quote.arrival_latest.date().isoformat()} is after the deadline minus "
                f"{buffer_days}-day safety buffer ({latest_ok.isoformat()})"
            )
    quote.feasible = not quote.reasons


def _rank(feasible: list[Quote], goal: Goal) -> list[Quote]:
    if not feasible:
        return []
    if goal == "cheapest":
        return sorted(feasible, key=lambda q: (q.landed_cost, q.arrival_latest))
    if goal == "fastest":
        return sorted(feasible, key=lambda q: (q.arrival_latest, q.landed_cost))
    costs = [q.landed_cost for q in feasible]
    hours = [D(q.arrival_latest.timestamp()) for q in feasible]
    c_lo, c_hi = min(costs), max(costs)
    t_lo, t_hi = min(hours), max(hours)
    for q, h in zip(feasible, hours):
        c_norm = (q.landed_cost - c_lo) / (c_hi - c_lo) if c_hi != c_lo else Decimal("0")
        t_norm = (h - t_lo) / (t_hi - t_lo) if t_hi != t_lo else Decimal("0")
        # Balanced goal: 70% weight on cost, 30% on worst-case delivery time (both min-max normalised).
        q.score = q_pct(Decimal("0.7") * c_norm + Decimal("0.3") * t_norm)
    return sorted(feasible, key=lambda q: (q.score, q.landed_cost))


def compare(
    ws: Workspace,
    send_ccy: str,
    recv_ccy: str,
    *,
    send_amount: Decimal | None = None,
    receive_amount: Decimal | None = None,
    deadline: date | None = None,
    goal: Goal = "cheapest",
    is_tuition: bool = False,
    payee_is_registry: bool = False,
    buffer_days: int | None = None,
) -> dict[str, Any]:
    buffer = buffer_days if buffer_days is not None else int(load_yaml("corridors.yaml")["default_safety_buffer_days"])
    mid = q_rate(fx.mid_rate(ws, send_ccy, recv_ccy))
    at = now(ws)
    quotes: list[Quote] = []
    for provider in providers():
        q = quote_provider(
            ws, provider, send_ccy, recv_ccy, send_amount=send_amount, receive_amount=receive_amount, at=at, mid=mid
        )
        _check_feasibility(
            q, provider, deadline=deadline, buffer_days=buffer, is_tuition=is_tuition, payee_is_registry=payee_is_registry
        )
        quotes.append(q)
    ranked = _rank([q for q in quotes if q.feasible], goal)
    infeasible = [q for q in quotes if not q.feasible]
    best = ranked[0] if ranked else None
    alternatives = []
    for q in ranked[1:]:
        extra = q_money(q.landed_cost - best.landed_cost, send_ccy) if best else Decimal("0")
        why = f"Costs {extra:,} {send_ccy} more than {best.provider_name}" if best and extra > 0 else "Ranked lower"
        if best and goal != "cheapest" and q.landed_cost < best.landed_cost:
            why = f"Cheaper by {abs(extra):,} {send_ccy} but slower (worst case {q.arrival_latest.date().isoformat()})"
        alternatives.append({"provider": q.provider_name, "why_not": why})
    for q in infeasible:
        alternatives.append({"provider": q.provider_name, "why_not": "; ".join(q.reasons)})
    mode = "reverse" if receive_amount is not None else "forward"
    explanation = {
        "inputs": {
            "send_currency": send_ccy,
            "receive_currency": recv_ccy,
            "send_amount": None if send_amount is None else str(send_amount),
            "receive_amount": None if receive_amount is None else str(receive_amount),
            "deadline": deadline.isoformat() if deadline else None,
            "goal": goal,
            "tuition": is_tuition,
        },
        "formula": (
            "send = (target / offered_rate + fixed_fee) / (1 − pct_fee); landed_cost = send − received / mid_rate"
            if mode == "reverse"
            else "received = (send − fee) × mid × (1 − markup); landed_cost = send − received / mid_rate"
        ),
        "alternatives": alternatives,
        "assumptions": [
            f"Worst-case business-day delivery with a {buffer}-day safety buffer before the deadline",
            "Fees and markups are the sandbox providers' published (fictional) tariffs",
            "Mid-market rate is the sandbox snapshot plus simulated ticks",
        ],
        "data_timestamp": at.isoformat(timespec="seconds"),
        "rates_label": fx.fx_config()["label"],
        "sources": ["How cross-border transfers work", "FX and fee glossary"],
        "disclaimer": DISCLAIMER,
    }
    return {
        "mode": mode,
        "goal": goal,
        "mid_rate": str(mid),
        "recommended": best.to_dict() if best else None,
        "options": [q.to_dict() for q in ranked],
        "rejected": [q.to_dict() for q in infeasible],
        "explanation": explanation,
        "no_feasible_option": best is None,
    }
