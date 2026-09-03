# AGENTS.md

## Project

Debian Bookworm Slim container deployed on Railway as a **remote dev container**. Access:
- **SSH** (primary, for VS Code Remote-SSH) on `$PORT`
- **opencode** headless server (HTTP, basic auth) on `4096` by default
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

- **`entrypoint.sh`** is the container's `CMD` (Dockerfile:62). It bootstraps the `/workspace` volume from baked config, sets the SSH port, injects `SSH_PUBLIC_KEY`, applies `PASSWORD`, starts `sshd`, conditionally starts ttyd, runs `/scripts/install-tools.sh` (app toolchain), then starts `opencode serve` in the background. It keeps the container alive with `exec tail -f /dev/null`.
- **`scripts/install-tools.sh`** (baked to `/scripts/install-tools.sh`) — idempotent dev-toolchain bootstrap run at every start: apt packages (ffmpeg/lsof/unzip/jq/build-essential/fonts), `uv` + Python 3.12, pnpm 11.22.0 via corepack, Doppler CLI, plus repair of a persisted `core/.venv` if present. Root-FS installs are wiped each redeploy, hence re-run on boot.
- **Persistence** is via the mounted Railway volume `/workspace`. `XDG_DATA_HOME=/workspace/.opencode/data` and `XDG_CONFIG_HOME=/workspace/.opencode/config` redirect **both opencode and magic-context** state (sessions db, auth, memories) to the volume so they survive restarts. `/root` is ephemeral.
- **Config bootstrap**: non-sensitive config is baked into the image at `/opt/opencode-config/` (copied from host global config). On start, `entrypoint.sh` syncs it into `$XDG_CONFIG_HOME`, **overwriting volume files whose content differs** (the baked config is the source of truth) — so image config updates propagate on redeploy. Layout mirrors the target: `opencode-config/opencode/` → `$XDG_CONFIG_HOME/opencode/` (opencode reads its global config from the XDG app subdir, NOT from `$XDG_CONFIG_HOME` root — a flat layout is silently ignored), `opencode-config/cortexkit/` → `$XDG_CONFIG_HOME/cortexkit/` (magic-context plugin reads XDG root directly).
- **opencode serve** runs with basic auth: user `opencode`, password `qingying` (override with `OPENCODE_SERVER_USERNAME`/`OPENCODE_SERVER_PASSWORD`), port `OPENCODE_PORT` (default 4096).

## Runtime env vars

`PORT` (SSH), `SSH_PORT`, `SSH_PUBLIC_KEY`, `PASSWORD`, `USERNAME` (ttyd), `TTYD_PORT`, `OPENCODE_PORT` (default 4096), `OPENCODE_SERVER_USERNAME` (default `opencode`), `OPENCODE_SERVER_PASSWORD` (default `qingying`). Also injected at start: `GIT_USER_NAME`/`GIT_USER_EMAIL` (git identity), `GITHUB_TOKEN`/`GITHUB_HOST` (git credential store), `DOPPLER_TOKEN` (doppler auto-auth), `NEON_API_KEY` (neon CLI), `EMBEDDING_API_KEY` (magic-context embeddings), `COMMANDCODE_API_KEY` (opencode commandcode provider). Edits must keep these names consistent.

## Dockerfile gotchas

- `ttyd` is pinned to `ttyd.x86_64` (Dockerfile:26) — x86_64 only. Fails on ARM builds; make arch-aware if ARM is ever needed.
- `EXPOSE $PORT` (Dockerfile:60) resolves at build time; set `PORT` as a build arg/env or Railway's default. opencode port `4096` is also EXPOSEd.
- `SSH_PUBLIC_KEY` is injected by `entrypoint.sh` each start (so a key survives restarts without a volume). Without it, only password login works (needs `PASSWORD`).
- `entrypoint.sh` must stay executable (`chmod +x`) and keep `set -e`.
- **Secrets are NOT in the image or repo**: `auth.json`/`account.json`/`opencode.db` (API keys, session history) are excluded from `opencode-config/`. Credentials must be provided at runtime via env vars or `opencode auth login`.

## Files

- `Dockerfile` — image definition.
- `entrypoint.sh` — runtime entrypoint (SSH + ttyd + opencode serve + volume bootstrap).
- `opencode-config/` — non-sensitive opencode + magic-context config, baked into the image, copied to the volume on first start. **Keep `.railwayignore` negations in sync** so its `*.md`/`assets` aren't stripped from the build context.
- `README.md` — project docs (Chinese) + Railway CLI doc entry.
- `docs/railway-cli.md` — generated Railway CLI reference (from docs.railway.com/cli). Keep in sync with official docs if the CLI version changes.
- `.railwayignore` — files excluded from `railway up` uploads, with negations for `opencode-config/**`.
- `assets/` — README images only.

## Railway networking

One service exposes one public port (`$PORT`, used by SSH). To reach the opencode server (4096), add a **second public port** in Railway → Service → Settings → Networking → TCP proxy, mapped to container port `4096`. Then opencode is at `https://<second-domain>.up.railway.app` with basic auth `opencode:qingying`.
