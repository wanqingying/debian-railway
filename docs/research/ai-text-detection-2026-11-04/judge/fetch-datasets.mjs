// Build a balanced, tiny eval set (<=20 items per dataset) from HuggingFace's
// datasets-server. Each item: {id, dataset, label: human|ai, genre, text}.
// Usage: node fetch-datasets.mjs
//
// Note: the `/filter` endpoint is unusable here (500: "Authentication check on
// the Hugging Face Hub failed"), so RAID rows are located by offset instead.
// The train split is ordered by domain -> model -> attack, so each model's
// attack="none" block sits at a known offset (see PROBES below). The server
// rate-limits hard (429), hence the backoff in `get` and the small request count.
import { writeFileSync } from 'node:fs';

const OUT = 'items.jsonl';
const MAX_CHARS = 1600; // judge cost control; longer docs are cut with a marker
const PER_CLASS = 10;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const get = async (url, tries = 6) => {
  for (let i = 0; i < tries; i++) {
    const r = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (r.ok) return r.json();
    if (r.status === 429) {
      const wait = 5000 * 2 ** i; // 5s, 10s, 20s, 40s, 80s
      console.error(`429, waiting ${wait / 1000}s (${i + 1}/${tries})`);
      await sleep(wait);
      continue;
    }
    throw new Error(`${r.status} ${url}`);
  }
  throw new Error(`429 exhausted ${url}`);
};

const rowsUrl = (dataset, config, split, offset, length) =>
  `https://datasets-server.huggingface.co/rows?dataset=${encodeURIComponent(dataset)}&config=${config}&split=${split}&offset=${offset}&length=${length}`;

const trim = (t) => {
  const s = String(t || '').replace(/\r/g, '').trim();
  return s.length > MAX_CHARS ? s.slice(0, MAX_CHARS) + '\n[…文本已截断]' : s;
};

const items = [];

// ---------- RAID: modern models, long-form; human rows are model="human" ----------
// offsets of the attack="none" block, one per model, measured on the live split
const RAID_MODEL_OFFSETS = [
  [600, 'llama-chat'],
  [1600, 'mpt'],
  [2600, 'mpt-chat'],
  [4600, 'mistral'],
  [5600, 'mistral-chat'],
];

try {
  const page = await get(rowsUrl('liamdugan/raid', 'raid', 'train', 0, PER_CLASS));
  const human = page.rows.filter((r) => r.row.model === 'human' && r.row.generation);
  for (const r of human.slice(0, PER_CLASS)) {
    items.push({
      id: `raid-h${String(r.row_idx).padStart(3, '0')}`,
      dataset: 'RAID', label: 'human',
      genre: `${r.row.domain ?? '?'}/human`,
      text: trim(r.row.generation),
    });
  }
} catch (e) { console.error('RAID human failed:', e.message); }

try {
  // AI rows with no attack, so we test detection rather than robustness to paraphrase.
  const got = [];
  for (const [offset, model] of RAID_MODEL_OFFSETS) {
    if (got.length >= PER_CLASS) break;
    const page = await get(rowsUrl('liamdugan/raid', 'raid', 'train', offset, 3));
    const hit = page.rows.filter((r) => r.row.model === model && r.row.attack === 'none' && r.row.generation);
    for (const r of hit.slice(0, 2)) {
      if (got.length >= PER_CLASS) break;
      got.push(r);
    }
  }
  for (const r of got) {
    items.push({
      id: `raid-a${String(r.row_idx).padStart(7, '0')}`,
      dataset: 'RAID', label: 'ai',
      genre: `${r.row.domain ?? '?'}/${r.row.model}/${r.row.decoding}`,
      text: trim(r.row.generation),
    });
  }
} catch (e) { console.error('RAID ai failed:', e.message); }

// ---------- HC3 (English + Chinese): short forum-style Q&A ----------
for (const [dataset, tag] of [['Hello-SimpleAI/HC3', 'HC3-en'], ['Hello-SimpleAI/HC3-Chinese', 'HC3-zh']]) {
  try {
    const page = await get(rowsUrl(dataset, 'all', 'train', 0, PER_CLASS));
    const h = [], a = [];
    for (const r of page.rows) {
      const human = trim((r.row.human_answers || [])[0]);
      const ai = trim((r.row.chatgpt_answers || [])[0]);
      if (!human || !ai) continue;
      const base = String(r.row.id).slice(0, 8);
      if (h.length < PER_CLASS) h.push({ id: `${tag}-h${base}`, dataset: tag, label: 'human', genre: r.row.source || 'qa', text: human });
      if (a.length < PER_CLASS) a.push({ id: `${tag}-a${base}`, dataset: tag, label: 'ai', genre: r.row.source || 'qa', text: ai });
    }
    items.push(...h, ...a);
  } catch (e) { console.error(`${dataset} failed:`, e.message); }
}

writeFileSync(OUT, items.map((x) => JSON.stringify(x)).join('\n') + '\n');
const by = {};
for (const x of items) by[`${x.dataset}/${x.label}`] = (by[`${x.dataset}/${x.label}`] || 0) + 1;
console.log(`${items.length} items`);
for (const [k, v] of Object.entries(by)) console.log(`  ${k}: ${v}`);
const lens = items.map((x) => x.text.length).sort((a, b) => a - b);
console.log(`length chars: min ${lens[0]} median ${lens[Math.floor(lens.length / 2)]} max ${lens[lens.length - 1]}`);
