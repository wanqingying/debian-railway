# OpenCode Go allowance

How much of the monthly Go allowance is left, why the usage dashboard cannot
tell you, and how `scripts/go-allowance.mjs` answers it.

## The problem: the cost column reads zero

Go is a subscription. Every request the subscription serves is recorded with
`cost: 0`, so the usage page's cost column (and every per-model total built from
it) shows cents for what is really tens of dollars of consumed allowance. The
30-day usage view is still useful for tokens, steps and cache-hit rate — its
`$` numbers for `opencode-go/*` are meaningless.

## Where the real number lives

Two undocumented endpoints answer with the API key (the one in the `credential`
table, integration `opencode-go`):

| Endpoint | Returns |
| --- | --- |
| `GET https://opencode.ai/console/api/go/status` | plan, period, and the three meters as **exact micro-cents** (a dollar is `100000000`), plus each meter's reset time |
| `GET https://opencode.ai/zen/go/v1/usage` | the same three meters as floored integer percents, no plan, no resets |

`console/api/go/status` is what the Console page rounds and what OpenChamber's
VS Code quota provider reads (`packages/vscode/src/opencodeGoQuota.ts`), so it
is the authoritative one. A `401` with `{"error":{"code":"api_key_expired"}}`
means the key is dead — signing in again does not renew it, a new key must be
created in the Console.

```jsonc
// GET https://opencode.ai/console/api/go/status  (truncated)
{
  "product": "go",
  "access": {
    "startsAt": "2026-10-29T06:21:03.000Z",
    "endsAt":   "2026-11-29T06:21:03.000Z",
    "meters": {
      "fiveHour": { "limitMicroCents": "1200000000", "usedMicroCents": "...", "resetsAt": "..." },
      "week":     { "limitMicroCents": "3000000000", "usedMicroCents": "...", "resetsAt": "..." },
      "month":    { "limitMicroCents": "6000000000", "usedMicroCents": "...", "resetsAt": "..." }
    }
  }
}
```

## How the allowance is metered

One pool per plan with rolling caps: `go` is **$12 / 5 h, $30 / week, $60 /
month**. Every model draws on that same pool; what differs is the rate at which
it draws.

The Console's Subscriptions page gives each model a **monthly limit in that
model's own list dollars** — DeepSeek V4.1 Flash $100, Kimi K3.1 Pro $15, Hy4
$60. That is not a separate bucket; it is the same $60 pool restated, and the
conversion is exactly:

```
allowance_multiplier = 60 / console_monthly_limit
```

Measured 2026-11-09 on **fifteen models** by comparing `usage.opencode.allowance`
with `list_cost` on a live response — every one landed on the predicted value to
three decimals:

| Model | Console monthly limit (Go) | Measured multiplier | 60 / limit |
| --- | --- | --- | --- |
| DeepSeek V4.1 Flash | $100 | **0.6×** | 0.60 |
| Kimi K3.1 Pro | $15 | **4×** | 4.00 |
| DeepSeek V4 Pro | $15 | **4×** | 4.00 |
| Claude Haiku 5.5 | $15 | **4×** | 4.00 |
| GPT 6 Luna | $15 | **4×** | 4.00 |
| GLM-5.3 | $15 | **4×** | 4.00 |
| MiniMax M3.1 Flash | $20 | **3×** | 3.00 |
| Qwen3.8 Flash | $30 | **2×** | 2.00 |
| Gemini 4 Argon | $30 | **2×** | 2.00 |
| Hy4 | $60 | **1×** | 1.00 |
| Qwen3.7 Plus | $60 | **1×** | 1.00 |
| GLM-5.3-Flash | $60 | **1×** | 1.00 |
| MiMo-V2.6-Flash | $60 | **1×** | 1.00 |
| MiniMax M3 | $60 | **1×** | 1.00 |
| LongCat-2.0 | $60 | **1×** | 1.00 |

So the answer to "what is DeepSeek V4.1 Flash's monthly limit" is **$100 in list
dollars = $60 of allowance**, with the 5-hour cap at $20 list / $12 allowance and
the weekly cap at $50 list / $30 allowance. Every model's cap is the same $60 in
allowance terms; the list-dollar numbers differ only because the models are
priced differently. The practical consequence is that a step on GLM-5.3 burns
~85× the pool of a step on DeepSeek V4.1 Flash.

**Go Plus does not follow this.** Its column on the same page is 4× the Go column
for Kimi K3.1 Pro, DeepSeek V4 Pro, Hy4, Claude Haiku 5.5, MiniMax M3.1 Flash and
GPT 6 Luna, 3× for Qwen3.7 Plus and GLM-5.3-Flash, and 2× for MiMo-V2.6-Flash,
DeepSeek V4.1 Flash and Muse Spark 1.3 Contributor. A single shared pool with a
fixed per-model multiplier cannot produce three different ratios, so the Plus
plan's per-model ceilings are independent of the Go ones — do not extrapolate a
Go number to Plus by doubling it. (Unverified beyond the page: this account has
no Plus subscription to measure.)

Every response reports what it counted, in `usage.opencode`:

```jsonc
"opencode": {
  "billing_source": "go",
  "list_cost": 0.00022065,   // the OpenCode pay-as-you-go price of this request
  "allowance": 0.00013239,   // what it took out of the pool
  "tokens": { "input": 1231, "output": 60, "reasoning": 60, "cache_read": 0, ... }
}
```

`allowance = mult × list_cost`, where `mult = 60 / console_monthly_limit`
(see the table above). Pool cost per typical agent step:

| Model | `mult` | Pool cost per step |
| --- | --- | --- |
| DeepSeek V4.1 Flash | 0.6× | ~$0.0019 |
| GLM-5.3 | 4× | ~$0.16 |
| GPT 6 Luna | 4× | ~$0.02 |

The same tokens therefore cost ~85× more on GLM-5.3 than on DeepSeek V4.1
Flash. 41 GLM-5.3 steps (mostly magic-context historian/dreamer runs over
150 K-token contexts) took $6.6 out of the $60 pool — 11 % of the month for
0.7 % of the steps.

### Peak pricing

DeepSeek V4.1 Flash is priced **2× during peak hours: 01:00–04:00 and
06:00–10:00 UTC, Monday–Friday** (Beijing 09:00–12:00 and 14:00–18:00); every
other hour, including weekends, is off-peak. Work done in the container's
afternoon (Beijing) sessions lands in peak — on 2026-11-04, $3.66 of the day's
$4.62 was peak-priced. Moving heavy sessions outside those windows halves the
DeepSeek burn.

## The script

```bash
node scripts/go-allowance.mjs              # meters + per-model attribution + daily table
node scripts/go-allowance.mjs --json       # the same as JSON
node scripts/go-allowance.mjs --no-api     # database estimate only (no key, no network)
node scripts/go-allowance.mjs --days 7     # restrict the attribution window
```

It reads the authoritative meters, then attributes the month to models and days
from `session_message` (steps with `cost > 0` are pay-as-you-go, not allowance).

**Calibration.** The database records every step the client saw, but two things
distort the count, in opposite directions:

- **Forks duplicate rows.** Forking a session copies the parent's assistant
  messages into the child with new message ids but the *same* timestamps and
  token counts — and the usage dashboard counts those copies. In this workspace
  **25 % of the last 30 days' message rows are copies** (5,154 of 24,019), so
  the dashboard's 30-day figure of 36.86亿 tokens is really 27.73亿. The script
  drops a row whose `(time_created, token fingerprint)` already appeared, which
  is the only way to tell a copy from a real call. Cross-check: over all
  history the deduped message sum is 3.692 B tokens against `session_v2`'s own
  `tokens_*` columns at 3.628 B (1.8 % apart), while the raw stream is 4.680 B.
- **Hidden runs vanish.** magic-context's historian/dreamer sessions are deleted
  through the session API when the run ends, and deleting a session deletes its
  messages (no orphans survive in the table), so their spend is counted by the
  provider and missing from the database.

Net: after deduplication the estimate runs ~13 % *below* the month meter, which
is the hidden-run share. The script scales the attribution onto the meter and
prints the factor (`calibrated x1.127`); the shares and the `$/step` column are
the useful part, the meter is the truth for how much is left. `--no-api` has no
meter to calibrate against and therefore over-reports.

Reading it:

```
meter      used      limit   used%   resets in
5h          $0.90     $12.00    7.5%        3h
week        $0.90     $30.00    3.0%        7d
month      $18.15     $60.00   30.2%       20d

pace $1.66/day → $51.57 by renewal, fits with $8.43 spare
```

The 5-hour meter is the one that interrupts a long session; the month meter
decides whether the plan lasts. A day at 2026-11-04's intensity ($5.40) burns
9 % of the month, so three such days inside one week is what hits the $30
weekly cap.

## Pitfalls

- **Do not size a plan from the usage dashboard.** It reports `$0.59` for what
  was `$18.15` of allowance, and its token totals are ~33 % high because they
  count fork copies (see Calibration above).
- **The per-model "monthly limit" is not a separate bucket.** It is the $60 pool
  restated in that model's list dollars: `multiplier = 60 / limit`. DeepSeek
  V4.1 Flash's $100 and the meter's $60 are the same limit.
- **`auth.json` and the credential table can disagree.** The provider credential
  (`credential` table, `integration_id = 'opencode-go'`) is the live key; an
  expired `auth.json` key answers `api_key_expired`.
- **A forked session is not a second conversation.** It replays the parent's
  messages locally; only the steps taken *after* the fork boundary cost
  anything, which is why the dashboard over-counts heavily in a workspace that
  forks a lot.
