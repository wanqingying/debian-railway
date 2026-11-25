# Instruction Design: Prompts, Skills, Tool Descriptions

An `AGENTS.md` rule, a `SKILL.md` body and a tool's `description` all guide the agent. What differs is *when* they load and *what they compete with*.

**Aim for the shortest text and the smallest result that are still accurate, complete for the task, and usable.** Cut repetition, not evidence, caveats, or the next action. Let the task determine the length and how much to return at once; validate real platform or interface requirements separately rather than turning them into general writing rules.

Sources are named inline. §11 distinguishes measurements, platform requirements and practical advice, and explains where each applies.

## 0. Where the text goes

| Carrier | Loaded | Cost | Use it for |
|---|---|---|---|
| `AGENTS.md` | As applicable to the session or project | Repeated context; reuse depends on the provider and request | Rules that hold across tasks; environment facts; **routing** |
| Skill (`SKILL.md` + `references/`) | Body on activation; references as needed | Loaded material competes with conversation history | A class of task the agent repeatedly gets wrong, plus its traps |
| Tool `description` + schema | When supplied to the model | Repeated context for exposed tools | When to call it, what it returns, how it differs from its neighbours |
| Tool *output* | When a tool returns data | Can dominate the conversation context | Relevant fields; a clear way to retrieve the rest |
| Hook / CI / wrapper script | Automatically when configured | Runs outside the model; any returned output still costs context | Requirements that need deterministic enforcement |

The loading difference decides design more than writing style does. In Vercel's Next.js 16 evals a skill **was never invoked in 56% of cases** and scored exactly baseline (53% → 53%, +0pp); an explicit instruction to use it lifted triggering above 95% and the pass rate to 79%; a **compressed 8 KB docs index inside `AGENTS.md` reached 100%** (40 KB compressed 5:1, no loss).

- **Horizontal knowledge** (applies everywhere) → passive context. There is no decision point, so nothing gets skipped.
- **Vertical workflows** (explicitly triggered) → a skill.
- **Bulk detail** → neither. Keep a lightweight identifier (path, query, link) in the prompt and let the agent load it just-in-time with a tool; Claude Code's `CLAUDE.md` + `glob`/`grep` is the hybrid, and Anthropic reports the hybrid as its default because runtime exploration beats a stale index.

**Calibrate.** Vercel tested one framework and task family. The index made routing visible without requiring skill activation; the agent still had to retrieve the relevant docs. The result does not justify loading full documentation or assuming the same pass rate elsewhere.

## 1. What an instruction file is worth

This is the section to read before adding anything.

An agent already has three sources of truth: its training data, the repository itself, and tool results. **An instruction file earns its place only by carrying something none of those three supplies**, and it is never free: ETH Zurich's CTXbench study (4 agents — Claude Code+Sonnet-4.5, Codex+GPT-5.2, Codex+GPT-5.1-mini, Qwen Code+Qwen3-30B; 300 SWE-bench Lite instances and 138 new instances from 12 repositories with developer-committed context files) measured what an instruction file actually costs:

| | Success rate | Steps | Cost |
|---|---|---|---|
| LLM-generated file | −0.5% / −2% (p=0.87 / 0.37) | +2.45 / +3.92 | **+20% / +23%** (p<0.001%) |
| Developer-written file | +2.4% average (p=0.21, n.s.) | +3.34 | up to **+19%** |

Agents did follow the instructions (`uv` was used 1.6 times per instance when mentioned versus <0.01 times when not; repository-specific tools 2.5 versus <0.05 times). On SWE-bench, reasoning tokens rose 22% (GPT-5.2) and 10% (GPT-5.1-mini) with LLM-generated files. Following extra instructions is a plausible explanation for some of the added work, not a measured cost per instruction.

**What to leave out.** In the ETH study, context files did not meaningfully help agents reach a file touched by the reference patch sooner. GPT-5.1-mini took longer and sometimes searched for and re-read the context file despite already having it. Avoid directory listings, architecture summaries and generic advice when they repeat what the agent can already discover; keep pointers that change where it looks or how it works.

**Routing is not an overview.** A map across projects can tell an agent which sibling checkout to use, which subdirectory to enter and which copies to avoid. Include the identity and path needed to choose correctly, not each neighbour's architecture or deployment history.

**What earns a place.** These are useful starting points, not categories independently proven to improve success:

1. **Non-standard conventions** the agent would otherwise guess wrong — the ETH authors' own recommendation is only content "not already present in the README".
2. **Environment facts invisible in the repo** — for example, which filesystem paths survive a container redeploy.
3. **Routing that changes tool or skill selection** — Vercel tested a version-matched index with an explicit retrieval instruction, not a generic repository overview.
4. **Version-specific facts absent from training data** — the Next.js 16 APIs in Vercel's suite.

**Two corollaries that are cheap to apply:**

- **Don't deploy a generic LLM-generated file unreviewed.** On CTXbench, the generated files scored significantly below developer-written ones (p=0.038); their decline versus no file was not statistically significant. An agent can draft from verified runbooks, incidents and task traces; review the draft and test what it changes.
- **Do not duplicate it.** Agents hunt for context files by name and re-read them; a copy in a subdirectory makes them waste steps finding and reading text that is already in context.

**The counter-evidence.** A separate study of small PRs (124 across 10 repositories) reported a 28.6% lower median wall-clock time and 16.6% fewer median output tokens with `AGENTS.md`. It does not establish better code correctness. The studies used different tasks and measures: neither isolates task size as the cause of the difference or predicts the cost of a change here.

Practical rule: **add a line only if you can name which of the four categories it belongs to, and measure before/after on tasks that resemble your real ones.**

## 2. Universal rules

### 2.1 Content comes from execution, not imagination

SkillsBench reported a **+16.6 pp** pass-rate increase with curated skills across its benchmark (33.9% → 50.5%), while skills generated from a general prompt showed no measurable benefit. SkillAxe reported that evaluation-guided refinement recovered part of the gap in its own benchmark. Start from evidence of the real workflow rather than asking a model to invent it.

Work through a real task with the agent, note the corrections that matter, then extract the pattern. Or synthesise from existing artefacts: runbooks, incident reports, review comments, patch history.

### 2.2 Evals before prose

First establish what the agent does wrong *without* the text. Four kinds of goal: **outcome** (task completed), **process** (right tool, right order), **style** (conventions), **efficiency** (no thrashing, no token blowup).

- Start with a representative set of real tasks. Add cases until it covers the intended workflows, plausible near-misses and meaningful risks. For trigger tests, record `id, should_trigger, prompt`.
- **Include negative controls** to catch over-eager matching; keep fresh cases aside to check that edits generalise.
- Score the outcome and inspect the trace: test results or delivered artefact, commands run, step count, tokens, and `git status --porcelain` where relevant.

Changing a prompt without a baseline is indistinguishable from luck.

### 2.3 The delete test

For every sentence: **would the agent get this wrong without it?** If no, cut it. If unsure, test it.

The ETH study measured added work and cost for whole context files in its benchmarks, not a fixed tax for every unnecessary line. Measure the effect of a proposed change on representative tasks.

### 2.4 Say what to do

A prohibition tells the model what to avoid but not what to do instead, so under pressure it takes the cheapest reading that is not literally forbidden. State the action.

| Instead of | Write |
|---|---|
| "Never report a change as working until you have executed it" | "Run it before you call it done; if you did not run it, say it is untested" |
| "Don't improve adjacent code/comments/formatting" | "Leave adjacent code, comments and formatting as you found them" |
| "No features beyond the ask" | "Build only what the ask requires" |
| "Do not use markdown" | "Your response should be composed of smoothly flowing prose paragraphs" |
| "Handle errors appropriately" | "Every HTTP call gets an explicit timeout — a missing one once hung a run for 464 s" |

Keep each rule focused on a decision, including the fallback when the preferred action is unavailable. In the first example, "say it is untested" supplies the missing fallback.

Measured here over 220 sessions and 26,976 shell calls: foreground `sleep` ≥ 60 s accounted for **600 calls and 25.7 hours of blocked wall time** (worst session: 87 calls, 229 minutes). The share of shell calls run in the background rose from 0.4% to 2.9% over the observed period. That is not the share of eligible calls that followed the rule, and the observation does not isolate a wording effect. A checkable replacement is to background long jobs or use a bounded wait on the actual condition instead of polling with `sleep`.

### 2.5 Altitude, sections, and the attention budget

Two failure modes bracket the useful range. At one end, **brittle hardcoded logic** ("if the user says X and the file is Y, then do Z") breaks on cases it did not anticipate. At the other, **vague high-level guidance** ("be careful and thorough") assumes context the model does not have. State the observable condition and what to do about it. This is practical guidance; test it against the failures you are trying to prevent.

Structure helps more than prose does: name the sections (`<background_information>`, `<instructions>`, `## Tool guidance`, `## Output description`) with XML tags or markdown headers, so both you and the agent can see which part a line belongs to.

Context is a **finite attention budget, not free storage**. Recall degrades as context grows ("context rot"), and attention pairs grow n² in token count. The target is the *smallest set of high-signal tokens*, which is not the same as the shortest text — minimal does not mean terse when the behaviour genuinely needs detail.

For examples: curate a **few canonical, diverse** ones. Do not stack a laundry list of edge cases; that is the brittle end of 2.5 wearing an example's clothes.

### 2.6 Progressive disclosure, with direct references

- Keep the core workflow, common traps and verification in `SKILL.md`. Move details needed only on certain paths into focused references.
- Link the material needed to finish a path **directly from `SKILL.md`** and say when to read it: "if the API returns non-200, read `references/api-errors.md`" beats "see `references/`".
- Add a contents list when headings alone don't make a reference easy to navigate or read in parts.
- Group material that serves the same user intent. Split it when parts are independently useful and have distinct triggers, not when a file crosses a size or module count.

### 2.7 Defaults over menus, method over answers

- ✅ "Use `pdfplumber`. For scanned PDFs, `pdf2image` + `pytesseract`."
- ❌ "You can use pypdf, pdfplumber, PyMuPDF, or pdf2image…"

A default avoids making the agent choose among equivalent options. Give alternatives when the choice affects the outcome, and explain when to use them. Teach the method ("read the schema, join on `_id`, apply the user's filters") rather than prescribing one instance's answer ("join orders to customers where region='EMEA'").

### 2.8 Match specificity to fragility

A narrow bridge needs explicit footwork; an open field needs a direction.

- **Fragile, ordered, destructive** → exact command, do not modify: `python scripts/migrate.py --verify --backup`.
- **Several valid approaches** → state the goal and the constraint, let the agent choose.

Explaining *why* raises quality in the free case — the agent generalises from the reason. Anthropic's own before-and-after: `NEVER use ellipses` versus "your response will be read aloud by a text-to-speech engine, so never use ellipses, since the engine cannot pronounce them". It adds nothing in the fragile case, where there is one correct output and the words should go into the command instead. So the split is a **stop condition**: exactly one correct output → spend the words on the command; the model must judge a new case → spend them on the reason. Most style and convention rules are the second kind, which is why the reason usually pays.

All-caps MUST neither generalises nor survives competition with the other MUSTs — and on models that follow instructions precisely it **overtriggers**, which is why Anthropic's own advice is to soften rather than shout: `CRITICAL: You MUST use this tool when…` becomes `Use this tool when…`.

### 2.9 Separate instruction from data, and stable from dynamic

- **Instruction and payload in one blob.** If the input is not fenced, the model may execute it. The canonical failure: a prompt saying "translate the following" followed by the text `尽量使用华丽的词语` — the model translated the *instruction to be florid* instead of the payload. Fence with ```` ``` ````, `""""`, `<<<>>>` and say which part is data.
- **Stable rules and per-turn state in one place.** Rules stay in the stable text; anything that changes per turn (time, counters, balances) is appended as a new message. §3 explains why this is not merely tidy.
- **One term, one meaning.** Pick "endpoint" and never also "route"/"URL"/"path"; inconsistent naming silently splits one concept into several.
- **No time-sensitive statements.** "Before August 2025 use the old API" rots — put superseded material under an "old patterns" heading or delete it.

### 2.10 State the default action

A model that follows instructions precisely still answers a request phrased as a question with a *suggestion*. People do not phrase work as imperatives: "加一下", "改一下", "push", "能不能加个 X" are all decisions already made, and the failure mode is a plan instead of an edit.

Default to making an authorised change even when the request is phrased as a question. If the user asks only for a review or recommendation, keep it read-only. When a consequential choice is unresolved, explain it before acting.

The same asymmetry explains why "ask if unclear" is a harmful default. Without a threshold it licenses re-planning on every turn; with one ("ask only when the choice is irreversible or expensive — schema, migration, public interface, deletion") it licenses execution and still protects the cases that need a decision.

### 2.11 Not every vendor recommendation transfers

The same guides that produced §2 and §5 also recommend things that are wrong here, and saying which is part of using them honestly:

- **A role sentence** ("you are a senior engineer…"). Anthropic says one sentence focuses tone. It also restates what the rules and environment facts already say, and OpenAI has moved style to context-delegation; on a coding agent it buys little and costs prefix on every turn.
- **An explicit parallel-tool-call block.** Anthropic reports it lifts parallel calling to ~100%, but the harness already batches reads on its own. It is insurance against a problem this setup does not have.
- **Thinking and effort guidance.** Host-controlled. Writing "think step by step" into a rule file does not reach the dial, and on models with adaptive thinking it can suppress it.

The test is the same one as §1: name the failure the instruction prevents, in this setup, and drop it if there is none.

## 3. Keep the reusable prefix stable

Think in terms of stable instructions and tool definitions followed by a growing conversation. What the provider actually caches depends on how the harness renders the request. In OpenAI's Responses API, for example, a cache hit requires an eligible matching prefix at an available breakpoint. A change can invalidate reuse from that point onward without invalidating an earlier matching breakpoint.

- **Keep changing state out of the reusable portion.** Put stable material first and timestamps, counters and current task state later. Check how the target API places each message or instruction field before relying on its position.
- **Keep exposed tool definitions stable when practical.** Names, schemas and ordering can affect matching. Where supported, changing availability separately or appending tools can preserve more of the prefix. Apply permission changes even if doing so loses reuse.
- **Append rather than rewrite history when possible.** Editing or compacting earlier content can reduce reuse. Compact when context quality or the available window warrants it, not just to chase a cache metric.
- **Check the actual cache policy.** Eligibility, breakpoints, retention, and read and write rates depend on the provider, model and API. Don't add filler to reach a cache threshold. If cost matters, compare cache reads and writes, latency and billed cost on representative requests over the actual route.

In this container, keep global instructions stable and pass runtime state separately. Do not infer savings on a gateway from another provider's cache behaviour or from prompt length alone.

## 4. Position

Liu et al. (TACL 2024) observed weaker retrieval from the middle in the long-context tasks and models they tested. Treat position as a useful design heuristic, not a guarantee for current models or agent sessions.

- Critical constraints and the routing table go **first**.
- Current state / next action goes **last** in the message list.
- Keep a critical rule easy to find where it is needed, rather than burying it in background prose.

## 5. Output style

Response style is the most-specified and least-evidenced part of most system prompts. Three findings should reshape what you write.

**A friendly persona costs accuracy.** Fine-tuning five models (Llama-8B and 70B, Mistral-Small, Qwen-32B, GPT-4o) to sound warmer raised error rates by 10–30 pp and made them ~40% more likely to affirm incorrect user beliefs — most strongly when the user's message expressed sadness. The part that matters for prompt authors: the same effect appeared from **system prompting**, smaller and less consistent but the same direction, at up to 14 pp and 12 pp more errors on questions carrying an incorrect user belief. The control condition is the useful one — fine-tuning on the *same* data rewritten cold (direct, concise, emotionally neutral) left accuracy unchanged or slightly better (−3 to +13 pp). So the plain style is the safe style, and "be friendly and encouraging" is not a free nicety. (Nature, 2026-04)

**Vendors have stopped specifying style and started delegating it.** OpenAI's Model Spec revision of 2026-10-29 "retired most of the detailed style guidance", reasoning that style should adapt to the user and the context, while keeping sycophancy as a user-level principle that survives unless explicitly overridden. Practical consequence: no default gives you a length or format you can rely on. If you need one, it goes in your own prompt.

**Match the style rule to the behaviour.** Anthropic documents different verbosity and progress-reporting defaults across models. Test whether the model gives useful progress and a complete answer before adding a general instruction to be brief; recheck after a model change.

### What the canonical concise style looks like

Claude Code ships one, and its shape is the reusable part:

- **Lead with the answer or outcome.**
- It **drops the lead-in, the step-by-step narration, and the closing recap**.
- A simple question gets a brief, direct answer with the context needed to understand or act on it.
- The engineering work is done just as thoroughly as without the style.

Business writing calls this BLUF — bottom line up front.

### The carve-outs are the design, not an afterthought

Every published concise style keeps exceptions, and the same ones:

- Anything the user explicitly asked to have explained.
- **Error reports, failing test output, security warnings, and confirmations before destructive actions** keep their complete content — exactly the cases where trimming causes a wrong decision.
- The reasoning needed to approve a risky step.
- Progress on long-running work, when silence reads as "stuck".

State these exceptions with the brevity rule. The user should not have to ask again for evidence or context needed to act safely.

### Formatting instructions cut both ways

- **Say what to do, not what not to do.** "Do not use markdown" → "your response should be composed of smoothly flowing prose paragraphs."
- **Your own prompt's formatting leaks into the answers.** A prompt written entirely in bolded bullets produces bulleted answers; Anthropic notes that removing markdown from a prompt reduces markdown in the output. A rule file is prose with structure, which is one reason its own style bleeds into replies.
- **Over-constraining suppresses structure the content needs.** Anthropic ships a long `<avoid_excessive_markdown_and_bullet_points>` block and then warns that on models which already format sparingly it "can suppress structure the content needs" and should be removed or shortened. Structure should follow the content: genuinely discrete items get a list, an argument gets paragraphs.
- **Formatting is not enforcement.** Both vendors describe style instructions as things the model follows, not guarantees; anything that must happen every time belongs in a hook or in post-processing.


## 6. `AGENTS.md`

### What belongs

1. Rules that apply to every task (language, change discipline, verification loop).
2. Environment facts the agent cannot infer (§1 category 2).
3. **Routing** — task type → skill / doc / command (§1 category 3).
4. Guardrails: what is destructive, what needs confirmation.

### What does not

- Generic overviews, directory listings and architecture prose that do not affect the agent's choices (§1).
- Reference material (flags, commands, pitfalls) → `docs/`, with a short pointer explaining when to read it.
- Anything duplicated from a tool description, or the agent can read from the repo.

### Wording is load-bearing

Question phrasing can make an agent offer a suggestion instead of acting on an authorised request (§2.10). In Vercel's Next.js evaluation, "You MUST invoke the skill" led the agent to read docs first and miss a configuration change in one case. Telling it to explore the project first and then consult the skill caught that change. Write the **sequence** you want when order matters.

### Rule format

```
**Action.** Say when it applies and what to do. Add a command or the reason when it prevents a likely mistake.
```

"Background long jobs; use a bounded `--watch` when the task needs to wait for external state" describes behaviour that can be checked in a log. §2.4's background-call share was not a rule-adoption rate.

### What stays in the prompt

Keep the prompt easy to scan. Keep rules, routing and non-obvious facts that must be visible before the agent acts; put examples, procedures and history behind a pointer unless they are needed to follow the rule correctly. Measure the effect of changes on tasks, not against a line count.

## 7. Skills

### Description: lead with when, then say what

The description is part of the skill metadata the agent can use before loading the body. Give it enough to choose the skill without duplicating its workflow:

- **Lead with the trigger**, in the user's own words, including Chinese colloquial forms when that is how the ask arrives.
- Say what the skill delivers and include the signals needed to distinguish it from related skills. Keep workflow details in the body.
- Write directly ("Use when…"); use realistic phrasing, artefact names or domain terms when they help. Avoid generic claims that match unrelated work.
- Name the boundary with a neighbouring skill if the overlap is likely to cause a false trigger.
- Use readable YAML and check the parsed description against the target skill spec and runtime. Platform acceptance is a compatibility check, not a writing target.

If a skill must not be model-invoked, hide it in frontmatter rather than writing a weaker description.

### Body

Ordered by fragility, not narrative:

1. **Gotchas first.** Counter-intuitive environment facts are the highest-value content in most skills. Every correction you make to the agent belongs here.
2. **Workflow.** Numbered steps, each with its command. For long procedures, tell the agent to copy the checklist and tick it off; agents drift and declare done early. End multi-step work with a review pass over the whole deliverable.
3. **Verification.** A loop — do the work, run the validator, fix, repeat — beats describing what good looks like. For batch or destructive work insert a plan file between "decide" and "act": produce it, validate it against the source of truth, then execute.
4. **Templates** for output format; agents pattern-match against structure better than against prose.
5. **References and scripts.** Bulky detail in `references/`, deterministic work in `scripts/` (`uv run scripts/x.py`). Say whether to *run* a script or *read* it as reference.

Put discovery cues in the description. Use the body to clarify what is in scope, when to branch, and when to stop once the skill is loaded.

### Triggering and compliance fail independently

- Trigger test: realistic prompts that should fire, plus near-misses that must not.
- Compliance test: name the skill explicitly to remove triggering, then read the trace.
- Change a description → retest the neighbouring skills, which compete for the same prompts.

Four diagnostics when a skill underperforms: quality impact (does it move the metric), trigger precision (does it fire on the right prompts), instruction compliance with fault attribution (the instruction's fault or the model's?), solution-path coverage (does it cover the paths real tasks take).

### OpenCode v2 specifics

Verified against current docs; several circulating assumptions are wrong.

- **The ID comes from the path, not frontmatter `name`.** `<source>/git-release/SKILL.md` → `git-release`; `name: Git Release` is a display label. IDs are case-sensitive kebab-case.
- Discovery: `~/.config/opencode/skills` (global), `.opencode/skills` (project), plus `.claude/skills` / `.agents/skills`. A file must be a root-level `*.md` or a nested file named exactly `SKILL.md`; a directory containing `SKILL.md` is one skill and is not searched further.
- **`metadata.opencode/autoinvoke: false` hides a skill from the model's list while keeping it loadable by ID.** `disable-model-invocation: true` is *not* ignored — v2 honours it, and `opencode/autoinvoke` wins when both are set. An earlier note in this repo claimed otherwise; that was wrong.
- Loading injects the body without frontmatter and the skill's base directory. The runtime may list supporting paths without loading their contents; link the required files explicitly rather than relying on the preview.
- `@skill-id` loads a skill explicitly. Permissions use the `skill` action with the ID as resource (`allow` / `ask` / `deny`); `deny` hides it entirely.
- v2 does **not** enforce description length, name/directory agreement, or kebab-case. Portability is your responsibility.

## 8. Tool descriptions

Tool descriptions compete for attention and can contribute to repeated input. Small wording changes can steer calls: Anthropic gives the example of a web-search `query` description that invited appending `2025` and biased searches. Check the trace before assuming a description improves performance.

### Design the tool, not the wrapper

- `search_contacts` beats `list_contacts`: an agent reading a full list token-by-token is doing brute-force search with the most expensive scanner in the system.
- Consolidate chains: `schedule_event` (find availability, then schedule) instead of `list_users` + `list_events` + `create_event`; `search_logs` instead of `read_logs`; `get_customer_context` instead of three lookups.
- **Overlapping tools make selection harder.** If their boundaries are hard to explain, simplify the surface or make the distinction explicit. Repeatedly exposing unused tools also adds context.

If two descriptions could swap without changing behaviour, one tool is wrong.

### Names

- **Namespace by service and resource**: `asana_search`, `jira_search`, `asana_projects_search`. Prefix vs suffix has a non-trivial measured effect on tool choice, and the direction varies by model — pick by eval.
- **Unambiguous parameters**: `user_id`, not `user`. Prefer `enum` over free text. Enforce with a strict schema; the schema survives a lazy description.
- Verb-on-object names (`search_logs`, `send_message`) are self-documenting; `logs` or `handle` are not.

### Write it like onboarding a new hire

State the implicit knowledge you would say out loud:

- **When to call it and when not to** — "use for a known customer; with only a name, call `search_customer` first."
- **Niche terminology and formats** the tool expects, with an example when it removes ambiguity.
- **Relationships between resources** — "a thread reply needs `thread_ts` from a *detailed* `get_channel` response."
- **Boundaries with siblings** — "raw logs: `search_logs`; this returns aggregates only."
- **What it returns**, in the vocabulary the agent will use afterwards.
- **Side effects** — destructive, open-world, paid. MCP tool annotations exist for this.

If a description is long because the tool serves unrelated intents, split it along those boundaries. If it is long because the contract is complex, simplify the schema or keep the detail needed to call it correctly. Don't split a coherent tool to satisfy a line count.

### Output is part of the description

Tool results can dominate the context. Return enough to answer the request or make the next decision:

- **Return relevant fields.** For a display task, prefer readable fields such as `name`, `image_url` and `file_type`. Omit metadata that serves neither the request nor a follow-up action.
- **Use readable labels and keep actionable identifiers.** Prefer `Jane Doe` to a bare ID for display; include `usr_8f3ac1` if the next call needs it. Offer more detail on demand when it isn't necessary for the current task.
- **Choose scope by intent, not a universal batch size.** Filter to the requested records and fields. For large results, use pagination, range selection or a downloadable artefact so the full requested result remains reachable. Distinguish a complete result from a page, preview or sample; never quietly drop matches to make an answer shorter.
- **Make partial results and errors actionable.** Say what was returned, what remains and how to continue (for example, provide a cursor). For invalid input, explain the problem and show the valid or relevant alternatives, or how to look them up.

### Measure tool use, not just task success

Calls per task (many redundant → bad pagination defaults), error rate per parameter (high → ambiguous description or schema), tokens per task (output too verbose), and tools never called (description does not fire, or the tool is unnecessary).

## 9. Review checklist

- [ ] Can you state what the agent does wrong **without** this text? Was a baseline measured?
- [ ] Every added line belongs to one of §1's four categories — not an overview, not a restatement of the repo.
- [ ] Each rule says when it applies and what to do instead of the undesired behaviour (§2.4).
- [ ] The default action is stated: execute, or discuss (§2.10).
- [ ] The delete test removed repetition without losing necessary evidence, caveats or next actions.
- [ ] If a rule is often missed when it applies, the trace was checked before clarifying, replacing or removing it.
- [ ] Routing is visible where it affects the decision, through a prompt pointer or skill metadata as appropriate.
- [ ] Trigger tests include negative controls.
- [ ] Required references are linked directly, each with *when* to read it.
- [ ] Stable instructions and tool definitions are separated from changing state where the target API supports it; critical rules are easy to find.
- [ ] Response-style rules carry their carve-outs: requested explanations, error reports and failing test output, security warnings, destructive-action confirmations, and progress on long jobs.
- [ ] No time-sensitive statements; terminology consistent.
- [ ] **The edit reached the intended copy.** For a global prompt change, use `cmp` to check the volume copy against `opencode-config/opencode/AGENTS.md`, not the project-root `AGENTS.md`. For a mirrored doc, edit `docs/`, run `scripts/sync-agent-docs.sh` and compare the source with the packaging copy. To make the change available in the running container, update the matching volume copy and compare it too; a new image is needed for the change to survive redeploy.
- [ ] Deterministic repeated work is a script, not an instruction.
- [ ] Tool: name says the task, params are unambiguous, output is scoped and complete or clearly partial with a continuation path, errors are actionable, and boundaries are stated.
- [ ] Verified platform requirements, research findings and local observations are labelled separately; any claim that drives a decision was checked in the applicable version or setting.
- [ ] Third-party skills and tools were read in full before install; no secrets; least privilege.

## 10. This container's constraints

- Global prompt: `opencode-config/opencode/AGENTS.md` → baked to `/opt/opencode-config`, synced to `$XDG_CONFIG_HOME/opencode/AGENTS.md` at boot, **overwriting** the volume copy. Editing the volume file alone is lost on redeploy. Never `cp AGENTS.md` from the repo root over it — that is the *project* prompt and doing so wipes the global rules.
- Keep that file stable and pass runtime values separately. Verify cache behaviour for the actual provider and API (§3).
- Skills: `opencode-config/opencode/skills/<name>/`, synced the same way. The sync **copies, never deletes** — removing or renaming needs an explicit cleanup in `entrypoint.sh`.
- Devcontainer copy lives at `.devcontainer/opencode/skills/` and does **not** sync with the Railway one; both must change (Railway first).
- No same-named command: a command shadows the native `/skill` path.
- Skill persistent data goes on `/workspace`, never inside the skill directory — that directory is replaced by the next image.
- Vendor third-party skills with their LICENSE and put local adaptations in a preamble at the top of `SKILL.md`.

## 11. Sources and what they support

**Judge evidence by what it supports, not by a fixed age discount.** Record publication or revision dates when known; for living documentation, record the version or date checked when it matters to a decision.

- **Platform requirements:** check current official docs for the target and test the installed version. Distinguish what validation rejects from what the vendor merely recommends.
- **Research:** check the tasks, harnesses, models, metrics and comparison. Report results within that scope and re-test before treating an inferred effect as a local rule.
- **Practical advice and local observations:** label the setting and limits of the evidence. A trace can show what happened; a change over time alone does not establish why.

| Source | Published | Contributed | Scope / caveat |
|---|---|---|---|
| [Nature — warm models are less accurate](https://www.nature.com/articles/s41586-026-10410-0) | 2026-04 | Warmth fine-tuning: +10–30 pp error, ~40% more sycophancy; **also from system prompting**, up to 14 pp on incorrect-belief items; cold (direct, concise) style unchanged or better | **Highest for §5** — 5 architectures, controlled cold-style ablation, and it isolates system-prompt effects from fine-tuning. Caveat: QA benchmarks and ShareGPT-derived data, not agent transcripts |
| [OpenAI — Model Spec](https://model-spec.openai.com/2026-10-29.html) | 2026-10, rev. 2025-02 | Retired most detailed style guidance; style adapts to context; sycophancy stays a user-level principle; instructions carry explicit authority levels | High for §5's "no default length exists" and for the authority-level idea. It states intent, and OpenAI says its models do not yet fully reflect it — a spec is not a measurement |
| [Anthropic — prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices) | living doc, 2026-10 | Models are already concise; Opus 5 runs long → prompt for conciseness; Fable 5.1 needs the opposite; say what to do not what not to do; prompt formatting leaks; over-constraining suppresses needed structure; soften over-aggressive wording; explain why | **Highest for §5's actionable detail** — per-model notes are the part that goes stale fastest, so re-read after every model change |
| [Claude Code — output styles](https://docs.claude.com/en/docs/claude-code/output-styles) | living doc | Lead with the answer; omit narration and recap; preserve requested explanations and safety-critical content | Vendor style guidance, not guaranteed output behaviour |
| [ETH — Evaluating AGENTS.md (2602.11988)](https://arxiv.org/abs/2602.11988) | 2026-02, rev. 2026-09 | No statistically significant success change versus no file; higher inference costs; developer files outperformed generated ones on CTXbench | Measures success and cost on Python tasks with the tested agents; not a per-line estimate or a verdict on grounded drafting |
| [AGENTS.md efficiency (2601.20404)](https://arxiv.org/abs/2601.20404) | 2026-01, rev. 2026-03 | Lower median runtime and median output tokens with `AGENTS.md` | Efficiency study on small PRs; not evidence of code correctness or a causal comparison across task sizes |
| [Anthropic — writing tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents) | 2025-09 | Task-shaped tools; namespacing; field selection; pagination; actionable errors | Tool-design guidance grounded in vendor examples; test on the actual tool set before generalising |
| [Anthropic — effective context engineering](https://www.anthropic.com/research/effective-context-engineering-for-ai-agents) | 2025-09 | Right altitude; named sections; high-signal context; just-in-time retrieval | Practical design guidance, not a controlled comparison for this container |
| [Agent Skills — specification](https://agentskills.io/specification.md) | living spec | Format and validation; progressive disclosure | Distinguishes portable format requirements from authoring recommendations; check the target runtime too |
| [Agent Skills — best practices](https://agentskills.io/skill-creation/best-practices) | living guidance | Extract from real tasks and artefacts; refine from traces; organise coherent workflows | Guidance on what belongs in a skill, not a validator |
| [Agent Skills — optimizing descriptions](https://agentskills.io/skill-creation/optimizing-descriptions.md) | living guidance | User intent; near-miss tests; fresh cases to check generalisation | Use representative tasks rather than copying the example suite size |
| [Anthropic — skill authoring](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) | living doc | Clear descriptions; focused references; navigation and checklists | Vendor-specific authoring guidance; check the portable spec and installed runtime separately |
| [Vercel — `AGENTS.md` beats skills](https://vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals) | 2026-01 | 56% never invoked, +0pp; 95%+ / 79% with routing; 8 KB index 100%; 40→8 KB; wording fragility | High for §0 but **narrow** — one framework's docs, one task family. The mechanism transfers, the 100% does not |
| [OpenAI — prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching) | living doc | Prefix matching, breakpoints, tool stability, model-dependent cache policy | Official for the documented API and models; verify gateway behaviour and billing separately |
| [OpenAI — testing skills with evals](https://developers.openai.com/blog/eval-skills) | undated | Goal categories; negative controls; trace-based checks | Practical evaluation recipe; choose coverage based on the task |
| [SkillsBench (2602.12670)](https://arxiv.org/abs/2602.12670) | 2026-02, rev. 2026-06 | +16.6 pp over 87 tasks / 18 configurations; focused skills performed better than broad bundles in the benchmark | Paired evaluation with deterministic verifiers; not a universal module-count rule |
| [SkillAxe (2606.10546)](https://arxiv.org/abs/2606.10546) | 2026-06 | Human +16.2 pp vs LLM-authored no gain; four diagnostic dimensions; 47–67% gap closed by refinement | Medium-high — the four dimensions are the useful part; the self-refinement pipeline is their product |
| [Lost in the Middle (TACL 2024)](https://aclanthology.org/2024.tacl-1.9/) | 2023-07 / 2024 | Weaker retrieval from the middle in tested long-context tasks | Direct evidence for those tasks and models, not for current agent sessions |
| [Sam McLeod — common pitfalls](https://smcleod.net/2026/07/writing-and-reviewing-agent-skills-common-pitfalls) | 2026-07 | Lead with trigger wording; scripts over inference; third-party review | Practitioner advice; the portable spec also asks descriptions to say what the skill does |
| [OpenCode — skills](https://opencode.ai/docs/skills/) | living doc | Discovery paths, path-derived IDs, `autoinvoke`, precedence, load semantics, permissions | Highest for platform facts — the runtime we use. Re-read after every OpenCode bump; the pinned version decides, not the doc |
| 李博杰《深入理解 AI Agent》第 2 章 | 2026 (chapter undated) | Static prefix vs trajectory; dynamic injection cost; lost-in-the-middle; tool reordering | Medium — the structural model is sound and §3 now backs it with a primary source; its cache ratios and per-model `reasoning_content` rules are vendor specifics, already expiring |
| [ai-agents-from-zero 1-2](https://github.com/didilili/ai-agents-from-zero/blob/main/1-2-%E6%8F%90%E7%A4%BA%E8%AF%8D%E5%B7%A5%E7%A8%8B%E5%9F%BA%E7%A1%80.md) | undated (2025–26) | Delimiters separating instruction from data; system = stable, user = current task; output format as a contract | Low-medium and undated — its six-element template is for one-shot content prompts and does not transfer to agent instructions |
| [ai-agents-from-zero 13](https://github.com/didilili/ai-agents-from-zero/blob/main/13-%E6%8F%90%E7%A4%BA%E8%AF%8D%E4%B8%8E%E6%B6%88%E6%81%AF%E6%A8%A1%E6%9D%BF.md) | undated (2025–26) | Stable vs dynamic split; history resent; prompts externalised for versioning | Low — mostly framework mechanics |
| [prompt-optimizer](https://github.com/linshenkx/prompt-optimizer) (41.5k★) | living repo | Prompts as versioned assets; optimise → evaluate → compare | Low — a product, not a source of principles; one-click "optimisation" tends to inflate prompts, which §2.3 rejects |
