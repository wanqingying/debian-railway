#!/usr/bin/env node
/**
 * scripts/mcmod/import-json.mjs — one-off migration of previously scraped JSON into the SQLite DB.
 *
 * Accepts the JSON shapes the retired shell scraper produced:
 *   [ ...mod records... ]              (a bare array, e.g. tmp/mcmod-300.json)
 *   { pack: {...}, mods: [ {...} ] }   (a modpack result, if it also carries scraped mod records)
 * Derived files (rankings) are ignored — they are recomputed from the DB by rank.mjs.
 *
 * Usage: node scripts/mcmod/import-json.mjs tmp/mcmod-300.json [--db data/mcmod.db]
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openDb, saveMod, savePack, nowStamp } from './db.mjs';

const argv = process.argv.slice(2);
const files = argv.filter((a) => !a.startsWith('--') && argv[argv.indexOf(a) - 1] !== '--db');
const dbArg = argv.includes('--db') ? argv[argv.indexOf('--db') + 1] : null;

const db = openDb(dbArg ? resolve(dbArg) : undefined);
const stamp = nowStamp();
let total = 0;

for (const file of files) {
  const data = JSON.parse(readFileSync(file, 'utf8'));
  const mods = Array.isArray(data) ? data : Array.isArray(data.mods) ? data.mods : null;
  if (!mods) {
    console.error(`[import] ${file}: unrecognised shape (no mod array) — skipped`);
    continue;
  }
  let n = 0;
  for (const rec of mods) {
    if (!rec || !rec.id || !rec.name || !rec.stats) continue;   // a pack link without a scrape
    saveMod(db, rec, stamp);
    n++;
  }
  if (data.pack) savePack(db, data.pack, mods, stamp);
  total += n;
  console.error(`[import] ${file}: ${n} mods${data.pack ? ` (pack ${data.pack.id})` : ''}`);
}

const counts = db.prepare('SELECT (SELECT COUNT(*) FROM mods) mods, (SELECT COUNT(*) FROM mod_stats) stats').get();
console.error(`[import] done: imported ${total} records — DB now has ${counts.mods} mods / ${counts.stats} stat rows`);
db.close();
