# Pinned by digest, not by tag: a re-push of `debian:bookworm-slim` would otherwise
# silently change what this image is built FROM, and the browser/toolchain verified
# here would not be the one that ships. Bump deliberately
# (docs/image-baking.md §3 rule 3).
FROM debian:bookworm-slim@sha256:99c0b25c46d0214d5a2091092e7908907dcaecd6a962cde0ac700acee222b6f3

# ---- Base + build toolchain + SSH server + locales ----
RUN apt-get update && apt-get upgrade -y && \
    apt-get install -y --no-install-recommends \
        wget curl git ca-certificates \
        build-essential \
        python3 python3-pip \
        openssh-server \
        locales bash-completion \
        neofetch \
        tini \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# ---- UTF-8 locale (avoids warnings in git/node/etc.) ----
RUN sed -i 's/^# *\(en_US.UTF-8\)/\1/' /etc/locale.gen && \
    locale-gen en_US.UTF-8
ENV LANG=en_US.UTF-8 \
    LC_ALL=en_US.UTF-8

# ---- Node.js 24 (NodeSource) ----
RUN curl -fsSL https://deb.nodesource.com/setup_24.x | bash - && \
    apt-get install -y nodejs && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# ---- ttyd: web terminal fallback (optional, own port) ----
RUN wget -qO /bin/ttyd https://github.com/tsl0922/ttyd/releases/download/1.7.3/ttyd.x86_64 && \
    chmod +x /bin/ttyd

# ---- SSH server (primary access for VS Code Remote-SSH) ----
RUN mkdir -p /run/sshd && \
    sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin yes/' /etc/ssh/sshd_config && \
    sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication yes/' /etc/ssh/sshd_config && \
    sed -i 's/^#\?UsePAM.*/UsePAM no/' /etc/ssh/sshd_config

ENV NODE_ENV=development \
    PATH="/usr/local/bin:${PATH}"

# ════════════════════════════════════════════════════════════════════════════════
# BAKED TOOLCHAIN
# ────────────────────────────────────────────────────────────────────────────────
# Everything below used to be installed by scripts/install-tools.sh **on every boot**
# (the root FS is not persisted, so it re-installed the world each start). That made
# every redeploy a fresh chance to come up without a browser or without an agent,
# and every failure was non-fatal by design — so it was quiet.
#
# The failure modes that motivated moving it here are measured, not theoretical:
# a package mirror serving at <1 KB/s, and a distro-built browser that installs and
# then dies at exec time because the base release is older than the one it was
# compiled against. Both are invisible at boot and loud at build.
# Full reasoning, rules and the Railway migration plan: docs/image-baking.md
#
# install-tools.sh is NOT removed: it keeps a guarded fallback for every item below,
# so a running container can still be repaired. On a healthy image it is a no-op.
# ════════════════════════════════════════════════════════════════════════════════

# ---- App toolchain (formerly install-tools.sh step 1) ----
# ffmpeg          : LangGraph runtime (core/langgraph.json) + media pipeline
# lsof            : `./dev` preflight and `./dev stop` (port detection)
# unzip / jq      : tool installers, JSON parsing in shell helpers
# build-essential : source-built Python deps (e.g. forbiddenfruit)
# poppler-utils   : pdftotext for the book-to-skill skill
# fontconfig + fonts-liberation : font rendering for overlay/render workers
RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg lsof unzip jq \
        build-essential \
        poppler-utils \
        fontconfig fonts-liberation \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# ---- Interactive browser: Chromium + KasmVNC (formerly install-tools.sh, last step) ----
# A real windowed Chromium on a virtual X display, so a human can do what an agent
# cannot (QR-code scan, CAPTCHA, 2FA, device pairing) and the agent then attaches to
# the SAME signed-in session over CDP. Runbook: docs/interactive-browser.md
#
# chromium/chromium-l10n : Debian packages. chromium-l10n is what makes the UI
#                          language switchable (Linux Chromium takes it from LANG).
# fluxbox                : window manager (tabs/dialogs need one; without it the
#                          window is unmapped and the VNC view is a grey screen)
# fonts-noto-cjk         : without it every Chinese page renders as tofu
# x11-utils / scrot      : xwininfo/xdpyinfo and screenshots, for verification
#
# KasmVNC is not in Debian: it is a pinned GitHub-release .deb, downloaded here and
# verified against a checksum baked into this file. Verifying matters: this .deb is
# the one artifact with no distro to vouch for it, and a truncated download would
# otherwise fail in the middle of an apt transaction. Both amd64 and arm64 are
# published; other architectures skip the browser instead of failing the build.
ARG KASMVNC_VERSION=1.5.0
RUN apt-get update && apt-get install -y --no-install-recommends \
        chromium chromium-l10n fluxbox fonts-noto-cjk x11-utils scrot \
    && apt-get clean && rm -rf /var/lib/apt/lists/* \
    && set -eu; \
       arch="$(dpkg --print-architecture)"; \
       case "$arch" in \
         amd64) sha=770fd3df51510beecc89666879d82faf411276e68c6e11df612f736b891b5f71 ;; \
         arm64) sha=aa83a1a6c9069d1a02239988b07a3a2a082a433042b4d4ee2b9e9f6b2df9643c ;; \
         *) echo "kasmvnc: no .deb for $arch — skipping the interactive browser"; exit 0 ;; \
       esac; \
       url="https://github.com/kasmtech/KasmVNC/releases/download/v${KASMVNC_VERSION}/kasmvncserver_bookworm_${KASMVNC_VERSION}_${arch}.deb"; \
       echo "kasmvnc: $url"; \
       curl -fsSL --retry 3 -o /tmp/kasmvnc.deb "$url"; \
       echo "${sha}  /tmp/kasmvnc.deb" | sha256sum -c -; \
       apt-get install -y --no-install-recommends /tmp/kasmvnc.deb; \
       rm -f /tmp/kasmvnc.deb; \
       apt-get clean; rm -rf /var/lib/apt/lists/*

# ---- GitHub CLI (gh) — not in Debian repos, GitHub's own apt source ----
# Auth needs no login step: gh reads GH_TOKEN / GITHUB_TOKEN, which this container
# already injects for git HTTPS.
RUN mkdir -p -m 755 /etc/apt/keyrings \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
         -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
         > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends gh \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# ---- uv + Python 3.12 ----
# The repo requires >=3.12; Debian's system python3 is 3.11.
# UV_PYTHON_INSTALL_DIR is pinned to a fixed path **inside the image** on purpose:
# uv otherwise resolves its data dir from XDG_DATA_HOME, which this container points
# at the /workspace volume — so a boot-time `uv python install` would store the
# interpreter somewhere the image cannot see and the baked one would be invisible.
# `python3.12` on PATH is an absolute symlink, so it survives regardless.
ENV UV_PYTHON_INSTALL_DIR=/usr/local/share/uv/python
RUN curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin sh \
    && uv python install 3.12 \
    && ln -sf "$(uv python find 3.12)" /usr/local/bin/python3.12 \
    && rm -rf /root/.cache/uv

# ---- pnpm (pinned, via corepack) ----
# Keep the pin in sync with scripts/install-tools.sh (fallback path).
RUN corepack enable pnpm && corepack prepare pnpm@11.22.0 --activate

# ---- Doppler CLI (secrets management; token injected at runtime via DOPPLER_TOKEN) ----
RUN curl -Ls https://cli.doppler.com/install.sh | sh \
    && rm -rf /var/lib/apt/lists/*

# ---- Javascript CLIs: Neon, Railway, OpenChamber ----
# Each installs independently so one upstream failure does not take the others down
# (the boot script keeps the same per-tool fallback).
#   neon         : neonctl — authenticates natively via NEON_API_KEY, no login step
#   @railway/cli : ships a postinstall -> needs --allow-scripts under npm 11
#   openchamber  : the web UI that manages its own embedded OpenCode server. PINNED
#                  (BD-001 = 2.5.1) and paired with the OpenCode pin below — OpenChamber
#                  2.x drives OpenCode 2.x only, and 2.5.2 is deliberately held back
#                  (it removed the Tree view; see versions/BD-INDEX.md).
ARG OPENCHAMBER_VERSION=2.5.1
RUN npm i -g neon \
    && npm i -g --allow-scripts=@railway/cli @railway/cli \
    && npm i -g "@openchamber/web@${OPENCHAMBER_VERSION}" \
    && npm cache clean --force

# opencode + codegraph are installed here (baked) so the AI stack is present in
# the image; opencode serve is NOT started directly — openchamber manages its
# own embedded opencode server at runtime (see entrypoint.sh).
#
# opencode MUST be v2 (@opencode/cli), installed **pinned** — not `@latest`. The
# official guide's npm method (https://opencode.ai/v2/docs → `npm install -g
# @opencode/cli`) is what we follow, but the version is held at 2.1.4 on purpose:
# following `latest` makes the running agent drift with every build, and one bad
# upstream release takes the whole AI stack down. It is also paired with the
# OpenChamber pin above (see the version-pair note there).
# The old v1 package `opencode-ai` is incompatible — OpenChamber reports
# "Configured OpenCode binary not found" and degrades to a no-agent mode. The
# `opencode` binary this package installs is what OpenChamber discovers on PATH.
# This install is normally the one that determines the running version:
# scripts/install-tools.sh only installs opencode when it is missing, so its
# version variable is the fallback knob, not the source of truth — keep the two
# in sync when bumping.
#
# --allow-scripts=@opencode/cli silences a build warning and keeps the install
# deterministic under npm 11:
#   npm warn install-scripts @opencode/cli@<v> (postinstall: node ./postinstall.mjs)
# Measured (node:24 / npm 11.19.1, two isolated containers): the binary WORKS
# either way — @opencode/cli ships every platform payload as an optionalDependency
# and npm itself hard-links it into bin/opencode.exe (same inode, links=2), so
# postinstall is not what fetches it. With the flag the warning count goes 4 -> 0.
# The flag is still worth passing: postinstall.mjs is the package's own binary
# resolution/AVX2-selection step, and letting it run is the supported path rather
# than depending on a layout that happens to work today.
#
# codegraph is baked here but NOT pinned at an exact version: versions/BD-INDEX.md
# records a deliberate Hold (L1 tool, failures are visible via `codegraph status`,
# so it is not in the BD), and `CODEGRAPH_UPGRADE=1` still refreshes it at boot.
RUN npm i -g --allow-scripts=@opencode/cli @opencode/cli@2.1.4 @colbymchenry/codegraph \
    && npm cache clean --force

# ---- book-to-skill PDF extractors ----
# The baked book-to-skill skill runs scripts/extract.py, which needs a PDF text
# extractor: poppler's pdftotext (above) is preferred, pypdf / pdfminer.six are the
# Python fallbacks. Debian's python3 is PEP 668 externally-managed, hence
# --break-system-packages. docling (better tables, for `--mode technical`) is
# deliberately NOT installed: large and slow.
RUN pip3 install --break-system-packages --quiet pypdf pdfminer.six \
    && rm -rf /root/.cache/pip

# ---- Build-time assertions: a broken image must fail HERE, not at boot ----
# Installing successfully is not evidence that a binary runs: the Chromium this
# image was modelled on installed cleanly and then died with a symbol lookup error.
# Keep this list in sync with what the sections above promise.
RUN set -eu; \
    fail() { echo "ASSERT FAILED: $*" >&2; exit 1; }; \
    for t in git curl wget jq ffmpeg lsof unzip pdftotext gh uv pnpm doppler \
             neon railway openchamber opencode codegraph chromium python3.12 node npm; do \
      command -v "$t" >/dev/null 2>&1 || fail "$t not on PATH"; \
    done; \
    python3.12 -c 'import sys; assert sys.version_info[:2] == (3, 12), sys.version' \
      || fail "python3.12 is not 3.12"; \
    python3 -c 'import pypdf, pdfminer' || fail "pypdf/pdfminer missing"; \
    pnpm --version | grep -q '11\.22\.0' || fail "pnpm is not 11.22.0"; \
    node --version | grep -q '^v24\.' || fail "node is not 24.x"; \
    opencode --version | grep -q '2\.1\.4' || fail "opencode is not 2.1.4"; \
    openchamber --version 2>/dev/null | grep -q '2\.5\.1' \
      || echo "WARN: openchamber --version did not report 2.5.1 (non-fatal)"; \
    if [ -f /usr/bin/kasmvncserver ] || command -v kasmvncserver >/dev/null 2>&1; then \
      echo "kasmvnc: present ($(dpkg-query -W -f='${Version}' kasmvncserver 2>/dev/null))"; \
    else \
      echo "kasmvnc: absent (architecture without a published .deb) — browser will be skipped"; \
    fi; \
    echo "baked toolchain OK"

# ---- Bake non-sensitive opencode config (copied from host global config) ----
# Sensitive credentials (auth.json / account.json / opencode.db) are NOT baked;
# they are injected at runtime via env vars (OPENCODE_* / provider keys).
COPY opencode-config /opt/opencode-config

# ---- Persistence: redirect opencode, magic-context, and openchamber state to the /workspace volume ----
# OpenChamber default is ~/.config/openchamber (under ephemeral /root) and it does
# NOT follow XDG_CONFIG_HOME, so it needs its own pointer onto the volume.
ENV XDG_DATA_HOME=/workspace/.opencode/data \
    XDG_CONFIG_HOME=/workspace/.opencode/config \
    OPENCHAMBER_DATA_DIR=/workspace/.opencode/config/openchamber

# ---- opencode headless server: basic auth (user opencode, password overridable) ----
ENV OPENCODE_SERVER_USERNAME=opencode \
    OPENCODE_SERVER_PASSWORD=qingying

# ---- Working dir on the mounted volume ----
WORKDIR /workspace

# ---- Boot scripts (repair path + service bring-up; deliberately NOT baked as logic) ----
# install-tools.sh: on a healthy image it is a no-op; it exists so a running
# container can be repaired without a rebuild.
COPY scripts/install-tools.sh /scripts/install-tools.sh
RUN chmod +x /scripts/install-tools.sh

# ---- Interactive browser bring-up (KasmVNC + Chromium) ----
# Called by entrypoint.sh when BROWSER_ENABLE is set (default on). See docs/interactive-browser.md.
COPY scripts/start-browser.sh /scripts/start-browser.sh
RUN chmod +x /scripts/start-browser.sh

# ---- Feishu Q&A bridge supervisor ----
# Keeps the Feishu topic router alive across crashes; started by entrypoint.sh. The bridge itself
# lives in the joops repo on the volume (/workspace/joops/feishu-bot), not in this image.
COPY scripts/start-feishu-bridge.sh /scripts/start-feishu-bridge.sh
RUN chmod +x /scripts/start-feishu-bridge.sh

# ---- Worktrees on the volume ----
# `wt` wrapper (symlinked to /usr/local/bin/wt by entrypoint.sh): creates git worktrees
# under $WORKTREE_ROOT and refuses any root a redeploy would wipe. See docs/worktrees.md.
COPY scripts/worktree.sh /scripts/worktree.sh
RUN chmod +x /scripts/worktree.sh

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Ports: $PORT (SSH, Railway public) · 4096 (opencode, managed by openchamber on
# 127.0.0.1 — expose via the openchamber proxy instead) · 3001 (openchamber web
# UI, map as the second Railway public TCP port) · 8444 (interactive browser's
# KasmVNC HTML5 view — bound to 127.0.0.1 by default; reach it over the SSH tunnel)
EXPOSE $PORT 3001 4096 8444

# ---- tini as PID 1: reap orphaned children so zombies cannot pile up ----
# `entrypoint.sh` ends with `exec tail -f /dev/null`, so without an init the
# keep-alive `tail` *is* PID 1 and never wait()s. Any orphaned descendant whose
# parent exits first (esbuild's service child, codegraph's watchdog, short-lived
# bash/grep) is re-parented to PID 1 and, once it exits, stays a permanent
# zombie. Zombies are counted against the cgroup's pids.max (1000 here) and are
# never released, so after ~2 days every fork() fails with EAGAIN and even `git`
# cannot start — the container appears "stuck" until it is restarted. tini only
# reaps; the keep-alive process and the rest of entrypoint.sh are unchanged.
# `-s` (subreaper) is harmless as PID 1 and also reaps if tini is ever nested
# under another init instead of being PID 1.
ENTRYPOINT ["/usr/bin/tini", "-s", "--"]
CMD ["/entrypoint.sh"]
