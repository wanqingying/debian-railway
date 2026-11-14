#!/usr/bin/env node
// a6api consumption log puller.
//
// The gateway is a New API fork: the sk- key only exposes an aggregate
// (/v1/dashboard/billing/usage), while per-request rows live behind the
// dashboard API and need a *system access token* plus the numeric user id:
//   A6API_ACCESS_TOKEN=<dashboard token>  A6API_USER_ID=<id> node scripts/a6api-logs.mjs
//
// Two traps, both measured 2026-11-14:
//   * `p` is 1-BASED here (upstream New API is 0-based): p=1 is the first page,
//     p=0 behaves like p=1.
//   * page_size is capped at 100 and an out-of-range p returns an empty page
//     rather than an error, so the loop stops on `items.length === 0` too.
//
// quota is New API's integer unit: 500000 quota = $1 (a $0.0054 image is
// quota 2700), which is what the `model_price` field also states in dollars.

const BASE = process.env.A6API_BASE || 'https://a6api.vip';
const TOKEN = process.env.A6API_ACCESS_TOKEN;
const USER_ID = process.env.A6API_USER_ID;
const PAGE_SIZE = 100;
const QUOTA_PER_USD = 500_000;

if (!TOKEN || !USER_ID) {
  console.error('usage: A6API_ACCESS_TOKEN=<dashboard token> A6API_USER_ID=<id> node scripts/a6api-logs.mjs [--json]');
  process.exit(2);
}

const headers = { Authorization: `Bearer ${TOKEN}`, 'New-Api-User': String(USER_ID) };
const usd = (quota) => quota / QUOTA_PER_USD;

async function fetchPage(p) {
  const response = await fetch(`${BASE}/api/log/self?p=${p}&page_size=${PAGE_SIZE}`, {
    headers,
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json();
  if (!body.success) throw new Error(`a6api ${response.status}: ${JSON.stringify(body).slice(0, 200)}`);
  return body.data;
}

async function fetchAll() {
  const byId = new Map();
  let total = 0;
  for (let p = 1; p <= 200; p++) {
    const data = await fetchPage(p);
    total = data.total;
    for (const item of data.items) byId.set(item.id, item);
    if (data.items.length === 0 || byId.size >= total) break;
  }
  return { items: [...byId.values()].sort((a, b) => b.created_at - a.created_at), total };
}

function group(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    const row = map.get(key) || { requests: 0, quota: 0, prompt: 0, completion: 0 };
    row.requests += 1;
    row.quota += item.quota;
    row.prompt += item.prompt_tokens || 0;
    row.completion += item.completion_tokens || 0;
    map.set(key, row);
  }
  return [...map.entries()].sort((a, b) => b[1].quota - a[1].quota);
}

const { items, total } = await fetchAll();
const spent = items.reduce((sum, item) => sum + item.quota, 0);
const path = (item) => {
  try { return JSON.parse(item.other)?.request_path || '(n/a)'; } catch { return '(n/a)'; }
};

const summary = {
  requests: items.length,
  server_total: total,
  spent_usd: +usd(spent).toFixed(4),
  window: items.length
    ? [new Date(items[items.length - 1].created_at * 1000).toISOString(), new Date(items[0].created_at * 1000).toISOString()]
    : [],
  by_model: group(items, (i) => i.model_name).map(([model, r]) => ({
    model, requests: r.requests, usd: +usd(r.quota).toFixed(4),
    avg_usd: +(usd(r.quota) / r.requests).toFixed(5), prompt_tokens: r.prompt, completion_tokens: r.completion,
  })),
  by_day: group(items, (i) => new Date(i.created_at * 1000).toISOString().slice(0, 10))
    .map(([day, r]) => ({ day, requests: r.requests, usd: +usd(r.quota).toFixed(4) })),
  by_path: group(items, path).map(([p, r]) => ({ path: p, requests: r.requests, usd: +usd(r.quota).toFixed(4) })),
};

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ summary, items }, null, 1));
} else {
  console.log(JSON.stringify(summary, null, 2));
}
