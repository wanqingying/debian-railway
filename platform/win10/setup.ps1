#Requires -Version 5.1
<#
.SYNOPSIS
    Bootstrap the agent stack (opencode + OpenChamber + magic-context + codegraph)
    on a native Windows 10 machine, pinned to the same BD as the Linux container.

.DESCRIPTION
    Idempotent: safe to re-run. Installs the globally-installed npm packages at the
    BD-004 versions, then copies this repo's non-sensitive config into
    %USERPROFILE%\.config. Secrets are never written: run `opencode auth login` for
    the opencode-go subscription and set A6API_API_KEY (image_generate) plus
    EMBEDDING_API_KEY (magic-context) in your environment.

.PARAMETER RepoRoot
    Repo checkout to copy config from. Defaults to two levels above this script.

.PARAMETER WorktreeRoot
    Where this machine's worktrees go. The shared opencode.jsonc pins the container's
    /workspace/worktrees, so the copied file is rewritten to this path.

.PARAMETER SkipGlobalPackages
    Copy config only. Use when the npm packages are already at the right versions.

.PARAMETER SkipLark
    Do not install @larksuite/cli. The lark-* skills stay on disk but cannot run.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File platform\win10\setup.ps1
#>
[CmdletBinding()]
param(
    [string]$RepoRoot,
    [string]$WorktreeRoot = 'D:\gamedev\worktrees',
    [switch]$SkipGlobalPackages,
    [switch]$SkipLark
)

# Windows PowerShell 5.1 evaluates param defaults before $PSScriptRoot is
# populated, so the default '-' got an empty string and Join-Path refused to
# bind. Resolve the repo root after binding instead.
if (-not $RepoRoot) {
    $scriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
    $RepoRoot = (Resolve-Path (Join-Path $scriptDir '..\..')).Path
}

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# --- version pins: keep in sync with versions/BD-004.md ----------------------
$OPENCODE_VERSION    = '2.2.6'
$CODEGRAPH_VERSION   = '1.6.2'
$PLAYWRIGHT_VERSION  = '1.65.0'
$LARK_CLI_VERSION    = '1.0.99'
$MIN_NODE_VERSION    = [version]'24.14.0'   # @openchamber/web engines requirement
$OPENCHAMBER_TARBALL = (Join-Path (Join-Path $RepoRoot 'vendor') 'openchamber-web-2.7.0-fork.tgz')
# ----------------------------------------------------------------------------

function Step([string]$message) { Write-Host "==> $message" -ForegroundColor Cyan }
function Ok([string]$message)   { Write-Host "  ok  $message" -ForegroundColor Green }
function Warn([string]$message) { Write-Host "  !!  $message" -ForegroundColor Yellow }

function Assert-Command([string]$name, [string]$hint) {
    if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
        throw "'$name' not found on PATH. $hint"
    }
}

# Read the installed version straight off the filesystem instead of shelling out to
# `npm ls -g` per package: that call costs a round trip each time and its JSON has to
# be flattened first (PS feeds native output line by line). One `npm root -g`, cached,
# answers every lookup in the process.
$script:globalRoot = $null
function Get-GlobalRoot {
    if (-not $script:globalRoot) {
        $raw = (cmd /c 'npm root -g 2>nul') -join "`n"
        $first = ($raw -split "`n" | Where-Object { $_.Trim() } | Select-Object -First 1)
        if ($first) { $script:globalRoot = $first.Trim() }
    }
    return $script:globalRoot
}

function Get-GlobalPackageVersion([string]$package) {
    $root = Get-GlobalRoot
    if (-not $root) { return $null }
    $pkgJson = Join-Path (Join-Path $root ($package -replace '/', '\')) 'package.json'
    if (-not (Test-Path -LiteralPath $pkgJson)) { return $null }
    try { return (Get-Content -Raw -LiteralPath $pkgJson | ConvertFrom-Json).version } catch { return $null }
}

function Install-NpmGlobal([string]$spec, [string]$allowScriptsFor) {
    # PS 5.1 turns every native-command stderr line into an error record, and
    # under $ErrorActionPreference = 'Stop' an ordinary npm warning (the
    # install-scripts advisory fires on every install) terminates the script.
    # Run the call through cmd so both streams arrive as plain text, and judge
    # success by $LASTEXITCODE only.
    #
    # npm 11 blocks install scripts unless the package is named with
    # --allow-scripts: @opencode/cli only loses its binary-resolution step,
    # @larksuite/cli's postinstall is what fetches the CLI at all.
    $flags  = if ($allowScriptsFor) { "--allow-scripts=$allowScriptsFor " } else { '' }
    $quoted = '"' + ($spec -replace '"', '') + '"'
    cmd /c "npm install -g $flags$quoted 2>&1" | ForEach-Object {
        if ("$_" -match 'ERR!|npm warn') { Write-Host "    $_" }
    }
    if ($LASTEXITCODE -ne 0) { throw "npm install -g $spec failed (exit $LASTEXITCODE)." }
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
    # Skip a package already installed at the pinned version: re-running the script is
    # then a no-op for the toolchain, and only the config copy (step 3) does work.
    $packages = @(
        @{ name = '@opencode/cli';          pin = $OPENCODE_VERSION;   allow = '@opencode/cli' },
        @{ name = '@colbymchenry/codegraph'; pin = $CODEGRAPH_VERSION;  allow = $null },
        @{ name = 'playwright';             pin = $PLAYWRIGHT_VERSION; allow = $null }
    )
    if (-not $SkipLark) {
        $packages += @{ name = '@larksuite/cli'; pin = $LARK_CLI_VERSION; allow = '@larksuite/cli' }
    }
    foreach ($package in $packages) {
        $have = Get-GlobalPackageVersion $package.name
        if ($have -eq $package.pin) {
            Ok "$($package.name) $have - already installed"
            continue
        }
        $note = if ($have) { " (replacing $have)" } else { '' }
        Write-Host "  installing $($package.name)@$($package.pin)$note"
        Install-NpmGlobal "$($package.name)@$($package.pin)" $package.allow
        Ok "$($package.name) $($package.pin)"
    }

    if ($SkipLark) {
        Warn 'lark-cli skipped (-SkipLark): the lark-* skills are installed but cannot run'
    }

    # The fork tarball is always reinstalled, deliberately: a rebuilt fork keeps the
    # version 2.7.0, so a version comparison would silently keep the old build after
    # the tarball in vendor/ is replaced. It is a local file - no registry round trip.
    Write-Host '  installing @openchamber/web from the fork tarball'
    Install-NpmGlobal $OPENCHAMBER_TARBALL
    Ok 'openchamber (fork build)'

    # node-pty ships prebuilds/win32-x64/conpty.exe, so no MSVC is needed.
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

# opencode.jsonc is otherwise copied verbatim, but its worktree.directory is the
# container's /workspace/worktrees - a path this machine does not have, which would
# make OpenChamber's "New worktree" create a directory nobody can open. Rewrite that
# one value (backslashes escaped for JSON) and leave every other key alone.
$jsoncPath = Join-Path $opencodeCfg 'opencode.jsonc'
if (Test-Path $jsoncPath) {
    $content  = Get-Content -Raw -Path $jsoncPath
    $jsonPath = $WorktreeRoot -replace '\\', '\\'
    $patched  = $content -replace '"directory":\s*"/workspace/worktrees"', ('"directory": "{0}"' -f $jsonPath)
    if ($patched -ne $content) {
        [System.IO.File]::WriteAllText($jsoncPath, $patched)
        Ok "worktree.directory -> $WorktreeRoot"
    } else {
        Warn 'worktree.directory not found in opencode.jsonc - the container pin changed; check by hand'
    }
}
Ok "config copied to $configHome"

# --- 3b. secrets from a file -------------------------------------------------
# A .env in %USERPROFILE%\.config\opencode (outside the repo) plus a loader in the
# PowerShell profile: keys then survive without setx, are editable in one place, and
# are inherited by both `opencode` and `openchamber serve`. Never overwritten here.
$envFile = Join-Path $opencodeCfg '.env'
if (-not (Test-Path -LiteralPath $envFile)) {
    $template = @'
# Keys for the agent stack on this machine. Loaded into every new PowerShell session
# by the block setup.ps1 writes into your PS profile; `opencode` and `openchamber serve`
# inherit them, so no setx is needed. Machine-local: never copy this into the repo.

# magic-context memory embeddings (ctx_search / memory search)
EMBEDDING_API_KEY=

# a6api: image_generate and the a6api models. Instead of a key here you can store it
# once with `opencode auth login` -> A6API and leave this blank.
A6API_API_KEY=

# V-API (gpt.ge) resale models. Optional.
# GPTGE_API_KEY=

# Browser automation and the deep-research playwright library. Uncomment and fill
# after `npm root -g` prints this machine's real global root.
# PW_CDP=http://127.0.0.1:9222
# NODE_PATH=<npm root -g>
# PW_PKG=<npm root -g>\playwright\index.mjs
'@
    [System.IO.File]::WriteAllText($envFile, ($template -replace "`r`n", "`n"))
    Ok "created $envFile - fill in the keys"
} else {
    Ok "$envFile exists (left untouched)"
}

# One block, both profile files: Windows PowerShell 5.1 and winget's pwsh 7 read
# different paths, and the user may launch either.
$loader = @'
# >>> opencode stack env (platform\win10) >>>
# Keys live in %USERPROFILE%\.config\opencode\.env so setx is not needed. Written by
# platform/win10/setup.ps1; delete this block (both markers) to opt out.
$__ocEnv = Join-Path $env:USERPROFILE '.config\opencode\.env'
if (Test-Path -LiteralPath $__ocEnv) {
    foreach ($__line in Get-Content -LiteralPath $__ocEnv) {
        $__line = $__line.Trim().TrimStart([char]0xFEFF)
        if (-not $__line -or $__line.StartsWith('#')) { continue }
        $__i = $__line.IndexOf('=')
        if ($__i -lt 1) { continue }
        $__name  = $__line.Substring(0, $__i).Trim()
        $__value = $__line.Substring($__i + 1).Trim().Trim('"').Trim("'")
        Set-Item -Path "Env:$__name" -Value $__value
    }
    Remove-Variable __ocEnv, __line, __i, __name, __value -ErrorAction SilentlyContinue
}
# <<< opencode stack env (platform\win10) <<<
'@
$docsDir = [Environment]::GetFolderPath('MyDocuments')
if (-not $docsDir) { $docsDir = Join-Path $env:USERPROFILE 'Documents' }
foreach ($profilePath in @(
    (Join-Path $docsDir 'WindowsPowerShell\Microsoft.PowerShell_profile.ps1'),
    (Join-Path $docsDir 'PowerShell\Microsoft.PowerShell_profile.ps1')
)) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $profilePath) | Out-Null
    $existing = if (Test-Path -LiteralPath $profilePath) { Get-Content -Raw -LiteralPath $profilePath } else { '' }
    if ($existing -notlike '*opencode stack env (platform\win10)*') {
        Add-Content -LiteralPath $profilePath -Value $loader
        Ok "profile loader added: $profilePath"
    }
}

# The default model is opencode-go/*, which is a subscription rather than an env key:
# authorise it once with `opencode auth login` (or from OpenChamber); the credential
# stays in this machine's opencode data directory.
foreach ($variable in 'EMBEDDING_API_KEY', 'A6API_API_KEY') {
    if (-not (Test-Path "env:$variable")) {
        $what = if ($variable -eq 'EMBEDDING_API_KEY') { 'magic-context memory embeddings' } else { 'image_generate and the a6api models' }
        Warn "$variable not set in this session - $what will fail until you fill $envFile and open a new shell"
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
$reported = @('@opencode/cli', '@openchamber/web', '@colbymchenry/codegraph', 'playwright')
if (-not $SkipLark) { $reported += '@larksuite/cli' }
foreach ($package in $reported) {
    $version = Get-GlobalPackageVersion $package
    if ($version) { Ok "$package $version" } else { Warn "$package not found in the global prefix" }
}

# Version managers (fnm, nvm-windows) keep global packages inside the Node
# installation, not %APPDATA%\npm - print the real root so the Playwright env
# hints below use the right path.
$npmRoot = (Get-GlobalRoot)
if ($npmRoot) { Ok "npm global root: $npmRoot" }
# Same .env file as the keys: the profile loader injects anything named here.
if (-not $env:NODE_PATH -or -not $env:PW_PKG) {
    Warn 'NODE_PATH / PW_PKG not set - the playwright library (deep-research) needs them:'
    Write-Host "    add to $envFile :"
    Write-Host "      NODE_PATH=$npmRoot"
    Write-Host "      PW_PKG=$npmRoot\playwright\index.mjs"
}
if (-not $env:PW_CDP) {
    Warn 'PW_CDP not set for browser automation:'
    Write-Host "    add to $envFile :  PW_CDP=http://127.0.0.1:9222"
    Write-Host '    (start Chrome with --remote-debugging-port=9222)'
}

Write-Host ''
Write-Host 'Done. Next: platform\win10\verify.ps1' -ForegroundColor White
Write-Host 'Then start opencode from any project directory; OpenChamber with: openchamber serve'
Write-Host ''
