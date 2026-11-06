"""Bridge module — thin re-exports from the adspower_mcp package.

The FastAPI routes never reach into adspower_mcp directly. They import from
here so we have exactly one seam between the web layer and the MCP core, and so
stub imports in tests have a single surface to patch.

Naming note: `list_proxies` from adspower_mcp.adspower.proxies collides with the
web-level proxy store. We re-export the AdsPower one as
`list_adspower_proxies` to keep the distinction obvious at call sites.
"""

from __future__ import annotations

from typing import Any, Mapping

from adspower_mcp.adspower.browsers import start_browser, stop_browser
from adspower_mcp.adspower.client import AdsPowerClient, AdsPowerError
from adspower_mcp.adspower.profiles import (
    create_profile_for_proxy,
    delete_profile,
    list_profiles,
)
from adspower_mcp.adspower.proxies import list_proxies as list_adspower_proxies
from adspower_mcp.captcha.sadcaptcha import make_solver
from adspower_mcp.orchestrator.creator import create_accounts_run
from adspower_mcp.orchestrator.state import store as run_store
from adspower_mcp.orchestrator.warmer import warmup_accounts_run


__all__ = [
    "AdsPowerClient",
    "AdsPowerError",
    "list_adspower_proxies",
    "list_profiles",
    "create_profile_for_proxy",
    "delete_profile",
    "start_browser",
    "stop_browser",
    "create_accounts_run",
    "warmup_accounts_run",
    "run_store",
    "make_solver",
    "count_stored_proxies",
    "_create_profile_with_inline_proxy",
]


def count_stored_proxies() -> int:
    """Return the row count of the local JSON proxy store — never hits AdsPower.

    The Dashboard's N-accounts selector (DESIGN_BRIEF_V2 §5) caps at the number
    of proxies on disk, so this has to answer even when the AdsPower Local API
    is offline or the operator hasn't pasted an API key yet. The store call is
    cheap (single-digit KB file read, held under its own lock for microseconds)
    and does not reach outside the FastAPI process.

    The import is function-scoped to mirror ``store.get_store``'s own convention
    and keep this module import-safe regardless of what else touches ``.store``
    during startup.
    """

    from .store import get_store

    return len(get_store().list())


def _proxy_field(proxy: Any, field: str, default: Any = None) -> Any:
    """Read ``field`` off a StoredProxy regardless of shape (pydantic / dataclass / dict)."""

    if isinstance(proxy, Mapping):
        return proxy.get(field, default)
    return getattr(proxy, field, default)


async def _create_profile_with_inline_proxy(
    client: AdsPowerClient,
    name: str,
    group_id: str,
    proxy: Any,
    *,
    domain_name: str = "tiktok.com",
) -> str:
    """Create an AdsPower profile with proxy config passed inline on ``/api/v1/user/create``.

    Used by the sync route for StoredProxy entries that aren't in AdsPower's Proxy
    Manager pool. ``proxy`` can be any object exposing ``host`` / ``port`` /
    ``type`` / ``user`` / ``password`` (pydantic model, dataclass, or dict).

    AdsPower's Local API expects these under ``user_proxy_config``:
    - ``proxy_soft``: "other" for anything outside the Proxy Manager catalog
    - ``proxy_type``: http / https / socks5
    - ``proxy_host`` / ``proxy_port``: strings
    - ``proxy_user`` / ``proxy_password``: optional

    Returns the new AdsPower ``user_id``.
    """

    host = _proxy_field(proxy, "host")
    port = _proxy_field(proxy, "port")
    proxy_type = (_proxy_field(proxy, "type") or "http").lower()
    user = _proxy_field(proxy, "user")
    password = _proxy_field(proxy, "password")

    if not host or port in (None, ""):
        raise AdsPowerError(
            "StoredProxy is missing host/port; cannot build inline proxy config.",
            payload={"host": host, "port": port},
        )

    user_proxy_config: dict[str, Any] = {
        "proxy_soft": "other",
        "proxy_type": proxy_type,
        "proxy_host": str(host),
        "proxy_port": str(port),
    }
    if user:
        user_proxy_config["proxy_user"] = str(user)
    if password:
        user_proxy_config["proxy_password"] = str(password)

    payload: dict[str, Any] = {
        "name": name,
        "group_id": group_id,
        "domain_name": domain_name,
        "user_proxy_config": user_proxy_config,
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
            "AdsPower create returned no profile id for inline-proxy payload.",
            payload=envelope.data,
        )
    return str(user_id)
