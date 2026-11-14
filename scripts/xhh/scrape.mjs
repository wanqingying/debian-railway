// Collect 小黒盒 BBS feed posts + their comment trees into data/xhh.db.
//
// The browser is the only credential store: every request is issued from inside the
// logged-in page over CDP, so cookies and the site's own query stamps (hkey/_time/nonce)
// are those the SPA itself produced. Nothing is reverse-engineered or signed by hand.
//
// Usage:
//   node scripts/xhh/scrape.mjs --posts 120 --comments 200
//   node scripts/xhh/scrape.mjs --posts 3 --comments 50 --db /tmp/opencode/xhh-test.db   (smoke test)
//
// Query-stamp templates are captured from the live app (feeds list and one post page).
// Only the parameters we care about (offset, page, link_id, root_comment_id, lastval) are
// overridden; everything else is passed through untouched.
import { chromium } from 'playwright-core';
import { openDb, startRun, finishRun, upsertPost, insertComment, setPostCommentCounts, logCrawl, now } from './db.mjs';

const arg = (name, def) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
};
const N_POSTS = Number(arg('--posts', 120));
const N_COMMENTS = Number(arg('--comments', 200));
// Reserve part of the per-post budget for replies: a post with hundreds of top-level
// comments would otherwise spend the whole budget on roots and store no nesting at all.
const ROOT_CAP = Number(arg('--root-cap', Math.min(120, N_COMMENTS)));
const DB_PATH = arg('--db', new URL('../../data/xhh.db', import.meta.url).pathname);
const DELAY_MS = Number(arg('--delay', 400));
// The site's WAF blocks the container IP after a few thousand requests in a few minutes
// (403 openresty on both www and api, reproducible with plain curl). Pace the run and
// pause between batches; a blocked run resumes with --skip-done once the block clears.
const BATCH = Number(arg('--batch', 40));
const BATCH_PAUSE_S = Number(arg('--batch-pause', 60));
const SKIP_DONE = process.argv.includes('--skip-done');
const REFRESH_POSTS = process.argv.includes('--refresh-posts');
const HOME = 'https://www.xiaoheihe.cn/app/bbs/home';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ts = () => new Date().toISOString().slice(11, 19);
const log = (...a) => console.log(ts(), ...a);

// ---------- browser plumbing ----------

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222', { noDefaults: true, isLocal: true });
const ctx = browser.contexts()[0];
const page = await ctx.newPage();
page.setDefaultTimeout(60_000);

const templates = { feeds: null };
page.on('request', (r) => {
  const u = r.url();
  if (!templates.feeds && /\/bbs\/app\/feeds\?/.test(u)) templates.feeds = u;
});

// Issue the request from inside the page so it carries the logged-in session.
const callApi = async (urlLike) => {
  await sleep(DELAY_MS);
  const res = await page.evaluate(async (u) => {
    const r = await fetch(u, { credentials: 'include' });
    const t = await r.text();
    return { status: r.status, body: t };
  }, String(urlLike));
  if (res.status !== 200) throw new Error(`HTTP ${res.status} ${String(urlLike).slice(0, 120)}`);
  let j;
  try { j = JSON.parse(res.body); } catch { throw new Error(`non-JSON response ${String(urlLike).slice(0, 120)}`); }
  if (!j || j.result === undefined) throw new Error(`no result: ${JSON.stringify(j).slice(0, 160)}`);
  return j.result;
};

// Build any BBS API URL from the captured feeds template: the site's query stamps
// (hkey/_time/nonce/...) are not path-bound, so swapping the path is enough. This avoids
// navigating to a post page just to observe one request - that navigation is slow and
// occasionally times out on the SPA.
const apiUrl = (path, patch = {}) => {
  const u = new URL(templates.feeds);
  u.pathname = path;
  for (const k of ['pull', 'offset', 'dw']) u.searchParams.delete(k);
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined) u.searchParams.delete(k);
    else u.searchParams.set(k, String(v));
  }
  return u.toString();
};

// ---------- feed list ----------

const captureTemplate = async () => {
  templates.feeds = null;
  try {
    await page.goto(HOME, { waitUntil: 'commit' });
  } catch { /* the SPA often never fires domcontentloaded; the request still goes out */ }
  for (let i = 0; i < 30 && !templates.feeds; i++) await page.waitForTimeout(500);
  if (!templates.feeds) throw new Error('could not capture a feeds template URL');
  return templates.feeds;
};

const collectFeed = async (limit) => {
  const seen = new Map();
  // The list returns 10 links per call and `offset` advances by exactly that many.
  for (let offset = 0; offset < limit * 3 && seen.size < limit; ) {
    const url = apiUrl('/bbs/app/feeds', { offset, pull: 0 });
    let r;
    for (let attempt = 1; ; attempt++) {
      try { r = await callApi(url); break; } catch (e) {
        if (attempt >= 2) throw e;
        log('feeds retry after', e.message);
        await captureTemplate();
      }
    }
    const links = r.links || [];
    if (!links.length) break;
    for (const l of links) if (!seen.has(l.linkid)) seen.set(l.linkid, l);
    offset += links.length;
    log(`feeds offset=${offset} got=${links.length} total=${seen.size}`);
  }
  return [...seen.values()].slice(0, limit);
};

// ---------- post + comments ----------

const decodeBody = (link) => {
  const raw = link.text;
  if (typeof raw !== 'string' || !raw.trim()) return link.description || '';
  try {
    const parts = JSON.parse(raw);
    if (Array.isArray(parts)) return parts.map((p) => (typeof p === 'string' ? p : p.text || '')).join('');
    return typeof parts === 'string' ? parts : JSON.stringify(parts);
  } catch {
    return raw;
  }
};

const normUser = (u) => ({
  id: u && (u.userid ?? u.user_id ?? null),
  name: u && (u.username ?? u.nickname ?? null),
  level: u && u.level_info ? u.level_info.level : null,
});

// One comment row from a tree node (top-level) or a sub-comment node (reply).
const normComment = (n, { postId, parentId, rootId, depth, nowTs }) => {
  const u = normUser(n.user || {});
  const ru = n.replyuser ? normUser(n.replyuser) : null;
  return {
    comment_id: n.commentid,
    post_id: postId,
    parent_id: parentId === undefined ? (n.replyid ?? null) : parentId,
    root_id: rootId,
    depth,
    floor_num: n.floor_num ?? null,
    user_id: u.id != null ? String(u.id) : null,
    user_name: u.name,
    reply_to_user: ru ? ru.name : null,
    text: n.text ?? null,
    create_at: n.create_at ?? null,
    ip_location: n.ip_location ?? null,
    up: n.up ?? null,
    child_num: n.child_num ?? null,
    is_link_owner: n.is_link_owner ?? null,
    is_author_award: n.is_author_award ?? null,
    imgs: n.imgs && n.imgs.length ? JSON.stringify(n.imgs) : null,
    raw: JSON.stringify(n),
    fetched_at: nowTs,
  };
};

// The feeds list only carries a truncated `description`; the full body lives in the
// `link` object of a /link/tree response. Always build the post row from a tree link
// when one is available, and fall back to the feed object otherwise.
const postRow = (link, rank, nowTs) => {
  const user = normUser(link.user || {});
  return {
    post_id: link.linkid,
    rank,
    title: link.title ?? null,
    description: link.description ?? null,
    body: decodeBody(link),
    author_id: user.id != null ? String(user.id) : null,
    author_name: user.name,
    author_level: user.level,
    create_at: link.create_at ?? null,
    ip_location: link.ip_location ?? null,
    comment_num: link.comment_num ?? null,
    up: link.up ?? null,
    down: link.down ?? null,
    click: link.click ?? null,
    favour_count: link.favour_count ?? null,
    forward_num: link.forward_num ?? null,
    award_num: link.link_award_num ?? null,
    link_tag: link.link_tag ?? null,
    is_article: link.is_article ?? null,
    topics: link.topics && link.topics.length ? JSON.stringify(link.topics) : null,
    images: link.imgs && link.imgs.length ? JSON.stringify(link.imgs) : null,
    share_url: link.share_url ?? null,
    raw: JSON.stringify(link),
    fetched_at: nowTs,
  };
};

const collectPost = async (link, db, runId, rank) => {
  const t0 = Date.now();
  const postId = link.linkid;
  const nowTs = now();
  upsertPost(db, postRow(link, rank, nowTs));

  const rows = [];
  const seenIds = new Set(); // paging can repeat a node across pages; keep the first
  let treePages = 0;
  let subCalls = 0;
  let totalPage = 1;
  let budgetHit = false;

  // 1) top-level comments, one API page at a time
  for (let p = 1; p <= totalPage; p++) {
    const url = apiUrl('/bbs/app/link/tree', { link_id: postId, page: p, is_first: p === 1 ? 1 : 0, limit: 20, index: 1 });
    const r = await callApi(url);
    treePages++;
    // page 1 carries the full post object (the feed copy only has a 150-char preview)
    if (p === 1 && r.link && r.link.linkid) upsertPost(db, postRow(r.link, rank, nowTs));
    totalPage = r.total_page || 1;
    const wraps = r.comments || [];
    if (!wraps.length) break;
    for (const w of wraps) {
      for (const n of w.comment || []) {
        if (seenIds.has(n.commentid)) continue;
        if (rows.length >= ROOT_CAP) { budgetHit = rows.length >= N_COMMENTS; break; }
        seenIds.add(n.commentid);
        rows.push(normComment(n, { postId, parentId: null, rootId: n.commentid, depth: 0, nowTs }));
      }
      if (budgetHit) break;
    }
    if (rows.length >= ROOT_CAP || p >= totalPage) break;
  }

  // 2) replies for every root that has children, until the per-post budget is spent
  const roots = rows.filter((r) => r.depth === 0);
  const byId = new Map(rows.map((r) => [r.comment_id, r]));
  for (const root of roots) {
    if (rows.length >= N_COMMENTS) { budgetHit = true; break; }
    if (!root.child_num) continue;
    let lastval = null;
    for (let guard = 0; guard < 40; guard++) {
      const url = apiUrl('/bbs/app/comment/sub/comments', {
        root_comment_id: root.comment_id, lastval, link_id: null, page: null, is_first: null, index: null, limit: null,
      });
      const r = await callApi(url);
      subCalls++;
      const subs = r.comments || [];
      for (const n of subs) {
        if (seenIds.has(n.commentid)) continue;
        if (rows.length >= N_COMMENTS) { budgetHit = true; break; }
        seenIds.add(n.commentid);
        const parentId = n.replyid ?? root.comment_id;
        const parent = byId.get(parentId);
        const depth = parent ? parent.depth + 1 : 1;
        const row = normComment(n, { postId, parentId, rootId: root.comment_id, depth, nowTs });
        byId.set(row.comment_id, row);
        rows.push(row);
      }
      if (budgetHit || !r.has_more) break;
      const next = r.lastval;
      if (!next || next === lastval) break;
      lastval = next;
    }
    if (budgetHit) break;
  }

  for (const r of rows) insertComment(db, r);
  // `truncated` also covers the case where the root cap (not the total budget) stopped us.
  setPostCommentCounts(db, postId, rows.length, budgetHit || rows.length >= ROOT_CAP);
  const ms = Date.now() - t0;
  log(`post ${postId} "${(link.title || '').slice(0, 24)}" comments=${stored}/${link.comment_num ?? '?'} roots=${rows.filter((r) => r.depth === 0).length} treePages=${treePages} subCalls=${subCalls} ${(ms / 1000).toFixed(1)}s${budgetHit ? ' [budget]' : ''}`);
  logCrawl(db, { run_id: runId, post_id: postId, ok: true, tree_pages: treePages, sub_calls: subCalls, stored: rows.length, ms });
  return rows.length;
};

// ---------- main ----------

const db = openDb(DB_PATH);
// A post is "done" only when coverage is complete: the stored count reached the per-post
// budget, or reached the server's own comment_num. A post with 3 of 200 comments is partial
// (that is what a wiped dataset looks like) and must be re-collected, not skipped.
const doneSql = `SELECT post_id, comments_n, comment_num FROM posts
                 WHERE comments_n >= MIN(COALESCE(comment_num, 0), ?) AND comments_n > 0`;
const alreadyDone = new Map(
  SKIP_DONE ? db.prepare(doneSql).all(N_COMMENTS).map((r) => [String(r.post_id), r]) : [],
);
const runId = startRun(db, 'posts', `posts=${N_POSTS} comments=${N_COMMENTS} skip_done=${SKIP_DONE}`);
log(`run ${runId} -> ${DB_PATH} (posts=${N_POSTS}, comments<=${N_COMMENTS}/post)`);

let donePosts = 0;
let doneComments = 0;
if (REFRESH_POSTS) {
  // Re-read post metadata/body for rows already in the DB (one tree call each) without
  // touching comments - used after the feed object turned out to carry only a preview.
  await captureTemplate();
  const rows = db.prepare('SELECT post_id, rank FROM posts ORDER BY rank').all();
  let fixed = 0;
  for (const { post_id, rank } of rows) {
    try {
      const r = await callApi(apiUrl('/bbs/app/link/tree', { link_id: post_id, page: 1, is_first: 1, limit: 20, index: 1 }));
      if (r.link) { upsertPost(db, postRow(r.link, rank, now())); fixed++; }
      log(`refresh ${post_id} body=${(r.link && r.link.text ? r.link.text.length : 0)}`);
    } catch (e) {
      log(`refresh ${post_id} FAILED: ${e.message}`);
      if (/Failed to fetch|403/.test(e.message)) break;
    }
  }
  finishRun(db, runId, 'done', { posts: fixed, comments: 0 }, 'refresh-posts');
  log(`REFRESH DONE: ${fixed}/${rows.length} posts`);
  await page.close().catch(() => {});
  await browser.close().catch(() => {});
  db.close();
  process.exit(0);
}

try {
  await captureTemplate();
  const feed = await collectFeed(N_POSTS);
  log(`feed collected: ${feed.length} posts`);

  let i = 0;
  let sincePause = 0;
  for (const link of feed) {
    i++;
    if (SKIP_DONE && alreadyDone.has(String(link.linkid))) { log(`skip ${link.linkid} (complete)`); continue; }
    if (sincePause >= BATCH && BATCH_PAUSE_S > 0) {
      log(`batch pause ${BATCH_PAUSE_S}s after ${sincePause} posts`);
      await sleep(BATCH_PAUSE_S * 1000);
      sincePause = 0;
    }
    sincePause++;
    if (i > 1 && i % 25 === 0) {
      // refresh query stamps so a stale _time/nonce cannot fail a whole batch
      await captureTemplate();
    }
    try {
      doneComments += await collectPost(link, db, runId, donePosts + 1);
      donePosts++;
    } catch (e) {
      log(`post ${link.linkid} FAILED: ${e.message}`);
      logCrawl(db, { run_id: runId, post_id: link.linkid, ok: false, tree_pages: 0, sub_calls: 0, stored: 0, ms: 0, error: e.message.slice(0, 300) });
      try { await captureTemplate(); } catch { /* keep going */ }
    }
    log(`progress ${i}/${feed.length} posts, ${doneComments} comments`);
  }
  finishRun(db, runId, 'done', { posts: donePosts, comments: doneComments });
  log(`DONE: ${donePosts} posts, ${doneComments} comments`);
} catch (e) {
  log('FATAL', e.message);
  finishRun(db, runId, 'failed', { posts: donePosts, comments: doneComments }, e.message.slice(0, 300));
  process.exitCode = 1;
} finally {
  await page.close().catch(() => {});
  await browser.close().catch(() => {});
  db.close();
}
