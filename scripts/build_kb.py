#!/usr/bin/env python3
"""Build (or refresh) the knowledge-base vector index. Also runs automatically on app startup if missing."""
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.knowledge import retrieval  # noqa: E402

t0 = time.time()
idx = retrieval.get_index()
print(f"Knowledge base: {len(idx.articles)} articles, {len(idx.chunks)} chunks, "
      f"embeddings={'yes ' + str(idx.vectors.shape) if idx.vectors is not None else 'no (BM25 only)'} in {time.time() - t0:.1f}s")
for q in ("What documents do I need to pay tuition from abroad?", "How do I build credit in the UK?"):
    print(" ", q, "->", [h["title"] for h in idx.search(q)][:2])
