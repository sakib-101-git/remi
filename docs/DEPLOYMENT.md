# Deploying Remi (zero cost)

Remi ships as one Docker image that serves the API and the built React app on a single port. Everything below uses free tiers. No credit card is needed.

| Option | When to use | Cost |
|---|---|---|
| **Render free web service (Docker)** | Primary public demo | Free instance (512 MB RAM, shared CPU), no card; sleeps after ~15 min idle (cold start ~1 min) |
| Local + Cloudflare quick tunnel | Backup during judging | Free, no account needed |
| Local (`./scripts/start.sh` or `docker compose up`) | Development, offline demo | Free |
| Hugging Face Spaces (Docker) | Only with an HF PRO subscription | Not free: as of October 2026, Docker/Gradio Spaces on CPU Basic require PRO (API answers 402), so it breaks our zero-cost rule. `scripts/deploy_hf.sh` is kept for teams that have PRO |

Free-tier terms change; check the provider's pricing page before the event.

## 1. Configuration

All settings are environment variables (see `.env.example` for the full list).

| Variable | Default | Notes |
|---|---|---|
| `GEMINI_API_KEY` | – | Free key from Google AI Studio (aistudio.google.com/apikey). Primary model |
| `GROQ_API_KEY` | – | Free key from console.groq.com. Second in the fallback chain |
| `OPENROUTER_API_KEY` | – | Optional; `:free` models |
| `LLM_PROVIDER` / `LLM_FALLBACK` | `gemini` / `gemini,groq,openrouter,ollama,mock` | Providers without a key are skipped; `mock` always answers |
| `LLM_CACHE` | `replay` | `replay` serves recorded demo answers from `evals/replay_cache.json` first, then goes live |
| `LLM_DAILY_BUDGET` | `400` | Live LLM calls per day across all visitors; then recorded answers and the offline agent |
| `SECRET_KEY` | random in production | Signs workspace cookies and token HMACs. Set it as a secret so cookies survive restarts |
| `APP_ENV` | `production` in the image | Enables `Secure` cookies |
| `PORT` | `7860` in the image, `8000` locally | |
| `COOLING_OFF_SECONDS` / `DEMO_SETTLE_SECONDS` | `60` / `12` | Short demo timings |

**Never commit keys.** `.env` is gitignored. On hosts, keys go into the platform's secret settings.

## 2. Render (primary)

The repository contains a [Render Blueprint](../render.yaml): one free Docker web service built from the same `Dockerfile`, with health check `/api/health` and a generated `SECRET_KEY`.

1. Sign in at <https://dashboard.render.com> with GitHub (free, no card).
2. **New → Blueprint** → select the `sakib-101-git/remi` repository → **Apply**.
3. When prompted, paste `GEMINI_API_KEY` and `GROQ_API_KEY` (stored as Render secrets, never in the repo).
4. The first build takes ~5–10 minutes (npm, pip and the embedding model baked into the image). The service URL looks like `https://remi-xxxx.onrender.com`; ours is <https://remi-pzqb.onrender.com>.

Equivalent manual setup: **New → Web Service** → the repo → Runtime **Docker** → Instance type **Free** → Health check path `/api/health` → environment variables as above. Render injects `PORT`, and the image listens on it.

Memory: the container peaks at ≈ 275 MB with local embeddings (≈ 80 MB with `KB_USE_EMBEDDINGS=false`), within the 512 MB free limit.

### What the image does

* Stage 1 (`node:22-slim`) builds the frontend; stage 2 (`python:3.12-slim`) installs the backend.
* The knowledge-base embedding model (BGE-small, local) and index are **baked in at build time**, so cold starts work offline.
* Runs as uid 1000 on `$PORT` with a Docker `HEALTHCHECK` on `/api/health`.
* SQLite lives in `/tmp/remi-data`. Free instances have **ephemeral** disks: a restart or redeploy wipes it, and every visitor's workspace re-seeds automatically on the next visit.

### Before judging (warm-up)

Free instances sleep when idle. **Open the URL 5–10 minutes before the presentation** and click through Home once. Check `<live-url>/api/health` → `{"status":"ok",...}`.

## 3. Hugging Face Spaces (requires PRO)

`./scripts/deploy_hf.sh` creates a Docker Space, stores the LLM keys and a random `SECRET_KEY` as Space secrets, pushes only the build inputs (HF rejects binaries outside LFS) and waits for `/api/health`. It needs an HF **PRO** subscription for Docker Spaces; on a free account the API answers `402`.

## 4. Local, Docker and quick tunnel

```bash
./scripts/seed.sh && ./scripts/start.sh      # builds the frontend if needed, prints "Remi is ready -> http://localhost:8000"
docker compose up --build                     # same app in the production image on http://localhost:8000
```

To expose a local instance publicly for free without an account:

```bash
cloudflared tunnel --url http://localhost:8000   # prints a https://<random>.trycloudflare.com URL
```

## 5. Verifying a deployment

```bash
curl -s <live-url>/api/health
# End-to-end S1 smoke test (Playwright, against any URL):
cd frontend && E2E_BASE_URL=<live-url> E2E_REPORT=../evidence/live_smoke_test.json npx playwright test
```

The result of the smoke test against the live URL is saved in `evidence/live_smoke_test.json`.

## 6. Troubleshooting

| Symptom | Fix |
|---|---|
| `localhost:8000` doesn't open | Use the URL in the "Remi is ready" banner. `start.sh` binds IPv4 and IPv6; `0.0.0.0` is a bind address, not a URL |
| "Port 8000 is already in use" | Another Remi/dev server is running: stop it or `PORT=8080 ./scripts/start.sh` |
| **Demo → AI model** says "Offline agent (no key)", or answers are generic | No LLM key set, daily budget used up, or providers rate-limited. Replay answers still work for the demo scenarios |
| Render build slow or service "starting" | The first build takes ~5–10 min (npm + pip + embedding model); after idle sleep the first request takes ~1 min. See the service **Logs** |
| Visitors lose their sandbox | Expected after a restart or redeploy (ephemeral storage); the workspace re-seeds automatically |
