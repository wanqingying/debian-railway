# Quality Checklist

Run this in Phase 6, before delivery. It exists because the most common failure of AI research is confident prose whose citations do not actually support it. Fix or annotate every failed item — do not ship silently.

## 1. Citation support

- [ ] For every load-bearing claim, open the cited URL and confirm it **directly** supports the claim.
- [ ] The claim is not stronger than the source (no "proves" where the source says "suggests").
- [ ] Quotes are verbatim and in context; no truncation that changes meaning.
- [ ] Version- and date-sensitive facts name the version/date, and the source is not obsolete.

## 2. Coverage and balance

- [ ] Every sub-question defined in Phase 1 is answered, or explicitly listed under "Not established".
- [ ] Load-bearing claims have ≥2 independent sources, or are labelled single-source.
- [ ] At least one attempt was made to find **counter-evidence** for contested claims.
- [ ] No single source is cited for many unrelated claims (citation monopolizing).

## 3. Freshness

- [ ] "Latest/current/recent" questions state the retrieval cutoff.
- [ ] The freshest authoritative source was used, not the most-indexed older one.
- [ ] Deprecated/retracted sources were replaced or flagged (check retraction notices, "superseded by" notes).

## 4. Honesty

- [ ] Facts, inferences, and recommendations are visibly separated.
- [ ] Uncertainties and gaps are stated where they matter, not buried.
- [ ] Source disagreements are shown, not averaged away.
- [ ] Tiers are assigned correctly (an article about a paper is not T1).
- [ ] No claim rests solely on a T4 source.

## 5. Form

- [ ] The report is in the user's language.
- [ ] The sections from `report-template.md` are present (TL;DR, Method, Findings, Confidence, Sources).
- [ ] Every source in the list has a tier and a retrieval date.
- [ ] The file is written where the user expects, and the chat summary names the strongest conclusion and the biggest uncertainty.

## Failure handling

- If a citation fails to support its claim: re-source it, downgrade the claim, or delete it — in that order.
- If two sources conflict and you cannot resolve it: report both, explain the likely reason (different dates, definitions, populations, methods), and say what would settle it.
- If a key sub-question is unanswerable within the time/source budget: say so plainly and recommend how to answer it (which source, dataset, or expert).
