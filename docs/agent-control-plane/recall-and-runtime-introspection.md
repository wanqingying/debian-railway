# Agent recall and runtime introspection — what we take from `self-tools.md`

**Status:** design decision, 2026-10-28. Reviewed [`self-tools.md`](./self-tools.md) (an untracked draft
when this was written) and decided which parts belong in the control plane, which belong in this container,
and which to drop. Companion: [`design.md`](./design.md) §16 (tool surface), §17 (experience base),
§18 (this capability), §19 (delegation). This file records only the review and the division of ownership.

Nothing here is implemented.

## 0. Verdict

| Part of `self-tools.md` | Decision | Reason |
| --- | --- | --- |
| `self_sessions` (recall: list, map, content search) | **Adopt**, owned by the control plane | It closes a real gap: we cannot answer "which session dealt with X, and what did it conclude" for work a human did |
| `self_session_get` (one session's metadata and tail) | **Adopt**, same owner | The drill-down half of recall; without it a search hit is a dead end |
| `self_config` (effective config, plugins, provenance, drift) | **Narrow** to `runtime.config`, owned by this container | Only the container knows the runtime overlay and the repository-vs-volume drift |
| Redaction list, noise defaults, search budget, branch semantics | **Adopt as rules**, not as tools | These are the reusable part; they apply to our tools whether or not we copy theirs |
| Registration through a local plugin | **Reject** as the home for recall | That is an OpenCode-2 constraint (only plugins can register tools), not an architectural choice |
| Reading `opencode.db` as the primary path | **Reject** | Their own failure table lists "schema drift after an upgrade → degrade"; we already paid for this class of coupling once |
| One tool that switches shape on the presence of `text` | **Reject** | Implicit modes are worse than an explicit enum, and they cost the same tokens |
| Config editing, UI rendering, cross-container sessions, historical branch attribution | **Not doing** | They already dropped the first; the rest are out of scope for both projects |

## 1. The gap this closes

Our design has three layers of memory and only two of them exist:

| Layer | Question it answers | Where it lives today |
| --- | --- | --- |
| Session context | "what is happening in this task" | OpenCode session + compaction |
| Job ledger | "what did the delegate itself do" | `jobs` / `job_events` (agentd §4) |
| Curated lessons | "what did we learn, and does it still hold" | the experience corpus (agentd §19) |
| **Raw history of human work** | **"who dealt with X last week, and what did they conclude"** | **missing** |

The third row of that table is the gap. `jobs` only covers work the control plane dispatched; `experience`
only holds lessons someone promoted. Neither can answer a question about a session a colleague ran by hand,
which is the most common thing a colleague asks a delegate ("that timeout you fixed — how?").

Recall is *not* the experience corpus, and the difference matters:

| | Session recall | Experience corpus |
| --- | --- | --- |
| Content | raw transcript of everything, including failed attempts | one reviewed note per lesson |
| Trust | what happened (may be wrong reasoning) | what we decided was true |
| Lifetime | as long as the session store keeps it | until superseded or past `review_after` |
| Cost to read | must be searched and sampled | one short file |
| Auto-loaded | never | never (§19.1) |

## 2. The inventory is accurate — verified, not assumed

Measured in this container on 2026-10-28 against `$XDG_DATA_HOME/opencode/opencode.db` (read-only):

| Metric | Value | Why it shapes the design |
| --- | --- | --- |
| sessions | 190 | small enough for a direct scan today |
| child sessions (subagents) | 83 (44%) | must be excluded by default or the list is half noise |
| archived | 71 (37%) | same |
| messages | 21,460 | the draft said 21,430: live data, +30 in two days |
| distinct directories | 21 | grouping signal; `session_v2.directory` is the strongest one |
| largest session | 1,247 messages | detail must paginate and truncate (2,000 chars per message) |

Two facts the draft got right and that we should not re-derive: `time_archived` is the archive column (there
is no boolean), and no table stores a git branch.

## 3. The tools we will have

Owned by the control plane, exposed both to job sessions and (later) over MCP. Read-only.

### 3.1 `session.search`

```
session.search({
  mode: "map" | "search",        // explicit; presence of text never switches behaviour
  text?,                         // required when mode = "search"
  match?: "title" | "content" | "both",   // default "title": cheap and predictable
  project?, directory?,          // label or path substring
  worktree?: "only" | "exclude" | "any",  // default "any"
  branch?,                       // current branch of the directory, derived (§5.3)
  include_archived?: false,
  include_children?: false,
  since?, until?,                // ISO date or relative, applied before parsing
  agent?, model?,
  order?: "recent" | "oldest" | "largest" | "cost",
  limit?: 20,                    // max 100
  cursor?
})
```

- `map` returns totals plus projects and their worktrees with session counts and last activity. No session
  bodies, so it stays cheap even as the store grows.
- `search` returns **one hit per session** (not per message): id, title, project, directory, branch,
  archived, child, time, `matches`, one `snippet` of ~200 chars, and the `message_id` of the best match.
  `level: "message"` is the opt-in for per-message rows.

### 3.2 `session.get`

```
session.get({
  session,                       // id, or "last" for the most recent in this directory
  tail?: 20,                     // max 200
  from?, to?,                    // message id or ISO time
  include_tools?: false,
  include_reasoning?: false
})
```

Returns metadata (title, directory, project, branch, model, agent, tokens, cost, parent, archived,
created/updated) and normalised messages `{seq, role, at, text, tools?, reasoning?}`. Tool output is the
largest text source in the database, so it is off by default.

### 3.3 `runtime.config`

Container-owned, because it is the only place that can see all four layers:

| Layer | Source | Why not elsewhere |
| --- | --- | --- |
| opencode | `GET /api/config` | only it knows the source list *and* the runtime overlay |
| plugins | `opencode plugin list`, `magic-context.jsonc` | not part of opencode's config tree |
| OpenChamber | `settings.json`, `preferences.json` | its HTTP API refuses every credential we hold |
| drift | repository copy vs volume copy | only the filesystem knows what a redeploy restores |

The overlay is the whole point: `OPENCODE_CONFIG` points at
`…/openchamber/run/instances/<pid>/opencode.managed.json`, which injects
`plugins: ["-opencode.browser", "…/openchamber-agent-tool"]`. An agent that reads only `opencode.jsonc`
concludes magic-context is the only plugin, and is wrong. `drift: "differs"` is the only signal that a hand
edit will be overwritten on the next deploy.

`runtime.config` reports existence, never values, for `auth.json`, `mcp-auth.json`, `github-auth.json`,
`jwt-secret`, and any key matching the secret patterns in §5.1.

### 3.4 Profile scoping

Recall is a `qa` / `incident` capability, so it does not inflate the `fix` profile:

| Profile | Tools | Count |
| --- | --- | --- |
| `fix` | built-ins + `logs.*` + `metrics` + `experience.*` + `acceptance.check` + `pr.*` | 18 |
| `qa` | built-ins + `logs.*` + `metrics` + `experience.search` + `session.search` + `session.get` + `runtime.config` | 16 |

This keeps the §18.2 budget (≤ 20 per job kind) intact rather than growing it.

## 4. What we are not taking, and why

1. **Their registration path is not our architecture.** The draft registers tools via a local plugin because
   OpenCode 2 does not discover `tools/*.ts`. That is a fact about this container, not about where a control
   plane should own recall. Putting recall in a plugin would tie it to one process, make it untestable from
   outside, and duplicate what agentd already knows (job → session mapping).
2. **Direct database reads are a fallback, not a foundation.** The draft reads the DB because the API hides
   child and archived sessions and returns parts needing normalisation. Both may be true; our adapter should
   still try the API first and fall back with a capability check, because a schema change after an upgrade
   must degrade rather than silently return nothing. The draft's own failure table agrees; we are just making
   it the default rather than an exception.
3. **One tool, two shapes.** `self_sessions` changes behaviour when `text` is present. That reads nicely in
   prose and badly in a schema: the model must remember an implicit rule, and the failure mode (searching
   when it meant to map) is silent. An explicit `mode` costs one enum.
4. **Map by default.** Returning the whole inventory when no filter is given is a 190-session payload today
   and grows linearly. `map` is a mode, not the fallback.

## 5. Five rules worth more than the tools

### 5.1 Redaction is mandatory, and shared

Every string returned by recall or config passes through one module:

- environment-style secrets: `*_KEY=`, `*_TOKEN=`, `*_SECRET=`, `PASSWORD=`
- provider tokens: `sk-…`, `ghp_…`, `gho_…`, `github_pat_…`, `xox[bap]-…`
- bearer headers and JWTs (`eyJ…`)
- URLs with embedded credentials

Two implementations would eventually diverge by one line, and that line would be a leak. `logs.query` and
`metrics` must use the same module.

### 5.2 Noise defaults

Archived off, child sessions off, `limit` 20, snippet 200 characters, tool output off. Every one of these is
a "the corpus is mostly noise" decision, and the percentages in §2 are why.

### 5.3 Branch is derived, and its meaning is stated

No table stores a branch. Derive it without spawning a process: resolve `<directory>/.git` (a directory in a
checkout, a `gitdir:` file in a worktree), read `HEAD`, and map `ref: refs/heads/<name>` to `<name>`.

- Linked worktree → the branch is stable, the worktree exists for it.
- Main checkout → the branch is the directory's **current** HEAD, not the branch the session ran on. Report
  it as `{ name, at: "current" }` so it is not mistaken for history.

Cache per call only; a branch can change between calls.

### 5.4 Search has a budget and fails loudly

21,430 rows took 823 ms (450 ms read, 320 ms parse — parsing dominates). Budget 2 s, then return
`{ status: "too-slow", scanned }` with a suggestion to narrow the window, rather than continuing quietly.
Apply `since`/`until` **before** parsing. Add FTS5 only past ~100k messages; until then a direct scan is
smaller and more predictable.

### 5.5 Read-only is a contract, not a habit

No tool in this set writes: not the config, not the sessions, not the annotations. The draft dropped config
editing and that was correct — a "helpful" config write is exactly the class of action that makes an
unattended system untrustworthy.

## 6. Ownership: one implementation per capability

`self-tools.md` is "know myself" for one container's agent. The control plane is "know myself, my jobs, and
the fleet". Same primitives, different scope — so split by what each side can actually see:

| Capability | Owner | Why |
| --- | --- | --- |
| `session.search`, `session.get` | control plane | It already owns session ids, job attribution and worktree bookkeeping; one implementation, one permission check, usable from a job session or MCP |
| `runtime.config` | this container (plugin) | Only it can see the process overlay and repository-vs-volume drift |
| Redaction, defaults, budgets | shared module | Two copies diverge (§5.1) |

What we must not build is two similar tool sets: a model offered `self_sessions` and `session.search` with
slightly different semantics will pick the wrong one, and the cost lands on every turn.

## 7. Consequences for the control-plane design

Four edits to `agentd-design.md`, listed here so the decision is traceable:

1. §18.3 — add P1 rows `session.search`, `session.get` (qa, incident only) and `runtime.config` (all kinds,
   read-only); update the per-kind counts to 18 / 16.
2. §18.4 — add: session content may contain secrets, so redaction is mandatory; config reports existence,
   not values.
3. §19 — add the recall-vs-corpus distinction (§1 above), including that neither is ever auto-loaded.
4. §20 — add: recall is read-only and cannot widen scope; "may search another team's sessions" is an
   authorization question, open while there is one team.

## 8. Open questions

1. Does `session.search` need tool output search? It is the largest text source and sometimes the only record
   of what ran, but it is also where secrets live. If yes: opt-in flag, redacted, budget doubled.
2. Retention: recall reads whatever the session store keeps. Do we need our own retention policy, or is
   "whatever OpenCode keeps" acceptable for a delegate that must answer questions about last month?
3. Should `session.get` default to the tail, or to a summary derived from the title and last assistant
   message? Tail is cheaper to reason about; a summary matches what a human sees in the UI.
4. When a second container exists, does recall federate (search across hosts) or stay per-host with the control
   plane merging? Merging is easier to reason about; federating avoids moving message bodies.

## 9. Non-goals

- Writing configuration or sessions.
- A UI; every tool returns JSON.
- Cross-container search (§8.4).
- Historical branch attribution — needs upstream schema support.
