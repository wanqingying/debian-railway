# Stage 4 — Code Review

**Goal**: systematically review the implementation across three dimensions — functional correctness, technical/architectural soundness, and impact on existing functionality. Not complete until the review passes.

**Core loop**: if the review finds the implementation incomplete or problematic → return to stage 3 to fix, until it passes. If the problem **originates in the requirements or design itself** (not the implementation), **rolling back** to stage 1 (requirements) or 2 (design) to correct is allowed, then continue — rolling back is the normal rhythm, not a failure.

## Steps

### 1. Assess whether the implementation steps are complete
- Against the detail design in `technical-design.md` and the progress tracking in `ops/implementation-tracking.md`:
  - Are all design items implemented?
  - Are the designed unit/e2e tests all written and passing?
- If incomplete: return to stage 3, stating the gap.

### 2. Complete → update the progress-tracking document
- In `ops/implementation-tracking.md`, confirm all steps are complete and record the corresponding commit SHAs.

### 3. Read the requirements + technical design
- Re-read `requirements.md` and `technical-design.md`; use them as the review baseline, not your impression.

### 4. Inspect the code changes with git
- `git diff` / `git log` to see the complete change set relative to the base branch.

### 5. Three-dimension review (may use subagents in parallel; use your judgment)
The three dimensions are evaluated independently; you may delegate to subagents in parallel and consolidate:

**a. Functional correctness & reasonableness**
- System perspective: is the implementation reasonable, are there logic holes, was the best implementation path chosen?
- User perspective: is the usage flow complete, is the experience optimal, are user-action feedback and prompts correct and reasonable?

**b. Technical & architectural soundness**
- Review whether the architecture design is sound and whether there are technical-detail issues / code smells.
- Evaluate from multiple angles: architecture, conventions, smells, maintainability, security, performance.
- **Architecture and newly introduced core dependencies/complex libraries**: consult official docs, web search, best practices; compare and reflect on possible alternatives; assess whether the selection is optimal.

**b'. Code robustness** (dedicated sub-dimension of b — check item by item, don't let issues slide on impressions)
- **Exception handling**: are all failure paths handled? Do errors propagate as hard-to-understand failures or crashes? Is anything swallowing exceptions and masking problems? Does failure degrade gracefully rather than aborting the whole flow?
- **Edge cases & invalid input**: do null/empty/oversized/out-of-range/malformed/malicious inputs each have a defined handling path? Is external input (user, interface, config) validated?
- **Partial failure & consistency**: how does a multi-step operation wind down when an intermediate step fails? Does it produce dirty data, half-finished artifacts, or inconsistent state? Are transactions/compensation/retry/idempotency needed?
- **Resource management**: are connections, file handles, temp files, and timers released correctly on failure paths too? Any leak or resource-exhaustion risk?
- **Concurrency & race conditions**: do shared state, async callbacks, and concurrent access have race conditions or data races? Do writes need locking/atomic operations?
- **Timeout & cancellation**: do calls depending on external systems/network have timeouts and failure-retry policies? Is cleanup done when a task is cancelled/interrupted?
- **Diagnosability**: do critical paths have usable logs/metrics so failures can be located quickly (rather than just "an error occurred")? Are error messages practically actionable for users and operators?

**c. Impact on existing functionality**
- Does this change break other features? Perform a complete impact assessment (modules called, modules calling this code, consumers of data-format changes, config/environment dependencies).

### 6. Record the review results
- Write the conclusion into the current iteration's `review.md` (append a code-review section):
  - Issue list per dimension (severity, location, suggested fix)
  - Pass/fail conclusion
  - Autonomous decisions made during implementation but not covered by the design, with rationale (traceability of the "drive autonomously" tier)
- If issues are found: return to stage 3 to fix, then review again; if the problem originates in requirements/design, roll back to stage 1/2.
- **Human batch sign-off**: when UX/product-behavior changes are involved, or the review has disputed conclusions, package the sign-off points + change summary for the user, confirm once, then treat the review as passed.

## Cautions
- Review against the requirements+design baseline, evaluated independently — don't flatter your own work.
- Impact assessment (dimension c) is the easiest to miss; be sure to check all consumers of data-format/interface changes.
- When using subagents for parallel review, give each a clear objective and output format, then consolidate.
- **New requirement points** discovered during review (reasonable ideas beyond the current scope) should not be merged into the implementation; record them in `review.md` for the user to decide whether to open a new iteration.