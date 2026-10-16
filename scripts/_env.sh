# Shared helpers for scripts (sourced, not executed).
ROOT="${ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$ROOT"
if [ -f "$ROOT/.env" ]; then set -a; source "$ROOT/.env"; set +a; fi

ensure_backend() {
  if [ ! -x "$ROOT/backend/.venv/bin/python" ]; then
    if command -v uv >/dev/null 2>&1; then
      uv venv --python 3.12 "$ROOT/backend/.venv"
      uv pip install --python "$ROOT/backend/.venv/bin/python" -r "$ROOT/backend/requirements-dev.txt"
    else
      python3 -m venv "$ROOT/backend/.venv"
      "$ROOT/backend/.venv/bin/pip" install -r "$ROOT/backend/requirements-dev.txt"
    fi
  fi
}

ensure_frontend() {
  if ! command -v npm >/dev/null 2>&1 && [ -s "$HOME/.nvm/nvm.sh" ]; then source "$HOME/.nvm/nvm.sh" >/dev/null; fi
  command -v npm >/dev/null 2>&1 || { echo "npm not found: install Node 20+ (e.g. via nvm)"; exit 1; }
  [ -d "$ROOT/frontend/node_modules" ] || (cd "$ROOT/frontend" && npm ci)
}
