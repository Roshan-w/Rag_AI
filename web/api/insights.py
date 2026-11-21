"""POST /api/insights {doc: {name, pages}} -> {summary, faq, quiz}"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _http import Base
from _core import UserError, insights, parse_docs


def run(p):
    docs = parse_docs({"docs": [p.get("doc") or {}]})
    if not docs:
        raise UserError("That document has no readable text.")
    return insights(docs[0])


class handler(Base):
    def do_POST(self):
        self.run_json(run)
