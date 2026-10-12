#!/usr/bin/env node
/**
 * scripts/mcmod/rank-packs.mjs — "most worth playing" ranking over the scraped modpacks.
 *
 * Six signals, each min–max normalised, plus a documented rationale for every one of them (and for the
 * signals deliberately left out). Design rule: never score the same latent factor twice — the signal
 * set was chosen from the measured rank correlations, not from intuition; see
 * docs/mcmod-stats.md § "Modpack worth-playing score" for the correlation matrix.
 *
 * Usage:
 *   scripts/mcmod/rank-packs.mjs --top 20
 *   scripts/mcmod/rank-packs.mjs --top 20 --json          # includes each pack's component breakdown
 *   MCMOD_AS_OF=2026-10-11 scripts/mcmod/rank-packs.mjs  # freeze the age reference (reproducible)
 */
import { openDb } from './db.mjs';
import { resolve } from 'node:path';

// --- tunables: keep in sync with docs/mcmod-stats.md § "Modpack worth-playing score" -------------
const W = {
  recRate: 0.25,    // 推荐 per age^0.5   — a distinct act (r 0.62–0.76 with everything else)
  favRate: 0.21,    // 收藏  per age^0.5  — stands in for the 收藏/浏览/投票 cluster (r 0.91–0.97)
  idx: 0.19,        // 昨日指数          — *current* activity; also subsumes 评分 (r 0.96)
  size: 0.13,       // 模组数            — the most independent signal (r ≤ 0.42)
  editRate: 0.13,   // 编辑次数 per age^0.5 — sustained maintenance (only r 0.24 with 指数)
  approval: 0.09,   // 投票赞成率         — the only signal that can penalise (r 0.83 with 收藏)
};
/** A pack a fortnight old would otherwise divide by ~0; treat 0.5 y as the prior. */
const AGE_PRIOR = 0.5;
const YEAR_MS = 31557600000;

const SIGNALS = {
  recRate: (p) => p.recommend / soften(p.ageY),
  favRate: (p) => p.favorite / soften(p.ageY),
  idx: (p) => p.yesterday_idx,
  size: (p) => p.mod_count,
  editRate: (p) => p.edit_count / soften(p.ageY),
  approval: (p) => (p.votes_for + 1) / (p.votes_for + p.votes_against + 2),   // Laplace: 0 votes -> 0.5
};
const soften = (ageY) => Math.sqrt(Math.max(ageY, 0) + AGE_PRIOR);
/** Approval is already bounded 0–1, so normalise it linearly; the counts are skewed, so log first. */
const normalize = (v) => (v == null || !Number.isFinite(v) ? null : v);
const spread = (vals, log) => {
  const xs = vals.filter((v) => v != null).map((v) => (log ? Math.log1p(v) : v));
  const lo = Math.min(...xs), hi = Math.max(...xs);
  return (v) => (hi === lo ? 0 : ((log ? Math.log1p(v) : v) - lo) / (hi - lo));
};

export function loadPacks(db, asOf = new Date()) {
  return db.prepare(`SELECT id,name,name_en,url,pack_type,run_mode,recommend,favorite,votes_for,
      votes_against,views,rating,rating_label,yesterday_idx,mod_count,edit_count,published_at,
      last_edit_at,description
    FROM modpacks`).all().map((p) => {
    const t = p.published_at ? Date.parse(p.published_at.replace(' ', 'T') + 'Z') : NaN;
    return { ...p, ageY: Number.isFinite(t) ? (asOf.getTime() - t) / YEAR_MS : null };
  }).filter((p) => p.ageY != null && p.ageY > 0);
}

export function rank(packs) {
  const norm = {};
  for (const [key, fn] of Object.entries(SIGNALS)) {
    const n = spread(packs.map(fn).map(normalize), key !== 'approval');
    norm[key] = packs.map((p) => n(normalize(fn(p))));
  }
  return packs.map((p, i) => {
    const parts = {};
    let score = 0;
    for (const key of Object.keys(W)) {
      const v = norm[key][i] ?? 0;
      parts[key] = +(W[key] * 100 * v).toFixed(1);
      score += W[key] * 100 * v;
    }
    return { ...p, score: +score.toFixed(1), parts };
  }).sort((a, b) => b.score - a.score);
}

function main() {
  const argv = process.argv.slice(2);
  const arg = (k, d) => { const i = argv.indexOf(k); return i < 0 ? d : argv[i + 1]; };
  const top = +arg('--top', 20);
  const asJson = argv.includes('--json');
  const db = openDb(arg('--db') ? resolve(arg('--db')) : undefined);
  const asOf = process.env.MCMOD_AS_OF ? new Date(process.env.MCMOD_AS_OF + 'T00:00:00Z') : new Date();
  const rows = rank(loadPacks(db, asOf)).slice(0, top);

  if (asJson) console.log(JSON.stringify({ asOf: asOf.toISOString().slice(0, 10), weights: W, rows }, null, 1));
  else {
    console.log(`# modpack "worth playing" — top ${rows.length} of ${loadPacks(db, asOf).length} (as of ${asOf.toISOString().slice(0, 10)})`);
    for (const [i, r] of rows.entries())
      console.log(`${String(i + 1).padStart(3)}  ${String(r.score).padStart(5)}  ` +
        `${String(r.recommend).padStart(5)}推 ${String(r.favorite).padStart(4)}收 ` +
        `${String(r.votes_for)}:${String(r.votes_against)}票 指数${String(r.yesterday_idx).padStart(5)} ` +
        `评分${r.rating}(${r.rating_label || '-'}) ${String(r.mod_count).padStart(4)}模组 ${r.ageY.toFixed(1)}y  ${r.name}`);
  }
  db.close();
}

if (import.meta.url === `file://${process.argv[1]}`) main();
