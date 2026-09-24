---
name: deep-research
description: "End-to-end deep research that turns a question into a cited, verifiable report. Use whenever the answer needs many external sources rather than a single lookup: technology/library selection, code and architecture questions, academic or medical literature, market and company facts, policy and standards, and 'what's the latest' or capability/benchmark questions. Routes each sub-question to the most authoritative sources for its domain (GitHub and official docs for code, arXiv/OpenAlex/Semantic Scholar for scholarship, PubMed/Europe PMC for medicine, SEC EDGAR for company facts, vendor and official pages for products), gathers evidence in parallel, triangulates claims, and writes a structured report with dated citations. Trigger on 调研/研究/调查/综述/对比一下 X、帮我查清楚 X、X 的最新进展/评测数据/方案有哪些, and any request for a research report, literature review, landscape survey, or source-backed answer — even when the user does not say the word 'research'."
---

# Deep Research

Turn a question into a report a reader can trust: every claim traceable to a source, sources chosen for authority rather than convenience, and uncertainty stated instead of hidden.

This skill is **self-contained and host-agnostic**. It defines the *method*; it requires no custom agent, plugin, or MCP server. Where it says "spawn workers", use whatever parallel-subagent facility the host provides (see *Running workers*); if none exists, run the same steps yourself, sequentially.

## When to use

Use it when the answer must be assembled from **multiple external sources** and needs to be current, comparative, or authoritative:

- technical / library / architecture selection, migration paths, "X vs Y"
- literature reviews, "what does the research say about X"
- medical, clinical, or life-science questions
- market, company, competitive, or due-diligence facts
- policy, regulation, standards
- "what's the latest / what changed recently" about a fast-moving area
- any request for a research report, survey, landscape, or source-backed answer

Do **not** use it for a single fact ("capital of France"), a quick definition, or when the user explicitly wants a short direct answer — just answer.

## Principles

1. **Primary sources first.** Prefer the thing itself — the paper, the official docs, the repository, the filing, the standard — over articles that describe it. Secondary sources orient and corroborate.
2. **Provenance on every non-obvious claim.** Each such claim carries a source URL and the date it was retrieved; quote the exact supporting text when wording matters.
3. **Triangulate.** A load-bearing claim needs ≥2 independent sources. If only one exists, say so and lower confidence.
4. **Freshness.** For "latest/current/recent" questions, constrain retrieval to a recent window and state the cutoff date. Version- or date-sensitive facts must name the version or date.
5. **Surface disagreement.** When credible sources conflict, present both and explain the difference; never silently pick one or average them.
6. **Separate fact from inference.** Label anything you derived; never present an inference as a fact.
7. **Uncertainty is data.** State what could not be verified and how that bounds the conclusion.
8. **Write in the user's language**, even though this skill is written in English.

## Workflow

Before Phase 2 (Route), read `references/source-routing.md`. Before Phase 5, read `references/report-template.md`. Before Phase 6, run `references/quality-checklist.md`. When spawning workers, take their prompt from `references/subagent-briefs.md`.

Emit a one-line progress note per phase so a long run stays visible, e.g. `[deep-research] gather (phase 3) — 4 workers, 21 sources`.

### 0 · Preflight
Verify retrieval works before planning: a web-search tool and a page/URL fetch tool, plus (ideally) a shell for JSON APIs (GitHub, arXiv, Crossref, PubMed, …). If search is unavailable or has no provider configured, use the domain APIs in `references/source-routing.md` as the search path rather than relying on scraping search-engine result pages, and say so in the report's method section. If there is **no shell**, issue the same API URLs through the URL-fetch tool — they are plain `GET`s. For questions about a local codebase, also use code-search and file-read tools.

### 1 · Frame
Restate the question in one or two sentences, then:
- Decompose it into 3–7 concrete sub-questions that together answer it.
- State the deliverable (default: a Markdown report file) and pick a depth (below).
- Define what "answered" means — which sub-questions must be covered.
- Ask the user **only** if a missing detail would change the whole approach; otherwise state your assumptions and proceed. They asked for a finished report, not a questionnaire.

### 2 · Route
Classify the domain(s) and list, per sub-question, the authoritative source families from `references/source-routing.md`. Prefer primary/official sources. Note paywalled sources up front so they do not block later phases.

### 3 · Gather (parallel)
Spawn one worker per sub-question or source family (see *Running workers*). Give each worker: the sub-question, the assigned source families, the recency window, and the evidence format from `references/subagent-briefs.md`. Each worker returns an **evidence pack**:

```
- Claim: <one sentence>
  Source: <title> — <URL> (retrieved YYYY-MM-DD)
  Quote: "<verbatim supporting text>"
  Tier: T1 primary | T2 authoritative secondary | T3 preprint/reputable community | T4 unvetted
  Confidence: high | medium | low
```

Workers return evidence, not prose. They must not pad or speculate.

### 4 · Consolidate
Merge the packs into one evidence table; deduplicate. Mark each load-bearing claim **verified** (≥2 independent T1/T2), **single-source**, or **contradicted**. List gaps and send targeted follow-ups until every "answered" item is covered or explicitly marked unanswerable.

### 5 · Synthesize
Write the report using `references/report-template.md`:
- inline citation next to every non-obvious claim;
- facts, analysis, and recommendations visibly separate;
- a comparison table when comparing options;
- a "Confidence, gaps & disagreements" section.

### 6 · Verify (before delivery)
Run `references/quality-checklist.md`. For contested or high-stakes topics, re-fetch a sample of load-bearing citations to confirm they still support the claim, and look for counter-evidence. Fix or annotate anything that fails. Never ship a claim whose cited page does not support it.

### 7 · Deliver
- Write the report to a file (default `docs/research/<slug>-<YYYY-MM-DD>.md` unless the user names a location).
- Follow it with a 3–6 line summary: strongest conclusion, biggest uncertainty, most trusted sources.
- List sources with tier and retrieval date.

## Running workers

The method is host-agnostic; only the spawning mechanics vary.

- **If the host has a subagent/task tool** — opencode: the `subagent`/`task` tool with the built-in `general` or `explore` agents; Claude Code: `Task` with a subagent type — launch workers in parallel, passing the worker prompt from `references/subagent-briefs.md` with the placeholders filled in. Prefer a read-only worker (`explore`/`Explore`) for pure retrieval; use a general worker when it must also run shell/API calls.
- **Bound concurrency to 2–3 workers per turn.** Some providers reject a turn containing several parallel tool calls (e.g. "an assistant message with 'tool_calls' must be followed by tool messages responding to each 'tool_call_id'"). When there are more sub-questions than that, run them in batches. If a batch errors, relaunch only the failed workers in smaller batches, and if the error persists, do the work yourself sequentially.
- **If a `researcher` agent already exists**, prefer it.
- **If there is no subagent facility**, run the same briefs yourself, sequentially, one sub-question at a time. The evidence format and routing do not change.
- Keep workers independent: one worker's conclusions must not frame another's search.

## Depth levels

| Depth | Use for | Shape |
|---|---|---|
| quick | simple, current facts | one gather pass, no independent verification, short report |
| standard (default) | most requests | parallel gather + consolidate + inline verification + full report |
| deep | contested, high-stakes, or "comprehensive" | multi-round, a dedicated verification worker, explicit disagreement analysis |

## Bounded runs

- Announce phase, worker count, and recency window before a long gather.
- If a source is rate-limited or paywalled, record it and move on — do not retry indefinitely.
- If a sub-question is still unanswered after two rounds, mark it and proceed.

## Why this shape

A single search returns undifferentiated snippets; a report needs provenance. The hard part is not fetching — it is knowing the authoritative source for each domain and proving the source actually supports the claim. The routing table and the verification pass exist for exactly that.
