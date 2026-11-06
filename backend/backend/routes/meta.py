"""Meta endpoints — health probe and AdsPower reachability.

The frontend Settings page pins a HealthBadge to the top bar that polls
``/api/health`` every 10s. The Settings page also calls ``/api/adspower/status``
when the operator presses the "test connection" button. Both share the same
AdsPower ping (``/api/v1/user/list?page_size=1``) so the badge and the detail
view never disagree.

Both endpoints are deliberately small, side-effect free, and safe to call from
any context — they never block longer than 3 seconds and never raise.
"""

from __future__ import annotations

import time
from typing import Any

import httpx
from fastapi import APIRouter

from adspower_mcp.config import get_settings as get_adspower_settings

from .. import bridge


router = APIRouter(tags=["meta"])


_SUGGESTED_CONCURRENCY_CEILING = 10


BACKEND_VERSION = "0.1.0"
_PING_TIMEOUT_SECONDS = 3.0
_PING_PATH = "/api/v1/user/list"
_PING_PARAMS: dict[str, Any] = {"page_size": 1}


async def _ping_adspower() -> tuple[bool, int | None, str | None]:
    """Hit AdsPower's lightest list endpoint with a 3s cap.

    Returns ``(reachable, latency_ms, error)``. ``reachable`` is True only when
    AdsPower answered with HTTP 200 AND an application-level ``code == 0``
    (its "success" convention). Anything else — timeout, connection refused,
    DNS failure, non-200, or ``code != 0`` — surfaces as ``reachable=False``
    with a short human-readable error string.
    """

    settings = get_adspower_settings()
    base_url = settings.adspower_base_url.rstrip("/")
    url = f"{base_url}{_PING_PATH}"

    start = time.perf_counter()
    try:
        async with httpx.AsyncClient(timeout=_PING_TIMEOUT_SECONDS) as client:
            response = await client.get(url, params=_PING_PARAMS)
    except httpx.TimeoutException:
        return False, None, f"timeout after {_PING_TIMEOUT_SECONDS:.0f}s"
    except httpx.ConnectError as exc:
        return False, None, f"connection refused: {exc}"
    except httpx.HTTPError as exc:
        return False, None, f"http error: {exc.__class__.__name__}"
    except Exception as exc:  # noqa: BLE001 — last-resort guard for the probe
        return False, None, f"unexpected: {exc.__class__.__name__}"

    latency_ms = int((time.perf_counter() - start) * 1000)

    if response.status_code != 200:
        return False, latency_ms, f"http {response.status_code}"

    try:
        payload = response.json()
    except ValueError:
        return False, latency_ms, "non-json response"

    code = payload.get("code") if isinstance(payload, dict) else None
    if code != 0:
        message = payload.get("msg") if isinstance(payload, dict) else None
        detail = str(message) if message else f"adspower code={code}"
        return False, latency_ms, detail

    return True, latency_ms, None


@router.get("/health")
async def health() -> dict[str, Any]:
    """Liveness + AdsPower reachability in one shot.

    Shape locked by DESIGN_SPEC.md:
        ``{"ok": True, "version": "0.1.0", "adspower_reachable": bool}``

    ``ok`` is always True — if the backend itself is down, the frontend
    sees a network error, not a False payload.
    """

    reachable, _latency, _error = await _ping_adspower()
    return {
        "ok": True,
        "version": BACKEND_VERSION,
        "adspower_reachable": reachable,
    }


@router.get("/capacity")
async def capacity() -> dict[str, Any]:
    """Ceiling values for the Dashboard N-accounts selector.

    Shape:
        ``{"proxies": N, "profiles": M, "suggested_concurrency": min(N, 10)}``

    - ``proxies`` is the row count of the local proxy store. Does not hit
      AdsPower, so the N-selector keeps working while AdsPower is down or the
      operator's friend hasn't pasted an API key yet (DESIGN_BRIEF_V2 §5).
    - ``profiles`` is the AdsPower profile count via the Local API. When
      AdsPower is unreachable, returns 0 instead of propagating the error —
      capacity is informational; the dashboard uses ``/health`` for the
      reachability dot.
    - ``suggested_concurrency`` is ``min(proxies, 10)``. The hard concurrency
      cap (default 8, max 32) lives in settings; this is the friendly hint the
      selector surfaces as its default upper bound.
    """

    proxies = bridge.count_stored_proxies()
    profiles = 0
    client: bridge.AdsPowerClient | None = None
    try:
        client = bridge.AdsPowerClient()
        profile_rows = await bridge.list_profiles(client)
        profiles = len(profile_rows) if profile_rows is not None else 0
    except Exception:  # noqa: BLE001 — capacity is best-effort, never 5xx
        profiles = 0
    finally:
        if client is not None:
            try:
                await client.aclose()
            except Exception:  # noqa: BLE001 — teardown must not raise
                pass

    return {
        "proxies": proxies,
        "profiles": profiles,
        "suggested_concurrency": min(proxies, _SUGGESTED_CONCURRENCY_CEILING),
    }


@router.get("/adspower/status")
async def adspower_status() -> dict[str, Any]:
    """Detailed AdsPower probe — latency and error string.

    Shape locked by DESIGN_SPEC.md:
        ``{"reachable": bool, "latency_ms": int|None, "error": str|None}``

    ``latency_ms`` is reported whenever a response came back at all, even on
    an application-level failure, so the Settings page can show "answered in
    42 ms but refused the ping" instead of a blank gauge.
    """

    reachable, latency_ms, error = await _ping_adspower()
    return {
        "reachable": reachable,
        "latency_ms": latency_ms,
        "error": error,
    }
