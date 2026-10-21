import os
import json
import logging
import threading
from typing import List, Dict, Any, Optional, Tuple
import numpy as np
from app.config import settings
from app.schemas.rag import ChunkItem
from app.core.retrieval import BM25Index, reciprocal_rank_fusion

logger = logging.getLogger(__name__)


class VectorStoreManager:
    """
    Local vector store persisted to disk (chunks JSON + embeddings .npy), with a
    BM25 keyword index alongside so retrieval can be hybrid (semantic + keyword).
    Survives restarts: uploaded documents no longer vanish when the server reboots.
    """

    def __init__(self, index_dir: str = None):
        self.index_dir = index_dir or settings.INDEX_DIR
        self._chunks_path = os.path.join(self.index_dir, "chunks.json")
        self._emb_path = os.path.join(self.index_dir, "embeddings.npy")
        self._lock = threading.RLock()

        self._chunks_store: Dict[str, ChunkItem] = {}
        self._embeddings_store: Dict[str, np.ndarray] = {}
        self._doc_to_chunks: Dict[str, List[str]] = {}
        self._bm25 = BM25Index()
        # Bumped on every write; lets caches know when cached answers may be stale
        self.version = 0

        self._load()

    @property
    def store_type(self) -> str:
        return "Local Hybrid Store (Vector + BM25, persisted)"

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------

    def _load(self):
        if not (os.path.exists(self._chunks_path) and os.path.exists(self._emb_path)):
            return
        try:
            with open(self._chunks_path, "r", encoding="utf-8") as f:
                chunk_dicts = json.load(f)
            matrix = np.load(self._emb_path)
            if len(chunk_dicts) != len(matrix):
                raise ValueError("chunk/embedding count mismatch")
            for data, emb in zip(chunk_dicts, matrix):
                self._add(ChunkItem(**data), emb)
            logger.info(f"Loaded persisted index: {len(self._chunks_store)} chunks from {self.index_dir}")
        except Exception as e:
            logger.error(f"Failed to load persisted index ({e}); starting empty.")
            self._chunks_store.clear(); self._embeddings_store.clear()
            self._doc_to_chunks.clear(); self._bm25 = BM25Index()

    def _save(self):
        os.makedirs(self.index_dir, exist_ok=True)
        ids = list(self._chunks_store)
        chunk_dicts = [self._chunks_store[i].model_dump() for i in ids]
        matrix = (np.stack([self._embeddings_store[i] for i in ids]) if ids
                  else np.zeros((0, 768), dtype=np.float32))
        tmp_json, tmp_npy = self._chunks_path + ".tmp", self._emb_path + ".tmp.npy"
        with open(tmp_json, "w", encoding="utf-8") as f:
            json.dump(chunk_dicts, f)
        np.save(tmp_npy, matrix)
        os.replace(tmp_json, self._chunks_path)
        os.replace(tmp_npy, self._emb_path)

    # ------------------------------------------------------------------
    # Writes
    # ------------------------------------------------------------------

    def _add(self, chunk: ChunkItem, emb):
        vec = np.asarray(emb, dtype=np.float32)
        norm = np.linalg.norm(vec)
        self._chunks_store[chunk.chunk_id] = chunk
        self._embeddings_store[chunk.chunk_id] = vec / norm if norm > 0 else vec
        ids = self._doc_to_chunks.setdefault(chunk.document_id, [])
        if chunk.chunk_id not in ids:
            ids.append(chunk.chunk_id)
        self._bm25.add(chunk.chunk_id, f"{chunk.filename} {chunk.text}")

    def upsert_chunks(self, chunks: List[ChunkItem], embeddings: List[List[float]]) -> int:
        if not chunks or not embeddings:
            return 0
        with self._lock:
            for chunk, emb in zip(chunks, embeddings):
                self._add(chunk, emb)
            self.version += 1
            self._save()
        return len(chunks)

    def delete_document(self, document_id: str) -> bool:
        with self._lock:
            for cid in self._doc_to_chunks.pop(document_id, []):
                self._chunks_store.pop(cid, None)
                self._embeddings_store.pop(cid, None)
                self._bm25.remove(cid)
            self.version += 1
            self._save()
        return True

    # ------------------------------------------------------------------
    # Search
    # ------------------------------------------------------------------

    def _allowed_ids(self, document_ids: Optional[List[str]]) -> Optional[set]:
        if not document_ids:
            return None
        return {cid for d in document_ids for cid in self._doc_to_chunks.get(d, [])}

    def similarity_search(
        self,
        query_vector: List[float],
        top_k: int = 4,
        document_ids: Optional[List[str]] = None
    ) -> List[Tuple[ChunkItem, float]]:
        with self._lock:
            allowed = self._allowed_ids(document_ids)
            ids = [cid for cid in self._embeddings_store if allowed is None or cid in allowed]
            if not ids:
                return []
            q = np.asarray(query_vector, dtype=np.float32)
            qn = np.linalg.norm(q)
            if qn > 0:
                q = q / qn
            sims = np.stack([self._embeddings_store[i] for i in ids]) @ q
            order = np.argsort(-sims)[:top_k]
            return [(self._chunks_store[ids[i]], round(float(max(0.0, min(1.0, (sims[i] + 1) / 2))), 4))
                    for i in order]

    def hybrid_search(
        self,
        query: str,
        query_vector: List[float],
        candidates: int = 20,
        document_ids: Optional[List[str]] = None
    ) -> List[Tuple[ChunkItem, Dict[str, Any]]]:
        """
        Fuse semantic and BM25 rankings with Reciprocal Rank Fusion.
        Returns (chunk, trace) where trace records how each retriever ranked the chunk.
        """
        with self._lock:
            semantic = self.similarity_search(query_vector, candidates, document_ids)
            keyword = self._bm25.search(query, candidates, self._allowed_ids(document_ids))
            sem_rank = {c.chunk_id: (i + 1, s) for i, (c, s) in enumerate(semantic)}
            kw_rank = {cid: (i + 1, s) for i, (cid, s) in enumerate(keyword)}
            fused = reciprocal_rank_fusion([[c.chunk_id for c, _ in semantic], [cid for cid, _ in keyword]])
            results = []
            for pos, cid in enumerate(fused[:candidates], start=1):
                if cid not in self._chunks_store:
                    continue
                results.append((self._chunks_store[cid], {
                    "semantic_rank": sem_rank.get(cid, (None, 0.0))[0],
                    "semantic_score": round(sem_rank.get(cid, (None, 0.0))[1], 4),
                    "keyword_rank": kw_rank.get(cid, (None, 0.0))[0],
                    "keyword_score": round(kw_rank.get(cid, (None, 0.0))[1], 3),
                    "fused_rank": pos,
                }))
            return results

    def all_chunks(self) -> List[ChunkItem]:
        return list(self._chunks_store.values())

    def embedding_of(self, chunk_id: str) -> Optional[np.ndarray]:
        return self._embeddings_store.get(chunk_id)

    def get_document_chunks(self, document_id: str) -> List[ChunkItem]:
        chunk_ids = self._doc_to_chunks.get(document_id, [])
        return [self._chunks_store[cid] for cid in chunk_ids if cid in self._chunks_store]

    def get_stats(self) -> Dict[str, Any]:
        return {
            "total_documents": len(self._doc_to_chunks),
            "total_chunks": len(self._chunks_store),
            "store_type": self.store_type,
            "pinecone_active": False
        }


# Global singleton
vector_store = VectorStoreManager()
