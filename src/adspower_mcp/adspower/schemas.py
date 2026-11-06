from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class AdsPowerResponse(BaseModel):
    """Envelope every AdsPower Local API endpoint uses."""

    model_config = ConfigDict(extra="allow")

    code: int
    msg: str = ""
    data: Any = None

    @property
    def ok(self) -> bool:
        return self.code == 0


class Proxy(BaseModel):
    """One proxy entry inside AdsPower's Proxy Manager."""

    model_config = ConfigDict(extra="allow")

    proxy_id: str = Field(description="AdsPower proxy_id used when attaching to a profile.")
    proxy_soft: str | None = None
    proxy_type: str | None = None
    proxy_host: str | None = None
    proxy_port: str | None = None
    proxy_user: str | None = None
    proxy_password: str | None = None
    name: str | None = None
    global_config: str | None = None
    rotation_url: str | None = Field(
        default=None,
        description=(
            "Not an AdsPower field. Populated by this MCP from proxies_config.json so the warmer "
            "can hit the provider's rotation endpoint between accounts."
        ),
    )


class ProfileSummary(BaseModel):
    model_config = ConfigDict(extra="allow")

    user_id: str
    name: str | None = None
    group_id: str | None = None
    group_name: str | None = None
    serial_number: str | None = None
    created_time: str | None = None
    ip: str | None = None
    ip_country: str | None = None
    user_proxy_config: dict[str, Any] | None = None


class BrowserStartInfo(BaseModel):
    model_config = ConfigDict(extra="allow")

    ws: dict[str, str] = Field(default_factory=dict)
    debug_port: str | None = None
    webdriver: str | None = None

    @property
    def cdp_endpoint(self) -> str | None:
        return self.ws.get("puppeteer")


class CreatedAccount(BaseModel):
    """Everything worth keeping after a successful signup run."""

    profile_id: str
    profile_name: str
    proxy_id: str
    email: str
    password: str
    username: str | None = None
    created_at: str
