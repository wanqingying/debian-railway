# Report Template

Use this structure for the deliverable. Keep it in the user's language. Omit a section only when it is genuinely empty, and say why.

```markdown
# <Title — the question, answered in a phrase>

**Question:** <the user's question, restated precisely>
**Date:** <YYYY-MM-DD>  **Depth:** quick | standard | deep
**Sources:** <N> (<n1> primary) · **Cutoff:** <date range or "all dates">

## TL;DR
- <3–6 bullets: the conclusions a busy reader needs, each with a citation>
- <state the single biggest uncertainty here, not at the end>

## Method
- Sub-questions investigated: <list>
- Source families used: <e.g. GitHub releases, arXiv, official docs, SEC EDGAR>
- What was not available: <paywalls, missing data, rate limits — and how that limits the result>

## Findings
### 1. <Sub-question>
<Prose. Every non-obvious claim gets an inline citation [S1]. Keep facts and your analysis
visually distinct — mark derived statements clearly.>

### 2. <Sub-question>
…

## Comparison
<When options are compared. One row per option, one column per decision-relevant criterion.
Every cell carries a citation or "unverified".>

| Option | Criterion A | Criterion B | Notes |
|---|---|---|---|
| X | … [S2] | … [S3] | |

## Analysis
<What the evidence means together: patterns, trade-offs, the reasoning behind the
recommendation. Label this as interpretation, not fact.>

## Confidence, gaps & disagreements
- **High confidence:** <claims backed by multiple independent T1/T2 sources>
- **Single-source / tentative:** <claims with only one source>
- **Contradicted:** <where credible sources disagree, both sides stated>
- **Not established:** <what could not be answered, and what would answer it>

## Recommendations
<Only if the question implies a decision. Concrete, tied to the criteria above, and honest
about the conditions under which the advice would change.>

## Sources
| ID | Source | Tier | Retrieved |
|---|---|---|---|
| S1 | <Title> — <URL> | T1 | <YYYY-MM-DD> |
| S2 | … | T2 | … |
```

## Rules

- **Inline citations, next to claims.** A reader must reach a claim and its source together. A bare reference list at the end is not enough.
- **Cite the primary source.** If a secondary source points at a paper/dataset/filing, cite that too.
- **Dates everywhere.** Report date, source retrieval dates, and the recency cutoff for "latest" questions.
- **No orphan claims.** Anything non-obvious without a citation is either cited or moved to Analysis as a labelled inference.
- **Length follows the question**, not a page target. Density beats volume; never pad.
- **File output**: write to `docs/research/<slug>-<YYYY-MM-DD>.md` unless the user asked for another location or format.
