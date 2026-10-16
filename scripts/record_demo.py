#!/usr/bin/env python3
"""Record silent backup demo footage to evidence/demo_raw.webm (Playwright drives the UI through Demo_Video_Script.md).

Starts a fresh local server (replay cache first, then the configured provider, then mock) unless --base-url is given.
  python scripts/record_demo.py
  python scripts/record_demo.py --base-url https://<live-url> --out evidence/demo_live.webm
"""
import argparse
import os
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from capture_screenshots import node_cmd  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url")
    ap.add_argument("--port", type=int, default=8767)
    ap.add_argument("--out", default=str(ROOT / "evidence" / "demo_raw.webm"))
    args = ap.parse_args()
    server = None
    base = args.base_url
    if not base:
        env = {**os.environ, "DATA_DIR": tempfile.mkdtemp(prefix="remi-demo-"), "LLM_CACHE": os.environ.get("LLM_CACHE", "replay"),
               "DEMO_SETTLE_SECONDS": "8", "COOLING_OFF_SECONDS": "30"}
        server = subprocess.Popen([str(ROOT / "backend/.venv/bin/uvicorn"), "app.main:app", "--app-dir", str(ROOT / "backend"), "--port", str(args.port)],
                                  env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        base = f"http://localhost:{args.port}"
        for _ in range(60):
            try:
                urllib.request.urlopen(f"{base}/api/health", timeout=1)
                break
            except OSError:
                time.sleep(0.5)
    try:
        return subprocess.call([*node_cmd(), str(ROOT / "frontend/e2e/record_demo.mjs"), base, str(Path(args.out).resolve())], cwd=ROOT / "frontend")
    finally:
        if server:
            server.terminate()


if __name__ == "__main__":
    sys.exit(main())
