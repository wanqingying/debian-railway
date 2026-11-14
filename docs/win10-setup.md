# Agent stack on Windows 10

Same BD as the container (`versions/BD-INDEX.md`, currently `BD-004`), same config, no
KasmVNC/ttyd/tini. This branch (`win10-compat`) is `main` plus `platform/win10/`.

## What runs where

| Piece | Container | Windows 10 |
|---|---|---|
| `opencode` | `@opencode/cli@2.2.6` (npm) | same, npm — ships its own `opencode.exe`, no Node needed |
| OpenChamber | fork tarball `2.7.0`, `openchamber serve` | same tarball, same command |
| magic-context | `0.49.43` (plugin inside opencode) | same |
| codegraph | `1.6.2` | same, has `codegraph-win32-x64` |
| playwright | `1.65.0`, CDP attach | same; points at your local Chrome |
| lark-cli | `@larksuite/cli@1.0.99` | same; authorise per machine |
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
   - `-WorktreeRoot D:\gamedev\worktrees` overrides where worktrees go (default is that path).
   - `-SkipLark` skips `@larksuite/cli` and leaves the `lark-*` skills without a CLI.
5. Authorise the model provider, then reopen the shell:

   ```powershell
   opencode auth login            # opencode-go subscription (or sign in from OpenChamber); no env key exists for it
   setx EMBEDDING_API_KEY "<key>" # magic-context memory embeddings
   setx A6API_API_KEY "<key>"     # image_generate + the a6api models
   ```

6. `powershell -ExecutionPolicy Bypass -File platform\win10\verify.ps1`
7. `opencode` from any project directory; `openchamber serve` for the web UI.

`setup.ps1` installs five global packages at the BD pins and copies config to
`%USERPROFILE%\.config`:

```
.config\
  package.json            <- opencode-config/package.json (supplies @opencode/plugin types)
  opencode\
    opencode.jsonc        <- providers, plugins, mcp.servers (worktree.directory rewritten)
    AGENTS.md             <- platform/win10/AGENTS.win10.md (Windows edition)
    skills\               <- 11 skills, verbatim
    docs\                 <- the machine-level reference docs
    plugins\, lib\        <- sysinfo, session_search, image_gen
  cortexkit\
    magic-context.jsonc   <- memory layer config
```

Two rewrites happen during the copy, both deliberate: `AGENTS.md` is replaced by the Windows
edition, and `opencode.jsonc`'s `worktree.directory` moves from the container's
`/workspace/worktrees` to `-WorktreeRoot`. Everything else is byte-identical, so a change on
`main` propagates by copy.

Secrets are never copied: `auth.json`, `account.json` and `opencode.db` stay machine-local.
Copying a session database between the container and the laptop is not supported — two
writers on one `opencode.db` corrupt it, and magic-context's store sits beside it.

### Providers

The default model is `opencode-go/deepseek-v4.1-flash` — a subscription, so it is authorised
by `opencode auth login`, not by an environment variable. `a6api` and `gptge` are declared in
the same file and used for resale models and for `image_generate`; both run off a prepaid
balance, and `a6api`'s token only authorises `nano-banana-2.1` for images. `commandcode` is
disabled in the config (`disabled_providers`), so its key is not needed any more.

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
| OpenChamber starts, chat never answers | opencode missing or version mismatch | `verify.ps1`; reinstall `@opencode/cli@2.2.6` |
| Chat answers, then every turn fails with a schema error | magic-context and opencode out of step | the plugin version is pinned inside `opencode.jsonc`; re-run `setup.ps1` so the copy matches BD-004 |
| `openchamber` command not found after install | npm global bin not on PATH | add `%APPDATA%\npm` to `PATH` |
| installed with fnm / nvm-windows, commands missing after switching Node | global packages live inside the Node installation, not `%APPDATA%\npm` | `npm root -g` prints the real root; re-run `setup.ps1` after switching Node versions |
| `ERR_INVALID_PACKAGE_CONFIG` under `.config\opencode` | a stray `package.json` inside `opencode\` | delete it; the valid one lives in `.config\` (parent) |
| New worktree lands in `C:\workspace\worktrees` | the copied `opencode.jsonc` still has the container path | re-run `setup.ps1` (it rewrites `worktree.directory`); `verify.ps1` flags this |
| `image_generate` fails with `model_not_allowed` | the a6api token only authorises `nano-banana-2.1` | pass no model override; see `docs/a6api.md` |
| memory search silently empty | `EMBEDDING_API_KEY` unset | `setx EMBEDDING_API_KEY "<key>"`, reopen shell, restart opencode |
| Godot AI dock shows "server not running" | `uv` missing | `winget install astral-sh.uv`, then reopen the dock |
| MCP entry exists but the agent sees no tools | client not restarted after Configure | restart opencode |
| `pids`-like instability, editor spawning hundreds of processes | Defender scanning + asset import | add exclusions, retry |

## Syncing from `main`

```bash
git fetch origin main
git merge origin/main
```

Only `platform/win10/` is branch-only, so conflicts are rare. Three files carry a deliberate
branch-versus-`main` difference:

- `platform/win10/AGENTS.win10.md` — must be updated by hand whenever
  `opencode-config/opencode/AGENTS.md` changes on `main`; `verify.ps1` reports any shared
  heading that went missing.
- `opencode-config/opencode/lib/session-search.ts` — the `win32` branch in `resolveDbPath`
  lives here only (decided 2026-11-03: `main` keeps Linux-only resolution). When `main` turned
  the lib into TypeScript (2026-11-10) the patch was ported by hand, so the rule still holds:
  the difference is one function, and a conflict stays confined to it.
- `platform/win10/setup.ps1` / `verify.ps1` — the BD pins. Bump them in the same commit that
  bumps `versions/BD-INDEX.md`, otherwise the laptop silently runs a different stack.

Other than those, anything useful on both sides (a config key, a skill update) belongs on
`main` and is merged down.
