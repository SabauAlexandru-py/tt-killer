"""Account warmer — N (profile, proxy) pairs scrolled in parallel, rotate + verify per pair.

Fleet concurrency model
-----------------------

Mirrors the creator: one coroutine per (profile, proxy) pair, each owning its own
``AdsPowerClient`` so the 1 req/sec rate limit stays per-coroutine instead of
serialising the fleet. The semaphore caps real concurrency at
``min(len(pairs), MAX_PARALLEL)``; the backstop timeout is high enough to absorb
the full warmup window (``settings.warmup_max_minutes``) plus rotate + verify
overhead — default 1800 s / 30 min.

Rotation (``rotate_between=True``) stays post-warmup here — it's a verification
step confirming the proxy still cycles its IP, not a pre-flight. Each coroutine
runs it on its own pair.
"""
from __future__ import annotations

import asyncio
import logging

import httpx

from ..adspower.browsers import start_browser, stop_browser
from ..adspower.client import AdsPowerClient
from ..adspower.profiles import list_profiles
from ..adspower.proxies import list_proxies
from ..adspower.schemas import Proxy, ProfileSummary
from ..automation.browser import connect
from ..automation.ip_check import current_ip
from ..automation.tiktok_warmup import warmup
from ..config import get_settings
from .state import AccountResult, Run, touch_run

logger = logging.getLogger(__name__)


async def _rotate_and_verify(
    proxy: Proxy,
    before_ip: str,
    api: AdsPowerClient,
    profile_id: str,
) -> tuple[str, bool]:
    """Hit the proxy's rotation URL, then reopen the profile to confirm the IP changed."""
    if not proxy.rotation_url:
        return before_ip, False
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            await client.get(proxy.rotation_url)
    except httpx.HTTPError as exc:
        logger.warning("Proxy rotation for %s failed: %s", proxy.proxy_id, exc)
        return before_ip, False
    await asyncio.sleep(5)

    info = await start_browser(api, profile_id)
    if not info.cdp_endpoint:
        return before_ip, False
    bundle = await connect(info.cdp_endpoint)
    try:
        new_ip = await current_ip(bundle.page)
        return new_ip, new_ip != before_ip
    finally:
        await bundle.close()
        try:
            await stop_browser(api, profile_id)
        except Exception:
            pass


def _pair_profiles_to_proxies(
    profiles: list[ProfileSummary],
    proxies: list[Proxy],
) -> list[tuple[ProfileSummary, Proxy]]:
    by_id = {p.proxy_id: p for p in proxies}
    pairs: list[tuple[ProfileSummary, Proxy]] = []
    for prof in profiles:
        cfg = prof.user_proxy_config or {}
        pid = cfg.get("proxy_id")
        proxy = by_id.get(str(pid)) if pid else None
        if proxy is not None:
            pairs.append((prof, proxy))
    return pairs


async def _warm_one(
    *,
    run: Run,
    profile: ProfileSummary,
    proxy: Proxy,
    result: AccountResult,
    rotate: bool,
    sem: asyncio.Semaphore,
    timeout_s: float,
) -> None:
    """Drive one (profile, proxy) through warmup + optional rotation, writing onto ``result``.

    Never re-raises outside ``CancelledError``: every other failure lands on
    ``result.status`` / ``result.error`` so gather returns clean and the SSE stream
    keeps flowing for the rest of the fleet.
    """
    async with sem:
        result.status = "running"
        touch_run(run)
        # Fresh AdsPower client per coroutine so the 1 req/sec throttle is local to
        # this pair, not shared across the fleet.
        async with AdsPowerClient() as api:
            try:
                async with asyncio.timeout(timeout_s):
                    info = await start_browser(api, profile.user_id)
                    if not info.cdp_endpoint:
                        raise RuntimeError("AdsPower returned no CDP endpoint on browser start.")

                    bundle = await connect(info.cdp_endpoint)
                    try:
                        result.ip_before = await current_ip(bundle.page)
                    finally:
                        await bundle.close()

                    warm = await warmup(cdp_endpoint=info.cdp_endpoint, profile_id=profile.user_id)
                    result.screenshots = warm.screenshots
                    if warm.error:
                        result.status = "failed"
                        result.error = warm.error
                    else:
                        result.status = "complete"

                    try:
                        await asyncio.shield(stop_browser(api, profile.user_id))
                    except Exception as close_exc:
                        logger.warning(
                            "stop_browser(%s) failed after warmup: %s",
                            profile.user_id,
                            close_exc,
                        )

                    if rotate and result.status == "complete" and result.ip_before:
                        new_ip, changed = await _rotate_and_verify(
                            proxy, result.ip_before, api, profile.user_id
                        )
                        result.ip_after = new_ip
                        if not changed:
                            result.error = (
                                "Proxy rotation did not change IP. Check the rotation URL in "
                                "proxies_config.json."
                            )
            except asyncio.TimeoutError:
                result.status = "failed"
                result.error = f"Warmup timed out after {timeout_s:.0f}s (per-account backstop)."
                try:
                    await asyncio.shield(stop_browser(api, profile.user_id))
                except Exception:
                    pass
            except asyncio.CancelledError:
                result.status = "failed"
                result.error = "Run cancelled."
                try:
                    await asyncio.shield(stop_browser(api, profile.user_id))
                except Exception:
                    pass
                raise
            except Exception as exc:
                result.status = "failed"
                result.error = str(exc)
                try:
                    await asyncio.shield(stop_browser(api, profile.user_id))
                except Exception:
                    pass
            finally:
                touch_run(run)


async def warmup_accounts_run(
    run: Run,
    *,
    profile_ids: list[str] | None,
    rotate_between: bool,
    max_parallel: int | None = None,
) -> None:
    """Dispatch a warmup run across N (profile, proxy) pairs in parallel.

    ``max_parallel`` overrides ``settings.max_parallel_signups`` (shared cap with
    the creator — warmup contention on AdsPower is of the same shape as signup).
    Effective concurrency is clamped to ``min(len(pairs), max_parallel)``.
    """
    settings = get_settings()
    requested_cap = max_parallel if max_parallel is not None else settings.max_parallel_signups
    requested_cap = max(1, min(32, int(requested_cap)))
    timeout_s = settings.per_warmup_timeout_seconds

    try:
        async with AdsPowerClient() as api:
            all_profiles = await list_profiles(api, page_size=500)
            all_proxies = await list_proxies(api)

        if profile_ids:
            wanted = set(profile_ids)
            selected = [p for p in all_profiles if p.user_id in wanted]
        else:
            selected = list(all_profiles)

        pairs = _pair_profiles_to_proxies(selected, all_proxies)
        if not pairs:
            run.mark(
                "failed",
                "No profile/proxy pairs found. Make sure your profiles have proxies attached.",
            )
            return

        run.results = [
            AccountResult(
                proxy_id=proxy.proxy_id,
                profile_id=profile.user_id,
                profile_name=profile.name or profile.user_id,
            )
            for profile, proxy in pairs
        ]
        touch_run(run)

        effective_cap = min(len(pairs), requested_cap)
        sem = asyncio.Semaphore(effective_cap)
        logger.info(
            "warmup_accounts_run %s: fleet=%d, parallel_cap=%d, timeout=%.0fs, rotate=%s",
            run.run_id,
            len(pairs),
            effective_cap,
            timeout_s,
            rotate_between,
        )

        tasks = [
            _warm_one(
                run=run,
                profile=profile,
                proxy=proxy,
                result=run.results[idx],
                rotate=rotate_between,
                sem=sem,
                timeout_s=timeout_s,
            )
            for idx, (profile, proxy) in enumerate(pairs)
        ]

        await asyncio.gather(*tasks, return_exceptions=True)

        run.mark("complete")
    except asyncio.CancelledError:
        run.mark("failed", "Run cancelled.")
        raise
    except Exception as exc:
        run.mark("failed", str(exc))
