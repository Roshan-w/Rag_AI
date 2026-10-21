"""
Telegram bot front-end for the same RAG pipeline (long polling, no public webhook needed).
Enabled only when TELEGRAM_BOT_TOKEN is set in .env.

Anyone can ask questions. Only users listed in TELEGRAM_ADMIN_IDS can add documents
(send a file or photo); added documents are shared with everyone, like web uploads.
"""
import os
import re
import logging
import threading
import time
import requests
from app.config import settings
from app.core.rag_pipeline import rag_pipeline

logger = logging.getLogger(__name__)

WELCOME = (
    "👋 Ask me anything about the uploaded university documents.\n"
    "Every answer comes with its sources (document + page).\n\n"
    "Admins can also send a PDF, Word file, text file or a photo of a notice to add it to the knowledge base.\n"
    "/myid — show your Telegram user ID"
)

# Telegram's Bot API only lets bots download files up to 20 MB
MAX_TELEGRAM_FILE = 20 * 1024 * 1024
SUPPORTED_EXTS = {".pdf", ".docx", ".doc", ".txt", ".md", ".csv", ".png", ".jpg", ".jpeg", ".webp"}


def _api(method: str, **params):
    return requests.post(f"https://api.telegram.org/bot{settings.TELEGRAM_BOT_TOKEN}/{method}",
                         json=params, timeout=60).json()


def _send(chat_id: int, text: str):
    _api("sendMessage", chat_id=chat_id, text=text)


def _format(answer: str, citations) -> str:
    sources = sorted({(c.document_name, c.page_number) for c in citations})
    # Plain-text chat: drop Markdown emphasis/headings and inline citation markers (sources are listed below)
    text = re.sub(r"\*\*|__|^#+\s*", "", answer, flags=re.M)
    text = re.sub(r"\s*\[(?:Citation:\s*)?(?:\[)?Doc:[^\]]*\]+", "", text)
    text = re.sub(r"^\s*(?:Citations?|Sources?):?\s*$", "", text, flags=re.M | re.I)  # orphaned headings
    text = re.sub(r"^\s*[-*•]\s*$", "", text, flags=re.M)  # bullets left empty once their citation is gone
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    if sources:
        text += "\n\n📚 Sources:\n" + "\n".join(f"• {d}, p.{p}" for d, p in sources)
    return text[:4000]  # Telegram message limit is 4096


def _download(file_id: str) -> bytes:
    info = _api("getFile", file_id=file_id)
    if not info.get("ok"):
        raise ValueError(info.get("description", "could not fetch file"))
    resp = requests.get(
        f"https://api.telegram.org/file/bot{settings.TELEGRAM_BOT_TOKEN}/{info['result']['file_path']}", timeout=120)
    resp.raise_for_status()
    return resp.content


def _handle_upload(message: dict):
    chat_id = message["chat"]["id"]
    user = message.get("from", {})
    if user.get("id") not in settings.TELEGRAM_ADMIN_IDS:
        _send(chat_id, f"⛔ Only approved admins can add documents.\n"
                       f"Your Telegram ID is {user.get('id')} — ask the site owner to add it to TELEGRAM_ADMIN_IDS.")
        return

    if "document" in message:
        doc = message["document"]
        file_id, size = doc["file_id"], doc.get("file_size", 0)
        filename = doc.get("file_name") or f"telegram-{doc['file_unique_id']}"
    else:
        photo = message["photo"][-1]  # Telegram sends several sizes; the last is the largest
        file_id, size = photo["file_id"], photo.get("file_size", 0)
        filename = f"telegram-photo-{time.strftime('%Y%m%d-%H%M%S')}.jpg"

    ext = os.path.splitext(filename)[1].lower()
    if ext not in SUPPORTED_EXTS:
        _send(chat_id, f"⚠️ {ext or 'This file type'} is not supported. Send a PDF, DOCX, TXT or image.")
        return
    if size > MAX_TELEGRAM_FILE:
        _send(chat_id, "⚠️ Telegram only lets bots download files up to 20 MB. Upload larger files on the website.")
        return

    _send(chat_id, f"📥 Indexing {filename}…")
    _api("sendChatAction", chat_id=chat_id, action="upload_document")
    try:
        from app.api.endpoints.documents import index_document  # late import: avoids a circular import at startup
        meta = index_document(filename, _download(file_id))
        logger.info(f"Telegram upload by {user.get('id')} (@{user.get('username')}): {filename}")
        _send(chat_id, f"✅ Added {meta.filename} — {meta.total_pages} page(s), {meta.total_chunks} chunks.\n"
                       "It is searchable now here and on the website; summary, FAQ and conflict checks follow shortly.")
    except Exception as exc:
        logger.error(f"Telegram upload failed: {exc}")
        _send(chat_id, f"❌ Could not index {filename}: {exc}")


def _handle(message: dict):
    chat_id = message["chat"]["id"]
    if "document" in message or "photo" in message:
        _handle_upload(message)
        return
    text = (message.get("text") or "").strip()
    if not text:
        return
    if text.startswith("/start") or text.startswith("/help"):
        _send(chat_id, WELCOME)
        return
    if text.startswith("/myid"):
        uid = message.get("from", {}).get("id")
        status = "admin ✅ — you can upload documents" if uid in settings.TELEGRAM_ADMIN_IDS else "not an upload admin"
        _send(chat_id, f"Your Telegram user ID: {uid} ({status})")
        return
    _api("sendChatAction", chat_id=chat_id, action="typing")
    result = rag_pipeline.run_query(text, top_k=settings.TOP_K)
    _send(chat_id, _format(result.answer, result.citations))


def _poll():
    offset = None
    while True:
        try:
            updates = _api("getUpdates", timeout=50, offset=offset)
            for upd in updates.get("result", []):
                offset = upd["update_id"] + 1
                if "message" in upd:
                    threading.Thread(target=_handle, args=(upd["message"],), daemon=True).start()
        except Exception as exc:
            logger.warning(f"Telegram polling error: {exc}")
            time.sleep(5)


def start():
    if not settings.TELEGRAM_BOT_TOKEN:
        logger.info("Telegram bot disabled (TELEGRAM_BOT_TOKEN not set).")
        return
    me = _api("getMe")
    if not me.get("ok"):
        logger.error(f"Telegram token rejected: {me}")
        return
    logger.info(f"Telegram bot running as @{me['result']['username']} ({len(settings.TELEGRAM_ADMIN_IDS)} upload admins)")
    _api("setMyCommands", commands=[
        {"command": "start", "description": "How to use this bot"},
        {"command": "myid", "description": "Show your Telegram user ID"},
    ])
    threading.Thread(target=_poll, daemon=True, name="telegram-bot").start()
