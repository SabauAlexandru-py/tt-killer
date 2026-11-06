"""FastAPI entry point for the adspower-mcp Mission Control bridge.

Mounted at `backend.main:app`. All routers live under `/api`. The lifespan
handler logs startup and ensures the runtime data directory exists so the JSON
proxy store has a landing pad.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.config import BackendSettings, get_settings


logger = logging.getLogger("adspower_web_backend")


def _configure_logging(settings: BackendSettings) -> None:
    """Match uvicorn's format and respect LOG_LEVEL from env."""

    level = getattr(logging, settings.log_level.upper(), logging.INFO)
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)s %(name)s :: %(message)s",
    )


@asynccontextmanager
async def _lifespan(app: FastAPI):  # type: ignore[no-untyped-def]
    """Log startup, prepare the data dir, then hand control to uvicorn."""

    settings = get_settings()
    _configure_logging(settings)
    logger.info(
        "Mission Control backend starting on %s:%s (data_dir=%s, origins=%s)",
        settings.host,
        settings.port,
        settings.data_path,
        settings.allowed_origins,
    )
    try:
        yield
    finally:
        logger.info("Mission Control backend shutting down.")


def create_app() -> FastAPI:
    """Factory used by uvicorn and tests. Keeps global side effects minimal."""

    settings = get_settings()

    app = FastAPI(
        title="AdsPower MCP Backend",
        version="0.1.0",
        lifespan=_lifespan,
    )

    # CORS — exact origins + a wildcard regex for Vercel/Cloudflare tunnel subdomains.
    exact_origins = [
        origin for origin in settings.allowed_origins if "*" not in origin
    ]
    wildcard_patterns = [
        origin.replace(".", r"\.").replace("*", r"[^./]+")
        for origin in settings.allowed_origins
        if "*" in origin
    ]
    allow_origin_regex = (
        "|".join(f"^{pattern}$" for pattern in wildcard_patterns)
        if wildcard_patterns
        else None
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=exact_origins or ["*"],
        allow_origin_regex=allow_origin_regex,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Routers are mounted under /api. Imported lazily so this skeleton boots
    # before the route modules exist. Once a router module lands it slots in
    # with no edits here if it exposes `router`.
    try:  # pragma: no cover - import guard for in-progress scaffold
        from backend.routes import proxies as proxies_routes  # noqa: WPS433
        from backend.routes import profiles as profiles_routes  # noqa: WPS433
        from backend.routes import runs as runs_routes  # noqa: WPS433
        from backend.routes import stream as stream_routes  # noqa: WPS433
        from backend.routes import meta as meta_routes  # noqa: WPS433

        for mod in (
            meta_routes,
            proxies_routes,
            profiles_routes,
            runs_routes,
            stream_routes,
        ):
            router = getattr(mod, "router", None)
            if router is not None:
                app.include_router(router, prefix="/api")
    except ModuleNotFoundError as missing:
        logger.warning("Route module not available yet: %s", missing.name)

    return app


app = create_app()
