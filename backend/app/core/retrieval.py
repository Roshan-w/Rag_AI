import math
import re
import logging
from collections import Counter
from typing import Dict, List, Optional, Tuple

from app.config import settings
from app.schemas.rag import ChunkItem

logger = logging.getLogger(__name__)

_TOKEN_RE = re.compile(r"[a-z0-9]+(?:[.,][0-9]+)*")
_STOPWORDS = {
    "a", "an", "the", "is", "are", "was", "were", "be", "been", "of", "to", "in", "on", "for",
    "and", "or", "with", "by", "at", "as", "it", "this", "that", "what", "which", "who", "how",
    "do", "does", "did", "can", "i", "you", "me", "my", "we", "our", "from", "about", "there",
}


def tokenize(text: str) -> List[str]:
    return [t for t in _TOKEN_RE.findall(text.lower()) if t not in _STOPWORDS]


class BM25Index:
    """Okapi BM25 keyword index. Catches exact terms (fees, codes, names) that embeddings miss."""

    def __init__(self, k1: float = 1.5, b: float = 0.75):
        self.k1 = k1
        self.b = b
        self._tf: Dict[str, Counter] = {}
        self._len: Dict[str, int] = {}
        self._df: Counter = Counter()

    def add(self, chunk_id: str, text: str):
        if chunk_id in self._tf:
            self.remove(chunk_id)
        tokens = tokenize(text)
        tf = Counter(tokens)
        self._tf[chunk_id] = tf
        self._len[chunk_id] = len(tokens)
        self._df.update(tf.keys())

    def remove(self, chunk_id: str):
        tf = self._tf.pop(chunk_id, None)
        self._len.pop(chunk_id, None)
        if tf:
            self._df.subtract(tf.keys())

    def search(self, query: str, top_k: int, allowed: Optional[set] = None) -> List[Tuple[str, float]]:
        q_terms = set(tokenize(query))
        n = len(self._tf)
        if not q_terms or not n:
            return []
        avg_len = sum(self._len.values()) / n or 1.0
        scores = []
        for cid, tf in self._tf.items():
            if allowed is not None and cid not in allowed:
                continue
            score = 0.0
            for term in q_terms:
                f = tf.get(term)
                if not f:
                    continue
                df = self._df[term]
                idf = math.log(1 + (n - df + 0.5) / (df + 0.5))
                score += idf * f * (self.k1 + 1) / (f + self.k1 * (1 - self.b + self.b * self._len[cid] / avg_len))
            if score > 0:
                scores.append((cid, score))
        scores.sort(key=lambda x: x[1], reverse=True)
        return scores[:top_k]


def reciprocal_rank_fusion(rankings: List[List[str]], k: int = 60) -> List[str]:
    fused: Dict[str, float] = {}
    for ranking in rankings:
        for rank, cid in enumerate(ranking):
            fused[cid] = fused.get(cid, 0.0) + 1.0 / (k + rank + 1)
    return sorted(fused, key=fused.get, reverse=True)


class Reranker:
    """Cross-encoder reranker (ONNX via fastembed, CPU). Falls back to fused order if unavailable."""

    def __init__(self):
        self._model = None
        self._failed = False

    def _load(self):
        if self._model is not None or self._failed or not settings.RERANKER_MODEL:
            return
        try:
            from fastembed.rerank.cross_encoder import TextCrossEncoder
            self._model = TextCrossEncoder(model_name=settings.RERANKER_MODEL, cache_dir=settings.MODEL_CACHE_DIR)
            logger.info(f"Reranker loaded: {settings.RERANKER_MODEL}")
        except Exception as exc:
            self._failed = True
            logger.warning(f"Reranker unavailable ({exc}); using hybrid ranking only.")

    @property
    def active(self) -> bool:
        self._load()
        return self._model is not None

    def rerank(self, query: str, chunks: List[ChunkItem]) -> Optional[List[float]]:
        if not chunks or not self.active:
            return None
        try:
            raw = list(self._model.rerank(query, [c.text for c in chunks]))
            # Logits -> 0..1 relevance for display and thresholding
            return [1.0 / (1.0 + math.exp(-float(s))) for s in raw]
        except Exception as exc:
            logger.warning(f"Rerank failed ({exc}); using hybrid ranking only.")
            return None


reranker = Reranker()
