# Quality Checklist

Run this in Phase 6, before delivery. It exists because the most common failure of AI research is confident prose whose citations do not actually support it. Fix or annotate every failed item — do not ship silently.

## 1. Citation support (the gate)

- [ ] **Every** load-bearing claim was opened and checked, not a sample.
- [ ] `node scripts/evidence.mjs stats <dir>` reports a citation accuracy, and that number is in the report header.
- [ ] Accuracy ≥95%, or every failing claim was re-sourced, weakened, or moved to the uncertainty section.
- [ ] No claim is stronger than its source ("proves" where the source says "suggests").
- [ ] Quotes are verbatim and in context; nothing truncated that changes the meaning.
- [ ] Version- and date-sensitive facts name the version/date, and the source is not obsolete.
- [ ] No claim has a verdict of `unverifiable` while still presented as settled.

> Why a number and not a feeling: published evaluations put real production systems between 33% and 94% citation accuracy, and the systems with the best prose were not the most accurate. If you did not count, you do not know which side of that range you are on.

## 2. Access honesty

- [ ] Each source records an access lane: `public`, `render`, or `authenticated`.
- [ ] No load-bearing claim rests **solely** on an `authenticated` page (a reader cannot re-check it).
- [ ] Where an authenticated source carries a load-bearing claim, a public equivalent was sought, or the report says the claim is not reproducible without the login.
- [ ] `render` sources note that the page may have changed since retrieval when the content is time-sensitive.

## 3. Coverage and balance

- [ ] Every node in `outline.json` is `covered`, `partial`, or `unanswerable` with a reason — none left open.
- [ ] Every acceptance test that can be applied mechanically was applied.
- [ ] Load-bearing claims have ≥2 independent **source families**, or are labelled single-source.
- [ ] `stats` shows each covered node with ≥2 distinct families where the node is load-bearing.
- [ ] At least one deliberate attempt was made to find **counter-evidence** for each contested claim.
- [ ] No primary source is made to carry claims about something other than its own subject. (It may carry many facts about itself — that is what a primary source is for.)
- [ ] Editorial diversity: one commentary site does not supply most of the commentary. First-party API endpoints of the subject are exempt — several facts from one repository are one family, not one site dominating.
- [ ] Every dimension the question asked for is either answered or explicitly reported as a gap; none was dropped because its ideal source was unreachable.

## 4. Freshness

- [ ] "Latest/current/recent" questions state the retrieval cutoff and the window searched.
- [ ] The freshest authoritative source was used, not the most-indexed older one.
- [ ] Deprecated or retracted sources were replaced or flagged.

## 5. Honesty

- [ ] Facts, inferences, and recommendations are visibly separated.
- [ ] Uncertainties and gaps are stated where they matter, not buried at the end.
- [ ] Source disagreements are shown, not averaged away.
- [ ] Tiers are correct (an article about a paper is not T1).
- [ ] No claim rests solely on a T4 source.

## 6. Form and artifacts

- [ ] The report is in the user's language.
- [ ] Sections from `report-template.md` are present (TL;DR, Method, Findings, Confidence, Sources).
- [ ] `outline.json`, `evidence.jsonl`, `sources.json` and `claims.json` sit beside the report.
- [ ] Every source in the table has a tier, an access lane, and a retrieval date.
- [ ] The chat summary names the strongest conclusion, the biggest uncertainty, and the accuracy figure.
- [ ] The actual spend (sources, workers, minutes, what the budget cut short) is recorded.

## Failure handling

- Citation fails to support its claim: re-source it, downgrade the claim, or delete it — in that order.
- Two sources conflict and you cannot resolve it: report both, explain the likely reason (different dates, definitions, populations, methods), and say what would settle it.
- Key sub-question unanswerable within budget: say so plainly and recommend how to answer it (which source, dataset, or expert).
- Accuracy below the gate: the default is **do not ship**. Ship only after the failing claims are visibly demoted in the text.
