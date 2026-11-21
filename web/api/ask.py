"""POST /api/ask -> NDJSON stream: meta (mode, sources), tokens, done | error."""
import time
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _http import Base
from _core import Library, LLMError, UserError, MAX_QUESTION, build_prompt, parse_docs, route, stream, LLM_MODEL


class handler(Base):
    def do_POST(self):
        try:
            p = self.body()
            question = str(p.get("question") or "").strip()
            if not question:
                raise UserError("Type a question first.")
            if len(question) > MAX_QUESTION:
                raise UserError(f"Keep the question under {MAX_QUESTION} characters.")
            lib = Library(parse_docs(p, required=False))
            only = set(p.get("only") or []) or None
            mode, hits = route(question, lib)
            if mode == "rag" and only:
                hits = lib.search(question, only=only) or hits
            history = [m for m in (p.get("history") or []) if isinstance(m, dict)][-4:]
            if history and mode == "rag":
                recap = "\n".join(f"{m.get('role', 'user').title()}: {str(m.get('content', ''))[:400]}" for m in history)
                question_for_prompt = f"(Earlier in this conversation:\n{recap})\n\n{question}"
            else:
                question_for_prompt = question
            prompt = build_prompt(mode, question_for_prompt, lib, hits, general=bool(p.get("general")))
        except UserError as e:
            return self.json({"type": "error", "message": str(e)}, 400)
        self.start_stream()
        t0 = time.time()
        self.emit({"type": "meta", "mode": mode, "model": LLM_MODEL, "sources": hits})
        try:
            for piece in stream(prompt):
                self.emit({"type": "token", "t": piece})
            self.emit({"type": "done", "seconds": round(time.time() - t0, 1)})
        except LLMError as e:
            self.emit({"type": "error", "message": str(e)})
        except Exception:  # noqa: BLE001
            self.emit({"type": "error", "message": "Something went wrong while generating the answer."})
