# Subagent Briefs

Copy-paste prompts for the workers in Phase 3. Fill the `<…>` placeholders and pass the whole block as the subagent's task. The text matters, not which agent runs it.

Prefer a read-only worker for retrieval (opencode `explore`, Claude Code `Explore`). Use a general worker when the task needs shell/API calls or the browser.

> **Before spawning:** a worker has a fresh context and cannot read this skill's directory. So (a) replace `<RECIPES>` with the **actual URLs or `curl` commands** from `source-routing.md`, not family names; (b) keep the **SOURCE-TIER RUBRIC** line so `Tier:` is unambiguous; (c) give the absolute path of `evidence.mjs` — the worker writes to disk with it.

## Worker brief — evidence gathering

```
You are one worker in a multi-worker deep-research run. Your only job is to gather evidence for ONE
sub-question, write it to the evidence register, and return a short digest. Do not write a report,
do not speculate, do not pad.

SUB-QUESTION: <question>
ACCEPTANCE (you are done when these are satisfied, not when you run out of pages):
<acceptance list from outline.json>
RECIPES: <the actual URLs or curl commands from source-routing.md>
LANES ALLOWED: <A only | A,B | A,B,C>
RECENCY WINDOW: <e.g. "published after 2025-01-01" or "any date">
TODAY: <YYYY-MM-DD>
BUDGET: at most <n> sources; stop as soon as acceptance is met
EVIDENCE DIR: <absolute path to the research dir>
NODE: <N1>
SOURCE-TIER RUBRIC: T1 = the artifact itself (paper, official docs, repo, filing, standard);
T2 = peer-reviewed or editorially accountable secondary; T3 = preprint / reputable community;
T4 = unvetted (SEO, unsourced blogs, forums).

Method
1. Start from the most authoritative recipe listed; go to the primary source, not articles about it.
2. Read the page, not the search snippet. If the fetch returns an empty shell, retry once through the
   browser lane; if that needs a login you do not have, record the gap instead of guessing.
3. For each useful source, copy the exact supporting sentence — a paraphrase cannot be verified later.
4. Record the access lane you used: public (plain fetch/API), render (browser, anonymous),
   authenticated (the browser's signed-in session). Do not upgrade a claim's reliability because the
   page looked authoritative while signed in.
5. Write every finding to the register, one record per claim:
     node <evidence.mjs> append <EVIDENCE DIR> '<json>'
   where the json is {"node","claim","source_title","url","quote","tier","access","retrieved","confidence"}
   One record = one claim + one quote + one URL. If a claim needs two pages to stand up, write two
   records; never one claim pointing at two URLs, because neither can then be verified alone.
6. Count sources the way the register does: by publisher + page kind. The project's releases page, its
   README and its commit history are ONE source family — they corroborate each other the way one person
   citing himself does. Two independent sources means two families.
7. If the ideal source for a dimension is unreachable (benchmark dead, page gone, no public number),
   degrade to the best machine-readable stand-in and say what it is — do not drop the dimension. The
   main agent needs to know a dimension is thin far more than it needs silence.
8. If sources disagree, keep both and say so — do not resolve it yourself.
9. On 406/429/503 retry once with backoff; on 403 add a User-Agent; then record it and move on.

Return ONLY:
## Digest — node <NODE>
Covered: <which acceptance items are satisfied>
Sources: <n> (T1×a, T2×b, T3×c, T4×d; public×e, render×f, authenticated×g)
Conflicts: <conflicting claims, with the two URLs, or "none">
Gaps: <acceptance items you could not satisfy, and why>
Claims written: <C011–C023>
```

Keep the digest under ~15 lines. The quotes live on disk; the digest is all the main context keeps.

## Worker brief — browser reader (lane B/C)

Use when a node depends on pages a plain fetch cannot see. One worker, one browser: never run two of these at once.

```
You are a browser reader. For each URL, open it in the shared visible Chromium over CDP, extract the
main text, and record what is actually on the page.

URLS: <one per line>
WHY THESE: <what the sub-question needs from them>
LOGIN: <"none needed" | "the browser is already signed in to <site>; mark those sources authenticated">
NODE: <N1>
EVIDENCE DIR: <absolute path>

Command (use it, do not hand-roll CDP):
  node <browse.mjs> <url> --max 8000 --json            # anonymous
  node <browse.mjs> <url> --max 8000 --json --auth     # signed-in session
Add --shot on pages where the number lives in a chart or a table image; keep the screenshot path.

Rules
- New tab only. Never navigate a tab a person may be looking at; browse.mjs already opens and closes its own.
- If a page returns under ~200 characters, the content is probably behind a click, a cookie wall, or a
  login: try one scroll/consent reload, then report the failure — do not invent the content.
- Copy the exact sentence that carries each number; the page may change, the quote is the evidence.
- Write findings to the register with `node <evidence.mjs> append <dir> '<json>'`.

Return: ## Digest — node <N>  (same fields as the gathering brief, plus
  "Pages:" <n> ok / <m> failed, and the reason for each failure)
```

## Worker brief — verification (Phase 6, or a dedicated worker in `deep` runs)

```
You are an independent verifier. You did not gather this evidence and must not trust it.

For each claim id below, run `node <evidence.mjs> slice <dir> --node <N>` to read the claim, its URL
and the quote the gatherer recorded. Then:
1. Re-open the cited URL yourself (browser lane if the fetch returns a shell; you do not have an
   authenticated session unless the brief says so).
2. Decide whether the page as it stands supports the claim AS WRITTEN. Watch for overreach
   ("proves" where the source says "suggests"), version drift, and quotes taken out of context.
3. Look once for a newer source or a credible counter-claim.
4. Record the verdict: `node <evidence.mjs> verify <dir> --claim C0xx --verdict <v> --note "<why>"`

Verdicts: supported | partial | not_supported | superseded | unverifiable.
Never mark something supported on a page you could not read — `unverifiable` plus the error is the
honest answer, and it is what keeps the reported accuracy meaningful.

Return: a table of claim_id → verdict → one-line reason, and the accuracy line from `stats`.
```

## Consolidation checklist (main agent, Phase 4)

- [ ] Every record has a URL, a retrieval date, a tier, and an access lane.
- [ ] Duplicates removed by URL **and** by underlying source (five copies of one press release are one source).
- [ ] Load-bearing claims marked verified / single-source / contradicted.
- [ ] Contradictions surfaced, not averaged.
- [ ] Every open acceptance item maps to a follow-up worker or an explicit `unanswerable`.
- [ ] No T4 source is the sole support for a load-bearing claim.
- [ ] No `authenticated` source is the sole support for a load-bearing claim.
- [ ] Tiers look right (an article about a paper is T2/T3, not T1).
