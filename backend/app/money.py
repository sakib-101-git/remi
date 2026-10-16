from __future__ import annotations

from decimal import ROUND_HALF_EVEN, ROUND_HALF_UP, Decimal, getcontext

getcontext().prec = 28

MINOR_UNITS: dict[str, int] = {"BDT": 2, "GBP": 2, "USD": 2, "CAD": 2, "NGN": 2, "INR": 2, "EUR": 2}
SYMBOLS: dict[str, str] = {"BDT": "৳", "GBP": "£", "USD": "$", "CAD": "C$", "NGN": "₦", "INR": "₹", "EUR": "€"}
RATE_PLACES = Decimal("0.0000000001")
ZERO = Decimal("0")


def D(value: object) -> Decimal:
    if isinstance(value, Decimal):
        return value
    if isinstance(value, float):
        # Floats are routed through repr so 0.1 becomes Decimal("0.1"), not its binary expansion.
        return Decimal(repr(value))
    return Decimal(str(value))


def q_money(amount: object, currency: str) -> Decimal:
    places = MINOR_UNITS.get(currency.upper(), 2)
    return D(amount).quantize(Decimal(1).scaleb(-places), rounding=ROUND_HALF_UP)


def q_money_up(amount: object, currency: str) -> Decimal:
    """Round up to the next minor unit; used when the sender must cover a target exactly."""
    places = MINOR_UNITS.get(currency.upper(), 2)
    step = Decimal(1).scaleb(-places)
    value = D(amount)
    rounded = value.quantize(step, rounding=ROUND_HALF_UP)
    return rounded + step if rounded < value else rounded


def q_rate(rate: object) -> Decimal:
    return D(rate).quantize(RATE_PLACES, rounding=ROUND_HALF_EVEN)


def q_pct(value: object, places: int = 2) -> Decimal:
    return D(value).quantize(Decimal(1).scaleb(-places), rounding=ROUND_HALF_UP)


def rate_display(base: str, quote: str, rate: object) -> str:
    """Human-friendly rate: small rates are shown inverted (1 GBP = 164.43 BDT rather than 1 BDT = 0.0061 GBP)."""
    r = D(rate)
    if r == 0:
        return f"1 {base} = 0 {quote}"
    if r < 1:
        return f"1 {quote} = {(Decimal(1) / r).quantize(Decimal('0.0001'))} {base}"
    return f"1 {base} = {r.quantize(Decimal('0.0001'))} {quote}"


def fmt(amount: object, currency: str) -> str:
    value = q_money(amount, currency)
    return f"{SYMBOLS.get(currency, '')}{value:,.{MINOR_UNITS.get(currency, 2)}f} {currency}".strip()
