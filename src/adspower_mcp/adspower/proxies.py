from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .client import AdsPowerClient, AdsPowerError
from .schemas import Proxy

# AdsPower exposes the Proxy Manager pool on /api/v1/user/proxy-list in current builds. Some
# older builds only expose per-profile proxy configs; the client falls back by scanning profiles
# in that case so the MCP still sees every proxy the user has in AdsPower.
_PROXY_LIST_PATHS = ["/api/v1/user/proxy-list", "/api/v1/proxy/list"]


def _load_rotation_map(path: str | Path = "proxies_config.json") -> dict[str, str]:
    """Load a {proxy_id: rotation_url} dict from a local JSON file, if present.

    AdsPower itself doesn't store mobile-proxy rotation URLs — that's a per-provider thing. This
    file lets the user pair rotation URLs with AdsPower proxy_ids once, so the warmer can hit the
    right rotate endpoint per proxy.
    """
    p = Path(path)
    if not p.exists():
        return {}
    try:
        raw = json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}
    if isinstance(raw, dict):
        return {str(k): str(v) for k, v in raw.items() if v and not str(k).startswith("__")}
    return {}


async def list_proxies(client: AdsPowerClient) -> list[Proxy]:
    """Return every proxy in AdsPower's Proxy Manager, with rotation URLs merged from local config."""
    rotation = _load_rotation_map()
    last_error: AdsPowerError | None = None
    for path in _PROXY_LIST_PATHS:
        try:
            envelope = await client.request("GET", path, params={"page": 1, "page_size": 500})
        except AdsPowerError as exc:
            last_error = exc
            continue
        rows: list[dict[str, Any]] = (envelope.data or {}).get("list", []) or []
        proxies: list[Proxy] = []
        for row in rows:
            proxy = Proxy.model_validate(row)
            proxy.rotation_url = rotation.get(proxy.proxy_id)
            proxies.append(proxy)
        return proxies

    # Fallback: derive unique proxies from the profile list.
    profiles_envelope = await client.request(
        "GET", "/api/v1/user/list", params={"page": 1, "page_size": 500}
    )
    profiles: list[dict[str, Any]] = (profiles_envelope.data or {}).get("list", []) or []
    seen: dict[str, Proxy] = {}
    for profile in profiles:
        cfg = profile.get("user_proxy_config") or {}
        pid = cfg.get("proxy_id")
        if not pid or pid in seen:
            continue
        seen[pid] = Proxy(
            proxy_id=str(pid),
            proxy_soft=cfg.get("proxy_soft"),
            proxy_type=cfg.get("proxy_type"),
            proxy_host=cfg.get("proxy_host"),
            proxy_port=cfg.get("proxy_port"),
            proxy_user=cfg.get("proxy_user"),
            proxy_password=cfg.get("proxy_password"),
            rotation_url=rotation.get(str(pid)),
        )
    if not seen and last_error is not None:
        raise last_error
    return list(seen.values())
