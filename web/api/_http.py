"""Small shared request/response helpers for the Vercel Python functions."""
import json
import os
import sys
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(__file__))
from _core import LLMError, UserError  # noqa: E402

MAX_BODY = 4_000_000


class Base(BaseHTTPRequestHandler):
    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > MAX_BODY:
            raise UserError("The request is too large for the online demo.")
        try:
            return json.loads(self.rfile.read(n) or b"{}")
        except ValueError as e:
            raise UserError("Invalid request.") from e

    def json(self, obj, code=200):
        data = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def start_stream(self):
        self.send_response(200)
        self.send_header("Content-Type", "application/x-ndjson; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()

    def emit(self, obj):
        self.wfile.write((json.dumps(obj) + "\n").encode())
        self.wfile.flush()

    def run_json(self, fn):
        """Call fn(payload) and reply with its JSON, mapping errors to readable messages."""
        try:
            self.json(fn(self.body()))
        except UserError as e:
            self.json({"error": str(e)}, 400)
        except LLMError as e:
            self.json({"error": str(e)}, 503)
        except Exception:  # noqa: BLE001
            self.json({"error": "Something went wrong on the server."}, 500)

    def log_message(self, *args):  # keep document text out of logs
        pass
