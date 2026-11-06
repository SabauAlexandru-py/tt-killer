"""Proxy management routes.

Local JSON-backed proxy registry. Not AdsPower-backed — AdsPower profiles reference
these entries by id when materialised via /api/profiles/sync.

Endpoints (all under /proxies, mounted by main at /api):
    GET    ""                     list all stored proxies
    POST   ""                     create a new proxy entry
    POST   "/bulk"                insert many proxies in one call (JSON list)
    POST   "/bulk-text"           insert many proxies parsed from pasted text
    PATCH  "/{proxy_id}"          update any mutable field
    DELETE "/{proxy_id}"          remove
    POST   "/{proxy_id}/rotate"   fire rotation webhook, re-check exit IP
    POST   "/{proxy_id}/verify-ip" check current exit IP through the proxy
"""

from __future__ import annotations

import logging
from typing import Any, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from ..parsers import parse_bulk_text_detailed
from ..store import (
    Store,
    StoredProxy,
    StoredProxyCreate,
    StoredProxyUpdate,
    get_store,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/proxies", tags=["proxies"])

# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

IPIFY_URL = "https://api.ipify.org?format=json"
_PROXY_HTTP_TIMEOUT = 15.0
_ROTATION_TIMEOUT = 15.0


def _build_proxy_url(proxy: StoredProxy) -> str:
    """Build a proxy URL string from a StoredProxy.

    http/https  -> http://[user:pass@]host:port
    socks5      -> socks5://[user:pass@]host:port
    """
    scheme = (proxy.type or "http").lower()
    if scheme in {"http", "https"}:
        scheme = "http"
    elif scheme in {"socks5", "socks5h"}:
        scheme = "socks5"
    else:
        # Unknown type — fall back to http so we still get a usable URL.
        scheme = "http"

    auth = ""
    if proxy.user:
        if proxy.password:
            auth = f"{proxy.user}:{proxy.password}@"
        else:
            auth = f"{proxy.user}@"

    return f"{scheme}://{auth}{proxy.host}:{proxy.port}"


async def _fetch_ip_through_proxy(proxy: StoredProxy) -> Optional[str]:
    """Call api.ipify.org through the given proxy and return the observed IP.

    Returns None on any network error. Uses httpx's proxy kwarg; falls back to
    the legacy `proxies` kwarg on older httpx versions.
    """
    proxy_url = _build_proxy_url(proxy)
    try:
        try:
            # httpx >= 0.26: singular `proxy=` kwarg.
            client = httpx.AsyncClient(proxy=proxy_url, timeout=_PROXY_HTTP_TIMEOUT)
        except TypeError:
            # httpx < 0.28: `proxies=` kwarg (string or mapping).
            client = httpx.AsyncClient(proxies=proxy_url, timeout=_PROXY_HTTP_TIMEOUT)
        async with client:
            resp = await client.get(IPIFY_URL)
            resp.raise_for_status()
            data = resp.json()
            ip = data.get("ip")
            if isinstance(ip, str) and ip.strip():
                return ip.strip()
            return None
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning("ipify lookup through proxy %s failed: %s", proxy.id, exc)
        return None


def _require_proxy(store: Store, proxy_id: str) -> StoredProxy:
    """Fetch a stored proxy or raise 404.

    The underlying ``ProxyStore.get`` raises ``KeyError`` on missing rows;
    we translate that into a proper HTTP 404 so smoke tests don't see a 500.
    """
    try:
        return store.get(proxy_id)
    except KeyError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"proxy '{proxy_id}' not found",
        ) from exc


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------


@router.get("", response_model=list[StoredProxy])
async def list_proxies(store: Store = Depends(get_store)) -> list[StoredProxy]:
    """Return every stored proxy, newest first."""
    return store.list()


@router.post(
    "",
    response_model=StoredProxy,
    status_code=status.HTTP_201_CREATED,
)
async def create_proxy(
    payload: StoredProxyCreate,
    store: Store = Depends(get_store),
) -> StoredProxy:
    """Create a new proxy entry. Id and timestamps are generated server-side."""
    return store.create(payload)


@router.patch("/{proxy_id}", response_model=StoredProxy)
async def update_proxy(
    proxy_id: str,
    payload: StoredProxyUpdate,
    store: Store = Depends(get_store),
) -> StoredProxy:
    """Partial update — only fields present in the body are changed."""
    _require_proxy(store, proxy_id)
    try:
        return store.update(proxy_id, payload)
    except KeyError as exc:
        # Race: present during the require check, gone by the write.
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"proxy '{proxy_id}' not found",
        ) from exc


@router.delete("/{proxy_id}")
async def delete_proxy(
    proxy_id: str,
    store: Store = Depends(get_store),
) -> dict[str, bool]:
    """Remove a proxy entry. Idempotent: 404 only if it never existed."""
    _require_proxy(store, proxy_id)
    try:
        store.delete(proxy_id)
    except KeyError as exc:
        # Race: another writer removed it between the check and here.
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"proxy '{proxy_id}' not found",
        ) from exc
    return {"ok": True}


# ---------------------------------------------------------------------------
# rotation + verification
# ---------------------------------------------------------------------------


@router.post("/{proxy_id}/rotate")
async def rotate_proxy(
    proxy_id: str,
    store: Store = Depends(get_store),
) -> dict[str, object]:
    """Trigger the proxy's rotation URL, then re-verify the exit IP.

    Returns:
        {"old_ip": str|None, "new_ip": str|None, "changed": bool}

    Errors:
        400 — no rotation_url configured
        404 — proxy not found
        502 — rotation URL returned non-2xx
    """
    proxy = _require_proxy(store, proxy_id)

    if not proxy.rotation_url:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="proxy has no rotation_url configured",
        )

    old_ip = proxy.last_known_ip

    # 1. Fire the rotation webhook. Synchronous httpx.get per spec, 15s timeout.
    try:
        rotation_resp = httpx.get(proxy.rotation_url, timeout=_ROTATION_TIMEOUT)
        rotation_resp.raise_for_status()
    except httpx.HTTPError as exc:
        logger.warning("rotation webhook failed for %s: %s", proxy_id, exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"rotation_url call failed: {exc}",
        ) from exc

    # 2. Verify the new exit IP through the proxy itself.
    new_ip = await _fetch_ip_through_proxy(proxy)
    if new_ip is not None:
        store.set_ip(proxy_id, new_ip)

    return {
        "old_ip": old_ip,
        "new_ip": new_ip,
        "changed": bool(new_ip and new_ip != old_ip),
    }


@router.post("/{proxy_id}/verify-ip")
async def verify_proxy_ip(
    proxy_id: str,
    store: Store = Depends(get_store),
) -> dict[str, Optional[str]]:
    """Check the proxy's current exit IP without rotating.

    Returns {"ip": str|None}. Persists the observed IP via store.set_ip when
    the lookup succeeded.
    """
    proxy = _require_proxy(store, proxy_id)

    ip = await _fetch_ip_through_proxy(proxy)
    if ip is None:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="failed to reach api.ipify.org through proxy",
        )

    store.set_ip(proxy_id, ip)
    return {"ip": ip}


# ---------------------------------------------------------------------------
# bulk insert
# ---------------------------------------------------------------------------


class BulkProxyCreate(BaseModel):
    """Request body for POST /proxies/bulk — a flat list of create payloads."""

    proxies: list[StoredProxyCreate] = Field(default_factory=list)


class BulkProxyText(BaseModel):
    """Request body for POST /proxies/bulk-text — raw operator paste."""

    text: str


def _dedup_key(host: str, port: int, user: Optional[str]) -> tuple[str, int, str]:
    """Normalise an identity triple for idempotency checks.

    ``user`` is folded through an empty string so ``None`` and ``""`` collide
    like an operator would expect.
    """
    return (host, port, user or "")


def _partition_new_items(
    store: Store,
    candidates: list[StoredProxyCreate],
) -> tuple[list[StoredProxyCreate], list[dict[str, Any]]]:
    """Split ``candidates`` into inserts + duplicate errors.

    Checks the triple ``(host, port, user)`` against both the current store
    contents and against already-accepted rows from the same batch so that a
    paste with internal duplicates still reports the second one as a skip.
    """
    existing_keys = {
        _dedup_key(p.host, p.port, p.user) for p in store.list()
    }
    batch_keys: set[tuple[str, int, str]] = set()
    to_insert: list[StoredProxyCreate] = []
    errors: list[dict[str, Any]] = []

    for index, item in enumerate(candidates):
        key = _dedup_key(item.host, item.port, item.user)
        if key in existing_keys:
            errors.append(
                {
                    "index": index,
                    "host": item.host,
                    "port": item.port,
                    "user": item.user,
                    "reason": "duplicate (host, port, user) — already in store",
                }
            )
            continue
        if key in batch_keys:
            errors.append(
                {
                    "index": index,
                    "host": item.host,
                    "port": item.port,
                    "user": item.user,
                    "reason": "duplicate (host, port, user) — appears twice in request",
                }
            )
            continue
        batch_keys.add(key)
        to_insert.append(item)

    return to_insert, errors


@router.post("/bulk", status_code=status.HTTP_201_CREATED)
async def bulk_create_proxies(
    payload: BulkProxyCreate,
    store: Store = Depends(get_store),
) -> dict[str, Any]:
    """Create many proxies in a single call.

    Idempotent: any candidate whose ``(host, port, user)`` triple already
    exists in the store is skipped and reported in ``errors`` instead of
    failing the whole request. Duplicates within the request body itself are
    also reported.

    Response shape::

        {
            "added":  [StoredProxy, ...],
            "errors": [{"index": int, "host": str, "port": int,
                        "user": str|None, "reason": str}, ...]
        }
    """
    to_insert, errors = _partition_new_items(store, payload.proxies)
    added = store.bulk_create(to_insert)
    return {"added": added, "errors": errors}


@router.post("/bulk-text", status_code=status.HTTP_201_CREATED)
async def bulk_create_proxies_from_text(
    payload: BulkProxyText,
    store: Store = Depends(get_store),
) -> dict[str, Any]:
    """Create many proxies from an operator paste.

    Accepted per-line formats:

    1. ``host:port:user:pass``
    2. ``host:port``
    3. ``scheme://user:pass@host:port``
    4. ``scheme://host:port``

    Blank lines and lines starting with ``#`` are skipped. Unparseable lines
    are reported in ``errors`` with the line number and a redacted echo of
    the offending input (user/pass stripped to ``***``) so the UI can show
    them without leaking secrets.
    """
    candidates: list[StoredProxyCreate] = []
    errors: list[dict[str, Any]] = []

    for lineno, parsed, err in parse_bulk_text_detailed(payload.text):
        if parsed is None:
            errors.append({"line": lineno, "reason": err or "parse error"})
            continue
        try:
            candidates.append(StoredProxyCreate.model_validate(parsed))
        except Exception as exc:  # pragma: no cover — defensive
            errors.append(
                {"line": lineno, "reason": f"validation error: {exc}"}
            )

    to_insert, dedup_errors = _partition_new_items(store, candidates)
    errors.extend(dedup_errors)
    added = store.bulk_create(to_insert)
    return {"added": added, "errors": errors}
