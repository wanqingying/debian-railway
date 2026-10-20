#!/usr/bin/env python3
"""Enroll one model from one provider endpoint into a new ModelTrace bank.

Collects the full 12-environment x 3 sample suite (36 responses by default),
appends them to a reference jsonl and refits that bank.

Example:
    MODELTRACE=/workspace/ModelTrace DEEPSEEK_API_KEY=sk-... \
    python enroll_model.py \
        --base-url https://api.deepseek.com \
        --api-key-env DEEPSEEK_API_KEY \
        --api-model deepseek-flash \
        --label deepseek-v4.1-flash@official \
        --bank-id deepseek --provider api.deepseek.com

Notes:
  * ``--samples`` must stay 36. Fewer samples drop environments out of the
    cross-validation groups and silently disable the 3-query calibration.
  * ``--label`` becomes the class id in the bank. Use one label per
    (model, endpoint); a second label for the same model creates a duplicate
    class that steals votes from the original.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

MODELTRACE = Path(os.environ.get("MODELTRACE", "/workspace/ModelTrace"))
sys.path.insert(0, str(MODELTRACE))

import enrollment as E  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--api-key-env", required=True)
    parser.add_argument("--api-model", required=True, help="model id as the provider spells it")
    parser.add_argument("--label", required=True, help="class id stored in the bank")
    parser.add_argument("--bank-id", required=True)
    parser.add_argument("--provider", required=True, help="provenance string written into every row")
    parser.add_argument("--samples", type=int, default=36)
    parser.add_argument("--temperature", type=float, default=None,
                        help="omit to use the provider default, which is what the reference bank uses")
    parser.add_argument("--api-format", default="auto", choices=["auto", "openai", "anthropic"])
    parser.add_argument("--parallel", type=int, default=2)
    parser.add_argument("--data-dir", default=str(MODELTRACE / "data"))
    args = parser.parse_args()

    data_dir = Path(args.data_dir)
    data_file = data_dir / f"{args.bank_id}_reference.jsonl"
    bank_file = data_dir / f"{args.bank_id}_bank.json"

    original = E.request_completion
    done = {"n": 0}
    started = time.time()

    def logged(*call_args, **call_kwargs):
        done["n"] += 1
        request_started = time.time()
        try:
            text = original(*call_args, **call_kwargs)
        except Exception as error:
            print(f"[{done['n']:02d}/{args.samples}] FAIL {time.time() - request_started:.1f}s "
                  f"{str(error)[:90]} (elapsed {time.time() - started:.0f}s)", flush=True)
            raise
        print(f"[{done['n']:02d}/{args.samples}] ok {time.time() - request_started:.1f}s "
              f"chars={len(text)} (elapsed {time.time() - started:.0f}s)", flush=True)
        return text

    E.request_completion = logged
    print(f"start {datetime.now(timezone.utc).isoformat()} endpoint={args.base_url} "
          f"model={args.api_model} label={args.label} samples={args.samples}", flush=True)

    result = E.enroll_automatic(
        base_url=args.base_url,
        api_key=os.environ[args.api_key_env],
        api_model=args.api_model,
        model_label=args.label,
        sample_count=args.samples,
        temperature=args.temperature,
        api_format=args.api_format,
        data_file=data_file,
        bank_file=bank_file,
        bank_id=args.bank_id,
        provider=args.provider,
    )

    print("DONE " + json.dumps({
        "requested": result["requested"],
        "received": result["received"],
        "accepted": result["accepted"],
        "rejected": result["rejected"],
        "errors": result["errors"],
        "bank": result["bank"],
        "elapsed_seconds": round(time.time() - started, 1),
    }, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
