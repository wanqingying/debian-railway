#!/usr/bin/env bash
#
# scripts/start-browser.sh — interactive Chromium on a virtual display (KasmVNC).
#
# WHAT IT DOES
#   Starts a real, windowed Chromium on a virtual X display and streams it to a browser-based
#   HTML5 VNC client (KasmVNC), so flows an agent cannot do alone can be completed by hand:
#   QR-code / password sign-in, CAPTCHA, 2FA, device pairing. The same browser also exposes
#   the DevTools Protocol on loopback, so an agent (Playwright `connectOverCDP`,
#   chrome-devtools-mcp) can attach to the SAME, already-signed-in session afterwards.
#
#   Full runbook, gotchas and verification checklist: docs/interactive-browser.md
#
# IDEMPOTENT   — a no-op when the display + browser are already up; safe to re-run.
# NON-FATAL    — the caller (entrypoint.sh) guards with `|| ...`; a failure here must never
#                stop the container.
#
# ENV (all optional):
#   BROWSER_DISPLAY      :1                                          virtual display number
#   BROWSER_RESOLUTION   1600x900                                    desktop size (WxH)
#   BROWSER_PORT         8444                                        KasmVNC HTTP/WebSocket port
#   BROWSER_BIND         127.0.0.1                                   VNC bind address (loopback; use the SSH tunnel)
#   BROWSER_CDP_PORT     9222                                        Chromium DevTools port (always loopback)
#   BROWSER_PROFILE_DIR  /workspace/.opencode/config/chrome-profile  persistent profile (on the volume)
#   BROWSER_URL          about:blank                                 start page
#   BROWSER_LOCALE       zh-CN                                       browser UI language
#   BROWSER_VNC_PASSWORD ${PASSWORD:-$OPENCODE_SERVER_PASSWORD}      KasmVNC password (random if unset)
#   BROWSER_BLOCK_HOSTS  ad/tracker hosts resolved to 0.0.0.0        (list; see step 5)
set -euo pipefail

log() { printf '[browser] %s\n' "$*"; }

BROWSER_DISPLAY="${BROWSER_DISPLAY:-:1}"
BROWSER_RESOLUTION="${BROWSER_RESOLUTION:-1600x900}"
BROWSER_PORT="${BROWSER_PORT:-8444}"
BROWSER_BIND="${BROWSER_BIND:-127.0.0.1}"
BROWSER_CDP_PORT="${BROWSER_CDP_PORT:-9222}"
BROWSER_PROFILE_DIR="${BROWSER_PROFILE_DIR:-/workspace/.opencode/config/chrome-profile}"
BROWSER_URL="${BROWSER_URL:-about:blank}"
BROWSER_LOCALE="${BROWSER_LOCALE:-zh-CN}"

DISP_NUM="${BROWSER_DISPLAY#:}"
LANG_SHORT="${BROWSER_LOCALE%%-*}"
LOCALE_UNDERSCORE="${BROWSER_LOCALE//-/_}"   # zh-CN -> zh_CN (the LANG/LANGUAGE form)

# Only run where the pieces exist; install-tools.sh installs them (BROWSER_ENABLE, default on).
command -v kasmvncserver >/dev/null 2>&1 || { log "kasmvncserver not installed — skipping"; exit 0; }
command -v chromium >/dev/null 2>&1 || { log "chromium not installed — skipping"; exit 0; }

# Idempotent, but granular: the display and the browser are checked SEPARATELY, because they can get
# out of sync — Chromium exits when its last tab is closed while KasmVNC keeps running, and a
# display-only check would then no-op forever with no browser on screen.
# Note: `kasmvncserver -list` exits non-zero, and `set -o pipefail` would then fail the whole
# pipeline even on a match — capture the output and let grep alone decide.
RUNNING="$(kasmvncserver -list 2>/dev/null || true)"
DISPLAY_UP=0
printf '%s\n' "$RUNNING" | grep -qE "^${BROWSER_DISPLAY}[[:space:]]" && DISPLAY_UP=1
CHROME_UP=0
pgrep -f "user-data-dir=${BROWSER_PROFILE_DIR}" >/dev/null 2>&1 && CHROME_UP=1

if [ "$DISPLAY_UP" = 1 ] && [ "$CHROME_UP" = 1 ]; then
    log "display ${BROWSER_DISPLAY} and chromium already running — no-op"
    exit 0
fi
[ "$DISPLAY_UP" = 1 ] && log "display ${BROWSER_DISPLAY} up but chromium is gone — restarting the browser only"

# ---- 1. KasmVNC password (~/.kasmpasswd lives in ephemeral /root; recreated every boot) ----
# KasmVNC enforces a 6-character minimum, and this container's PASSWORD is often a short dev
# password, so a too-short value must fall back rather than break the start.
VNC_PW="${BROWSER_VNC_PASSWORD:-${PASSWORD:-${OPENCODE_SERVER_PASSWORD:-}}}"
OC_PW="${OPENCODE_SERVER_PASSWORD:-}"
if [ "${#VNC_PW}" -lt 6 ]; then
    if [ "${#OC_PW}" -ge 6 ] && [ "$VNC_PW" != "$OC_PW" ]; then
        log "BROWSER_VNC_PASSWORD/PASSWORD is shorter than KasmVNC's 6-char minimum — using OPENCODE_SERVER_PASSWORD"
        VNC_PW="$OC_PW"
    else
        VNC_PW="$(head -c 18 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 16)"
        log "no usable VNC password (KasmVNC needs >= 6 chars) — generated: ${VNC_PW}"
    fi
fi
printf '%s\n%s\n' "$VNC_PW" "$VNC_PW" | kasmvncpasswd -u root -w -r

# ---- 2. KasmVNC config (resolution lives HERE — `-geometry` is ignored by KasmVNC) ----
mkdir -p "$HOME/.vnc"
# Skip the interactive "select a desktop environment" first-run prompt (aborts with no TTY).
touch "$HOME/.vnc/.de-was-selected"
cat > "$HOME/.vnc/kasmvnc.yaml" <<EOF
desktop:
  resolution:
    width: ${BROWSER_RESOLUTION%x*}
    height: ${BROWSER_RESOLUTION#*x}
  allow_resize: true
network:
  protocol: http
  interface: ${BROWSER_BIND}
  websocket_port: ${BROWSER_PORT}
  ssl:
    require_ssl: true
EOF

# ---- 3. Browser language (profile side) ----
# The UI language itself comes from the environment at launch (step 5). Here we also record the
# locale in the profile so the "Languages" settings page opens on it and pages get the right
# Accept-Language. Requires chromium-l10n for non-English UI strings (only en-US.pak ships
# otherwise); the glibc locale need not be generated.
mkdir -p "$BROWSER_PROFILE_DIR/Default"
PREFS_FILE="$BROWSER_PROFILE_DIR/Default/Preferences" BROWSER_LOCALE="$BROWSER_LOCALE" LANG_SHORT="$LANG_SHORT" node -e '
  const fs = require("fs");
  const p = process.env.PREFS_FILE, loc = process.env.BROWSER_LOCALE, short = process.env.LANG_SHORT;
  let d = {};
  try { d = JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) {}
  d.intl = Object.assign({}, d.intl, { app_locale: loc, accept_languages: loc + "," + short });
  fs.writeFileSync(p, JSON.stringify(d));
' || log "warning: could not pre-set the UI locale (chromium will use its default)"

# ---- 4. Start virtual display + window manager (skipped when already up) ----
export DISPLAY="$BROWSER_DISPLAY"
if [ "$DISPLAY_UP" = 1 ]; then
    log "keeping the existing KasmVNC display ${BROWSER_DISPLAY}"
else
    log "starting KasmVNC on ${BROWSER_DISPLAY} (view https://${BROWSER_BIND}:${BROWSER_PORT}/vnc.html, cdp 127.0.0.1:${BROWSER_CDP_PORT})"
    setsid kasmvncserver "$BROWSER_DISPLAY" -depth 24 -noxstartup \
        >/tmp/kasmvncserver.log 2>&1 </dev/null &

    for _ in $(seq 1 40); do
        [ -e "/tmp/.X11-unix/X${DISP_NUM}" ] && break
        sleep 0.5
    done
    if [ ! -e "/tmp/.X11-unix/X${DISP_NUM}" ]; then
        log "display ${BROWSER_DISPLAY} did not come up — see /tmp/kasmvncserver.log and ~/.vnc/*.log"
        exit 1
    fi
fi

if ! pgrep -x fluxbox >/dev/null 2>&1; then
    setsid fluxbox >/tmp/fluxbox.log 2>&1 </dev/null &
fi

# ---- 5. Chromium ----
# Ad/tracker hosts to resolve to 0.0.0.0. On ad-heavy pages (mcmod.cn) an ad iframe navigates the
# TOP frame to googleads, which aborts our own navigation ("Navigation ... is interrupted by another
# navigation to ...") and spawns dozens of processes. Blocking them keeps automation reliable.
BROWSER_BLOCK_HOSTS="${BROWSER_BLOCK_HOSTS:-*.doubleclick.net *.googlesyndication.com *.googleadservices.com *.google-analytics.com *.googletagmanager.com *.clinch.co *.doubleverify.com *.adnxs.com *.criteo.com}"
HOST_RULES=""
for h in $BROWSER_BLOCK_HOSTS; do
    [ -n "$HOST_RULES" ] && HOST_RULES="${HOST_RULES},"
    HOST_RULES="${HOST_RULES}MAP ${h} 0.0.0.0"
done
# --no-sandbox             : required because the container runs as root
# --disable-dev-shm-usage   : /dev/shm is tiny here, or tabs crash
# --user-data-dir           : on the volume, so sign-ins survive a redeploy
# --remote-debugging-port   : loopback only (an open CDP port can read cookies / drive pages)
# LANG/LANGUAGE             : THE UI-language selector on Linux. Verified in this container:
#                             --lang=zh-CN with LANG=en_US.UTF-8 keeps the UI English; adding
#                             LANG=zh_CN.UTF-8 LANGUAGE=zh_CN switches it. chromium-l10n supplies
#                             the .pak (the glibc locale need not be generated).
LANG="${LOCALE_UNDERSCORE}.UTF-8" LANGUAGE="$LOCALE_UNDERSCORE" setsid chromium \
    --no-sandbox --disable-dev-shm-usage --disable-gpu \
    --no-first-run --no-default-browser-check --start-maximized \
    --enable-remote-extensions \
    --user-data-dir="$BROWSER_PROFILE_DIR" \
    --remote-debugging-address=127.0.0.1 --remote-debugging-port="$BROWSER_CDP_PORT" \
    --remote-allow-origins='*' \
    --host-resolver-rules="$HOST_RULES" \
    --lang="$BROWSER_LOCALE" --accept-lang="${BROWSER_LOCALE},${LANG_SHORT}" \
    "$BROWSER_URL" >/tmp/chromium.log 2>&1 </dev/null &

# ---- 6. Non-fatal self-check (never fails the script) ----
for _ in $(seq 1 15); do
    code="$(curl -sk -u "root:${VNC_PW}" -o /dev/null -w '%{http_code}' "https://127.0.0.1:${BROWSER_PORT}/" 2>/dev/null || true)"
    [ "$code" = "200" ] && { log "VNC endpoint responding (HTTP 200)"; break; }
    sleep 1
done

log "ready — reach it from a laptop with:"
log "  ssh -N -L ${BROWSER_PORT}:127.0.0.1:${BROWSER_PORT} -p <PORT> root@<host>"
log "  then open https://127.0.0.1:${BROWSER_PORT}/vnc.html  (accept the self-signed cert; user root)"
