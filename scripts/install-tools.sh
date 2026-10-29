#!/usr/bin/env bash
#
# scripts/install-tools.sh — toolchain VERIFIER + repair path (was: the installer)
#
# WHAT CHANGED (2026-10-29)
#   The whole toolchain is now baked into the image (see the "BAKED TOOLCHAIN"
#   section of the Dockerfile). This script used to install all of it on every
#   boot, because the root FS is not persisted. That made every redeploy a fresh
#   chance to come up without a browser or without an agent, and every failure was
#   non-fatal by design — so it was silent. Reasoning, measurements and the rules:
#   docs/image-baking.md
#
#   It is NOT removed. It is the repair path: on a healthy image every step below
#   finds the tool present and skips, so a boot touches no package mirror at all.
#   On a container where something was removed or a bake did not land, it still
#   installs it. Keep that property — never make an install unconditional again.
#
# WHAT IT STILL DOES AT RUNTIME (this is boot work, not packaging)
#   · Doppler token configuration from DOPPLER_TOKEN (per-machine secret)
#   · Neon: report that NEON_API_KEY is present (the CLI reads it natively)
#   · CodeGraph: upgrade to latest unless CODEGRAPH_UPGRADE=0 (deliberate Hold —
#     see versions/BD-INDEX.md; move to an exact pin to change this)
#   · repair the persisted core/.venv against this boot's interpreter (uv sync)
#   · smoke test + version report
#
# Verified tools (installed by the image): apt system packages, uv + Python 3.12,
# pnpm (11.22.0), Doppler CLI, Neon CLI, Railway CLI, OpenChamber (2.5.1),
# OpenCode CLI (2.1.4), CodeGraph, the interactive browser (Chromium + KasmVNC),
# gh, and the book-to-skill PDF extractors.
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

# ── 1. System packages (repair only) ────────────────────────────────────────────
# ffmpeg          : required by the LangGraph runtime (core/langgraph.json) + media pipeline
# lsof            : required by `./dev` preflight and `./dev stop` (port detection)
# unzip           : used by a few tool installers
# jq              : JSON parsing in shell helpers
# build-essential : source-built Python deps (e.g. forbiddenfruit) compile against it
# poppler-utils   : pdftotext for the baked book-to-skill skill (PDF text extraction)
# fontconfig + fonts-liberation : font rendering for overlay/render workers
# Baked into the image; this block only runs if one of them is gone.
log "1/5 system packages (apt)"
missing_pkgs=""
for pkg in ffmpeg lsof unzip jq build-essential poppler-utils fontconfig fonts-liberation; do
  dpkg-query -W -f='${Status}' "$pkg" 2>/dev/null | grep -q 'install ok installed' \
    || missing_pkgs="$missing_pkgs $pkg"
done
if [ -z "$missing_pkgs" ]; then
  log "  already in image — skipped"
else
  log "  missing:$missing_pkgs — repairing"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y --no-install-recommends $missing_pkgs >/dev/null
  apt-get clean
  rm -rf /var/lib/apt/lists/*
fi

# ── 2. uv + Python 3.12 ─────────────────────────────────────────────────────────
# uv self-installs to /usr/local/bin (root-FS; reinstalled each boot). Its managed pythons live
# under the uv data dir, which follows $HOME — on this container $HOME sits in the persistent
# /workspace volume, so an already-installed 3.12 survives redeploys and this step is a no-op.
log "2/5 uv"
if ! command -v uv >/dev/null 2>&1; then
  curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin sh
fi

log "3/5 Python 3.12"
# Baked into the image (uv-managed, under /usr/local/share/uv/python). Only rebuild the
# symlink if it is gone; the interpreter itself is already there.
if command -v python3.12 >/dev/null 2>&1; then
  log "  already in image — skipped"
else
  uv python install 3.12   # idempotent: skips if already managed
  # Expose the uv-managed interpreter on PATH as python3.12 (uv's managed pythons are NOT on PATH
  # by default). uv's data dir follows XDG_DATA_HOME, which points at the volume, so this is the
  # repair path for a container whose baked symlink was lost.
  ln -sf "$(uv python find 3.12)" /usr/local/bin/python3.12
fi

# ── 3. pnpm (pinned, via corepack) ──────────────────────────────────────────────
# Baked into the image. corepack shims live in the node bin dir; re-enabling is
# cheap and offline once the version is prepared, but skip it when pnpm resolves.
log "4/5 pnpm"
if command -v pnpm >/dev/null 2>&1; then
  log "  already in image — skipped"
else
  corepack enable pnpm
  corepack prepare pnpm@11.22.0 --activate
fi

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
# Both are installed **pinned** (not `latest`), using each project's official npm
# method:
#   OpenChamber: github.com/openchamber/openchamber (README / scripts/install.sh)
#                → `npm install -g @openchamber/web`
#   OpenCode v2: https://opencode.ai/v2/docs → `npm install -g @opencode/cli`
# Defaults live here (2.5.1 / 2.1.4) and can be overridden with
# OPENCHAMBER_VERSION / OPENCODE_VERSION. Set either to `latest` only if you
# deliberately want the old "track upstream" behaviour.
# Why pinned: with `latest` every redeploy could swap either component, so a bad
# upstream release silently takes down the whole AI stack (and the two must stay
# matched — see the version-pair note below). Pinning also means the boot only
# installs when the binary is *missing*, so nothing changes under you.
# A Dockerfile opencode pin travels with this one: keep them in sync.
#
# Why npm -g rather than the curl installers: `curl -fsSL https://opencode.ai/v2/install | bash`
# and OpenChamber's install.sh drop the binary under $HOME (or pick pnpm/bun when
# present) and patch shell rc files — wrong for a container whose $HOME is
# ephemeral and whose root FS is rebuilt on every redeploy. npm -g lands in /usr,
# which this script re-creates each boot, and is the documented npm method for both.
#
# npm 11 allow-scripts: @opencode/cli needs --allow-scripts (its postinstall picks
# the native binary); @openchamber/web's own files ship no install script, and
# node-pty's linux-x64 prebuild is inside the tarball, so a plain install is fine
# (verified 2026-09-25: working terminal, no dep scripts needed).
# Requires Node >=22 (image ships Node 24). OpenChamber manages its own embedded
# OpenCode server (spawns `opencode serve` on $OPENCODE_PORT) and reads the
# standard OPENCODE_SERVER_USERNAME/PASSWORD envs for that server's auth, so the
# existing opencode config carries over unchanged. Installed per boot because
# /usr/local (npm global) is wiped on redeploy.
#
# Version pairing: OpenChamber 2.x drives OpenCode 2.x only and declares a
# minimum (2.0.1 → MINIMUM_OPENCODE_VERSION = 2.0.15 in
# server/lib/opencode/compatibility.js). The pinned pair below is verified to
# work together; bump both together, never one alone. v1 `opencode-ai` must
# never be installed (no-agent mode).
# Install failure is non-fatal so a broken upstream release can't take down SSH;
# the web UI is just skipped (entrypoint.sh already guards on `command -v openchamber`).
OPENCHAMBER_VERSION="${OPENCHAMBER_VERSION:-2.5.1}"
log "OpenChamber ${OPENCHAMBER_VERSION}"
if ! command -v openchamber >/dev/null 2>&1; then
  npm install -g "@openchamber/web@${OPENCHAMBER_VERSION}" >/dev/null \
    || log "warning: OpenChamber install failed (continuing without web UI)"
fi

# ── OpenCode v2 CLI ───────────────────────────────────────────────────────────
# Official npm method (https://opencode.ai/v2/docs): `npm install -g @opencode/cli`.
# OpenChamber 2.x drives OpenCode 2.x and will not use v1: with `opencode-ai`
# installed it reports "Configured OpenCode binary not found" and runs without an
# agent. `@opencode/cli` installs the v2 `opencode` binary that OpenChamber finds
# on PATH. npm 11 needs --allow-scripts here too (same flag as @railway/cli
# below). Note the flag does NOT gate the binary: measured on npm 11.19.1, the
# platform payload rides along as an optionalDependency that npm itself
# hard-links into bin/, so `opencode` works with or without the flag. Passing it
# just silences the install-scripts warning and lets the package's own
# postinstall (binary resolution / AVX2 selection) run.
# The Dockerfile bakes this package too, so the guard below normally skips the
# install; this is the fallback when the baked copy is missing. Keep the pin in
# sync with the Dockerfile line. Installed per boot because
# /usr/local (npm global) is wiped on redeploy.
OPENCODE_VERSION="${OPENCODE_VERSION:-2.1.4}"
log "OpenCode CLI (v2) ${OPENCODE_VERSION}"
if ! command -v opencode >/dev/null 2>&1; then
  npm install -g --allow-scripts=@opencode/cli "@opencode/cli@${OPENCODE_VERSION}" >/dev/null \
    || log "warning: opencode CLI install failed (continuing without AI agent)"
fi

# Log what is actually on PATH (the baked Dockerfile install wins for opencode,
# so this is the line that says which pair this boot is really running).
log "resolved: openchamber $(openchamber --version 2>/dev/null || echo 'n/a') · opencode $(opencode --version 2>/dev/null || echo 'n/a')"

# ── CodeGraph ─────────────────────────────────────────────────────────────────
# Baked into the image at a **pinned** version (Dockerfile: `@colbymchenry/codegraph@1.6.2`,
# BD-001). The boot no longer upgrades it: CODEGRAPH_UPGRADE defaults to 0.
# Why the change: this used to track upstream on every start, so a redeploy could silently
# change how the agent indexes code, on top of the baked version drifting per build. Two
# moving parts in one container. Now the image is the source of truth; set
# CODEGRAPH_UPGRADE=1 deliberately to track latest again (that path is kept as an escape
# hatch, and it is non-fatal like everything else here).
CODEGRAPH_VERSION="${CODEGRAPH_VERSION:-1.6.2}"
CODEGRAPH_UPGRADE="${CODEGRAPH_UPGRADE:-0}"
if command -v codegraph >/dev/null 2>&1; then
  if [ "$CODEGRAPH_UPGRADE" = "0" ]; then
    log "CodeGraph upgrade skipped (pinned; CODEGRAPH_UPGRADE=0)"
  else
    log "CodeGraph upgrade to latest"
    # `timeout -k 15 … </dev/null`: GNU timeout puts the child in its own process
    # group, so a child that reads stdin gets SIGTTIN-stopped and then survives
    # SIGTERM forever — stdin redirection plus a kill-after is the guard.
    timeout -k 15 300 codegraph upgrade </dev/null >/dev/null 2>&1 \
      || npm install -g "@colbymchenry/codegraph@latest" >/dev/null 2>&1 \
      || log "warning: CodeGraph upgrade failed (keeping the current version)"
  fi
  log "resolved: codegraph $(codegraph --version 2>/dev/null || echo 'n/a') (pin ${CODEGRAPH_VERSION})"
elif [ "$CODEGRAPH_UPGRADE" != "0" ]; then
  # Repair path: baked copy is gone and the caller opted into tracking latest.
  npm install -g "@colbymchenry/codegraph@${CODEGRAPH_VERSION}" >/dev/null 2>&1 \
    || log "warning: CodeGraph install failed (continuing)"
fi

# ── Interactive browser (Chromium + KasmVNC) ────────────────────────────────────
# A real, windowed Chromium on a virtual X display, reachable from a laptop browser over an
# HTML5 VNC client — so manual sign-in (QR code, CAPTCHA, 2FA, device pairing) is possible —
# and exposing CDP on loopback for the agent to attach to the SAME signed-in session.
# Enabled unless BROWSER_ENABLE=0. chromium + CJK fonts are apt; KasmVNC is NOT in Debian and
# comes from a pinned GitHub-release .deb (amd64 only). Runbook: docs/interactive-browser.md
# Installed per boot because / is rebuilt on redeploy; guarded so a re-run is a no-op.
if [ "${BROWSER_ENABLE:-1}" != 0 ]; then
  if command -v kasmvncserver >/dev/null 2>&1 && command -v chromium >/dev/null 2>&1; then
    log "interactive browser: already installed"
  else
    log "interactive browser: chromium + KasmVNC"
    # The apt lists from step 1 were cleaned up, so refresh them for this second apt run.
    apt-get update -qq
    apt-get install -y --no-install-recommends \
      chromium chromium-l10n fluxbox fonts-noto-cjk x11-utils scrot \
      >/dev/null
    KASMVNC_VERSION="${KASMVNC_VERSION:-1.5.0}"
    # Upstream publishes both amd64 and arm64 bookworm .debs (verified 2026-10-29).
    # This repair path does NOT verify a checksum (the image build does); it is
    # best-effort and non-fatal by design.
    case "$(uname -m)" in
      x86_64|amd64) KASMVNC_ARCH=amd64 ;;
      aarch64|arm64) KASMVNC_ARCH=arm64 ;;
      *) KASMVNC_ARCH="" ;;
    esac
    if [ -z "$KASMVNC_ARCH" ]; then
      log "warning: no KasmVNC .deb published for $(uname -m) — skipping"
    else
      KASMVNC_DEB="/tmp/kasmvncserver_bookworm_${KASMVNC_VERSION}_${KASMVNC_ARCH}.deb"
      if curl -fsSL -o "$KASMVNC_DEB" \
           "https://github.com/kasmtech/KasmVNC/releases/download/v${KASMVNC_VERSION}/kasmvncserver_bookworm_${KASMVNC_VERSION}_${KASMVNC_ARCH}.deb"; then
        apt-get install -y "$KASMVNC_DEB" >/dev/null \
          || log "warning: KasmVNC install failed (continuing without the interactive browser)"
      else
        log "warning: KasmVNC download failed (continuing without the interactive browser)"
      fi
      rm -f "$KASMVNC_DEB"
    fi
    apt-get clean
    rm -rf /var/lib/apt/lists/*
  fi
fi

# ── GitHub CLI (gh) ─────────────────────────────────────────────────────────────
# gh is not in the Debian repos, so add GitHub's official apt source (keyring +
# list under /etc/apt, both ephemeral and re-created on each boot) and install it.
# Installed per boot because /usr is rebuilt on redeploy; guarded so a re-run is a
# no-op. Auth needs no login step: gh reads the GH_TOKEN / GITHUB_TOKEN env var
# (the same GITHUB_TOKEN this container already injects for git HTTPS).
log "GitHub CLI (gh)"
if ! command -v gh >/dev/null 2>&1; then
  mkdir -p -m 755 /etc/apt/keyrings
  curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    -o /etc/apt/keyrings/githubcli-archive-keyring.gpg
  chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    > /etc/apt/sources.list.d/github-cli.list
  apt-get update -qq
  apt-get install -y --no-install-recommends gh >/dev/null \
    || log "warning: gh install failed (continuing)"
  apt-get clean
  rm -rf /var/lib/apt/lists/*
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
for tool in gh neon railway openchamber; do
  command -v "$tool" >/dev/null 2>&1 || log "warning: $tool missing (optional)"
done
command -v opencode >/dev/null 2>&1 || log "warning: opencode CLI missing (optional; OpenChamber needs it for its agent)"
printf 'uv        %s\n' "$(uv --version)"
printf 'python    %s\n' "$(uv run --project "$REPO_ROOT/core" python --version 2>/dev/null || uv python find 3.12)"
printf 'pnpm      %s\n' "$(pnpm --version)"
printf 'doppler   %s\n' "$(doppler --version)"
printf 'neon      %s\n' "$(neon --version 2>/dev/null || echo installed)"
printf 'railway   %s\n' "$(railway --version 2>/dev/null || echo installed)"
printf 'gh        %s\n' "$(gh --version 2>/dev/null | head -1 || echo missing)"
printf 'openchamber %s\n' "$(openchamber --version 2>/dev/null || echo installed)"
printf 'opencode   %s\n' "$(opencode --version 2>/dev/null | head -1 || echo missing)"
printf 'ffmpeg    %s\n' "$(ffmpeg -version 2>/dev/null | head -1)"
printf 'lsof      %s\n' "$(lsof -v 2>&1 | grep -oE 'revision: [0-9.]+' | head -1)"
printf 'pdftotext %s\n' "$(pdftotext -v 2>&1 | head -1)"
printf 'pypdf     %s\n' "$(python3 -c 'import pypdf; print(getattr(pypdf, "__version__", "installed"))' 2>/dev/null || echo missing)"
printf 'chromium  %s\n' "$(chromium --version 2>/dev/null || echo missing)"
printf 'kasmvnc   %s\n' "$(dpkg-query -W -f='${Version}' kasmvncserver 2>/dev/null || echo missing)"

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