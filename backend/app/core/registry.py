import os
import re
import json
import logging
from typing import Dict, List, Optional
from app.config import settings
from app.schemas.rag import DocumentMetadata
from app.core.vector_store import vector_store

logger = logging.getLogger(__name__)

REGISTRY_FILE = os.path.join(settings.INDEX_DIR, "registry.json")

# Document registry, persisted next to the vector index so documents survive restarts
# Map: doc_id -> DocumentMetadata
DOCUMENT_REGISTRY: Dict[str, DocumentMetadata] = {}

def load_registry():
    if not os.path.exists(REGISTRY_FILE):
        return
    try:
        with open(REGISTRY_FILE, "r", encoding="utf-8") as f:
            for item in json.load(f):
                doc = DocumentMetadata(**item)
                # Only keep entries whose chunks actually made it into the index
                if vector_store.get_document_chunks(doc.document_id):
                    DOCUMENT_REGISTRY[doc.document_id] = doc
    except Exception as e:
        logger.error(f"Failed to load document registry: {e}")


def save_registry():
    os.makedirs(os.path.dirname(REGISTRY_FILE), exist_ok=True)
    tmp = REGISTRY_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump([d.model_dump() for d in DOCUMENT_REGISTRY.values()], f, indent=2)
    os.replace(tmp, REGISTRY_FILE)


def document_ids_in_scope(requested: Optional[List[str]] = None) -> List[str]:
    """All indexed documents (every document is shared with everyone), optionally narrowed to `requested`."""
    ids = list(DOCUMENT_REGISTRY)
    if requested:
        ids = [i for i in ids if i in requested]
    return ids


def library_catalog(limit: int = 60) -> str:
    """One line per document (name, pages, upload date, summary) so the assistant can answer questions
    about the collection itself: "list the documents", "how many PDFs", "what is each about"."""
    lines = []
    for doc in list(DOCUMENT_REGISTRY.values())[:limit]:
        summary = ""
        try:
            with open(os.path.join(settings.INDEX_DIR, "insights", f"{doc.document_id}.json"), encoding="utf-8") as f:
                summary = (json.load(f).get("summary") or "").strip()
        except Exception:
            pass
        line = f"- {doc.filename} ({doc.total_pages} page(s), uploaded {doc.uploaded_at} UTC)"
        lines.append(line + (f": {summary[:300]}" if summary else ""))
    if len(DOCUMENT_REGISTRY) > limit:
        lines.append(f"- … and {len(DOCUMENT_REGISTRY) - limit} more")
    return f"{len(DOCUMENT_REGISTRY)} document(s) indexed:\n" + "\n".join(lines) if lines else "No documents are indexed yet."


def _name_variants(filename: str) -> List[str]:
    stem = os.path.splitext(filename)[0].lower().strip()
    spaced = re.sub(r"[-_.]+", " ", stem).strip()
    return [v for v in {stem, spaced, filename.lower()} if len(v) >= 3 or any(ch.isdigit() for ch in v)]


def documents_named_in(question: str) -> List[str]:
    """Documents the question refers to by name (e.g. "the 1-2 pdf", "fee circular")."""
    q = question.lower()
    found = []
    for doc in DOCUMENT_REGISTRY.values():
        for v in _name_variants(doc.filename):
            if re.search(rf"(?<![a-z0-9]){re.escape(v)}(?![a-z0-9])", q):
                found.append(doc.document_id)
                break
    return found


load_registry()
