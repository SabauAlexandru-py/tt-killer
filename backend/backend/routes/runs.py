"""/runs endpoints — list/inspect snapshots and dispatch background orchestrator runs.

The heavy lifting lives in ``adspower_mcp.orchestrator`` and is re-exported by
``backend.bridge``. These handlers stay thin: validate input, mint a ``Run`` on
``bridge.run_store``, fire an asyncio task, hand back the ``run_id`` so the
frontend can start polling (or SSE-tailing) immediately.

Two gotchas worth calling out so a reader doesn't rediscover them:

1.  ``asyncio.create_task`` returns a coroutine task whose only owner is the
    caller. If nothing holds a strong reference the GC can destroy it
    mid-flight (the stdlib docs mention this explicitly). We stash every task
    in :data:`_BACKGROUND_TASKS` and discard it in a done-callback. Without
    this, a long signup run can disappear the moment the request handler
    returns.

2.  ``proxy_ids`` in the ``POST /create`` payload can be AdsPower proxy_ids
    (what the orchestrator wants) OR local ``backend.store`` uuids (what the
    ``/proxies`` UI emits). We try to resolve the local ids to AdsPower
    proxy_ids by matching ``(host, port)`` against the live AdsPower proxy
    list; anything we can't resolve is passed through untouched so the caller
    sees a clear downstream error instead of a silent drop.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from .. import bridge

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/runs", tags=["runs"])


# ---------------------------------------------------------------------------
# Background task registry
# ---------------------------------------------------------------------------
#
# asyncio holds only a weak reference to tasks it spawns. If we don't keep a
# strong reference, the task can be garbage-collected before it finishes and
# the orchestrator run silently dies. See:
# https://docs.python.org/3/library/asyncio-task.html#asyncio.create_task
_BACKGROUND_TASKS: set[asyncio.Task[Any]] = set()


def _spawn(coro: Any, *, label: str) -> asyncio.Task[Any]:
    """Create a tracked asyncio task and auto-remove it from the registry on done."""
    task = asyncio.create_task(coro, name=label)
    _BACKGROUND_TASKS.add(task)

    def _discard(t: asyncio.Task[Any]) -> None:
        _BACKGROUND_TASKS.discard(t)
        exc = t.exception() if not t.cancelled() else None
        if exc is not None:
            logger.exception("Background task %s crashed", label, exc_info=exc)

    task.add_done_callback(_discard)
    return task


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------


class CreateRunBody(BaseModel):
    """Payload for ``POST /runs/create``.

    All fields optional — matches the orchestrator contract where ``None``
    means "use the setting default".
    """

    proxy_ids: Optional[list[str]] = Field(
        default=None,
        description=(
            "Either AdsPower proxy_ids (pass-through) or local backend "
            "proxy uuids (resolved via host+port lookup). Omit to use every "
            "AdsPower proxy."
        ),
    )
    name_prefix: Optional[str] = Field(
        default=None,
        description='Profile name prefix, e.g. "TikTok Acc". Falls back to settings.',
    )
    rotate_between: Optional[bool] = Field(
        default=None,
        description="Trigger proxy rotation before each account. Falls back to settings.",
    )
    birth_year: Optional[int] = Field(
        default=None,
        ge=1950,
        le=2015,
        description="Signup birth year. Falls back to settings.",
    )
    max_parallel: Optional[int] = Field(
        default=None,
        ge=1,
        le=32,
        description=(
            "Cap on concurrent signups. Effective concurrency is "
            "min(len(proxies), max_parallel). Omit to use "
            "settings.max_parallel_signups (env MAX_PARALLEL_SIGNUPS, default 10)."
        ),
    )


class WarmupRunBody(BaseModel):
    """Payload for ``POST /runs/warmup``."""

    profile_ids: Optional[list[str]] = Field(
        default=None,
        description="AdsPower profile user_ids to warm. Omit to warm every pairable profile.",
    )
    rotate_between: Optional[bool] = Field(
        default=None,
        description="Rotate proxy IP between profiles. Defaults to True.",
    )
    max_parallel: Optional[int] = Field(
        default=None,
        ge=1,
        le=32,
        description=(
            "Cap on concurrent warmups. Effective concurrency is "
            "min(len(pairs), max_parallel). Shares the creator's "
            "settings.max_parallel_signups default when omitted."
        ),
    )


class RunCreatedResponse(BaseModel):
    run_id: str


# ---------------------------------------------------------------------------
# Proxy id resolution
# ---------------------------------------------------------------------------


async def _resolve_proxy_ids(raw_ids: Optional[list[str]]) -> Optional[list[str]]:
    """Map incoming ids to AdsPower proxy_ids.

    Rules, in order per id:

    1.  If the id matches a local ``backend.store`` row, pair it with a live
        AdsPower proxy by ``(host, port)`` and use that proxy's ``proxy_id``.
    2.  Otherwise, pass the id through untouched — treated as an AdsPower
        proxy_id already.
    3.  If a local row has no matching AdsPower proxy, we still pass the raw
        id through. The orchestrator will filter it out with a clear "no
        proxies found" error rather than us silently swallowing selection.

    Returns ``None`` when the caller passed ``None``, so the orchestrator's
    "pick every proxy" default survives unchanged.
    """
    if not raw_ids:
        return None

    # Pull local store rows — tolerate a missing store so the AdsPower-only
    # path (operator never used the /proxies UI) still works.
    try:
        from ..store import get_store  # local import keeps module load cheap

        local_rows = {row.id: row for row in get_store().list()}
    except Exception:  # pragma: no cover — defensive, shouldn't fire
        logger.warning("ProxyStore lookup failed; treating ids as AdsPower proxy_ids", exc_info=True)
        local_rows = {}

    # Only probe AdsPower when at least one id looks like a local uuid —
    # otherwise an offline AdsPower doesn't need to block a pass-through run.
    host_port_index: dict[tuple[str, str], str] = {}
    if any(rid in local_rows for rid in raw_ids):
        try:
            from adspower_mcp.adspower.client import AdsPowerClient
            from adspower_mcp.adspower.proxies import list_proxies

            async with AdsPowerClient() as api:
                ap_proxies = await list_proxies(api)
            for p in ap_proxies:
                if p.proxy_host and p.proxy_port:
                    host_port_index[(p.proxy_host, str(p.proxy_port))] = p.proxy_id
        except Exception:
            logger.warning(
                "Could not read AdsPower proxies while resolving local ids; passing raw",
                exc_info=True,
            )

    resolved: list[str] = []
    for rid in raw_ids:
        row = local_rows.get(rid)
        if row is None:
            resolved.append(rid)  # already an AdsPower proxy_id
            continue
        mapped = host_port_index.get((row.host, str(row.port)))
        resolved.append(mapped if mapped is not None else rid)
    return resolved


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("", summary="List all run snapshots")
async def list_runs() -> list[dict[str, Any]]:
    """Return a snapshot of every run the bridge has recorded.

    Sorted newest-first so the dashboard "Recent runs" grid doesn't need to
    sort client-side.
    """
    runs = bridge.run_store.list_runs()
    snapshots = [r.snapshot() for r in runs]
    snapshots.sort(key=lambda s: s.get("created_at", 0), reverse=True)
    return snapshots


@router.get("/{run_id}", summary="Full snapshot of one run")
async def get_run(run_id: str) -> dict[str, Any]:
    try:
        run = bridge.run_store.get(run_id)
    except KeyError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return run.snapshot()


@router.post(
    "/create",
    response_model=RunCreatedResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Kick off an account-creation run",
)
async def create_run(body: CreateRunBody) -> RunCreatedResponse:
    """Mint a ``create`` run on the bridge and dispatch it in the background.

    The HTTP response returns immediately with the ``run_id``; the frontend
    then subscribes to ``/stream/runs/{run_id}`` for live updates.
    """
    resolved_ids = await _resolve_proxy_ids(body.proxy_ids)

    run = bridge.run_store.new("create")
    _spawn(
        bridge.create_accounts_run(
            run,
            proxy_ids=resolved_ids,
            name_prefix=body.name_prefix,
            rotate_between=body.rotate_between,
            birth_year=body.birth_year,
            max_parallel=body.max_parallel,
        ),
        label=f"create:{run.run_id}",
    )
    return RunCreatedResponse(run_id=run.run_id)


@router.post(
    "/warmup",
    response_model=RunCreatedResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Kick off a warmup run across selected profiles",
)
async def warmup_run(body: WarmupRunBody) -> RunCreatedResponse:
    """Mint a ``warmup`` run on the bridge and dispatch it in the background.

    ``rotate_between`` defaults to ``True`` — warming profiles on the same
    IP is almost never what we want in production.
    """
    rotate = True if body.rotate_between is None else body.rotate_between

    run = bridge.run_store.new("warmup")
    _spawn(
        bridge.warmup_accounts_run(
            run,
            profile_ids=body.profile_ids,
            rotate_between=rotate,
            max_parallel=body.max_parallel,
        ),
        label=f"warmup:{run.run_id}",
    )
    return RunCreatedResponse(run_id=run.run_id)
