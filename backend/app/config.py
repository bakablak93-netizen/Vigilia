"""Application configuration loaded from environment variables."""

from functools import lru_cache
from pathlib import Path
from typing import List

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[1]
DEFAULT_DB_PATH = (BACKEND_DIR / "vigilia.db").as_posix()


class Settings(BaseSettings):
    """Runtime settings for the VIGILIA 2.0 laboratory backend."""

    app_name: str = "VIGILIA 2.0 — Intelligent Bank Defense Laboratory"
    app_version: str = "2.0.0"
    database_url: str = f"sqlite:///{DEFAULT_DB_PATH}"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    max_transactions: int = 10000
    max_customers: int = 2000
    max_benchmark_seeds: int = 15

    # Optional external LLM settings (never hardcoded; empty means deterministic analyst only)
    llm_api_key: str = ""
    llm_base_url: str = ""
    llm_model: str = ""

    model_config = SettingsConfigDict(
        env_prefix="VIGILIA_",
        env_file=".env",
        extra="ignore",
    )

    @property
    def cors_origin_list(self) -> List[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def llm_configured(self) -> bool:
        return bool(self.llm_api_key.strip() and self.llm_base_url.strip())


@lru_cache
def get_settings() -> Settings:
    return Settings()
