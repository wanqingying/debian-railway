// Verify each load-bearing claim by re-fetching its URL and checking that a
// distinctive slice of the quote appears in the page text.
//   - PDFs go through pdftotext (the text layer, not the compressed streams).
//   - Matching is on a normalised alphanumeric stream so markup, soft hyphens
//     and PDF line breaks do not defeat it.
// Usage: node verify.mjs <dir>
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = process.argv[2] || '.';
const rows = readFileSync(`${dir}/evidence.jsonl`, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
const work = mkdtempSync(join(tmpdir(), 'verify-'));

const decode = (s) => s
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

// Solr-style: lowercase, drop everything that is not a letter, digit or space.
const norm = (s) => decode(s).toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim();

// PDFs carry no markup: run the tag stripper would eat every span between a
// random "<" and ">" in a formula, so they get the plain path only.
const normPdf = (s) => String(s).toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim();

function fragments(q) {
  return String(q).split(/\.\.\.|…/).map((f) => norm(f)).filter((f) => f.length > 20);
}

// Exact-substring matching is defeated by layout (a PDF table, MathJax printing
// "96.5 % 96.5\%", a line break inside a word). Compare word trigrams instead:
// a page supports an exact quote when nearly all of its trigrams are present.
function shingles(s) {
  const w = s.split(' ').filter(Boolean);
  const out = [];
  for (let i = 0; i + 3 <= w.length; i++) out.push(w.slice(i, i + 3).join(' '));
  return out.length ? out : [w.join(' ')];
}

function supports(pageText, quote) {
  const frags = fragments(quote);
  if (!frags.length) return { ok: false, ratio: 0, frags: 0 };
  let ok = 0;
  for (const f of frags) {
    const sh = shingles(f);
    const hit = sh.filter((g) => pageText.includes(g)).length;
    if (hit / sh.length >= 0.85) ok++;
  }
  return { ok: ok === frags.length, ratio: ok, frags: frags.length };
}

async function fetchText(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 30000);
  try {
    const r = await fetch(url, {
      signal: ctl.signal, redirect: 'follow',
      headers: {
        'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0 Safari/537.36',
        'accept': 'text/html,application/xhtml+xml,application/pdf,*/*',
        'accept-language': 'en,zh;q=0.9',
      },
    });
    const buf = Buffer.from(await r.arrayBuffer());
    const isPdf = buf.subarray(0, 5).toString() === '%PDF-' || /\.pdf($|\?)/i.test(url);
    if (isPdf) {
      const f = join(work, `p${Math.random().toString(36).slice(2)}.pdf`);
      writeFileSync(f, buf);
      const txt = execFileSync('pdftotext', ['-q', '-enc', 'UTF-8', f, '-'], { maxBuffer: 1 << 28 }).toString();
      return { status: r.status, text: normPdf(txt), kind: 'pdf', frags: txt };
    }
    return { status: r.status, text: norm(buf.toString('utf8')), kind: 'html' };
  } finally {
    clearTimeout(t);
  }
}

// Lane B: a real browser for JS-rendered and paywalled/cookie-gated pages.
const BROWSER = '/workspace/.opencode/config/opencode/skills/deep-research/scripts/browse.mjs';
function browseText(url) {
  const raw = execFileSync('node', [BROWSER, url], { maxBuffer: 1 << 28, timeout: 90000 }).toString();
  return norm(raw);
}

const out = [];
for (const r of rows) {
  if (!r.load_bearing) continue;
  let res, lane = 'http';
  try {
    res = await fetchText(r.url);
  } catch (e) {
    res = { status: 0, text: '', kind: 'error' };
  }
  let m = supports(res.text, r.quote);
  if (!m.ok) {
    try {
      const t = browseText(r.url);
      const bm = supports(t, r.quote);
      if (bm.ratio > m.ratio) { res = { status: 200, text: t, kind: 'render' }; lane = 'render'; m = bm; }
    } catch { /* browser lane unavailable, keep the http result */ }
  }
  const verdict = !m.frags ? 'no-quote' : m.ok ? 'supported' : m.ratio ? 'partial' : 'not-found';
  out.push({ id: r.claim_id, node: r.node, url: r.url, verdict, hits: `${m.ratio}/${m.frags}`, status: res.status, kind: res.kind, lane, len: res.text.length });
}

writeFileSync(`${dir}/verification.json`, JSON.stringify(out, null, 1));
const tally = out.reduce((a, x) => ((a[x.verdict] = (a[x.verdict] || 0) + 1), a), {});
console.log(JSON.stringify(tally));
for (const x of out) if (x.verdict !== 'supported') console.log(`${x.id} ${x.node} ${x.verdict} ${x.hits || ''} ${x.status || ''} ${x.kind || ''} ${x.len || ''} ${x.url}`);
