import os
import logging
import tempfile
import threading
from typing import Dict
from app.config import settings

logger = logging.getLogger(__name__)

_model = None
_lock = threading.Lock()


def _load():
    global _model
    with _lock:
        if _model is None:
            from faster_whisper import WhisperModel
            _model = WhisperModel(settings.WHISPER_MODEL, device="cpu", compute_type="int8",
                                  download_root=os.path.join(settings.MODEL_CACHE_DIR, "whisper"))
            logger.info(f"Whisper model loaded: {settings.WHISPER_MODEL}")
    return _model


def transcribe(audio: bytes, suffix: str = ".webm") -> Dict[str, str]:
    """Local speech-to-text (Hindi, Marathi, English and more). Audio never leaves the server."""
    model = _load()
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
        f.write(audio)
        path = f.name
    try:
        segments, info = model.transcribe(path, beam_size=1, vad_filter=True)
        text = " ".join(s.text.strip() for s in segments).strip()
        return {"text": text, "language": info.language}
    finally:
        os.remove(path)
