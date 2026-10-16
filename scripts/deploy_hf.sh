#!/usr/bin/env bash
# Deploy Remi to a free Hugging Face Docker Space.
#   HF_TOKEN (write) in .env or the environment; optional HF_SPACE=user/name (default <you>/remi).
# Pushes only what the Docker build needs (no screenshots/PDFs: HF rejects binaries outside LFS),
# and sets GEMINI_API_KEY / GROQ_API_KEY / OPENROUTER_API_KEY / SECRET_KEY as Space secrets (never committed).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/scripts/_env.sh"
: "${HF_TOKEN:?HF_TOKEN missing - add a write token from https://huggingface.co/settings/tokens to .env}"
API=https://huggingface.co/api
auth=(-H "Authorization: Bearer $HF_TOKEN")
USER_NAME="$(curl -fsS "${auth[@]}" "$API/whoami-v2" | python3 -c 'import json,sys; print(json.load(sys.stdin)["name"])')"
SPACE="${HF_SPACE:-$USER_NAME/remi}"
SUB="$(echo "$SPACE" | tr '[:upper:]/' '[:lower:]-' | tr '_.' '--')"
URL="https://${SUB}.hf.space"

echo "==> Space $SPACE ($URL)"
code=$(curl -s -o /dev/null -w '%{http_code}' "${auth[@]}" "$API/spaces/$SPACE")
if [ "$code" != "200" ]; then
  echo "==> Creating Docker Space"
  curl -fsS "${auth[@]}" -H 'Content-Type: application/json' -X POST "$API/repos/create" \
    -d "{\"type\":\"space\",\"name\":\"${SPACE#*/}\",\"sdk\":\"docker\",\"private\":false}" >/dev/null
fi

set_secret() {
  [ -n "${2:-}" ] || return 0
  curl -fsS "${auth[@]}" -H 'Content-Type: application/json' -X POST "$API/spaces/$SPACE/secrets" \
    -d "$(python3 -c 'import json,sys; print(json.dumps({"key": sys.argv[1], "value": sys.argv[2]}))' "$1" "$2")" >/dev/null
  echo "    secret $1 set"
}
echo "==> Secrets"
set_secret GEMINI_API_KEY "${GEMINI_API_KEY:-}"
set_secret GROQ_API_KEY "${GROQ_API_KEY:-}"
set_secret OPENROUTER_API_KEY "${OPENROUTER_API_KEY:-}"
set_secret SECRET_KEY "${SPACE_SECRET_KEY:-$(python3 -c 'import secrets; print(secrets.token_hex(32))')}"

echo "==> Assembling build context"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
cd "$ROOT"
git ls-files -z Dockerfile .dockerignore LICENSE THIRD_PARTY_LICENSES.md backend config knowledge evals/replay_cache.json scripts/build_kb.py frontend \
  | xargs -0 -I{} cp --parents {} "$STAGE"/
cp evals/replay_cache.json "$STAGE/evals/replay_cache.json"
find "$STAGE" -type f \( -name '*.png' -o -name '*.jpg' -o -name '*.pdf' -o -name '*.webm' \) -delete
cat > "$STAGE/README.md" <<EOF
---
title: Remi - AI money agent for students
emoji: 💸
colorFrom: green
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
license: mit
short_description: Sandbox AI agent for cross-border student payments
---

# Remi (sandbox demo)

AI money agent for international students: compares providers on landed cost, executes payments after human confirmation, and keeps a hash-chained audit log. **Sandbox only - no real money. Not financial, legal or tax advice.**

Source code and documentation: https://github.com/sakib-101-git/remi
EOF

echo "==> Pushing to the Space"
cd "$STAGE"
git init -q -b main
git -c user.name="Remi deploy" -c user.email="deploy@users.noreply.huggingface.co" add -A
git -c user.name="Remi deploy" -c user.email="deploy@users.noreply.huggingface.co" commit -qm "Deploy Remi $(git -C "$ROOT" rev-parse --short HEAD)"
git push -q --force "https://user:${HF_TOKEN}@huggingface.co/spaces/${SPACE}" main 2>&1 | sed "s/${HF_TOKEN}/***/g"

echo "==> Waiting for the build (first build takes ~5-10 min)"
for _ in $(seq 1 120); do
  stage=$(curl -fsS "${auth[@]}" "$API/spaces/$SPACE/runtime" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("stage",""))' || true)
  printf '\r    stage: %-20s' "$stage"
  case "$stage" in
    RUNNING) curl -fsS -o /dev/null "$URL/api/health" && { printf '\n  Remi is live -> %s\n' "$URL"; exit 0; } ;;
    BUILD_ERROR|RUNTIME_ERROR|CONFIG_ERROR) printf '\nBuild failed: see https://huggingface.co/spaces/%s?logs=build\n' "$SPACE"; exit 1 ;;
  esac
  sleep 10
done
printf '\nStill building - check https://huggingface.co/spaces/%s\n' "$SPACE"
