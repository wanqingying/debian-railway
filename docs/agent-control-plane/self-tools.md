# Agent self-inspection tools (`self_*`) — design

**Status:** design only; nothing implemented. Reviewed in
[`recall-and-runtime-introspection.md`](./recall-and-runtime-introspection.md) — that file decides which parts of
this one belong in the control plane.
**Scope:** read-only. Configuration editing is out of scope (dropped 2026-10-28).

## 1. Purpose

An agent should be able to browse its own environment the way a user browses the OpenChamber UI — which
projects and worktrees exist, what sessions ran in them, where a topic was discussed, what the effective
configuration is — without leaving the conversation and without writing one-off SQL each time.

Two questions drive the tool surface:

- **Recall:** "what did we do, and where?" — sessions, grouped and searchable.
- **State:** "what am I running with?" — effective configuration, plugins, paths.

## 2. Acceptance scenarios

| # | Question the agent must answer | Tool |
|---|---|---|
| 1 | Which projects and worktrees exist, and how many sessions does each have? | `self_sessions` (map mode) |
| 2 | What are the most recent sessions, overall or in this project? | `self_sessions` |
| 3 | Which sessions are in this worktree / on this branch? | `self_sessions` |
| 4 | Which session discussed X? | `self_sessions` (content search) |
| 5 | What is session `ses_…` about, and what did it conclude? | `self_session_get` |
| 6 | What did the last turn in this project actually do? | `self_session_get` (tail) |
| 7 | What is the effective config, and which file set each value? | `self_config` |
| 8 | Which plugins are loaded, and where do they come from? | `self_config` |

## 3. Data inventory

Measured 2026-10-28 in this container, opencode 2.1.4.

| Source | Size / shape | Use |
|---|---|---|
| `$XDG_DATA_HOME/opencode/opencode.db` | 275 MB; 190 sessions, 21,430 messages (16,704 with text) | sessions, content |
| `session_v2` | 190 rows: title, directory, project_id, parent_id, model, cost, tokens, timestamps, archived | list + filters |
| `session_message` | 21,430 rows; `data` is JSON: user → `text`, assistant → `content[].text` | content |
| `project` | 26 rows: `worktree`, `name` (null in practice) | project identity |
| `worktree` | 25 rows: `project_id`, `directory` | worktree identity |
| `worktree` directory of a session | `session_v2.directory`; **162 / 190 sessions live in a worktree dir** | strongest grouping signal |
| git branch | **not stored anywhere** | must be derived (see §5) |
| `settings.json` (OpenChamber) | 7 projects with `path`/`label` | human labels |
| `GET /api/config` | array of 4 source entries | effective opencode config |

Distribution worth designing around:

- **71 / 190 sessions archived** (37%) — default must be explicit, not accidental.
- **83 / 190 are child sessions** (subagents) — they pollute list results.
- **21 distinct directories**, 26 projects, 25 worktrees.
- Largest session 1,247 messages; mean 113 — detail must paginate.
- Every session has a title (0 nulls).

## 4. Tool surface

Three tools, registered by a local plugin (`opencode-config/opencode/plugins/self/index.ts`) the same way
`sysinfo` is. OpenCode 2 does not discover `tools/*.ts`; only plugins are a registration path.

### 4.1 `self_sessions`

One tool, two shapes selected by whether `text` is present:

- **map / list** — no `text`: grouped inventory or a filtered list.
- **search** — with `text`: find sessions whose title or content matches.

```
self_sessions({
  text?,                 // free text; matched against title and/or content
  match?,                // 'content' (default) | 'title' | 'both'
  project?,              // project label or directory substring
  directory?,            // exact directory or substring
  worktree?,             // 'only' | 'exclude' | 'any' (default 'any')
  branch?,               // current git branch of the directory
  include_archived?,     // default false
  include_children?,     // default false
  role?,                 // 'user' | 'assistant' for content matches
  since?, until?,        // ISO date or relative ('7d')
  agent?, model?,        // filter by agent / model id
  has_children?,         // sessions that spawned subagents
  order?,                // 'recent' (default) | 'oldest' | 'largest' | 'cost'
  limit?, cursor?        // default 20, max 100
})
```

Map mode (`text` absent, no filters) returns:

```
{
  mode: "map",
  totals: { sessions: 190, archived: 71, children: 83, directories: 21 },
  projects: [{
    project: "debian-railway",
    directory: "/workspace/debian-railway",
    sessions: 39, last_active: "...",
    worktrees: [{ directory: "...", branch: "fix/login", sessions: 10 }]
  }]
}
```

Search / list mode returns:

```
{
  mode: "search",
  scanned: 21430,          // messages examined; present only for content search
  elapsed_ms: 812,
  hits: [{
    session_id: "ses_…", title: "…", project: "…", directory: "…",
    branch: "…", archived: false, child: false,
    at: "2026-10-27T12:25:00Z",
    matches: 4,                    // occurrences in this session
    snippet: "…matched text with 80 chars either side…",
    message_id: "msg_…", role: "user"
  }],
  next: "<cursor>"
}
```

Ordering rule: one hit per session (not per message), `matches` carries the count, `snippet` shows the
best occurrence. A `level: 'message'` option returns one row per message for precise drill-down.

### 4.2 `self_session_get`

```
self_session_get({
  session,               // id, or 'last' for the most recent in this directory
  tail?,                 // last N messages (default 20, max 200)
  from?, to?,            // message id or ISO time window
  include_tools?,        // default false; tool name + args + result digest
  include_reasoning?,    // default false
})
```

Returns session metadata (title, directory, project, branch, model, agent, tokens, cost, parent,
archived, created/updated) and a normalized message list:

```
{ seq, role, at, text, tools?: [{ name, args, result }], reasoning? }
```

Reads the database directly rather than the API: the API hides child and archived sessions, and returns
parts in a shape that still needs normalization.

### 4.3 `self_config`

Layered, because no single source covers everything (§6):

```
self_config({ scope?: 'all' | 'opencode' | 'plugins' | 'openchamber' | 'paths' })
```

```
{
  opencode: {
    sources: [{ type, path, keys }],        // as returned by GET /api/config
    effective: { ... },                     // deep-merged in source order
    provenance: { "plugins": "<file>", "model": "<file>" }
  },
  plugins: [{ id, version, source }],
  pluginConfigs: { magicContext: { ... } },
  openchamber: { version, settings: { ... }, preferences: { ... } },
  paths: { data, config, cache, state, db, log },
  drift: { configBaked: "identical", note: "baked configs are re-applied on every boot" }
}
```

`drift` compares the repository copy under `opencode-config/` with the volume copy: `differs` means a
hand edit will be overwritten on the next deploy. Since there is no write tool, this field is the only
signal that tells an agent its edit is ephemeral.

## 5. Git branch: derived, never stored

No table or column carries a branch. Every message's `snapshot` carries a commit SHA, but not a ref.

Derivation, without spawning a process:

1. Resolve `<directory>/.git`: a directory in a normal checkout, a file (`gitdir: …`) in a worktree.
2. Read `HEAD` from the resolved git dir.
3. `ref: refs/heads/<name>` → `<name>`; otherwise detached → 7-character SHA.

Semantics that must be stated in the output:

- For a **linked worktree**, the branch is stable — the worktree exists for that branch.
- For a **main checkout**, the branch is the directory's *current* HEAD, not the branch the session ran
  on. Report it as `branch: { name, at: "current" }` so the agent does not mistake it for history.

Cache per call only (a branch can change between calls).

## 6. Why `self_config` is layered

| Layer | Source | Reason |
|---|---|---|
| opencode | `GET /api/config` via `ctx.client` | Only it knows the source list *and* the runtime overlay |
| plugins | `opencode plugin list`, `magic-context.jsonc` | Not part of opencode's config tree |
| OpenChamber | `settings.json`, `preferences.json` | Its HTTP API returns 401 for every credential we hold |
| drift | repository vs volume files | Only the filesystem knows what a redeploy will restore |

The runtime overlay matters: `OPENCODE_CONFIG` points at
`…/openchamber/run/instances/<pid>/opencode.managed.json`, which injects
`plugins: ["-opencode.browser", "…/openchamber-agent-tool"]`. An agent reading only `opencode.jsonc`
will conclude that magic-context is the only plugin, and be wrong.

`GET /api/config` returns *sources*, not a merged object, and excludes built-in defaults. The tool
merges in array order and marks keys absent from every source as `default`.

## 7. Search implementation

Phase 1 — direct scan, no index:

- Title: `LIKE` on `session_v2.title` — negligible.
- Content: read `session_message`, parse `data`, extract text, substring/LIKE match.
- Measured: **823 ms** for 21,430 rows (450 ms read + 320 ms parse, single pass).
- Budget: 2 s, then abort with `{ status: "too-slow", scanned }` and a suggestion to narrow the range.
- `since`/`until` are applied **before** parsing (`time_created` is indexed).

Phase 2 — only when the message table exceeds ~100k rows: add an FTS5 index inside a separate database,
built incrementally from a watermark. The tool interface does not change.

OpenChamber already maintains `message-search.sqlite` (FTS5 trigram, 107 sessions). It is **not** used:
it lags (newest entry a day behind), covers top-level sessions only, and excludes tool output.

## 8. Defaults and noise control

| Setting | Default | Why |
|---|---|---|
| `include_archived` | `false` | 37% of sessions are archived; including them by default buries the live work |
| `include_children` | `false` | 44% are subagent sessions; they repeat their parent's topic |
| `limit` | 20 | Keeps a search result inside a reasonable share of the context window |
| snippet | 200 chars | Enough to recognize, not enough to flood |
| `include_tools` | `false` | Tool output is the single largest text source in the DB |

## 9. Redaction

Applied to every returned string in both session tools:

- environment-style secrets: `*_KEY=`, `*_TOKEN=`, `*_SECRET=`, `PASSWORD=`
- provider tokens: `sk-…`, `ghp_…`, `gho_…`, `github_pat_…`, `xox[bap]-…`
- bearer headers and JWTs (`eyJ…`)
- URLs with embedded credentials

`self_config` never returns the contents of `auth.json`, `mcp-auth.json`, `github-auth.json`,
`jwt-secret`, or any value whose key matches the patterns above. It reports existence, not values.

## 10. Failure modes

| Failure | Behaviour |
|---|---|
| Database locked / busy | `busy_timeout` 2 s, one retry, then a clear error |
| Schema drift after an opencode upgrade | Capability check at plugin load (required tables/columns); degrade to the HTTP API and say so |
| Missing `.git` | `branch: null`, not an error |
| Session too large | Truncate each message to 2,000 chars; `tail` bounds the count |
| Non-UTF text | Replace invalid sequences rather than throwing |

## 11. Non-goals

- Writing or editing configuration (dropped).
- Rendering a UI; the tools return JSON.
- Cross-container or remote sessions.
- Historical branch attribution (requires upstream schema support).

## 12. Open questions

1. Should `self_sessions` expose a separate `self_projects` tool instead of a map mode? A dedicated tool
   reads more clearly to a model but adds one more item to the tool list.
2. Should content search include tool output behind an opt-in flag? It is the largest text source and
   sometimes the only record of what ran.
3. Should `self_session_get` default to the *tail* of a session or to a summary derived from titles and
   the last assistant message? Tail is cheaper to reason about; a summary matches what the UI shows.
