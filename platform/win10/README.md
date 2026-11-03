# platform/win10 — Windows 10 overlay

This directory holds everything that exists **only** for running the agent stack on a
native Windows 10 machine. `main` stays the Linux/Railway container; this branch
(`win10-compat`) is `main` + this overlay.

## Why an overlay instead of a fork

The two environments share almost everything: `opencode.jsonc`, `magic-context.jsonc`,
the eight skills, the two local plugins, the BD version pins. Only four things differ:

| Difference | Where it lives here |
|---|---|
| No KasmVNC / ttyd / tini | documented in `docs/win10-setup.md`; nothing to install |
| No `wt` wrapper (worktrees are plain `git worktree` on `D:`) | `AGENTS.win10.md` |
| Global agent rules without container-only commands | `AGENTS.win10.md` (installed as the global `AGENTS.md`) |
| Bootstrap is PowerShell, not `entrypoint.sh` | `setup.ps1` / `verify.ps1` |

Everything else is copied verbatim from the repo, so a `main` update propagates by copy.

## Sync procedure

```bash
git fetch origin main
git merge origin/main
```

The merge surface is deliberately tiny:

- **New files only** under `platform/win10/` → never conflicts, `main` never touches them.
- **One additive code edit** in `opencode-config/opencode/lib/session-search.js`
  (a `win32` branch in `resolveDbPath`). That edit is harmless on Linux, so it should be
  cherry-picked into `main` and then the branch carries no shared-file diff at all.
- **`AGENTS.win10.md` must be re-synced by hand** whenever `opencode-config/opencode/AGENTS.md`
  changes on `main`. `verify.ps1` reports the diff so this cannot be forgotten silently.

Rule of thumb: if a change benefits both environments, land it on `main` first and merge
down. Only genuinely Windows-only work goes on this branch.

## Files

| File | Purpose |
|---|---|
| `setup.ps1` | Idempotent bootstrap: version checks, global npm installs, config copy |
| `verify.ps1` | Read-only health check: prints PASS/FAIL per signal and exits non-zero on failure |
| `AGENTS.win10.md` | Global agent instructions for Windows (installed as `~/.config/opencode/AGENTS.md`) |
| `../../docs/win10-setup.md` | Human runbook: what to install, in what order, and why |

## Version pins

The Windows machine must run the **same BD** as the container (see `versions/BD-INDEX.md`).
`setup.ps1` hard-codes the pins from `BD-002`; bump them in the same commit that bumps the BD.
