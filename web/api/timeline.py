"""POST /api/timeline {question, docs} -> {title, events, sources}"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _http import Base
from _core import Library, UserError, parse_docs, timeline


def run(p):
    q = str(p.get("question") or "").strip() or "important dates and deadlines"
    if len(q) > 600:
        raise UserError("Keep the topic under 600 characters.")
    return timeline(q, Library(parse_docs(p)))


class handler(Base):
    def do_POST(self):
        self.run_json(run)
