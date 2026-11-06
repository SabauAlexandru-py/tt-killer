from __future__ import annotations

import asyncio
import time
from typing import Any

import httpx

from ..config import get_settings
from .schemas import AdsPowerResponse


class AdsPowerError(RuntimeError):
    def __init__(self, message: str, *, code: int | None = None, payload: Any = None) -> None:
        super().__init__(message)
        self.code = code
        self.payload = payload


class AdsPowerClient:
    """Shared HTTP wrapper for AdsPower's Local API (localhost:50325).

    AdsPower throttles the Local API to 1 req/sec; this client serialises every call behind a
    per-instance lock so concurrent tool invocations don't trip the throttle.
    """

    def __init__(self) -> None:
        settings = get_settings()
        self._throttle = settings.adspower_throttle_seconds
        self._client = httpx.AsyncClient(
            base_url=settings.adspower_base_url.rstrip("/"),
            timeout=settings.adspower_request_timeout_seconds,
            headers=self._headers(settings.adspower_api_key),
        )
        self._lock = asyncio.Lock()
        self._last_call_at: float = 0.0

    @staticmethod
    def _headers(api_key: str | None) -> dict[str, str]:
        headers = {"Accept": "application/json"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        return headers

    async def aclose(self) -> None:
        await self._client.aclose()

    async def __aenter__(self) -> "AdsPowerClient":
        return self

    async def __aexit__(self, *exc: Any) -> None:
        await self.aclose()

    async def request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json: dict[str, Any] | None = None,
    ) -> AdsPowerResponse:
        async with self._lock:
            delta = time.monotonic() - self._last_call_at
            if delta < self._throttle:
                await asyncio.sleep(self._throttle - delta)
            try:
                response = await self._client.request(method, path, params=params, json=json)
            except httpx.HTTPError as exc:
                raise AdsPowerError(
                    f"AdsPower API transport error for {method} {path}: {exc}. "
                    "Confirm the AdsPower desktop client is running and base_url is reachable."
                ) from exc
            self._last_call_at = time.monotonic()

        try:
            data = response.json()
        except ValueError as exc:
            raise AdsPowerError(
                f"AdsPower returned non-JSON (HTTP {response.status_code}): {response.text[:200]}"
            ) from exc

        envelope = AdsPowerResponse.model_validate(data)
        if not envelope.ok:
            raise AdsPowerError(
                f"AdsPower {path} failed (code={envelope.code}): {envelope.msg}",
                code=envelope.code,
                payload=envelope.data,
            )
        return envelope
