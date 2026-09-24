# Source Routing

Pick sources by **authority for the domain**, not by what a search engine ranks first. This file maps domains to primary sources and gives ready-to-run access recipes. Read it before Phase 2 (Route) and hand the relevant rows to each worker.

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

## Domain → where to look

| Domain | Go first to | Access |
|---|---|---|
| Code / libraries / infra | the project's official repo (README, releases, commits, issues/PRs), official docs site, changelog, migration guide, language/stdlib reference | GitHub REST API + ``git``/code search; `webfetch` for docs |
| Package facts | npm, PyPI, crates.io, Maven Central, Hugging Face Hub | registry JSON APIs |
| AI/ML papers & methods | arXiv, OpenAlex, Semantic Scholar, Crossref, ACL/NeurIPS/ICML proceedings | APIs below |
| Models & capability data | vendor model cards and release notes, Hugging Face model cards, Papers with Code, official benchmark repos (SWE-bench, GAIA, τ-bench, BrowseComp, LiveCodeBench…), leaderboards (LMArena, Artificial Analysis, OpenRouter rankings) | official pages + arXiv tech reports |
| Medicine / clinical | PubMed & PMC, Europe PMC, Cochrane reviews, WHO, FDA/EMA labels, ClinicalTrials.gov | E-utilities / Europe PMC APIs |
| Life sciences | bioRxiv, medRxiv, UniProt, Ensembl, NCBI | APIs + `webfetch` |
| General scholarship | OpenAlex, Crossref, Semantic Scholar, DOAJ, journal pages | APIs below |
| Company / finance | SEC EDGAR (10-K/10-Q/8-K, S-1), company IR and annual reports, exchange filings | EDGAR full-text search + submissions JSON |
| Markets & macro | World Bank, IMF, OECD, national statistics offices | open data APIs |
| Policy / law / standards | government sites and official gazettes, IETF RFCs, W3C recommendations, ISO/IEC pages | `websearch` → `webfetch` official source |
| Products / pricing | the vendor's own docs, pricing page, and changelog | `webfetch` |
| Security advisories | NVD, GitHub Security Advisories, vendor security bulletins, OSV | APIs + `webfetch` |
| Sentiment / practice | Hacker News, Stack Overflow, Reddit, maintainer blogs | treat as T3/T4; corroborate |

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

**No shell?** Every endpoint above is a plain `GET`; issue it with the host's URL-fetch tool instead and parse the returned body. A host that can only fetch (no search) can still use arXiv/Crossref/OpenAlex as a keyword-search fallback.

## Choosing within a domain

- **Comparisons**: gather the same fields for every option — from each option's own primary source, then reconcile.
- **"Latest"**: sort by date and record the exact cutoff; a top-ranked page without a date is a red flag.
- **Contested topics**: deliberately search for the strongest opposing view (terms like "criticism", "limitations", "replication failure", "retracted"), not just confirming sources.
- **Numbers**: tie every figure to its definition, unit, population, and date; note when two sources measure different things.

## Anti-patterns

- Citing an article *about* a paper instead of the paper.
- One search engine's top results as the whole evidence base.
- Undated web pages for time-sensitive claims.
- Treating GitHub stars, download counts, or upvotes as quality evidence.
- Quoting an abstract as if it were the finding.
