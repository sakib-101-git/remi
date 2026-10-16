#!/usr/bin/env bash
# Reset the sandbox: delete the local database and rebuild the knowledge-base index.
# Each visitor workspace is re-seeded automatically on first visit.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/scripts/_env.sh"
ensure_backend
DATA="${DATA_DIR:-$ROOT/data}"
rm -f "$DATA"/remi.db "$DATA"/remi.db-wal "$DATA"/remi.db-shm
"$ROOT/backend/.venv/bin/python" "$ROOT/scripts/build_kb.py"
"$ROOT/backend/.venv/bin/python" - <<'PY'
import sys; sys.path.insert(0, "backend")
from app.db import init_db, session_scope
from app.sandbox import workspaces, ledger
init_db()
with session_scope() as s:
    ws = workspaces.create(s)
    print("Seeded demo workspace", ws.id[:6], "- trial balance:", {k: str(v) for k, v in ledger.trial_balance(s, ws.id).items()})
PY
echo "Sandbox reset. Start the app with ./scripts/start.sh"
