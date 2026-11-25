# Usage and billing

- `session_usage` exposes recorded assistant message usage, keyed by `message_id`. Its `provider_id` and `model_id` describe the message; `session_v2.model` describes the session's selected model and may differ.
- `tokens_input`, `tokens_output`, `tokens_reasoning`, `tokens_cache_read`, and `tokens_cache_write` are separate recorded counters. Missing or invalid fields are NULL; do not present them as measured zero. Use explicit time bounds and state the timezone.
- Forks copy history under new message IDs. Counting all matching rows can overstate actual requests and usage. For OpenCode Go billing follow the `go-allowance.md` runbook under `$XDG_CONFIG_HOME/opencode/docs/` and use the provider meter, not a SQL sum: subscription requests can record zero cost, and deleted sessions will not be in the database.

## Compare recorded usage by model

```sql
SELECT provider_id, model_id, COUNT(*) AS message_rows, SUM(tokens_input) AS input_tokens
FROM session_usage
WHERE time_created >= (unixepoch('now') - 86400) * 1000
  AND time_created < unixepoch('now') * 1000
  AND tokens_input IS NOT NULL
GROUP BY provider_id, model_id
ORDER BY input_tokens DESC, provider_id, model_id
LIMIT 20;
```

Label this as recorded usage over a rolling 24 hours, before fork deduplication. For a calendar day, replace both bounds with the start and end of that day in the requested timezone.
