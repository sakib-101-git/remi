from app.audit import log as audit
from app.models import AuditEntry
from helpers import propose_payment
from sqlmodel import select


def _entries(ctx):
    return ctx.session.exec(select(AuditEntry).where(AuditEntry.workspace_id == ctx.ws_id).order_by(AuditEntry.seq)).all()


def test_chain_verifies_after_activity(ctx):
    propose_payment(ctx, "mom", "15000", "BDT")
    result = audit.verify(ctx.session, ctx.ws_id)
    assert result["valid"] and result["entries"] >= 2


def test_tampered_content_detected(ctx):
    propose_payment(ctx, "mom", "15000", "BDT")
    entry = _entries(ctx)[-1]
    entry.decision = "executed"
    ctx.session.flush()
    result = audit.verify(ctx.session, ctx.ws_id)
    assert not result["valid"] and result["broken_at"] == entry.seq
    assert result["reason"] == "content hash mismatch"


def test_deleted_entry_detected(ctx):
    propose_payment(ctx, "mom", "15000", "BDT")
    propose_payment(ctx, "mom", "16000", "BDT")
    ctx.session.delete(_entries(ctx)[1])
    ctx.session.flush()
    assert not audit.verify(ctx.session, ctx.ws_id)["valid"]


def test_rehashed_entry_breaks_next_link(ctx):
    propose_payment(ctx, "mom", "15000", "BDT")
    propose_payment(ctx, "mom", "16000", "BDT")
    entries = _entries(ctx)
    target = entries[1]
    target.result = {"forged": True}
    target.hash = audit.entry_digest(target)
    ctx.session.flush()
    result = audit.verify(ctx.session, ctx.ws_id)
    assert not result["valid"] and result["reason"] == "prev_hash mismatch"


def test_secrets_and_accounts_redacted_in_audit(ctx):
    entry = audit.append(ctx.session, ctx.ws_id, "user", "test", inputs={"token": "abc", "account_number": "GB00SBUK40001234567890", "note": "pay GB00SBUK40001234567890"})
    assert entry.inputs["token"] == "[REDACTED]"
    assert entry.inputs["account_number"] == "••••7890"
    assert "GB00SBUK40001234567890" not in entry.inputs["note"]
