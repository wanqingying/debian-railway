#!/usr/bin/env node
// Evidence register for the deep-research skill.
//
// Why this exists: evidence that lives only in the conversation is lost to
// context rot before the report is written, and source ids assigned by hand
// while typing cannot be audited. This keeps one append-only JSONL file as the
// single source of truth, assigns stable ids, and computes the citation
// accuracy the report header has to show.
//
// Record shape (one line in evidence.jsonl):
//   claim_id, node, source_family, claim, source_title, url, quote, tier,
//   access, published, retrieved, confidence, load_bearing, verdict, note,
//   stale_reason
//
// `published` (when the page was written) is a different fact from `retrieved`
// (when we fetched it), and it is the one timeliness is measured on: a 2019 page
// fetched today is a stale source, not a fresh one.
//
// Usage:
//   node evidence.mjs init   <dir> [--slug s]
//   node evidence.mjs append <dir> '<json>'|--stdin     (object or array)
//   node evidence.mjs edit   <dir> --claim C001 '<json>'   (fields to change)
//   node evidence.mjs edit   <dir> --claim C001 --delete
//   node evidence.mjs stats  <dir> [--window YYYY-MM-DD] [--json]
//   node evidence.mjs slice  <dir> --node N1 [--max 4000]
//   node evidence.mjs verify <dir> --claim C001 --verdict supported [--note "…"]
//   node evidence.mjs render <dir> [--window YYYY-MM-DD] [--gate]   (assigns S ids)
//
// Exit codes: 0 ok, 1 bad usage, 2 accuracy gate failed (render --gate).

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const TIERS = ['T1', 'T2', 'T3', 'T4'];
const ACCESS = ['public', 'render', 'authenticated'];
const VERDICTS = ['supported', 'partial', 'not_supported', 'superseded', 'unverifiable'];
const GATE = 0.95;

const args = process.argv.slice(2);
const cmd = args[0];
const dir = args[1];
const flags = parseFlags(args.slice(2));

function parseFlags(list) {
  const out = {};
  for (let i = 0; i < list.length; i++) {
    if (!list[i].startsWith('--')) continue;
    const key = list[i].slice(2);
    const next = list[i + 1];
    out[key] = next && !next.startsWith('--') ? (i++, next) : true;
  }
  return out;
}

const evidencePath = dir && join(dir, 'evidence.jsonl');

function die(msg, code = 1) {
  console.error(`evidence: ${msg}`);
  process.exit(code);
}

function load() {
  if (!existsSync(evidencePath)) return [];
  return readFileSync(evidencePath, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l, i) => {
      try {
        return JSON.parse(l);
      } catch {
        die(`evidence.jsonl line ${i + 1} is not valid JSON`);
      }
    });
}

function normalizeTier(v) {
  if (!v) return undefined;
  const m = String(v).toUpperCase().match(/^T[1-4]/);
  return m ? m[0] : String(v);
}

// Timeliness is compared as strings, so every accepted form is expanded to a
// full date. Year- and month-only dates expand to their EARLIEST day: an
// uncertain date must only ever be able to flag more claims as possibly stale,
// never fewer.
function normalizePublished(v) {
  if (v === undefined || v === null || v === '') return 'undated';
  const s = String(v).trim();
  if (/^(undated|unknown|n\/a|none)$/i.test(s)) return 'undated';
  if (/^\d{4}$/.test(s)) return `${s}-01-01`;
  if (/^\d{4}-\d{2}$/.test(s)) return `${s}-01`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return 'undated';
}

function normalizeAccess(v) {
  if (!v) return 'public';
  const s = String(v).toLowerCase();
  if (s.startsWith('auth')) return 'authenticated';
  if (s.startsWith('render') || s.startsWith('browser')) return 'render';
  return 'public';
}

function key(url) {
  return String(url || '')
    .replace(/^https?:\/\/(www\.)?/, '')
    .replace(/#.*$/, '')
    .replace(/\/$/, '')
    .toLowerCase();
}

function hostOf(u) {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}

// A source family is "who published it" — not "which URL". A repository's
// releases page, its README and its commit history corroborate each other the
// way one author citing himself does, so they must not satisfy an
// "independent sources" requirement between them. Derived from the URL so
// workers do not have to remember a new field; an explicit `source_family`
// still wins, for publishers split across hosts.
function familyOf(row) {
  const u = String(row.url || '');
  const gh = u.match(/^https?:\/\/(?:api\.)?github\.com\/(?:repos\/)?([^/]+)\/([^/?#]+)/i);
  if (gh) return `github:${gh[1]}/${gh[2]}`.toLowerCase();
  const npm = u.match(/registry\.npmjs\.org\/([^/?#]+)/i);
  if (npm) return `npm:${decodeURIComponent(npm[1])}`.toLowerCase();
  // Both /api/v1/crates/<name> and the human page /crates/<name> must resolve to
  // the same family; otherwise two different crates collapse into "crates.io" and
  // the independence check silently gets looser.
  const crates = u.match(/crates\.io\/(?:api\/v1\/)?crates\/([^/?#]+)/i);
  if (crates) return `crates:${crates[1]}`.toLowerCase();
  const pypi = u.match(/pypi\.org\/pypi\/([^/?#]+)/i);
  if (pypi) return `pypi:${pypi[1]}`.toLowerCase();
  const arxiv = u.match(/arxiv\.org\/(?:abs|pdf)\/([^/?#]+)/i);
  if (arxiv) return `arxiv:${arxiv[1]}`.toLowerCase();
  return hostOf(u);
}

function save(rows) {
  writeFileSync(evidencePath, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
}

// Highest id + 1, not length + 1: after a delete, length restarts below the
// highest id and would hand out an id that is already taken.
function nextClaimId(rows) {
  const max = rows.reduce((m, r) => {
    const n = Number(String(r.claim_id || '').replace(/^C/, ''));
    return Number.isFinite(n) && n > m ? n : m;
  }, 0);
  return 'C' + String(max + 1).padStart(3, '0');
}

// ---------------------------------------------------------------- commands

function cmdInit() {
  if (!dir) die('init needs a directory');
  mkdirSync(dir, { recursive: true });
  if (!existsSync(evidencePath)) writeFileSync(evidencePath, '');
  if (!existsSync(join(dir, 'outline.json'))) {
    writeFileSync(
      join(dir, 'outline.json'),
      JSON.stringify(
        {
          slug: flags.slug || dir.split('/').filter(Boolean).pop(),
          question: '',
          depth: 'standard',
          budget: { max_sources_per_node: 8, max_minutes: 20, max_workers_per_batch: 3 },
          created: new Date().toISOString().slice(0, 10),
          nodes: [],
        },
        null,
        2
      ) + '\n'
    );
  }
  console.log(`initialized ${dir}`);
}

function coerce(row, rows) {
  if (!row.claim) die('every record needs a "claim"');
  if (!row.url) die(`record "${row.claim.slice(0, 40)}…" has no url`);
  return {
    claim_id: row.claim_id || nextClaimId(rows),
    node: row.node || 'N0',
    source_family: row.source_family || familyOf(row),
    claim: row.claim,
    source_title: row.source_title || '',
    url: row.url,
    quote: row.quote || '',
    tier: normalizeTier(row.tier) || 'T4',
    access: normalizeAccess(row.access),
    published: normalizePublished(row.published),
    retrieved: row.retrieved || new Date().toISOString().slice(0, 10),
    confidence: row.confidence || 'medium',
    load_bearing: row.load_bearing !== false,
    verdict: row.verdict || null,
    note: row.note || '',
    stale_reason: row.stale_reason || '',
  };
}

function cmdAppend() {
  if (!dir) die('append needs a directory');
  const raw = flags.stdin ? readFileSync(0, 'utf8') : args.slice(2).find((a) => a.trim().startsWith('{') || a.trim().startsWith('['));
  if (!raw) die("append needs a JSON object or array (or --stdin)");
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (e) {
    die(`invalid JSON: ${e.message}`);
  }
  const rows = load();
  const incoming = Array.isArray(payload) ? payload : [payload];
  const seen = new Set(rows.map((r) => key(r.url) + '|' + r.claim.trim().toLowerCase()));
  let added = 0;
  for (const item of incoming) {
    const rec = coerce(item, rows);
    const dup = key(rec.url) + '|' + rec.claim.trim().toLowerCase();
    if (seen.has(dup)) continue;
    seen.add(dup);
    rows.push(rec);
    appendFileSync(evidencePath, JSON.stringify(rec) + '\n');
    added++;
  }
  console.log(`appended ${added} (skipped ${incoming.length - added} duplicates), total ${rows.length}`);
}

// Freshness, measured the same way accuracy is: a counted number over the
// load-bearing claims, not a claim that the sources felt recent.
function freshness(rows, window) {
  const lb = rows.filter((r) => r.load_bearing);
  const dated = lb.filter((r) => r.published && r.published !== 'undated');
  const undated = lb.length - dated.length;
  if (!window) return { window: null, load_bearing: lb.length, dated: dated.length, undated, in_window: null, out_of_window: [] };
  const inWin = dated.filter((r) => r.published >= window);
  const outWin = dated.filter((r) => r.published < window);
  return {
    window,
    load_bearing: lb.length,
    dated: dated.length,
    undated,
    in_window: inWin.length,
    // % over DATED claims only: an undated page is unknown, not stale, and
    // counting it as stale would push the model to invent publication dates.
    pct: dated.length ? Number(((inWin.length / dated.length) * 100).toFixed(1)) : null,
    out_of_window: outWin.map((r) => ({ claim_id: r.claim_id, published: r.published, reason: r.stale_reason || '' })),
  };
}

function accuracy(rows) {
  const lb = rows.filter((r) => r.load_bearing);
  const decided = lb.filter((r) => r.verdict);
  const supported = lb.filter((r) => r.verdict === 'supported');
  return {
    load_bearing: lb.length,
    decided: decided.length,
    supported: supported.length,
    ratio: decided.length ? supported.length / decided.length : null,
  };
}

function cmdStats() {
  const rows = load();
  const acc = accuracy(rows);
  const fresh = freshness(rows, flags.window ? String(flags.window) : null);
  const byYear = {};
  for (const r of rows) {
    const y = r.published && r.published !== 'undated' ? r.published.slice(0, 4) : 'undated';
    byYear[y] = (byYear[y] || 0) + 1;
  }
  const tally = (fn) =>
    rows.reduce((m, r) => ((m[fn(r)] = (m[fn(r)] || 0) + 1), m), {});
  // Independence is counted in families, never in URLs: four endpoints of one
  // repository are one publisher.
  const familiesByNode = {};
  for (const r of rows.filter((x) => x.load_bearing)) {
    (familiesByNode[r.node] ||= new Set()).add(r.source_family || familyOf(r));
  }
  const weakNodes = Object.entries(familiesByNode)
    .filter(([, s]) => s.size < 2)
    .map(([n, s]) => `${n}(${s.size})`);
  const out = {
    records: rows.length,
    load_bearing: acc.load_bearing,
    by_tier: tally((r) => r.tier),
    by_access: tally((r) => r.access),
    by_node: tally((r) => r.node),
    verdicts: tally((r) => r.verdict || 'unverified'),
    source_families: Object.keys(tally((r) => r.source_family || familyOf(r))).length,
    families_per_node: Object.fromEntries(Object.entries(familiesByNode).map(([n, s]) => [n, s.size])),
    nodes_under_2_families: weakNodes,
    citation_accuracy: acc.ratio === null ? null : Number((acc.ratio * 100).toFixed(1)),
    verified: `${acc.supported}/${acc.decided}`,
    by_published_year: byYear,
    freshness: fresh,
  };
  if (flags.json) return console.log(JSON.stringify(out, null, 2));
  console.log(`records: ${out.records}  load-bearing: ${out.load_bearing}  source families: ${out.source_families}`);
  console.log(`by tier: ${fmt(out.by_tier)}`);
  console.log(`by access: ${fmt(out.by_access)}`);
  console.log(`by node: ${fmt(out.by_node)}`);
  console.log(`families per node: ${fmt(out.families_per_node)}`);
  if (weakNodes.length) console.log(`warning: under 2 independent families: ${weakNodes.join(', ')}`);
  console.log(`verdicts: ${fmt(out.verdicts)}`);
  console.log(`by published year: ${fmt(out.by_published_year)}`);
  if (fresh.window) {
    const unreasoned = fresh.out_of_window.filter((c) => !c.reason);
    console.log(
      `freshness: in-window ${fresh.in_window}/${fresh.dated} dated (${fresh.pct}%) · undated ${fresh.undated} · window >= ${fresh.window}`
    );
    if (fresh.out_of_window.length) {
      console.log(
        `  before window: ${fresh.out_of_window.map((c) => `${c.claim_id}@${c.published}${c.reason ? '' : '!'}`).join(', ')}   (! = no stale_reason)`
      );
    }
    if (unreasoned.length) console.log(`warning: ${unreasoned.length} out-of-window claim(s) without a stale_reason`);
  } else {
    console.log(`freshness: ${fresh.dated} dated, ${fresh.undated} undated — pass --window YYYY-MM-DD to measure it`);
  }
  console.log(
    `citation accuracy: ${out.citation_accuracy === null ? 'n/a (nothing verified yet)' : out.citation_accuracy + '%'} (${out.verified})`
  );
}

function fmt(m) {
  return Object.entries(m)
    .sort()
    .map(([k, v]) => `${k} ${v}`)
    .join(', ');
}

function cmdSlice() {
  const rows = load().filter((r) => !flags.node || r.node === flags.node);
  const max = Number(flags.max || 4000);
  let out = '';
  for (const r of rows) {
    const block = `- ${r.claim_id} [${r.tier}/${r.access}] ${r.claim}\n  ${r.source_title} — ${r.url} (published ${r.published || 'undated'}, retrieved ${r.retrieved})\n  "${r.quote}"\n`;
    if (out.length + block.length > max) {
      out += `… ${rows.length} records total, truncated at ${max} chars — narrow with --node or raise --max\n`;
      break;
    }
    out += block;
  }
  console.log(out || '(no records)');
}

function cmdVerify() {
  if (!flags.claim) die('verify needs --claim C001');
  if (!VERDICTS.includes(flags.verdict)) die(`--verdict must be one of ${VERDICTS.join('|')}`);
  const rows = load();
  const row = rows.find((r) => r.claim_id === flags.claim);
  if (!row) die(`no claim ${flags.claim}`);
  row.verdict = flags.verdict;
  if (flags.note) row.note = flags.note;
  save(rows);
  const acc = accuracy(rows);
  console.log(
    `${row.claim_id} → ${row.verdict}  · accuracy now ${acc.ratio === null ? 'n/a' : (acc.ratio * 100).toFixed(1) + '%'} (${acc.supported}/${acc.decided})`
  );
}

const EDITABLE = [
  'node',
  'claim',
  'source_title',
  'url',
  'quote',
  'tier',
  'access',
  'published',
  'source_family',
  'retrieved',
  'confidence',
  'load_bearing',
  'verdict',
  'note',
  'stale_reason',
];

function cmdEdit() {
  if (!flags.claim) die('edit needs --claim C001');
  const rows = load();
  const idx = rows.findIndex((r) => r.claim_id === flags.claim);
  if (idx < 0) die(`no claim ${flags.claim}`);

  if (flags.delete) {
    rows.splice(idx, 1);
    save(rows);
    console.log(`deleted ${flags.claim} · ${rows.length} records remain · next id will be ${nextClaimId(rows)}`);
    return;
  }

  const raw = args.slice(2).find((a) => a.trim().startsWith('{'));
  if (!raw) die('edit needs a JSON object of the fields to change, or --delete');
  let patch;
  try {
    patch = JSON.parse(raw);
  } catch (e) {
    die(`invalid JSON: ${e.message}`);
  }
  const unknown = Object.keys(patch).filter((k) => !EDITABLE.includes(k));
  if (unknown.length) die(`not editable: ${unknown.join(', ')} (editable: ${EDITABLE.join(', ')})`);
  if ('claim_id' in patch) die('claim_id is an identity, not a field — edit the content instead');

  const row = rows[idx];
  const before = { ...row };
  const merged = { ...row, ...patch };
  // Re-apply the same validation and normalization `append` uses, so an edit
  // can neither introduce a record the register would have rejected nor leave
  // a stale derived field behind.
  if (!String(merged.claim || '').trim()) die('claim cannot be empty');
  if (!String(merged.url || '').trim()) die('url cannot be empty');
  merged.tier = normalizeTier(merged.tier) || 'T4';
  merged.access = normalizeAccess(merged.access);
  merged.published = normalizePublished(merged.published);
  if (patch.url && !patch.source_family) merged.source_family = familyOf(merged);
  merged.load_bearing = merged.load_bearing !== false;

  rows[idx] = merged;
  save(rows);

  const changed = Object.keys(patch).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(merged[k]));
  console.log(`updated ${merged.claim_id}: ${changed.join(', ') || 'nothing (identical values)'}`);
  for (const k of changed) {
    const short = (v) => (typeof v === 'string' && v.length > 70 ? v.slice(0, 67) + '…' : v);
    console.log(`  ${k}: ${short(before[k])} → ${short(merged[k])}`);
  }
  if (changed.includes('verdict') || changed.includes('load_bearing')) {
    const acc = accuracy(rows);
    console.log(`  accuracy now ${acc.ratio === null ? 'n/a' : (acc.ratio * 100).toFixed(1) + '%'} (${acc.supported}/${acc.decided})`);
  }
}

function cmdRender() {
  const rows = load();
  const sources = new Map();
  for (const r of rows) {
    const k = key(r.url);
    if (!sources.has(k)) {
      sources.set(k, {
        sid: 'S' + (sources.size + 1),
        title: r.source_title,
        url: r.url,
        tier: r.tier,
        access: r.access,
        published: r.published || 'undated',
        retrieved: r.retrieved,
      });
    }
    const s = sources.get(k);
    r.source_id = s.sid;
    // A source is as weak as its weakest lane: a page read behind a login is
    // not reproducible just because one claim from it was also public.
    if (ACCESS.indexOf(r.access) > ACCESS.indexOf(s.access)) s.access = r.access;
    // One page can back several claims written at different times; keep the
    // earliest date so the source is never presented as fresher than it is.
    if ((r.published || 'undated') !== 'undated' && (s.published === 'undated' || r.published < s.published)) s.published = r.published;
  }
  save(rows);
  const list = [...sources.values()];
  writeFileSync(join(dir, 'sources.json'), JSON.stringify(list, null, 2) + '\n');
  writeFileSync(
    join(dir, 'claims.json'),
    JSON.stringify(
      rows.map((r) => ({
        claim_id: r.claim_id,
        node: r.node,
        source_id: r.source_id,
        claim: r.claim,
        tier: r.tier,
        access: r.access,
        load_bearing: r.load_bearing,
        verdict: r.verdict,
      })),
      null,
      2
    ) + '\n'
  );
  const acc = accuracy(rows);
  console.log(`| ID | Source | Tier | Access | Published | Retrieved |`);
  console.log(`|---|---|---|---|---|---|`);
  for (const s of list) console.log(`| ${s.sid} | [${s.title || s.url}](${s.url}) | ${s.tier} | ${s.access} | ${s.published} | ${s.retrieved} |`);
  const fresh = freshness(rows, flags.window ? String(flags.window) : null);
  console.log(`\n${list.length} sources · ${rows.length} claims · accuracy ${acc.ratio === null ? 'n/a' : (acc.ratio * 100).toFixed(1) + '%'} (${acc.supported}/${acc.decided})`);
  if (fresh.window) console.log(`freshness: in-window ${fresh.in_window}/${fresh.dated} dated (${fresh.pct}%) · undated ${fresh.undated} · window >= ${fresh.window}`);

  if (flags.gate) {
    console.log(`\nGATE: ${flags.window ? `window >= ${flags.window}` : 'no window given (freshness not gated)'}`);
    const unresolved = rows.filter((r) => r.load_bearing && !r.verdict).length;
    if (unresolved) {
      console.error(`\nGATE FAILED: ${unresolved} load-bearing claims have no verdict`);
      process.exit(2);
    }
    if (acc.ratio !== null && acc.ratio < GATE) {
      console.error(`\nGATE FAILED: citation accuracy ${(acc.ratio * 100).toFixed(1)}% < ${GATE * 100}%`);
      process.exit(2);
    }
    // Timeliness gates only what it can see: a source before the window must say
    // why it still holds. Undated sources are unknown, not stale — the metric
    // reports how many there are rather than inventing dates for them.
    const unreasoned = fresh.out_of_window.filter((c) => !c.reason);
    if (unreasoned.length) {
      console.error(
        `\nGATE FAILED: ${unreasoned.length} load-bearing claim(s) published before ${fresh.window} without a stale_reason: ${unreasoned
          .map((c) => `${c.claim_id}@${c.published}`)
          .join(', ')}`
      );
      process.exit(2);
    }
    console.log(
      `PASS: accuracy ${acc.ratio === null ? 'n/a' : (acc.ratio * 100).toFixed(1) + '%'}, every load-bearing claim has a verdict${
        fresh.window ? ` and no out-of-window claim lacks a reason` : ''
      }`
    );
  }
}

const commands = { init: cmdInit, append: cmdAppend, edit: cmdEdit, stats: cmdStats, slice: cmdSlice, verify: cmdVerify, render: cmdRender };
if (!commands[cmd]) {
  console.error(`usage: node evidence.mjs <${Object.keys(commands).join('|')}> <dir> [flags]`);
  process.exit(1);
}
commands[cmd]();
