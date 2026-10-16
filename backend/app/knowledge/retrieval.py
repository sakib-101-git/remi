"""Hybrid retrieval over the curated knowledge base.

score = α · cos_norm(q, chunk) + (1 − α) · bm25_norm(q, chunk)
  cos_norm  = clip((cos − 0.45) / 0.40, 0, 1)   (bge-small cosines for unrelated text sit around 0.4-0.5)
  bm25_norm = s / (s + 6)                        (absolute saturation, so an irrelevant query stays low)
Results below KB_MIN_SCORE are dropped and the agent says it doesn't know.
"""
from __future__ import annotations

import hashlib
import json
import logging
import re
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import yaml
from rank_bm25 import BM25Okapi

from ..config import KNOWLEDGE_DIR, get_settings
from ..security import injection

log = logging.getLogger("remi.kb")
INDEX_DIR = Path(__file__).resolve().parent / "index"
EMBED_MODEL = "BAAI/bge-small-en-v1.5"
CHUNK_CHARS = 1600  # ≈ 400 tokens
STOP = set("a an and are as at be by can do does for from how i if in is it my of on or so that the this to what when where which who why will with you your".split())
_SENT_SPLIT = re.compile(r"(?<=[.!?])\s+")


@dataclass
class Article:
    slug: str
    title: str
    region: str
    last_reviewed: str
    illustrative: bool
    body: str


@dataclass
class Chunk:
    slug: str
    title: str
    illustrative: bool
    text: str
    flagged: bool


def _stem(word: str) -> str:
    for suffix in ("ations", "ation", "ments", "ment", "ings", "ing", "ies", "es", "s"):
        if word.endswith(suffix) and len(word) - len(suffix) >= 4:
            return word[: -len(suffix)] + ("y" if suffix == "ies" else "")
    return word


def tokenize(text: str) -> list[str]:
    return [_stem(w) for w in re.findall(r"[a-z0-9]+", text.lower()) if w not in STOP and len(w) > 1]


def load_articles(directory: Path = KNOWLEDGE_DIR) -> list[Article]:
    out = []
    for path in sorted(directory.glob("*.md")):
        raw = path.read_text()
        meta: dict[str, Any] = {}
        body = raw
        if raw.startswith("---"):
            _, fm, body = raw.split("---", 2)
            meta = yaml.safe_load(fm) or {}
        out.append(Article(
            slug=path.stem, title=str(meta.get("title", path.stem)), region=str(meta.get("region", "global")),
            last_reviewed=str(meta.get("last_reviewed", "")), illustrative=bool(meta.get("illustrative", False)), body=body.strip(),
        ))
    return out


def chunk_article(a: Article) -> list[Chunk]:
    paras = [p.strip() for p in re.split(r"\n\s*\n", a.body) if p.strip()]
    chunks: list[Chunk] = []
    current: list[str] = []
    for p in paras:
        if current and sum(len(x) for x in current) + len(p) > CHUNK_CHARS:
            chunks.append(_mk(a, current))
            current = current[-1:]  # one-paragraph overlap
        current.append(p)
    if current:
        chunks.append(_mk(a, current))
    return chunks


def _mk(a: Article, paras: list[str]) -> Chunk:
    text = "\n\n".join(paras)
    return Chunk(slug=a.slug, title=a.title, illustrative=a.illustrative, text=text, flagged=injection.scan(text).suspicious)


def sanitize(text: str) -> str:
    """Drop instruction-like sentences from retrieved text; the rest is still treated as untrusted data."""
    kept = []
    for sentence in _SENT_SPLIT.split(text):
        kept.append("[removed: instruction-like text]" if injection.scan(sentence).suspicious else sentence)
    return " ".join(kept)


class Index:
    def __init__(self, articles: list[Article], use_embeddings: bool) -> None:
        self.articles = {a.slug: a for a in articles}
        self.chunks = [c for a in articles for c in chunk_article(a)]
        self.bm25 = BM25Okapi([tokenize(f"{c.title} {c.text}") for c in self.chunks]) if self.chunks else None
        self.vectors: np.ndarray | None = None
        self._embedder: Any = None
        if use_embeddings and self.chunks:
            try:
                self.vectors = self._load_or_embed()
            except Exception as exc:  # model download/offline failure → BM25-only, still works
                log.warning("Embeddings unavailable, using BM25 only: %s", exc)
                self.vectors = None

    def _fingerprint(self) -> str:
        return hashlib.sha256(json.dumps([[c.slug, c.text] for c in self.chunks]).encode()).hexdigest()[:16]

    def _embedder_get(self) -> Any:
        if self._embedder is None:
            from fastembed import TextEmbedding

            self._embedder = TextEmbedding(EMBED_MODEL, cache_dir=str(INDEX_DIR / "models"))
        return self._embedder

    def _load_or_embed(self) -> np.ndarray:
        INDEX_DIR.mkdir(parents=True, exist_ok=True)
        fp = self._fingerprint()
        vec_path = INDEX_DIR / f"vectors-{fp}.npy"
        if vec_path.exists():
            return np.load(vec_path)
        vecs = np.array(list(self._embedder_get().embed([f"{c.title}. {c.text}" for c in self.chunks])), dtype=np.float32)
        vecs /= np.linalg.norm(vecs, axis=1, keepdims=True) + 1e-9
        np.save(vec_path, vecs)
        (INDEX_DIR / "manifest.json").write_text(json.dumps({"fingerprint": fp, "model": EMBED_MODEL, "chunks": len(self.chunks)}))
        return vecs

    def search(self, query: str, k: int = 4, alpha: float | None = None, min_score: float | None = None) -> list[dict[str, Any]]:
        if not self.chunks or self.bm25 is None:
            return []
        settings = get_settings()
        alpha = settings.kb_alpha if alpha is None else alpha
        min_score = settings.kb_min_score if min_score is None else min_score
        raw = np.array(self.bm25.get_scores(tokenize(query)), dtype=np.float64)
        bm25n = raw / (raw + 6.0)
        if self.vectors is not None:
            q = np.array(list(self._embedder_get().embed([f"Represent this sentence for searching relevant passages: {query}"]))[0], dtype=np.float32)
            q /= np.linalg.norm(q) + 1e-9
            cos = self.vectors @ q
            cos_n = np.clip((cos - 0.45) / 0.40, 0, 1)
            scores = alpha * cos_n + (1 - alpha) * bm25n
        else:
            cos = np.zeros_like(bm25n)
            scores = bm25n
        order = np.argsort(-scores)
        out: list[dict[str, Any]] = []
        seen: set[str] = set()
        top = float(scores[order[0]]) if len(order) else 0.0
        for i in order:
            if scores[i] < min_score or len(out) >= k or scores[i] < 0.6 * top:
                break
            c = self.chunks[i]
            if c.slug in seen and len(out) >= 2:
                continue
            seen.add(c.slug)
            out.append({
                "slug": c.slug, "title": c.title, "illustrative": c.illustrative, "score": round(float(scores[i]), 3),
                "cosine": round(float(cos[i]), 3), "bm25": round(float(bm25n[i]), 3),
                "text": sanitize(c.text) if c.flagged else c.text, "flagged": c.flagged,
            })
        return out


_index: Index | None = None
_lock = threading.Lock()


def get_index() -> Index:
    global _index
    with _lock:
        if _index is None:
            _index = Index(load_articles(), get_settings().kb_use_embeddings)
        return _index


def set_index(index: Index | None) -> None:
    global _index
    _index = index


def search(query: str, k: int = 4) -> list[dict[str, Any]]:
    return get_index().search(query, k=k)


def list_articles() -> list[dict[str, Any]]:
    return [{"slug": a.slug, "title": a.title, "region": a.region, "last_reviewed": a.last_reviewed, "illustrative": a.illustrative} for a in get_index().articles.values()]


def get_article(slug: str) -> dict[str, Any] | None:
    a = get_index().articles.get(slug)
    if a is None:
        return None
    return {"slug": a.slug, "title": a.title, "region": a.region, "last_reviewed": a.last_reviewed, "illustrative": a.illustrative, "body": a.body}


def slug_for_title(title: str) -> str | None:
    t = title.lower().strip()
    for a in get_index().articles.values():
        if a.title.lower() == t or t in a.title.lower():
            return a.slug
    return None
