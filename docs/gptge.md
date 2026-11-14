# gpt.ge (V-API)

Vendor reference for the `gpt.ge` reseller gateway (brand name **V-API**, docs at
`https://api-gpt-ge.apifox.cn`): what it authorises, how its money works, what was
measured end to end, and the traps. Everything below was measured against the live
service on 2026-11-14 unless marked otherwise.

## What it is

Another New API fork, older than a6api's (no marketplace layer, no per-token model
whitelist). Two separate API surfaces:

| Surface | Base | Auth |
| --- | --- | --- |
| Inference (OpenAI- and Anthropic-compatible) | `https://api.gpt.ge/v1` | `sk-` token: `Authorization: Bearer <key>` (or `x-api-key` on `/v1/messages`) |
| Dashboard / management | `https://api.gpt.ge/api/*` | system access token **plus** `X-Api-User: <user id>` |

Ten nodes are advertised by the public `/api/status` (`api_list`); they all front the
same account, so pick by network path, not by price:

| Node | Note |
| --- | --- |
| `api.gpt.ge` | global, what this repo uses |
| `api.vveai.com` | "三网优化", the main recommended line |
| `run.v3.cm`, `us.gpt.ge` | 10 GB-bandwidth recommended nodes |
| `api1.v3.cm`, `api2.v3.cm` | backups |
| `jp.gpt.ge` | Tokyo, being retired |
| `api.v3.cm` | overseas, unreachable from China |
| `cf.gpt.ge` | Cloudflare CDN |
| `api.aaai.vip` | API only, no front end |

Supported inference endpoints per model page: `POST /v1/chat/completions`,
`POST /v1/messages` (Anthropic native), and on some models `POST /v1/responses`.
`/v1/models` answers with all **271** model ids the account can see.

## Credentials

Three values, all on the Railway service (never in this repo):

| Env var | What it is |
| --- | --- |
| `GPTGE_API_KEY` | the `sk-` inference token |
| `GPTGE_ACCESS_TOKEN` | the dashboard **system access token** (32 hex chars), created in the panel under 个人设置 → 系统访问令牌 |
| `GPTGE_USER_ID` | the numeric account id (`20535` here) |

Three traps in the dashboard auth, each of which cost a round trip:

- **The header name is `X-Api-User`, not `New-Api-User`.** a6api's fork wants
  `New-Api-User`; this one ignores it and answers
  `Not allowed: missing X-Api-User header` for every management path.
- **The value is compared, not trusted.** A wrong id answers
  `Not allowed: X-Api-User does not match the logged-in user` — the same message
  a6api gives, but here there is no way to discover the id from the token, so it
  must be read off the panel (`/api/user/self` needs it, i.e. chicken and egg).
  Brute-forcing it does not work: ~150 probes tripped the rate limiter.
- **The rate limiter is global per account/IP and coarse.** A burst of 30 parallel
  management requests answered HTTP 429 `{"message":"请求过于频繁，请 139 秒后重试"}`,
  and during that window the *inference* billing endpoints were throttled too, so a
  measurement loop must be serial with ~1 s spacing.

## Money

**Quota unit: 500000 quota = $1** (`/api/status` → `quota_per_unit: 500000`).
Every dashboard `quota` field, including the per-request `quota` in log rows, is in
that unit. Verified to the cent on two log rows:
`284 in / 53 out` on DeepSeek → `124` (= 284×0.5/M + 53×2/M), and
`403 in / 51 out` on Opus → `1316` (= 403×4/M + 51×20/M).

Two ceilings apply and the smaller one wins:

| Ceiling | Endpoint | Measured (2026-11-14) |
| --- | --- | --- |
| Account balance | `/api/user/self` → `quota` | `4737572` = **$9.475** |
| Token allowance | `/api/token/?p=1` → `remain_quota` | `24018517` = **$48.04** (`unlimited_quota: false`), expires `2026-12-10T02:32:02Z` |

Lifetime spend across the account was `used_quota: 20362428` = $40.72 over 27 077
requests.

**Do not trust `/v1/dashboard/billing/*` here.** It exists (the `sk-` key alone can
read it) and it is a legacy shim: `total_usage` lands in *cents* but its rows lag the
per-request log by up to a minute, its `start_date`/`end_date` are ignored, and
`subscription.hard_limit_usd` reported `58.905` while the account actually held
`$9.475` — an unrelated scale. The authoritative reads are `/api/user/self` (balance)
and `/api/log/self` (per request).

```
GET /api/log/self?p=1&page_size=20&type=0      // p is 1-based; newest first
GET /api/user/self                              // quota, used_quota, group, request_count
GET /api/token/?p=1&page_size=20                // per-token remain_quota, group, expiry
```

### Price points measured

List prices come from each model's public page, `https://gpt.ge/models/<id>` (no auth
needed), and every one below was then confirmed against a real log row.

| Item | Group | Price |
| --- | --- | --- |
| `deepseek-v4.1-flash-1017` | `deepseek` (0.5×) | `$0.5`/M input, `$2`/M output, `$0.01`/M cache read |
| `claude-opus-5-5` | `claude_max` (1×) | `$4`/M input, `$20`/M output, `$0.2`/M cache read, `$5`/M cache write (5 m), `$8`/M (1 h) |

- **DeepSeek peak pricing** multiplies the *cache read* only, to `$0.02`/M, on
  weekdays `01:00–04:00` and `06:00–10:00` UTC (= Beijing 09–12 and 14–18). Input and
  output are flat.
- **Opus has four channel groups**, and the price differs 3× between the cheap and
  the verified one (`/api/user/groups`): `claude_kiro` 0.35× (reverse-engineered
  Kiro), `claude_fzl` 0.6× (反重力), `claude_cc` 0.8× (cursor/Kiro), `claude_max` 1×
  ("pure max account, best quality, cannot be distilled"), plus `claude` 2.6×
  (enterprise, "may be out of stock").
- **The group is a property of the token, set in the panel — not of the request.**
  Adding `"group": "claude_kiro"` to the chat body is silently ignored: the log row
  still says `claude_max`. This token carries `gemini_cli,deepseek,sale,default`
  (`auto_group_enabled: true`), and `claude-5-5` resolves through `default` to
  `claude_max`. Getting the 0.35× channel means changing the token's group in the
  panel, and that channel is the Kiro resale whose behaviour a6api's copy gets wrong
  (see below), so it must be re-verified before use.
- **Cache writes are billed at full price and the cache is per-request-write only for
  a first call.** Two consecutive 125 k-token Opus calls billed `312571` quota each
  ($0.625) with `prompt_tokens: 4` — the other 125 041 tokens were the cache write,
  charged at `$5`/M. That is the whole reason a long-context Opus call costs ~$0.63
  no matter how small the visible prompt is.

## Behaviour measured

Both models were driven end to end over HTTP, not just via the `models` list.

| Check | `deepseek-v4.1-flash-1017` | `claude-opus-5-5` |
| --- | --- | --- |
| Basic completion | 200, 1.65 s | 200, 2.0 s |
| System prompt honoured | yes | **yes** — unlike a6api's Kiro resale, which overrides it |
| Tool calling (streaming) | `get_weather{"city":"Osaka"}` | same, with `toolu_…` ids |
| Token accounting | honest | honest (113 k prompt reported as 113 k) |
| `/v1/messages` (Anthropic) | — | yes, with signed `thinking` blocks |
| Prompt cache | 5248 of 5392 tokens on the 2nd call (97 %) | `cache_write_tokens` on every call; no read-side hit without a pinned session |
| Context / max output (panel) | 1 M / 384 K | 1 M / 128 K, knowledge cutoff 2026-06 |

Cost of the same agent step, on this token, versus the two other gateways:

| Gateway | DeepSeek V4.1 Flash 1017 | Claude Opus 5.5 |
| --- | --- | --- |
| `gpt.ge` | $0.5/M in, $2/M out | **$4/M in, $20/M out** (`claude_max`) |
| `a6api` | ~$0.00005 per short call | $0.108/M in, $0.54/M out (Kiro resale) |
| `opencode-go` (subscription) | one $60/month shared pool | same pool, 0.6× multiplier |

So gpt.ge is the expensive-but-honest channel: 37× a6api's Opus price, and roughly
1/25 of Opus list pricing, in exchange for a real Max account that obeys the system
prompt. It is worth using for a task that needs Opus quality, not for routine agent
work, and not at all while the balance is $9.48 (~15 × 125 k-token Opus calls).

## Wiring in this repo

`opencode-config/opencode/opencode.jsonc` carries the provider:

```jsonc
"gptge": {
  "name": "V-API (gpt.ge)",
  "env": ["GPTGE_API_KEY"],
  "package": "@opencode/ai/providers/openai-compatible",
  "settings": { "baseURL": "https://api.gpt.ge/v1" },
  "models": { "deepseek-v4.1-flash-1017": {…}, "claude-opus-5-5": {…} }
}
```

Two operational notes:

- **A provider added to the config does not appear in the running server.** The model
  list is read at startup (`GET /api/model` kept answering the old 34 models after
  the file changed, including a live `cp` into `$XDG_CONFIG_HOME/opencode/`), so the
  models show up only after opencode restarts — i.e. after the next redeploy.
- Costs in the config are the panel's per-million list prices above; they are
  metadata for OpenChamber's UI and the allowance meter, not what the gateway charges.

## Image generation

Not exercised and deliberately not wired: the OpenCode image-model path already fails
on this gateway family (see the note in `opencode.jsonc`), and the `image_generate`
tool talks to a6api, where an image costs $0.0054 against a real balance. If gpt.ge
images are ever needed, probe `/v1/images/generations` first and record the per-request
`quota` from `/api/log/self`.
