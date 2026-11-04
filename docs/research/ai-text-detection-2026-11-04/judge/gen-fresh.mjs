// Generate fresh 2026-model text in the xhh distribution, to test whether a
// calibration set built on 2023-24 model output still detects current models.
// Generators differ from the judge on purpose.
import { writeFileSync } from 'node:fs';

const API = 'http://127.0.0.1:4096';
const AUTH = 'Basic ' + Buffer.from('opencode:qingying').toString('base64');
const DIR = '/tmp/opencode/judge-run';

const GEN = [
  { providerID: 'opencode-go', id: 'gpt-5.6-luna' },
  { providerID: 'opencode-go', id: 'glm-5.3' },
];

const TOPICS = [
  '吐槽一个买了就后悔的游戏',
  '推荐一个冷门但好玩的独立游戏',
  '问大家某个游戏值不值得买',
  '分享自己打某个 BOSS 的心得',
  '讨论游戏涨价这件事',
  '说说自己为什么退坑某个网游',
  '安利一个模组',
  '抱怨联机队友',
  '分享一个游戏里的小技巧',
  '聊游戏里最离谱的剧情',
];

const POSTS = (topic) =>
  `你在中文游戏社区「小黑盒」发帖。主题：${topic}。\n` +
  `要求：像普通玩家本人一样写，200–400 字，带一点个人经历和具体细节，口语化，不要小标题、不要列表、不要总结段、不要「首先其次最后」。直接输出帖子正文，不要任何解释。`;

const COMMENTS = (topic) =>
  `你在中文游戏社区「小黑盒」的帖子「${topic}」下写一条评论。\n` +
  `要求：像普通玩家随口说的，20–60 字，可以带一点个人看法或吐槽。直接输出评论内容，不要解释。`;

const api = async (path, init = {}) => {
  const r = await fetch(API + path, {
    ...init,
    headers: { authorization: AUTH, 'content-type': 'application/json' },
    signal: AbortSignal.timeout(30_000),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t.slice(0, 160)}`);
  return t ? JSON.parse(t) : null;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const gen = async (model, prompt) => {
  const s = await api('/api/session', {
    method: 'POST',
    body: JSON.stringify({ title: 'gen', location: { directory: DIR }, model }),
  });
  const sid = s.data.id;
  await api(`/api/session/${sid}/prompt`, { method: 'POST', body: JSON.stringify({ text: prompt }) });
  const t0 = Date.now();
  let text = '';
  while (Date.now() - t0 < 120_000) {
    await sleep(1200);
    const j = await api(`/api/session/${sid}/message`);
    const m = (j.data || []).filter((x) => x.type === 'assistant').pop();
    if (!m) continue;
    text = (m.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim();
    if (m.finish && text) break;
  }
  return text;
};

const jobs = [];
for (const model of GEN) {
  for (const topic of TOPICS) {
    jobs.push({ model, kind: 'post', topic, prompt: POSTS(topic) });
    jobs.push({ model, kind: 'comment', topic, prompt: COMMENTS(topic) });
  }
}

const out = [];
let next = 0;
const worker = async () => {
  while (true) {
    const i = next++;
    if (i >= jobs.length) return;
    const j = jobs[i];
    try {
      const text = await gen(j.model, j.prompt);
      out.push({
        id: `gen-${j.model.id}-${j.kind}-${i}`,
        dataset: 'gen2026',
        label: 'ai',
        genre: j.kind,
        text,
        generator: j.model.id,
        topic: j.topic,
      });
      console.log(`  ${j.model.id} ${j.kind} ${text.length}字`);
    } catch (e) {
      console.log(`  ! ${j.model.id} ${j.kind}: ${e.message}`);
    }
  }
};
await Promise.all(Array.from({ length: 6 }, worker));

const items = out.filter((o) => o.text && o.text.length > 10);
writeFileSync(new URL('./gen2026.jsonl', import.meta.url), items.map((o) => JSON.stringify(o)).join('\n') + '\n');
console.log(`\n生成 ${items.length} 条 (帖子 ${items.filter((i) => i.genre === 'post').length}, 评论 ${items.filter((i) => i.genre === 'comment').length})`);
