# Outline Schema

`outline.json` is the plan the rest of the run is held to. Its job is to make "answered" a thing you can check, not a thing you feel. A node whose `acceptance` cannot be failed generates paragraphs, not research.

## Shape

```json
{
  "slug": "vector-db-selection-2026-11-02",
  "question": "Which vector database should a 5-person team use for a 20M-vector RAG app?",
  "depth": "standard",
  "budget": { "max_total_sources": 12, "max_sources_per_node": 8, "max_minutes": 20, "max_workers_per_batch": 3 },
  "created": "2026-11-02",
  "nodes": [
    {
      "id": "N1",
      "question": "Which hosted vector DBs publish per-1M-vector pricing at 20M scale?",
      "acceptance": [
        "at least 3 vendors, each with a linked pricing page",
        "each price converted to USD per 1M vectors per month, with the retrieval date",
        "any price that is quote-only is listed as such, not estimated"
      ],
      "families": ["vendor pricing page", "vendor docs: limits & quotas"],
      "lanes": ["A", "B"],
      "min_independent_sources": 2,
      "freshness_window": "2025-06-01..now",
      "status": "open"
    }
  ]
}
```

## Fields

| Field | Required | What it is | Failure it prevents |
|---|---|---|---|
| `slug`, `question`, `depth`, `created` | yes | identity and the restated question | the run losing track of what it was asked |
| `budget` | yes | total sources, sources/node, minutes, workers/batch | open-ended runs that cannot be compared or stopped |
| `nodes[].question` | yes | one sub-question, answerable alone | overlapping nodes that triple the same search |
| `nodes[].acceptance` | yes | a list of tests a stranger could apply to the finished report | "analyze X" with no failure condition |
| `nodes[].families` | yes | source families, or exact recipes/URLs | workers inventing a search from scratch |
| `nodes[].lanes` | when known | which access lanes this node needs (`A`, `B`, `C`) | a worker burning the budget on a page it cannot see |
| `nodes[].min_independent_sources` | yes | usually 2 for load-bearing nodes, counted in **distinct source families** (one publisher's `releases`, `README` and `commits` are one family) | a single blog post — or a single project quoting itself — standing in for consensus |
| `nodes[].freshness_window` | yes | accepted date range (`"2025-06-01.."`) or `any`; its start date is the `--window` you pass to `stats`/`render --gate` | stale numbers presented as current — unmeasurable unless the window is a real date |
| `nodes[].status` | yes | `open` → `covered` / `partial` / `unanswerable` + reason | silent holes at write time |

## Writing an acceptance test

The test is what makes verification mechanical later, so write it at the level of the **finished sentence**, not the activity:

- Weak: "compare the options" — nothing to check, so nothing gets checked.
- Strong: "one row per option with columns: license, self-host, managed price at 20M vectors, p99 latency claim with its source and date" — now a missing cell is visible, and so is an unsourced cell.

Three patterns that work:

1. **Coverage with a count** — "at least 3 vendors, each with a linked primary source".
2. **A named artifact per item** — "each option cites its official docs page and a version number", "every price names its retrieval date".
3. **A negative test** — "no figure appears without a definition and unit", "the strongest known counter-argument to the recommendation is stated".

## Feasibility check (before searching)

Two numbers have to agree before the run starts:

```
Σ nodes[].min_independent_sources  ≤  budget.max_total_sources
```

Seven nodes at 2 sources each needs 14 sources. If the budget (yours, or one the user imposed) is 8, the plan is impossible, and the observable failure is not an error message — it is a run that quietly lowers the per-node floor, keeps the load-bearing labels, and produces a report whose "verified" claims rest on one source each. When the arithmetic does not fit, **cut nodes**: merge overlapping ones, demote nice-to-have ones to `status: "cut"` with a reason. Cutting the evidence floor to protect the node list inverts the whole point of the register.

Decide the same way what the 80% mark means: at 80% of the source or time budget, stop gathering and start writing. A run that stops with a stated gap is worth more than one that dies mid-sentence, and much more than a silent one that shrank its evidence.

## Critic pass (before searching)

Read your own outline as a hostile reviewer, and fix it here rather than in the prose:

- Which acceptance tests could pass on a page of confident prose with no sources?
- Which two nodes would fetch the same pages? Merge them.
- What does the question imply that no node covers? (Usually: cost, failure modes, what changed recently, who is the incumbent.)
- Which node needs lane C to be answerable at all, and is a login actually available?
- Is `min_independent_sources` honest for this node, or is it 2 because 2 looks rigorous?
- Is `freshness_window` a real date, or `any` because a date would be awkward? (`any` silently opts the node out of the freshness metric, and it is visible in the report.)

## Updating during the run

The outline is editable and should be edited when evidence shows it was wrong — that is a sign the research is working, not a sign of failure. When a node splits, splits carry the suffix (`N3` → `N3a`, `N3b`); do not renumber, because claim ids in `evidence.jsonl` reference nodes.

Mark `status` as you close each node, and keep `partial` honest: `partial` plus a reason is a deliverable, `covered` over a hole is a defect.
