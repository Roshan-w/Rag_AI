from fastapi import APIRouter
from app.api.endpoints.documents import router as documents_router
from app.api.endpoints.query import router as query_router
from app.api.endpoints.health import router as health_router
from app.api.endpoints.chat import router as chat_router
from app.api.endpoints.intel import router as intel_router

api_router = APIRouter(prefix="/api")

api_router.include_router(documents_router)
api_router.include_router(query_router)
api_router.include_router(health_router)
api_router.include_router(chat_router)
api_router.include_router(intel_router)
