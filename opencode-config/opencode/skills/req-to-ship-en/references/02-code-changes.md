# Stage 2 — Code Changes

**Goal**: implement the code changes on the correct requirement branch, based on the confirmed design.

**Prerequisite**: stage 1's design review has passed and the user has confirmed the pending decisions (**L2 may be exempt**: proceed straight to implementation when the change is self-evident with no design trade-offs).

**Depth scales with level** (see master file): L0 uses strict small commits (the commit log is the step tracking); L1 standard; L2 may be a single commit.

## Steps

### 1. Check/create the requirement branch
- Check whether the current branch is this requirement's branch.
- If not on the right branch:
  - **Look at a few historical branch names for the naming convention**, follow the project's existing naming style.
  - Pick a branch name that **correctly and concisely describes the current requirement** (derived from the requirement's feature name).
- A new worktree has no index: run `codegraph init --yes` there once (the file watcher keeps it fresh afterwards).
- L2 gets its own branch too: every change goes through a feature branch and a PR (per the project's git conventions).

### 2. Confirm git state is clean and synced with remote
- `git status`: is the working tree clean?
- `git fetch` + confirm it's in sync with the remote main branch (avoid developing on stale code).

### 3. Execute the code implementation
- Implement item by item per the agreed design (`design.md` when there is one; for L2 with no design, per the requirement itself).
- Use `codegraph_explore` throughout implementation to keep an accurate picture of the code you are changing — name the symbols you are about to edit so their source and callers come back together — and read the file before editing it.
- Advance the unit-test/e2e tests designed at the design stage in parallel (not back-filled after implementation).
- **Progress tracking is the commit log**: one commit per logical step with a semantic message, so `git log` shows the sequence and `git blame` the origin; there is no tracking file. The iteration record cites the commit range once.
- Commit in small steps: one commit per logical unit; commit messages follow the project style (L2 may be a single commit).

### 4. Human collaboration during implementation (important)
- **Drive autonomously**: implementation details, naming, error handling, etc., are handled at the "drive autonomously" tier — don't interrupt the user.
- **New issues not covered by the design**: don't silently expand scope — first add them to the pending-decisions list (with options + recommendation + rationale), keep advancing what can advance, and submit to the user in a batch at the stage boundary.
- **Implementation conflicts with the design**: if implementation reveals a design detail that doesn't hold, record it in the pending-decisions list ("options + recommendation + rationale"), continue implementing the recommended approach, and submit to the user at the stage boundary; only **key decisions that block downstream work** genuinely warrant stopping and waiting.
- Technology selection / destructive operations / changes touching data permissions → add to the pending-decisions list, submit in a batch; don't execute unilaterally.

### 5. Stage-boundary reporting
- When implementation completes or hits a blocker, report **progress + pending decisions as a package** to the user (what was done, test status, the decision list needing approval); L2 may just be a one-liner.
- After the user decides, correct accordingly and proceed to stage 3 code review.

## Cautions
- Don't start writing code when not on the right branch, git state is dirty, or not synced with remote.
- When a branch name doesn't match project conventions, add it to the pending-decisions list (candidates + recommendation) for the user, or follow existing conventions and decide autonomously while recording.
- Don't implement everything and commit it all at once — keep commits traceable and revertible.
- Don't disturb the user piecemeal within a stage; report **in batches** at stage boundaries.