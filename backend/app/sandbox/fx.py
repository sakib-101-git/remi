from __future__ import annotations

import math
import random
from datetime import date
from decimal import Decimal

from ..config import load_yaml
from ..models import Workspace
from ..money import D, q_rate


def fx_config() -> dict:
    return load_yaml("fx_rates.yaml")


def snapshot_rates() -> dict[str, Decimal]:
    return {ccy: D(v) for ccy, v in fx_config()["rates"].items()}


def supported_currencies() -> list[str]:
    return list(fx_config()["rates"].keys())


def current_rates(ws: Workspace) -> dict[str, Decimal]:
    if not ws.fx_rates:
        return snapshot_rates()
    return {ccy: D(v) for ccy, v in ws.fx_rates.items()}


def cross(rates: dict[str, Decimal], base: str, quote: str) -> Decimal:
    """Units of `quote` per 1 unit of `base`, from USD-based rates."""
    base, quote = base.upper(), quote.upper()
    if base not in rates or quote not in rates:
        raise ValueError(f"Unsupported currency pair {base}/{quote}")
    if base == quote:
        return Decimal("1")
    return rates[quote] / rates[base]


def mid_rate(ws: Workspace, base: str, quote: str) -> Decimal:
    return cross(current_rates(ws), base, quote)


def to_usd(ws: Workspace, amount: Decimal, currency: str) -> Decimal:
    return D(amount) * mid_rate(ws, currency, "USD")


def _phase(ccy: str) -> float:
    return (sum(ord(c) for c in ccy) % 17) / 17 * 2 * math.pi


def historical_rate(base: str, quote: str, day: date) -> Decimal:
    """Deterministic synthetic history around the snapshot (±1.2% seasonal wave). Sandbox only."""
    snap = snapshot_rates()
    ordinal = day.toordinal()
    shifted: dict[str, Decimal] = {}
    for ccy in {base.upper(), quote.upper()}:
        if ccy == "USD":
            shifted[ccy] = Decimal("1")
            continue
        wave = 0.012 * math.sin(2 * math.pi * ordinal / 23 + _phase(ccy))
        shifted[ccy] = snap[ccy] * D(round(1 + wave, 8))
    shifted.setdefault("USD", Decimal("1"))
    return cross(shifted, base, quote)


def tick(ws: Workspace, steps: int = 1, shock: tuple[str, Decimal] | None = None) -> dict[str, Decimal]:
    """Advance the per-workspace random walk. Seeded by workspace id + tick count, so runs are reproducible."""
    cfg = fx_config()["tick"]
    vol = float(cfg["volatility"])
    rates = current_rates(ws)
    for _ in range(max(1, steps)):
        rng = random.Random(f"{ws.id}:{ws.fx_tick}")
        for ccy in sorted(rates):
            if ccy == "USD":
                continue
            rates[ccy] = q_rate(rates[ccy] * D(round(1 + rng.gauss(0, vol), 8)))
        ws.fx_tick += 1
    if shock:
        ccy, pct = shock
        rates[ccy.upper()] = q_rate(rates[ccy.upper()] * (Decimal("1") + D(pct)))
    ws.fx_rates = {ccy: str(v) for ccy, v in rates.items()}
    return rates


def reset_rates(ws: Workspace) -> None:
    ws.fx_rates = {ccy: str(v) for ccy, v in snapshot_rates().items()}
    ws.fx_tick = 0
