# Common OpenCode SQL

Run `schema` first. These patterns use the exposed v2 names, not the v1 `session`, `message`, or `part` tables.

## Count new sessions by project

```sql
SELECT s.project_id, COALESCE(p.name, p.worktree, s.project_id) AS project,
       COUNT(*) AS sessions
FROM session_v2 AS s LEFT JOIN project AS p ON p.id = s.project_id
WHERE s.time_created >= (unixepoch('now') - 7 * 86400) * 1000
  AND s.time_created < unixepoch('now') * 1000
  AND s.parent_id IS NULL AND s.time_archived IS NULL
  AND s.directory NOT LIKE '/tmp/%'
GROUP BY s.project_id, project
ORDER BY sessions DESC, s.project_id;
```

This counts new top-level, non-archived sessions over a rolling seven days. Forks still count as session rows. Use `time_updated` instead for recent activity; use explicit UTC offsets for calendar days. Put the time conversion on the bounds, not the indexed timestamp column.

## Find forks and their origins

```sql
SELECT f.id AS fork_id, f.title AS fork_title,
       f.fork_session_id AS origin_id, o.title AS origin_title
FROM session_v2 AS f LEFT JOIN session_v2 AS o ON o.id = f.fork_session_id
WHERE f.fork_session_id IS NOT NULL
ORDER BY f.time_created DESC, f.id
LIMIT 20;
```

Filter on `f.project_id` for one project. `LEFT JOIN` keeps a fork if its origin is missing. To find child sessions created by delegation, use `parent_id` instead.

## Read a session's selected model

```sql
SELECT id, json_extract(model, '$.providerID') AS provider,
       json_extract(model, '$.id') AS model_id
FROM session_v2
WHERE json_valid(model)
ORDER BY time_updated DESC, id
LIMIT 10;
```

Use `session_usage` for actual per-message model attribution and read [usage.md](usage.md) before totaling tokens or cost. Join `session_message` by `session_id`, and `session_part` by `message_id`; aggregate before joining if the intended count is per session or per message rather than per part.

## Keep queries bounded

Select explicit columns: raw JSON and credential tables are not exposed, so `SELECT *` on a partially exposed table fails. Use an `ORDER BY` with a unique tie-breaker for sampling or paging. Prefer a time or session filter before joining large tables; an output `LIMIT` alone does not bound a sort or aggregate. Treat `truncated: true` as a partial result, not as the total.

For recent sessions use `ORDER BY time_updated DESC, id LIMIT 10`; if the user supplies a session URL/ID, query only that ID rather than expanding to other sessions. For conversation text, hand the ID to OpenChamber `session.messages`, not SQL.

The CLI accepts SQL on stdin or as one argument. Do not put SQL after `schema` or `path`. It uses Node's SQLite, not the system Python SQLite; `unixepoch()` is available in the tested runtime. If a query fails, read the error before retrying: missing columns require `schema`, denied private fields require the appropriate session tool, and timeouts require partitioning the original scope.
