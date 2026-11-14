# Reddit data access by driving a logged-in browser (CDP) — migration guide

**Audience:** a project that currently reads Reddit through a third-party API / scraper and wants to
switch to "drive a real, logged-in browser over CDP". **Status:** measured end-to-end 2026-10-10 in
the dev container (Chromium 154 + KasmVNC, Reddit account logged in). Companion docs:
[`interactive-browser.md`](./interactive-browser.md) (how the browser runs),
[`agent-web-access.md`](./agent-web-access.md) (adapter-CLI vs Playwright, general).

---

## 1. Why this approach exists

- **Reddit's official API is closed to new self-service users** (registration moved to manual
  approval in 2025-11); PRAW is only viable if you already hold credentials.
- **Anonymous `.json` is not an option from a datacenter IP**: every variant returns **HTTP 403**
  (anti-bot). Verified here: `curl https://www.reddit.com/search.json?q=ai` → 403.
- **Third-party APIs** add a vendor, a bill, a rate quota, and their own outages.

What *does* work, from anywhere, is a **real browser carrying a real logged-in Reddit session**. The
page's own `fetch('/search.json?…', {credentials:'include'})` is an ordinary same-site request: no
API key, no 403, full field set.

## 2. Architecture

```
  ┌──────────────────────────── container ────────────────────────────┐
  │  Chromium (KasmVNC :1)  ── CDP 127.0.0.1:9222 ──┐                  │
  │   └ logged-in reddit.com session (profile on /workspace volume)   │
  │                                                  │                │
  │  your code:  playwright-core connectOverCDP ─────┘                │
  │  or:         OPENCLI_CDP_ENDPOINT=http://127.0.0.1:9222 opencli … │
  └───────────────────────────────────────────────────────────────────┘
```

Login is done **once, by hand** (QR/password) through the HTML5 VNC view; afterwards every tool
attaches to the *same* session. One browser, many consumers.

---

## 3. Detailed steps

### 3.1 One-time: a logged-in browser

1. Start the container browser (KasmVNC + Chromium + CDP) — in this repo `scripts/start-browser.sh`
   (see `interactive-browser.md`). It exposes **CDP on `127.0.0.1:9222`** and keeps the profile on
   the volume.
2. Reach the HTML5 view over an SSH tunnel: `ssh -N -L 8444:127.0.0.1:8444 -p <PORT> root@<host>`,
   then `https://127.0.0.1:8444/vnc.html`.
3. In that browser, **log in to reddit.com once**. The session lands in the profile and survives
   redeploys.
4. Verify from inside the container:
   ```bash
   curl -s http://127.0.0.1:9222/json/version          # -> {"Browser":"Chrome/154…"}
   ```

> Any Chrome/Chromium with `--remote-debugging-port` + `--user-data-dir` works the same way; it does
> not have to be this container.

### 3.2 Path A — a minimal Playwright client (recommended for a migration)

`npm i playwright-core` (no browser download — you attach to an existing one).

```js
const { chromium } = require('playwright-core');

async function redditSearch(query, { limit = 300, sort = 'relevance' } = {}) {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const page = await browser.contexts()[0].newPage();   // new tab: don't disturb the user's tabs
  const out = [];
  let after = null;
  try {
    for (let i = 0; i < 10 && out.length < limit; i++) {
      const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}`
        + `&sort=${sort}&limit=100&raw_json=1` + (after ? `&after=${after}` : '');
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      const body = await page.evaluate(() => document.body.innerText);
      let j;
      try { j = JSON.parse(body); } catch { throw new Error('Reddit returned HTML (WAF/login wall)'); }
      if (j.error) throw new Error(`Reddit HTTP ${j.error}`);
      for (const c of j.data.children) out.push(c.data);
      after = j.data.after;
      if (!after || j.data.children.length === 0) break;
    }
  } finally {
    await page.close();
    await browser.close();
  }
  return out.slice(0, limit);
}
```

Notes that matter in production:
- **`after` is the only pagination knob**; Reddit caps **one response at 100**.
- Read through **`page.goto` to the `.json` URL** (top-level navigation) rather than `page.evaluate(fetch)`:
  cookies ride along and you sidestep CORS.
- Open a **fresh tab** and close it, so you never hijack whatever the user has open.
- The payload gives you everything: `id, title, subreddit, subreddit_name_prefixed, author, score,
  num_comments, permalink, created_utc, selftext, post_hint, preview, url_overridden_by_dest, gallery_data, …`
- Single post + comments: `https://www.reddit.com/comments/<id>.json?limit=…&raw_json=1` (a 2-element
  array: post listing, then comments) — or `opencli reddit read` (see below) which already flattens
  it into a POST/L0/L1/L2 tree.

### 3.3 Path B — OpenCLI as a turnkey CLI (no code)

`@jackwener/opencli` drives the same browser if you point it at the DevTools endpoint. **No extension
needed** (the default mode wants the Browser Bridge extension and fails here with
`Browser Bridge extension not connected`):

```bash
export OPENCLI_CDP_ENDPOINT=http://127.0.0.1:9222

opencli reddit search "openchamber" --limit 50 -f json   # search (see the pagination caveat below)
opencli reddit subreddit opencode --limit 10 -f yaml     # a subreddit's posts
opencli reddit read 1wxjlar --depth 3 -f yaml            # post + threaded comments (POST/L0/L1/L2)
opencli reddit user-posts spez --limit 10 -f json
opencli reddit whoami -f json
```

**Verb availability matrix (measured here, CDP mode):**

| command | status | note |
|---|---|---|
| `search`, `subreddit`, `subreddit-info`, `user`, `user-posts`, `whoami`, `frontpage`, `popular` | ✅ | `search` needs the patch in §4.4 to go past 100 |
| `read` | ✅ | best-in-class output: flattened comment tree, `-f yaml` is agent-friendly |
| `hot` | ❌ | returns `[]` silently — its adapter pre-navigates to the bare `reddit.com`, which redirects; upstream PR #2581 fixes exactly this. Use `frontpage`/`popular`, or Playwright |
| `subscribed` | ❌ | `HTTP 404` — **Reddit retired `/subreddits/mine/subscriptions.json`** (verified: 404 from the browser too). Not an adapter bug |
| `home`, `saved` | ⚠️ | returned empty for this account (account-dependent); `home` = personalized Best |

---

## 4. Pitfalls (all hit for real)

### 4.1 Relevance search matches comments → most hits are noise
`search.json?q=openchamber&sort=relevance` returned **237 posts**, but only **57** actually mention
"OpenChamber" in title/body — Reddit ranks a post if the term appears in its comments too. Always
post-filter (`title + selftext`, case-insensitive) before you use the result.

### 4.2 One response = at most 100 rows
Both paths must paginate on `after`. If you skip it you silently get 100 and think you have
everything.

### 4.3 Anonymous / no-session requests are 403 from a datacenter IP
Never fall back to unauthenticated `.json` from the server; it will look like a Reddit outage.

### 4.4 OpenCLI's `reddit search` does not paginate (upstream gap)
`--limit 250` returns 100. `clis/reddit/search.js` (identical on npm 1.8.8 and on `main`) does a
single `fetch` and ignores `after`, while its sibling `clis/reddit/subscribed.js` does paginate
(`REDDIT_SUBSCRIBED_MAX_LIMIT = 1000`). The upstream owner knows Reddit's per-listing cap of 100
(PR #1491 validates `home --limit` to `[1,100]`) — `search` was simply left out.

Local, reversible fix:
```bash
opencli adapter eject reddit          # -> ~/.opencli/clis/reddit/*.js (edits apply immediately)
# replace the single fetch in search.js with an after-loop (see agent-web-access.md §3.1)
opencli adapter reset reddit          # revert
```
After the patch: `--limit 250` → 237, identical to Path A; `--limit 15/100/120` still exact.
**Two traps:** (a) the pipeline `evaluate` is a JS **template literal** — a backtick inside it
(comments included) closes the string, the module fails to load, and OpenCLI **silently falls back to
the official adapter**, so you keep getting 100; (b) the override dir is `$HOME/.opencli/clis`
(hardcoded, no env var) — ephemeral unless you persist it.

### 4.5 Scores and ordering drift between runs
Reddit's relevance ranking and vote counts change minute to minute: the same query returned 32/35/36
score for one post across runs. Don't assert on scores; assert on ids.

### 4.6 Reddit can answer with HTML (WAF / login wall / rate limit)
`JSON.parse` then throws `Unexpected token '<'`. Sniff the body for HTML and classify it as
auth-vs-rate-limit instead of crashing (OpenCLI does this internally with its `LoginWallError`).

### 4.7 Session lifetime & concurrency
- One browser = effectively serial. Reddit rate-limits per session; add a small delay and back off on
  HTML responses. For throughput, run several browser profiles / containers.
- `connectOverCDP` needs the browser **running**; if it dies, reconnect (don't cache the handle).
- The login can expire: check `https://www.reddit.com/api/me.json` and re-login by hand when it says
  not-logged-in.

### 4.8 Don't scrape with a personal account
Use a dedicated/burner account (here: `CharmingTest2598`), and keep request rates low enough that the
account is never risk-flagged. Riding a real session means a ban costs that account.

---

## 5. Data conclusions (measured 2026-10-10)

Query `openchamber` on Reddit, logged-in session:

| metric | value |
|---|---|
| raw hits (`sort=relevance`) | **237** |
| posts genuinely mentioning OpenChamber | **57** (24 %) |
| top subreddits (raw) | `r/opencode` 74, `r/opencodeCLI` 66, `r/OpenChamber` 19, `r/codex` 7, `r/DeepSeek` 6, `r/LocalLLaMA` 6 |
| time span | 2018-12 → 2026-10 |
| hottest thread | "Openchamber is actually pretty good." — 251–253 score / 90 comments, `r/opencode` |

Performance:

| path | rows | wall time | requests |
|---|---|---|---|
| Playwright/CDP | 237 | **3.8 s** | 3 |
| OpenCLI (unpatched) | 100 | 3.1 s | 1 |
| OpenCLI (patched) | 237 | 5.6 s | 3 |

Fields: raw `.json` gives the full Reddit payload; OpenCLI surfaces 13 columns
(`id, title, subreddit, author, score, comments, url, created_utc, selftext, post_hint,
url_overridden_by_dest, preview_image_url, gallery_urls`). For discussion text, `read` yields a
flattened `POST/L0/L1/L2` tree — far cheaper than parsing the raw comment payload yourself.

---

## 6. Migration checklist for the calling project

1. **Wrap it behind one interface** — e.g. `reddit.search(q, {limit,sort})`, `reddit.post(id)`,
   `reddit.subreddit(name)` — so call sites never see CDP.
2. **Move auth out of the app**: the browser holds the session; the app only knows the CDP endpoint.
   Config: `REDDIT_CDP_ENDPOINT` (default `http://127.0.0.1:9222`).
3. **Implement pagination on `after`** in the client (not the caller).
4. **Post-filter by relevance** if the consumer expects "posts about X" (§4.1).
5. **Classify failures**: not-logged-in vs rate-limited/WAF vs empty — and surface them distinctly
   (your old API client had HTTP codes; reproduce that vocabulary).
6. **Retry policy**: reconnect the CDP handle on failure; back off on HTML responses; never hammer.
7. **Observability**: log per-call `{query, pages, rows, elapsedMs, lastAfter, outcome}` — this is
   what makes a browser-driven reader debuggable.
8. **Keep a fallback** for when the browser is unavailable (cache last results; if you still hold
   official API credentials, that stays the sanctioned path).
9. **Decide scope**: if you only need a handful of verbs, the CLI form (§3.3) replaces a lot of code;
   if you need arbitrary fields and completeness, Path A (§3.2) is the honest minimum.

## 7. Reference

- Working scripts from the session that produced this doc: `reddit.cjs` (paginated search over CDP),
  `reddit-endpoints.cjs` (endpoint probe).
- Upstream evidence: OpenCLI `clis/reddit/search.js` (no `after`), `clis/reddit/subscribed.js`
  (auto-paginates, max 1000), PRs #1491 / #1651 / #2559; Reddit `/subreddits/mine/subscriptions.json`
  now 404s.
- Local package inspected: `@jackwener/opencli` 1.8.8.
