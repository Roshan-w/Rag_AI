"""
Feedback logging and the self-tuning retrieval loop.

Evaluation set = auto-generated FAQ questions (expected source: their document)
               + 👍-rated answers (expected source: the pages they cited).
Each run scores a small grid of retrieval configurations by Hit@k and MRR and
applies the best one if it beats the current configuration. Runs nightly and on demand.
"""
import os
import json
import time
import logging
import threading
from typing import Any, Dict, List
from app.config import settings
from app.core.registry import DOCUMENT_REGISTRY
from app.core.rag_pipeline import rag_pipeline, TUNING_FILE
from app.core.intelligence import get_insights, _read_json, _write_json

logger = logging.getLogger(__name__)

FEEDBACK_FILE = os.path.join(os.path.dirname(settings.INDEX_DIR), "feedback.jsonl")
REPORT_FILE = os.path.join(settings.INDEX_DIR, "eval_report.json")
_lock = threading.Lock()

# A new configuration must beat the current one by a real margin on enough questions;
# small eval sets otherwise flip settings on noise.
MIN_QUESTIONS = 20
MIN_HIT_GAIN = 0.03
MIN_MRR_GAIN = 0.05

GRID = [{"candidates": c, "use_reranker": r, "top_k": k}
        for c in (10, 20, 30) for r in (True, False) for k in (4,)]


def record_feedback(entry: Dict[str, Any]):
    entry = {**entry, "ts": time.strftime("%Y-%m-%d %H:%M:%S")}
    with _lock:
        os.makedirs(os.path.dirname(FEEDBACK_FILE), exist_ok=True)
        with open(FEEDBACK_FILE, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")


def load_feedback() -> List[Dict[str, Any]]:
    if not os.path.exists(FEEDBACK_FILE):
        return []
    with open(FEEDBACK_FILE, "r", encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def build_eval_set() -> List[Dict[str, Any]]:
    items = []
    for doc_id, doc in DOCUMENT_REGISTRY.items():
        for q in get_insights(doc_id).get("faq", []):
            items.append({"question": q, "expected_docs": [doc.filename], "origin": "faq"})
    for fb in load_feedback():
        if fb.get("rating") == 1 and fb.get("sources"):
            items.append({"question": fb["question"], "expected_docs": sorted({s["document_name"] for s in fb["sources"]}),
                          "origin": "feedback"})
    seen, unique = set(), []
    for it in items:
        if it["question"] not in seen:
            seen.add(it["question"])
            unique.append(it)
    return unique


def _score(config: Dict[str, Any], items: List[Dict[str, Any]], vectors: List[List[float]]) -> Dict[str, Any]:
    hits, rr = 0, 0.0
    for item, vec in zip(items, vectors):
        retrieved = rag_pipeline.retrieve(item["question"], top_k=config["top_k"], query_vector=vec,
                                          candidates=config["candidates"], use_reranker=config["use_reranker"])
        docs = [c.filename for c, _, _ in retrieved]
        rank = next((i + 1 for i, d in enumerate(docs) if d in item["expected_docs"]), None)
        if rank:
            hits += 1
            rr += 1.0 / rank
    n = len(items) or 1
    return {**config, "hit_rate": round(hits / n, 3), "mrr": round(rr / n, 3)}


def run_evaluation(apply: bool = True) -> Dict[str, Any]:
    items = build_eval_set()
    feedback = load_feedback()
    current = {"candidates": settings.RETRIEVAL_CANDIDATES, "use_reranker": settings.USE_RERANKER,
               "top_k": settings.TOP_K}
    report: Dict[str, Any] = {
        "ran_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "questions": len(items),
        "feedback": {"up": sum(1 for f in feedback if f.get("rating") == 1),
                     "down": sum(1 for f in feedback if f.get("rating") == -1)},
        "needs_attention": [f["question"] for f in feedback if f.get("rating") == -1][-10:],
        "cache": rag_pipeline.cache.stats(),
    }
    if not items:
        report.update({"results": [], "current": current, "best": None, "applied": False,
                       "note": "No evaluation questions yet — they appear once document insights are generated."})
        _write_json(REPORT_FILE, report)
        return report

    vectors = [rag_pipeline.embedding_service.embed_query(it["question"]) for it in items]
    results = [_score(cfg, items, vectors) for cfg in GRID]
    baseline = next((r for r in results if all(r[k] == current[k] for k in current)), None) or _score(current, items, vectors)
    best = max(results, key=lambda r: (r["hit_rate"], r["mrr"], r["use_reranker"]))
    improved = len(items) >= MIN_QUESTIONS and (
        best["hit_rate"] - baseline["hit_rate"] >= MIN_HIT_GAIN
        or (best["hit_rate"] >= baseline["hit_rate"] and best["mrr"] - baseline["mrr"] >= MIN_MRR_GAIN))

    if apply and improved:
        settings.RETRIEVAL_CANDIDATES = best["candidates"]
        settings.USE_RERANKER = best["use_reranker"]
        settings.TOP_K = best["top_k"]
        _write_json(TUNING_FILE, {k: best[k] for k in ("candidates", "use_reranker", "top_k")})

    history = _read_json(REPORT_FILE, {}).get("history", [])
    history.append({"ran_at": report["ran_at"], "hit_rate": max(best["hit_rate"], baseline["hit_rate"]),
                    "mrr": max(best["mrr"], baseline["mrr"]), "questions": len(items)})
    report.update({"results": results, "current": current, "baseline": baseline, "best": best,
                   "applied": bool(apply and improved), "history": history[-30:]})
    _write_json(REPORT_FILE, report)
    logger.info(f"Evaluation: baseline hit {baseline['hit_rate']} → best {best['hit_rate']} (applied={report['applied']})")
    return report


def latest_report() -> Dict[str, Any]:
    return _read_json(REPORT_FILE, {})


def start_nightly(interval_hours: float = 24.0):
    def loop():
        while True:
            time.sleep(interval_hours * 3600)
            try:
                run_evaluation(apply=True)
            except Exception as exc:
                logger.error(f"Nightly evaluation failed: {exc}")
    threading.Thread(target=loop, daemon=True, name="nightly-eval").start()
