import os
import json
from fastapi import APIRouter

router = APIRouter(prefix="/chat", tags=["Chat"])

CHAT_HISTORY_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "data", "chat_history.json")

def get_chat_history_list():
    if not os.path.exists(CHAT_HISTORY_FILE):
        return []
    try:
        with open(CHAT_HISTORY_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return []

def save_chat_history_list(history):
    os.makedirs(os.path.dirname(CHAT_HISTORY_FILE), exist_ok=True)
    with open(CHAT_HISTORY_FILE, "w", encoding="utf-8") as f:
        json.dump(history, f, indent=2)

@router.get("/history")
async def get_history():
    return get_chat_history_list()

@router.delete("/history")
async def clear_history():
    save_chat_history_list([])
    return {"success": True, "message": "Chat history cleared"}
