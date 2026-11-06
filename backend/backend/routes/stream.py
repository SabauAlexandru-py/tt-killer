"""SSE streams for live run snapshots and global log tail.

Two endpoints, both cancellation-safe:

* `GET /stream/runs/{run_id}` — emits `run.snapshot()` as JSON every ~1s until
  the run reaches a terminal state (`complete` / `failed`). A final frame is
  always sent before the generator exits so late subscribers can observe the
  end state even if they attach right as the run finishes.
* `GET /stream/logs?tail=200` — emits a `backlog` frame with the last N lines
  from the in-memory `RingBuffer`, then streams new lines as the orchestrators
  log them. Polling cadence is 0.5s.

Why `sse_starlette.EventSourceResponse` over hand-rolled StreamingResponse:
built-in keepalive pings, proper SSE framing (`event:`/`data:`/`\\n\\n`), and
first-class handling of client disconnects via `asyncio.CancelledError`.
"""
from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import AsyncGenerator
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request
from sse_starlette.sse import EventSourceResponse

from adspower_mcp.orchestrator.state import store

from ..log_buffer import get_log_ring

router = APIRouter(prefix="/stream", tags=["stream"])

log = logging.getLogger(__name__)

# --- cadence knobs ---------------------------------------------------------

# Run snapshot cadence. Spec says "every 1s or on change"; we go time-based so
# the UI always sees a heartbeat even if the run is stalled.
_RUN_TICK_SECONDS: float = 1.0
# Log tail poll cadence — tight enough to feel live, loose enough to coalesce
# bursts into one yield.
_LOG_POLL_SECONDS: float = 0.5
# SSE keepalive ping. sse_starlette accepts an int; 15s keeps proxies happy
# without flooding the console.
_PING_SECONDS: int = 15
# Hard ceiling on backlog size per `/logs` connection. The ring itself is
# already bounded to 500; this is a client-side override limit.
_MAX_TAIL: int = 500


# =============================================================================
# /stream/runs/{run_id}
# =============================================================================


async def _run_event_stream(
    run_id: str, request: Request
) -> AsyncGenerator[dict[str, Any], None]:
    """Yield SSE events with `run.snapshot()` until the run is terminal.

    Behaviour on edges:
    * Run becomes terminal mid-loop → emit one last snapshot (the terminal
      one), then return cleanly.
    * Client disconnects → `request.is_disconnected()` goes true and we
      return before the next sleep; `asyncio.CancelledError` is also caught
      as a backstop if the task is cancelled directly.
    * Run id vanishes mid-stream (shouldn't happen — `RunStore` doesn't evict)
      → emit an `error` frame and stop.
    """
    try:
        while True:
            if await request.is_disconnected():
                return

            try:
                run = store.get(run_id)
            except KeyError as exc:
                yield {
                    "event": "error",
                    "data": json.dumps({"detail": str(exc)}),
                }
                return

            payload = json.dumps(run.snapshot(), default=str)
            yield {"event": "snapshot", "data": payload}

            # Terminal check AFTER yielding so the final frame always lands.
            if run.status in {"complete", "failed"}:
                yield {
                    "event": "end",
                    "data": json.dumps(
                        {"run_id": run_id, "status": run.status}
                    ),
                }
                return

            try:
                await asyncio.sleep(_RUN_TICK_SECONDS)
            except asyncio.CancelledError:
                return
    except asyncio.CancelledError:
        # Client dropped mid-tick. Not an error.
        return


@router.get("/runs/{run_id}")
async def stream_run(run_id: str, request: Request) -> EventSourceResponse:
    """SSE snapshot stream for a single run. 404s unknown ids up-front."""
    # Pre-flight so a bad id returns a real 404 instead of an SSE `error`
    # frame the client can't distinguish from a transient hiccup.
    try:
        store.get(run_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    return EventSourceResponse(
        _run_event_stream(run_id, request),
        ping=_PING_SECONDS,
    )


# =============================================================================
# /stream/logs
# =============================================================================


def _format_line(seq: int, line: str) -> str:
    return json.dumps({"seq": seq, "line": line})


async def _log_event_stream(
    request: Request, tail: int
) -> AsyncGenerator[dict[str, Any], None]:
    """Yield SSE events for the global log tail.

    Flow:
    1. One `backlog` frame carrying the last `tail` lines as a JSON array —
       lets the UI render history in a single paint.
    2. Subsequent `line` frames, one per new log line, with a monotonic
       `seq` the client can reuse to reconnect without duplicates.
    """
    ring = get_log_ring()

    backlog = ring.tail(tail)
    if backlog:
        last_seq = backlog[-1][0]
        yield {
            "event": "backlog",
            "data": json.dumps(
                [{"seq": s, "line": line} for s, line in backlog]
            ),
        }
    else:
        # Empty ring: start from latest_seq (-1 if truly empty) so the first
        # real push becomes seq 0 and we yield it.
        last_seq = ring.latest_seq

    try:
        while True:
            if await request.is_disconnected():
                return

            new_items = ring.since(last_seq)
            if new_items:
                last_seq = new_items[-1][0]
                # One SSE event per line keeps the client-side parser trivial
                # and matches the natural shape of a log tail.
                for seq, line in new_items:
                    yield {
                        "event": "line",
                        "data": _format_line(seq, line),
                    }

            try:
                await asyncio.sleep(_LOG_POLL_SECONDS)
            except asyncio.CancelledError:
                return
    except asyncio.CancelledError:
        return


@router.get("/logs")
async def stream_logs(
    request: Request,
    tail: int = Query(
        default=200,
        ge=0,
        le=_MAX_TAIL,
        description="Backlog length to replay on connect. Max 500.",
    ),
) -> EventSourceResponse:
    """SSE stream of the global log tail with an initial backlog frame."""
    return EventSourceResponse(
        _log_event_stream(request, tail),
        ping=_PING_SECONDS,
    )


__all__ = ["router"]
