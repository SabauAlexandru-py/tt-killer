from __future__ import annotations

import asyncio
from typing import Annotated, Any

from mcp.server.mcpserver import MCPServer
from pydantic import Field

from ..orchestrator.creator import create_accounts_run
from ..orchestrator.state import store


def register(mcp: MCPServer) -> None:
    @mcp.tool(
        name="create_accounts",
        description=(
            "Create one TikTok account per selected proxy via EMAIL signup. Each proxy gets a new "
            "AdsPower profile named '<prefix> #N', a fresh 1secmail inbox (with domain rotation "
            "if TikTok rejects a domain), and a random strong password. The CapSolver extension "
            "(if installed) auto-solves the signup puzzle. Returns a run_id — poll run_status."
        ),
    )
    async def create_accounts(
        proxy_ids: Annotated[
            list[str] | None,
            Field(description="Which proxies from list_proxies to use. Omit to use ALL proxies."),
        ] = None,
        name_prefix: Annotated[
            str | None,
            Field(description="Profile name prefix. Default: TIKTOK_PROFILE_NAME_PREFIX env var."),
        ] = None,
        rotate_between: Annotated[
            bool | None,
            Field(description="Rotate each proxy's IP before the next account. Default from env."),
        ] = None,
        birth_year: Annotated[int | None, Field(ge=1950, le=2010)] = None,
    ) -> dict[str, Any]:
        run = store.new("create")
        asyncio.create_task(
            create_accounts_run(
                run,
                proxy_ids=proxy_ids,
                name_prefix=name_prefix,
                rotate_between=rotate_between,
                birth_year=birth_year,
            )
        )
        return {"run_id": run.run_id, "status": "started"}
