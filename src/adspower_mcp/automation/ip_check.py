"""Read the current egress IP from inside an AdsPower profile.

Used by the warmer to verify the proxy's rotate button actually changed the IP before accepting
the next account into the loop. Hitting ipify from the browser itself proves the proxy — and the
rotation — are working, not just that AdsPower's own proxy-check endpoint is happy.
"""
from __future__ import annotations

from playwright.async_api import Page


async def current_ip(page: Page) -> str:
    response = await page.request.get("https://api.ipify.org?format=json")
    data = await response.json()
    ip = data.get("ip")
    if not ip:
        raise RuntimeError(f"ipify returned no 'ip' field: {data}")
    return str(ip)
