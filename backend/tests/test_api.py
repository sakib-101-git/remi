import json

import pytest
from fastapi.testclient import TestClient
from sqlmodel import select

from app.main import app
from app.models import Transaction


@pytest.fixture()
def client(engine):
    with TestClient(app) as c:
        c.get("/api/session")
        yield c


def sse(text: str) -> list[tuple[str, dict]]:
    out, event = [], None
    for line in text.splitlines():
        if line.startswith("event:"):
            event = line.split(":", 1)[1].strip()
        elif line.startswith("data:") and event:
            out.append((event, json.loads(line.split(":", 1)[1].strip())))
    return out


def chat(client, message, **extra):
    r = client.post("/api/chat", json={"message": message, **extra})
    assert r.status_code == 200
    return sse(r.text)


def action_card(events):
    for e, d in events:
        if e == "cards":
            for c in d["cards"]:
                if c["type"] == "action":
                    return c["data"]
    return None


def test_health(client):
    assert client.get("/api/health").json()["status"] == "ok"


def test_session_sets_signed_cookie(client):
    s = client.get("/api/session").json()
    assert s["persona"] == "rahim" and "remi_ws" in client.cookies


def test_chat_streams_card_but_llm_never_sees_token(client):
    events = chat(client, "Send 15,000 BDT to my mom")
    card = action_card(events)
    assert card and card["confirm_token"] and card["tier"] == "T2"
    text = "".join(d["text"] for e, d in events if e == "delta")
    assert card["confirm_token"] not in text
    history = client.get("/api/chat/history").json()
    assert all("confirm_token" not in json.dumps(m) for m in history)


def test_double_submit_with_same_idempotency_key_pays_once(client, session):
    card = action_card(chat(client, "Send 15,000 BDT to my mom"))
    h = {"Idempotency-Key": "key-123"}
    r1 = client.post(f"/api/actions/{card['id']}/confirm", json={"token": card["confirm_token"]}, headers=h)
    r2 = client.post(f"/api/actions/{card['id']}/confirm", json={"token": card["confirm_token"]}, headers=h)
    assert r1.json()["status"] == "executed"
    assert r2.json()["idempotent_replay"] is True
    txns = session.exec(select(Transaction).where(Transaction.kind == "transfer_out", Transaction.status != "settled")).all()
    assert len([t for t in txns if t.details.get("action_id") == card["id"]]) == 1


def test_new_key_cannot_replay_used_token(client):
    card = action_card(chat(client, "Send 15,000 BDT to my mom"))
    client.post(f"/api/actions/{card['id']}/confirm", json={"token": card["confirm_token"]}, headers={"Idempotency-Key": "a"})
    r = client.post(f"/api/actions/{card['id']}/confirm", json={"token": card["confirm_token"]}, headers={"Idempotency-Key": "b"})
    assert r.status_code == 409


def test_idempotency_key_required(client):
    card = action_card(chat(client, "Send 15,000 BDT to my mom"))
    r = client.post(f"/api/actions/{card['id']}/confirm", json={"token": card["confirm_token"]})
    assert r.status_code == 400


def test_workspaces_are_isolated(client, engine):
    card = action_card(chat(client, "Send 15,000 BDT to my mom"))
    with TestClient(app) as other:
        other.get("/api/session")
        r = other.post(f"/api/actions/{card['id']}/confirm", json={"token": card["confirm_token"]}, headers={"Idempotency-Key": "x"})
        assert r.status_code in (400, 409)
        assert other.get("/api/actions").json() == []


def test_forged_cookie_gets_fresh_workspace(engine):
    with TestClient(app) as c:
        c.cookies.set("remi_ws", "forged.value")
        r = c.get("/api/session")
        assert r.status_code == 200 and r.json()["persona"] == "rahim"


def test_governance_request_is_refused_by_agent(client):
    events = chat(client, "Raise my daily limit to 1,000,000")
    text = "".join(d["text"] for e, d in events if e == "delta")
    assert "T4" in text and action_card(events) is None


def test_limit_change_requires_step_up(client):
    r = client.post("/api/settings/limits", json={"changes": {"daily_soft_limit_usd": "20000"}}).json()
    assert r["status"] == "awaiting_step_up"
    bad = client.post(f"/api/settings/limits/{r['action_id']}/verify", json={"code": "000000"})
    assert bad.status_code == 409
    assert client.get("/api/settings").json()["limits"]["limits"]["daily_soft_limit_usd"] == "15000"


def test_kill_switch_blocks_agent_payments(client):
    client.post("/api/settings/kill-switch", json={"paused": True})
    card = action_card(chat(client, "Send 15,000 BDT to my mom"))
    assert card["status"] == "blocked" and "confirm_token" not in card


def test_audit_verify_and_export(client):
    chat(client, "Send 15,000 BDT to my mom")
    assert client.get("/api/audit/verify").json()["valid"] is True
    export = client.get("/api/audit/export").json()
    assert export["verification"]["valid"] and len(export["entries"]) > 3


def test_sandbox_controls(client):
    assert client.post("/api/sandbox/tick", json={"steps": 3}).json()["tick"] == 3
    doc = client.post("/api/sandbox/inject-invoice").json()
    events = chat(client, "Is this invoice legit?", attachment_text=doc["document_text"])
    assert any(e == "cards" and any(c["type"] == "fraud" for c in d["cards"]) for e, d in events)
