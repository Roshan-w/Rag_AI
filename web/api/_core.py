"""RAG.AI web backend: BM25 retrieval across all documents + Qwen (OpenAI-compatible) generation.

Standard library only, so the Vercel functions stay small. Documents live in the browser and are sent with
each request (Vercel functions keep no state between calls). Prompts and routing follow backend/app/core.
"""
import json
import math
import os
import re
import socket
import urllib.error
import urllib.request
from collections import Counter

CHUNK_SIZE, CHUNK_OVERLAP, TOP_K = 800, 150, 6
MAX_DOCS, MAX_CHARS_TOTAL, MAX_QUESTION = 12, 900_000, 1000

LLM_BASE_URL = os.getenv("LLM_BASE_URL", "http://127.0.0.1:18205/v1").rstrip("/")
LLM_MODEL = os.getenv("LLM_MODEL", "qwen2.5-14b")
LLM_API_KEY_ENV = os.getenv("LLM_API_KEY_ENV", "QWEN_API_KEY")
LLM_TIMEOUT = float(os.getenv("LLM_TIMEOUT", "280"))

STOP = set("""a an and are as at be by for from has have in is it its of on or that the this to was were will with what which
who how does do each their there these those than then into about any all can per vs i me my we our you your please tell""".split())


class UserError(ValueError):
    """Bad input, shown to the user as-is."""


class LLMError(RuntimeError):
    """Model failure with a readable message."""


# ------------------------------------------------------------------ prompts (from backend/app/core)
CITATION_PROMPT = """You are a senior AI research assistant specializing in Multi-Document Retrieval-Augmented Generation (RAG).
Your role is to provide accurate, comprehensive, and strictly grounded answers based ONLY on the provided context excerpts from uploaded documents.

CRITICAL INSTRUCTIONS:
1. Answer the user's question relying EXCLUSIVELY on the provided Context Chunks. Do not invent or assume facts outside the provided context.
2. Read every chunk carefully, including tables (rows are written as "cell | cell | cell"). Quote exact figures, dates, amounts and names as they appear.
3. If the answer is genuinely not present in the chunks, say clearly: "The provided documents do not contain this information." Do not guess.
4. Every claim or fact you present must include an inline citation in the format `[Doc: <filename>, Page: <page_number>]`.
5. When answering queries spanning multiple documents, synthesize the facts cleanly and cite all contributing documents. Point out if documents disagree.
6. Format your response with clean Markdown (using bold headings, bullet points, or tables where appropriate).

Library Catalog (every document currently indexed):
{catalog}

Context Chunks:
{context_blocks}

Question: {question}
Answer:"""

GENERAL_PROMPT = """You are RAG.AI, a friendly assistant for a university's document library. Users upload PDFs,
Word files and text files; you answer questions about them with page-level citations.
You can also audit answers claim by claim, build timelines, and generate summaries, FAQs and quizzes.

Library Catalog (every document currently indexed):
{catalog}

{mode_instruction}

User: {question}
Answer (clean Markdown):"""

MODE_LIBRARY = ("The user is asking about the document collection itself. Answer ONLY from the Library Catalog. "
                "Start with one sentence stating how many documents are indexed, then list documents as bullet points "
                "with their page counts. Do not invent documents.")
MODE_CHAT = ("The user is greeting you or asking about you. Reply briefly and warmly, say what you can do, and suggest "
             "two or three example questions based on the Library Catalog.")
MODE_NOT_FOUND = ("No passage in the uploaded documents answers this question. Say so plainly in one or two sentences, "
                  "and suggest what the user could ask instead, based on the Library Catalog.")
MODE_GENERAL = ("No passage in the uploaded documents answers this question. Begin your reply with exactly this line:\n"
                "> ⚠️ Not found in your documents — answering from general knowledge.\n"
                "Then answer helpfully and accurately from general knowledge. Do not cite documents.")

LIBRARY_RE = re.compile(r"\b(list|show|which|what|how many|name|count|all|latest|newest|recent|uploaded)\b.{0,40}"
                        r"\b(documents?|docs?|files?|pdfs?|sources?|uploads?|knowledge base|library)\b", re.I)
CONTENT_HINT_RE = re.compile(r"\b(say|says|said|about|regarding|mention\w*|according|explain\w*|describe\w*|contain\w*|related to)\b", re.I)
CHAT_RE = re.compile(r"^\s*(hi+|hello|hey|hii+|namaste|good (morning|afternoon|evening)|thanks?( you)?|thank u|ok(ay)?|bye)\b[\s!.?]*$"
                     r"|\b(who are you|what can you do|what are you|help me use|how do (i|you) use|your features)\b", re.I)

AUDIT_PROMPT = """You are a strict fact-checker. Split the ANSWER into its individual factual claims
(ignore headings, filler and citation markers). For each claim decide, using ONLY the SOURCES:
- "supported": the sources state it
- "partial": the sources state part of it, or it is a loose paraphrase
- "unsupported": the sources do not state it

SOURCES:
{sources}

ANSWER:
{answer}

Return JSON exactly like:
{{"claims": [{{"claim": "...", "verdict": "supported|partial|unsupported", "source": <source number or null>, "evidence": "short exact quote from that source, or empty"}}]}}"""

STUDY_PROMPT = """You are preparing a study guide for the document "{filename}". Use ONLY its text below.

TEXT:
{text}

Return JSON exactly like:
{{"summary": "one paragraph, 3-5 sentences",
  "faq": ["question a student is likely to ask, answerable from the text", "... (5 to 8 items)"],
  "quiz": [{{"question": "...", "options": ["A", "B", "C", "D"], "answer_index": 0, "page": <page number>}}]}}
Give 4 to 6 quiz questions. Every question must be answerable from the text."""

TIMELINE_PROMPT = """From the SOURCES, list every dated fact relevant to the QUESTION, in chronological order.
Use ONLY the sources. Skip facts without a date, month or year.

QUESTION: {question}

SOURCES:
{sources}

Return JSON exactly like:
{{"title": "short title for the timeline",
  "events": [{{"date": "date as written", "sort_key": "YYYY-MM-DD, YYYY-MM or YYYY", "event": "what happens", "source": <source number>}}]}}"""


# ------------------------------------------------------------------ text + BM25
# Whole-library mode: when every page fits comfortably in Qwen's 32K-token window, send all of it.
FULL_BUDGET = int(os.getenv("FULL_CONTEXT_CHARS", "60000"))   # ~17K tokens, leaves room for the answer
SEARCH_BUDGET = 36000                                          # max characters of passages in search mode
OVERVIEW_RE = re.compile(r"\b(summar\w*|overview|outline|everything|all about|tell me about|what is .{0,40} about|describe|explain|key points|main points|topics?|covers?|contain\w*)\b", re.I)
_SUFFIXES = ("ilities", "ility", "ations", "ation", "ments", "ment", "ings", "ing", "ies", "ied", "ible", "able", "es", "ed", "ly", "s")


def stem(w):
    """Light suffix stripping so deadline/deadlines and eligible/eligibility match."""
    if len(w) <= 4 or w.isdigit():
        return w
    for suf in _SUFFIXES:
        if w.endswith(suf) and len(w) - len(suf) >= 4:
            w = w[: -len(suf)]
            break
    return w[:-1] if w.endswith("e") and len(w) > 5 else w


def tokens(text):
    return [stem(t) for t in re.findall(r"[a-z0-9]+(?:[.,][0-9]+)?", text.lower()) if t not in STOP and len(t) > 1]


def split_text(text, size=CHUNK_SIZE, overlap=CHUNK_OVERLAP):
    text = re.sub(r"[ \t]+", " ", text).strip()
    if len(text) <= size:
        return [text] if text else []
    out, start = [], 0
    while start < len(text):
        end = min(start + size, len(text))
        if end < len(text):
            cut = max(text.rfind("\n", start, end), text.rfind(". ", start, end))
            if cut > start + size // 2:
                end = cut + 1
        out.append(text[start:end].strip())
        if end >= len(text):
            break
        start = max(end - overlap, start + 1)
    return [c for c in out if c]


def _base(name):
    return re.sub(r"\.[a-z0-9]+$", "", name.lower()).replace("-", " ").replace("_", " ")


class Library:
    """BM25 over every chunk of every document; remembers document and page for each chunk."""

    def __init__(self, docs):
        self.docs = docs
        self.chunks = [{"doc": d["name"], "page": p, "text": c}
                       for d in docs for p, page in enumerate(d["pages"], start=1) for c in split_text(page)]
        self.tf = [Counter(tokens(c["text"])) for c in self.chunks]
        self.lens = [sum(t.values()) for t in self.tf]
        self.avg = (sum(self.lens) / len(self.lens)) if self.lens else 1
        df = Counter(w for t in self.tf for w in t)
        n = max(1, len(self.tf))
        self.idf = {w: math.log(1 + (n - f + 0.5) / (f + 0.5)) for w, f in df.items()}
        self.total_chars = sum(len(p) for d in docs for p in d["pages"])

    def score(self, q, i, k1=1.5, b=0.75):
        t, dl = self.tf[i], self.lens[i]
        return sum(self.idf.get(w, 0) * t[w] * (k1 + 1) / (t[w] + k1 * (1 - b + b * dl / self.avg)) for w in q if w in t)

    def named(self, question):
        """Documents the question refers to by name (the full name, or its distinctive words)."""
        ql = " " + question.lower().replace("-", " ").replace("_", " ") + " "
        out = set()
        for d in self.docs:
            words = [w for w in _base(d["name"]).split() if len(w) > 3 and w not in STOP]
            if _base(d["name"]) in ql or (words and sum((" " + w) in ql for w in words) >= max(1, min(2, len(words)))):
                out.add(d["name"])
        return out

    def search(self, question, k=TOP_K, only=None):
        q = tokens(question)
        named = self.named(question)
        scored = []
        for i, c in enumerate(self.chunks):
            if only and c["doc"] not in only:
                continue
            s = self.score(q, i) * (1.8 if c["doc"] in named else 1.0)
            if s > 0:
                scored.append((s, i))
        scored.sort(reverse=True)
        if not scored:
            return []
        # top passages overall, plus the best two from every document that matched, so no file is left out
        pick, seen_doc = [], Counter()
        for s, i in scored:
            d = self.chunks[i]["doc"]
            if len(pick) < k or seen_doc[d] < 2:
                pick.append((s, i))
                seen_doc[d] += 1
        out, used = [], 0
        for s, i in pick:
            ch = self.chunks[i]
            if used + len(ch["text"]) > SEARCH_BUDGET:
                break
            out.append(ch | {"score": round(s, 3)})
            used += len(ch["text"])
        return out

    def pages_of(self, names=None):
        """Every page (of the named documents, or of all) as sources."""
        return [{"doc": d["name"], "page": i, "text": p.strip()}
                for d in self.docs if names is None or d["name"] in names
                for i, p in enumerate(d["pages"], start=1) if p.strip()]

    def catalog(self):
        return "\n".join(f"- {d['name']} ({len(d['pages'])} page{'s' if len(d['pages']) != 1 else ''})" for d in self.docs) or "(no documents)"


def numbered(hits):
    return "\n\n".join(f"[Source {i}] {h['doc']} — Page {h['page']}\n{h['text']}" for i, h in enumerate(hits, start=1))


def context_blocks(hits):
    return "\n\n".join(f"--- Chunk {i} | Doc: {h['doc']} | Page: {h['page']} ---\n{h['text']}" for i, h in enumerate(hits, start=1))


# ------------------------------------------------------------------ validation
def parse_docs(payload, required=True):
    docs = []
    for d in (payload.get("docs") or [])[:MAX_DOCS]:
        name = str(d.get("name", "document"))[:140]
        pages = [str(p) for p in (d.get("pages") or [])][:400]
        if any(p.strip() for p in pages):
            docs.append({"name": name, "pages": pages})
    if sum(len(p) for d in docs for p in d["pages"]) > MAX_CHARS_TOTAL:
        raise UserError("The library is too large for the online demo. Remove a few documents and try again.")
    if required and not docs:
        raise UserError("Upload at least one document first.")
    return docs


def route(question, lib):
    """Pick an answering mode. Returns (mode, sources, scope): scope 'full' (every page), 'search' or 'none'."""
    if CHAT_RE.search(question):
        return "chat", [], "none"
    if LIBRARY_RE.search(question) and not CONTENT_HINT_RE.search(question) and not OVERVIEW_RE.search(question):
        return "library", [], "none"
    if not lib.chunks:
        return "not_found", [], "none"
    if lib.total_chars <= FULL_BUDGET:                       # the whole library fits: read all of it
        return "rag", lib.pages_of(), "full"
    named = lib.named(question)
    if named and OVERVIEW_RE.search(question):                # "summarise X": read all of X if it fits
        pages = lib.pages_of(named)
        if sum(len(p["text"]) for p in pages) <= FULL_BUDGET:
            return "rag", pages, "full"
    hits = lib.search(question)
    return ("rag", hits, "search") if hits else ("not_found", [], "none")


REFUSE_RULE = ('3. If the answer is genuinely not present in the chunks, say clearly: '
               '"The provided documents do not contain this information." Do not guess.')
GENERAL_RULE = ("3. If the answer is genuinely not present in the chunks, the user has allowed general knowledge: "
                "begin your reply with exactly this line:\n"
                "> ⚠️ Not found in your documents — answering from general knowledge.\n"
                "Then answer helpfully and accurately from general knowledge, without citing any document.")


def build_prompt(mode, question, lib, hits, general=False):
    if mode == "rag":
        prompt = CITATION_PROMPT.format(catalog=lib.catalog(), context_blocks=context_blocks(hits), question=question)
        if general:
            assert REFUSE_RULE in prompt, "citation prompt rule 3 changed"
            prompt = prompt.replace(REFUSE_RULE, GENERAL_RULE, 1)
        return prompt
    instr = {"chat": MODE_CHAT, "library": MODE_LIBRARY, "not_found": MODE_GENERAL if general else MODE_NOT_FOUND}[mode]
    return GENERAL_PROMPT.format(catalog=lib.catalog(), mode_instruction=instr, question=question)


# ------------------------------------------------------------------ LLM
def _key():
    key = os.getenv(LLM_API_KEY_ENV)
    if not key:
        raise LLMError(f"The server has no API key configured ({LLM_API_KEY_ENV}).")
    return key


def _explain(e):
    if isinstance(e, urllib.error.HTTPError):
        if e.code == 401:
            return "The model server rejected the API key (401). The site owner needs to update it."
        if e.code in (404, 502, 503, 504, 530):
            return "The model server is offline right now (the lab tunnel is down). Please try again later."
        return f"The model server returned an error (HTTP {e.code})."
    if isinstance(e, (socket.timeout, TimeoutError)) or (isinstance(e, urllib.error.URLError) and isinstance(e.reason, (socket.timeout, TimeoutError))):
        return f"The model did not answer within {LLM_TIMEOUT:.0f}s. Try a shorter question or fewer documents."
    if isinstance(e, urllib.error.URLError):
        return "Cannot reach the model server (connection refused). The lab tunnel is probably down."
    return None


def _request(body):
    return urllib.request.Request(f"{LLM_BASE_URL}/chat/completions", data=json.dumps(body).encode(), method="POST", headers={
        "Content-Type": "application/json", "Authorization": f"Bearer {_key()}", "ngrok-skip-browser-warning": "1"})


def stream(prompt, max_tokens=1200, temperature=0.1):
    body = {"model": LLM_MODEL, "stream": True, "temperature": temperature, "max_tokens": max_tokens,
            "messages": [{"role": "user", "content": prompt}]}
    try:
        with urllib.request.urlopen(_request(body), timeout=LLM_TIMEOUT) as resp:
            for raw in resp:
                line = raw.decode("utf-8", "replace").strip()
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                try:
                    delta = json.loads(data)["choices"][0].get("delta", {}).get("content")
                except (ValueError, KeyError, IndexError):
                    continue
                if delta:
                    yield delta
    except LLMError:
        raise
    except Exception as e:  # noqa: BLE001
        msg = _explain(e)
        if msg:
            raise LLMError(msg) from e
        raise


def generate_json(prompt, max_tokens=900):
    body = {"model": LLM_MODEL, "stream": False, "temperature": 0.1, "max_tokens": max_tokens,
            "response_format": {"type": "json_object"}, "messages": [{"role": "user", "content": prompt}]}
    try:
        with urllib.request.urlopen(_request(body), timeout=LLM_TIMEOUT) as resp:
            text = json.load(resp)["choices"][0]["message"]["content"]
    except LLMError:
        raise
    except Exception as e:  # noqa: BLE001
        msg = _explain(e)
        if msg:
            raise LLMError(msg) from e
        raise
    m = re.search(r"\{.*\}", text, re.S)
    try:
        return json.loads(m.group(0) if m else text)
    except ValueError:
        return {}


def health():
    try:
        req = urllib.request.Request(f"{LLM_BASE_URL}/models", headers={"Authorization": f"Bearer {_key()}", "ngrok-skip-browser-warning": "1"})
        with urllib.request.urlopen(req, timeout=8) as resp:
            json.load(resp)
        return {"ok": True, "model": LLM_MODEL}
    except LLMError as e:
        return {"ok": False, "model": LLM_MODEL, "error": str(e)}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "model": LLM_MODEL, "error": _explain(e) or "Model server unavailable."}


# ------------------------------------------------------------------ intelligence (on demand)
def audit(answer, sources):
    if not sources:
        return {"claims": [], "faithfulness": None}
    data = generate_json(AUDIT_PROMPT.format(sources=numbered(sources), answer=answer[:6000]), max_tokens=900)
    claims = []
    for c in (data.get("claims") or []) if isinstance(data, dict) else []:
        if not isinstance(c, dict) or not str(c.get("claim", "")).strip():
            continue
        verdict = c.get("verdict") if c.get("verdict") in ("supported", "partial", "unsupported") else "unsupported"
        src = c.get("source")
        s = sources[src - 1] if isinstance(src, int) and 1 <= src <= len(sources) else None
        claims.append({"claim": str(c["claim"]).strip(), "verdict": verdict, "evidence": str(c.get("evidence") or "").strip(),
                       "document_name": s["doc"] if s else None, "page_number": s["page"] if s else None})
    weight = {"supported": 1.0, "partial": 0.5, "unsupported": 0.0}
    score = round(sum(weight[c["verdict"]] for c in claims) / len(claims), 3) if claims else None
    return {"claims": claims, "faithfulness": score}


def insights(doc):
    text, used = [], 0
    for i, p in enumerate(doc["pages"], start=1):
        block = f"[Page {i}]\n{p.strip()}\n"
        if used + len(block) > 40000:
            break
        text.append(block); used += len(block)
    data = generate_json(STUDY_PROMPT.format(filename=doc["name"], text="\n".join(text)), max_tokens=1100)
    data = data if isinstance(data, dict) else {}
    faq = [q for q in (data.get("faq") or []) if isinstance(q, str) and q.strip().endswith("?")][:8]
    quiz = [q for q in (data.get("quiz") or []) if isinstance(q, dict) and isinstance(q.get("options"), list) and len(q["options"]) >= 2][:6]
    return {"document": doc["name"], "summary": str(data.get("summary") or "").strip(), "faq": faq, "quiz": quiz}


def timeline(question, lib):
    hits = lib.pages_of() if lib.total_chars <= FULL_BUDGET else lib.search(question, k=10)
    if not hits:
        return {"title": "No dated facts found", "events": [], "sources": []}
    data = generate_json(TIMELINE_PROMPT.format(question=question, sources=numbered(hits)), max_tokens=800)
    events = []
    for e in (data.get("events") or []) if isinstance(data, dict) else []:
        if not isinstance(e, dict) or not e.get("event"):
            continue
        src = e.get("source")
        s = hits[src - 1] if isinstance(src, int) and 1 <= src <= len(hits) else None
        events.append({"date": str(e.get("date") or ""), "sort_key": str(e.get("sort_key") or ""), "event": str(e["event"]),
                        "document_name": s["doc"] if s else None, "page_number": s["page"] if s else None})
    events.sort(key=lambda e: e["sort_key"] or "9999")
    return {"title": str((data or {}).get("title") or "Timeline"), "events": events, "sources": hits}
