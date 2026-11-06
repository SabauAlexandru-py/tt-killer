# Deployment

Three paths, by increasing complexity. Pick the first one that fits your setup.

1. **Local-only** — backend and frontend both on your machine. Simplest. No public URL, no tunnel.
2. **Vercel frontend + local backend over Cloudflare Tunnel** — UI lives on Vercel so you can open it from any device; backend and AdsPower stay on your machine; a tunnel bridges them.
3. **Vercel frontend + local backend, same machine only** — UI on Vercel, but you only ever open it from the machine that runs AdsPower. Point the Vercel UI at `http://localhost:8080` via Settings. Works because the browser is local.

AdsPower Local API must be enabled on port `50325` in every path. Open AdsPower → Settings → Local API → Enable, confirm port `50325`.

---

## 1. Local-only setup

Simplest path. Both halves run on the same machine. The browser hits `http://localhost:3000`, which calls `http://localhost:8080`, which calls `http://127.0.0.1:50325` (AdsPower).

**Prerequisites**

- Node.js 20+ and pnpm 9+ (`brew install node pnpm` on macOS, or `corepack enable && corepack prepare pnpm@latest --activate`)
- Python 3.11+ with `uv` or `pip` (`brew install uv`)
- AdsPower desktop app running, Local API enabled on port `50325`

**Steps**

```bash
cd ~/Downloads/adspower-mcp

# 1. Install backend deps (FastAPI bridge)
cd backend
uv sync        # or: pip install -e .
cd ..

# 2. Install frontend deps
cd frontend
pnpm install
cd ..

# 3. Install root dev script (concurrently runner)
pnpm install

# 4. Run both halves together
pnpm dev
```

`pnpm dev` runs `concurrently`:

- `cd backend && uvicorn backend.main:app --reload --port 8080`
- `cd frontend && pnpm dev` (Next.js on port 3000)

Open `http://localhost:3000`. The HealthBadge in the sidebar turns green within 10s once `/api/health` returns `{ok: true, adspower_reachable: true}`.

**Verify the chain is wired**

```bash
# Backend is up
curl http://localhost:8080/api/health
# → {"ok": true, "version": "0.1.0", "adspower_reachable": true}

# AdsPower is reachable through the backend
curl http://localhost:8080/api/adspower/status
# → {"reachable": true, "code": 0, "profile_count": 12}
```

If `adspower_reachable` is `false`, see [Troubleshooting → AdsPower not reachable](#adspower-not-reachable).

---

## 2. Vercel frontend deployment

Push the `frontend/` directory to Vercel so the UI is reachable from any device. The backend still runs locally — Vercel only hosts static assets and the Next.js server.

**Prerequisites**

- A GitHub repo containing this project (or at least the `frontend/` directory).
- `vercel` CLI installed: `pnpm add -g vercel` or `npm i -g vercel`.
- Logged in: `vercel login`.

**Option A — Vercel CLI from `frontend/`**

```bash
cd ~/Downloads/adspower-mcp/frontend
vercel --prod
```

First run asks:

- Link to existing project? → **No** on first deploy
- Scope → your personal or team account
- Project name → `adspower-mcp` (or whatever you want)
- Directory → `.` (current)
- Build settings → accept defaults, Next.js is auto-detected from `next.config.mjs`

Subsequent deploys reuse the linked project: `vercel --prod` and you're done.

**Option B — GitHub → Vercel dashboard**

1. Push the repo to GitHub.
2. Go to `https://vercel.com/new`, import the repo.
3. Set **Root Directory** to `frontend` (so Vercel builds only the Next.js app).
4. Framework preset → **Next.js** (auto-detected).
5. Deploy.

**Environment variables**

`NEXT_PUBLIC_DEFAULT_BACKEND_URL` is the one that matters. If unset, the frontend defaults to `http://localhost:8080` and users set the real URL in `/settings`.

```bash
# From the frontend/ directory, after a deploy exists:
vercel env add NEXT_PUBLIC_DEFAULT_BACKEND_URL production
# Paste your Cloudflare Tunnel URL when prompted (see section 3), or leave unset
# and let each user configure their own via /settings.

vercel --prod   # redeploy to pick up the env change
```

Dashboard equivalent: Project → Settings → Environment Variables → add `NEXT_PUBLIC_DEFAULT_BACKEND_URL` for Production (and Preview if you want preview deploys to pre-fill it).

**After deploy, the UI is live at `https://<project>.vercel.app`**. It can't talk to your local backend yet — do section 3 or set the backend URL to a public endpoint of your own.

---

## 3. Cloudflare Tunnel: Vercel UI → local backend

Vercel runs over HTTPS. A browser on `https://adspower-mcp.vercel.app` cannot call `http://localhost:8080` — that's mixed content, blocked by every browser. Cloudflare Tunnel fronts your local backend with a public HTTPS URL. No account, no DNS. One command.

**Install `cloudflared`**

```bash
# macOS
brew install cloudflared

# Linux (amd64)
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 \
  -o /usr/local/bin/cloudflared
chmod +x /usr/local/bin/cloudflared

# Windows
# Download https://github.com/cloudflare/cloudflared/releases/latest → cloudflared-windows-amd64.exe
```

**Start the backend**

```bash
cd ~/Downloads/adspower-mcp/backend
uv run uvicorn backend.main:app --port 8080
```

Leave it running. In another terminal:

**Open the tunnel**

```bash
cloudflared tunnel --url http://localhost:8080
```

It prints something like:

```
2026-11-06T12:04:11Z INF +--------------------------------------------------------------------------------------------+
2026-11-06T12:04:11Z INF |  Your quick Tunnel has been created! Visit it at (it may take a few seconds to be reachable): |
2026-11-06T12:04:11Z INF |  https://brave-donkey-mango-wave.trycloudflare.com                                             |
2026-11-06T12:04:11Z INF +--------------------------------------------------------------------------------------------+
```

Copy the `https://*.trycloudflare.com` URL.

**Point the Vercel UI at it**

1. Open your Vercel-hosted UI: `https://<project>.vercel.app`.
2. Go to `/settings`.
3. Paste the tunnel URL into **Backend URL**, save.
4. Within 10 seconds the HealthBadge in the sidebar flips green.

The URL is persisted in `localStorage` under the key `adspower-backend-url`. Every API call and SSE stream now routes through the tunnel to your machine.

**Keep the tunnel alive**

`trycloudflare.com` URLs are ephemeral — they survive only as long as `cloudflared` is running, and the URL changes every restart. For a stable URL, log in (`cloudflared tunnel login`), create a named tunnel, and bind a DNS record. The quick tunnel is fine for one-off sessions; a named tunnel is fine for long-running fleets.

**SSE through the tunnel**

The tunnel streams `text/event-stream` fine. `/api/stream/runs/{run_id}` and `/api/stream/logs` keep working. If the connection drops silently every ~100s, it's usually Cloudflare's idle-connection reaper — the frontend's `useSSE<T>` hook reconnects automatically, but if you want to tune it, set `--idle-timeout 300s` on `cloudflared`.

---

## Troubleshooting

### Mixed-content errors

**Symptom.** Browser console shows:

```
Mixed Content: The page at 'https://adspower-mcp.vercel.app/settings' was loaded over HTTPS,
but requested an insecure resource 'http://localhost:8080/api/health'. This request has been blocked.
```

**Fix.** Your backend URL must be HTTPS when the frontend is HTTPS. Two options:

1. Use a Cloudflare Tunnel (section 3) — gives you `https://*.trycloudflare.com` out of the box.
2. Run the frontend locally too (`pnpm dev` → `http://localhost:3000`), so both ends are HTTP.

Setting the tunnel URL in `/settings` must include the `https://` scheme. The HealthBadge polls `GET <backendUrl>/api/health`; if you paste `trycloudflare.com` without the scheme, the fetch is relative and fails.

### CORS errors

**Symptom.** Browser console shows:

```
Access to fetch at 'https://brave-donkey-mango-wave.trycloudflare.com/api/proxies'
from origin 'https://adspower-mcp.vercel.app' has been blocked by CORS policy:
No 'Access-Control-Allow-Origin' header is present on the requested resource.
```

**Fix.** The backend's CORS allowlist is defined in `backend/backend/main.py` and includes by default:

- `http://localhost:3000`
- `https://*.vercel.app`
- `https://*.trycloudflare.com`

Your Vercel URL should already match `*.vercel.app`. If you're on a custom domain (`https://ops.example.com`), add it via the `BACKEND_ALLOWED_ORIGINS` env var — comma-separated, exact origins (no wildcards beyond what's already baked in).

```bash
# macOS/Linux
export BACKEND_ALLOWED_ORIGINS="https://ops.example.com,https://adspower.mydomain.io"
uv run uvicorn backend.main:app --port 8080
```

Or put it in `backend/.env`:

```
BACKEND_ALLOWED_ORIGINS=https://ops.example.com,https://adspower.mydomain.io
```

Restart the backend. Hard-refresh the Vercel page (Cmd+Shift+R / Ctrl+Shift+R) so the preflight re-runs.

### AdsPower not reachable

**Symptom.** `/api/health` returns `{"ok": true, "adspower_reachable": false}`, HealthBadge amber, profile list empty.

**Checklist, in order:**

1. **Is the AdsPower desktop app running?** Open it. Not the installer — the client that loads your profile list.
2. **Is Local API enabled?** AdsPower → Settings (gear icon, top-right) → **Local API** → toggle on.
3. **Is it on port 50325?** Same panel, port field. If you changed it, set `ADSPOWER_API_URL=http://127.0.0.1:<port>` in `backend/.env`.
4. **Is port 50325 reachable from the backend?**

   ```bash
   curl http://127.0.0.1:50325/status
   # Expected: {"code":0,"data":{},"msg":"success"}
   ```

   `curl: (7) Failed to connect` → AdsPower isn't listening. Restart the app. Mac firewall prompt may be suppressed; approve it in System Settings → Network → Firewall → Options.

5. **If you're tunneling the backend from another machine**, the backend and AdsPower must still be on the same machine. Cloudflare Tunnel only moves the frontend's view of the backend to HTTPS — it does not move AdsPower.

### Tunnel URL changed after I restarted `cloudflared`

Quick tunnels (`--url http://localhost:8080` with no args) mint a new hostname every start. Expected. Either:

- Repaste the new URL into `/settings` each time, or
- Upgrade to a named tunnel: `cloudflared tunnel login`, `cloudflared tunnel create adspower-mcp`, `cloudflared tunnel route dns adspower-mcp adspower.yourdomain.com`, `cloudflared tunnel run adspower-mcp`. Stable DNS, no repaste.

### HealthBadge stays red

Open browser DevTools → Network tab → filter `health`. The row tells you which layer is broken:

- **Request fails (no response)** — backend URL in `/settings` is wrong, tunnel is down, or backend isn't running. `curl <backendUrl>/api/health` from your terminal.
- **403 / blocked by CORS** — see [CORS errors](#cors-errors).
- **200 with `adspower_reachable: false`** — see [AdsPower not reachable](#adspower-not-reachable).
- **Blocked by mixed content** — see [Mixed-content errors](#mixed-content-errors).

### SSE stream drops mid-run

The `useSSE<T>` hook reconnects on `onerror` with exponential backoff. If you see repeated reconnects in the console, check:

- Tunnel idle timeout (Cloudflare caps idle streams at ~100s on quick tunnels — pass `--idle-timeout 300s`).
- Corporate proxies that strip `text/event-stream` — bypass with a VPN, or run the frontend locally.
- Backend hot-reload while `--reload` is on — expected in dev, every file save kills active SSE connections.
