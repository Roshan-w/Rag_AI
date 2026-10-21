import logging
import os
import socket
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from app.config import settings
from app.api.router import api_router
from app.api.endpoints.documents import load_demo_documents

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - [%(levelname)s] - %(name)s - %(message)s"
)
logger = logging.getLogger("RAGApplication")

# Built frontend (frontend/dist) — served by this same server so the whole app
# lives on one host/port and is reachable from any PC on the network.
FRONTEND_DIST = os.path.normpath(
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "..", "frontend", "dist")
)


def _local_ips() -> list:
    """Every usable IPv4 address of this machine, so the right one can be shared.

    A single "best" guess is unreliable here: the machine has several adapters
    (Wi-Fi, Ethernet, virtual) and the route to the internet is not necessarily
    the interface other PCs on the campus network use to reach us.
    """
    ips = []
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            ips.append(s.getsockname()[0])
    except Exception:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if ip not in ips and not ip.startswith(("127.", "169.254.")):
                ips.append(ip)
    except Exception:
        pass
    return ips or ["<this-machine-ip>"]


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting RAG.AI Backend Service (Ollama mode)...")
    logger.info(f"LLM Model   : {settings.OLLAMA_GEN_MODEL} via {settings.OLLAMA_BASE_URL}")
    logger.info(f"Embed Model : {settings.OLLAMA_EMBED_MODEL} via {settings.OLLAMA_BASE_URL}")
    load_demo_documents()
    from app.core.intelligence import insights_worker
    from app.core import evaluation, telegram_bot
    insights_worker.start()
    evaluation.start_nightly()
    telegram_bot.start()
    for ip in _local_ips():
        logger.info(f"Reachable on the network at: http://{ip}:{settings.PORT}")
    yield
    logger.info("Shutting down RAG.AI Backend Service...")

app = FastAPI(
    title="RAG.AI API",
    description="Document Intelligence API — Grounded answers with source citations powered by local AI (Ollama)",
    version="2.0.0",
    lifespan=lifespan
)

# CORS Configuration
origins = settings.CORS_ORIGINS if isinstance(settings.CORS_ORIGINS, list) else ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins if "*" not in origins else ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)

@app.get("/api")
def api_root():
    return {
        "name": "RAG.AI API",
        "status": "operational",
        "docs": "/docs",
        "health": "/api/health"
    }


_index_file = os.path.join(FRONTEND_DIST, "index.html")
if os.path.isfile(_index_file):
    _assets_dir = os.path.join(FRONTEND_DIST, "assets")
    if os.path.isdir(_assets_dir):
        app.mount("/assets", StaticFiles(directory=_assets_dir), name="assets")

    @app.get("/{full_path:path}")
    def serve_frontend(full_path: str):
        # Serve real files (favicon, output.css, ...) and fall back to the SPA entry point.
        candidate = os.path.normpath(os.path.join(FRONTEND_DIST, full_path))
        if candidate.startswith(FRONTEND_DIST) and os.path.isfile(candidate):
            return FileResponse(candidate)
        return FileResponse(_index_file)
else:
    logger.warning("frontend/dist not built — run 'npm run build' in frontend/ to serve the UI from this server.")

    @app.get("/")
    def root():
        return {
            "name": "RAG.AI API",
            "status": "operational",
            "docs": "/docs",
            "health": "/api/health"
        }
