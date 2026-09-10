#!/usr/bin/env python3
"""Fetch the Command Code GOAT plan model table into a JSON catalog.

The GOAT plan page lists every model available on the $10/$70 plan with
its context window, Command Code intelligence/speed scores and per-1M
prices (off-peak for DeepSeek). This scrapes that table so model-cost.py
can rank the whole catalog by comprehensive price.

Usage:
    python3 scripts/fetch-goat-models.py                # -> scripts/models-goat-catalog.json
    python3 scripts/fetch-goat-models.py --refresh      # force re-download
    python3 scripts/fetch-goat-models.py --out foo.json
"""

import argparse
import json
import os
import re
import urllib.request

URL = "https://commandcode.ai/docs/plans/goat"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"


def fetch(url, cache, refresh=False):
    if not refresh and os.path.exists(cache):
        with open(cache) as f:
            return f.read()
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        data = r.read().decode("utf-8", "replace")
    with open(cache, "w") as f:
        f.write(data)
    return data


def text(cell):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", cell)).strip()


def to_price(s):
    """Last $ value in a cell (discounted rows show <s>$old</s>$new)."""
    vals = re.findall(r"\$([0-9.]+)", s)
    return float(vals[-1]) if vals else None


def parse(html):
    rows = []
    for tr in re.findall(r"<tr\b.*?</tr>", html, re.S):
        cells = re.findall(r"<td\b.*?</td>", tr, re.S)
        if len(cells) < 7:
            continue
        vals = [text(c) for c in cells]
        # cells: [name(+discount tag), context, intelligence, speed, input,
        #         output, cache_read, cache_write?, caps]
        m = re.search(r'<a href="/models/[^"]+"[^>]*>\s*(?:<span[^>]*>)?([^<]+)', cells[0])
        name = text(m.group(1)) if m else vals[0]
        discount = re.search(r">(-\d+%)<", cells[0])
        context = vals[1]
        intel = vals[2]
        speed = vals[3]
        pin = to_price(vals[4])
        pout = to_price(vals[5])
        cr = to_price(vals[6]) if len(vals) > 6 else None
        cw = to_price(vals[7]) if len(vals) > 7 else None
        if not name or pin is None or pout is None:
            continue
        rows.append({
            "name": name,
            "discount": discount.group(1) if discount else None,
            "context": context,
            "intelligence": (float(intel) if re.fullmatch(r"[0-9.]+", intel) else None),
            "speed_tps": (float(speed) if re.fullmatch(r"[0-9.]+", speed) else None),
            "pin": pin,
            "pout": pout,
            "cr": cr,
            "cw": cw,
        })
    return rows


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                                  "models-goat-catalog.json"))
    ap.add_argument("--cache", default="/tmp/opencode/goat.html")
    ap.add_argument("--refresh", action="store_true")
    args = ap.parse_args()

    html = fetch(URL, args.cache, args.refresh)
    models = parse(html)
    with open(args.out, "w") as f:
        json.dump(models, f, indent=1)
    print(f"wrote {args.out}: {len(models)} GOAT models")
    for m in models:
        print(f"  {m['name'][:28]:28} ctx={m['context']:>5} "
              f"intel={m['intelligence']} tps={m['speed_tps']} "
              f"in={m['pin']} out={m['pout']} cr={m['cr']} cw={m['cw']}")


if __name__ == "__main__":
    main()
