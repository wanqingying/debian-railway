# Stage 3 — Code Changes

**Goal**: implement the code changes on the correct requirement branch, based on the confirmed design.

**Prerequisite**: the design review has passed and the user has confirmed.

## Steps

### 1. Check/create the requirement branch
- Check whether the current branch is this requirement's branch.
- If not on the right branch:
  - **Look at a few historical branch names for the naming convention**, follow the project's existing naming style.
  - Pick a branch name that **correctly and concisely describes the current requirement** (derived from the requirement document's feature name).
- After switching/creating the branch: **run `codegraph sync`** to sync code changes.

### 2. Confirm git state is clean and synced with remote
- `git status`: is the working tree clean?
- `git fetch` + confirm it's in sync with the remote main branch (avoid developing on stale code).
- After syncing: **run `codegraph sync`**.

### 3. Execute the code implementation
- Implement item by item per the detail design in `technical-design.md`.
- Use `codegraph_explore` throughout implementation to keep an accurate understanding of the code logic.
- Advance the unit-test/e2e tests designed at the design stage in parallel (not back-filled after implementation).
- **Progress tracking**: tick off implementation steps one by one in `ops/implementation-tracking.md` and record commit SHAs (same commit as the code; run `git rev-parse HEAD` to record the baseline before committing).
- Commit in small steps: one commit per logical unit; commit messages follow the project style.

### 4. Human collaboration during implementation (important)
- **Drive autonomously**: implementation details, naming, error handling, etc., are handled at the "drive autonomously" tier — don't interrupt the user.
- **New issues not covered by the design**: don't silently expand scope — first record them in `review.md`'s pending-decisions list (with options + recommendation + rationale), keep advancing what can advance, and submit to the user in a batch at the stage boundary.
- **Implementation conflicts with the design**: if implementation reveals a design detail that doesn't hold, record it in the pending-decisions list ("options + recommendation + rationale"), continue implementing the recommended approach, and submit to the user at the stage boundary; only **key decisions that block downstream work** genuinely warrant stopping and waiting.
- Technology selection / destructive operations / changes touching data permissions → add to the pending-decisions list, submit in a batch; don't execute unilaterally.

### 5. Stage-boundary reporting
- When implementation completes or hits a blocker, report **progress + pending decisions as a package** to the user (what was done, test status, the decision list needing approval).
- After the user decides, correct accordingly and proceed to stage 4 code review.

## Cautions
- Don't start writing code when not on the right branch, git state is dirty, or not synced with remote.
- When a branch name doesn't match project conventions, add it to the pending-decisions list (candidates + recommendation) for the user, or follow existing conventions and decide autonomously while recording.
- Don't implement everything and commit it all at once — keep commits traceable and revertible.
- Don't disturb the user piecemeal within a stage; report **in batches** at stage boundaries.