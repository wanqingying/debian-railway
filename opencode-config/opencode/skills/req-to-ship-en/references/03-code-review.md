# Stage 3 — Code Review

**Goal**: systematically review the implementation across three dimensions — spec conformance & functional correctness, technical/architectural soundness, and impact on existing functionality. Not complete until the review passes.

**Core loop**: if the review finds the implementation incomplete or problematic → return to stage 2 to fix, until it passes. If the problem **originates in the requirements or design itself** (not the implementation), **rolling back** to stage 1 to correct is allowed, then continue — rolling back is the normal rhythm, not a failure.

**Depth scales with level** (see master file): L0 does the full three dimensions and may use parallel subagents; L1 is standard; L2 is a lightweight review without forcing all three dimensions.

## Steps

### 1. Assess whether the implementation steps are complete
- Against the agreed design (with an iteration, `design.md`; the commit log is the step record):
  - Are all design items implemented?
  - Are the designed unit/e2e tests all written and passing?
- If incomplete: return to stage 2, stating the gap.
- L2 may skip the item-by-item check and just verify the change meets the requirement goal.

### 2. Confirm the commit log is complete
- `git log <base>..HEAD`: every logical step has its own commit; there is no tracking file.

### 3. Read the requirements + technical design
- Re-read the requirement and the agreed design (`design.md` when it exists); use them as the review baseline, not your impression.

### 4. Inspect the code changes with git
- `git diff` / `git log` to see the complete change set relative to the base branch.
- **Read every changed line.** Don't scan a human-written function and assume its body is fine. If a change is hard to follow, that is itself a finding — a later reader (and the agent that edits it next) will struggle too; ask for a clarification or a simplification instead of approving code you cannot follow.

### 5. Three-dimension review (may use subagents in parallel; use your judgment)
The three dimensions are evaluated independently; you may delegate to subagents in parallel and consolidate. **Review depth scales with level**: L0/L1 do all items; L2 just targets the main risks without forcing all of them.

**a. Spec conformance & functional correctness**
- **Implements the requirement**: against `design.md` / the requirement, is everything asked for present and correct? List anything missing or only partly done.
- **No scope creep**: was anything added that was not asked for (an unrequested flag, behaviour, or abstraction)? Extra scope is a finding to surface, not a bonus — the human decides whether to keep it.
- System perspective: is the implementation reasonable, are there logic holes, was the best implementation path chosen?
- User perspective: is the usage flow complete, is the experience optimal, are user-action feedback and prompts correct and reasonable?
- **Tests are code too — review them as carefully as the production code**:
  - Does each test assert a real behaviour, or is it a tautology / a snapshot of whatever the code happens to produce?
  - **Would it fail if the code were broken?** A test that passes for the wrong reason is worse than none — name a change that should turn it red.
  - Is over-mocking letting it pass regardless of the real logic? Are error and edge cases covered, not only the happy path?
  - A green suite is not evidence by itself: for a behaviour / output / cost change, insist on the verification that proves the change.

**b. Technical & architectural soundness**
- Review whether the architecture design is sound and whether there are technical-detail issues / code smells.
- Evaluate from multiple angles: architecture, conventions, smells, maintainability, security, performance.
- **Naming & comments**: does a name reveal what the thing is or does (a good name needs no comment)? Do comments explain *why* — a decision, a constraint — rather than restating *what* the code already says? Flag comments that paraphrase the code, and code that only a comment makes understandable.
- **Smell baseline** (a labelled heuristic, never a hard violation; a documented repo standard wins; skip what tooling already enforces): mysterious name, duplicated code, feature envy, data clumps, primitive obsession, repeated switches, shotgun surgery, divergent change, speculative generality, message chains, middle man, refused bequest (Fowler, *Refactoring* ch.3). Name the smell — "possible Feature Envy" — rather than calling the code "smelly".
- **Architecture and newly introduced core dependencies/complex libraries**: consult official docs, web search, best practices; compare and reflect on possible alternatives; assess whether the selection is optimal.

**b'. Code robustness** (dedicated sub-dimension of b — check item by item, don't let issues slide on impressions)
- **Exception handling**: are all failure paths handled? Do errors propagate as hard-to-understand failures or crashes? Is anything swallowing exceptions and masking problems? Does failure degrade gracefully rather than aborting the whole flow?
- **Edge cases & invalid input**: do null/empty/oversized/out-of-range/malformed/malicious inputs each have a defined handling path? Is external input (user, interface, config) validated?
- **Partial failure & consistency**: how does a multi-step operation wind down when an intermediate step fails? Does it produce dirty data, half-finished artifacts, or inconsistent state? Are transactions/compensation/retry/idempotency needed?
- **Resource management**: are connections, file handles, temp files, and timers released correctly on failure paths too? Any leak or resource-exhaustion risk?
- **Concurrency & race conditions**: do shared state, async callbacks, and concurrent access have race conditions or data races? Do writes need locking/atomic operations?
- **Timeout & cancellation**: do calls depending on external systems/network have timeouts and failure-retry policies? Is cleanup done when a task is cancelled/interrupted?
- **Observability** — check item by item, not on impression:
  - **Greppable logs at key steps**: a new flow's entry and exit, each branch/decision that matters, and every external call (provider, DB write, queue, webhook) emits a log that says what happened and with which identifiers. A run that cannot be followed through the logs is not reviewable in production — ship the signal with the feature, not after the first incident.
  - **Structured, with correlating identifiers**: include what lets you tie a line to a run — request/run id, tenant/workspace id, the unit of work, provider id — not a bare "an error occurred".
  - **Use the repo's existing observability channels; invent none**: route traces and product-meaningful events through the mechanisms the repo already has, and **add no bespoke telemetry or run tables**.
  - **Errors carry context and stay visible**: log the failure with actionable context; don't swallow exceptions or log-and-continue silently (see the exception-handling item above).
  - **No secrets or PII in logs**: never emit tokens, keys, credentials, or raw personal data.
  - **Signal, not noise**: no per-item logging inside tight loops; use levels meaningfully (info for milestones, warn/error for what someone must act on).
  - **Locatable from logs alone**: given only the logs, can an operator tell whether the new behavior ran, and if it failed, why?

**c. Impact on existing functionality**
- Does this change break other features? Perform a complete impact assessment (modules called, modules calling this code, consumers of data-format changes, config/environment dependencies).

### 6. Record the review results
- With an iteration, append a code-review section to the current iteration's record (`README.md`):
  - Issue list per dimension, each with **location + severity + suggested fix**; use one vocabulary: **blocker** (must fix before merge — correctness, security, data, a broken contract), **should-fix** (real, but not merge-blocking), **nit** (a preference; prefix `Nit:` and never block on it).
  - Pass/fail conclusion.
  - Autonomous decisions made during implementation but not covered by the design, with rationale (traceability of the "drive autonomously" tier).
- Without one, fix the findings and carry into the PR description only what a reviewer needs: those autonomous decisions with rationale, and any residual risk or unfixed finding.
- If issues are found: return to stage 2 to fix, then review again; if the problem originates in requirements/design, roll back to stage 1.
- **Human batch sign-off**: when UX/product-behavior changes are involved, or the review has disputed conclusions, package the sign-off points + change summary for the user, confirm once, then treat the review as passed; L0/L1 must not skip this, L2 may self-confirm.

## Cautions
- Review against the requirements+design baseline, evaluated independently — don't flatter your own work.
- Impact assessment (dimension c) is the easiest to miss; be sure to check all consumers of data-format/interface changes.
- When using subagents for parallel review, give each a clear objective and output format, then consolidate.
- **New requirement points** discovered during review (reasonable ideas beyond the current scope) should not be merged into the implementation; record them as follow-ups for the user to decide on.