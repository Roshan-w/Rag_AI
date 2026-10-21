import re
import uuid
from typing import List, Dict, Any
from app.core.document_parser import ParsedPage
from app.schemas.rag import ChunkItem

class DocumentChunker:
    def __init__(self, chunk_size: int = 800, chunk_overlap: int = 150):
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap

    def chunk_document(
        self,
        document_id: str,
        filename: str,
        pages: List[ParsedPage],
        metadata: Dict[str, Any]
    ) -> List[ChunkItem]:
        """
        Splits parsed pages into overlapping chunks while maintaining precise page numbers
        and character ranges for accurate citations.
        """
        chunks: List[ChunkItem] = []
        global_chunk_index = 0

        for page in pages:
            page_text = page.text.strip()
            if not page_text:
                continue

            page_chunks = self._split_text_with_overlap(page_text)
            
            for local_idx, chunk_text in enumerate(page_chunks):
                if not chunk_text.strip():
                    continue

                chunk_id = f"{document_id}_p{page.page_number}_c{global_chunk_index}"
                
                # Estimate char positions within the page
                char_start = page_text.find(chunk_text[:30]) if len(chunk_text) >= 30 else page_text.find(chunk_text)
                if char_start == -1:
                    char_start = 0
                char_end = char_start + len(chunk_text)

                chunk_item = ChunkItem(
                    chunk_id=chunk_id,
                    document_id=document_id,
                    filename=filename,
                    page_number=page.page_number,
                    chunk_index=global_chunk_index,
                    text=chunk_text.strip(),
                    char_start=char_start,
                    char_end=char_end,
                    metadata={
                        "file_type": metadata.get("file_type", ""),
                        "total_pages": metadata.get("total_pages", len(pages)),
                        "file_size": metadata.get("file_size", 0),
                        "page_number": page.page_number,
                        "chunk_index": global_chunk_index,
                        "filename": filename,
                        "document_id": document_id
                    }
                )
                chunks.append(chunk_item)
                global_chunk_index += 1

        return chunks

    def _split_text_with_overlap(self, text: str) -> List[str]:
        """
        Recursively splits text on natural boundaries: double newline, single newline,
        periods/sentences, spaces, with overlap.
        """
        if len(text) <= self.chunk_size:
            return [text]

        separators = ["\n\n", "\n", ". ", "? ", "! ", "; ", " ", ""]
        return self._recursive_split(text, separators, self.chunk_size, self.chunk_overlap)

    def _recursive_split(self, text: str, separators: List[str], chunk_size: int, chunk_overlap: int) -> List[str]:
        if not separators or len(text) <= chunk_size:
            return [text] if text.strip() else []

        sep = separators[0]
        remaining_seps = separators[1:]

        if sep == "":
            splits = list(text)
        else:
            splits = text.split(sep)

        good_chunks = []
        current_chunk = []
        current_length = 0

        for s in splits:
            item = s if sep == "" else s + sep
            item_len = len(item)

            if current_length + item_len > chunk_size and current_chunk:
                merged = "".join(current_chunk).strip()
                if len(merged) > chunk_size and remaining_seps:
                    sub_chunks = self._recursive_split(merged, remaining_seps, chunk_size, chunk_overlap)
                    good_chunks.extend(sub_chunks)
                else:
                    good_chunks.append(merged)
                
                # Overlap logic: keep last few tokens
                overlap_text = []
                overlap_len = 0
                for prev in reversed(current_chunk):
                    if overlap_len + len(prev) <= chunk_overlap:
                        overlap_text.insert(0, prev)
                        overlap_len += len(prev)
                    else:
                        break
                current_chunk = overlap_text
                current_length = overlap_len

            current_chunk.append(item)
            current_length += item_len

        if current_chunk:
            merged = "".join(current_chunk).strip()
            if len(merged) > chunk_size and remaining_seps:
                sub_chunks = self._recursive_split(merged, remaining_seps, chunk_size, chunk_overlap)
                good_chunks.extend(sub_chunks)
            else:
                good_chunks.append(merged)

        return [c for c in good_chunks if len(c.strip()) > 10]
