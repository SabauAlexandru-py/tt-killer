"""Warmup scroller.

Opens the profile's Chrome via CDP, lands on the For You feed, then scrolls for a random total
duration (WARMUP_MIN_MINUTES..WARMUP_MAX_MINUTES) with 5-15s jitter between swipes. Occasionally
likes a video to make the session look less bot-like.
"""
from __future__ import annotations

import asyncio
import random
import time
from dataclasses import dataclass
from pathlib import Path

from playwright.async_api import Page

from ..config import get_settings
from .browser import ConnectedBrowser, connect


@dataclass
class WarmupResult:
    profile_id: str
    scrolls: int
    duration_seconds: float
    screenshots: list[str]
    error: str | None = None


async def _wander(page: Page) -> None:
    """One scroll gesture + maybe a like."""
    # Use JS wheel event — more reliable than mouse.wheel against TikTok's virtualised feed.
    await page.evaluate("window.scrollBy({ top: window.innerHeight, behavior: 'smooth' })")
    if random.random() < 0.08:
        try:
            await page.keyboard.press("l")  # TikTok's keyboard shortcut for like
        except Exception:
            pass


async def warmup(*, cdp_endpoint: str, profile_id: str) -> WarmupResult:
    settings = get_settings()
    out_dir = Path(settings.screenshots_dir).expanduser() / profile_id
    out_dir.mkdir(parents=True, exist_ok=True)
    shots: list[str] = []

    minutes = random.uniform(settings.warmup_min_minutes, settings.warmup_max_minutes)
    duration = minutes * 60
    deadline = time.monotonic() + duration

    bundle: ConnectedBrowser | None = None
    scrolls = 0
    try:
        bundle = await connect(cdp_endpoint)
        page = bundle.page
        await page.goto("https://www.tiktok.com/foryou", wait_until="domcontentloaded", timeout=30_000)
        await asyncio.sleep(4)

        while time.monotonic() < deadline:
            await _wander(page)
            scrolls += 1
            if scrolls % 25 == 0:
                shot = out_dir / f"warmup-{scrolls:04d}.png"
                try:
                    await page.screenshot(path=str(shot))
                    shots.append(str(shot))
                except Exception:
                    pass
            delay = random.uniform(
                settings.warmup_scroll_min_delay_seconds,
                settings.warmup_scroll_max_delay_seconds,
            )
            await asyncio.sleep(delay)
        return WarmupResult(
            profile_id=profile_id,
            scrolls=scrolls,
            duration_seconds=time.monotonic() - (deadline - duration),
            screenshots=shots,
        )
    except Exception as exc:
        return WarmupResult(
            profile_id=profile_id,
            scrolls=scrolls,
            duration_seconds=0.0,
            screenshots=shots,
            error=str(exc),
        )
    finally:
        if bundle is not None:
            await bundle.close()
