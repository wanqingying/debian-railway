// Turn results.json into the tables of results.md.
// Usage: node analyze.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const rows = JSON.parse(readFileSync(new URL('./results.json', import.meta.url), 'utf8'));

const AI_VERDICTS = new Set(['AI', 'LIKELY_AI']);
const HUMAN_VERDICTS = new Set(['LIKELY_HUMAN', 'UNCERTAIN']);
const ORDER = ['RAID', 'HC3-en', 'HC3-zh'];

const predClass = (v) => (AI_VERDICTS.has(v) ? 'ai' : HUMAN_VERDICTS.has(v) ? 'human' : null);
const pct = (n, d) => (d ? ((100 * n) / d).toFixed(1) + '%' : '—');

// Wilson score interval for a binomial proportion.
const wilson = (k, n, z = 1.96) => {
  if (!n) return [0, 0];
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
};
const ci = (k, n) => {
  const [lo, hi] = wilson(k, n);
  return `${pct(k, n)} [${(100 * lo).toFixed(1)}–${(100 * hi).toFixed(1)}]`;
};

const stats = (subset) => {
  const ok = subset.filter((r) => r.parse_ok);
  const human = ok.filter((r) => r.label === 'human');
  const ai = ok.filter((r) => r.label === 'ai');
  const hAsHuman = human.filter((r) => predClass(r.verdict) === 'human').length;
  const hAsAi = human.length - hAsHuman;
  const aAsAi = ai.filter((r) => predClass(r.verdict) === 'ai').length;
  const aAsHuman = ai.length - aAsAi;
  const correct = hAsHuman + aAsAi;
  const n = human.length + ai.length;
  const uncertain = ok.filter((r) => r.verdict === 'UNCERTAIN').length;
  const decided = ok.filter((r) => r.verdict !== 'UNCERTAIN');
  const decidedCorrect = decided.filter((r) => predClass(r.verdict) === r.label).length;
  const verdicts = {};
  for (const r of ok) {
    const k = `${r.label}:${r.verdict}`;
    verdicts[k] = (verdicts[k] || 0) + 1;
  }
  return {
    n, failed: subset.length - ok.length,
    human: human.length, ai: ai.length,
    hAsHuman, hAsAi, aAsAi, aAsHuman,
    correct, acc: correct / n, accCi: ci(correct, n),
    uncertain, uncertainShare: pct(uncertain, n),
    decided: decided.length, decidedCorrect,
    decidedAcc: decided.length ? pct(decidedCorrect, decided.length) : '—',
    decidedCi: decided.length ? ci(decidedCorrect, decided.length) : '—',
    verdicts,
    meanMs: Math.round(ok.reduce((s, r) => s + r.durationMs, 0) / (ok.length || 1)),
  };
};

const table = (label, s) => `### ${label}（n=${s.n}${s.failed ? `，另有 ${s.failed} 条 API/解析失败未计入` : ''}）

混淆矩阵（行=模型判定，列=真实标签）：

| 判定 | 真实 human（n=${s.human}） | 真实 ai（n=${s.ai}） |
|---|---|---|
| 判 AI（\`AI\`+\`LIKELY_AI\`） | ${s.hAsAi} | ${s.aAsAi} |
| 判人（\`LIKELY_HUMAN\`+\`UNCERTAIN\`） | ${s.hAsHuman} | ${s.aAsHuman} |

- 总体准确率：**${s.accCi}**（${s.correct}/${s.n}，95% Wilson）
- 判人准确率（human 被正确判人）：${pct(s.hAsHuman, s.human)}；判 AI 准确率（ai 被正确判 AI）：${pct(s.aAsAi, s.ai)}
- \`UNCERTAIN\` 占比：**${s.uncertainShare}**（${s.uncertain}/${s.n}）
- 剔除 \`UNCERTAIN\` 后：**${s.decidedCi}**（${s.decidedCorrect}/${s.decided}）
- 平均耗时：${(s.meanMs / 1000).toFixed(1)}s/条
`;

const all = stats(rows);
const perDataset = ORDER.map((d) => [d, stats(rows.filter((r) => r.dataset === d))]);

// ---- failure cases: wrong class, highest confidence first, spread over datasets ----
const wrong = rows
  .filter((r) => r.parse_ok && predClass(r.verdict) !== r.label)
  .sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
const picked = [];
for (const r of wrong) {
  if (picked.length >= 3) break;
  if (!picked.some((p) => p.dataset === r.dataset)) picked.push(r);
}
for (const r of wrong) {
  if (picked.length >= 3) break;
  if (!picked.includes(r)) picked.push(r);
}
const caseMd = picked.map((r, i) => {
  const ev = (r.evidence || []).map((e) => `「${e.quote}」→ ${e.why}`).join('；') || '（无 evidence）';
  return `**失败案例 ${i + 1} — ${r.id}（${r.dataset}，真实 ${r.label}，判定 ${r.verdict} @ ${r.confidence}）**

> ${r.text.slice(0, 200).replace(/\n/g, ' ')}……

- evidence：${ev}
- caveats：${r.caveats || '（无）'}
`;
}).join('\n');

const verdictDist = ORDER.map((d) => {
  const s = perDataset.find(([x]) => x === d)[1];
  const f = (l, v) => s.verdicts[`${l}:${v}`] || 0;
  return `| ${d} | ${f('human', 'LIKELY_HUMAN')}/${f('ai', 'LIKELY_HUMAN')} | ${f('human', 'UNCERTAIN')}/${f('ai', 'UNCERTAIN')} | ${f('human', 'LIKELY_AI')}/${f('ai', 'LIKELY_AI')} | ${f('human', 'AI')}/${f('ai', 'AI')} |`;
}).join('\n');

const md = `# judge-v1 评测结果

- 数据集：RAID（长文摘要，llama-chat/mpt/mpt-chat/mistral/mistral-chat，attack=none）、HC3-en、HC3-zh（短问答，老 ChatGPT）
- 判定模型：\`opencode-go/deepseek-v4.1-flash\`，每条一个全新会话，输入为 \`prompt-judge-v1.md\` 全文（\`{{TEXT}}\` 替换）
- 判定规则：\`AI\`+\`LIKELY_AI\` = 判 AI；\`LIKELY_HUMAN\`+\`UNCERTAIN\` = 判人
- 样本：${rows.length} 条，每条数据集 human/ai 各 ≤10

## 1. 各数据集

${perDataset.map(([d, s]) => table(d, s)).join('\n')}

## 2. 覆盖度（UNCERTAIN 与剔除后准确率）

| 数据集 | UNCERTAIN 占比 | 剔除 UNCERTAIN 后准确率 | 总体准确率 |
|---|---|---|---|
${perDataset.map(([d, s]) => `| ${d} | ${s.uncertainShare}（${s.uncertain}/${s.n}） | ${s.decidedAcc}（${s.decidedCorrect}/${s.decided}） | ${s.accCi} |`).join('\n')}

## 3. 三数据集合并

${table('全部样本', all)}

分档位分布（human 条数 / ai 条数）：

| 数据集 | LIKELY_HUMAN | UNCERTAIN | LIKELY_AI | AI |
|---|---|---|---|---|
${verdictDist}
| 合计 | ${all.verdicts['human:LIKELY_HUMAN'] || 0}/${all.verdicts['ai:LIKELY_HUMAN'] || 0} | ${all.verdicts['human:UNCERTAIN'] || 0}/${all.verdicts['ai:UNCERTAIN'] || 0} | ${all.verdicts['human:LIKELY_AI'] || 0}/${all.verdicts['ai:LIKELY_AI'] || 0} | ${all.verdicts['human:AI'] || 0}/${all.verdicts['ai:AI'] || 0} |

## 4. 失败案例

共 ${wrong.length} 条判错（按置信度降序取 3 条）：

${caseMd}
`;

writeFileSync(new URL('./results.md', import.meta.url), md);
console.log(md);
