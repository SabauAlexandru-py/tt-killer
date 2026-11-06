from __future__ import annotations

from typing import Any

from mcp.server.mcpserver import MCPServer

from ..adspower.client import AdsPowerClient
from ..adspower.proxies import list_proxies


def register(mcp: MCPServer) -> None:
    @mcp.tool(
        name="list_proxies",
        description=(
            "Return every proxy in AdsPower's Proxy Manager. These proxy_ids are what you pass to "
            "create_accounts. Rotation URLs are merged from proxies_config.json when present."
        ),
    )
    async def _list_proxies() -> dict[str, Any]:
        async with AdsPowerClient() as api:
            proxies = await list_proxies(api)
        return {
            "count": len(proxies),
            "proxies": [p.model_dump() for p in proxies],
        }
