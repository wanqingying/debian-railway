# Stage 5 — Self-Test, Integration & Delivery

**Goal**: complete self-testing and integration, then deliver for release. The release actions (commit + push + create MR) run only after the user expresses finish/release/publish intent.

## Steps

### 1. Sync remote main-branch code again
- `git fetch` and confirm the branch is in sync with the remote main branch; rebase/merge if necessary.
- After syncing: **run `codegraph sync`**.

### 2. Run unit tests + e2e tests
- Run all unit/e2e tests designed at the design stage and written during implementation.
- Self-test is complete only when all pass; fix failures and re-run.

### 3. Integration verification
- If necessary, ask the user to run local debugging: provide **detailed debug steps** (reference `ops/debug-guides.md`).
- Guide the user through `launch-checklist.md` to verify release prerequisites (environment variables, database, third-party platform operations).

### 4. Delivery (controlled action)
**Without explicit user instruction, pushing code is forbidden.**
- After the user expresses "finish development / release / publish" intent:
  1. Sync remote main-branch code again (`git fetch` + confirm sync).
  2. Commit all changes (including documents: requirements, design, review, checklist, progress tracking — in the same commit chain as the code).
  3. `git push` the requirement branch.
  4. **Create the MR**: provide an MR description (requirement summary, change overview, test results, release-checklist status, link to review conclusions).

## Cautions
- push/MR are controlled actions; do not execute without explicit instruction.
- Deliver documents together with the code to guarantee traceability (review.md records, progress tracking, checklist status).
- The MR description must be self-contained: reviewers should understand the change without the conversation.