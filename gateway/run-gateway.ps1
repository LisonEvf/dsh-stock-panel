# stock-tdx-gateway launcher / watchdog / autostart (Windows)
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File run-gateway.ps1 -Action start       # hidden background start (prewarmed)
#   powershell -ExecutionPolicy Bypass -File run-gateway.ps1 -Action status      # health check
#   powershell -ExecutionPolicy Bypass -File run-gateway.ps1 -Action stop
#   powershell -ExecutionPolicy Bypass -File run-gateway.ps1 -Action restart
#   powershell -ExecutionPolicy Bypass -File run-gateway.ps1 -Action autostart-on   # register HKCU Run
#   powershell -ExecutionPolicy Bypass -File run-gateway.ps1 -Action autostart-off
#
# Optional overrides:
#   -Port 8017 | -Python "C:\...\python.exe" | -OpentdxSrc "C:\...\TRADE\opentdx"
param(
    [ValidateSet('start', 'stop', 'restart', 'status', 'autostart-on', 'autostart-off')]
    [string]$Action = 'status',
    [int]$Port = 8017,
    [string]$Python = '',
    [string]$OpentdxSrc = ''
)

$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$gatewayPy = Join-Path $scriptDir 'gateway.py'
$pidFile = Join-Path $scriptDir 'gateway.pid'
$logFile = Join-Path $scriptDir 'gateway.log'
$startupKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$startupName = 'dsh-stock-tdx-gateway'

if (-not $OpentdxSrc) {
    # gateway -> frontend-dsh -> tickflow-stock-panel -> TRADE\opentdx
    $OpentdxSrc = (Resolve-Path (Join-Path $scriptDir '..\..\..\opentdx') -ErrorAction SilentlyContinue).Path
}
if (-not $OpentdxSrc -or -not (Test-Path (Join-Path $OpentdxSrc 'opentdx'))) {
    Write-Host "[gateway] opentdx source not found (current: $OpentdxSrc). Pass -OpentdxSrc." -ForegroundColor Red
    exit 1
}

if (-not $Python) {
    $candidates = @(
        (Join-Path $scriptDir '..\..\backend\.venv\Scripts\python.exe'),
        $env:PYTHON
    )
    foreach ($c in $candidates) { if ($c -and (Test-Path $c)) { $Python = $c; break } }
    if (-not $Python) { $cmd = Get-Command python -ErrorAction SilentlyContinue; if ($cmd) { $Python = $cmd.Source } }
}
if (-not $Python -or -not (Test-Path $Python)) {
    Write-Host '[gateway] python>=3.12 not found. Pass -Python.' -ForegroundColor Red
    exit 1
}

function Get-Health {
    try {
        return Invoke-RestMethod -Uri "http://127.0.0.1:$Port/healthz" -TimeoutSec 5
    } catch {
        return $null
    }
}

function Start-Gateway {
    $h = Get-Health
    if ($h) {
        Write-Host "[gateway] already running (uptime $($h.uptime_s)s, connected A=$($h.connected.a) ext=$($h.connected.ext), tools=$($h.tools.Count))" -ForegroundColor Green
        return
    }
    if (Test-Path $pidFile) {
        $old = (Get-Content $pidFile -Raw).Trim()
        if ($old -and (Get-Process -Id $old -ErrorAction SilentlyContinue)) {
            Write-Host "[gateway] stale PID=$old, stopping it first" -ForegroundColor Yellow
            Stop-Process -Id $old -Force -ErrorAction SilentlyContinue
            Start-Sleep -Milliseconds 400
        }
    }
    $argLine = "`"$gatewayPy`" --host 127.0.0.1 --port $Port --opentdx-src `"$OpentdxSrc`" --log `"$logFile`""
    $proc = Start-Process -FilePath $Python -ArgumentList $argLine -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput "$logFile.out" -RedirectStandardError "$logFile.err"
    Set-Content -Path $pidFile -Value $proc.Id
    Write-Host "[gateway] starting PID=$($proc.Id), prewarming TDX connections..." -ForegroundColor Cyan
    for ($i = 0; $i -lt 20; $i++) {
        Start-Sleep -Milliseconds 300
        $h = Get-Health
        if ($h -and $h.ok) {
            Write-Host "[gateway] ready: http://127.0.0.1:$Port/call (warm requests ~15ms)" -ForegroundColor Green
            return
        }
        if ($proc.HasExited) {
            Write-Host "[gateway] process exited. Check $logFile.err" -ForegroundColor Red
            if (Test-Path "$logFile.err") { Get-Content "$logFile.err" -Tail 10 }
            exit 1
        }
    }
    Write-Host "[gateway] wait timeout. Check $logFile" -ForegroundColor Red
}

function Stop-Gateway {
    if (Test-Path $pidFile) {
        $old = (Get-Content $pidFile -Raw).Trim()
        if ($old -and (Get-Process -Id $old -ErrorAction SilentlyContinue)) {
            Stop-Process -Id $old -Force -ErrorAction SilentlyContinue
            Write-Host "[gateway] stopped PID=$old" -ForegroundColor Yellow
        }
        Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
    } elseif (Get-Health) {
        $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
        if ($conn) { Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue }
        Write-Host "[gateway] stopped by port $Port" -ForegroundColor Yellow
    } else {
        Write-Host '[gateway] not running'
    }
}

switch ($Action) {
    'start' { Start-Gateway }
    'stop' { Stop-Gateway }
    'restart' { Stop-Gateway; Start-Sleep -Milliseconds 500; Start-Gateway }
    'status' {
        $h = Get-Health
        if ($h) {
            Write-Host "[gateway] running: ok=$($h.ok) uptime=$($h.uptime_s)s connected(A=$($h.connected.a),ext=$($h.connected.ext)) tools=$($h.tools.Count)"
        } else {
            Write-Host "[gateway] not running (port $Port)"
            exit 1
        }
    }
    'autostart-on' {
        $cmd = "powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$($MyInvocation.MyCommand.Path)`" -Action start"
        Set-ItemProperty -Path $startupKey -Name $startupName -Value $cmd
        Write-Host "[gateway] autostart registered: $startupName"
        Start-Gateway
    }
    'autostart-off' {
        Remove-ItemProperty -Path $startupKey -Name $startupName -ErrorAction SilentlyContinue
        Write-Host "[gateway] autostart removed: $startupName"
    }
}
