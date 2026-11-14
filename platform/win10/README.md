# platform/win10 — Windows 10 overlay

This directory holds everything that exists **only** for running the agent stack on a
native Windows 10 machine. `main` stays the Linux/Railway container; this branch
(`win10-compat`) is `main` + this overlay.

## Why an overlay instead of a fork

The two environments share almost everything: `opencode.jsonc`, `magic-context.jsonc`,
the skills, the machine-level docs, the local plugins, the BD version pins. Only five
things differ:

| Difference | Where it lives here |
|---|---|
| No KasmVNC / ttyd / tini | documented in `docs/win10-setup.md`; nothing to install |
| No `wt` wrapper (worktrees are plain `git worktree` on `D:`) | `AGENTS.win10.md` |
| Global agent rules without container-only commands | `AGENTS.win10.md` (installed as the global `AGENTS.md`) |
| `worktree.directory` must not be `/workspace/worktrees` | `setup.ps1` rewrites that one value in the copied `opencode.jsonc` |
| Bootstrap is PowerShell, not `entrypoint.sh` | `setup.ps1` / `verify.ps1` |

Everything else is copied verbatim from the repo, so a `main` update propagates by copy.

## Sync procedure

```bash
git fetch origin main
git merge origin/main
```

The merge surface is deliberately tiny:

- **New files only** under `platform/win10/` → never conflicts, `main` never touches them.
- **One additive code edit** in `opencode-config/opencode/lib/session-search.ts`
  (a `win32` branch in `resolveDbPath`). It is harmless on Linux, but it stays on this
  branch by decision (2026-11-03): `main` keeps the Linux-only path resolution, so the two
  environments differ in exactly one function and a merge conflict, if one ever appears,
  is confined to it. The `main` rewrite of that file into TypeScript (2026-11-10) deleted
  the `.js` and re-created the file, so the patch was ported by hand once; after that the
  merge is ordinary.
- **`AGENTS.win10.md` must be re-synced by hand** whenever `opencode-config/opencode/AGENTS.md`
  changes on `main`. `verify.ps1` reports any *shared* heading that went missing, so a new rule
  section cannot be skipped silently. The environment-specific headings are excluded on
  purpose, since they describe different machines.
- **BD pins** in `setup.ps1` / `verify.ps1` — the same commit that bumps
  `versions/BD-INDEX.md` must bump them, or the laptop runs a different stack.

Rule of thumb: if a change benefits both environments, land it on `main` first and merge
down. Only genuinely Windows-only work goes on this branch.

## Files

| File | Purpose |
|---|---|
| `setup.ps1` | Idempotent bootstrap: version checks, global npm installs at the BD pins, config copy + the two rewrites |
| `verify.ps1` | Read-only health check: prints PASS/FAIL per signal and exits non-zero on failure |
| `AGENTS.win10.md` | Global agent instructions for Windows (installed as `~/.config/opencode/AGENTS.md`) |
| `../../docs/win10-setup.md` | Human runbook: what to install, in what order, and why |

## Version pins

The Windows machine runs the **same BD** as the container (see `versions/BD-INDEX.md`);
`setup.ps1` hard-codes those pins, currently from `BD-004`:

| Package | Version |
|---|---|
| `@opencode/cli` | 2.2.6 |
| `@openchamber/web` | 2.7.0 (fork tarball, 2nd patch) |
| `@colbymchenry/codegraph` | 1.6.2 |
| `playwright` | 1.65.0 |
| `@larksuite/cli` | 1.0.99 |

`magic-context` is not an npm global: it is the plugin spec inside `opencode.jsonc`
(`0.49.43`), so it follows the config copy.
