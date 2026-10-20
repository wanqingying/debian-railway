#!/usr/bin/env python3
"""Run N independent 3-query attribution tests against one bank.

Each round asks three fresh challenges, scores every response, averages the
class scores and applies the bank's calibrated softmax. That consensus is the
unit ModelTrace reports; single responses are far noisier (see README).

Example:
    MODELTRACE=/workspace/ModelTrace \
    DEEPSEEK_API_KEY=sk-... COMMANDCODE_API_KEY=cc-... \
    python stability_test.py --bank unified_bank.json --rounds 5 \
        --target deepseek-v4.1-flash@official \
        --channel "official|https://api.deepseek.com|DEEPSEEK_API_KEY|deepseek-flash" \
        --channel "gateway|https://api.commandcode.ai/provider/v1|COMMANDCODE_API_KEY|deepseek/deepseek-v4.1-flash"
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

MODELTRACE = Path(os.environ.get("MODELTRACE", "/workspace/ModelTrace"))
sys.path.insert(0, str(MODELTRACE))

from enrollment import test_automatic  # noqa: E402
from fingerprint import load_bank  # noqa: E402


def parse_channel(spec: str) -> tuple[str, str, str, str, str]:
    # "label|base_url|KEY_ENV|api_model" — '|' because URLs contain ':' and model ids contain '/'
    label, base_url, key_env, api_model = spec.split("|", 3)
    return label, base_url.strip(), os.environ[key_env], api_model.strip(), key_env


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bank", required=True, help="bank json, e.g. unified_bank.json")
    parser.add_argument("--target", required=True, help="class id that counts as a correct attribution")
    parser.add_argument("--rounds", type=int, default=5)
    parser.add_argument("--channel", action="append", required=True,
                        help="label|base_url|KEY_ENV|api_model")
    parser.add_argument("--parallel", type=int, default=3)
    parser.add_argument("--out", default="/tmp/modeltrace-stability.json")
    args = parser.parse_args()

    bank = load_bank(Path(args.bank))
    channels = [parse_channel(spec) for spec in args.channel]
    print(f"bank={Path(args.bank).name} models={len(bank['models'])} target={args.target} "
          f"rounds={args.rounds} channels={[c[0] for c in channels]}", flush=True)

    jobs = [(label, base, key, model, index)
            for label, base, key, model, _ in channels
            for index in range(1, args.rounds + 1)]
    started = time.time()

    def run(job):
        label, base, key, model, index = job
        request_started = time.time()
        try:
            result = test_automatic(base, key, model, None, bank, api_format="auto")
        except Exception as error:
            return {"channel": label, "round": index, "error": str(error)[:180],
                    "seconds": round(time.time() - request_started, 1)}
        return {
            "channel": label,
            "round": index,
            "model": model,
            "prediction": result["prediction_name"],
            "probability": round(result["probability"], 5),
            "family": result["family_prediction_name"],
            "used": result["used_outputs"],
            "top3": [(item["display_name"], round(item["probability"], 5))
                     for item in result["results"][:3]],
            "seconds": round(time.time() - request_started, 1),
        }

    rows = []
    with ThreadPoolExecutor(max_workers=args.parallel) as pool:
        for row in pool.map(run, jobs):
            rows.append(row)
            if row.get("error"):
                print(f"[{len(rows):02d}/{len(jobs)}] {row['channel']:9} #{row['round']} ERROR "
                      f"{row['error'][:80]} (elapsed {time.time() - started:.0f}s)", flush=True)
            else:
                print(f"[{len(rows):02d}/{len(jobs)}] {row['channel']:9} #{row['round']} -> "
                      f"{row['prediction']:28} p={row['probability']:.4f} used={row['used']} "
                      f"(elapsed {time.time() - started:.0f}s)", flush=True)

    Path(args.out).write_text(json.dumps(rows, ensure_ascii=False, indent=2))
    for label, *_ in channels:
        valid = [row for row in rows if row["channel"] == label and not row.get("error")]
        hits = [row for row in valid if row["prediction"] == args.target]
        probabilities = [row["probability"] for row in hits]
        if probabilities:
            print(f"SUMMARY {label}: {len(hits)}/{len(valid)} correct, "
                  f"min={min(probabilities):.4f} mean={sum(probabilities) / len(probabilities):.4f}",
                  flush=True)
        else:
            print(f"SUMMARY {label}: 0/{len(valid)} correct", flush=True)
    print(f"wrote {args.out} elapsed={round(time.time() - started)}s", flush=True)


if __name__ == "__main__":
    main()
