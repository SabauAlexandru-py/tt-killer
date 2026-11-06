# adspower-mcp Web UI — Design Brief V2 (locked)

Builds on `DESIGN_SPEC.md` (V1). V1 tokens, three-pane layout, and endpoints
stay. V2 adds: hardware-feeling LEDs, an AdsPower-like profile grid, a motion
vocabulary with explicit budget, a bulk-paste proxy form, an N-accounts
selector bounded by proxy count, and the asyncio plan that actually runs N
parallel signups when the button is pressed.

Direction stays Mission Control: trading terminal meets Lamborghini dash.
Chrome stays restrained, data stays dense — animation never fights the data.

---

## 1. LED color tokens

LEDs are rendered as a 10px circle with a 2px inner highlight and a bloom halo
in `box-shadow`. One semantic per color — same palette as V1, re-expressed as
`--led-*` tokens so SVG, CSS, and canvas renderers agree.

```css
:root {
  /* Core LED fills (OKLCH triples, no alpha) */
  --led-idle:        oklch(0.55 0.00 0);      /* neutral gray — nothing running */
  --led-running:     oklch(0.72 0.17 160);    /* emerald — signup in flight */
  --led-success:     oklch(0.78 0.18 150);    /* brighter emerald — "just finished" flash */
  --led-warning:     oklch(0.78 0.17 85);     /* amber — warming, soft-retry, slow */
  --led-error:       oklch(0.65 0.22 25);     /* rose — stuck, failed, needs attention */
  --led-info:        oklch(0.72 0.14 220);    /* sky — queued, informational */
  --led-busy:        oklch(0.74 0.17 300);    /* violet — AdsPower bridge call in flight */
  --led-pending:     oklch(0.62 0.05 240);    /* desaturated blue-gray — waiting for upstream */

  /* Halo (box-shadow) fills — same hue, higher chroma for glow */
  --led-idle-glow:     oklch(0.55 0.00 0   / 0.0);                           /* no glow when idle */
  --led-running-glow:  oklch(0.72 0.17 160 / 0.55);
  --led-success-glow:  oklch(0.82 0.20 150 / 0.75);
  --led-warning-glow:  oklch(0.78 0.17 85  / 0.55);
  --led-error-glow:    oklch(0.65 0.22 25  / 0.60);
  --led-info-glow:     oklch(0.72 0.14 220 / 0.45);
  --led-busy-glow:     oklch(0.74 0.17 300 / 0.55);
  --led-pending-glow:  oklch(0.62 0.05 240 / 0.25);

  /* Inner specular highlight — tiny white dot top-left of the lens */
  --led-highlight:   oklch(1.0 0 0 / 0.65);
}
```

Rendering primitive (one source of truth, used by every status chip):

```css
.led {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  background: var(--led-fill, var(--led-idle));
  box-shadow:
    inset 0 1px 1px var(--led-highlight),           /* specular dot */
    0 0 0 1px oklch(0 0 0 / 0.40),                  /* bezel */
    0 0 8px 1px var(--led-halo, transparent),       /* close bloom */
    0 0 16px 2px var(--led-halo, transparent);      /* far bloom */
  transition: background 120ms var(--ease-out), box-shadow 220ms var(--ease-out);
}
```

Each status binds `--led-fill` + `--led-halo` (e.g. `.led--running` sets
`--led-fill: var(--led-running); --led-halo: var(--led-running-glow);`).

---

## 2. LED patterns

Eight named patterns. Every pattern maps to exactly one semantic state —
operators should be able to read status from across the room without reading
text. No pattern uses more than 2 keyframes except `rainbow-idle`.

| Pattern        | Semantic                            | Duration | Easing            | Keyframes |
|----------------|-------------------------------------|----------|-------------------|-----------|
| `steady`       | Idle, info, pending                 | —        | —                 | opacity 1 constant |
| `pulse`        | Running — active signup step        | 1800ms   | `--ease-smooth`   | opacity 1 → 0.45 → 1, halo 0 → 1 → 0 |
| `slow-pulse`   | Warming, long-running (>60s step)   | 3200ms   | `--ease-smooth`   | opacity 1 → 0.60 → 1 |
| `fast-blink`   | Error, stuck, needs operator        | 420ms    | `steps(2, end)`   | opacity 1 → 0.1 → 1 (binary feel) |
| `breathing`    | Backend connected but idle fleet    | 4200ms   | `cubic-bezier(.4,0,.6,1)` | opacity 0.85 → 1 → 0.85, halo scale 0.8 → 1.1 → 0.8 |
| `strobe`       | Captcha challenge appeared          | 180ms    | `steps(2)`        | opacity 1 → 0 → 1 — capped to 6 cycles then falls back to `fast-blink` (epilepsy guard) |
| `heartbeat`    | AdsPower local bridge reachable     | 1400ms   | `cubic-bezier(.7,0,.3,1)` | opacity 1 → 1 → 0.55 → 1 → 1 (double-thump) |
| `rainbow-idle` | "Chill" state — operator demo mode  | 8000ms   | `linear`          | hue cycles 160 → 220 → 300 → 25 → 85 → 160, saturation held at 0.17 |

`rainbow-idle` only fires when explicitly toggled from Settings → "Demo
mode". Never auto-enabled. Never used as a real status.

All patterns respect `prefers-reduced-motion: reduce` — they collapse to
`steady` with a one-shot 220ms opacity cross-fade on state change. `strobe`
and `fast-blink` always collapse under reduced motion; `pulse` collapses to a
single 600ms fade.

Keyframe example (`pulse`, canonical form):

```css
@keyframes led-pulse {
  0%, 100% {
    opacity: 1;
    box-shadow:
      inset 0 1px 1px var(--led-highlight),
      0 0 0 1px oklch(0 0 0 / 0.40),
      0 0 10px 2px var(--led-halo);
  }
  50% {
    opacity: 0.45;
    box-shadow:
      inset 0 1px 1px var(--led-highlight),
      0 0 0 1px oklch(0 0 0 / 0.40),
      0 0 4px 1px var(--led-halo);
  }
}
.led--running { animation: led-pulse 1800ms var(--ease-smooth) infinite; }
```

---

## 3. Motion vocabulary

All motion uses tokens from V1 (`--ease-out`, `--ease-smooth`, `--dur-fast`,
`--dur-normal`, `--dur-slow`) plus three V2 additions:

```css
:root {
  --ease-overshoot: cubic-bezier(0.34, 1.56, 0.64, 1);   /* subtle bounce — badges, LED kick */
  --ease-anticip:   cubic-bezier(0.68, -0.4, 0.32, 1.4); /* reserved — modal entry only */
  --dur-quick:      80ms;                                 /* button press, chip tap */
}
```

Named presets (each is a single source of truth — components reference them
by name, never redefine):

| Preset             | Properties                        | Duration | Easing            | Notes |
|--------------------|-----------------------------------|----------|-------------------|-------|
| `card-enter`       | opacity, translateY               | 320ms    | `--ease-out`      | from `{opacity: 0, translateY: 12px}`; 40ms stagger per card in a grid, cap at 12 staggered items |
| `card-hover`       | translateY, border, box-shadow    | 180ms    | `--ease-out`      | `translateY(-2px)`, border → `--border-strong`, shadow 0 → `0 6px 20px oklch(0 0 0 / 0.35)` |
| `card-press`       | scale                             | 80ms     | `--ease-out`      | `scale(0.985)` on `:active`, snaps back on release |
| `row-ripple`       | background                        | 400ms    | `--ease-smooth`   | background flashes `--accent-bg` → transparent on data update; rate-capped to one ripple per row per 500ms |
| `led-pulse`        | (see §2)                          | 1800ms   | `--ease-smooth`   | LED only |
| `led-kick`         | scale                             | 220ms    | `--ease-overshoot`| one-shot — fires when LED changes state, from 1 → 1.25 → 1 |
| `metric-count-up`  | numeric interpolation             | 600ms    | `--ease-out`      | `requestAnimationFrame` tween; only on monotonic counters (profiles total, done 24h) |
| `success-flash`    | background, border                | 480ms    | `--ease-smooth`   | one-shot on row — background `--accent-bg`, border `--accent-border`, fades back; fires on run complete |
| `error-shake`      | translateX                        | 320ms    | `linear`          | 5-sample keyframe: 0, -4px, 4px, -2px, 0 — only on form submission error, never on data error |
| `inspector-slide`  | translateX, opacity               | 260ms    | `--ease-smooth`   | right inspector from 100% → 0, opacity 0 → 1 |
| `nav-expand`       | width                             | 220ms    | `--ease-smooth`   | left nav 56px ↔ 240px |
| `focus-ring-in`    | outline-offset, outline-color     | 120ms    | `--ease-out`      | focus ring materializes rather than hard-appears |
| `tab-indicator`    | translateX, scaleX                | 260ms    | `--ease-smooth`   | underline slides between tabs via FLIP |
| `screenshot-expand`| scale, border-radius, z-index     | 320ms    | `--ease-out`      | thumb hover grows from 48×48 to 240×240, pins above siblings |
| `log-line-enter`   | opacity                           | 120ms    | `linear`          | just a fade — scrolling must stay performant |
| `toast-enter`      | translateY, opacity               | 260ms    | `--ease-out`      | from `{translateY: 12px, opacity: 0}` |
| `progress-pip-fill`| background, scale                 | 280ms    | `--ease-overshoot`| pip 0 → 1 fills from left, slight pop at end |

All motion is GPU-friendly: `transform` and `opacity` only, except for
`row-ripple`, `success-flash`, `led-pulse` halo, and the border color on
`card-hover`. Nothing animates `width`/`height`/`top`/`left` except
`nav-expand`, which is on a 220ms easing and costs once per toggle.

---

## 4. Profile grid layout (AdsPower-style)

Replaces V1's `/profiles` flat table. Lives at `/profiles` as the default
view; a `[Grid | Table]` segmented toggle in the TopBar lets users fall back
to the dense table when triaging 500+ profiles. Grid is default up to 200
profiles, table is default above that.

### Card anatomy

```
┌─────────────────────────────────────┐
│ ●LED  TikTok Acc #017         ⋮     │  ← header: LED(10px) + name + ⋮ menu
│                                     │
│   ┌───────────────────────────┐     │
│   │                           │     │
│   │     browser thumbnail     │     │  ← 232×130 screenshot (16:9 at 2x downsampled)
│   │                           │     │
│   └───────────────────────────┘     │
│                                     │
│   185.244.xx.xx · US-NY             │  ← mono-data row: IP + geo tag
│   ████████████░░░░░░░░ 62%          │  ← rotation freshness bar (how fresh is current IP)
│                                     │
│   Last run: 3m ago · 12 ok · 1 err  │  ← compact stats row
└─────────────────────────────────────┘
```

### Dimensions

- Card: `280px × 232px` fixed. Inner padding: 16px. Radius: `--radius-lg` (8px).
- Background: `--bg-surface`. Border: 1px `--border`.
- Thumbnail: `232px × 130px`, radius 6px, `object-fit: cover`,
  `background-color: --bg-base` as placeholder. If no screenshot yet, shows
  a 130-pt browser-window glyph in `--text-muted`.
- LED: 10px with halo (see §1).
- Rotation bar: 8px tall, radius 4px, tracks last-rotation age. Fill
  `--accent` under 24h, `--warn` 24–72h, `--error` over 72h.

### Grid

- CSS Grid, `grid-template-columns: repeat(auto-fill, minmax(280px, 1fr))`
- Gap: 20px.
- Container max-width: 1680px, centered.
- Viewport breakpoints:
  - ≥1680px — 5 columns
  - 1360–1679 — 4 columns
  - 1040–1359 — 3 columns
  - 720–1039 — 2 columns
  - <720 — 1 column

### States

- **Default** — border `--border`, no shadow.
- **Hover** — `card-hover` preset: translateY -2px, border `--border-strong`,
  shadow `0 6px 20px oklch(0 0 0 / 0.35)`. Thumbnail saturates by 8%
  (`filter: saturate(1.08)`).
- **Active (pressed)** — `card-press` preset: `scale(0.985)`.
- **Selected** (part of bulk-select) — border 1.5px `--accent-border`,
  background `--accent-bg`, LED halo intensity doubled. A 20×20 checkmark
  chip appears top-right of the thumbnail.
- **Focus-visible** — 2px `--border-focus` outline, offset 2px.
- **Disabled** (profile missing from AdsPower) — thumbnail 40% opacity,
  LED locked to `--led-pending` in `steady`, card not clickable, cursor
  `not-allowed`.
- **Running** (profile currently executing a run step) — LED pattern
  `pulse`, top edge of card shows a 2px accent-colored progress rail
  reflecting the current run's `% complete`. Rail uses
  `progress-pip-fill` easing on updates.
- **Just-succeeded** — fires `success-flash` once, then returns to normal.

### Right-click menu

Native context menu replaced with a hand-rolled menu anchored to cursor.
Items:

- Open browser (fires `POST /api/profiles/{user_id}/open`)
- Close browser (fires `POST /api/profiles/{user_id}/close`)
- Rotate proxy now
- Copy IP
- Copy profile ID
- —
- Open in Inspector
- —
- Delete profile (destructive — rose label, requires one more click)

Menu enters with `toast-enter` preset (260ms). Esc closes it. Click outside
closes it. Keyboard-triggerable via Shift+F10 on a focused card.

### Bulk-select

- Click any card: single-select (closes inspector reopen on new row).
- Shift+click: range select from last selection to clicked card (reading
  order).
- Cmd/Ctrl+click: toggle a single card in the selection.
- Cmd/Ctrl+A on grid: select all visible cards.
- Esc: clear selection.
- Selection count + "Rotate N proxies" / "Open N browsers" / "Delete N"
  surface in a sticky action bar that slides down from the TopBar when
  selection ≥ 1. Action bar uses `inspector-slide` on enter.

### Virtualization

- Up to 200 profiles — render all, rely on CSS.
- 200+ — virtualize with `@tanstack/react-virtual` in grid mode (fixed
  232px row height × computed column count). Window overscan 2 rows.

---

## 5. N-accounts selector UX

Lives on the Dashboard primary CTA panel and on `/runs` → "Create run"
drawer. One selector, two homes.

### Shape

A **compact stepper + slider hybrid** — stepper for keyboard, slider for
feel. Pills show preset multiples.

```
┌────────────────────────────────────────────────────────────┐
│  Accounts to create                                        │
│                                                            │
│  [ − ]  04  [ + ]   ●────────○──────────────────  / 10     │
│                                                            │
│  Presets:   [ 1 ]  [ 5 ]  [ 10 ]  [ All ]                  │
│                                                            │
│  Will use 4 of 10 available proxies. Est. duration ~2m.    │
└────────────────────────────────────────────────────────────┘
```

### Rules

- **Lower bound**: 1 (button disabled below).
- **Upper bound**: `P` = number of proxies with `last_known_ip !== null`
  and reachable. "All" preset = `P`. The slider's max tick is always `P`.
- **Default value**: `min(P, 5)`. If `P === 0` the control is disabled with
  helper text "Add a proxy first → /proxies".
- **Rendering**:
  - Stepper: `--`, `-`, `+`, `++` buttons. `--`/`++` are long-press-enabled
    (hold 400ms, then auto-increment at 100ms intervals).
  - Numeric readout uses `mono-data` style, tabular-nums, 2-digit zero-pad
    up to 99.
  - Slider is a hand-rolled range: 6px track, 16px thumb, `--accent`
    fill, `--border-strong` empty track. Thumb has an LED-style halo
    (inherits `--led-running-glow`) that lights up on drag.
  - Pills: `--radius-sm`, 36px height, `--bg-raised` default, `--accent-bg`
    + `--accent-border` when active. "All" pill is right-aligned.
- **Live feedback**: as N changes, a small sentence below updates: "Will
  use N of P available proxies. Est. duration ~<T>." T is computed as
  `base_signup_seconds + (ceil(N / MAX_CONCURRENCY) - 1) * base_signup_seconds`
  where `MAX_CONCURRENCY` is a backend-returned config value
  (`GET /api/health` payload field `max_concurrency`, default 8).
- **Warning states**:
  - N > P: never happens (upper bound enforces).
  - P === 0: whole control disabled as above.
  - N > MAX_CONCURRENCY: info chip below selector — "N > concurrency limit;
    runs will batch in waves of MAX_CONCURRENCY."
- **Keyboard**: ←/→ on slider thumb moves by 1, Shift+←/→ by 5, Home/End
  jumps to min/max. Stepper buttons are Tab-reachable.
- **Accessibility**: the control is a labelled `role="group"` with the
  stepper buttons, slider (`role="slider"` with aria-valuemin/max/now), and
  pills (`role="radiogroup"`). Live region announces the sentence under the
  control on change (polite).

---

## 6. Bulk proxy paste format

New `POST /api/proxies/bulk` endpoint accepts a `{ text: string }` body.
Parser is line-based and liberal — it tries each format in order per line
and skips empty lines and lines starting with `#`.

### Accepted formats (in parser priority)

1. **AdsPower-native CSV** (one row per line, already the dominant format in
   proxy-seller marketplaces):
   ```
   host:port:user:pass
   185.244.1.14:10013:usr_7fa:p@ss!word
   ```
2. **URI form** with explicit scheme:
   ```
   http://usr_7fa:p@ss!word@185.244.1.14:10013
   https://usr_7fa:p@ss!word@185.244.1.14:10013
   socks5://usr_7fa:p@ss!word@185.244.1.14:10013
   socks5h://usr_7fa:p@ss!word@185.244.1.14:10013
   ```
3. **URI form without creds** (for rotating-gateway providers):
   ```
   http://185.244.1.14:10013
   socks5://185.244.1.14:10013
   ```
4. **Host:port shorthand** (treated as HTTP, no auth):
   ```
   185.244.1.14:10013
   ```
5. **JSON array** (whole payload — detected if `text.trim().startsWith('[')`):
   ```json
   [
     {"host":"185.244.1.14","port":10013,"user":"usr_7fa","password":"p@ss!word","type":"http","rotation_url":"https://..."},
     {"host":"185.244.1.15","port":10013,"type":"socks5"}
   ]
   ```
6. **Extended CSV with rotation URL** (6th field):
   ```
   host:port:user:pass:type:rotation_url
   185.244.1.14:10013:usr_7fa:p@ss!word:http:https://rot.proxy/xyz
   ```

### Rules

- Default scheme is `http` when missing.
- Type values accepted: `http`, `https`, `socks4`, `socks5`, `socks5h` (case-
  insensitive).
- Names are auto-generated as `Proxy #NNN` unless a `# name:My Label` comment
  line precedes a block, in which case subsequent lines inherit it until the
  next `# name:` directive.
- Duplicates (same host+port) are rejected with a per-line error returned to
  the client; valid lines are still inserted. Response shape:
  ```json
  {
    "inserted": [{"line": 1, "id": "..."}, ...],
    "skipped":  [{"line": 3, "reason": "duplicate host:port"}, ...],
    "errors":   [{"line": 5, "reason": "invalid port", "input": "..."}]
  }
  ```
- Credentials in the raw paste are never echoed back; the `input` field in
  `errors` has user/pass redacted to `***`.

### UI surface

- `/proxies` page: tab switch between "Form" (single add — V1) and "Bulk
  paste" (V2). Bulk paste is a textarea with mono font, line numbers in a
  gutter, and a live parse preview on the right pane showing count parsed,
  schemes detected, dupes flagged. Submit button disabled until at least
  one valid line is detected.

---

## 7. Parallel signup backend plan

The N-selector hands an integer `N` and a list of `proxy_ids` (chosen by
the user, or the first `N` reachable proxies when `proxy_ids` is empty) to
`POST /api/runs/create`. Everything from here runs inside the FastAPI
process; no celery, no external queue.

### Concurrency primitive

- `asyncio.gather(*tasks, return_exceptions=True)` over one `_signup_one`
  coroutine per proxy.
- A **module-level `asyncio.Semaphore(MAX_CONCURRENCY)`** throttles how many
  signups actually run at once. `MAX_CONCURRENCY` reads from
  `settings.max_concurrency`, defaults to **8**, capped at **32** in
  validation.
- Rationale: AdsPower local API is single-host, single-process; pushing past
  ~8 concurrent `/browser/start` calls on consumer hardware hits timeouts.
  Operator can raise it in Settings for beefier boxes.

### Per-signup coroutine

```python
async def _signup_one(
    run_id: str,
    proxy: Proxy,
    idx: int,
    cfg: SignupConfig,
    bus: EventBus,
    sem: asyncio.Semaphore,
) -> AccountResult:
    async with sem:
        async with asyncio.timeout(cfg.per_account_timeout_s):  # default 300s
            try:
                await bus.emit(run_id, {"idx": idx, "state": "profile_create"})
                profile_id = await bridge.create_profile(proxy)
                await bus.emit(run_id, {"idx": idx, "state": "browser_start"})
                ws_url = await bridge.start_browser(profile_id)
                await bus.emit(run_id, {"idx": idx, "state": "signup_in_flight"})
                account = await signup_flow(ws_url, cfg, bus, run_id, idx)
                await bus.emit(run_id, {"idx": idx, "state": "done", "account": account})
                return AccountResult.ok(idx=idx, profile_id=profile_id, account=account)
            except asyncio.TimeoutError:
                return AccountResult.timeout(idx=idx)
            except SignupError as e:
                return AccountResult.failed(idx=idx, error=str(e), retryable=e.retryable)
            finally:
                with contextlib.suppress(Exception):
                    await bridge.stop_browser(profile_id)
```

### Orchestrator

```python
async def start_run(req: CreateRunRequest) -> RunHandle:
    run_id = ids.new_run_id()
    proxies = store.pick_proxies(req.proxy_ids, req.n)  # exactly req.n items
    sem = asyncio.Semaphore(settings.max_concurrency)

    async def _runner():
        results = await asyncio.gather(
            *[_signup_one(run_id, p, i, req.cfg, bus, sem) for i, p in enumerate(proxies)],
            return_exceptions=False,  # inner coroutine never raises past this boundary
        )
        store.finalize_run(run_id, results)
        await bus.emit(run_id, {"state": "run_done", "summary": summarize(results)})

    task = asyncio.create_task(_runner(), name=f"run:{run_id}")
    _running_tasks[run_id] = task
    return RunHandle(run_id=run_id, started_at=now_utc(), n=req.n)
```

### Failure boundary rules

- `return_exceptions=False` on `gather` **only because** `_signup_one`
  catches all expected failures internally and returns an `AccountResult`.
  Anything slipping past that is a programmer bug and should surface in the
  server log. Uncaught exceptions do not take down the run — the inner
  coroutine is wrapped with a final `try/except Exception` that logs and
  returns `AccountResult.failed(idx=i, error="internal", retryable=False)`.
- Per-account timeout: `300s` default, configurable per request (10–900s).
- Per-step timeouts live inside `signup_flow` (OTP wait, captcha solve,
  element wait) — the outer 300s is a backstop.
- A single account's failure never cancels its siblings.
- Operator can cancel a whole run via `POST /api/runs/{run_id}/cancel`,
  which calls `task.cancel()` on the orchestrator task; the inner
  coroutines catch `CancelledError`, stop the browser, and emit a
  `cancelled` state.

### Event emission (SSE)

- Every state transition on every account emits one JSON line to the
  `/api/stream/runs/{run_id}` SSE channel.
- The bus is an in-process `asyncio.Queue` per run with a
  broadcast-to-subscribers fanout. Latest snapshot is also written to
  `backend/data/runs/{run_id}.json` every 1s so a fresh SSE subscriber gets
  current state immediately on connect.
- Rate cap: at most 20 events/sec per run; excess coalesces (keeps latest
  state per `idx`).

### Resource hygiene

- Browsers always closed in `finally` — `bridge.stop_browser` wrapped in
  `suppress(Exception)` so it never shadows the real failure.
- Semaphore counts are logged every 15s at DEBUG.
- `asyncio.timeout` instead of `wait_for` (3.11+) — plays nicer with
  nested cancellation.
- On FastAPI shutdown: `app.state.cancel_all_runs()` cancels every entry in
  `_running_tasks` and awaits them with a 10s grace.

### Request/response shape

```jsonc
// POST /api/runs/create
{
  "n": 4,
  "proxy_ids": ["prx_01", "prx_04", "prx_07", "prx_12"],  // optional; if omitted, backend picks first N reachable
  "rotate_between": true,
  "name_prefix": "TikTok Acc",
  "birth_year": 1998,
  "per_account_timeout_s": 300
}

// 202 Accepted
{
  "run_id": "run_2026_11_06_15_28_7fa3",
  "started_at": "2026-11-06T15:28:04.117Z",
  "n": 4,
  "stream_url": "/api/stream/runs/run_2026_11_06_15_28_7fa3"
}
```

---

## 8. Animation budget — what NOT to animate

The ban list is as important as the vocabulary. If something isn't on the
whitelist in §3, it doesn't move.

### Banned outright

- **Card wobble / jitter / "rubber band" idle motion.** No idle rotation,
  no subtle scale-breathe on cards. Cards are still until hovered or data
  updates.
- **Parallax on scroll.** Full stop. Background doesn't move at a different
  rate than foreground. Ever.
- **Carousel auto-advance.** No auto-rotating hero, no auto-cycling stats.
- **Confetti.** Including on "all N accounts completed." Use
  `success-flash` on the summary row and move on.
- **Marquee / scrolling text.** Logs scroll because logs scroll, not for
  decoration. No ticker tape.
- **Typing animations** on static text. "Welcome, operator…" typing in
  one letter at a time is theater.
- **Spring-physics drag on non-draggables.** Cards don't wiggle when
  grabbed if you can't actually move them.
- **Mouse-tracking gradient blobs / spotlight-follow.** No "cursor
  spotlight on glass" effect — that's a landing-page trope, not a terminal.
- **Easing on scroll** — native scroll only. No smoothscroll JS overrides.
- **Full-screen flash** on errors or successes. The `success-flash`
  preset is scoped to a row. The `error-shake` preset is scoped to a form
  input. The chrome stays calm.
- **Looping LED patterns on idle items.** An idle profile shows `steady`.
  The `rainbow-idle` pattern only runs in explicit demo mode.
- **Hover-triggered 3D tilt.** No `perspective: 800px; rotateX(…)` cards.
- **Glassmorphism on data cards.** Backdrop-filter on an overlay
  (Inspector, right-click menu) is allowed; on a data card it ruins
  legibility and tanks GPU.
- **Shadow pulsing** on resting cards.
- **Scroll-jacking narrative sections.** No pinned sections that commandeer
  the scroll wheel.

### Rate caps

- `row-ripple` fires at most once per row per 500ms (dedupe).
- `success-flash` fires at most once per row per 2s.
- SSE-driven animations throttle through a `requestAnimationFrame` batcher
  — the UI never animates more than once per frame per element.
- When the tab is backgrounded (`document.hidden`), all looped animations
  pause. On focus return, they resume without replaying missed cycles.
- When `prefers-reduced-motion: reduce` is set:
  - All loops become `steady`.
  - All one-shots collapse to a 120ms opacity cross-fade.
  - `error-shake`, `strobe`, `fast-blink`, and `card-press` are no-ops.

### Positive rules

- One animation per element at a time. New animation cancels prior.
- Every `will-change` hint is removed on animation end.
- No animation lasts longer than 4200ms except `rainbow-idle` (demo only).
- GPU-friendly properties (`transform`, `opacity`, `filter` sparingly) for
  anything looped. Color/background transitions are fine as one-shots.

---

## 9. Runtime config surface (Settings → V2 additions)

New fields on `/settings`, all persisted to `localStorage` and mirrored to
backend where relevant:

- **AdsPower API URL** — default `http://local.adspower.net:50325`.
- **AdsPower API Key** — password input, masked, revealed on hover of the
  eye icon. Round-trips to backend via `POST /api/settings/adspower` which
  stores it at `backend/data/adspower.json` (0600 perms). Operator's friend
  pastes his key here once; panel works for everyone who can reach the
  backend URL.
- **Max concurrency** — integer 1–32, default 8. Emits an SSE restart
  notice to active runs when changed (no cancel, just the next batch picks
  up the new value).
- **Demo mode** — boolean. Enables `rainbow-idle` on idle LEDs. Off by
  default.
- **Reduce motion override** — tri-state: Auto (follow OS) / Always reduce /
  Never reduce. Auto is default.
- **LED brightness** — three-step: Soft / Normal / Bright. Scales the halo
  alpha (×0.7 / ×1.0 / ×1.4).

---

## 10. Open questions / explicitly deferred

- Multi-user auth — still out of scope. Access control is "whoever can
  reach the backend URL". V1's note about Cloudflare Tunnel still applies.
- Per-profile screenshot capture pipeline — V2 assumes a thumb already
  exists at `backend/data/thumbs/{user_id}.png`. Capture scheduling is
  owned by the signup/warmup flows, not this UI spec.
- Dark/light theme toggle — stays dark-only. Mission Control is dark, full
  stop.

---

## 11. File-level deltas from V1

```
frontend/
├── app/
│   ├── profiles/page.tsx                # now hosts both Grid and Table views
│   └── settings/page.tsx                # add AdsPower API Key + Max concurrency + LED/Motion controls
├── components/
│   ├── led/                             # NEW
│   │   ├── LED.tsx                      # core primitive, takes `state` prop
│   │   ├── led-patterns.css             # all 8 patterns
│   │   └── useLEDState.ts               # maps semantic state → pattern + color
│   ├── profiles/
│   │   ├── ProfileGrid.tsx              # NEW — virtualized grid
│   │   ├── ProfileCard.tsx              # NEW — single card
│   │   ├── ProfileContextMenu.tsx       # NEW — right-click
│   │   └── BulkActionBar.tsx            # NEW — sticky bar on selection
│   ├── runs/
│   │   └── NAccountsSelector.tsx        # NEW — the §5 control
│   ├── proxies/
│   │   ├── BulkProxyPaste.tsx           # NEW — §6 textarea + preview
│   │   └── ProxyParsePreview.tsx        # NEW
│   └── motion/                          # NEW
│       ├── tokens.css                   # the §3 presets as utility classes
│       └── useRespectsReducedMotion.ts
└── lib/
    ├── parse-proxies.ts                 # NEW — §6 parser
    └── estimate-run-duration.ts         # NEW — §5 live estimate

backend/
└── backend/
    ├── routes/
    │   ├── proxies.py                   # + POST /bulk
    │   ├── runs.py                      # + cancel, + concurrency wiring
    │   └── settings.py                  # NEW — AdsPower API key storage
    ├── orchestrator.py                  # NEW — §7 semaphore + gather
    ├── event_bus.py                     # NEW — per-run asyncio queue + fanout
    └── config.py                        # + max_concurrency, + adspower_api_key
```
