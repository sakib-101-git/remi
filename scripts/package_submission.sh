#!/usr/bin/env bash
# Build submission/ and submission/GitPushPray_FinTechathon2026_TopicC.zip.
# Optional env: LIVE_URL (default: read from README), VIDEO_URL (YouTube/Drive link), REBUILD_DOCS=1.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
OUT="$ROOT/submission"
PKG="$OUT/GitPushPray_FinTechathon2026_TopicC"
REPO="https://github.com/sakib-101-git/remi"
LIVE_URL="${LIVE_URL:-$(grep -oE '\*\*Live demo:\*\* <[^>]+>' README.md | sed -E 's/.*<([^>]+)>/\1/' || true)}"
VIDEO_URL="${VIDEO_URL:-}"
warn() { printf '  ! %s\n' "$1"; WARNINGS=$((WARNINGS + 1)); }
WARNINGS=0

if [ "${REBUILD_DOCS:-0}" = "1" ] || [ ! -f docs/TECHNICAL_DOCUMENTATION.pdf ] || [ ! -f docs/SECURITY_SELF_ASSESSMENT.pdf ]; then
  ./scripts/build_docs.sh
fi

rm -rf "$PKG" "$PKG.zip"
mkdir -p "$PKG"
echo "==> Assembling $PKG"
cp docs/TECHNICAL_DOCUMENTATION.pdf "$PKG/01_Technical_Documentation.pdf"

deck_pptx=$(ls deck/*.pptx 2>/dev/null | head -1 || true)
deck_pdf=$(ls deck/*.pdf 2>/dev/null | head -1 || true)
[ -n "$deck_pptx" ] && cp "$deck_pptx" "$PKG/02_Presentation_Deck.pptx"
[ -n "$deck_pdf" ] && cp "$deck_pdf" "$PKG/02_Presentation_Deck.pdf"
if [ -z "$deck_pptx$deck_pdf" ]; then
  warn "No deck in deck/ (put the final PPTX/PDF there) - 02 missing"
elif [ -z "$deck_pdf" ]; then
  warn "No deck PDF in deck/ - reviewers without the deck fonts will see substitutes in the PPTX"
fi

video=$(ls "$OUT"/03_Demo_Video.mp4 deck/*.mp4 2>/dev/null | head -1 || true)
if [ -n "$video" ]; then
  cp "$video" "$PKG/03_Demo_Video.mp4"
elif [ -f evidence/demo_raw.webm ]; then
  cp evidence/demo_raw.webm "$PKG/03_Demo_Video_backup_silent.webm"
  warn "No narrated demo video (submission/03_Demo_Video.mp4) - included the silent Playwright capture instead"
else
  warn "No demo video - 03 missing (optional deliverable)"
fi
[ -n "$VIDEO_URL" ] || warn "VIDEO_URL not set - add the video link to SUBMISSION_EMAIL.md"

mkdir -p "$PKG/04_Source_Code"
cp README.md LICENSE THIRD_PARTY_LICENSES.md "$PKG/04_Source_Code/"
cp docs/DEPLOYMENT.md "$PKG/04_Source_Code/DEPLOYMENT.md"
cat > "$PKG/04_Source_Code/SOURCE_LINKS.md" <<EOF
# Remi - source and live demo

* GitHub repository: $REPO
* Live demo: ${LIVE_URL:-<not deployed>}
* Demo video: ${VIDEO_URL:-<link to be added>}
* Commit: $(git rev-parse --short HEAD) ($(git log -1 --format=%cd --date=format:'%Y-%m-%d %H:%M %z'))

Quick start: \`git clone $REPO.git && cd remi && ./scripts/seed.sh && ./scripts/start.sh\` -> open the URL printed in the "Remi is ready" banner.
Deployment: see DEPLOYMENT.md. Tests: \`cd backend && .venv/bin/python -m pytest -q\`. Evals: \`backend/.venv/bin/python evals/run_evals.py\`.
EOF
git archive --format=zip --prefix=remi/ -o "$PKG/04_Source_Code/remi_source_$(git rev-parse --short HEAD).zip" HEAD
[ -z "$(git status --porcelain)" ] || warn "Working tree has uncommitted changes - the source zip contains HEAD only"

cp docs/SECURITY_SELF_ASSESSMENT.pdf "$PKG/05_Security_Self_Assessment.pdf"

mkdir -p "$PKG/06_Execution_Evidence"
cp -r evidence/README.md evidence/eval_report.md evidence/eval_results.json evidence/audit_export.json evidence/playwright_results.json \
  evidence/pytest_summary.txt evidence/sandbox_logs evidence/screenshots "$PKG/06_Execution_Evidence/"
if [ -f evidence/live_smoke_test.json ]; then cp evidence/live_smoke_test.json "$PKG/06_Execution_Evidence/"; else warn "evidence/live_smoke_test.json missing (run the S1 smoke test against the live URL)"; fi

cat > "$OUT/SUBMISSION_EMAIL.md" <<EOF
**To:** wangyr@pbcsf.tsinghua.edu.cn
**Subject:** FinTechathon 2026 International Track - Topic C submission - Team Git Push Pray (Remi)

Dear Organising Committee,

Please find attached the submission of Team **Git Push Pray** for the FinTechathon 2026 International Track, **Topic C: Cross-border & Student Finance Assistant**. Our project, **Remi**, is an AI money agent for international students that plans and executes cross-border and tuition payments in a sandbox, with human confirmation, deterministic policy controls and a hash-chained audit log.

**Attachments** (GitPushPray_FinTechathon2026_TopicC.zip):

1. 01_Technical_Documentation.pdf - system architecture, core algorithms, security design (mandatory)
2. 02_Presentation_Deck - final presentation, 10 minutes or less (mandatory)
3. 03_Demo_Video - demo video, 5 minutes or less (optional)
4. 04_Source_Code - README, deployment instructions, licences, source archive and links
5. 05_Security_Self_Assessment.pdf - permission-tier implementation and known-risk list (optional)
6. 06_Execution_Evidence - sandbox operation logs, audit export with chain verification, evaluation report, test results, screenshots (optional)

**Links**

* GitHub: $REPO
* Live demo: ${LIVE_URL:-<live URL>}
* Demo video: ${VIDEO_URL:-<video link>}

**Team**

* Syed Nazmus Sakib (Leader), East Delta University
* Sadmanul Arefin, Ahsanullah University of Science & Technology

All money, providers, banks and universities in Remi are fictional sandbox data. The project is released under the MIT licence and uses only permissively licensed open-source components and free-tier services.

Kind regards,
Syed Nazmus Sakib, on behalf of Team Git Push Pray
EOF

(cd "$OUT" && rm -f GitPushPray_FinTechathon2026_TopicC.zip && "$ROOT/backend/.venv/bin/python" -c "
import shutil; shutil.make_archive('GitPushPray_FinTechathon2026_TopicC', 'zip', '.', 'GitPushPray_FinTechathon2026_TopicC')")
echo "==> $(du -h "$OUT/GitPushPray_FinTechathon2026_TopicC.zip" | cut -f1)  submission/GitPushPray_FinTechathon2026_TopicC.zip"
echo "==> submission/SUBMISSION_EMAIL.md"
[ "$WARNINGS" = "0" ] && echo "Package complete." || echo "Package built with $WARNINGS warning(s) above."
