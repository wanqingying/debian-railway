#!/bin/bash
set -e

# ---- Workspace volume: /workspace is mounted by Railway. Keep opencode state here ----
mkdir -p /workspace
cd /workspace

# ---- Ensure the persistent state/config dirs exist on the volume ----
mkdir -p "$XDG_DATA_HOME" "$XDG_CONFIG_HOME"

# ---- OpenChamber data: pin to the volume ----
# OpenChamber keeps settings, projects, themes, and managed chats under
# ~/.config/openchamber by default (ephemeral /root) and does not follow
# XDG_CONFIG_HOME, so point it onto the volume explicitly.
export OPENCHAMBER_DATA_DIR="${OPENCHAMBER_DATA_DIR:-$XDG_CONFIG_HOME/openchamber}"
mkdir -p "$OPENCHAMBER_DATA_DIR"

# A few auxiliary writers (managed-process registry, telemetry install id in
# package-manager.js) resolve ~/.config/openchamber directly and ignore
# OPENCHAMBER_DATA_DIR. Point the default path at the same volume directory so
# those files persist too and every writer agrees on one root. A real directory
# left by an earlier run in this same container is folded in first (no-clobber,
# the volume wins) so `ln` cannot nest the link inside it.
mkdir -p "$HOME/.config"
if [ -e "$HOME/.config/openchamber" ] && [ ! -L "$HOME/.config/openchamber" ]; then
    cp -an "$HOME/.config/openchamber/." "$OPENCHAMBER_DATA_DIR/" 2>/dev/null || true
    rm -rf "$HOME/.config/openchamber"
fi
ln -sfn "$OPENCHAMBER_DATA_DIR" "$HOME/.config/openchamber"

# ---- Config bootstrap: copy baked config into the persistent volume ----
# The baked config is the source of truth; files whose content differs from the
# baked version are overwritten so image updates (e.g. env-var refs) propagate.
if [ -d /opt/opencode-config ] && [ -n "$XDG_CONFIG_HOME" ]; then
    mkdir -p "$XDG_CONFIG_HOME"
    # Sync every baked file/dir onto the volume (overwrite when content differs)
    find /opt/opencode-config -mindepth 1 | while read -r src; do
        rel="${src#/opt/opencode-config/}"
        dst="$XDG_CONFIG_HOME/$rel"
        if [ -d "$src" ]; then
            mkdir -p "$dst"
        elif [ ! -e "$dst" ] || ! cmp -s "$src" "$dst"; then
            mkdir -p "$(dirname "$dst")"
            cp -p "$src" "$dst"
        fi
    done
    # magic-context config lives under $XDG_CONFIG_HOME/cortexkit/ (plugin reads it there)
    mkdir -p "$XDG_CONFIG_HOME/cortexkit"
fi

# ---- Git identity: configured into the persistent volume's XDG git config ----
# git reads $XDG_CONFIG_HOME/git/config (XDG spec) before ~/.gitconfig; the file
# lives on the /workspace volume so identity survives restarts.
if [ -n "${GIT_USER_NAME:-}" ] || [ -n "${GIT_USER_EMAIL:-}" ]; then
    mkdir -p "$XDG_CONFIG_HOME/git"
    GIT_CONFIG_GLOBAL="$XDG_CONFIG_HOME/git/config" \
        git config --global user.name "${GIT_USER_NAME}"
    GIT_CONFIG_GLOBAL="$XDG_CONFIG_HOME/git/config" \
        git config --global user.email "${GIT_USER_EMAIL}"
fi

# ---- GitHub auth: PAT from GITHUB_TOKEN, stored for HTTPS clone/push ----
# GitHub accepts any username with the PAT as password; 'oauth2' is the most
# generic. The credential file and helper config live in the persistent
# volume, so git operations authenticate without interaction.
if [ -n "${GITHUB_TOKEN:-}" ]; then
    GITHUB_HOST="${GITHUB_HOST:-github.com}"
    mkdir -p "$XDG_CONFIG_HOME/git"
    CRED_FILE="$XDG_CONFIG_HOME/git/credentials"
    OLD_UMASK="$(umask)"
    umask 077
    echo "https://oauth2:${GITHUB_TOKEN}@${GITHUB_HOST}" > "$CRED_FILE"
    umask "$OLD_UMASK"
    chmod 600 "$CRED_FILE"
    GIT_CONFIG_GLOBAL="$XDG_CONFIG_HOME/git/config" \
        git config --global credential.helper "store --file=$CRED_FILE"
fi

# ---- SSH host keys: persist on the volume so the fingerprint is stable ----
# `railway up` rebuilds the image every time, and openssh-server's postinst
# generates a fresh host key during the build, so /etc/ssh/ssh_host_* changes on
# every redeploy and clients hit "REMOTE HOST IDENTIFICATION HAS CHANGED". Keep
# the host key on the /workspace volume and point sshd at it, so the fingerprint
# is fixed for the life of the volume (generate once if absent). This does not
# stop connections dropping on a restart (that is inherent); it removes the key
# churn so auto-reconnect (autossh, VS Code RemoteForward) can run unattended.
SSH_HOST_KEY_DIR="$XDG_CONFIG_HOME/ssh"
mkdir -p "$SSH_HOST_KEY_DIR"
chmod 700 "$SSH_HOST_KEY_DIR"
if [ ! -f "$SSH_HOST_KEY_DIR/ssh_host_ed25519_key" ]; then
    ssh-keygen -q -t ed25519 -N "" -f "$SSH_HOST_KEY_DIR/ssh_host_ed25519_key"
fi
chmod 600 "$SSH_HOST_KEY_DIR"/ssh_host_*_key
chmod 644 "$SSH_HOST_KEY_DIR"/ssh_host_*_key.pub
# Use only the persisted key: a rebuilt image must never present a different one.
sed -i '/^#\?HostKey /d' /etc/ssh/sshd_config
echo "HostKey $SSH_HOST_KEY_DIR/ssh_host_ed25519_key" >> /etc/ssh/sshd_config

# ---- SSH port: prefer SSH_PORT, else $PORT (Railway's public port) ----
SSH_PORT="${SSH_PORT:-${PORT:-22}}"
sed -i "s/^#\?Port .*/Port ${SSH_PORT}/" /etc/ssh/sshd_config

# ---- Authorized key: inject SSH_PUBLIC_KEY so a key survives restarts ----
if [ -n "$SSH_PUBLIC_KEY" ]; then
    mkdir -p /root/.ssh
    grep -qF "$SSH_PUBLIC_KEY" /root/.ssh/authorized_keys 2>/dev/null || \
        echo "$SSH_PUBLIC_KEY" >> /root/.ssh/authorized_keys
    chmod 700 /root/.ssh
    chmod 600 /root/.ssh/authorized_keys
fi

# ---- Password: reuse PASSWORD env for the root login ----
if [ -n "$PASSWORD" ]; then
    echo "root:$PASSWORD" | chpasswd
fi

# ---- Start SSH server ----
/usr/sbin/sshd

# ---- ttyd: optional web-terminal fallback on its own port ----
if [ -n "$TTYD_PORT" ]; then
    /bin/ttyd -p "$TTYD_PORT" -c "${USERNAME:-root}:${PASSWORD}" /bin/bash &
fi

# ---- App-environment bootstrap: idempotent dev-toolchain install (ffmpeg/uv/pnpm/doppler) ----
if [ -x /scripts/install-tools.sh ]; then
    /scripts/install-tools.sh
fi

# ---- Playwright: attach over CDP to the browser on the user's machine ----
# This container has no local browser: the Playwright MCP server (registered in
# opencode.jsonc) and the Playwright CLI (used through the playwright-cli skill)
# both attach over CDP to a browser on the user's own machine through a reverse
# SSH tunnel (Win10: chrome.exe --remote-debugging-port=9222, then
# `-R 9222:127.0.0.1:9222`). PLAYWRIGHT_MCP_CONFIG points at the baked config
# whose browser.cdpEndpoint is the tunnel port, so `playwright-cli open`
# attaches instead of launching. Override the envs to point elsewhere.
export PLAYWRIGHT_MCP_CONFIG="${PLAYWRIGHT_MCP_CONFIG:-$XDG_CONFIG_HOME/opencode/playwright/cli.config.json}"
export PLAYWRIGHT_MCP_CDP_ENDPOINT="${PLAYWRIGHT_MCP_CDP_ENDPOINT:-http://127.0.0.1:9222}"

# ---- OpenChamber: web UI that spawns/manages its own OpenCode server ----
# openchamber starts the embedded `opencode serve` itself (on $OPENCODE_PORT,
# bound to $OPENCHAMBER_OPENCODE_HOSTNAME, default 127.0.0.1), so opencode is no
# longer started separately here. It reads the standard OPENCODE_SERVER_*
# envs for that server's basic auth. Run in foreground mode so the process is a
# plain child of this shell (managed by nohup like the old opencode serve).
OPENCHAMBER_PORT="${OPENCHAMBER_PORT:-3001}"
if command -v openchamber >/dev/null 2>&1; then
    # openchamber reads OPENCODE_PORT to decide where its managed opencode
    # server listens; without it the port is allocated dynamically, so pin it
    # here to keep the documented default (4096) stable across restarts.
    export OPENCODE_PORT="${OPENCODE_PORT:-4096}"
    OC_UI_PASSWORD="${OPENCHAMBER_UI_PASSWORD:-${OPENCODE_SERVER_PASSWORD:-}}"
    OC_ARGS=(serve --foreground --port "$OPENCHAMBER_PORT" --host 0.0.0.0)
    [ -n "$OC_UI_PASSWORD" ] && OC_ARGS+=(--ui-password "$OC_UI_PASSWORD")
    nohup openchamber "${OC_ARGS[@]}" \
        >"$XDG_DATA_HOME/openchamber.log" 2>&1 &
fi

# ---- Keep the container alive ----
exec tail -f /dev/null
