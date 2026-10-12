#!/usr/bin/env node
/**
 * scripts/mcmod/export.mjs — write a canonical JSON snapshot of the mcmod dataset.
 *
 * The DB (`data/mcmod.db`) is the **working** store: queryable, updated incrementally. This snapshot is
 * the **reviewable** one — roughly 2x smaller raw and ~6x smaller once git compresses it, and its diffs
 * are readable (a binary DB's are not). `scrape.mjs` refreshes it after every successful run.
 *
 * Usage: node scripts/mcmod/export.mjs [--db data/mcmod.db] [--out data/mcmod.json]
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { nowStamp } from './db.mjs';

/** Snapshot every table, nested per mod. Returns { mods, modpacks, bytes }. */
export function exportJson(db, out) {
  const mods = db.prepare('SELECT * FROM mods ORDER BY id').all().map((m) => ({
    ...m,
    stats: db.prepare('SELECT * FROM mod_stats WHERE mod_id=? ORDER BY captured_at').all(m.id),
    tags: db.prepare('SELECT tag FROM mod_tags WHERE mod_id=? ORDER BY tag').all(m.id).map((r) => r.tag),
    authors: db.prepare('SELECT name, role FROM mod_authors WHERE mod_id=? ORDER BY name, role').all(m.id).map((r) => [r.name, r.role]),
    versions: db.prepare('SELECT loader, version FROM mod_versions WHERE mod_id=? ORDER BY loader, version').all(m.id).map((r) => [r.loader, r.version]),
  }));
  const modpacks = db.prepare('SELECT * FROM modpacks ORDER BY id').all().map((p) => ({
    ...p,
    mods: db.prepare('SELECT mod_id, version_in_pack FROM modpack_mods WHERE modpack_id=? ORDER BY rowid').all(p.id),
  }));
  const text = `${JSON.stringify({ exported_at: nowStamp(), mods, modpacks }, null, 1)}\n`;
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, text);
  return { mods: mods.length, modpacks: modpacks.length, bytes: Buffer.byteLength(text) };
}

function main(argv) {
  const args = { db: resolve('data/mcmod.db'), out: resolve('data/mcmod.json') };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--db') args.db = resolve(argv[++i]);
    else if (argv[i] === '--out') args.out = resolve(argv[++i]);
    else if (argv[i] === '-h' || argv[i] === '--help') {
      console.log('node scripts/mcmod/export.mjs [--db FILE] [--out FILE]');
      return 0;
    } else { console.error(`unknown argument: ${argv[i]}`); return 2; }
  }
  const db = new DatabaseSync(args.db, { readOnly: true });
  const r = exportJson(db, args.out);
  db.close();
  console.error(`[mcmod] exported ${r.mods} mods / ${r.modpacks} modpacks -> ${args.out} (${r.bytes} bytes)`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main(process.argv.slice(2)));
