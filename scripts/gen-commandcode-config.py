#!/usr/bin/env python3
"""Regenerate provider.commandcode.models in opencode.jsonc from GOAT data.

Pipeline:
    1. Read scripts/models-goat-catalog.json (fetched by fetch-goat-models.py).
    2. Rank by value = score / comprehensive_price, drop Contributor, keep the
       top PCT% (default 50).
    3. Add a curated set of high-value models that Command Code has not scored
       yet (so they are not silently dropped by the value cut).
    4. Map each model to its Command Code API id (api/providers endpoint) and
       enrich capabilities/limits from docs/models-prices.json.
    5. Rewrite provider.commandcode.models in the target opencode config.

Usage:
    python3 scripts/gen-commandcode-config.py                 # print summary
    python3 scripts/gen-commandcode-config.py --dry-run       # print JSON only
    python3 scripts/gen-commandcode-config.py --write         # patch config
"""

import argparse
import json
import os
import re
import urllib.request

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CATALOG = os.path.join(SCRIPT_DIR, "models-goat-catalog.json")
PRICES = os.path.join(
    os.path.dirname(SCRIPT_DIR), "docs", "models-prices.json")
CONFIG = os.path.join(
    os.path.dirname(SCRIPT_DIR), "opencode-config", "opencode", "opencode.jsonc")
API_URL = "https://api.commandcode.ai/provider/v1/models"

# models Command Code has not scored yet but which are worth keeping
KEEP_UNSCORED = [
    "DeepSeek V4.1 Flash",
    "Qwen 3.8 Flash",
    "Qwen 3.8 Max 0902",
    "Tencent Hy4 Preview",
]

# free models: not on the GOAT plan page, but zero-cost and worth keeping
KEEP_FREE = [
    {"name": "LongCat 2.0 (free)", "id": "meituan/LongCat-2.0:free",
     "context": "1M", "reasoning": False, "tool_call": True},
    {"name": "Laguna S 2.1 (free)", "id": "poolside/laguna-s-2.1-free",
     "context": "256K", "reasoning": True, "tool_call": True},
]


def norm(s):
    return re.sub(r"[^a-z0-9]", "", str(s).lower())


def comprehensive(m, h=0.98, k=0.004):
    pin, pout = float(m["pin"]), float(m["pout"])
    cr = m["cr"] if m.get("cr") is not None else 0.1 * pin
    cw = m["cw"] if m.get("cw") is not None else 1.0 * pin
    return h * cr + (1.0 - h) * cw + k * pout


def parse_ctx(s):
    match = re.match(r"([\d.]+)\s*([MK])", str(s).strip().upper())
    if not match:
        return None
    value = float(match.group(1))
    return int(value * 1_000_000) if match.group(2) == "M" else int(value * 1_000)


def load_api_ids():
    req = urllib.request.Request(API_URL, headers={
        "User-Agent": "gen-commandcode-config/1.0",
        "Authorization": "Bearer " + os.environ.get("COMMANDCODE_API_KEY", ""),
    })
    with urllib.request.urlopen(req, timeout=60) as r:
        data = json.load(r)
    rows = data.get("data", data) if isinstance(data, dict) else data
    return {norm(m.get("name", "")): m.get("id") for m in rows}


def build_price_index():
    with open(PRICES) as f:
        prices = json.load(f)
    index = {}
    for prov in prices.values():
        for mid, m in prov.get("models", {}).items():
            for name in (m.get("id", mid), m.get("name", "")):
                index.setdefault(norm(name), m)
    return index


def select(catalog, top_percent, exclude):
    needles = [s.lower() for s in exclude]
    rows = [m for m in catalog
            if not any(n in m["name"].lower() for n in needles)]
    scored = [m for m in rows if m.get("intelligence")]
    scored.sort(key=lambda m: m["intelligence"] / comprehensive(m), reverse=True)
    n = max(1, round(len(scored) * top_percent / 100))
    picked = scored[:n]
    by_name = {m["name"]: m for m in catalog}
    for name in KEEP_UNSCORED:
        if name not in [m["name"] for m in picked] and name in by_name:
            picked.append(by_name[name])
    return picked


def model_key(api_id):
    key = api_id.split("/")[-1].lower()
    return re.sub(r"[^a-z0-9]+", "-", key).strip("-")


def build_entry(goat, api_id, meta):
    cost = {"input": goat["pin"], "output": goat["pout"]}
    if goat.get("cr") is not None:
        cost["cache_read"] = goat["cr"]
    if goat.get("cw") is not None:
        cost["cache_write"] = goat["cw"]
    modalities = meta.get("modalities") or {
        "input": ["text"], "output": ["text"]}
    limit = meta.get("limit") or {}
    context = parse_ctx(goat.get("context")) or limit.get("context") or 128000
    output = limit.get("output") or 32768
    entry = {
        "name": goat["name"],
        "id": api_id,
        "tool_call": bool(meta.get("tool_call", True)),
    }
    if meta.get("release_date"):
        entry["release_date"] = meta["release_date"]
    entry["reasoning"] = bool(meta.get("reasoning", True))
    entry["attachment"] = bool(meta.get("attachment",
                                        "image" in modalities.get("input", [])))
    entry["modalities"] = modalities
    entry["limit"] = {"context": context, "output": output}
    entry["cost"] = cost
    return entry


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--catalog", default=CATALOG)
    ap.add_argument("--config", default=CONFIG)
    ap.add_argument("--top-percent", type=float, default=50)
    ap.add_argument("--exclude", action="append", default=["Contributor"])
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--write", action="store_true")
    args = ap.parse_args()

    with open(args.catalog) as f:
        catalog = json.load(f)
    api = load_api_ids()
    prices = build_price_index()
    picked = select(catalog, args.top_percent, args.exclude)

    models, missing = {}, []
    for goat in picked:
        api_id = api.get(norm(goat["name"]))
        if not api_id:
            missing.append(goat["name"])
            continue
        meta = prices.get(norm(goat["name"])) or prices.get(norm(api_id)) or {}
        models[model_key(api_id)] = build_entry(goat, api_id, meta)

    for f in KEEP_FREE:
        models[model_key(f["id"])] = {
            "name": f["name"],
            "id": f["id"],
            "reasoning": f["reasoning"],
            "attachment": False,
            "tool_call": f["tool_call"],
            "limit": {"context": parse_ctx(f["context"]), "output": 32768},
            "cost": {"input": 0, "output": 0, "cache_read": 0},
        }

    for name in missing:
        print(f"WARN no API id for: {name}")

    if args.dry_run:
        print(json.dumps(models, indent=2))
        return

    print(f"selected {len(models)} models "
          f"(top {args.top_percent:g}% value + {len(KEEP_UNSCORED)} unscored keeps)")
    for i, (key, m) in enumerate(models.items(), 1):
        print(f"  {i:>2} {key:26} {m['id']:34} "
              f"in ${m['cost']['input']} out ${m['cost']['output']}")

    if not args.write:
        print("\n(dry run; pass --write to patch the config)")
        return

    with open(args.config) as f:
        text = f.read()
    replaced = patch_models(text, models)
    if replaced == text:
        print("config already up to date")
        return
    with open(args.config, "w") as f:
        f.write(replaced)
    print(f"\npatched {args.config}")


def patch_models(text, models_obj):
    """Replace only the provider.commandcode.models object, leaving the rest."""
    import re as _re
    m = _re.search(r'"models"\s*:\s*\{', text)
    if not m:
        raise SystemExit("error: no provider.commandcode.models block found")
    start = text.index("{", m.start())
    depth, i, in_str, esc = 0, start, False, False
    while i < len(text):
        c = text[i]
        if in_str:
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == '"':
                in_str = False
        elif c == '"':
            in_str = True
        elif c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                break
        i += 1
    body = json.dumps(models_obj, indent=2).replace("\n", "\n" + " " * 8)
    return text[:start] + body + text[i + 1:]


if __name__ == "__main__":
    main()
