import re
import json
import logging
from typing import Any, Dict, Iterator, Optional
import requests
from app.config import settings

logger = logging.getLogger(__name__)


def _payload(prompt: str, model: Optional[str], stream: bool, temperature: float, json_mode: bool) -> Dict[str, Any]:
    payload = {
        "model": model or settings.OLLAMA_GEN_MODEL,
        "prompt": prompt,
        "stream": stream,
        "keep_alive": "24h",
        "options": {"temperature": temperature, "top_p": 0.9, "num_ctx": settings.OLLAMA_NUM_CTX},
    }
    if json_mode:
        payload["format"] = "json"
    return payload


def _clean(text: str) -> str:
    # Strip DeepSeek-R1 style <think>…</think> reasoning blocks
    return re.sub(r"<think>[\s\S]*?</think>", "", text).strip()


def generate(prompt: str, model: Optional[str] = None, temperature: float = 0.1, timeout: int = 300) -> str:
    resp = requests.post(f"{settings.OLLAMA_BASE_URL}/api/generate",
                         json=_payload(prompt, model, False, temperature, False), timeout=timeout)
    resp.raise_for_status()
    return _clean(resp.json().get("response", ""))


def generate_json(prompt: str, model: Optional[str] = None, timeout: int = 300) -> Any:
    """Generate with Ollama's JSON mode and parse the result; returns None if it is not valid JSON."""
    try:
        resp = requests.post(f"{settings.OLLAMA_BASE_URL}/api/generate",
                             json=_payload(prompt, model, False, 0.0, True), timeout=timeout)
        resp.raise_for_status()
        return json.loads(_clean(resp.json().get("response", "")))
    except Exception as exc:
        logger.warning(f"JSON generation failed: {exc}")
        return None


def stream(prompt: str, model: Optional[str] = None, temperature: float = 0.1, timeout: int = 300) -> Iterator[str]:
    with requests.post(f"{settings.OLLAMA_BASE_URL}/api/generate",
                       json=_payload(prompt, model, True, temperature, False), stream=True, timeout=timeout) as resp:
        if resp.status_code != 200:
            raise RuntimeError(f"{resp.status_code}: {resp.text[:200]}")
        for line in resp.iter_lines():
            if not line:
                continue
            data = json.loads(line)
            if data.get("response"):
                yield data["response"]
            if data.get("done"):
                break
