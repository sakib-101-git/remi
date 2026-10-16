from __future__ import annotations

from typing import Any

from ..config import load_yaml

DISCLAIMER = "Illustrative checklist for the sandbox. Requirements vary by bank and country; verify with official sources. Not legal or tax advice."
SOURCES_OF_FUNDS = ["Family support", "Personal savings", "Scholarship / sponsor", "Education loan", "Employment income"]


def corridor_rules(send_ccy: str, recv_ccy: str, is_tuition: bool) -> dict[str, Any]:
    corridors = load_yaml("corridors.yaml")["corridors"]
    key = f"{send_ccy.upper()}-{recv_ccy.upper()}"
    rules = corridors.get(key) if is_tuition else None
    return rules or corridors["default"]


def checklist(send_ccy: str, recv_ccy: str, is_tuition: bool, kyc_status: str = "verified") -> dict[str, Any]:
    rules = corridor_rules(send_ccy, recv_ccy, is_tuition)
    return {
        "corridor": f"{send_ccy.upper()}→{recv_ccy.upper()}",
        "payment_type": "tuition" if is_tuition else "personal",
        "kyc_status": kyc_status,
        "purpose_codes": rules["purpose_codes"],
        "documents": rules["documents"],
        "source_of_funds_options": SOURCES_OF_FUNDS,
        "note": rules["note"],
        "illustrative": True,
        "disclaimer": DISCLAIMER,
        "sources": ["Tuition payment documentation checklist"],
    }


def default_purpose(send_ccy: str, recv_ccy: str, is_tuition: bool, beneficiary_kind: str) -> str:
    codes = [c["code"] for c in corridor_rules(send_ccy, recv_ccy, is_tuition)["purpose_codes"]]
    if is_tuition and "EDU-TUITION" in codes:
        return "EDU-TUITION"
    if beneficiary_kind == "landlord":
        return "RENT"
    if beneficiary_kind == "family":
        return "FAM-SUPPORT"
    return codes[0]
