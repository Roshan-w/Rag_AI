import os
import json
import uuid
import logging
from datetime import datetime
from typing import List, Dict, Any
from fastapi import APIRouter, UploadFile, File, HTTPException, Query
from fastapi.concurrency import run_in_threadpool
from app.schemas.rag import DocumentMetadata, DocumentUploadResponse, DocumentSummary, ChunkItem
from app.core.document_parser import DocumentParser
from app.core.chunker import DocumentChunker
from app.core.embeddings import EmbeddingService
from app.core.vector_store import vector_store
from app.config import settings
from app.core.registry import DOCUMENT_REGISTRY, save_registry as _save_registry
from app.core.intelligence import insights_worker, forget_document

router = APIRouter(prefix="/documents", tags=["Documents"])

MAX_UPLOAD_BYTES = 50 * 1024 * 1024

def load_demo_documents():
    import logging
    logger = logging.getLogger("RAGApplication")
    demo_dir = os.path.join(os.getcwd(), "demo_data")
    if not os.path.exists(demo_dir):
        return
    
    files = [f for f in os.listdir(demo_dir) if f.endswith(".pdf")]
    if not files:
        return
        
    chunker = DocumentChunker(chunk_size=800, chunk_overlap=150)
    embedding_svc = EmbeddingService()
    
    logger.info(f"Loading {len(files)} demo documents from {demo_dir}...")
    for filename in files:
        # Check if already loaded by name to prevent duplicates if called multiple times
        if any(doc.filename == filename for doc in DOCUMENT_REGISTRY.values()):
            continue
            
        file_path = os.path.join(demo_dir, filename)
        doc_id = str(uuid.uuid4())[:8]
        try:
            with open(file_path, "rb") as f:
                content = f.read()
                
            pages, parser_meta = DocumentParser.parse_file(filename, content)
            chunks = chunker.chunk_document(
                document_id=doc_id,
                filename=filename,
                pages=pages,
                metadata=parser_meta
            )
            chunk_texts = [c.text for c in chunks]
            embeddings = embedding_svc.embed_texts(chunk_texts)
            vector_store.upsert_chunks(chunks, embeddings)
            
            doc_meta = DocumentMetadata(
                document_id=doc_id,
                filename=filename,
                file_type="pdf",
                file_size=len(content),
                total_pages=len(pages),
                total_chunks=len(chunks),
                uploaded_at=datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
            )
            DOCUMENT_REGISTRY[doc_id] = doc_meta
            logger.info(f"Auto-loaded demo doc: {filename} ({len(chunks)} chunks)")
        except Exception as e:
            logger.error(f"Failed to auto-load {filename}: {e}")
    _save_registry()

def format_file_size(size_in_bytes: int) -> str:
    if size_in_bytes < 1024:
        return f"{size_in_bytes} B"
    elif size_in_bytes < 1024 * 1024:
        return f"{round(size_in_bytes / 1024, 1)} KB"
    else:
        return f"{round(size_in_bytes / (1024 * 1024), 2)} MB"

def index_document(filename: str, content: bytes, chunker: DocumentChunker = None, embedding_svc: EmbeddingService = None,
                   doc_id: str = None) -> DocumentMetadata:
    """Parse → chunk → embed → index → register. Shared by web uploads and the Telegram bot."""
    if not content:
        raise ValueError("Uploaded file is empty.")
    if len(content) > MAX_UPLOAD_BYTES:
        raise ValueError(f"File exceeds the {MAX_UPLOAD_BYTES // (1024 * 1024)} MB upload limit.")
    chunker = chunker or DocumentChunker(chunk_size=800, chunk_overlap=150)
    embedding_svc = embedding_svc or EmbeddingService()
    doc_id = doc_id or str(uuid.uuid4())[:8]

    pages, parser_meta = DocumentParser.parse_file(filename, content)
    chunks = chunker.chunk_document(document_id=doc_id, filename=filename, pages=pages, metadata=parser_meta)
    embeddings = embedding_svc.embed_texts([c.text for c in chunks])
    vector_store.upsert_chunks(chunks, embeddings)

    doc_meta = DocumentMetadata(
        document_id=doc_id,
        filename=filename,
        file_type=parser_meta.get("file_type", "unknown"),
        file_size=len(content),
        total_pages=len(pages),
        total_chunks=len(chunks),
        uploaded_at=datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    )
    DOCUMENT_REGISTRY[doc_id] = doc_meta
    _save_registry()
    insights_worker.enqueue(doc_id)
    return doc_meta


@router.post("/upload", response_model=List[DocumentUploadResponse])
async def upload_documents(
    files: List[UploadFile] = File(...),
    chunk_size: int = Query(default=800, ge=200, le=3000),
    chunk_overlap: int = Query(default=150, ge=0, le=800)
):
    """
    Upload one or multiple documents (PDF, DOCX, TXT, MD).
    Parses, chunks, embeds, and indexes them with full metadata.
    """
    if not files:
        raise HTTPException(status_code=400, detail="No files uploaded.")

    responses: List[DocumentUploadResponse] = []
    chunker = DocumentChunker(chunk_size=chunk_size, chunk_overlap=chunk_overlap)
    embedding_svc = EmbeddingService()

    for file in files:
        filename = file.filename or "uploaded_document"
        doc_id = str(uuid.uuid4())[:8]

        try:
            content = await file.read()

            # Run off the event loop so other users' requests keep being served while indexing
            doc_meta = await run_in_threadpool(index_document, filename, content, chunker, embedding_svc, doc_id)
            chunks_count, pages_count = doc_meta.total_chunks, doc_meta.total_pages

            responses.append(DocumentUploadResponse(
                success=True,
                message=f"Indexed '{filename}' successfully ({chunks_count} chunks across {pages_count} pages).",
                document=doc_meta,
                chunks_created=chunks_count
            ))
        except Exception as e:
            responses.append(DocumentUploadResponse(
                success=False,
                message=f"Failed to process '{filename}': {str(e)}",
                document=DocumentMetadata(
                    document_id=doc_id,
                    filename=filename,
                    file_type=os.path.splitext(filename)[1].lstrip("."),
                    file_size=0,
                    total_pages=0,
                    total_chunks=0,
                    uploaded_at=datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
                ),
                chunks_created=0
            ))

    return responses

@router.get("", response_model=List[DocumentSummary])
async def list_documents():
    """
    Returns list of all active indexed documents.
    """
    summaries = []
    for doc in DOCUMENT_REGISTRY.values():
        summaries.append(DocumentSummary(
            document_id=doc.document_id,
            filename=doc.filename,
            file_type=doc.file_type,
            file_size_formatted=format_file_size(doc.file_size),
            total_pages=doc.total_pages,
            total_chunks=doc.total_chunks,
            uploaded_at=doc.uploaded_at
        ))
    return summaries

@router.get("/{document_id}/chunks", response_model=List[ChunkItem])
async def get_document_chunks(document_id: str):
    """
    Inspect all chunk items and metadata belonging to a specific document.
    """
    if document_id not in DOCUMENT_REGISTRY:
        raise HTTPException(status_code=404, detail="Document not found.")
    chunks = vector_store.get_document_chunks(document_id)
    return chunks

@router.delete("/{document_id}")
async def delete_document(document_id: str):
    """
    Deletes a document and clears its vector embeddings from the index.
    """
    if document_id not in DOCUMENT_REGISTRY:
        raise HTTPException(status_code=404, detail="Document not found.")
    
    doc = DOCUMENT_REGISTRY.pop(document_id)
    vector_store.delete_document(document_id)
    _save_registry()
    forget_document(document_id)
    return {"success": True, "message": f"Document '{doc.filename}' deleted successfully."}

@router.delete("")
async def clear_all_documents():
    """
    Clears all documents and resets the vector store index.
    """
    doc_ids = list(DOCUMENT_REGISTRY.keys())
    for did in doc_ids:
        vector_store.delete_document(did)
        forget_document(did)
    DOCUMENT_REGISTRY.clear()
    _save_registry()
    return {"success": True, "message": f"Cleared {len(doc_ids)} documents."}
