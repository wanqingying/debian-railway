/**
 * SQLite storage for the mcmod dataset — node:sqlite, no dependencies.
 *
 * The DDL in this file is the EXECUTABLE copy; docs/mcmod-db.md is the DOCUMENTED copy (column
 * comments, relationships, example queries). Change both together.
 *
 * Design: `mods` holds identity + slow-changing metadata, `mod_stats` is an append-only time series
 * (the counts only grow, so history is the point), and the multi-valued attributes live in their own
 * tables. A `runs` table records scrape progress, which lets a second process report on a scrape
 * that is running in the background.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export const DDL = `
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
  id         TEXT PRIMARY KEY,
  name       TEXT,
  url        TEXT,
  mod_count  INTEGER,
  fetched_at TEXT
);

CREATE TABLE IF NOT EXISTS modpack_mods (
  modpack_id      TEXT NOT NULL REFERENCES modpacks(id) ON DELETE CASCADE,
  mod_id          TEXT NOT NULL,
  version_in_pack TEXT,
  PRIMARY KEY (modpack_id, mod_id)
);

CREATE TABLE IF NOT EXISTS runs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT NOT NULL,
  target     TEXT,
  status     TEXT NOT NULL,
  total      INTEGER NOT NULL DEFAULT 0,
  done       INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  note       TEXT
);

-- No secondary indexes. Every access path we use filters on the leading column of a primary key, whose
-- automatic index already covers it: mod_stats and mod_versions by mod_id, modpack_mods by modpack_id.
-- Anything else just duplicating that index ~15% of the file (the version matrix dominates it).
-- The DROP statements retire the redundant indexes from databases created before this change.
DROP INDEX IF EXISTS idx_mod_stats_mod;
DROP INDEX IF EXISTS idx_mod_versions_mod;
DROP INDEX IF EXISTS idx_modpack_mods_pack;
`;

/** `YYYY-MM-DD HH:MM:SS` in UTC — sortable, readable, and identical in SQL and JS. */
export function nowStamp() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

export function openDb(file = process.env.MCMOD_DB || resolve('data/mcmod.db')) {
  mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');      // lets another process read while a scrape writes
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(DDL);
  return db;
}

const nn = (v) => (v === undefined ? null : v);   // SQLite cannot bind `undefined`
const exact = (v) => nn(v && typeof v === 'object' ? v['精确'] : v);
const shown = (v) => nn(v && typeof v === 'object' ? v['显示'] : v);
const int = (v) => (Number.isFinite(+v) ? Math.trunc(+v) : null);

/**
 * Upsert one scraped mod: identity/metadata into `mods`, a timestamped row into `mod_stats`, and a
 * fresh set of tags/authors/versions (all three are replaced, so a mod edit is reflected).
 */
export function saveMod(db, r, capturedAt = nowStamp()) {
  const info = r.info || {};
  const s = r.stats || {};
  const x = r.index || {};
  const id = String(r.id);
  const versions = info['支持的MC版本'] || {};

  db.prepare(`INSERT INTO mods (id,name,name_en,short_name,status,url,platform,run_mode,run_env,
      published_at,edit_count,last_edit_at,last_rec_at,modpack_uses,license,first_seen_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, name_en=excluded.name_en, short_name=excluded.short_name, status=excluded.status,
      url=excluded.url, platform=excluded.platform, run_mode=excluded.run_mode, run_env=excluded.run_env,
      published_at=excluded.published_at, edit_count=excluded.edit_count, last_edit_at=excluded.last_edit_at,
      last_rec_at=excluded.last_rec_at, modpack_uses=excluded.modpack_uses, license=excluded.license,
      updated_at=excluded.updated_at`)
    .run(id, r.name || '', r.enName || null, r.shortName || null, r.status || null, r.url || null,
      shown(info['支持平台']), shown(info['运作方式']), shown(info['运行环境']),
      exact(info['收录时间']), int(String(info['编辑次数'] ?? '').replace(/[^0-9]/g, '') || null),
      exact(info['最后编辑']), exact(info['最后推荐']),
      Number.isFinite(+info['整合包使用数']) ? +info['整合包使用数'] : null,
      shown(info['协议']), capturedAt, capturedAt);

  db.prepare(`INSERT INTO mod_stats (mod_id,captured_at,recommend,favorite,follow,views,views_display,
      yesterday_idx,avg_idx,rating,fill_rate) VALUES (?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(mod_id,captured_at) DO UPDATE SET
      recommend=excluded.recommend, favorite=excluded.favorite, follow=excluded.follow,
      views=excluded.views, views_display=excluded.views_display, yesterday_idx=excluded.yesterday_idx,
      avg_idx=excluded.avg_idx, rating=excluded.rating, fill_rate=excluded.fill_rate`)
    .run(id, capturedAt, int(s['推荐']), int(s['收藏']), int(s['关注']), int(s['总浏览']), s['总浏览显示'] || null,
      int(x['昨日指数']), x['昨日平均指数'] != null ? +x['昨日平均指数'] : null,
      x['评分'] != null ? +x['评分'] : null, x['资料填充率'] || null);

  db.prepare('DELETE FROM mod_tags WHERE mod_id=?').run(id);
  for (const tag of info['模组标签'] || [])
    db.prepare('INSERT OR IGNORE INTO mod_tags (mod_id,tag) VALUES (?,?)').run(id, tag);

  db.prepare('DELETE FROM mod_authors WHERE mod_id=?').run(id);
  for (const a of info['作者团队'] || [])
    db.prepare('INSERT OR IGNORE INTO mod_authors (mod_id,name,role) VALUES (?,?,?)').run(id, a.name, a.role ?? null);

  db.prepare('DELETE FROM mod_versions WHERE mod_id=?').run(id);
  for (const [loader, list] of Object.entries(versions))
    for (const v of list)
      db.prepare('INSERT OR IGNORE INTO mod_versions (mod_id,loader,version) VALUES (?,?,?)')
        .run(id, loader.trim(), v);

  return id;
}

export function savePack(db, pack, mods, fetchedAt = nowStamp()) {
  db.prepare(`INSERT INTO modpacks (id,name,url,mod_count,fetched_at) VALUES (?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, url=excluded.url, mod_count=excluded.mod_count,
      fetched_at=excluded.fetched_at`)
    .run(String(pack.id), pack.name || null, pack.url || null, pack.modCount ?? mods.length, fetchedAt);
  db.prepare('DELETE FROM modpack_mods WHERE modpack_id=?').run(String(pack.id));
  for (const m of mods)
    db.prepare('INSERT OR IGNORE INTO modpack_mods (modpack_id,mod_id,version_in_pack) VALUES (?,?,?)')
      .run(String(pack.id), String(m.id), m.version ?? null);
}

export function startRun(db, kind, target, total) {
  const r = db.prepare(`INSERT INTO runs (kind,target,status,total,done,started_at,updated_at)
    VALUES (?,?, 'running', ?, 0, ?, ?)`).run(kind, target ?? null, total ?? 0, nowStamp(), nowStamp());
  return Number(r.lastInsertRowid);
}

export function progressRun(db, runId, done, total, note = null) {
  db.prepare('UPDATE runs SET done=?, total=?, updated_at=?, note=? WHERE id=?')
    .run(done, total, nowStamp(), note, runId);
}

export function finishRun(db, runId, status, note = null) {
  db.prepare('UPDATE runs SET status=?, updated_at=?, note=? WHERE id=?').run(status, nowStamp(), note, runId);
}
