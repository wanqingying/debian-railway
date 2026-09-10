# Stage 4 — Self-Test, Integration & Delivery

**Goal**: complete self-testing and integration, deliver for release, and confirm after release that no rollback trigger fires. The release actions (commit + push + create MR) run only after the user expresses finish/release/publish intent.

**Depth scales with level** (see master file): test scope, integration effort, and whether to run canary/rollback all scale with the level — L2 needs only targeted verification, while L0 must run the full tests and (if there's a core risky change) canary/rollback.

## Steps

### 1. Sync remote main-branch code again
- `git fetch` and confirm the branch is in sync with the remote main branch; rebase/merge if necessary.
- After syncing: **run `codegraph sync`**.

### 2. Run unit tests + e2e tests
- Run all unit/e2e tests designed at the design stage and written during implementation; L2 may do only targeted tests or manual verification.
- Self-test is complete only when all pass; fix failures and re-run.

### 3. Integration verification
- If necessary, ask the user to run local debugging: provide **detailed debug steps** (reference the "Local & remote debugging guide" in `technical-design.md`).
- Guide the user through the "Release checklist" and "Canary & rollback plan" in `technical-design.md` to verify release prerequisites (environment variables, database, third-party platform operations, rollback steps).

### 4. Delivery (controlled action)
**Without explicit user instruction, pushing code is forbidden.**
- After the user expresses "finish development / release / publish" intent:
  1. Sync remote main-branch code again (`git fetch` + confirm sync).
  2. Commit all changes (including documents: requirements, design, review, progress tracking — in the same commit chain as the code).
  3. `git push` the requirement branch.
  4. **Create the MR**: provide an MR description (requirement summary, change overview, test results, release-checklist status, link to review conclusions, the level and whether canary/rollback is needed).

### 5. Post-release observation & rollback (as needed)
- If the design includes a "Canary & rollback plan": ramp up per the plan, watch the predefined metrics; when a **stop/rollback trigger condition** is hit, immediately execute the plan's rollback steps and remediation, and notify the user.
- Stay on watch through the observation window until ramp-up completes or a rollback happens; record the outcome (including anomalies) in `review.md`.
- Ordinary changes without canary/rollback (e.g. L2) may skip this section.

## Cautions
- push/MR are controlled actions; do not execute without explicit instruction.
- Deliver documents together with the code to guarantee traceability (review.md records, progress tracking, checklist status).
- The MR description must be self-contained: reviewers should understand the change without the conversation.
- **Canary/rollback runs only for "core risky changes"** (see stage 1 B10); ordinary bug fixes, layout tweaks, etc. don't need this flow.
