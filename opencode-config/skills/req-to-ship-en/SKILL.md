---
name: req-to-ship-en
description: 'End-to-end requirement development guide — from requirement clarification to production release. Use when the user proposes a feature/requirement development task ("build a feature", "change a requirement", "implement X", "develop Y", or when given a task as a requirement ticket, Issue, or requirement description). Covers the complete flow: requirement clarification → technical design → code implementation → code review → self-testing and integration → commit and release, with standalone documents produced at each stage (requirements doc, technical design, review log, progress tracking). Also applies when the requirement is already clear but the user is not sure where to start. Not needed for a one-line bug fix, copy change, or pure refactor with no requirement change.'
---

# ReQ-to-Ship — End-to-End Requirement Development

This skill guides a **complete requirement development delivery**. It positions itself as **human-agent collaboration**: the agent works like a senior engineering partner — proactively driving the workflow, producing documents, and writing code — while collecting decision points in batches for the human to approve at once. It emphasizes **batch collaboration** — the agent first finishes everything it can do on its own; the human only makes the high-value decisions that only a human can make, and ideally processes them in a single batch.

> Iron rule: **decision authority lies with the human**. Decisions about scope, technology selection, destructive operations, and releases must be made by the human; the agent executes, advises, and records — it never decides in the human's place. But the agent does not idle waiting on open decisions — it continues with the recommended approach and waits for the human to decide in a batch.

## Human-Agent Collaboration (core principle of this skill)

### Core mode: batch collaboration, not step-by-step confirmation

**Humans do not watch the AI work continuously; they may step away for a while.** So the default mode is: **the agent drives autonomously, collects the decision points that must go to the human into a "pending-decisions list", and presents them to the human in one batch at stage boundaries**. Do not stop for confirmation at every step — that is inefficient.

- **Within a stage**: the agent autonomously completes all work it can in that stage (research, drafts, designs, implementation). When it hits a "must-ask-human" decision point, it does not block progress — it continues with the **recommended approach** while recording the decision in the pending-decisions list (`review.md` or a temporary list), including options, recommendation, and rationale.
- **At stage boundaries**: package all pending decision points of the stage and present them to the human at once (options + recommendation + rationale). The human approves them in one batch; the agent corrects or continues based on the decisions.
- **Don't stop just because the human hasn't returned**: as long as pending decisions don't block downstream work, keep pushing forward; only **critical blockers** (e.g., undefined scope, directional choices affecting all downstream work) truly warrant stopping and waiting.
- If the task is simple (the user just said "go ahead"), be more autonomous: complete more stages before presenting one consolidated confirmation.

### Decision tiers: what must ask the human, what to drive autonomously, what to proactively report

| Tier | Situation | Examples | Agent behavior |
|------|-----------|----------|----------------|
| **Must ask human** | Decision authority is with the human; the agent must not decide unilaterally | Requirement scope, product behavior, technology selection, destructive operations, release/publish, changes touching permissions/data/cost | Add to pending-decisions list, present in batch at stage boundary with "options + recommendation + rationale"; wait for the human to decide |
| **Drive autonomously** | Execution detail; decision authority is with the agent | Implementation details, naming, error handling, test-case wording, document formatting | Decide autonomously, **record the decision and rationale in `review.md`** (traceable) |
| **Proactively report** | No decision needed, but the human needs to know | Completing a logical unit, test results, progress changes, discovered risks | Report proactively (can batch: summarize at stage end) |

### How to present pending decisions in a batch (save the human time)
- List pending decisions **numbered**: each contains **background + candidate options + recommended option + rationale**, so the human can make a multiple-choice decision.
- Present them all at once, marking which are **blockers** (must decide first) and which can be **deferred** (don't block continuing).
- Make questions contextual and specific; don't make the human guess what you're asking.

### Points where the human needs to act (the agent proactively prompts; don't silently skip)
- **Stage 1 boundary**: scope and priority decisions.
- **Stage 2 boundary**: technology-selection decisions, sign-off on key research conclusions.
- **Stage 4 boundary**: review sign-off — especially UX / product-behavior changes.
- **Stage 5**: local integration testing — when real environments/accounts/manual verification are needed, explicitly ask the user to run them and provide the steps.
- **Release**: only after the user explicitly expresses intent to "finish/release/publish" does the agent execute commit + push + create MR.

## Global Principles (apply to all stages)

1. **Prefer the codegraph tools for code analysis.** When understanding call chains, searching symbols, or investigating module logic, use `codegraph_explore` (CLI usage below) — don't start by grepping and guessing.
2. **When to run `codegraph sync`**: before starting a requirement, after switching branches, and after syncing remote code, you must first run code-change sync (see below) to keep the index fresh.
3. **Don't assume; don't hide confusion**: when something is ambiguous, stop and ask; don't decide for the user; the decision-tier table governs how to ask.
4. **Keep documents**: every stage's output documents live in the project's `docs/` directory and are committed together with the code, forming a traceable record.
5. **Never push code without explicit user instruction.** Only after the user expresses "finish/release/publish" intent do you perform the final sync + commit + push + create MR.
6. **Batch reporting**: when a stage is done (or before the user steps away), package progress + pending decisions into one summary; don't disturb the user piecemeal; the human processes them in one pass when back.

## Document Directory Structure (global constraint)

Project `docs/` is organized by requirement, with **iterations as the evolution unit**, following the claude-mcp structure. **This is a constraint that all stage reference docs must obey** — any stage's output documents must land at the exact locations and names defined below; do not invent a different structure or custom filenames.

```
docs/<feature>/
├── README.md              # Index: iteration timeline (# | iteration | date | content | status), navigation
├── user-guide.md          # User guide (optional, shared across iterations; user-facing part of the stage-2 integration guide can go here)
├── iterations/
│   ├── 00-initial/        # First requirement iteration (baseline)
│   │   ├── README.md      # This iteration's requirement changes, decisions, status (links to the docs below)
│   │   ├── requirements.md        # Requirements document (stage 1 deliverable)
│   │   ├── technical-design.md    # Technical design document (stage 2 deliverable)
│   │   └── review.md              # Design / code review log (stages 2/4 deliverable)
│   ├── 01-<slug>/         # Subsequent requirement iterations: each requirement change gets a new incrementing directory
│   │   └── README.md      # This iteration's requirement changes, decisions, status (same structure as 00)
│   └── ...
└── ops/                   # Shared documents across iterations
    ├── implementation-tracking.md   # Progress tracking (records each implementation step + commit SHA)
    ├── launch-checklist.md          # Release checklist (stage 2 deliverable, organized by iteration/release batch)
    └── debug-guides.md              # Local/remote integration guide (stage 2 deliverable, used in stage 5)
```

**Iteration cohesion principle**: each iteration directory holds **all** of that iteration's documents (requirements, design, review) and evolves with it; documents shared across iterations go in `ops/`. **Every requirement change opens a new incrementing iteration directory** (`00-initial` is the baseline, then `01-*`, `02-*`…), appended in order to the README timeline so evolution is traceable.

**Location mapping**: stage 1 → `iterations/NN-*/requirements.md`; stage 2 → `iterations/NN-*/technical-design.md` + `review.md` + `ops/launch-checklist.md` + `ops/debug-guides.md`; stage 4 → append to that iteration's `review.md`; stage 5 → update `ops/implementation-tracking.md`. "Current iteration" means the iteration directory the requirements document belongs to.

**Conventions**:
- New iteration: append a row to the `README.md` timeline (iteration number, date, content, status), and create `iterations/NN-<slug>/README.md` (requirement changes, decisions, status).
- `ops/implementation-tracking.md` records "which step landed in which commit" line by line, updated in the same commit as the code (run `git rev-parse HEAD` to record the baseline SHA before committing).
- Stage reference docs only contain **content templates and step detail**; document **locations and names always follow this spec** — reference docs must not redefine the directory structure.

## Stage Overview and Flow

**Core loop**: review finds issues → return to stage 3 to fix; if the problem originates in the requirements/design itself → **rolling back** to stage 1 or 2 to correct is allowed, then continue. Rolling back is not a failure; it's the normal rhythm of human development. **Pacing**: the agent drives autonomously + decisions confirmed in batches; no step-by-step pauses.

| Stage | Action | Deliverables | Human involvement (batch) | Enter next stage |
|-------|--------|--------------|---------------------------|------------------|
| 1. Requirement clarification & initialization | Understand the requirement, refine it against existing code, produce the requirements document | `iterations/NN-*/requirements.md` | Batch decision at boundary: scope/priority/product behavior | After pending decisions are confirmed in a batch |
| 2. Technical design & review | Architecture + detail design, research key dependencies, review the design | `iterations/NN-*/technical-design.md` + `review.md` + `ops/` shared docs | Batch decision at boundary: selection, key research conclusions | After pending decisions are confirmed in a batch |
| 3. Code changes | Create requirement branch, confirm git state, implement code (autonomous + record decisions) | Code + progress-tracking update | Key blocking decisions; implementation highlights can be summarized in a batch | Code review determines completion |
| 4. Code review | Three-dimension review: function/architecture/impact | `review.md` (appended, commit-level) | Batch sign-off: review conclusions, UX/product-behavior changes | Review passes; otherwise back to 3/1/2 |
| 5. Self-test & integration & delivery | Sync + test + integrate, deliver for release | Tests pass, commit+push+MR | Local integration (give steps), release intent | Deliver after user expresses release intent |

## Stage Entry Points

Each stage has its own document with detail, templates, and cautions — read it when entering that stage:

- **Stage 1 Requirement clarification & initialization** → read `references/01-requirements.md`
- **Stage 2 Technical design & review** → read `references/02-technical-design.md`
- **Stage 3 Code changes** → read `references/03-code-changes.md`
- **Stage 4 Code review** → read `references/04-code-review.md`
- **Stage 5 Self-test & integration & delivery** → read `references/05-test-and-delivery.md`

## Tool Quick Reference

### codegraph CLI (code-change sync)

```bash
codegraph sync        # run in the workspace root; syncs code changes into the index
```

### Key checkpoints in the requirement-development flow

- Before stage 1: `codegraph sync`
- After stage 3 creates/switches branches: `codegraph sync`
- After stage 3/5 syncs remote: `codegraph sync`
- Code analysis: `codegraph_explore` tool (syntax-tree call graph; preferred over grep)

## Cautions (frequent pitfalls)

1. **Don't write code in stages 1/2**. Starting before requirements are clarified and the design reviewed makes rework extremely likely.
2. **Code review cannot grade itself** — during review, first read requirements + design, inspect changes with git, evaluate independently; use subagents for parallel review if needed (see stage 4 doc).
3. **Push is a controlled action**: execute the final commit + push + create MR only after the user expresses finish/release/publish intent.
4. **Requirement changes must update progress tracking**: tick off implementation steps in `ops/implementation-tracking.md` one by one and record commit SHAs.
5. **Key research in the design cannot be skipped**: "key technology research" and "architecture comparison" are mandatory fields in the technical design (write "N/A — no new dependency" when there are none, and "none" with reasons when there's no architecture divergence); they cannot be omitted wholesale.
6. **e2e/unit-test design is done at the design stage** (one of stage 2's deliverables); write tests against it during implementation, not after.
7. **Don't silently expand scope**: if implementation uncovers new issues not covered by the design, first record them in `review.md` and report/ask the user — don't quietly add implementation.

## Fallback Principles

- When the user says "just a simple change / skip the process / too complex", or the task is clearly trivial (copy change, fixing a single bug, single-file small change), you may skip or heavily simplify the document flow, but **keep the three iron rules: `codegraph sync` + no unauthorized push + decision authority with the human**.
- If stuck in implementation/self-test for three consecutive rounds, stop changing code and re-question assumptions (requirement understanding, the design itself, environment issues); clarify before continuing.