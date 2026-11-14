// Compare judge prompt versions on the same 60 items.
// Usage: node compare.mjs
import { readFileSync } from 'node:fs';

const FILES = [
  ['v1', './results.json'],
  ['v2', './results-v2.json'],
  ['v3', './results-v3.json'],
  ['v4', './results-v4.json'],
  ['v5', './results-v5.json'],
  ['v6', './results-v6.json'],
];
const ORDER = ['RAID', 'HC3-en', 'HC3-zh'];
const AI_V = new Set(['AI', 'LIKELY_AI']);
const pct = (n, d) => (d ? ((100 * n) / d).toFixed(1) + '%' : '—');
const wilson = (k, n, z = 1.96) => {
  if (!n) return [0, 0];
  const p = k / n, den = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / den;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / den;
  return [Math.max(0, c - h), Math.min(1, c + h)];
};
const ci = (k, n) => {
  const [lo, hi] = wilson(k, n);
  return `${pct(k, n)} [${(100 * lo).toFixed(1)}–${(100 * hi).toFixed(1)}]`;
};

// AUC from p_ai (higher = more AI). Ties count 0.5.
const auc = (rows) => {
  const pos = rows.filter((r) => r.label === 'ai' && typeof r.p_ai === 'number').map((r) => r.p_ai);
  const neg = rows.filter((r) => r.label === 'human' && typeof r.p_ai === 'number').map((r) => r.p_ai);
  if (!pos.length || !neg.length) return null;
  let s = 0;
  for (const p of pos) for (const n of neg) s += p > n ? 1 : p === n ? 0.5 : 0;
  return s / (pos.length * neg.length);
};

const out = [];
for (const [name, file] of FILES) {
  let rows;
  try { rows = JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8')); } catch { out.push(`## ${name}\n(missing)\n`); continue; }
  const ok = rows.filter((r) => r.parse_ok && AI_V.has(r.verdict) || r.parse_ok && ['LIKELY_HUMAN', 'UNCERTAIN'].includes(r.verdict));
  const failures = rows.length - ok.length;
  out.push(`## ${name}  (${ok.length} 判定 / ${failures} 失败)`);
  out.push('');
  out.push('| 数据集 | 准确率 (95% CI) | UNCERTAIN | 召回AI | 误报human | 剔除UNCERTAIN |');
  out.push('|---|---|---|---|---|---|');
  let allK = 0, allN = 0;
  for (const ds of ORDER) {
    const sub = ok.filter((r) => r.dataset === ds);
    if (!sub.length) continue;
    const correct = sub.filter((r) => (AI_V.has(r.verdict) ? r.label === 'ai' : r.label === 'human')).length;
    const unc = sub.filter((r) => r.verdict === 'UNCERTAIN').length;
    const ai = sub.filter((r) => r.label === 'ai');
    const hu = sub.filter((r) => r.label === 'human');
    const rec = ai.filter((r) => AI_V.has(r.verdict)).length;
    const fpr = hu.filter((r) => AI_V.has(r.verdict)).length;
    const dec = sub.filter((r) => r.verdict !== 'UNCERTAIN');
    const decOk = dec.filter((r) => (AI_V.has(r.verdict) ? r.label === 'ai' : r.label === 'human')).length;
    out.push(`| ${ds} | ${ci(correct, sub.length)} | ${pct(unc, sub.length)} | ${pct(rec, ai.length)} | ${fpr}/${hu.length} | ${dec.length ? ci(decOk, dec.length) : '—'} |`);
    allK += correct; allN += sub.length;
  }
  const allCorrect = ok.filter((r) => (AI_V.has(r.verdict) ? r.label === 'ai' : r.label === 'human')).length;
  const allAI = ok.filter((r) => r.label === 'ai');
  const allHU = ok.filter((r) => r.label === 'human');
  const allDec = ok.filter((r) => r.verdict !== 'UNCERTAIN');
  const allDecOk = allDec.filter((r) => (AI_V.has(r.verdict) ? r.label === 'ai' : r.label === 'human')).length;
  out.push(`| **合并** | **${ci(allCorrect, ok.length)}** | ${pct(ok.filter((r) => r.verdict === 'UNCERTAIN').length, ok.length)} | ${pct(allAI.filter((r) => AI_V.has(r.verdict)).length, allAI.length)} | **${allHU.filter((r) => AI_V.has(r.verdict)).length}/${allHU.length}** | ${allDec.length ? ci(allDecOk, allDec.length) : '—'} |`);
  const a = auc(ok);
  out.push('');
  out.push(`- 档位分布: ${JSON.stringify(ok.reduce((m, r) => ((m[r.verdict] = (m[r.verdict] || 0) + 1), m), {}))}`);
  if (a !== null) out.push(`- AUC(p_ai) = **${a.toFixed(3)}**`);
  const rule = ok.reduce((m, r) => ((m[r.rule || '—'] = (m[r.rule || '—'] || 0) + 1), m), {});
  out.push(`- 规则命中: ${JSON.stringify(rule)}`);
  const avgMs = Math.round(ok.reduce((s, r) => s + (r.ms || 0), 0) / ok.length);
  out.push(`- 平均耗时: ${avgMs}ms/条`);
  out.push('');
}
console.log(out.join('\n'));
