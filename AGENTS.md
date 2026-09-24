# AGENTS.md

## Project

Debian Bookworm Slim container deployed on Railway as a **remote dev container**. Access:
- **SSH** (primary, for VS Code Remote-SSH) on `$PORT`
- **OpenChamber** web UI (auto-manages an embedded **opencode** server) on `OPENCHAMBER_PORT` (`3001` by default)
- **opencode** headless server (HTTP, basic auth) on `OPENCODE_PORT` (`4096`), managed by OpenChamber, bound to `127.0.0.1`
- **ttyd** web-terminal (optional) on `$TTYD_PORT`

No build/test/lint toolchain — the Dockerfile + entrypoint script are the whole app.

## Commands

- Deploy to Railway: `railway up` (after `railway login` / linking). No local build or test step.
- Local build/test (from README):
  ```bash
  docker build -t debian-dev .
  docker run --rm -p 22:22 -p 4096:4096 \
    -v /tmp/ws:/workspace \
    -e SSH_PUBLIC_KEY="$(cat ~/.ssh/id_ed25519.pub)" \
    -e PORT=22 debian-dev
  ```
  (`-v /tmp/ws:/workspace` simulates the Railway volume so opencode state persists.)
- Railway CLI reference: `docs/railway-cli.md` (linked from README). Consult it before running CLI commands instead of guessing flags.

## Architecture

- **`entrypoint.sh`** is the container's `CMD` (Dockerfile:79). It bootstraps the `/workspace` volume from baked config, sets the SSH port, injects `SSH_PUBLIC_KEY`, applies `PASSWORD`, starts `sshd`, conditionally starts ttyd, runs `/scripts/install-tools.sh` (app toolchain), migrates a v1 opencode session db if present, then starts `openchamber serve` in the background (**which spawns its own embedded `opencode serve`** — opencode is not started separately). It keeps the container alive with `exec tail -f /dev/null`.
- **`scripts/install-tools.sh`** (baked to `/scripts/install-tools.sh`) — idempotent dev-toolchain bootstrap run at every start: apt packages (ffmpeg/lsof/unzip/jq/build-essential/fonts), `uv` + Python 3.12, pnpm 11.22.0 via corepack, Doppler CLI, Railway CLI, **OpenChamber** (`@openchamber/web@2.0.0`) + **OpenCode v2** (`@opencode/cli`), plus repair of a persisted `core/.venv` if present. Root-FS installs are wiped each redeploy, hence re-run on boot. OpenChamber and OpenCode versions must stay matched: OpenChamber 2.x requires OpenCode ≥2.0.15, and installing v1 `opencode-ai` makes OpenChamber report `Configured OpenCode binary not found` and run with no agent.
- **Persistence** is via the mounted Railway volume `/workspace`. `XDG_DATA_HOME=/workspace/.opencode/data` and `XDG_CONFIG_HOME=/workspace/.opencode/config` redirect **opencode and magic-context** state (sessions db, auth, memories), and `OPENCHAMBER_DATA_DIR=/workspace/.opencode/config/openchamber` redirects **OpenChamber's own** state (settings, preferences, projects, themes, managed chats) — OpenChamber otherwise defaults to `~/.config/openchamber`, which it does not move for `XDG_CONFIG_HOME`. `entrypoint.sh` then symlinks `~/.config/openchamber` to that directory so the few auxiliary writers that hardcode the default path (managed-process registry, telemetry install id) also persist. All of it survives restarts; `/root` is ephemeral.
- **Config bootstrap**: non-sensitive config is baked into the image at `/opt/opencode-config/` (copied from host global config). On start, `entrypoint.sh` syncs it into `$XDG_CONFIG_HOME`, **overwriting volume files whose content differs** (the baked config is the source of truth) — so image config updates propagate on redeploy. Layout mirrors the target: `opencode-config/opencode/` → `$XDG_CONFIG_HOME/opencode/` (opencode reads its global config from the XDG app subdir, NOT from `$XDG_CONFIG_HOME` root — a flat layout is silently ignored), `opencode-config/cortexkit/` → `$XDG_CONFIG_HOME/cortexkit/` (magic-context plugin reads XDG root directly).
- **OpenChamber serve** runs the web UI on `OPENCHAMBER_PORT` (default 3001, bound `0.0.0.0`, UI password from `OPENCHAMBER_UI_PASSWORD` falling back to `OPENCODE_SERVER_PASSWORD`). It manages an embedded **opencode serve** on `OPENCODE_PORT` (default 4096, bound `OPENCHAMBER_OPENCODE_HOSTNAME` default `127.0.0.1`), which keeps basic auth from the standard opencode envs: user `opencode`, password `qingying` (override with `OPENCODE_SERVER_USERNAME`/`OPENCODE_SERVER_PASSWORD`). OpenChamber proxies the opencode API through its own server.
- **OpenCode 2 / OpenChamber 2 upgrade notes** (applied 2026-09-24):
  - **Version pair**: `@openchamber/web@2.0.0` + `@opencode/cli` (v2). The v1 package `opencode-ai` is no longer installed anywhere. OpenChamber 2.x requires OpenCode ≥2.0.15 and will not fall back to v1.
  - **`opencode.jsonc` needs no rewrite**: OpenCode 2 still accepts the v1 config shape — `provider` with `npm`/`options`/`id`/`release_date`, plus `plugin`, `permission`, `autoupdate`, `watcher`, `mcp.<name>`. `kind=unsupported action="omitted unsupported legacy setting"` warnings may appear for a few retired keys, but the provider still activates (verified: a v1-shaped custom provider booted and answered).
  - **`CLAUDE.md` is ignored**: OpenCode 2 reads project instructions from `AGENTS.md` only. `opencode-config/` therefore ships no `CLAUDE.md`, and adding one would have no effect.
  - **Session db generation matters**: v1 dbs have `message`/`part` tables, v2 has `session_message`/`session_inbox`. The v2 core can still read a v1 db, but **magic-context refuses it** (`expected v2, found v1; refusing generation-specific database access`), which interrupts every turn silently (the UI only says "OpenCode interrupted this reply"). `entrypoint.sh` detects this via `node:sqlite` table names and renames the file to `opencode.db.v1-backup-<timestamp>` (keeping only the newest), so v2 recreates a fresh db. Both the core and the plugin hardcode the `opencode.db` filename, and the plugin ignores `OPENCODE_DB`, so relocating the db is not an option.

## Runtime env vars

`PORT` (SSH), `SSH_PORT`, `SSH_PUBLIC_KEY`, `PASSWORD`, `USERNAME` (ttyd), `TTYD_PORT`, `OPENCHAMBER_PORT` (default 3001), `OPENCHAMBER_UI_PASSWORD` (default `$OPENCODE_SERVER_PASSWORD`), `OPENCHAMBER_DATA_DIR` (baked to `/workspace/.opencode/config/openchamber`; OpenChamber's data/config root on the volume), `OPENCODE_PORT` (default 4096), `OPENCODE_SERVER_USERNAME` (default `opencode`), `OPENCODE_SERVER_PASSWORD` (default `qingying`). Also injected at start: `GIT_USER_NAME`/`GIT_USER_EMAIL` (git identity), `GITHUB_TOKEN`/`GITHUB_HOST` (git credential store), `DOPPLER_TOKEN` (doppler auto-auth), `NEON_API_KEY` (neon CLI), `EMBEDDING_API_KEY` (magic-context embeddings), `COMMANDCODE_API_KEY` (opencode commandcode provider). Edits must keep these names consistent.

## Dockerfile gotchas

- `ttyd` is pinned to `ttyd.x86_64` (Dockerfile:26) — x86_64 only. Fails on ARM builds; make arch-aware if ARM is ever needed.
- `EXPOSE $PORT` (Dockerfile:77) resolves at build time; set `PORT` as a build arg/env or Railway's default. openchamber port `3001` and opencode port `4096` are also EXPOSEd.
- `SSH_PUBLIC_KEY` is injected by `entrypoint.sh` each start (so a key survives restarts without a volume). Without it, only password login works (needs `PASSWORD`).
- `entrypoint.sh` must stay executable (`chmod +x`) and keep `set -e`.
- **Secrets are NOT in the image or repo**: `auth.json`/`account.json`/`opencode.db` (API keys, session history) are excluded from `opencode-config/`. Credentials must be provided at runtime via env vars or `opencode auth login`.

## Files

- `Dockerfile` — image definition.
- `entrypoint.sh` — runtime entrypoint (SSH + ttyd + OpenChamber-serve + volume bootstrap).
- `opencode-config/` — non-sensitive opencode + magic-context config, baked into the image, copied to the volume on first start. **Keep `.railwayignore` negations in sync** so its `*.md`/`assets` aren't stripped from the build context.
- `opencode-config/opencode/tools/sysinfo.ts` + `opencode-config/opencode/lib/sysinfo.js` — global opencode custom tool `sysinfo` so any agent can probe the current date/time and timezone, OS/distro/kernel/shell/user/locale, container/CI/railway flags, CPU/memory/disk, the active Python venv, and the installed developer tools with versions. Single compact JSON shape (no detail levels); tool probes are cached 5 min. The `.ts` is a thin `tool()` wrapper; the dependency-free `.js` holds the logic and also runs directly (`node lib/sysinfo.js`). Reads only whitelisted non-sensitive values.
- `README.md` — project docs (Chinese) + Railway CLI doc entry.
- `docs/railway-cli.md` — generated Railway CLI reference (from docs.railway.com/cli). Keep in sync with official docs if the CLI version changes.
- `.railwayignore` — files excluded from `railway up` uploads, with negations for `opencode-config/**`.
- `assets/` — README images only.

## Railway networking

One service exposes one public port (`$PORT`, used by SSH). To reach the OpenChamber web UI (3001), add a **second public port** in Railway → Service → Settings → Networking → TCP proxy, mapped to container port `3001`. Then OpenChamber is at `https://<second-domain>.up.railway.app` (UI password from `OPENCHAMBER_UI_PASSWORD`, default `qingying`). The embedded opencode server (4096) stays on `127.0.0.1` and is proxied through OpenChamber — do not expose it directly.
