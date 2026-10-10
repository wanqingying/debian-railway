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

# ---- Magic Context housekeeping: delete finished dreamer/historian child sessions ----
# Every scheduled dreamer/historian run is a real OpenCode session (metadata
# {"magic_context":"hidden-run"}). Settled ones are supposed to be deleted after
# the run, but under a plain `opencode serve` host -- which is what OpenChamber
# starts -- a plugin has no way to delete sessions (upstream #558): the plugin
# records the finished children instead, and `doctor --fix` performs the deletion,
# which it only does with both session stores closed and unheld. This point in the
# boot is exactly that window: OpenChamber has not started its embedded opencode
# yet. Skipping this lets the sessions pile up in the OpenChamber list at roughly
# one per project per role per day, because OpenChamber does not read the
# magic_context marker and has no filter for it.
# Bounded and non-fatal, like install-tools.sh above: doctor backs opencode.db up
# before deleting anything and refuses (rather than guessing) when a store is
# held or the store is not the verified OpenCode 2 schema, so a failure here must
# not stop the container. Its exit status is reported rather than branched on:
# doctor also exits nonzero for checks that simply need a running OpenCode host
# (the hidden-agent model catalog cannot be read before OpenChamber starts), so
# "exit 1" here is normal and says nothing about whether the cleanup happened.
# ---- Drop the pinned "@latest" plugin cache so it re-resolves ----
# opencode pins the version it resolved for an "@latest" plugin inside its npm cache
# (~/.cache/opencode/npm/<pkg>@latest/<timestamp>/) and never re-resolves it, so the
# cached copy can go stale indefinitely. Observed on the dev container: magic-context
# stayed at 0.42.6 while 0.45.0 was out — and anything below 0.43.0 breaks image
# attachments on OpenCode 2 (upstream cortexkit/magic-context#517: "Schema validation
# failed" out of SessionModelRequest.prepare, after which every turn in that session
# fails). There the cache lives on a volume; here /root is rebuilt on redeploy, so the
# window is only a long-running container. Cheap either way, and non-fatal.
for d in "$HOME/.cache/opencode/npm" "${XDG_CACHE_HOME:-$HOME/.cache}/opencode/npm"; do
    p="$d/@cortexkit/opencode-magic-context@latest"
    if [ -d "$p" ]; then
        rm -rf "$p"
        echo "[entrypoint] dropped the pinned magic-context plugin cache (will re-resolve @latest)"
    fi
done

if [ -f "$OPENCODE_DB_FILE" ] && command -v npx >/dev/null 2>&1; then
    MC_STATUS=0
    # `</dev/null` + `-k 15` are deliberate, not decoration:
    # GNU timeout puts the child in its OWN PROCESS GROUP. Whenever the caller has a
    # controlling tty (any interactive/vscontainer start) that group is a *background*
    # group of that tty, so the first read from stdin raises SIGTTIN and STOPS the child
    # (ps state T, wchan do_signal_stop). timeout's SIGTERM is then only *pending* — a
    # stopped process cannot act on it (only SIGKILL works) — so the caller waits forever
    # on a corpse. Observed 2026-10-10: a container boot wedged at doctor for good.
    # dtach/detached starts (Railway) get stdin = /dev/null so they never hit it; keep
    # this anyway so the guard does not depend on how the container happens to be started.
    timeout -k 15 300 npx --yes "@cortexkit/magic-context@${MAGIC_CONTEXT_VERSION:-latest}" \
        doctor --fix --harness opencode </dev/null || MC_STATUS=$?
    echo "[entrypoint] magic-context: doctor --fix exit ${MC_STATUS} (non-fatal)"
fi

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
# OpenCode 2 config compatibility: v2 still accepts the v1 config shape
# (`provider` with `npm`/`options`/`id`, `plugin`, `permission`, `autoupdate`,
# `mcp.<name>`). The baked opencode.jsonc is trimmed of v2-unsupported keys
# (model `release_date`/`reasoning`/`attachment`, top-level `server`,
# `compaction.prune`) because v2 re-diagnoses each one on every config
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

# ---- Keep the container alive ----
exec tail -f /dev/null
