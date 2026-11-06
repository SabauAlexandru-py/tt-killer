"""JSON-backed local proxy store.

Not AdsPower-backed. Holds the operator's proxy pool on disk at
``<data_dir>/proxies.json`` and exposes CRUD plus a small
``set_ip`` helper used after rotation / verify-ip calls.

Design contract:
- Atomic writes: read all, mutate, write-temp + ``os.replace`` (POSIX rename).
- Thread-safe: a single :class:`threading.Lock` guards every read/write.
- Idempotent bootstrap: creates the parent directory and an empty file
  if either is missing.
- Pure data layer: no HTTP, no FastAPI, no AdsPower calls. Rotation and
  verify-ip live in ``backend/routes/proxies.py`` and feed us via
  :py:meth:`ProxyStore.set_ip`.
"""

from __future__ import annotations

import json
import os
import tempfile
import threading
import uuid
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, ValidationError

ProxyType = Literal["http", "https", "socks5"]


def _now_iso() -> str:
    """UTC timestamp with timezone suffix, second-stable for logs/tests."""
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _new_id() -> str:
    return uuid.uuid4().hex


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------


class StoredProxy(BaseModel):
    """One row in ``proxies.json``.

    Field order mirrors the DESIGN_SPEC contract so JSON reads cleanly in
    a terminal diff. ``rotation_url`` and the credential pair are optional
    because not every residential pool exposes them.
    """

    id: str = Field(default_factory=_new_id)
    name: str
    host: str
    port: int
    type: ProxyType
    user: Optional[str] = None
    password: Optional[str] = None
    rotation_url: Optional[str] = None
    last_known_ip: Optional[str] = None
    last_rotated_at: Optional[str] = None
    created_at: str = Field(default_factory=_now_iso)


class StoredProxyCreate(BaseModel):
    """Input shape for POST /api/proxies — the server fills id/created_at/last_*."""

    name: str
    host: str
    port: int
    type: ProxyType
    user: Optional[str] = None
    password: Optional[str] = None
    rotation_url: Optional[str] = None


class StoredProxyUpdate(BaseModel):
    """Input shape for PATCH /api/proxies/{id} — every field is optional."""

    name: Optional[str] = None
    host: Optional[str] = None
    port: Optional[int] = None
    type: Optional[ProxyType] = None
    user: Optional[str] = None
    password: Optional[str] = None
    rotation_url: Optional[str] = None


# ---------------------------------------------------------------------------
# Store
# ---------------------------------------------------------------------------


class ProxyStore:
    """Thread-safe JSON store for :class:`StoredProxy` rows.

    Not async. FastAPI routes should call these methods via
    ``run_in_threadpool`` when they want to stay off the event loop; the
    store itself is cheap (single-digit KB file) and the lock is held for
    microseconds in normal use.
    """

    def __init__(self, path: Path) -> None:
        self._path = Path(path)
        self._lock = threading.Lock()
        self._ensure_file()

    # -- internals ---------------------------------------------------------

    def _ensure_file(self) -> None:
        """Create parent dir and an empty ``[]`` file if missing."""
        self._path.parent.mkdir(parents=True, exist_ok=True)
        if not self._path.exists():
            self._atomic_write([])

    def _read_raw(self) -> list[dict[str, Any]]:
        """Return the raw JSON list. Tolerates an empty file.

        Does NOT acquire the lock — callers must hold it.
        """
        try:
            text = self._path.read_text(encoding="utf-8")
        except FileNotFoundError:
            return []
        if not text.strip():
            return []
        try:
            data = json.loads(text)
        except json.JSONDecodeError as exc:
            raise RuntimeError(
                f"proxies.json at {self._path} is corrupt: {exc.msg} "
                f"(line {exc.lineno}, col {exc.colno})"
            ) from exc
        if not isinstance(data, list):
            raise RuntimeError(
                f"proxies.json at {self._path} must be a JSON array, "
                f"got {type(data).__name__}"
            )
        return data

    def _read_models(self) -> list[StoredProxy]:
        rows: list[StoredProxy] = []
        for row in self._read_raw():
            try:
                rows.append(StoredProxy.model_validate(row))
            except ValidationError as exc:
                raise RuntimeError(
                    f"proxies.json contains an invalid row: {exc.errors()}"
                ) from exc
        return rows

    def _atomic_write(self, rows: list[Any]) -> None:
        """Write ``rows`` as a JSON array atomically.

        Accepts either dicts or :class:`StoredProxy` instances. Serializes
        via Pydantic for models so field ordering stays stable.
        """
        payload: list[dict[str, Any]] = []
        for row in rows:
            if isinstance(row, StoredProxy):
                payload.append(row.model_dump())
            elif isinstance(row, dict):
                payload.append(row)
            else:
                raise TypeError(
                    f"ProxyStore row must be StoredProxy or dict, got "
                    f"{type(row).__name__}"
                )

        serialized = json.dumps(payload, indent=2, ensure_ascii=False) + "\n"

        # Write to a temp file in the same directory, fsync, then rename.
        # Same dir keeps the rename atomic across the same filesystem.
        parent = self._path.parent
        fd, tmp_path = tempfile.mkstemp(
            prefix=".proxies.", suffix=".json.tmp", dir=str(parent)
        )
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                fh.write(serialized)
                fh.flush()
                os.fsync(fh.fileno())
            os.replace(tmp_path, self._path)
        except Exception:
            # Best-effort cleanup if replace never happened.
            try:
                os.unlink(tmp_path)
            except FileNotFoundError:
                pass
            raise

    # -- public API --------------------------------------------------------

    def list(self) -> list[StoredProxy]:  # noqa: A003 — mirrors the spec verb
        with self._lock:
            return self._read_models()

    def get(self, id: str) -> StoredProxy:  # noqa: A002 — spec verb
        with self._lock:
            for row in self._read_models():
                if row.id == id:
                    return row
        raise KeyError(f"proxy {id!r} not found")

    def create(self, data: "StoredProxyCreate | dict[str, Any] | StoredProxy") -> StoredProxy:
        """Alias for :py:meth:`add` that also accepts a StoredProxyCreate model."""
        if isinstance(data, StoredProxyCreate):
            return self.add(data.model_dump(exclude_none=False))
        return self.add(data)

    def add(self, data: dict[str, Any] | StoredProxy) -> StoredProxy:
        """Insert a new row. Generates ``id`` and ``created_at`` if absent.

        Accepts a dict (typical FastAPI handler input) or a pre-built
        :class:`StoredProxy`. Never trusts a client-supplied id — always
        mints a new uuid — because an id collision would corrupt lookups.
        """
        if isinstance(data, StoredProxy):
            payload = data.model_dump()
        else:
            payload = dict(data)

        # Force a fresh id + created_at even if the caller tried to set them.
        payload["id"] = _new_id()
        payload["created_at"] = _now_iso()
        row = StoredProxy.model_validate(payload)

        with self._lock:
            rows = self._read_models()
            rows.append(row)
            self._atomic_write(rows)
        return row

    def bulk_create(
        self,
        items: "list[StoredProxyCreate] | list[dict[str, Any]]",
    ) -> list[StoredProxy]:
        """Insert many rows under one lock and one disk write.

        Every item is coerced to :class:`StoredProxy` with a freshly minted
        ``id`` and ``created_at`` — client-supplied values for those two
        fields are discarded, same as :py:meth:`add`.

        Returns the list of :class:`StoredProxy` instances that were inserted,
        in the same order as ``items``. An empty input list is a no-op and
        returns ``[]`` without touching the lock.
        """
        if not items:
            return []

        new_rows: list[StoredProxy] = []
        for item in items:
            if isinstance(item, StoredProxyCreate):
                payload = item.model_dump()
            elif isinstance(item, StoredProxy):
                payload = item.model_dump()
            elif isinstance(item, BaseModel):
                payload = item.model_dump()
            elif isinstance(item, dict):
                payload = dict(item)
            else:
                raise TypeError(
                    f"bulk_create item must be StoredProxyCreate/StoredProxy/dict, "
                    f"got {type(item).__name__}"
                )
            payload["id"] = _new_id()
            payload["created_at"] = _now_iso()
            new_rows.append(StoredProxy.model_validate(payload))

        with self._lock:
            rows = self._read_models()
            rows.extend(new_rows)
            self._atomic_write(rows)
        return new_rows

    def update(self, id: str, patch: "dict[str, Any] | BaseModel") -> StoredProxy:  # noqa: A002
        """Shallow-merge ``patch`` into the row with the given id.

        Accepts a dict or any Pydantic model (e.g. StoredProxyUpdate). Rejects
        any attempt to rewrite ``id`` or ``created_at`` so the audit trail
        stays honest.
        """
        if isinstance(patch, BaseModel):
            patch = patch.model_dump(exclude_none=True)
        if not isinstance(patch, dict):
            raise TypeError(f"patch must be a dict or BaseModel, got {type(patch).__name__}")

        immutable = {"id", "created_at"}
        clean_patch = {k: v for k, v in patch.items() if k not in immutable}

        with self._lock:
            rows = self._read_models()
            for idx, row in enumerate(rows):
                if row.id == id:
                    merged = {**row.model_dump(), **clean_patch}
                    updated = StoredProxy.model_validate(merged)
                    rows[idx] = updated
                    self._atomic_write(rows)
                    return updated
        raise KeyError(f"proxy {id!r} not found")

    def delete(self, id: str) -> None:  # noqa: A002
        with self._lock:
            rows = self._read_models()
            remaining = [r for r in rows if r.id != id]
            if len(remaining) == len(rows):
                raise KeyError(f"proxy {id!r} not found")
            self._atomic_write(remaining)

    def set_ip(self, id: str, ip: str, when: Optional[str] = None) -> None:  # noqa: A002
        """Record a new ``last_known_ip`` and bump ``last_rotated_at``.

        ``when`` is optional — defaults to now in UTC — so routes can pass
        an explicit timestamp when they want the IP-check and the DB write
        to line up with the external request.
        """
        timestamp = when or _now_iso()
        with self._lock:
            rows = self._read_models()
            for idx, row in enumerate(rows):
                if row.id == id:
                    merged = row.model_dump()
                    merged["last_known_ip"] = ip
                    merged["last_rotated_at"] = timestamp
                    rows[idx] = StoredProxy.model_validate(merged)
                    self._atomic_write(rows)
                    return
        raise KeyError(f"proxy {id!r} not found")


# ---------------------------------------------------------------------------
# Singleton accessor
# ---------------------------------------------------------------------------


@lru_cache(maxsize=1)
def get_store() -> ProxyStore:
    """Return the process-wide :class:`ProxyStore`.

    Honors :attr:`backend.config.BackendSettings.data_dir`. Imported lazily
    so this module stays import-safe even if ``config`` is being edited;
    FastAPI routes always hit the singleton via this accessor, which keeps
    tests simple (patch ``get_store`` or clear its cache).
    """
    from .config import BackendSettings  # local import avoids import cycle

    settings = BackendSettings()
    data_dir = Path(settings.data_dir)
    return ProxyStore(data_dir / "proxies.json")

# Backwards-compatible alias for routes that import 'Store'.
Store = ProxyStore

