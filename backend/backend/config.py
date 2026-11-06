"""Backend configuration loaded from .env via pydantic-settings.

Mission Control runs locally by default: 127.0.0.1:8080, with CORS opened only
to the origins the frontend actually ships from. Anything the operator needs to
override at runtime goes through BACKEND_* env vars.
"""

from __future__ import annotations

from pathlib import Path
from typing import List

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


_DEFAULT_ORIGINS: tuple[str, ...] = (
    "http://localhost:3000",
    "https://*.vercel.app",
    "https://*.trycloudflare.com",
)


class BackendSettings(BaseSettings):
    """Runtime settings for the FastAPI bridge."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        env_prefix="BACKEND_",
        extra="ignore",
        case_sensitive=False,
    )

    host: str = "127.0.0.1"
    port: int = 8080
    allowed_origins: List[str] = Field(default_factory=lambda: list(_DEFAULT_ORIGINS))
    data_dir: str = "./data"
    log_level: str = "INFO"

    @field_validator("allowed_origins", mode="before")
    @classmethod
    def _split_origins(cls, raw: object) -> List[str]:
        """Accept a comma-separated string from env or a real list from code."""

        if raw is None or raw == "":
            return list(_DEFAULT_ORIGINS)
        if isinstance(raw, str):
            parts = [item.strip() for item in raw.split(",") if item.strip()]
            return parts or list(_DEFAULT_ORIGINS)
        if isinstance(raw, (list, tuple)):
            return [str(item) for item in raw if str(item).strip()]
        raise TypeError(f"Unsupported allowed_origins value: {raw!r}")

    @property
    def data_path(self) -> Path:
        """Resolve the runtime state directory."""

        return Path(self.data_dir).expanduser().resolve()


_settings: BackendSettings | None = None


def get_settings() -> BackendSettings:
    """Return a lazily-created settings singleton."""

    global _settings
    if _settings is None:
        _settings = BackendSettings()
        _settings.data_path.mkdir(parents=True, exist_ok=True)
    return _settings
