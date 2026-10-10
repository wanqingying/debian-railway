# Interactive-browser routes — evaluation & decision record

> This is the **comparison / decision record**. The chosen route (KasmVNC) is implemented and
> documented, verified end-to-end, in **[`interactive-browser.md`](./interactive-browser.md)** —
> that is the document to follow for the actual setup.

**Date:** 2026-10-10 · **Method:** multi-worker source-backed survey (deep-research skill), plus direct
inspection of the running container. Every non-obvious claim below carries a source; claims marked
*(needs PoC)* were not empirically confirmed in this container.

## 1. The question

The container has no desktop and no display. We want to run Chromium **inside the container** and
operate it **by hand from a laptop** — mainly for flows that cannot be automated: interactive
username/password or **QR-code ("scan to login")** sign-in, CAPTCHA, 2FA, device pairing. The likely
follow-on is to let an agent (opencode via Playwright) reuse the same, already-logged-in browser.

## 2. What the container is today (verified)

| Fact | Value |
|---|---|
| OS / arch | Debian 12 (bookworm), x86_64 |
| Browsers / X / VNC installed | **none** |
| apt candidates | `chromium 154.0.8037.92-1~deb12u1`, `xvfb 2:21.1.7-3+deb12u13`, `x11vnc 0.9.16-9`, `tigervnc-standalone-server 1.12.0+dfsg-8`, `novnc 1:1.3.0-1`, `websockify 0.10.0`, `xpra 3.1.3`, `openbox`/`fluxbox` |
| `/dev/shm` | **62 MB** → Chromium must run with `--disable-dev-shm-usage` |
| CPU quota | 8 cores (`cpu.max` 800000/100000); `nproc` misleadingly reports 48 |
| RAM | ~330 GB host, ~90 GB available |
| Volumes | `/workspace` 46 GB (48% used, 25 GB free) — persists; `/` is ephemeral (rebuilt on redeploy) |
| Network surface | SSH on `$PORT` via `tokaido.proxy.rlwy.net:11838`; OpenChamber on 3001 via `debian-dev-production.up.railway.app`; opencode 4096 on loopback only |
| Region | Railway `us-west2` |

Two consequences: (a) every install must live in `scripts/install-tools.sh` because `/` is wiped each
deploy; (b) the persistent browser profile belongs on `/workspace`, not `$HOME`.

## 3. Routes evaluated

### Route 1 — Self-hosted HTML5 "desktop browser" (virtual display + web VNC)
A real, windowed Chromium runs on a virtual X display; a VNC server streams the framebuffer to a
browser-based HTML5 client. Full fidelity: multiple tabs, native file dialogs, downloads, clipboard,
IME, extensions.

- **1a. Xvfb + fluxbox + x11vnc + noVNC/websockify** — every component is in Debian apt. noVNC is the
  HTML5 client (`Supports scaling, clipping and resizing`; `Clipboard copy/paste with full Unicode`);
  `websockify` is the WebSocket→TCP proxy and can also serve the noVNC web files with `--web DIR`
  ([noVNC README](https://raw.githubusercontent.com/novnc/noVNC/master/README.md),
  [websockify README](https://raw.githubusercontent.com/novnc/websockify/master/README.md)). x11vnc
  attaches to the Xvfb display and does server-side scaling, but its README states it is
  *"currently unmaintained and is looking for a new maintainer"*
  ([x11vnc README](https://raw.githubusercontent.com/LibVNC/x11vnc/master/README)).
- **1b. KasmVNC** — a single server package with a **built-in** HTML5 client
  (*"accessed by users from any modern browser and does not support legacy VNC viewer applications"*),
  "seamless clipboard support (on Chromium based browsers)", installed from a GitHub-release `.deb`
  (`sudo apt-get install ./kasmvncserver_*.deb`) — **not** in Debian
  ([KasmVNC README](https://raw.githubusercontent.com/kasmtech/KasmVNC/master/README.md),
  [client docs](https://kasmweb.com/kasmvnc/docs/1.0.0/clientside.html)). Better WAN image encoding
  and dynamic resize than raw RFB.
- **1c. Xpra HTML5** — the server bundles an HTML5 client and adds client→server **file upload**, but
  bookworm ships the 2020-era `xpra 3.1.3`, and the HTML5 client was split into a separate
  `xpra-html5` package that has gone missing from some repos, yielding a blank 403 page
  ([xpra README](https://raw.githubusercontent.com/Xpra-org/xpra/master/README.md),
  [html5 README](https://raw.githubusercontent.com/Xpra-org/xpra-html5/master/README.md),
  [issue #4779](https://github.com/Xpra-org/xpra/issues/4779)). Highest risk of the three here.

### Route 2 — Headless Chromium + CDP live view (no display server at all)
Chromium runs headless; a human views it through a Chrome DevTools Protocol screencast.

- **2a. Chromium's own DevTools frontend at `http://host:9222`.** CDP provides the full
  view+input path: `Page.startScreencast` → `Page.screencastFrame` (+ `…FrameAck` for back-pressure,
  `maxFramesInFlight` default 3, `everyNthFrame`, `quality`), and the `Input` domain
  (`dispatchMouseEvent`, `dispatchKeyEvent`, `insertText` for IME/emoji)
  ([CDP Page](https://chromedevtools.github.io/devtools-protocol/tot/Page/),
  [CDP Input](https://chromedevtools.github.io/devtools-protocol/tot/Input/)). The bundled
  `devtools-frontend` ships a **Screencast** app whose `InputModel.ts` maps real mouse/keyboard onto
  those CDP calls — i.e. it is interactive, not inspect-only
  ([devtools-frontend](https://github.com/ChromeDevTools/devtools-frontend)). *(needs PoC: that the
  stock `:9222` frontend exposes Screencast for a **remote** target without a local `chrome://inspect`.)*
  Chrome ≥136 refuses `--remote-debugging-port` on the *default* profile: it "must now be accompanied
  by the `--user-data-dir` switch" — which is exactly what persistence wants anyway
  ([Chrome blog](https://developer.chrome.com/blog/remote-debugging-port)).
- **2b. browserless (self-hosted).** Adds a purpose-built human hand-off: a short-lived interactive
  **Live URL** that lets anyone "watch the browser and click, type, and scroll in it directly, with no
  code … needed" — explicitly "for login flows, 2FA, CAPTCHAs" — and a bundled self-hosted Live
  Debugger ([hybrid automation](https://docs.browserless.io/baas/interactive-browser-sessions/hybrid-automation),
  [Live Debugger](https://docs.browserless.io/enterprise/live-debugger)). Runtime is a Node service +
  its own Chromium; the OSS image is SSPL.
- **2c. Playwright for the agent side.** `connectOverCDP` attaches Playwright to an already-running
  Chromium from another process/host ("significantly lower fidelity than … `browserType.connect()`"),
  and the login can be persisted with `storageState` (cookies, localStorage, IndexedDB, WebAuthn)
  ([connectOverCDP](https://playwright.dev/docs/api/class-browsertype),
  [auth](https://playwright.dev/docs/auth)). Note `codegen` / `page.pause()` are **headed-window**
  tools, so they need Route 1, not headless.

### Route 3 — Managed cloud browsers
Browserbase, browserless Cloud, Steel, browser-use Cloud run the browser in the **vendor's** cloud,
with a first-class interactive live view. They do **not** run on the container's network/IP, so they
are wrong if the login must originate from this container.

### Route 4 — SSH X11 forwarding (`ssh -X`, run Chromium, draw on the laptop)
Zero install in the container, but needs a local X server (XQuartz/VcXsrv), and Chromium over X11
forwarding is slow/laggy and clipboard/HiDPI are poor — especially across the Railway TCP proxy.
Noted for completeness; fails the interaction-quality bar.

## 4. Comparison

| | 1a noVNC+x11vnc | 1b KasmVNC | 2a DevTools screencast | 2b browserless | 3 Cloud | 4 ssh -X |
|---|---|---|---|---|---|---|
| Human can click/type/scan QR | ✅ full | ✅ full | ✅ (input over CDP) | ✅ purpose-built | ✅ | ⚠️ laggy |
| Native file dialog / download | ✅ | ✅ | ⚠️ needs `setInputFiles`/download events | ✅ via Chromium | ✅ | ✅ |
| Clipboard / IME | ✅ | ✅ seamless (Chrome) | ⚠️ limited | ✅ | ✅ | ⚠️ |
| Runs on **container** IP | ✅ | ✅ | ✅ | ✅ | ❌ vendor cloud | ✅ |
| Install cost in this repo | all apt | one pinned `.deb` | chromium only | Node app + chromium | none | none |
| Size / moving parts | ~500 MB | ~500 MB | ~400 MB | larger | none local | none |
| WAN feel @~200 ms RTT | OK | better encoding | good (screencast) | good | best (WebRTC) | poor |
| Agent hand-off (CDP) | ✅ add `--remote-debugging-port` | ✅ same | ✅ native | ✅ | ✅ | ⚠️ |
| Cost (US$/browser-hour) | ~0 (container) | ~0 | ~0 | ~0 self-host / $0.15 cloud | $0.02–$0.20 | 0 |
| Notable caveats | x11vnc unmaintained | not in apt | Screencast remote *(needs PoC)* | SSPL, heavier | not container IP | local X server |

Cloud price anchors, normalised to browser-hours: Browserbase $20/100 h = **$0.20/h** then $0.12/h
([pricing](https://www.browserbase.com/pricing)); browserless 20 000 units × 30 s = 166.7 h for $25 =
**$0.15/h** ([pricing](https://www.browserless.io/pricing)); Steel **$0.10/h**
([pricing](https://steel.dev/pricing)); browser-use Cloud **$0.02/h**
([README](https://github.com/browser-use/browser-use)).

## 5. Recommendation

**Route 1 — a self-hosted HTML5 desktop browser, with the browser also exposing CDP for the agent.**
It is the only family that is simultaneously (a) genuinely operable by hand — native dialogs, clipboard,
IME, tabs, QR rendering — (b) on the **container's** network, and (c) free (it uses the container that
is already paid for). Route 3 fails (b); Route 2 meets the letter of "view + click" but loses native
dialogs and carries an unverified screencast path; Route 4 fails the interaction-quality bar.

Within Route 1, **KasmVNC (1b) is the UX pick** — built-in client, seamless clipboard, better
WAN encoding and dynamic resolution — accepting a pinned GitHub-release `.deb`. **Xvfb+x11vnc+noVNC
(1a) is the lower-risk fallback** because every piece is apt-native and matches the container's
existing install pattern; its only real downsides are an unmaintained x11vnc and an older noVNC 1.3.0.

Two design choices make it fit this container:
1. **Windowed Chromium under the virtual display, launched with `--remote-debugging-port=9222` bound
   to `127.0.0.1`.** The human logs in through the HTML5 view; the agent then attaches over CDP to the
   **same** browser (chrome-devtools-mcp / Playwright `connectOverCDP`), so there is one logged-in
   session, not two.
2. **Persistent profile on the volume** (`--user-data-dir=/workspace/…`), so logins survive redeploys.

## 6. Implementation sketch (superseded)

The concrete, verified setup now lives in **[`interactive-browser.md`](./interactive-browser.md)**;
the sketch below is kept only as the original plan of record.

1. `scripts/install-tools.sh`: `apt-get install -y chromium xvfb fluxbox fonts-noto-cjk
   fonts-liberation` (+ `x11vnc novnc websockify` for 1a, or a pinned KasmVNC `.deb` for 1b).
2. New `/scripts/start-browser.sh`, started from `entrypoint.sh` after OpenChamber (never before it —
   keep OpenChamber the only opencode owner):
   - `Xvfb :99 -screen 0 1600x900x24 &` (or `Xvnc :99` for KasmVNC)
   - `DISPLAY=:99 fluxbox &`
   - `DISPLAY=:99 chromium --no-sandbox --disable-dev-shm-usage \
       --user-data-dir=/workspace/.opencode/config/chrome-profile \
       --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222 &`
   - 1a: `x11vnc -display :99 -rfbauth … -forever -shared &` +
     `websockify --web=/usr/share/novnc 6080 localhost:5900 &`
     1b: start KasmVNC on its HTTP port (default 6901) with `kasmvncpasswd`.
3. Railway: add a **public TCP-proxy port** mapped to the VNC web port (6080 / 6901), the same way 3001
   was exposed. Open `http://<proxy>:6080/vnc.html?autoconnect=1&resize=scale` (1a) or the KasmVNC URL.
4. **Security:** password-protect the VNC endpoint (Railway exposes it publicly); keep `9222` on
   loopback only — an open CDP port can read cookies and drive the browser.
5. Persist only the profile on `/workspace`; everything else is rebuilt per deploy.

## 6b. PoC outcome

**Route 1b (KasmVNC) was brought up live in this container and the chain was verified end-to-end**,
including a real laptop browser rendering and driving the container's Chromium over an SSH tunnel.
Recipe, configuration, gotchas and verification checklist are consolidated in
**[`interactive-browser.md`](./interactive-browser.md)**.

## 7. Risks and open items

- **(needs PoC)** That the *stock* `:9222` DevTools frontend exposes an interactive **Screencast** for a
  remote target. If not, Route 2 requires browserless or a small custom screencast page.
- **WAN latency:** region is `us-west2`; at high RTT any VNC-family view feels laggy (KasmVNC least).
  Changing the Railway region is the only real lever.
- **QR = phone-scans-screen** works in all live views; a **webcam-based** QR scan is impossible in the
  container and out of scope.
- `/dev/shm` is 62 MB, so `--disable-dev-shm-usage` is mandatory or Chromium tabs crash.
- Running Chromium as root needs `--no-sandbox`; acceptable for a dev container, noted as a tradeoff.
- KasmVNC has no bookworm package: pin the `.deb` version + arch in `install-tools.sh`.
- Optional nicety: an agent can `page.screenshot()` the live page and hand the QR image to the user,
  but that is not "manual operation" and does not replace the interactive view.

## 8. Sources

All retrieved 2026-10-10.

- T1 — [noVNC README](https://raw.githubusercontent.com/novnc/noVNC/master/README.md) · [websockify README](https://raw.githubusercontent.com/novnc/websockify/master/README.md) · [x11vnc README](https://raw.githubusercontent.com/LibVNC/x11vnc/master/README) · [TigerVNC README](https://raw.githubusercontent.com/TigerVNC/tigervnc/master/README.rst)
- T1 — [KasmVNC README](https://raw.githubusercontent.com/kasmtech/KasmVNC/master/README.md) · [KasmVNC client docs](https://kasmweb.com/kasmvnc/docs/1.0.0/clientside.html) · [Kasm workspaces-images](https://github.com/kasmtech/workspaces-images)
- T1 — [xpra README](https://raw.githubusercontent.com/Xpra-org/xpra/master/README.md) · [xpra-html5 README](https://raw.githubusercontent.com/Xpra-org/xpra-html5/master/README.md) · [xpra issue #4779](https://github.com/Xpra-org/xpra/issues/4779)
- T1 — [CDP Page domain](https://chromedevtools.github.io/devtools-protocol/tot/Page/) · [CDP Input domain](https://chromedevtools.github.io/devtools-protocol/tot/Input/) · [devtools-frontend](https://github.com/ChromeDevTools/devtools-frontend) · [new headless](https://developer.chrome.com/docs/automation-and-testing/headless) · [remote-debugging-port change](https://developer.chrome.com/blog/remote-debugging-port)
- T1 — [Playwright connectOverCDP](https://playwright.dev/docs/api/class-browsertype) · [Playwright auth/storageState](https://playwright.dev/docs/auth) · [playwright-mcp](https://github.com/microsoft/playwright-mcp) · [chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp) · [browser-use](https://github.com/browser-use/browser-use)
- T1 — [browserless hybrid automation](https://docs.browserless.io/baas/interactive-browser-sessions/hybrid-automation) · [browserless Live Debugger](https://docs.browserless.io/enterprise/live-debugger) · [browserless pricing](https://www.browserless.io/pricing)
- T1 — [Browserbase live view](https://docs.browserbase.com/features/session-live-view) · [Browserbase pricing](https://www.browserbase.com/pricing) · [Steel live sessions](https://docs.steel.dev/overview/sessions-api/embed-sessions/live-sessions) · [Steel profiles](https://docs.steel.dev/overview/profiles-api/overview) · [Steel pricing](https://steel.dev/pricing)
- T1 — [linuxserver/docker-chrome](https://github.com/linuxserver/docker-chrome) · [SeleniumHQ/docker-selenium](https://github.com/SeleniumHQ/docker-selenium)
- T1/T2 — Debian package pages: [chromium](https://packages.debian.org/bookworm/chromium), [xvfb](https://packages.debian.org/bookworm/xvfb), [tigervnc-standalone-server](https://packages.debian.org/bookworm/tigervnc-standalone-server); versions cross-checked on Repology.
