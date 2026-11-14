#Requires -Version 5.1
<#
.SYNOPSIS
    Read-only health check for the agent stack on Windows 10.

.DESCRIPTION
    Prints one PASS/FAIL line per signal and exits non-zero if any FAIL fires.
    Nothing is modified, so it is safe to run at any time.

    The two signals that decide real portability questions:
      * opencode's data directory  -> does the session_search plugin need a win32 branch?
      * magic-context's store      -> is the memory layer actually persisting?

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File platform\win10\verify.ps1
#>
[CmdletBinding()]
param([string]$RepoRoot)

# Same Windows PowerShell 5.1 quirk as setup.ps1: param defaults are evaluated
# before $PSScriptRoot exists, so resolve the repo root after binding.
if (-not $RepoRoot) {
    $scriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
    $RepoRoot = (Resolve-Path (Join-Path $scriptDir '..\..')).Path
}

$script:failures = 0
$script:warnings = 0

function Check([string]$name, [scriptblock]$test) {
    try {
        $result = & $test
        if ($result -is [array]) { $detail = $result[1]; $result = $result[0] }
        else { $detail = $result }
        if ($result) {
            Write-Host ('PASS  {0,-34} {1}' -f $name, $detail) -ForegroundColor Green
            return
        }
        Write-Host ('FAIL  {0,-34} {1}' -f $name, $detail) -ForegroundColor Red
        $script:failures++
        return
    } catch {
        Write-Host ('FAIL  {0,-34} {1}' -f $name, $_.Exception.Message) -ForegroundColor Red
        $script:failures++
        return
    }
}

function Note([string]$name, [string]$detail) {
    Write-Host ('INFO  {0,-34} {1}' -f $name, $detail) -ForegroundColor DarkGray
}

function Warn([string]$name, [string]$detail) {
    Write-Host ('WARN  {0,-34} {1}' -f $name, $detail) -ForegroundColor Yellow
    $script:warnings++
}

Write-Host ''
Write-Host 'agent stack on Windows 10 - verification' -ForegroundColor White
Write-Host ('host: {0}  powershell: {1}' -f $env:COMPUTERNAME, $PSVersionTable.PSVersion)
Write-Host ''

# --- runtime ----------------------------------------------------------------
Check 'node >= 24.14' {
    $raw = (node -v).Trim()
    $v = [version]($raw.TrimStart('v'))
    @(($v -ge [version]'24.14.0'), $raw)
}

Check 'opencode on PATH' {
    $raw = (opencode --version 2>$null | Out-String).Trim()
    @([bool]$raw, $raw)
}

Check 'openchamber on PATH' {
    $raw = (Get-Command openchamber -ErrorAction SilentlyContinue)
    @([bool]$raw, $(if ($raw) { $raw.Source } else { 'not found - run setup.ps1' }))
}

Check 'BD pins installed' {
    # cmd + flatten first: PowerShell feeds native output line by line, which
    # breaks ConvertFrom-Json on npm's multi-line pretty JSON (PS 5.1 also
    # becomes an error record at a redirected stderr line).
    $raw = (cmd /c 'npm ls -g --depth=0 --json 2>nul') -join "`n"
    $tree = $raw | ConvertFrom-Json
    $want = @(
        @('@opencode/cli', '2.2.6'),
        @('@openchamber/web', '2.7.0'),
        @('@colbymchenry/codegraph', '1.6.2'),
        @('playwright', '1.65.0'),
        @('@larksuite/cli', '1.0.99')
    )
    $bad = @()
    foreach ($pair in $want) {
        $name = $pair[0]
        $have = $tree.dependencies.$name.version
        if (-not $have) { $bad += "$name missing" }
        elseif ($have -ne $pair[1]) { $bad += "$name $have != $($pair[1])" }
    }
    if ($bad.Count -gt 0) { @($false, ($bad -join '; ')) } else { @($true, "$($want.Count)/$($want.Count) match BD-004") }
}

# --- config -----------------------------------------------------------------
$configHome = Join-Path $env:USERPROFILE '.config'

Check 'opencode.jsonc installed' {
    $p = (Join-Path (Join-Path $configHome 'opencode') 'opencode.jsonc')
    @((Test-Path $p), $p)
}

Check 'magic-context.jsonc installed' {
    $p = (Join-Path (Join-Path $configHome 'cortexkit') 'magic-context.jsonc')
    @((Test-Path $p), $p)
}

Check 'global AGENTS.md installed' {
    $p = (Join-Path (Join-Path $configHome 'opencode') 'AGENTS.md')
    @((Test-Path $p), $p)
}

Check 'plugins present' {
    $dir = (Join-Path (Join-Path $configHome 'opencode') 'plugins')
    $found = @(Get-ChildItem $dir -Directory -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name)
    @(($found.Count -ge 2), ($found -join ', '))
}

Check 'secrets .env present' {
    $p = (Join-Path (Join-Path $configHome 'opencode') '.env')
    @((Test-Path -LiteralPath $p), $p)
}

# A warning, not a failure: a key can legitimately live in auth.json (stored with
# `opencode auth login`) instead of the .env file.
$missingKeys = @('EMBEDDING_API_KEY', 'A6API_API_KEY') | Where-Object { -not (Test-Path "env:$_") }
if ($missingKeys.Count -gt 0) {
    Warn 'keys in this session' (($missingKeys -join ', ') + ' - fill .env and open a new shell, or store the provider key with `opencode auth login`')
} else {
    Note 'keys in this session' 'EMBEDDING_API_KEY, A6API_API_KEY present'
}

# --- the two decisions that matter -----------------------------------------
$localShareDb = (Join-Path (Join-Path (Join-Path (Join-Path $env:USERPROFILE '.local') 'share') 'opencode') 'opencode.db')
$appDataDb    = (Join-Path (Join-Path $env:LOCALAPPDATA 'opencode') 'opencode.db')

if (Test-Path $localShareDb) {
    Check 'session_search db path' { @($true, $localShareDb) }
    Note 'win32 branch needed? No - opencode uses ~/.local/share here, exactly as session-search assumes'
} elseif (Test-Path $appDataDb) {
    Check 'session_search db path' { @($false, "%LOCALAPPDATA%\opencode\opencode.db") }
    Note 'win32 branch needed? yes - port resolveDbPath in opencode-config/opencode/lib/session-search.ts'
} else {
    Check 'session_search db path' { @($false, 'no opencode.db yet - start opencode once, then re-run') }
    Note 'the db appears after the first session is created; this is not a failure of the install'
}

$mcStore = (Join-Path (Join-Path (Join-Path (Join-Path (Join-Path $env:USERPROFILE '.local') 'share') 'cortexkit') 'magic-context') 'context.db')
if (Test-Path $mcStore) {
    Check 'magic-context store' { @($true, $mcStore) }
} else {
    Check 'magic-context store' { @($false, 'missing - storage may be under %LOCALAPPDATA%\cortexkit') }
    Note 'run: Get-ChildItem -Recurse $env:USERPROFILE,$env:LOCALAPPDATA -Filter context.db -ErrorAction SilentlyContinue'
}

# --- project wiring ---------------------------------------------------------
Check 'godot-ai mcp entry' {
    $p = (Join-Path (Join-Path $configHome 'opencode') 'opencode.jsonc')
    if (-not (Test-Path $p)) { return @($false, 'no config') }
    $hit = Select-String -Path $p -Pattern 'godot-ai' -SimpleMatch -Quiet
    @($hit, $(if ($hit) { 'present' } else { 'absent - enable the addon and press Configure in its dock' }))
}

Check 'codegraph mcp entry' {
    $p = (Join-Path (Join-Path $configHome 'opencode') 'opencode.jsonc')
    if (-not (Test-Path $p)) { return @($false, 'no config') }
    $hit = Select-String -Path $p -Pattern 'codegraph' -SimpleMatch -Quiet
    @($hit, $(if ($hit) { 'present' } else { 'absent' }))
}

Check 'worktree root rewritten' {
    $p = (Join-Path (Join-Path $configHome 'opencode') 'opencode.jsonc')
    if (-not (Test-Path $p)) { return @($false, 'no config') }
    $hit = Select-String -Path $p -Pattern '/workspace/worktrees' -SimpleMatch -Quiet
    @((-not $hit), $(if ($hit) { 'still the container path - re-run setup.ps1' } else { 'no /workspace path' }))
}

# --- drift check ------------------------------------------------------------
# Only the shared sections are comparable. The environment-specific headings are
# deliberately different per machine, so they are excluded; a new *rule* section on
# main therefore still trips this, which is the failure worth catching.
$containerOnly = @(
    '## Filesystem: only `/workspace` survives a redeploy',
    '## 浏览器',
    '## 飞书 / Lark'
)
$mainAgents = (Join-Path (Join-Path (Join-Path $RepoRoot 'opencode-config') 'opencode') 'AGENTS.md')
$winAgents  = Join-Path $PSScriptRoot 'AGENTS.win10.md'
if ((Test-Path $mainAgents) -and (Test-Path $winAgents)) {
    $mainHeadings = Select-String -Path $mainAgents -Pattern '^## ' | ForEach-Object { $_.Line.Trim() } |
        Where-Object { $containerOnly -notcontains $_ }
    $winHeadings  = Select-String -Path $winAgents  -Pattern '^## ' | ForEach-Object { $_.Line.Trim() }
    $missing = $mainHeadings | Where-Object { $winHeadings -notcontains $_ }
    if ($missing.Count -gt 0) {
        Warn 'AGENTS.win10.md drift' ('missing sections: ' + ($missing -join ', '))
    } else {
        Note 'AGENTS.win10.md drift' 'shared sections in sync with main'
    }
}

Write-Host ''
if ($script:failures -eq 0) {
    Write-Host "ALL PASS  ($($script:warnings) warning(s))" -ForegroundColor Green
    exit 0
}
Write-Host "$($script:failures) FAILED  ($($script:warnings) warning(s))" -ForegroundColor Red
exit 1
