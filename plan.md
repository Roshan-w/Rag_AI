# Multi-Document RAG System with Source Citations

## Project Overview
A Retrieval-Augmented Generation (RAG) system that allows users to upload multiple documents (PDFs, DOCX, TXT) and ask natural-language questions across all of them. Every answer includes a citation showing which document and page/section the information came from, so answers are traceable and verifiable rather than generic LLM guesses.

## Problem Statement
General AI chatbots (ChatGPT, Claude, Gemini) can't reliably answer questions across large private document sets — they hit context window limits, don't persist data across sessions, and reprocess entire files on every query, which is costly. This project builds the retrieval infrastructure (chunking, embeddings, vector search, ranked retrieval) that lets an application query thousands of pages efficiently, cite exact sources, and scale to multiple users through an API — something a one-off file upload to a chatbot cannot do.

## Tech Stack
| Layer | Technology |
|---|---|
| Backend | FastAPI (Python) |
| RAG Orchestration | LangChain |
| Vector Database | Pinecone |
| LLM (Generation) | Gemini API |
| Embeddings | Gemini Embeddings API (or `text-embedding-004`) |
| Frontend | React (Vite) |
| File Parsing | PyPDF2 / pdfplumber, python-docx |
| Deployment | Backend: Render, Frontend: Vercel |

## Core Features
1. **Multi-document upload** — support PDF, DOCX, and TXT files, multiple files at once.
2. **Chunking & embedding pipeline** — split documents into overlapping chunks, tag each chunk with metadata (filename, page number, chunk index).
3. **Vector storage in Pinecone** — store embeddings with metadata so retrieval results carry source information.
4. **Query interface** — user asks a question in natural language.
5. **Retrieval + ranking** — fetch top-k relevant chunks across all uploaded documents using similarity search.
6. **Answer generation with citations** — Gemini generates an answer using only retrieved chunks, and the response includes which document(s) and page(s) supported the answer.
7. **Source viewer** — clicking a citation shows the exact excerpt/chunk it came from.
8. **Chat history per session** (optional stretch goal).

## Architecture Flow
```
User uploads documents (React)
        ↓
FastAPI receives files → parses text → chunks text
        ↓
LangChain generates embeddings (Gemini Embeddings)
        ↓
Chunks + metadata stored in Pinecone (vector DB)
        ↓
User asks a question (React → FastAPI)
        ↓
Query embedded → Pinecone similarity search → top-k chunks retrieved
        ↓
LangChain builds prompt with retrieved chunks + question
        ↓
Gemini API generates grounded answer
        ↓
FastAPI returns answer + source citations (doc name, page, excerpt)
        ↓
React displays answer with clickable citations
```

## Milestones / Build Order
1. **Setup** — FastAPI project structure, Pinecone account + index, Gemini API key.
2. **File ingestion** — upload endpoint, text extraction from PDF/DOCX.
3. **Chunking strategy** — implement chunk size + overlap, attach metadata (source, page number).
4. **Embedding + storage** — generate embeddings via Gemini, upsert into Pinecone with metadata.
5. **Retrieval endpoint** — given a query, embed it and fetch top-k matches from Pinecone.
6. **Generation with citation prompt** — LangChain prompt template instructing Gemini to answer strictly from context and reference source metadata.
7. **API integration** — `/upload` and `/ask` endpoints tested via Postman/Swagger.
8. **React frontend** — upload UI, chat/question UI, citation display with expandable source excerpts.
9. **Testing & edge cases** — no-answer-in-documents case, multiple overlapping sources, large file handling.
10. **Deployment** — backend to Render, frontend to Vercel, connect via environment variables.
11. **Documentation** — README with architecture diagram, setup instructions, demo GIF/screenshots.

## Evaluation / Demo Scenarios
- Upload 3-4 different PDFs on unrelated topics and confirm answers pull from the correct document only.
- Ask a question with no answer in the documents — system should say so instead of hallucinating.
- Ask a question where the answer spans two documents — check if both are cited.
- Time a large document upload (50+ pages) to confirm chunking performance is acceptable.

## Resume Bullet Points (draft, to refine after building)
- Built a Multi-Document RAG system using LangChain, Pinecone, and Gemini API that retrieves and cites exact source documents/pages for user queries, reducing hallucination and improving answer traceability.
- Designed a chunking and metadata-tagging pipeline to enable accurate cross-document retrieval and citation at page-level granularity.
- Developed a FastAPI backend and React frontend, deployed on Render and Vercel, supporting multi-file upload and real-time Q&A with source-linked answers.

## Stretch Goals (if time permits)
- Support for scanned/image-based PDFs via OCR.
- Multi-turn conversation memory (follow-up questions referencing prior answers).
- Highlight the exact sentence/paragraph in the source PDF viewer, not just the chunk.
- Add authentication so users have private document spaces.

## Skill File Reference
Pair this plan with a Claude Code skill file (`SKILL.md`) once implementation begins, covering:
- LangChain chunking/retrieval conventions used in this repo
- Pinecone index schema and metadata structure
- Prompt template used for citation-grounded generation
