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

if [ ! -f "$ROOT/src/index.ts" ]; then
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

# The queue (NATS JetStream) is a first-class dependency: the assistant connects to it at startup and
# **fails fast** when it is missing (`启动失败: CONNECTION_REFUSED`), then restarts forever without ever
# taking the Feishu long connection — nothing is received at all. The queue is not started by the
# image, so a container restart takes both down and only the assistant comes back. natsd.sh has its
# own guard + flock and is idempotent, so calling `start` on every boot is safe.
# 2026-11-14: a restart at 00:28 UTC left the assistant dead for 12.6 hours this way.
NATS_CTL="$ROOT/scripts/natsd.sh"
if [ -x "$NATS_CTL" ]; then
    if bash "$NATS_CTL" start >>"$LOG" 2>&1; then
        log "queue is up (nats://127.0.0.1:4222)"
    else
        log "natsd start failed; the assistant will keep exiting until the queue is up"
    fi
else
    log "no $NATS_CTL; the assistant needs the queue (bash scripts/nats-init.sh --install)"
fi

# A previous supervisor that was killed (SIGTERM/SIGKILL on the bash wrapper) leaves its child
# running: `npx tsx src/index.ts` is in its own process tree and survives. That orphan is a SECOND
# Feishu long-connection consumer, and Feishu delivers each event to only one of them — messages
# look randomly lost. Kill stale ones before we start (the flock above means we are the only
# supervisor, so any assistant process on this box right now is stale).
kill_stale() {
    local pids
    pids="$(pgrep -f "tsx src/index.ts" 2>/dev/null | tr '\n' ' ')"
    [ -z "${pids// /}" ] && return 0
    log "killing stale assistant process(es): $pids"
    # shellcheck disable=SC2086
    kill $pids 2>/dev/null
    for _ in 1 2 3 4 5 6 7 8 9 10; do
        sleep 0.5
        # shellcheck disable=SC2086
        kill -0 $pids 2>/dev/null || return 0
    done
    # shellcheck disable=SC2086
    kill -9 $pids 2>/dev/null
}

child=""
on_signal() {
    log "supervisor received a stop signal; stopping the assistant"
    if [ -n "$child" ]; then
        kill -TERM "-$child" 2>/dev/null || kill -TERM "$child" 2>/dev/null
        wait "$child" 2>/dev/null
    fi
    exit 0
}
trap on_signal TERM INT

kill_stale

restarts=0
while true; do
    log "starting assistant (attempt $((restarts + 1)))"
    # Run the assistant as its own process group so a stop signal reaches npx + node together.
    # The repo is TypeScript (strict): tsx runs the sources, there is no build step.
    setsid env LWA_RESTARTS="$restarts" npx --no-install tsx src/index.ts >>"$LOG" 2>&1 &
    child=$!
    wait "$child"
    code=$?
    child=""
    # 被信号打断（128+n）说明是我们在收尾，别再重启
    if [ "$code" -ge 128 ]; then
        log "assistant stopped by signal ($code); supervisor exiting"
        exit 0
    fi
    restarts=$((restarts + 1))
    log "assistant exited with $code; restarting"

    # Exponential backoff capped at MAX_BACKOFF: a flapping dependency should not spin.
    backoff=$((5 * (restarts < 7 ? (1 << (restarts - 1)) : 64)))
    [ "$backoff" -gt "$MAX_BACKOFF" ] && backoff=$MAX_BACKOFF
    sleep "$backoff"
done
