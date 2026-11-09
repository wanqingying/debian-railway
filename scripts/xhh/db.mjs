// SQLite schema + access layer for data/xhh.db (小黒盒 BBS posts and comment trees).
// Uses node:sqlite only - no external dependencies.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const DDL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS runs (
  run_id      INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT NOT NULL,              -- 'feeds' | 'posts'
  started_at  INTEGER NOT NULL,
  finished_at INTEGER,
  status      TEXT,                       -- 'running' | 'done' | 'failed'
  posts       INTEGER DEFAULT 0,
  comments    INTEGER DEFAULT 0,
  note        TEXT
);

CREATE TABLE IF NOT EXISTS posts (
  post_id      INTEGER PRIMARY KEY,        -- linkid, stable across runs
  rank         INTEGER,                    -- position in the feed when collected
  title        TEXT,
  description  TEXT,                       -- server-side truncated preview
  body         TEXT,                       -- full text, decoded from link.text (JSON rich text)
  author_id    TEXT,
  author_name  TEXT,
  author_level INTEGER,
  create_at    INTEGER,                    -- unix seconds
  ip_location  TEXT,
  comment_num  INTEGER,                    -- total comments the server reports
  up           INTEGER,
  down         INTEGER,
  click        INTEGER,
  favour_count INTEGER,
  forward_num  INTEGER,
  award_num    INTEGER,
  link_tag     INTEGER,
  is_article   INTEGER,
  topics       TEXT,                       -- JSON array
  images       TEXT,                       -- JSON array of {url,width,height}
  share_url    TEXT,
  raw          TEXT,                       -- full API object, for fields we do not model yet
  fetched_at   INTEGER NOT NULL,
  comments_n   INTEGER DEFAULT 0,          -- comments actually stored for this post
  truncated    INTEGER DEFAULT 0           -- 1 when the per-post comment budget cut the tree
);

CREATE TABLE IF NOT EXISTS comments (
  comment_id     INTEGER PRIMARY KEY,      -- commentid
  post_id        INTEGER NOT NULL,
  parent_id      INTEGER,                  -- replyid for replies, NULL for top-level
  root_id        INTEGER,                  -- containing top-level comment (itself for top-level)
  depth          INTEGER NOT NULL DEFAULT 0,
  floor_num      INTEGER,
  user_id        TEXT,
  user_name      TEXT,
  reply_to_user  TEXT,
  text           TEXT,
  create_at      INTEGER,
  ip_location    TEXT,
  up             INTEGER,
  child_num      INTEGER,
  is_link_owner  INTEGER,                  -- comment written by the post author
  is_author_award INTEGER,
  imgs           TEXT,                     -- JSON array
  raw            TEXT,
  fetched_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS crawl_log (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id    INTEGER,
  post_id   INTEGER,
  ok        INTEGER,
  tree_pages INTEGER,
  sub_calls INTEGER,
  stored    INTEGER,
  ms        INTEGER,
  error     TEXT
);

CREATE INDEX IF NOT EXISTS idx_comments_post   ON comments(post_id);
CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_id);
CREATE INDEX IF NOT EXISTS idx_comments_root   ON comments(root_id);
CREATE INDEX IF NOT EXISTS idx_posts_rank      ON posts(rank);
`;

export const openDb = (path) => {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(DDL);
  return db;
};

export const now = () => Math.floor(Date.now() / 1000);

export const startRun = (db, kind, note = null) => {
  const info = db.prepare('INSERT INTO runs (kind, started_at, status, note) VALUES (?, ?, ?, ?)').run(kind, now(), 'running', note);
  return Number(info.lastInsertRowid);
};

export const finishRun = (db, runId, status, counts = {}, note = null) => {
  db.prepare('UPDATE runs SET finished_at=?, status=?, posts=?, comments=?, note=? WHERE run_id=?')
    .run(now(), status, counts.posts ?? 0, counts.comments ?? 0, note, runId);
};

const POST_COLS = [
  'post_id', 'rank', 'title', 'description', 'body', 'author_id', 'author_name', 'author_level',
  'create_at', 'ip_location', 'comment_num', 'up', 'down', 'click', 'favour_count', 'forward_num',
  'award_num', 'link_tag', 'is_article', 'topics', 'images', 'share_url', 'raw', 'fetched_at',
];

export const upsertPost = (db, p) => {
  const vals = POST_COLS.map((c) => (p[c] === undefined ? null : p[c]));
  const sql = `INSERT INTO posts (${POST_COLS.join(',')}) VALUES (${POST_COLS.map(() => '?').join(',')})
    ON CONFLICT(post_id) DO UPDATE SET ${POST_COLS.filter((c) => c !== 'post_id').map((c) => `${c}=excluded.${c}`).join(',')}`;
  db.prepare(sql).run(...vals);
};

export const setPostCommentCounts = (db, postId, n, truncated) => {
  db.prepare('UPDATE posts SET comments_n=?, truncated=? WHERE post_id=?').run(n, truncated ? 1 : 0, postId);
};

const COMMENT_COLS = [
  'comment_id', 'post_id', 'parent_id', 'root_id', 'depth', 'floor_num', 'user_id', 'user_name',
  'reply_to_user', 'text', 'create_at', 'ip_location', 'up', 'child_num', 'is_link_owner',
  'is_author_award', 'imgs', 'raw', 'fetched_at',
];

export const insertComment = (db, c) => {
  const vals = COMMENT_COLS.map((k) => (c[k] === undefined ? null : c[k]));
  db.prepare(`INSERT INTO comments (${COMMENT_COLS.join(',')}) VALUES (${COMMENT_COLS.map(() => '?').join(',')})
    ON CONFLICT(comment_id) DO NOTHING`).run(...vals);
};

export const logCrawl = (db, row) => {
  db.prepare('INSERT INTO crawl_log (run_id, post_id, ok, tree_pages, sub_calls, stored, ms, error) VALUES (?,?,?,?,?,?,?,?)')
    .run(row.run_id, row.post_id, row.ok ? 1 : 0, row.tree_pages, row.sub_calls, row.stored, row.ms, row.error ?? null);
};

export const commentStats = (db) => {
  const total = db.prepare('SELECT COUNT(*) n FROM comments').get().n;
  const byDepth = db.prepare('SELECT depth, COUNT(*) n FROM comments GROUP BY depth ORDER BY depth').all();
  const posts = db.prepare('SELECT COUNT(*) n FROM posts').get().n;
  const postsWith = db.prepare('SELECT COUNT(*) n FROM posts WHERE comments_n > 0').get().n;
  return { posts, postsWithComments: postsWith, comments: total, byDepth };
};
