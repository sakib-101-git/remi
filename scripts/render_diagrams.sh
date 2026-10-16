#!/usr/bin/env bash
# Render docs/diagrams/*.mmd to PNG with Mermaid CLI, reusing Playwright's Chromium (no extra browser download).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/scripts/_env.sh"
ensure_frontend
DIR="$ROOT/docs/diagrams"
CHROME="$(ls -d "$HOME"/.cache/ms-playwright/chromium-*/chrome-linux*/chrome 2>/dev/null | sort -V | tail -1 || true)"
[ -n "$CHROME" ] || (cd "$ROOT/frontend" && npx playwright install chromium) && CHROME="$(ls -d "$HOME"/.cache/ms-playwright/chromium-*/chrome-linux*/chrome | sort -V | tail -1)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
printf '{"executablePath": "%s", "args": ["--no-sandbox"]}\n' "$CHROME" > "$TMP/puppeteer.json"
cat > "$TMP/mermaid.json" <<'JSON'
{"theme": "base", "themeVariables": {"fontFamily": "Inter, Segoe UI, Helvetica, Arial, sans-serif", "fontSize": "15px",
  "primaryColor": "#ffffff", "primaryBorderColor": "#64748b", "primaryTextColor": "#0b1220", "lineColor": "#475569",
  "actorBkg": "#ecfdfb", "actorBorder": "#0ea5a0", "noteBkgColor": "#fff7ed", "noteBorderColor": "#f59e0b",
  "signalColor": "#334155", "signalTextColor": "#0b1220", "labelBoxBkgColor": "#ecfdfb", "sequenceNumberColor": "#ffffff"},
 "flowchart": {"curve": "basis", "htmlLabels": true, "padding": 14}, "sequence": {"mirrorActors": false, "showSequenceNumbers": true}}
JSON
for src in "$DIR"/*.mmd; do
  out="${src%.mmd}.png"
  echo "rendering $(basename "$out")"
  PUPPETEER_SKIP_DOWNLOAD=1 npx --yes @mermaid-js/mermaid-cli@11.12.0 -q -i "$src" -o "$out" \
    -p "$TMP/puppeteer.json" -c "$TMP/mermaid.json" -b white -s 2 -w 1600
done
