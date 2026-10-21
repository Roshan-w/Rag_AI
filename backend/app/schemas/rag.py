from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field
from datetime import datetime

class DocumentMetadata(BaseModel):
    document_id: str
    filename: str
    file_type: str
    file_size: int
    total_pages: int
    total_chunks: int
    uploaded_at: str

class ChunkItem(BaseModel):
    chunk_id: str
    document_id: str
    filename: str
    page_number: int
    chunk_index: int
    text: str
    char_start: Optional[int] = 0
    char_end: Optional[int] = 0
    metadata: Optional[Dict[str, Any]] = None

class DocumentUploadResponse(BaseModel):
    success: bool
    message: str
    document: DocumentMetadata
    chunks_created: int

class Citation(BaseModel):
    citation_id: str
    document_name: str
    document_id: str
    page_number: int
    chunk_index: int
    excerpt: str
    similarity_score: float = Field(default=0.0, description="Relevance score (0 to 1)")
    context_snippet: Optional[str] = None
    # Retrieval trace ("Why this answer?")
    semantic_rank: Optional[int] = None
    keyword_rank: Optional[int] = None
    fused_rank: Optional[int] = None
    rerank_score: Optional[float] = None

class QueryRequest(BaseModel):
    question: str
    top_k: Optional[int] = 4
    document_ids: Optional[List[str]] = None
    gemini_api_key: Optional[str] = None
    pinecone_api_key: Optional[str] = None

class QueryResponse(BaseModel):
    question: str
    answer: str
    citations: List[Citation]
    retrieved_chunks_count: int
    processing_time_seconds: float
    model_used: str
    vector_store_type: str
    cached: bool = False

class DocumentSummary(BaseModel):
    document_id: str
    filename: str
    file_type: str
    file_size_formatted: str
    total_pages: int
    total_chunks: int
    uploaded_at: str

class HealthStatus(BaseModel):
    status: str
    gemini_configured: bool
    pinecone_configured: bool
    active_vector_store: str
    indexed_documents_count: int
    indexed_chunks_count: int
    version: str = "1.0.0"
