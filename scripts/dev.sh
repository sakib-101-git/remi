#!/usr/bin/env bash
# Backend (uvicorn --reload on :8000) + frontend (Vite on :5173, proxies /api).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/scripts/_env.sh"
ensure_backend
ensure_frontend
cd "$ROOT/backend"
.venv/bin/uvicorn app.main:app --reload --port "${PORT:-8000}" &
BACK=$!
trap 'kill $BACK 2>/dev/null' EXIT
cd "$ROOT/frontend" && npm run dev -- --host
