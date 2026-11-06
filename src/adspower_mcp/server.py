from __future__ import annotations

from mcp.server.mcpserver import MCPServer

from .tools import creator_tools, proxy_tools, run_tools, warmer_tools


def build_server() -> MCPServer:
    mcp = MCPServer(
        name="adspower-tiktok",
        instructions=(
            "TikTok account factory on top of AdsPower. Email-only signup — no phone required. Typical flow:\n"
            "  1) list_proxies — see what's in AdsPower's Proxy Manager.\n"
            "  2) create_accounts(proxy_ids=[...]) — 1 proxy → 1 profile → email signup via 1secmail + CapSolver.\n"
            "     1secmail domains rotate automatically if TikTok rejects a specific disposable domain.\n"
            "     SadCaptcha solves TikTok's slide / rotate / icon / shapes puzzles in-page.\n"
            "  3) run_status(run_id) — poll until status is 'complete'.\n"
            "  4) warmup_accounts(profile_ids=[...], rotate_between=True) — 15-20 min scroll per profile, \n"
            "     then hit the proxy's rotate URL and verify the new IP via ipify before the next account.\n"
            "AdsPower must be running locally. SADCAPTCHA_API_KEY must be set in .env. "
            "Rotation URLs live in proxies_config.json keyed by proxy_id."
        ),
    )
    proxy_tools.register(mcp)
    creator_tools.register(mcp)
    warmer_tools.register(mcp)
    run_tools.register(mcp)
    return mcp
