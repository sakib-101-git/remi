"""Invoice / document review with fraud and prompt-injection defences.

Document text is untrusted. Remi extracts fields deterministically, but payee bank details are NEVER taken
from a document: a university payment always uses the verified-registry account, and any mismatch blocks.
"""
from __future__ import annotations

import re

from decimal import Decimal
from typing import Any

from sqlmodel import select

from ..audit import log as audit
from ..models import Invoice
from ..money import D
from ..sandbox.clock import today
from ..security import injection
from ..security.redact import mask_account
from . import beneficiaries as bene
from .context import Ctx

_CCY = {"£": "GBP", "$": "USD", "c$": "CAD", "৳": "BDT", "₦": "NGN", "₹": "INR", "€": "EUR"}
_AMOUNT_RE = re.compile(r"(?i)(GBP|USD|CAD|BDT|NGN|INR|EUR|C\$|£|\$|৳|₦|₹|€)\s?([\d]{1,3}(?:,\d{3})*(?:\.\d{2})?|\d+(?:\.\d{2})?)")
_ACCOUNT_RE = re.compile(r"\b([A-Z]{2}\d{2}[A-Z0-9]{10,30})\b")
_ACCOUNT_LABEL_RE = re.compile(r"(?i)(?:account(?: number| no\.?)?|iban)\s*[:#]?\s*([A-Z0-9][A-Z0-9 -]{7,34})")
_REF_RE = re.compile(r"(?i)\b(?:reference|ref|invoice(?: no\.?| number)?)\s*[:#]\s*([A-Z0-9-]{4,30})")
_DUE_RE = re.compile(r"(?i)due(?: date)?\s*[:\-]?\s*(\d{4}-\d{2}-\d{2})")


def extract(text: str) -> dict[str, Any]:
    amount = currency = None
    m = _AMOUNT_RE.search(text)
    if m:
        currency = _CCY.get(m.group(1).lower(), m.group(1).upper())
        amount = D(m.group(2).replace(",", ""))
    accounts = _ACCOUNT_RE.findall(text) or [re.sub(r"[\s-]", "", a) for a in _ACCOUNT_LABEL_RE.findall(text)]
    ref = _REF_RE.search(text)
    due = _DUE_RE.search(text)
    institution = None
    for entry in bene.registry():
        short = entry["name"].replace(" (demo)", "")
        if short.lower() in text.lower() or short.split()[0].lower() in text.lower():
            institution = entry
            break
    return {
        "institution": institution,
        "amount": amount,
        "currency": currency,
        "accounts": accounts,
        "reference": ref.group(1) if ref else None,
        "due_date": due.group(1) if due else None,
    }


def analyze(ctx: Ctx, text: str, source: str = "uploaded_document") -> dict[str, Any]:
    scan = injection.scan(text)
    fields = extract(text)
    institution = fields["institution"]
    warnings: list[str] = []
    verdict = "ok"
    registry_match: bool | None = None
    if institution:
        doc_accounts = fields["accounts"]
        registry_match = all(a == institution["account_number"] for a in doc_accounts) if doc_accounts else True
        if not registry_match:
            verdict = "blocked"
            warnings.append(
                f"Possible invoice fraud: the document's bank account {', '.join(mask_account(a) for a in doc_accounts)} does not match "
                f"the verified account for {institution['name']} ({mask_account(institution['account_number'])})."
            )
    if scan.suspicious:
        verdict = "blocked"
        warnings.append("The document contains instructions aimed at the assistant or claims bank details changed; Remi ignores them.")
    elif scan.flags:
        warnings.append("The document uses urgency or secrecy language often seen in scams.")
    if fields["accounts"] and not institution:
        warnings.append("Payee is not in the verified registry; Remi will not add a payee from a document.")

    result = {
        "verdict": verdict,
        "fraud_suspected": verdict == "blocked",
        "institution": institution["name"] if institution else None,
        "registry_match": registry_match,
        "extracted": {
            "amount": None if fields["amount"] is None else str(fields["amount"]),
            "currency": fields["currency"],
            "reference": fields["reference"],
            "due_date": fields["due_date"],
            "accounts_in_document": [mask_account(a) for a in fields["accounts"]],
        },
        "injection_flags": [f["label"] for f in scan.flags],
        "warnings": warnings,
        "safe_next_step": (
            "Do not pay this document. Contact the university through its official, previously known channels. "
            "Remi can still pay the verified invoice already on file to the registry account."
            if verdict == "blocked" else
            "Details match the verified registry. Remi can draft a payment to the verified account."
        ),
    }
    audit.append(
        ctx.session, ctx.ws_id, "system", "document.reviewed", tool="analyze_document", tier="T0",
        inputs={"source": source, "chars": len(text)},
        decision="flagged" if verdict == "blocked" else "clean",
        result={"verdict": verdict, "flags": result["injection_flags"], "registry_match": registry_match},
    )
    if verdict == "blocked":
        ctx.notify("fraud", "Possible invoice fraud detected", warnings[0], {"source": source})
    return result


def open_invoices(ctx: Ctx) -> list[Invoice]:
    return list(ctx.session.exec(select(Invoice).where(Invoice.workspace_id == ctx.ws_id, Invoice.user_id == ctx.user.id, Invoice.status == "open")).all())


def draft_from_invoice(ctx: Ctx, invoice_id: str | None = None) -> dict[str, Any]:
    invoices = open_invoices(ctx)
    inv = next((i for i in invoices if i.id == invoice_id), None) if invoice_id else (invoices[0] if invoices else None)
    if inv is None:
        return {"status": "not_found", "message": "No open invoice on file"}
    entry = bene.registry_entry(inv.registry_id) if inv.registry_id else None
    payee = next((b for b in bene.all_for_user(ctx) if entry and b.registry_id == entry["id"]), None)
    return {
        "status": "drafted",
        "invoice_id": inv.id,
        "issuer": inv.issuer,
        "amount": str(inv.amount),
        "currency": inv.currency,
        "due_date": inv.due_date.isoformat(),
        "days_left": (inv.due_date - today(ctx.ws)).days,
        "reference": inv.reference,
        "beneficiary_id": payee.id if payee else None,
        "verified_account": mask_account(entry["account_number"]) if entry else None,
        "note": "Draft only - nothing has been sent. Payee account comes from the verified registry, not the document.",
    }


def to_dict(inv: Invoice) -> dict[str, Any]:
    return {
        "id": inv.id, "issuer": inv.issuer, "amount": str(inv.amount), "currency": inv.currency,
        "due_date": inv.due_date.isoformat(), "reference": inv.reference, "status": inv.status,
    }


def amount_decimal(value: Any) -> Decimal | None:
    return None if value in (None, "") else D(value)
