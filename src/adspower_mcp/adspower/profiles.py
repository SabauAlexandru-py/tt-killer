from __future__ import annotations

from typing import Any

from .client import AdsPowerClient, AdsPowerError
from .schemas import ProfileSummary


async def list_profiles(
    client: AdsPowerClient,
    *,
    group_id: str | None = None,
    page: int = 1,
    page_size: int = 100,
) -> list[ProfileSummary]:
    params: dict[str, Any] = {"page": page, "page_size": page_size}
    if group_id:
        params["group_id"] = group_id
    envelope = await client.request("GET", "/api/v1/user/list", params=params)
    rows = (envelope.data or {}).get("list", []) or []
    return [ProfileSummary.model_validate(row) for row in rows]


async def create_profile_for_proxy(
    client: AdsPowerClient,
    *,
    name: str,
    proxy_id: str,
    group_id: str = "0",
    domain_name: str = "tiktok.com",
) -> str:
    """Create a new AdsPower profile bound to an existing Proxy Manager proxy_id.

    No extension juggling needed: SadCaptcha solves TikTok puzzles from Python via
    tiktok-captcha-solver, so profiles are extension-free.
    """
    payload: dict[str, Any] = {
        "name": name,
        "group_id": group_id,
        "domain_name": domain_name,
        "user_proxy_config": {"proxy_id": proxy_id},
        "fingerprint_config": {
            "automatic_timezone": "1",
            "language": ["en-US", "en"],
            "flash": "block",
            "fonts": ["all"],
            "webrtc": "disabled",
        },
    }

    envelope = await client.request("POST", "/api/v1/user/create", json=payload)
    user_id = (envelope.data or {}).get("id")
    if not user_id:
        raise AdsPowerError(
            "AdsPower create returned no profile id. Check that proxy_id exists in the Proxy Manager.",
            payload=envelope.data,
        )
    return str(user_id)


async def delete_profile(client: AdsPowerClient, user_id: str) -> None:
    await client.request("POST", "/api/v1/user/delete", json={"user_ids": [user_id]})
