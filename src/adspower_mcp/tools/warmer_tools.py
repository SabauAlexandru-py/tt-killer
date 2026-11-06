from __future__ import annotations

import asyncio
from typing import Annotated, Any

from mcp.server.mcpserver import MCPServer
from pydantic import Field

from ..orchestrator.state import store
from ..orchestrator.warmer import warmup_accounts_run


def register(mcp: MCPServer) -> None:
    @mcp.tool(
        name="warmup_accounts",
        description=(
            "Warm up selected TikTok profiles: open each, scroll the For You feed for 15-20 min "
            "with 5-15s between scrolls, close, hit the proxy rotate URL, verify the new IP "
            "differs via ipify, then move on. Returns a run_id — poll run_status(run_id)."
        ),
    )
    async def warmup_accounts(
        profile_ids: Annotated[
            list[str] | None,
            Field(description="AdsPower user_ids to warm. Omit to warm every profile that has a proxy attached."),
        ] = None,
        rotate_between: Annotated[
            bool,
            Field(description="Hit the proxy rotation URL between accounts and verify the IP changed."),
        ] = True,
    ) -> dict[str, Any]:
        run = store.new("warmup")
        asyncio.create_task(warmup_accounts_run(run, profile_ids=profile_ids, rotate_between=rotate_between))
        return {"run_id": run.run_id, "status": "started"}
