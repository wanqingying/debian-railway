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

# ---- answer-me-with-html skill data: pin to the volume ----
# The skill's bundled `am` CLI writes pages/videos/themes under AM_HOME, which
# defaults to ~/.answer-me-with-html (ephemeral /root), so point it onto the
# volume to keep rendered pages across redeploys.
export AM_HOME="${AM_HOME:-$XDG_DATA_HOME/answer-me-with-html}"

# ---- Worktrees: pin to the volume ----
# A worktree is a session's working directory, so it has to outlive a redeploy.
# The root filesystem (/tmp, /root, /var/tmp) is rebuilt from the image on every
# start: a worktree created there disappears and the session pointing at it then
# fails with "Directory not found" and cannot be resumed. `worktree.directory`
# in opencode.jsonc sends OpenChamber's own "New worktree" here as well, and
# `wt` (scripts/worktree.sh) is the only sanctioned way for an agent to make one.
export WORKTREE_ROOT="${WORKTREE_ROOT:-/workspace/worktrees}"
mkdir -p "$WORKTREE_ROOT"
ln -sfn /scripts/worktree.sh /usr/local/bin/wt

# `pw` (scripts/pw) — Playwright CLI pinned onto the in-container KasmVNC browser:
# it attaches over CDP (idempotently) instead of launching, so an agent drives the
# SAME signed-in session a human just logged into. `playwright cli open` is avoided
# on purpose: it honours ~/.playwright/cli.config.json's cdpEndpoint but navigates the
# user's current tab away (measured 2026-10-29 on playwright 1.64.1).
if [ -f /scripts/pw ]; then
    chmod +x /scripts/pw 2>/dev/null || true
    ln -sfn /scripts/pw /usr/local/bin/pw
fi

# `xdg-open` — route "the CLI wants to open a browser" (railway login, gh auth login --web)
# to the in-container KasmVNC Chromium via CDP instead of a no-op. Debian's xdg-open would
# try x-www-browser and never reach the VNC session; /usr/local/bin wins on PATH.
if [ -f /scripts/xdg-open ]; then
    chmod +x /scripts/xdg-open 2>/dev/null || true
    ln -sfn /scripts/xdg-open /usr/local/bin/xdg-open
fi

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

# ---- Prune config paths retired from the baked image ----
# The bootstrap above is a one-way copy and never deletes, so a path dropped
# from the image would linger on the volume forever (and silently keep winning
# over its replacement). Retired paths are listed explicitly by name -- never
# prune blindly: the volume also holds credentials (opencode/auth.json,
# opencode/account.json) and OpenChamber's own state, none of which are baked.
# Each entry here can be dropped once every container has booted at least once
# on the newer image.
for f in code-review req-to-ship req-to-ship-en skill-creator; do
    p="$XDG_CONFIG_HOME/opencode/commands/$f.md"
    if [ -e "$p" ]; then
        rm -f "$p"
        echo "[entrypoint] removed retired /skill bridge command: $f.md"
    fi
done
# Only succeeds when the directory is now empty, so user-added commands survive.
rmdir "$XDG_CONFIG_HOME/opencode/commands" 2>/dev/null || true

# Retired 2026-10-26: these belonged to v1-era features that OpenCode 2 never
# reads (verified against 2.1.4). `tools/` is not a tool discovery path in v2 --
# the sysinfo tool moved to plugins/sysinfo/. tui.jsonc (v2 reads cli.json),
# dcp.jsonc and smart-voice-notify.jsonc (their plugins are not enabled) and the
# notify assets would otherwise sit on the volume forever, looking live.
rm -f "$XDG_CONFIG_HOME/opencode/tools/sysinfo.ts"
rmdir "$XDG_CONFIG_HOME/opencode/tools" 2>/dev/null || true
for f in tui.jsonc dcp.jsonc smart-voice-notify.jsonc; do
    p="$XDG_CONFIG_HOME/opencode/$f"
    if [ -e "$p" ]; then
        rm -f "$p"
        echo "[entrypoint] removed retired config: $f"
    fi
done
for f in Machine-alert-beep-sound-effect.mp3 Soft-high-tech-notification-sound-effect.mp3; do
    rm -f "$XDG_CONFIG_HOME/opencode/assets/$f"
done
rmdir "$XDG_CONFIG_HOME/opencode/assets" 2>/dev/null || true

# Retired 2026-10-29: a v1-era global config left at the XDG root by an earlier
# image. OpenCode still parses it (every config resolution), and every key in it
# is retired -- `server`, `permission`, `provider`, `small_model`, `autoupdate`,
# `disabled_providers`, plus `plugin: [...@latest]`, an UNPINNED magic-context
# spec that competes with the pinned one. It produced 6 "configuration
# normalization diagnostic" warnings per resolution and could re-bind the
# opencode server to 0.0.0.0:4096 behind OpenChamber's back. The live global
# config is $XDG_CONFIG_HOME/opencode/opencode.jsonc (baked, above).
p="$XDG_CONFIG_HOME/opencode.jsonc"
if [ -e "$p" ]; then
    rm -f "$p"
    echo "[entrypoint] removed retired v1 root config: opencode.jsonc"
fi

# ---- Migrate a v1 OpenCode session database to the v2 schema ----
# OpenCode 2 uses a different schema (session_message/session_inbox) than v1
# (message/part). A v1 database left on this volume from an earlier deploy is
# still readable by the v2 core, but magic-context checks the tables and refuses
# with "expected v2, found v1" — which silently interrupts every turn (the UI
# only says "OpenCode interrupted this reply"). Both the core and the plugin
# hardcode the filename `opencode.db` and the plugin ignores OPENCODE_DB, so the
# only fix is to move the v1 file aside and let v2 recreate it.
# Idempotent: only acts when the file exists and actually has the v1 tables.
OPENCODE_DB_FILE="${XDG_DATA_HOME:-$HOME/.local/share}/opencode/opencode.db"
if [ -f "$OPENCODE_DB_FILE" ]; then
    # Classify by table name; the query avoids string literals so it survives
    # being embedded in this script.
    DB_GEN="$(DBPATH="$OPENCODE_DB_FILE" node -e '
        try {
            const { DatabaseSync } = require("node:sqlite");
            const db = new DatabaseSync(process.env.DBPATH, { readOnly: true });
            const names = db.prepare("SELECT name FROM sqlite_master").all().map((r) => r.name);
            db.close();
            const t = new Set(names);
            if (t.has("message") && t.has("part")) console.log("v1");
            else if (t.has("session_message")) console.log("v2");
            else console.log("unknown");
        } catch { console.log("unknown"); }
    ' 2>/dev/null || echo unknown)"
    if [ "$DB_GEN" = "v1" ]; then
        BACKUP="$OPENCODE_DB_FILE.v1-backup-$(date +%Y%m%d-%H%M%S)"
        # Move all three files: the WAL may hold data not yet checkpointed.
        mv -f "$OPENCODE_DB_FILE" "$BACKUP"
        [ -f "$OPENCODE_DB_FILE-shm" ] && mv -f "$OPENCODE_DB_FILE-shm" "$BACKUP-shm"
        [ -f "$OPENCODE_DB_FILE-wal" ] && mv -f "$OPENCODE_DB_FILE-wal" "$BACKUP-wal"
        echo "migrated v1 opencode.db -> $(basename "$BACKUP") (v2 schema is recreated on first use)"
        # Keep only the newest backup so the volume does not accumulate copies.
        # $BACKUP was just created, so it IS the newest: drop every other main
        # backup (and its -shm/-wal siblings). Iterate the glob directly instead
        # of `ls -t | tail -n +2` — that idiom matches the -shm/-wal siblings too,
        # so `rm -f "$old" "$old-shm" "$old-wal"` could delete the main file it
        # was meant to keep. The glob is expanded before the loop mutates the dir.
        for old in "$OPENCODE_DB_FILE".v1-backup-*; do
            case "$old" in *-shm|*-wal) continue ;; esac
            [ -e "$old" ] || continue
            [ "$old" = "$BACKUP" ] && continue
            rm -f "$old" "$old-shm" "$old-wal"
        done
    fi
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

# ---- Prune cached magic-context builds that are not the pinned one ----
# opencode caches the plugin it resolved for each configured spec under
# ~/.cache/opencode/npm/<pkg>@<spec>/<timestamp>/ and never re-resolves a tagged
# spec, which is why this used to say "@latest" here plus a forced cache drop:
# observed on the dev container, magic-context stayed at 0.42.6 while 0.45.0 was
# out (anything below 0.43.0 breaks image attachments on OpenCode 2 — upstream
# cortexkit/magic-context#517). opencode.jsonc now pins an exact version, so the
# resolved version cannot drift; this only deletes leftovers — an older pin, or an
# `@latest` copy from before the pin — so a long-running container cannot keep
# serving a stale build from disk. Keep the version in sync with opencode.jsonc.
MC_PLUGIN_CACHE_SPEC="@cortexkit/opencode-magic-context@0.49.21"
for d in "$HOME/.cache/opencode/npm" "${XDG_CACHE_HOME:-$HOME/.cache}/opencode/npm"; do
    for p in "$d"/@cortexkit/opencode-magic-context@*; do
        [ -e "$p" ] || continue
        if [ "$(basename "$p")" != "$MC_PLUGIN_CACHE_SPEC" ]; then
            rm -rf "$p"
            echo "[entrypoint] pruned stale magic-context plugin cache: $(basename "$p")"
        fi
    done
done

# NOTE: this boot used to run `npx @cortexkit/magic-context doctor --fix --harness
# opencode` right here, to delete finished dreamer/historian child sessions, which
# older versions could not remove under a plain `opencode serve` host (upstream
# cortexkit/magic-context#558) and which therefore piled up in the OpenChamber list
# at roughly one per project per role per day (OpenChamber does not read the
# `magic_context: hidden-run` marker and has no filter for it).
#
# That is no longer needed. Magic Context now requires OpenCode >= 2.0.22 for hidden
# runs and removes each run's child through the NATIVE SESSION API when the run ends,
# "whether or not the host runs as a service". Verified in this container on OpenCode
# 2.0.32 + magic-context 0.49.12: historian and dreamer both ran after boot (historian
# ~19 min in, dreamer ~3 h in) and created no new `magic_context: hidden-run` sessions,
# and `doctor list-hidden-sessions` reports nothing left to collect. The six child
# sessions still visible in the session list are legacy rows from 2026-09-25 .. 10-12
# that the boot batches can no longer reach (the doctor's recorded inventory is empty).
#
# Dropping the call also removes the ONLY automatic source of an orphaned
# `opencode serve --service`: doctor's model-catalog check shells out to
# `opencode api model.list`, the CLI boots its background service for that call, and
# the service outlives the doctor (reparented to PID 1, ~500 MB, its own codegraph MCP
# tree, a second magic-context plugin instance, holding opencode.db + context.db).
# The stop call that used to clean that up went with it. To diagnose by hand instead,
# run `npx @cortexkit/magic-context@latest doctor --harness opencode` in the container
# and then `opencode service stop`.

# ---- OpenChamber: web UI that spawns/manages its own OpenCode server ----
# OpenChamber 2.x drives OpenCode 2.x. It starts the embedded `opencode serve`
# itself (on $OPENCODE_PORT, bound to $OPENCHAMBER_OPENCODE_HOSTNAME, default
# 127.0.0.1), so opencode is not started separately here. It reads the standard
# OPENCODE_SERVER_* envs for that server's basic auth.
#
# Launched as a daemon (openchamber's default), NOT `--foreground`. The in-app
# "update available" button installs the new package and restarts the server
# itself, but only for a daemon instance: a foreground instance is assumed to be
# managed by systemd and the updater answers "Foreground servers must be updated
# by their service manager. Set OPENCHAMBER_SYSTEMD_UNIT ...". Neither systemd
# nor the updater's container branch is available here — Railway runs neither
# systemd nor a Docker-detected sandbox (no /.dockerenv, no CONTAINER env).
# Daemon mode writes its own log to
# $OPENCHAMBER_DATA_DIR/logs/openchamber-<port>.log (`openchamber logs`); the
# redirect below only captures the startup banner.
#
# OpenCode 2 config compatibility: the baked opencode.jsonc uses the v2 shape
# (`providers`/`permissions`/`plugins`/`update`/`mcp.servers`); v2 also still
# accepts the v1 shape (`provider` with `npm`/`options`/`id`, `plugin`,
# `permission`, `autoupdate`, `mcp.<name>`). Either way the file must stay free
# of retired v1 keys (model `release_date`/`reasoning`/`attachment`, top-level
# `server`, `compaction.prune`) because v2 re-diagnoses each one on every config
# resolution, which otherwise floods the log and burns CPU. Two v1-only
# behaviors do NOT carry over and are handled here:
#   * v2 reads project instructions from AGENTS.md only — CLAUDE.md is ignored.
#   * v2 renamed the session database schema; a v1 `opencode.db` left on the
#     volume makes magic-context refuse with "expected v2, found v1" and every
#     turn fails silently. Migrate it once (same logic as the dev container).
OPENCHAMBER_PORT="${OPENCHAMBER_PORT:-3001}"
if command -v openchamber >/dev/null 2>&1; then
    # openchamber reads OPENCODE_PORT to decide where its managed opencode
    # server listens; without it the port is allocated dynamically, so pin it
    # here to keep the documented default (4096) stable across restarts.
    export OPENCODE_PORT="${OPENCODE_PORT:-4096}"
    OC_UI_PASSWORD="${OPENCHAMBER_UI_PASSWORD:-${OPENCODE_SERVER_PASSWORD:-}}"
    OC_ARGS=(serve --port "$OPENCHAMBER_PORT" --host 0.0.0.0)
    [ -n "$OC_UI_PASSWORD" ] && OC_ARGS+=(--ui-password "$OC_UI_PASSWORD")
    # `serve` daemonizes itself and returns once the server is ready; the `||`
    # guard keeps a failed start from tripping `set -e` and killing the
    # container (same reason install-tools.sh treats tool installs as non-fatal).
    openchamber "${OC_ARGS[@]}" \
        >"$XDG_DATA_HOME/openchamber.log" 2>&1 \
        || echo "[entrypoint] warning: OpenChamber failed to start (continuing without web UI)"
fi

# ---- Interactive browser (KasmVNC): a real Chromium on a virtual display ----
# Optional; opt out with BROWSER_ENABLE=0. Started AFTER OpenChamber so the browser can never
# compete with it for the boot window, and it starts no opencode process of its own — OpenChamber
# stays the sole opencode owner. The browser keeps a DevTools endpoint on loopback (CDP) for the
# agent and an HTML5 VNC view for manual sign-in (QR/CAPTCHA/2FA); its profile lives on the
# volume so sign-ins survive a redeploy. Non-fatal: a failure here must not stop the container.
# See docs/interactive-browser.md.
if [ "${BROWSER_ENABLE:-1}" != 0 ] && [ -x /scripts/start-browser.sh ]; then
    /scripts/start-browser.sh || echo "[entrypoint] warning: interactive browser failed to start (continuing)"
fi

# ---- Feishu Q&A bridge ----
# Routes questions asked in an inspection report's topic to the session that wrote it. Started AFTER
# OpenChamber because it talks to the embedded opencode server, and detached so a crashing bridge can
# never take the container (or SSH) down with it. The launcher waits for opencode, holds a lock
# (only one long connection per Feishu app may exist), installs deps when the lockfile moved, and
# restarts the bridge with capped backoff. Log:
#   $XDG_DATA_HOME/feishu-bridge/bridge-supervisor.log
# Opt out with FEISHU_BRIDGE_ENABLE=0.
if [ -x /scripts/start-feishu-bridge.sh ]; then
    nohup /scripts/start-feishu-bridge.sh >/dev/null 2>&1 &
fi

# ---- Keep the container alive ----
exec tail -f /dev/null
