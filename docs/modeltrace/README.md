# ModelTrace — model attribution by numeric fingerprinting

Notes and artifacts from setting up [ModelTrace](https://github.com/xqy2006/ModelTrace)
(commit `6cd4a8f`), rebuilding its reference library, and using it to check which
model an API gateway actually serves. The working copy of the project lives at
`/workspace/ModelTrace`; this directory holds the write-up, the scripts that
produced the measurements, and the DeepSeek fingerprint data we collected.

## 1. What ModelTrace does

It does not ask a model who it is. It asks it for a few hundred integers in
`1..355` and compares the **shape of the resulting distribution** against a
library of models enrolled the same way. The output is a ranked attribution
inside that library, not a proof of identity.

Three questions per test, roughly 300 numbers each — enough for a stable
estimate, short enough that the model keeps picking numbers instead of drifting
into arithmetic progressions.

## 2. Why that works as a fingerprint

Four things shape the digits an autoregressive model emits, and all four are
stable for a given checkpoint:

- the tokenizer (is `355` one token or `3`+`55`?),
- the pretraining frequency of numbers (years and prices outnumber sparse large values),
- post-training preferences (RLHF pushes "looks random", e.g. away from arithmetic runs),
- decoding parameters (temperature, top-p).

They differ systematically between vendors and between generations. So the
histogram over `1..355` carries a signal even though no single number is
diagnostic.

## 3. The reference library

Each model in the library is enrolled with **36 responses = 12 prompt
environments × 3 queries**. The environments cross format, language, delivery
channel and distractor prefix length on purpose; that spread is what lets the
scorer estimate how much of the distribution is "how you asked" versus "who
answered":

| condition | delivery · format | requested counts |
|---|---|---|
| E01 | clean · JSON | 218 / 233 / 247 |
| E02 | clean · JSON, reworded | 223 / 239 / 251 |
| E03 | system prefix · JSON | 227 / 241 / 257 |
| E04 | clean · Chinese | 294 / 311 / 329 |
| E05 | clean · English prose | 297 / 315 / 331 |
| E06 | clean · JSON, different counts | 301 / 319 / 327 |
| E07 | system prefix 96 words · zh | 293 / 310 / 326 |
| E08 | system prefix 512 words · zh | 296 / 314 / 330 |
| E09 | system prefix 2048 words · zh | 299 / 317 / 332 |
| E10 | user prefix 96 words · zh | 292 / 308 / 324 |
| E11 | user prefix 512 words · zh | 295 / 313 / 328 |
| E12 | user prefix 2048 words · zh | 298 / 316 / 333 |

Prompt variants also forbid tools, sorting, deduplication and explanations, and
the phrasing plus the requested count is resampled per query so a model cannot
memorise one wording.

Upstream library, as shipped: `gpt_bank` (8 models, 36 each, collected through
`codex`) and `claude_bank` (10 models, 36 each, collected through `oaipro`),
merged into `unified_bank.json` (18 models, 648 rows).

## 4. Pipeline

1. **Parse.** Take the longest digit run (alphabetic separators split runs), keep
   values in `1..355`, require at least `max(80, 55% × requested)`. A refusal, a
   truncation or a chatty answer is discarded rather than trimmed.
2. **Overall distribution.** 355-bin histogram, `α = 0.5` smoothing, square-root,
   L2 normalise (Hellinger). Weight **0.75**.
3. **Ordered structure.** The sequence split into 4 equal blocks × 16 value bins
   (64 dims) plus the last-digit distribution over 0–9 (10 dims). Weight **0.25**.
4. **Nuisance removal.** Per-environment mean offsets are computed across all
   models, and the top 2 SVD directions are projected out. The assumption is
   that channel and format move every model the same way, while model identity
   does not.
5. **Score.** Cosine similarity to unit-normalised class centroids, z-standardised
   across models, averaged over the three responses, then softmax with a
   temperature `β` fitted by grouped cross-validation (whole environments held
   out, so the number measures "do you still recognise it under a different
   prompt format").

## 5. Data shipped here

| file | size | content |
|---|---|---|
| `data/deepseek_reference.jsonl` | 295 KB | 36 responses from the official `api.deepseek.com` (`deepseek-flash` = DeepSeek-V4.1-Flash), class label `deepseek-v4.1-flash@official` |
| `data/deepseek_bank.json` | 102 KB | single-model bank fitted from those responses |
| `data/unified_bank.json` | 957 KB | current merged bank: 19 models, 684 rows, `providers = [api.deepseek.com, codex, oaipro]` |

Calibration in the shipped unified bank: 96.5% at 1 query, 99.6% at 2, **100% at
3** (`β` = 7.33 / 12.0 / 12.0).

The gateway-sampled DeepSeek data is **not** kept in this library: it is the same
model, and a second class for the same model steals votes (see §8). It remains in
`/workspace/ModelTrace/data/commandcode_reference.jsonl` as evidence, with its
bank parked as `commandcode_bank.json.off`.

## 6. Setup

```bash
git clone https://github.com/xqy2006/ModelTrace
cd ModelTrace
uv venv .venv --python 3.11 && uv pip install --python .venv/bin/python -r requirements.txt
python start.py          # Flask on http://127.0.0.1:7860
```

The web page only wires the manual test path; enrollment, bank creation and the
automatic test live behind the JSON API, so drive those from a script or `curl`.
The scripts in `scripts/` import the project package and `numpy`, so run them with
the project interpreter (`/workspace/ModelTrace/.venv/bin/python`) and point
`MODELTRACE` at the clone:

| endpoint | purpose |
|---|---|
| `GET /api/challenges` | three fresh challenges for manual testing |
| `POST /api/analyze` | score pasted outputs (manual mode) |
| `POST /api/test/auto` | 3-query consensus test against any OpenAI/Anthropic-shaped endpoint |
| `POST /api/test/probe` | send one raw challenge, get the text back (debugging) |
| `GET/POST /api/banks` | list / create a bank (a bank is a family) |
| `POST /api/enroll/auto` | collect the 36-sample suite and refit that bank |

The helper scripts take a channel as `label|base_url|KEY_ENV|api_model`; `|` is
used because a URL contains `:` and a model id contains `/`.

## 7. How to evaluate an endpoint

Run this whenever you need to know whether an API actually serves the model it
advertises.

1. **Enrol the model from its official endpoint.** This is the reference class;
   third-party fingerprints are worthless without it.

   ```bash
   MODELTRACE=/workspace/ModelTrace DEEPSEEK_API_KEY=sk-... \
   /workspace/ModelTrace/.venv/bin/python scripts/enroll_model.py \
     --base-url https://api.deepseek.com --api-key-env DEEPSEEK_API_KEY \
     --api-model deepseek-flash --label deepseek-v4.1-flash@official \
     --bank-id deepseek --provider api.deepseek.com
   ```

   `--samples` must stay 36. Register the bank first
   (`curl -X POST localhost:7860/api/banks -H 'Content-Type: application/json' -d '{"label":"DeepSeek"}'`)
   so it appears in the web inventory.

   For a model with **no API** (web-only chat), use manual mode instead: fetch
   three challenges from `GET /api/challenges`, paste each to the model, join the
   three outputs with a line containing only `===OUTPUT===`, and import them:

   ```python
   from pathlib import Path
   from enrollment import enroll_manual
   enroll_manual("gemini-3-pro", Path("out.txt").read_text(),
                 data_file=Path("data/gemini_reference.jsonl"),
                 bank_file=Path("data/gemini_bank.json"),
                 bank_id="gemini")
   ```

   Pass all three file arguments explicitly — their defaults point at the GPT
   bank and will quietly mix a new model into it.

2. **Refit the merged bank.**

   ```bash
   cd /workspace/ModelTrace && .venv/bin/python -c "import app; app.rebuild_global_bank()"
   ```

   Do **not** run `rebuild_unified_bank.py`: it hardcodes `gpt_reference.jsonl`
   and `claude_reference.jsonl` and will silently drop any other family.

3. **Test the suspect endpoint** with five independent rounds of the 3-query
   consensus, then the single-response noise floor:

   ```bash
   MODELTRACE=/workspace/ModelTrace \
   DEEPSEEK_API_KEY=sk-... COMMANDCODE_API_KEY=cc-... \
   /workspace/ModelTrace/.venv/bin/python scripts/stability_test.py \
     --bank /workspace/ModelTrace/data/unified_bank.json \
     --rounds 5 --target deepseek-v4.1-flash@official \
     --channel "official|https://api.deepseek.com|DEEPSEEK_API_KEY|deepseek-flash" \
     --channel "gateway|https://api.commandcode.ai/provider/v1|COMMANDCODE_API_KEY|deepseek/deepseek-v4.1-flash"

   MODELTRACE=/workspace/ModelTrace \
   DEEPSEEK_API_KEY=sk-... COMMANDCODE_API_KEY=cc-... \
   /workspace/ModelTrace/.venv/bin/python scripts/single_response_test.py \
     --bank /workspace/ModelTrace/data/unified_bank.json \
     --per-channel 6 --target deepseek-v4.1-flash@official \
     --channel "official|https://api.deepseek.com|DEEPSEEK_API_KEY|deepseek-flash" \
     --channel "gateway|https://api.commandcode.ai/provider/v1|COMMANDCODE_API_KEY|deepseek/deepseek-v4.1-flash"
   ```

4. **Read the result correctly.**
   - Consensus rounds are the signal: same target 5/5 with `p > 0.99` means the
     distribution matches.
   - Single responses are noisy: the **official endpoint itself** put 1 of 6
     single responses on a GPT class (`gpt-6-luna`, 0.52). A single outlier is
     not evidence of substitution.
   - The probability is a softmax over the enrolled classes only. An unenrolled
     model always gets mapped to its nearest enrolled neighbour, sometimes at
     0.99 confidence. Absence of the model from the bank makes the answer
     meaningless, not "unknown".

## 8. Measured results

### 8.1 Official vs gateway, same model

| metric | official `deepseek-flash` | gateway `deepseek/deepseek-v4.1-flash` |
|---|---|---|
| responses collected | 36 / 36 valid | 36 / 36 valid |
| valid integers | 10,584 | 10,582 |
| mean ± sd | 178.5 ± 104.2 | 181.4 ± 104.0 |
| histogram entropy | 8.436 bit | 8.425 bit |
| followed requested count | 100.0% | 100.0% |
| wall clock | 376 s | 481 s |

Raw Hellinger cosine between the two datasets: **0.9976**.

Attribution with the official class in the bank:

| test | result |
|---|---|
| gateway, 3-query consensus × 7 | 7/7 → `deepseek-v4.1-flash@official`, `p` 0.825–1.0000 |
| official, 3-query consensus × 6 | 6/6 → `deepseek-v4.1-flash@official`, `p` 1.0000 |
| gateway, single responses × 6 | 5/6 → `p` 0.99+, 1/6 → `gpt-5.6-sol` 0.98 |
| official, single responses × 6 | 5/6 → `p` 0.67–1.00, 1/6 → `gpt-6-luna` 0.52 |

Conclusion: the gateway serves DeepSeek-V4.1-Flash, and the only wrong answers
came at the tool's own single-response noise floor, which the official endpoint
shows too.

### 8.2 What a duplicate class costs

Enrolling the gateway as a second DeepSeek class (same model, different
provenance) degraded the whole library:

| unified bank composition | models | rows | cv @1 query | cv @3 queries |
|---|---|---|---|---|
| upstream (8 GPT + 10 Claude) | 18 | 648 | 96.3% | 100% |
| + DeepSeek from the gateway only | 19 | 684 | 95.2% | 99.6% |
| + DeepSeek from both endpoints (duplicate) | 20 | 720 | 91.4% | 95.0% |
| + DeepSeek official only (current) | 19 | 684 | 96.5% | 100% |

Centroid cosine between the two same-model classes: **0.719** — the highest of
all 380 model pairs (next highest 0.317, median −0.035). So the same model across
two channels is far more similar than any two different models, but far less
similar than a class is to itself. The softmax amplifies that gap into a
0.93 / 0.07 split, and official queries started landing on their own gateway
clone 93% of the time.

### 8.3 Sampling fewer responses

Same data, measured with `build_bank`:

| new-model samples | training rows | environments | cv @3 queries | cv @1 query |
|---|---|---|---|---|
| 36 (12 × 3) | 684 | 12 | 99.6% | 95.2% |
| 12 (1 per environment) | 660 | 12 | **disabled** (`β` = 1) | 93.9% |
| 3 (3 environments) | 165 | 3 | **disabled** (`β` = 1) | 77.2% |

Row count barely moves at 12 samples, but one response per environment cannot
form a "hold out three" validation group, so the 3-query calibration falls back
to `β = 1` and probabilities flatten toward uniform. Collect 36.

## 9. Pitfalls

1. **Enrol from the official endpoint.** A class sampled through a relay carries
   that relay's behaviour. Here it happened to be identical (0.9976), but you
   cannot know that before measuring — and if it is not, you have enrolled
   someone else's fingerprint under your model's name.
2. **Never enrol the same model twice.** Two labels for one model create
   duplicate classes; §8.2 is the measured cost.
3. **`sample_count` must be 36.** Anything less kills the 3-query calibration
   (§8.3).
4. **`enroll_manual` defaults write into the GPT bank.** Pass `data_file`,
   `bank_file` and `bank_id` explicitly.
5. **Skip `rebuild_unified_bank.py`**; use `app.rebuild_global_bank()` so custom
   families survive.
6. **`temperature` = provider default.** Every reference row is
   `provider_default`; passing an explicit temperature changes the digit
   distribution and quietly makes your class incomparable.
7. **A bank is loaded at import time.** Restart the Flask process after refitting,
   or the API keeps serving the old numbers.
8. **The bank is a fit, not a table.** It stores centroids, the nuisance basis
   and `β`; it cannot be edited by hand. Adding a model means appending rows and
   refitting.

## 10. Cost

Measured on DeepSeek-V4.1-Flash: 36 official responses plus ~40 test queries cost
**¥1.57** (`api.deepseek.com` balance 16.20 → 14.63), roughly ¥0.02–0.03 per
~300-number response. A full family rebuild scales with model price; Claude-class
models are one to two orders of magnitude more expensive per response.

## 11. Limits

- **Distribution equivalence, not weights.** A distilled or quantised sibling
  with the same digit preferences is indistinguishable here.
- **Closed set.** Probabilities normalise over enrolled classes. Unknown models
  get the nearest neighbour, confidently.
- **Non-adversarial.** A gateway that serves the real model only on probe-like
  traffic defeats any black-box fingerprint. ModelTrace Guard (in the repo under
  `codex-plugin/`) addresses this by forking the task's frozen snapshot so the
  probe rides the same context, model and reasoning effort as real work.
- **Context sensitive.** Long system prompts (Claude Code sized), long context,
  and non-default decoding all shift the distribution; the upstream README
  advises against measuring inside long-context coding harnesses.
- **Verified scope here.** One model id, one gateway, one day. The gateway also
  lists `deepseek/deepseek-v4-pro`, `deepseek-v4-flash`,
  `deepseek-v4-flash-vision-exp` and `deepseek-v4-flash-fast`, none of which are
  covered. On the same plan, 15 of its 94 models return
  `403 MODEL_NOT_IN_PLAN`, including `gpt-5.4`, `gpt-5.5`, `gpt-5.6-terra`,
  `gpt-6-astra`, `gpt-6-sol` and all Claude ids except `claude-haiku-5-5`.

## 12. Provenance

- Project: `https://github.com/xqy2006/ModelTrace`, commit `6cd4a8f`.
- Reference library as shipped: 18 models / 648 rows, `providers = [codex, oaipro]`.
  The 10 Claude classes were collected through the **OAIPro** relay, so they
  carry the same caveat in §9.1 as the gateway DeepSeek data did. Re-enrolling
  them from `api.anthropic.com` requires an Anthropic key.
- DeepSeek data here: collected 2026-10-20 from `https://api.deepseek.com`,
  model id `deepseek-flash` (reported name `DeepSeek-V4.1-Flash`), 36/36 valid,
  `temperature = provider_default`, `provider = api.deepseek.com`.
- Scripts in `scripts/` are the ones that produced the numbers above, with the
  paths and keys parameterised.
