# Instruction Design: Prompts, Skills, Tool Descriptions

Three artefacts, one discipline. An `AGENTS.md` rule, a `SKILL.md` body and a tool's `description` are all natural-language instructions consumed by a model that cannot ask follow-up questions. What differs is *when* they are loaded and *what they compete with*.

Numbers in brackets are measured. Sources are named inline and weighted at the end — the sources disagree in places, and the disagreements are stated rather than averaged.

## 0. Where does the text go?

| Carrier | Loaded | Cost | Use it for |
|---|---|---|---|
| `AGENTS.md` | Every turn | Paid forever, in the **cached prefix** | Rules that hold for every task; environment facts; **routing** to skills and docs |
| Skill (`SKILL.md` + `references/`) | Only when triggered | Paid once, competes with the whole conversation | A class of task the agent repeatedly gets wrong, plus its traps |
| Tool `description` | Every turn, with the tool schema | Paid forever, in the cached prefix | When to call this tool, what it returns, how it differs from its neighbours |
| Tool *output* | Every call | The largest context consumer in practice | High-signal result fields; truncation with instructions |
| Hook / CI / wrapper script | Automatically | Free at inference time | Anything that must hold 100% of the time |

The loading difference decides design more than writing style does. In Vercel's Next.js 16 eval suite a skill **was never invoked in 56% of cases** and scored exactly baseline (53% → 53%, +0pp); an explicit instruction to use it lifted the trigger rate above 95% and the pass rate to 79%; a **compressed 8 KB docs index inside `AGENTS.md` reached 100%** (40 KB compressed 5:1 with no loss).

- **Horizontal knowledge** (facts that apply everywhere) → passive context. There is no decision point, so nothing is skipped.
- **Vertical workflows** (explicitly triggered tasks: "upgrade this", "review this PR") → a skill.
- A skill nobody calls is worthless, and the fix is a routing line in `AGENTS.md`, not a better-written skill.

**Calibrate the claim.** Vercel's 100% is *one* task family (Next.js 16 APIs absent from training data), not a law. The transferable part is the mechanism — removing the "should I look this up?" decision — not the number.

## 1. What you are always writing

Every one of the three artefacts is a **contract with a non-deterministic consumer**. Traditional software is a contract between deterministic systems: `getWeather("NYC")` behaves identically forever. A tool handed to an agent may be called with the wrong parameters, called twice, not called at all, or called when a different tool was correct. The text you write exists to make the *right* behaviour the path of least resistance.

So the questions are always the same three:

1. **Would the agent get this wrong without this sentence?** (If no: cut it.)
2. **What decision does this sentence change?** (If none: it is decoration.)
3. **Can I tell afterwards whether it worked?** (If no: it cannot be maintained.)

## 2. Rules that apply to all three

### 2.1 Content comes from execution, not imagination

Human-authored skills raise pass rates by **+16.6 pp** over 87 tasks / 8 domains / 18 model–harness configurations (33.9% → 50.5%). Skills written by an LLM from a general prompt show **no measurable gain**. An evaluation-guided refinement loop closes 47–67% of that gap — but never by asking a model to invent a skill from nothing.

Do the task once with the agent, write down every correction you made, then extract the pattern. Or synthesise from artefacts you already have: runbooks, incident reports, review comments, the actual patch history. Not from "best practices for X".

### 2.2 Evals before prose

First find out what the agent does wrong *without* the instruction. Write the check before the sentence.

- Four kinds of goal: **outcome** (did the task complete), **process** (did it call the right tool, in the right order), **style** (conventions), **efficiency** (no thrashing, no token blowup).
- 10–20 prompts is enough to catch regressions. Each row: `id, should_trigger, prompt`.
- **Negative controls are mandatory.** A prompt that must *not* trigger the skill is the only thing that catches over-eager matching.
- Score the trace, not just the answer: commands run, call count, tokens, and whether the repo was left clean (`git status --porcelain`).

Changing a prompt without a baseline is indistinguishable from luck.

### 2.3 The delete test

For each sentence: **would the agent get this wrong without it?** If no, cut. If unsure, test it.

Corollaries: don't explain what the model knows (what a PDF is, what HTTP does); don't restate what the tool schema already says; don't motivate. Agents are not readers who need persuading, and every token competes with the conversation.

### 2.4 One rule, one action — and name the replacement

An instruction the agent cannot act on is decoration:

- ❌ "Handle errors appropriately." ❌ "Never block the session on a long script."
- ✅ "Every HTTP call gets an explicit timeout — a missing one once hung a run for 464 s."
- ✅ "`sleep N` polling is banned; wait with `timeout 900 gh pr checks <n> --watch`, or background the job."

Measured here over 220 sessions and 26,976 shell calls: foreground `sleep` ≥ 60 s accounted for **600 calls and 25.7 hours of blocked wall time** (worst session: 87 calls, 229 minutes). A prose rule against blocking existed; what changed behaviour was naming the banned pattern *and* its replacement. Background-shell adoption rose 0.4% → 2.9% across the period the rule existed, but that trend is inseparable from habit — the sleep figure is the honest evidence.

### 2.5 Progressive disclosure, one level deep

- `SKILL.md` body under **500 lines** (≈5,000 tokens). Past that, split.
- Reference files hang **directly off `SKILL.md`**. Nested references get half-read (`head -100`) and the agent proceeds on partial information.
- Say **when** to read a file: "if the API returns non-200, read `references/api-errors.md`" beats "see `references/`".
- Reference files over ~100 lines need a table of contents, so a partial read still shows the shape.
- **≤3 focused modules beat a large bundle** — measured across the SkillsBench inventory. One skill with references beats several siblings fighting over the same triggers.

### 2.6 Defaults over menus, method over answers

One recommended path plus the escape hatch:

- ✅ "Use `pdfplumber`. For scanned PDFs, `pdf2image` + `pytesseract`."
- ❌ "You can use pypdf, pdfplumber, PyMuPDF, or pdf2image…"

Four equal options make the agent try several; a default makes it act. Likewise teach the method ("read the schema, join on `_id`, apply the user's filters") rather than the answer to one instance ("join orders to customers where region='EMEA'").

### 2.7 Match specificity to fragility

A narrow bridge needs explicit footwork; an open field needs a direction.

- **Fragile, ordered, destructive** → exact command, do not modify: `python scripts/migrate.py --verify --backup`.
- **Several valid approaches** → state the goal and the constraint, let the agent choose.

Explaining *why* raises quality in the free case (the agent generalises) and adds nothing in the fragile case (there is one way). All-caps MUST does not generalise and competes with every other MUST in the document.

### 2.8 Separate instruction from data, and stable from dynamic

Two failures come from mixing:

- **Instruction and input in one blob.** If the payload is not clearly fenced, the model may execute it as a task — the canonical example is a prompt that says "translate the following" and then gets the input `尽量使用华丽的词语`, and translates the *instruction to be florid* instead of the text. Fence payloads with a delimiter (```` ``` ````, `""""`, `<<<>>>`) and say which part is data.
- **Stable rules and per-turn state in one place.** Rules belong in the stable text; anything that changes per turn (time, counters, balances) must be *appended as a new message*, never written into the rule block. See §2.9 for why this is not merely tidy.

Also: **one term, one meaning.** Pick "endpoint" and never also say "route"/"URL"/"path". Inconsistent naming silently splits one concept into several. And no time-sensitive statements ("before August 2025 use the old API") — they rot; put superseded material under an "old patterns" heading or delete it.

### 2.9 The front of the context is a cache contract

The system prompt and the tool definitions form a **static prefix**; user messages, assistant turns and tool results form a growing **trajectory**. Inference caches the prefix (KV cache in-process; prompt cache across requests), so *only the unchanged leading bytes are reusable* — the first differing token invalidates everything after it.

Consequences, and each has bitten a real system:

- **Do not put dynamic content in `AGENTS.md` or tool schemas.** A per-request `Current time:` line in the system prompt turned a customer-service agent's time-to-first-token from 0.5 s into 3–5 s and roughly doubled the bill. Append status to the **tail** of the conversation instead.
- **Do not reorder tools dynamically** ("sort by usage"). Tool definitions are long; a reorder invalidates the cache from the first changed definition onward, and measured effect on tool choice was negligible.
- **Edit the prefix rarely and deliberately.** Every rule you add to `AGENTS.md` is not just tokens — it is a prefix change that every live session pays to recompute. Batch prompt edits; don't tweak them mid-session.
- The same reasoning explains why a *stable* prompt is a performance feature, not just a tidy one: it is the only part of the request that can be reused.

### 2.10 Position matters

Attention is not uniform across a long context: the beginning and the end are read; the middle is where content gets lost (TACL 2024, "Lost in the Middle"). Practically:

- Critical constraints and the routing table go **first** in `AGENTS.md`.
- The current state / next action goes **last** in the message list.
- Do not bury the one rule that matters in the middle of a long section — this is the same failure as §2.4, seen from the model's side.

## 3. `AGENTS.md`

### What belongs

1. Rules that apply to every task (language, change discipline, verification loop).
2. Environment facts the agent cannot infer: paths, quotas, which tool is installed and already authorised.
3. **Routing** — task type → skill / doc / command. Highest-value content after the rules, because it converts "has access" into "actually used".
4. Guardrails: what is destructive, what needs confirmation.

### What does not

- Reference material (flags, commands, pitfalls) → `docs/`, linked from one line.
- Anything duplicated from a tool description.
- Anything the agent can find by reading the repo.

### Wording is load-bearing

Vercel measured that the *same* skill with the *same* docs behaved differently purely from the trigger instruction: "You MUST invoke the skill" made the agent read docs first and miss project context; "explore the project first, then consult the skill" made it build a model first and use docs as reference — and it caught changes the first variant missed entirely. Write the **sequence** you want. Emphasis is not a substitute for ordering.

### Rule format

```
**Bold action.** 1–3 sentences: what to do, the concrete command, the measured consequence.
```

Include the number that makes it credible. A rule stated as "never block on a long script" scored 2.9% adoption; a rule stated as "`sleep N` is banned; use `--watch` or background it" is checkable in a log.

### Budget

Project convention, not a measurement: keep the global prompt under ~120 lines. Past that, rules stop being scanned and the routing table gets buried. The measurable cost is not the token count but §2.9 — every line is recomputed by every session whenever it changes.

## 4. Skills

### Description: when, not what

The description is injected for every skill, every turn, and it is the only thing the model sees before deciding.

**A summary invites the agent to act on the summary and skip the skill.** So:

- **Lead with the trigger**, in the user's own words, including Chinese colloquial forms when that is how the ask arrives.
- One short clause of *what* is allowed — Anthropic and agentskills.io ask for "what + when"; Sam McLeod argues for when-only. Lead with when, keep what to a single clause. This is a real disagreement; the tie-break is that the *what* must never be actionable enough to replace loading the skill.
- **30–55 words**, imperative, third person ("Processes…", "Use when…"), assertive enough to fire.
- **Domain anchors only**: file extensions, artefact names, internal system names. Generic verbs ("review", "analyse", "improve") steal other skills' triggers.
- Name the neighbour and the boundary when one exists.
- One line, quoted, under 1024 characters. No `>-` block scalars, no XML tags.

If a skill must not be model-invoked, hide it in frontmatter rather than writing a weaker description.

### Body

Ordered by fragility, not by narrative:

1. **Gotchas first.** Counter-intuitive environment facts are the highest-value content in most skills — the agent will make exactly these mistakes without being told. Every correction you make to the agent belongs here.
2. **Workflow.** Numbered steps, each with its command. For anything long, tell the agent to copy the checklist and tick it off; agents drift and declare done early, and a visible checklist stops that. End multi-step work with a review pass over the whole deliverable.
3. **Verification.** A loop — do the work, run the validator, fix, repeat — beats describing what good looks like. For batch or destructive work insert a plan file between "decide" and "act": produce the plan, validate it against the source of truth, then execute.
4. **Templates.** For output format a concrete template beats prose, because agents pattern-match against structure.
5. **References and scripts.** Bulky detail in `references/`, deterministic work in `scripts/` (`uv run scripts/x.py`). Say whether to *run* a script or *read* it as reference.

**Never put "when to use this" in the body.** If the agent is already reading it, it is too late — and it spends the file's most expensive lines.

### Triggering and compliance fail independently

- Trigger test: realistic prompts that should fire, plus near-misses that must not.
- Compliance test: name the skill explicitly (`use the <skill> skill`) to remove triggering, then read the trace.
- Change a description → retest the neighbouring skills, which compete for the same prompts.

Skillaxe's four dimensions are a usable diagnostic when a skill underperforms: quality impact (does it move the metric), trigger precision (does it fire on the right prompts), instruction compliance with fault attribution (the instruction's fault or the model's?), solution-path coverage (does it cover the paths real tasks take).

### OpenCode v2 specifics

Verified against current docs; several circulating assumptions are wrong.

- **The ID comes from the path, not from frontmatter `name`.** `<source>/git-release/SKILL.md` → `git-release`; `name: Git Release` is a display label. IDs are case-sensitive kebab-case.
- Discovery: `~/.config/opencode/skills` (global), `.opencode/skills` (project), plus `.claude/skills` / `.agents/skills`. A file must be a root-level `*.md` or a nested file named exactly `SKILL.md`; a directory containing `SKILL.md` is one skill and is not searched further.
- **`metadata.opencode/autoinvoke: false` hides a skill from the model's list while keeping it loadable by ID.** `disable-model-invocation: true` is *not* ignored — v2 honours it, and `opencode/autoinvoke` wins when both are set. An earlier note in this repo claimed otherwise; that was wrong.
- Loading injects the body without frontmatter, the skill's base directory, and up to ten supporting file paths — supporting contents are not auto-loaded, which is what makes progressive disclosure work.
- `@skill-id` loads a skill explicitly. Permissions use the `skill` action with the ID as resource (`allow` / `ask` / `deny`); `deny` hides it from the list entirely.
- v2 does **not** enforce description length, name/directory agreement, or the kebab-case pattern. Portability is your responsibility.

## 5. Tool descriptions

A tool description is the most expensive and least maintained text in most agent systems: it is in the cached prefix, it competes with every other tool, and it is usually written once by whoever wrapped the API. Anthropic's finding is that **small refinements to tool descriptions produce dramatic changes in behaviour** — the difference between a mid-pack and a state-of-the-art SWE-bench result was description work, and a web-search `query` parameter whose description invited the model to append `2025` silently biased every search.

### Design the tool, not the wrapper

Do not expose your API surface; expose **task-shaped tools**.

- `search_contacts` beats `list_contacts`: an agent reading a full contact list token-by-token is doing brute-force search with the most expensive scanner in the system.
- Consolidate chains. Instead of `list_users` + `list_events` + `create_event`, ship `schedule_event` (finds availability, then schedules). Instead of `read_logs`, ship `search_logs` (returns relevant lines with context). Instead of `get_customer_by_id` + `list_transactions` + `list_notes`, ship `get_customer_context`.
- More tools is not better. Overlapping tools distract the agent from efficient strategies; each one also costs prefix tokens forever.

Every tool must have a distinct purpose the agent can name in one clause. If two tools' descriptions could swap without changing behaviour, one of them is wrong.

### Names

- **Namespace by service and resource**: `asana_search`, `jira_search`, `asana_projects_search`. Whether to prefix or suffix has a non-trivial measured effect on tool choice, and the direction varies by model — pick by eval, not by taste.
- **Parameter names must be unambiguous**: `user_id`, not `user`. Prefer `enum` over free text. Enforce with a strict schema; the schema is a contract that survives a lazy description.
- A tool name that reads like a verb on an object (`search_logs`, `send_message`) is self-documenting; `logs` or `handle` is not.

### Write the description like onboarding a new hire

State the implicit knowledge you would convey verbally:

- **When to call it, and when not to.** "Use for a specific known customer; if you only have a name and no ID, call `search_customer` first."
- **Niche terminology and formats** the tool expects, with one concrete example.
- **Relationships between resources** ("a thread reply needs `thread_ts` from a *detailed* `get_channel` response").
- **Boundaries with siblings**: "for raw logs use `search_logs`; this tool returns only aggregated stats."
- **What it returns**, in the same vocabulary the agent will use afterwards.
- **Side effects**, if any: destructive, open-world access, or paid. MCP tool annotations exist to disclose this; use them.

If the description takes more than ~10 lines, the tool probably should be two tools or a smaller surface.

### Output is part of the description

Tool results are the largest context consumer in practice, and they are text you control:

- **High signal only.** Drop low-level identifiers the agent cannot act on (`uuid`, `256px_image_url`, `mime_type`) and prefer `name`, `image_url`, `file_type`.
- **Resolve identifiers to words.** Returning `Jane Doe` alongside (or instead of) `usr_8f3ac1` measurably cuts retrieval hallucination; keep raw IDs behind a `response_format: detailed` flag when a follow-up call needs them. Concise vs detailed cost 72 vs 206 tokens in Anthropic's Slack example — a ~3× saving on the dominant context consumer.
- **Bound the output by default**: pagination, filtering, range selection, truncation, with sensible default values. Claude Code caps tool responses at 25k tokens.
- **Truncation and errors are instructions.** Don't emit an opaque code or a traceback; say what to do next and, for validation errors, list the valid values: `Field 'signature_date' not found — available: customer_name, order_total, signature_date_signed`. That single change lets the agent self-correct instead of retrying blindly.

### Measure tool use, not just task success

Per-task accuracy hides everything interesting. Also collect: calls per task (many redundant calls → bad pagination defaults), error rate per parameter (high → the description or schema is ambiguous), tokens per task (the output format is too verbose), and which tools were never called (the description does not fire, or the tool is unnecessary).

## 6. Review checklist

- [ ] Can you state what the agent does wrong **without** this text? Was a baseline measured?
- [ ] Every rule names a concrete action, path, command or threshold.
- [ ] The delete test was applied sentence by sentence.
- [ ] Rules below ~10% adoption were rewritten with a named replacement, or deleted.
- [ ] Routing exists where the artefact must be discovered (a line in `AGENTS.md`, not a better description alone).
- [ ] Trigger tests include negative controls.
- [ ] References hang one level deep, each with *when* to read it.
- [ ] No dynamic content in the prefix (§2.9); critical rules sit first, current state last.
- [ ] No time-sensitive statements; superseded material under "old patterns" or gone.
- [ ] Terminology consistent throughout.
- [ ] Deterministic repeated work is a script, not an instruction.
- [ ] Tool: name says the task, params unambiguous, output bounded, errors actionable, boundaries with siblings stated.
- [ ] Third-party skills and tools were read in full before install; no secrets; least privilege.

## 7. This container's constraints

- Global prompt: `opencode-config/opencode/AGENTS.md` → baked to `/opt/opencode-config`, synced to `$XDG_CONFIG_HOME/opencode/AGENTS.md` at boot, **overwriting** the volume copy. Editing the volume file alone is lost on redeploy; the repo is what ships. Never `cp AGENTS.md` from the repo root over it — that path is the *project* prompt and doing so wipes the global rules.
- This file plus the tool definitions are the **cached prefix** for every session (§2.9): batch edits, and never inject per-turn state.
- Skills: `opencode-config/opencode/skills/<name>/`, synced the same way. The sync **copies, never deletes** — removing or renaming a skill needs an explicit cleanup in `entrypoint.sh`.
- Devcontainer copy lives at `.devcontainer/opencode/skills/` and does **not** sync with the Railway one; both must change (Railway first).
- No same-named command: a command shadows the native `/skill` path.
- Skill persistent data goes on `/workspace`, never inside the skill directory — that directory is replaced by the next image.
- Vendor third-party skills with their LICENSE and put local adaptations in a preamble at the top of `SKILL.md`, so re-vendoring stays cheap.

## 8. Sources, and how much weight each carries

| Source | Contributed | Weight / caveat |
|---|---|---|
| [agentskills.io — best practices](https://agentskills.io/skill-creation/best-practices) | Extract from a hands-on task; refine from traces; delete test; coherent units; fragility-matched specificity; gotchas; plan-validate-execute | High — it is the spec's own guidance, aligned with Anthropic |
| [Anthropic — skill authoring](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) | 500-line / 1024-char budgets; third person; one-level references; TOC; degrees of freedom; "old patterns"; terminology; checklists | High — vendor spec, and the only source that discusses large-skill structure in detail |
| [Anthropic — writing tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents) | Task-shaped tools; namespacing; output signal/IDs/pagination; `response_format`; actionable errors; description = onboarding; eval-driven with held-out sets | Highest for §5 — measured on their own Slack/Asana MCP servers with held-out test sets |
| [Vercel — `AGENTS.md` beats skills](https://vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals) | 56% never invoked, +0pp; 95%+ and 79% with routing; 8 KB index 100%; 40→8 KB; wording fragility | High for §0, **narrow scope** — one framework's docs on one task family; do not generalise to "AGENTS.md always wins" |
| [OpenAI — testing skills with evals](https://developers.openai.com/blog/eval-skills) | Four goal categories; 10–20 prompt CSV with negative controls; trace-based deterministic checks; thrashing / token / cleanliness signals | High for §2.2 — concrete and runnable |
| [SkillsBench (2602.12670)](https://arxiv.org/abs/2602.12670) | +16.6 pp over 87 tasks / 18 configs; ≤3-module skills beat bundles; small model + skills ≈ large model alone | High — paired evaluation with deterministic verifiers |
| [SkillAxe (2606.10546)](https://arxiv.org/abs/2606.10546) | Human +16.2 pp vs LLM-authored no gain; four diagnostic dimensions; 47–67% gap closed by refinement | Medium-high — the four dimensions are the useful part; the self-refinement pipeline is their product |
| [Sam McLeod — common pitfalls](https://smcleod.net/2026/07/writing-and-reviewing-agent-skills-common-pitfalls) | Description = trigger only, 30–55 words; "when to use" in body is too late; scripts over inference; third-party review | Medium — practitioner experience, no measurements, but consistent with spec guidance and reproduced here |
| [OpenCode — skills](https://opencode.ai/docs/skills/) | Discovery paths, path-derived IDs, `autoinvoke`, precedence, load semantics, permissions | Highest for platform facts — it is the runtime we use |
| 李博杰《深入理解 AI Agent》第 2 章 | static prefix vs trajectory; prefix byte-stability and cache invalidation; dynamic injection cost; dynamic tool reordering; lost-in-the-middle | Medium — structural model is sound and independently verifiable; the vendor specifics (cache ratios, per-model `reasoning_content` rules) change and are not rules |
| [ai-agents-from-zero 1-2](https://github.com/didilili/ai-agents-from-zero/blob/main/1-2-%E6%8F%90%E7%A4%BA%E8%AF%8D%E5%B7%A5%E7%A8%8B%E5%9F%BA%E7%A1%80.md) | Delimiters separating instruction from data; system = stable rules, user = current task; output format as a checkable contract | Low-medium — the six-element template is for one-shot content prompts and does not transfer to agent instructions; only the split/fence discipline did |
| [ai-agents-from-zero 13](https://github.com/didilili/ai-agents-from-zero/blob/main/13-%E6%8F%90%E7%A4%BA%E8%AF%8D%E4%B8%8E%E6%B6%88%E6%81%AF%E6%A8%A1%E6%9D%BF.md) | Stable vs dynamic split; history must be resent; prompts externalised for versioning | Low — mostly LangChain mechanics; kept only the parts that describe the model's input |
| [prompt-optimizer](https://github.com/linshenkx/prompt-optimizer) (41.5k★) | Prompts as versioned assets; optimise → evaluate → compare loop | Low — a product, not a source of principles; its one-click "optimisation" tends to inflate prompts, which §2.3 rejects. Useful only as evidence that eval-driven iteration is the commercial consensus |
