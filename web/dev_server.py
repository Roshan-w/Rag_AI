"""Local preview of the Vercel site: python web/dev_server.py  ->  http://localhost:3000"""
import importlib
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "api"))
API = {name: importlib.import_module(name).handler for name in ("ask", "audit", "insights", "timeline", "health")}
HELPERS = ("body", "json", "start_stream", "emit", "run_json")


class Dev(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=HERE, **kw)

    def _api(self, method):
        name = self.path.split("?")[0].strip("/").split("/")[-1]
        h = API.get(name)
        if h is None or not hasattr(h, method):
            return self.send_error(404)
        for attr in HELPERS:
            setattr(self, attr, getattr(h, attr).__get__(self))
        return getattr(h, method)(self)

    def do_GET(self):
        if self.path.startswith("/api/"):
            return self._api("do_GET")
        if self.path.split("?")[0] == "/app":  # mirror Vercel cleanUrls
            self.path = "/app.html"
        return super().do_GET()

    def do_POST(self):
        if self.path.startswith("/api/"):
            return self._api("do_POST")
        return self.send_error(404)


if __name__ == "__main__":
    port = int(os.getenv("PORT", "3000"))
    print(f"Serving on http://localhost:{port}")
    ThreadingHTTPServer(("127.0.0.1", port), Dev).serve_forever()
