// Print an overview of data/xhh.db.
// Usage: node scripts/xhh/stats.mjs [--db path]
import { openDb } from './db.mjs';

const arg = (name, def) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
};
const db = openDb(arg('--db', new URL('../../data/xhh.db', import.meta.url).pathname));

const one = (sql, ...p) => db.prepare(sql).get(...p);
const all = (sql, ...p) => db.prepare(sql).all(...p);
const q = (n, d = 0) => (n === null || n === undefined ? '—' : String(n));

const posts = one('SELECT COUNT(*) n FROM posts').n;
const comments = one('SELECT COUNT(*) n FROM comments').n;
const roots = one('SELECT COUNT(*) n FROM comments WHERE parent_id IS NULL').n;
const replies = comments - roots;
const trunc = one('SELECT COUNT(*) n FROM posts WHERE truncated=1').n;
const bodies = all('SELECT length(body) l FROM posts ORDER BY l');
const ctexts = all('SELECT length(text) l FROM comments ORDER BY l');
const med = (a) => (a.length ? a[Math.floor(a.length / 2)].l : 0);

console.log(`posts           ${posts}`);
console.log(`comments        ${comments}  (top-level ${roots}, replies ${replies})`);
console.log(`posts truncated ${trunc}  (budget or root cap cut the tree)`);
console.log(`distinct authors  posts ${one('SELECT COUNT(DISTINCT author_id) n FROM posts').n}, commenters ${one('SELECT COUNT(DISTINCT user_id) n FROM comments').n}`);
console.log(`post body chars  total ${q(one('SELECT SUM(length(body)) n FROM posts').n)}, median ${med(bodies)}, max ${bodies.length ? bodies[bodies.length - 1].l : 0}`);
console.log(`comment chars    total ${q(one('SELECT SUM(length(text)) n FROM comments').n)}, median ${med(ctexts)}, max ${ctexts.length ? ctexts[ctexts.length - 1].l : 0}`);

console.log('\ndepth distribution');
for (const r of all('SELECT depth, COUNT(*) n FROM comments GROUP BY depth ORDER BY depth')) {
  console.log(`  depth ${r.depth}: ${r.n}`);
}

console.log('\ncomments stored per post');
const per = all('SELECT comments_n n FROM posts ORDER BY n');
const buckets = { '0': 0, '1-19': 0, '20-49': 0, '50-99': 0, '100-199': 0, '200': 0 };
for (const r of per) {
  if (r.n === 0) buckets['0']++;
  else if (r.n < 20) buckets['1-19']++;
  else if (r.n < 50) buckets['20-49']++;
  else if (r.n < 100) buckets['50-99']++;
  else if (r.n < 200) buckets['100-199']++;
  else buckets['200']++;
}
for (const [k, v] of Object.entries(buckets)) console.log(`  ${k.padEnd(8)} ${v}`);

console.log('\ntop posts by comments stored');
for (const r of all(`SELECT post_id, rank, substr(title,1,30) t, comment_num, comments_n, truncated
                     FROM posts ORDER BY comments_n DESC LIMIT 8`)) {
  console.log(`  ${r.post_id} #${r.rank} ${String(r.comments_n).padStart(3)}/${String(r.comment_num).padStart(4)}${r.truncated ? '*' : ' '} ${r.t}`);
}

const run = one('SELECT * FROM runs ORDER BY run_id DESC LIMIT 1');
if (run) console.log(`\nlast run: ${run.status} posts=${run.posts} comments=${run.comments} started=${new Date(run.started_at * 1000).toISOString()}`);
const fails = one('SELECT COUNT(*) n FROM crawl_log WHERE ok=0').n;
if (fails) console.log(`failed posts in crawl_log: ${fails}`);
db.close();
