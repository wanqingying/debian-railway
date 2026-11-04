---
name: deep-research
description: "End-to-end deep research that turns a question into a cited, verifiable report. Use whenever the answer needs many external sources rather than a single lookup: technology/library selection, code and architecture questions, academic or medical literature, market and company facts, policy and standards, and 'what's the latest' or capability/benchmark questions. Routes each sub-question to the most authoritative sources for its domain (GitHub and official docs for code, arXiv/OpenAlex/Semantic Scholar for scholarship, PubMed/Europe PMC for medicine, SEC EDGAR for company facts, vendor and official pages for products), reads pages through the cheapest lane that can actually see the content (APIs, then a real browser for JavaScript- and login-gated pages), keeps every claim in an on-disk evidence register, and gates delivery on a measured citation-accuracy number. Trigger on 调研/研究/调查/综述/对比一下 X、帮我查清楚 X、X 的最新进展/评测数据/方案有哪些, and any request for a research report, literature review, landscape survey, or source-backed answer — even when the user does not say the word 'research'. Not for a single fact, a quick definition, or a question the user wants answered in one short paragraph."
---

# Deep Research

Turn a question into a report a reader can trust: every claim traceable to a source, sources chosen for authority rather than convenience, and uncertainty stated instead of hidden.

Three findings from the systems that do this well shape everything below, and each one costs something to ignore:

- **Evidence kept only in the conversation is evidence you lose.** A six-worker run pours tens of thousands of tokens of raw page text into the main context; the model then picks citations out of that noise, which is exactly where citation accuracy collapses. So evidence goes to disk, and the main context reads digests.
- **A sub-goal you cannot check off is a sub-goal that drifts.** "Analyze the options" has no failure condition, so nothing downstream can tell whether it was met. Each sub-question needs an acceptance test a stranger could apply.
- **A citation nobody opened is a guess with a URL.** Published benchmarks put real systems at 33–94% citation accuracy — the prose being good tells you nothing about whether the sources support it. Verification is a counted step, not a courtesy.

This skill is **self-contained and host-agnostic**. It requires no custom agent, plugin, or MCP server. Where it says "spawn workers", use whatever parallel-subagent facility the host provides (see *Running workers*); with none, run the same steps yourself, sequentially.

## When to use

Use it when the answer must be assembled from **multiple external sources** and needs to be current, comparative, or authoritative: technical selection and migration paths, literature reviews, medical and life-science questions, market/company/due-diligence facts, policy and standards, "what's the latest", and any request for a survey, landscape, or source-backed report.

Do **not** use it for a single fact, a quick definition, or when the user wants a short direct answer — just answer. If the user asks for a **decision about code they already have**, the answer may need only a few file reads, which is a different job.

## Principles

1. **Primary sources first.** Prefer the thing itself — the paper, the official docs, the repository, the filing, the standard — over articles that describe it.
2. **Provenance on every non-obvious claim.** URL, retrieval date, the exact supporting quote, the tier, and the access lane.
3. **Triangulate.** A load-bearing claim needs ≥2 independent sources. One source means say so and lower confidence.
4. **Freshness with a number.** Naming the window you searched is not enough — a report can state a window and then cite three sources from before it. So timeliness is measured like accuracy is: every source records the date *it was published*, and `stats --window` reports how many load-bearing claims fall inside the window. A claim from before it is allowed, but it has to carry a `stale_reason` saying why it still holds; a testable claim with no date is `undated`, reported as unknown rather than counted as fresh.
5. **Surface disagreement.** Show both sides and explain the difference; never silently pick one or average them.
6. **Separate fact from inference.** Label what you derived.
7. **Uncertainty is data.** State what could not be verified and how that bounds the conclusion.
8. **Say how you read it.** Each source carries an access lane — `public`, `render`, or `authenticated` — because a reader can re-run the first two and cannot re-run the third. Claims resting only on an authenticated page are weaker evidence even when the page is authoritative, and the report has to admit that rather than present them as equal.
9. **Write in the user's language**, though this skill is written in English.

## Workflow

Read the reference named at each phase when you reach it, not all at once. Emit one progress line per phase — `[deep-research] gather — 3 workers, 14 sources, 2 render-lane` — so a long run stays visible to whoever is watching.

### 0 · Preflight and budget

One short message before any searching. It costs a line and prevents the two commonest failures: searching for content the tools cannot see, and running without a stop condition.

Decide which **lanes** are available, in this order of preference:

| Lane | Reaches | Check | Cost |
|---|---|---|---|
| **A · API / text fetch** | arXiv, GitHub, EDGAR, PubMed, registries, static HTML | a shell, `webfetch`, and a search tool | cheapest, parallel, reproducible |
| **B · rendered browser** | JavaScript-rendered docs, lazy tables, bot-blocked pages | `node scripts/browse.mjs --check` | ~2–8 s per page, single browser |
| **C · authenticated browser** | pages behind a sign-in the user completed in the VNC browser | same check, plus the page actually loads signed in | slowest, not reproducible for a reader |

Prefer A. Escalate to B when a fetch returns an empty shell (a `<div id="__root">` and nothing else) or a 403/Cloudflare page. Escalate to C only when the source is genuinely necessary and the user has already signed in; if a login is needed and nobody is there to do it, note the gap and move on rather than stalling the run.

If search is unavailable entirely, use the domain APIs in `references/source-routing.md` as the search path rather than scraping search-result pages, and say so in the report's Method section. Without a shell, issue the same URLs through the fetch tool — they are plain `GET`s.

Then state the budget you will hold yourself to: `depth`, workers per batch, max sources per sub-question, and a wall-clock ceiling. Announcing it makes the run's cost legible and gives you a reason to stop.

```
[deep-research] depth=standard lanes=A,B workers=3 budget=8 sources/node, ≤20 min
```

### 1 · Frame: an outline whose nodes can be checked off

Restate the question in one or two sentences, then write `outline.json` (schema: `references/outline-schema.md`) with 3–7 nodes. Each node carries:

- `question` — one sub-question, answerable on its own;
- `acceptance` — the test that decides whether it is answered. Write it as something a stranger could apply to the finished report: *"three deployable options, each with an official docs link and a version number from the last 6 months"*, not *"analyze the options"*. If you cannot imagine a result that would fail the test, the test is not one;
- `families` — the source families or exact recipes to try (from `references/source-routing.md`);
- `min_independent_sources` — usually 2 for load-bearing nodes, counted in **distinct source families**, not URLs (see Phase 4);
- `freshness_window` — the date range you will accept, or `any`. Its start date is what you pass to `stats --window`, so write it as a real date (`"2025-06-01.."`) whenever the question is time-sensitive; `any` opts the node out of the freshness metric, and that opt-out is visible in the report.

Then check the plan is **arithmetically possible**: sum `min_independent_sources` across nodes and compare it with the total source budget. Seven nodes at 2 sources each is 14 sources; if the budget is 8, the plan cannot be executed, and an agent under that pressure silently starts cutting the per-node floor — which is how evidence quality degrades while the report still looks fine. When the numbers do not fit, cut **nodes** (merge overlapping ones, drop the ones that are nice-to-have), never the per-node floor. Record the arithmetic in `outline.json` so the trade-off is visible afterwards.

A **critic pass on yourself**, before searching: which nodes are under-specified, which acceptance tests are unfalsifiable, which two nodes overlap enough to merge, and what the outline omits that the question implies. Fix the outline, not the prose later.

**Human gate, only when it earns its interruption.** For `deep` runs, or when two readings of the question would send the research in different directions, show the outline as 5 lines and ask once before spending the budget. For `quick` and `standard` on a clear question, state your assumptions and go — the user asked for a report, not a questionnaire.

### 2 · Route

Classify the domain and, per node, pick the authoritative source families and the lane each needs. Read `references/source-routing.md` for the domain table, the access lanes in detail, and ready-to-run `curl` recipes. Note paywalled or login-gated sources up front so they do not silently block a node later.

### 3 · Gather: workers write to disk, not into the conversation

Spawn one worker per node or source family (see *Running workers*), handing each the node from `outline.json`, the exact recipes, the recency window, and the evidence schema. Workers **append each finding to `evidence.jsonl`** with `scripts/evidence.mjs` and return only a short digest:

```
## Digest — node N2 (pricing & packaging)
Covered: list price, free-tier limits, enterprise floor
Sources: 6 (T1×4, T2×2; public×5, render×1)
Conflicts: annual discount 17% vs 20% (vendor page vs reseller)
Gaps: no public number for per-seat overage
Claims written: C011–C023
```

The digest is what the main context keeps. The quotes stay on disk and are read back by node when you write that section — which is the whole point: the report is written against audited evidence, not against whatever survived in the window.

Workers return evidence, not prose. They must not pad, speculate, or summarize away the quote.

### 4 · Consolidate: one claim register

Merge the digests into a single register — deduplicate **by URL** (one page cited twice is one source) and count **by family** — and mark each load-bearing claim `verified` (≥2 independent families, T1/T2), `single-source`, or `contradicted`.

A **source family** is the organisation that published the content plus what kind of page it is — `cortexkit/magic-context:releases`, `cortexkit/magic-context:docs`, `tokio-rs/axum:crates-api`. Four GitHub endpoints of one repository are one family: they corroborate each other the way one author citing himself does. This matters because "two independent sources" is the claim the whole report rests on; if a repository's `releases` and its `README` count as two, then every self-consistent project verifies its own claims and the word `verified` stops meaning anything. `scripts/evidence.mjs` derives the family from the URL (and accepts an explicit `source_family` when two hosts belong to the same publisher), and `stats` prints how many distinct families a node actually has.

The same logic resolves an apparent rule conflict: one primary source **may** carry several facts about its own subject — that is what a primary source is for. What it must not do is carry claims about *something else*.

`node scripts/evidence.mjs stats <dir>` then prints the shape of what you have: counts by tier, by lane, by family, and by verification state.

Then close gaps: for every unanswered acceptance test, either send a targeted follow-up or mark it unanswerable with the reason. Do not let an unanswered node become a vague paragraph.

### 5 · Synthesize

Write `report.md` from `references/report-template.md`, pulling quotes by node from the register. Cite with the source ids the register assigns (`[S3]`) rather than inventing numbers as you type — hand-numbering drifts and breaks the audit in step 6. Keep facts, analysis, and recommendations visibly separate, and use a comparison table whenever options are compared.

### 6 · Verify: count, don't sample

Open the cited URL for **every** load-bearing claim and decide, per claim, whether the page as it stands supports the claim as written. Not a sample — the sample is the version of this step that never finds the two wrong citations. Where the page no longer matches, mark the verdict, then re-source, weaken, or delete, in that order.

Fixing a record goes through the register, never through a text editor: `node scripts/evidence.mjs edit <dir> --claim C0xx '<json of the fields to change>'` corrects a claim in place — recomputing its source family when the `url` moves — and `--delete` removes one outright. Hand-editing `evidence.jsonl` is how ids and derived fields drift apart from the numbers the report quotes. When one claim needs two pages to stand up, do not give it two URLs: edit it down to the first, and `append` the second as its own record.

`node scripts/evidence.mjs stats <dir> --window <YYYY-MM-DD>` then gives you the two numbers that go in the report header:

```
citation accuracy = SUPPORTED / (load-bearing claims with a verdict)
```

Record it even when it is bad; a report that admits 88% is more useful than one that claims 100% and cannot show its work. Below ~95% on a load-bearing topic, the deliverable is not ready: keep fixing, or move the failing claims into the report's uncertainty section.

The same pass settles **timeliness**: for every claim published before the node's `freshness_window`, either drop it, replace it with something current, or record why the older source still holds in `stale_reason` (`edit <dir> --claim C0xx '{"stale_reason":"…"}'`). A 2019 number is often the right number — the failure is presenting it as if it were from last month, and the fix is one clause of explanation, not a hunt for a fresher page. `render --gate --window <date>` fails on any outdated claim that does not carry that clause.

Run `references/quality-checklist.md` as the final sweep.

### 7 · Deliver

- `docs/research/<slug>-<date>/report.md` — the deliverable, with the accuracy line in its header.
- Alongside it: `outline.json`, `evidence.jsonl`, `sources.json` — the audit trail that lets a later session re-check a claim without redoing the research.
- In chat: 3–6 lines — strongest conclusion, biggest uncertainty, the one source you would trust most, and the measured accuracy and freshness.

## Running workers

The method is host-agnostic; only the spawning mechanics vary.

- **With a subagent/task tool** — opencode: `subagent`; Claude Code: `Task` — launch in parallel and pass the brief from `references/subagent-briefs.md` with placeholders filled. Prefer a read-only worker for retrieval (`explore`) and a general worker when it must run shell/APIs or the browser.
- **Bound concurrency to 2–3 workers per batch.** Some providers reject a turn with many parallel tool calls. More nodes than that means batches. If a batch errors, relaunch only the failures in smaller batches; if it persists, do the work yourself.
- **The browser is a single shared instance.** Never more than 1–2 workers on lanes B/C at once, and never navigate the tab a person is looking at — open a new one and close it when done (`scripts/browse.mjs` does this).
- **If a `researcher` agent exists**, prefer it.
- **With no subagent facility**, run the same briefs yourself, sequentially. The evidence schema and routing do not change — but say so in the Method section, because one context doing all four searches is not the independence the parallel design assumes: each search is already framed by the previous result, and an early misreading quietly shapes everything after it.

Keep workers independent: one worker's conclusions must not frame another's search, or you get one search repeated N times.

## Depth levels

| Depth | Use for | Shape |
|---|---|---|
| quick | simple, current facts | one gather pass, no independent verification, short report |
| standard (default) | most requests | outline + parallel gather + register + full verification + report |
| deep | contested, high-stakes, or "comprehensive" | multi-round, a dedicated verification worker, outline gate, explicit disagreement analysis |

## Budget and stopping rules

- Announce depth, worker count, and the recency window before a long gather.
- Stop a node after the acceptance test is met with two independent sources — not when the page budget runs out, and not before.
- Stop the whole run after two rounds that add no new claims to the register. (Being unable to answer is a legitimate outcome; grinding is not.)
- On rate limits or paywalls: record and move on. One retry with backoff on 406/429/503; a `User-Agent` on 403; then a lane escalation; then a gap.
- Report the actual spend at the end: sources, workers, wall-clock, and anything the budget cut short.

## Why this shape

A single search returns undifferentiated snippets; a report needs provenance. The hard part is not fetching — it is knowing the authoritative source for a domain, reaching pages that only a browser can see, and proving the source actually supports the claim. The routing table, the register on disk, and the counted verification exist for exactly those three.
