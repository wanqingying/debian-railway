---
name: code-review
description: Review a pull request, merge request, branch, commit range, or working-tree diff for correctness, security, and fit with the repository's own conventions. Use when asked to review code or a change before merge, when reviewing a revision after feedback, and before shipping a risky change.
---

# Code Review

# Part 1 — The constants

## 1.1 Read the project's rules first

- `AGENTS.md`, `CONTRIBUTING.md`, `README.md`
- lint / format / type config, CI config
- architecture docs (`docs/`, ADRs) and the line-of-business docs for the area
- the code around the change

**Repository rules beat your taste.** Where the repo is silent, use 1.2.

## 1.2 The standard

- **Precision over recall.** Three findings that are right beat ten where two are wrong.
- **Evidence or nothing.** Every finding names the file, the line, and the concrete reason: the failing input, the missing guard, the caller that breaks.
- **The change, not the codebase.** Judge what the diff touched plus the minimum context needed. Pre-existing problems go in their own section, not the main list.
- **Whole files, not hunks.** If a change is too hard to follow, report that as a finding.
- **A verdict, always.** Approve / approve with nits / request changes.
- **A spec's silence is not permission.** Where it says nothing, judge by what a reasonable user of this code would expect.

## 1.3 What not to review

- what a tool already enforces: formatting, import order, lint, type errors
- unchanged code, except where the change depends on it
- personal preference — say it as `Nit:`, never block on it
- generated code, vendored dependencies, lockfile content (read its *diff*)

## 1.4 Severity

- **blocker** — must fix before merge: security, data loss, broken contract, wrong result
- **should-fix** — a real defect or a maintenance cost that will bite
- **nit** — optional polish, never blocks
- **pre-existing** — outside this change; at most three, in their own section

---

# Part 2 — The process

## 2-1. Understand the intent

Read the intent before any code. Sources, strongest first:

1. the requirement / spec (`docs/`, `specs/`, `prd/`, issue)
2. the technical design or ADR
3. the conversation history — when the change was written in this session, this is the primary record: the requirement as stated, the decisions taken, the constraints, and what was explicitly deferred
4. the PR/MR description
5. commit messages
6. the diff itself — mark it as an inference when it is the only source

Reviewing a change written in this session: the history supplies the benchmark, not the justification. Deferred items are gaps. Decisions are claims to check against the code, not facts to accept.

Pin down the target:

| Target | How |
|---|---|
| PR / MR | `gh pr view <n>`, `gh pr diff <n>` |
| Branch | `git merge-base origin/main HEAD`, then `git diff <base>...HEAD` |
| Commit range | `git diff <from>..<to>` |
| Working tree | `git diff`, `git diff --staged` |
| Re-review | only the commits added since the last reviewed SHA |

Set the depth:

- **tiny** (< 50 changed lines, ≤ 3 files): one pass.
- **normal**: the full process.
- **large** (> 400 lines or > 20 files): say so, recommend splitting, review the riskiest files first — security, data, contracts, concurrency — and list what you skipped.

Record the prior state: `gh pr checks <n>` (name the failing job if CI is red; do not re-derive it), and every finding from the previous round as *fixed*, *still open* or *obsolete*.

Write one paragraph: what this change claims to do, and its tier.

## 2-2. Understand the current state

- Read the architecture of the area: module boundaries, data flow, the layer this change belongs to, what already exists that it could reuse.
- Read the related code: what it calls, what calls it, the tests that cover it.
  `codegraph`: confirm `.codegraph/` (else `codegraph init`), run `codegraph sync`, then `codegraph_explore` for the symbols and their call paths.
- Read the data: schema, migrations, config keys, env vars the change depends on.
- Form a model of how this change should fit.

List the contracts the change can break.

## 2-3. Review the change

Read the full changed files. Walk one happy path and one failure path. Check the other side of every boundary the change crosses: API, schema, message, CLI flag, config key.

Answer two questions separately: **does it do the right thing**, and **is it done the right way**.

### A. Intent conformance and functional correctness

- is every required behaviour present, and correct?
- is anything present that nobody asked for? Extra scope is a finding, not a bonus
- logic holes: wrong condition, off-by-one, wrong variable, unreachable branch
- system view: is this a sound way to implement it?
- user view: is the flow complete, is the feedback correct, are errors presented sensibly?

### B. Tests — review them as code

- does each test assert real behaviour, or tautology / a snapshot of current output?
- **would it fail if the code broke?** Name the change that would turn it red
- is over-mocking hiding a broken real path?
- are error and edge cases covered, not just the happy path?
- **green is not evidence.** For a change to behaviour, output or cost, require something that proves *this* change

### C. Technical and architectural soundness

- right layer? composes with what exists? missed a reusable piece?
- more complex than the problem? generic for a need that does not exist?
- **naming**: does the name reveal what the thing is? **comments**: do they explain *why* — a decision, a constraint — rather than restate *what*?
- **new core dependency or complex library**: check its docs, its alternatives, whether it is the right choice
- **smells** — name the smell ("possible Feature Envy"), never just "smelly". Heuristics, not violations; repo standards win; skip what tooling enforces.
  Mysterious Name · Duplicated Code · Feature Envy · Data Clumps · Primitive Obsession · Repeated Switches · Shotgun Surgery · Divergent Change · Speculative Generality · Message Chains · Middle Man · Refused Bequest

### D. Robustness — check each item

- **exceptions**: every failure path handled? swallowed? turned into an incomprehensible crash? does the caller learn?
- **boundaries and invalid input**: null, zero, empty, huge, over-limit, malformed, hostile — each handled? is external input (user, API, config) validated?
- **partial failure and consistency**: a multi-step operation that fails midway — dirty data, half-done state? is a transaction, compensation, retry or idempotency key needed?
- **resources**: connections, file handles, temp files, timers — released on the failure path too? leak or exhaustion risk?
- **concurrency**: shared state, async callbacks, concurrent access — races, lost updates, missing locks?
- **timeouts and cancellation**: external calls time-bounded? retries bounded? work cleaned up when cancelled?
- **observability** — new flows must be diagnosable from logs alone:
  - greppable lines at the entry and exit of a new flow, at each meaningful branch or decision, and at each external call (provider, DB write, queue, webhook), carrying the identifiers that tie them together
  - use the repository's existing observability channel; never add a new telemetry or run table
  - errors carry actionable context; no silent log-and-continue
  - no secrets, tokens, credentials or raw personal data in logs
  - signal, not noise: not a line per loop iteration; info for milestones, warn/error for what needs a human

### E. Security — check what the diff touches

- injection: SQL/NoSQL, shell, template, header, path traversal, SSRF
- authorisation on every new entry point — ownership, not just login (IDOR)
- secrets in code, logs, error messages, URLs
- unsafe deserialisation, XXE, prototype pollution, zip-slip
- crypto: home-made schemes, weak randomness for tokens, missing verification
- output encoding for rendered data (XSS); CSRF on state-changing routes
- new dependencies: maintained, pinned, licence-compatible, lockfile updated

### F. Impact on existing behaviour

- callers and callees: what breaks when this signature, shape or ordering changes?
- data-format changes: every consumer found and checked?
- config, env and deployment assumptions
- migration: reversible? backfilled? does an old instance still work during rollout?
- contract: breaking change? versioned? do old clients still work?

### Size signals

- a change that pushes a file past ~1000 lines — decompose before piling more on
- a lockfile edited by hand, or a dependency added without a lockfile update

Record each candidate finding with `file:line`, a proposed severity, and the reason.

## 2-4. Verify the conclusions

Attack every candidate before reporting it. For each blocker, and for any should-fix you are not certain about:

- **re-read the exact line** — is the guard really missing, or two lines above?
- **check the caller** — does the bad input actually reach this function?
- **check the config** — is the setting that triggers this actually on? grep the config, read the env, query the runtime
- **check the test** — does an existing test already prove it works?
- **check the logs / output** — does the code really run this path?
- **run the cheapest demonstration** — the failing case, the relevant test file, a two-line script. Not the full suite unless asked

Then classify each one:

- **confirmed** — keep it, with the evidence
- **downgraded** — real but conditional; fix the severity and state the condition
- **unverified** — cannot be demonstrated in this review: mark it `unverified` and say what would settle it, or drop it
- **dropped** — it did not survive contact with the code

Never mutate the reviewed branch or push. For another revision, use a temporary `git worktree`.

---

# Part 3 — The report

At most ~10 findings. Merge duplicates. Rank. If nothing blocks, say so plainly.

```
## Verdict
approve | approve with nits | request changes

## Summary
≤5 lines: what it does, can it ship.

## Findings
### Blocker
1. `path/file.ts:42` — <what is wrong>
   Why: <impact>
   Evidence: <input / call path / config / test / log>
   Fix: <concrete change>
### Should-fix
...
### Nit
...

## Intent gaps
## Prior findings
## Pre-existing
## Not reviewed / assumptions
## Strengths        (≤3, specific)
```

- A supplied JSON schema overrides this template — read it first, never invent fields.
- One issue per finding. No tables inside a finding.
- Posting to the PR only when the user asks.
- A contested blocker, or a UX/product behaviour change, goes to the human with the evidence attached.

---

# Part 4 — Before you sign

- Did I read the full changed files, not just the hunks?
- Did I walk a happy path and a failure path?
- Does every finding carry `file:line` and evidence, and did it survive 2-4?
- Did I review the tests as code — would they fail if the code broke?
- Did I check exceptions, boundaries, partial failure, resources, concurrency, timeouts?
- Are the new flows diagnosable from logs alone, with no secrets in them?
- Did I check authz, injection and secrets on each new entry point?
- Did I check every consumer of a changed format, config or contract?
- Did I resolve every prior finding?

**Excuses to reject**

| Excuse | Reality |
|---|---|
| "Tests pass, so it is correct." | CI proves the tests ran, not that they assert the right thing. |
| "LGTM." | A verdict needs evidence that you read it. |
| "The diff is big, I will skim." | Say it is big, review the risky files, and list what you skipped. |
| "I will call it a nit to be safe." | Nits do not block; committing to a severity is the job. |
| "The linter will catch it." | Then do not report it at all. |
| "This is probably a bug." | Trace it, or mark it unverified, or drop it. |
| "It is in the spec, so it must be fine." | The spec says what must happen, not that this implementation achieves it. |
