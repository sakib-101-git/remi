#!/usr/bin/env python3
"""Capture every key screen into evidence/screenshots/ (drives the real UI with Playwright/Chromium).

Starts a fresh mock-provider server on a spare port unless --base-url is given.
  python scripts/capture_screenshots.py
  python scripts/capture_screenshots.py --base-url https://<live-url>
"""
import argparse
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def node_cmd() -> list[str]:
    if shutil.which("node"):
        return ["node"]
    nvm = Path.home() / ".nvm" / "nvm.sh"
    return ["bash", "-lc", f"source {nvm} >/dev/null && node \"$@\"", "node"]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url")
    ap.add_argument("--port", type=int, default=8766)
    args = ap.parse_args()
    server = None
    base = args.base_url
    if not base:
        data = tempfile.mkdtemp(prefix="remi-shots-")
        env = {**os.environ, "DATA_DIR": data, "LLM_PROVIDER": os.environ.get("LLM_PROVIDER", "mock"), "LLM_FALLBACK": os.environ.get("LLM_FALLBACK", "mock"),
               "DEMO_SETTLE_SECONDS": "3", "COOLING_OFF_SECONDS": "20"}
        server = subprocess.Popen([str(ROOT / "backend/.venv/bin/uvicorn"), "app.main:app", "--app-dir", str(ROOT / "backend"), "--port", str(args.port)], env=env,
                                  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        base = f"http://localhost:{args.port}"
        for _ in range(60):
            try:
                urllib.request.urlopen(f"{base}/api/health", timeout=1)
                break
            except OSError:
                time.sleep(0.5)
    try:
        return subprocess.call([*node_cmd(), str(ROOT / "frontend/e2e/capture.mjs"), base], cwd=ROOT / "frontend")
    finally:
        if server:
            server.terminate()


if __name__ == "__main__":
    sys.exit(main())
