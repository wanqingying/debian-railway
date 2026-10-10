#!/usr/bin/env node
/**
 * scripts/mcmod/rank.mjs — rank the scraped mods by the documented "worth-playing" score.
 *
 * The algorithm and the reasoning behind every weight live in docs/mcmod-db.md (§ "worth-playing
 * score"). The constants below are the executable copy — keep them in sync with that section.
 *
 *   Score = 100 * ( Σ wᵢ · minmax(log1p(xᵢ)) + 0.06 · 评分/5 )
 *
 * Usage:
 *   node scripts/mcmod/rank.mjs [--top 10] [--db data/mcmod.db] [--json]
 */
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';

export const WEIGHTS = {
  '推荐(柔率)': 0.26,   // 推荐 / 收录年数^0.5 — deliberate endorsement, softly age-normalised
  '整合包采用': 0.18,   // 被多少个整合包收录 — real adoption
  '浏览量': 0.16,       // 总浏览 — reach
  '近期热度': 0.14,     // 昨日指数 — is anyone playing it NOW
  '收藏(柔率)': 0.12,   // 收藏 / 收录年数^0.5 — retention intent
  '版本覆盖': 0.08,     // 支持的MC版本条数 — still usable today
};
export const AGE_EXPONENT = 0.5;
export const RATING_WEIGHT = 0.06;

/** Latest snapshot per mod (mod_stats is a time series, so take MAX(captured_at)). */
export function loadMods(db) {
  return db.prepare(`
    SELECT m.id, m.name, m.name_en, m.url, m.published_at, m.modpack_uses,
           s.captured_at, s.recommend, s.favorite, s.follow, s.views, s.views_display,
           s.yesterday_idx, s.rating,
           (SELECT COUNT(*) FROM mod_versions v WHERE v.mod_id = m.id) AS version_count,
           (SELECT COUNT(*) FROM mod_tags t WHERE t.mod_id = m.id)     AS tag_count
      FROM mods m
      JOIN mod_stats s ON s.mod_id = m.id
     WHERE s.captured_at = (SELECT MAX(captured_at) FROM mod_stats WHERE mod_id = m.id)
  `).all();
}

export function rank(rows, now = Date.now()) {
  const ageOf = (r) => {
    const d = r.published_at ? Date.parse(r.published_at.replace(' ', 'T') + 'Z') : NaN;
    return Number.isNaN(d) ? 4 : Math.max((now - d) / 31557600000, 0.5);
  };
  const age = new Map(rows.map((r) => [r.id, ageOf(r)]));
  const rate = (r, k) => (r[k] ?? 0) / Math.pow(age.get(r.id), AGE_EXPONENT);
  const components = {
    '推荐(柔率)': (r) => rate(r, 'recommend'),
    '整合包采用': (r) => r.modpack_uses ?? 0,
    '浏览量': (r) => r.views ?? 0,
    '近期热度': (r) => r.yesterday_idx ?? 0,
    '收藏(柔率)': (r) => rate(r, 'favorite'),
    '版本覆盖': (r) => r.version_count ?? 0,
  };
  const keys = Object.keys(WEIGHTS);
  const normalised = {};
  for (const k of keys) {
    const logged = rows.map((r) => Math.log1p(components[k](r)));
    const lo = Math.min(...logged);
    const hi = Math.max(...logged);
    normalised[k] = rows.map((r, i) => (hi > lo ? (logged[i] - lo) / (hi - lo) : 0));
  }
  return rows
    .map((r, i) => {
      const parts = Object.fromEntries(keys.map((k) => [k, 100 * WEIGHTS[k] * normalised[k][i]]));
      const score = Object.values(parts).reduce((a, b) => a + b, 0) + 100 * RATING_WEIGHT * ((Number(r.rating) || 0) / 5);
      return { ...r, age_years: age.get(r.id), parts, score: Math.round(score * 10) / 10 };
    })
    .sort((a, b) => b.score - a.score);
}

function main(argv) {
  const args = { top: 10, db: resolve('data/mcmod.db'), json: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--top') args.top = +argv[++i];
    else if (argv[i] === '--db') args.db = resolve(argv[++i]);
    else if (argv[i] === '--json') args.json = true;
    else if (argv[i] === '-h' || argv[i] === '--help') { console.log('node scripts/mcmod/rank.mjs [--top N] [--db FILE] [--json]'); return 0; }
    else { console.error(`unknown argument: ${argv[i]}`); return 2; }
  }
  const db = new DatabaseSync(args.db, { readOnly: true });
  const ranked = rank(loadMods(db)).slice(0, args.top);
  db.close();

  if (args.json) {
    console.log(JSON.stringify(ranked.map((r, i) => ({
      rank: i + 1, score: r.score, id: r.id, name: r.name, url: r.url,
      stats: { 推荐: r.recommend, 收藏: r.favorite, 关注: r.follow, 总浏览: r.views, 总浏览显示: r.views_display },
      modpack_uses: r.modpack_uses, age_years: Math.round(r.age_years * 100) / 100,
      why: Object.fromEntries(Object.entries(r.parts).map(([k, v]) => [k, Math.round(v * 10) / 10])),
    })), null, 1));
    return 0;
  }
  const keys = Object.keys(WEIGHTS);
  const short = (k) => k.replace(/\(.*\)/, '').padStart(4);
  console.log(`${'#'.padStart(2)} ${'score'.padStart(6)} | ${keys.map(short).join(' ')} | ${'mod'.padEnd(24)} ${'views'.padStart(10)} ${'age'.padStart(5)}`);
  console.log('-'.repeat(104));
  ranked.forEach((r, i) => {
    const cols = keys.map((k) => r.parts[k].toFixed(1).padStart(4)).join(' ');
    console.log(`${String(i + 1).padStart(2)} ${String(r.score).padStart(6)} | ${cols} | ${(r.name || '').slice(0, 24).padEnd(24)} ${String(r.views_display || '').padStart(10)} ${r.age_years.toFixed(1).padStart(5)}`);
  });
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main(process.argv.slice(2)));
