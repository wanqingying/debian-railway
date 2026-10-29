# Baking the browser stack into a derived image — devcontainer case study, Railway migration plan

**Status:** **applied to both containers on 2026-10-29.**

* devcontainer (`trn-bff-devcontainer-demo`): verified end-to-end — the container was rebuilt on the
  derived image and the browser came up automatically.
* this repo (`debian-railway`): the toolchain moved from a boot-time installer into the Dockerfile,
  and `scripts/install-tools.sh` became a verifier/repair path. See §4 for exactly what moved, what
  deliberately did not, and how it was verified.

**Why this document is in this repo:** `debian-railway` used to install its whole toolchain from the
network on *every boot* (`entrypoint.sh` → `scripts/install-tools.sh`). That is the pattern this
document removes, and the measurements below are why.

---

## 0. TL;DR

| | Rule | Why it bit us |
| --- | --- | --- |
| 1 | **Bake what is fixed; keep at runtime only what is per-user or per-machine** | a 126 MB package at <1 KB/s makes boot-install a permanent single point of failure |
| 2 | **Vendor upstream artifacts, pin by sha256, normalise the filenames** | builds must not depend on a mirror's mood, and must work on more than one arch |
| 3 | **Pin the base image by digest, not `:latest`** | a re-push by the base-image owner silently changes what your layer means |
| 4 | **Assert at build time** — a broken image must fail the *build*, not the *boot* | the browser was installed and still could not start (`symbol lookup error`) |
| 5 | **Never bake secrets or state** | credentials, `opencode.db`, chrome profile, code checkouts |
| 6 | **Packages go into the image; scripts stay in the repo** | a mount lets you fix a start-script bug without rebuilding |
| 7 | **Order layers: rarely-changing and heavy first; clean up in the same layer** | otherwise every config tweak re-downloads 150 MB of rpms |

---

## 1. The failure that motivated it (measured, not assumed)

Target: an interactive browser inside the devcontainer (QR-code login, CAPTCHA, 2FA — things an agent
cannot do alone; afterwards the agent attaches to the **same** logged-in session over CDP).

Everything below was measured on the real container (AlmaLinux 9.3, aarch64, Rancher Desktop):

| Observation | Consequence |
| --- | --- |
| `chromium-156.0.8078.47` fetched from the internal artifactory mirror: **<1 KB/s**, then timeout | `dnf install chromium` at runtime can never succeed reliably |
| The same rpm from the Fedora upstream mirror: ~1.3 MB/s | the package itself is fine; the *route* is the problem |
| EPEL's chromium is **built for RHEL 9.8**, the image's repos are pinned to **9.3** | it installs, then dies at exec time with `symbol lookup error` |
| Three chained symbol misses: `mpg123_param2` (libopenmpt ← mpg123), `vaMapBuffer2` (libavutil ← libva), `drmSyncobjEventfd` (chromium ← libdrm) | needed Rocky 9 builds of `mpg123-libs 1.32.9`, `libva 2.22.0`, `libdrm 2.4.128` — versions the pinned 9.3 repos do not carry |
| `ImageMagick` from the same mirror is uninstallable (`nothing provides libraw_r.so.23`) | tests the "is this repo healthy?" question, not ours |
| `chromium-browser --version` after the fixes | `Chromium 156.0.8078.47 ... RHEL 9.8` — proves exec, not just install |

The lesson is not "EL is special". It is: **anything fetched at container start can fail at container
start, and the failure is usually silent** (the container reports ready while the capability is
missing). Baking moves that failure into the build, where it is loud and blocks the release.

---

## 2. What was actually built (devcontainer)

Image: `hub.cloud.ctripcorp.com/trn-tai/trn-bff-devcontainer-demo:v1`
= official base pinned by digest + the items below. ~3.45 GB uncompressed, of which the browser stack
is ~600 MB (chromium 431 MB, CJK fonts 128 MB, KasmVNC 9 MB).

### 2.1 Inside the image

| Content | Size | Note |
| --- | --- | --- |
| `chromium`, `chromium-common` 156 | 431 MB | vendored rpm from Fedora upstream |
| `mpg123-libs` 1.32.9, `libva` 2.22.0, `libdrm` 2.4.128 | small | vendored from Rocky 9; **installed before chromium** |
| `kasmvncserver` 1.5.0 | 9 MB | GitHub release only, no dnf/apt source |
| `openbox`, `xorg-x11-utils` | small | window manager + local verification tools |
| `google-noto-sans-cjk-ttc-fonts` | 128 MB | without it every Chinese page renders as tofu |
| `jq`, `ripgrep`, `fzf`, `lsof`, `tree`, `glibc-langpack-zh` | tens of MB | small, but each used to require network |

### 2.2 Deliberately **not** inside the image

* credentials and anything rendered from them (`~/.npmrc`, `~/.m2/settings.xml`, ssh keys, API keys);
* user state: `opencode.db`, magic-context store, OpenChamber settings, **chrome profile**;
* code checkouts (must stay fresh), git identity (per person);
* `opencode` / `codegraph` binaries — measured 236 MB / 284 MB, they already live on the persistent
  volume and are maintained there. Baking them bought nothing and cost a lot.

### 2.3 Mechanics worth copying

* **`fetch-rpms.sh` + pinned checksums.** Downloads the rpms into `rpms/` (git-ignored) and verifies
  them against `rpms.sha256.<arch>`, which **is** committed. The Dockerfile only ever does
  `dnf install /tmp/rpms/*.rpm`, so builds need no package mirror at all.
* **Normalised file names.** Files are `chromium.rpm`, `libva.rpm`, … — no version, no arch in the
  name — so one Dockerfile builds on `aarch64` and `x86_64`; the script maps normalised name → the
  per-arch upstream URL, and the checksum file pins the version.
* **Build-time assertion.** The last Dockerfile step is
  `test -x /usr/bin/Xvnc && chromium-browser --version | grep -q 'Chromium 156'`. A broken stack
  cannot be pushed.
* **Ordering.** base libs → browser stack → small tools. The cheap, frequently-edited layer sits
  last, so editing the tool list does not re-download 150 MB of rpms.
* **`init: true` (tini as PID 1).** Measured in the old container: PID 1 was `bash -c`, which never
  `wait()`s, so an already-orphaned `chromium` had become a permanent zombie. Zombies count against
  the cgroup `pids.max`; after a couple of days every `fork()` fails and the container looks "stuck"
  while `git` cannot even start. `debian-railway` already does this (`ENTRYPOINT tini -s --`) — keep it.
* **`shm_size: 1g`.** `/dev/shm` defaults to 64 MB; Chromium tabs crash without it
  (`--disable-dev-shm-usage` is the in-browser workaround, better to fix it at the container).

---

## 3. The seven rules, with the evidence behind each

1. **Bake what is fixed, keep at runtime only what is per-user / per-machine.**
   Fixed: browser, fonts, CLI tools, language packs. Per-machine: credentials, git identity. Per-user:
   sessions, caches, profile. The devcontainer's start script now installs *nothing*.
2. **Vendor and checksum.** Measured above: the same byte-identical rpm went from "never" to
   "1.3 MB/s" depending on the mirror. A build should not depend on which mirror answers.
3. **Pin the base by digest.** `almalinux-nodejs24-function-app@sha256:4a66c294…` — if the owner
   re-pushes that tag, a `FROM ...:latest` would silently change what your layer *is*, and the
   browser you tested is not the browser you ship.
4. **Assert at build time.** The install succeeding is not evidence the binary runs. One `RUN` line
   with `--version` turned a boot-time mystery into a build failure.
5. **Never bake secrets or state.** Two independent reasons: the image is pushed to a registry, and
   the state must survive image changes (a baked `opencode.db` would be a stale snapshot that
   silently replaces the live one).
6. **Packages in the image, scripts in the repo.** `start-browser.sh` is bind-mounted
   (`./scripts:/root/scripts:ro`). The password-persistence bug below was fixed and took effect on
   the next restart — no rebuild.
7. **Layer order + cleanup in the same layer.** `dnf clean all && rm -rf /tmp/rpms` in the same `RUN`;
   heavy/rare layers first.

Two more findings that are *behavioural*, not packaging, and are easy to get wrong:

* **A ≤6-character password silently becomes a random one every boot.** KasmVNC enforces a 6-character
  minimum. The devcontainer's `OPENCHAMBER_UI_PASSWORD` default is `tpass` (5 chars) → it fell back to
  "generate a random password", which meant "nobody can log in, and nobody knows why". Fix: an explicit
  default that satisfies the minimum (`tpaass`) **plus** persisting whatever was chosen to a file on the
  volume (`/root/.local/share/.browser-vnc-password`) so a restart does not change it.
* **A virtual display number is not free.** `vncserver` checks availability by binding `TCP 6000+N`.
  In the devcontainer `:1` is impossible because OpenChamber owns `6001` (and `6081-6084` are business
  ports), so the browser uses `:20`. Check the port range before choosing a display number.

---

## 4. Applied to `debian-railway` (2026-10-29)

### 4.1 What the image now bakes

In `Dockerfile` order (heavy/rare first, so editing a late layer does not re-download Chromium):

| Layer | Content | Why baked |
| --- | --- | --- |
| app toolchain | `ffmpeg`, `lsof`, `unzip`, `jq`, `build-essential`, `poppler-utils`, `fontconfig`, `fonts-liberation` | every boot used to run `apt-get update` + install |
| browser stack | `chromium`, `chromium-l10n`, `fluxbox`, `fonts-noto-cjk`, `x11-utils`, `scrot` + **KasmVNC `.deb`** | the heaviest and least frequently changed; KasmVNC has no apt source at all |
| `gh` | GitHub's own apt repo + keyring | not in Debian; the repo/keyring setup was rebuilt on every boot |
| `uv` + Python 3.12 | uv-managed, under `/usr/local/share/uv/python` | repo needs ≥3.12, system python3 is 3.11 |
| `pnpm` | corepack, pinned `11.22.0` | was prepared on every boot |
| Doppler CLI | official install script | secrets tooling |
| npm CLIs | `neon`, `@railway/cli`, `@openchamber/web@2.5.1` | three network installs per boot |
| `opencode@2.1.4` + `codegraph` | as before (already baked) | unchanged |
| PDF extractors | `pypdf`, `pdfminer.six` (`--break-system-packages`) | for the baked book-to-skill skill |

The base image is now pinned by **digest** (`debian:bookworm-slim@sha256:99c0b25c…`).

`UV_PYTHON_INSTALL_DIR=/usr/local/share/uv/python` is set **because** this container redirects
`XDG_DATA_HOME` to the `/workspace` volume: uv resolves its python dir from XDG, so a boot-time
`uv python install` would have stored the interpreter somewhere the image cannot see, and the baked
copy would be invisible. Fixing the path makes build and runtime agree.

### 4.2 What stayed at boot, and must

`entrypoint.sh` still owns everything that is per-machine or per-user: volume bootstrap from baked
config, SSH host-key persistence, `SSH_PUBLIC_KEY` / `PASSWORD` injection, `.npmrc` and
`settings.xml` rendering from env, the v1→v2 session-db migration, the plugin-cache prune, inotify
sysctls (needs `privileged`), and starting the three services (OpenChamber, browser, Feishu bridge).

`scripts/install-tools.sh` was **not deleted** — it was inverted into a verifier/repair path:

* every install is inside a guard (`dpkg-query … | grep 'install ok installed'`, `command -v`, or an
  import check), so on a healthy image **no step touches the network**;
* it still performs the genuinely-runtime work: Doppler token configuration from `DOPPLER_TOKEN`,
  the Neon key notice, the CodeGraph upgrade, and `uv sync` repair of the persisted `core/.venv`;
* it still ends with the smoke test / version report, which is what tells you the boot is healthy.

That combination is the point: the image is the source of truth, and the script is the escape hatch
when someone patches a running container.

### 4.3 Three deviations from the plan above, and why

1. **CodeGraph stays unpinned.** The plan's step 6 said to flip `CODEGRAPH_UPGRADE` to `0`. That
   would contradict an existing, documented decision: `versions/BD-INDEX.md` records a deliberate
   **Hold** ("codegraph 未锁 … 属于 L1 工具，故障可见 … 暂不纳入 BD", i.e. keep tracking upstream,
   because its failures are loud via `codegraph status`). So it is baked (so a boot has a working
   copy without npm) but `CODEGRAPH_UPGRADE` still defaults to `1`. If it ever moves to an exact pin,
   that Hold is the thing to lift — flip the default in the same change.
2. **The KasmVNC `.deb` is downloaded in the Dockerfile, not vendored into the build context.** The
   devcontainer vendored its rpms because its build *could* be offline. Railway builds from git,
   where a git-ignored `debs/` directory does not exist — vendoring would work locally and fail in
   CI. The build needs network for apt/npm regardless, so the pin that matters is the **checksum**:
   it is a literal in the Dockerfile, per architecture, and verified with `sha256sum -c` before
   `apt-get install`. That keeps rule 2's guarantee (the artifact is pinned and verified) without the
   "works on my machine" trap.
3. **KasmVNC is supported on `arm64` too.** The old script said "amd64 only"; upstream publishes
   both `bookworm` debs (verified 2026-10-29), so both are pinned and an unknown architecture skips
   the browser instead of failing the build.

### 4.4 Verification

Build-time assertions (the last `RUN` in the Dockerfile) fail the **build** if: any promised tool is
missing from `PATH`; `chromium` does not execute; `python3.12` is not 3.12; `pypdf`/`pdfminer` do not
import; `pnpm` is not `11.22.0`; `node` is not 24.x; `opencode` is not `2.1.4`. `openchamber`'s
version is reported but only warns — its `--version` output is not a contract worth breaking a deploy
over.

The real check is the deploy itself: build the image, watch the build log for the assertion line
(`baked toolchain OK`), then watch the container log for the boot smoke test (`toolchain ready` plus
the version table). Because every repair path is still present, a missed item degrades to "the boot
installed it again" rather than "the container has no agent".

### 4.5 What must not move into the image

`auth.json`/`account.json`, `.npmrc`, `settings.xml`, any API key, `opencode.db`, the magic-context
store, OpenChamber state, the chrome profile, and repo checkouts. All of these already live on the
volume; keep it that way. (`opencode-config/` stays baked and is *mirrored* to the volume by
`entrypoint.sh` — that is a config source, not state.)

---

## 5. Building and pushing when there is no docker CLI

Both machines that did this work have no `docker` binary but do have `/var/run/docker.sock`, so the
build and push went through the Engine API:

```bash
# context = Dockerfile + rpms/ only (small, reproducible)
curl -sS --unix-socket /var/run/docker.sock \
  -H 'Content-Type: application/x-tar' \
  --data-binary @ctx.tar \
  "http://localhost/build?t=<repo>:<tag>&dockerfile=Dockerfile&rm=1&forcerm=1"

curl -sS --unix-socket /var/run/docker.sock -X POST \
  "http://localhost/images/<repo>/push?tag=<tag>"
```

Both calls need `X-Registry-Auth: base64({"username","password","serveraddress"})` when the base image
or the target repo is private. Keep the password in an env var, never in a script (it ends up in
`ps` output, which is how it leaked once during this work).

**Caveat that cost a round of debugging:** the daemon resolves bind-mount *source* paths on the
**host**, so a container cannot verify a compose bind mount that points at its own filesystem — inside
a Rancher-Desktop VM `/workspace` is a named volume the daemon has never heard of. To feed files into
a verification container, `PUT /containers/{id}/archive?path=/…` a tar instead. A real
`docker compose up` is unaffected (compose runs on the host).

---

## 6. Distro traps found (EL side; Debian is friendlier, same shape)

| Trap | AlmaLinux 9 / EPEL (devcontainer) | Debian (this repo) |
| --- | --- | --- |
| browser binary | `chromium-browser` (no `chromium`) | `chromium` |
| window manager | no `fluxbox` in EPEL → `openbox` | `fluxbox` available |
| KasmVNC packaging | rpm has `/usr/bin/vncserver` + `Xvnc`, **no** `kasmvncserver`; certs generated at `/etc/pki/tls/private/kasmvnc.pem` | `.deb` provides `kasmvncserver`, uses snakeoil cert |
| distro-built browser | EPEL 156 built for RHEL **9.8** on a **9.3** base → `symbol lookup error` | not observed; still assert at build |
| CJK fonts | `google-noto-sans-cjk-ttc-fonts` | `fonts-noto-cjk` |
| font cache | a browser started **before** the fonts were installed keeps tofu until restarted | same |
| display number | `:1` impossible — `6001` is taken by OpenChamber | check `6000+N` before choosing |
| VNC password | min 6 chars; the devcontainer's 5-char default silently degrades to a random password every boot | this repo's default (`qingying`, via `OPENCODE_SERVER_PASSWORD`) is 8 chars so it is fine — but a shortened custom value degrades the same way |

---

## 7. Verification checklist (copy-paste, for either container)

```bash
# 1. stack present and executable
chromium --version || chromium-browser --version
test -x /usr/bin/vncserver && echo vncserver-ok
# 2. display up
vncserver -list
xwininfo -root -tree | grep -i chrom            # a mapped browser window, not just a process
# 3. VNC reachable, auth enforced, websocket accepted (the VNC client needs ws, not plain HTTP)
curl -sk -u root:"$PW" -o /dev/null -w '%{http_code}\n' https://127.0.0.1:8444/
curl -sk          -o /dev/null -w '%{http_code}\n' https://127.0.0.1:8444/          # expect 401
curl -sk -u root:"$PW" -o /dev/null -w '%{http_code}\n' \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' \
  -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' -H 'Sec-WebSocket-Protocol: binary' \
  -H 'Origin: https://127.0.0.1:8444' https://127.0.0.1:8444/websockify            # expect 101
# 4. agent hand-off
curl -s http://127.0.0.1:9222/json/version
# 5. rendered pixels (proves fonts + compositing, not just the process)
node -e '…CDP Page.captureScreenshot…'   # or:  host browser opens https://localhost:8444/vnc.html
# 6. hygiene
ps -eo stat --no-headers | grep -c '^Z'   # zombies must be 0 (tini reaps)
```

Expected: `200` / `401` / `101`, CDP answers with a browser version, a screenshot that is not blank or
tofu, zero zombies.

---

## 8. Files added by the devcontainer work (for reference)

`trn-bff-devcontainer-demo`, branch merged to `main` as `42cf365`:

| File | Role |
| --- | --- |
| `.devcontainer/Dockerfile` | derived image: base libs → browser stack → tools, with build-time assertion |
| `.devcontainer/fetch-rpms.sh` | downloads the rpms per arch, verifies against the committed checksums |
| `.devcontainer/rpms.sha256.aarch64` | the pins (version lives here, not in the Dockerfile) |
| `.devcontainer/scripts/start-browser.sh` | idempotent, non-fatal start; bind-mounted, not baked |
| `.devcontainer/docker-compose.yml` | derived image, `127.0.0.1:8444` publish, `init: true`, `shm_size: 1g`, `./scripts` mount |
| `.devcontainer/init.sh` | step `[10]`: call the start script, non-fatal |
