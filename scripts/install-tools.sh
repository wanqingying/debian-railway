#!/usr/bin/env bash
#
# scripts/install-tools.sh — idempotent dev-toolchain bootstrap for the dev container.
#
# WHY THIS EXISTS
#   The dev container is ephemeral: anything installed outside the persistent /workspace volume is
#   wiped on every redeploy (the root filesystem is not persisted). This script re-installs the whole
#   toolchain at container start. It is idempotent and safe to re-run at any time.
#
# WHAT IT INSTALLS (tools only — see "NOT handled here" below)
#   System packages (apt): ffmpeg · lsof · unzip · jq · build-essential · fontconfig + fonts-liberation
#   uv                -> /usr/local/bin        (Python package + interpreter manager)
#   Python 3.12       -> uv-managed            (repo requires >=3.12; system python3 is 3.11)
#   pnpm              -> corepack, pinned 11.22.0
#   Doppler CLI       -> official apt installer (v3.76.5), auto-authenticated via DOPPLER_TOKEN
#   Neon CLI          -> npm (neonctl), authenticated natively via NEON_API_KEY env var
#   Railway CLI      -> npm (@railway/cli), auth via RAILWAY_API_TOKEN / browserless login
#   OpenChamber      -> npm (@openchamber/web), web UI that manages its own OpenCode server
#   OpenCode CLI     -> npm (@opencode/cli), the v2 `opencode` binary OpenChamber drives
#   book-to-skill    -> PDF extractors for the baked book-to-skill skill: poppler-utils (apt) +
#                       pypdf/pdfminer.six (pip). docling (technical/tables mode) is intentionally omitted.
#
# NOT HANDLED HERE (per-developer, interactive — keep out of the startup script)
#   - Doppler token:  set DOPPLER_TOKEN env var -> auto-configured below (no interactive login)
#   - Neon key:       set NEON_API_KEY env var   -> used natively by the CLI (no login step)
#   - Repo bootstrap:scripts/setup.sh            (env-pull + dev branch + uv sync + pnpm install + migrate)
#   - Server start:   ./dev all                  (app :3000 / graph :2025, per-worktree ports)
#
# Expected runtime versions (verified on the current dev container):
#   Node v24.19.0 · Debian 12 (bookworm) · uv 0.12.5 · Python 3.12.14 · pnpm 11.22.0 · Doppler 3.76.5
#
# Usage:
#   scripts/install-tools.sh          # from the repo root (needs root; the container runs as root)
#   scripts/install-tools.sh --skip-venv   # skip the core/venv repair step (faster, if already done)
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
log() { printf '→ %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

SKIP_VENV=0
[ "${1:-}" = "--skip-venv" ] && SKIP_VENV=1

[ "$(id -u)" -eq 0 ] || die "must run as root (the dev container runs as root)"

# ── 1. System packages ──────────────────────────────────────────────────────────
# ffmpeg          : required by the LangGraph runtime (core/langgraph.json) + media pipeline
# lsof            : required by `./dev` preflight and `./dev stop` (port detection)
# unzip           : used by a few tool installers
# jq              : JSON parsing in shell helpers
# build-essential : source-built Python deps (e.g. forbiddenfruit) compile against it
# poppler-utils   : pdftotext for the baked book-to-skill skill (PDF text extraction)
# fontconfig + fonts-liberation : font rendering for overlay/render workers
log "1/5 system packages (apt)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y --no-install-recommends \
  ffmpeg lsof unzip jq \
  build-essential \
  poppler-utils \
  fontconfig fonts-liberation \
  ca-certificates curl wget git \
  >/dev/null
apt-get clean
rm -rf /var/lib/apt/lists/*

# ── 2. uv + Python 3.12 ─────────────────────────────────────────────────────────
# uv self-installs to /usr/local/bin (root-FS; reinstalled each boot). Its managed pythons live
# under the uv data dir, which follows $HOME — on this container $HOME sits in the persistent
# /workspace volume, so an already-installed 3.12 survives redeploys and this step is a no-op.
log "2/5 uv"
if ! command -v uv >/dev/null 2>&1; then
  curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin sh
fi

log "3/5 Python 3.12"
uv python install 3.12   # idempotent: skips if already managed
# Expose the uv-managed interpreter on PATH as python3.12 (uv's managed pythons are NOT on PATH by
# default). /usr/local/bin is root-FS, so the symlink is recreated on every boot.
ln -sf "$(uv python find 3.12)" /usr/local/bin/python3.12

# ── 3. pnpm (pinned, via corepack) ──────────────────────────────────────────────
# corepack shims live in the node bin dir (root-FS; re-enabled each boot). The pinned version is
# downloaded on first use and cached in corepack's cache (HOME-based -> persistent volume).
log "4/5 pnpm"
corepack enable pnpm
corepack prepare pnpm@11.22.0 --activate

# ── 4. Doppler CLI ──────────────────────────────────────────────────────────────
log "5/5 Doppler CLI"
if ! command -v doppler >/dev/null 2>&1; then
  curl -Ls https://cli.doppler.com/install.sh | sh
fi

# ── Doppler auto-auth via DOPPLER_TOKEN ─────────────────────────────────────────
# Headless containers can't run `doppler login` (browser). If DOPPLER_TOKEN is set
# (Service Token dp.st.* or personal dp.pt.*), configure it so `doppler run` etc.
# work without further interaction. Skip silently if unset (user logs in later).
if [ -n "${DOPPLER_TOKEN:-}" ]; then
  log "configuring doppler token from DOPPLER_TOKEN"
  echo "$DOPPLER_TOKEN" | doppler configure set token --scope / >/dev/null
fi

# ── 5. Neon CLI ─────────────────────────────────────────────────────────────────
# neonctl (alias `neon`) — Serverless Postgres project/branch/db management.
# The CLI authenticates natively via the NEON_API_KEY env var (no configure step
# needed, unlike doppler): credential order is --api-key > NEON_API_KEY >
# credentials.json (from `neon auth`) > interactive web.
log "Neon CLI"
if ! command -v neon >/dev/null 2>&1; then
  npm install -g neon >/dev/null \
    || log "warning: neon CLI install failed (continuing)"
fi
if [ -n "${NEON_API_KEY:-}" ]; then
  log "neon: NEON_API_KEY present (used natively by the CLI, no login needed)"
fi

# ── Railway CLI ───────────────────────────────────────────────────────────────
# @railway/cli ships a postinstall script, so npm 11 (allow-scripts) needs the
# --allow-scripts flag. Installed per boot because /usr/local (npm global) is
# wiped on redeploy. Auth is via `railway login --browserless` or RAILWAY_API_TOKEN.
log "Railway CLI"
if ! command -v railway >/dev/null 2>&1; then
  npm install -g --allow-scripts=@railway/cli @railway/cli >/dev/null \
    || log "warning: Railway CLI install failed (continuing)"
fi

# ── OpenChamber (web UI for OpenCode) + OpenCode v2 ───────────────────────────
# @openchamber/web has no postinstall script; plain npm i -g works. Requires
# Node >=22 (image ships Node 24). It manages its own embedded OpenCode server
# (spawns `opencode serve` on $OPENCODE_PORT) and reads the standard
# OPENCODE_SERVER_USERNAME/PASSWORD envs for that server's auth, so the
# existing opencode config carries over unchanged. Installed per boot because
# /usr/local (npm global) is wiped on redeploy.
#
# Version pair: OpenChamber 2.0.0 requires OpenCode 2.0.15+. Its dependency
# @openchamber/sdk@2.0.0 IS published (the 1.24.0-era ETARGET that forced the old
# 1.23.2 pin is gone), so the pin can move. Keep both pins in lockstep — a
# mismatched pair degrades the web UI instead of failing loudly.
# OpenCode is pinned to 2.0.15: 2.0.16 regresses user prompt image attachments —
# the media content part fails internal `Media.Asset` schema validation in
# SessionModelRequest.prepare, so SessionRunner.drain aborts and the UI shows
# only "OpenCode stopped this reply". Verified 2026-09-25: 2.0.16 fails for every
# provider/model, 2.0.15 handles the same image normally. Do not float this pin
# to latest until upstream ships a fix.
# Install failure is non-fatal so a broken upstream release can't take down SSH;
# the web UI is just skipped (entrypoint.sh already guards on `command -v openchamber`).
OPENCHAMBER_VERSION=2.0.0
log "OpenChamber ${OPENCHAMBER_VERSION}"
if ! command -v openchamber >/dev/null 2>&1; then
  npm install -g "@openchamber/web@${OPENCHAMBER_VERSION}" >/dev/null \
    || log "warning: OpenChamber install failed (continuing without web UI)"
fi

# ── OpenCode v2 CLI ───────────────────────────────────────────────────────────
# OpenChamber 2.x drives OpenCode 2.x and will not use v1: with `opencode-ai`
# installed it reports "Configured OpenCode binary not found" and runs without an
# agent. `@opencode/cli` installs the v2 `opencode` binary that OpenChamber finds
# on PATH. Its postinstall script downloads the platform binary, so npm 11 needs
# --allow-scripts (same reason as @railway/cli below).
# Installed per boot because /usr/local (npm global) is wiped on redeploy.
OPENCODE_VERSION=2.0.15
log "OpenCode CLI (v2) ${OPENCODE_VERSION}"
if ! command -v opencode >/dev/null 2>&1; then
  npm install -g --allow-scripts=@opencode/cli "@opencode/cli@${OPENCODE_VERSION}" >/dev/null \
    || log "warning: opencode CLI install failed (continuing without AI agent)"
fi

# ── book-to-skill PDF extractors ─────────────────────────────────────────────────
# The baked book-to-skill skill (opencode-config/opencode/skills/book-to-skill) runs
# scripts/extract.py, which needs a PDF text extractor. poppler's pdftotext (apt, step 1)
# is fastest and preferred; pypdf / pdfminer.six are Python fallbacks. Python packages
# install into the root FS (wiped on redeploy) -> reinstall per boot. Debian's python3 is
# PEP 668 externally-managed, hence --break-system-packages. docling (better tables/code
# for `--mode technical`) is deliberately NOT installed: it is large and slow to install.
log "book-to-skill PDF extractors"
if ! python3 -c 'import pypdf, pdfminer' >/dev/null 2>&1; then
  pip3 install --break-system-packages --quiet pypdf pdfminer.six
fi

# ── repair the persisted venv against this boot's interpreter ────────────────────
# core/.venv lives in the persistent workspace and survives redeploys, but its pyvenv.cfg may point
# at a python path that no longer exists. `uv sync` recreates/repairs it (idempotent; a no-op when
# nothing changed). node_modules (vercel) needs no repair — pnpm resolves it from the lockfile.
if [ "$SKIP_VENV" = 0 ] && [ -f "$REPO_ROOT/core/pyproject.toml" ]; then
  log "repairing core/.venv (uv sync)"
  ( cd "$REPO_ROOT/core" && uv sync --python 3.12 )
fi

# ── smoke test ────────────────────────────────────────────────────────────────────
log "verifying toolchain"
for tool in uv python3.12 pnpm doppler pdftotext; do
  command -v "$tool" >/dev/null 2>&1 || die "$tool missing after install"
done
for tool in neon railway openchamber; do
  command -v "$tool" >/dev/null 2>&1 || log "warning: $tool missing (optional)"
done
command -v opencode >/dev/null 2>&1 || log "warning: opencode CLI missing (optional; OpenChamber needs it for its agent)"
printf 'uv        %s\n' "$(uv --version)"
printf 'python    %s\n' "$(uv run --project "$REPO_ROOT/core" python --version 2>/dev/null || uv python find 3.12)"
printf 'pnpm      %s\n' "$(pnpm --version)"
printf 'doppler   %s\n' "$(doppler --version)"
printf 'neon      %s\n' "$(neon --version 2>/dev/null || echo installed)"
printf 'railway   %s\n' "$(railway --version 2>/dev/null || echo installed)"
printf 'openchamber %s\n' "$(openchamber --version 2>/dev/null || echo installed)"
printf 'opencode   %s\n' "$(opencode --version 2>/dev/null | head -1 || echo missing)"
printf 'ffmpeg    %s\n' "$(ffmpeg -version 2>/dev/null | head -1)"
printf 'lsof      %s\n' "$(lsof -v 2>&1 | grep -oE 'revision: [0-9.]+' | head -1)"
printf 'pdftotext %s\n' "$(pdftotext -v 2>&1 | head -1)"
printf 'pypdf     %s\n' "$(python3 -c 'import pypdf; print(getattr(pypdf, "__version__", "installed"))' 2>/dev/null || echo missing)"

cat <<EOF

✓ toolchain ready.

Next, one-time per developer (interactive):
  scripts/setup.sh                    # env-pull + dev branch + uv sync + pnpm install + migrate

Auth is automatic when env vars are set:
  DOPPLER_TOKEN                       # doppler run / secrets (configured at start)
  NEON_API_KEY                        # neon CLI (used natively, no login needed)

Then start the stack:
  ./dev all
EOF