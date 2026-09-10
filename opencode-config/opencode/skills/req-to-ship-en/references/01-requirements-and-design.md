# Stage 1 — Requirement Clarification & Technical Design

**Goal**: first refine the user's requirement into an **unambiguous, actionable** requirements document, then produce an **architecturally sound, detail-complete, actionable** technical design document based on it.

**Prerequisite**: first run `codegraph sync` to sync code changes, then use `codegraph_explore` to analyze the existing system. The requirements sub-part (Part A) is the design's (Part B) input; **design does not start until the requirements are clear**.

---

## Part A — Requirement Clarification (produces `requirements.md`)

### A1. Understand the requirement
- Read the user's requirement statement in full; don't miss details. **Keep the user's original wording** as a document appendix to avoid information loss.
- Make clear the requirement's **background (why)**, **goal (what problem / business value)**, **scope (what's in / what's not)**, and **actors (who uses it, what triggers it)**.
- If this is a change/iteration on an existing feature: first read `docs/<feature>/`'s README timeline and the relevant iteration docs to confirm the baseline and existing design, then open a new incrementing iteration directory per the master file's spec.

### A2. Determine the change level (first — it sets process depth)
- **Decide the level first**: do a **preliminary** assessment using the questions in the master file's "Change Level & Process Depth". The level determines the process depth and output detail of this stage and all later stages — set the level, then decide how detailed each item should be.
- A small-sounding requirement does not mean a small change: after B1/B6 survey the code and impact, **confirm or revise** the level, and take the revised level as authoritative.
- Record the level and rationale in the requirements document (e.g. "Change level: L1 (rationale…)"). When in doubt, use the **higher** level.

### A3. Understand against existing code
(This step only needs enough understanding to "define the requirement and its impact scope"; deep structural/insertion-point analysis is left to B1 to avoid duplicated work.)
- Use `codegraph_explore` to find the relevant modules, call chains, data models, and existing implementations the requirement touches.
- Determine whether this is a **new feature**, a **behavior change to existing code**, or a **fix**, and which existing features it affects.
- When the requirement references existing UI/flows/interfaces, read the corresponding code first to confirm the current state.

### A4. Refine and clarify
- List the ambiguous points, **first autonomously handle what you can**:
  - What can be inferred from existing code/docs: verify it yourself and write it directly into the requirements document.
  - Edge cases (empty data, exceptions, concurrency), non-functional requirements, interaction details, dependencies: first make reasonable inferences based on the existing system, marked "to be confirmed".
- Decisions involving **scope, priority, product behavior** → per the master-file decision tiers, **must ask the human**: add to the pending-decisions list and present in batch at the stage boundary.
- Implementation-detail ambiguities (how to implement, etc.) → leave to Part B (technical design); record the related pending/autonomous decisions in `review.md`.
- Analyze reasonableness: does the requirement conflict with the existing architecture? Is it out of reasonable scope? If so, record it as a pending decision with reasons and submit to the user.

### A5. Produce the requirements document

Write to `requirements.md` in the iteration directory defined by the master file (**location and naming follow the master file's "Document Directory Structure"**). Content template:

```markdown
# <Feature> Requirements

## Change Level
(L0/L1/L2 + a one-line rationale; decide it per the master file's "Change Level & Process Depth")

## 1. Background & Goals
### Background (why we do this, the pain point it solves)
### Goals (what problem it solves, the expected business value)
### Success metrics (how we judge the goal achieved; quantify where possible)
### Sources & References
(Reference the original requirement ticket / product doc / design mockup / prototype:
 link or repo path. Keep product-authored material at its original source — do not copy it
 in full; cite it so the original intent stays traceable.)

## 2. Requirement Description
### Feature List
(each feature: description, priority, acceptance criteria)
### User Flow & Interaction
(from the user's perspective: entry → action → result, including normal/exception paths)
### UI & Interaction Requirements
(screens, interactions, state feedback, copy; if there are mockups/prototypes, cite their
 original source and the specific pages)

## 3. Non-Functional Requirements
(performance, security, compatibility, maintainability)

## 4. Boundaries & Constraints
(what we don't do, dependencies, limitations)

## 5. Acceptance Criteria
(verifiable checklist: satisfying these means it's done)
```

> **Background & Goals are the document's driving force** — they are the underlying motivation behind the requirement, and all later analysis, architecture, and trade-offs must revolve around them. Hence they come first, and the design review (B11) checks goal alignment: if a design does not serve the goal, either redesign it or state the deviation and why.
>
> **The requirements document focuses on "what we want", not technical implementation.** Technical matters like data/interface impact belong in the technical design document (B6); the requirements document describes only the business and user perspective.
>
> **L2 may be brief**: for a small/harmless change, the requirements document can be just "background & goals + feature/fix points + acceptance criteria" without filling every section.

---

## Part B — Technical Design (produces `technical-design.md`)

### B1. Survey the existing code and architecture
- Use `codegraph_explore` to systematically map: involved modules, service boundaries, data flow, similar existing implementations.
- Confirm the **insertion points**: which layer/module to implement in, which files to change, which existing logic will be touched.
- **Include key code/file references**: give relevant file paths + line numbers (e.g. `path/to/file.ts:123`) or key symbols, and say "why it's relevant, what will change". **Give only locating information, not large source excerpts** — the goal is to let implementation quickly locate the module and change points, not to restate the existing code.
- **Confirm/revise the change level here** (see A2): the actual change scope and impact may exceed the requirement's preliminary assessment.

### B2. Key technology research (as needed)
Required only when **introducing a new low-level/core dependency**; when there are none, write "N/A — no new dependency" with the reason.
- Consult **official docs** + **web search**: research usage, whether it meets the need, version/stability.
- **Is it the best choice**: compare against alternatives (feature coverage, maintenance activity, performance, community maturity, license) and give the selection rationale.

### B3. Architecture design (required)
- Produce the overall architecture: module breakdown, layers and boundaries, data flow, external interfaces, relationship to the existing system.
- After the initial design, **reflect on and evaluate the overall and key designs**: are there other designs? What are the candidate alternatives? Evaluate each (complexity, maintainability, performance, extensibility, risk), and arrive at the **optimal solution for this project's current situation**, with rationale.
- When there's an architecture divergence, record the comparison conclusion in `technical-design.md` (as part of the architecture design).

### B4. Database & table design (optional; mandatory if present)
- Describe the database changes: new/modified tables, fields, indexes, constraints.
- **Include migration notes**: migration script/method, data-compatibility handling, rollback plan.

### B5. Detail design for each part (required)
- Provide implementation-level detail for each feature/module: key classes/functions, interface signatures, state transitions, exception handling, edge cases.
- Provide pseudocode or flow descriptions for key algorithms/complex logic.

### B6. Data & interface impact
- Data structures and field changes, external interface contracts, relationship to the existing system, affected consumers.

### B7. Test design (required)
- Design the **core-flow-covering** unit-test case list (normal paths + key exception paths).
- Design the e2e case list: walk the end-to-end user flow.
- Map to the requirements document's "Acceptance Criteria" so every acceptance point has test coverage.
- **Depth scales with level**: L0 covers core flows + key exceptions + e2e; L1 covers the core paths; L2 needs only targeted tests or manual verification.

### B8. Local & remote debugging guide (required)
- A **user-facing integration guide**: how to start locally, how to connect to the deployed environment, how to trigger the flows this requirement involves, and common troubleshooting methods.
- The user-facing part can be synced into `user-guide.md`.

### B9. Release checklist (required)
- Environment variables/config (new envs, whether to add to Railway Variables).
- When to run database migrations.
- Third-party platform operations (whether approvals/configurations are needed).
- Monitoring items, teams to notify.

### B10. Canary & rollback plan (as needed)
After reading the change scope and impact (B1/B6), decide whether this change contains a **core risky change**. Write this section only when one of the following applies; otherwise write "N/A — no core risky change" with a one-line reason:
- Database schema / data migration
- Core agent / core engine / core business-logic change
- Low-level framework or core dependency upgrade
- Involves cost, permissions, or data integrity
- Hard-to-roll-back change

**Typical cases that don't need it**: bug fixes, page-layout tweaks, copy, ordinary small features. By level: **L0 required, L1 as needed, L2 usually not needed**.

When needed, this section must be standalone and executable — not just "roll back if something breaks":
- **Canary**: whether it's needed, scope/ratio/duration, ramp-up pace, observation metrics and stop conditions.
- **Rollback**: the explicit **trigger conditions** and **executable rollback steps** (step by step, directly followable).
- **Remediation**: how to repair/remediate data or state already produced after rollback (compensation, cleanup, backfill).
- **Provide operation scripts where necessary** (rollback/remediation scripts), and state their execution preconditions and verification method.

### B11. Design review
- After the initial design, **re-inspect the modules and code involved** to confirm:
  - Goal alignment: against the requirements document's "Background & Goals", check whether this design serves the goals; designs that deviate must be adjusted or explicitly justified.
  - Design reasonableness: does it match the existing architecture and avoid over-engineering?
  - Actionability: change scope is controllable, no hidden dependencies, no missing key details.
- Write the review conclusion (confirmed/rejected design points + rationale) as a "Design review" section inside `technical-design.md` — **do not create a separate document**.

> **Unified output**: all of the design stage's outputs (B1 code survey, B3 architecture, B5 detail, B6 data/interface, B7 test design, B8 debugging guide, B9 release checklist, B10 canary/rollback, B11 design review) **go into this single `technical-design.md`** — no more separate documents. **For L2 the design may be minimal or even omitted** (when the change is self-evident with no design trade-offs).

---

## Part C — Stage Boundary: Batch Approval

- Merge the **full set of pending decisions** from Parts A and B into one list, numbered, each with **background + candidate options + recommendation + rationale**, so the human can make multiple-choice decisions.
- Present them all at once, marking which are **blockers** (must decide first, e.g. undefined scope) and which can be **deferred** (don't block continuing).
- **High-risk guardrail**: if the requirement scope is highly uncertain or the requirement is large, treat "scope" as a **critical blocker and stop early to confirm** before investing in design — to avoid large rework after designing on an ambiguous requirement. When the requirement is clear, by default run all the way to this boundary.
- Make questions contextual and specific; don't make the human guess what you're asking.
- After the human decides in one batch, write decisions back into `requirements.md` / `technical-design.md` and record them in `review.md`; after correcting the remaining pending decisions, proceed to stage 2.
- **L2 may weaken this step**: when the change is harmless and decision authority is clear, give the user a one-line note and proceed to implementation without forcing a pending-decisions list.

## Cautions
- **Set the change level first**: the level governs how much to invest (document detail, test depth, review rigor, whether canary/rollback is needed, number of human checkpoints). Don't wrap a harmless small change in a heavy process, and don't cut corners on a core change.
- The requirements document is the design's input; **don't start design before it's clear**.
- **Background & Goals are the driving force**; the design should revolve around them and not drift — just check this during the design review.
- **Requirements describe only the business/user view**; data & interface impact belongs in the design document (B6).
- Key code/file references must be **locatable** (path + line/symbol); don't paste large source excerpts.
- Deliverables live in the single `technical-design.md`; no more separate files, so implementation can consult one place.
- Acceptance criteria must be **verifiable** ("the user can do X", not "the system should be somewhat better at X").
- Key technology research and architecture comparison are **mandatory fields** (write "N/A" with reasons when there are no new dependencies / no architecture divergence); they cannot be omitted wholesale.
- e2e/unit-test design is completed at the design stage and executed during implementation — not back-filled after implementation.
- No production code in the design stage, but **spikes are allowed**: for uncertain selections, write throwaway verification code to confirm feasibility; record results in `review.md`; spike code is not merged into the deliverable.
- **Don't clarify in a back-and-forth chat**: the agent first completes everything it can verify/infer, produces a complete draft, and asks the remaining questions all at once — avoid piecemeal interruptions of the user.
