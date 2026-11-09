# xiaoheihe BBS dataset (`data/xhh.db`)

Posts and their comment trees collected from 小黑盒 (`www.xiaoheihe.cn/app/bbs/home`), for later AI-text scanning. Scraping only — no detection is applied here.

## How the data is collected

The browser is the credential store. `scripts/xhh/scrape.mjs` attaches to the container's visible Chromium over CDP (`127.0.0.1:9222`) and issues every request **from inside the logged-in page**, so cookies and the site's own query stamps (`hkey`, `_time`, `nonce`, `heybox_id`) are genuine. Nothing is signed or guessed.

Three endpoints are used, all discovered from the app's own traffic:

| Purpose | Endpoint | Notes |
|---|---|---|
| Post list | `GET /bbs/app/feeds` | 10 posts per call; `offset` advances by the number returned |
| Post + top-level comments | `GET /bbs/app/link/tree` | `link_id`, `page` (1-based), `limit`; returns `link` (the post) plus comment wrappers |
| Replies of one top-level comment | `GET /bbs/app/comment/sub/comments` | `root_comment_id` + cursor `lastval`, `has_more` |

The site's query stamps are **not path-bound**: any of the three URLs can be built from the captured `feeds` URL by swapping the path. That is why the scraper never navigates to a post page (an SPA navigation there occasionally hangs for 60 s).

Nesting is **not** in the tree response — the API returns a flat list where each reply carries `replyid`. Depth is reconstructed locally by walking `replyid` (verified: chains up to depth 5, zero orphans in a 200-comment sample).

### Pacing and the rate limit (measured)

The site rate-limits by request volume, not by "API vs browser": every call above is issued from the logged-in page, and the block hits plain `curl` from the same container too.

- First block: ~2,300 requests in 15 minutes (6.5 s per post, up to 33 sub-comment calls inside one post) → `403 Forbidden / openresty` on both `www` and `api`, page body rendered as bare 403.
- Duration: **12 minutes** (06:51 first failure → 07:03:38 the probe got 200 again). It is a short-window throttle, not a durable ban.
- Safe pace used since: `--delay 2500 --batch 10 --batch-pause 180` (2.5 s between calls, 3 min pause every 10 posts). A 1.2 s pace also ran 25 minutes without a block.

Practical rule: keep average call rate under ~1/second and stop on the first failure. WAF behaviour was not probed further (a threshold sweep would cost another block).

### Body text: the feed copy is a preview

`/bbs/app/feeds` returns each post with an **empty `text` and a ~150-character `description`**. The full body only arrives in the `link` object of `/bbs/app/link/tree`. The scraper therefore re-reads page 1 of the tree for every post and upserts the post row from that object; `--refresh-posts` re-does this for rows already stored (one call per post, comments untouched). Measured effect on the collected set: median `posts.body` went 128 → 1,121 characters, max 16,152.

### Conventions

- **Order** = feed order at collection time (`posts.rank`, 1-based).
- **Comment budget** = 200 per post, spent in reading order: top-level comments first (server order across `/link/tree` pages), then each root's replies. When the budget cuts a tree, `posts.truncated = 1`.
- **Root cap**: at most 120 top-level comments per post, so the remaining budget goes to replies. Without it a post with 400 top-level comments spent the whole 200 on roots and stored no nesting at all.
- Posts with fewer comments than the budget store everything; `posts.comment_num` is the server's own count and can be 1–2 higher (deleted/hidden comments).
- Feed order drifts between runs; `finalize.mjs` reassigns `rank` against one fresh snapshot and drops posts that fell out of the top N.
- Paging can return the same node twice; duplicates are dropped by `commentid`.
- `depth` 0 = top-level comment, 1.. = replies; `parent_id` is `NULL` for top-level, otherwise the `replyid` that was replied to.
- Timestamps are unix seconds (server's `create_at`).

## Schema

`scripts/xhh/db.mjs` holds the DDL; this section documents it.

### `posts`

| column | meaning |
|---|---|
| `post_id` | `linkid`, stable |
| `rank` | position in the feed when collected |
| `title`, `description` | post title; `description` is the server's truncated preview |
| `body` | full text, decoded from `link.text` (a JSON array of rich-text runs) |
| `author_id`, `author_name`, `author_level` | author |
| `create_at`, `ip_location` | unix seconds, author's IP province |
| `comment_num` | total comments the server reports |
| `up`, `down`, `click`, `favour_count`, `forward_num`, `award_num` | engagement counters |
| `link_tag`, `is_article` | post kind |
| `topics`, `images` | JSON arrays |
| `raw` | the whole API object, for fields not modelled yet |
| `comments_n`, `truncated` | comments actually stored; 1 when the budget cut the tree |

### `comments`

| column | meaning |
|---|---|
| `comment_id` | `commentid` |
| `post_id` | owning post |
| `parent_id` | `replyid` — the comment this one answers; `NULL` for top-level |
| `root_id` | the top-level comment this belongs to (itself for top-level) |
| `depth` | 0 top-level, 1.. nesting level |
| `floor_num` | server floor number (top-level only) |
| `user_id`, `user_name`, `reply_to_user` | author; the name being replied to |
| `text`, `imgs`, `create_at`, `ip_location`, `up` | content and metadata |
| `child_num` | server's reply count for this comment |
| `is_link_owner`, `is_author_award` | author of the post replied / awarded |
| `raw` | whole API object |

### `runs`, `crawl_log`

`runs` records each collection pass (counts, status). `crawl_log` records one row per post: tree pages, sub-comment calls, comments stored, elapsed ms, error.

## Usage

```bash
node scripts/xhh/scrape.mjs --posts 120 --comments 200 --delay 2500 --batch 10 --batch-pause 180
node scripts/xhh/finalize.mjs --posts 120        # re-rank against a fresh feed, drop leftovers
node scripts/xhh/export.mjs                      # data/xhh.json, comments nested
node scripts/xhh/stats.mjs                       # overview
```

Useful flags: `--skip-done` (skip posts that already have comments, for resuming), `--refresh-posts` (re-read post bodies only), `--root-cap N`, `--db path`.

Smoke test without touching the real dataset:

```bash
node scripts/xhh/scrape.mjs --posts 5 --comments 50 --db /tmp/opencode/xhh-test.db
```

The scrape is safe to re-run: posts and comments upsert by id, so a second pass refreshes text/counters without duplicating rows.

There is no `sqlite3` CLI in this image; query with `node -e` + `node:sqlite`:

```bash
node -e 'const {DatabaseSync}=require("node:sqlite");const db=new DatabaseSync("data/xhh.db");
console.log(db.prepare("SELECT COUNT(*) posts FROM posts").get());
console.log(db.prepare("SELECT depth,COUNT(*) n FROM comments GROUP BY depth").all());'
```

Useful queries:

```sql
-- posts with the most replies stored
SELECT p.post_id, p.title, p.comment_num, p.comments_n,
       SUM(c.depth>0) replies
FROM posts p JOIN comments c ON c.post_id=p.post_id
GROUP BY p.post_id ORDER BY replies DESC LIMIT 10;

-- a whole thread, in reading order
SELECT depth, user_name, substr(text,1,60) FROM comments
WHERE root_id=? ORDER BY create_at;
```

## Limits

- The feed is whatever the home page showed at collection time; it is a snapshot, not history.
- `body` comes from `link.text`; image-only posts have no text.
- Comments are capped at 200 per post by design; deeper replies of a long thread are absent and the post is flagged `truncated`.
- A reply whose parent did not survive the budget is stored with a `parent_id` that has no row; `export.mjs` attaches those to the root, so the JSON has no dangling branches. (14 such rows in the first 68 posts.)
- No user profiles beyond name/level/avatar, no likes per user, no edit history.
