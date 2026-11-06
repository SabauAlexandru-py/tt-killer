"""Thread-safe ring buffer + stdlib logging handler that feeds `/stream/logs`.

Why a logging-handler path instead of pushing lines from the orchestrators
directly: `adspower_mcp.orchestrator.creator` and `.warmer` already emit every
meaningful step through the stdlib `logging` module. Plumbing an explicit push
callback through those call sites would touch dozens of lines and leak a
backend-only concern into the MCP core. Attaching one `logging.Handler` keeps
the orchestrators untouched and the ring population sync-safe (log records can
originate on FastMCP worker threads with no running event loop of their own).

The SSE endpoint polls `RingBuffer.since(seq)` rather than waking on an
`asyncio.Condition` — same reason: log records arrive on arbitrary threads and
would need a `loop.call_soon_threadsafe` dance to notify. At 0.5s cadence the
UI tail stays smooth without thread/loop juggling.

NOTE: The handler is installed as an import side-effect at the bottom of this
module. That means the first import (from `backend.main` or from
`backend.routes.stream`) wires the handler; `install_log_ring_handler()` is
idempotent so repeat imports under `--reload` do not double-attach.
"""
from __future__ import annotations

import logging
import threading
from collections import deque
from typing import Iterable

# (seq, formatted line). Monotonically increasing seq lets SSE clients
# resume from exactly where they left off even across ring wraparound.
RingItem = tuple[int, str]

_DEFAULT_MAXLEN = 500
_DEFAULT_FORMAT = "%(asctime)s %(levelname)-5s %(name)s | %(message)s"
_DEFAULT_LOGGER_NAMES: tuple[str, ...] = ("adspower_mcp", "backend")


class RingBuffer:
    """Thread-safe bounded ring with monotonic sequence numbers.

    `deque(maxlen=N)` handles eviction. The lock protects the seq counter and
    the snapshot copy against concurrent `push` calls from logging threads
    while the SSE generator is reading.
    """

    def __init__(self, maxlen: int = _DEFAULT_MAXLEN) -> None:
        self._items: deque[RingItem] = deque(maxlen=maxlen)
        self._next_seq: int = 0
        self._lock = threading.Lock()

    # --- writers (called from arbitrary threads via logging) ---------------

    def push(self, line: str) -> int:
        """Append a line. Returns the seq assigned to it."""
        with self._lock:
            seq = self._next_seq
            self._items.append((seq, line))
            self._next_seq = seq + 1
            return seq

    def clear(self) -> None:
        with self._lock:
            self._items.clear()
            # intentionally NOT resetting _next_seq — consumers rely on
            # monotonicity across clears.

    # --- readers (called from the SSE generator) ---------------------------

    def snapshot(self) -> list[RingItem]:
        """Current contents, oldest first."""
        with self._lock:
            return list(self._items)

    def tail(self, n: int) -> list[RingItem]:
        """Last `n` items (or all, if fewer)."""
        if n <= 0:
            return []
        with self._lock:
            return list(self._items)[-n:]

    def since(self, seq: int) -> list[RingItem]:
        """All items whose seq is strictly greater than `seq`."""
        with self._lock:
            return [item for item in self._items if item[0] > seq]

    @property
    def latest_seq(self) -> int:
        """Last seq assigned, or -1 if nothing has been pushed yet."""
        with self._lock:
            return self._next_seq - 1


class RingBufferHandler(logging.Handler):
    """Logging handler that writes formatted records into a `RingBuffer`."""

    def __init__(self, ring: RingBuffer) -> None:
        super().__init__()
        self._ring = ring

    def emit(self, record: logging.LogRecord) -> None:  # pragma: no cover
        try:
            self._ring.push(self.format(record))
        except Exception:
            # logging.Handler protocol — never raise from emit()
            self.handleError(record)


# --- module-level singletons ------------------------------------------------

_LOG_RING: RingBuffer = RingBuffer(maxlen=_DEFAULT_MAXLEN)
_INSTALLED_LOGGERS: set[str] = set()


def get_log_ring() -> RingBuffer:
    """Accessor for the shared log ring. Stable across imports."""
    return _LOG_RING


def install_log_ring_handler(
    level: int = logging.INFO,
    extra_loggers: Iterable[str] = (),
    fmt: str = _DEFAULT_FORMAT,
) -> RingBufferHandler:
    """Attach the ring buffer handler to backend + orchestrator loggers.

    Idempotent: safe to call repeatedly (uvicorn `--reload`, pytest, etc.) —
    it tracks which logger names have already been wired and skips them.
    """
    handler = RingBufferHandler(_LOG_RING)
    handler.setLevel(level)
    handler.setFormatter(logging.Formatter(fmt))

    targets = tuple(_DEFAULT_LOGGER_NAMES) + tuple(extra_loggers)
    for name in targets:
        if name in _INSTALLED_LOGGERS:
            continue
        lg = logging.getLogger(name)
        # Guard against duplicate attach if another import path raced us.
        if not any(isinstance(h, RingBufferHandler) for h in lg.handlers):
            lg.addHandler(handler)
        # Make sure records at `level` actually propagate to the handler.
        if lg.level == logging.NOTSET or lg.level > level:
            lg.setLevel(level)
        _INSTALLED_LOGGERS.add(name)

    return handler


# Install on first import. `backend.main` can also call this explicitly from
# its lifespan if it wants to pass custom logger names.
install_log_ring_handler()
