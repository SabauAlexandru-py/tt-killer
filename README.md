# adspower-mcp — TikTok account factory on AdsPower

MCP server that creates and warms TikTok accounts through AdsPower profiles, one profile per
mobile proxy, with rotation between accounts and warmup sessions. Email-only signup — no SMS.

## Now with a web UI (Mission Control)

A dark, data-dense **three-pane dashboard** (Nav · Center · Inspector) built for operators who
leave the page open watching N parallel signups and warmups. The Python MCP is unchanged — the
UI drives the same tools through a thin FastAPI bridge.

- **Add proxies via a real form** — name, host, port, type, auth, rotation URL — not JSON editing
- **One-click create accounts** — pick proxies, hit *Create accounts*, run_id streams live
- **Live run tracking** — per-account `ProgressPips`, `ElapsedTimer`, inline screenshot thumbs
  (hover to expand), full `LogStream` pane, errors surfaced inline
- **Cmd+K palette** — jump to any run, proxy, or profile without touching the mouse
- **Deploys to Vercel** — frontend ships to Vercel out of the box; backend tunnels from your
  machine via Cloudflare Tunnel so AdsPower stays local

Monorepo at a glance:

```
adspower-mcp/
├── src/adspower_mcp/   Python MCP server (unchanged)
├── backend/            FastAPI bridge, local-only, JSON proxy store
├── frontend/           Next.js 15 app, Vercel-deployable
├── docs/deployment.md  Local, Vercel, and tunnel setup
└── package.json        pnpm concurrently runner for dev
```

Full wiring, CORS notes, and troubleshooting live in [`docs/deployment.md`](./docs/deployment.md).

## One-command start

```bash
cd ~/Downloads/adspower-mcp
./start.sh
```

`./start.sh` does the whole install + boot in one shot:

- Checks you have `python3.11+`, `node 20+`, `pnpm 9+`, and `uv` — fails loud with install hints if any are missing
- Creates `backend/.venv`, installs the FastAPI bridge with `uv pip install -e .`, and runs `playwright install chromium` (one-time ~300 MB)
- Runs `pnpm install` in the repo root (hydrates `frontend/`)
- Copies `.env.example → .env` if `.env` is missing and prompts you to paste your `SADCAPTCHA_API_KEY`
- Confirms AdsPower's Local API is reachable on `localhost:50325` (warns, doesn't block, if AdsPower isn't open yet)
- Launches `pnpm dev` — FastAPI on `:8080`, Next.js on `:3000`, both under `concurrently`

Re-runs of `./start.sh` are idempotent: existing `.venv` and `node_modules` are reused, deps are only re-installed on `pyproject.toml` / `package.json` churn, and Chromium isn't re-downloaded. First run: ~3–5 min. Subsequent runs: ~5 sec to boot both servers.

If you'd rather do each step by hand, [Quick start](#quick-start) below still works.

## Share with a friend

Onboarding someone else? Send them [`docs/friend-guide.md`](./docs/friend-guide.md). It's a zero-assumption walkthrough — what to install, where to get a SadCaptcha key, how to add proxies, how to read the UI, and a troubleshooting table for the stuff that goes wrong first. The friend guide now leads with `./start.sh` too, so they can be up on `localhost:3000` in one command without touching the Python or Node setup themselves.

## Quick start

```bash
cd ~/Downloads/adspower-mcp
pnpm install
(cd backend && uv pip install -e .)
pnpm dev
```

`pnpm dev` runs the FastAPI bridge on `:8080` and the Next.js UI on `:3000` under `concurrently`.
Open `http://localhost:3000`. Classic MCP-only workflow? Skip the UI and keep reading.

## What it does

**Creator flow** (email-only, no phone numbers):
`list_proxies` → `create_accounts(proxy_ids=[...])` → for each proxy: optionally rotate IP,
create AdsPower profile `TikTok Acc #N`, start browser over CDP, load
`tiktok.com/signup/phone-or-email/email`, pick DOB, mint 1secmail inbox, SadCaptcha solves the
puzzle in-page, paste email code, set password, pick username, stop browser.

**Warmer flow**:
`warmup_accounts(profile_ids=[...], rotate_between=True)` → for each profile: start browser,
read egress IP from ipify, open `/foryou`, scroll 15–20 min with 5–15 s jitter, stop browser,
hit `proxy.rotation_url`, re-open, assert new IP != old IP, move on.

## Requirements

- Python 3.11+ · Node 20+ · pnpm 9+
- AdsPower desktop running, Local API on `localhost:50325`
- Mobile proxies in AdsPower's Proxy Manager
- SadCaptcha API key (TikTok puzzle solver — 25 free credits at sadcaptcha.com)
- `playwright install chromium`

## Install (MCP only)

```bash
cd ~/Downloads/adspower-mcp
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
playwright install chromium
cp .env.example .env
cp proxies_config.example.json proxies_config.json
```

Edit `.env` (`SADCAPTCHA_API_KEY`, birth-year default) and `proxies_config.json` (map each
`proxy_id` from `list_proxies` to its provider's rotation URL).

## Wire the MCP into Claude Code

```json
{
  "mcpServers": {
    "adspower-tiktok": {
      "command": "/absolute/path/to/adspower-mcp/.venv/bin/adspower-mcp"
    }
  }
}
```

Or run standalone: `adspower-mcp`. Speaks MCP over stdio, stays idle until a tool is called.

## Tools exposed

| Tool              | Purpose                                                     |
|-------------------|-------------------------------------------------------------|
| `list_proxies`    | Show AdsPower Proxy Manager contents                        |
| `create_accounts` | One-proxy-one-account signup run (fire and forget → run_id) |
| `warmup_accounts` | Scroll warmup with proxy rotation between accounts          |
| `run_status`      | Poll any run for per-profile results, errors, screenshots   |
| `list_runs`       | Every run started in this MCP session                       |

## Known rough edges

1. **TikTok DOM drift** — selectors in `automation/tiktok_signup.py` (`S` dict); `data-e2e` gets renamed every few months.
2. **Disposable email domains** — some 1secmail domains are rejected; flow auto-retries 4×. Swap `email/temp_mail.py` for mail.tm if your IPs hit this often.
3. **Delayed phone challenge** — TikTok may ask for phone verification post-signup based on IP/fingerprint/velocity. Clean mobile proxies and spacing keep rates low.
4. **No persistent state** — MCP restart mid-run leaves Chrome windows open; close via AdsPower UI.
5. **Mobile proxy rotation** — AdsPower doesn't store rotation URLs; `proxies_config.json` is authoritative.

## Development

`pytest` for the Python side; `pnpm --filter ./frontend typecheck` for the UI.

## License

MIT.
