#Requires -Version 5.1
<#
.SYNOPSIS
    Bootstrap the agent stack (opencode + OpenChamber + magic-context + codegraph)
    on a native Windows 10 machine, pinned to the same BD as the Linux container.

.DESCRIPTION
    Idempotent: safe to re-run. Installs the globally-installed npm packages at the
    BD-002 versions, then copies this repo's non-sensitive config into
    %USERPROFILE%\.config. Secrets are never written: set COMMANDCODE_API_KEY and
    EMBEDDING_API_KEY in your environment before starting opencode.

.PARAMETER RepoRoot
    Repo checkout to copy config from. Defaults to two levels above this script.

.PARAMETER SkipGlobalPackages
    Copy config only. Use when the npm packages are already at the right versions.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File platform\win10\setup.ps1
#>
[CmdletBinding()]
param(
    [string]$RepoRoot = (Resolve-Path ((Join-Path (Join-Path $PSScriptRoot '..') '..'))).Path,
    [switch]$SkipGlobalPackages
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# --- version pins: keep in sync with versions/BD-002.md ----------------------
$OPENCODE_VERSION    = '2.2.5'
$CODEGRAPH_VERSION   = '1.6.2'
$PLAYWRIGHT_VERSION  = '1.64.1'
$MIN_NODE_VERSION    = [version]'24.14.0'   # @openchamber/web engines requirement
$OPENCHAMBER_TARBALL = (Join-Path (Join-Path $RepoRoot 'vendor') 'openchamber-web-2.6.0-fork.tgz')
# ----------------------------------------------------------------------------

function Step([string]$message) { Write-Host "==> $message" -ForegroundColor Cyan }
function Ok([string]$message)   { Write-Host "  ok  $message" -ForegroundColor Green }
function Warn([string]$message) { Write-Host "  !!  $message" -ForegroundColor Yellow }

function Assert-Command([string]$name, [string]$hint) {
    if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
        throw "'$name' not found on PATH. $hint"
    }
}

function Get-GlobalPackageVersion([string]$package) {
    $raw = npm ls -g --depth=0 --json 2>$null
    if (-not $raw) { return $null }
    try { $tree = $raw | ConvertFrom-Json } catch { return $null }
    $deps = $tree.dependencies
    if (-not $deps) { return $null }
    $key = $package
    if ($deps.PSObject.Properties.Name -contains $key) { return $deps.$key.version }
    return $null
}

Write-Host ''
Write-Host 'OpenCode agent stack - Windows 10 setup' -ForegroundColor White
Write-Host "repo: $RepoRoot"
Write-Host ''

# --- 1. prerequisites --------------------------------------------------------
Step '1/6 prerequisites'

Assert-Command 'node' 'Install Node.js 24.14+ (winget install OpenJS.NodeJS.LTS) and reopen the shell.'
Assert-Command 'npm'  'npm ships with Node.js; if missing, repair the Node install.'
Assert-Command 'git'  'Install Git for Windows (winget install Git.Git).'

$nodeRaw = (node -v).Trim()
$nodeVersion = [version]($nodeRaw.TrimStart('v'))
if ($nodeVersion -lt $MIN_NODE_VERSION) {
    throw "Node $nodeRaw is too old: @openchamber/web requires >= $MIN_NODE_VERSION. Update Node and re-run."
}
Ok "node $nodeRaw"

if (-not (Test-Path $OPENCHAMBER_TARBALL)) {
    throw "Missing $OPENCHAMBER_TARBALL. Run 'git lfs pull' or re-clone: the fork build must come from the repo."
}
Ok "fork tarball present ($([math]::Round((Get-Item $OPENCHAMBER_TARBALL).Length / 1MB)) MB)"

# --- 2. global packages ------------------------------------------------------
if ($SkipGlobalPackages) {
    Step '2/6 global packages (skipped)'
} else {
    Step '2/6 global packages'
    $packages = @(
        "@opencode/cli@$OPENCODE_VERSION",
        "@colbymchenry/codegraph@$CODEGRAPH_VERSION",
        "playwright@$PLAYWRIGHT_VERSION"
    )
    foreach ($package in $packages) {
        Write-Host "  installing $package"
        npm install -g $package 2>&1 | ForEach-Object { if ($_ -match 'ERR!') { Write-Host "    $_" } }
        if ($LASTEXITCODE -ne 0) { throw "npm install -g $package failed (exit $LASTEXITCODE)." }
        Ok $package
    }

    Write-Host '  installing @openchamber/web from the fork tarball'
    npm install -g $OPENCHAMBER_TARBALL 2>&1 | ForEach-Object { if ($_ -match 'ERR!') { Write-Host "    $_" } }
    if ($LASTEXITCODE -ne 0) { throw 'npm install -g of the fork tarball failed.' }
    Ok 'openchamber (fork build)'

    # node-pty ships prebuilds/win32-x64/conpty.node, so no MSVC is needed.
    # If this ever starts failing, install Visual Studio Build Tools and retry.
}

# --- 3. config copy ----------------------------------------------------------
Step '3/6 config'

$configHome = Join-Path $env:USERPROFILE '.config'
$opencodeCfg = Join-Path $configHome 'opencode'
$cortexCfg   = Join-Path $configHome 'cortexkit'
New-Item -ItemType Directory -Force -Path $opencodeCfg, $cortexCfg | Out-Null

Copy-Item ((Join-Path (Join-Path (Join-Path $RepoRoot 'opencode-config') 'opencode') '*'))   $opencodeCfg -Recurse -Force
Copy-Item ((Join-Path (Join-Path (Join-Path $RepoRoot 'opencode-config') 'cortexkit') '*'))  $cortexCfg   -Recurse -Force
Copy-Item ((Join-Path (Join-Path $RepoRoot 'opencode-config') 'package.json')) (Join-Path $configHome 'package.json') -Force
Copy-Item (Join-Path $PSScriptRoot 'AGENTS.win10.md')          (Join-Path $opencodeCfg 'AGENTS.md') -Force
Ok "config copied to $configHome"

# The container pins these through entrypoint.sh; on Windows they are the user's job.
foreach ($variable in 'COMMANDCODE_API_KEY', 'EMBEDDING_API_KEY') {
    if (-not (Test-Path "env:$variable")) {
        Warn "$variable is not set - opencode will start but the model provider / embeddings will fail"
    } else {
        Ok "$variable set"
    }
}

# --- 4. Playwright: CDP only ------------------------------------------------
Step '4/6 playwright (CDP attach, no browser download)'
$cdpHint = Join-Path $PSScriptRoot 'AGENTS.win10.md'
Ok 'skipped browser download by design - see browser section in AGENTS.md'
Write-Host "  point PW_CDP at your local Chrome: --remote-debugging-port=9222"

# --- 5. per-project MCP (godot-ai) -----------------------------------------
Step '5/6 Godot MCP'
Write-Host '  Not configured here: the godot-ai dock writes its own mcp entry.'
Write-Host '  Enable the addon, then use its Configure button (it pins version + port).'
Warn 'do not hand-copy the uvx command line: v4 clients must connect through godot-ai attach'

# --- 6. report --------------------------------------------------------------
Step '6/6 versions installed'
foreach ($package in '@opencode/cli', '@openchamber/web', '@colbymchenry/codegraph', 'playwright') {
    $version = Get-GlobalPackageVersion $package
    if ($version) { Ok "$package $version" } else { Warn "$package not found in the global prefix" }
}

Write-Host ''
Write-Host 'Done. Next: platform\win10\verify.ps1' -ForegroundColor White
Write-Host 'Then start opencode from any project directory; OpenChamber with: openchamber serve'
Write-Host ''
