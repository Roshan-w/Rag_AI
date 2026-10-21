import os
import sys

# Ensure backend root is in sys.path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.document_parser import DocumentParser
from app.core.chunker import DocumentChunker
from app.core.embeddings import EmbeddingService
from app.core.vector_store import vector_store
from app.core.rag_pipeline import rag_pipeline

def test_full_rag_pipeline():
    print("\n--- Starting Full Multi-Document RAG Integration Test ---\n")

    sample_doc_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "sample_documents", "Fintech_Annual_Report_2025.txt")
    
    with open(sample_doc_path, "rb") as f:
        file_bytes = f.read()

    filename = "Fintech_Annual_Report_2025.txt"

    # Step 1: Parsing
    print(f"1. Parsing {filename}...")
    pages, meta = DocumentParser.parse_file(filename, file_bytes)
    assert len(pages) > 0, "Pages extraction failed"
    print(f"   Extracted {len(pages)} pages.")

    # Step 2: Chunking
    print("2. Chunking document...")
    chunker = DocumentChunker(chunk_size=400, chunk_overlap=80)
    chunks = chunker.chunk_document("doc-test-1", filename, pages, meta)
    assert len(chunks) > 0, "Chunking produced 0 chunks"
    print(f"   Created {len(chunks)} chunks with metadata.")

    # Step 3: Embeddings & Vector Store Upsert
    print("3. Generating embeddings & upserting...")
    emb_service = EmbeddingService()
    chunk_texts = [c.text for c in chunks]
    embeddings = emb_service.embed_texts(chunk_texts)
    assert len(embeddings) == len(chunks), "Embedding count mismatch"
    
    vector_store.upsert_chunks(chunks, embeddings)
    stats = vector_store.get_stats()
    print(f"   Vector Store stats: {stats}")

    # Step 4: Similarity Retrieval
    question = "What was the total revenue in FY2025 and what was the operating margin?"
    print(f"4. Running query: '{question}'...")
    response = rag_pipeline.run_query(question, top_k=3)
    
    print("\n--- Query Response ---")
    print(f"Model Used: {response.model_used}")
    print(f"Processing Time: {response.processing_time_seconds}s")
    print(f"Retrieved Chunks: {response.retrieved_chunks_count}")
    print(f"Citations Count: {len(response.citations)}")
    print(f"Answer Preview:\n{response.answer[:300]}...\n")

    for i, cite in enumerate(response.citations, 1):
        print(f"Citation #{i}: {cite.document_name} (Page {cite.page_number}) - Score: {cite.similarity_score}")
        print(f"Excerpt: {cite.excerpt}\n")

    assert response.retrieved_chunks_count > 0, "No chunks retrieved"
    print(" Full Multi-Document RAG Integration Test Passed Successfully!\n")

if __name__ == "__main__":
    test_full_rag_pipeline()
