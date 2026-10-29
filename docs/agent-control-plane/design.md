# Agent control plane — design for an OpenCode-backed digital employee

**Status:** design, not implemented. This is the canonical document: it records what we are building, why
each decision was made, what prior art we rejected, and what must be measured before code is written. When
this file and an implementation disagree, the disagreement is a bug in one of them.

**Revisions:** 2026-10-26 first draft (archived in [`history/`](./history/agentd-design-2026-10-26.md));
2026-10-28 expanded here — prior-art review, capability model, experience base, delegation, recall.

**Scope.** A long-running process that turns external requests (a Feishu message, a schedule, a webhook) into
**jobs**, executes each job in OpenCode sessions, keeps state across restarts, gates dangerous actions on a
human, and reports back in the thread the request came from.

**Non-goals.** A web UI. Multi-tenant. Slack (interface reserved, not implemented). CI-triggered runs.
Cross-repo orchestration. A second agent runtime. A model-facing "manager" that plans the fleet.

---

## 1. What this is

A delegate. You give it work in the channel you already use; it investigates, changes code, opens a pull
request, answers questions, and tells you when something needs you. It is not a chatbot with tools, and not a
dashboard: the deliverable is *work that landed*, plus a record of what it did.

The target is **not** "it can do everything I can". It is:

> it can do everything I **delegated**, with the same audit trail as if I had done it.

Capability and authorization are different things, and conflating them is how an assistant becomes an
incident. See §19.

## 2. Decisions at a glance

| Concern | Decision | Why |
| --- | --- | --- |
| Who owns job state, budgets, retries, approvals, dedupe | **Code** (this process) | These must hold when a model is wrong or absent. A model grading its own completion is not an acceptance check. |
| Who investigates, plans, codes, explains | **Model**, in an OpenCode session | No rule exists for "which log line matters". |
| What runs the agent loop | **OpenCode**, reused as-is | It already owns compaction, skills/`AGENTS.md`, MCP, permissions, worktrees, session persistence, an event stream. Rebuilding that is not product work. |
| How many agents | **Exactly one** per job: the execution session. No manager, planner or reviewer agent. | One agent keeps cost and failure modes countable; the loop is code, so it needs no brain. |
| How a request becomes a job kind | **Rules** with an explicit default of "ask a human" (§7.1) | Deterministic, testable, no extra model call. |
| How "done" is decided | **Artifacts**, checked in code (§7.3) | PR open, CI green, diff in scope, checks ran. A session's prose is data, not a verdict. |
| How a new capability is added | **Skill first**; a tool only when a capability is missing; a control-plane change last (§16.5) | Most additions are procedure, not code. |
| Where hard-won experience lives | A searchable corpus on disk, **never auto-injected** (§17) | Too large, too stale, and agent-writable — reference material, not context. |

## 3. Prior art: what exists, what we take, what we drop

### 3.1 The five projects reviewed

Read at the source, not from marketing pages.

| Project | What it is | Verified mechanism | Verdict |
| --- | --- | --- | --- |
| **paperclip** (107k★) | Node server + React UI orchestrating a "team" of agents: org chart, budgets, governance | A finite **heartbeat run** per turn: "does not keep an agent process alive between turns"; 30 s scheduler; stranded-issue reconciliation; issue tree `Workspace → Initiatives → Projects → Milestones → Issues → Sub-issues` | Borrow the approval/budget/cost model and routine→task; do **not** borrow the execution model |
| **openclaw** (393k★) | Personal assistant with a local **Gateway** as control plane, 20+ chat channels, cron, skills | Session controller owns *which turn may use a session next*; "standing orders" in `AGENTS.md` define autonomy vs approval; sessions and cron persisted in SQLite | Borrow turn admission and standing orders as a policy surface |
| **hermes-agent** (257k★) | Python agent with six terminal backends, cron, 40+ toolsets, skills | Four **stop gates** per turn (late LSP verdicts, verify-on-stop, pre-verify hook, terminal-tool guard) append the answer as interim and continue; durable turn leases | Borrow "verify before you finish"; drop per-turn granularity |
| **agent-orchestrator** (14k★) | Go orchestrator for a fleet of coding agents, worktrees, PRs | `SessionKind` is only `worker` \| `orchestrator`; separate reviewer harness; CI failures and review comments routed back to the worker that owns the branch | Borrow CI-failure routing; drop the three-role structure |
| **deer-flow** (84k★) | ByteDance "super agent harness": gateway, sandboxes, sub-agents, skills, Feishu/Lark channels | `acceptance_criteria` (`file:<path> exists`, `tests_passed:<command>`), execution **receipts**: claims without a cited receipt are flagged `UNVERIFIED`; inbound work bounded by queue size and concurrency | Borrow the acceptance vocabulary and receipts; keep our gateway much smaller |
| **ruflo** (79k★) | TS "agent harness": swarm/hive-mind, queen-led consensus, 300+ MCP tools, adaptive memory | `UnifiedSwarmCoordinator`/`QueenCoordinator`, seven topologies, consensus protocols; ~645 MB repo, 8,251 files, **339 tool source files** | **Reject as a substrate** (§3.4) |

### 3.2 Compensations for weak models — removed

Every project above was designed when a model could not hold a task, so its architecture compensates with
process. That compensation is paid per turn, forever. What we removed, and what it was paying for:

| Mechanism | Where it comes from | What it compensated | What we do instead |
| --- | --- | --- | --- |
| finite run per turn, context rebuilt from the database | paperclip | a model that forgets between turns; a context window that cannot hold the job | one long session per job; OpenCode compacts; a new session only for a new job or after a hard failure, with a five-line handoff |
| issue → sub-issue decomposition | paperclip | a single run could not carry a deliverable | one job = one acceptance-checkable unit, one brief |
| orchestrator / worker / reviewer roles | agent-orchestrator | a model that could neither plan nor check itself | one agent + artifact checks; the human is the reviewer |
| per-turn stop gates | hermes | a model that declares victory early | one gate per delivery (CI + PR), plus a plan gate before code |
| consensus / voting verification | ruflo | a single model that cannot be trusted | one strong model + deterministic checks; voting only helps when errors are independent, and same-family errors correlate |
| a 300+ tool catalogue | ruflo | a model that cannot find the right capability | ≤ 20 tools per job kind; procedures live in skills |
| large RAG / full-text memory | openclaw, hermes | a context window too small to hold the repository | the repository is the context (`AGENTS.md`, skills, codegraph); notes only across jobs |
| fresh-session handoff as the normal path | paperclip's OpenCode adapter | sessions that could not be resumed reliably | handoff is an exception after failure, not the turn boundary |

This is not optimism about models. It moves trust from *process* to *artifacts* — §7.3 is what makes dropping
the scaffolding safe. One mechanism stays for a non-model reason: **turn admission** (one turn per session at
a time) is concurrency control, not a capability patch.

### 3.3 Responsibilities that stay

Three things are about accountability, not capability. A stronger model makes each *more* important: failures
are rarer and more expensive, and a plausible wrong answer is harder to spot.

1. **Artifact acceptance.** PR open, CI green, diff in scope, checks ran. The executor is the only
   participant that knows what it ran — which is also why it is the one most likely to call it done. A machine
   check is the only claim that survives a restart, a compaction, or a reviewer who was not there.
2. **Write-path boundaries.** Worktree isolation, branch rules, a per-job permission profile, approvals with
   default-reject and a timeout. A stronger model spends less time being wrong and more time being
   confidently wrong at scale; one helpful extra command can merge or deploy.
3. **Recovery, idempotency, budget, audit.** A job row, one idempotency key per trigger, reconciliation on
   start and on reconnect, a spend ceiling with a hard stop, an append-only event log. Unattended means
   nobody is watching: every silent failure must become a visible state.

**Where the gate goes.** Because checks moved from per-turn to per-delivery, the human gate moves earlier:
approving a plan costs a minute and catches the expensive mistake; reviewing a 400-line diff costs half an
hour and catches the cheap one. Corollary: a job that cannot state its plan in five lines is not ready to run.

### 3.4 Rejected architectures

| Option | Why not |
| --- | --- |
| Build our own harness (Vercel AI SDK, pi-style framework) | Months rebuilding `read → compact → tools → retry → permissions → worktree → persistence`; none of it is our differentiator |
| A "manager agent" that owns the loop | State lives in a context window: it drifts under compaction, duplicates work on redelivery, cannot be tested, forgets boundaries as context grows |
| A reviewer session as the acceptance step | It has no memory of what was attempted, so it re-derives the problem and can be confidently wrong about a change the executor verified. Objectivity comes from CI and diff state, not a second opinion. Revisit only for work whose correctness cannot be expressed as a check (§23) |
| ruflo as a substrate | Its architecture grows from the problem "one model cannot coordinate": swarm topologies, queen consensus, 300+ tools. Adopting it means inheriting a 645 MB, 8k-file, fast-moving product whose abstractions (colony, consensus) are not ours (jobs, approvals, artifacts). Its 339 tool files alone would cost ~18k tokens of schema before any work starts, and near-duplicate tool names add selection noise. Take ideas, not the dependency |
| OpenChamber as the control-plane API | It is the human console; its API is for its own UI and agent tool, with no published contract |
| A workflow engine (Temporal, LangGraph) now | The durability we need is already in the session object. Two brains is worse than one; revisit if multi-day multi-approver flows appear |

## 4. Architecture: two loops, one agent

```
trigger ─▶ rules: which kind ─▶ create job ─▶ state machine ─▶ run session ─▶ wait events
                                                                     │              │
                                                              one agent        code: check artifacts
                                                              (session)        PR / CI / diff / checks
                                                                     │              │
                                                                     └──▶ notify ◀──┘
   ▲
   └── Feishu (P0) · cron (P1) · HTTP webhook (reserved) · Slack (reserved)
```

Modules (first version lives beside the existing Feishu tool in `joops/feishu-bot`, because it reuses proven
pieces — §22):

```
agentd/
  main.ts        bootstrap, supervision, single-instance lock
  store.ts       SQLite schema, job/event/approval queries
  machine.ts     state machine transitions + timeouts
  runner.ts      create session, send brief, follow to completion
  artifacts.ts   "is it really done": PR, CI, diff scope, check evidence
  rules.ts       trigger grammar: which kind of job a message is (no model)
  brief.ts       brief rendering (the contract with the session)
  perms.ts       permission profiles per job kind
  worktree.ts    create from origin/main, verify base, clean up
  events.ts      subscribe, dedupe, dispatch, reconcile
  approvals.ts   permission.asked → channel → permission.reply
  notify.ts      state-transition notifications + outbox
  http.ts        /status /jobs/:id /health /jobs/:id/cancel
  channels/{types,feishu,slack}.ts
```

## 5. Jobs

Kinds: `qa` (read-only question), `fix` (small change → PR), `requirement` (planned change → PR),
`incident` (investigate, no write), `maintenance` (scheduled report).

```
queued ──dispatch──▶ running ──artifacts ok──▶ done
   │                   │  ▲
   │                   │  └──human answered──▶ running
   │                   ├──permission.asked──▶ waiting_human
   │                   ├──PR opened─────────▶ waiting_ci ──CI green──▶ done
   │                   ├──no progress 15m───▶ blocked
   │                   └──budget exhausted──▶ failed(budget)
   └──cancelled
```

Rules that matter more than elegance:

- **No state without evidence.** `done` requires artifact checks (§7.3) — or, for `qa`, a non-empty answer
  the channel actually accepted (message id). `waiting_ci` requires a PR URL.
- **Stall detection.** 15 minutes with no session event on a running job triggers `session.get`; if it is not
  running and has no artifacts, the job becomes `blocked`.
- **Two automatic retries, then a human.** `failed` keeps the worktree and branch.
- **Unknown request shapes go to a human**, not to a fallback workflow. This is what keeps the rule count at
  ~8 states and ~12 transitions.

## 6. Data model

SQLite (WAL) in a state directory **outside any checkout** (§22), never inside one — a scheduled run once
spent five minutes hunting for its own state across worktrees.

```sql
create table jobs (
  id             text primary key,              -- ulid
  kind           text not null,                 -- qa | fix | requirement | incident | maintenance
  intent         text not null,                 -- the request, verbatim
  status         text not null,                 -- queued|running|waiting_human|waiting_ci|blocked|done|failed|cancelled
  project_id     text,
  directory      text,                          -- session location
  worktree       text,                          -- null for read-only jobs
  branch         text,
  base_sha       text,                          -- origin/main at dispatch
  channel        text,                          -- "feishu:oc_xxx:omt_yyy"
  idempotency    text not null unique,          -- channel message id / trigger id
  budget_tokens  integer,
  cost_usd       real not null default 0,
  session_ids    text not null default '[]',
  result         text,                          -- JSON: {pr, answer, diffStat, report, checks}
  attempts       integer not null default 0,
  last_event_at  integer,
  created_at     integer not null,
  updated_at     integer not null
);
create index jobs_status on jobs(status, created_at);
create index jobs_channel on jobs(channel);

create table job_events (                        -- audit + forensics; never deleted
  job_id text not null, seq integer not null, at integer not null,
  type text not null, payload text,
  primary key (job_id, seq)
);

create table approvals (
  id text primary key, job_id text not null, session_id text not null, request_id text not null,
  action text not null, resources text, message text,
  status text not null,                          -- pending|once|rejected|timeout
  asked_at integer not null, decided_at integer, decided_by text
);
create index approvals_pending on approvals(status);

create table sessions_seen (                     -- one row per session this process created
  session_id text primary key, job_id text not null, created_at integer not null, removed_at integer
);
```

No mirror of session state: OpenCode is the source of truth. We keep the id list so a restart can reconcile;
everything else is fetched. `session.list` filters by directory and does not expose `metadata` for querying,
so the store must own the ids.

## 7. Job contract: one agent

### 7.1 Which kind of job — rules, no model

| Input | Kind |
| --- | --- |
| a message in a report's topic, or `/ask …`, or a `[feishu:…]`-tagged prompt | `qa` |
| `/fix …`, or a printed "small fix" phrase | `fix` |
| `/req …`, or a printed "requirement" phrase | `requirement` |
| `/status`, `/cancel <id>` | control command, no job |
| anything else | reply with three choices (question / fix / requirement); 30 min unanswered → drop |

The phrase list is data in `rules.ts`, one line and one test per phrase, deliberately small. The default path
is one question to the human — cheaper and more honest than a keyword soup that occasionally starts a
40-minute coding job for a question.

**Escalation.** A `qa` job that turns out to need a small change may escalate **once**, and only within the
small-change contract: one root cause, ≤ 3 files, verifiable by an existing check. It then behaves like `fix`
(worktree from `origin/main`, plan gate, PR, no merge). Anything larger stops and reports; it does not turn
into an unbounded refactor because somebody asked a question in chat.

### 7.2 The brief — intent, never the security boundary

```ts
const session = await client.session.create({
  title: `[${job.kind}] ${title}`,                       // human-findable in any UI
  location: { directory: job.worktree ?? job.directory },
  metadata: { jobID: job.id, kind: job.kind, channel: job.channel, baseSha: job.baseSha },
  permissions: profileFor(job.kind),                       // appended after agent rules (§8)
});
await client.session.switchAgent({ sessionID: session.id, agent: agentFor(job.kind) });
await client.session.prompt({ sessionID: session.id, text: brief(job), delivery: "queue" });
```

`delivery: "queue"` always: the default `steer` interrupts whatever the session is doing, which a control
plane never wants.

```
[任务] <one-sentence goal>
[范围] only <worktree>; base origin/main@<sha>
[边界] no merge, no deploy, no production writes; read-only queries via <how>
[完成标准] <check command>; produce <PR url | answer>
[预算] <tokens>; stop and report if exceeded
[汇报] ≤5 lines: what changed, how it was verified, what is left
```

### 7.3 "Done" is decided by artifacts, in code

The session's prose is stored for humans (`result.report`) and is *not* the transition condition.

| Kind | Checks that must all pass |
| --- | --- |
| `fix`, `requirement` | branch exists and is not the default; PR open for it; CI on the PR head green; diff non-empty and inside allowed paths; the brief's check command appears with evidence |
| `qa` | a non-empty answer, delivered (message id returned by the channel) |
| `incident`, `maintenance` | the report exists and every claim cites a query or log window the job actually ran |

```jsonc
"acceptance": [
  { "check": "pr.open",        "branch": "agent/<slug>" },
  { "check": "ci.green" },
  { "check": "tests_passed",   "command": "cd vercel && pnpm check" },
  { "check": "file.non_empty", "path": "vercel/src/**/fix*.ts" },
  { "check": "diff.within",    "paths": ["vercel/", "core/"] }
]
```

A check that cannot be evaluated deterministically is stored as `UNVERIFIED` and routed to a human; it never
counts as done. (Vocabulary borrowed from deer-flow: acceptance criteria plus execution receipts.)

CI is the evidence of correctness: it runs the project's own checks on the real diff, which is stronger than
asking a second model to re-read the diff and guess.

### 7.4 Plan gate and progress

- **Plan gate (before code).** The session first produces a plan of at most five lines: root cause, files to
  touch, check to run. The job moves to `waiting_human`. Silence for 30 minutes → `blocked`, not "do
  something plausible". This is the cheapest possible gate on the most expensive mistake.
- **Progress heartbeat.** While running, one line every 15 minutes into the thread ("reading the CI log for
  run 1234"). Not a per-turn gate; just enough that a long job does not look dead.
- **Interrupt.** `session.interrupt` then a required five-line summary; the worktree and branch are kept.

## 8. Permissions and approvals

Verified defaults (OpenCode v2): every agent starts with `{action:"*", resource:"*", effect:"allow"}` plus
`.env` reads → `ask`; **the last matching rule wins**; any `deny` among several resources denies the
operation; session rules are appended after agent rules; saved approvals are durable project-scoped `allow`
and never override a `deny`.

So "auto-approve everything except sensitive things" is already the default. The work is the sensitive list,
not an approval switch.

Profiles are appended per job kind (`perms.ts`). Baseline for `fix` / `requirement`:

```jsonc
[
  { "action": "read",  "resource": "*.env",  "effect": "deny" },
  { "action": "read",  "resource": "*.pem",  "effect": "deny" },
  { "action": "shell", "resource": "*",      "effect": "ask" },
  { "action": "shell", "resource": "git status *",   "effect": "allow" },
  { "action": "shell", "resource": "git diff *",     "effect": "allow" },
  { "action": "shell", "resource": "git add *",      "effect": "allow" },
  { "action": "shell", "resource": "git commit *",   "effect": "allow" },
  { "action": "shell", "resource": "git push origin HEAD*", "effect": "allow" },
  { "action": "shell", "resource": "git push origin main*", "effect": "deny" },
  { "action": "shell", "resource": "git push * --force*",   "effect": "deny" },
  { "action": "shell", "resource": "gh pr merge*",   "effect": "deny" },
  { "action": "shell", "resource": "gh pr create*",  "effect": "allow" },
  { "action": "shell", "resource": "*deploy*",       "effect": "deny" },
  { "action": "shell", "resource": "*railway up*",   "effect": "deny" },
  { "action": "shell", "resource": "vercel --prod*", "effect": "deny" },
  { "action": "shell", "resource": "*migrate*",      "effect": "deny" },
  { "action": "shell", "resource": "rm -rf *",       "effect": "deny" },
  { "action": "external_directory", "resource": "*", "effect": "deny" },
  { "action": "question", "resource": "*", "effect": "allow" }
]
```

`qa` adds no `edit`, no `git push`, and narrows shell to read-only prefixes.

Two facts shape this section:

1. **Shell matching is best effort.** The official docs warn that directory inference from command text is
   heuristic and advise a narrow allow-list over patterns meant to catch every dangerous command. Deny rules
   are layer two; they are not the wall.
2. **`allow always` writes a durable rule.** The control plane answers `permission.asked` with `once` only;
   widening is a reviewed config change. Otherwise rules accumulate and nobody can explain them.

Layer one is the environment: the job's process carries no production write credential and the worktree is
the only writable place. Layer three is audit (`approvals` + `job_events`).

**Approval routing.** `permission.asked` carries `{id, sessionID, action, resources, save, message}`. Render
one message with the exact command and three choices (`1 once / 2 reject / 3 never`), timeout 30 min →
`reject`. Never auto-approve. Who may approve is an `open_id` allow-list (the contact scope is not granted, so
usernames are not available from the API).

## 9. Worktrees

- `git fetch origin` in the canonical checkout, then `worktree.create({ projectID, name: slug, branch: "agent/<slug>" })`.
- **Verify the base**: `git -C <dir> rev-parse HEAD` must equal the recorded `origin/main` sha, else fail the
  job. The exact semantics of the API's `branch` field are not yet verified (§20).
- One active session per worktree, enforced by the store.
- Cleanup: `done` + merged → remove; `failed` → keep for 7 days so a human can take over; never remove a
  worktree with uncommitted changes without `force`.

## 10. Events and reconciliation

`client.event.subscribe()`; dedupe on `(sessionID, event.id)`.

| Event | Use |
| --- | --- |
| `session.execution.started` | running, refresh `last_event_at` |
| `session.execution.succeeded` / `session.idle` | candidate completion → artifact checks |
| `session.execution.failed` | carries `error` → classify (transient vs human) |
| `permission.asked` | approval routing |
| `session.created` / `deleted` / `forked` | repair bookkeeping |
| `worktree.updated` | detect a worktree removed behind our back |

The stream is **live-only (no replay)**. Reconciliation is therefore part of the main loop, not a startup
step:

1. On start and after every reconnect: read `jobs` in `running|waiting_human|waiting_ci`.
2. `session.get` each id: idle → run artifact checks; still running → re-attach; 404 → `failed(session removed)`.
3. Re-send pending approvals, marked "from before the restart".
4. Persist every event before acting on it.

## 11. Concurrency, queue, budget

- Global concurrency 3, per project 2, one session per worktree.
- Queue = `jobs where status='queued' order by created_at`; no external broker.
- Budget: read cost/tokens from `session.get` after each transition. 80% → notify, 100% →
  `session.interrupt` + `failed(budget)`.
- Defaults: `qa` 30k tokens, `fix` 120k, `requirement` 300k. Per-job cost is recorded so a daily report can
  answer "what did the delegate spend".

## 12. Notifications

- Only on state transitions, never per event.
- Dedupe key `jobID + status + hash(result)`, suppressed 24 h.
- Failures go to an outbox with exponential backoff (3 attempts), then a loud log line.
- Every notification answers: what is this, what state, **what happens next and who must act**, and a link.

## 13. Observability

```
GET /health        process, OpenCode reachability, event stream connected, queue depth
GET /status        one line per active job: state, age, cost, last event
GET /jobs/:id      detail + event timeline + pending approval
POST /jobs/:id/cancel
```

Log lines are greppable and stable:

```
[job] created id=01J... kind=requirement channel=feishu:omt_...
[job] dispatched id=... session=ses_... worktree=/... base=<sha>
[event] session.execution.failed ses=... error=rate_limited attempts=1
[approval] asked action=shell resources="git push ..." requestID=per_...
[approval] timeout 30m → reject
[job] done id=... pr=https://... cost=$0.42 elapsed=12m
```

## 14. Failure taxonomy

| Class | Example | Action |
| --- | --- | --- |
| transient | 429, network, provider 5xx | one retry with backoff |
| underspecified | "修一下" with no subject | `blocked`, ask one question |
| permission / approval | deny, or approval timeout | `blocked`, never auto-retry |
| bad output | checks red, no PR | one more execution round (max 2), then `failed` |
| budget | tokens exhausted | stop immediately, keep evidence |
| infrastructure | OpenCode unreachable | keep `queued`, retry with backoff, notify after 10 min |

## 15. Channels

```ts
export interface InboundEvent {
  channel: string;                 // "feishu:oc_xxx:omt_yyy"
  externalId: string;              // message id — the idempotency key
  text: string;
  author: { id: string; name?: string };
  thread?: string;
}

export interface ChannelAdapter {
  start(onEvent: (event: InboundEvent) => Promise<void>): Promise<void>;
  stop(): Promise<void>;
  reply(ref: string, markdown: string): Promise<void>;
  askApproval(ref: string, approval: ApprovalAsk): Promise<string>;
  notify(ref: string, message: NotifyMessage): Promise<void>;
}
```

Feishu is P0; Slack and HTTP are stubs that throw `not implemented`. Adding one must not touch the loop.

What the Feishu work has already established (all measured, not assumed):

- A report message **opens a topic**: reply with `reply_in_thread: true`; the topic id (`omt_…`) is returned
  and becomes the channel ref. Continuing inside the topic means replying to a message in it — sending with
  `receive_id_type=thread_id` is rejected (`99992402`).
- **Thread → session routing.** The sender records `{threadId, sessionId}` when it posts; the bridge looks it
  up per message. A job's report therefore belongs to the session that wrote it, and a follow-up in that
  topic reaches that same session without any global state.
- **One long connection per app.** A second consumer silently steals events: no error, no duplicate, the
  first process just goes quiet. Single-instance lock plus a startup warning.
- **Only @-mentions arrive** under the current scopes (`im:message.group_at_msg:readonly`). Non-@ messages in
  a topic are not delivered. Accepting that is fine; asking for `im:message.group_msg` is the upgrade path.
- **Bot membership is the usual failure**: `230002` means the bot is not in the chat (and proves the send
  scope is granted), `99991672` means a missing scope, `230001` a malformed id.
- **Attribution tag.** Prompt text arriving from a channel is prefixed `[feishu:<group>/<person>]`, resolved
  from the chat member list, so a session can tell a colleague's question from the operator's own typing. It
  is a tag, not a security control.
- **Chat allow-list is the gate**: named groups only; env can narrow it, never widen it. A group-name guard
  refuses to send when the id's real name differs from the configured one (a test card once went to the wrong
  group).
- **Retention**: a day's session and its topic are kept 7 days; after that the topic answers "expired" with a
  way forward, and the session is removed. The ledger entry stays so an old topic does not become a dead end.
- **State outside checkouts** (`$XDG_DATA_HOME/feishu-bot/state`): ledger, seen-set, heartbeat, outbox.

## 16. Capability model and tool surface

### 16.1 Six axes, not a tool list

| Axis | What it means | Supplied by | This project adds |
| --- | --- | --- | --- |
| Perception | repo, history, runtime logs, metrics, outside docs | OpenCode `read`/`grep`/`glob`/`shell`/`webfetch`, codegraph | `logs.*`, `metrics`, `research.ask` |
| Action | change code, run checks, open a PR, message people | OpenCode `edit`/`write`/`patch`/`shell`, `gh` | `pr.*`, `channel.send`, `acceptance.check` |
| Memory | what happened, what was decided, what hurt | session + compaction; `jobs`/`job_events` | experience corpus (§17), recall (§18) |
| Judgement | when to do which thing, in what order, to what standard | skills, `AGENTS.md` | trigger rules (§7.1), the brief (§7.2) |
| Boundaries | what may be touched, by whom, for how long | permissions (§8), worktrees (§9) | delegation scopes (§19) |
| Feedback | is it actually finished | event stream, CI | artifact checks (§7.3), approvals (§8) |

### 16.2 Principles

1. **Tool count is a context tax** — 40–120 tokens per schema; 300 tools ≈ 18k tokens before work starts.
   Budget **≤ 20 visible per job kind**.
2. **A tool returns evidence, not prose**: a message id, a PR URL, a count with an exemplar, an exit code.
3. **Procedures do not belong in tools.** A tool does X once; a skill says when, why and in what order.
4. **Progressive disclosure**: the skill names the tool; no catalogue, no registry search.
5. **Reversible by default**: branch before push, PR before merge, dry-run before write.
6. **No tool widens its own authority**: approvals are `once`; elevated scope expires with the job.
7. **If three lines of shell under the existing profile can do it, do not build the tool.**

### 16.3 The surface

| Tool | Job kinds | Purpose | Returns | Permission action |
| --- | --- | --- | --- | --- |
| `logs.dump` | qa, fix, incident | one window into a local NDJSON store (Vercel, Railway) | rows, window, path | `logs_dump` |
| `logs.query` | qa, fix, incident | group/filter/sample the dump | counts + exemplars | `logs_query` |
| `metrics` | qa, incident, maintenance | DB/LangSmith/Vercel/GitHub aggregates behind the read-only SQL guard | numbers + window | `metrics` |
| `experience.search` | all | prior lessons by symptom and tags | ≤ 5 hits with path/status/date | `experience_search` |
| `experience.write` | all | draft a lesson after a non-obvious fix | draft path, never `confirmed` | `experience_write` |
| `acceptance.check` | fix, requirement | run this job's acceptance list | per-check pass/fail/`UNVERIFIED` | `acceptance_check` |
| `channel.send` | maintenance, requirement | post or update a message/card in a whitelisted chat | message id | `channel_send` |

P1: `pr.open`/`pr.status` (structured PR state), `deploy.status`, `research.ask` (external repo/doc answer
with citations), and — from §18 — `session.search`, `session.get`, `runtime.config`.

P2, only on a concrete need: `sandbox.exec`, `budget.status`, `incident.open`.

Counts: `fix` = 18 tools, `qa` = 16. Both stay under the budget.

### 16.4 Deliberately not exposed

Raw SQL (only canned aggregates). Production write APIs (deploy, migrate, billing, credit spend). Secret
stores. A tool catalogue or registry search. Arbitrary HTTP to internal admin endpoints. `edit` outside the
job's worktree; `external_directory` denied.

### 16.5 The customization ladder

| Level | You add | Code change | Review | Example |
| --- | --- | --- | --- | --- |
| 1 | a line of preference or boundary in `AGENTS.md` | no | none | "never touch billing code" |
| 2 | a skill (`SKILL.md` + references) | no | none | how to triage a 5xx |
| 3 | a tool (MCP server or a thin tool here) | yes | yes | a new log source |
| 4 | control-plane behaviour (job kind, state, acceptance) | yes | yes + migration | scheduled audits |

Two rules keep the ladder honest. A new capability **must not require touching the state machine**; if it
does, it is level 4 and needs a design note. A level-2 addition **must declare its acceptance checks**,
otherwise the jobs it creates can never legitimately end as `done`.

## 17. Experience base

### 17.1 Never auto-loaded

Three reasons it is a corpus to query, not context to load:

- **Size**: a year of incidents is hundreds of kilobytes; the top few notes are never the ones needed.
- **Staleness**: advice correct for a retired provider or an older framework is actively misleading.
- **Injection**: agents write these notes, and notes are text; anything injected wholesale is a channel for
  "ignore your instructions".

No note goes into a system prompt, ever. Retrieval is a tool call, and the retrieved text is quoted as
reference material.

### 17.2 Lifecycle

`capture → review → index → retrieve → expire / supersede`. A note is `draft` on write; it becomes
`confirmed` only when a human says the fix held, or a later job cites it successfully. Most days produce zero
notes, and that is the correct outcome.

### 17.3 Shape

One file per lesson, `experience/<yyyy-mm-dd>-<slug>.md`:

```markdown
---
id: 2026-10-23-mcp-subscriptions-timeout
title: MCP subscriptions/listen hits the 60 s function limit
symptom: /api/mcp 504 roughly every 61 s, 400+ error rows per day
root_cause: the SDK serves subscriptions over SSE; maxDuration is 60 s
fix: reject subscriptions/listen on the stateless endpoint (PR #1484)
verify: error rows for that route fall to zero in the next window
tags: [mcp, vercel, timeout]
evidence: ["log window 2026-10-23T00:00/13:49, 379 rows", "pr:1484"]
status: confirmed
review_after: 2027-04-23
---

What we saw, what we tried that did not work, and the check that would catch a regression.
```

`evidence` needs at least one verifiable anchor. A note without evidence is a rumour.

### 17.4 Retrieval

Two stages: search returns ≤ 5 hits (title, one line, path, status, date); the session reads **at most
three** full notes. Index cost is ~60 bytes per hit. Add embeddings only past ~500 notes or when keyword
search demonstrably misses.

### 17.5 Governance

Untrusted text, wrapped as `<experience source="...">` and labelled reference material. No auto-promotion.
Contradictions explicit (`supersedes`). `review_after` defaults to six months; stale notes rank lower. Dedupe
by hash of symptom + root cause. No secrets, tokens or customer data in a note.

### 17.6 Capture

Explicit (a `qa`/`fix` session may draft after a non-obvious fix) or nightly distillation (the control plane
drafts 0–3 from the day's `job_events` and offers them for one-tap approval). Never from an unfinished job.

## 18. Recall and runtime introspection

Full review: [`recall-and-runtime-introspection.md`](./recall-and-runtime-introspection.md). Summary:

- Job ledger covers only work the delegate dispatched; the experience corpus covers only promoted lessons.
  **Raw history of human work** is a separate memory layer, answered by `session.search` / `session.get`.
- Recall is `qa`/`incident`-scoped, read-only, redacted, and never auto-loaded.
- `runtime.config` stays in this container (plugin): only it can see the process overlay
  (`OPENCODE_CONFIG` → `opencode.managed.json`) and repository-vs-volume drift.
- Five rules worth more than the tools: one shared redaction module; noise defaults (37% of sessions are
  archived, 44% are subagents); a 2 s search budget that fails loudly; derived branch semantics that
  distinguish "current HEAD" from history; read-only as a contract.

## 19. Delegation: authorization, not capability

| Dimension | Rule |
| --- | --- |
| Identity | One bot identity per environment (dev, prod). Never a person's token, never a shared human account. |
| Scope | (person, channel) → allowed job kinds; (job kind) → tool profile + acceptance list; (environment) → read or write. |
| Time | Approvals are `once`; an elevated grant expires with the job. Nothing is remembered as "always allowed". |
| Reversibility | Default is branch → PR. Merge, deploy, migrate, spend, and anything sent under a human's name require a human. |
| Audit | Every tool call and approval lands in `job_events`; a job's report must cite its evidence. |
| Blast radius | Worktree only; `external_directory` denied; no production write credentials in the session environment. |
| Revocation | Removing a person from the chat allow-list stops new jobs immediately; running jobs are cancelled, not left to finish. |

## 20. Not yet verified — settle before relying on it

| Question | How to settle it |
| --- | --- |
| `worktree.create` semantics for `branch` / `from` (create or check out?) | one scripted experiment against a scratch repo; record the result here |
| How the `question` tool surfaces to a non-UI client (permission action? message type? inbox item?) | run a session that asks a question, inspect the session's messages |
| Whether `session.generate` needs a session id, and what it costs | measure one call (only needed if §7.1 phrases prove too blunt) |
| Scanner behaviour on compound shell commands (`&&`, `$(...)`) | try `git status && git push` against the deny profile |
| Whether session `metadata` is queryable server-side | assumed **no**; the store owns session ids |
| Whether an archived session is still resumable / sendable to | try prompting an archived session |

## 21. Milestones and acceptance

**P0 — unattended Q&A (~1 week).** Feishu message → job → read-only session → answer in the topic; restart
reconciles; `/status` shows it. Acceptance: `kill -9` mid-job, restart, the job finishes and answers exactly
once; a second Feishu message from the same thread while the first runs queues instead of interleaving.

**P1 — fixes and requirements (~2 weeks).** Worktree from `origin/main`, one session implements and verifies,
plan gate, PR, CI loop, merge by a human. Acceptance: one sentence in Feishu produces an open PR whose CI is
green; `git push origin main` from the session is denied and logged; an approval timeout rejects; a job whose
CI stays red ends `failed` with the branch kept.

**P2 — breadth.** MCP facade (`job.create|list|get|cancel`, `session.tail`); Slack; cron jobs (nightly
briefing on the inspection skill); the experience distillation loop; `sandbox.exec` when a job needs a
throwaway environment.

## 22. Reused, not rebuilt

| Existing piece | Role here |
| --- | --- |
| `joops/feishu-bot/src/bridge.ts` | becomes `channels/feishu.ts` (routing, dedupe, outbox, single-consumer lock already proven) |
| `joops/feishu-bot/src/state.ts` | shared state outside checkouts |
| `joops/feishu-bot/src/whitelist.ts` | chat admission; everything else refused |
| `joops/feishu-bot/src/feishu.ts` | token, send, card, members, thread reply |
| `joops/feishu-bot/src/opencode.ts` | session adapter, to grow create/prompt/wait/get/interrupt |
| `.agents/skills/system-inspection` | policy for `qa` and `maintenance` jobs |
| `.agents/skills/req-to-ship-en` | policy for `requirement` jobs |
| `self-tools.md` + `recall-and-runtime-introspection.md` (this directory) | recall and config introspection (§18) |
| this container's `entrypoint.sh` + supervisor script | process supervision, single-instance lock, restart backoff |

## 23. Open questions

1. **Reviewer for untestable work.** If a class of jobs (copy changes, design judgement) starts passing its
   checks while being wrong, add a second session *for that class only*. What is the trigger metric — a
   human-rejected PR rate?
2. **Cross-repo jobs.** One job touching two repositories, or two jobs and a link? One job is simpler to
   reason about; two is simpler to roll back.
3. **Retention.** Sessions and topics live 7 days. Is that long enough for "what did we do last month" once
   recall exists, or do we need our own archive of job reports?
4. **Federation.** When a second container exists: search across hosts, or per-host recall merged by the
   control plane?
5. **Budget enforcement.** Hard stop at 100% is easy for tokens, harder for money when the provider bills
   asynchronously. Do we stop at 80% and reconcile later?
