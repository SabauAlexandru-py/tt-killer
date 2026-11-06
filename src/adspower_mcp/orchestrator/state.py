"""In-memory run state shared between MCP tool calls.

A run is one invocation of `create_accounts` or `warmup_accounts`. The MCP client fires a run,
then polls `run_status(run_id)` for progress. State never spills to disk — if the MCP restarts
mid-run, AdsPower's Chrome windows are still open and recoverable manually.
"""
from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Literal

from ..adspower.schemas import CreatedAccount

RunKind = Literal["create", "warmup"]
RunStatus = Literal["running", "complete", "failed"]


@dataclass
class AccountResult:
    proxy_id: str
    profile_id: str | None
    profile_name: str
    status: Literal["pending", "running", "complete", "failed"] = "pending"
    error: str | None = None
    account: CreatedAccount | None = None
    ip_before: str | None = None
    ip_after: str | None = None
    screenshots: list[str] = field(default_factory=list)


@dataclass
class Run:
    run_id: str
    kind: RunKind
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    status: RunStatus = "running"
    results: list[AccountResult] = field(default_factory=list)
    error: str | None = None

    def mark(self, status: RunStatus, error: str | None = None) -> None:
        self.status = status
        self.error = error
        self.updated_at = time.time()

    def touch(self) -> None:
        """Bump ``updated_at`` without changing status/error.

        Parallel orchestrators call this when a result inside the run changes
        state — the run itself is still ``"running"``, but SSE subscribers polling
        for ``updated_at`` need to see the shared snapshot has fresh data.
        """
        self.updated_at = time.time()


def touch_run(run: "Run") -> None:
    """Module-level alias for ``run.touch()``.

    Lets the orchestrator coroutines import one helper instead of threading the
    ``Run`` object + method call through every state transition. Keeps the
    intent (`touch the shared snapshot`) obvious at the call site.
    """
    run.touch()

    def snapshot(self) -> dict[str, Any]:
        return {
            "run_id": self.run_id,
            "kind": self.kind,
            "status": self.status,
            "error": self.error,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "results": [
                {
                    "proxy_id": r.proxy_id,
                    "profile_id": r.profile_id,
                    "profile_name": r.profile_name,
                    "status": r.status,
                    "error": r.error,
                    "ip_before": r.ip_before,
                    "ip_after": r.ip_after,
                    "account": r.account.model_dump() if r.account else None,
                    "screenshots": r.screenshots,
                }
                for r in self.results
            ],
        }


class RunStore:
    def __init__(self) -> None:
        self._runs: dict[str, Run] = {}

    def new(self, kind: RunKind) -> Run:
        run = Run(run_id=f"run_{uuid.uuid4().hex[:10]}", kind=kind)
        self._runs[run.run_id] = run
        return run

    def get(self, run_id: str) -> Run:
        if run_id not in self._runs:
            raise KeyError(f"Unknown run_id {run_id}. Did the MCP restart?")
        return self._runs[run_id]

    def list_runs(self) -> list[Run]:
        return list(self._runs.values())


store = RunStore()
