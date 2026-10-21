import os
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, HTTPException, UploadFile, File, Query
from pydantic import BaseModel
from app.core import intelligence, evaluation, voice
from app.core.registry import DOCUMENT_REGISTRY, document_ids_in_scope

router = APIRouter(tags=["Intelligence"])


class AuditRequest(BaseModel):
    answer: str
    citations: List[Dict[str, Any]]


class QuestionRequest(BaseModel):
    question: str


class FeedbackRequest(BaseModel):
    question: str
    answer: str
    rating: int  # 1 = 👍, -1 = 👎
    sources: List[Dict[str, Any]] = []
    comment: Optional[str] = None


def _need_question(q: str) -> str:
    q = (q or "").strip()
    if not q:
        raise HTTPException(status_code=400, detail="Question cannot be empty.")
    return q


# ── Answer audit ─────────────────────────────────────────────────────

@router.post("/intel/audit")
def audit(req: AuditRequest):
    return intelligence.audit_answer(req.answer, req.citations)


# ── Document insights, conflicts, graph ──────────────────────────────

@router.get("/intel/insights")
def list_insights():
    out = []
    for doc_id in document_ids_in_scope():
        doc = DOCUMENT_REGISTRY[doc_id]
        ins = intelligence.get_insights(doc_id)
        out.append({**ins, "document_id": doc_id, "filename": doc.filename})
    return out


@router.get("/intel/suggestions")
def suggestions(limit: int = Query(6, ge=1, le=20)):
    """Auto-generated FAQ questions, interleaved across documents, for the empty chat state."""
    lists = [[q for q in intelligence.get_insights(d).get("faq", []) if intelligence.is_question(q)]
             for d in document_ids_in_scope()]
    out, i = [], 0
    while len(out) < limit and any(i < len(l) for l in lists):
        out += [l[i] for l in lists if i < len(l)]
        i += 1
    return out[:limit]


@router.get("/intel/conflicts")
def conflicts():
    return intelligence.list_conflicts()


@router.get("/intel/graph")
def graph():
    return intelligence.knowledge_graph()


# ── Timeline & jury ──────────────────────────────────────────────────

@router.post("/intel/timeline")
def timeline(req: QuestionRequest):
    return intelligence.timeline(_need_question(req.question))


@router.post("/intel/jury")
def jury(req: QuestionRequest):
    return intelligence.jury(_need_question(req.question))


# ── Feedback & self-tuning evaluation ────────────────────────────────

@router.post("/feedback")
def feedback(req: FeedbackRequest):
    if req.rating not in (1, -1):
        raise HTTPException(status_code=400, detail="rating must be 1 or -1")
    evaluation.record_feedback(req.model_dump())
    return {"success": True}


@router.get("/eval/report")
def eval_report():
    return evaluation.latest_report()


@router.post("/eval/run")
def eval_run():
    return evaluation.run_evaluation(apply=True)


# ── Voice ────────────────────────────────────────────────────────────

@router.post("/voice/transcribe")
def transcribe(audio: UploadFile = File(...)):
    data = audio.file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty audio.")
    if len(data) > 25 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Audio too long.")
    suffix = os.path.splitext(audio.filename or "")[1] or ".webm"
    try:
        return voice.transcribe(data, suffix)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Transcription failed: {e}")
