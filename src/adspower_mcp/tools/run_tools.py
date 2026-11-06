from __future__ import annotations

from typing import Annotated, Any

from mcp.server.mcpserver import MCPServer
from pydantic import Field

from ..orchestrator.state import store


def register(mcp: MCPServer) -> None:
    @mcp.tool(
        name="run_status",
        description=(
            "Get the current state of a create or warmup run started by create_accounts / "
            "warmup_accounts. Returns per-profile status, errors, IPs before/after rotation, "
            "credentials of successful signups, and screenshot paths for debugging."
        ),
    )
    async def run_status(
        run_id: Annotated[str, Field(description="run_id returned by create_accounts or warmup_accounts.")],
    ) -> dict[str, Any]:
        try:
            run = store.get(run_id)
        except KeyError as exc:
            return {"run_id": run_id, "status": "unknown", "error": str(exc)}
        return run.snapshot()

    @mcp.tool(
        name="list_runs",
        description="List every run (create + warmup) started in this MCP session.",
    )
    async def list_runs() -> dict[str, Any]:
        return {
            "runs": [
                {
                    "run_id": r.run_id,
                    "kind": r.kind,
                    "status": r.status,
                    "created_at": r.created_at,
                    "updated_at": r.updated_at,
                    "account_count": len(r.results),
                }
                for r in store.list_runs()
            ]
        }
