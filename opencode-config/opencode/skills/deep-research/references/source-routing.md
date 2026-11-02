# Source Routing

Pick sources by **authority for the domain**, not by what a search engine ranks first. This file maps domains to primary sources and gives ready-to-run access recipes. Read it before Phase 2 (Route) and hand the relevant rows to each worker.

**Contents:** [Source tiers](#source-tiers) · [Access lanes](#access-lanes) · [Domain → where to look](#domain--where-to-look) · [Access recipes](#access-recipes) · [Chinese first-party sources](#chinese-first-party-sources) · [Choosing within a domain](#choosing-within-a-domain) · [Anti-patterns](#anti-patterns)


## Source tiers

| Tier | What it is | Examples |
|---|---|---|
| **T1 — primary** | The artifact itself; official first-party | source paper, official docs, the repository, the spec, an SEC filing, a vendor's own pricing page, a government site |
| **T2 — authoritative secondary** | Peer-reviewed or editorially accountable, but not the artifact | systematic reviews, standards bodies, reputable journalism, textbooks |
| **T3 — preprint / reputable community** | Useful but not yet vetted | arXiv/bioRxiv preprints, well-maintained community docs, conference talks |
| **T4 — unvetted** | SEO aggregators, unsourced blogs, forum posts, LLM-generated summaries | content farms, most "top 10" listicles, unsourced wiki mirrors |

Rules of thumb:
- A claim is **verified** when ≥2 independent T1/T2 sources agree. Record the tier on every source.
- Use T3/T4 for leads and orientation, then chase the primary source they point to.
- Never cite a T4 source as the sole support for a load-bearing claim.

## Access lanes

Tier says how much to trust a source. The lane says whether a reader can go and check it — a distinction that matters because a paywalled or login-gated page can be perfectly authoritative and still unverifiable by the person reading your report. Record both.

| Lane | What it reaches | How | Cost | Reproducible by a reader |
|---|---|---|---|---|
| **A · API / text fetch** | registries, repositories, filings, scholarly APIs, static docs | `curl`, `webfetch` | lowest, parallel | yes |
| **B · rendered browser** | JavaScript-rendered docs, lazy-loaded tables, bot-blocked pages, cookie walls | `node scripts/browse.mjs <url>` | ~1–8 s/page, one browser | mostly (the page may have changed) |
| **C · authenticated browser** | anything behind a sign-in the user completed in the VNC browser | `node scripts/browse.mjs <url> --auth` | slowest, serial | **no** |

Escalate in that order, and only when the previous lane failed for a reason you can name:

- A fetch returns a shell (`<div id="__root">` and nothing else) or under ~200 characters → B.
- A fetch returns 403, a Cloudflare interstitial, or a consent wall that hides the content → B.
- The content only exists for signed-in users, and the user is already signed in → C; otherwise record the gap.
- Tear-downs, review sites, private dashboards, community threads behind login, paid newsletters → C, and mark the claim `not reproducible without a login` in the report.

Two rules that keep lane C honest: never let an `authenticated` source be the **sole** support for a load-bearing claim, and always look for a public equivalent (the vendor's own docs usually restate what a reviews site quotes).


## Domain → where to look

| Domain | Go first to | Access |
|---|---|---|
| Code / libraries / infra | the project's official repo (README, releases, commits, issues/PRs), official docs site, changelog, migration guide, language/stdlib reference | GitHub REST API + ``git``/code search; `webfetch` for docs |
| Package facts | npm, PyPI, crates.io, Maven Central, Hugging Face Hub | registry JSON APIs |
| AI/ML papers & methods | arXiv, OpenAlex, Semantic Scholar, Crossref, ACL/NeurIPS/ICML proceedings | APIs below |
| Models & capability data | vendor model cards and release notes, Hugging Face model cards, Papers with Code, official benchmark repos (SWE-bench, GAIA, τ-bench, BrowseComp, LiveCodeBench…), leaderboards (LMArena, Artificial Analysis, OpenRouter rankings) | official pages + arXiv tech reports |
| Performance / speed of software | the project's own benchmark page, TechEmpower (historical), the-benchmarker/web-frameworks `data.json`, `criterion` benchmark repos, vendor release notes that state a measured number | repo raw files + `webfetch`; check the dataset's `updated_at` and hardware |
| Medicine / clinical | PubMed & PMC, Europe PMC, Cochrane reviews, WHO, FDA/EMA labels, ClinicalTrials.gov | E-utilities / Europe PMC APIs |
| Life sciences | bioRxiv, medRxiv, UniProt, Ensembl, NCBI | APIs + `webfetch` |
| General scholarship | OpenAlex, Crossref, Semantic Scholar, DOAJ, journal pages | APIs below |
| Company / finance | SEC EDGAR (10-K/10-Q/8-K, S-1), company IR and annual reports, exchange filings | EDGAR full-text search + submissions JSON |
| Markets & macro | World Bank, IMF, OECD, national statistics offices | open data APIs |
| Policy / law / standards | government sites and official gazettes, IETF RFCs, W3C recommendations, ISO/IEC pages | `websearch` → `webfetch` official source |
| Products / pricing | the vendor's own docs, pricing page, and changelog | `webfetch` |
| Security advisories | NVD, GitHub Security Advisories, vendor security bulletins, OSV | APIs + `webfetch` |
| Sentiment / practice | Hacker News, Stack Overflow, Reddit, maintainer blogs, GitHub issues & discussions | free JSON APIs below; treat as T3/T4 and corroborate |

**China-specific topics:** prefer official Chinese sources (gov.cn, 行业协会, 公司官网/公告, 招股书) over community reposts. Treat CSDN, 简书, 微信公众号, 未注明出处的知乎回答 as T4 unless they link a primary source.

## Access recipes

Use `webfetch` for HTML and these `curl` calls for JSON. Quote URLs; many query values need encoding.

**Always check the HTTP status.** A bare `curl -s` hides redirects and 4xx/5xx as an empty body, which reads as "no results". These recipes use `curl -sL -f` — the `-f` makes curl exit non-zero on HTTP errors, and `-L` follows redirects. On `403`, add a `User-Agent`; on `406`/`429`/`503`, wait and retry with backoff (arXiv, Semantic Scholar, and OpenAlex return these intermittently, and anonymous scholarly APIs are best-effort without a key). If a recipe still fails, record it and retry the same URL with `webfetch`.

**GitHub** (authenticated when `GITHUB_TOKEN` is set — much higher rate limit). Build the header with a bash array; `AUTH=${VAR:+...}` word-splits and silently drops the credential:
```bash
AUTH=(); [ -n "$GITHUB_TOKEN" ] && AUTH=(-H "Authorization: Bearer $GITHUB_TOKEN")
curl -sL -f "${AUTH[@]}" -H "Accept: application/vnd.github+json" \
  "https://api.github.com/search/repositories?q=QUERY&sort=stars&order=desc&per_page=20"
curl -sL -f "${AUTH[@]}" "https://api.github.com/repos/OWNER/REPO/releases?per_page=10"
curl -sL -f "${AUTH[@]}" "https://api.github.com/repos/OWNER/REPO/commits?per_page=10"
```
Stars, issues, and commit dates are signals, not proof of quality — read the README and release notes.

**arXiv** (no key; use `https` and `-L` — the old `http` host 301s to an empty body). arXiv throttles bursts with `406`, so send a `User-Agent` and space requests out:
```bash
curl -sL -f -A "research/1.0 (mailto:you@example.com)" \
  "https://export.arxiv.org/api/query?search_query=all:QUERY&start=0&max_results=20&sortBy=submittedDate&sortOrder=descending"
```

**Crossref** (no key):
```bash
curl -sL -f "https://api.crossref.org/works?query=QUERY&rows=20&select=title,DOI,URL,issued,container-title,author"
```

**OpenAlex** (add `&mailto=you@example.com`; anonymous search is often rate-limited, so retry with backoff, and use a free key for volume):
```bash
curl -sL -f "https://api.openalex.org/works?search=QUERY&per-page=25&sort=publication_date:desc&mailto=you@example.com"
```

**Semantic Scholar** (a free key is effectively required from shared/cloud IPs; anonymous calls frequently 429):
```bash
curl -sL -f "https://api.semanticscholar.org/graph/v1/paper/search?query=QUERY&limit=20&fields=title,year,abstract,url,externalIds,citationCount,venue"
```

**PubMed E-utilities** (no key): search IDs, then fetch summaries.
```bash
curl -sL -f "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=QUERY&retmax=20&retmode=json"
curl -sL -f "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=ID1,ID2&retmode=json"
```

**Europe PMC** (no key):
```bash
curl -sL -f "https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=QUERY&format=json&pageSize=20"
```

**ClinicalTrials.gov** (no key; restrict `fields` — full records are large):
```bash
curl -sL -f "https://clinicaltrials.gov/api/v2/studies?query.term=QUERY&pageSize=10&fields=NCTId,BriefTitle,OverallStatus,StartDate,Phase"
```

**Hugging Face Hub** (no key):
```bash
curl -sL -f "https://huggingface.co/api/models?search=QUERY&sort=downloads&direction=-1&limit=20"
```

**Package registries**:
```bash
curl -sL -f "https://registry.npmjs.org/-/v1/search?text=QUERY&size=20"
curl -sL -f "https://pypi.org/pypi/PACKAGE/json"
# crates.io returns 403 without a User-Agent
curl -sL -f -H "User-Agent: research (mailto:you@example.com)" "https://crates.io/api/v1/crates?q=QUERY&per_page=20"
```

**SEC EDGAR** (no key; requires a descriptive `User-Agent`):
```bash
# full-text search across filings
curl -sL -f -H "User-Agent: research you@example.com" \
  "https://efts.sec.gov/LATEST/search-index?q=%22QUERY%22&forms=10-K"
# company submission history (CIK zero-padded to 10 digits)
curl -sL -f -H "User-Agent: research you@example.com" "https://data.sec.gov/submissions/CIK0000320193.json"
```

**World Bank** (no key):
```bash
curl -sL -f "https://api.worldbank.org/v2/country/CN/indicator/NY.GDP.MKTP.CD?format=json&per_page=10"
```

**Practice, sentiment and failure reports** (no key). These are the sources a web search consistently misses, and they carry the things official docs never admit — breakage, cost surprises, migration pain. Treat them as T3 until corroborated:

```bash
# Hacker News — search titles/comments, filter by date; the discussion is often more useful than the link
curl -sL -f "https://hn.algolia.com/api/v1/search?query=QUERY&tags=story&numericFilters=created_at_i>$(date -d '-18 months' +%s)"
# GitHub issues + discussions: real-world failures for a library or product
# (reuse the AUTH array from the GitHub block above; omit it if you skipped that block)
curl -sL -f "${AUTH[@]}" "https://api.github.com/search/issues?q=QUERY+repo:OWNER/REPO&sort=created&order=desc&per_page=20"
# Reddit (public JSON; needs a UA, and often rate-limits — one retry, then lane C)
curl -sL -f -A "research/1.0" "https://www.reddit.com/search.json?q=QUERY&sort=new&limit=25&t=year"
# Wikipedia: a lead generator and a citation trail, never a primary source
curl -sL -f "https://en.wikipedia.org/api/rest_v1/page/summary/TITLE"
```

**Stack Exchange** (no key at low volume; `site` takes `stackoverflow`, `serverfault`, `askubuntu`, …):
```bash
curl -sL -f "https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&q=QUERY&site=stackoverflow&filter=withbody"
```


**No shell?** Every endpoint above is a plain `GET`; issue it with the host's URL-fetch tool instead and parse the returned body. A host that can only fetch (no search) can still use arXiv/Crossref/OpenAlex as a keyword-search fallback.

## Chinese first-party sources

Chinese-language research has an inverted source landscape: the authoritative material is often **inside platforms that no search API indexes**, and the sites that rank well are reposts. Two consequences for a run.

**Prefer these, in this order.** Government and regulator sites (`gov.cn`, `stats.gov.cn`, `miit.gov.cn`), exchange filings and announcements (`cninfo`, HKEX, company IR), company official sites and 公众号 posts where the company itself publishes, then industry associations. Treat CSDN, 简书, 微信公众号 reposts, and unsourced 知乎 answers as T4 unless they link a primary document. 雪球/东方财富 are T3 for market opinion and T4 for anything factual.

**Many of these need lane B or C.** 微信公众号 articles, 知乎 answers, 小红书 notes and Bilibili videos rarely render for a plain fetch, and are partly login-gated. So:

```bash
# lane B: render the page in the browser and read the main text
node scripts/browse.mjs "URL" --max 8000 --json

# lane C: the same, using the session the user already signed in to
node scripts/browse.mjs "URL" --max 8000 --json --auth
```

Practical notes that save a wasted page:

- 微信公众号 articles (`mp.weixin.qq.com`) usually render fine anonymously; 知乎 answers often do not and need lane C.
- 小红书 and Bilibili are mostly video/image-first — the usable evidence is the description, the comments justifying a claim, or a screenshot; anything else is anecdote, not data. Keep them T4.
- Chinese pages rarely expose a publication date in metadata. Read the date off the page and record it; if there is none, say "undated" rather than assuming it is current.
- Search engines rank 百家号/搜狐/网易 reposts above the original. When you find one, search the title verbatim to reach the primary publisher before citing.


## Choosing within a domain

- **Comparisons**: gather the same fields for every option — from each option's own primary source, then reconcile.
- **"Latest"**: sort by date and record the exact cutoff; a top-ranked page without a date is a red flag.
- **Contested topics**: deliberately search for the strongest opposing view (terms like "criticism", "limitations", "replication failure", "retracted"), not just confirming sources.
- **Numbers**: tie every figure to its definition, unit, population, and date; note when two sources measure different things.

### When the authoritative source is not available

The most consequential failure in this file is not citing a weak source — it is **deleting a whole dimension because its ideal source was unreachable**, and then writing a report that looks complete. A selection question without performance, a pricing comparison without the enterprise tier, a review without the strongest objection: each is a silent hole.

So, in order:

1. **Degrade, don't drop.** Find the best machine-readable stand-in and say what it is: a maintained third-party dataset, the project's own benchmark page, an older round of the canonical benchmark with its date. State the substitution in the Method section.
2. **Report the gap in place.** If only a proxy exists, give the proxy *and* what it cannot tell you ("synthetic 512-connection throughput; says nothing about p99 under your workload").
3. **Delete the dimension only if 1 and 2 fail**, and then name it in Confidence with the reason. A reader must never have to guess that a dimension went missing.

**Reading a benchmark:** a benchmark measures a synthetic workload and a specific machine. It can support "same order of magnitude", "one is consistently ~10% ahead", or "the difference is inside the noise". It cannot support "your service will be N% faster". Say what the dataset's `updated_at`, hardware, and scenario are before quoting a number, and never carry a benchmark figure across to a different version without re-checking.

For TechEmpower specifically: it was the reference for years and its pages are JavaScript-rendered — lane B gets you the top of a round, but the result tables are virtualised and expose only the visible rows, and the old `data_raw.json` endpoints return 404. So expect a partial view, record which round and which rows you actually saw, and never repeat the folklore ("actix is the fastest on TechEmpower") as a fact. A maintained mirror such as `the-benchmarker/web-frameworks`'s `data.json` is usually the better primary: it is machine-readable and carries `updated_at` and hardware fields — but check those fields for self-contradiction before quoting a number.

## Anti-patterns

- Citing an article *about* a paper instead of the paper.
- One search engine's top results as the whole evidence base.
- Quoting a search snippet as if you had read the page.
- Undated web pages for time-sensitive claims.
- Treating GitHub stars, download counts, or upvotes as quality evidence.
- Quoting an abstract as if it were the finding.
- Presenting a login-gated source as ordinary evidence: the claim may be true, but the reader cannot check it, and the report has to say so.
- One domain supplying most of the evidence base — usually a sign the search never left its first page.

