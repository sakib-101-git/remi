#!/usr/bin/env bash
# Build the PDF deliverables: docs/TECHNICAL_DOCUMENTATION.pdf and docs/SECURITY_SELF_ASSESSMENT.pdf.
# Renders Mermaid diagrams first (SKIP_DIAGRAMS=1 to reuse existing PNGs). Uses pandoc only if PANDOC=1 and installed;
# the default path is Markdown -> HTML (python-markdown) -> PDF (Playwright Chromium), no sudo needed.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/scripts/_env.sh"
ensure_backend
ensure_frontend
[ "${SKIP_DIAGRAMS:-0}" = "1" ] || "$ROOT/scripts/render_diagrams.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
build() {
  local md="$1" pdf="$2" label="$3"
  if [ "${PANDOC:-0}" = "1" ] && command -v pandoc >/dev/null 2>&1; then
    pandoc "$md" -o "$pdf" --toc --resource-path="$(dirname "$md")"
  else
    "$ROOT/backend/.venv/bin/python" "$ROOT/scripts/build_docs.py" "$md" "$TMP/$(basename "$md" .md).html"
    (cd "$ROOT/frontend" && node scripts/print_pdf.mjs "$TMP/$(basename "$md" .md).html" "$pdf" "$label")
  fi
}
build "$ROOT/docs/TECHNICAL_DOCUMENTATION.md" "$ROOT/docs/TECHNICAL_DOCUMENTATION.pdf" "Remi - Technical Documentation"
build "$ROOT/docs/SECURITY_SELF_ASSESSMENT.md" "$ROOT/docs/SECURITY_SELF_ASSESSMENT.pdf" "Remi - Security Self-Assessment"
