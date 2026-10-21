import os
from typing import List, Union
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import field_validator

# Absolute path to backend/.env
ENV_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env")

class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=ENV_PATH,
        env_file_encoding="utf-8",
        extra="ignore"
    )

    HOST: str = "0.0.0.0"
    PORT: int = 8000
    DEBUG: bool = False
    CORS_ORIGINS: Union[List[str], str] = [
        "http://localhost:5173",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:3000",
        "*"
    ]

    # Ollama (local LLM — primary)
    OLLAMA_BASE_URL: str = "http://localhost:11434"
    OLLAMA_GEN_MODEL: str = "qwen2.5:7b"
    OLLAMA_NUM_CTX: int = 8192
    OLLAMA_EMBED_MODEL: str = "nomic-embed-text"

    # Google Gemini (optional, not required when using Ollama)
    GEMINI_API_KEY: str = ""
    EMBEDDING_MODEL: str = "gemini-embedding-001"
    GENERATION_MODEL: str = "gemini-3.7-flash"

    # Pinecone (optional)
    PINECONE_API_KEY: str = ""
    PINECONE_ENVIRONMENT: str = "us-east-1"
    PINECONE_INDEX_NAME: str = "multidoc-rag"

    # Persistence & retrieval
    INDEX_DIR: str = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "index")
    MODEL_CACHE_DIR: str = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "models")
    RERANKER_MODEL: str = "Xenova/ms-marco-MiniLM-L-6-v2"  # empty string disables reranking
    USE_RERANKER: bool = True
    RETRIEVAL_CANDIDATES: int = 20
    ALLOW_GENERAL_KNOWLEDGE: bool = True  # answer non-document questions from general knowledge, clearly labelled
    CACHE_SIMILARITY: float = 0.95  # cosine above which a new question reuses a cached answer

    # Intelligence features
    JURY_MODELS: Union[List[str], str] = ["qwen2.5:7b", "llama3.1:8b"]
    WHISPER_MODEL: str = "base"           # faster-whisper size for voice questions
    OCR_LANGUAGES: str = "eng+hin+mar"    # tesseract languages for images and scanned PDFs
    TELEGRAM_BOT_TOKEN: str = ""          # set to enable the Telegram bot
    TELEGRAM_ADMIN_IDS: Union[List[int], str] = []  # Telegram user IDs allowed to upload documents (/myid shows yours)
    MIN_RELEVANCE: float = 0.02  # reranker score below which a chunk is treated as irrelevant

    # RAG Chunker settings
    CHUNK_SIZE: int = 800
    CHUNK_OVERLAP: int = 150
    TOP_K: int = 4

    @field_validator("JURY_MODELS", mode="before")
    @classmethod
    def split_models(cls, v):
        return [m.strip() for m in v.split(",") if m.strip()] if isinstance(v, str) else v

    @field_validator("TELEGRAM_ADMIN_IDS", mode="before")
    @classmethod
    def split_ids(cls, v):
        if isinstance(v, (int, float)):
            return [int(v)]
        return [int(x) for x in str(v).replace(" ", "").split(",") if x] if isinstance(v, str) else v

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def assemble_cors_origins(cls, v: Union[str, List[str]]) -> List[str]:
        if isinstance(v, str) and not v.startswith("["):
            return [i.strip() for i in v.split(",")]
        elif isinstance(v, str) and v.startswith("["):
            import json
            try:
                return json.loads(v)
            except Exception:
                return ["*"]
        elif isinstance(v, list):
            return v
        return ["*"]

settings = Settings()
