# adspower-mcp Web UI — Design Spec (locked)

Source of truth for the scaffold. Every agent reads this verbatim. Don't substitute values.

## Direction: Mission Control

Dark trading-terminal aesthetic for phone-farm operators who leave the page open for hours watching N parallel TikTok signups + warmups. Data density > decoration. One semantic accent. Monospaced tabular numerals on anything numeric. No marketing-site shadows, gradients, or illustrations.

## Monorepo layout

```
~/Downloads/adspower-mcp/
├── src/adspower_mcp/        (existing Python MCP — unchanged)
├── backend/                 (NEW — FastAPI bridge, local-only)
│   ├── pyproject.toml
│   ├── backend/
│   │   ├── __init__.py
│   │   ├── main.py          (FastAPI app, CORS, lifespan)
│   │   ├── config.py        (pydantic-settings)
│   │   ├── bridge.py        (imports from adspower_mcp)
│   │   ├── store.py         (JSON-backed proxy store)
│   │   └── routes/
│   │       ├── __init__.py
│   │       ├── proxies.py
│   │       ├── profiles.py
│   │       ├── runs.py
│   │       ├── stream.py
│   │       └── meta.py
│   └── data/                (gitignored — runtime state)
│       └── proxies.json
├── frontend/                (NEW — Next.js 15 app, Vercel-deployable)
│   ├── package.json
│   ├── tsconfig.json
│   ├── next.config.mjs
│   ├── tailwind.config.ts
│   ├── postcss.config.mjs
│   ├── vercel.json
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── providers.tsx
│   │   ├── globals.css
│   │   ├── page.tsx                  (dashboard)
│   │   ├── proxies/page.tsx
│   │   ├── profiles/page.tsx
│   │   ├── runs/page.tsx
│   │   ├── runs/[id]/page.tsx
│   │   └── settings/page.tsx
│   ├── components/
│   │   ├── layout/
│   │   ├── ui/
│   │   ├── data/
│   │   ├── proxies/
│   │   ├── profiles/
│   │   ├── runs/
│   │   ├── logs/
│   │   └── settings/
│   └── lib/
│       ├── api.ts
│       ├── sse.ts
│       ├── types.ts
│       ├── tokens.ts
│       └── cn.ts
├── docs/
│   └── deployment.md
├── package.json             (monorepo root, concurrently dev script)
└── README.md
```

## Design tokens

### Colors — dark mode primary. All OKLCH.

```css
:root {
  --bg-base:         oklch(0.145 0 0);
  --bg-surface:      oklch(0.19 0 0);
  --bg-raised:       oklch(0.22 0 0);
  --bg-hover:        oklch(0.24 0 0);

  --border:          oklch(0.28 0 0);
  --border-strong:   oklch(0.35 0 0);
  --border-focus:    oklch(0.72 0.17 160);

  --text-primary:    oklch(0.98 0 0);
  --text-secondary:  oklch(0.72 0 0);
  --text-muted:      oklch(0.55 0 0);

  --accent:          oklch(0.72 0.17 160);   /* emerald — healthy, running */
  --accent-bg:       oklch(0.72 0.17 160 / 0.12);
  --accent-border:   oklch(0.72 0.17 160 / 0.30);

  --warn:            oklch(0.78 0.17 85);    /* amber — in-flight, warming */
  --warn-bg:         oklch(0.78 0.17 85 / 0.12);
  --warn-border:     oklch(0.78 0.17 85 / 0.30);

  --error:           oklch(0.65 0.22 25);    /* rose — stuck, failed */
  --error-bg:        oklch(0.65 0.22 25 / 0.12);
  --error-border:    oklch(0.65 0.22 25 / 0.30);

  --info:            oklch(0.72 0.14 220);   /* sky — info chips */
  --info-bg:         oklch(0.72 0.14 220 / 0.12);
  --info-border:     oklch(0.72 0.14 220 / 0.30);
}
```

### Typography

```css
--font-sans: 'Geist', ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
--font-mono: 'Geist Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
```

Scale (use CSS vars):
- body: 13px / 1.5 / sans
- label: 12px / 1.4 / sans / letter-spacing 0.02em / uppercase on all-caps section headers
- heading-sm: 14px / 1.4 / sans / 600
- heading-md: 16px / 1.3 / sans / 600
- heading-lg: 20px / 1.2 / sans / 600
- display: 32px / 1.1 / sans / 700 (dashboard totals)
- mono-data: 12px / 1.5 / mono / tabular-nums (IPs, IDs, timestamps, ports)
- mono-log: 11px / 1.45 / mono (log stream only)

### Spacing scale

4, 8, 12, 16, 20, 24, 32, 48, 64. 8px macro grid, 4px micro.

### Row heights

- Table rows: 36px (dense: 32px)
- Nav items: 36px
- Inputs: 36px
- Buttons: 36px default, 32px small, 44px primary CTA

### Radii

- --radius-sm: 4px (chips, pills)
- --radius: 6px (default — cards, inputs, buttons)
- --radius-lg: 8px (large containers)

### Motion

```css
--ease-out:    cubic-bezier(0.16, 1, 0.3, 1);
--ease-smooth: cubic-bezier(0.32, 0.72, 0, 1);
--dur-fast:    120ms;
--dur-normal:  220ms;
--dur-slow:    380ms;
```

Pulse keyframe for live status dots (only on in-flight items, never idle): 2s loop, scale 1 → 1.3 → 1, opacity 1 → 0 → 1.

## Layout

Three-pane, locked:

- **Left Nav** — 240px expanded, 56px collapsed. Items: Dashboard, Proxies, Profiles, Runs, Logs, Settings. Collapse/expand button at bottom.
- **Center** — fluid. Primary data view per route.
- **Right Inspector** — 360px when open, 0 when nothing selected. Opens on row click. Shows full detail + live tail + action buttons. Never a modal.

TopBar inside Center: 48px, holds breadcrumb, filters, primary action button.

## Backend endpoints (FastAPI)

### Proxies (local JSON store, not AdsPower-backed)
```
GET    /api/proxies                 list all with rotation_url + last_known_ip
POST   /api/proxies                 {name, host, port, type, user?, password?, rotation_url?}
PATCH  /api/proxies/{id}            update any field
DELETE /api/proxies/{id}            remove
POST   /api/proxies/{id}/rotate     trigger rotation URL, return {old_ip, new_ip, changed}
POST   /api/proxies/{id}/verify-ip  check current IP without rotating
```

### Profiles (AdsPower passthrough)
```
GET    /api/profiles                list from AdsPower Local API
POST   /api/profiles/sync           create 1 AdsPower profile per stored proxy that doesn't have one; name pattern "TikTok Acc #N"
DELETE /api/profiles/{user_id}      delete from AdsPower
POST   /api/profiles/{user_id}/open launch browser via /browser/start
POST   /api/profiles/{user_id}/close call /browser/stop
```

### Runs
```
GET    /api/runs                    list all runs (both create + warmup)
GET    /api/runs/{run_id}           full snapshot
POST   /api/runs/create             {proxy_ids?, name_prefix?, rotate_between?, birth_year?}
POST   /api/runs/warmup             {profile_ids?, rotate_between?}
```

### Streams
```
GET    /api/stream/runs/{run_id}    SSE: emit snapshot every 1s or on change
GET    /api/stream/logs             SSE: global tail of recent log lines
```

### Meta
```
GET    /api/health                  {ok, version, adspower_reachable}
GET    /api/adspower/status         ping /api/v1/user/list and report
```

## Frontend routes

- `/` — Dashboard: top-metric row (profiles total, running, failed, done 24h), recent runs grid, "Create accounts" primary CTA
- `/proxies` — Proxy manager: table of stored proxies with inline add form at top, rotate button per row
- `/profiles` — Profile explorer: AdsPower profiles table with attached proxy, sync button to materialize profiles from proxies
- `/runs` — Runs history: table with filter chips, URL-state
- `/runs/[id]` — Run detail: per-account rows with ProgressPips, ElapsedTimer, inline screenshot thumbs (hover expand), live log stream pane
- `/settings` — Settings: backend URL field, API keys display (masked), defaults

## Components (hand-rolled — NO shadcn, NO radix)

### layout/
ThreePane, Nav, Inspector, TopBar, PageHeader

### ui/
Button, IconButton, Input, Select, Textarea, Checkbox, Pill, StatusDot, Skeleton, Dialog, Toast, Kbd, CommandPalette

### data/
DataTable, TableRow, TableCell, SortableHeader, EmptyState, FilterChips

### proxies/
ProxyList, ProxyForm, ProxyRow, RotationBadge

### profiles/
ProfileTable, ProfileRow, SyncButton

### runs/
RunCard, AccountRow, ProgressPips, ElapsedTimer, ScreenshotThumb

### logs/
LogStream, LogLine, LogFilterBar

### settings/
BackendUrlField, HealthBadge, ApiKeysForm, DefaultsForm

## API client conventions

- TanStack Query v5 for reads (`useQuery`) and writes (`useMutation`)
- Backend URL from `localStorage['adspower-backend-url']` with fallback `http://localhost:8080`
- SSE via native EventSource behind a `useSSE<T>(path)` hook that returns `{ data, connected, error }`
- Error toasts via sonner
- Loading: `<Skeleton />` on initial load, inline spinner on refetch
- Mutations invalidate relevant query keys

## Accessibility

- Semantic HTML (header/nav/main/section)
- Focus ring: 2px `--border-focus` outline-offset 2px, visible via `:focus-visible`
- Status changes emit `aria-live="polite"` text
- Keyboard: Cmd+K palette, `/` focuses search, Esc closes panels
- Minimum 36px row / input / button hit targets

## Vercel + localhost strategy

1. Frontend is Next.js 15, deploys to Vercel out of the box (`vercel.json` sets framework + build command)
2. Settings page lets user set `backendUrl` (persisted to localStorage)
3. Default `backendUrl` is `http://localhost:8080` — works when user runs the frontend locally (`pnpm dev` → localhost:3000)
4. For Vercel-hosted frontend talking to local AdsPower, user MUST set up Cloudflare Tunnel:
   - `cloudflared tunnel --url http://localhost:8080`
   - Resulting `https://*.trycloudflare.com` URL → paste into Settings
5. HealthBadge polls `GET /api/health` every 10s and shows a live status dot next to the backend URL

Document both paths in `docs/deployment.md`.

## CORS

Backend allows origins:
- `http://localhost:3000` (local Next.js dev)
- `https://*.vercel.app` (preview + production)
- `https://*.trycloudflare.com` (tunnel URLs if user hosts frontend elsewhere)
- Any additional origin configured via env `BACKEND_ALLOWED_ORIGINS` (comma-separated)

## Dev experience

Root `package.json` has `pnpm dev` using `concurrently` to run:
- `cd backend && uvicorn backend.main:app --reload --port 8080`
- `cd frontend && pnpm dev`

## Non-goals (don't build these now)

- Auth / multi-user — single-operator local tool
- Database — JSON file store is fine
- Email service integration — uses existing 1secmail via adspower_mcp
- SadCaptcha dashboard — uses existing env var
