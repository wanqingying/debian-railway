# Browser self-check (in-container Chromium + KasmVNC)

A read-only procedure to answer one question in under a minute: **is the container's browser
healthy — the one a human can watch over VNC, and the one an agent drives over CDP?**

Nothing here starts, stops or restarts anything. Restoration lives in §5 and is a separate,
deliberate step.

Full install / config / access runbook: [`interactive-browser.md`](./interactive-browser.md).
This document is the *check* half; that one is the *how it is built* half.

## 1. What "normal" means

Five signals have to hold at once. Any single one can be green while the browser is useless —
that is the whole reason this document exists.

| # | Signal | Proves |
| --- | --- | --- |
| 1 | KasmVNC lists display `:1` | the X server a human can watch exists |
| 2 | Chromium is running **windowed** (no `--headless`) | there is a picture to watch, and manual sign-in (QR / CAPTCHA / 2FA) is possible |
| 3 | CDP answers on `127.0.0.1:9222` | an agent can drive that same browser |
| 4 | the VNC view answers `200` with `root` + the VNC password | a laptop can reach the desktop |
| 5 | a screenshot of `:1` shows the window | the compositor actually renders (a listening port does not prove this) |

Component map, for orientation:

| Piece | Process | Port | Path |
| --- | --- | --- | --- |
| X server + HTML5 VNC front end | `kasmvncserver :1` (KasmVNC) | `8444` (`BROWSER_PORT`, loopback) | `~/.vnc/kasmvnc.yaml`, `~/.kasmpasswd` (both in ephemeral `/root`) |
| Browser | windowed `/usr/lib/chromium/chromium` on `DISPLAY=:1` | CDP `9222` (always loopback) | profile on the volume: `$BROWSER_PROFILE_DIR` = `/workspace/.opencode/config/chrome-profile` |
| Window manager | `fluxbox` | — | taskbar at the bottom of the screenshot |
| Launcher | `/scripts/start-browser.sh` (from `scripts/start-browser.sh`) | — | idempotent, non-fatal, called once from `entrypoint.sh` |
| Agent wrappers | `pw` (`/scripts/pw` → `/usr/local/bin/pw`), `xdg-open` | — | both baked by `entrypoint.sh` **only if the image is new enough** (§4.7) |

## 2. The 30-second check

Read-only. Copy-paste as one block; it prints `PASS` / `FAIL` per signal and exits non-zero if
anything failed.

```bash
#!/usr/bin/env bash
set -u
DISP=${BROWSER_DISPLAY:-:1}
PORT=${BROWSER_PORT:-8444}
CDP=${BROWSER_CDP_PORT:-9222}
PROFILE=${BROWSER_PROFILE_DIR:-/workspace/.opencode/config/chrome-profile}
pass=0; fail=0
ok() { printf 'PASS  %s\n' "$*"; pass=$((pass+1)); }
no() { printf 'FAIL  %s\n' "$*"; fail=$((fail+1)); }

# 1. X display
if kasmvncserver -list 2>/dev/null | grep -qE "^${DISP}[[:space:]]"; then
    ok "KasmVNC display ${DISP} is listed"
else
    no "KasmVNC display ${DISP} is NOT running (kasmvncserver -list)"
fi

# 2. a windowed (not headless) Chromium on that display
if pgrep -f "user-data-dir=${PROFILE}" >/dev/null 2>&1; then
    if pgrep -af "user-data-dir=${PROFILE}" | grep -q -- "--headless"; then
        no "Chromium is running HEADLESS — nobody can see or sign in to it"
    else
        ok "Chromium is running windowed (no --headless)"
    fi
else
    no "no Chromium using the profile ${PROFILE}"
fi

# 3. CDP
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:${CDP}/json/version" 2>/dev/null)
if [ "$code" = 200 ]; then
    ver=$(curl -s --max-time 5 "http://127.0.0.1:${CDP}/json/version" \
        | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).Browser)}catch(e){console.log("?")}})')
    ok "CDP answering on 127.0.0.1:${CDP} (${ver})"
else
    no "CDP not answering on 127.0.0.1:${CDP} (HTTP ${code:-none})"
fi

# 4. pages
pages=$(curl -s --max-time 5 "http://127.0.0.1:${CDP}/json/list" \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).filter(t=>t.type==="page").length)}catch(e){console.log(0)}})')
[ "${pages:-0}" -ge 1 ] 2>/dev/null && ok "CDP reports ${pages} page target(s)" \
    || no "CDP reports no page targets"

# 5. VNC view — the password is resolved exactly as scripts/start-browser.sh resolves it
VNC_PW="${BROWSER_VNC_PASSWORD:-${PASSWORD:-${OPENCODE_SERVER_PASSWORD:-}}}"
[ "${#VNC_PW}" -ge 6 ] || VNC_PW="${OPENCODE_SERVER_PASSWORD:-}"
vcode=$(curl -sk -o /dev/null -w '%{http_code}' --max-time 5 -u "root:${VNC_PW}" \
    "https://127.0.0.1:${PORT}/" 2>/dev/null)
if   [ "$vcode" = 200 ]; then ok "VNC view answers 200 with root + the VNC password"
elif [ "$vcode" = 401 ]; then no "VNC endpoint is up but rejects the password (401)"
else no "VNC view not serving on https://127.0.0.1:${PORT}/ (code ${vcode:-none})"; fi

# 6. visual proof
shot=/tmp/browser-self-check.png
if DISPLAY="$DISP" scrot -o "$shot" >/dev/null 2>&1 && [ -s "$shot" ]; then
    ok "desktop screenshot written: ${shot} — open it and look"
else
    no "could not screenshot display ${DISP} (scrot)"
fi

# 7. profile login state
if [ "$code" = 200 ]; then
    cookies=$(cd /workspace/debian-railway 2>/dev/null && node -e '
      const {chromium}=require("playwright-core");
      (async()=>{const b=await chromium.connectOverCDP("http://127.0.0.1:'"${CDP}"'",{noDefaults:true,isLocal:true});
        const c=await b.contexts()[0].cookies(); console.log(c.length); await b.close();})().catch(()=>console.log("n/a"));')
    case "$cookies" in
        ''|n/a) printf 'SKIP  cookie check (playwright-core not importable from here)\n' ;;
        *)      ok "profile holds ${cookies} cookies (logins survive redeploys)" ;;
    esac
fi

# 8. agent takeover path baked in?
command -v pw >/dev/null 2>&1 \
    && ok "pw wrapper installed ($(command -v pw))" \
    || no "pw wrapper missing — image older than the repo, needs a redeploy (§4.7)"

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
```

Measured on this container on 2026-11-02, right after restoring it:

```
PASS  KasmVNC display :1 is listed
PASS  Chromium is running windowed (no --headless)
PASS  CDP answering on 127.0.0.1:9222 (Chrome/156.0.8078.47)
PASS  CDP reports 1 page target(s)
PASS  VNC view https://127.0.0.1:8444/vnc.html answers 200 with root + the VNC password
PASS  desktop screenshot written: /tmp/browser-self-check.png (44K) — open it and look
PASS  profile holds 236 cookies (logins survive redeploys)
FAIL  pw wrapper missing — image older than the repo, needs a redeploy (§4.7)
```

## 3. What each check proves, and what a failure means

| Check | Green means | Red means |
| --- | --- | --- |
| `kasmvncserver -list` | an X server exists for the display | nothing to watch; no VNC port; run `/scripts/start-browser.sh` |
| no `--headless` in the browser cmdline | a human can see and sign in | someone replaced the visible browser (§4.2) |
| `curl 127.0.0.1:9222/json/version` | CDP is up on a **loopback** port | either no browser, a stale profile lock, or the port is held by another instance |
| `/json/list` page targets | there is a page to drive | browser up with no tabs (it exits when the last tab closes — restart it) |
| authenticated `https://…/` | laptop ↔ desktop path works | 401 = wrong password; timeout = server down or `BROWSER_BIND` mismatch |
| `scrot` output | the desktop composites and renders | X is up but nothing draws — look at `~/.vnc/*.log` |
| cookie count | profile (and therefore logins) persists on the volume | profile wiped or another `--user-data-dir` in use |
| `pw` present | the documented agent takeover path exists | image predates the repo (§4.7) |

Two habits matter more than any single command:

- **Always look at the screenshot**, not just for its existence. A black or empty PNG with every
  port green is a real failure mode (the X server is alive, the window is not).
- **Read the command line, not the process count.** A headless Chromium is still "a Chromium
  running", and `pgrep chromium` says everything is fine.

## 4. Failure catalogue

### 4.1 Display is up, no Chromium

Chromium exits when its last tab is closed; KasmVNC keeps running. `start-browser.sh` checks the
two separately for exactly this reason, so re-running it starts the browser alone:

```bash
/scripts/start-browser.sh          # "display :1 up but chromium is gone — restarting the browser only"
```

### 4.2 Chromium is running, but **headless**

This is the failure that hides best: CDP is green, pages are drivable, cookies are there — and no
human can see or sign in to anything. It happens when someone "fixes" a wedged browser by
killing it and relaunching with `--headless=new` on the same profile and the same `9222`.

```bash
# who is it?
pgrep -af "user-data-dir=${BROWSER_PROFILE_DIR:-/workspace/.opencode/config/chrome-profile}"
#   ... chromium --headless=new --user-data-dir=... --remote-debugging-port=9222 ...

# which session launched it? (the bash tool passes its session id to every child)
tr '\0' '\n' < /proc/<PID>/environ | grep -E '^OPENCODE_SESSION_ID|^OPENCODE_TERMINAL'
```

Fix: treat it as a rogue instance — §5. Never launch a second Chromium on this profile: it either
loses the profile-lock race ("another computer … is using this profile") or fights for `9222`.
Headless is only acceptable for a *throwaway* profile on another port, and even then it is not
this container's browser.

### 4.3 `9222` refused, browser "running"

Almost always the process-singleton lock left by the **previous** container: `SingletonLock`
records `hostname-PID`, and both change across a redeploy, so Chromium refuses the profile and never
starts DevTools. `start-browser.sh` deletes the four lock files before launching; manually:

```bash
pkill -f "user-data-dir=${BROWSER_PROFILE_DIR:-/workspace/.opencode/config/chrome-profile}" || true
rm -f "${BROWSER_PROFILE_DIR:-/workspace/.opencode/config/chrome-profile}"/{SingletonLock,SingletonSocket,SingletonCookie,DevToolsActivePort}
/scripts/start-browser.sh
```

### 4.4 VNC `401`

The endpoint is alive and asking for `root` + the VNC password. The password is
`$BROWSER_VNC_PASSWORD`, falling back to `$PASSWORD`, then `$OPENCODE_SERVER_PASSWORD`; a value
shorter than 6 characters is replaced (KasmVNC's minimum) — `start-browser.sh` logs which branch it
took at boot. `~/.kasmpasswd` lives in ephemeral `/root`, so a password changed without a restart
does not apply until the script runs again.

### 4.5 VNC page loads but nothing is visible

Check the screenshot first (§2 check 6). If it is black, look at the X server's own log — it is
named after the hostname, which changes per deploy:

```bash
ls -lt /root/.vnc/*.log | head -3
tail -40 "$(ls -t /root/.vnc/*.log | head -1)"
tail -20 /tmp/kasmvncserver.log /tmp/chromium.log
```

Note that a KasmVNC log ending in `ComparingUpdateTracker: 0 pixels in / 0 pixels out` means *no
client is connected and nothing changed* — normal, not an error.

### 4.6 Tabs crash, or pages die under memory pressure

`--disable-dev-shm-usage` is already in the launch (container `/dev/shm` is small). If pages die
repeatedly, check the cgroup instead of the host numbers — `/proc/meminfo` reports the **host**
(≈338 GB), the container is capped by `memory.max` (16 GB):

```bash
awk '{printf "memory.current %.1f GB / max %.1f GB\n",$1/2^30,$2/2^30}' /sys/fs/cgroup/memory.current /sys/fs/cgroup/memory.max
grep -E '^(oom|oom_kill) ' /sys/fs/cgroup/memory.events
```

### 4.7 `pw` (or `xdg-open`) missing

`entrypoint.sh` installs both **only if the image contains them**. A container built before the
commit that added `scripts/pw` has neither the wrapper nor the global `playwright`, and
`docs/interactive-browser.md`'s agent hand-off then describes a path that does not exist.

```bash
ls -l /scripts/pw /usr/local/bin/pw 2>&1        # both should exist
ps -o lstart= -p 1                               # when this container's image was started
git -C /workspace/debian-railway log -1 --format='%h %ad %s' --date=iso
```

If the image start time is older than the commit that introduced the file, the only fix is a
redeploy (`railway up`; it restarts the container and every live session). Until then, drive CDP
directly — `playwright-core` from the repo works without any global install:

```bash
cd /workspace/debian-railway && node -e '
const {chromium}=require("playwright-core");
(async()=>{const b=await chromium.connectOverCDP("http://127.0.0.1:9222",{noDefaults:true,isLocal:true});
  console.log(await b.contexts()[0].pages().map(p=>p.url())); await b.close();})()'
```

## 5. Restoring a dead or hijacked browser

Order matters: a rogue instance holds the profile **and** `9222`, so `start-browser.sh` would
refuse to launch ("chromium already running") if it is left in place.

```bash
PROFILE=${BROWSER_PROFILE_DIR:-/workspace/.opencode/config/chrome-profile}

# 1. confirm nothing is attached right now (no ESTABLISHED CDP clients)
lsof -i :9222 2>/dev/null | grep ESTABLISHED        # empty = nobody attached

# 2. stop it (the bracket keeps the pattern from matching this very shell when run inside bash -c)
pkill -f "user-data-dir=${PROFILE}"

# 3. start the visible browser (idempotent; clears stale singleton locks itself)
/scripts/start-browser.sh

# 4. re-run §2 and *look* at the screenshot
```

What survives a restart and what does not: the profile (cookies, logins, history) is on the volume
and survives; open tabs and in-page state do not, and neither does anything a page had not saved.

## 6. Known non-issues (do not chase these)

| Looks wrong | Actually |
| --- | --- |
| Yellow infobar *"您使用的是不受支持的命令行标记: --host-resolver-rules=…"* | the ad/tracker host blocking (`BROWSER_BLOCK_HOSTS`) is passed as a command-line flag; Chromium always shows this infobar for it. Cosmetic |
| *"your connection is not private"* on the VNC page | self-signed cert by design (`require_ssl: true`); accept it once |
| `401` when curl-ing the VNC port without credentials | correct — the view is password-protected |
| PIDs and the VNC log filename change every restart | hostname + PID are per-container; the fingerprint that matters (SSH host key) is persisted separately |
| `kasmvncserver -list` exits non-zero | KasmVNC's own quirk; read its stdout, not the exit code (this is why `start-browser.sh` captures the output before grepping) |

## 7. Human access, for the record

```bash
ssh -N -L 8444:127.0.0.1:8444 -p "$PORT" root@<railway-host>
# then https://127.0.0.1:8444/vnc.html   — accept the self-signed cert, user root, the VNC password
```

Run the tunnel on the **laptop**: starting it inside the container collides with the listener that
is already on 8444.

## 8. Case study — 2026-10-31, three days of an invisible browser

- 12:18:03 — a session ("竞对品牌Reddit数据抓取与生产数据分析") decided the page was wedged and ran
  `ps … | awk '/chrom(e|ium)/'` → `kill` every Chromium → `setsid nohup chromium --headless=new
  --user-data-dir=/workspace/.opencode/config/chrome-profile --remote-debugging-port=9222`.
- 12:18:09 — the KasmVNC display exited as well. From then on: `8444` had no listener,
  `kasmvncserver -list` was empty, `9222` was held by the headless instance.
- For three days every "is the browser up?" check that only looked at CDP said **yes**, while the
  one thing the browser exists for — a human completing a sign-in — was impossible.
- 2026-11-02 — this self-check found it: display missing (check 1), `--headless` in the command
  line (check 2), no `8444` (check 5). Killing the headless instance and re-running
  `/scripts/start-browser.sh` restored the desktop; the profile still held 236 cookies, so no
  login was lost.

The lesson encoded above: **CDP green ≠ browser healthy**, and a browser has no supervisor by
design — a failure like this stays silent until someone runs this check.

## 9. Related

- [`interactive-browser.md`](./interactive-browser.md) — install, config, access, CDP hand-off, security.
- [`agent-web-access.md`](./agent-web-access.md) — what to do once attached (adapter CLIs vs raw Playwright).
- `scripts/start-browser.sh` — the launcher this document checks (env knobs in its header).
- `scripts/pw` — the `pw` takeover wrapper.
