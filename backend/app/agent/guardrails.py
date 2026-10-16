"""Deterministic guardrails that run before and after the LLM. Security decisions never depend on the model."""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

EVASION = re.compile(
    r"(without (it )?(being |getting )?(reported|flagged|detected|traced|noticed)|avoid(ing)? (the )?(report|reporting|tax|kyc|aml|detection|checks?)"
    r"|under the (reporting )?(radar|threshold)|launder|money mule|hide (the|this|my)? ?(money|transfer|payment)s?"
    r"|bypass (the )?(kyc|limit|check|verification)|fake (invoice|document|purpose)|evade|structur(e|ing) (it|the|my|payments?))",
    re.I,
)
GOVERNANCE = re.compile(
    r"((raise|increase|change|remove|lift|bump|double|up)\b.{0,30}\b(limit|limits|threshold|thresholds|permission|permissions))"
    r"|(\bset\b.{0,20}\b(daily|monthly|transaction|transfer)\s+limits?)"
    r"|((disable|turn off|switch off|remove|skip)\b.{0,30}\b(alerts?|step[- ]?up|otp|cooling[- ]off|verification|confirmations?|kill switch))"
    r"|((delete|erase|edit|modify|clear|wipe)\b.{0,20}\b(audit|log|logs))"
    r"|(export (all )?(user|customer)s?'? (data|pii))|(give (yourself|remi) (permission|access))",
    re.I,
)
OFF_TOPIC = re.compile(r"\b(write (me )?(a )?(poem|essay|code|story)|recipe|weather|football|movie|homework|crypto(currency)? (tips|picks)|which stock|lottery)\b", re.I)
SPECULATION = re.compile(r"\b(will (the )?(pound|gbp|dollar|usd|taka|bdt|naira|rupee|cad|rate)s? (go|rise|fall|drop|crash|increase)|predict|forecast|best time to (buy|convert)|should i invest)\b", re.I)
SPLIT_REQUEST = re.compile(r"\b(split|break (it )?(up|into)|smaller (payments|transfers|amounts)|several (payments|transfers)|multiple (payments|transfers))\b", re.I)
CLAIM_DONE = re.compile(r"\b(i('ve| have)|has been|have been|was|were|successfully)\s+(sent|paid|transferred|converted|executed|completed|added)\b", re.I)


@dataclass
class Precheck:
    kind: str | None = None
    message: str = ""
    cards: list[dict[str, Any]] = field(default_factory=list)


def precheck(text: str) -> Precheck:
    if EVASION.search(text):
        return Precheck(
            kind="evasion",
            message=(
                "I can't help with moving money in a way that avoids reporting, identity checks or limits - that can be illegal "
                "and gets accounts frozen. Monitoring is normal and, for legitimate family support or tuition, usually means at most "
                "a request for documents. I can help you send money the right way: pick a regulated channel, state the true purpose, "
                "and prepare source-of-funds evidence. [KB: Why transfers are monitored and reported] [KB: Transfer limits and why Remi never splits payments]"
            ),
            cards=[{"type": "refusal", "data": {"reason": "evasion", "title": "Request declined", "detail": "Remi never helps avoid reporting, KYC or limits."}},
                   {"type": "sources", "data": [{"slug": "why-transfers-are-reported", "title": "Why transfers are monitored and reported", "illustrative": False},
                                                {"slug": "limits-and-no-splitting", "title": "Transfer limits and why Remi never splits payments", "illustrative": False}]}],
        )
    if GOVERNANCE.search(text):
        return Precheck(
            kind="governance",
            message=(
                "That's a governance change (tier T4), so I'm not allowed to do it - not even if you ask me. Only you can change limits, "
                "permissions or safety settings, in Settings → Limits, and it needs step-up verification. The audit log can never be edited or deleted. "
                "[KB: How Remi's safety tiers work]"
            ),
            cards=[{"type": "refusal", "data": {"reason": "governance", "title": "T4 - human only", "detail": "Open Settings → Limits to change this yourself (step-up required).", "link": "/settings"}},
                   {"type": "sources", "data": [{"slug": "remi-safety-tiers", "title": "How Remi's safety tiers work", "illustrative": False}]}],
        )
    if OFF_TOPIC.search(text):
        return Precheck(kind="off_topic", message="I'm Remi, a money agent for international students, so I'll stay on finance: transfers, tuition, wallets, budgets, credit building and scam checks. What can I do for you there?")
    return Precheck()


def is_speculation(text: str) -> bool:
    return bool(SPECULATION.search(text))


def validate_output(text: str, executed_this_turn: bool, proposed_this_turn: bool) -> str:
    """Never let the model claim money moved when nothing was executed."""
    if CLAIM_DONE.search(text) and not executed_this_turn:
        text = CLAIM_DONE.sub(lambda m: f"{m.group(1)} prepared", text)
    if proposed_this_turn and not executed_this_turn and "Nothing has moved yet" not in text:
        text = text.rstrip() + "\n\nNothing has moved yet - review the action card and confirm it if everything looks right."
    return text.strip()


def add_split_refusal(user_text: str, reply: str) -> str:
    """An explicit request to split around a limit always gets an explicit refusal, whatever the model wrote."""
    if SPLIT_REQUEST.search(user_text) and not re.search(r"\bsplit", reply, re.I):
        reply += "\n\nI won't split this into smaller payments to get around a limit - that is structuring. The full amount goes through a channel that supports it. [KB: Transfer limits and why Remi never splits payments]"
    return reply
