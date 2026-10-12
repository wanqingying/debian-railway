# mcmod dataset — storage and schema

## Two artefacts

| file | role | size (515 mods) | git (zlib) |
|---|---|---|---|
| `data/mcmod.db` | the **working** store — queryable, updated incrementally | 1.199 MB | 0.381 MB |
| `data/mcmod.json` | the **reviewable** snapshot written by `export.mjs` | 1.211 MB | **0.102 MB** |

Raw they are a wash, but **git compresses the JSON 3.7x better** (key repetition is highly
compressible, SQLite pages are not), and a JSON diff is readable while a binary DB's is not. Both are
committed: the DB for querying, the snapshot for review and rebuild. `scrape.mjs` rewrites the snapshot
after every successful run.

## Schema

The scraped mcmod.cn data lives in **`data/mcmod.db`** (SQLite, committed to git so the dataset is
versioned and shareable). It is written by [`scripts/mcmod/scrape.mjs`](../scripts/mcmod/scrape.mjs)
and read by [`scripts/mcmod/rank.mjs`](../scripts/mcmod/rank.mjs); the access layer is
[`scripts/mcmod/db.mjs`](../scripts/mcmod/db.mjs).

- **No dependencies** — `node:sqlite` (Node ≥ 22.5; this container has v24).
- **The DDL in `db.mjs` is the executable copy; this file is the documented copy.** Change both together.
- **WAL is on** (`journal_mode = WAL`) so a second process can read while a scrape is writing — that is
  how progress is reported. WAL creates `-wal`/`-shm` sidecars; run `PRAGMA wal_checkpoint(TRUNCATE)`
  before committing the `.db` (the sidecars should not be committed).

```
                 ┌────────────────────────── mods ──────────────────────────┐
                 │ id (PK)  name  name_en  short_name  status  url           │
                 │ platform run_mode run_env published_at edit_count          │
                 │ last_edit_at last_rec_at modpack_uses license             │
                 │ first_seen_at updated_at                                  │
                 └───┬───────────┬────────────┬────────────┬─────────────────┘
                     │ 1:N       │ 1:N        │ 1:N        │ 1:N
        mod_stats ───┘   mod_tags ┘  mod_authors ┘   mod_versions
      (time series)       (tag)        (name, role)   (loader, version)

   modpacks (id PK, name, url, mod_count, fetched_at) ──1:N──> modpack_mods
                                                    (modpack_id, mod_id, version_in_pack)

   runs (id PK, kind, target, status, total, done, started_at, updated_at, note)   ← progress
```

## Tables

| table | purpose | key |
|---|---|---|
| `mods` | one row per mod: identity + slowly-changing metadata | `id` = mcmod class id (text) |
| `mod_stats` | **time series** of interaction counts (they only grow — history is the point) | `(mod_id, captured_at)` |
| `mod_tags` | 模组标签 | `(mod_id, tag)` |
| `mod_authors` | 作者团队 with role (所有者 / 美术 / Mod作者 …) | `(mod_id, name, role)` |
| `mod_versions` | 支持的MC版本, one row per (loader, version) | `(mod_id, loader, version)` |
| `modpacks` | one row per modpack we resolved | `id` = mcmod modpack id |
| `modpack_tags` | 整合包标签 | `(modpack_id, tag)` |
| `modpack_texts` | every prose/tab section of a pack page (前言 / 模组列表 / 教程 …) | `(modpack_id, section)` |
| `modpack_authors` | 整合包制作团队, one row per (name, role) | `(modpack_id, name, role)` |
| `modpack_versions` | the MC versions a pack supports, per loader | `(modpack_id, loader, version)` |
| `modpack_mods` | pack membership + the version pinned inside that pack | `(modpack_id, mod_id)` |
| `runs` | scrape-run log and live progress, so a background scrape can be monitored | `id` autoincrement |

### Column notes

**`mods`**

| column | source on the page | notes |
|---|---|---|
| `id` | `/class/<id>.html` | text, not integer — mcmod ids are opaque |
| `name` / `name_en` / `short_name` | `.class-title h3` / `h4` / `.short-name` | e.g. `Iron的法术与魔法书` / `Iron's Spells 'n Spellbooks` / `[ISS]` |
| `status` | `.class-status` | 活跃 / 停止更新 … |
| `platform` / `run_mode` / `run_env` | `支持平台` / `运作方式` / `运行环境` rows | display text, e.g. `客户端需装, 服务端需装` |
| `published_at` | `收录时间` `data-original-title` | **exact** timestamp (`YYYY-MM-DD HH:MM:SS`), not the "3年前" display form |
| `edit_count` | `编辑次数` | integer parsed out of `"107次"`; null when absent |
| `last_edit_at` / `last_rec_at` | `最后编辑` / `最后推荐` exact timestamps | maintenance-activity signal |
| `modpack_uses` | `N 个已收录的整合包` | integer; **null when the mod has none** (which is not the same as zero) |
| `license` | `.class-license-list` | free text |
| `first_seen_at` / `updated_at` | — | set by the scraper; `first_seen_at` is preserved across re-scrapes |

**`mod_stats`** — one row per scrape of a mod (`captured_at` at second granularity, so re-scraping
within the same second updates in place):

| column | source | notes |
|---|---|---|
| `recommend` / `favorite` / `follow` | `li.push/like/subscribe` → `.nums[title]` | **login-gated** (null on an anonymous session) |
| `views` / `views_display` | `.infos .span[title]` | `views` = exact integer, `views_display` = e.g. `973.75万`; **public** |
| `yesterday_idx` / `avg_idx` | `.class-excount .text` | mcmod's own 昨日指数 / 昨日平均指数 |
| `rating` | `.class-excount .star .up` | 0–5 in 0.5 steps; **43% of mods are 5.0**, so it discriminates poorly |
| `fill_rate` | `资料填充率` | text, e.g. `100.00%` |

**`modpacks`** — the pack's own metadata. A pack page carries **two independent interaction counts**:
the site's own 投票 (`votes_for`/`votes_against`) *and* the user action bar's 推荐/收藏, which is the
**same login-gated `common-fuc-group` a mod page has** — but a pack has no 关注, only 分享.

| column | source on the page | notes |
|---|---|---|
| `id` | `/modpack/<id>.html` | **a separate id namespace from `/class/<id>`** — the two collide (7 ids exist as both) |
| `name` / `name_en` / `short_name` | `.class-title h3` / `h4` / `.short-name` | e.g. `匠造之传` / `The Legend of Tinker` / `[TLT]` |
| `pack_type` / `run_mode` / `pack_method` | `整合包类型` / `运作方式` / `打包方式` rows | e.g. `魔改整合` / `Forge` / `CurseForge托管 , 其他启动器打包` |
| `published_at` / `last_edit_at` / `last_rec_at` | `收录时间` / `最后编辑` / `最后推荐` | exact timestamps from `data-original-title` |
| `votes_for` / `votes_against` | `data-original-title="<n>票"` | the site's approval votes (e.g. `150` : `8`) |
| `rating` / `rating_label` | `.class-excount .star .up` / `.down` | 0–5 plus mcmod's grade for it (闻所未闻 0.5 … 名扬天下 5.0) |
| `yesterday_idx` | `.class-excount .text` | mcmod's 昨日指数 — the daily activity index |
| `avg_idx` | `.class-excount .text` | 昨日平均指数 — **a site-wide constant, not a per-pack value** (packs `81.585`, mods `40.28`); kept only as the index's baseline |
| `recommend` / `favorite` | `li.push` / `li.like` → `.nums[title]` | **login-gated** — the whole bar is absent anonymously |
| `views` / `views_display` | `.infos .span[title]` | exact integer + the `97.03万` display form; public |
| `description` | the first `text-area` that is not the mod list | the section's own heading is stripped (it is in `modpack_texts.title`) |
| `mod_count` | — | number of members **parsed**; `0` when the page renders no list (44 of 300) |

## DDL

```sql
CREATE TABLE IF NOT EXISTS mods (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  name_en       TEXT,
  short_name    TEXT,
  status        TEXT,
  url           TEXT,
  platform      TEXT,
  run_mode      TEXT,
  run_env       TEXT,
  published_at  TEXT,
  edit_count    INTEGER,
  last_edit_at  TEXT,
  last_rec_at   TEXT,
  modpack_uses  INTEGER,
  license       TEXT,
  first_seen_at TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mod_stats (
  mod_id        TEXT NOT NULL REFERENCES mods(id) ON DELETE CASCADE,
  captured_at   TEXT NOT NULL,
  recommend     INTEGER,
  favorite      INTEGER,
  follow        INTEGER,
  views         INTEGER,
  views_display TEXT,
  yesterday_idx INTEGER,
  avg_idx       REAL,
  rating        REAL,
  fill_rate     TEXT,
  PRIMARY KEY (mod_id, captured_at)
);

CREATE TABLE IF NOT EXISTS mod_tags (
  mod_id TEXT NOT NULL REFERENCES mods(id) ON DELETE CASCADE,
  tag    TEXT NOT NULL,
  PRIMARY KEY (mod_id, tag)
);

CREATE TABLE IF NOT EXISTS mod_authors (
  mod_id TEXT NOT NULL REFERENCES mods(id) ON DELETE CASCADE,
  name   TEXT NOT NULL,
  role   TEXT,
  PRIMARY KEY (mod_id, name, role)
);

CREATE TABLE IF NOT EXISTS mod_versions (
  mod_id  TEXT NOT NULL REFERENCES mods(id) ON DELETE CASCADE,
  loader  TEXT NOT NULL,
  version TEXT NOT NULL,
  PRIMARY KEY (mod_id, loader, version)
);

CREATE TABLE IF NOT EXISTS modpacks (
  id            TEXT PRIMARY KEY,
  name          TEXT,
  name_en       TEXT,
  short_name    TEXT,
  url           TEXT,
  pack_type     TEXT,
  run_mode      TEXT,
  pack_method   TEXT,
  published_at  TEXT,
  last_edit_at  TEXT,
  last_rec_at   TEXT,
  edit_count    INTEGER,
  votes_for     INTEGER,
  votes_against INTEGER,
  views         INTEGER,
  views_display TEXT,
  recommend     INTEGER,
  favorite      INTEGER,
  rating        REAL,
  rating_label  TEXT,
  yesterday_idx INTEGER,
  avg_idx       REAL,
  description   TEXT,
  mod_count     INTEGER,
  fetched_at    TEXT
);

CREATE TABLE IF NOT EXISTS modpack_tags (
  modpack_id TEXT NOT NULL REFERENCES modpacks(id) ON DELETE CASCADE,
  tag        TEXT NOT NULL,
  PRIMARY KEY (modpack_id, tag)
);

CREATE TABLE IF NOT EXISTS modpack_texts (
  modpack_id TEXT NOT NULL REFERENCES modpacks(id) ON DELETE CASCADE,
  section    TEXT NOT NULL,
  title      TEXT,
  text       TEXT,
  PRIMARY KEY (modpack_id, section)
);

CREATE TABLE IF NOT EXISTS modpack_authors (
  modpack_id TEXT NOT NULL REFERENCES modpacks(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  role       TEXT,
  PRIMARY KEY (modpack_id, name, role)
);

-- The MC versions a pack supports, per loader family (e.g. Forge -> 1.20.1).
CREATE TABLE IF NOT EXISTS modpack_versions (
  modpack_id TEXT NOT NULL REFERENCES modpacks(id) ON DELETE CASCADE,
  loader     TEXT NOT NULL,
  version    TEXT NOT NULL,
  PRIMARY KEY (modpack_id, loader, version)
);

CREATE TABLE IF NOT EXISTS modpack_mods (
  modpack_id      TEXT NOT NULL REFERENCES modpacks(id) ON DELETE CASCADE,
  mod_id          TEXT NOT NULL,
  version_in_pack TEXT,
  PRIMARY KEY (modpack_id, mod_id)
);

CREATE TABLE IF NOT EXISTS runs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT NOT NULL,      -- mod | list | modpack
  target     TEXT,               -- the list URL / class/<id> / modpack/<id>
  status     TEXT NOT NULL,      -- running | done | failed
  total      INTEGER NOT NULL DEFAULT 0,
  done       INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  note       TEXT
);

-- No secondary indexes: every access path filters on the leading column of a primary key (mod_stats and
-- mod_versions by mod_id, modpack_mods by modpack_id), which the primary key's automatic index already
-- covers. Extra indexes would only duplicate it — and they accounted for ~15% of the file.
DROP INDEX IF EXISTS idx_mod_stats_mod;
DROP INDEX IF EXISTS idx_mod_versions_mod;
DROP INDEX IF EXISTS idx_modpack_mods_pack;
```

`PRAGMA foreign_keys = ON` and `PRAGMA busy_timeout = 5000` are set on every connection by `openDb()`.
After a schema change, `VACUUM` reclaims the freed pages (SQLite does not shrink a file on its own).

## Querying

There is no `sqlite3` CLI in this image; use Node (which also guarantees the same `node:sqlite`
build that wrote the file):

```bash
# counts per table
node -e "const{DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('data/mcmod.db');
for(const t of ['mods','mod_stats','mod_tags','mod_authors','mod_versions','modpacks','modpack_mods','runs'])
  console.log(t, d.prepare('select count(*) c from '+t).get().c)"

# latest snapshot of one mod
node -e "const{DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('data/mcmod.db');
console.log(d.prepare('select * from mod_stats where mod_id=? order by captured_at desc limit 1').get('10175'))"

# the mods of a modpack, with the version pinned in the pack
node -e "const{DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('data/mcmod.db');
console.log(d.prepare('select m.name, p.version_in_pack from modpack_mods p join mods m on m.id=p.mod_id where p.modpack_id=?').all('684').slice(0,5))"

# watch a running scrape
node -e "const{DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('data/mcmod.db');
console.log(d.prepare('select * from runs order by id desc limit 3').all())"

# the ranking (algorithm: docs/mcmod-stats.md § Worth-playing score)
node scripts/mcmod/rank.mjs --top 30
```

## Notes and gotchas

- **Re-scraping is additive.** A new scrape inserts a new `mod_stats` row and updates `mods` in place,
  so the DB accumulates a usable history of the counts. `first_seen_at` is never overwritten.
- **`modpack_uses` is a proxy with a known bias** — it counts "picked into a curated modpack", which is
  unfair to total-conversion/adventure mods. See the ranking section for how that is handled.
- **A modpack page lists its mods server-rendered** (265 on pack 684), each with the version pinned in
  the pack; `modpack_mods` stores that pin.
- **Only scraped mods become rows.** `modpack_mods.mod_id` is deliberately not a foreign key: a pack
  membership is recorded even for mods we have not scraped yet, so a pack's member list does **not**
  imply the member has `mod_stats`. After the 300-pack scrape only 441 of 8,246 distinct member mods had
  counts; backfilling means scraping those ids (`--mod`) — members carry their own 推荐/收藏 like any mod.
- **`status='interrupted'` in `runs`** marks a run whose process was killed; `scrape.mjs` sets it at
  startup (`interruptStaleRuns`) so `status='running'` reliably means "a scrape is live now".
