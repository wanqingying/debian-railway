# Usage and billing

`session_usage` exposes recorded assistant usage by `message_id`; its model is the message's actual model, not the session's selected model. Missing, malformed or incorrectly typed fields remain NULL, not measured zero. Input, output, reasoning, cache read and cache write are separate counters; do not assume whether a provider includes reasoning in output.

`session_usage_dedup` removes probable history copies **before applying your SQL filters**. A row is marked with `copy_of` when an existing fork/parent ancestor has the same timestamp, provider, model, cost and all five usage counters. Unrelated sessions with identical counters stay separate. A new timestamp or different counters stays separate. Missing provider/model or entirely missing counters are not deduplicated. The views are materialized on demand; each message's JSON is parsed once, then aggregates use scalar columns.

This is an estimate of recorded requests, not a billing ledger: two genuine requests with identical fingerprints in an ancestry can collide; a deleted origin cannot be matched. Mutually cyclic ancestors are retained rather than choosing an arbitrary original. Report raw rows, retained rows and removed copies together. Do not claim exact real usage from deduplicated SQL. Missing counters should be reported alongside totals.

## Compare recorded usage by model

Use explicit half-open bounds in the requested timezone. This example covers November 24, 2026 in UTC+08:00; replace both dates for the user's requested day.

```sql
SELECT provider_id, model_id, COUNT(*) AS raw_rows,
       SUM(CASE WHEN copy_of IS NULL THEN 1 ELSE 0 END) AS retained_rows,
       SUM(CASE WHEN copy_of IS NOT NULL THEN 1 ELSE 0 END) AS removed_copies,
       SUM(CASE WHEN copy_of IS NULL THEN tokens_input END) AS input_tokens,
       SUM(CASE WHEN copy_of IS NULL AND tokens_input IS NULL THEN 1 ELSE 0 END) AS missing_input
FROM session_usage
WHERE time_created >= unixepoch('2026-11-24T00:00:00+08:00') * 1000
  AND time_created < unixepoch('2026-11-25T00:00:00+08:00') * 1000
GROUP BY provider_id, model_id
ORDER BY input_tokens DESC, provider_id, model_id;
```

For only retained rows use `session_usage_dedup`, including when filtering to one fork's sessions. For rolling 24 hours use `(unixepoch('now') - 86400) * 1000` and `unixepoch('now') * 1000`, labeling the result as rolling, not a calendar day.

On timeout, divide the requested bounds into disjoint daily/hourly intervals and add sums/counts per model (not per-interval distinct counts). Each query still builds global ancestry-copy matches, so a child-only interval does not re-count earlier inherited history. If loading the underlying store itself times out, report the limit rather than presenting partial totals as complete.

For OpenCode Go billing use the provider meter and the `go-allowance.md` runbook in the global config's `docs/` directory (`$XDG_CONFIG_HOME/opencode/docs/`, or `~/.config/opencode/docs/` when XDG_CONFIG_HOME is unset). Subscription requests can record zero cost; deleted hidden sessions leave no rows. Summed DB cost is recorded cost, not necessarily invoiced spend.
