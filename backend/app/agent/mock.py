"""Deterministic offline agent. It speaks the same tool-calling protocol as a real model and calls the SAME tools,
so the whole pipeline (policy, tokens, audit, cards) is exercised without any network or quota."""
from __future__ import annotations

import json
import re
from decimal import Decimal
from typing import Any

from ..money import D
from ..security.injection import UNTRUSTED_OPEN
from .llm import ChatResult, ToolCall

CCY_WORDS = {
    "gbp": "GBP", "£": "GBP", "pound": "GBP", "pounds": "GBP", "bdt": "BDT", "taka": "BDT", "tk": "BDT", "৳": "BDT",
    "usd": "USD", "$": "USD", "dollar": "USD", "dollars": "USD", "cad": "CAD", "c$": "CAD", "ngn": "NGN", "naira": "NGN", "₦": "NGN",
    "inr": "INR", "rupee": "INR", "rupees": "INR", "₹": "INR", "eur": "EUR", "€": "EUR",
}
_AMT = re.compile(
    r"(?P<pre>£|\$|c\$|৳|₦|₹|€|gbp|bdt|usd|cad|ngn|inr|eur)?\s?(?P<num>\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s?(?P<k>k\b)?\s?(?P<post>gbp|bdt|usd|cad|ngn|inr|eur|taka|tk|pounds?|dollars?|naira|rupees?)?",
    re.I,
)
PROVIDERS = {"alpha": "alpha_remit", "beta": "beta_express", "bank wire": "bank_wire", "wire": "bank_wire", "campus": "campus_pay"}
_IBAN = re.compile(r"\b([A-Z]{2}\d{2}[A-Z0-9]{10,30})\b")


def parse_amounts(text: str) -> list[tuple[Decimal, str | None]]:
    out = []
    for m in _AMT.finditer(text):
        pre, post = (m.group("pre") or "").lower(), (m.group("post") or "").lower()
        num = m.group("num").replace(",", "")
        if re.fullmatch(r"20\d\d", num) and not (pre or post):
            continue
        # Skip pair rates like "GBP/BDT 163.5" being read as amounts of GBP.
        start = m.start()
        if text[max(0, start - 1):start] == "/" or (pre and text[m.end("pre"):m.end("pre") + 1] == "/"):
            continue
        value = D(num) * (1000 if m.group("k") else 1)
        ccy = CCY_WORDS.get(pre) or CCY_WORDS.get(post.rstrip("s")) or CCY_WORDS.get(post)
        out.append((value, ccy))
    return out


def _recipient(text: str) -> str | None:
    t = text.lower()
    for word in ("mom", "mum", "mother", "ammu", "dad", "father", "abbu", "landlord", "university", "college", "uni"):
        if re.search(rf"\b{word}\b", t):
            return word
    m = re.search(r"\b(?:to|pay)\s+(?:my\s+)?([A-Z][\w'&.-]*(?:\s+[A-Z(][\w'&.)-]*){0,4})", text)
    if m:
        name = re.sub(r"\s+(via|with|using|through|today|now|tomorrow|for|by|before)\b.*$", "", m.group(1)).strip(" .,")
        if name.lower() not in {"i", "me", "my", "remi"}:
            return name
    return None


def _provider(text: str) -> str | None:
    t = text.lower()
    for key, pid in PROVIDERS.items():
        if key in t:
            return pid
    return None


def _goal(text: str) -> str:
    t = text.lower()
    if re.search(r"\b(fastest|asap|urgent|quick(ly)?|today)\b", t):
        return "fastest"
    if "balanced" in t:
        return "balanced"
    return "cheapest"


def _tool_results(messages: list[dict[str, Any]]) -> list[tuple[str, dict[str, Any], dict[str, Any]]]:
    """(tool name, args, result) for calls made since the last user message."""
    last_user = max((i for i, m in enumerate(messages) if m["role"] == "user"), default=0)
    calls: dict[str, tuple[str, dict[str, Any]]] = {}
    out = []
    for m in messages[last_user + 1:]:
        if m["role"] == "assistant":
            for c in m.get("tool_calls") or []:
                calls[c["id"]] = (c["function"]["name"], json.loads(c["function"]["arguments"] or "{}"))
        elif m["role"] == "tool":
            name, args = calls.get(m["tool_call_id"], (m.get("name", ""), {}))
            try:
                data = json.loads(m["content"])
            except json.JSONDecodeError:
                data = {"raw": m["content"]}
            out.append((name, args, data))
    return out


_NUM_IN_TEXT = re.compile(r"(?<![\w.,:/•-])(\d{4,})(\.\d+)?(?![\w-])")


def _commas(text: str) -> str:
    """Add thousands separators to bare numbers in composed replies (dates, refs and IDs are untouched)."""
    return _NUM_IN_TEXT.sub(lambda m: f"{int(m.group(1)):,}{m.group(2) or ''}", text)


def _call(name: str, args: dict[str, Any], n: int) -> ChatResult:
    return ChatResult(content="", tool_calls=[ToolCall(id=f"mock_{n}_{name}", name=name, arguments=json.dumps(args))])


def _say(text: str) -> ChatResult:
    return ChatResult(content=_commas(text))


def _strip_untrusted(text: str) -> str:
    return re.sub(r"<<UNTRUSTED_DATA[^>]*>>\n?|\n?<<END_UNTRUSTED_DATA>>", "", text)


class MockAgent:
    name = "mock"
    model = "remi-mock-1"

    def available(self) -> bool:
        return True

    def chat(self, messages: list[dict[str, Any]], tools: list[dict[str, Any]]) -> ChatResult:
        user_msg = next((m for m in reversed(messages) if m["role"] == "user"), {"content": ""})
        raw = str(user_msg.get("content", ""))
        has_doc = UNTRUSTED_OPEN in raw
        text = raw.split(UNTRUSTED_OPEN)[0].strip() if has_doc else raw
        done = _tool_results(messages)
        names = [d[0] for d in done]
        available = {t["function"]["name"] for t in tools}
        n = len(done)

        if any(d[2].get("error") for d in done):
            err = next(d[2]["error"] for d in done if d[2].get("error"))
            return _say(f"I couldn't complete that: {err}")

        t = text.lower()
        if has_doc:
            return self._document(done, n)
        if re.search(r"\b(tell|notify|alert|ping|let) me (know )?when\b|\brate alert\b|\bwatch the rate\b", t) and "set_rate_alert" in available:
            return self._alert(text, done, n)
        if re.search(r"(receive|get|arrive)s? exactly|must receive|needs? to receive|how much .*\b(send|need)\b", t):
            return self._reverse(text, done, n)
        if re.search(r"credit (history|score|file|record|card)|build(ing)? (my )?credit|no credit", t):
            return self._credit(text, done, n)
        if re.search(r"how am i doing|budget|spending|spent|runway|how long .*last|money last|afford|insights?", t):
            return self._budget(done, n)
        if re.match(r"^\s*(what|which|why|where|who|how (do|does|can|should|is|are)|do i|does|is it|are there|can i|when should|explain|tell me about)\b", t):
            return self._knowledge(text, done, n)
        if _IBAN.search(text) and re.search(r"\b(add|new|pay)\b", t):
            return self._add_payee(text, done, n)
        if re.search(r"\b(pay|settle)\b.{0,40}\b(tuition|fees|invoice)\b", t):
            return self._tuition(text, done, n)
        if re.search(r"\b(should i|now or|wait)\b.{0,40}\bconvert|\bconvert\b.{0,40}\b(now or|or wait|tranche)", t):
            return self._fx_options(text, done, n)
        if re.search(r"\b(convert|exchange|move)\b", t) and parse_amounts(text):
            return self._convert(text, done, n)
        if re.search(r"\b(send|transfer|pay|wire|remit)\b", t):
            return self._send(text, done, n)
        if re.search(r"\b(compare|cheapest way|quote|providers?)\b", t):
            return self._quotes(text, done, n)
        if re.search(r"\b(exchange )?rates?\b", t) and "get_fx_rates" in available:
            return self._simple("get_fx_rates", {}, done, n, self._fmt_rates)
        if re.search(r"\b(balance|wallets?|how much (money )?do i have)\b", t):
            return self._simple("get_wallets", {}, done, n, self._fmt_wallets)
        if re.search(r"\b(transactions?|recent payments|history)\b", t):
            return self._simple("get_transactions", {"limit": 8}, done, n, self._fmt_txns)
        return self._knowledge(text, done, n)

    # ---- flows ---------------------------------------------------------------

    def _simple(self, tool: str, args: dict[str, Any], done: list, n: int, fmt: Any) -> ChatResult:
        if not done:
            return _call(tool, args, n)
        return _say(fmt(done[-1][2]))

    def _document(self, done: list, n: int) -> ChatResult:
        if not done:
            return _call("analyze_document", {}, n)
        r = done[0][2]
        if r.get("fraud_suspected"):
            lines = ["**I blocked this document - it looks like invoice fraud.**", ""]
            lines += [f"- {w}" for w in r.get("warnings", [])]
            lines += ["", r.get("safe_next_step", ""), "", "I did not add any payee or prepare any payment from it, and I ignored the instructions it contained. This review is in your audit log. [KB: Invoice fraud and scam red flags]"]
            return _say("\n".join(lines))
        if "draft_payment" not in [d[0] for d in done]:
            return _call("draft_payment", {}, n)
        d = done[-1][2]
        return _say(f"The document matches the verified registry for {r.get('institution')}. I drafted a payment of {d.get('amount')} {d.get('currency')} (reference {d.get('reference')}) to the verified account {d.get('verified_account')}. Nothing is sent yet - say \"pay my tuition\" and I'll compare providers.")

    def _alert(self, text: str, done: list, n: int) -> ChatResult:
        if not done:
            pair = re.search(r"\b([A-Za-z]{3})\s*/\s*([A-Za-z]{3})\b", text)
            base, quote = (pair.group(1).upper(), pair.group(2).upper()) if pair else ("GBP", "BDT")
            target = re.search(r"(better than|below|under|above|over|reaches|hits|drops to|goes to|is at)\s*([\d.,]+)", text, re.I)
            if not target:
                return _say(f"What rate should I watch for on {base}/{quote}? (For example: tell me when {base}/{quote} is below 163.5.)")
            args: dict[str, Any] = {"base": base, "quote": quote, "target_rate": target.group(2).rstrip(".,")}
            word = target.group(1).lower()
            if word in ("above", "over"):
                args["direction"] = "above"
            elif word in ("below", "under", "drops to"):
                args["direction"] = "below"
            conv = re.search(r"convert\s+(£|\$|€)?\s?([\d,]+(?:\.\d+)?)\s*([A-Za-z]{3})?", text, re.I)
            if conv:
                args["convert_amount"] = conv.group(2).replace(",", "")
                args["convert_currency"] = (CCY_WORDS.get((conv.group(1) or "").lower()) or (conv.group(3) or base)).upper()
            return _call("set_rate_alert", args, n)
        r = done[0][2]
        msg = f"Done - I'm watching **{r['pair']}** and will alert you when it goes {r['direction']} **{r['target_rate']}** (now {Decimal(r['current_rate']).quantize(Decimal('0.01'))}, sandbox rate)."
        if r.get("convert_amount"):
            msg += f" When it triggers I'll prepare a conversion of {r['convert_amount']} {r['convert_currency']} for you to confirm - nothing converts automatically."
        msg += " I won't predict where the rate goes; the target may never be hit. [KB: Converting currency without speculating]"
        return _say(msg)

    def _reverse(self, text: str, done: list, n: int) -> ChatResult:
        if not done:
            amounts = parse_amounts(text)
            amt = next(((a, c) for a, c in amounts if c), amounts[0] if amounts else None)
            recipient = _recipient(text) or ("university" if re.search(r"universit|tuition|college", text, re.I) else None)
            if not amt:
                return _say("How much exactly must the recipient receive, and in which currency?")
            args = {"target_amount": str(amt[0]), "target_currency": amt[1] or "GBP"}
            if recipient:
                args["recipient"] = recipient
            src = re.search(r"how much\s+([A-Za-z]{3}|taka|naira|rupees?)\b", text, re.I)
            if src:
                args["from_currency"] = CCY_WORDS.get(src.group(1).lower(), src.group(1).upper())
            return _call("reverse_quote", args, n)
        r = done[0][2]
        best = r.get("recommended")
        if not best:
            return _say("No provider can deliver that exact amount before the deadline. " + "; ".join(a["why_not"] for a in r.get("alternatives", [])[:3]))
        lines = [
            f"To have exactly **{best['receive_amount']} {best['receive_currency']}** arrive, send **{best['send_amount']} {best['send_currency']}** with **{best['provider_name']}**.",
            "",
            f"- Rate {best['rate_display']} (mid-market {best['mid_display']}), fee {best['fee']} {best['send_currency']}",
            f"- Landed cost {best['landed_cost']} {best['send_currency']} ({best['effective_cost_pct']}% of the amount)",
            f"- Worst-case arrival {best['arrival_latest'][:10]}" + (f", before the {r['deadline']} deadline" if r.get("deadline") else ""),
            "- Formula: send = (target ÷ offered rate + fixed fee) ÷ (1 − % fee), rounded up so the target is never short.",
        ]
        alts = r.get("alternatives", [])
        if alts:
            lines += ["", "Why not the others: " + "; ".join(f"{a['provider']}: {a['why_not']}" for a in alts[:3])]
        lines += ["", "Want me to prepare this payment for your confirmation? [KB: FX and fee glossary]"]
        return _say("\n".join(lines))

    def _credit(self, text: str, done: list, n: int) -> ChatResult:
        t = text.lower()
        mark = re.search(r"\b(done|finished|completed|did|started)\b", t)
        if not done:
            if mark:
                return _call("get_credit_plan", {}, n)
            return _call("create_credit_plan", {}, n)
        if mark and done[0][0] == "get_credit_plan" and len(done) == 1:
            tasks = done[0][2].get("tasks", [])
            target = next((tk for tk in tasks if any(w in tk["title"].lower() for w in re.findall(r"[a-z]{5,}", t) if w not in {"finished", "completed", "started", "credit"})), None)
            if target:
                status = "in_progress" if "started" in t else "done"
                return _call("update_credit_task", {"task_key": target["task_key"], "status": status}, n)
            return _say("Which credit task did you complete? You can also tick it off on the Credit page.")
        if done[-1][0] == "update_credit_task":
            r = done[-1][2]
            return _say(f"Updated - **{r['task_key'].replace('_', ' ')}** is now {r['task_status'].replace('_', ' ')}. Your simulated credit-readiness score is **{r['readiness_score']}/100**.")
        p = done[-1][2]
        steps = "\n".join(f"{i}. **Month {s['month']}** - {s['title']}" for i, s in enumerate(p.get("tasks", [])[:6], 1))
        return _say(
            f"Welcome to the {p.get('country_label')}! Having no local credit history is normal for new arrivals. I've created a 6-month credit-building plan and I'll track it with you:\n\n{steps}\n\n"
            f"Your simulated credit-readiness score starts at **{p.get('readiness_score', 0)}/100** and rises as you complete tasks. Start with: **{(p.get('next_steps') or [{'title': '-'}])[0]['title']}**.\n\n"
            f"_{p.get('disclaimer')}_ [KB: Credit-building basics ({p.get('country')})]"
        )

    def _budget(self, done: list, n: int) -> ChatResult:
        if not done:
            return _call("get_budget_summary", {}, n)
        s = done[0][2]
        ccy = s["reporting_currency"]
        rw = s["runway"]
        cats = ", ".join(f"{c['category']} {c['last_30_days']}" for c in s.get("top_categories", [])[:4])
        recs = "\n".join(f"{i}. **{r['title']}** - {r['detail']}" for i, r in enumerate(s.get("recommendations", []), 1))
        multi = ", ".join(f"{v} {k}" for k, v in s.get("spend_by_original_currency", {}).items())
        return _say(
            f"Over the last 30 days you spent **{s['total_spend_30d']} {ccy}** (previous 30 days: {s['total_spend_prev_30d']} {ccy}), spread across {multi}, all converted to {ccy} at each day's sandbox rate. Biggest categories: {cats}.\n\n"
            f"**Runway:** after setting aside {rw['reserved_for_obligations']} {ccy} for upcoming obligations, your money lasts about **{rw['runway_days']} days - until {rw['runway_until']}** at {rw['daily_burn']} {ccy}/day. {rw['excludes']}\n\n"
            f"Three things you could do:\n{recs}\n\n[KB: Understanding your runway]"
        )

    def _tuition(self, text: str, done: list, n: int) -> ChatResult:
        names = [d[0] for d in done]
        if not done:
            return _call("get_obligations", {}, n)
        if "propose_payment" not in names:
            obs = done[0][2]
            inv = (obs.get("open_invoices") or [None])[0]
            amounts = [a for a in parse_amounts(text) if a[1]]
            if amounts:
                amount, ccy = amounts[0]
            elif inv:
                amount, ccy = D(inv["amount"]), inv["currency"]
            else:
                return _say("I couldn't find an open tuition invoice. How much do you need to pay, and in which currency?")
            args: dict[str, Any] = {"recipient": "university", "amount": str(amount), "amount_currency": ccy, "goal": _goal(text)}
            if inv:
                args["invoice_id"] = inv["id"]
            prov = _provider(text)
            if prov:
                args["provider_id"] = prov
            return _call("propose_payment", args, n)
        return _say(self._fmt_proposal(done[-1][2], text, tuition=True))

    def _send(self, text: str, done: list, n: int) -> ChatResult:
        if not done:
            recipient = _recipient(text)
            amounts = parse_amounts(text)
            if not recipient:
                return _say("Who should receive the money? Pick a saved recipient (for example your mom or landlord) or give me the new payee's name and bank details.")
            if not amounts:
                return _say(f"How much would you like to send to your {recipient}, and in which currency?")
            amount, ccy = next(((a, c) for a, c in amounts if c), amounts[0])
            if not ccy:
                return _say(f"Is that {amount} in which currency - for example GBP or BDT?")
            args: dict[str, Any] = {"recipient": recipient, "amount": str(amount), "amount_currency": ccy, "goal": _goal(text)}
            prov = _provider(text)
            if prov:
                args["provider_id"] = prov
            return _call("propose_payment", args, n)
        return _say(self._fmt_proposal(done[-1][2], text, tuition=False))

    def _add_payee(self, text: str, done: list, n: int) -> ChatResult:
        if not done:
            acct = _IBAN.search(text).group(1)  # type: ignore[union-attr]
            name_m = re.search(r"(?:add|new (?:payee|landlord|recipient|beneficiary)|my new \w+)\s+(?:my new \w+\s+)?([A-Z][\w'&.-]*(?:\s+[A-Z(][\w'&.()-]*){0,5})", text)
            name = (name_m.group(1) if name_m else "New payee").strip(" ,.")
            bank_m = re.search(r"\bat\s+([A-Z][\w ]*?Bank(?:\s+[A-Z]{2,})?)", text)
            t = text.lower()
            kind = "landlord" if re.search(r"landlord|rent|lettings|rooms", t) else "family" if re.search(r"\b(mom|mum|dad|sister|brother|uncle|aunt|cousin)\b", t) else "other"
            country = {"GB": "UK"}.get(acct[:2], acct[:2])
            currency = {"UK": "GBP", "BD": "BDT", "CA": "CAD", "NG": "NGN", "US": "USD", "IN": "INR"}.get(country, "GBP")
            return _call("propose_add_beneficiary", {"name": name, "kind": kind, "country": country, "currency": currency, "bank_name": bank_m.group(1).strip() if bank_m else "Unknown bank", "account_number": acct}, n)
        r = done[0][2]
        if r.get("status") == "blocked":
            return _say("I can't add this payee: " + "; ".join(r.get("policy_reasons", [])))
        return _say(
            f"Adding a new payee is a **high-risk (T3) action**, so I've prepared it for you to review: confirm the card, then enter the one-time code from your Sandbox phone. "
            "After that there's a short **cooling-off period** before any payment to them is released - this protects you if someone tricked you into adding the account. "
            "Once the payee is added, ask me to pay them and I'll prepare that payment too. [KB: How Remi's safety tiers work]"
        )

    def _quotes(self, text: str, done: list, n: int) -> ChatResult:
        if not done:
            amounts = parse_amounts(text)
            recipient = _recipient(text)
            if not amounts or not recipient:
                return _say("Sure - how much, and to whom (for example \"£300 to my mom\")?")
            amount, ccy = next(((a, c) for a, c in amounts if c), amounts[0])
            return _call("get_remittance_quotes", {"recipient": recipient, "amount": str(amount), "amount_currency": ccy or "GBP", "goal": _goal(text)}, n)
        r = done[0][2]
        best = r.get("recommended")
        if not best:
            return _say("No provider can do this transfer: " + "; ".join(a["why_not"] for a in r.get("alternatives", [])))
        return _say(f"Best option: **{best['provider_name']}** - send {best['send_amount']} {best['send_currency']}, recipient gets {best['receive_amount']} {best['receive_currency']}, landed cost {best['landed_cost']} {best['send_currency']} ({best['effective_cost_pct']}%), arrives by {best['arrival_latest'][:10]}. " + " ".join(f"{a['provider']}: {a['why_not']}." for a in r.get("alternatives", [])[:3]) + " [KB: How cross-border transfers work]")

    def _convert(self, text: str, done: list, n: int) -> ChatResult:
        if not done:
            amounts = parse_amounts(text)
            amount, ccy = next(((a, c) for a, c in amounts if c), amounts[0])
            m = re.search(r"\b([A-Za-z]{3})\s*(?:to|into|→|->)\s*([A-Za-z]{3})\b", text)
            if m:
                frm, to = m.group(1).upper(), m.group(2).upper()
            else:
                frm_m = re.search(r"from (?:my )?([A-Za-z]{3})", text)
                frm = frm_m.group(1).upper() if frm_m else ("BDT" if ccy == "GBP" else "GBP")
                to = ccy if ccy and ccy != frm else "GBP"
            return _call("propose_fx_conversion", {"from_currency": frm, "to_currency": to, "amount": str(amount), "amount_currency": ccy or to}, n)
        r = done[0][2]
        if r.get("status") == "blocked":
            return _say("I can't prepare that conversion: " + "; ".join(r.get("policy_reasons", [])))
        s = r.get("summary", {})
        return _say(f"I've prepared a conversion: you sell **{s.get('you_sell')}** and get **{s.get('you_get')}** at {s.get('rate')} (mid-market {s.get('mid_rate')}; cost vs mid {s.get('cost_vs_mid')}). It's a **{r['tier']}** action - review the card and confirm to execute. Rates are sandbox rates and the quote is locked for 5 minutes.")

    def _fx_options(self, text: str, done: list, n: int) -> ChatResult:
        if not done:
            amounts = parse_amounts(text)
            amount, ccy = (amounts[0] if amounts else (D("500"), "GBP"))
            return _call("fx_conversion_options", {"from_currency": "BDT" if (ccy or "GBP") == "GBP" else "GBP", "to_currency": ccy or "GBP", "amount": str(amount), "amount_currency": ccy or "GBP"}, n)
        r = done[0][2]
        opts = "\n".join(f"- **{o['title']}**: {o['detail']}" for o in r["options"])
        return _say(f"I don't predict exchange rates, but here are three neutral options:\n{opts}\n\n{r['risk_statement']} [KB: Converting currency without speculating]")

    def _knowledge(self, text: str, done: list, n: int) -> ChatResult:
        if not done:
            return _call("search_knowledge", {"query": text}, n)
        r = done[0][2]
        results = r.get("results", [])
        if not results:
            return _say("I don't have a reliable answer to that in my knowledge base, so I won't guess. I can help with transfers, tuition payments, wallets, budgets, credit building and scam checks.")
        top = results[0]
        body = _strip_untrusted(top["text"])
        bullets = [ln[2:].strip() for ln in body.splitlines() if ln.startswith("- ")]
        if bullets:
            core = "\n".join(f"- {b}" for b in bullets[:6])
        else:
            sentences = re.split(r"(?<=[.!?])\s+", re.sub(r"#+ [^\n]*\n", "", body).replace("\n", " "))
            core = " ".join(sentences[:3])
        cites = " ".join(dict.fromkeys(f"[KB: {x['title']}]" for x in results[:2]))
        note = "\n\n_This is illustrative guidance - requirements vary by bank and country, so confirm with official sources. Not legal or tax advice._" if any(x["illustrative"] for x in results[:2]) else ""
        intro = "Here's what's usually needed:" if bullets else "In short:"
        return _say(f"{intro}\n{core}\n\n{cites}{note}")

    # ---- formatting ---------------------------------------------------------------

    def _fmt_proposal(self, r: dict[str, Any], text: str, tuition: bool) -> str:
        if r.get("status") == "no_feasible_option":
            return "I couldn't find a provider that can do this safely: " + "; ".join(a["why_not"] for a in r.get("alternatives", [])[:3])
        s = r.get("summary", {})
        if r.get("status") == "blocked":
            reasons = "; ".join(r.get("policy_reasons", []) + r.get("risk_reasons", []))
            return f"**I can't prepare this payment.** {reasons}"
        lines = []
        if re.search(r"\bsplit\b", text, re.I):
            lines.append("**I won't split this into smaller payments** - breaking a transfer up to get under a limit looks like structuring and can get your account blocked. [KB: Transfer limits and why Remi never splits payments]")
        if r.get("routing_note"):
            lines.append(r["routing_note"])
        lines.append(f"I've prepared **{s.get('title')}** via **{s.get('provider')}**:")
        lines += [
            f"- You send **{s.get('you_send')}** · fee {s.get('fee')} · rate {s.get('rate')}",
            f"- {s.get('recipient')} receives **{s.get('they_receive')}** · landed cost {s.get('landed_cost')}",
            f"- Worst-case arrival {str(s.get('arrival', ''))[:10]}",
        ]
        why = r.get("why_this_provider") or []
        if why:
            lines.append("- Why not the others: " + "; ".join(f"{a['provider']} - {a['why_not']}" for a in why[:3]))
        if tuition:
            lines.append(f"- Purpose code {s.get('purpose_code')}, source of funds: {s.get('source_of_funds')}. Typical documents: " + ", ".join((r.get('compliance') or [])[:3]) + " (illustrative)")
        tier_text = {"T2": "a **T2** action: review the card and press Confirm", "T3": "a **T3** action: confirm the card, then enter the one-time code from your Sandbox phone"}
        lines.append("")
        lines.append(f"This is {tier_text.get(r.get('tier'), 'an action that needs your confirmation')}." + (" Reasons: " + "; ".join(r.get("policy_reasons", [])) + "." if r.get("tier") == "T3" and r.get("policy_reasons") else ""))
        lines.append("Nothing has moved yet.")
        return "\n".join(lines)

    def _fmt_wallets(self, r: dict[str, Any]) -> str:
        rows = "\n".join(f"- **{w['balance']} {w['currency']}** (≈ {w['in_reporting_currency']} {r['reporting_currency']})" for w in r["wallets"])
        return f"Your wallets:\n{rows}\n\nTotal ≈ **{r['total_in_reporting_currency']} {r['reporting_currency']}** at sandbox rates."

    def _fmt_rates(self, r: dict[str, Any]) -> str:
        return "Current sandbox rates: " + "; ".join(x["display"] for x in r["rates"]) + ". These are simulated, not live market data."

    def _fmt_txns(self, r: dict[str, Any]) -> str:
        rows = "\n".join(f"- {t['occurred_at'][:10]} · {t['description']} · {t['amount']} {t['currency']} · {t['status']}" for t in r["transactions"][:8])
        return f"Your recent transactions:\n{rows}"
