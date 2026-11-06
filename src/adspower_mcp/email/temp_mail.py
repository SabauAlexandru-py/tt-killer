"""1secmail-backed temporary email provider.

1secmail exposes a public JSON API with no auth: perfect for throwaway TikTok signup mailboxes.
If 1secmail is down (they rate-limit occasionally) swap to mail.tm or your preferred provider —
only the three methods below need re-implementing.
"""
from __future__ import annotations

import asyncio
import random
import re
import string
import time
from dataclasses import dataclass

import httpx

_BASE = "https://www.1secmail.com/api/v1/"
_CODE_RE = re.compile(r"\b(\d{4,8})\b")


@dataclass
class TempMailbox:
    login: str
    domain: str

    @property
    def address(self) -> str:
        return f"{self.login}@{self.domain}"


def _random_login() -> str:
    return "".join(random.choices(string.ascii_lowercase + string.digits, k=12))


async def create_mailbox() -> TempMailbox:
    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.get(_BASE, params={"action": "getDomainList"})
        domains = response.json() or ["1secmail.com"]
    return TempMailbox(login=_random_login(), domain=random.choice(domains))


async def wait_for_code(mailbox: TempMailbox, *, timeout_seconds: float = 180.0) -> str:
    deadline = time.monotonic() + timeout_seconds
    async with httpx.AsyncClient(timeout=15.0) as client:
        while time.monotonic() < deadline:
            messages = await client.get(
                _BASE,
                params={
                    "action": "getMessages",
                    "login": mailbox.login,
                    "domain": mailbox.domain,
                },
            )
            inbox = messages.json() or []
            for msg in inbox:
                msg_id = msg.get("id")
                if not msg_id:
                    continue
                detail = await client.get(
                    _BASE,
                    params={
                        "action": "readMessage",
                        "login": mailbox.login,
                        "domain": mailbox.domain,
                        "id": msg_id,
                    },
                )
                body = (detail.json() or {}).get("textBody", "")
                match = _CODE_RE.search(body)
                if match:
                    return match.group(1)
            await asyncio.sleep(5.0)
    raise TimeoutError(f"No email code arrived at {mailbox.address} within {timeout_seconds}s.")
