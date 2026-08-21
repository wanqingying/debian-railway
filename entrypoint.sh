#!/bin/bash
set -e

# ---- Workspace volume: /workspace is mounted by Railway. Keep opencode state here ----
mkdir -p /workspace
cd /workspace

# ---- Ensure the persistent state/config dirs exist on the volume ----
mkdir -p "$XDG_DATA_HOME" "$XDG_CONFIG_HOME"

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

# ---- opencode: headless server (basic auth via OPENCODE_SERVER_*). Prefer OPENCODE_PORT else 4096 ----
OPENCODE_PORT="${OPENCODE_PORT:-4096}"
if command -v opencode >/dev/null 2>&1; then
    nohup opencode serve --port "$OPENCODE_PORT" --hostname 0.0.0.0 \
        >"$XDG_DATA_HOME/opencode-serve.log" 2>&1 &
fi

# ---- Keep the container alive ----
exec tail -f /dev/null
