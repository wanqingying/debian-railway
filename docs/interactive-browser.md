# Interactive browser in the debian-dev container (KasmVNC)

**Status:** verified end-to-end in this container on 2026-10-10 (route 1b), and **now baked into the
image**: `scripts/install-tools.sh` installs the pieces and `entrypoint.sh` calls
`scripts/start-browser.sh` at every boot (opt out with `BROWSER_ENABLE=0`). This document is the
authoritative runbook; the *decision record* (why this route over the alternatives) lives in
[`container-browser-gui.md`](./container-browser-gui.md).

## 0. What this gives you

A **real, windowed Chromium running inside the container**, reachable from a laptop browser over an
HTML5 VNC client: native tabs, file dialogs, downloads, clipboard, IME — plus an **interactive**
sign-in surface, so flows that cannot be automated (QR-code "scan to log in", CAPTCHA, 2FA, device
pairing) can be completed by hand. The same Chromium also exposes **CDP on loopback**, so an agent
(opencode / Playwright / chrome-devtools-mcp) can attach to the **same logged-in session** afterwards.

Browsing egress is the **container's own network** (Railway `us-west2`) — this is why a self-hosted
browser was chosen over managed cloud browsers, which run on the vendor's IP.

## 1. Components

| Piece | What it does | Source |
|---|---|---|
| `chromium` | the browser (Debian build) | apt, `154.0.8037.92-1~deb12u1` |
| `chromium-l10n` | non-English UI strings (e.g. the Chinese UI) — without it only `en-US.pak` ships | apt |
| `fluxbox` | window manager (titles/drag/focus) | apt, `1.3.5-2.1` |
| `fonts-noto-cjk`, `fonts-liberation` | CJK + Latin fonts | apt |
| `x11-utils`, `scrot` | local verification (screenshots, `xdpyinfo`/`xwininfo`) | apt |
| **KasmVNC** (`Xkasmvnc` + `kasmvncserver`) | one process = virtual X server **+** VNC/image encoder **+** built-in HTTP/WebSocket server **+** HTML5 client | GitHub release `.deb` (not in apt) |

KasmVNC is deliberately *not* RFB-compliant ("has broken from the RFB specification"); it pairs only
with its own web client. That is fine here — the browser *is* the client.

**Pinned version:** `kasmvncserver_bookworm_1.5.0_amd64.deb`
→ `https://github.com/kasmtech/KasmVNC/releases/download/v1.5.0/kasmvncserver_bookworm_1.5.0_amd64.deb`

## 2. Install

```sh
export DEBIAN_FRONTEND=noninteractive
apt-get install -y --no-install-recommends \
  chromium chromium-l10n fluxbox fonts-noto-cjk fonts-liberation x11-utils scrot ca-certificates curl

curl -L -o /tmp/kasmvnc.deb \
  https://github.com/kasmtech/KasmVNC/releases/download/v1.5.0/kasmvncserver_bookworm_1.5.0_amd64.deb
apt-get install -y /tmp/kasmvnc.deb
```

`/` is rebuilt on every redeploy, so this must live in `scripts/install-tools.sh` (see §8).

## 3. Configure

### 3.1 VNC password
Writes `~/.kasmpasswd`, which KasmVNC's web client authenticates against (HTTP Basic auth):

```sh
printf '%s\n%s\n' "$PASSWORD" "$PASSWORD" | kasmvncpasswd -u root -w -r
```

### 3.2 Skip the first-run prompt
On first start `kasmvncserver` launches `/usr/lib/kasmvncserver/select-de.sh`, which **interactively**
asks which desktop environment to run and aborts when there is no TTY. Pre-create the marker:

```sh
mkdir -p ~/.vnc && touch ~/.vnc/.de-was-selected
```

### 3.3 Display resolution and port
`-geometry` is **ignored** by KasmVNC. The resolution is KasmVNC's built-in default **1024×768**;
set `desktop.resolution` in `~/.vnc/kasmvnc.yaml` to change it. The web port defaults to `auto` (it
picked **8444**). Pin both:

```yaml
# ~/.vnc/kasmvnc.yaml
desktop:
  resolution:
    width: 1600
    height: 900
  allow_resize: true          # let the client resize the session
network:
  protocol: http
  interface: 0.0.0.0          # 127.0.0.1 if only ever reached over the SSH tunnel
  websocket_port: 8444
  ssl:
    require_ssl: true         # snakeoil self-signed cert (browser shows a warning)
```

## 4. Start / stop

```sh
# start (detached)
DISPLAY=:1 nohup setsid kasmvncserver :1 -depth 24 -noxstartup >/tmp/kasmvncserver.log 2>&1 </dev/null &

export DISPLAY=:1
nohup setsid fluxbox >/tmp/fluxbox.log 2>&1 </dev/null &
nohup setsid chromium \
    --no-sandbox --disable-dev-shm-usage --disable-gpu \
    --no-first-run --no-default-browser-check --start-maximized \
    --user-data-dir=/workspace/.opencode/config/chrome-profile \
    --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222 \
    <start-url> >/tmp/chromium.log 2>&1 </dev/null &

kasmvncserver -list        # -> ":1  <pid>"
kasmvncserver -kill :1     # stop the session (then kill fluxbox/chromium)
```

- `--no-sandbox` is required because the container runs as **root**; Chromium otherwise aborts with
  "Running as root without --no-sandbox is not supported."
- `--disable-dev-shm-usage` is required: `/dev/shm` is only **62 MB** here, or tabs crash.
- `--user-data-dir` on `/workspace` is what makes logins survive a redeploy (`/root` is ephemeral).
- `--remote-debugging-port` **must** be accompanied by `--user-data-dir` on Chrome ≥136, and is bound
  to loopback on purpose (see §7).
- KasmVNC's own session log: `~/.vnc/<hostname>:1.log`.

## 5. Access

### 5.1 SSH tunnel (works today, no Railway change)
```sh
ssh -N -L 8444:127.0.0.1:8444 -p <PORT> root@<railway-host>
# then open:  https://127.0.0.1:8444/vnc.html     (accept the self-signed cert; user root)
```
Self-test the tunnel without a browser:
```sh
curl -k -u root:"$PASSWORD" -o /dev/null -w '%{http_code}\n' https://127.0.0.1:8444/   # expect 200
```

### 5.2 Railway public TCP port (optional)
Add a second public TCP proxy on the service (Networking → TCP proxy) mapped to container port `8444`,
exactly as port 3001 was exposed. Open `https://<railway-host>:<mapped-port>/vnc.html`.
Self-signed cert → browser warning is expected. **Use a strong password if this is public.**

## 6. Agent hand-off over CDP

The browser exposes the DevTools Protocol on `127.0.0.1:9222`:

```sh
curl -s http://127.0.0.1:9222/json/version    # -> {"Browser":"Chrome/154...","webSocketDebuggerUrl":...}
curl -s http://127.0.0.1:9222/json/list       # -> open pages
```

- **Keep it on loopback.** CDP can read cookies and drive the browser; never expose 9222.
- Human logs in through the VNC view → the agent then attaches to the **same** browser:
  - Playwright: `chromium.connectOverCDP('http://127.0.0.1:9222')`
  - or `microsoft/playwright-mcp --cdp-endpoint http://127.0.0.1:9222`,
    `chrome-devtools-mcp` with a WebSocket/CDP endpoint.
- Login persistence for the agent path is handled by the on-volume `--user-data-dir` (or Playwright
  `storageState`).
- For *what to do* once attached — adapter CLIs (`opencli`) vs raw Playwright/CDP, the credentials
  bridge, and the OpenCLI `reddit search` pagination gap — see
  [`agent-web-access.md`](./agent-web-access.md).

## 7. Security

- VNC endpoint is **password-protected** (`~/.kasmpasswd`) and, with `require_ssl: true`, encrypted.
- Prefer the **SSH tunnel** (encrypted, nothing new exposed) over a public Railway port.
- `9222` stays on `127.0.0.1`; do not add it to any public mapping.
- `--no-sandbox` is an accepted tradeoff for a single-user dev container; it is inherent to running
  Chromium as root.

## 8. Repo integration (applied 2026-10-10)

1. **`scripts/install-tools.sh`** — installs the apt packages of §2 plus the pinned KasmVNC `.deb`
   (`KASMVNC_VERSION`, default `1.5.0`; amd64 only). Enabled unless `BROWSER_ENABLE=0`; guarded so a
   re-run is a no-op (skipped when `chromium` + `kasmvncserver` are already present).
2. **`scripts/start-browser.sh`** — the §3–§4 recipe, idempotent and non-fatal, driven by env vars:
   `BROWSER_DISPLAY` (`:1`), `BROWSER_RESOLUTION` (`1600x900`), `BROWSER_PORT` (`8444`),
   `BROWSER_BIND` (`127.0.0.1`), `BROWSER_CDP_PORT` (`9222`),
   `BROWSER_PROFILE_DIR` (`/workspace/.opencode/config/chrome-profile`), `BROWSER_URL`,
   `BROWSER_LOCALE` (`zh-CN`), `BROWSER_VNC_PASSWORD`
   (default `$PASSWORD` → `$OPENCODE_SERVER_PASSWORD`; a random one is generated if unset). It
   pre-creates `~/.vnc/.de-was-selected`, writes `~/.vnc/kasmvnc.yaml`, records the locale in the
   profile, and launches Chromium with `LANG`/`LANGUAGE` (the UI-language selector — see §9).
3. **`entrypoint.sh`** — calls `start-browser.sh` **after** `openchamber serve` (never before), unless
   `BROWSER_ENABLE=0`; OpenChamber stays the sole opencode owner (no separate opencode is started).
4. **`Dockerfile`** — bakes `scripts/start-browser.sh` into `/scripts/` and exposes `8444`.
5. Expose the port: the SSH tunnel (§5.1) is the default (`BROWSER_BIND=127.0.0.1`); set
   `BROWSER_BIND=0.0.0.0` and add a Railway TCP proxy (§5.2) only for a public port.

## 9. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Failed to execute /usr/lib/kasmvncserver/select-de.sh`, X server never starts | first-run DE prompt → `touch ~/.vnc/.de-was-selected` |
| `-geometry` has no effect | resolution is in `~/.vnc/kasmvnc.yaml` → `desktop.resolution` |
| Browser shows "not secure" | snakeoil self-signed cert (`require_ssl: true`) — accept it |
| Page never loads over a tunnel | used `http://` instead of `https://`, or the forward is not up — run the §5.1 curl self-test |
| `bind [127.0.0.1]:8444: Address already in use` | the tunnel was started **inside** the container (which already listens on 8444) — run it on the laptop |
| Tabs crash | missing `--disable-dev-shm-usage` (`/dev/shm` = 62 MB) |
| `Running as root without --no-sandbox` | add `--no-sandbox` |
| UI stays English despite `--lang=zh-CN` | Chromium on Linux takes the UI locale from the **environment** (`LANG`/`LANGUAGE`), not `--lang`. `start-browser.sh` sets `LANG=zh_CN.UTF-8 LANGUAGE=zh_CN`; `chromium-l10n` must be installed (only `en-US.pak` ships otherwise) |
| `wss://…/websockify` returns 404 | the request needs a `Sec-WebSocket-Protocol` header; without it the server treats it as a plain HTTP file request. A correct client upgrades with **101** |
| SSH "REMOTE HOST IDENTIFICATION HAS CHANGED" | container host key is not persisted; each redeploy regenerates it. Verify the fingerprint inside the container (`ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`) then `ssh-keygen -R "[host]:port"` on the laptop. Permanent fix = persist the host key on the volume (see §10) |

## 10. Open items

- **Host key persistence** — this container regenerates its SSH host key every redeploy
  (`sshd_config` has no `HostKey` line). Commit `3ecb0a6` ("fix(ssh): persist host key on the volume",
  branch `artful-dolphin`) implements the fix but was **never merged to main or deployed**. Merging it
  removes the recurring known_hosts warning.
- **WAN latency** — region is `us-west2`; changing the Railway region is the only real lever.
- **Resolution** — 1024×768 was the default at PoC time; pin 1600×900 (or enable client resize) for a
  usable desktop.
- A webcam-based QR scan is impossible inside the container (no camera); "phone scans the screen" works.
- Optional: let an agent `page.screenshot()` the live page to hand a QR image to the user — but that is
  not "manual operation" and does not replace the interactive view.

## 11. Verification checklist (what "working" means)

- [ ] `kasmvncserver -list` shows `:1`
- [ ] `xdpyinfo -display :1` reports the display
- [ ] `scrot -o /tmp/x.png` on `:1` shows the Chromium window
- [ ] `curl http://127.0.0.1:9222/json/version` → a `Chrome/…` version
- [ ] `curl -k -u root:$PASSWORD https://127.0.0.1:<port>/vnc.html` → `200`
- [ ] `wss://…/websockify` with a `Sec-WebSocket-Protocol` header → `101`
- [ ] a laptop browser renders the desktop and can click/type
