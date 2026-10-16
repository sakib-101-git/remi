# syntax=docker/dockerfile:1
# ---- 1. Build the React frontend ---------------------------------------------
FROM node:22-slim AS web
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ---- 2. Python runtime (single port) -----------------------------------------
FROM python:3.12-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 \
    APP_ENV=production PORT=7860 DATA_DIR=/tmp/remi-data \
    LLM_CACHE=replay KB_USE_EMBEDDINGS=true HF_HOME=/tmp/hf
RUN useradd -m -u 1000 remi
WORKDIR /app
COPY backend/requirements.txt backend/requirements.txt
RUN pip install -r backend/requirements.txt
COPY --chown=remi backend/app backend/app
COPY --chown=remi config config
COPY --chown=remi knowledge knowledge
COPY --chown=remi evals/replay_cache.json* evals/
COPY --chown=remi scripts/build_kb.py scripts/build_kb.py
COPY --from=web --chown=remi /app/frontend/dist frontend/dist
USER remi
# Bake the local embedding model + KB vectors into the image so cold starts are fast and offline-safe.
RUN python scripts/build_kb.py
EXPOSE 7860
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s CMD python -c "import os,urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"PORT\",\"7860\")}/api/health', timeout=4)" || exit 1
CMD ["sh", "-c", "cd backend && exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips='*'"]
