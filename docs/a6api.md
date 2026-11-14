# a6api

Vendor reference for the `a6api` reseller gateway: what it authorises, how its
money works, which of its APIs are actually reachable with the credentials this
container holds, and the traps that cost time to find. Everything below was
measured against the live service on 2026-11-13/14 unless marked otherwise.

## What it is

A New API fork with a marketplace layer on top (`marketplace_*`, `pin_*` and
`supplier_*` fields appear in every log row). Two separate API surfaces:

| Surface | Base | Auth |
| --- | --- | --- |
| Inference (OpenAI-compatible) | `https://a6api.vip/v1` | `sk-` token: `Authorization: Bearer <key>` |
| Dashboard / management | `https://a6api.vip/api/*` | system access token **plus** `New-Api-User: <user id>` |

The inference surface also documents `https://api.a6api.vip` and a native path
(`/v1/messages`, `/v1beta/models/{model}:generateContent`); its own docs list
exactly nine operations: `/chat/completions`, `/responses`, `/v1/messages`,
`/v1beta/models/{model}:generateContent`, `/images/generations`, `/embeddings`,
`/rerank`, `/models`, and `/realtime` (WebSocket).

The dashboard is a SPA at `/ui/new/`; its 66 JS chunks carry the whole
management API surface (106 paths), which is how the inventory below was found —
the published docs only cover inference.

## Credentials

Three values, all on the Railway service (never in this repo):

| Env var | What it is |
| --- | --- |
| `A6API_API_KEY` | the `sk-` inference token (also mirrored in `auth.json` under `a6api`) |
| `A6API_ACCESS_TOKEN` | the dashboard **system access token**, created in the console under 个人设置 → 系统访问令牌 |
| `A6API_USER_ID` | the numeric user id (`44964` here), required as the `New-Api-User` header |

The header is not optional and not a formality: the dashboard API authenticates
the token first, then compares the header against the token's own user.

| Response | Meaning |
| --- | --- |
| `dashboard_auth_access_token_invalid` | token wrong, revoked or expired — or the request tripped the gateway's own guard (a burst of ~40 rapid GETs was enough once) |
| `dashboard_auth_user_id_missing` | no `New-Api-User` header |
| `dashboard_auth_required` … `does not match logged in user` | header present but wrong |

Treat the access token as short-lived and cheap to replace: regenerating it in
the console invalidates the previous one immediately.

## Money

**Quota unit: 500000 quota = $1.** Every dashboard field named `quota` or
`*_quota` is in that unit; `micros` fields are millionths of a dollar.

Two independent ceilings apply, and the smaller one wins:

| Ceiling | Endpoint | Measured (2026-11-14) |
| --- | --- | --- |
| Account balance | `/api/user/self` → `quota` | `4629199` = **$9.258** |
| Token allowance | `/api/token/search` → `remain_quota`, `unlimited_quota` | `1128832` = **$2.258**, `unlimited_quota: false` → hard cap |

So the binding limit for inference is the token, not the account: at the token's
remaining balance the key dies with `token_quota_exhausted` long before the
account is empty.

Aggregate billing is also readable with the `sk-` key alone — note the unit here
is **cents**, and the date parameters are ignored:

```
GET /v1/dashboard/billing/usage        -> {"object":"list","total_usage":74.1602}   // 74.1602 cents
GET /v1/dashboard/billing/subscription -> {"soft_limit_usd":2.999266,"hard_limit_usd":2.999266,"access_until":1802361540}
```

`total_usage` is a lifetime total for the token, and it reconciles exactly with
the sum of the per-request rows (`370801` quota = `$0.7416` = 74.16 cents),
which is the cross-check to run whenever the dashboard looks wrong.

### Price points measured

| Item | Price | Notes |
| --- | --- | --- |
| `nano-banana-2.1` image | **$0.0054** per request | marketplace per-request billing: supplier `$0.0045` + 20 % markup (`markup_percent: 20`, `quota_per_unit: 500000`, `quota: 2700`) |
| `claude-opus-5-5` | `$0.108`/M input, `$0.54`/M output, `$0.0054`/M cache read | Kiro-channel resale; ~1/100 of Opus list price, which is why it is tempting and why its behaviour must be verified per use |
| `deepseek-v4.1-flash-1017` | ~`$0.00005` per short call | the cheap default for agent work |

**Peak pricing doubles the bill**: `/api/marketplace/peak-schedule` reports
`multiplier_bps: 20000` (×2) for `weekdays: [1,2,3,4,5]` in the windows
`09:00–12:00` and `14:00–18:00`, interpreted in **Beijing time** (verified by
`next_switch_at` decoding to `2026-11-16T01:00:00Z` = 09:00 Beijing). Moving a
long-context job from 09:00 to 08:30 halves it.

Commission on referrals is `300` bps (3 %).

## Model access is whitelisted per token

`/api/token/search` exposes the token's own limits:

```jsonc
{
  "name": "TUYY", "id": 203422, "status": 1,
  "remain_quota": 1128832, "unlimited_quota": false,
  "model_limits_enabled": true,
  "model_limits": "deepseek-v4.1-flash-1017,claude-opus-5-5,nano-banana-2.1",
  "group": "auto", "routing_preference": "cheap", "pricing_strategy": "auto",
  "pricing_custom_pct": 50, "routing_allow_fallback": true,
  "expired_time": 1802361540
}
```

Consequences worth remembering:

- `/v1/models` lists only what the token may use, so "the gateway has no image
  models" is the wrong reading — the marketplace lists 32, the token authorises
  **one** (`nano-banana-2.1`), and every other id answers `403 model_not_allowed`.
- Model ids must be written exactly. `deepseek-v4.1-flash` (the upstream name)
  answers `400 model_not_allowed`; the token's id is
  `deepseek-v4.1-flash-1017`.
- Routing is already configured for price: `group: auto`,
  `routing_preference: cheap`, `pricing_strategy: auto`,
  `routing_allow_fallback: true`.

## Images: what the endpoint actually does

Measured with `nano-banana-2.1`:

| Behaviour | Result |
| --- | --- |
| `size: "1024x1024"` | 1024×1024 |
| `size: "1792x1024"` | **2752×1536** (the gateway maps size to an aspect, not to the pixel count asked for) |
| `size: "1024x1792"` | 1536×2752 |
| `n: 2` | silently ignored — always one image |
| output format | JPEG |
| latency | 10–24 s |
| `response_format: "b64_json"` | supported; the default is a temporary `console.prompt-hubs.com` URL that expires, so download immediately |
| image-to-image | `POST /v1/images/edits`, multipart, repeated `image` fields |
| Chinese prompts | fine |

### Why OpenCode's own image model cannot drive it

`experimental.image_generate` plus a `type: "image"` model is supported and does
load (`GET /api/model?types=image` lists the model), but every call fails with
`OpenAI Images returned an invalid response`: each item in the response carries
`revised_prompt` (plus an empty `b64_json`/`url` sibling) and OpenCode decodes
the OpenAI images body strictly. No config key drops a response field, and
`@opencode/ai/providers/openai` has no image route at all (`openai/images2` is
not even resolvable).

That is why the container talks to the endpoint itself:
`opencode-config/opencode/lib/image-gen.ts` + `plugins/image-gen/` expose the
`image_generate` tool, and the config deliberately declares **no** image
provider.

## Consumption logs

`GET /api/log/self` with the dashboard token; rows are newest-first.

```jsonc
{
  "id": 1, "created_at": 1794616379, "type": 2,
  "model_name": "nano-banana-2.1", "quota": 2700,
  "prompt_tokens": 68, "completion_tokens": 808, "use_time": 20,
  "token_name": "TUYY", "channel_name": "Channel ID 6763",
  "content": "大小 1792x1024, 品质 standard, ... 单次市场价 0.005400 USD，数量 1",
  "other": "{\"request_path\":\"/v1/images/generations\",\"marketplace_price_micros\":5400,\"pin_status\":\"active\", ...}"
}
```

Two pagination traps, both measured:

- **`p` is 1-based here** (upstream New API is 0-based): `p=1` is the first page,
  `p=0` behaves like `p=1`.
- `page_size` is capped at **100**, and a `p` past the end returns an **empty
  page**, not an error — so a loop must stop on `items.length === 0` as well as
  on the reported `total`.

Related endpoints: `/api/log/self/stat` (`{quota, rpm, tpm}` — the cheap health
check), `/api/log/self/filter-options` (`models`, `tokens`), and the export pair
`/api/log/self/export-tasks` + `/export` (CSV; the POST was not exercised).

`scripts/a6api-logs.mjs` wraps all of this: it pages the full history, groups by
model/day/hour/endpoint, and prints either a summary or `--json` with the raw
rows.

## Management API inventory

106 paths recovered from the SPA bundle, grouped by what they are for. "Works"
means measured `200` with the current token; the write methods (POST/PUT/DELETE)
were deliberately not exercised, so their status is unknown.

| Group | Endpoints | Status |
| --- | --- | --- |
| Consumption | `/api/log/self`, `/stat`, `/filter-options`, `/export-tasks` | works |
| Account | `/api/user/self`, `/api/user/self/groups`, `/api/user/token` | works |
| Tokens | `/api/token/search`, `/api/token/`, `/api/token/batch`, `/:id/key`, `/:id/routes` | search works; mutations untested |
| Prices & models | `/api/pricing`, `/api/platform-models`, `/api/user/models` | works (`/api/pricing` is also readable **without** auth) |
| Marketplace | `/api/marketplace/pins`, `/unpin`, `/favorites`, `/price-notices`, `/peak-schedule`, `/my-blocks` | works |
| Marketplace probes | `/api/marketplace/model-detections` (needs `channel_id` + `model`), `/circuit-states/query`, `/self-tests/*` | parameterised; untested |
| Subscriptions | `/api/subscriptions`, `/auto-pool-preview` (needs `subscription_id`), `/fallback/bulk` | works |
| Commission | `/api/commission/summary`, `/records`, `/referrals`, `/withdraw*` | works (3 % ratio) |
| Support | `/api/support/categories`, `/tickets`, `/attachments/:id` | works |
| Async tasks | `/api/task/self` | works (empty) |
| Invoices | `/api/user/invoices`, `/config`, `/mark-read`, `/unread-count` | works (empty) |
| Credential pool | `/api/credential-pool` | not enabled (`credential_pool_allowed: false`) |
| Supplier | `/api/supplier/*` (apply, me, listings, earnings, settlements, withdraw, guarantee, probes) | requires the seller onboarding (`apply`) |
| Platform admin | `/api/channel/`, `/api/option/`, `/api/user/` (list), `/api/redemption/`, `/api/group/`, `/api/log/` (global) | **403 for this account** — `role: 1`, `permissions.admin: false` |

## Measured spend snapshot (2026-11-13 20:05 → 11-14 08:33 Beijing)

187 requests, **$0.7416** total, reconciled against `total_usage` to the cent.

| Model | Requests | Spend | Share | Per call | Tokens in/out |
| --- | --- | --- | --- | --- | --- |
| `claude-opus-5-5` | 84 | $0.5440 | 73.3 % | $0.00648 | 9.54 M / 35 k |
| `nano-banana-2.1` | 35 | $0.1944 | 26.2 % | $0.00555 | 1.6 k / 26 k |
| `deepseek-v4.1-flash-1017` | 67 | $0.0032 | 0.4 % | $0.00005 | 630 k / 14 k |

The shape to remember: Opus spend is **input-dominated** — 84 calls re-sent
~250 k tokens each (peak 585 k, flagged `dynamic_long_request_tier:
very_large`), output was only 35 k. Cache absorbed 5.22 M of the 7.81 M input
(67 % hit, `$0.0054`/M against `$0.108`/M), which saved roughly $0.53 — about as
much as the entire bill. Without caching the same work would have cost ~2×.

Cheapest lever by far: run long-context sessions on
`deepseek-v4.1-flash-1017` ($0.00005/call) instead of Opus ($0.0065/call), and
keep out of the ×2 peak windows.

## Traps, in the order they bite

1. **`New-Api-User` is required** and must match the token's user; the error text
   distinguishes missing from mismatched, so read the `code`, not the message.
2. **The access token can die without warning.** One run lost it after ~40 rapid
   GETs; whether that is a rate guard or a regeneration is undetermined. Keep the
   probe rate low and be ready to reissue.
3. **`railway variable list --kv` prints every secret in clear.** Use `--json`
   and inspect keys and lengths instead.
4. **`quota` is not dollars.** Divide by 500000. The `/v1/dashboard/billing/*`
   endpoints use cents instead — the two units sit one call apart.
5. **Token ≠ account balance.** `unlimited_quota: false` means the token's
   `remain_quota` is the real ceiling.
6. **Peak pricing is Beijing-time weekday** 09–12 and 14–18, ×2.
7. **Image sizes are aspects.** Asking for 1792×1024 returns 2752×1536.
8. **Returned image URLs expire.** Fetch the bytes in the same call.

## Open questions

- Whether `/api/log/self/export` (POST) produces a usable CSV, and where the file
  can be downloaded from.
- Whether the dashboard token has a fixed TTL, and what the real rate limit is.
- Supplier-side endpoints (`/api/supplier/*`) stay unverified until an account
  actually applies as a seller.
- `other.marketplace_price_*` for the opus channel varies per row
  (`108000`/`60000`/`52800` micros), so a per-row cost model needs the tier rules
  before it can replace measurement.
