# Deploying Remi (zero cost)

Remi ships as one Docker image that serves the API and the built React app on a single port. Everything below uses free tiers. No credit card is needed.

| Option | When to use | Cost |
|---|---|---|
| **Hugging Face Spaces (Docker)** | Primary public demo | Free CPU Basic (2 vCPU, 16 GB RAM); sleeps after ~48 h without visitors |
| Render free web service | Fallback host | Free instance; sleeps after ~15 min idle (cold start ~1 min) |
| Local + Cloudflare quick tunnel | Last resort / venue without a host | Free, no account needed |
| Local (`./scripts/start.sh` or `docker compose up`) | Development, offline demo | Free |

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
| `LLM_DAILY_BUDGET` | `400` | Live LLM calls per day across all visitors; then replay/mock "demo mode" |
| `SECRET_KEY` | random in production | Signs workspace cookies and token HMACs. Set it as a secret so cookies survive restarts |
| `APP_ENV` | `production` in the image | Enables `Secure` cookies |
| `PORT` | `7860` in the image, `8000` locally | |
| `COOLING_OFF_SECONDS` / `DEMO_SETTLE_SECONDS` | `60` / `12` | Short demo timings |

**Never commit keys.** `.env` is gitignored. On hosts, keys go into the platform's secret settings.

## 2. Hugging Face Spaces (primary)

### One command

```bash
# .env contains HF_TOKEN (a *write* token from huggingface.co/settings/tokens) and the LLM keys
./scripts/deploy_hf.sh            # deploys to <your-hf-user>/remi
HF_SPACE=myname/remi-demo ./scripts/deploy_hf.sh   # custom Space name
```

The script:
1. creates a public **Docker Space** if it does not exist,
2. stores `GEMINI_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY` and a random `SECRET_KEY` as **Space secrets** (never in the repo),
3. pushes only the files the Docker build needs, plus a Space `README.md` header (`sdk: docker`, `app_port: 7860`). Screenshots and PDFs stay out because the Space git rejects binaries outside LFS,
4. waits until the Space is `RUNNING` and `/api/health` answers, then prints the URL (`https://<user>-remi.hf.space`).

### Manual steps (equivalent)

1. huggingface.co → **New Space** → SDK **Docker** → Blank → Public.
2. Space **Settings → Variables and secrets** → add secrets `GEMINI_API_KEY`, `GROQ_API_KEY`, `SECRET_KEY`.
3. Push `Dockerfile`, `backend/`, `frontend/`, `config/`, `knowledge/`, `evals/replay_cache.json` and `scripts/build_kb.py`, with a `README.md` whose front-matter contains `sdk: docker` and `app_port: 7860`.

### What the image does

* Stage 1 (`node:22-slim`) builds the frontend; stage 2 (`python:3.12-slim`) installs the backend.
* The knowledge-base embedding model (BGE-small, local) and index are **baked in at build time**, so cold starts work offline.
* Runs as uid 1000 on `$PORT` (7860) with a Docker `HEALTHCHECK` on `/api/health`.
* SQLite lives in `/tmp/remi-data`. Free Space storage is **ephemeral**: a restart wipes it, and every visitor's workspace re-seeds automatically on the next visit.

### Before judging (warm-up)

Free Spaces sleep when idle. **Open the URL 5–10 minutes before the presentation** and click through the dashboard once. Check `https://<user>-remi.hf.space/api/health` → `{"status":"ok",...}`.

## 3. Render (fallback)

1. render.com → New → **Web Service** → connect the GitHub repo → Runtime **Docker**, plan **Free**.
2. Environment: `GEMINI_API_KEY`, `GROQ_API_KEY`, `SECRET_KEY` (Render injects `PORT`, which the image honours).
3. Health check path: `/api/health`.

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
curl -s https://<user>-remi.hf.space/api/health
# End-to-end S1 smoke test (Playwright, against any URL):
cd frontend && E2E_BASE_URL=https://<user>-remi.hf.space E2E_REPORT=../evidence/live_smoke_test.json npx playwright test
```

The result of the smoke test against the live URL is saved in `evidence/live_smoke_test.json`.

## 6. Troubleshooting

| Symptom | Fix |
|---|---|
| `localhost:8000` doesn't open | Use the URL in the "Remi is ready" banner. `start.sh` binds IPv4 and IPv6; `0.0.0.0` is a bind address, not a URL |
| "Port 8000 is already in use" | Another Remi/dev server is running: stop it or `PORT=8080 ./scripts/start.sh` |
| Badge shows `mock` / "demo mode" | No LLM key set, daily budget used up, or providers rate-limited. Replay answers still work for the demo scenarios |
| Space stuck in `BUILDING` | First build takes ~5–10 min (npm + pip + embedding model). See the Space's **Logs** tab |
| Visitors lose their sandbox | Expected after a Space restart (ephemeral storage); set `SECRET_KEY` so cookies stay valid |
