# mcmod.cn — scraping and ranking

Reads mod data from [mcmod.cn](https://www.mcmod.cn) into the SQLite dataset `data/mcmod.db`, and ranks
it. Everything runs **inside this container** and drives the **visible** Chromium (KasmVNC display `:1`,
DevTools on `127.0.0.1:9222`) — never a headless browser and never a second browser, so you can watch
the pages open in the VNC view.

| file | role |
|---|---|
| [`scripts/mcmod/db.mjs`](../scripts/mcmod/db.mjs) | schema + access layer (`node:sqlite`) |
| [`scripts/mcmod/scrape.mjs`](../scripts/mcmod/scrape.mjs) | fetch mods → DB (single / list / modpack) |
| [`scripts/mcmod/rank.mjs`](../scripts/mcmod/rank.mjs) | the "worth-playing" ranking over the DB |
| [`scripts/mcmod/import-json.mjs`](../scripts/mcmod/import-json.mjs) | one-off migration of old JSON scrapes |
| [`scripts/mcmod/export.mjs`](../scripts/mcmod/export.mjs) | DB → `data/mcmod.json` (the reviewable snapshot; `scrape.mjs` refreshes it automatically) |
| [`docs/mcmod-db.md`](./mcmod-db.md) | **the schema: DDL + column comments + query examples** |

## Usage

```bash
# scrape
node scripts/mcmod/scrape.mjs --count 300        # first 300 mods of the default 1.18.2 / Java list
node scripts/mcmod/scrape.mjs --index 1          # 1st mod of that list
node scripts/mcmod/scrape.mjs --mod 10175        # one mod (id or /class/<id>.html URL)
node scripts/mcmod/scrape.mjs --modpack 684      # every mod of a modpack (id or URL)

# rank (reads data/mcmod.db)
node scripts/mcmod/rank.mjs --top 30
node scripts/mcmod/rank.mjs --top 10 --json
```

Options: `--list <url>` (a different `modlist.html`), `--batch N` (mods per group, default 25),
`--concurrency N` (parallel fetches, default 6), `--db <file>`, `--no-export`.

Every successful scrape also rewrites **`data/mcmod.json`**, a canonical snapshot of the DB — see
[`mcmod-db.md`](./mcmod-db.md) § "Two artefacts".

## Requirements

1. **A running container browser.** Start it with `scripts/start-browser.sh` (it is started at boot
   unless `BROWSER_ENABLE=0`). The scraper connects to `127.0.0.1:9222` over CDP; if that is down, start
   the browser first.
2. **`playwright-core`** — `npm install` (there is a `package.json`; no browser download, we attach to
   the existing one).
3. **A signed-in mcmod.cn session** — see below.

## Why node + `playwright-core` (not the CLI)

The earlier implementation shelled out to `playwright-cli`; each invocation costs **~750 ms** (client
startup + daemon round-trip), which dominated everything. Connecting with `playwright-core` over CDP
takes **125 ms** and gives real control — including **timeouts**, which is what actually matters:

> **The one bug that made a run hang for 464 s**: `page.context().request.get(url)` has **no default
> timeout**, so one wedged mcmod response hung the whole batch forever. Every call in `scrape.mjs` now
> carries an explicit timeout (`T` in the file), and the fetch retries.

## The four counts are login-gated; 总浏览 is not

Verified by comparing the same page anonymous vs signed in:

| session | `.common-fuc-group` action bar | 总浏览 |
|---|---|---|
| anonymous | **absent from the DOM** (`收藏` occurs 0 times) | present |
| signed in | present, with numbers | present |

So **log in to mcmod.cn once in the container browser** (VNC view → `https://127.0.0.1:8444/vnc.html`).
The login lives in the on-volume profile (`/workspace/.opencode/config/chrome-profile`) and survives a
redeploy. If `推荐/收藏/关注` come back null the scraper logs
`WARNING: … the browser session is not signed in`.

## DOM recipe

| field | where |
|---|---|
| 推荐 / 收藏 / 关注 | `div.common-fuc-group > ul > li` → `.action span` (label) + **sibling** `div.nums[title]` (exact value) |
| 总浏览 | `div.infos .span[title]` → `title` = exact integer, `.n` = display (`973.75万`) |
| name / en / short / status | `div.class-title` → `h3` / `h4` / `.short-name` / `.class-status` |
| 支持平台 / 运作方式 / 运行环境 / 收录时间 / 编辑次数 / 最后编辑 / 最后推荐 | `.class-info-left > ul > li.col-lg-4` (label `:` value; `data-original-title` holds the exact timestamp) |
| 模组标签 | `.class-info-left li.tag ul li a` |
| 作者团队 | `.class-info-left li.author .frame ul li` → `.member .name` + `.member .position` |
| 支持的MC版本 | `.class-info-left li.mcver .platform-block` → `.mcver-title` (loader) + `.mcver-row` links |
| 整合包使用数 | `.class-info-left li.modpack` |
| 评分 / 昨日指数 | `.class-excount`, `.star .up`, `.text` |
| **modpack members** | `<a data-original-title="Name (En)" href="/class/<id>.html">…</a></p><p>version</p>` — server-rendered |

The `li` classes matter: `col-lg-4` are the simple label/value rows; `col-lg-12` are the complex ones
(author / tag / mcver / modpack), so the generic loop only parses `col-lg-4`.

## Pitfalls hit while building this (all real)

1. **Ad iframes hijack the top-level navigation.** mcmod's Google ads navigate the top frame, aborting
   our own navigation (`Navigation … is interrupted by another navigation to https://googleads…`), so
   the page never becomes the list. Fixed by launching Chromium with `--host-resolver-rules` mapping the
   ad hosts to `0.0.0.0` (`BROWSER_BLOCK_HOSTS` in `start-browser.sh`). Run time went from "never" to
   seconds.
2. **Ad iframes exhaust the container's process budget.** One mcmod page held **26 CDP targets**, most of
   them ad iframes; `pids.current` reached 825/1000 and Chromium could no longer `fork()`
   (`pthread_create: Resource temporarily unavailable`, `Zygote could not fork`) — which shows up as a
   **CDP handshake that connects and then times out**. Looks like a Playwright bug; it is process
   exhaustion. Blocking the ad hosts prevents it.
3. **A request without a timeout hangs the whole run** (the 464 s incident above).
4. **`setContent` + aborting sub-resources is the fast path.** The counts are in the server-rendered HTML
   string, so a fetch + `setContent` + `evaluate` beats a full page load per mod — and it cannot be
   hijacked by ads. Single-mod scrapes still `goto` (so you can watch them).
5. **The list's first slot is a promoted / rotating placement.** `modlist.html?mcver=1.18.2&platform=1`
   returned Iron's Spells first at one point and Bigger Stacks first an hour later, with everything after
   unchanged. **"The first mod" is not a stable identifier.**
6. **Closing the browser's last tab exits Chromium** (the VNC display survives), so `start-browser.sh`
   checks the browser and the display separately.

## Background runs and progress

A scrape writes a row to `runs` (`status`, `total`, `done`, `note` = the mod currently saving,
`updated_at`) on **every** mod, and logs one line per mod. A second process can therefore watch it:

```bash
# start it detached
node scripts/mcmod/scrape.mjs --modpack 684 --batch 25 >/tmp/mcmod.log 2>&1 &

# report progress (safe to run while the scrape writes: WAL)
node -e "const{DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('data/mcmod.db',{readOnly:true});
console.log(d.prepare('select * from runs order by id desc limit 1').get())"
tail -3 /tmp/mcmod.log
```

Measured: **265 mods of modpack 684 in 145 s** (≈1.8 mods/s), 0 empty pages; **300 list mods in 133 s**.

## Browser vs websearch

| | browser (these scripts) | `websearch` |
|---|---|---|
| result | all four counts + full metadata | **0/4** |
| why | a real, signed-in page — the numbers are in the DOM | search engines do not index these numbers |

## Worth-playing score

`rank.mjs` turns the dataset into a "most worth playing" ranking. It is deliberately transparent rather
than a black box:

```
Score = 100 × ( Σ wᵢ · minmax(log1p(xᵢ)) + 0.06 · 评分/5 )
```

| component xᵢ | weight | what it proxies |
|---|---|---|
| `推荐 / 收录年数^0.5` | 0.26 | deliberate endorsement, gently age-normalised |
| `整合包使用数` | 0.18 | real adoption — chosen into curated modpacks |
| `总浏览` | 0.16 | reach |
| `昨日指数` | 0.14 | current activity |
| `收藏 / 收录年数^0.5` | 0.12 | retention intent |
| `支持的MC版本条数` | 0.08 | still usable today |
| `评分/5` | 0.06 | coarse quality prior |

Every component is `log1p`'d then min–max normalised **across the sample**, so one outlier (a mod with
14 238 recommendations) cannot dominate.

### Why these choices (each backed by a measurement)

- **Never count the same popularity signal twice.** Spearman on the 300-mod sample: 收藏↔关注 **0.95**,
  收藏↔总浏览 **0.94**, 关注↔总浏览 **0.95** — one signal wearing three names. 推荐 is the independent one
  (0.65 vs 收藏). That is why 关注 is not a separate term, and why adding 总浏览 cut 收藏 from 0.20 to 0.12
  instead of stacking.
- **Age-normalise, but gently.** Counts only accumulate, so a raw ranking degenerates into an "oldest
  mods" list. Dividing by the *full* age is too harsh — 工业时代2 (13.9 y) fell to #16 — while `age^0.5`
  moves it to #8, and `age^0.25` keeps it there (the ranking is stable across that range).
- **`整合包使用数` is a proxy with a known bias.** It measures "picked into curated modpacks", which is
  fair to libraries and unfair to total-conversion/adventure mods (虚无世界3 is in only 17 packs despite
  the highest 推荐 in the sample). So it sits **second**, not first.
- **`评分` barely discriminates** — 43 % of mods are 5.0 — so it acts as a small prior, not a scorer.

### Limitations

1. **It ranks whatever is in the DB.** Currently 515 mods (the first 300 of one 1.18.2 list + modpack 684
   with all 265 of its members) — **not a site-wide (7625-mod) ranking**. `--count 7625` is possible but
   takes ~70 min.
2. **`整合包使用数` under-rates total-conversion mods** (mitigated by the weight order, not removed).
3. **`评分` and `昨日指数` are mcmod's own opaque metrics.**
4. **The weights are a judgement call, not a fitted model** — there is no ground-truth "worth playing"
   label to fit against.

### Where the goods are

Tools/utilities and content mods interleave in the ranking because "installed by everyone" (JEI: 699
modpacks; 玉 🔍: 547; 鼠标手势、苹果皮: ~800) is not the same as "worth playing". If you want a
content-only list, filter on the tag tables (`mod_tags`) or on 推荐/收藏 ratio.

## Verified numbers

2026-10-10, signed in. `data/mcmod.db` holds 515 mods / 565 stat rows / 1431 tags / 1408 authors /
15 572 version rows / 1 modpack (684, 265 members).

| # | mod | 推荐 | 收藏 | 关注 | 总浏览 |
|---|---|---|---|---|---|
| 1 | 机械动力 | 7718 | 6343 | 1511 | 1614.11万 |
| 2 | 暮色森林 | 2578 | 6851 | 930 | 2172.83万 |
| 3 | 应用能源2 | 3271 | 3420 | 530 | 1484.77万 |
| — | `[ISS] Iron的法术与魔法书` (10175) | 1523 | 2229 | 204 | 973.78万 |
| — | `Sooty Chimneys` (9655) | 13 | 129 | 5 | 2.40万 — matches the reference screenshot |

## Related

- [`mcmod-db.md`](./mcmod-db.md) — the schema (DDL + column comments), query examples.
- [`interactive-browser.md`](./interactive-browser.md) — how the container browser runs and how to reach it.
- [`agent-web-access.md`](./agent-web-access.md) — driving logged-in sites: adapter CLIs vs Playwright/CDP.
- [`reddit-data-access.md`](./reddit-data-access.md) — the same "drive a logged-in browser" pattern for Reddit.
