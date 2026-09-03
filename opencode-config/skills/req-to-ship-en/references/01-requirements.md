# Stage 1 — Requirement Clarification & Initialization

**Goal**: refine the user's requirement statement, combined with the existing system's design and code logic, into a **detailed, actionable, unambiguous** requirements document.

**Prerequisite**: first run `codegraph sync` to sync code changes, then use `codegraph_explore` to analyze the existing system.

## Steps

### 1. Understand the requirement
- Read the user's requirement statement in full; don't miss details.
- List the requirement's **goal** (what problem it solves), **scope** (what's in / what's not), and **actors** (who uses it, what triggers it).

### 2. Understand against existing code
- Use `codegraph_explore` to find the relevant modules, call chains, data models, and existing implementations the requirement touches.
- Determine: is this a **new feature**, a **behavior change to existing code**, or a **fix**? Which existing features does it affect?
- If the requirement references existing UI/flows/interfaces, read the corresponding code first to confirm the current state.

### 3. Refine and clarify
- List the ambiguous points, **first autonomously handle what you can**:
  - What can be inferred from existing code/docs: verify it yourself and write it directly into the requirements document.
  - Edge cases (empty data, exceptions, concurrency), non-functional requirements (performance, security, compatibility), interaction details, dependencies — first make reasonable inferences based on the existing system, marked "to be confirmed".
- Decisions involving **scope, priority, product behavior** → per the master-file decision tiers, **must ask the human**: add to the pending-decisions list, present in batch at the stage boundary with "options + recommendation + rationale".
- Implementation-detail ambiguities (how to implement, etc.) → don't get tangled here; record in `review.md` for the design stage.
- Analyze reasonableness: does the requirement conflict with the existing architecture? Is it out of reasonable scope? If so, record it as a pending decision with reasons and submit to the user.

### 4. Produce the requirements document

Write to `requirements.md` in the iteration directory defined by the master file (**document location and naming follow the master file's "Document Directory Structure"; do not redefine the directory here**). Content template:

```markdown
# <Feature> Requirements

## Background & Goals
(why we do this, what problem it solves, success metrics)

## Requirement Description
### Feature List
(each feature: description, priority, acceptance criteria)

### User Flow
(from the user's perspective: entry → action → result, including normal/exception paths)

## Non-Functional Requirements
(performance, security, compatibility, maintainability)

## Boundaries & Constraints
(what we don't do, dependencies, limitations)

## Data & Interface Impact
(data involved, external interfaces, relationship to the existing system)

## Acceptance Criteria
(verifiable checklist: satisfying these means it's done)
```

### 5. Present pending decisions in a batch; confirm once
- At the stage boundary, package **all pending decisions** for the user (each: background + options + recommendation + rationale, marked blocker/deferrable).
- Report the requirements document's key points; the user decides in one batch.
- After the user decides, write the decisions back into `requirements.md` (correct the "to be confirmed" items) and record them in `review.md`.
- If the user's decisions change scope/priority → update the requirements document, then proceed to stage 2; otherwise proceed directly.

## Cautions
- The requirements document is stage 2's input; **don't start design before it's clear**.
- Acceptance criteria must be **verifiable** ("the user can do X", not "the system should be somewhat better at X").
- When the user describes the requirement informally, convert it into a structured document, but keep the user's original wording as an appendix to avoid information loss.
- **Don't clarify in a back-and-forth chat**: the agent first completes everything it can verify/infer, produces a complete draft, and asks the remaining questions all at once — avoid piecemeal interruptions of the user.