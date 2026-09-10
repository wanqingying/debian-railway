#!/usr/bin/env python3
"""Cost an LLM, keep the Pareto-optimal set, and price the upgrades.

Formula (see docs/ai-model-pricing.md):

    P(1M input) = h * Cr + (1 - h) * Cw + k * Pout

    Pin   input price           ($/1M tokens)
    Pout  output price          ($/1M tokens)
    Cr    cache read price      (defaults to 0.1  * Pin)
    Cw    cache write price     (defaults to 1.25 * Pin)
    h     cache hit rate        (default 0.96)
    k     output/input ratio    (default 0.1)

Instead of folding quality and price into one arbitrary score, this tool:

    1. Computes each model's comprehensive price.
    2. Keeps only the PARETO FRONTIER: models where no other is both
       cheaper and better. Dominated models can never win and are dropped.
       This step needs no baseline and makes no subjective trade-off.
    3. Computes the ICER (incremental cost-effectiveness ratio) between
       adjacent frontier models: dollars per quality point to upgrade.
    4. Flags the KNEE: the point where the ICER jumps the most. Above the
       knee, each extra quality point costs dramatically more.

Two human-friendly columns are shown for the displayed set:
    xlow     price as a multiple of the cheapest displayed model
    dlow     score minus the lowest displayed score (e.g. +154)

The only remaining judgement is HOW MUCH you are willing to pay above the
knee; everything below it is a free lunch.

Usage:
    python3 scripts/model-cost.py --file models.json
    python3 scripts/model-cost.py --file models.json --all
    python3 scripts/model-cost.py --file models.json --h 0.9 --k 0.15
    python3 scripts/model-cost.py --file models.json --budget 70 --min-win 0.6

A models file is a JSON list of objects:

    [{"name": "foo", "pin": 0.2, "pout": 1.2, "cr": 0.02, "cw": 0.25,
      "score": 1584, "budget": 60}]

'cr', 'cw', 'score' and 'budget' are optional. 'budget' is a monthly usage
allowance in dollars; when present, capacity = budget / price is printed
(millions of input tokens affordable per month).
"""

import argparse
import json
import os
import sys

DEFAULT_MODELS = [
    {"name": "gpt-5.6-luna", "pin": 0.20, "pout": 1.20},
    {"name": "gpt-5.6-sol", "pin": 4.00, "pout": 20.00},
    {"name": "claude-sonnet-4.6", "pin": 3.00, "pout": 15.00},
    {"name": "deepseek-v4-flash", "pin": 0.28, "pout": 0.43},
]


def win_prob(score, ref, scale):
    """Probability that 'score' beats 'ref' under an Elo model."""
    return 1.0 / (1.0 + 10.0 ** ((ref - score) / scale))


def comprehensive(models, h, k, ref, scale):
    rows = []
    for m in models:
        pin = float(m["pin"])
        pout = float(m["pout"])
        cr = float(m.get("cr", 0.1 * pin))
        cw = float(m.get("cw", 1.25 * pin))
        coeff = h * cr + (1.0 - h) * cw
        price = coeff + k * pout
        row = {
            **m,
            "coeff": coeff,
            "price": price,
            "mixed": price / (1.0 + k),
        }
        score = m.get("score")
        if score is not None:
            row["winprob"] = win_prob(float(score), ref, scale)
        budget = m.get("budget")
        if budget is not None and price > 0:
            row["capacity"] = float(budget) / price
        rows.append(row)
    return rows


def is_dominated(row, pool):
    """True if some other model in pool is both cheaper and better."""
    for o in pool:
        if o is row:
            continue
        cheaper_or_equal = o["price"] <= row["price"]
        better_or_equal = o["score"] >= row["score"]
        strictly_better = o["price"] < row["price"] or o["score"] > row["score"]
        if cheaper_or_equal and better_or_equal and strictly_better:
            return True
    return False


def pareto_frontier(rows):
    """Return the set of rows not dominated on price (lower) and score (higher)."""
    frontier = []
    for r in rows:
        r["dominated"] = is_dominated(r, rows)
        if not r["dominated"]:
            frontier.append(r)
    return frontier


def icer_segments(frontier):
    """Adjacent frontier segments sorted by price, with ICER = dPrice/dScore."""
    ordered = sorted(frontier, key=lambda r: r["price"])
    segs = []
    for a, b in zip(ordered, ordered[1:]):
        dp = b["price"] - a["price"]
        ds = b["score"] - a["score"]
        segs.append({"from": a, "to": b, "dp": dp, "ds": ds,
                     "icer": dp / ds if ds else float("inf")})
    return ordered, segs


def find_knee(ordered, segs):
    """The frontier point where the ICER jumps the most.

    Returns (point, jump_ratio). For each interior point the ratio between
    the ICER to its right and to its left is taken; the largest ratio marks
    where quality stops being cheap.
    """
    best_i, best_ratio = None, 0.0
    for i in range(1, len(segs)):
        left = segs[i - 1]["icer"]
        right = segs[i]["icer"]
        if left > 0 and right > 0 and right / left > best_ratio:
            best_ratio = right / left
            best_i = i
    if best_i is None:
        return None, 0.0
    return ordered[best_i], best_ratio


def pick_next(pool):
    """Pick this round's winner: the knee of the current pool.

    Recomputes the Pareto frontier and ICER on the pool and returns the knee
    (where marginal quality cost jumps). With too few frontier points to have
    a knee, falls back to the cheapest non-dominated model.
    """
    frontier = [r for r in pool if not is_dominated(r, pool)]
    if len(frontier) >= 3:
        ordered, segs = icer_segments(frontier)
        knee, _ = find_knee(ordered, segs)
        if knee is not None:
            return knee
    return min(frontier, key=lambda r: r["price"])


def select_order(pool):
    """Rank the whole pool by repeatedly picking the winner and removing it.

    This relaxes strict Pareto elimination: after the winner is removed, the
    models it dominated can themselves become Pareto-optimal and be picked
    later, so the shortlist is not limited to the first frontier.
    """
    remaining = list(pool)
    order = []
    while remaining:
        pick = pick_next(remaining)
        order.append(pick)
        remaining.remove(pick)
    return order


def main():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--h", type=float, default=0.96, help="cache hit rate (default 0.96)")
    p.add_argument("--k", type=float, default=0.1, help="output/input ratio (default 0.1)")
    p.add_argument("--ref", type=float, default=1350.0,
                   help="baseline score for the optional win-probability gate")
    p.add_argument("--scale", type=float, default=400.0,
                   help="Elo scale for win probability (default 400)")
    p.add_argument("--min-win", type=float, default=0.0,
                   help="optional quality gate: drop models whose win probability "
                        "vs --ref is below this (default 0 = off)")
    p.add_argument("--budget", type=float,
                   help="monthly allowance ($) applied to all models without one")
    p.add_argument("--file", help="JSON file with a custom model list "
                                  "(default: scripts/models-arena-overall.json if present)")
    p.add_argument("--exclude", action="append", default=[], metavar="SUBSTR",
                   help="drop models whose name contains SUBSTR (case-insensitive); "
                        "repeatable, e.g. --exclude Contributor")
    p.add_argument("--top", type=int, default=3,
                   help="shortlist size: keep the top N picks (default 3)")
    p.add_argument("--all", action="store_true",
                   help="show every model in selection order instead of top N")
    args = p.parse_args()

    default_file = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                "models-arena-overall.json")
    if args.file:
        with open(args.file) as f:
            models = json.load(f)
    elif os.path.exists(default_file):
        with open(default_file) as f:
            models = json.load(f)
    else:
        models = DEFAULT_MODELS

    if args.exclude:
        needles = [s.lower() for s in args.exclude]
        keep = []
        for m in models:
            name = str(m.get("name", "")).lower()
            if any(n in name for n in needles):
                continue
            keep.append(m)
        models = keep

    if args.budget is not None:
        for m in models:
            m.setdefault("budget", args.budget)

    rows = comprehensive(models, args.h, args.k, args.ref, args.scale)
    has_score = all(r.get("score") is not None for r in rows) and rows

    if args.min_win > 0 and has_score:
        for r in rows:
            r["qualified"] = r["winprob"] >= args.min_win
        pool = [r for r in rows if r["qualified"]]
    else:
        for r in rows:
            r["qualified"] = True
        pool = rows

    print(f"h={args.h}  k={args.k}")
    print(f"input coeff = {args.h}*Cr + {round(1 - args.h, 4)}*Cw")
    if args.min_win > 0 and has_score:
        print(f"quality gate: winprob vs {args.ref:g} >= {args.min_win:g} "
              f"({len(pool)}/{len(rows)} pass)")

    if not has_score:
        show = sorted(rows, key=lambda r: r["price"])
        hdr = f"{'model':22} {'Pin':>6} {'Pout':>6} {'$/1M':>8} {'mixed':>7}"
        if any("capacity" in r for r in rows):
            hdr += f" {'capM':>7}"
        print()
        print(hdr)
        print("-" * len(hdr))
        for r in show:
            line = (f"{r['name'][:22]:22} {r['pin']:>6.3g} {r['pout']:>6.3g} "
                    f"{r['price']:>8.4f} {r['mixed']:>7.4f}")
            if "capacity" in r:
                line += f" {r['capacity']:>7.1f}"
            print(line)
        return

    frontier = pareto_frontier(pool)
    ordered, segs = icer_segments(frontier)
    knee, jump = find_knee(ordered, segs)

    ranked = select_order(pool)
    if args.all:
        show = ranked + [r for r in rows if not r["qualified"]]
    else:
        show = ranked[:max(1, args.top)]
    min_price = min(r["price"] for r in show)
    min_score = min(float(r["score"]) for r in show)

    if args.all:
        print(f"Pareto frontier: {len(frontier)}/{len(rows)} models")
    else:
        print(f"shortlist: top {len(show)} of {len(pool)} qualified models")
        print(f"Pareto frontier: {len(frontier)}/{len(rows)} models")
    print()
    hdr = (f"{'#':>2} {'model':22} {'Pin':>6} {'Pout':>6} {'$/1M':>8} {'mixed':>7} "
           f"{'xlow':>7} {'score':>6} {'dlow':>6} {'mark':>9}")
    if any("capacity" in r for r in show):
        hdr += f" {'capM':>7}"
    print(hdr)
    print("-" * len(hdr))
    for i, r in enumerate(show, 1):
        price_mult = r["price"] / min_price if min_price else 0
        score_delta = float(r["score"]) - min_score
        if not r["qualified"]:
            mark = "DROP"
        elif knee is not None and r is knee:
            mark = "<- knee"
        elif not r["dominated"]:
            mark = "frontier"
        else:
            mark = "dominated"
        line = (f"{i:>2} {r['name'][:22]:22} {r['pin']:>6.3g} {r['pout']:>6.3g} "
                f"{r['price']:>8.4f} {r['mixed']:>7.4f} "
                f"{price_mult:>6.1f}x {r['score']:>6.0f} {score_delta:>+6.0f} {mark:>9}")
        if "capacity" in r:
            line += f" {r['capacity']:>7.1f}"
        print(line)

    if segs and not args.all:
        print()
        print("ICER: marginal cost to upgrade along the frontier")
        for s in segs:
            print(f"  {s['from']['name']:22} -> {s['to']['name']:22} "
                  f"+${s['dp']:.4f} / {s['ds']:+.0f} pts = ${s['icer']:.6f}/pt")
        if knee is not None:
            print()
            print(f"Knee: {knee['name']} "
                  f"(ICER jumps {jump:.1f}x after this point)")


if __name__ == "__main__":
    try:
        main()
    except (KeyError, ValueError, json.JSONDecodeError) as e:
        sys.exit(f"error: {e}")
