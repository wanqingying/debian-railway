#!/usr/bin/env python3
"""Score every single response on its own against a bank.

This is the noise floor check: the true model's own endpoint also produces
single responses that land on a wrong class (measured: 1 in 6). Use it to tell
"the provider swapped the model" apart from "the fingerprint had a bad sample".

Example:
    MODELTRACE=/workspace/ModelTrace DEEPSEEK_API_KEY=sk-... \
    python single_response_test.py --bank unified_bank.json --per-channel 6 \
        --target deepseek-v4.1-flash@official \
        --channel "official|https://api.deepseek.com|DEEPSEEK_API_KEY|deepseek-flash"
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

MODELTRACE = Path(os.environ.get("MODELTRACE", "/workspace/ModelTrace"))
sys.path.insert(0, str(MODELTRACE))

from enrollment import request_completion  # noqa: E402
from fingerprint import analyze_global_outputs, generate_challenges, load_bank, parse_numbers  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bank", required=True)
    parser.add_argument("--target", required=True)
    parser.add_argument("--per-channel", type=int, default=6)
    parser.add_argument("--channel", action="append", required=True,
                        help="label|base_url|KEY_ENV|api_model")
    parser.add_argument("--parallel", type=int, default=3)
    args = parser.parse_args()

    bank = load_bank(Path(args.bank))
    channels = []
    for spec in args.channel:
        # "label|base_url|KEY_ENV|api_model" — '|' because URLs contain ':' and model ids contain '/'
        label, base_url, key_env, api_model = spec.split("|", 3)
        channels.append((label, base_url.strip(), os.environ[key_env], api_model.strip()))

    jobs = [(label, base, key, model, index)
            for label, base, key, model in channels
            for index in range(1, args.per_channel + 1)]
    started = time.time()

    def run(job):
        label, base, key, model, index = job
        challenge = generate_challenges(1)[0]
        try:
            text = request_completion(base, key, model, challenge["prompt"], None,
                                      "auto" if "commandcode" in base else "openai")
        except Exception as error:
            return label, index, None, str(error)[:90]
        numbers = len(parse_numbers(text))
        minimum = max(80, int(challenge["expected_count"] * 0.55))
        if numbers < minimum:
            return label, index, None, f"invalid {numbers}/{minimum}"
        result = analyze_global_outputs(
            [{"text": text, "expected_count": challenge["expected_count"]}], bank)
        return label, index, (result["prediction_name"], round(result["probability"], 4), numbers), None

    hits = {label: 0 for label, *_ in channels}
    totals = {label: 0 for label, *_ in channels}
    with ThreadPoolExecutor(max_workers=args.parallel) as pool:
        for label, index, result, error in pool.map(run, jobs):
            if error:
                print(f"{label:9} #{index} ERROR {error} ({time.time() - started:.0f}s)", flush=True)
                continue
            totals[label] += 1
            if result[0] == args.target:
                hits[label] += 1
            mark = "ok  " if result[0] == args.target else "MISS"
            print(f"{label:9} #{index} {mark} -> {result[0]:28} p={result[1]:.4f} "
                  f"nums={result[2]} ({time.time() - started:.0f}s)", flush=True)

    for label in hits:
        print(f"SUMMARY {label}: {hits[label]}/{totals[label]} single responses matched {args.target}",
              flush=True)


if __name__ == "__main__":
    main()
