from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from playwright.async_api import Browser, BrowserContext, Page, async_playwright


@dataclass
class ConnectedBrowser:
    playwright: Any
    browser: Browser
    context: BrowserContext
    page: Page

    async def close(self) -> None:
        # The Chrome process belongs to AdsPower — only detach Playwright here. AdsPower's
        # /browser/stop endpoint is what actually closes the window.
        try:
            await self.browser.close()
        except Exception:
            pass
        try:
            await self.playwright.stop()
        except Exception:
            pass


async def connect(cdp_endpoint: str) -> ConnectedBrowser:
    pw = await async_playwright().start()
    browser = await pw.chromium.connect_over_cdp(cdp_endpoint)
    context = browser.contexts[0] if browser.contexts else await browser.new_context()
    page = context.pages[0] if context.pages else await context.new_page()
    return ConnectedBrowser(playwright=pw, browser=browser, context=context, page=page)
