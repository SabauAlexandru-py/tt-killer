"""SadCaptcha solver wrapper.

SadCaptcha's `tiktok-captcha-solver` Python library detects and solves TikTok's puzzle, rotate,
icon, and shapes challenges inline — no browser extension required. We instantiate a solver per
signup, bind it to the Playwright page already connected to the AdsPower profile, and call
`solve_captcha_if_present()` wherever TikTok would throw a puzzle.

Pricing: ~$0.002/solve on the starter tier, cheaper at volume. Key from
https://sadcaptcha.com/dashboard.
"""
from __future__ import annotations

from playwright.async_api import Page
from tiktok_captcha_solver import AsyncPlaywrightSolver

from ..config import get_settings


class SadCaptchaNotConfigured(RuntimeError):
    pass


def make_solver(page: Page) -> AsyncPlaywrightSolver:
    settings = get_settings()
    if not settings.sadcaptcha_api_key:
        raise SadCaptchaNotConfigured(
            "SADCAPTCHA_API_KEY is not set. Grab one from https://sadcaptcha.com/dashboard "
            "and paste it into .env."
        )
    return AsyncPlaywrightSolver(page=page, sadcaptcha_api_key=settings.sadcaptcha_api_key)


async def solve_if_present(page: Page, *, timeout_seconds: int = 15, retries: int = 3) -> None:
    """Non-blocking helper: solve any TikTok puzzle currently on `page`, or no-op."""
    solver = make_solver(page)
    await solver.solve_captcha_if_present(captcha_detect_timeout=timeout_seconds, retries=retries)
