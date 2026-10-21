import math
import logging
from typing import List
import requests
import numpy as np
from app.config import settings

logger = logging.getLogger(__name__)


class EmbeddingService:
    """
    Embedding service backed by Ollama's local models.
    Primary: nomic-embed-text (768-dim, optimised for RAG retrieval)
    Fallback: local deterministic hash-shingle vectoriser (same 768-dim)
    """

    def __init__(self, api_key: str = None, model_name: str = None):
        # api_key / Gemini params kept for signature compatibility but are ignored
        self.ollama_base = settings.OLLAMA_BASE_URL
        self.embed_model = settings.OLLAMA_EMBED_MODEL
        logger.info(f"EmbeddingService initialised → Ollama/{self.embed_model} @ {self.ollama_base}")

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def embed_texts(self, texts: List[str]) -> List[List[float]]:
        if not texts:
            return []
            
        try:
            url = f"{self.ollama_base}/api/embed"
            payload = {"model": self.embed_model, "input": [self._prefix("search_document", t) for t in texts], "keep_alive": "24h"}
            # Use longer timeout for batch requests
            resp = requests.post(url, json=payload, timeout=120)
            if resp.status_code == 200:
                data = resp.json()
                embeddings_list = data.get("embeddings", [])
                if embeddings_list and len(embeddings_list) == len(texts):
                    return [self._normalise(vec) for vec in embeddings_list]
            logger.warning(
                f"Ollama batch embed returned {resp.status_code}. "
                "Falling back to local vectoriser."
            )
        except Exception as exc:
            logger.warning(f"Ollama batch embed request failed ({exc}). Falling back to local vectoriser.")

        return [self._local_embed(t, dim=768) for t in texts]

    def embed_query(self, query: str) -> List[float]:
        """Return a 768-dim embedding vector for *query*."""
        try:
            url = f"{self.ollama_base}/api/embed"
            payload = {"model": self.embed_model, "input": self._prefix("search_query", query), "keep_alive": "24h"}
            resp = requests.post(url, json=payload, timeout=30)
            if resp.status_code == 200:
                data = resp.json()
                # Ollama returns {"embeddings": [[...]]}
                embeddings_list = data.get("embeddings", [])
                if embeddings_list and isinstance(embeddings_list[0], list):
                    vec = embeddings_list[0]
                    return self._normalise(vec)
            logger.warning(
                f"Ollama embed returned {resp.status_code}: {resp.text[:200]}. "
                "Falling back to local vectoriser."
            )
        except Exception as exc:
            logger.warning(f"Ollama embed request failed ({exc}). Falling back to local vectoriser.")

        return self._local_embed(query, dim=768)

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    def _prefix(self, task: str, text: str) -> str:
        # nomic-embed-text is trained with task prefixes; omitting them noticeably hurts retrieval
        return f"{task}: {text}" if "nomic" in self.embed_model else text

    @staticmethod
    def _normalise(vec: List[float]) -> List[float]:
        arr = np.array(vec, dtype=np.float32)
        norm = np.linalg.norm(arr)
        if norm > 0:
            arr = arr / norm
        return arr.tolist()

    def _local_embed(self, text: str, dim: int = 768) -> List[float]:
        """Deterministic hash-shingle fallback (no external calls)."""
        vec = np.zeros(dim, dtype=np.float32)
        words = text.lower().split()
        for i, word in enumerate(words):
            h = hash(word) % dim
            weight = 1.0 / (math.log(i + 2) + 0.1)
            vec[h] += float(weight)
            for j in range(len(word) - 2):
                shingle = word[j : j + 3]
                h_shingle = hash(shingle) % dim
                vec[h_shingle] += 0.4
        norm = np.linalg.norm(vec)
        if norm > 0:
            vec = vec / norm
        return vec.tolist()
