---
name: req-to-ship-en
description: 'End-to-end requirement development, from clarification to release. Use when the user proposes a feature or requirement task ("build a feature", "change a requirement", "implement X", "develop Y"), hands one over as a requirement ticket, Issue, or requirement description, or has a clear requirement but is not sure where to start. Not needed for a one-line bug fix, copy change, or pure refactor with no requirement change.'
---

# ReQ-to-Ship — End-to-End Requirement Development

Branching, commits, pushes, the PR and merging follow the project's own git conventions (its contribution or agent workflow docs, if any); this skill applies those rules and adds the requirement-development flow on top, rather than redefining them.

This skill guides a **complete requirement development delivery**. It positions itself as **human-agent collaboration**: the agent works like a senior engineering partner — proactively driving the workflow and writing code — while collecting decision points in batches for the human to approve at once. It emphasizes **batch collaboration** — the agent first finishes everything it can do on its own; the human only makes the high-value decisions that only a human can make, and ideally processes them in a single batch.

> Iron rule: **decision authority lies with the human**. Decisions about scope, technology selection, destructive operations, and releases must be made by the human; the agent executes, advises, and records — it never decides in the human's place. But the agent does not idle waiting on open decisions — it continues with the recommended approach and waits for the human to decide in a batch.

## Human-Agent Collaboration (core principle of this skill)

### Core mode: batch collaboration, not step-by-step confirmation

**Humans do not watch the AI work continuously; they may step away for a while.** So the default mode is: **the agent drives autonomously, collects the decision points that must go to the human into a "pending-decisions list", and presents them to the human in one batch at stage boundaries**. Do not stop for confirmation at every step — that is inefficient.

- **Within a stage**: the agent autonomously completes all work it can in that stage (research, drafts, designs, implementation). When it hits a "must-ask-human" decision point, it does not block progress — it continues with the **recommended approach** while adding the decision to the pending-decisions list, including options, recommendation, and rationale. Continuing covers only work that stays reversible until review; a destructive operation, a release, a write to live data, or spend beyond routine verification waits for the human's decision.
- **At stage boundaries**: package all pending decision points of the stage and present them to the human at once (options + recommendation + rationale). The human approves them in one batch; the agent corrects or continues based on the decisions.
- **Don't stop just because the human hasn't returned**: as long as pending decisions don't block downstream work, keep pushing forward; only **critical blockers** (e.g., undefined scope, directional choices affecting all downstream work) truly warrant stopping and waiting.
- If the task is simple (the user just said "go ahead"), be more autonomous: complete more stages before presenting one consolidated confirmation.

### Decision tiers: what must ask the human, what to drive autonomously, what to proactively report

| Tier | Situation | Examples | Agent behavior |
|------|-----------|----------|----------------|
| **Must ask human** | Decision authority is with the human; the agent must not decide unilaterally | Requirement scope, product behavior, technology selection, destructive operations, release/publish, changes touching permissions/data/cost | Add to pending-decisions list, present in batch at stage boundary with "options + recommendation + rationale"; wait for the human to decide |
| **Drive autonomously** | Execution detail; decision authority is with the agent | Implementation details, naming, error handling, test-case wording, document formatting | Decide autonomously; **note the decision and rationale for the record** (see Documentation) |
| **Proactively report** | No decision needed, but the human needs to know | Completing a logical unit, test results, progress changes, discovered risks | Report proactively (can batch: summarize at stage end) |

### How to present pending decisions in a batch (save the human time)
- List pending decisions **numbered**: each contains **background + candidate options + recommended option + rationale**, so the human can make a multiple-choice decision.
- Present them all at once, marking which are **blockers** (must decide first) and which can be **deferred** (don't block continuing).
- Make questions contextual and specific; don't make the human guess what you're asking.

### Points where the human needs to act (the agent proactively prompts; don't silently skip)
- **Stage 1 boundary**: one batch approval — scope/priority + technology selection + sign-off on key research conclusions.
- **Stage 3 boundary**: review sign-off — especially UX / product-behavior changes.
- **Stage 4**: local integration testing — when real environments/accounts/manual verification are needed, explicitly ask the user to run them and provide the steps.
- **Merge**: the agent opens the PR ready for review when the work is done; merging waits for the user's explicit LGTM.
- **The number of human checkpoints scales with level**: L0 keeps multiple key checkpoints (scope, selection, release/rollback decisions for core risky changes); L2 consolidates into one or none.

## Change Level & Process Depth (L0/L1/L2)

**Determine the level first — it sets the rigor of everything that follows**: test depth, review depth, rollback planning, and human checkpoints. It does not decide how much to write down; **Documentation** below does. Do a preliminary assessment from the requirement, then **confirm or revise** it during the design stage based on the actual change scope and impact (a small-sounding requirement that turns out large is normal); when in doubt, use the **higher (more cautious) level**. Record the level and its rationale. The lower the level, the more you should trim the process — don't wrap a harmless change in a heavyweight process.

| Level | Definition | Typical signals | Process depth |
|-------|------------|-----------------|---------------|
| **L0** | Large-scope / low-level framework / core change | Cross-module, cross-service, multi-system; low-level framework, architecture, or core-abstraction changes; data-model or DB-schema migration, data migration; core agent/engine/protocol; large blast radius, hard to roll back; broadly touches data/permissions/cost | Strengthened: requirements and design worked out in full; core-flow unit+e2e coverage required; three-dimension review (parallel subagents allowed); canary/rollback plan **required**; keep multiple human confirmation points |
| **L1** | New feature / feature enhancement | A new user-visible feature or a meaningful enhancement; a new interface/UI flow; touches several files but with clear boundaries and reversible; no data-model migration, no core-framework change | The four stages, trimmed as needed; tests covering the core paths; standard three-dimension review; canary/rollback **as needed** (required when it hits a core risky change) |
| **L2** | Small / contained change | A fix or a change of up to a few hundred lines within one feature: bug fix, copy, style/layout tweak, config value, prompt wording, an additive enum or vocabulary value, dependency patch bump; no schema change, no breaking contract change; reversible by revert | The L2 fast path below; targeted tests plus the verification that proves the change (before/after when output, behavior, or cost moves); lightweight review; canary/rollback usually **not needed** |

**How to decide** (go through each):
1. **Blast radius**: how many modules/services/systems? Does it cross boundaries?
2. **Contracts & data structures**: does it change the data model, DB schema, or external interface contracts?
3. **Low-level**: does it touch the framework, architecture, core abstractions, or core engine?
4. **Reversibility**: can it be rolled back quickly and losslessly if something goes wrong?
5. **Risk domain**: does it involve data integrity, permissions, security, or cost?

Hitting items 2/3/5 with a large blast radius → L0; a new feature with clear boundaries → L1; a fix or contained tuning (copy, style, config, prompt, an additive value) → L2. Whatever the size, a change to permissions or access control, security controls, customer billing, or writes that could lose or corrupt data is at least L1. A model-cost or output-quality effect on its own raises the evidence you owe (before/after), not the level. Test coverage, review depth, canary/rollback needs, and the number of human checkpoints all scale with the level.

### L2 fast path

L2 need not run the full four stages; use the lightweight flow: **understand the requirement and impact (quick codegraph check) → implement → targeted tests plus the verification that proves the change → PR ready for review, with that evidence in its description**. Skip the multi-round batch boundaries (a must-ask decision still goes to the human); if the change turns out to touch unforeseen contracts / low-level code / risk domains, **immediately escalate the level** and do the corresponding work. Still keep the two iron rules — never push or merge beyond what the project's git conventions authorize, and decision authority stays with the human — and make sure the worktree is indexed before you rely on codegraph (see Tool Quick Reference).

## Global Principles (apply to all stages)

1. **Start code analysis with codegraph, finish it with the source.** `codegraph_explore` is the first call for orientation — call chains, symbols, module logic — but an explore answer is a *starting set*, not the whole picture: on a flow that crosses package or language boundaries it typically returns only one side unless you name the files. Confirm writers and callers with `rg` before you list the modules a change touches, and read a file before you edit it. The Tool Quick Reference has the two query habits that raise recall.
2. **Make sure the worktree is indexed.** The index is per directory: a fresh worktree has no `.codegraph/` until you run `codegraph init --yes` there once. After that the file watcher syncs on every save and the server reconciles on connect, so there is no sync step to remember — branch switches, rebases and pulls are picked up as file changes.
3. **Don't assume; don't hide confusion**: when something is ambiguous, don't decide for the user — items in the "must ask human" tier go into the pending-decisions list (handled via batch collaboration), everything else proceeds autonomously with the recommendation recorded; don't silently guess.
4. **Size the record to the change**: the PR description by default, an iteration only for genuinely large work (see Documentation).
5. **Never push or merge beyond what the project's git conventions authorize.** An implementation request covers commits, pushes, and a PR ready for review; merging needs the user's explicit LGTM.
6. **Batch reporting**: when a stage is done (or before the user steps away), package progress + pending decisions into one summary; don't disturb the user piecemeal; the human processes them in one pass when back.

## Documentation (sized to the change)

The level sets rigor; this section sets what gets written down. The default is
**no new document**: the PR description and the commit log are the record. Write
an iteration only when a later session would otherwise lose something
non-obvious — a decision and its *why*, a gotcha, an invariant, a contract.

- **Default: the PR description is the record.** Fixes and changes of up to a few hundred lines, including prompt, config, cost, and additive-vocabulary changes, get no iteration directory. Beyond what the project's git conventions ask a PR to describe, the description carries the evidence, the verification (the commands and their results; before/after tables when output, behavior, or cost moves), the decisions with their rationale, and residual risks, so a reviewer needs nothing from the conversation.
- **The commit log is the implementation record.** There is no implementation-tracking document. Implement one commit per logical step, each with a semantic message (per the project's git conventions), so `git log` and `git blame` carry what was done and when; the iteration record cites the commit range once, not a per-step SHA table.
- **Iteration docs only for genuinely large work**: a schema change or migration, a cross-module or cross-service change, a new product surface, a new or breaking external contract, or a hard-to-reverse change. When a change is borderline — small but on this list, or large but not on it — ask the user before writing them. When it applies it is **two files, not four**:
  - `design.md` — **requirements and technical design in one document**;
  - `README.md` — the **iteration record**: what changed and why, the decisions with their rationale, the review conclusion, follow-ups, and status.
- **Non-obvious knowledge is captured where it can be retrieved.** A debugging recipe, a root cause worth remembering, or a decision and its *why* goes into the repo's docs (an `ops/` guide, the iteration record, or a decisions log), not only the PR description — a later session reads the repo, not the PR thread.
- **Follow the project's docs conventions** for any new document under `docs/` — location, naming, and frontmatter/metadata if the project uses it — so it can be found and filtered later; if the project has none, a title and date are enough.
- **Durable follow-ups** (findings the change does not fix) go to the feature README's **Follow-ups** list, a line or two each — there is no separate tracking file. If the feature has no README, put them in the PR description.
- **Smell test, not a budget**: unless the work is L0, repo doc lines should not outnumber the code lines they describe (prompts and shipped skills count as code). If they would, move the content into the PR description.
- **No unrelated doc hygiene.** Update what your change makes stale and put a lasting constraint's why next to the code (a comment, or the project's coding-style doc); leave everything else for its own PR.

When the work does get an iteration, commit it with the code. Read the feature README and its latest iteration first, and don't invent other locations or names:

```
docs/<feature>/
├── README.md                 # feature entry: what it is, a link to iterations/, the Follow-ups list
├── user-guide.md             # optional, shared across iterations
├── ops/                      # optional durable guides (runbook, debug guide)
└── iterations/NN-<slug>/     # 00-initial, then one incrementing directory per large change
    ├── design.md             # requirements + technical design (incl. test design, release/rollback when needed)
    └── README.md             # iteration record: what/why, decisions, review conclusion, follow-ups, status
```

## Stage Overview and Flow

**Core loop**: review finds issues → return to stage 2 to fix; if the problem originates in the requirements/design itself → **rolling back** to stage 1 to correct is allowed, then continue. Rolling back is not a failure; it's the normal rhythm of human development. **Pacing**: the agent drives autonomously + decisions confirmed in batches; no step-by-step pauses.

| Stage | Action | Deliverables | Human involvement (batch) | Enter next stage |
|-------|--------|--------------|---------------------------|------------------|
| 1. Requirement clarification & technical design | Understand the requirement and refine it against existing code; do architecture + detail design, research key dependencies, review the design | Agreed scope, design, and test plan (`design.md` only when the work gets an iteration) | One batch approval at boundary: scope/priority + selection + key research conclusions | After pending decisions are confirmed in a batch |
| 2. Code changes | Create requirement branch, confirm git state, implement code (autonomous + record decisions) | Code + tests | Key blocking decisions; implementation highlights can be summarized in a batch | Code review determines completion |
| 3. Code review | Three-dimension review: spec+function / architecture / impact | Findings fixed; conclusions in the record | Batch sign-off: review conclusions, UX/product-behavior changes | Review passes; otherwise back to 2/1 |
| 4. Self-test & integration & delivery | Sync + test + integrate, deliver for review | Checks pass; PR ready for review, evidence in its description | Local integration (give steps); LGTM | Merge after the user's explicit LGTM |

Each stage's **depth scales with the change level (L0/L1/L2)** — see "Change Level & Process Depth" above for the criteria and the level-to-flow mapping.

## Stage Entry Points

Each stage has its own document with detail, templates, and cautions — read it when entering that stage:

- **Stage 1 Requirement clarification & technical design** → read `references/01-requirements-and-design.md`
- **Stage 2 Code changes** → read `references/02-code-changes.md`
- **Stage 3 Code review** → read `references/03-code-review.md`
- **Stage 4 Self-test & integration & delivery** → read `references/04-test-and-delivery.md`

## Tool Quick Reference

### codegraph (code analysis)

```bash
codegraph status                                      # is THIS worktree indexed? (the index is per directory)
codegraph init --yes                                  # once per worktree that has no .codegraph/; the watcher syncs after that
codegraph explore "<question, or symbol/file names>"  # same output as the codegraph_explore MCP tool
codegraph callers <symbol> -l 500                     # the default caps at 20 results and does not say when it truncates
```

- **Orient with a question, pin with names.** A natural-language query ranks by keyword and pads the answer with check scripts; naming the files or symbols you care about pins them into the answer, and is how the far side of a cross-package flow shows up at all.
- **An explore answer is a starting set.** Confirm writers and callers with `rg` before they go into a design, and read the file before you edit it. Its blast-radius counts undercount anything reached through a namespace (e.g. `namespace.member`), so never quote them as impact.
- **CLI not installed?** The router's tool-fallback rule applies (`rg`, file reads) — say so in the record, and never claim a codegraph survey you did not run.

### Finding project knowledge (docs)

Before designing, find what already exists instead of re-deriving it:

```bash
cat docs/index.md                 # docs area map/index, if the project keeps one
rg -n "<term>" docs/              # keyword search across the whole corpus (fast, exact)
```

- Locate the area from the docs index (if any), then read the feature `README.md`, its latest iteration, and any `ops/` guide. Prior decisions may sit in a decisions log.
- **Semantic search is optional.** If `qmd` is on PATH, `qmd query --no-rerank "<question>"` answers a natural-language question over the docs. If `qmd` is **not** installed, print a one-line note that semantic search is unavailable and continue with `rg` — **never block the stage on it**. When it does run, treat documents marked archived or superseded as historical, not current.

## Cautions (frequent pitfalls)

1. **Set the change level (L0/L1/L2) first**: the level determines test depth, review rigor, whether canary/rollback is needed, and the number of human checkpoints. Don't wrap a harmless small change in a heavy process, and don't cut corners on a core change; when a requirement looks small but the change is large, use the higher level.
2. **Don't write production code in stage 1**. Starting before requirements are clarified and the design reviewed makes rework extremely likely (spikes are allowed).
3. **Code review cannot grade itself** — during review, first read requirements + design, inspect changes with git, evaluate independently; use subagents for parallel review if needed (see stage 3 doc).
4. **Decide the tests at the design stage** (stage 1 B7); write them during implementation, not after.
5. **Don't silently expand scope**: if implementation uncovers new issues not covered by the design, first record them and report/ask the user — don't quietly add implementation.

## Fallback Principles

- When the user says "just a simple change / skip the process / too complex", or the task is clearly trivial (copy change, fixing a single bug, single-file small change), treat it as **L2** (the fast path) unless the at-least-L1 floor in "How to decide" applies, but **keep the two iron rules: no push or merge beyond what the project's git conventions authorize + decision authority with the human**.
- If stuck in implementation/self-test for three consecutive rounds, stop changing code and re-question assumptions (requirement understanding, the design itself, environment issues); clarify before continuing.