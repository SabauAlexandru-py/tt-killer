"""Account creator orchestrator — N proxies → N 'TikTok Acc #k' → N parallel signups.

Fleet concurrency model
-----------------------

Before V2 this loop was sequential: one account at a time, serialised by AdsPower's
1 req/sec throttle on a shared client. That turned a 10-account batch into ~a 10×
multiplier on wall time even when every proxy was healthy and ready to go.

V2 makes it parallel:

* Each per-account coroutine owns its **own** ``AdsPowerClient``. The client's 1 req/sec
  rate-limit lock is per-instance, so a separate instance per coroutine means each
  account can issue AdsPower calls independently instead of queuing behind the fleet.
* An ``asyncio.Semaphore`` sized to ``min(len(proxies), MAX_PARALLEL)`` caps real
  concurrency. ``MAX_PARALLEL`` reads from ``settings.max_parallel_signups`` (env
  ``MAX_PARALLEL_SIGNUPS``, default 10), overridable per request.
* Each coroutine wraps its body in ``asyncio.timeout(per_account_timeout_seconds)``
  — default 420 s (7 min) — so a stuck Playwright/CDP call releases the semaphore
  instead of holding it for the rest of the run.
* ``AccountResult`` entries are allocated in input order and never reshuffled, so
  the SSE stream and the frontend grid keep a stable idx ↔ proxy mapping.
* Rotation (``rotate_between=True``) runs **inside** each coroutine, before the
  signup call. Under parallel execution there's no "first" vs "subsequent" ordering
  to lean on; rotating per proxy before signup is the only semantic that keeps
  parallel and sequential behaviour consistent for the operator.
"""
from __future__ import annotations

import asyncio
import logging
import random

import httpx

from ..adspower.browsers import start_browser, stop_browser
from ..adspower.client import AdsPowerClient
from ..adspower.profiles import create_profile_for_proxy
from ..adspower.proxies import list_proxies
from ..adspower.schemas import Proxy
from ..automation.tiktok_signup import signup
from ..config import get_settings
from .state import AccountResult, Run, touch_run

logger = logging.getLogger(__name__)


async def _trigger_rotation(proxy: Proxy) -> None:
    """Hit the mobile proxy's rotation URL (if we have one) to cycle the IP.

    Fire-and-forget: rotation failure is noisy at the log level but never fatal —
    the signup still runs on whatever IP the proxy is currently on.
    """
    if not proxy.rotation_url:
        return
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            await client.get(proxy.rotation_url)
    except httpx.HTTPError as exc:
        logger.warning("Proxy rotation for %s failed: %s", proxy.proxy_id, exc)


async def _signup_one(
    *,
    run: Run,
    proxy: Proxy,
    result: AccountResult,
    birth_year: int,
    rotate: bool,
    sem: asyncio.Semaphore,
    timeout_s: float,
) -> None:
    """Drive one profile → one browser → one signup, writing state back onto ``result``.

    Never re-raises: every failure is captured on ``result.status`` / ``result.error``
    so ``asyncio.gather`` sees a clean coroutine and the SSE stream keeps flowing for
    the rest of the fleet.
    """
    async with sem:
        result.status = "running"
        touch_run(run)
        # A fresh AdsPower client per coroutine so each account has its own 1 req/sec
        # budget. Sharing one client across the fleet would serialise every call.
        async with AdsPowerClient() as api:
            try:
                async with asyncio.timeout(timeout_s):
                    # Rotation lives inside the coroutine so each proxy cycles its own IP
                    # before its own signup, regardless of what the rest of the fleet is doing.
                    if rotate:
                        await _trigger_rotation(proxy)
                        # Small settle window so the rotated IP is live before DNS resolves.
                        await asyncio.sleep(3)

                    profile_id = await create_profile_for_proxy(
                        api,
                        name=result.profile_name,
                        proxy_id=proxy.proxy_id,
                    )
                    result.profile_id = profile_id
                    touch_run(run)

                    browser_info = await start_browser(api, profile_id)
                    if not browser_info.cdp_endpoint:
                        raise RuntimeError("AdsPower returned no CDP endpoint on browser start.")

                    try:
                        signup_result = await signup(
                            cdp_endpoint=browser_info.cdp_endpoint,
                            profile_id=profile_id,
                            profile_name=result.profile_name,
                            proxy_id=proxy.proxy_id,
                            birth_year=birth_year,
                            birth_month=random.randint(1, 12),
                            birth_day=random.randint(1, 28),
                        )
                    finally:
                        # Shield the browser close so an outer cancellation / timeout still
                        # lets us release the AdsPower-side Chrome window — leaking Chrome
                        # instances is the one failure mode that ruins the next run.
                        try:
                            await asyncio.shield(stop_browser(api, profile_id))
                        except Exception as close_exc:
                            logger.warning(
                                "stop_browser(%s) failed after signup: %s",
                                profile_id,
                                close_exc,
                            )

                    result.screenshots = signup_result.screenshots
                    if signup_result.error:
                        result.status = "failed"
                        result.error = signup_result.error
                    else:
                        result.account = signup_result.account
                        result.status = "complete"
            except asyncio.TimeoutError:
                result.status = "failed"
                result.error = f"Signup timed out after {timeout_s:.0f}s (per-account backstop)."
                if result.profile_id:
                    try:
                        await asyncio.shield(stop_browser(api, result.profile_id))
                    except Exception:
                        pass
            except asyncio.CancelledError:
                # Operator cancelled the run. Surface the state and re-raise so the
                # parent task_cancel contract isn't broken.
                result.status = "failed"
                result.error = "Run cancelled."
                if result.profile_id:
                    try:
                        await asyncio.shield(stop_browser(api, result.profile_id))
                    except Exception:
                        pass
                raise
            except Exception as exc:
                result.status = "failed"
                result.error = str(exc)
                if result.profile_id:
                    try:
                        await asyncio.shield(stop_browser(api, result.profile_id))
                    except Exception:
                        pass
            finally:
                touch_run(run)


async def create_accounts_run(
    run: Run,
    *,
    proxy_ids: list[str] | None,
    name_prefix: str | None,
    rotate_between: bool | None,
    birth_year: int | None,
    max_parallel: int | None = None,
) -> None:
    """Dispatch a create-accounts run across N proxies in parallel.

    ``max_parallel`` overrides the env default ``settings.max_parallel_signups``.
    Effective concurrency is clamped to ``min(len(picked_proxies), max_parallel)``
    so a fleet of 4 proxies with max_parallel=10 only ever spawns 4 workers.
    """
    settings = get_settings()
    prefix = name_prefix or settings.tiktok_profile_name_prefix
    rotate = settings.rotate_proxy_between_accounts if rotate_between is None else rotate_between
    year = birth_year or settings.tiktok_default_birth_year

    requested_cap = max_parallel if max_parallel is not None else settings.max_parallel_signups
    # Defensive clamp: Pydantic validates the request body, but the function is also
    # callable directly from MCP tools / tests where no validator runs.
    requested_cap = max(1, min(32, int(requested_cap)))
    timeout_s = settings.per_account_timeout_seconds

    try:
        # One-off listing uses its own short-lived client so the per-coroutine clients
        # below never share the 1 req/sec lock with the orchestrator's setup phase.
        async with AdsPowerClient() as api:
            proxies = await list_proxies(api)

        if proxy_ids:
            wanted = set(proxy_ids)
            picked = [p for p in proxies if p.proxy_id in wanted]
        else:
            picked = list(proxies)

        if not picked:
            run.mark("failed", "No proxies found. Add proxies to AdsPower's Proxy Manager first.")
            return

        # Results are ordered by original proxy index — the SSE stream and frontend grid
        # key off idx, so this must stay deterministic.
        run.results = [
            AccountResult(
                proxy_id=p.proxy_id,
                profile_id=None,
                profile_name=f"{prefix} #{idx + 1}",
            )
            for idx, p in enumerate(picked)
        ]
        touch_run(run)

        effective_cap = min(len(picked), requested_cap)
        sem = asyncio.Semaphore(effective_cap)
        logger.info(
            "create_accounts_run %s: fleet=%d, parallel_cap=%d, timeout=%.0fs, rotate=%s",
            run.run_id,
            len(picked),
            effective_cap,
            timeout_s,
            rotate,
        )

        tasks = [
            _signup_one(
                run=run,
                proxy=proxy,
                result=run.results[idx],
                birth_year=year,
                rotate=rotate,
                sem=sem,
                timeout_s=timeout_s,
            )
            for idx, proxy in enumerate(picked)
        ]

        # return_exceptions=True keeps one bad coroutine from poisoning the gather —
        # though _signup_one is written to catch everything except CancelledError, so
        # this is a belt-and-braces backstop.
        await asyncio.gather(*tasks, return_exceptions=True)

        run.mark("complete")
    except asyncio.CancelledError:
        run.mark("failed", "Run cancelled.")
        raise
    except Exception as exc:
        run.mark("failed", str(exc))
