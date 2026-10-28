# Agent control plane — documents

Everything about the control plane (the "digital employee" that manages OpenCode work) lives in this
directory. One canonical design, one focused review, one input draft, one archived draft.

| File | Status | What it is |
| --- | --- | --- |
| [`design.md`](./design.md) | **canonical** | The design: jobs, state machine, one agent per job, artifact acceptance, permissions, worktrees, events and reconciliation, channels, capability and tool surface, experience base, delegation. Read this first. |
| [`recall-and-runtime-introspection.md`](./recall-and-runtime-introspection.md) | decided | Review of `self-tools.md`: which parts belong in the control plane, which in this container, which to drop, and the five rules that matter more than the tools. Realises `design.md` §18. |
| [`self-tools.md`](./self-tools.md) | input draft | The `self_sessions` / `self_session_get` / `self_config` design for introspecting this container's own sessions and configuration. Not the design of the control plane; see the review above for what survives. |
| [`history/agentd-design-2026-10-26.md`](./history/agentd-design-2026-10-26.md) | archived | The first draft, written while the code lived in `joops/feishu-bot`. Superseded by `design.md`; kept only for the record. |

## Reading order

1. `design.md` §1–§3 — what this is, the decisions at a glance, and what prior art we looked at (including
   which of its mechanisms were compensations for weak models and which are accountability).
2. `design.md` §5–§10 — jobs, data model, the one-agent contract, permissions, worktrees, events.
3. `design.md` §16–§19 — capability model and tool surface, experience base, recall, delegation.
4. `research` and `self-tools.md` only when you are changing one of those areas.

## Conventions

- This directory is the only place design documents for the control plane live. Code and skills stay in the
  repository that runs them (`joops/feishu-bot` and `.agents/skills/`), because they are runtime assets.
- The design is a contract: when code and document disagree, one of them is a bug — fix the document in the
  same change as the code.
- Unverified API behaviour is listed in `design.md` §20. Do not state a conclusion that section has not
  settled.
