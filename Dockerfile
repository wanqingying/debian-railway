FROM debian:bookworm-slim

# ---- Base + build toolchain + SSH server + locales ----
RUN apt-get update && apt-get upgrade -y && \
    apt-get install -y --no-install-recommends \
        wget curl git ca-certificates \
        build-essential \
        python3 python3-pip \
        openssh-server \
        locales bash-completion \
        neofetch \
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

# opencode + codegraph are installed here (baked) so the AI stack is present in
# the image; opencode serve is NOT started directly — openchamber manages its
# own embedded opencode server at runtime (see entrypoint.sh).
#
# opencode MUST be v2 (@opencode/cli): OpenChamber v2.0.0 requires OpenCode
# 2.0.15+. The old v1 package `opencode-ai` is incompatible — OpenChamber reports
# "Configured OpenCode binary not found" and degrades to a no-agent mode. The
# `opencode` binary this package installs is what OpenChamber discovers on PATH.
# PINNED to 2.0.15: 2.0.16 regresses user prompt image attachments (the media
# content part fails internal Media.Asset schema validation in
# SessionModelRequest.prepare, so SessionRunner.drain aborts and the UI shows
# only "OpenCode stopped this reply"). Verified 2026-09-25 on the same
# provider/model: 2.0.16 fails for every model, 2.0.15 handles the image.
# This is the install that actually determines the version — scripts/install-tools.sh
# only installs opencode when it is missing, so its pin is a fallback, not the source
# of truth. Do not float this to `latest` until upstream ships a fix.
RUN npm i -g @opencode/cli@2.0.15 @colbymchenry/codegraph && npm cache clean --force

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

# ---- App-environment bootstrap script (idempotent toolchain install, run at start) ----
COPY scripts/install-tools.sh /scripts/install-tools.sh
RUN chmod +x /scripts/install-tools.sh

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Ports: $PORT (SSH, Railway public) · 4096 (opencode, managed by openchamber on
# 127.0.0.1 — expose via the openchamber proxy instead) · 3001 (openchamber web
# UI, map as the second Railway public TCP port)
EXPOSE $PORT 3001 4096

CMD ["/entrypoint.sh"]
