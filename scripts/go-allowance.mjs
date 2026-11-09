#!/usr/bin/env node
/**
 * OpenCode Go allowance meter.
 *
 * Go is a subscription, so OpenCode records `cost: 0` for every request the
 * subscription serves — the usage dashboard's cost column cannot answer "how
 * much of the month is left". Two things can:
 *
 *   1. `GET https://opencode.ai/console/api/go/status` with the API key. It
 *      returns the plan and the three meters as exact micro-cents (a dollar is
 *      100_000_000). This is the authoritative number and what the Console
 *      page rounds. Undocumented, but it is what OpenChamber's VS Code quota
 *      provider reads (`packages/vscode/src/opencodeGoQuota.ts`).
 *   2. `GET https://opencode.ai/zen/go/v1/usage` — the same three meters as
 *      floored integer percents, no plan, no reset detail.
 *
 * The plan meters are one shared pool (`go`: $12 / 5 h, $30 / week, $60 /
 * month; `go-plus` multiplies them), and on top of that each model has its own
 * monthly sub-cap, so one expensive model cannot eat the whole pool. Each
 * response reports what it counted as `usage.opencode.allowance`, which is a
 * fixed multiple of the OpenCode list price — the multiple is per model, not
 * per plan, and the measured ones are in MULT below. The script uses them to
 * attribute the month's spend to models and days from the session database.
 *
 * Usage: node scripts/go-allowance.mjs [--days N] [--json] [--no-api]
 */

import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const ARGS = process.argv.slice(2);
const JSON_OUT = ARGS.includes("--json");
const NO_API = ARGS.includes("--no-api");
const daysArg = ARGS.indexOf("--days");
const WINDOW_DAYS = daysArg >= 0 ? Number(ARGS[daysArg + 1]) : 0;

/**
 * List prices in $/1M tokens as [input, output, cache read, cache write].
 * `mult` is the allowance/list ratio, measured 2026-11-09 on eight models and
 * exactly `60 / docMonthly` on every one. A model's documented monthly limit is
 * therefore the $60 pool restated in that model's own list dollars, not a
 * separate sub-cap: DeepSeek V4.1 Flash's "$100/month" and the meter's
 * "$60/month" are the same limit, 0.6 apart.
 */
const MODELS = {
  "deepseek-v4.1-flash": {
    label: "DeepSeek V4.1 Flash",
    // Peak 01:00-04:00 and 06:00-10:00 UTC, Monday-Friday; off-peak otherwise.
    peak: [0.30, 1.20, 0.006, 0],
    off: [0.15, 0.60, 0.003, 0],
    peakPriced: true,
    mult: 0.6,
    docMonthly: 100,
  },
  "glm-5.3": { label: "GLM-5.3", peak: [1.40, 4.40, 0.26, 0], off: [1.40, 4.40, 0.26, 0], mult: 4, docMonthly: 15 },
  "gpt-6-luna": { label: "GPT 6 Luna", peak: [0.10, 0.50, 0.01, 0.125], off: [0.10, 0.50, 0.01, 0.125], mult: 4, docMonthly: 15 },
  "gpt-5.6-luna": { label: "GPT 5.6 Luna", peak: [0.20, 1.20, 0.02, 0.25], off: [0.20, 1.20, 0.02, 0.25], mult: 4, docMonthly: 15 },
  "minimax-m3": { label: "MiniMax M3", peak: [0.30, 1.20, 0.06, 0], off: [0.30, 1.20, 0.06, 0], mult: 1, docMonthly: 60 },
};

const MICRO_CENTS = 1e8;
const dataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
const dbPath = process.env.OPENCODE_DB || path.join(dataHome, "opencode", "opencode.db");

/** The Go API key: the provider credential first, then the legacy auth.json. */
const readApiKey = () => {
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    const row = db.prepare("select value from credential where integration_id = 'opencode-go' and active = 1 limit 1").get();
    db.close();
    if (row) return JSON.parse(row.value).key;
  } catch { /* fall through */ }
  try {
    const auth = JSON.parse(fs.readFileSync(path.join(dataHome, "opencode", "auth.json"), "utf8"));
    return auth["opencode-go"]?.key;
  } catch { return null; }
};

/** Authoritative meters, or null when the key is missing/expired/offline. */
const fetchStatus = async (key) => {
  if (!key) return null;
  try {
    const res = await fetch("https://opencode.ai/console/api/go/status", {
      headers: { Accept: "application/json", Authorization: `Bearer ${key}` },
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const body = await res.json();
    if (!body?.access?.meters) return null;
    const meter = (m) => m && ({
      used: Number(m.usedMicroCents) / MICRO_CENTS,
      limit: Number(m.limitMicroCents) / MICRO_CENTS,
      resetsAt: m.resetsAt ? Date.parse(m.resetsAt) : null,
    });
    return {
      product: body.product,
      periodStart: body.access.startsAt ? Date.parse(body.access.startsAt) : null,
      periodEnd: body.access.endsAt ? Date.parse(body.access.endsAt) : null,
      fiveHour: meter(body.access.meters.fiveHour),
      week: meter(body.access.meters.week),
      month: meter(body.access.meters.month),
    };
  } catch { return null; }
};

const isPeak = (ts) => {
  const d = new Date(ts), day = d.getUTCDay(), h = d.getUTCHours();
  return day !== 0 && day !== 6 && ((h >= 1 && h < 4) || (h >= 6 && h < 10));
};

const status = NO_API ? null : await fetchStatus(readApiKey());

const db = new DatabaseSync(dbPath, { readOnly: true });
const rows = db.prepare(
  "select time_created, data from session_message where type = 'assistant' order by time_created"
).all();
db.close();

const steps = [];
let lastPaidTs = 0;
// Forking a session copies the parent's messages into the child with new message
// ids but the same timestamps and token counts, and the usage dashboard counts
// those copies — in this workspace 25 % of the last 30 days' message rows are
// copies. Only a (timestamp, token fingerprint) pair that appears once was a
// real API call, so the copies are dropped here.
const seen = new Set();
let copies = 0;
for (const r of rows) {
  const d = JSON.parse(r.data);
  if (!d.model || d.model.providerID !== "opencode-go") continue;
  const model = MODELS[d.model.id];
  if (!model) continue;
  // cost > 0 means pay-as-you-go, not subscription usage
  if ((d.cost || 0) > 0) { lastPaidTs = Math.max(lastPaidTs, r.time_created); continue; }
  const t = d.tokens || {};
  const fingerprint = `${r.time_created}@${t.input || 0}|${t.output || 0}|${t.reasoning || 0}|${(t.cache && t.cache.read) || 0}|${(t.cache && t.cache.write) || 0}`;
  if (seen.has(fingerprint)) { copies++; continue; }
  seen.add(fingerprint);
  const peak = Boolean(model.peakPriced) && isPeak(r.time_created);
  const rate = peak ? model.peak : model.off;
  const input = t.input || 0;
  const output = (t.output || 0) + (t.reasoning || 0);
  const cacheRead = (t.cache && t.cache.read) || 0;
  const cacheWrite = (t.cache && t.cache.write) || 0;
  const list = (input * rate[0] + output * rate[1] + cacheRead * rate[2] + cacheWrite * rate[3]) / 1e6;
  steps.push({ ts: r.time_created, id: d.model.id, peak, input, output, cacheRead, allowance: list * model.mult });
}

if (!steps.length) {
  console.log("No OpenCode Go usage found.");
  process.exit(0);
}

const subscriptionStart = steps.find((s) => s.ts > lastPaidTs)?.ts ?? steps[0].ts;
const start = status?.periodStart ?? (WINDOW_DAYS ? Date.now() - WINDOW_DAYS * 86400_000 : subscriptionStart);
const inWindow = steps.filter((s) => s.ts >= start);
const now = Date.now();
const elapsedDays = Math.max((now - start) / 86400_000, 0.01);

/** Largest sum over any window of `winMs` — the caps are rolling, not calendar. */
const rollingMax = (list, winMs) => {
  let best = 0, sum = 0, lo = 0;
  for (let hi = 0; hi < list.length; hi++) {
    sum += list[hi].allowance;
    while (list[hi].ts - list[lo].ts >= winMs) { sum -= list[lo].allowance; lo++; }
    if (sum > best) best = sum;
  }
  return best;
};

const byModel = new Map();
for (const s of inWindow) {
  const a = byModel.get(s.id) || { steps: 0, estimate: 0 };
  a.steps++; a.estimate += s.allowance;
  byModel.set(s.id, a);
}
const estimateTotal = [...byModel.values()].reduce((sum, m) => sum + m.estimate, 0);
const monthUsed = status?.month?.used ?? estimateTotal;
// The database records every step the client saw; retries and replayed folds
// can appear twice, so the attribution is scaled onto the provider's meter.
const calibration = estimateTotal > 0 ? monthUsed / estimateTotal : 1;

const models = [...byModel].map(([id, a]) => ({
  model: MODELS[id].label,
  mult: MODELS[id].mult,
  docMonthly: MODELS[id].docMonthly,
  steps: a.steps,
  share: a.estimate * calibration,
  perStep: (a.estimate * calibration) / a.steps,
})).sort((a, b) => b.share - a.share);

const monthLimit = status?.month?.limit ?? 60;
const report = {
  product: status?.product ?? "unknown",
  period: { start: new Date(start).toISOString(), end: status?.periodEnd ? new Date(status.periodEnd).toISOString() : null, elapsedDays: Number(elapsedDays.toFixed(1)) },
  meters: status ? {
    fiveHour: status.fiveHour, week: status.week, month: status.month,
  } : {
    fiveHour: { used: rollingMax(inWindow, 5 * 3600e3), limit: 12 },
    week: { used: rollingMax(inWindow, 7 * 86400e3), limit: 30 },
    month: { used: estimateTotal, limit: 60 },
  },
  projection: {
    perDay: Number((monthUsed / elapsedDays).toFixed(2)),
    daysRemaining: Number(((status?.periodEnd ? (status.periodEnd - now) / 86400_000 : 30 - elapsedDays)).toFixed(1)),
    byRenewal: Number((monthUsed / elapsedDays * (status?.periodEnd ? (status.periodEnd - start) / 86400_000 : 30)).toFixed(2)),
    exhaustedInDays: monthUsed > 0 ? Number(((monthLimit - monthUsed) / (monthUsed / elapsedDays)).toFixed(0)) : null,
  },
  models: models.map((m) => ({ ...m, share: Number(m.share.toFixed(2)), perStep: Number(m.perStep.toFixed(4)) })),
  forkCopiesDropped: copies,
  calibration: Number(calibration.toFixed(3)),
};

if (JSON_OUT) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

const $ = (n) => `$${n.toFixed(2)}`;
const pct = (used, limit) => `${((used / limit) * 100).toFixed(1)}%`;
const hours = (ms) => `${Math.max(0, Math.round(ms / 3600e3))}h`;
const days = (ms) => `${Math.max(0, Math.round(ms / 86400e3))}d`;

console.log(`OpenCode Go · plan ${report.product} · ${$(monthLimit)}/month`);
console.log(`period ${report.period.start.slice(0, 16)}Z → ${report.period.end ? report.period.end.slice(0, 16) + "Z" : "(unknown)"} · ${elapsedDays.toFixed(1)} d elapsed`);
console.log("");
console.log("meter      used      limit   used%   resets in");
for (const [name, m] of [["5h", report.meters.fiveHour], ["week", report.meters.week], ["month", report.meters.month]]) {
  if (!m) continue;
  const reset = m.resetsAt ? (name === "5h" ? hours(m.resetsAt - now) : days(m.resetsAt - now)) : "-";
  console.log(`${name.padEnd(7)} ${$(m.used).padStart(9)} ${$(m.limit).padStart(10)} ${pct(m.used, m.limit).padStart(7)} ${String(reset).padStart(9)}`);
}
console.log("");
const p = report.projection;
if (p.exhaustedInDays !== null && p.exhaustedInDays < p.daysRemaining) {
  console.log(`pace ${$(p.perDay)}/day → allowance runs out in ${p.exhaustedInDays} d, ${Math.round(p.daysRemaining - p.exhaustedInDays)} d before renewal`);
} else {
  console.log(`pace ${$(p.perDay)}/day → ${$(p.byRenewal)} by renewal, fits with ${$(monthLimit - p.byRenewal)} spare`);
}
console.log("");
console.log(`by model (share calibrated x${report.calibration} to the month meter; ${report.forkCopiesDropped} fork copies dropped)`);
console.log("model                  steps   share$  of month   $/step   doc limit");
for (const m of report.models) {
  console.log(
    m.model.padEnd(22), String(m.steps).padStart(6), $(m.share).padStart(8),
    `${((m.share / monthLimit) * 100).toFixed(1)}%`.padStart(9), m.perStep.toFixed(4).padStart(8), $(m.docMonthly).padStart(9)
  );
}

const mainId = models[0] && Object.keys(MODELS).find((id) => MODELS[id].label === models[0].model);
if (mainId) {
  const byDay = new Map();
  for (const s of inWindow.filter((x) => x.id === mainId)) {
    const k = new Date(s.ts).toISOString().slice(0, 10);
    const a = byDay.get(k) || { steps: 0, allowance: 0, peak: 0 };
    a.steps++; a.allowance += s.allowance * calibration;
    if (s.peak) a.peak += s.allowance * calibration;
    byDay.set(k, a);
  }
  console.log(`\n${MODELS[mainId].label} by day (UTC)`);
  console.log("day          steps   share$   peak$");
  for (const [date, v] of [...byDay].sort()) {
    console.log(`${date}  ${String(v.steps).padStart(5)} ${$(v.allowance).padStart(8)} ${$(v.peak).padStart(7)}`);
  }
}
