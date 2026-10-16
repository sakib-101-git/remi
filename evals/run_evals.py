#!/usr/bin/env python3
"""Golden-scenario evaluation harness for Remi.

Drives the real FastAPI app in-process (cookies, SSE chat, confirm/step-up endpoints, sandbox controls), checks
tool use, policy decisions and the final sandbox state, and writes evidence/eval_report.md + eval_results.json.

  python evals/run_evals.py                      # mock provider (deterministic, offline)
  python evals/run_evals.py --provider gemini --sleep 6 --cache record
  python evals/run_evals.py --provider gemini --cache replay
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
import time
from decimal import Decimal
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / "evidence"
SCENARIOS = Path(__file__).resolve().parent / "scenarios"


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--provider", default="mock", choices=["mock", "gemini", "groq", "openrouter", "ollama"])
    p.add_argument("--cache", default="off", choices=["off", "record", "replay"])
    p.add_argument("--sleep", type=float, default=0.0, help="seconds to wait between LLM turns (free-tier throttling)")
    p.add_argument("--only", default="", help="comma-separated scenario ids, e.g. S1,S6")
    p.add_argument("--resume", action="store_true", help="skip scenarios that already passed for this provider")
    p.add_argument("--no-report", action="store_true")
    return p.parse_args()


ARGS = parse_args()
_db_dir = Path(tempfile.mkdtemp(prefix="remi-evals-"))
os.environ.update({
    "DATABASE_URL": f"sqlite:///{_db_dir / 'evals.db'}",
    "SANDBOX_FIXED_NOW": os.environ.get("SANDBOX_FIXED_NOW", "2026-10-14T10:00:00Z"),
    "LLM_PROVIDER": ARGS.provider,
    "LLM_FALLBACK": f"{ARGS.provider},mock" if ARGS.provider != "mock" else "mock",
    "LLM_CACHE": ARGS.cache,
    "LLM_DAILY_BUDGET": "100000",
    "RATE_LIMIT_CHAT": "1000/minute",
    "RATE_LIMIT_DEFAULT": "10000/minute",
    "DEMO_SETTLE_SECONDS": "1",
})
os.environ.setdefault("KB_USE_EMBEDDINGS", "true")
sys.path.insert(0, str(ROOT / "backend"))

import yaml  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import logging  # noqa: E402

logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpx2").setLevel(logging.WARNING)

from app import events  # noqa: E402
from app.main import app  # noqa: E402

PHONE: list[dict[str, Any]] = []
_orig_publish = events.publish


def _capture(ws_id: str, event: str, data: dict[str, Any]) -> None:
    if event == "sandbox_phone":
        PHONE.append(data)
    _orig_publish(ws_id, event, data)


events.publish = _capture  # type: ignore[assignment]


def sse(text: str) -> list[tuple[str, dict[str, Any]]]:
    out, event = [], None
    for line in text.splitlines():
        if line.startswith("event:"):
            event = line.split(":", 1)[1].strip()
        elif line.startswith("data:") and event:
            try:
                out.append((event, json.loads(line.split(":", 1)[1].strip())))
            except json.JSONDecodeError:
                pass
    return out


class Run:
    def __init__(self, scenario: dict[str, Any]) -> None:
        self.s = scenario
        self.client = TestClient(app)
        self.client.__enter__()
        self.client.post("/api/session/consent", json={"accepted": True})
        if scenario.get("persona", "rahim") != "rahim":
            self.client.post("/api/session/persona", json={"persona": scenario["persona"]})
        self.start_wallets = self.balances()
        self.start_limits = self.client.get("/api/settings").json()["limits"]["limits"]
        self.last_action: dict[str, Any] | None = None
        self.alert_action: dict[str, Any] | None = None
        self.log: list[dict[str, Any]] = []
        self.checks: list[dict[str, Any]] = []
        self.providers: set[str] = set()
        self.timings: list[int] = []

    def close(self) -> None:
        self.client.__exit__(None, None, None)

    def balances(self) -> dict[str, Decimal]:
        return {w["currency"]: Decimal(w["balance"]) for w in self.client.get("/api/wallets").json()["wallets"]}

    def check(self, name: str, ok: bool, detail: Any = "") -> None:
        self.checks.append({"check": name, "ok": bool(ok), "detail": detail if ok else str(detail)[:400]})

    def _idem(self) -> dict[str, str]:
        return {"Idempotency-Key": f"eval-{time.time_ns()}"}

    def step(self, st: dict[str, Any]) -> None:
        exp = st.get("expect", {})
        if "say" in st:
            body: dict[str, Any] = {"message": st["say"]}
            if st.get("attachment") == "suspicious_invoice":
                body["attachment_text"] = self.client.post("/api/sandbox/inject-invoice").json()["document_text"]
            t0 = time.time()
            r = self.client.post("/api/chat", json=body)
            ms = int((time.time() - t0) * 1000)
            self.timings.append(ms)
            evs = sse(r.text)
            text = "".join(d.get("text", "") for e, d in evs if e == "delta")
            cards = [c for e, d in evs if e == "cards" for c in d["cards"]]
            done = next((d for e, d in evs if e == "done"), {})
            meta = done.get("meta", {})
            self.providers.add(f"{meta.get('provider')}/{meta.get('model')}" + (" (cache)" if meta.get("cached") else ""))
            tools_used = [t["name"] for t in meta.get("tools", [])]
            actions = [c["data"] for c in cards if c["type"] == "action"]
            if actions:
                self.last_action = actions[-1]
            self.log.append({"step": "say", "message": st["say"], "attachment": bool(body.get("attachment_text")), "reply": text, "cards": [c["type"] for c in cards], "tools": tools_used, "provider": meta.get("provider"), "model": meta.get("model"), "cached": meta.get("cached"), "latency_ms": ms, "actions": [{k: a.get(k) for k in ("id", "kind", "tier", "status", "risk_score", "policy_reasons")} for a in actions]})
            self._check_say(exp, text, cards, tools_used, actions)
            if ARGS.sleep and meta.get("provider") not in ("mock", "guardrail"):
                time.sleep(ARGS.sleep)
        elif "confirm" in st:
            a = self.alert_action if st["confirm"] == "alert" else self.last_action
            if not a or "confirm_token" not in a:
                self.check("confirm: action with token available", False, a)
                return
            r = self.client.post(f"/api/actions/{a['id']}/confirm", json={"token": a["confirm_token"]}, headers=self._idem()).json()
            self.log.append({"step": "confirm", "action_id": a["id"], "result_status": r.get("status"), "receipt": (r.get("result") or {}).get("receipt")})
            self.last_action = {**a, **r, "confirm_token": None}
            self._check_status(exp, r)
            if exp.get("receipt"):
                rec = (r.get("result") or {}).get("receipt") or {}
                self.check("receipt issued with reference", str(rec.get("reference", "")).startswith("RMI-"), rec)
        elif "stepup" in st:
            a = self.last_action
            code = next((p["code"] for p in reversed(PHONE) if a and p["action_id"] == a["id"]), None)
            self.check("OTP delivered to sandbox phone", code is not None, a and a.get("id"))
            r = self.client.post(f"/api/actions/{a['id']}/stepup", json={"code": code or "000000"}, headers=self._idem()).json()
            self.log.append({"step": "stepup", "action_id": a["id"], "result_status": r.get("status")})
            self.last_action = {**a, **r}
            self._check_status(exp, r)
        elif "advance_hours" in st:
            self.client.post("/api/sandbox/advance", json={"hours": st["advance_hours"]})
            self.log.append({"step": "advance_hours", "hours": st["advance_hours"]})
            if "action_status" in exp and self.last_action:
                acts = {x["id"]: x for x in self.client.get("/api/actions").json()}
                status = acts.get(self.last_action["id"], {}).get("status")
                self.check(f"action status after time advance = {exp['action_status']}", status == exp["action_status"], status)
        elif "tick" in st:
            r = self.client.post("/api/sandbox/tick", json=st["tick"]).json()
            fired = r.get("alerts_fired", [])
            self.log.append({"step": "tick", "args": st["tick"], "alerts_fired": len(fired), "rates": {k: r["rates"][k] for k in ("GBP", "BDT")}})
            if "alert_fired" in exp:
                self.check(f"alert fired = {exp['alert_fired']}", bool(fired) == exp["alert_fired"], fired)
            if fired and fired[0].get("action"):
                self.alert_action = fired[0]["action"]
                if "proposal_tier" in exp:
                    self.check(f"alert proposal tier {exp['proposal_tier']} awaiting confirmation", self.alert_action.get("tier") == exp["proposal_tier"] and self.alert_action.get("status") == "awaiting_confirmation", self.alert_action)
        elif "api" in st:
            spec = st["api"]
            r = self.client.request(spec["method"], spec["path"], json=spec.get("body")).json()
            self.log.append({"step": "api", "path": spec["path"]})
            if "readiness_above" in exp:
                self.check("credit readiness increased", r.get("readiness_score", 0) > exp["readiness_above"], r.get("readiness_score"))

    def _check_status(self, exp: dict[str, Any], r: dict[str, Any]) -> None:
        if "status" in exp:
            self.check(f"status = {exp['status']}", r.get("status") == exp["status"], r.get("error") or r.get("status"))

    def _check_say(self, exp: dict[str, Any], text: str, cards: list[dict[str, Any]], tools_used: list[str], actions: list[dict[str, Any]]) -> None:
        types = [c["type"] for c in cards]
        if "tools_include" in exp:
            self.check(f"tools called include {exp['tools_include']}", all(t in tools_used for t in exp["tools_include"]), tools_used)
        if "tools_include_any" in exp:
            self.check(f"tools called include one of {exp['tools_include_any']}", any(t in tools_used for t in exp["tools_include_any"]), tools_used)
        if "tools_count" in exp:
            self.check(f"tool calls = {exp['tools_count']}", len(tools_used) == exp["tools_count"], tools_used)
        if "cards_include" in exp:
            self.check(f"cards include {exp['cards_include']}", all(c in types for c in exp["cards_include"]), types)
        if "cards_include_any" in exp:
            self.check(f"cards include one of {exp['cards_include_any']}", any(c in types for c in exp["cards_include_any"]), types)
        if exp.get("no_action"):
            self.check("no money-moving proposal created", not actions, [a.get("kind") for a in actions])
        if exp.get("single_action"):
            self.check("exactly one payment proposal (no splitting)", len([a for a in actions if a["kind"] == "payment"]) == 1, len(actions))
        if "action" in exp:
            a = actions[-1] if actions else {}
            want = exp["action"]
            self.check(f"policy tier = {want.get('tier')}", a.get("tier") == want.get("tier"), {"tier": a.get("tier"), "reasons": a.get("policy_reasons")})
            if "status" in want:
                self.check(f"action status = {want['status']}", a.get("status") == want["status"], a.get("status"))
            if "provider_id" in want:
                self.check(f"routed to {want['provider_id']}", (a.get("payload") or {}).get("provider_id") == want["provider_id"], (a.get("payload") or {}).get("provider_id"))
            if want.get("cooling_off"):
                self.check("cooling-off applied (not_before set)", bool(a.get("not_before")), a.get("not_before"))
            self.check("LLM never received the confirm token", not a.get("confirm_token") or a["confirm_token"] not in text, "token leaked")
        if "text_any" in exp:
            self.check(f"reply mentions one of {exp['text_any']}", any(s in text for s in exp["text_any"]), text[:200])
        if "text_any_2" in exp:
            self.check(f"reply mentions one of {exp['text_any_2']}", any(s in text for s in exp["text_any_2"]), text[:200])
        if "question_count" in exp:
            self.check(f"asks exactly {exp['question_count']} clarifying question", text.count("?") == exp["question_count"] and not actions, text)
        if "budget_recommendations" in exp:
            b = next((c["data"] for c in cards if c["type"] == "budget"), None)
            self.check(f"{exp['budget_recommendations']} actionable recommendations", b is not None and len(b.get("recommendations", [])) == exp["budget_recommendations"], b and len(b.get("recommendations", [])))
        if "reverse_quote_exact" in exp:
            want = exp["reverse_quote_exact"]
            q = next((c["data"] for c in cards if c["type"] == "quotes"), {})
            rec = q.get("recommended") or {}
            ok = rec.get("receive_amount") == want["receive_amount"] and rec.get("receive_currency") == want["receive_currency"] and rec.get("send_currency") == want["send_currency"]
            if ok:
                # Independently recompute: forward quote of the reverse-quoted send must deliver >= target.
                fwd = self.client.post("/api/quotes", json={"send_currency": rec["send_currency"], "receive_currency": rec["receive_currency"], "amount": rec["send_amount"], "amount_mode": "send"}).json()
                f = next(o for o in fwd["options"] + fwd["rejected"] if o["provider_id"] == rec["provider_id"])
                ok = Decimal(f["receive_amount"]) >= Decimal(want["receive_amount"])
            self.check("reverse quote delivers exact target (verified by forward recompute)", ok, rec)

    def final(self) -> None:
        fin = self.s.get("final", {})
        now_bal = self.balances()
        for ccy, rule in (fin.get("wallet_change") or {}).items():
            delta = now_bal[ccy] - self.start_wallets[ccy]
            ok = delta < 0 if rule == "negative" else delta == Decimal(rule)
            self.check(f"final: {ccy} wallet change {rule}", ok, str(delta))
        if fin.get("no_money_moved"):
            self.check("final: balances unchanged", now_bal == self.start_wallets, {k: str(now_bal[k] - self.start_wallets[k]) for k in now_bal})
        if "transfer" in fin:
            want = fin["transfer"]
            txns = [t for t in self.client.get("/api/transactions?limit=10").json() if t["kind"] == "transfer_out" and t["reference"] and "SEED" not in t["reference"]]
            t = txns[0] if txns else {}
            ok = bool(t) and t["counter_amount"] == want["receive_amount"] and t["counter_currency"] == want["receive_currency"]
            if "provider" in want:
                ok = ok and t.get("provider") == want["provider"]
            if "status" in want:
                ok = ok and t.get("status") == want["status"]
            if "status_in" in want:
                ok = ok and t.get("status") in want["status_in"]
            self.check(f"final: transfer recorded {want}", ok, t)
        if fin.get("invoice_paid"):
            self.check("final: tuition invoice marked paid", self.client.get("/api/invoices").json() == [], "invoice still open")
        if fin.get("credit_tasks_saved"):
            plan = self.client.get("/api/credit").json()
            self.check(f"final: {fin['credit_tasks_saved']} credit tasks tracked", plan["saved"] and len(plan["tasks"]) == fin["credit_tasks_saved"], len(plan["tasks"]))
        if fin.get("no_new_beneficiary"):
            self.check("final: no beneficiary added", len(self.client.get("/api/beneficiaries").json()) == 4, "beneficiaries changed")
        if fin.get("limits_unchanged"):
            self.check("final: limits unchanged", self.client.get("/api/settings").json()["limits"]["limits"] == self.start_limits, "limits changed")
        audit = self.client.get("/api/audit?limit=500").json()
        if fin.get("audit_valid"):
            self.check("final: audit hash chain verifies", audit["verification"]["valid"], audit["verification"])
        for action in fin.get("audit_has", []):
            self.check(f"final: audit contains {action}", any(e["action"] == action for e in audit["entries"]), "missing")
        if fin.get("ledger_balanced"):
            from app.db import session_scope
            from app.sandbox import ledger
            from app.api.deps import unsign

            ws_id = unsign(self.client.cookies.get("remi_ws"))
            with session_scope() as s:
                tb = ledger.trial_balance(s, ws_id)
            self.check("final: double-entry ledger balances in every currency", all(v == 0 for v in tb.values()), {k: str(v) for k, v in tb.items()})
        self.audit_entries = audit["entries"]


def run_scenario(path: Path) -> dict[str, Any]:
    scenario = yaml.safe_load(path.read_text())
    started = time.time()
    run = Run(scenario)
    error = None
    try:
        for st in scenario["steps"]:
            run.step(st)
        run.final()
    except Exception as exc:  # a crash is a failed scenario, not a crashed harness
        error = f"{type(exc).__name__}: {exc}"
        run.check("scenario ran without errors", False, error)
    finally:
        run.close()
    logs = EVIDENCE / "sandbox_logs"
    logs.mkdir(parents=True, exist_ok=True)
    with (logs / f"{scenario['id']}_{ARGS.provider}.jsonl").open("w") as fh:
        for entry in run.log:
            fh.write(json.dumps({"scenario": scenario["id"], **entry}, default=str) + "\n")
        for entry in reversed(getattr(run, "audit_entries", [])):
            fh.write(json.dumps({"scenario": scenario["id"], "step": "audit", **entry}, default=str) + "\n")
    passed = all(c["ok"] for c in run.checks)
    return {
        "id": scenario["id"], "title": scenario["title"], "demonstrates": scenario.get("demonstrates", ""), "persona": scenario.get("persona", "rahim"),
        "passed": passed, "checks_passed": sum(c["ok"] for c in run.checks), "checks_total": len(run.checks), "checks": run.checks,
        "providers_used": sorted(run.providers), "turn_latency_ms": run.timings, "duration_s": round(time.time() - started, 2), "error": error,
    }


def write_report(all_results: dict[str, Any]) -> None:
    lines = ["# Remi - golden scenario evaluation report", "", f"Generated {time.strftime('%Y-%m-%d %H:%M UTC', time.gmtime())} by `evals/run_evals.py`. Sandbox clock pinned to {os.environ['SANDBOX_FIXED_NOW']} for reproducibility.", ""]
    lines += ["## Summary", "", "| Provider run | Scenarios passed | Checks passed | Median turn latency |", "|---|---|---|---|"]
    for prov, res in all_results.items():
        rows = res["results"]
        lat = sorted(x for r in rows for x in r["turn_latency_ms"]) or [0]
        lines.append(f"| `{prov}` ({res['cache']}) | **{sum(r['passed'] for r in rows)}/{len(rows)}** | {sum(r['checks_passed'] for r in rows)}/{sum(r['checks_total'] for r in rows)} | {lat[len(lat) // 2]} ms |")
    for prov, res in all_results.items():
        lines += ["", f"## Results - `{prov}`", "", f"Run at {res['run_at']}, cache mode `{res['cache']}`.", "", "| # | Scenario | Demonstrates | Result | Checks | Answered by |", "|---|---|---|---|---|---|"]
        for r in res["results"]:
            lines.append(f"| {r['id']} | {r['title']} | {r['demonstrates']} | {'✅ pass' if r['passed'] else '❌ fail'} | {r['checks_passed']}/{r['checks_total']} | {', '.join(r['providers_used']) or '-'} |")
        failed = [r for r in res["results"] if not r["passed"]]
        if failed:
            lines += ["", "### Failed checks", ""]
            for r in failed:
                for c in r["checks"]:
                    if not c["ok"]:
                        lines.append(f"- **{r['id']}** {c['check']}: `{c['detail'][:200]}`")
    lines += ["", "## How checks work", "", "Each scenario is executed through the real HTTP API (signed workspace cookie, SSE chat stream, confirm and step-up endpoints with idempotency keys, sandbox controls). Checks cover tools called, cards rendered, the policy tier chosen by the deterministic policy engine, action status transitions, the final ledger/wallet state, the double-entry trial balance and the audit hash chain. Per-step logs are in `evidence/sandbox_logs/`.", ""]
    (EVIDENCE / "eval_report.md").write_text("\n".join(lines))


def main() -> int:
    EVIDENCE.mkdir(exist_ok=True)
    results_path = EVIDENCE / "eval_results.json"
    all_results: dict[str, Any] = json.loads(results_path.read_text()) if results_path.exists() else {}
    key = ARGS.provider
    previous = {r["id"]: r for r in all_results.get(key, {}).get("results", [])}
    only = {s.strip().upper() for s in ARGS.only.split(",") if s.strip()}
    results = []
    for path in sorted(SCENARIOS.glob("s*.yaml")):
        sid = yaml.safe_load(path.read_text())["id"]
        if only and sid not in only:
            if sid in previous:
                results.append(previous[sid])
            continue
        if ARGS.resume and previous.get(sid, {}).get("passed"):
            results.append(previous[sid])
            print(f"{sid}: skipped (passed before)")
            continue
        r = run_scenario(path)
        results.append(r)
        print(f"{r['id']}: {'PASS' if r['passed'] else 'FAIL'} ({r['checks_passed']}/{r['checks_total']}) via {', '.join(r['providers_used'])}")
        for c in r["checks"]:
            if not c["ok"]:
                print(f"    ✗ {c['check']}: {c['detail'][:300]}")
        all_results[key] = {"provider": key, "cache": ARGS.cache, "run_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "results": results}
        results_path.write_text(json.dumps(all_results, indent=1, default=str))
    all_results[key] = {"provider": key, "cache": ARGS.cache, "run_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "results": sorted(results, key=lambda r: int(r["id"][1:]))}
    results_path.write_text(json.dumps(all_results, indent=1, default=str))
    if not ARGS.no_report:
        write_report(all_results)
    passed = sum(r["passed"] for r in results)
    print(f"\n{passed}/{len(results)} scenarios passed ({key}, cache={ARGS.cache})")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
