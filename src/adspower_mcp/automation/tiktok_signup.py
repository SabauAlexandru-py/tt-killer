"""TikTok email-based signup, fully automated via SadCaptcha.

Selectors reflect TikTok's EN web signup as of 2026-Q4. If TikTok renames a data-e2e attribute,
update the `S` dict only. The flow:

1. Open the age-gate + email form, fill DOB and email.
2. Click "Send code". SadCaptcha's AsyncPlaywrightSolver resolves the puzzle in-page.
3. Poll 1secmail for the email verification code, enter it, next.
4. Set password. Pick a username if TikTok asks for one.
5. Return a CreatedAccount record.

Domain rotation: TikTok rejects some disposable-email domains with "This email isn't supported".
If that happens the flow retries with a different 1secmail domain before giving up — up to
MAX_DOMAIN_ATTEMPTS attempts.
"""
from __future__ import annotations

import asyncio
import random
import secrets
import string
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from playwright.async_api import Page, TimeoutError as PWTimeoutError

from ..adspower.schemas import CreatedAccount
from ..captcha.sadcaptcha import make_solver
from ..config import get_settings
from ..email.temp_mail import TempMailbox, create_mailbox, wait_for_code
from .browser import ConnectedBrowser, connect

_SIGNUP_URL = "https://www.tiktok.com/signup/phone-or-email/email"
MAX_DOMAIN_ATTEMPTS = 4

S = {
    "age_month": 'div[data-e2e="select-month"]',
    "age_day": 'div[data-e2e="select-day"]',
    "age_year": 'div[data-e2e="select-year"]',
    "dropdown_option": 'div[data-e2e="select-list"] div[role="option"]',
    "email_input": 'input[name="email"], input[type="email"]',
    "send_code": 'button[data-e2e="send-code"]',
    "otp_input": 'input[name="code"]',
    "next_button": 'button[data-e2e="next-button"], button[type="submit"]',
    "password_input": 'input[name="password"]',
    "username_input": 'input[name="username"]',
    "email_error": '[data-e2e="email-error"], div[class*="error"]',
}

_MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]

_UNSUPPORTED_EMAIL_PHRASES = (
    "isn't supported",
    "is not supported",
    "not valid",
    "invalid email",
    "unable to register",
)


@dataclass
class SignupResult:
    account: CreatedAccount | None
    screenshots: list[str]
    error: str | None = None


def random_password(length: int = 14) -> str:
    alphabet = string.ascii_letters + string.digits + "!@#$%^&*"
    while True:
        candidate = "".join(secrets.choice(alphabet) for _ in range(length))
        if (
            any(c.islower() for c in candidate)
            and any(c.isupper() for c in candidate)
            and any(c.isdigit() for c in candidate)
            and any(c in "!@#$%^&*" for c in candidate)
        ):
            return candidate


async def _snap(page: Page, out_dir: Path, label: str, bag: list[str]) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"{len(bag):02d}-{label}.png"
    try:
        await page.screenshot(path=str(path), full_page=True)
        bag.append(str(path))
    except Exception:
        pass


async def _pick_dropdown(page: Page, trigger: str, label: str) -> None:
    await page.click(trigger)
    option = page.locator(S["dropdown_option"], has_text=label).first
    await option.wait_for(state="visible", timeout=5_000)
    await option.click()


async def _email_rejected(page: Page) -> bool:
    """Peek at visible errors to tell if TikTok refused the domain."""
    try:
        text = (await page.locator("body").inner_text(timeout=1_000)).lower()
    except Exception:
        return False
    return any(phrase in text for phrase in _UNSUPPORTED_EMAIL_PHRASES)


async def _submit_email_with_rotation(
    page: Page, solver, out_dir: Path, shots: list[str]
) -> TempMailbox:
    """Try up to MAX_DOMAIN_ATTEMPTS 1secmail domains; return the mailbox TikTok accepted.

    After each Send-code click we let SadCaptcha solve whatever TikTok throws (puzzle / rotate /
    shapes) before waiting on the OTP field.
    """
    last_error = ""
    for attempt in range(1, MAX_DOMAIN_ATTEMPTS + 1):
        mailbox = await create_mailbox()
        await page.fill(S["email_input"], mailbox.address)
        await _snap(page, out_dir, f"email-filled-{attempt}", shots)
        await page.click(S["send_code"])

        # SadCaptcha resolves any puzzle variant in-page. ~2-8 seconds typical.
        try:
            await solver.solve_captcha_if_present(captcha_detect_timeout=15, retries=3)
        except Exception as exc:
            last_error = f"SadCaptcha solve failed on attempt {attempt}: {exc}"
            await _snap(page, out_dir, f"captcha-error-{attempt}", shots)

        try:
            await page.wait_for_selector(S["otp_input"], timeout=30_000)
            await _snap(page, out_dir, f"otp-ready-{attempt}", shots)
            return mailbox
        except PWTimeoutError:
            if await _email_rejected(page):
                last_error = f"TikTok rejected {mailbox.domain} on attempt {attempt}."
                await _snap(page, out_dir, f"email-rejected-{attempt}", shots)
                try:
                    await page.fill(S["email_input"], "")
                except Exception:
                    pass
                continue
            last_error = (
                f"OTP field never appeared on attempt {attempt}. "
                "SadCaptcha may have failed on a new puzzle variant."
            )
            await _snap(page, out_dir, f"otp-missing-{attempt}", shots)
            break
    raise RuntimeError(
        last_error or f"Email signup failed after {MAX_DOMAIN_ATTEMPTS} domain rotations."
    )


async def signup(
    *,
    cdp_endpoint: str,
    profile_id: str,
    profile_name: str,
    proxy_id: str,
    birth_year: int,
    birth_month: int,
    birth_day: int,
) -> SignupResult:
    settings = get_settings()
    out_dir = Path(settings.screenshots_dir).expanduser() / profile_id
    shots: list[str] = []
    bundle: ConnectedBrowser | None = None
    try:
        bundle = await connect(cdp_endpoint)
        page = bundle.page
        solver = make_solver(page)

        # Age + email form -----------------------------------------------------------------
        await page.goto(_SIGNUP_URL, wait_until="domcontentloaded", timeout=30_000)
        await _snap(page, out_dir, "signup-open", shots)

        await _pick_dropdown(page, S["age_month"], _MONTHS[birth_month - 1])
        await _pick_dropdown(page, S["age_day"], str(birth_day))
        await _pick_dropdown(page, S["age_year"], str(birth_year))

        mailbox = await _submit_email_with_rotation(page, solver, out_dir, shots)
        code = await wait_for_code(mailbox, timeout_seconds=settings.email_code_timeout_seconds)
        await page.fill(S["otp_input"], code)
        await page.click(S["next_button"])

        # Password ------------------------------------------------------------------------
        await page.wait_for_selector(S["password_input"], timeout=30_000)
        password = random_password()
        await page.fill(S["password_input"], password)
        await page.click(S["next_button"])

        # Username (TikTok sometimes skips this step and auto-assigns) --------------------
        username: str | None = None
        try:
            await page.wait_for_selector(S["username_input"], timeout=10_000)
            username = f"tt_{mailbox.login[:6]}_{random.randint(100, 999)}"
            await page.fill(S["username_input"], username)
            await page.click(S["next_button"])
        except PWTimeoutError:
            pass

        await asyncio.sleep(3)
        await _snap(page, out_dir, "signup-complete", shots)

        account = CreatedAccount(
            profile_id=profile_id,
            profile_name=profile_name,
            proxy_id=proxy_id,
            email=mailbox.address,
            password=password,
            username=username,
            created_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        )
        return SignupResult(account=account, screenshots=shots)
    except Exception as exc:
        if bundle is not None:
            await _snap(bundle.page, out_dir, "signup-error", shots)
        return SignupResult(account=None, screenshots=shots, error=str(exc))
    finally:
        if bundle is not None:
            await bundle.close()
