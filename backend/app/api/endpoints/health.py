import os
from fastapi import APIRouter
from app.schemas.rag import HealthStatus
from app.core.vector_store import vector_store
from app.config import settings

router = APIRouter(prefix="/health", tags=["Health"])

@router.get("", response_model=HealthStatus)
async def check_health():
    stats = vector_store.get_stats()
    gemini_key = settings.GEMINI_API_KEY or os.getenv("GEMINI_API_KEY", "")
    pinecone_key = settings.PINECONE_API_KEY or os.getenv("PINECONE_API_KEY", "")

    return HealthStatus(
        status="healthy",
        gemini_configured=bool(gemini_key),
        pinecone_configured=bool(pinecone_key),
        active_vector_store=vector_store.store_type,
        indexed_documents_count=stats["total_documents"],
        indexed_chunks_count=stats["total_chunks"],
        version="1.0.0"
    )
