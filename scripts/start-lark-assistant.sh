#!/usr/bin/env bash
# Keep the Feishu work assistant (lark-work-assistant) running in this container.
#
# The assistant is the ONLY long-connection consumer of the Feishu app. A second WS client does not
# error — Feishu delivers each event to just one of them — so an extra process looks healthy while
# starving the other. The lock below is what enforces "one consumer".
#
# It replaces the old feishu-bridge (joops/feishu-bot): that project still sends the inspection
# reports and records the topic ledger, but questions asked inside a report's topic are now answered
# here, in the same OpenCode session that wrote the report.
#
# Logs and the lock live on the volume. Started from entrypoint.sh (the only place that survives a
# Railway redeploy: /usr is rebuilt, /workspace is not).
#
# Env (Railway service variables): none required — the app id comes from lark-cli's credential store,
# BOT_OPEN_ID is fetched from the open API, and the OpenCode endpoint comes from OPENCODE_PORT.
# Opt out with LWA_ENABLE=0.
set -u

ROOT="${LWA_ROOT:-/workspace/lark-work-assistant}"
STATE_DIR="${LWA_SUPERVISOR_DIR:-${XDG_DATA_HOME:-/workspace/.opencode/data}/lark-assistant}"
LOG="$STATE_DIR/supervisor.log"
LOCK="$STATE_DIR/supervisor.lock"
STAMP="$STATE_DIR/deps.stamp"
OPENCODE_PORT="${OPENCODE_PORT:-4096}"
export OPENCODE_PORT
MAX_BACKOFF=300

mkdir -p "$STATE_DIR"
log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) [lark-assistant] $*" >>"$LOG"; }

if [ "${LWA_ENABLE:-1}" = 0 ]; then
    log "disabled by LWA_ENABLE=0"
    exit 0
fi

if [ ! -f "$ROOT/src/index.js" ]; then
    log "no assistant at $ROOT (nothing to start)"
    exit 0
fi

exec 9>"$LOCK"
if ! flock -n 9; then
    log "supervisor already running; exiting"
    exit 0
fi

cd "$ROOT" || { log "cannot cd into $ROOT"; exit 0; }

# LWA_DEBUG=1 → 打开助手的 debug 日志（路由判定、跳过原因都在这一级），排查「没反应」时用
if [ "${LWA_DEBUG:-0}" = 1 ]; then
    export DEBUG=1
    log "debug logging enabled"
fi

# The assistant talks to the OpenCode server OpenChamber owns; starting before it answers means a
# burst of ECONNREFUSED on the first messages. Wait, bounded.
wait_for_opencode() {
    node -e '
      const port = process.env.OPENCODE_PORT;
      const auth = "Basic " + Buffer.from("opencode:" + (process.env.OPENCODE_PASSWORD || "")).toString("base64");
      const url = `http://127.0.0.1:${port}/api/session?limit=1`;
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
    log "opencode did not answer within 90s; starting the assistant anyway (it retries per task)"
fi

# Dependencies only move when package.json / lockfile move.
deps_stamp() { command -v sha256sum >/dev/null 2>&1 && sha256sum package.json package-lock.json 2>/dev/null | sha256sum | cut -d' ' -f1; }

current_stamp="$(deps_stamp)"
if [ ! -d node_modules ] || [ "$current_stamp" != "$(cat "$STAMP" 2>/dev/null || true)" ]; then
    log "installing dependencies (node_modules missing or lockfile changed)"
    if npm install --no-audit --no-fund >>"$LOG" 2>&1; then
        echo "$current_stamp" >"$STAMP"
        log "dependencies installed"
    else
        log "npm install failed; the assistant will keep failing until this is fixed"
    fi
fi

restarts=0
while true; do
    log "starting assistant (attempt $((restarts + 1)))"
    LWA_RESTARTS="$restarts" node src/index.js >>"$LOG" 2>&1
    code=$?
    restarts=$((restarts + 1))
    log "assistant exited with $code; restarting"

    # Exponential backoff capped at MAX_BACKOFF: a flapping dependency should not spin.
    backoff=$((5 * (restarts < 7 ? (1 << (restarts - 1)) : 64)))
    [ "$backoff" -gt "$MAX_BACKOFF" ] && backoff=$MAX_BACKOFF
    sleep "$backoff"
done
