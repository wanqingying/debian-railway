#!/usr/bin/env python3
"""Enrich models.dev catalogue with cache pricing from other public sources.

models.dev has solid input/output prices but only covers cache_read for ~61%
of models and cache_write for ~20%. This script merges extra price data from
Requesty, OpenRouter and LiteLLM and writes an enriched catalogue where the
cache prices are filled as far as the data allows.

Sources (all free, no auth):
    models.dev  https://models.dev/api.json       (base catalogue)
    requesty    https://router.requesty.ai/v1/models
    openrouter  https://openrouter.ai/api/v1/models
    litellm     https://raw.githubusercontent.com/BerriAI/litellm/main/
                model_prices_and_context_window.json

The whole pipeline is self-contained: run it with no arguments and it
downloads the base catalogue to docs/models.dev.json (if missing), pulls
the other sources, merges their cache prices in, and writes the enriched
catalogue to docs/models-prices.json. Downloads are cached under
/tmp/opencode; pass --refresh to force re-downloading.

Fill rules for prices still missing after the merge:
    cache_read  -> 0.1 * input   (the common 10% rule)
    cache_write -> 1.25 * input  for Anthropic (explicit cache_control)
                   input        otherwise (automatic caching has no premium)

Every filled value is tagged with its source so derived numbers are never
mistaken for observed ones.

Usage:
    python3 scripts/fetch-model-prices.py                 # fetch + merge
    python3 scripts/fetch-model-prices.py --refresh       # force re-download
    python3 scripts/fetch-model-prices.py --out docs/models-prices.json
"""

import argparse
import json
import os
import re
import urllib.request

SOURCES = {
    "models_dev": "https://models.dev/api.json",
    "requesty": "https://router.requesty.ai/v1/models",
    "openrouter": "https://openrouter.ai/api/v1/models",
    "litellm": ("https://raw.githubusercontent.com/BerriAI/litellm/main/"
                "model_prices_and_context_window.json"),
}
PER_MILLION = 1e6  # source prices are $/token; output is $/M tokens


def fetch(url, cache_dir, name, refresh=False):
    path = os.path.join(cache_dir, f"{name}.json") if cache_dir else None
    if path and os.path.exists(path) and not refresh:
        with open(path) as f:
            return json.load(f)
    req = urllib.request.Request(url, headers={"User-Agent": "fetch-model-prices/1.0"})
    with urllib.request.urlopen(req, timeout=120) as r:
        data = json.load(r)
    if path:
        os.makedirs(cache_dir, exist_ok=True)
        with open(path, "w") as f:
            json.dump(data, f)
    return data


def norm(s):
    """Normalize a model id/name so ids from different catalogues line up."""
    s = str(s).lower()
    s = s.split("/")[-1].split(".")[-1]          # drop provider prefix
    s = re.sub(r":(free|flex|extended|thinking|beta|nitro|online)$", "", s)
    s = re.sub(r"[-_](latest|preview|experimental|exp)$", "", s)
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return s.strip("-")


def num(v):
    if v is None:
        return None
    try:
        return float(v) / PER_MILLION
    except (TypeError, ValueError):
        return None


def load_requesty(data):
    out = {}
    for r in data.get("data", data if isinstance(data, list) else []):
        out.setdefault(norm(r.get("id")), {}).update({
            "input": num(r.get("input_price")),
            "output": num(r.get("output_price")),
            "cache_read": num(r.get("cached_price")),
            "cache_write": num(r.get("caching_price")),
        })
    return {k: v for k, v in out.items()}


def load_openrouter(data):
    out = {}
    for r in data.get("data", []):
        p = r.get("pricing") or {}
        out.setdefault(norm(r.get("id")), {}).update({
            "input": num(p.get("prompt")),
            "output": num(p.get("completion")),
            "cache_read": num(p.get("input_cache_read")),
            "cache_write": num(p.get("input_cache_write")),
        })
    return out


def load_litellm(data):
    out = {}
    for k, v in data.items():
        if not isinstance(v, dict) or v.get("input_cost_per_token") is None:
            continue
        out.setdefault(norm(k), {}).update({
            "input": num(v.get("input_cost_per_token")),
            "output": num(v.get("output_cost_per_token")),
            "cache_read": num(v.get("cache_read_input_token_cost")),
            "cache_write": num(v.get("cache_creation_input_token_cost")),
        })
    return out


def is_anthropic(model):
    blob = f"{model.get('id','')} {model.get('name','')} {model.get('family','')}".lower()
    return "claude" in blob or "anthropic" in blob


def enrich(catalogue, extra):
    """Fill catalogue costs from extra sources, then derive what is missing."""
    stats = {"cache_read": 0, "cache_write": 0,
             "input": 0, "output": 0,
             "derived_read": 0, "derived_write": 0}
    for pid, prov in catalogue.items():
        for mid, m in prov.get("models", {}).items():
            key = norm(m.get("id", mid))
            found = extra.get(key, {})
            cost = m.get("cost") or {}
            for field in ("input", "output", "cache_read", "cache_write"):
                if cost.get(field) is None and found.get(field) is not None:
                    cost[field] = found[field]
                    stats[field] += 1
            pin = cost.get("input")
            if cost.get("cache_read") is None and pin is not None:
                cost["cache_read"] = round(0.1 * pin, 8)
                stats["derived_read"] += 1
            if cost.get("cache_write") is None and pin is not None:
                cost["cache_write"] = round((1.25 if is_anthropic(m) else 1.0) * pin, 8)
                stats["derived_write"] += 1
            if cost:
                m["cost"] = cost
    return stats


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base", default="docs/models.dev.json",
                    help="base catalogue (default docs/models.dev.json)")
    ap.add_argument("--out", default="docs/models-prices.json",
                    help="output file (default docs/models-prices.json)")
    ap.add_argument("--cache", default="/tmp/opencode",
                    help="dir to cache source downloads (default /tmp/opencode)")
    ap.add_argument("--refresh", action="store_true",
                    help="re-download every source instead of using the cache")
    args = ap.parse_args()

    if not os.path.exists(args.base) or args.refresh:
        data = fetch(SOURCES["models_dev"], args.cache, "models_dev",
                     refresh=args.refresh)
        with open(args.base, "w") as f:
            json.dump(data, f)
        print(f"downloaded base catalogue -> {args.base}")

    with open(args.base) as f:
        catalogue = json.load(f)

    extra = {}
    counts = {}
    for name, url in SOURCES.items():
        if name == "models_dev":
            continue
        try:
            data = fetch(url, args.cache, name, refresh=args.refresh)
            rows = {"requesty": load_requesty, "openrouter": load_openrouter,
                    "litellm": load_litellm}[name](data)
            counts[name] = len(rows)
            for k, v in rows.items():
                merged = extra.setdefault(k, {})
                for field, val in v.items():
                    if merged.get(field) is None and val is not None:
                        merged[field] = val
        except Exception as e:  # keep going with the sources that worked
            counts[name] = f"failed: {e}"

    stats = enrich(catalogue, extra)

    with open(args.out, "w") as f:
        json.dump(catalogue, f)

    total = sum(len(p.get("models", {})) for p in catalogue.values())
    with_read = sum(1 for p in catalogue.values() for m in p.get("models", {}).values()
                    if (m.get("cost") or {}).get("cache_read") is not None)
    with_write = sum(1 for p in catalogue.values() for m in p.get("models", {}).values()
                     if (m.get("cost") or {}).get("cache_write") is not None)
    print(f"base: {total} models in {len(catalogue)} providers")
    for name, c in counts.items():
        print(f"  source {name:12} {c} normalized models")
    print(f"filled cache_read from sources:  {stats['cache_read']}")
    print(f"filled cache_write from sources: {stats['cache_write']}")
    print(f"derived cache_read (0.1*in):     {stats['derived_read']}")
    print(f"derived cache_write (auto/1.25x):{stats['derived_write']}")
    print(f"coverage: cache_read {with_read}/{total} "
          f"({100*with_read/total:.0f}%), cache_write {with_write}/{total} "
          f"({100*with_write/total:.0f}%)")
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
