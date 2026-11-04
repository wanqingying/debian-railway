// Steam AI-disclosure revenue study — collection + stats.
// Usage: node collect.mjs strat [n] [strata] | fetch | stats
import fs from "node:fs";
import path from "node:path";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const SAMPLE = path.join(DIR, "sample.tsv");
const ROWS = path.join(DIR, "rows.jsonl");
const CACHE = "/tmp/opencode/steam-search-cache";
fs.mkdirSync(CACHE, { recursive: true });

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const INDIE_TAG = 492;
const CUTOFF = new Date("2026-01-01T00:00:00Z");

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, { timeout = 25000, retries = 3 } = {}) {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" }, signal: AbortSignal.timeout(timeout) });
      const text = await res.text();
      if (res.status === 200) return { status: 200, text };
      if (i === retries) return { status: res.status, text: "" };
    } catch (e) {
      if (i === retries) return { status: 0, text: "" };
    }
    await sleep(1500 * (i + 1));
  }
}

function parseDate(s) {
  const t = (s || "").trim().replace(/\s+/g, " ");
  if (!t || /coming soon|to be announced|q[1-4]|^\d{4}$/i.test(t)) return null;
  const d = new Date(t + " UTC");
  return isNaN(d) ? null : d;
}

function parseSearchPage(text) {
  let j;
  try { j = JSON.parse(text); } catch { return []; }
  return (j.results_html || "").split('<a href="https://store.steampowered.com/app/').slice(1).map((it) => {
    const appid = (it.match(/^(\d+)\//) || [])[1];
    const name = ((it.match(/<span class="title">([^<]*)<\/span>/) || [])[1] || "").trim();
    const rel = ((it.match(/search_released[^>]*>([^<]*)</) || [])[1] || "").trim();
    const price = (it.match(/data-price-final="(\d+)"/) || [])[1] || "";
    return { appid, name, date: parseDate(rel), price_cents: +price || 0 };
  }).filter((r) => r.appid && r.date);
}

async function page(offset) {
  const cf = `${CACHE}/${offset}.json`;
  if (fs.existsSync(cf)) {
    const c = fs.readFileSync(cf, "utf8");
    if (c.length > 1000) return parseSearchPage(c);
  }
  const url = `https://store.steampowered.com/search/results/?infinite=1&count=100&sort_by=Released_DESC&tags=${INDIE_TAG}&cc=us&l=english&start=${offset}`;
  const { status, text } = await get(url);
  if (status !== 200 || text.length < 1000) return [];
  fs.writeFileSync(cf, text);
  return parseSearchPage(text);
}

async function strat(n = 1500, strata = 10) {
  // find newest offset that still contains a 2026 release (binary search)
  let lo = 0, hi = 80000, boundary = 0;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2 / 100) * 100;
    const items = await page(mid);
    if (!items.length) { hi = mid - 100; continue; }
    const maxD = items.reduce((m, r) => (r.date > m ? r.date : m), items[0].date);
    if (maxD >= CUTOFF) { boundary = mid; lo = mid + 100; } else hi = mid - 100;
  }
  log(`boundary offset ~${boundary} (newest ${new Date().toISOString().slice(0, 10)}, cutoff ${CUTOFF.toISOString().slice(0, 10)})`);
  const per = Math.ceil(n / strata);
  const pagesPer = Math.max(2, Math.ceil((per * 1.4) / 100));
  const picked = [];
  for (let s = 0; s < strata; s++) {
    const base = Math.floor((boundary * s) / (strata - 1) / 100) * 100;
    let pool = [];
    for (let attempt = 0; attempt < 5 && pool.length < per; attempt++) {
      const extra = attempt * pagesPer * 100;
      for (let p = 0; p < pagesPer; p++) {
        pool.push(...(await page(base + extra + p * 100)));
        await sleep(350);
      }
      pool = [...new Map(pool.filter((r) => r.date >= CUTOFF).map((r) => [r.appid, r])).values()];
    }
    if (!pool.length) { log(`stratum ${s} @${base}: empty, skipped`); continue; }
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    picked.push(...pool.slice(0, Math.min(per, pool.length)));
    const ds = pool.map((r) => r.date).sort();
    log(`stratum ${s} @${base}: ${ds[0].toISOString().slice(0, 10)} .. ${ds[ds.length - 1].toISOString().slice(0, 10)} pool=${pool.length} pick=${Math.min(per, pool.length)}`);
  }
  fs.writeFileSync(SAMPLE, "appid\tname\tdate\tprice_cents\n" + picked.map((r) => `${r.appid}\t${r.name.replace(/\t/g, " ")}\t${r.date.toISOString().slice(0, 10)}\t${r.price_cents}`).join("\n") + "\n");
  log(`sample: ${picked.length} apps`);
}

function parseStore(html) {
  const flagged = /AI Generated Content Disclosure/.test(html);
  let reviews = 0;
  const m = html.match(/([\d,]+) user reviews for this game/);
  if (m) reviews = +m[1].replace(/,/g, "");
  return { flagged, reviews };
}

async function fetchAll() {
  const rows = fs.readFileSync(SAMPLE, "utf8").trim().split("\n").slice(1).map((l) => {
    const [appid, name, date, price_cents] = l.split("\t");
    return { appid, name, date, price_cents: +price_cents || 0 };
  });
  const done = new Set();
  if (fs.existsSync(ROWS)) for (const l of fs.readFileSync(ROWS, "utf8").trim().split("\n")) { try { done.add(JSON.parse(l).appid); } catch {} }
  const todo = rows.filter((r) => !done.has(r.appid));
  log(`fetch: ${rows.length} sampled, ${done.size} done, ${todo.length} to go`);
  const out = fs.createWriteStream(ROWS, { flags: "a" });
  let i = 0, ok = 0, fail = 0, flagged = 0;
  const t0 = Date.now();
  async function worker() {
    while (i < todo.length) {
      const r = todo[i++];
      const { status, text } = await get(`https://store.steampowered.com/app/${r.appid}/?l=english&cc=us`);
      if (status !== 200 || !text) { fail++; out.write(JSON.stringify({ ...r, error: status }) + "\n"); continue; }
      const s = parseStore(text);
      if (s.flagged) flagged++;
      ok++;
      out.write(JSON.stringify({ ...r, ...s }) + "\n");
      if (ok % 200 === 0) {
        const el = (Date.now() - t0) / 1000;
        log(`progress ${ok}/${todo.length} flagged=${flagged} (${((flagged / ok) * 100).toFixed(1)}%) fail=${fail} ${(ok / el).toFixed(1)}/s eta=${((todo.length - ok) / (ok / el) / 60).toFixed(1)}min`);
      }
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));
  out.end();
  log(`fetch done: ok=${ok} fail=${fail} flagged=${flagged}`);
}

function quantile(arr, q) {
  if (!arr.length) return 0;
  const a = [...arr].sort((x, y) => x - y);
  const pos = (a.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return a[lo] + (a[hi] - a[lo]) * (pos - lo);
}
function wilson(k, n) {
  if (!n) return [0, 0];
  const p = k / n, z = 1.96, d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}

function stats() {
  const rows = fs.readFileSync(ROWS, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((r) => !r.error && r.reviews !== undefined);
  for (const r of rows) { r.priceUsd = r.price_cents / 100; r.units = r.reviews * 30; r.revenue = r.units * r.priceUsd; }
  const pct = (x) => (x * 100).toFixed(1) + "%";
  const usd = (n) => "$" + Math.round(n).toLocaleString("en-US");

  function describe(name, g) {
    if (!g.length) return null;
    const paid = g.filter((r) => r.priceUsd > 0);
    const rev = paid.map((r) => r.revenue).sort((a, b) => b - a);
    const total = rev.reduce((a, b) => a + b, 0);
    const top1 = rev.slice(0, Math.max(1, Math.ceil(rev.length * 0.01))).reduce((a, b) => a + b, 0);
    const zero = g.filter((r) => r.reviews === 0).length;
    const ge10 = g.filter((r) => r.reviews >= 10).length;
    const ge100 = g.filter((r) => r.reviews >= 100).length;
    const [zl, zh] = wilson(zero, g.length);
    const [cl, ch] = wilson(ge100, g.length);
    log(`[${name}] n=${g.length} paid=${paid.length} price_med=$${quantile(paid.map((r) => r.priceUsd), 0.5).toFixed(2)}`);
    log(`   zeroReview=${pct(zero / g.length)} [${pct(zl)}-${pct(zh)}]  >=10rev=${pct(ge10 / g.length)}  >=100rev=${pct(ge100 / g.length)} [${pct(cl)}-${pct(ch)}]`);
    log(`   paid: median=${usd(quantile(rev, 0.5))} p75=${usd(quantile(rev, 0.75))} p90=${usd(quantile(rev, 0.9))} mean=${usd(total / Math.max(1, paid.length))}`);
    log(`   paid: >=$1k=${pct(paid.filter((r) => r.revenue >= 1000).length / Math.max(1, paid.length))} >=$10k=${pct(paid.filter((r) => r.revenue >= 10000).length / Math.max(1, paid.length))} >=$100k=${pct(paid.filter((r) => r.revenue >= 100000).length / Math.max(1, paid.length))} top1%_share=${total ? pct(top1 / total) : "n/a"}`);
    return { n: g.length, zero: zero / g.length, ge100: ge100 / g.length };
  }

  const ai = rows.filter((r) => r.flagged), no = rows.filter((r) => !r.flagged);
  log(`total n=${rows.length} flagged=${ai.length} (${pct(ai.length / rows.length)})`);
  const b = describe("AI", ai), c = describe("NON-AI", no);
  describe("ALL", rows);

  const byMonth = new Map();
  for (const r of rows) {
    const k = r.date.slice(0, 7);
    if (!byMonth.has(k)) byMonth.set(k, { ai: [], no: [] });
    byMonth.get(k)[r.flagged ? "ai" : "no"].push(r);
  }
  log("\nmonth | AI n / zero% / >=100rev% | NON-AI n / zero% / >=100rev%");
  for (const k of [...byMonth.keys()].sort()) {
    const { ai: A, no: N } = byMonth.get(k);
    const f = (g) => `${String(g.length).padStart(3)} ${pct(g.filter((r) => !r.reviews).length / Math.max(1, g.length))} ${pct(g.filter((r) => r.reviews >= 100).length / Math.max(1, g.length))}`;
    log(`${k} | ${f(A)} | ${f(N)}`);
  }
  if (b && c) log(`\nKEY zeroReview AI=${pct(b.zero)} vs non-AI=${pct(c.zero)} diff=${((b.zero - c.zero) * 100).toFixed(1)}pp; >=100rev AI=${pct(b.ge100)} vs ${pct(c.ge100)} ratio=${(b.ge100 / c.ge100).toFixed(2)}x`);

  // Mantel-Haenszel odds ratio, stratified by release month
  function mh(eventFn) {
    let num = 0, den = 0, sumAR = 0, sumVAR = 0;
    for (const [, { ai: A, no: N }] of byMonth) {
      const a = A.filter(eventFn).length, b = A.length - a;
      const c = N.filter(eventFn).length, d = N.length - c;
      const n = a + b + c + d;
      if (!n || !b || !c) continue;
      num += (a * d) / n; den += (b * c) / n;
      sumAR += (a * d) / n; sumVAR += ((a + b) * (c + d) * (a + c) * (b + d)) / (n * n * (n - 1));
    }
    const or = num / den, se = Math.sqrt(sumVAR) / num;
    return { or, lo: Math.exp(Math.log(or) - 1.96 * se), hi: Math.exp(Math.log(or) + 1.96 * se) };
  }
  const mhZero = mh((r) => r.reviews === 0);
  const mh10 = mh((r) => r.reviews >= 10);
  const mh100 = mh((r) => r.reviews >= 100);
  log(`\nMH odds ratio (AI vs non-AI, stratified by month):`);
  log(`   zero reviews  OR=${mhZero.or.toFixed(2)} [${mhZero.lo.toFixed(2)}-${mhZero.hi.toFixed(2)}]`);
  log(`   >=10 reviews  OR=${mh10.or.toFixed(2)} [${mh10.lo.toFixed(2)}-${mh10.hi.toFixed(2)}]`);
  log(`   >=100 reviews OR=${mh100.or.toFixed(2)} [${mh100.lo.toFixed(2)}-${mh100.hi.toFixed(2)}]`);

  for (const [k, g] of [["AI", ai], ["NON-AI", no]]) {
    const g10 = g.filter((r) => r.reviews >= 10 && r.priceUsd > 0);
    const rev = g10.map((r) => r.revenue);
    log(`   ${k} traction (paid, >=10 rev): n=${g10.length} median=${usd(quantile(rev, 0.5))} p75=${usd(quantile(rev, 0.75))}`);
  }

  // paid games in the 10-30 CNY band (approx $1.4-$4.2)
  const band = rows.filter((r) => r.priceUsd >= 1.4 && r.priceUsd <= 4.2);
  if (band.length) {
    log(`\n[band $1.4-4.2 ≈ ¥10-30] n=${band.length} flagged=${band.filter((r) => r.flagged).length}`);
    for (const [k, g] of [["AI", band.filter((r) => r.flagged)], ["NON-AI", band.filter((r) => !r.flagged)]]) {
      const rev = g.map((r) => r.revenue).sort((a, b) => b - a);
      log(`   ${k}: n=${g.length} zero=${pct(g.filter((r) => !r.reviews).length / Math.max(1, g.length))} median=${usd(quantile(rev, 0.5))} >=100rev=${pct(g.filter((r) => r.reviews >= 100).length / Math.max(1, g.length))}`);
    }
  }
}

const cmd = process.argv[2];
if (cmd === "strat") await strat(+process.argv[3] || 1500, +process.argv[4] || 10);
else if (cmd === "fetch") await fetchAll();
else if (cmd === "stats") stats();
else console.log("usage: node collect.mjs strat [n] [strata] | fetch | stats");
