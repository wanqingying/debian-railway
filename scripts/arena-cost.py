#!/usr/bin/env python3
"""Rank every model on the Arena WebDev leaderboard by real cost.

Pipeline (all automated):

    1. Fetch the Arena WebDev leaderboard page for a category and parse
       every entry (name, rating, votes, rank) from its embedded JSON.
    2. Match each model to docs/models-prices.json (models.dev enriched with
       cache prices) by a normalized name.
    3. Write scripts/models-arena-<category>.json with the matched models
       and their token prices.
    4. Run scripts/model-cost.py on that file (Pareto frontier, ICER, knee,
       Top-N shortlist).

Data downloads are cached under /tmp/opencode; pass --refresh to re-fetch.

Usage:
    python3 scripts/arena-cost.py
    python3 scripts/arena-cost.py --category frontend --top 5
    python3 scripts/arena-cost.py --exclude Contributor --top 10
    python3 scripts/arena-cost.py --refresh
"""

import argparse
import json
import os
import re
import subprocess
import sys
import urllib.request

ARENA_URL = "https://arena.ai/leaderboard/code/webdev/{category}"
DEFAULT_PRICES = "docs/models-prices.json"
CACHE_DIR = "/tmp/opencode"
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PER_MILLION = 1e6

# suffixes that distinguish a leaderboard variant (effort/harness/date) from
# its base model; stripped so arena names line up with catalogue ids.
VARIANT = (r"(max|high|xhigh|medium|minimal|low|preview|latest|exp|experimental|"
           r"next|codex-harness|code-harness|non-thinking|thinking|instruct|"
           r"reasoning|instant|chat|\d{6,8}|\d+k|\d+b)")


def fetch(url, path, refresh=False):
    if os.path.exists(path) and not refresh:
        with open(path) as f:
            return f.read()
    req = urllib.request.Request(url, headers={"User-Agent": "arena-cost/1.0"})
    with urllib.request.urlopen(req, timeout=120) as r:
        html = r.read().decode("utf-8", "replace")
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w") as f:
        f.write(html)
    return html


def parse_arena(html):
    """Extract leaderboard entries from the page's escaped embedded JSON."""
    pat = re.compile(
        r'\\"rank\\":(?P<rank>\d+).*?'
        r'\\"modelKey\\":\\"(?P<key>[^"\\]+)\\".*?'
        r'\\"modelDisplayName\\":\\"(?P<name>[^"\\]+)\\".*?'
        r'\\"rating\\":(?P<rating>[0-9.]+).*?'
        r'\\"votes\\":(?P<votes>\d+)', re.S)
    rows, seen = [], set()
    for m in pat.finditer(html):
        key = m.group("key")
        if key in seen:
            continue
        seen.add(key)
        rows.append({
            "rank": int(m.group("rank")),
            "name": m.group("name"),
            "score": float(m.group("rating")),
            "votes": int(m.group("votes")),
        })
    return rows


def norm(s):
    """Normalize a model name/id so arena names line up with catalogue ids."""
    s = str(s).lower().split("/")[-1]
    s = re.sub(r"\(.*?\)", "", s).replace("_", "-").strip()
    s = re.sub(r":(free|flex|extended|thinking|beta|nitro|online)$", "", s)
    for _ in range(3):
        s = re.sub(r"-" + VARIANT + r"$", "", s)
    return re.sub(r"[^a-z0-9.]+", "-", s).strip("-")


def build_index(prices):
    """Map normalized name/id -> price entry.

    models.dev lists the same model under many providers, and a few
    aggregator providers store per-token instead of per-million prices.
    Collect every candidate and pick the median input price, which ignores
    those outliers and matches the first-party per-million price.
    """
    candidates = {}
    for pid, prov in prices.items():
        for mid, m in prov.get("models", {}).items():
            cost = m.get("cost") or {}
            pin, pout = cost.get("input"), cost.get("output")
            if not pin or not pout:
                continue
            entry = {
                "pin": pin,
                "pout": pout,
                "cr": cost.get("cache_read"),
                "cw": cost.get("cache_write"),
                "provider": pid,
                "model_id": m.get("id", mid),
            }
            for cand in {norm(m.get("id", mid)), norm(m.get("name", ""))}:
                candidates.setdefault(cand, []).append(entry)

    idx = {}
    for key, entries in candidates.items():
        entries.sort(key=lambda e: e["pin"])
        idx[key] = entries[len(entries) // 2]
    return idx


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--category", default="overall",
                    choices=["overall", "frontend", "fullstack"],
                    help="WebDev sub-leaderboard (default overall)")
    ap.add_argument("--prices", default=DEFAULT_PRICES,
                    help=f"enriched price catalogue (default {DEFAULT_PRICES})")
    ap.add_argument("--cache", default=CACHE_DIR,
                    help=f"download cache dir (default {CACHE_DIR})")
    ap.add_argument("--refresh", action="store_true",
                    help="re-fetch the leaderboard and price catalogue")
    ap.add_argument("--top", type=int, default=10,
                    help="shortlist size passed to model-cost (default 10)")
    ap.add_argument("--exclude", action="append", default=[], metavar="SUBSTR",
                    help="drop models whose name contains SUBSTR (repeatable)")
    ap.add_argument("--no-run", action="store_true",
                    help="only write the JSON; do not run model-cost")
    ap.add_argument("--h", type=float, default=0.98, help="cache hit rate")
    ap.add_argument("--k", type=float, default=0.004,
                    help="output/total-input ratio (input includes cache reads)")
    args, passthrough = ap.parse_known_args()

    url = ARENA_URL.format(category=args.category)
    html = fetch(url, os.path.join(args.cache, f"arena-{args.category}.html"),
                 refresh=args.refresh)
    arena = parse_arena(html)
    if not arena:
        sys.exit("error: parsed 0 leaderboard entries (page layout changed?)")

    if not os.path.exists(args.prices) or args.refresh:
        subprocess.run([sys.executable,
                        os.path.join(SCRIPT_DIR, "fetch-model-prices.py")]
                       + (["--refresh"] if args.refresh else []), check=True)
    with open(args.prices) as f:
        prices = json.load(f)
    index = build_index(prices)

    models, misses = [], []
    for a in arena:
        hit = index.get(norm(a["name"]))
        if not hit:
            misses.append(a["name"])
            continue
        models.append({
            "name": a["name"],
            "pin": hit["pin"],
            "pout": hit["pout"],
            "cr": hit["cr"],
            "cw": hit["cw"],
            "score": round(a["score"]),
            "rank": a["rank"],
            "votes": a["votes"],
            "matched_provider": hit["provider"],
            "matched_model": hit["model_id"],
        })

    out = os.path.join(SCRIPT_DIR, f"models-arena-{args.category}.json")
    with open(out, "w") as f:
        json.dump(models, f, indent=1)

    print(f"arena {args.category}: {len(arena)} models, "
          f"matched {len(models)} ({100*len(models)//max(1,len(arena))}%)")
    if misses:
        print(f"unmatched ({len(misses)}): {', '.join(misses[:10])}"
              + (" ..." if len(misses) > 10 else ""))
    print(f"wrote {out}")
    if args.no_run:
        return
    sys.stdout.flush()

    cmd = [sys.executable, os.path.join(SCRIPT_DIR, "model-cost.py"),
           "--file", out, "--top", str(args.top),
           "--h", str(args.h), "--k", str(args.k)] + passthrough
    for e in args.exclude:
        cmd += ["--exclude", e]
    print()
    subprocess.run(cmd, check=True)


if __name__ == "__main__":
    main()
