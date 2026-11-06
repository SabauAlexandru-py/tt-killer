from __future__ import annotations

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # AdsPower Local API
    adspower_base_url: str = Field(default="http://local.adspower.net:50325")
    adspower_api_key: str | None = None
    adspower_throttle_seconds: float = Field(default=1.1, ge=0.0)
    adspower_request_timeout_seconds: float = Field(default=20.0, ge=1.0, le=120.0)

    # Email signup
    email_code_timeout_seconds: float = Field(default=180.0, ge=10.0)

    # SadCaptcha (TikTok puzzle solver; Python lib, no extension needed)
    sadcaptcha_api_key: str | None = None

    # TikTok
    tiktok_profile_name_prefix: str = "TikTok Acc"
    tiktok_default_birth_year: int = 1996

    # Warmup
    warmup_min_minutes: int = Field(default=15, ge=1, le=120)
    warmup_max_minutes: int = Field(default=20, ge=1, le=120)
    warmup_scroll_min_delay_seconds: float = Field(default=5.0, ge=0.5)
    warmup_scroll_max_delay_seconds: float = Field(default=15.0, ge=0.5)
    rotate_proxy_between_accounts: bool = True

    # Parallel signup/warmup fleet.
    #
    # Each per-account coroutine owns its own AdsPowerClient so the client's 1 req/sec
    # throttle is per-coroutine, not per-fleet. The semaphore is the only thing holding
    # back real concurrency — set it to min(len(proxies), MAX_PARALLEL) at run start.
    # 32 is a hard ceiling; past that, Playwright + Chrome contention on consumer boxes
    # starts eating wins. 10 is the sane default a mobile-proxy farm actually ships.
    max_parallel_signups: int = Field(default=10, ge=1, le=32)
    # Hard per-account backstop so a stuck Playwright page doesn't squat the semaphore
    # for the rest of the run. Creator (signup flow): default 7 minutes.
    per_account_timeout_seconds: float = Field(default=420.0, ge=30.0, le=3600.0)
    # Warmup runs 15-20 min of scroll by design, plus rotate + IP verify overhead,
    # so its backstop is set well above the warmup_max_minutes ceiling.
    per_warmup_timeout_seconds: float = Field(default=1800.0, ge=60.0, le=7200.0)

    # Diagnostics
    screenshots_dir: str = "./screenshots"
    run_state_dir: str = "./state"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
