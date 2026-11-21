"""POST /api/audit {answer, sources} -> {claims, faithfulness}"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _http import Base
from _core import audit


class handler(Base):
    def do_POST(self):
        self.run_json(lambda p: audit(str(p.get("answer") or ""), [s for s in (p.get("sources") or []) if isinstance(s, dict)][:10]))
