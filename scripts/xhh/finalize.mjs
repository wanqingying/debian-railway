// Normalise the dataset against one fresh feed snapshot: reassign `rank` to the current
// feed order and (by default) drop posts that are no longer in the top N, together with
// their comments. Feed order drifts between runs, so without this the table accumulates
// rows from earlier snapshots with stale rank numbers.
//
// Usage: node scripts/xhh/finalize.mjs --posts 120 [--keep-extra]
import { chromium } from 'playwright-core';
import { openDb } from './db.mjs';

const arg = (name, def) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
};
const N = Number(arg('--posts', 120));
const KEEP_EXTRA = process.argv.includes('--keep-extra');
const DB_PATH = arg('--db', new URL('../../data/xhh.db', import.meta.url).pathname);
const HOME = 'https://www.xiaoheihe.cn/app/bbs/home';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ts = () => new Date().toISOString().slice(11, 19);

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222', { noDefaults: true, isLocal: true });
const page = await (browser.contexts()[0]).newPage();
let feeds = null;
page.on('request', (r) => { if (!feeds && /\/bbs\/app\/feeds\?/.test(r.url())) feeds = r.url(); });
try { await page.goto(HOME, { waitUntil: 'commit' }); } catch { /* SPA may never settle */ }
for (let i = 0; i < 30 && !feeds; i++) await page.waitForTimeout(500);
if (!feeds) throw new Error('no feeds template captured');

const getJson = async (u) => {
  await sleep(2500);
  const res = await page.evaluate(async (x) => {
    const r = await fetch(x, { credentials: 'include' });
    return { status: r.status, body: await r.text() };
  }, u);
  if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
  return JSON.parse(res.body).result;
};

const apiUrl = (offset) => {
  const u = new URL(feeds);
  u.searchParams.set('offset', String(offset));
  u.searchParams.set('pull', '0');
  return u.toString();
};

// Ids arrive as strings from the API and come back as INTEGER from SQLite (column
// affinity). Comparing the two raw types silently fails: every post then looks absent
// from the feed and gets deleted - which is exactly how this script once wiped the DB.
const key = (v) => String(v);

const order = [];
const seen = new Set();
for (let offset = 0; offset < N * 3 && order.length < N; ) {
  const r = await getJson(apiUrl(offset));
  const links = r.links || [];
  if (!links.length) break;
  for (const l of links) if (!seen.has(key(l.linkid))) { seen.add(key(l.linkid)); order.push(key(l.linkid)); }
  offset += links.length;
  console.log(ts(), `feed offset=${offset} seen=${order.length}`);
}

const db = openDb(DB_PATH);
const before = db.prepare('SELECT COUNT(*) n FROM posts').get().n;
const updateRank = db.prepare('UPDATE posts SET rank=? WHERE post_id=?');
order.forEach((id, i) => updateRank.run(i + 1, Number(id)));

let removed = 0;
if (!KEEP_EXTRA) {
  const keep = new Set(order);
  const all = db.prepare('SELECT post_id FROM posts').all();
  const doomed = all.filter((r) => !keep.has(key(r.post_id)));
  // Safety rail: a mass delete means the id comparison broke again, not that the feed
  // legitimately dropped the whole set. Refuse rather than destroy the dataset.
  if (doomed.length > all.length * 0.5 && all.length > 10) {
    throw new Error(`refusing to delete ${doomed.length}/${all.length} posts - feed ids do not match stored ids`);
  }
  for (const { post_id } of doomed) {
    db.prepare('DELETE FROM comments WHERE post_id=?').run(post_id);
    db.prepare('DELETE FROM posts WHERE post_id=?').run(post_id);
    removed++;
  }
}

const inList = db.prepare(`SELECT COUNT(*) n FROM posts WHERE rank BETWEEN 1 AND ?`).get(N).n;
const withComments = db.prepare('SELECT COUNT(*) n FROM posts WHERE comments_n>0').get().n;
const comments = db.prepare('SELECT COUNT(*) n FROM comments').get().n;
console.log(`posts ${before} -> ${db.prepare('SELECT COUNT(*) n FROM posts').get().n} (removed ${removed} outside the feed snapshot)`);
console.log(`in top ${N}: ${inList}, with comments: ${withComments}, comments total: ${comments}`);

await page.close().catch(() => {});
await browser.close().catch(() => {});
db.close();
