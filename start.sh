#!/usr/bin/env bash
# =============================================================================
# Mission Control — one-command bootstrap for the adspower-mcp web stack.
#
# Checks prereqs → builds backend venv → installs frontend deps → starts both
# servers → opens a Cloudflare Tunnel to :8080 if `cloudflared` is installed →
# opens your browser (localhost UI, or the Vercel UI with the tunnel URL
# pre-filled so a teammate can use it from anywhere).
#
# Ctrl-C stops everything cleanly.
#
# macOS + Linux. The Windows twin is `start.ps1`.
# =============================================================================

set -eo pipefail

# ---------------------------------------------------------------------------- #
# Paths + constants
# ---------------------------------------------------------------------------- #

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
FRONTEND_DIR="$SCRIPT_DIR/frontend"

BACKEND_PORT="${BACKEND_PORT:-8080}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"

# Where the Vercel-hosted frontend lives. Shared across operators — the
# `?backend=<tunnel>` param auto-fills the Settings page so a teammate's
# browser talks to whoever is actively running `./start.sh`.
VERCEL_URL="${VERCEL_URL:-https://tiktokkiller.vercel.app}"

LOG_DIR="$SCRIPT_DIR/.logs"
mkdir -p "$LOG_DIR"
BACKEND_LOG="$LOG_DIR/backend.log"
FRONTEND_LOG="$LOG_DIR/frontend.log"
TUNNEL_LOG="$LOG_DIR/tunnel.log"

# ---------------------------------------------------------------------------- #
# Cosmetics
# ---------------------------------------------------------------------------- #

if [ -t 1 ]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; RST=$'\033[0m'
  RED=$'\033[0;31m'; GRN=$'\033[0;32m'; YLW=$'\033[0;33m'; CYN=$'\033[0;36m'
else
  BOLD=""; DIM=""; RST=""; RED=""; GRN=""; YLW=""; CYN=""
fi

say()  { printf "%s>%s %s\n" "$CYN" "$RST" "$*"; }
ok()   { printf "%sok%s %s\n" "$GRN" "$RST" "$*"; }
warn() { printf "%s!%s  %s\n" "$YLW" "$RST" "$*"; }
err()  { printf "%sX%s  %s\n" "$RED" "$RST" "$*" >&2; }
hdr()  { printf "\n%s%s%s\n" "$BOLD" "$*" "$RST"; }

# ---------------------------------------------------------------------------- #
# Lifecycle — track every child pid, kill them cleanly on Ctrl-C.
# ---------------------------------------------------------------------------- #

PIDS=()
TUNNEL_URL=""

cleanup() {
  printf "\n"
  say "Shutting down..."
  # SIGTERM first — give each process 2s to drain.
  for pid in "${PIDS[@]:-}"; do
    [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && kill "$pid" 2>/dev/null || true
  done
  sleep 2
  # SIGKILL stragglers.
  for pid in "${PIDS[@]:-}"; do
    [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null || true
  done
  ok "Stopped."
  exit 0
}
trap cleanup INT TERM

# ---------------------------------------------------------------------------- #
# Prereqs — python3 >= 3.11, node >= 20, pnpm, uv.
# ---------------------------------------------------------------------------- #

# Portable "ver_lhs >= ver_rhs" using sort -V.
ver_ge() { [ "$(printf '%s\n' "$2" "$1" | sort -V 2>/dev/null | head -n1)" = "$2" ]; }

install_hint_python() {
  cat <<'EOF'
     install: brew install python@3.12
         or:  https://www.python.org/downloads/
EOF
}
install_hint_node() {
  cat <<'EOF'
     install: brew install node        (macOS)
         or:  nvm install 20           (Linux/macOS, via nvm)
         or:  https://nodejs.org/
EOF
}
install_hint_pnpm() {
  cat <<'EOF'
     install: brew install pnpm
         or:  npm install -g pnpm
         or:  curl -fsSL https://get.pnpm.io/install.sh | sh -
EOF
}
install_hint_uv() {
  cat <<'EOF'
     install: brew install uv
         or:  curl -LsSf https://astral.sh/uv/install.sh | sh
EOF
}

check_prereqs() {
  hdr "Checking prerequisites"
  local bad=0

  if ! command -v python3 >/dev/null 2>&1; then
    err "python3 not found"
    install_hint_python
    bad=1
  else
    local pv
    pv=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")' 2>/dev/null || echo "0.0")
    if ! ver_ge "$pv" "3.11"; then
      err "python3 is $pv, need >= 3.11"
      install_hint_python
      bad=1
    else
      ok "python3 $pv"
    fi
  fi

  if ! command -v node >/dev/null 2>&1; then
    err "node not found"
    install_hint_node
    bad=1
  else
    local nv
    nv=$(node -v | sed 's/^v//')
    if ! ver_ge "$nv" "20.0.0"; then
      err "node is $nv, need >= 20"
      install_hint_node
      bad=1
    else
      ok "node $nv"
    fi
  fi

  if ! command -v pnpm >/dev/null 2>&1; then
    err "pnpm not found"
    install_hint_pnpm
    bad=1
  else
    ok "pnpm $(pnpm --version)"
  fi

  if ! command -v uv >/dev/null 2>&1; then
    err "uv not found"
    install_hint_uv
    bad=1
  else
    ok "uv $(uv --version 2>/dev/null | awk '{print $2}')"
  fi

  if [ "$bad" -eq 1 ]; then
    err "Fix the prerequisites above and re-run ./start.sh"
    exit 1
  fi
}

# ---------------------------------------------------------------------------- #
# .env — bootstrap from .env.example, prompt for the SadCaptcha key, then stop.
# ---------------------------------------------------------------------------- #

setup_env() {
  hdr "Environment config"
  if [ ! -f "$SCRIPT_DIR/.env" ]; then
    if [ ! -f "$SCRIPT_DIR/.env.example" ]; then
      err "Neither .env nor .env.example found at $SCRIPT_DIR"
      exit 1
    fi
    cp "$SCRIPT_DIR/.env.example" "$SCRIPT_DIR/.env"
    warn ".env created from .env.example"
    printf "\n  %sNext step%s: paste your %sSADCAPTCHA_API_KEY%s in\n" "$BOLD" "$RST" "$BOLD" "$RST"
    printf "  %s%s/.env%s\n" "$DIM" "$SCRIPT_DIR" "$RST"
    printf "  then re-run %s./start.sh%s\n\n" "$BOLD" "$RST"
    exit 0
  fi
  ok ".env present"
}

# ---------------------------------------------------------------------------- #
# Backend — venv + pip/uv + editable install + playwright chromium.
# ---------------------------------------------------------------------------- #

setup_backend() {
  hdr "Backend"
  if [ ! -d "$BACKEND_DIR/.venv" ]; then
    say "Creating backend/.venv (first run)"
    ( cd "$BACKEND_DIR" && python3 -m venv .venv )

    say "Upgrading pip + uv inside the venv"
    "$BACKEND_DIR/.venv/bin/python" -m pip install --quiet --upgrade pip uv

    say "Installing backend package (editable)"
    ( cd "$BACKEND_DIR" && uv pip install --python .venv/bin/python -e . )

    say "Installing Playwright Chromium (~170 MB, one-time)"
    if ! "$BACKEND_DIR/.venv/bin/playwright" install chromium; then
      warn "playwright install chromium failed — run it manually later if signup flows error out"
    fi

    ok "Backend ready"
  else
    ok "backend/.venv present"
  fi
}

# ---------------------------------------------------------------------------- #
# Frontend — pnpm install into frontend/node_modules.
# ---------------------------------------------------------------------------- #

setup_frontend() {
  hdr "Frontend"
  if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
    say "Running pnpm install (first run, ~1 min)"
    ( cd "$FRONTEND_DIR" && pnpm install )
    ok "Frontend ready"
  else
    ok "frontend/node_modules present"
  fi
}

# ---------------------------------------------------------------------------- #
# Servers
# ---------------------------------------------------------------------------- #

port_in_use() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
  elif command -v ss >/dev/null 2>&1; then
    ss -ltn "sport = :$1" 2>/dev/null | grep -q LISTEN
  else
    # Fallback — try to curl the port.
    curl --silent --fail --max-time 1 "http://127.0.0.1:$1" >/dev/null 2>&1
  fi
}

start_backend() {
  if port_in_use "$BACKEND_PORT"; then
    warn "Port $BACKEND_PORT already in use — assuming an existing backend is live"
    return
  fi
  say "Starting backend on :$BACKEND_PORT"
  : > "$BACKEND_LOG"
  (
    cd "$BACKEND_DIR" && \
    .venv/bin/uvicorn backend.main:app \
      --host 127.0.0.1 --port "$BACKEND_PORT" --no-access-log
  ) >> "$BACKEND_LOG" 2>&1 &
  PIDS+=("$!")
}

start_frontend() {
  if port_in_use "$FRONTEND_PORT"; then
    warn "Port $FRONTEND_PORT already in use — assuming an existing frontend is live"
    return
  fi
  say "Starting frontend on :$FRONTEND_PORT"
  : > "$FRONTEND_LOG"
  (
    cd "$FRONTEND_DIR" && \
    pnpm --silent dev
  ) >> "$FRONTEND_LOG" 2>&1 &
  PIDS+=("$!")
}

wait_for_http() {
  local url="$1" name="$2" timeout="${3:-60}"
  local elapsed=0
  printf "   waiting for %s" "$name"
  while [ "$elapsed" -lt "$timeout" ]; do
    if curl --silent --fail --max-time 2 -o /dev/null "$url"; then
      printf "\r"
      ok "$name ready ($url)"
      return 0
    fi
    printf "."
    sleep 1
    elapsed=$((elapsed + 1))
  done
  printf "\n"
  err "$name did not respond at $url within ${timeout}s"
  err "  tail the log: tail -f ${BACKEND_LOG/${SCRIPT_DIR}\//}  (or frontend.log)"
  return 1
}

# ---------------------------------------------------------------------------- #
# Cloudflare Tunnel — optional, only if cloudflared is installed.
# ---------------------------------------------------------------------------- #

start_tunnel() {
  TUNNEL_URL=""
  if ! command -v cloudflared >/dev/null 2>&1; then
    warn "cloudflared not installed — skipping tunnel (frontend will use localhost)"
    printf "   %sinstall: brew install cloudflare/cloudflare/cloudflared%s\n" "$DIM" "$RST"
    return
  fi

  say "Starting cloudflared tunnel to :$BACKEND_PORT"
  : > "$TUNNEL_LOG"
  cloudflared tunnel --no-autoupdate --url "http://localhost:$BACKEND_PORT" \
    >> "$TUNNEL_LOG" 2>&1 &
  PIDS+=("$!")

  local elapsed=0
  while [ "$elapsed" -lt 25 ]; do
    TUNNEL_URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG" 2>/dev/null | head -n1 || true)
    if [ -n "$TUNNEL_URL" ]; then
      ok "Tunnel ready: $TUNNEL_URL"
      return
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done

  warn "Tunnel did not come up within 25s — see $TUNNEL_LOG"
  TUNNEL_URL=""
}

# ---------------------------------------------------------------------------- #
# Browser
# ---------------------------------------------------------------------------- #

open_url() {
  local url="$1"
  case "$(uname -s)" in
    Darwin)
      open "$url"
      ;;
    Linux)
      if command -v xdg-open >/dev/null 2>&1; then
        xdg-open "$url" >/dev/null 2>&1 &
      else
        warn "xdg-open not found — open this URL manually:"
        printf "   %s\n" "$url"
      fi
      ;;
    *)
      warn "Open manually: $url"
      ;;
  esac
}

open_browser() {
  local url
  if [ -n "$TUNNEL_URL" ]; then
    # URL-encode the tunnel URL for the query param.
    local encoded
    encoded=$(python3 -c "import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=''))" "$TUNNEL_URL")
    url="$VERCEL_URL/settings?backend=$encoded"
    say "Opening Vercel UI (tunnel pre-filled)"
  else
    url="http://localhost:$FRONTEND_PORT"
    say "Opening local UI"
  fi
  printf "   %s%s%s\n" "$BOLD" "$url" "$RST"
  open_url "$url"
}

# ---------------------------------------------------------------------------- #
# Main
# ---------------------------------------------------------------------------- #

main() {
  printf "%s%sMission Control - AdsPower MCP%s\n" "$BOLD" "$CYN" "$RST"
  printf "%s%s%s\n" "$DIM" "one-command bootstrap" "$RST"

  check_prereqs
  setup_env
  setup_backend
  setup_frontend

  hdr "Starting services"
  start_backend
  start_frontend

  wait_for_http "http://localhost:$BACKEND_PORT/api/health" "backend"  60 || cleanup
  wait_for_http "http://localhost:$FRONTEND_PORT"           "frontend" 90 || cleanup

  start_tunnel
  open_browser

  hdr "Running"
  printf "  backend   %shttp://localhost:%s%s  -> %s\n" "$DIM" "$BACKEND_PORT" "$RST" "$BACKEND_LOG"
  printf "  frontend  %shttp://localhost:%s%s  -> %s\n" "$DIM" "$FRONTEND_PORT" "$RST" "$FRONTEND_LOG"
  if [ -n "$TUNNEL_URL" ]; then
    printf "  tunnel    %s%s%s  -> %s\n" "$DIM" "$TUNNEL_URL" "$RST" "$TUNNEL_LOG"
    printf "  vercel    %s%s/settings?backend=%s%s\n" "$DIM" "$VERCEL_URL" "$TUNNEL_URL" "$RST"
  fi
  printf "\n  %sPress Ctrl-C to stop everything%s\n\n" "$BOLD" "$RST"

  # Hold the foreground until a child exits or Ctrl-C arrives.
  # If any process dies we tear the rest down.
  while true; do
    for pid in "${PIDS[@]:-}"; do
      if [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; then
        err "A service exited unexpectedly (pid $pid) — check the logs in $LOG_DIR"
        cleanup
      fi
    done
    sleep 2
  done
}

main "$@"
