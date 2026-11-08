"""Runtime configuration loaded from environment variables (see .env.example)."""
import os

from dotenv import load_dotenv

load_dotenv()


def _bool(name: str, default: bool) -> bool:
    return os.getenv(name, str(default)).strip().lower() in {"1", "true", "yes", "on"}


class Config:
    MONGODB_URI = os.getenv("MONGODB_URI", "").strip()
    MONGODB_DB = os.getenv("MONGODB_DB", "block_around_the_clock")

    NVIDIA_API_KEY = os.getenv("NVIDIA_API_KEY", "").strip()
    NVIDIA_BASE_URL = os.getenv("NVIDIA_BASE_URL", "https://integrate.api.nvidia.com/v1").rstrip("/")
    NEMOTRON_MODEL = os.getenv("NEMOTRON_MODEL", "nvidia/nemotron-3.5-lightning-30b-a3b")
    NEMOTRON_TIMEOUT_SECONDS = float(os.getenv("NEMOTRON_TIMEOUT_SECONDS", "30"))

    TOKENIZATION_SECRET = os.getenv("TOKENIZATION_SECRET", "dev-only-tokenization-secret")
    CONTAINMENT_STEP_SECONDS = float(os.getenv("CONTAINMENT_STEP_SECONDS", "1.6"))
    SIMULATE_ADAPTER_FAILURE = _bool("SIMULATE_ADAPTER_FAILURE", True)
    SEED_ON_START = _bool("SEED_ON_START", True)

    CORS_ORIGINS = [o.strip() for o in os.getenv(
        "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",") if o.strip()]
    PORT = int(os.getenv("PORT", "5050"))
