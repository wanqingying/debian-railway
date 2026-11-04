// Run prompt-judge-v1 against items.jsonl through the local opencode HTTP API.
// Usage: node judge.mjs [--concurrency 3] [--limit N] [--prompt ./prompt-judge-v2.md]
//                      [--model provider/id] [--variant high] [--out ./results-v2.json]
// Writes results.json (one row per item) and prints one line per finished item.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

const API = 'http://127.0.0.1:4096';
const AUTH = 'Basic ' + Buffer.from('opencode:qingying').toString('base64');
const strArg = (name, def) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
};
const [mProvider, mId] = strArg('--model', 'opencode-go/deepseek-v4.1-flash').split('/');
const MODEL = { providerID: mProvider, id: mId };
if (strArg('--variant', '')) MODEL.variant = strArg('--variant', '');
const DIR = '/tmp/opencode/judge-run';
const TIMEOUT_MS = 120_000;
const POLL_MS = 1500;

const args = process.argv.slice(2);
const argOf = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args[i + 1]) : def;
};
const CONCURRENCY = argOf('--concurrency', 6);
const LIMIT = argOf('--limit', Infinity);

const PROMPT_TEMPLATE = readFileSync(new URL(strArg('--prompt', 'prompt-judge-v1.md'), import.meta.url), 'utf8');
if (!PROMPT_TEMPLATE.includes('{{TEXT}}')) throw new Error('prompt template has no {{TEXT}}');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const api = async (path, init = {}) => {
  const r = await fetch(API + path, {
    ...init,
    headers: { authorization: AUTH, 'content-type': 'application/json', ...(init.headers || {}) },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status} ${path}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
};

const createSession = async () => {
  const j = await api('/api/session', {
    method: 'POST',
    body: JSON.stringify({ title: 'judge', location: { directory: DIR }, model: MODEL }),
  });
  return j.data.id;
};

// returns { text, error }
const runOnce = async (promptText) => {
  const sid = await createSession();
  await api(`/api/session/${sid}/prompt`, { method: 'POST', body: JSON.stringify({ text: promptText }) });

  const started = Date.now();
  let last = { text: '', error: null };
  while (Date.now() - started < TIMEOUT_MS) {
    await sleep(POLL_MS);
    const j = await api(`/api/session/${sid}/message`);
    const msgs = (j.data || []).filter((m) => m.type === 'assistant');
    if (!msgs.length) continue;
    const m = msgs[msgs.length - 1];
    const text = (m.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim();
    last = { text, error: m.error || null };
    if (last.error) return last;
    if (m.finish && text) return last;
    if (m.finish && !text) return { text: '', error: m.error || 'empty assistant message' };
  }
  return { ...last, error: last.error || (last.text ? null : 'timeout') };
};

// Balanced-brace scan: the model sometimes appends a second JSON after a correction
// note, so a single first-{ .. last-} slice spans both and fails. Prefer the last
// object that actually carries a verdict/p_ai.
const jsonCandidates = (s) => {
  const out = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '{') continue;
    let depth = 0, inStr = false, esc = false;
    for (let j = i; j < s.length; j++) {
      const c = s[j];
      if (esc) { esc = false; continue; }
      if (c === '\\') { if (inStr) esc = true; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === '{') depth++;
      else if (c === '}') { if (--depth === 0) { out.push(s.slice(i, j + 1)); i = j; break; } }
    }
  }
  return out;
};

// Models routinely emit a trailing comma before } or ] (invalid JSON but valid JS-ish).
// Strip those outside strings, then parse.
const stripTrailingCommas = (s) => {
  let out = '', inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (esc) { out += c; esc = false; continue; }
    if (c === '\\') { out += c; if (inStr) esc = true; continue; }
    if (c === '"') { inStr = !inStr; out += c; continue; }
    if (!inStr && c === ',') {
      let j = i + 1;
      while (j < s.length && /\s/.test(s[j])) j++;
      if (s[j] === '}' || s[j] === ']') continue; // drop the comma
    }
    out += c;
  }
  // Models also emit a dangling `,"}` when they cut a value short; drop that fragment.
  return out.replace(/,\s*"\s*}/g, '}').replace(/,\s*"\s*\]/g, ']');
};

const repair = (s) => rebalance(stripTrailingCommas(s));

// Models also truncate mid-object; close the string and append the missing brackets.
const rebalance = (s) => {
  let inStr = false, esc = false;
  const stack = [];
  for (const c of s) {
    if (esc) { esc = false; continue; }
    if (c === '\\') { if (inStr) esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '{' || c === '[') stack.push(c);
    else if (c === '}' || c === ']') stack.pop();
  }
  let out = s;
  if (inStr) out += '"';
  for (let i = stack.length - 1; i >= 0; i--) out += stack[i] === '{' ? '}' : ']';
  return out;
};

const extractJson = (raw) => {
  if (!raw) return null;
  const cleaned = raw.replace(/```(?:json)?/gi, '').replace(/^[^{]*/, '').trim();
  const cands = jsonCandidates(cleaned);
  for (let k = cands.length - 1; k >= 0; k--) {
    for (const attempt of [cands[k], repair(cands[k])]) {
      try {
        const o = JSON.parse(attempt);
        if (o && (typeof o.p_ai === 'number' || typeof o.verdict === 'string')) return o;
      } catch { /* next */ }
    }
  }
  // Last resort: the object was cut mid-value, so no balanced candidate exists.
  try {
    const o = JSON.parse(repair(cleaned.slice(cleaned.indexOf('{'))));
    if (o && typeof o.p_ai === 'number') return o;
  } catch { /* give up */ }
  return null;
};

const judge = async (item) => {
  // replaceAll: prompt headers legitimately mention the placeholder, and a first-match
  // replace would drop the article into that doc line and leave the real slot empty.
  const promptText = PROMPT_TEMPLATE.replaceAll('{{TEXT}}', () => item.text);
  if (promptText.includes('{{TEXT}}') || !promptText.includes(item.text.slice(0, 40))) {
    throw new Error('prompt render failed: placeholder not substituted');
  }
  const t0 = Date.now();
  let attempt = 0;
  let res = null;
  while (attempt < 2) {
    attempt++;
    try {
      res = await runOnce(promptText);
    } catch (e) {
      res = { text: '', error: e.message };
    }
    if (!res.error) break;
  }
  const durationMs = Date.now() - t0;
  const parsed = extractJson(res.text);
  const rawVerdict = parsed && typeof parsed.verdict === 'string' ? parsed.verdict.toUpperCase() : null;
  const pAi = parsed && typeof parsed.p_ai === 'number' ? parsed.p_ai : null;
  // Prompts since v4 emit only p_ai; the band is the caller's fixed threshold, not the
  // model's discretion. Thresholds match prompt-judge-v4.md's header.
  const derived = pAi === null ? null : pAi >= 0.75 ? 'AI' : pAi >= 0.3 ? 'UNCERTAIN' : 'LIKELY_HUMAN';
  const verdict = rawVerdict || derived;
  const confidence = parsed && typeof parsed.confidence === 'number' ? parsed.confidence : null;
  const ok = Boolean(verdict) && ['AI', 'LIKELY_AI', 'UNCERTAIN', 'LIKELY_HUMAN'].includes(verdict);
  const row = {
    id: item.id,
    dataset: item.dataset,
    label: item.label,
    genre: item.genre,
    verdict: ok ? verdict : null,
    confidence,
    parse_ok: ok,
    error: res.error || (ok ? null : 'parse_error'),
    attempts: attempt,
    durationMs,
    text_len: item.text.length,
    evidence: parsed && Array.isArray(parsed.evidence) ? parsed.evidence : [],
    caveats: parsed && typeof parsed.caveats === 'string' ? parsed.caveats : null,
    p_ai: pAi,
    p_family: parsed && typeof parsed.p_family === 'number' ? parsed.p_family : null,
    e_shift: parsed && typeof parsed.e_shift === 'number' ? parsed.e_shift : null,
    auto_lean: parsed && parsed.auto && typeof parsed.auto.lean === 'string' ? parsed.auto.lean : null,
    auto_why: parsed && parsed.auto && typeof parsed.auto.why === 'string' ? parsed.auto.why : null,
    rule: parsed && typeof parsed.rule === 'string' ? parsed.rule : parsed && typeof parsed.hard === 'string' ? parsed.hard : null,
    verdict_source: rawVerdict ? 'model' : derived ? 'threshold' : null,
    noise: parsed && typeof parsed.noise === 'string' ? parsed.noise : null,
    raw: ok ? null : String(res.text || '').slice(0, 4000),
  };
  const tag = ok ? `${row.id} ${row.label}→${row.verdict} ${row.confidence}` : `${row.id} ${row.label}→FAIL(${row.error})`;
  if (!ok) {
    // keep the exact text of a failure so a parser gap can be diagnosed without re-running
    appendFileSync('/tmp/opencode/judge-fails.jsonl', JSON.stringify({ id: row.id, error: row.error, text: res.text }) + '\n');
  }
  console.log(`${tag} (${(durationMs / 1000).toFixed(1)}s)`);
  return { row, item };
};

const ONLY = (strArg('--only', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
const ITEMS_FILE = strArg('--items', './items.jsonl');
const items = readFileSync(new URL(ITEMS_FILE, import.meta.url), 'utf8')
  .trim()
  .split('\n')
  .map((l) => JSON.parse(l))
  .filter((it) => !ONLY.length || ONLY.includes(it.id))
  .slice(0, LIMIT === Infinity ? undefined : LIMIT);

console.log(`judging ${items.length} items, concurrency ${CONCURRENCY}`);
const startedAt = Date.now();

const results = new Array(items.length);
let next = 0;
const worker = async () => {
  while (true) {
    const i = next++;
    if (i >= items.length) return;
    results[i] = await judge(items[i]);
  }
};
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));

const rows = results.map((r) => (r ? r.row : { id: 'missing', label: 'missing', error: 'not run' }));
const withItem = results.filter(Boolean).map((r) => ({ text: r.item.text, ...r.row }));

const OUT = strArg('--out', './results.json');
writeFileSync(new URL(OUT, import.meta.url), JSON.stringify(withItem, null, 2) + '\n');

const failed = rows.filter((r) => !r.parse_ok).length;
const secs = ((Date.now() - startedAt) / 1000).toFixed(1);
console.log(`\ndone: ${rows.length} judged, ${failed} failed (parse/error), ${secs}s total`);
const byVerdict = {};
for (const r of rows) byVerdict[r.verdict || 'FAIL'] = (byVerdict[r.verdict || 'FAIL'] || 0) + 1;
console.log('verdicts:', JSON.stringify(byVerdict));
