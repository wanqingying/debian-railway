# Instruction Design: Prompts, Skills, Tool Descriptions

Three artefacts, one discipline. An `AGENTS.md` rule, a `SKILL.md` body and a tool's `description` are all natural-language instructions consumed by a model that cannot ask follow-up questions. What differs is *when* they load and *what they compete with*.

Numbers in brackets are measured. Sources are named inline; §11 dates and grades each one, applies a recency discount, and states where they disagree instead of averaging them.

## 0. Where the text goes

| Carrier | Loaded | Cost | Use it for |
|---|---|---|---|
| `AGENTS.md` | Every turn | In the **cached prefix**, paid forever | Rules that hold for every task; environment facts; **routing** |
| Skill (`SKILL.md` + `references/`) | Only when triggered | Paid once, competes with the whole conversation | A class of task the agent repeatedly gets wrong, plus its traps |
| Tool `description` + schema | Every turn | In the cached prefix, paid forever | When to call it, what it returns, how it differs from its neighbours |
| Tool *output* | Every call | The largest context consumer in practice | High-signal result fields; bounded, truncation with instructions |
| Hook / CI / wrapper script | Automatically | Free at inference time | Anything that must hold 100% of the time |

The loading difference decides design more than writing style does. In Vercel's Next.js 16 evals a skill **was never invoked in 56% of cases** and scored exactly baseline (53% → 53%, +0pp); an explicit instruction to use it lifted triggering above 95% and the pass rate to 79%; a **compressed 8 KB docs index inside `AGENTS.md` reached 100%** (40 KB compressed 5:1, no loss).

- **Horizontal knowledge** (applies everywhere) → passive context. There is no decision point, so nothing gets skipped.
- **Vertical workflows** (explicitly triggered) → a skill.
- **Bulk detail** → neither. Keep a lightweight identifier (path, query, link) in the prompt and let the agent load it just-in-time with a tool; Claude Code's `CLAUDE.md` + `glob`/`grep` is the hybrid, and Anthropic reports the hybrid as its default because runtime exploration beats a stale index.

**Calibrate.** Vercel's 100% is one framework's docs on one task family. The transferable part is the mechanism — removing the "should I look this up?" decision — not the number.

## 1. What an instruction file is worth

This is the section to read before adding anything.

An agent already has three sources of truth: its training data, the repository itself, and tool results. **An instruction file earns its place only by carrying something none of those three supplies**, and it is never free: ETH Zurich's CTXbench study (4 agents — Claude Code+Sonnet-4.5, Codex+GPT-5.2, Codex+GPT-5.1-mini, Qwen Code+Qwen3-30B; 300 SWE-bench Lite instances and 138 new instances from 12 repositories with developer-committed context files) measured what an instruction file actually costs:

| | Success rate | Steps | Cost |
|---|---|---|---|
| LLM-generated file | −0.5% / −2% (p=0.87 / 0.37) | +2.45 / +3.92 | **+20% / +23%** (p<0.001%) |
| Developer-written file | +2.4% average (p=0.21, n.s.) | +3.34 | up to **+19%** |

And the reason is not that agents ignore instructions — they follow them closely (`uv` was used 1.6× per instance when mentioned versus <0.01× when not; repository-specific tools 2.5× versus <0.05×). The cost is that **following more instructions makes the task harder**: reasoning tokens rose 22% (GPT-5.2) and 10% (GPT-5.1-mini) with LLM-written files.

**What fails.** The same study isolated the popular content category that buys nothing: **repository overviews**. Across both benchmarks and all agents, an overview did not reduce the number of steps before the agent touched a relevant file; for GPT-5.1-mini it *increased* steps, because the agent spent turns searching for the context file and re-reading it even though it was already in context. 100% of Sonnet-4.5-generated files contained one. Also failing: directory listings, architecture prose, and generic best practice ("write tests", "be careful") — all of it either restates the repo or restates the model.

**The distinction that decides the borderline case.** An overview of the repository the agent is *already standing in* fails, because that repo answers it better and the agent ends up hunting for the file instead of reading it. A **map across projects is routing, not an overview**: no repository can say which sibling directories exist or which one implements what, so a session working in project A and asked to change project B has no other source. Such a map still owes only the *navigational* minimum — path, one identity clause, which subdirectory to enter, where the duplicate copies are — not each neighbour's tech stack, architecture or deployment story.

**What passes.** Four categories survived the measurements:

1. **Non-standard conventions** the agent would otherwise guess wrong — the ETH authors' own recommendation is only content "not already present in the README".
2. **Environment facts invisible in the repo** — this container's cwd is on an ephemeral layer; the database is at a path the code does not name.
3. **Routing that changes tool or skill selection** — Vercel's 100% came from an instruction, not an overview, which is why it does not contradict the ETH result.
4. **Version-specific facts absent from training data** — the Next.js 16 APIs in Vercel's suite.

**Two corollaries that are cheap to apply:**

- **Never generate the file with an LLM.** LLM-written files were not merely useless but significantly *worse than nothing*: on CTXbench they lost to developer-written ones by a significant margin (p=0.038) and still cost 20% more. Stronger models did not write better files.
- **Do not duplicate it.** Agents hunt for context files by name and re-read them; a copy in a subdirectory makes them waste steps finding and reading text that is already in context.

**The counter-evidence, stated honestly.** A second study (10 repositories, 124 real PRs ≤100 LoC, Codex+gpt-5.2-codex) found the opposite sign on speed: with `AGENTS.md`, median wall-clock −28.6%, median output tokens −16.6%, mean output −20.1% — while median *input* tokens rose 3.4%. It measured **only** time and tokens, never correctness. So the two are compatible and jointly tell you something sharper than either alone: an instruction file on small tasks makes the agent work *faster per step and write less*, while on longer tasks it produces *more steps and higher total cost with no success gain*. Neither study found a success gain. Treat "it made things faster" as a claim about output volume, not about outcomes.

Practical rule: **add a line only if you can name which of the four categories it belongs to, and measure before/after on tasks that resemble your real ones.**

## 2. Universal rules

### 2.1 Content comes from execution, not imagination

Human-authored skills raise pass rates **+16.6 pp** over 87 tasks / 8 domains / 18 model–harness configurations (33.9% → 50.5%); skills an LLM writes from a general prompt show **no measurable gain**. An evaluation-guided refinement loop closes 47–67% of the gap — never by asking a model to invent a skill from nothing.

Do the task once with the agent, note every correction you made, then extract the pattern. Or synthesise from artefacts that exist: runbooks, incident reports, review comments, patch history.

### 2.2 Evals before prose

First establish what the agent does wrong *without* the text. Four kinds of goal: **outcome** (task completed), **process** (right tool, right order), **style** (conventions), **efficiency** (no thrashing, no token blowup).

- 10–20 prompts is enough to catch regressions; each row `id, should_trigger, prompt`.
- **Negative controls are mandatory** — a prompt that must *not* trigger is the only thing that catches over-eager matching.
- Score the trace, not the answer: commands run, step count, tokens, and `git status --porcelain`.

Changing a prompt without a baseline is indistinguishable from luck.

### 2.3 The delete test

For every sentence: **would the agent get this wrong without it?** If no, cut it. If unsure, test it.

The ETH numbers give this test a price tag: each instruction the agent follows costs steps and reasoning tokens even when it is correct. A file of true-but-unnecessary statements is not neutral — it is a 20% tax.

### 2.4 Say what to do; one rule, one action

A prohibition tells the model what to avoid but not what to do instead, so under pressure it takes the cheapest reading that is not literally forbidden. State the action.

| Instead of | Write |
|---|---|
| "Never report a change as working until you have executed it" | "Run it before you call it done; if you did not run it, say it is untested" |
| "Don't improve adjacent code/comments/formatting" | "Leave adjacent code, comments and formatting as you found them" |
| "No features beyond the ask" | "Build only what the ask requires" |
| "Do not use markdown" | "Your response should be composed of smoothly flowing prose paragraphs" |
| "Handle errors appropriately" | "Every HTTP call gets an explicit timeout — a missing one once hung a run for 464 s" |

The second clause matters as much as the first: the first version of the hard rule above forbade the wrong state and named no right one, so the honest fallback ("say it is untested") was simply absent.

Measured here over 220 sessions and 26,976 shell calls: foreground `sleep` ≥ 60 s accounted for **600 calls and 25.7 hours of blocked wall time** (worst session: 87 calls, 229 minutes). A prose rule against blocking existed; what moved behaviour was naming the banned pattern *and* its replacement. Background-shell adoption rose 0.4% → 2.9% over the period, but that trend is inseparable from habit — the sleep figure is the honest evidence.

### 2.5 Altitude, sections, and the attention budget

Two failure modes bracket the useful range. At one end, **brittle hardcoded logic** ("if the user says X and the file is Y, then do Z") — unmaintainable and it breaks on the first unlisted case. At the other, **vague high-level guidance** ("be careful and thorough") that assumes context the model does not have. Aim for the middle: specific enough to steer, general enough to cover cases you did not anticipate. (Practice claim from a 2025-09 source — discounted, but cheap to follow and consistent with the 2026 evidence that followed-but-unnecessary instructions raise cost.)

Structure helps more than prose does: name the sections (`<background_information>`, `<instructions>`, `## Tool guidance`, `## Output description`) with XML tags or markdown headers, so both you and the agent can see which part a line belongs to.

Context is a **finite attention budget, not free storage**. Recall degrades as context grows ("context rot"), and attention pairs grow n² in token count. The target is the *smallest set of high-signal tokens*, which is not the same as the shortest text — minimal does not mean terse when the behaviour genuinely needs detail.

For examples: curate a **few canonical, diverse** ones. Do not stack a laundry list of edge cases; that is the brittle end of 2.5 wearing an example's clothes.

### 2.6 Progressive disclosure, one level deep

- `SKILL.md` body under **500 lines** (≈5,000 tokens). Past that, split.
- References hang **directly off `SKILL.md`**. Nested references get half-read (`head -100`) and the agent proceeds on partial information.
- Say **when** to read a file: "if the API returns non-200, read `references/api-errors.md`" beats "see `references/`".
- Reference files over ~100 lines need a table of contents, so a partial read still shows the shape.
- **≤3 focused modules beat a large bundle** — measured across the SkillsBench inventory. One skill with references beats several siblings fighting for the same triggers.

### 2.7 Defaults over menus, method over answers

- ✅ "Use `pdfplumber`. For scanned PDFs, `pdf2image` + `pytesseract`."
- ❌ "You can use pypdf, pdfplumber, PyMuPDF, or pdf2image…"

Four equal options make the agent try several; a default makes it act. Likewise teach the method ("read the schema, join on `_id`, apply the user's filters") rather than one instance's answer ("join orders to customers where region='EMEA'").

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

One line fixes it, and it is cheap because it applies to every task: default to making the change, and reserve discussion for when the approach itself is undefined. The mirror image is worth knowing too — if you want analysis rather than edits, say that, because the default is now action.

The same asymmetry explains why "ask if unclear" is a harmful default. Without a threshold it licenses re-planning on every turn; with one ("ask only when the choice is irreversible or expensive — schema, migration, public interface, deletion") it licenses execution and still protects the cases that need a decision.

### 2.11 Not every vendor recommendation transfers

The same guides that produced §2 and §5 also recommend things that are wrong here, and saying which is part of using them honestly:

- **A role sentence** ("you are a senior engineer…"). Anthropic says one sentence focuses tone. It also restates what the rules and environment facts already say, and OpenAI has moved style to context-delegation; on a coding agent it buys little and costs prefix on every turn.
- **An explicit parallel-tool-call block.** Anthropic reports it lifts parallel calling to ~100%, but the harness already batches reads on its own. It is insurance against a problem this setup does not have.
- **Thinking and effort guidance.** Host-controlled. Writing "think step by step" into a rule file does not reach the dial, and on models with adaptive thinking it can suppress it.

The test is the same one as §1: name the failure the instruction prevents, in this setup, and drop it if there is none.

## 3. The prefix is a cache contract

The system prompt and tool definitions form a **static prefix**; user messages, assistant turns and tool results form a growing **trajectory**. Providers cache the prefix's key-value state, and the rule is mechanical, not advisory: *cache reuse requires the entire rendered prefix to match — if content or a relevant setting changes before a breakpoint, everything after that change cannot reuse the cache.*

Concretely, per the provider docs:

- **Dynamic content in the prefix is the classic own-goal.** OpenAI's guide says it outright: put stable instructions and reference material first, and move "timestamps, user-specific content, or other dynamic content" to the end or into later messages. A per-request `Current time:` line in a customer-service system prompt once took time-to-first-token from 0.5 s to 3–5 s and roughly doubled the bill.
- **Tool definitions are part of the prefix**, and the affected settings include tool **names, descriptions, schemas, ordering**, and tool-specific instructions. So: keep definitions stable, and change *availability* rather than definitions — `tool_choice: "none"` or an allow-list instead of removing tools, and append new tools rather than rewriting the list. Dynamically reordering tools by usage invalidates the cache from the first change while making tool selection no better.
- **Don't rewrite history.** Append messages rather than editing earlier turns; summarisation and compaction change the prefix and reset reuse — they are worth it only when the window demands it.
- **Below the minimum cacheable length there is nothing to cache** (1,024 tokens on current OpenAI models). A very short prompt is cheap either way, so this should not push you to pad; it does mean the "be minimal" and "be cacheable" goals only conflict for mid-size prompts.

Why this matters operationally here: this repo's global prompt plus tool definitions are the prefix for **every** session. Every edit is recomputed by every session, and an edit that injects state invalidates the cache on every turn. Batch prompt edits; never interpolate runtime values. (Cache behaviour also differs by upstream: measured on the two enabled providers, `opencode-go`'s DeepSeek channel hits ~99.6% versus ~88% on the reseller — the same prefix discipline, different payback.)

## 4. Position

Attention is not uniform: the start and the end are read, the middle is where content gets lost — a U-shaped curve (Liu et al., TACL 2024).

**This is the document's weakest claim and it is labelled as such.** It rests on a single 2023/2024 measurement, discounted to roughly a quarter under §11's rule, with no 2026 replication here. It is kept because obeying it is free and the failure it prevents is invisible: reordering two lines costs nothing, whereas a buried constraint simply never fires. Follow it; do not cite it as a measured law.

- Critical constraints and the routing table go **first**.
- Current state / next action goes **last** in the message list.
- Never bury the one rule that matters mid-section. This is §2.3 seen from the model's side: a rule that is not read was never a rule.

## 5. Output style

Response style is the most-specified and least-evidenced part of most system prompts. Three findings should reshape what you write.

**A friendly persona costs accuracy.** Fine-tuning five models (Llama-8B and 70B, Mistral-Small, Qwen-32B, GPT-4o) to sound warmer raised error rates by 10–30 pp and made them ~40% more likely to affirm incorrect user beliefs — most strongly when the user's message expressed sadness. The part that matters for prompt authors: the same effect appeared from **system prompting**, smaller and less consistent but the same direction, at up to 14 pp and 12 pp more errors on questions carrying an incorrect user belief. The control condition is the useful one — fine-tuning on the *same* data rewritten cold (direct, concise, emotionally neutral) left accuracy unchanged or slightly better (−3 to +13 pp). So the plain style is the safe style, and "be friendly and encouraging" is not a free nicety. (Nature, 2026-04)

**Vendors have stopped specifying style and started delegating it.** OpenAI's Model Spec revision of 2026-10-29 "retired most of the detailed style guidance", reasoning that style should adapt to the user and the context, while keeping sycophancy as a user-level principle that survives unless explicitly overridden. Practical consequence: no default gives you a length or format you can rely on. If you need one, it goes in your own prompt.

**Current models are already terse; what you need is *which* terseness.** Anthropic reports that its latest models are less verbose and may skip summaries after tool calls unless asked, names Claude Opus 5 as the exception whose visible replies run long and says to prompt explicitly for conciseness because effort settings do not change it, and reports the opposite for Claude Fable 5.1 — it writes *fewer* progress updates during agentic work, so there you ask for progress text *and remove* any instruction telling it to be brief. A style rule copied from one model can be exactly wrong on the next, which is why the recency rule in §11 matters most here.

### What the canonical concise style looks like

Claude Code ships one, and its shape is the reusable part:

- The **first sentence states what happened or what the answer is**.
- It **drops the lead-in, the step-by-step narration, and the closing recap**.
- A simple question gets **one to three sentences**.
- The engineering work is done just as thoroughly as without the style.

Business writing calls this BLUF — bottom line up front.

### The carve-outs are the design, not an afterthought

Every published concise style keeps exceptions, and the same ones:

- Anything the user explicitly asked to have explained.
- **Error reports, failing test output, security warnings, and confirmations before destructive actions** keep their complete content — exactly the cases where trimming causes a wrong decision.
- The reasoning needed to approve a risky step.
- Progress on long-running work, when silence reads as "stuck".

A brevity rule without these exceptions reliably truncates the one class of message that must not be truncated. Write the exceptions together with the rule, not later.

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

- Repository overviews, directory listings, architecture prose — measured not to help (§1).
- Reference material (flags, commands, pitfalls) → `docs/`, linked from one line.
- Anything duplicated from a tool description, or the agent can read from the repo.

### Wording is load-bearing

Two measured cases. First, **the way the request is phrased decides whether work happens**: a request in question form gets a suggestion, so §2.10's default-to-action line exists. Second, Vercel measured that the *same* skill with the *same* docs behaved differently purely from the trigger instruction: "You MUST invoke the skill" made the agent read docs first and miss project context; "explore the project first, then consult the skill" made it build a model first and use docs as reference — and it caught changes the first variant missed entirely. Write the **sequence** you want; emphasis is not a substitute for ordering.

### Rule format

```
**Bold action.** 1–3 sentences: what to do, the concrete command, the measured consequence.
```

A rule stated as "never block on a long script" scored 2.9% adoption; "`sleep N` is banned; use `--watch` or background it" is checkable in a log.

### Budget

Project convention, not a measurement: keep the global prompt under ~120 lines. The real cost is §3 — every line is recomputed whenever it changes — and §1, where unnecessary-but-followed instructions cost steps and reasoning.

## 7. Skills

### Description: when, not what

The description is injected for every skill, every turn, and it is the only thing the model sees before deciding.

**A summary invites the agent to act on the summary and skip the skill.** So:

- **Lead with the trigger**, in the user's own words, including Chinese colloquial forms when that is how the ask arrives.
- One short clause of *what* — Anthropic and agentskills.io ask for "what + when"; Sam McLeod argues for when-only. Lead with when; keep what to a single clause and never actionable enough to replace loading the skill.
- **30–55 words**, imperative, third person ("Processes…", "Use when…"), assertive enough to fire.
- **Domain anchors only**: file extensions, artefact names, internal system names. Generic verbs ("review", "analyse", "improve") steal other skills' triggers.
- Name the neighbour and the boundary when one exists.
- One line, quoted, under 1024 characters. No `>-` block scalars, no XML tags.

If a skill must not be model-invoked, hide it in frontmatter rather than writing a weaker description.

### Body

Ordered by fragility, not narrative:

1. **Gotchas first.** Counter-intuitive environment facts are the highest-value content in most skills. Every correction you make to the agent belongs here.
2. **Workflow.** Numbered steps, each with its command. For long procedures, tell the agent to copy the checklist and tick it off; agents drift and declare done early. End multi-step work with a review pass over the whole deliverable.
3. **Verification.** A loop — do the work, run the validator, fix, repeat — beats describing what good looks like. For batch or destructive work insert a plan file between "decide" and "act": produce it, validate it against the source of truth, then execute.
4. **Templates** for output format; agents pattern-match against structure better than against prose.
5. **References and scripts.** Bulky detail in `references/`, deterministic work in `scripts/` (`uv run scripts/x.py`). Say whether to *run* a script or *read* it as reference.

**Never put "when to use this" in the body.** If the agent is already reading it, it is too late.

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
- Loading injects the body without frontmatter, the skill's base directory, and up to ten supporting file paths — supporting contents are not auto-loaded, which is what makes progressive disclosure work.
- `@skill-id` loads a skill explicitly. Permissions use the `skill` action with the ID as resource (`allow` / `ask` / `deny`); `deny` hides it entirely.
- v2 does **not** enforce description length, name/directory agreement, or kebab-case. Portability is your responsibility.

## 8. Tool descriptions

The most expensive and least maintained text in most agent systems: it lives in the cached prefix, competes with every other tool, and was usually written once by whoever wrapped the API. Anthropic's finding is that **small refinements here produce dramatic behaviour changes** — description work separated a mid-pack from a state-of-the-art SWE-bench result, and a web-search `query` description that invited appending `2025` silently biased every search.

### Design the tool, not the wrapper

- `search_contacts` beats `list_contacts`: an agent reading a full list token-by-token is doing brute-force search with the most expensive scanner in the system.
- Consolidate chains: `schedule_event` (find availability, then schedule) instead of `list_users` + `list_events` + `create_event`; `search_logs` instead of `read_logs`; `get_customer_context` instead of three lookups.
- **Bloated tool sets are a top failure mode.** If a human engineer cannot say which tool applies, the agent cannot either. Every tool also costs prefix tokens forever.

If two descriptions could swap without changing behaviour, one tool is wrong.

### Names

- **Namespace by service and resource**: `asana_search`, `jira_search`, `asana_projects_search`. Prefix vs suffix has a non-trivial measured effect on tool choice, and the direction varies by model — pick by eval.
- **Unambiguous parameters**: `user_id`, not `user`. Prefer `enum` over free text. Enforce with a strict schema; the schema survives a lazy description.
- Verb-on-object names (`search_logs`, `send_message`) are self-documenting; `logs` or `handle` are not.

### Write it like onboarding a new hire

State the implicit knowledge you would say out loud:

- **When to call it and when not to** — "use for a known customer; with only a name, call `search_customer` first."
- **Niche terminology and formats** the tool expects, with one concrete example.
- **Relationships between resources** — "a thread reply needs `thread_ts` from a *detailed* `get_channel` response."
- **Boundaries with siblings** — "raw logs: `search_logs`; this returns aggregates only."
- **What it returns**, in the vocabulary the agent will use afterwards.
- **Side effects** — destructive, open-world, paid. MCP tool annotations exist for this.

Past ~10 lines, it should be two tools or a smaller surface. (The output-size guidance below is 2025-09 and version-pinned — re-check caps against current tooling before hard-coding a number; the *direction* — bound by default — is what to keep.)

### Output is part of the description

Tool results are the largest context consumer, and they are text you control:

- **High signal only.** Drop identifiers the agent cannot act on (`uuid`, `256px_image_url`, `mime_type`); prefer `name`, `image_url`, `file_type`.
- **Resolve identifiers to words.** Returning `Jane Doe` alongside `usr_8f3ac1` measurably cuts retrieval hallucination; keep raw IDs behind `response_format: detailed` when a follow-up call needs them. Concise vs detailed cost 72 vs 206 tokens in Anthropic's Slack example — ~3× on the dominant consumer.
- **Bound by default**: pagination, filtering, range selection, truncation, with sensible defaults. Claude Code caps a response at 25k tokens.
- **Truncation and errors are instructions.** No opaque codes or tracebacks: say what to do next, and for validation errors list the valid values — `Field 'signature_date' not found — available: customer_name, order_total, signature_date_signed`. That one change lets the agent self-correct instead of retrying blindly.

### Measure tool use, not just task success

Calls per task (many redundant → bad pagination defaults), error rate per parameter (high → ambiguous description or schema), tokens per task (output too verbose), and tools never called (description does not fire, or the tool is unnecessary).

## 9. Review checklist

- [ ] Can you state what the agent does wrong **without** this text? Was a baseline measured?
- [ ] Every added line belongs to one of §1's four categories — not an overview, not a restatement of the repo.
- [ ] Every rule names a concrete action, path, command or threshold, and every prohibition names what to do instead (§2.4).
- [ ] The default action is stated: execute, or discuss (§2.10).
- [ ] The delete test was applied sentence by sentence, with §1's 20% price in mind.
- [ ] Rules below ~10% adoption were rewritten with a named replacement, or deleted.
- [ ] Routing exists where the artefact must be discovered (a line in `AGENTS.md`, not a better description alone).
- [ ] Trigger tests include negative controls.
- [ ] References hang one level deep, each with *when* to read it.
- [ ] No dynamic content in the prefix; tools stable and append-only; critical rules first, current state last.
- [ ] Response-style rules carry their carve-outs: requested explanations, error reports and failing test output, security warnings, destructive-action confirmations, and progress on long jobs.
- [ ] No time-sensitive statements; terminology consistent.
- [ ] **The edit reached the file that is actually read.** After changing the global prompt, confirm the volume copy is the one you edited: `grep -c '^# Coding Guidelines' $XDG_CONFIG_HOME/opencode/AGENTS.md` returns 1, and it matches `opencode-config/opencode/AGENTS.md` byte for byte. **Docs the prompt routes to are mirrored, not linked** — here `scripts/sync-agent-docs.sh` copies them from `docs/` into the baked config tree, so a doc edit needs the script re-run or the prompt keeps routing to the previous text. Two files named `AGENTS.md` sit one `cp` apart; a wrong-source copy is silent and only a grep finds it.
- [ ] Deterministic repeated work is a script, not an instruction.
- [ ] Tool: name says the task, params unambiguous, output bounded, errors actionable, boundaries stated.
- [ ] Every rule's source is dated; a rule resting only on a pre-2026 source is phrased as a hypothesis, not a `MUST`.
- [ ] Third-party skills and tools were read in full before install; no secrets; least privilege.

## 10. This container's constraints

- Global prompt: `opencode-config/opencode/AGENTS.md` → baked to `/opt/opencode-config`, synced to `$XDG_CONFIG_HOME/opencode/AGENTS.md` at boot, **overwriting** the volume copy. Editing the volume file alone is lost on redeploy. Never `cp AGENTS.md` from the repo root over it — that is the *project* prompt and doing so wipes the global rules.
- That file plus the tool definitions are the **cached prefix** for every session (§3): batch edits, never interpolate runtime values.
- Skills: `opencode-config/opencode/skills/<name>/`, synced the same way. The sync **copies, never deletes** — removing or renaming needs an explicit cleanup in `entrypoint.sh`.
- Devcontainer copy lives at `.devcontainer/opencode/skills/` and does **not** sync with the Railway one; both must change (Railway first).
- No same-named command: a command shadows the native `/skill` path.
- Skill persistent data goes on `/workspace`, never inside the skill directory — that directory is replaced by the next image.
- Vendor third-party skills with their LICENSE and put local adaptations in a preamble at the top of `SKILL.md`.

## 11. Sources, dated, and how much weight each carries

**Recency rule: a reference loses half its weight for every year before 2026.** Agent behaviour, tool-call formats and model defaults change faster than the principles written about them, so a 2024 measurement is not evidence about today's model — it is a hypothesis that happened to be true once.

Two operational consequences:

- A rule supported **only** by a pre-2026 source is phrased as a hypothesis and re-verified before anyone enforces it. Where a pre-2026 claim has since been re-grounded in a 2026 source, the rule cites the 2026 one and the older paper is demoted to history.
- A pre-2026 source is never the sole basis for a hard constraint (a `MUST`, a budget, a validator). Version-pinned specifics are treated as already-expired: a pricing table or a per-model quirk from 2025 is documentation of the past, not a rule.

Applied below. `2025-09` sources keep roughly half their original weight; the 2023/2024 attention paper is retained only because no 2026 study in this set re-measured positional effects, and it is marked as such.

| Source | Published | Contributed | Weight / caveat |
|---|---|---|---|
| [Nature — warm models are less accurate](https://www.nature.com/articles/s41586-026-10410-0) | 2026-04 | Warmth fine-tuning: +10–30 pp error, ~40% more sycophancy; **also from system prompting**, up to 14 pp on incorrect-belief items; cold (direct, concise) style unchanged or better | **Highest for §5** — 5 architectures, controlled cold-style ablation, and it isolates system-prompt effects from fine-tuning. Caveat: QA benchmarks and ShareGPT-derived data, not agent transcripts |
| [OpenAI — Model Spec](https://model-spec.openai.com/2026-10-29.html) | 2026-10, rev. 2025-02 | Retired most detailed style guidance; style adapts to context; sycophancy stays a user-level principle; instructions carry explicit authority levels | High for §5's "no default length exists" and for the authority-level idea. It states intent, and OpenAI says its models do not yet fully reflect it — a spec is not a measurement |
| [Anthropic — prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices) | living doc, 2026-10 | Models are already concise; Opus 5 runs long → prompt for conciseness; Fable 5.1 needs the opposite; say what to do not what not to do; prompt formatting leaks; over-constraining suppresses needed structure; soften over-aggressive wording; explain why | **Highest for §5's actionable detail** — per-model notes are the part that goes stale fastest, so re-read after every model change |
| [Claude Code — output styles](https://docs.claude.com/en/docs/claude-code/output-styles) | living doc | The Concise style: first sentence = the answer, no lead-in/narration/recap, simple question 1–3 sentences, **full length for requested explanations and safety-critical content**; style is instruction, not enforcement | High for §5 — it is the vendor's own shipped style, and the carve-out list is what makes it safe |
| [ETH — Evaluating AGENTS.md (2602.11988)](https://arxiv.org/abs/2602.11988) | 2026-02, rev. 2026-09 | Context files cost ~20% with no success gain; overviews specifically useless; agents re-read files; LLM-generated worse than developer-written | **Highest for §1** — 4 agents, paired design, held-out repositories, and the only study measuring success *and* cost together. Caveat: Python, niche repos, one sample per instance |
| [AGENTS.md efficiency (2601.20404)](https://arxiv.org/abs/2601.20404) | 2026-01 | −28.6% median runtime, −16.6% median output tokens; input tokens slightly up | High but **narrow**: efficiency only, **no correctness measurement**, PRs ≤100 LoC. Does not contradict the ETH result; measures a different thing |
| [Anthropic — writing tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents) | 2025-09 | Task-shaped tools; namespacing; output signal/IDs/pagination; `response_format`; actionable errors; description = onboarding | **Discounted to ~half by the recency rule**, and it is the only source for §8's specifics. Still the best-tested account of tool design (held-out sets on their own Slack/Asana MCP servers), and §8's mechanisms are corroborated by the 2026 ETH finding that tool mentions steer behaviour (2.5× vs 0.05×). Re-verify the output-size advice against current tooling before hard-coding a cap |
| [Anthropic — effective context engineering](https://www.anthropic.com/research/effective-context-engineering-for-ai-agents) | 2025-09 | Right altitude; named sections; smallest high-signal token set; context rot; just-in-time + hybrid retrieval; bloated tool sets | **Discounted to ~half.** §2.5's altitude framing and §0's hybrid-retrieval point rest on it; both are practice claims, not measurements, and neither has a 2026 replication in this set |
| [agentskills.io — best practices](https://agentskills.io/skill-creation/best-practices) | living spec | Extract from a hands-on task; refine from traces; delete test; coherent units; fragility; gotchas; plan-validate-execute | High — the spec's own guidance, kept current. Treated as a living document and re-read when the spec changes, not trusted by publication date |
| [Anthropic — skill authoring](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) | living doc | 500-line / 1024-char budgets; third person; one-level references; TOC; "old patterns"; terminology; checklists | High — vendor spec, the only detailed treatment of large-skill structure. The numeric budgets are the part most likely to age; re-check them against the current spec before enforcing |
| [Vercel — `AGENTS.md` beats skills](https://vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals) | 2026-01 | 56% never invoked, +0pp; 95%+ / 79% with routing; 8 KB index 100%; 40→8 KB; wording fragility | High for §0 but **narrow** — one framework's docs, one task family. The mechanism transfers, the 100% does not |
| [OpenAI — prompt caching](https://platform.openai.com/docs/guides/prompt-caching) | living doc | Exact-prefix matching; `tools` including **ordering** invalidate; append-only tool updates; dynamic content at the end; minimum cacheable length | Highest for §3 — this is the mechanism, not a claim. Numbers in it (minimum length, write multipliers) are version-pinned and must be re-read, not remembered |
| [OpenAI — testing skills with evals](https://developers.openai.com/blog/eval-skills) | undated | Four goal categories; 10–20 prompt CSV with negative controls; trace-based checks; thrashing / token / cleanliness signals | High for §2.2 — concrete and runnable. **Undated page**: treated as current tooling guidance, and it agrees with the dated 2026 papers on method, which is why it is not discounted |
| [SkillsBench (2602.12670)](https://arxiv.org/abs/2602.12670) | 2026-02, rev. 2026-06 | +16.6 pp over 87 tasks / 18 configs; ≤3-module skills beat bundles; small model + skills ≈ large model alone | High — paired evaluation, deterministic verifiers |
| [SkillAxe (2606.10546)](https://arxiv.org/abs/2606.10546) | 2026-06 | Human +16.2 pp vs LLM-authored no gain; four diagnostic dimensions; 47–67% gap closed by refinement | Medium-high — the four dimensions are the useful part; the self-refinement pipeline is their product |
| [Lost in the Middle (TACL 2024)](https://aclanthology.org/2024.tacl-1.9/) | 2023-07 / 2024 | U-shaped positional performance; start and end are read | **Heavily discounted (≈1/4 remaining under the rule)** and now the weakest link in this document: §4 rests on it alone, no 2026 study here re-measured positional effects, and every model generation changes attention behaviour. Keep §4 as a cheap-to-follow hypothesis (putting critical rules first costs nothing), not as a measured law. Label it in any hard requirement |
| [Sam McLeod — common pitfalls](https://smcleod.net/2026/07/writing-and-reviewing-agent-skills-common-pitfalls) | 2026-07 | Description = trigger only, 30–55 words; "when to use" in body is too late; scripts over inference; third-party review | Medium — practitioner experience, no measurements, but current and consistent with spec guidance |
| [OpenCode — skills](https://opencode.ai/docs/skills/) | living doc | Discovery paths, path-derived IDs, `autoinvoke`, precedence, load semantics, permissions | Highest for platform facts — the runtime we use. Re-read after every OpenCode bump; the pinned version decides, not the doc |
| 李博杰《深入理解 AI Agent》第 2 章 | 2026 (chapter undated) | Static prefix vs trajectory; dynamic injection cost; lost-in-the-middle; tool reordering | Medium — the structural model is sound and §3 now backs it with a primary source; its cache ratios and per-model `reasoning_content` rules are vendor specifics, already expiring |
| [ai-agents-from-zero 1-2](https://github.com/didilili/ai-agents-from-zero/blob/main/1-2-%E6%8F%90%E7%A4%BA%E8%AF%8D%E5%B7%A5%E7%A8%8B%E5%9F%BA%E7%A1%80.md) | undated (2025–26) | Delimiters separating instruction from data; system = stable, user = current task; output format as a contract | Low-medium and undated — its six-element template is for one-shot content prompts and does not transfer to agent instructions |
| [ai-agents-from-zero 13](https://github.com/didilili/ai-agents-from-zero/blob/main/13-%E6%8F%90%E7%A4%BA%E8%AF%8D%E4%B8%8E%E6%B6%88%E6%81%AF%E6%A8%A1%E6%9D%BF.md) | undated (2025–26) | Stable vs dynamic split; history resent; prompts externalised for versioning | Low — mostly framework mechanics |
| [prompt-optimizer](https://github.com/linshenkx/prompt-optimizer) (41.5k★) | living repo | Prompts as versioned assets; optimise → evaluate → compare | Low — a product, not a source of principles; one-click "optimisation" tends to inflate prompts, which §2.3 rejects |
