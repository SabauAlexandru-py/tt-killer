from __future__ import annotations

from typing import Any

from .client import AdsPowerClient
from .schemas import BrowserStartInfo


async def start_browser(
    client: AdsPowerClient,
    user_id: str,
    *,
    open_tabs: int = 1,
    headless: bool = False,
) -> BrowserStartInfo:
    params: dict[str, Any] = {
        "user_id": user_id,
        "open_tabs": open_tabs,
        "ip_tab": 0,
        "headless": 1 if headless else 0,
    }
    envelope = await client.request("GET", "/api/v1/browser/start", params=params)
    return BrowserStartInfo.model_validate(envelope.data or {})


async def stop_browser(client: AdsPowerClient, user_id: str) -> None:
    await client.request("GET", "/api/v1/browser/stop", params={"user_id": user_id})


async def browser_status(client: AdsPowerClient, user_id: str) -> str:
    envelope = await client.request(
        "GET", "/api/v1/browser/active", params={"user_id": user_id}
    )
    return (envelope.data or {}).get("status", "Inactive")
