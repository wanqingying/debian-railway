// Judge the xhh dataset in two separate measurements:
//   1) posts   - is the post body AI-generated?
//   2) comments- is the comment text AI-generated? (stratified sample, cleaned)
// Batch size 10, concurrency 6, through the local opencode HTTP API.
//
// Usage: node xhh-run.mjs [--posts-only] [--comments-only] [--limit N]
import { appendFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const API = 'http://127.0.0.1:4096';
const AUTH = 'Basic ' + Buffer.from('opencode:qingying').toString('base64');
const MODEL = { providerID: 'opencode-go', id: 'deepseek-v4.1-flash' };
const DIR = '/tmp/opencode/judge-run';
const DB = '/workspace/debian-railway/data/xhh.db';
const BATCH = 10;
const CONCURRENCY = 6;
const THRESHOLD = 0.75;

const has = (flag) => process.argv.includes(flag);
const arg = (n, d) => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? Number(process.argv[i + 1]) : d;
};

/* ---------- tolerant JSON parsing (same strategy as judge.mjs) ---------- */
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
const stripTrailing = (s) => {
  let out = '', inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (esc) { out += c; esc = false; continue; }
    if (c === '\\') { out += c; if (inStr) esc = true; continue; }
    if (c === '"') { inStr = !inStr; out += c; continue; }
    if (!inStr && c === ',') {
      let j = i + 1;
      while (j < s.length && /\s/.test(s[j])) j++;
      if (s[j] === '}' || s[j] === ']') continue;
    }
    out += c;
  }
  return out.replace(/,\s*"\s*}/g, '}').replace(/,\s*"\s*\]/g, ']');
};
const parseBatch = (raw) => {
  const cleaned = raw.replace(/```(?:json)?/gi, '').replace(/^[^{]*/, '').trim();
  const cands = jsonCandidates(cleaned);
  for (let k = cands.length - 1; k >= 0; k--) {
    for (const a of [cands[k], rebalance(stripTrailing(cands[k]))]) {
      try {
        const o = JSON.parse(a);
        if (Array.isArray(o.results)) return o.results;
      } catch { /* next */ }
    }
  }
  try {
    const o = JSON.parse(rebalance(stripTrailing(cleaned)));
    if (Array.isArray(o.results)) return o.results;
  } catch { /* give up */ }
  return null;
};

/* ---------- cleaning ---------- */
const clean = (t) =>
  String(t || '')
    .replace(/<[^>]*>/g, ' ')                    // html tags (incl. heybox deep links)
    .replace(/\]\([^)]*\)/g, ']')                // markdown links
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\[cube_[^\]]*\]/gi, '')            // site emoji codes
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '')
    .replace(/&(?:nbsp|amp|lt|gt|quot);/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/* ---------- corpus ---------- */
const db = new DatabaseSync(DB, { readOnly: true });
const all = (s) => db.prepare(s).all();

const posts = all(
  'SELECT post_id, title, body, description, truncated, comment_num, create_at FROM posts ORDER BY post_id',
).map((p) => ({
  kind: 'post',
  id: `p${p.post_id}`,
  text: clean(p.body),
  title: clean(p.title),
  previewOnly: p.body === p.description ? 1 : 0,
  truncated: p.truncated ? 1 : 0,
  comments: p.comment_num,
}));

const rawComments = all(
  'SELECT comment_id, post_id, depth, up, text FROM comments ORDER BY post_id, floor_num',
).map((c) => ({ ...c, cleaned: clean(c.text) }));

const titleOf = new Map(posts.map((p) => [String(p.id).slice(1), p.title]));
const commentsAll = rawComments
  .filter((c) => c.cleaned.length >= 8)
  .map((c) => ({
    kind: 'comment',
    id: `c${c.comment_id}`,
    text: c.cleaned,
    title: titleOf.get(String(c.post_id)) || '',
    depth: c.depth,
    up: c.up,
    len: c.cleaned.length,
  }));

// Stratified sample: every comment >=100 chars, a fixed slice of 30-99, and a
// small slice of short ones so the short bucket is not invisible.
const shuffle = (a) => {
  const x = [...a];
  for (let i = x.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [x[i], x[j]] = [x[j], x[i]];
  }
  return x;
};
const byLen = (lo, hi) => commentsAll.filter((c) => c.len >= lo && c.len < hi);
const sampledComments = [
  ...byLen(100, 1e9),
  ...shuffle(byLen(30, 100)).slice(0, arg('--mid', 400)),
  ...shuffle(byLen(8, 30)).slice(0, arg('--short', 100)),
];
// keep batches thread-local: sorting by title groups a post's comments together
sampledComments.sort((a, b) => (a.title < b.title ? -1 : a.title > b.title ? 1 : 0));

const corpus = [...(has('--comments-only') ? [] : posts.filter((p) => p.text.length >= 20)), ...(has('--posts-only') ? [] : sampledComments)];
const limit = arg('--limit', Infinity);
const items = corpus.slice(0, limit);

console.log(`语料: 帖子 ${posts.filter((p) => p.text.length >= 20).length} / 评论样本 ${sampledComments.length}（≥100字 ${byLen(100, 1e9).length}，30–99 抽 400，8–29 抽 100）`);
console.log(`本次判定 ${items.length} 条，批大小 ${BATCH}，并发 ${CONCURRENCY}`);

/* ---------- api ---------- */
const api = async (path, init = {}) => {
  const r = await fetch(API + path, {
    ...init,
    headers: { authorization: AUTH, 'content-type': 'application/json' },
    signal: AbortSignal.timeout(30_000),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status} ${path}: ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PROMPT = `你是文本取证分析员。下面是一批**互相独立**的条目，每条一个 id。对每一条分别估计：它由大语言模型生成的概率 p_ai（0–1，两位小数）。

规则：
1. 逐条独立判断，不得互相比较、不得让某条的结论影响另一条。同一批里可能是同一帖子的不同评论，**同帖不代表同一作者**，允许同批内分数截然不同。
2. 评论类条目带 \"帖子\" 字段，那是它所回复的帖子标题，仅作语境：如果这条评论与该帖主题无实质关系、或明显是通用套话/推广，这是机器或水军的强证据（可给高分）。
3. 噪声不构成任何方向：HTML 残留、表情码、OCR 错字、被截断的句子都不算人味也不算机器味。
4. 短文本（<150 字）默认 0.30–0.60，除非有硬信号（对话残留、未清理的 Markdown、模板占位、复述式空转）→ ≥0.95。
5. 语言能力不等于 AI：非母语写作、翻译腔、模板化问答天然规整，遇到就往 0.30–0.60 收。
6. 证据族：A 结构（段落等长、总-分-总、论点恰好 3/5 个）、B 内容（泛化到无信息、无来源数字、正确但无用的建议）、C 语言（衔接过顺、术语密度均匀、成簇排比、同义替换重复）、D 交互（对读者说话、对称礼貌收尾、「首先其次最后」）。同族只算一次，≥2 族同向才给 0.62 以上。
7. 标定：硬信号 0.95–1.00；3–4 族 0.80–0.94；2 族 0.62–0.79；1 族或短文本 0.35–0.60；有具体人类痕迹 0.05–0.30。禁止习惯性给 0.55。

只输出一个 JSON 对象，按输入顺序，id 逐字回显：
{"results":[{"id":"…","p_ai":0.00}]}
不要其它字段、不要解释，条数必须等于输入条数。

条目：
{{BATCH}}`;

const runBatch = async (group) => {
  const s = await api('/api/session', {
    method: 'POST',
    body: JSON.stringify({ title: 'xhh', location: { directory: DIR }, model: MODEL }),
  });
  const sid = s.data.id;
  const block = group
    .map((it) =>
      it.kind === 'comment'
        ? `<item id="${it.id}" 帖子="${it.title.replace(/"/g, '')}">${it.text}</item>`
        : `<item id="${it.id}" 类型="帖子正文">${it.text}</item>`,
    )
    .join('\n');
  const prompt = PROMPT.replaceAll('{{BATCH}}', block);
  const t0 = Date.now();
  await api(`/api/session/${sid}/prompt`, { method: 'POST', body: JSON.stringify({ text: prompt }) });
  let text = '';
  while (Date.now() - t0 < 240_000) {
    await sleep(1500);
    const j = await api(`/api/session/${sid}/message`);
    const m = (j.data || []).filter((x) => x.type === 'assistant').pop();
    if (!m) continue;
    text = (m.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
    if (m.finish && text) break;
  }
  const rows = parseBatch(text);
  const ms = Date.now() - t0;
  if (!rows) {
    appendFileSync('/tmp/opencode/xhh-fails.jsonl', JSON.stringify({ ids: group.map((g) => g.id), text }) + '\n');
    console.log(`  ! 批解析失败 (${group.length} 条, ${(ms / 1000).toFixed(0)}s)`);
    return group.map((g) => ({ id: g.id, p_ai: null, ms }));
  }
  const map = new Map(rows.map((r) => [String(r.id), r.p_ai]));
  const got = group.filter((g) => typeof map.get(g.id) === 'number').length;
  console.log(`  批 ${group.length} 条 → 命中 ${got}，${(ms / 1000).toFixed(0)}s`);
  return group.map((g) => ({ id: g.id, p_ai: typeof map.get(g.id) === 'number' ? map.get(g.id) : null, ms }));
};

const groups = [];
for (let i = 0; i < items.length; i += BATCH) groups.push(items.slice(i, i + BATCH));

const started = Date.now();
const results = new Array(groups.length);
let next = 0;
const worker = async () => {
  while (true) {
    const i = next++;
    if (i >= groups.length) return;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        results[i] = await runBatch(groups[i]);
        break;
      } catch (e) {
        if (attempt === 2) {
          console.log(`  ! 批失败 ${groups[i].length} 条: ${e.message}`);
          results[i] = groups[i].map((g) => ({ id: g.id, p_ai: null, ms: 0 }));
        }
      }
    }
  }
};
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, groups.length) }, worker));

const flat = results.flat();
const scoreOf = new Map(flat.map((r) => [r.id, r.p_ai]));
const rows = items.map((it) => ({ ...it, p_ai: scoreOf.has(it.id) ? scoreOf.get(it.id) : null }));
const wall = (Date.now() - started) / 1000;

writeFileSync(
  '/workspace/debian-railway/docs/research/ai-text-detection-2026-11-04/judge/xhh-results.json',
  JSON.stringify({ wall, batch: BATCH, threshold: THRESHOLD, rows }, null, 1),
);

/* ---------- report ---------- */
const wilson = (k, n, z = 1.96) => {
  if (!n) return [0, 0];
  const p = k / n, den = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / den;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / den;
  return [Math.max(0, c - h), Math.min(1, c + h)];
};
const pct = (k, n) => (n ? ((100 * k) / n).toFixed(1) + '%' : '—');
const ci = (k, n) => {
  const [lo, hi] = wilson(k, n);
  return `${pct(k, n)} [${(100 * lo).toFixed(1)}–${(100 * hi).toFixed(1)}]`;
};
const summarize = (label, subset) => {
  const ok = subset.filter((r) => typeof r.p_ai === 'number');
  const ai = ok.filter((r) => r.p_ai >= THRESHOLD).length;
  const unc = ok.filter((r) => r.p_ai >= 0.3 && r.p_ai < THRESHOLD).length;
  const hum = ok.filter((r) => r.p_ai < 0.3).length;
  const mean = ok.length ? ok.reduce((s, r) => s + r.p_ai, 0) / ok.length : 0;
  return `| ${label} | ${ok.length} | **${ci(ai, ok.length)}** | ${pct(unc, ok.length)} | ${pct(hum, ok.length)} | ${mean.toFixed(3)} |`;
};

const postRows = rows.filter((r) => r.kind === 'post');
const commentRows = rows.filter((r) => r.kind === 'comment');
const out = [];
out.push('# xhh 数据集 AI 文本比例（帖子 / 评论 分开计算）\n');
out.push(`判定器：\`prompt-judge-v4\` 的批量版（10 条/批，并发 ${CONCURRENCY}），模型 \`opencode-go/deepseek-v4.1-flash\`。`);
out.push(`阈值：\`p_ai ≥ ${THRESHOLD}\` 判 AI，\`0.30–${THRESHOLD}\` 不确定，\`< 0.30\` 人类倾向。`);
out.push(`耗时 ${wall.toFixed(0)}s，共 ${items.length} 条，${groups.length} 次调用。\n`);
out.push('| 群体 | 样本 | **AI 比例 (95% CI)** | 不确定 | 人类倾向 | 平均 p_ai |');
out.push('|---|---|---|---|---|---|');
out.push(summarize('帖子（全部）', postRows));
out.push(summarize('帖子·正文完整', postRows.filter((r) => !r.previewOnly)));
out.push(summarize('帖子·仅 150 字预览', postRows.filter((r) => r.previewOnly)));
out.push(summarize('评论（全部样本）', commentRows));
out.push(summarize('评论·≥100 字', commentRows.filter((r) => r.len >= 100)));
out.push(summarize('评论·30–99 字', commentRows.filter((r) => r.len >= 30 && r.len < 100)));
out.push(summarize('评论·8–29 字', commentRows.filter((r) => r.len < 30)));
out.push('\n> 评论为分层抽样（≥100 字全量 + 30–99 字随机 400 + 8–29 字随机 100），不是全量。');
out.push('> 「帖子·仅 150 字预览」的正文是列表接口的截断预览，判定受长度影响，宜单独看。');

writeFileSync('/workspace/debian-railway/docs/research/ai-text-detection-2026-11-04/judge/xhh-report.md', out.join('\n') + '\n');
console.log('\n' + out.join('\n'));
