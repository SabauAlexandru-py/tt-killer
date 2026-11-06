"""AdsPower profile routes.

Pure passthrough to AdsPower's Local API plus one bit of real logic: the
``POST /sync`` endpoint materialises a new AdsPower profile for every
``StoredProxy`` that isn't already attached to one. Linking is proxy-shape
based, not id based, because our local store doesn't push proxies into the
AdsPower Proxy Manager — they only exist as inline ``user_proxy_config``
blobs on the profiles they power.

Endpoints (all under /profiles, mounted by main at /api):
    GET    ""                     list AdsPower profiles
    POST   "/sync"                create one profile per unlinked StoredProxy
    DELETE "/{user_id}"           delete a profile from AdsPower
    POST   "/{user_id}/open"      launch the profile's browser, returns CDP info
    POST   "/{user_id}/close"     stop the profile's browser
"""

from __future__ import annotations

import logging
import re
from typing import Any, AsyncIterator

from fastapi import APIRouter, Depends, HTTPException, status

from .. import bridge
from ..store import ProxyStore, StoredProxy, get_store

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/profiles", tags=["profiles"])


# ---------------------------------------------------------------------------
# dependencies
# ---------------------------------------------------------------------------

_TIKTOK_NAME_RE = re.compile(r"^TikTok Acc #(\d+)$")


async def _client_dep() -> AsyncIterator[bridge.AdsPowerClient]:
    """Per-request AdsPower client.

    One httpx session per request is cheap compared to the Local API's 1 req/s
    throttle, and it means we don't need a global lifespan hook just for this
    router. The client's internal lock still serialises concurrent calls inside
    one request.
    """
    client = bridge.AdsPowerClient()
    try:
        yield client
    finally:
        await client.aclose()


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def _profile_to_dict(profile: Any) -> dict[str, Any]:
    """Serialise an AdsPower ProfileSummary (pydantic) to a plain dict for JSON."""
    if hasattr(profile, "model_dump"):
        return profile.model_dump()
    if isinstance(profile, dict):
        return profile
    return dict(profile)  # best effort


def _proxy_endpoint(profile_dict: dict[str, Any]) -> tuple[str | None, str | None]:
    """Return (host, port) from an AdsPower profile's ``user_proxy_config``.

    AdsPower returns ports as strings; we normalise both to str for matching.
    """
    cfg = profile_dict.get("user_proxy_config") or {}
    host = cfg.get("proxy_host")
    port = cfg.get("proxy_port")
    return (
        str(host).strip() if host else None,
        str(port).strip() if port not in (None, "") else None,
    )


def _match_key(host: str | None, port: Any) -> tuple[str, str] | None:
    if not host or port in (None, ""):
        return None
    return (str(host).strip().lower(), str(port).strip())


def _next_name_index(existing_names: list[str]) -> int:
    """Highest ``TikTok Acc #N`` + 1, or 1 if none match."""
    highest = 0
    for name in existing_names:
        if not name:
            continue
        m = _TIKTOK_NAME_RE.match(name.strip())
        if m:
            try:
                highest = max(highest, int(m.group(1)))
            except ValueError:
                continue
    return highest + 1


def _translate_adspower_error(exc: bridge.AdsPowerError) -> HTTPException:
    """Lift an AdsPower transport/API failure to a 502 with the upstream code attached."""
    detail: dict[str, Any] = {"message": str(exc)}
    if exc.code is not None:
        detail["adspower_code"] = exc.code
    if exc.payload is not None:
        detail["adspower_payload"] = exc.payload
    return HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail=detail,
    )


# ---------------------------------------------------------------------------
# routes
# ---------------------------------------------------------------------------


@router.get("")
async def list_profiles(
    client: bridge.AdsPowerClient = Depends(_client_dep),
) -> list[dict[str, Any]]:
    """Return every AdsPower profile the Local API reports, as plain dicts."""
    try:
        profiles = await bridge.list_profiles(client)
    except bridge.AdsPowerError as exc:
        raise _translate_adspower_error(exc) from exc
    return [_profile_to_dict(p) for p in profiles]


@router.post("/sync")
async def sync_profiles(
    client: bridge.AdsPowerClient = Depends(_client_dep),
    store: ProxyStore = Depends(get_store),
) -> dict[str, list[dict[str, Any]]]:
    """Create one AdsPower profile per StoredProxy not already linked.

    Linking rule: an AdsPower profile is considered linked to a StoredProxy when
    its ``user_proxy_config.proxy_host`` + ``proxy_port`` match the StoredProxy's
    ``host`` + ``port`` (case-insensitive host, string-compared port).

    For every unmatched StoredProxy we call
    ``bridge._create_profile_with_inline_proxy`` with name ``"TikTok Acc #N"``
    where ``N`` continues from the highest existing ``TikTok Acc #...`` profile.

    Response:
        ``{"created": [{proxy_id, name, user_id}, ...],
           "skipped": [{proxy_id, name, user_id}, ...]}``

    ``skipped`` entries carry the existing AdsPower ``user_id`` so the UI can
    link the row straight to the matched profile.
    """
    try:
        profiles = await bridge.list_profiles(client)
    except bridge.AdsPowerError as exc:
        raise _translate_adspower_error(exc) from exc

    profile_dicts = [_profile_to_dict(p) for p in profiles]

    # Index existing profiles by (host, port) so matching is O(1).
    by_endpoint: dict[tuple[str, str], dict[str, Any]] = {}
    for profile in profile_dicts:
        host, port = _proxy_endpoint(profile)
        key = _match_key(host, port)
        if key is None:
            continue
        # First writer wins — if two AdsPower profiles share an endpoint, the
        # UI gets the first one linked and the operator can clean up later.
        by_endpoint.setdefault(key, profile)

    existing_names = [str(p.get("name") or "") for p in profile_dicts]
    next_idx = _next_name_index(existing_names)

    stored_proxies: list[StoredProxy] = store.list()
    created: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []

    for proxy in stored_proxies:
        key = _match_key(proxy.host, proxy.port)
        if key is not None and key in by_endpoint:
            matched = by_endpoint[key]
            skipped.append(
                {
                    "proxy_id": proxy.id,
                    "name": matched.get("name"),
                    "user_id": matched.get("user_id"),
                }
            )
            continue

        name = f"TikTok Acc #{next_idx}"
        next_idx += 1
        try:
            user_id = await bridge._create_profile_with_inline_proxy(
                client,
                name,
                "0",
                proxy,
            )
        except bridge.AdsPowerError as exc:
            logger.warning(
                "sync: inline-proxy create failed for proxy %s (%s:%s): %s",
                proxy.id,
                proxy.host,
                proxy.port,
                exc,
            )
            # Surface the first failure so the operator fixes AdsPower before
            # we partially materialise an unbounded list.
            raise _translate_adspower_error(exc) from exc

        created.append(
            {
                "proxy_id": proxy.id,
                "name": name,
                "user_id": user_id,
            }
        )
        # Keep the lookup fresh so a duplicate StoredProxy in the same sync
        # doesn't spawn a second AdsPower profile with the same endpoint.
        by_endpoint[key] = {"name": name, "user_id": user_id}

    return {"created": created, "skipped": skipped}


@router.delete("/{user_id}")
async def delete_profile(
    user_id: str,
    client: bridge.AdsPowerClient = Depends(_client_dep),
) -> dict[str, bool]:
    """Delete an AdsPower profile by its ``user_id``."""
    try:
        await bridge.delete_profile(client, user_id)
    except bridge.AdsPowerError as exc:
        raise _translate_adspower_error(exc) from exc
    return {"ok": True}


@router.post("/{user_id}/open")
async def open_profile(
    user_id: str,
    client: bridge.AdsPowerClient = Depends(_client_dep),
) -> dict[str, Any]:
    """Launch a profile's browser. Returns AdsPower's start payload, which
    includes the CDP (``ws.puppeteer``) and selenium webdriver endpoints.
    """
    try:
        info = await bridge.start_browser(client, user_id)
    except bridge.AdsPowerError as exc:
        raise _translate_adspower_error(exc) from exc

    if hasattr(info, "model_dump"):
        payload = info.model_dump()
    else:
        payload = dict(info)
    # Lift the cdp endpoint to a top-level convenience key for the UI.
    payload["cdp_endpoint"] = getattr(info, "cdp_endpoint", None) or (
        payload.get("ws") or {}
    ).get("puppeteer")
    return payload


@router.post("/{user_id}/close")
async def close_profile(
    user_id: str,
    client: bridge.AdsPowerClient = Depends(_client_dep),
) -> dict[str, bool]:
    """Stop a profile's browser via AdsPower's ``/browser/stop``."""
    try:
        await bridge.stop_browser(client, user_id)
    except bridge.AdsPowerError as exc:
        raise _translate_adspower_error(exc) from exc
    return {"ok": True}
