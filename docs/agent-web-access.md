# Agent web access (logged-in sites) from this container

**Status:** verified in this container on 2026-10-10. This is a *usage + gotcha* record, not an
install runbook: nothing here is baked into the image. The browser itself is documented in
[`interactive-browser.md`](./interactive-browser.md).

## 0. The two ways an agent can read the web here

| | Adapter CLIs | Playwright / raw CDP |
|---|---|---|
| What | `opencli <site> <cmd>` (and Agent-Reach, which is a router/skill over backends such as OpenCLI, `bili`, `rdt-cli`) | `playwright-core` → `chromium.connectOverCDP('http://127.0.0.1:9222')` |
| You write | 0 code | a script |
| Strength | turnkey commands, stable output shapes, YAML/JSON "for agents", built-in `read`/comment trees | full control: any pagination, any field, any site, deterministic flows |
| Weakness | you inherit each adapter's gaps (see §3) | you own the logic forever |

Both can drive **the same logged-in browser** (the KasmVNC Chromium), so the login is shared:
- Playwright attaches over CDP directly.
- **OpenCLI attaches over CDP too** — see §1. No extension, no daemon, no tunnel.

## 1. Driving the container's Chromium with OpenCLI (the key trick)

The default OpenCLI mode needs the **Browser Bridge extension** loaded in the browser:

```
$ opencli reddit search openchamber
error: Browser Bridge extension not connected
```

Point it at the DevTools endpoint instead — one env var, and it drives the running Chromium:

```bash
export OPENCLI_CDP_ENDPOINT=http://127.0.0.1:9222      # the container's Chromium
opencli reddit search openchamber --limit 50 -f json
```

This is the documented "remote-chrome" route (`docs/advanced/remote-chrome.md` upstream). It makes
OpenCLI usable **without installing the extension**, which matters because this container's Chromium
would need a restart with `--load-extension` to get one.

## 2. Handing the browser's login to a CLI that wants its own credentials

Some backends keep their own credential file instead of reusing the browser session. Example:
Agent-Reach's Bilibili backend is `bili` (bilibili-cli), which stores `~/.bilibili-cli/credential.json`.

**Neither cookie bridge works here:**
- Agent-Reach `configure --from-browser` supports only `chrome|firefox|edge|brave|opera` (**not
  `chromium`**), looks in `~/.config/google-chrome`, and needs `browser-cookie3`/`rookiepy`.
- Both it and `bili`'s own extraction then fail with
  `Could not read chrome cookies: 'DBUS_SESSION_BUS_ADDRESS'` — this container has no keyring/DBus.

**Working bridge:** pull the cookies out over CDP and write the file the CLI expects. Playwright's
`context.cookies()` returns HttpOnly cookies too:

```js
const { chromium } = require('playwright-core');
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const cookies = await browser.contexts()[0].cookies(['https://www.bilibili.com']);
const get = (n) => (cookies.find((c) => c.name === n) || {}).value || '';
require('fs').writeFileSync(process.env.HOME + '/.bilibili-cli/credential.json', JSON.stringify({
  sessdata: get('SESSDATA'), bili_jct: get('bili_jct'), ac_time_value: get('ac_time_value'),
  buvid3: get('buvid3'), buvid4: get('buvid4'), dedeuserid: get('DedeUserID'),
}, null, 2));
```

So the "no-code adapter" path can end up **depending on the very tool it is compared against**.

## 3. Measured comparison (2026-10-10, same browser session)

### Bilibili — the logged-in user's following list (82 creators)

| | OpenCLI / Agent-Reach (`bili following`) | Playwright/CDP |
|---|---|---|
| Result | 82 (identical set) | 82 |
| Time | 6.1 s (6 pages) | **0.9 s** |
| Pagination | **no `--all`, no page size** → manual page loop | API `ps=50`, one loop |
| Auth | **required hand-built credential bridge** (§2) | reuses the browser, 0 steps |

### Reddit — search `openchamber`

| | OpenCLI (`opencli reddit search`) | Playwright/CDP |
|---|---|---|
| Returned | 100 (capped, see §3.1) | **237** (3 pages of 100) |
| Real OpenChamber posts | 28/57 | **57/57** |
| Time | 3.1 s | 3.8 s |

OpenCLI wins on `read` (a post thread comes back as a readable L0/L1/L2 comment tree) and on the
fixed verbs (`hot`/`popular`/`subreddit`/…), which need no login at all.

### 3.1 OpenCLI's `reddit search` does not paginate (upstream gap)

`--limit 250` returns **100**. Root cause is in the adapter, not the caller:

`clis/reddit/search.js` (identical on npm 1.8.8 and on `main`) does **one** fetch and never uses the
`after` cursor:

```js
const params = 'q=' + q + '&sort=' + sort + '&t=' + time + '&limit=' + limit + ...;
const res = await fetch(basePath + '?' + params, { credentials: 'include' });
const d = await res.json();                       // only request; no `after`
return (d?.data?.children || []).map(...)
```

**Reddit caps one listing response at 100** — the upstream owner confirms the cap in PR #1491
("Reddit's per-listing cap", where `home --limit` is validated to `[1, 100]`). The sibling adapter
`clis/reddit/subscribed.js` *does* paginate (`data.after`, `REDDIT_SUBSCRIBED_MAX_LIMIT = 1000`,
help text "(1-1000, auto-paginates)", PR #1651) — so `search` is simply inconsistent with it. The
official docs (`docs/adapters/browser/reddit.md`) document no `--after`/`--page`/`--type` option and
say nothing about `search`'s limit.

**Fix (local, non-persistent):** `opencli adapter eject reddit` then give `search.js` the same
`after` loop as `subscribed.js`:

```bash
opencli adapter eject reddit        # -> ~/.opencli/clis/reddit/*.js  (edits take effect at once)
# patch ~/.opencli/clis/reddit/search.js, then:
opencli adapter reset reddit        # revert at any time
```

Replace the single fetch with (keeping the original `.map(c => ({ id: c.data.id, ... }))` intact):

```js
const target = ${{ args.limit }};
const basePath = sub ? '/r/' + sub + '/search.json' : '/search.json';
const PAGE_SIZE = 100;
const children = [];
let after = null;
const seenCursors = new Set();
for (let pageIndex = 0; pageIndex < 20 && children.length < target; pageIndex++) {
  const pageLimit = Math.min(PAGE_SIZE, target - children.length);
  const params = 'q=' + q + '&sort=' + sort + '&t=' + time + '&limit=' + pageLimit
    + '&restrict_sr=' + (sub ? 'on' : 'off') + '&raw_json=1'
    + (after ? '&after=' + encodeURIComponent(after) : '');
  const res = await fetch(basePath + '?' + params, { credentials: 'include' });
  const d = await res.json();
  const page = d?.data?.children || [];
  for (const c of page) {
    if (children.length >= target) break;
    children.push(c);
  }
  const next = d?.data?.after ?? null;
  if (!next || children.length >= target || page.length === 0) break;
  if (seenCursors.has(next)) break;
  seenCursors.add(next);
  after = next;
}
return children.map(c => ({ id: c.data.id, /* ...unchanged... */ }));
```

After the patch: `--limit 250` → **237**, identical to Playwright; `--limit 15/100/120` still exact.

Two traps:
- The pipeline `evaluate` is a JS **template literal**. A backtick anywhere inside it (including in a
  comment) closes the string early → the module fails to load and OpenCLI **silently falls back to
  the official adapter**, so the command still "works" but returns 100 again.
- The override lives in `$HOME/.opencli/clis` (hardcoded to `os.homedir()`; **no env var**), and
  `$HOME=/root` is ephemeral here — so a redeploy drops it. Not persisted on purpose; re-apply with
  the commands above if needed.

## 4. Decision rules

- **Logged-in data, need completeness or exact fields** → Playwright/CDP.
- **A concrete turnkey verb** (`opencli <site> hot|popular|search|read|…`) → OpenCLI via
  `OPENCLI_CDP_ENDPOINT`; it is faster to write and gives stable shapes.
- **Doubt about an adapter's depth** → check the adapter's own `.js` under
  `…/@jackwener/opencli/clis/<site>/` (and `opencli adapter status`) before trusting a `--limit`.
- **CLI needs its own credential** → bridge it with `context.cookies()` (§2); don't expect
  `configure --from-browser` to read Chromium.
- **Login-free reads** (`hot`/`rank`/`popular`/`search` on Bilibili, HN, …) → adapter CLIs, no setup.

## 5. Sources

- Upstream sources fetched 2026-10-10:
  `clis/reddit/search.js`, `clis/reddit/subscribed.js`, `docs/adapters/browser/reddit.md`
  (github.com/jackwener/OpenCLI, `main`); issues/PRs #1491 (per-listing cap 100), #1651
  (`subscribed` auto-pagination, max 1000), #2559 (open; touches `reddit/search` for HTML
  classification, not pagination).
- Local package inspected: `@jackwener/opencli` 1.8.8 at `/usr/lib/node_modules/@jackwener/opencli`.
