// Export data/xhh.db to a reviewable JSON snapshot (data/xhh.json).
// Comments are nested (children arrays) so the reply structure is obvious in a diff,
// while the DB keeps the flat parent_id form for queries.
// Usage: node scripts/xhh/export.mjs [--db path] [--out path]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { openDb } from './db.mjs';

const arg = (name, def) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
};
const DB_PATH = arg('--db', new URL('../../data/xhh.db', import.meta.url).pathname);
const OUT = arg('--out', new URL('../../data/xhh.json', import.meta.url).pathname);

const db = openDb(DB_PATH);
const posts = db.prepare('SELECT * FROM posts ORDER BY rank').all();
const stmt = db.prepare('SELECT * FROM comments WHERE post_id=? ORDER BY create_at');

const parseJson = (s) => {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
};

const out = posts.map((p) => {
  const rows = stmt.all(p.post_id);
  const nodes = new Map();
  for (const r of rows) {
    nodes.set(r.comment_id, {
      id: r.comment_id,
      parent_id: r.parent_id,
      depth: r.depth,
      floor: r.floor_num,
      user: r.user_name,
      user_id: r.user_id,
      reply_to_user: r.reply_to_user,
      text: r.text,
      create_at: r.create_at,
      ip_location: r.ip_location,
      up: r.up,
      child_num: r.child_num,
      by_author: r.is_link_owner === 1,
      images: parseJson(r.imgs),
      children: [],
    });
  }
  const roots = [];
  for (const n of nodes.values()) {
    const parent = n.parent_id == null ? null : nodes.get(n.parent_id);
    if (parent) parent.children.push(n);
    else roots.push(n);
  }
  const sortRec = (list) => {
    list.sort((a, b) => (a.create_at ?? 0) - (b.create_at ?? 0));
    for (const c of list) sortRec(c.children);
  };
  sortRec(roots);

  return {
    post_id: p.post_id,
    rank: p.rank,
    title: p.title,
    body: p.body,
    description: p.description,
    author: { id: p.author_id, name: p.author_name, level: p.author_level },
    create_at: p.create_at,
    ip_location: p.ip_location,
    stats: {
      up: p.up, down: p.down, click: p.click, favourites: p.favour_count,
      forwards: p.forward_num, awards: p.award_num, comment_num: p.comment_num,
    },
    link_tag: p.link_tag,
    is_article: p.is_article,
    topics: parseJson(p.topics),
    images: parseJson(p.images),
    share_url: p.share_url,
    comments_stored: p.comments_n,
    comments_truncated: p.truncated === 1,
    comments: roots,
  };
});

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ exported_at: Math.floor(Date.now() / 1000), posts: out }, null, 1));

const nComments = out.reduce((s, p) => s + db.prepare('SELECT COUNT(*) n FROM comments WHERE post_id=?').get(p.post_id).n, 0);
console.log(`exported ${out.length} posts, ${nComments} comments -> ${OUT}`);
db.close();
