# Stage 4 — Self-Test, Integration & Delivery

**Goal**: complete self-testing and integration, deliver a PR ready for review, and confirm after release that no rollback trigger fires. Commits, pushes, the PR, and merging follow the project's git conventions; merging waits for the user's explicit LGTM.

**Depth scales with level** (see master file): test scope, integration effort, and whether to run canary/rollback all scale with the level — L2 needs only targeted verification, while L0 must run the full tests and (if there's a core risky change) canary/rollback.

## Steps

### 1. Sync remote main-branch code again
- `git fetch` and confirm the branch is in sync with the remote main branch; rebase/merge if necessary.

### 2. Run unit tests + e2e tests
- Run all unit/e2e tests designed at the design stage and written during implementation; L2 may do only targeted tests or manual verification.
- Self-test is complete only when all pass; fix failures and re-run.

### 3. Integration verification
- If necessary, ask the user to run local debugging: provide **detailed debug steps** (from the "Local & remote debugging guide" when there is a `design.md`).
- Verify release prerequisites (environment variables, database, third-party platform operations, rollback steps) with the user — from the "Release checklist" and "Canary & rollback plan" when there is a `design.md`.

### 4. Delivery
Once implementation is complete, the applicable checks pass, and your own review finds it ready:
  1. Sync remote main-branch code again (`git fetch` + confirm sync).
  2. Format only the files this branch changed, using the project's formatter; never a repo-wide reformat.
  3. Commit the changes (an iteration's docs, if any, in the same commit chain as the code).
  4. `git push` the requirement branch.
  5. **Open the PR ready for review.** Its description is the record (master file → "Documentation") and also states the level and whether canary/rollback is needed; with an iteration, it summarizes and links them. It must be self-contained: reviewers should understand the change without the conversation.
  6. Merge only after the user's explicit LGTM.

### 5. Post-release observation & rollback (as needed)
- If the design includes a "Canary & rollback plan": ramp up per the plan, watch the predefined metrics; when a **stop/rollback trigger condition** is hit, immediately execute the plan's rollback steps and remediation, and notify the user.
- Stay on watch through the observation window until ramp-up completes or a rollback happens; record the outcome (including anomalies) and report it to the user.
- Ordinary changes without canary/rollback (e.g. L2) may skip this section.

## Cautions
- **Canary/rollback runs only for "core risky changes"** (see stage 1 B10); ordinary bug fixes, layout tweaks, etc. don't need this flow.
