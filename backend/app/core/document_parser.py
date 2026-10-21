import io
import os
from typing import List, Dict, Any, Tuple
import logging

logger = logging.getLogger(__name__)

class ParsedPage:
    def __init__(self, page_number: int, text: str):
        self.page_number = page_number
        self.text = text.strip()

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"}

# Below this many characters a PDF page is treated as scanned and OCR'd instead
SCANNED_PAGE_CHARS = 25


class DocumentParser:
    @staticmethod
    def parse_file(filename: str, file_bytes: bytes) -> Tuple[List[ParsedPage], Dict[str, Any]]:
        """
        Parses uploaded file content and returns a list of ParsedPage objects along with metadata.
        Supports PDF, DOCX, and TXT/MD.
        """
        ext = os.path.splitext(filename)[1].lower()
        metadata = {
            "filename": filename,
            "file_type": ext.lstrip("."),
            "file_size": len(file_bytes),
        }

        if ext == ".pdf":
            pages = DocumentParser._parse_pdf(file_bytes)
        elif ext in [".docx", ".doc"]:
            pages = DocumentParser._parse_docx(file_bytes)
        elif ext in IMAGE_EXTS:
            pages = [ParsedPage(page_number=1, text=DocumentParser._ocr_image_bytes(file_bytes))]
            metadata["ocr"] = True
        elif ext in [".txt", ".md", ".csv", ".json"]:
            pages = DocumentParser._parse_text(file_bytes)
        else:
            # Fallback to plain text interpretation
            try:
                pages = DocumentParser._parse_text(file_bytes)
            except Exception as e:
                raise ValueError(f"Unsupported file format: {ext}. Error: {str(e)}")

        if not pages or all(len(p.text) == 0 for p in pages):
            raise ValueError(f"Could not extract readable text from '{filename}'. File may be empty, image-scanned, or corrupted.")

        metadata["total_pages"] = len(pages)
        return pages, metadata

    @staticmethod
    def _parse_pdf(file_bytes: bytes) -> List[ParsedPage]:
        pages: List[ParsedPage] = []

        # 1. Try pdfplumber for high-quality text extraction
        try:
            import pdfplumber
            with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
                for idx, page in enumerate(pdf.pages, start=1):
                    text = page.extract_text() or ""
                    if len(text.strip()) < SCANNED_PAGE_CHARS:
                        text = DocumentParser._ocr_pdf_page(page) or text
                    # Also extract text from tables if available
                    tables = page.extract_tables()
                    if tables:
                        table_texts = []
                        for table in tables:
                            rows = [" | ".join([cell if cell else "" for cell in row]) for row in table if row]
                            table_texts.append("\n".join(rows))
                        if table_texts:
                            text += "\n\n" + "\n\n".join(table_texts)
                    pages.append(ParsedPage(page_number=idx, text=text))
            if any(len(p.text) > 0 for p in pages):
                return pages
        except Exception as e:
            logger.warning(f"pdfplumber failed to extract text: {e}. Falling back to pypdf.")

        # 2. Fallback to pypdf
        try:
            from pypdf import PdfReader
            reader = PdfReader(io.BytesIO(file_bytes))
            pages = []
            for idx, page in enumerate(reader.pages, start=1):
                text = page.extract_text() or ""
                pages.append(ParsedPage(page_number=idx, text=text))
            return pages
        except Exception as e:
            logger.error(f"pypdf extraction failed: {e}")
            raise ValueError(f"Failed to parse PDF: {str(e)}")

    @staticmethod
    def _ocr_image(image) -> str:
        import pytesseract
        from app.config import settings
        return pytesseract.image_to_string(image.convert("RGB"), lang=settings.OCR_LANGUAGES)

    @staticmethod
    def _ocr_image_bytes(file_bytes: bytes) -> str:
        from PIL import Image, ImageOps
        image = ImageOps.exif_transpose(Image.open(io.BytesIO(file_bytes)))  # respect phone photo rotation
        return DocumentParser._ocr_image(image)

    @staticmethod
    def _ocr_pdf_page(page) -> str:
        """OCR a scanned PDF page (renders via pypdfium2, bundled with pdfplumber)."""
        try:
            return DocumentParser._ocr_image(page.to_image(resolution=250).original)
        except Exception as e:
            logger.warning(f"OCR failed on PDF page {page.page_number}: {e}")
            return ""

    @staticmethod
    def _parse_docx(file_bytes: bytes) -> List[ParsedPage]:
        try:
            import docx
            doc = docx.Document(io.BytesIO(file_bytes))
            paragraphs = []
            for p in doc.paragraphs:
                if p.text.strip():
                    paragraphs.append(p.text.strip())

            # Also extract tables
            for table in doc.tables:
                for row in table.rows:
                    row_text = " | ".join([cell.text.strip() for cell in row.cells if cell.text.strip()])
                    if row_text:
                        paragraphs.append(row_text)

            full_text = "\n\n".join(paragraphs)
            # Estimate pages (~3000 chars or 500 words per page)
            page_size = 2500
            if len(full_text) <= page_size:
                return [ParsedPage(page_number=1, text=full_text)]
            
            pages = []
            for idx in range(0, len(full_text), page_size):
                page_num = (idx // page_size) + 1
                pages.append(ParsedPage(page_number=page_num, text=full_text[idx:idx + page_size]))
            return pages
        except Exception as e:
            logger.error(f"DOCX extraction failed: {e}")
            raise ValueError(f"Failed to parse DOCX: {str(e)}")

    @staticmethod
    def _parse_text(file_bytes: bytes) -> List[ParsedPage]:
        # Try UTF-8, then fallback to latin-1
        try:
            content = file_bytes.decode("utf-8")
        except UnicodeDecodeError:
            content = file_bytes.decode("latin-1", errors="replace")

        page_size = 2500
        if len(content) <= page_size:
            return [ParsedPage(page_number=1, text=content)]
        
        pages = []
        for idx in range(0, len(content), page_size):
            page_num = (idx // page_size) + 1
            pages.append(ParsedPage(page_number=page_num, text=content[idx:idx + page_size]))
        return pages
