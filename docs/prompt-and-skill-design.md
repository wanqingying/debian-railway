# Prompt and Skill Design Guidelines

Prompts and skills are both instructional documents written for agents. They share common design principles: **clarity over comprehensiveness, rules over explanation, and action-driven content**. This guide covers both.

## Shared Principles

### 1. Verifiable rules, not aspirational prose

A rule is only useful if you can tell whether it worked. Test it:
- "Be clear" is not a rule; "Explain the root cause in one sentence, not vague language" is.
- "Avoid `sleep` loops" is aspirational. "Replace `sleep N; command` with `timeout 900 command --watch` or background the wait" is testable.
- Measured data: across 220 sessions and 27k shell calls, foreground `sleep ≥60s` blocked 25.7 hours of wall time despite the rule existing for a month. Rules adopted at **~2.9%** without structural enforcement.

**Implication:** A rule you cannot measure adoption for should not be in the document. Either make it testable or delete it.

### 2. One action per rule

Don't explain *why* the action works—that belongs in a detailed reference guide, not the prompt or skill.

- ❌ "Background long scripts because foreground calls block the session and prevent observability of progress."
- ✅ "Background scripts >~10s: `shell` tool with `background: true` returns a shell ID and delivers a `<shell id=… state="completed">` completion event mid-turn."

**Implication:** Separate mechanism explanation from the rule. Move long reasoning to `docs/` files that the prompt can reference.

### 3. Global prompt stays lean; detail goes to `docs/`

Measured result (commit `0ec813f`): moving Lark tool details from the global prompt to `docs/lark-cli.md` did not reduce adoption. The prompt only needs: "the tool exists, it's authorized, go read this file for commands."

- Global prompt: ~100 lines (roughly 1,000 tokens); over that, rules stop being scanned.
- Detailed reference: `docs/<tool>.md` with commands, pitfalls, error messages, credentials, troubleshooting.

**Implication:** Keep the global prompt under 120 lines. Use links to `docs/` for everything that is not a rule you apply every session.

### 4. Specificity over generality

Use language and examples from the agent's actual environment:

- ❌ "Handle errors gracefully."
- ✅ "If a git command fails, run `git status` and `git log -1 --oneline` to show what changed; if a network call fails, show the HTTP status and response body."

For prompts: name the specific tools, files, paths, environment variables. For skills: name the exact output format, filenames, API fields.

### 5. Rules are assets that evolve

- Every time a model violates a rule, document *why* it happened (misplaced rule, ambiguous wording, triggering condition not met).
- Add a note to the document explaining the trap.
- If adoption is still <10% after a fix, delete the rule—it is noise.
- Archive rules that nobody encounters anymore.

---

## Prompt Design (AGENTS.md)

### Structure

A global prompt is loaded at the start of every session and defines:
- Coding style and quality gates (goal-driven execution, surgical changes, verification).
- Environment facts (worktree paths, cgroup resource quotas, installed tools, secret locations).
- Rule routing (when to use which tool, which skill, which document).
- Guardrails (what not to do; what requires explicit user confirmation).

### Writing a Rule

**Format:**
1. **Title:** one action or constraint (verb-first, imperative).
2. **Rule:** 1–3 sentences, testable, specific to your environment.
3. **Example (if needed):** ❌ / ✅ pair showing what not to do and what to do.
4. **Reference:** link to `docs/` if the rule needs more explanation.

**Length:** Each rule ≤ 4 lines in the rendered document; if longer, pull the detail into `docs/`.

**Checklist:**
- [ ] Can you measure whether the rule was followed?
- [ ] Does it name specific files, tools, or paths instead of generic terms?
- [ ] Would a senior engineer looking at logs be able to verify it?
- [ ] Is there a shorter way to phrase it?

### Rules That Work

Measured over 220 sessions:

| Rule | Adoption | Notes |
|---|---|---|
| Background long scripts (`background: true`) | ~2.9% | Existed for 1 month in 30-line section; measurement prompted redesign. Better enforcement: link to tool docs (which already describe it); top-level routing in prompt. |
| Never `cp AGENTS.md <global-location>` | 100% after prevention added | Prevention (warning in the repo file) worked where instruction alone did not. Lesson: structural enforcement > rules. |
| Foreground `sleep` ≥60s instead of polling | ~2% despite clear rule | 600 calls, 25.7 hours blocked in 220 sessions. Lesson: aspiration without alternative (e.g., `--watch` flag) is ignored. |
| Use `codegraph` before analyzing | ~80% (high when nearby skill exists) | Paired with a concrete routing rule ("code analysis → use codegraph") adoption rose to ~80%; named tool repo (`codegraph sync`) helped. |
| Worktrees on `/workspace/worktrees`, not `/tmp` | ~95% | Structural enforcement: wrapper script (`wt` refusing out-of-scope paths). |

**Pattern:** Direct guidance + named alternative + named tool that automates it = higher adoption.

### Common Pitfalls

1. **Buried important rules in prose.** "Never do X" is more likely to be followed if it's its own numbered rule with a title, not paragraph 3 of a wall of text.
2. **Generic verbs as triggers.** "Improve code quality" applies to any code fix; "Run linters and tests before pushing" is actionable. Without specificity, rules compete for the agent's attention.
3. **Explaining why instead of what.** "Because Y limits Z" is trivia; "Do X" is actionable. Save the reasoning for the linked reference doc.
4. **Rules that require memorization.** "Remember to check the environment before running long tasks" → Replace with a rule that structures it: "Every task >~10s goes to `background: true`; the tool returns a shell ID."
5. **Forgetting to measure.** If you never measure adoption, you won't know which rules are cargo cult.

---

## Skill Design (SKILL.md, references/)

### What Goes in a Skill

A skill packages a **repeatable workflow** that agents often get wrong, paired with **traps and conventions** specific to your domain. Skills work best for:

- Multi-step task flows (example: "code review with context from the codebase and a style guide").
- Traps that are counter-intuitive or environment-specific (example: "this repo's monorepo layout breaks the usual import pattern").
- Conventions that vary between repos (example: "this team's naming style for branches, commits, PRs").

Skills don't work for:
- One-off facts or a single decision (put that in `docs/` or the global prompt).
- Rules that require enforcement (a skill's instructions can be ignored; use CI hooks or wrapper scripts instead).
- Perfect information that the model already has (a skill can't override what it learned from the training data or from reading the code).

### Structure: SKILL.md + references/

**`SKILL.md` (the visible part):**
- `description` (1–3 sentences, under 1024 characters): when to use this skill. Trigger conditions, not content summary. Use the agent's language and jargon.
- **Workflow** (≤500 lines, ~5,000 tokens): key steps, traps, defaults, constraints. What changes between task instances? Highlight it. What's always the same? Move to a reference.
- **Example** (optional): a real task and the steps taken.

**`references/` (the detailed part):**
- One file per category or sub-topic (example: `references/git-conventions.md`, `references/code-review-checklist.md`).
- Pull exact commands, error messages, edge cases, fallback procedures here.
- Each file starts with "Read this when…" so the agent knows when it's relevant.

**Total skill size:** SKILL.md + all references ≤ ~50 KB (a bound that keeps context usage predictable).

### Writing the `description`

The description determines whether the skill is called at all. Measured on multiple agent platforms: without a strong description, **recall is 20–50%** even on tasks where the skill applies.

**Do:**
- Write **triggering conditions** ("when X happens" / "if you encounter Y" / "before submitting a Z").
- Use the user's actual language (code review patterns, error messages, repo structure names).
- Include domain-specific anchors (file extensions, artifact names, internal tool names) that won't compete with other skills.
- Keep it **short**: 1–3 sentences; 1–3 clauses per sentence.
- Be grammatically active and declarative: "Use this skill to…" "Call this when…" not "For situations where…"

**Don't:**
- Summarize the workflow. ("This skill teaches you how to do code review.") The user won't see the workflow before the decision, so that detail doesn't help.
- Use generic verbs: "analyze," "evaluate," "improve." Use your domain's specific terms.
- Compete with neighboring skills. Name the boundaries: "This covers API changes; for schema changes, use [other-skill]."

**Example (good):**
```
description: Use this skill when reviewing a pull request where the diff touches business logic, database schemas, API contracts, or infrastructure code. Call it after reading the PR description but before approving or requesting changes.
```

**Example (weak):**
```
description: Learn best practices for code review and improve your feedback on pull requests.
```

### Writing SKILL.md (Workflow)

**Start with traps, not theory.**

Order by fragility (what breaks silently vs. what fails noisily):
1. Assumptions that are often wrong (example: "this repo's CI always passes on the first run" — it doesn't; there are known flakes).
2. Conventions that vary (example: "branch naming: feat/, fix/, docs/ prefixes").
3. Standard steps that work every time (example: "read the PR description, skim the diff, check the CI status").

**Use defaults, not menus.**

One recommended path + exceptions. Don't list all ways a thing *could* be done:
- ✅ "Run `gh pr checks <n> --watch` to wait for CI; if it doesn't have a `--watch` flag, use `timeout 900 gh pr checks <n>`."
- ❌ "You can check CI by running: 1) `gh pr checks`, 2) `gh pr view <n> --web`, 3) polling the GitHub API, or 4) checking the web UI."

**Teach the method, not the answer.**

Write rules that generalize to the whole class of tasks, not just this one instance:
- ✅ "Rename all references to a symbol: use `codegraph` to find them, then `grep -r` to verify, then replace."
- ❌ "In this PR, change `AuthService.login()` to `AuthService.authenticate()` in 12 files: …"

**Constraint by consequences.**

Explain *why* a rule exists so the model can generalize to cases you didn't mention:
- ✅ "Don't push to `main` directly; PRs are required because they trigger CI and allow peer review. Open a PR for any change, even docs."
- ❌ "MUST NOT push to main. Use feature branches only."

**Delete test: if the skill still makes sense without this sentence, delete it.** Many sentences are context-setting that a smart agent can infer from the code.

### Example Skill Structure

```
# SKILL.md

**Description:**
Use this skill when reviewing a pull request that modifies application code, 
business logic, or infrastructure. Read this before approving changes or 
requesting revisions.

## Workflow

### Before you start

1. **Repo context:** Does this repo have a code-review `SKILL.md` or `REVIEW.md`? 
   Read it first; its rules override this one.
2. **PR scope:** Read the PR description. Limit your review to that scope; 
   don't demand unrelated improvements.

### Traps

- **Flaky CI:** This repo's main branch sometimes fails CI on the first push. 
  If CI shows a network timeout or `ECONNREFUSED`, wait 5 min and re-run; 
  don't blame the PR author.
- **Stale branch:** The PR branch may be weeks old. Run `codegraph sync` on 
  your local checkout to pick up recent refactors, or context-search the 
  session history for "why did we rename X?"

### Steps

1. **Skim the diff** (≤1000 lines is fast; >3000 lines, ask the author to split).
   Mark anything suspicious.

2. **Read the code in context.** Use `codegraph_explore` or `grep` to see how 
   each changed symbol is used. Suspicious = calling it wrong or breaking 
   the contract.

3. **Check CI.** Run `timeout 900 gh pr checks <PR#> --watch`. If it fails, 
   read the logs. If it's a real bug the PR author can fix, tell them how. 
   If it's flaky (see Traps above), re-run.

4. **Decide.** Approve with no changes, request specific revisions, or ask 
   for clarification. Link to the code line when requesting changes.

## References

- See `references/code-review-checklist.md` for domain-specific checks 
  (e.g., performance, security, schema changes).
- See `references/style-guide.md` for this repo's naming and structure conventions.
```

### Verification

**Baseline first:** Measure the model's error rate *without* the skill. What specifically does it get wrong? (Example: it approves PRs with failing CI, or it rewrites code it shouldn't touch.)

**Test in two dimensions:**
1. **Triggering:** Will the model call this skill when it should?
   - Write 3–5 real user prompts where this skill applies.
   - Write 3–5 near-miss prompts (similar domain, but a different skill or no skill).
   - Did the model call this one and not others?

2. **Execution:** Once called, does it follow the workflow correctly?
   - Point-name the skill (`use the code-review skill now`).
   - Run the same task 3–5 times; read the execution path, not just the output.
   - Did it hit the traps? Did it take the recommended path?

**Compare to baseline:** Same task 3–5 times, with and without the skill, on a clean context each time. Does the skill improve the metric? (Fewer wrong decisions, faster, more complete?)

**If you change the `description` or add a trap, re-test triggering and the adjusted execution.**

### Maintenance

- **Who owns this?** Assign a person; during model updates, they re-run the eval.
- **Measure adoption:** If the skill is never called in real sessions, or if the model calls it but ignores 50%+ of the workflow, redesign or delete it.
- **Archive stale rules:** If nobody encounters a trap anymore (because the repo's tooling changed), remove that paragraph.

### Safety and Practices

- **Treat third-party skills as external code:** Read every file before installing. The workflow text can contain adversarial instructions.
- **Minimal permissions.** If the skill hands the model a token or credential, that's a red flag. Exception: if the tool already handles auth (like `gh` or `lark-cli`), reference the tool's permissions, don't repeat them.
- **Persist data on the volume** (`/workspace/…`), not in the skill directory. Skill directories get overwritten on deploy.
- **License and preamble:** If vendoring a third-party skill, keep the LICENSE file. Adaptations go in a preamble at the top of SKILL.md, not inline comments.

---

## Checklist: When to Refine a Prompt or Skill

- [ ] Measured adoption or execution correctness.
- [ ] Deleted rules where adoption <10% or unachievable without enforcement.
- [ ] Every rule is specific to your environment (names paths, tools, files, not generic verbs).
- [ ] Moved detail to `docs/` if the prompt/skill exceeds its size budget.
- [ ] Tested triggering (for skills) or scanning (for prompts) with real user language.
- [ ] Archived traps or conventions that no longer apply.
- [ ] Assigned owner and re-test plan after model updates.

---

## References and Data

- **Shared principle sources:** [agentskills.io](https://agentskills.io/skill-creation/best-practices), [Anthropic skill authoring](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices), [OpenCode skills](https://opencode.ai/docs/skills/)
- **Prompt structure:** [Vercel agents.md beats skills](https://vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals), [HN discussion](https://news.ycombinator.com/item?id=46809708)
- **Adoption barriers:** [Triggering; UiPath measurement](https://www.reddit.com/r/claudeskills/comments/1waq4j9/), [Sam McLeod pitfalls](https://smcleod.net/2026/07/writing-and-reviewing-agent-skills-common-pitfalls)
- **Skill effectiveness:** [SkillsBench (human-sourced +16.6 pp)](https://arxiv.org/abs/2602.12670), [SkillAxe (LLM-written 0 improvement)](https://arxiv.org/abs/2606.10546)
- **This project's data:** debian-railway 220 sessions, 27k shell calls, 2.9% background adoption on a long rule in a 30-line section → redesigned to 5 lines with routing → under active measurement.
