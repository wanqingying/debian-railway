# Subagent Briefs

Copy-paste prompts for the workers described in Phase 3. Fill the `<…>` placeholders and pass the whole block as the subagent's task/prompt. The briefs are written so they work on any host — the text matters, not which agent runs it.

Prefer a read-only worker for retrieval (opencode `explore`, Claude Code `Explore`). Use a general worker only when the task needs shell/API calls that the read-only worker cannot make.

> **Before spawning:** a worker has a fresh context and usually cannot read this skill's directory. So (a) replace `<SOURCE FAMILIES/RECIPES>` with the **actual URLs or `curl` commands** from `references/source-routing.md`, not just the family name; and (b) keep the **SOURCE-TIER RUBRIC** line below in every brief so `Tier:` is unambiguous.

## Worker brief — evidence gathering

```
You are one worker in a multi-worker deep-research run. Your only job is to gather and return
evidence for ONE sub-question. Do not write a report, do not speculate, do not pad.

SUB-QUESTION: <sub-question>
SOURCE FAMILIES / RECIPES: <the actual URLs or curl commands from source-routing.md for this sub-question>
RECENCY WINDOW: <e.g. "published after 2025-01-01" or "any date">
TODAY: <YYYY-MM-DD>
SOURCE-TIER RUBRIC: T1 = the artifact itself (paper, official docs, repo, filing, standard);
T2 = peer-reviewed or editorially accountable secondary; T3 = preprint / reputable community;
T4 = unvetted (SEO, unsourced blogs, forums).

Method
1. Start from the most authoritative source listed; go to the primary source, not articles about it.
2. For each useful source, record the exact supporting text, not a paraphrase.
3. Stop when the sub-question is covered by at least two independent sources, or when you have
   exhausted the assigned sources. Prefer 4–8 high-quality sources over many weak ones. Keep the
   whole pack under ~60 lines.
4. If sources disagree, keep both and say so — do not resolve it yourself.
5. If a source is paywalled, rate-limited, or returns an error, note it and move on. On 406/429/503,
   retry once with a short backoff; on 403, add a User-Agent.

Return ONLY this structure, one block per source:

- Claim: <one sentence this source supports>
  Source: <title> — <URL> (retrieved <YYYY-MM-DD>)
  Quote: "<verbatim supporting text>"
  Tier: T1 primary | T2 authoritative secondary | T3 preprint/reputable community | T4 unvetted
  Confidence: high | medium | low

Then:

## Coverage
- Answered: <which parts of the sub-question are covered>
- Unanswered / gaps: <what you could not establish, and why>
- Disagreements: <conflicting claims, if any>
```

## Worker brief — verification (use in `deep` runs, Phase 6)

```
You are an independent verifier. You did not gather this evidence and must not trust it.

You are given a list of load-bearing claims with their cited URLs. For each:
1. Fetch the cited URL.
2. Decide: does the page actually support the claim as stated? Watch for claims stronger than
   the source (overreach), outdated versions, and quotes taken out of context.
3. Search for the strongest credible counter-evidence or a newer source that supersedes it.

Return, per claim:

- Claim: <as written>
  Verdict: SUPPORTED | PARTIALLY SUPPORTED | NOT SUPPORTED | SUPERSEDED | UNVERIFIABLE
  Evidence: <what the page actually says, with the relevant quote>
  Counter-evidence: <if any, with URL>
  Notes: <overreach, missing context, version/date problems>

If a URL is dead, paywalled, or returns an error, use UNVERIFIABLE and record the error; you may
check the claim against the abstract or another copy of the same work, and say which. Never mark
something SUPPORTED on the basis of a page you could not read.
```

## Consolidation checklist (main agent, Phase 4)

- [ ] Every evidence block has a URL and a retrieval date.
- [ ] Load-bearing claims are marked verified / single-source / contradicted.
- [ ] Contradictions between workers are surfaced, not averaged away.
- [ ] Gaps map to a follow-up worker or an explicit "unanswered" item.
- [ ] No T4 source is the sole support for a load-bearing claim.
- [ ] Source tiers look right (an article about a paper is T2/T3, not T1).
