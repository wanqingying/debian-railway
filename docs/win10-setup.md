# Agent stack on Windows 10

Same BD as the container (`versions/BD-INDEX.md`, currently `BD-002`), same config, no
KasmVNC/ttyd/tini. This branch (`win10-compat`) is `main` plus `platform/win10/`.

## What runs where

| Piece | Container | Windows 10 |
|---|---|---|
| `opencode` | `@opencode/cli@2.2.5` (npm) | same, npm — ships its own `opencode.exe`, no Node needed |
| OpenChamber | fork tarball, `openchamber serve` | same tarball, same command |
| magic-context | plugin inside opencode | same |
| codegraph | `1.6.2` | same, has `codegraph-win32-x64` |
| playwright | `1.64.1`, CDP attach | same; points at your local Chrome |
| ttyd / KasmVNC / tini | required | **not installed, not needed** |
| Godot + `godot-ai` MCP | not used | the reason this machine exists |

## Hard requirements

- **Node.js ≥ 24.14.0** — `@openchamber/web`'s `engines` field. Node 22 does not work.
- **Git for Windows** — OpenChamber's worktree features shell out to `git`.
- **A local fixed disk** — no OneDrive, no network drive, no `\\wsl.localhost` path.

## Install order

1. `winget install OpenJS.NodeJS.LTS` (or nvm-windows), then **reopen the shell**.
2. `winget install Git.Git`
3. Copy this repo to `D:\gamedev\debian-railway` (any local path).
4. `powershell -ExecutionPolicy Bypass -File platform\win10\setup.ps1`
5. Set the two keys, then reopen the shell:

   ```powershell
   setx COMMANDCODE_API_KEY "<key>"
   setx EMBEDDING_API_KEY "<key>"
   ```

6. `powershell -ExecutionPolicy Bypass -File platform\win10\verify.ps1`
7. `opencode` from any project directory; `openchamber serve` for the web UI.

`setup.ps1` installs four global packages at the BD pins and copies config to
`%USERPROFILE%\.config`:

```
.config\
  package.json            <- opencode-config/package.json (supplies @opencode/plugin types)
  opencode\
    opencode.jsonc        <- providers, plugins, mcp.servers
    AGENTS.md             <- platform/win10/AGENTS.win10.md (Windows edition)
    skills\               <- 8 skills, verbatim
    plugins\, lib\        <- sysinfo + session_search
  cortexkit\
    magic-context.jsonc   <- memory layer config
```

Secrets are never copied: `auth.json`, `account.json` and `opencode.db` stay machine-local.
Copying a session database between the container and the laptop is not supported — two
writers on one `opencode.db` corrupt it, and magic-context's store sits beside it.

## Godot

1. Portable build to `D:\gamedev\tools\godot-4.7.2\`. No installer, no PATH change.
2. `addons/godot_ai/` from the [godot-ai release](https://github.com/hi-godot/godot-ai/releases)
   into your Godot project. **Never extract over an existing `addons/godot_ai/`.**
3. Project → Project Settings → Plugins → enable *Godot AI*.
4. In the Godot AI dock press **Configure** next to OpenCode. It writes the `mcp` entry with
   the right version pin and port; hand-copied `uvx` lines cannot authenticate in v4.
5. Trim the tool surface — 47 tools is more than a model chooses well:

   ```
   --exclude-domains animation,audio,csg,gridmap,material,particle,signals,theme,tilemap,tileset,navigation
   ```

   Start with `editor, scene, node, script, game, project` and add back what you miss.

Windows-specific setup that is easy to forget:

- **Defender exclusions** for the project folder, the Godot folder and `%LOCALAPPDATA%\Godot`.
  Without them the first import of a few thousand assets is several times slower.
- **`.gitattributes`** (in this branch) keeps `.tscn`/`.tres` at LF. A CRLF checkout makes
  Godot rewrite every scene into a full-file diff.

## The two measurements that decide portability

`verify.ps1` prints both, so they cannot be skipped:

| Signal | What it means |
|---|---|
| Which `opencode.db` exists: `%USERPROFILE%\.local\share\...` or `%LOCALAPPDATA%\...` | `session_search` resolves `XDG_DATA_HOME` → `~/.local/share` → `%LOCALAPPDATA%` (this branch). If the first one exists, the win32 branch is inert. |
| `cortexkit\magic-context\context.db` present | memory layer is persisting. If it is missing after a session, storage resolved somewhere else — find it with `Get-ChildItem -Recurse $env:USERPROFILE,$env:LOCALAPPDATA -Filter context.db` |

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `npm i -g` fails with `EBADENGINE` | Node < 24.14 | upgrade Node, reopen shell |
| OpenChamber starts, chat never answers | opencode missing or version mismatch | `verify.ps1`; reinstall `@opencode/cli@2.2.5` |
| `openchamber` command not found after install | npm global bin not on PATH | add `%APPDATA%\npm` to `PATH` |
| `ERR_INVALID_PACKAGE_CONFIG` under `.config\opencode` | a stray `package.json` inside `opencode\` | delete it; the valid one lives in `.config\` (parent) |
| Godot AI dock shows "server not running" | `uv` missing | `winget install astral-sh.uv`, then reopen the dock |
| MCP entry exists but the agent sees no tools | client not restarted after Configure | restart opencode |
| `pids`-like instability, editor spawning hundreds of processes | Defender scanning + asset import | add exclusions, retry |

## Syncing from `main`

```bash
git fetch origin main
git merge origin/main
```

Only `platform/win10/` is branch-only, so conflicts are rare. Two files carry a deliberate
branch-versus-`main` difference:

- `platform/win10/AGENTS.win10.md` — must be updated by hand whenever
  `opencode-config/opencode/AGENTS.md` changes on `main`; `verify.ps1` reports any heading that
  went missing.
- `opencode-config/opencode/lib/session-search.js` — the `win32` branch in `resolveDbPath` lives
  here only (decided 2026-11-03: `main` keeps Linux-only resolution). If `main` ever rewrites
  that function, the conflict is confined to it.

Other than those two, anything useful on both sides (a config key, a skill update) belongs on
`main` and is merged down.
