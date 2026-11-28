<#
.SYNOPSIS
    One-shot start of the agent stack after a reboot.

.DESCRIPTION
    Nothing auto-starts on this machine unless `openchamber startup enable` was run,
    so after a reboot this script brings the stack back in one command:

      1. loads the keys from %USERPROFILE%\.config\opencode\.env into this process
         (a new terminal gets them from the profile; a script started by double-click
         or from a non-PowerShell parent does not),
      2. starts OpenChamber on the chosen port unless something already listens there
         (OpenChamber spawns the embedded opencode server itself),
      3. starts the debug Chrome on CDP 9222 unless a browser already listens there,
      4. waits for /health and prints what came up.

    Idempotent: run it twice and the second run only reports what is already running.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File platform\win10\start.ps1

.EXAMPLE
    # no browser automation, no UI window; just the servers
    .\start.ps1 -Port 3001 -SkipChrome -NoUi
#>
[CmdletBinding()]
param(
    [int]$Port = 3000,
    [int]$CdpPort = 9222,
    [switch]$SkipChrome,
    [switch]$NoUi
)

$ErrorActionPreference = 'Stop'
$failures = 0

function Step([string]$message) { Write-Host "==> $message" -ForegroundColor Cyan }
function Ok([string]$message)   { Write-Host "  ok  $message" -ForegroundColor Green }
function Warn([string]$message) { Write-Host "  !!  $message" -ForegroundColor Yellow }
function Fail([string]$message) { Write-Host "  xx  $message" -ForegroundColor Red; $script:failures++ }

function Test-PortListening([int]$port) {
    # Get-NetTCPConnection is Windows-only and may need elevation for other users'
    # sockets, so fall back to a plain connect when it throws.
    try {
        return [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop)
    } catch {
        try {
            $client = [System.Net.Sockets.TcpClient]::new()
            $client.Connect('127.0.0.1', $port)
            $client.Close()
            return $true
        } catch {
            return $false
        }
    }
}

# --- 1. keys -------------------------------------------------------------------
# Same file setup.ps1 writes; values already present in the environment win.
$envFile = Join-Path $env:USERPROFILE '.config\opencode\.env'
if (Test-Path -LiteralPath $envFile) {
    $loaded = 0
    foreach ($line in Get-Content -LiteralPath $envFile) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
        $eq = $trimmed.IndexOf('=')
        if ($eq -lt 1) { continue }
        $name = $trimmed.Substring(0, $eq).Trim()
        $value = $trimmed.Substring($eq + 1).Trim().Trim('"').Trim("'")
        if (-not $name -or $value -eq '') { continue }
        if (-not (Get-Item -LiteralPath "env:$name" -ErrorAction SilentlyContinue)) {
            Set-Item -LiteralPath "env:$name" -Value $value
            $loaded++
        }
    }
    Ok "keys: $loaded loaded from $envFile"
} else {
    Warn "keys: $envFile missing (embeddings and a6api calls will fail; run setup.ps1)"
}

# --- 2. OpenChamber ------------------------------------------------------------
if (-not (Get-Command openchamber -ErrorAction SilentlyContinue)) {
    Fail 'openchamber not on PATH (run platform\win10\setup.ps1 first)'
} elseif (Test-PortListening $Port) {
    Ok "openchamber: already listening on $Port"
} else {
    Step "starting openchamber on port $Port"
    & openchamber serve --port $Port
    if ($LASTEXITCODE -ne 0) { Fail "openchamber serve exited $LASTEXITCODE" }
}

# --- 3. debug Chrome -----------------------------------------------------------
if ($SkipChrome) {
    Warn 'chrome: skipped (-SkipChrome)'
} elseif (Test-PortListening $CdpPort) {
    Ok "chrome: CDP already listening on $CdpPort"
} else {
    $candidates = @(
        (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
        (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
    )
    $chrome = $candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
    if (-not $chrome) {
        Warn "chrome: not found (expected under Program Files); CDP $CdpPort stays closed"
    } else {
        Step "starting debug chrome (CDP $CdpPort)"
        # A separate profile keeps this window from fighting the daily one for the lock.
        # The user-data-dir is quoted by hand: Start-Process joins -ArgumentList with
        # spaces and does not quote it, so a path with spaces would split.
        Start-Process -FilePath $chrome -ArgumentList @(
            "--remote-debugging-port=$CdpPort",
            "--user-data-dir=`"$env:LOCALAPPDATA\chrome-debug`""
        ) | Out-Null
    }
}

# --- 4. readiness --------------------------------------------------------------
Step 'waiting for the server'
$health = $null
for ($i = 0; $i -lt 60; $i++) {
    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 2
        if ($health) { break }
    } catch { }
    Start-Sleep -Seconds 1
}

if (-not $health) {
    Fail "http://127.0.0.1:$Port/health did not answer within 60s (openchamber logs -p $Port)"
} else {
    Ok ("openchamber {0}, opencode ready: {1}" -f $health.openchamberVersion, [bool]$health.isOpenCodeReady)
    if (-not $health.isOpenCodeReady) {
        Warn "opencode is not ready yet; the first chat may take a few seconds"
    }
}

if (-not $SkipChrome -and (Test-PortListening $CdpPort)) {
    Ok "chrome: CDP http://127.0.0.1:$CdpPort"
}

if (-not $NoUi) {
    Start-Process "http://127.0.0.1:$Port/"
}

if ($failures -gt 0) {
    Write-Host "$failures step(s) failed" -ForegroundColor Red
    exit 1
}
Write-Host "stack up: http://127.0.0.1:$Port/   |   verify: platform\win10\verify.ps1" -ForegroundColor Green
exit 0
