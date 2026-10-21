import json
import time
from typing import Any, Dict, List
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from app.schemas.rag import QueryRequest, QueryResponse
from app.core.rag_pipeline import rag_pipeline
from app.api.endpoints.chat import get_chat_history_list, save_chat_history_list

router = APIRouter(prefix="/query", tags=["Query"])


def _record_exchange(question: str, answer: str, citations: List[Dict[str, Any]],
                     processing_time: float, chunks_count: int, model_used: str):
    history = get_chat_history_list()
    timestamp = time.strftime('%I:%M %p')
    now_ms = int(time.time() * 1000)
    history.append({
        "id": f"user-{now_ms}",
        "sender": "user",
        "content": question,
        "timestamp": timestamp
    })
    history.append({
        "id": f"assistant-{now_ms + 1}",
        "sender": "assistant",
        "content": answer,
        "timestamp": timestamp,
        "citations": citations,
        "processingTime": processing_time,
        "retrievedChunksCount": chunks_count,
        "modelUsed": model_used,
        "question": question
    })
    save_chat_history_list(history)


@router.post("/ask", response_model=QueryResponse)
def ask_question(request: QueryRequest):
    """
    Asks a natural language question across indexed documents.
    Retrieves top-k relevant chunks with similarity scoring and synthesizes
    a grounded answer with source citations.
    """
    if not request.question or not request.question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty.")

    try:
        response = rag_pipeline.run_query(
            question=request.question.strip(),
            top_k=request.top_k or 4,
            document_ids=request.document_ids,
            custom_gemini_key=request.gemini_api_key
        )
        _record_exchange(request.question.strip(), response.answer,
                         [c.model_dump() for c in response.citations],
                         response.processing_time_seconds, response.retrieved_chunks_count, response.model_used)
        return response
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to process query: {str(e)}")


@router.post("/stream")
def stream_question(request: QueryRequest):
    """
    Same as /ask, but streams the answer as newline-delimited JSON events:
    {"type":"citations"} first, then {"type":"token"} per generated piece, then {"type":"done"}.
    """
    question = (request.question or "").strip()
    if not question:
        raise HTTPException(status_code=400, detail="Question cannot be empty.")

    def events():
        try:
            for event in rag_pipeline.stream_query(question, request.top_k or 4, request.document_ids):
                if event["type"] == "done":
                    _record_exchange(question, event["answer"], event["citations"],
                                     event["processing_time_seconds"], event["retrieved_chunks_count"],
                                     event["model_used"])
                yield json.dumps(event) + "\n"
        except Exception as e:
            yield json.dumps({"type": "error", "detail": f"Failed to process query: {e}"}) + "\n"

    return StreamingResponse(events(), media_type="application/x-ndjson",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
