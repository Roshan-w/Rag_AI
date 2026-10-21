import os
import re
import json
import time
import logging
import threading
from typing import List, Tuple, Dict, Any, Optional, Iterator
import numpy as np
from app.config import settings
from app.schemas.rag import ChunkItem, Citation, QueryResponse
from app.core.embeddings import EmbeddingService
from app.core.vector_store import vector_store
from app.core.retrieval import reranker
from app.core.registry import document_ids_in_scope, documents_named_in, library_catalog
from app.core import llm

logger = logging.getLogger(__name__)

CITATION_SYSTEM_PROMPT = """You are a senior AI research assistant specializing in Multi-Document Retrieval-Augmented Generation (RAG).
Your role is to provide accurate, comprehensive, and strictly grounded answers based ONLY on the provided context excerpts from uploaded documents.

CRITICAL INSTRUCTIONS:
1. Answer the user's question relying EXCLUSIVELY on the provided Context Chunks. Do not invent or assume facts outside the provided context.
2. Read every chunk carefully, including tables (rows are written as "cell | cell | cell"). Quote exact figures, dates, amounts and names as they appear.
3. If the answer is genuinely not present in the chunks, say clearly: "The provided documents do not contain this information." Do not guess.
4. Every claim or fact you present must include an inline citation in the format `[Doc: <filename>, Page: <page_number>]`.
5. When answering queries spanning multiple documents, synthesize the facts cleanly and cite all contributing documents. Point out if documents disagree.
6. Format your response with clean Markdown (using bold headings, bullet points, or tables where appropriate).

Library Catalog (every document currently indexed):
{catalog}

Context Chunks:
{context_blocks}
"""

GENERAL_PROMPT = """You are RAG.AI, a friendly assistant for a university's document library. Users upload PDFs,
Word files, text files and photos of notices; you answer questions about them with page-level citations.
You can also: run a "Jury" of several AI models, build timelines, audit answers claim by claim, detect
contradictions between documents, generate summaries, FAQs and quizzes, accept voice questions, and run as a Telegram bot.

Library Catalog (every document currently indexed):
{catalog}

{mode_instruction}

User: {question}
Answer (clean Markdown):"""

MODE_LIBRARY = ("The user is asking about the document collection itself. Answer ONLY from the Library Catalog. "
                "Start with one sentence stating how many documents are indexed, then "
                "(list documents as bullet points with their page counts and a one-line description when available). "
                "Do not invent documents.")
MODE_CHAT = ("The user is greeting you or asking about you. Reply briefly and warmly, say what you can do, and suggest "
             "two or three example questions based on the Library Catalog.")
MODE_GENERAL = ("No passage in the uploaded documents answers this question. Begin your reply with exactly this line:\n"
                "> ⚠️ Not found in your documents — answering from general knowledge.\n"
                "Then answer helpfully and accurately from general knowledge. Do not cite documents and do not claim the "
                "documents say anything. If you are not sure, say so.")
MODE_NOT_FOUND = ("No passage in the uploaded documents answers this question. Say so plainly in one or two sentences, "
                  "and suggest what the user could ask instead, based on the Library Catalog.")

# Questions about the collection itself ("list all documents", "how many PDFs are there?")
LIBRARY_RE = re.compile(r"\b(list|show|which|what|how many|name|count|all|latest|newest|recent|uploaded)\b.{0,40}"
                        r"\b(documents?|docs?|files?|pdfs?|sources?|uploads?|knowledge base|library)\b", re.I)
# …but not content questions that merely mention the documents ("what do the documents say about MPI")
CONTENT_HINT_RE = re.compile(r"\b(say|says|said|about|regarding|mention\w*|according|explain\w*|describe\w*|contain\w*|related to)\b", re.I)
# Greetings and questions about the assistant
CHAT_RE = re.compile(r"^\s*(hi+|hello|hey|hii+|namaste|good (morning|afternoon|evening)|thanks?( you)?|thank u|ok(ay)?|bye)\b[\s!.?]*$"
                     r"|\b(who are you|what can you do|what are you|help me use|how do (i|you) use|your features)\b", re.I)

NOT_FOUND_ANSWER = ("No relevant documents or text chunks were found in the index. "
                    "Please upload documents first or refine your search query.")

TUNING_FILE = os.path.join(settings.INDEX_DIR, "tuning.json")

Retrieved = List[Tuple[ChunkItem, float, Dict[str, Any]]]

# "What does X contain / summarize X / what is X about" — answered from the document's opening, not by similarity
OVERVIEW_RE = re.compile(r"\b(contains?|about|summar\w*|overview|outline|explain|describe|topics?|covers?|what is in|what's in)\b", re.I)


def load_tuning():
    """Apply retrieval parameters chosen by the self-tuning evaluation loop, if any."""
    try:
        with open(TUNING_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        settings.RETRIEVAL_CANDIDATES = int(data.get("candidates", settings.RETRIEVAL_CANDIDATES))
        settings.USE_RERANKER = bool(data.get("use_reranker", settings.USE_RERANKER))
        settings.TOP_K = int(data.get("top_k", settings.TOP_K))
        logger.info(f"Applied tuned retrieval config: {data}")
    except FileNotFoundError:
        pass
    except Exception as e:
        logger.warning(f"Ignoring unreadable tuning file: {e}")


class SemanticCache:
    """
    Returns a stored answer when a new question means the same as an earlier one
    (cosine ≥ threshold) and the index has not changed since. Saves a full LLM call.
    """

    def __init__(self, max_entries: int = 300):
        self.max_entries = max_entries
        self._entries: List[Dict[str, Any]] = []
        self._lock = threading.Lock()
        self.hits = 0
        self.misses = 0

    def lookup(self, vec: np.ndarray, key: tuple) -> Optional[Dict[str, Any]]:
        with self._lock:
            best, best_sim = None, settings.CACHE_SIMILARITY
            for e in self._entries:
                if e["key"] != key or e["version"] != vector_store.version:
                    continue
                sim = float(np.dot(vec, e["vec"]))
                if sim >= best_sim:
                    best, best_sim = e, sim
            if best:
                self.hits += 1
            else:
                self.misses += 1
            return best

    def store(self, vec: np.ndarray, key: tuple, result: Dict[str, Any]):
        with self._lock:
            self._entries.append({"vec": vec, "key": key, "version": vector_store.version, **result})
            if len(self._entries) > self.max_entries:
                self._entries.pop(0)

    def stats(self) -> Dict[str, Any]:
        total = self.hits + self.misses
        return {"entries": len(self._entries), "hits": self.hits, "misses": self.misses,
                "hit_rate": round(self.hits / total, 3) if total else 0.0}


class RAGPipeline:
    def __init__(self, gemini_api_key: Optional[str] = None):
        # gemini_api_key kept for signature compatibility — not used
        self.gen_model = settings.OLLAMA_GEN_MODEL
        self.embedding_service = EmbeddingService()
        self.cache = SemanticCache()
        load_tuning()
        logger.info(f"RAGPipeline initialised → Ollama/{self.gen_model} @ {settings.OLLAMA_BASE_URL}")

    # ------------------------------------------------------------------
    # Retrieval: hybrid (vector + BM25) candidates → cross-encoder rerank
    # ------------------------------------------------------------------

    def retrieve(self, question: str, top_k: int = 4, document_ids: Optional[List[str]] = None,
                 query_vector: Optional[List[float]] = None, candidates: Optional[int] = None,
                 use_reranker: Optional[bool] = None) -> Retrieved:
        if document_ids is not None and not document_ids:
            return []
        if query_vector is None:
            query_vector = self.embedding_service.embed_query(question)
        pool = vector_store.hybrid_search(
            query=question,
            query_vector=query_vector,
            candidates=max(candidates or settings.RETRIEVAL_CANDIDATES, top_k),
            document_ids=document_ids,
        )
        if not pool:
            return []

        use_reranker = settings.USE_RERANKER if use_reranker is None else use_reranker
        scores = reranker.rerank(question, [c for c, _ in pool]) if use_reranker else None
        if scores is None:
            return [(c, t["semantic_score"], t) for c, t in pool[:top_k]]

        ranked = sorted(((c, s, {**t, "rerank_score": round(s, 4)}) for (c, t), s in zip(pool, scores)),
                        key=lambda x: x[1], reverse=True)
        relevant = [(c, round(s, 4), t) for c, s, t in ranked if s >= settings.MIN_RELEVANCE]
        # Nothing relevant → empty, so the caller answers without (misleading) citations
        return relevant[:top_k]

    @staticmethod
    def citations_for(retrieved: Retrieved) -> List[Citation]:
        return [Citation(
            citation_id=f"cite-{idx}",
            document_name=chunk.filename,
            document_id=chunk.document_id,
            page_number=chunk.page_number,
            chunk_index=chunk.chunk_index,
            excerpt=chunk.text[:220].strip() + ("..." if len(chunk.text) > 220 else ""),
            similarity_score=score,
            context_snippet=chunk.text,
            semantic_rank=trace.get("semantic_rank"),
            keyword_rank=trace.get("keyword_rank"),
            fused_rank=trace.get("fused_rank"),
            rerank_score=trace.get("rerank_score"),
        ) for idx, (chunk, score, trace) in enumerate(retrieved, start=1)]

    @staticmethod
    def context_text(retrieved: Retrieved) -> str:
        return "\n".join(
            f"--- [Source #{i} | File: {c.filename} | Page: {c.page_number}] ---\n{c.text}\n"
            for i, (c, _, _) in enumerate(retrieved, start=1))

    def build_prompt(self, question: str, retrieved: Retrieved) -> str:
        system = CITATION_SYSTEM_PROMPT.format(catalog=library_catalog(), context_blocks=self.context_text(retrieved))
        return f"{system}\n\nUser Question: {question}\n\nAnswer with exact inline citations:"

    def scope(self, question: str, document_ids: Optional[List[str]] = None) -> Tuple[List[str], bool]:
        """
        Documents to search. A question naming a document ("the 1-2 pdf") searches only that document,
        because similarity search matches content, never file names. Returns (doc ids, named?).
        """
        allowed = document_ids_in_scope(document_ids)
        named = [d for d in documents_named_in(question) if d in allowed]
        return (named, True) if named else (allowed, False)

    def overview_chunks(self, document_ids: List[str], limit: int = 6) -> Retrieved:
        """Opening chunks of each named document, in reading order, for "what does it contain" questions."""
        per_doc = max(2, limit // max(1, len(document_ids)))
        out: Retrieved = []
        for d in document_ids:
            chunks = sorted(vector_store.get_document_chunks(d), key=lambda c: c.chunk_index)[:per_doc]
            out += [(c, 1.0, {"fused_rank": i + 1}) for i, c in enumerate(chunks)]
        return out[:limit]

    def retrieve_for(self, question: str, top_k: int = 4, document_ids: Optional[List[str]] = None,
                     query_vector: Optional[List[float]] = None) -> Retrieved:
        """retrieve() plus document-name scoping and overview handling. Used by every answer mode."""
        allowed, named = self.scope(question, document_ids)
        if named and OVERVIEW_RE.search(question):
            return self.overview_chunks(allowed, max(top_k, 6))
        return self.retrieve(question, top_k, allowed, query_vector=query_vector)

    def _prepare(self, question: str, top_k: int, document_ids: Optional[List[str]]):
        allowed, _ = self.scope(question, document_ids)
        qvec = self.embedding_service.embed_query(question)
        key = (tuple(sorted(allowed)), top_k)
        return allowed, qvec, key

    # ------------------------------------------------------------------
    # Blocking answer
    # ------------------------------------------------------------------

    def run_query(self, question: str, top_k: int = 4, document_ids: Optional[List[str]] = None,
                  custom_gemini_key: Optional[str] = None) -> QueryResponse:
        result = None
        for event in self.stream_query(question, top_k, document_ids, stream_tokens=False):
            if event["type"] == "done":
                result = event
        return QueryResponse(
            question=question, answer=result["answer"],
            citations=[Citation(**c) for c in result["citations"]],
            retrieved_chunks_count=result["retrieved_chunks_count"],
            processing_time_seconds=result["processing_time_seconds"],
            model_used=result["model_used"], vector_store_type=vector_store.store_type,
            cached=result.get("cached", False))

    # ------------------------------------------------------------------
    # Streaming answer: yields {"type": "citations"|"token"|"replace"|"done", ...}
    # ------------------------------------------------------------------

    def stream_query(self, question: str, top_k: int = 4, document_ids: Optional[List[str]] = None,
                     stream_tokens: bool = True) -> Iterator[Dict[str, Any]]:
        start_time = time.time()
        allowed, qvec, key = self._prepare(question, top_k, document_ids)
        vec = np.asarray(qvec, dtype=np.float32)

        hit = self.cache.lookup(vec, key)
        if hit:
            yield {"type": "citations", "citations": hit["citations"]}
            yield {"type": "token", "text": hit["answer"]}
            yield {"type": "done", "answer": hit["answer"], "citations": hit["citations"],
                   "retrieved_chunks_count": hit["retrieved_chunks_count"], "model_used": hit["model_used"],
                   "processing_time_seconds": round(time.time() - start_time, 3), "cached": True}
            return

        named = bool(documents_named_in(question))
        if CHAT_RE.search(question):
            retrieved, mode = [], MODE_CHAT
        elif LIBRARY_RE.search(question) and not named and not CONTENT_HINT_RE.search(question):
            retrieved, mode = [], MODE_LIBRARY
        else:
            retrieved = self.retrieve_for(question, top_k, allowed, query_vector=qvec)
            mode = None if retrieved else (MODE_GENERAL if settings.ALLOW_GENERAL_KNOWLEDGE else MODE_NOT_FOUND)

        if mode and not allowed and mode != MODE_CHAT:
            yield {"type": "token", "text": NOT_FOUND_ANSWER}
            yield {"type": "done", "answer": NOT_FOUND_ANSWER, "citations": [], "retrieved_chunks_count": 0,
                   "processing_time_seconds": round(time.time() - start_time, 3), "model_used": "none"}
            return

        cite_dicts = [c.model_dump() for c in self.citations_for(retrieved)]
        yield {"type": "citations", "citations": cite_dicts}

        prompt = (GENERAL_PROMPT.format(catalog=library_catalog(), mode_instruction=mode, question=question)
                  if mode else self.build_prompt(question, retrieved))
        parts: List[str] = []
        model_used, gen_error = self.gen_model, None
        try:
            if stream_tokens:
                for token in llm.stream(prompt, self.gen_model):
                    parts.append(token)
                    yield {"type": "token", "text": token}
            else:
                parts.append(llm.generate(prompt, self.gen_model))
        except Exception as exc:
            gen_error = str(exc)
            logger.error(f"Ollama generation failed: {exc}")

        answer = llm._clean("".join(parts))
        if not answer and not retrieved:
            answer = f"⚠️ The language model is unavailable right now ({gen_error or 'no response'}). Please try again shortly."
            model_used = "none"
            yield {"type": "replace", "text": answer}
        elif not answer:
            answer = self._fallback_answer_synthesis(question, retrieved, error_reason=gen_error)
            model_used = "local-extractive-fallback"
            yield {"type": "replace", "text": answer}
        else:
            self.cache.store(vec, key, {"answer": answer, "citations": cite_dicts,
                                        "retrieved_chunks_count": len(retrieved), "model_used": model_used})

        yield {"type": "done", "answer": answer, "citations": cite_dicts,
               "retrieved_chunks_count": len(retrieved),
               "processing_time_seconds": round(time.time() - start_time, 3), "model_used": model_used}

    def _fallback_answer_synthesis(self, question: str, retrieved: Retrieved,
                                   error_reason: Optional[str] = None) -> str:
        lines = [
            f"**Extracted Source Findings for:** *\"{question}\"*\n",
        ]

        if error_reason:
            lines.append(f"> ⚠️ **Ollama Notice**: `{error_reason}`\n")

        lines.append("Below are the top relevant excerpts retrieved directly from your indexed documents:\n")

        for idx, (chunk, score, _) in enumerate(retrieved, start=1):
            relevance_pct = int(score * 100)
            lines.append(f"### Source {idx}: {chunk.filename} (Page {chunk.page_number}) — Match: {relevance_pct}%")
            lines.append(f"> \"{chunk.text.strip()}\"\n")
            lines.append(f"*Citation: [Doc: {chunk.filename}, Page: {chunk.page_number}]*\n")

        return "\n".join(lines)

rag_pipeline = RAGPipeline()
