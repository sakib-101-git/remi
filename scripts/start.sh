#!/usr/bin/env bash
# Production mode: build the frontend once and serve everything from FastAPI on one port.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/scripts/_env.sh"
ensure_backend
if [ ! -f "$ROOT/frontend/dist/index.html" ] || [ "${REBUILD:-0}" = "1" ]; then
  ensure_frontend
  (cd "$ROOT/frontend" && npm run build)
fi
cd "$ROOT/backend"
exec .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}" --proxy-headers --forwarded-allow-ips="*"
