# Stage 2 — Technical Design & Review

**Goal**: based on the confirmed requirements document, combined with existing code logic and overall architecture, produce an **architecturally sound, detail-complete, actionable** technical design document, validated by a design review.

**Prerequisite**: re-read the current iteration's `requirements.md`; use `codegraph_explore` to inspect the call chains and implementation of the modules involved; run `codegraph sync` as needed to keep the index fresh.

## Steps

### 1. Understand the existing architecture and code
- Use `codegraph_explore` to systematically map: involved modules, service boundaries, data flow, similar existing implementations.
- Confirm the insertion points: which layer/module to implement in, which files to change, which existing logic will be touched.

### 2. Key technology research (optional, as needed)
Required only when **introducing a new low-level/core dependency**; when there are none, write "N/A — no new dependency" with the reason.
- Consult **official docs** + **web search**: research usage, whether it meets the need, version/stability.
- **Is it the best choice**: compare against candidate alternatives (feature coverage, maintenance activity, performance, community maturity, license) and give the selection rationale.

### 3. Architecture design (required)
- Produce the overall architecture design: module breakdown, layers and boundaries, data flow, external interfaces, relationship to the existing system.
- After the initial design, **reflect on and evaluate the overall and key designs**:
  - Are there other designs? What are the candidate alternatives?
  - Evaluate each in turn (complexity, maintainability, performance, extensibility, risk), and arrive at the **optimal solution for this project's current situation**, with rationale.
- When there's an architecture divergence, record the comparison conclusion in `review.md`.

### 4. Database & table design (optional; mandatory if present)
- Describe the database changes: new/modified tables, fields, indexes, constraints.
- **Include migration notes**: migration script/method, data-compatibility handling, rollback plan.

### 5. Detail design for each part (required)
- Provide implementation-level detail for each feature/module: key classes/functions, interface signatures, state transitions, exception handling, edge cases.
- Provide pseudocode or flow descriptions for key algorithms/complex logic.

### 6. Core-flow unit-test & e2e-test design (required)
- Design the **core-flow-covering** unit-test case list (normal paths + key exception paths).
- Design the e2e case list: walk the end-to-end user flow.
- Map to the requirements document's acceptance criteria so every acceptance point has test coverage.

### 7. Local & remote debugging guide (required)
- Produce `ops/debug-guides.md`: a **user-facing integration guide** — how to start locally, how to connect to the deployed environment, how to trigger the flows this requirement involves, and common troubleshooting methods.

### 8. Release checklist (required)
- Produce `ops/launch-checklist.md`: everything to prepare before release —
  - Environment variables/config (new envs, whether to add to Railway Variables)
  - When to run database migrations
  - Third-party platform operations (whether approvals/configurations are needed)
  - Canary/rollback plan, data cleanup or backfill, monitoring items, teams to notify

### 9. Design review
- After the initial design, **re-inspect the modules and code involved** to confirm:
  - Design reasonableness: does it match the existing architecture with no over-engineering?
  - Actionability: change scope is controllable, no hidden dependencies, no missing key details.
  - Whether the step-3 architecture comparison conclusion still holds.
- Write the review conclusion into the current iteration's `review.md` (conclusion + confirmed/rejected design points + rationale).

### 10. Batch selection approval
- At the stage boundary, package **all selection/architecture decisions**: each as "candidate options + recommendation + rationale + comparison conclusion".
- The user decides in one batch; the agent updates `technical-design.md` and records decisions in `review.md` accordingly.
- After user confirmation, proceed to stage 3. If the user objects to certain choices, update the design and re-confirm (only on the disputed items, not the whole thing again).

## Cautions
- **Document locations follow the master file's "Document Directory Structure"**: design → `technical-design.md`, review → `review.md`, checklist → `ops/launch-checklist.md`, debugging guide → `ops/debug-guides.md`.
- Key technology research and architecture comparison are **mandatory fields** (write "N/A" with reasons when there are no new dependencies / no architecture divergence); they cannot be omitted wholesale.
- e2e/unit-test design is completed at the design stage and executed during implementation — not back-filled after implementation.
- No production code in the design stage, but **spikes are allowed**: for uncertain selections, write throwaway verification code to confirm feasibility; record results in `review.md`; spike code is not merged into the deliverable.