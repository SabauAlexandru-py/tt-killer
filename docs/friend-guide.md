# adspower-mcp — Mission Control: Setup Guide

Hey — Alex sent you this. It's a dark trading-terminal–style control panel for
running TikTok account signups + warmups on top of **AdsPower** (anti-detect
browser) with your own **mobile proxies** and a **SadCaptcha** key.

Everything is local-first. There's a Vercel-hosted frontend too, but read the
**Vercel URL** section before you click anything.

---

## Vercel URL — read this first

**Live:** https://tiktokkiller.vercel.app

Honest status today (2026-11-06): the Vercel project has **Vercel
Authentication** turned on. A cold visit redirects to a Vercel login wall. You
will see the login wall unless:

- (a) Alex disables Vercel Authentication under
  <https://vercel.com/syn-mgmt/frontend/settings/deployment-protection>, then
  the UI shell loads for anyone with the URL, **BUT**
- (b) even once you *see* the UI, nothing works until a backend is reachable
  at the address shown in Settings → Backend URL. The backend is the FastAPI
  bridge that talks to AdsPower on *your* Mac. So either you run the backend
  locally, or Alex exposes his backend via Cloudflare Tunnel (sharing his
  AdsPower = sharing his profiles — probably not what you want).

**TL;DR — ignore the Vercel URL. Run it on your own Mac. Takes five minutes.**

---

## What you need before starting

| Thing                  | Why                                               | Where                                   |
|------------------------|---------------------------------------------------|-----------------------------------------|
| macOS or Linux         | Scripts use bash + POSIX paths                    | your machine                            |
| Python 3.11+           | Backend runtime                                   | `python3 --version`                     |
| Node 20+               | Frontend runtime                                  | `node --version`                        |
| pnpm 9+                | Package manager                                   | `npm i -g pnpm` or `corepack enable`    |
| uv                     | Python installer (handles the monorepo cleanly)   | `brew install uv`                       |
| AdsPower desktop       | The anti-detect browser we drive                  | <https://www.adspower.com>              |
| SadCaptcha API key     | Solves TikTok's puzzle in-page                    | <https://sadcaptcha.com/dashboard>      |
| Mobile proxies         | 1 proxy = 1 TikTok account                        | your provider (iProxy, SOAX, LTEsocks…) |

SadCaptcha has 25 free credits on signup. Pricing after that: $5 per 2,500
solves → ~$0.002 per TikTok puzzle. Credits never expire.

---

## Setup — step by step

### 1. Get the project onto your machine

Alex will send you the folder (or a GitHub link). Drop it anywhere; the guide
assumes `~/Downloads/adspower-mcp`.

### 2. Make sure AdsPower is installed and running

- Download, install, create your free AdsPower account
- Open the app
- Settings → **Local API** → enable it. Port **50325** should be free.
- Keep the app open the whole time you're using Mission Control.

### 3. Run `./start.sh`

```bash
cd ~/Downloads/adspower-mcp
./start.sh
```

One command. That's the whole install. Here's what it does so nothing feels
like magic:

- **Checks your tools.** Verifies `python3.11+`, `node 20+`, `pnpm 9+`, and
  `uv`. If one's missing it prints the exact `brew install` line and bails —
  no half-finished installs.
- **Installs the backend.** Creates `backend/.venv`, runs
  `uv pip install -e .`, and downloads Playwright's bundled Chromium
  (~300 MB, one-time — needed by the TikTok captcha solver).
- **Installs the frontend.** Runs `pnpm install` from the repo root; pnpm
  hydrates `frontend/` in place.
- **Handles your SadCaptcha key.** If `.env` doesn't exist it copies
  `.env.example` over and prompts you to paste your
  `SADCAPTCHA_API_KEY=...`. Grab one from
  <https://sadcaptcha.com/dashboard> — 25 free credits on signup.
- **Pings AdsPower.** Checks `http://localhost:50325/status`. If AdsPower
  isn't open it warns and keeps going — you can start AdsPower after the UI
  is up.
- **Starts both servers.** Spins up the FastAPI backend on
  `http://127.0.0.1:8080` and the Next.js UI on `http://localhost:3000`
  under `concurrently`. Leave this terminal running while you use the app.

Re-runs are fast: `./start.sh` reuses the existing `.venv` and `node_modules`,
only re-installs deps when `pyproject.toml` or `package.json` change, and
never re-downloads Chromium. First run: ~3–5 min. Later runs: ~5 sec.

If `./start.sh` ever fails on your box, jump to [Prefer the manual route?
Here it is:](#prefer-the-manual-route-here-it-is) at the bottom — same steps,
no wrapper.

### 4. Open the UI

Visit <http://localhost:3000> (use `localhost`, not `127.0.0.1` — the backend
CORS allowlist expects `localhost`).

You should see the Mission Control dashboard: dark background, emerald accent
on the active nav item, four metric cards (PROXIES, PROFILES, RUNNING RUNS,
SIGNUPS 24H), and an empty "RECENT RUNS" section.

---

## Using it

### Add a proxy

1. Click **Proxies** in the left nav.
2. Fill the inline form at the top:
   - **Name** — any label (e.g. `US-mobile-01`)
   - **Host** — IP or hostname
   - **Port** — port number
   - **Type** — `http`, `https`, or `socks5`
   - **User / Password** — optional, if your provider needs auth
   - **Rotation URL** — optional, the magic URL your provider gives you to
     cycle the IP. Mission Control hits this before the next account.
3. Click Add. The proxy appears in the table.
4. Hit **Verify IP** to confirm the proxy actually works.

Proxies live in `backend/data/proxies.json`. They're not pushed into
AdsPower's Proxy Manager pool (AdsPower's Local API doesn't expose a public
write-proxy endpoint). Instead, Mission Control attaches each proxy *inline*
to the AdsPower profile it creates — same effect, fewer moving parts.

### Sync profiles from proxies

1. Click **Profiles**.
2. Click **Sync from proxies** (top-right).
3. One new AdsPower profile is created per stored proxy, named
   `TikTok Acc #1`, `TikTok Acc #2`, … with that proxy wired in.

Open AdsPower — you'll see the new profiles appear there too.

### Create accounts

1. Dashboard → **Create accounts**.
2. Pick which proxies to run (or leave empty for all).
3. Submit. A run_id streams back and you land on `/runs/<id>`.
4. Each row = one account. The ProgressPips go
   `proxy → launch → signup → captcha → otp → password → done`. If a step
   stalls, that row's timer goes amber → red and the inline screenshot thumb
   tells you what's on screen.

The flow:
- Opens the AdsPower profile via its Local API
- Playwright attaches over CDP
- Navigates to `tiktok.com/signup/phone-or-email/email`
- Picks DOB, generates a fresh 1secmail inbox
- Clicks Send code — **SadCaptcha solves the slide puzzle in-page**
- Polls 1secmail for the verification code, pastes it
- Sets a random strong password
- Picks a username (if TikTok asks)
- Closes the browser; moves to the next proxy

### Warm up accounts

1. Dashboard → pick a profile → **Warm up**.
2. For each profile the warmer will: open browser → read egress IP via ipify
   → scroll `/foryou` for 15–20 minutes with 5–15 s jitter → close →
   hit the proxy's rotation URL → re-open → verify new IP ≠ old IP → next.

Rotation is skipped if you didn't set a `rotation_url` on that proxy.

---

## Troubleshooting

| Symptom                                           | Fix                                                                                                     |
|---------------------------------------------------|---------------------------------------------------------------------------------------------------------|
| "AdsPower unreachable" on the dashboard           | Is AdsPower desktop open? Is Local API enabled under Settings?                                          |
| "Backend unreachable" / network error             | Did `pnpm dev` print "FastAPI backend ready"? If not, start it: `cd backend && .venv/bin/uvicorn backend.main:app --port 8080` |
| CORS error in the browser console                 | Visit `http://localhost:3000` — not `http://127.0.0.1:3000`. Backend CORS allowlist matches `localhost`. |
| TikTok: "This email isn't supported"              | 1secmail domain was blocked. Mission Control auto-retries 4× with different domains before giving up.    |
| TikTok: phone-verification prompt after signup    | Happens when IP/fingerprint/signup-velocity look suspicious. Use cleaner mobile proxies + space out runs. |
| `vercel.*.trycloudflare.com` — mixed-content block | You hit the Vercel URL but your backend is HTTP localhost. Run `cloudflared tunnel --url http://localhost:8080`, paste the HTTPS URL into Settings → Backend URL. |
| SadCaptcha: "insufficient credits"                | Top up at <https://sadcaptcha.com/dashboard>. $5 = 2,500 solves.                                         |
| AdsPower: "Too many requests per second"          | The Local API is 1 req/sec. The backend throttles automatically; this error only appears if something outside the app is hammering it. Wait ~2 s.        |

---

## FAQ

**Can I deploy my own Vercel copy?**
Yes. `cd frontend && vercel --prod` (requires a Vercel account). But you still
need to run the backend on your own machine — the Vercel frontend is just the
UI shell.

**Can I share my backend with Alex (or vice versa)?**
Technically with Cloudflare Tunnel yes (`cloudflared tunnel --url
http://localhost:8080` → HTTPS URL → paste into Settings → Backend URL on the
Vercel site). But whoever's backend is live controls that person's AdsPower.
Think twice.

**Will TikTok ban these accounts?**
Depends on proxy quality, fingerprint realism, and how fast you spawn them.
Clean mobile proxies + spaced-out signups + warming before posting = better
survival. No promises.

**What if the project changes and Alex sends an update?**
`cd ~/Downloads/adspower-mcp && git pull` (or re-extract the zip). Then
`pnpm install`, `(cd backend && uv pip install --python .venv/bin/python -e .)`,
restart `pnpm dev`.

**Is there a Docker image?**
Not yet. The scaffold is Mac/Linux native. If you want it, Alex can add one.

---

## Prefer the manual route? Here it is:

If `./start.sh` doesn't work on your box, or you just want to see every step
on its own, run these in order. They're exactly what the script does, no
wrapper.

### Install the backend

```bash
cd ~/Downloads/adspower-mcp/backend
python3 -m venv .venv
.venv/bin/pip install --upgrade pip uv
uv pip install --python .venv/bin/python -e .
.venv/bin/playwright install chromium
```

Last line installs Playwright's bundled Chromium (~300 MB, one-time). Needed
by the TikTok captcha solver when it has to download puzzle images.

### Install the frontend

```bash
cd ~/Downloads/adspower-mcp/frontend
pnpm install
```

### Add your SadCaptcha key

```bash
cd ~/Downloads/adspower-mcp
cp .env.example .env    # if .env doesn't exist yet
```

Open `.env` in your editor, find `SADCAPTCHA_API_KEY=` and paste your key in.
Save.

### Start both servers

From the project root:

```bash
pnpm dev
```

This spins up:
- **FastAPI backend** at <http://127.0.0.1:8080>
- **Next.js frontend** at <http://localhost:3000>

Leave this terminal running while you use the app. Then jump back to
[step 4 — Open the UI](#4-open-the-ui).

---

## What's under the hood

- **Python MCP server** (`src/adspower_mcp/`): the original lower-level tool.
  Does the signups and warmups. Still works as a standalone MCP for Claude
  Code too.
- **FastAPI backend** (`backend/`): thin HTTP bridge. Serves `/api/proxies`,
  `/api/profiles`, `/api/runs`, SSE streams, health check.
- **Next.js 15 frontend** (`frontend/`): three-pane Mission Control UI. Dark,
  dense, OKLCH tokens, Geist font stack.
- **AdsPower Local API** (localhost:50325): where the browser profiles live.
- **SadCaptcha Python lib** (`tiktok-captcha-solver`): solves TikTok's puzzle
  via API, no extension needed per profile.
- **1secmail**: disposable email inbox for the signup code.

One terminal. One browser tab. Watch it rip.

— Alex
