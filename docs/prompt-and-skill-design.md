# Prompt and Skill Design Guidelines

`AGENTS.md` and `SKILL.md` are the same kind of artefact — natural-language instructions written for an agent — loaded at different times and with different budgets. One design discipline covers both. Every non-obvious rule below carries the source that produced it; numbers in brackets are measured, not estimated.

## 0. Pick the carrier first

| Carrier | Loaded | Use it for |
|---|---|---|
| `AGENTS.md` (global / project) | Every turn, always | Rules that hold for every task, and **routing**: which tool, skill or doc applies |
| Skill (`SKILL.md` + `references/`) | Only when triggered | A class of task the agent often gets wrong, with its traps |
| Tool / plugin / MCP | When the agent calls it | One deterministic action |
| Hook / CI / wrapper script | Automatically | Anything that must hold 100% of the time |

The loading difference is not cosmetic. In Vercel's Next.js 16 eval suite, a skill was **never invoked in 56% of cases**, and a skill available-but-unused scored exactly the baseline (53% → 53%, +0pp); with an explicit instruction to use it, trigger rate rose above 95% and the pass rate to 79%; a **compressed 8 KB docs index inside `AGENTS.md` reached 100%** (40 KB compressed to 8 KB at no loss).

Two conclusions, both counter-intuitive:

1. **Passive context beats on-demand retrieval for horizontal knowledge.** If the agent must decide whether to look something up, it often doesn't. Put the index in `AGENTS.md`; put the detail in files it can then read.
2. **Active retrieval still wins for vertical workflows** — explicitly triggered tasks ("upgrade this", "review this PR"). That is what skills are for.

So: a skill nobody calls is worth nothing, and the fix is a routing line in `AGENTS.md`, not a better-written skill.

## 1. Shared principles

### 1.1 Content must come from real execution

Human-authored skills raise pass rates by **+16.6 pp** across 87 tasks, 8 domains and 18 model–harness configurations (33.9% → 50.5%, +4.1 to +25.7 pp per configuration). LLM-authored skills given only a general prompt show **no measurable gain**. A refinement loop that diagnoses trigger precision and instruction compliance closes 47–67% of that gap, but never by asking a model to imagine a skill from scratch.

Practical form: do the task once with the agent, note every correction you make, then extract the pattern. Or synthesise from artefacts you already have — runbooks, incident reports, review comments, the actual patch history. Never from "best practices for X".

### 1.2 Evals before prose

The first question is not "what should I write" but "what does the agent get wrong without this?" Write the check before the instruction.

- Split success into **outcome** (did the task complete), **process** (did it call the skill and run the intended commands), **style** (conventions), **efficiency** (no thrashing, no token blowup).
- 10–20 prompts is enough to catch regressions. Each row: `id, should_trigger, prompt`.
- **Include negative controls.** A prompt that *should not* trigger the skill is what catches over-eager matching.
- Score the **trace**, not just the output: did it run the command, in that order, how many commands, how many tokens, was `git status --porcelain` clean afterwards.

Without a baseline you cannot tell an improvement from a change in behaviour. That is the whole reason to write evals first.

### 1.3 The delete test

For every sentence: **would the agent get this wrong without it?** If no, cut it. If unsure, test it.

This is the same test in three sources, and it is the single most effective editing rule. Corollaries:

- Don't explain what the agent already knows (what a PDF is, how HTTP works, what a migration does).
- Don't restate a mechanism the tool description already carries.
- Terse beats complete. Agents are not human readers who need motivation.

### 1.4 One rule, one action

A rule the agent can't act on is decoration:

- ❌ "Handle errors appropriately." / "Be thorough."
- ✅ "Every HTTP call gets an explicit timeout — a missing one once hung a run for 464 s."

Prefer the imperative and the concrete noun (file path, flag, command). Long rationale goes one level down, in a reference file.

### 1.5 Progressive disclosure, one level deep

Two budgets, both real:

- **`AGENTS.md`** is in the system prompt every turn. Every line is paid forever.
- **`SKILL.md`** is paid only when loaded — but once loaded it competes with the whole conversation.

Rules that follow:

- `SKILL.md` body under **500 lines** (≈5,000 tokens). Past that, split.
- Reference files must hang **directly off `SKILL.md`**. Nested references get half-read (`head -100`) and the agent proceeds with partial information.
- Say **when** to read a file, not just that it exists: "if the API returns non-200, read `references/api-errors.md`" beats "see `references/`".
- Reference files over ~100 lines get a table of contents at the top, so a partial read still shows the shape.
- **`≤3` focused modules beat a large bundle** — measured across the SkillsBench inventory. One skill with references beats several small siblings that fight for the same trigger.

### 1.6 Defaults over menus, procedures over answers

Give one recommended path plus the escape hatch:

- ✅ "Use `pdfplumber`. For scanned PDFs, `pdf2image` + `pytesseract`."
- ❌ "You can use pypdf, pdfplumber, PyMuPDF, or pdf2image…"

Four equal options make the agent try several; a default makes it act. Same for answers vs methods: teach how to approach the class of task ("read the schema, join on `_id`, apply the user's filters") rather than the answer to one instance ("join orders to customers where region='EMEA'").

### 1.7 Match specificity to fragility

Think of the agent walking a path. A narrow bridge over a cliff needs explicit footwork; an open field needs a direction.

- **Fragile, ordered, destructive** → exact command, do not modify: `python scripts/migrate.py --verify --backup`.
- **Multiple valid approaches** → state the goal and the constraint, let the agent choose.
- Explaining *why* raises quality in the free case (the agent generalises correctly); it adds nothing in the fragile case (there is one way).

All-caps MUST is a weak tool: it doesn't generalise and it competes with every other MUST in the doc.

### 1.8 Consistency and time

- **One term throughout.** Pick "endpoint" and never also say "route", "URL", "path". Inconsistent naming silently splits one concept into several.
- **No time-sensitive statements.** "Before August 2025 use the old API" rots. Put superseded material under an "old patterns" heading, or delete it.
- **Scripts over model inference** for anything deterministic, repeated, or needing precision — a script gives the same answer twice, is testable, and costs no context to run.

## 2. `AGENTS.md`

### What belongs

1. Rules that apply to every task (language, change discipline, verification loop).
2. Environment facts the agent cannot infer — paths, quotas, which tool is already installed and authorised.
3. **Routing**: task type → skill / doc / command. This is the highest-value content after the rules, because it converts "has access" into "actually used".
4. Guardrails: what is destructive, what needs confirmation.

### What does not

- Reference material (commands, flags, pitfalls) → `docs/`, linked from one line.
- Anything duplicated from a tool's own description.
- Anything the agent already knows, or can find by reading the repo.

### Wording is load-bearing

Vercel measured that the *same* skill with the *same* docs produced different results purely from the trigger instruction: "You MUST invoke the skill" made the agent read docs first and miss project context; "explore the project first, then consult the skill" made it build a model first and use docs as reference — and it caught changes the first variant missed entirely. Write the sequence you actually want, not emphasis.

### Rule format

```
**Bold action.** One to three sentences: what to do, the concrete command, the measured consequence.
```

Include the number that makes the rule credible. Our own case, measured over 220 sessions and 26,976 shell calls:

- Foreground `sleep` ≥ 60 s: **600 calls, 25.7 hours of blocked wall time**, worst session 87 calls / 229 minutes.
- Background shell usage: **0.4% in September** (before the rule existed) → 1.9% in October → 2.9% in November. Whether that rise is the rule or habit is not separated; the sleep figure is the honest one.
- 601 of 640 background jobs were followed up later in the same session, so backgrounding does not mean abandoning the job.

A rule stated as "never block the session on a long script" achieved 2.9%. A rule stated as "`sleep N` polling is banned; wait with `timeout 900 gh pr checks <n> --watch` or background it" is checkable in a log. Prefer the second form: **name the banned pattern and name its replacement.**

### Budget

As a project convention (not a measurement): keep the global prompt under ~120 lines. Above that, rules stop being scanned and the routing table gets buried. Move detail out, leave the pointer.

## 3. Skills

### Description: when, not what

The description is injected into the system prompt for every skill; it is the only thing the agent sees before deciding. Measured trigger rates for available-but-unadvertised skills are poor by default (56% never invoked in Vercel's suite), so the description's job is narrow and mechanical.

**A summary invites the agent to act on the summary and skip the skill.** So:

- **Lead with the trigger**, in the user's own words, including Chinese colloquial forms when that is how the ask arrives.
- One short clause of *what* is allowed — both Anthropic and agentskills.io ask for "what + when" — but the *when* must dominate. This is the one place the sources disagree (Sam McLeod argues for when-only); lead with when, keep what to ≤1 clause.
- **30–55 words**, imperative, third person ("Processes…", "Use when…"), ± assertive enough to fire.
- **Domain anchors only**: file extensions, artefact names, internal system names. Generic verbs ("review", "analyse", "improve") steal other skills' triggers.
- Name the neighbour and the boundary when one exists.
- One line, quoted, under 1024 characters. No `>-` block scalars, no XML tags.

If the skill must not be model-invoked, hide it in frontmatter rather than writing a worse description.

### Body

Order by fragility, not by narrative:

1. **Gotchas first.** Counter-intuitive environment facts are the highest-value content in most skills — the agent will make exactly these mistakes without being told. When the agent errs and you correct it, that correction belongs here.
2. **Workflow.** Numbered steps, each with the command. For anything long, tell the agent to copy the checklist and tick it off; agents drift and declare done early, and a visible checklist stops that. End multi-step work with a review pass over the whole deliverable.
3. **Verification.** A validation loop — do the work, run the validator, fix, repeat until it passes — beats a description of what good looks like. For batch or destructive work, insert a plan file between "decide" and "act": produce the plan, validate it against the source of truth, then execute.
4. **Templates.** For output format, a concrete template beats prose description, because agents pattern-match against structure.
5. **References and scripts.** Bulky detail in `references/`, deterministic work in `scripts/` (`uv run scripts/x.py`). Say whether to *run* a script or *read* it as reference.

**Never put "when to use this" in the body.** If the agent is already reading it, it's too late — and it wastes the most expensive real estate in the file.

### Triggering is a separate problem from execution

Triggering and compliance fail independently, so test them independently:

- Trigger test: realistic prompts that should fire, plus near-misses that should not.
- Compliance test: point at the skill explicitly (`use the <skill> skill`) to remove triggering from the equation, then read the trace.
- Change a description → retest the neighbouring skills too, since they compete for the same prompts.

SkillAxe's four diagnostic dimensions are a usable checklist when a skill underperforms: quality impact (does it move the metric at all), trigger precision (does it fire on the right prompts), instruction compliance with fault attribution (does it follow the steps, and is the failure the instruction's or the model's), and solution-path coverage (does it cover the paths real tasks take).

### OpenCode v2 specifics

Verified against the current docs, because several assumptions that circulate are wrong:

- **The ID comes from the path, not from frontmatter `name`.** `<source>/git-release/SKILL.md` → `git-release`; `name: Git Release` is a display label only. IDs are case-sensitive kebab-case.
- Discovery: `~/.config/opencode/skills` (global), `.opencode/skills` (project), plus `.claude/skills` / `.agents/skills` compatibility paths. A file must be a root-level `*.md` or a nested file named exactly `SKILL.md`; a directory containing `SKILL.md` is one skill, not searched further.
- **`metadata.opencode/autoinvoke: false` hides a skill from the model's list but keeps it loadable by ID.** `disable-model-invocation: true` is *not* ignored — v2 honours it, and `opencode/autoinvoke` wins when both are set. An earlier note in this repo claimed otherwise; that was wrong.
- Loading injects the body without frontmatter, the skill's base directory, and up to ten supporting file paths — supporting contents are **not** auto-loaded, which is what makes progressive disclosure work.
- `@skill-id` in a prompt loads a skill explicitly; permissions use the `skill` action with the ID as resource (`allow` / `ask` / `deny`), and `deny` hides it from the list entirely.
- v2 does **not** enforce description length, name/directory agreement, or the kebab-case pattern. Portability is your responsibility.

## 4. Review checklist

Before merging a prompt or skill change:

- [ ] Can you state what the agent does wrong **without** this instruction? Was a baseline measured?
- [ ] Every rule names a concrete action, path, command, or threshold.
- [ ] The delete test was applied sentence by sentence.
- [ ] Rules that scored below ~10% adoption were rewritten with a named replacement, or deleted.
- [ ] Routing exists where the artefact needs to be discovered (a line in `AGENTS.md`, not just a better description).
- [ ] Trigger tests include negative controls.
- [ ] Reference files hang one level deep, with *when* to read each.
- [ ] No time-sensitive statements; superseded material is under "old patterns" or gone.
- [ ] Terminology is consistent across the whole document.
- [ ] Deterministic repeated work is a script, not an instruction.
- [ ] Third-party skills were read in full before install; no secrets; least privilege.

## 5. This container's constraints

- Global prompt: `opencode-config/opencode/AGENTS.md` → baked to `/opt/opencode-config`, synced to `$XDG_CONFIG_HOME/opencode/AGENTS.md` at boot, **overwriting** the volume copy. Editing the volume file alone is lost on redeploy; editing the repo is what ships.
- Skills: `opencode-config/opencode/skills/<name>/`, synced the same way. The sync **copies, never deletes** — removing or renaming a skill needs an explicit cleanup in `entrypoint.sh`.
- Devcontainer copy lives at `.devcontainer/opencode/skills/` and does **not** sync with the Railway one; both must be changed (Railway first).
- No same-named command: a command shadows the native `/skill` path.
- Skill persistent data belongs on `/workspace`, never inside the skill directory — the directory is replaced by the next image.
- Vendor third-party skills with their LICENSE and put local adaptations in a preamble at the top of `SKILL.md`, so re-vendoring stays cheap.

## 6. Sources

| Source | What it contributed |
|---|---|
| [agentskills.io — best practices](https://agentskills.io/skill-creation/best-practices) | Extract from a hands-on task; refine from traces; delete test; coherent units; fragility-matched specificity; gotchas; plan-validate-execute |
| [Anthropic — skill authoring](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) | 500-line / 1024-char budgets; third person; one-level-deep references; TOC over 100 lines; degrees of freedom; "old patterns"; terminology; rubric checklists |
| [Vercel — `AGENTS.md` beats skills](https://vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals) | 56% never invoked, +0pp; 95%+ with explicit routing, 79%; 8 KB index 100%; 40→8 KB compression; trigger-wording fragility |
| [OpenAI — testing skills with evals](https://developers.openai.com/blog/eval-skills) | Four goal categories; 10–20 prompt CSV with negative controls; trace-based deterministic checks; thrashing/token/repo-cleanliness signals |
| [SkillsBench (2602.12670)](https://arxiv.org/abs/2602.12670) | +16.6 pp over 87 tasks / 18 configs; focused ≤3-module skills beat bundles; small model + skills ≈ large model without |
| [SkillAxe (2606.10546)](https://arxiv.org/abs/2606.10546) | Human +16.2 pp vs LLM-authored no gain; four quality dimensions; 47–67% gap closed by evaluation-guided refinement |
| [Sam McLeod — common pitfalls](https://smcleod.net/2026/07/writing-and-reviewing-agent-skills-common-pitfalls) | Description = trigger only, 30–55 words; "when to use" in body is too late; scripts over inference; third-party review |
| [OpenCode — skills](https://opencode.ai/docs/skills/) | Discovery paths, path-derived IDs, `autoinvoke`, precedence, load semantics, permissions |
