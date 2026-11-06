# =============================================================================
# Mission Control - one-command bootstrap for the adspower-mcp web stack.
#
# Windows PowerShell equivalent of start.sh. Best-effort parity.
#
# Checks prereqs -> builds backend venv -> installs frontend deps -> starts
# both servers -> opens a Cloudflare Tunnel to :8080 if cloudflared is on PATH
# -> opens your browser (localhost UI, or the Vercel UI with the tunnel URL
# pre-filled so a teammate can use it from anywhere).
#
# Ctrl-C stops everything cleanly.
#
# Run with:    powershell -ExecutionPolicy Bypass -File .\start.ps1
# =============================================================================

[CmdletBinding()]
param(
    [int]$BackendPort  = 8080,
    [int]$FrontendPort = 3000,
    [string]$VercelUrl = "https://tiktokkiller.vercel.app"
)

$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------- #
# Paths + state
# ---------------------------------------------------------------------------- #

$ScriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendDir  = Join-Path $ScriptDir 'backend'
$FrontendDir = Join-Path $ScriptDir 'frontend'
$LogDir      = Join-Path $ScriptDir '.logs'
New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
$BackendLog  = Join-Path $LogDir 'backend.log'
$FrontendLog = Join-Path $LogDir 'frontend.log'
$TunnelLog   = Join-Path $LogDir 'tunnel.log'

# PID tracking - we store System.Diagnostics.Process objects.
$script:ChildProcs = @()
$script:TunnelUrl  = ''

# ---------------------------------------------------------------------------- #
# Cosmetics
# ---------------------------------------------------------------------------- #

function Say  ($msg) { Write-Host "> $msg"              -ForegroundColor Cyan   }
function Ok   ($msg) { Write-Host "ok $msg"             -ForegroundColor Green  }
function Warn ($msg) { Write-Host "!  $msg"             -ForegroundColor Yellow }
function Err  ($msg) { Write-Host "X  $msg"             -ForegroundColor Red    }
function Hdr  ($msg) { Write-Host "`n$msg"              -ForegroundColor White  }

# ---------------------------------------------------------------------------- #
# Lifecycle
# ---------------------------------------------------------------------------- #

function Stop-All {
    Write-Host ''
    Say 'Shutting down...'
    foreach ($proc in $script:ChildProcs) {
        try {
            if ($proc -and -not $proc.HasExited) {
                $proc.CloseMainWindow() | Out-Null
            }
        } catch { }
    }
    Start-Sleep -Seconds 2
    foreach ($proc in $script:ChildProcs) {
        try {
            if ($proc -and -not $proc.HasExited) {
                # Kill the whole tree - npm/pnpm/uvicorn spawn children.
                Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
                Get-CimInstance Win32_Process -Filter "ParentProcessId = $($proc.Id)" |
                    ForEach-Object {
                        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
                    }
            }
        } catch { }
    }
    Ok 'Stopped.'
    exit 0
}

# Ctrl-C in interactive PowerShell raises PipelineStoppedException - catch it in main.
# Also register for cleanup on normal exit.
Register-EngineEvent -SourceIdentifier PowerShell.Exiting -Action { Stop-All } | Out-Null

# ---------------------------------------------------------------------------- #
# Prereqs
# ---------------------------------------------------------------------------- #

function Test-VersionAtLeast {
    param([string]$Have, [string]$Want)
    try {
        $h = [Version]($Have.Split('-')[0])
        $w = [Version]$Want
        return ($h -ge $w)
    } catch {
        return $false
    }
}

function Resolve-Python {
    foreach ($candidate in @('python', 'python3', 'py')) {
        $cmd = Get-Command $candidate -ErrorAction SilentlyContinue
        if (-not $cmd) { continue }
        try {
            $args = if ($candidate -eq 'py') { @('-3', '-c', 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")') }
                    else                      { @('-c', 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")') }
            $ver = & $cmd.Source @args 2>$null
            if ($LASTEXITCODE -eq 0 -and (Test-VersionAtLeast $ver '3.11')) {
                return @{ Exe = $cmd.Source; PyArgs = $(if ($candidate -eq 'py') { @('-3') } else { @() }); Version = $ver }
            }
        } catch { }
    }
    return $null
}

function Test-Prereqs {
    Hdr 'Checking prerequisites'
    $bad = $false

    $script:Py = Resolve-Python
    if (-not $script:Py) {
        Err 'python 3.11+ not found'
        Write-Host '     install: https://www.python.org/downloads/' -ForegroundColor DarkGray
        Write-Host '          or: winget install Python.Python.3.12' -ForegroundColor DarkGray
        $bad = $true
    } else {
        Ok "python $($script:Py.Version)  ($($script:Py.Exe))"
    }

    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) {
        Err 'node not found'
        Write-Host '     install: winget install OpenJS.NodeJS.LTS' -ForegroundColor DarkGray
        Write-Host '          or: https://nodejs.org/' -ForegroundColor DarkGray
        $bad = $true
    } else {
        $nv = (& node -v).TrimStart('v')
        if (-not (Test-VersionAtLeast $nv '20.0.0')) {
            Err "node is $nv, need >= 20"
            Write-Host '     install: winget install OpenJS.NodeJS.LTS' -ForegroundColor DarkGray
            $bad = $true
        } else {
            Ok "node $nv"
        }
    }

    $pnpm = Get-Command pnpm -ErrorAction SilentlyContinue
    if (-not $pnpm) {
        Err 'pnpm not found'
        Write-Host '     install: npm install -g pnpm' -ForegroundColor DarkGray
        Write-Host '          or: iwr https://get.pnpm.io/install.ps1 -useb | iex' -ForegroundColor DarkGray
        $bad = $true
    } else {
        Ok "pnpm $(& pnpm --version)"
    }

    $uv = Get-Command uv -ErrorAction SilentlyContinue
    if (-not $uv) {
        Err 'uv not found'
        Write-Host '     install: winget install astral-sh.uv' -ForegroundColor DarkGray
        Write-Host '          or: powershell -c "irm https://astral.sh/uv/install.ps1 | iex"' -ForegroundColor DarkGray
        $bad = $true
    } else {
        Ok "uv $((& uv --version 2>$null) -split ' ' | Select-Object -Index 1)"
    }

    if ($bad) {
        Err 'Fix the prerequisites above and re-run .\start.ps1'
        exit 1
    }
}

# ---------------------------------------------------------------------------- #
# .env
# ---------------------------------------------------------------------------- #

function Initialize-Env {
    Hdr 'Environment config'
    $envPath     = Join-Path $ScriptDir '.env'
    $envExample  = Join-Path $ScriptDir '.env.example'
    if (-not (Test-Path $envPath)) {
        if (-not (Test-Path $envExample)) {
            Err "Neither .env nor .env.example found at $ScriptDir"
            exit 1
        }
        Copy-Item $envExample $envPath
        Warn '.env created from .env.example'
        Write-Host ''
        Write-Host '  Next step: paste your SADCAPTCHA_API_KEY in' -ForegroundColor White
        Write-Host "  $envPath" -ForegroundColor DarkGray
        Write-Host '  then re-run .\start.ps1' -ForegroundColor White
        Write-Host ''
        exit 0
    }
    Ok '.env present'
}

# ---------------------------------------------------------------------------- #
# Backend
# ---------------------------------------------------------------------------- #

function Initialize-Backend {
    Hdr 'Backend'
    $venvDir = Join-Path $BackendDir '.venv'
    $pyExe   = Join-Path $venvDir 'Scripts\python.exe'
    $plExe   = Join-Path $venvDir 'Scripts\playwright.exe'

    if (-not (Test-Path $venvDir)) {
        Say 'Creating backend/.venv (first run)'
        Push-Location $BackendDir
        try {
            & $script:Py.Exe @($script:Py.PyArgs) -m venv .venv
            if ($LASTEXITCODE -ne 0) { throw "python -m venv failed" }

            Say 'Upgrading pip + uv inside the venv'
            & $pyExe -m pip install --quiet --upgrade pip uv
            if ($LASTEXITCODE -ne 0) { throw "pip upgrade failed" }

            Say 'Installing backend package (editable)'
            & uv pip install --python $pyExe -e .
            if ($LASTEXITCODE -ne 0) { throw "uv pip install failed" }

            Say 'Installing Playwright Chromium (~170 MB, one-time)'
            & $plExe install chromium
            if ($LASTEXITCODE -ne 0) {
                Warn 'playwright install chromium failed - run it manually later if signup flows error out'
            }
        } finally {
            Pop-Location
        }
        Ok 'Backend ready'
    } else {
        Ok 'backend/.venv present'
    }
}

# ---------------------------------------------------------------------------- #
# Frontend
# ---------------------------------------------------------------------------- #

function Initialize-Frontend {
    Hdr 'Frontend'
    $nm = Join-Path $FrontendDir 'node_modules'
    if (-not (Test-Path $nm)) {
        Say 'Running pnpm install (first run, ~1 min)'
        Push-Location $FrontendDir
        try {
            & pnpm install
            if ($LASTEXITCODE -ne 0) { throw "pnpm install failed" }
        } finally {
            Pop-Location
        }
        Ok 'Frontend ready'
    } else {
        Ok 'frontend/node_modules present'
    }
}

# ---------------------------------------------------------------------------- #
# Ports + servers
# ---------------------------------------------------------------------------- #

function Test-PortInUse {
    param([int]$Port)
    try {
        $t = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
        return [bool]$t
    } catch {
        # Fallback for non-admin or older systems - probe with a socket.
        try {
            $c = New-Object System.Net.Sockets.TcpClient
            $c.Connect('127.0.0.1', $Port)
            $c.Close()
            return $true
        } catch {
            return $false
        }
    }
}

function Start-BackendProc {
    if (Test-PortInUse -Port $BackendPort) {
        Warn "Port $BackendPort already in use - assuming an existing backend is live"
        return
    }
    Say "Starting backend on :$BackendPort"
    Clear-Content $BackendLog -ErrorAction SilentlyContinue
    New-Item -ItemType File -Path $BackendLog -Force | Out-Null

    $uvicorn = Join-Path $BackendDir '.venv\Scripts\uvicorn.exe'
    $proc = Start-Process -FilePath $uvicorn `
        -ArgumentList @(
            'backend.main:app',
            '--host', '127.0.0.1',
            '--port', "$BackendPort",
            '--no-access-log'
        ) `
        -WorkingDirectory $BackendDir `
        -NoNewWindow `
        -RedirectStandardOutput $BackendLog `
        -RedirectStandardError  "$BackendLog.err" `
        -PassThru
    $script:ChildProcs += $proc
}

function Start-FrontendProc {
    if (Test-PortInUse -Port $FrontendPort) {
        Warn "Port $FrontendPort already in use - assuming an existing frontend is live"
        return
    }
    Say "Starting frontend on :$FrontendPort"
    Clear-Content $FrontendLog -ErrorAction SilentlyContinue
    New-Item -ItemType File -Path $FrontendLog -Force | Out-Null

    # pnpm.cmd on Windows - use cmd /c so output redirection + child-process
    # teardown both behave.
    $pnpmCmd = (Get-Command pnpm).Source
    $proc = Start-Process -FilePath $pnpmCmd `
        -ArgumentList @('--silent', 'dev') `
        -WorkingDirectory $FrontendDir `
        -NoNewWindow `
        -RedirectStandardOutput $FrontendLog `
        -RedirectStandardError  "$FrontendLog.err" `
        -PassThru
    $script:ChildProcs += $proc
}

function Wait-ForHttp {
    param(
        [string]$Url,
        [string]$Name,
        [int]$TimeoutSec = 60
    )
    Write-Host "   waiting for $Name" -NoNewline
    $elapsed = 0
    while ($elapsed -lt $TimeoutSec) {
        try {
            $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
            if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 400) {
                Write-Host "`r" -NoNewline
                Ok "$Name ready ($Url)"
                return $true
            }
        } catch { }
        Write-Host '.' -NoNewline
        Start-Sleep -Seconds 1
        $elapsed++
    }
    Write-Host ''
    Err "$Name did not respond at $Url within ${TimeoutSec}s"
    Err "  tail the log: Get-Content $BackendLog -Wait  (or $FrontendLog)"
    return $false
}

# ---------------------------------------------------------------------------- #
# Tunnel
# ---------------------------------------------------------------------------- #

function Start-Tunnel {
    $script:TunnelUrl = ''
    $cf = Get-Command cloudflared -ErrorAction SilentlyContinue
    if (-not $cf) {
        Warn 'cloudflared not installed - skipping tunnel (frontend will use localhost)'
        Write-Host '   install: winget install Cloudflare.cloudflared' -ForegroundColor DarkGray
        return
    }

    Say "Starting cloudflared tunnel to :$BackendPort"
    Clear-Content $TunnelLog -ErrorAction SilentlyContinue
    New-Item -ItemType File -Path $TunnelLog -Force | Out-Null

    $proc = Start-Process -FilePath $cf.Source `
        -ArgumentList @(
            'tunnel',
            '--no-autoupdate',
            '--url', "http://localhost:$BackendPort"
        ) `
        -NoNewWindow `
        -RedirectStandardOutput "$TunnelLog.out" `
        -RedirectStandardError  $TunnelLog `
        -PassThru
    $script:ChildProcs += $proc

    $elapsed = 0
    while ($elapsed -lt 25) {
        if (Test-Path $TunnelLog) {
            $content = Get-Content $TunnelLog -Raw -ErrorAction SilentlyContinue
            if ($content -and ($content -match 'https://[a-z0-9-]+\.trycloudflare\.com')) {
                $script:TunnelUrl = $matches[0]
                Ok "Tunnel ready: $($script:TunnelUrl)"
                return
            }
        }
        if (Test-Path "$TunnelLog.out") {
            $content2 = Get-Content "$TunnelLog.out" -Raw -ErrorAction SilentlyContinue
            if ($content2 -and ($content2 -match 'https://[a-z0-9-]+\.trycloudflare\.com')) {
                $script:TunnelUrl = $matches[0]
                Ok "Tunnel ready: $($script:TunnelUrl)"
                return
            }
        }
        Start-Sleep -Seconds 1
        $elapsed++
    }
    Warn "Tunnel did not come up within 25s - see $TunnelLog"
}

# ---------------------------------------------------------------------------- #
# Browser
# ---------------------------------------------------------------------------- #

function Open-Browser {
    if ($script:TunnelUrl) {
        $encoded = [System.Uri]::EscapeDataString($script:TunnelUrl)
        $url = "$VercelUrl/settings?backend=$encoded"
        Say 'Opening Vercel UI (tunnel pre-filled)'
    } else {
        $url = "http://localhost:$FrontendPort"
        Say 'Opening local UI'
    }
    Write-Host "   $url" -ForegroundColor White
    try {
        Start-Process $url
    } catch {
        Warn "Could not auto-open browser. Open manually: $url"
    }
}

# ---------------------------------------------------------------------------- #
# Main
# ---------------------------------------------------------------------------- #

try {
    Write-Host 'Mission Control - AdsPower MCP' -ForegroundColor Cyan
    Write-Host 'one-command bootstrap'          -ForegroundColor DarkGray

    Test-Prereqs
    Initialize-Env
    Initialize-Backend
    Initialize-Frontend

    Hdr 'Starting services'
    Start-BackendProc
    Start-FrontendProc

    if (-not (Wait-ForHttp "http://localhost:$BackendPort/api/health" 'backend'  60)) { Stop-All }
    if (-not (Wait-ForHttp "http://localhost:$FrontendPort"           'frontend' 90)) { Stop-All }

    Start-Tunnel
    Open-Browser

    Hdr 'Running'
    Write-Host "  backend   http://localhost:$BackendPort   -> $BackendLog"   -ForegroundColor DarkGray
    Write-Host "  frontend  http://localhost:$FrontendPort   -> $FrontendLog" -ForegroundColor DarkGray
    if ($script:TunnelUrl) {
        Write-Host "  tunnel    $($script:TunnelUrl)   -> $TunnelLog"        -ForegroundColor DarkGray
        Write-Host "  vercel    $VercelUrl/settings?backend=$($script:TunnelUrl)" -ForegroundColor DarkGray
    }
    Write-Host ''
    Write-Host '  Press Ctrl-C to stop everything' -ForegroundColor White
    Write-Host ''

    # Watchdog loop: exit if any child dies, exit on Ctrl-C.
    while ($true) {
        foreach ($proc in $script:ChildProcs) {
            try {
                if ($proc -and $proc.HasExited) {
                    Err "A service exited unexpectedly (pid $($proc.Id)) - check the logs in $LogDir"
                    Stop-All
                }
            } catch { }
        }
        Start-Sleep -Seconds 2
    }
}
catch [System.Management.Automation.PipelineStoppedException] {
    # Ctrl-C in interactive PowerShell lands here.
    Stop-All
}
catch {
    Err $_.Exception.Message
    Stop-All
}
finally {
    Stop-All
}
