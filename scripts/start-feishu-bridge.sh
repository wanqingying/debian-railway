#!/usr/bin/env bash
# Keep the Feishu Q&A bridge running in this container.
#
# The bridge is a *router*: it answers a question asked in an inspection report's topic with the
# session that wrote that report. It must be the only long-connection consumer of the Feishu app —
# a second one does not error, it silently steals events — so this script holds a lock and refuses
# to start twice.
#
# Started from entrypoint.sh (the only place that survives a Railway redeploy: /usr is rebuilt, the
# /workspace volume is not). Logs and the supervisor lock live on the volume; the bridge's own state
# (topic ledger, dedupe, outbox, heartbeat) lives with the tool in /workspace/joops/feishu-bot/.inspect.
#
# Env (Railway service variables): FEISHU_APP_ID, FEISHU_APP_SECRET, FEISHU_CHAT_ID (comma-separated
# allow-list), FEISHU_CHAT_NAME (send-time guard), OPENCODE_PORT (default 4096),
# OPENCODE_SERVER_PASSWORD, FEISHU_THREAD_RETENTION_DAYS (default 7).
# Opt out with FEISHU_BRIDGE_ENABLE=0.
set -u

BRIDGE_ROOT="${FEISHU_BRIDGE_ROOT:-/workspace/joops/feishu-bot}"
STATE_DIR="${FEISHU_BRIDGE_SUPERVISOR_DIR:-${XDG_DATA_HOME:-/workspace/.opencode/data}/feishu-bridge}"
LOG="$STATE_DIR/bridge-supervisor.log"
LOCK="$STATE_DIR/supervisor.lock"
STAMP="$STATE_DIR/deps.stamp"
OPENCODE_PORT="${OPENCODE_PORT:-4096}"
export OPENCODE_PORT
MAX_BACKOFF=300

mkdir -p "$STATE_DIR"
log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) [feishu-bridge] $*" >>"$LOG"; }

if [ "${FEISHU_BRIDGE_ENABLE:-1}" = 0 ]; then
    log "disabled by FEISHU_BRIDGE_ENABLE=0"
    exit 0
fi

if [ ! -f "$BRIDGE_ROOT/src/bridge.ts" ]; then
    log "no bridge at $BRIDGE_ROOT (nothing to start)"
    exit 0
fi

if [ -z "${FEISHU_APP_ID:-}" ] || [ -z "${FEISHU_APP_SECRET:-}" ]; then
    log "FEISHU_APP_ID / FEISHU_APP_SECRET are not set; bridge not started"
    exit 0
fi

# One supervisor per container. The bridge has its own lock too; this one stops a rebooted
# supervisor from racing the previous one during shutdown.
exec 9>"$LOCK"
if ! flock -n 9; then
    log "supervisor already running; exiting"
    exit 0
fi

cd "$BRIDGE_ROOT" || { log "cannot cd into $BRIDGE_ROOT"; exit 0; }

# The bridge talks to the OpenCode server that OpenChamber owns. Starting before it answers means a
# few failed questions, so wait (bounded) instead.
wait_for_opencode() {
    local password="${OPENCODE_SERVER_PASSWORD:-${OPENCODE_PASSWORD:-}}"
    node -e '
      const port = process.env.OPENCODE_PORT;
      const auth = "Basic " + Buffer.from("opencode:" + (process.env.OPENCODE_SERVER_PASSWORD || "")).toString("base64");
      const url = `http://127.0.0.1:${port}/api/info`;
      (async () => {
        for (let i = 0; i < 90; i++) {
          try {
            const res = await fetch(url, { headers: { Authorization: auth }, signal: AbortSignal.timeout(2000) });
            if (res.ok) return;
          } catch {}
          await new Promise((r) => setTimeout(r, 1000));
        }
        process.exit(1);
      })();
    ' 2>/dev/null
}

log "waiting for opencode on 127.0.0.1:$OPENCODE_PORT"
if wait_for_opencode; then
    log "opencode is up"
else
    log "opencode did not answer within 90s; starting the bridge anyway (it retries per question)"
fi

# Dependencies only move when package.json / lockfile move. --ignore-scripts because the only native
# postinstall (protobufjs) is not needed by either SDK, and its build prompt makes pnpm exit non-zero.
deps_stamp() { command -v sha256sum >/dev/null 2>&1 && sha256sum package.json pnpm-lock.yaml 2>/dev/null | sha256sum | cut -d' ' -f1; }

current_stamp="$(deps_stamp)"
if [ ! -d node_modules ] || [ "$current_stamp" != "$(cat "$STAMP" 2>/dev/null || true)" ]; then
    log "installing dependencies (node_modules missing or lockfile changed)"
    if pnpm install --frozen-lockfile --ignore-scripts >>"$LOG" 2>&1; then
        echo "$current_stamp" >"$STAMP"
        log "dependencies installed"
    else
        log "pnpm install failed; the bridge will keep failing until this is fixed"
    fi
fi

restarts=0
while true; do
    log "starting bridge (attempt $((restarts + 1)))"
    BRIDGE_RESTARTS="$restarts" node src/bridge.ts >>"$LOG" 2>&1
    code=$?
    restarts=$((restarts + 1))
    log "bridge exited with $code; restarting"

    # Exponential backoff capped at MAX_BACKOFF: a flapping network should not spin, and a permanent
    # failure should still retry slowly instead of leaving the topic silent forever.
    backoff=$((5 * (restarts < 7 ? (1 << (restarts - 1)) : 64)))
    [ "$backoff" -gt "$MAX_BACKOFF" ] && backoff=$MAX_BACKOFF
    sleep "$backoff"
done
