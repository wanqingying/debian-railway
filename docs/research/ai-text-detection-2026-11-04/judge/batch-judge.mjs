// Head-to-head: batch-10 vs the per-item v4 results, same 30 items.
// Answers "can we batch?" with an agreement number instead of an opinion.
// Usage: node batch-judge.mjs [--size 10] [--items 30]
import { readFileSync, writeFileSync } from 'node:fs';

const API = 'http://127.0.0.1:4096';
const AUTH = 'Basic ' + Buffer.from('opencode:qingying').toString('base64');
const MODEL = { providerID: 'opencode-go', id: 'deepseek-v4.1-flash' };
const DIR = '/tmp/opencode/judge-run';
const arg = (n, d) => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? Number(process.argv[i + 1]) : d;
};
const SIZE = arg('--size', 10);
const ITEMS = arg('--items', 30);

const template = readFileSync(new URL('./prompt-batch-10.md', import.meta.url), 'utf8');
const items = readFileSync(new URL('./items.jsonl', import.meta.url), 'utf8')
  .trim()
  .split('\n')
  .map((l) => JSON.parse(l))
  .slice(0, ITEMS);
const baseline = new Map(
  JSON.parse(readFileSync(new URL('./results-v4.json', import.meta.url), 'utf8')).map((r) => [r.id, r]),
);

const api = async (path, init = {}) => {
  const r = await fetch(API + path, {
    ...init,
    headers: { authorization: AUTH, 'content-type': 'application/json', ...(init.headers || {}) },
    signal: AbortSignal.timeout(30_000),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status} ${path}: ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const runBatch = async (group) => {
  const s = await api('/api/session', {
    method: 'POST',
    body: JSON.stringify({ title: 'batch', location: { directory: DIR }, model: MODEL }),
  });
  const sid = s.data.id;
  const block = group.map((it) => `<item id="${it.id}">\n${it.text}\n</item>`).join('\n\n');
  const prompt = template.replaceAll('{{N}}', String(group.length)).replaceAll('{{BATCH}}', block);
  const t0 = Date.now();
  await api(`/api/session/${sid}/prompt`, { method: 'POST', body: JSON.stringify({ text: prompt }) });
  let text = '';
  while (Date.now() - t0 < 300_000) {
    await sleep(1500);
    const j = await api(`/api/session/${sid}/message`);
    const m = (j.data || []).filter((x) => x.type === 'assistant').pop();
    if (!m) continue;
    text = (m.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
    if (m.finish && text) break;
  }
  const a = text.indexOf('{');
  const b = text.lastIndexOf('}');
  const parsed = JSON.parse(text.slice(a, b + 1));
  return { rows: parsed.results || [], ms: Date.now() - t0, raw: text };
};

const groups = [];
for (let i = 0; i < items.length; i += SIZE) groups.push(items.slice(i, i + SIZE));

const started = Date.now();
const outs = await Promise.all(groups.map(runBatch));
const wall = Date.now() - started;

const rows = outs.flatMap((o, gi) => {
  const expect = groups[gi].map((x) => x.id);
  return o.rows.map((r) => ({ ...r, expected: expect, ok: expect.includes(r.id) }));
});

const band = (p) => (p >= 0.75 ? 'ai' : p >= 0.3 ? 'unc' : 'human');
let same = 0, both = 0, sumDiff = 0;
const diffs = [];
for (const r of rows) {
  const base = baseline.get(r.id);
  if (!base || typeof base.p_ai !== 'number' || typeof r.p_ai !== 'number') continue;
  both++;
  if (band(r.p_ai) === band(base.p_ai)) same++;
  const d = Math.abs(r.p_ai - base.p_ai);
  sumDiff += d;
  diffs.push({ id: r.id, single: base.p_ai, batch: r.p_ai, d });
}

const perCall = outs.map((o, i) => `${o.rows.length}/${groups[i].length} 条 ${(o.ms / 1000).toFixed(0)}s`);
console.log(`批大小 ${SIZE}，共 ${groups.length} 次调用，并发全部同时发出`);
console.log(`每次调用的条数/耗时: ${perCall.join(' | ')}`);
console.log(`总墙钟 ${(wall / 1000).toFixed(0)}s → ${((items.length / (wall / 1000)) * 60).toFixed(1)} 条/分钟`);
console.log(`\n与单条 v4 的对比（${both} 条可比）`);
console.log(`  档位一致: ${same}/${both} = ${((100 * same) / both).toFixed(1)}%`);
console.log(`  p_ai 平均绝对差: ${(sumDiff / both).toFixed(3)}`);
diffs.sort((a, b) => b.d - a.d);
console.log('  差异最大的 5 条:');
for (const d of diffs.slice(0, 5)) console.log(`    ${d.id}: 单条 ${d.single} → 批量 ${d.batch} (Δ${d.d.toFixed(2)})`);
console.log(`\nid 回显异常: ${rows.filter((r) => !r.ok).length} 条 | 返回条数 ${rows.length}/${items.length}`);

writeFileSync(new URL('./results-batch.json', import.meta.url), JSON.stringify({ size: SIZE, wall, rows, diffs }, null, 1));
