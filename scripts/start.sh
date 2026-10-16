#!/usr/bin/env bash
# Production mode: build the frontend if needed and serve everything from FastAPI on one port.
# Env: PORT (default 8000), HOST (default "::" = IPv4 + IPv6, falls back to 0.0.0.0),
#      REBUILD=1 forces a frontend build, OPEN_BROWSER=1 opens the app when it is ready.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/scripts/_env.sh"
PORT="${PORT:-8000}"
export PORT HOST="${HOST:-::}"
URL="http://localhost:${PORT}"

if (exec 3<>"/dev/tcp/127.0.0.1/${PORT}") 2>/dev/null; then
  echo "Port ${PORT} is already in use (another Remi or dev server?). Stop it or run: PORT=8080 ./scripts/start.sh" >&2
  exit 1
fi

echo "==> Checking backend environment"
ensure_backend

DIST="$ROOT/frontend/dist/index.html"
needs_build=0
if [ ! -f "$DIST" ] || [ "${REBUILD:-0}" = "1" ]; then
  needs_build=1
elif [ -n "$(find "$ROOT/frontend/src" "$ROOT/frontend/index.html" "$ROOT/frontend/public" -newer "$DIST" -type f -print -quit 2>/dev/null)" ]; then
  echo "==> Frontend sources changed since the last build"
  needs_build=1
fi
if [ "$needs_build" = "1" ]; then
  echo "==> Building the frontend (first run can take a minute)"
  ensure_frontend
  (cd "$ROOT/frontend" && npm run build)
fi
[ -f "$DIST" ] || { echo "Frontend build failed: $DIST is missing" >&2; exit 1; }

announce() {
  for _ in $(seq 1 120); do
    if curl -fsS -o /dev/null "http://127.0.0.1:${PORT}/api/health" 2>/dev/null; then
      printf '\n  ============================================================\n'
      printf '   Remi is ready  ->  %s\n' "$URL"
      printf '   Stop with Ctrl+C\n'
      printf '  ============================================================\n\n'
      if [ "${OPEN_BROWSER:-0}" = "1" ] && command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1 || true; fi
      return
    fi
    sleep 0.5
  done
  echo "Remi did not answer on ${URL}/api/health within 60 s - check the log above." >&2
}

echo "==> Starting Remi on ${URL}"
announce &
cd "$ROOT/backend"
exec .venv/bin/python -m app.serve
