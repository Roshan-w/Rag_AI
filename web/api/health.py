"""GET /api/health -> {ok, model}"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _http import Base
from _core import health


class handler(Base):
    def do_GET(self):
        self.json(health())
