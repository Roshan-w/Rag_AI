"""
Features layered on top of the core RAG pipeline:
  • Answer audit (claim-by-claim faithfulness check)
  • Per-document insights: summary, FAQ, quiz, entities/relations (knowledge graph), dated events
  • Cross-document contradiction detection
  • Timeline answers
  • Multi-model jury
Insights and conflicts are computed in a background worker after upload and persisted to disk.
"""
import os
import json
import queue
import logging
import threading
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, List, Optional
import numpy as np
from app.config import settings
from app.core import llm
from app.core.vector_store import vector_store
from app.core.registry import DOCUMENT_REGISTRY, document_ids_in_scope
from app.core.rag_pipeline import rag_pipeline

logger = logging.getLogger(__name__)

INSIGHTS_DIR = os.path.join(settings.INDEX_DIR, "insights")
CONFLICTS_FILE = os.path.join(settings.INDEX_DIR, "conflicts.json")
_io_lock = threading.Lock()


def _write_json(path: str, data: Any):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    os.replace(tmp, path)


def _read_json(path: str, default: Any) -> Any:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def _numbered_sources(citations: List[Dict[str, Any]]) -> str:
    return "\n".join(
        f"[{i}] ({c['document_name']}, page {c['page_number']}): {c.get('context_snippet') or c['excerpt']}"
        for i, c in enumerate(citations, start=1))


# ----------------------------------------------------------------------
# Answer audit
# ----------------------------------------------------------------------

AUDIT_PROMPT = """You are a strict fact-checker. Split the ANSWER into its individual factual claims
(ignore headings, filler and citation markers). For each claim decide, using ONLY the SOURCES:
- "supported": the sources state it
- "partial": the sources state part of it, or it is a loose paraphrase
- "unsupported": the sources do not state it

SOURCES:
{sources}

ANSWER:
{answer}

Return JSON exactly like:
{{"claims": [{{"claim": "...", "verdict": "supported|partial|unsupported", "source": <source number or null>, "evidence": "short exact quote from that source, or empty"}}]}}"""

REVISE_PROMPT = """Rewrite the ANSWER so it keeps only the facts in SUPPORTED CLAIMS. Keep the Markdown style and keep
inline citations in the form [Doc: <filename>, Page: <page>]. If nothing is left, say
"The provided documents do not contain this information."

SUPPORTED CLAIMS:
{claims}

ANSWER:
{answer}

Revised answer:"""


def audit_answer(answer: str, citations: List[Dict[str, Any]]) -> Dict[str, Any]:
    if not citations:
        return {"claims": [], "faithfulness": 0.0, "revised_answer": None}
    data = llm.generate_json(AUDIT_PROMPT.format(sources=_numbered_sources(citations), answer=answer)) or {}
    claims = []
    for c in data.get("claims", []) if isinstance(data, dict) else []:
        if not isinstance(c, dict) or not str(c.get("claim", "")).strip():
            continue
        verdict = c.get("verdict") if c.get("verdict") in ("supported", "partial", "unsupported") else "unsupported"
        src = c.get("source")
        cite = citations[src - 1] if isinstance(src, int) and 1 <= src <= len(citations) else None
        claims.append({
            "claim": str(c["claim"]).strip(),
            "verdict": verdict,
            "evidence": str(c.get("evidence") or "").strip(),
            "document_name": cite["document_name"] if cite else None,
            "page_number": cite["page_number"] if cite else None,
        })
    if not claims:
        return {"claims": [], "faithfulness": None, "revised_answer": None}

    weight = {"supported": 1.0, "partial": 0.5, "unsupported": 0.0}
    score = round(sum(weight[c["verdict"]] for c in claims) / len(claims), 3)

    revised = None
    if any(c["verdict"] == "unsupported" for c in claims):
        kept = [c["claim"] + (f" [Doc: {c['document_name']}, Page: {c['page_number']}]" if c["document_name"] else "")
                for c in claims if c["verdict"] != "unsupported"]
        try:
            revised = llm.generate(REVISE_PROMPT.format(claims="\n".join(f"- {k}" for k in kept) or "(none)",
                                                        answer=answer))
        except Exception as exc:
            logger.warning(f"Answer revision failed: {exc}")
    return {"claims": claims, "faithfulness": score, "revised_answer": revised}


# ----------------------------------------------------------------------
# Per-document insights (background)
# ----------------------------------------------------------------------

STUDY_PROMPT = """You are preparing a study guide for the document "{filename}". Use ONLY its text below.

TEXT:
{text}

Return JSON exactly like:
{{"summary": "one paragraph, 3-5 sentences",
  "faq": ["question a student is likely to ask, answerable from the text", "... (5 to 8 items)"],
  "quiz": [{{"question": "...", "options": ["A", "B", "C", "D"], "answer_index": 0, "page": <page number>}}]}}
Give 4 to 6 quiz questions. Every question must be answerable from the text."""

GRAPH_PROMPT = """Extract a knowledge graph and dated events from the document "{filename}". Use ONLY its text below.
Pages are marked like [Page 3].

TEXT:
{text}

Return JSON exactly like:
{{"entities": [{{"name": "...", "type": "programme|fee|deadline|department|rule|person|organisation|document|other"}}],
  "relations": [{{"source": "<entity name>", "target": "<entity name>", "label": "short verb phrase"}}],
  "events": [{{"date": "date as written", "sort_key": "YYYY-MM-DD or YYYY-MM or YYYY, empty if unknown", "event": "what happens", "page": <page number>}}]}}
Up to 25 entities and 30 relations. Only include events with a concrete date or year."""

CONFLICT_PROMPT = """Two passages come from different documents. Do they CONTRADICT each other on a concrete fact
(a different amount, date, deadline, eligibility rule or requirement for the same thing)?
Passages that merely cover different topics, or one adds detail the other lacks, are NOT contradictions.

PASSAGE A ({doc_a}, page {page_a}):
{text_a}

PASSAGE B ({doc_b}, page {page_b}):
{text_b}

Return JSON exactly like:
{{"conflict": true or false, "topic": "what the disagreement is about", "explanation": "one sentence quoting both values"}}"""


def _doc_text(document_id: str, limit: int = 14000) -> str:
    chunks = sorted(vector_store.get_document_chunks(document_id), key=lambda c: c.chunk_index)
    out, page = [], None
    for c in chunks:
        if c.page_number != page:
            page = c.page_number
            out.append(f"\n[Page {page}]")
        out.append(c.text)
    return "\n".join(out)[:limit]


def is_question(text: Any) -> bool:
    """The FAQ generator occasionally emits answers ("Answer: ...") instead of questions; keep real questions only."""
    return isinstance(text, str) and text.strip().endswith("?") and not text.strip().lower().startswith("answer")


def insights_path(document_id: str) -> str:
    return os.path.join(INSIGHTS_DIR, f"{document_id}.json")


def get_insights(document_id: str) -> Dict[str, Any]:
    return _read_json(insights_path(document_id), {"status": "missing"})


def _detect_conflicts(document_id: str) -> List[Dict[str, Any]]:
    """Pair each chunk with its nearest chunk in every other document, then let the LLM judge the closest pairs."""
    own = vector_store.get_document_chunks(document_id)
    others = [c for c in vector_store.all_chunks() if c.document_id != document_id]
    if not own or not others:
        return []
    other_mat = np.stack([vector_store.embedding_of(c.chunk_id) for c in others])
    pairs = []
    for c in own:
        sims = other_mat @ vector_store.embedding_of(c.chunk_id)
        j = int(np.argmax(sims))
        if sims[j] >= 0.6:
            pairs.append((float(sims[j]), c, others[j]))
    pairs.sort(key=lambda p: p[0], reverse=True)

    found = []
    for sim, a, b in pairs[:6]:
        verdict = llm.generate_json(CONFLICT_PROMPT.format(
            doc_a=a.filename, page_a=a.page_number, text_a=a.text,
            doc_b=b.filename, page_b=b.page_number, text_b=b.text)) or {}
        if verdict.get("conflict") is True:
            found.append({
                # Order-independent id so A-vs-B and B-vs-A are the same conflict
                "id": "__".join(sorted((a.chunk_id, b.chunk_id))),
                "topic": str(verdict.get("topic", "")).strip(),
                "explanation": str(verdict.get("explanation", "")).strip(),
                "a": {"document_id": a.document_id, "document_name": a.filename, "page_number": a.page_number, "text": a.text},
                "b": {"document_id": b.document_id, "document_name": b.filename, "page_number": b.page_number, "text": b.text},
                "similarity": round(sim, 3),
            })
    return found


def _process_document(document_id: str):
    doc = DOCUMENT_REGISTRY.get(document_id)
    if not doc:
        return
    _write_json(insights_path(document_id), {"status": "processing", "document_id": document_id})
    text = _doc_text(document_id)
    study = llm.generate_json(STUDY_PROMPT.format(filename=doc.filename, text=text)) or {}
    graph = llm.generate_json(GRAPH_PROMPT.format(filename=doc.filename, text=text)) or {}

    if document_id not in DOCUMENT_REGISTRY:  # deleted while we were working
        return
    _write_json(insights_path(document_id), {
        "status": "ready",
        "document_id": document_id,
        "filename": doc.filename,
        "summary": str(study.get("summary", "")).strip(),
        "faq": [q.strip() for q in study.get("faq", []) if is_question(q)][:8],
        "quiz": [q for q in study.get("quiz", []) if isinstance(q, dict) and isinstance(q.get("options"), list)
                 and isinstance(q.get("answer_index"), int) and 0 <= q["answer_index"] < len(q["options"])][:6],
        "entities": [e for e in graph.get("entities", []) if isinstance(e, dict) and e.get("name")][:25],
        "relations": [r for r in graph.get("relations", []) if isinstance(r, dict) and r.get("source") and r.get("target")][:30],
        "events": [e for e in graph.get("events", []) if isinstance(e, dict) and e.get("event")][:30],
    })

    new_conflicts = _detect_conflicts(document_id)
    with _io_lock:
        merged: Dict[str, Dict[str, Any]] = {}
        for c in _read_json(CONFLICTS_FILE, []) + new_conflicts:
            if c["a"]["document_id"] in DOCUMENT_REGISTRY and c["b"]["document_id"] in DOCUMENT_REGISTRY:
                merged.setdefault("__".join(sorted(c["id"].split("__"))), c)
        _write_json(CONFLICTS_FILE, list(merged.values()))
    logger.info(f"Insights ready for {doc.filename} ({len(new_conflicts)} conflicts)")


class InsightsWorker:
    """Single background thread so insight generation never competes with itself for the GPU."""

    def __init__(self):
        self._queue: "queue.Queue[str]" = queue.Queue()
        self._started = False

    def start(self):
        if self._started:
            return
        self._started = True
        threading.Thread(target=self._run, daemon=True, name="insights-worker").start()
        # Catch up on documents indexed before this feature existed (or interrupted by a restart)
        for doc_id in list(DOCUMENT_REGISTRY):
            if get_insights(doc_id).get("status") != "ready":
                self.enqueue(doc_id)

    def enqueue(self, document_id: str):
        self._queue.put(document_id)

    def _run(self):
        while True:
            doc_id = self._queue.get()
            try:
                _process_document(doc_id)
            except Exception as exc:
                logger.error(f"Insight generation failed for {doc_id}: {exc}")
                _write_json(insights_path(doc_id), {"status": "failed", "document_id": doc_id, "error": str(exc)})


insights_worker = InsightsWorker()


def forget_document(document_id: str):
    try:
        os.remove(insights_path(document_id))
    except FileNotFoundError:
        pass
    with _io_lock:
        conflicts = _read_json(CONFLICTS_FILE, [])
        _write_json(CONFLICTS_FILE, [c for c in conflicts if document_id not in
                                     (c["a"]["document_id"], c["b"]["document_id"])])


def list_conflicts() -> List[Dict[str, Any]]:
    visible = set(document_ids_in_scope())
    return [c for c in _read_json(CONFLICTS_FILE, [])
            if c["a"]["document_id"] in visible and c["b"]["document_id"] in visible]


def knowledge_graph() -> Dict[str, Any]:
    nodes: Dict[str, Dict[str, Any]] = {}
    edges: List[Dict[str, Any]] = []

    def node(name: str, ntype: str, doc) -> str:
        key = name.strip().lower()
        n = nodes.setdefault(key, {"id": key, "label": name.strip(), "type": ntype or "other", "documents": []})
        if doc.filename not in n["documents"]:
            n["documents"].append(doc.filename)
        return key

    for doc_id in document_ids_in_scope():
        ins = get_insights(doc_id)
        doc = DOCUMENT_REGISTRY.get(doc_id)
        if ins.get("status") != "ready" or not doc:
            continue
        types = {e["name"].strip().lower(): e.get("type", "other") for e in ins.get("entities", [])}
        for e in ins.get("entities", []):
            node(e["name"], e.get("type", "other"), doc)
        for r in ins.get("relations", []):
            s = node(str(r["source"]), types.get(str(r["source"]).strip().lower(), "other"), doc)
            t = node(str(r["target"]), types.get(str(r["target"]).strip().lower(), "other"), doc)
            if s != t:
                edges.append({"source": s, "target": t, "label": str(r.get("label", "")), "document": doc.filename})
    return {"nodes": list(nodes.values()), "edges": edges}


# ----------------------------------------------------------------------
# Timeline answers
# ----------------------------------------------------------------------

TIMELINE_PROMPT = """From the SOURCES, list every dated fact relevant to the QUESTION, in chronological order.
Use ONLY the sources. Skip facts without a date, month or year.

QUESTION: {question}

SOURCES:
{sources}

Return JSON exactly like:
{{"title": "short title for the timeline",
  "events": [{{"date": "date as written", "sort_key": "YYYY-MM-DD, YYYY-MM or YYYY", "event": "what happens", "source": <source number>}}]}}"""


def timeline(question: str) -> Dict[str, Any]:
    retrieved = rag_pipeline.retrieve_for(question, top_k=8)
    citations = [c.model_dump() for c in rag_pipeline.citations_for(retrieved)]
    if not citations:
        return {"title": question, "events": [], "citations": []}
    data = llm.generate_json(TIMELINE_PROMPT.format(question=question, sources=_numbered_sources(citations))) or {}
    events = []
    for e in data.get("events", []) if isinstance(data, dict) else []:
        if not isinstance(e, dict) or not e.get("event"):
            continue
        src = e.get("source")
        cite = citations[src - 1] if isinstance(src, int) and 1 <= src <= len(citations) else None
        events.append({"date": str(e.get("date", "")), "sort_key": str(e.get("sort_key", "")),
                       "event": str(e["event"]), "document_name": cite["document_name"] if cite else None,
                       "page_number": cite["page_number"] if cite else None})
    events.sort(key=lambda e: e["sort_key"] or "9999")
    return {"title": data.get("title") or question, "events": events, "citations": citations}


# ----------------------------------------------------------------------
# Multi-model jury
# ----------------------------------------------------------------------

JUDGE_PROMPT = """Several AI models answered the same QUESTION from the same sources. Compare their answers.

QUESTION: {question}

{answers}

Return JSON exactly like:
{{"agreement": "high|medium|low", "score": <0-100, how much the answers agree on the facts>,
  "consensus": "the facts all answers agree on, in 1-3 sentences, with [Doc: <filename>, Page: <page>] citations",
  "differences": ["each concrete point where the answers disagree"]}}"""


def jury(question: str, top_k: int = 4) -> Dict[str, Any]:
    retrieved = rag_pipeline.retrieve_for(question, top_k=top_k)
    citations = [c.model_dump() for c in rag_pipeline.citations_for(retrieved)]
    if not retrieved:
        return {"verdicts": [], "agreement": None, "citations": []}
    prompt = rag_pipeline.build_prompt(question, retrieved)

    def ask(model: str) -> Dict[str, Any]:
        try:
            return {"model": model, "answer": llm.generate(prompt, model)}
        except Exception as exc:
            return {"model": model, "answer": "", "error": str(exc)}

    with ThreadPoolExecutor(max_workers=len(settings.JURY_MODELS)) as pool:
        verdicts = list(pool.map(ask, settings.JURY_MODELS))

    answered = [v for v in verdicts if v["answer"]]
    agreement = None
    if len(answered) >= 2:
        block = "\n\n".join(f"ANSWER FROM {v['model']}:\n{v['answer']}" for v in answered)
        agreement = llm.generate_json(JUDGE_PROMPT.format(question=question, answers=block))
    return {"verdicts": verdicts, "agreement": agreement, "citations": citations}
