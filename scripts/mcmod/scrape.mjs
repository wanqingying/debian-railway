#!/usr/bin/env node
/**
 * scripts/mcmod/scrape.mjs — read mcmod.cn mods (counts + metadata) into the SQLite dataset.
 *
 * Drives the container's **visible** Chromium over CDP (never headless, never a second browser), so
 * the operator can watch pages in the KasmVNC view. All HTTP goes through the browser context's
 * request client, which shares the signed-in cookie jar — the 推荐/收藏/关注 counts are login-gated
 * and come back null for an anonymous session.
 *
 * Usage:
 *   scripts/mcmod/scrape.mjs --count 300                 # first 300 mods of the default list
 *   scripts/mcmod/scrape.mjs --index 1                   # 1st mod of that list
 *   scripts/mcmod/scrape.mjs --mod 10175                 # one mod by id or /class/<id>.html URL
 *   scripts/mcmod/scrape.mjs --modpack 684               # every mod of a modpack (id or URL)
 *   options: --list <modlist url> --batch N --concurrency N --db <file> --no-export
 *
 * Progress: one line per mod on stderr, plus a `runs` row in the DB that a second process can poll
 * (see docs/mcmod-db.md). Exits non-zero on failure.
 */
import { chromium } from 'playwright-core';
import { resolve } from 'node:path';
import { openDb, saveMod, savePack, startRun, progressRun, finishRun, nowStamp } from './db.mjs';
import { exportJson } from './export.mjs';

const CDP = process.env.CDP || 'http://127.0.0.1:9222';
const UA = process.env.UA || 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154 Safari/537.36';
const DEFAULT_LIST = 'https://www.mcmod.cn/modlist.html?mcver=1.18.2&platform=1';
const CLASS = (id) => `https://www.mcmod.cn/class/${id}.html`;

const T = { connect: 15000, request: 20000, nav: 25000, content: 20000, eval: 20000 };

function parseArgs(argv) {
  const a = { list: DEFAULT_LIST, index: 1, count: 0, mod: null, modpack: null, batch: 25, concurrency: 6, noExport: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const next = () => argv[++i];
    if (k === '--list') a.list = next();
    else if (k === '--index') a.index = +next();
    else if (k === '--count') a.count = +next();
    else if (k === '--mod') a.mod = next();
    else if (k === '--modpack') a.modpack = next();
    else if (k === '--batch') a.batch = +next();
    else if (k === '--concurrency') a.concurrency = +next();
    else if (k === '--db') a.db = next();
    else if (k === '--no-export') a.noExport = true;
    else if (k === '-h' || k === '--help') { console.log(HEADER); process.exit(0); }
    else { console.error(`unknown argument: ${k}`); process.exit(2); }
  }
  return a;
}
const HEADER = `scripts/mcmod/scrape.mjs — see the header of this file for usage.`;

const log = (...x) => console.error('[mcmod]', ...x);

/** Fetch through the browser context (shares cookies), with a timeout and retries. */
async function fetchText(ctx, url, { attempts = 3 } = {}) {
  let last = '';
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await ctx.request.get(url, { timeout: T.request, headers: { 'user-agent': UA } });
      if (r.ok()) return await r.text();
      last = `HTTP ${r.status()}`;
    } catch (e) { last = String(e.message || e).split('\n')[0]; }
  }
  throw new Error(`GET ${url} failed after ${attempts} attempts — ${last}`);
}

const idsOf = (html) => html.split('<div class="modlist-block"').slice(1)
  .map((b) => { const m = b.match(/\/class\/(\d+)\.html/); return m ? m[1] : null; })
  .filter(Boolean);

/** The page-side extractor. Returns null until the mod page is actually rendered. */
function extract(id) {
  const c = (s) => (s || '').replace(/\s+/g, ' ').trim();
  if (!document.querySelector('.class-title')) return null;
  const t = document.querySelector('.class-title') || {};
  const o = {
    id, url: `https://www.mcmod.cn/class/${id}.html`,
    name: c((t.querySelector('h3') || {}).textContent), enName: c((t.querySelector('h4') || {}).textContent),
    shortName: c((t.querySelector('.short-name') || {}).textContent), status: c((t.querySelector('.class-status') || {}).textContent),
    stats: { 推荐: null, 收藏: null, 关注: null, 总浏览: null, 总浏览显示: null }, info: {}, index: {},
  };
  for (const li of document.querySelectorAll('.common-fuc-group li')) {
    const l = c((li.querySelector('.action span') || {}).textContent), n = li.querySelector('.nums');
    if (l && n) o.stats[l] = +n.getAttribute('title');
  }
  for (const s of document.querySelectorAll('.infos .span[title]')) {
    const l = c((s.querySelector('.t') || {}).textContent);
    if (l === '总浏览') { o.stats['总浏览'] = +s.getAttribute('title'); o.stats['总浏览显示'] = c((s.querySelector('.n') || {}).textContent); }
    else if (l === '资料填充率') o.index['资料填充率'] = c((s.querySelector('.n') || {}).textContent);
  }
  for (const li of document.querySelectorAll('.class-info-left > ul > li.col-lg-4')) {
    const x = c(li.textContent).match(/^([^:：]+)[:：]\s*(.*)$/);
    if (!x) continue;
    const ex = li.getAttribute('data-original-title');
    o.info[c(x[1])] = ex ? { 显示: x[2], 精确: ex } : x[2];
  }
  const tag = document.querySelector('.class-info-left li.tag');
  if (tag) o.info['模组标签'] = [...tag.querySelectorAll('ul li a')].map((a) => c(a.textContent));
  const au = document.querySelector('.class-info-left li.author');
  if (au) {
    o.info['作者团队'] = [...au.querySelectorAll('.frame ul li')].map((li) => {
      const n = c((li.querySelector('.member .name') || {}).textContent), p = li.querySelector('.member .position');
      return n ? { name: n, role: p ? c(p.textContent) : null } : null;
    }).filter(Boolean);
    const cnt = c(au.textContent).match(/\((\d+)\)/);
    if (cnt) o.info['作者团队数'] = +cnt[1];
  }
  const mc = document.querySelector('.class-info-left li.mcver .platform-block');
  if (mc) {
    const f = {}; let fam = null;
    for (const el of mc.children) {
      if (el.classList.contains('mcver-title')) { fam = c(c(el.textContent).replace(/\(共.*$/, '').replace(/[:：]\s*$/, '')); f[fam] = []; }
      else if (fam && el.classList.contains('mcver-row'))
        for (const a of el.querySelectorAll('a.dropdown-item, a.text-danger')) { const v = c(a.textContent); if (v && !f[fam].includes(v)) f[fam].push(v); }
    }
    o.info['支持的MC版本'] = f;
  }
  const mp = document.querySelector('.class-info-left li.modpack');
  if (mp) { const n = c(mp.textContent).match(/(\d+)\s*个已收录的整合包/); o.info['整合包使用数'] = n ? +n[1] : null; }
  const st = document.querySelector('.class-excount');
  if (st) {
    o.index['评分'] = c((st.querySelector('.star .up') || {}).textContent) || null;
    for (const d of st.querySelectorAll('.text')) {
      const s = c(d.textContent);
      if (/昨日平均指数/.test(s)) o.index['昨日平均指数'] = (s.match(/([\d.]+)\s*$/) || [])[1] || null;
      else if (/昨日指数/.test(s)) o.index['昨日指数'] = +(s.match(/(\d+)/) || [])[1] || null;
    }
  }
  const lic = document.querySelector('.class-license-list li.license');
  if (lic) o.info['协议'] = c(lic.textContent).replace(/^声明为[:：]\s*/, '');
  return o;
}

/** Parse the mod list out of a modpack page (server-rendered). */
function parsePack(html, url) {
  const id = (url.match(/\/modpack\/(\d+)/) || [])[1] || '';
  const title = (html.match(/<title>([^<]*)/) || [])[1] || '';
  const mods = [];
  const seen = new Set();
  const re = /<a[^>]*data-original-title="([^"]*)"[^>]*href="\/class\/(\d+)\.html"[^>]*>.*?<\/a>\s*<\/p>\s*<p>([^<]*)<\/p>/gs;
  for (const m of html.matchAll(re)) {
    const [, titleAttr, cid, ver] = m;
    if (seen.has(cid)) continue;
    seen.add(cid);
    const en = titleAttr.match(/\(([^()]*)\)\s*$/);
    mods.push({ id: cid, name: titleAttr.replace(/\s*\([^()]*\)\s*$/, '').trim(), enName: en ? en[1] : '', version: ver.trim() });
  }
  return { pack: { id, name: title.replace(/\s*-\s*MC百科.*$/, '').trim(), url, modCount: mods.length }, mods };
}

async function runPool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const db = openDb(a.db ? resolve(a.db) : undefined);
  const stamp = nowStamp();

  let browser;
  let runId = null;
  try {
    log(`connecting to the container browser at ${CDP}`);
    browser = await chromium.connectOverCDP(CDP, { timeout: T.connect });
    const ctx = browser.contexts()[0];
    if (!ctx) throw new Error('the browser has no context — is it the container Chromium?');

    // Resolve the targets first (cheap) so the run row can carry an accurate total.
    let ids = [];
    let packInfo = null;
    let kind, target;
    if (a.modpack) {
      const url = /^https?:/.test(a.modpack) ? a.modpack : `https://www.mcmod.cn/modpack/${a.modpack}.html`;
      const html = await fetchText(ctx, url.endsWith('.html') ? url : `${url}.html`);
      packInfo = parsePack(html, url.endsWith('.html') ? url : `${url}.html`);
      ids = packInfo.mods.map((m) => m.id);
      kind = 'modpack'; target = `modpack/${packInfo.pack.id}`;
      log(`modpack "${packInfo.pack.name}" has ${ids.length} mods`);
    } else if (a.mod) {
      const id = String(a.mod).replace(/.*\/class\/(\d+).*/, '$1');
      if (!/^\d+$/.test(id)) throw new Error('--mod expects a class id or a /class/<id>.html URL');
      ids = [id]; kind = 'mod'; target = `class/${id}`;
    } else {
      const want = a.count > 0 ? a.count : a.index;
      ids = [];
      for (let p = 1; ids.length < want && p <= 40; p++) {
        const sep = a.list.includes('?') ? '&' : '?';
        const html = await fetchText(ctx, p === 1 ? a.list : `${a.list}${sep}page=${p}`);
        const got = idsOf(html);
        if (!got.length) break;
        for (const id of got) if (ids.length < want) ids.push(id);
      }
      if (ids.length < want) throw new Error(`the list yielded only ${ids.length} of ${want} ids`);
      if (a.count > 0) { kind = 'list'; target = a.list; }
      else { ids = [ids[a.index - 1]]; kind = 'mod'; target = `class/${ids[0]}`; }
      log(`resolved ${ids.length} ids from the list`);
    }
    if (ids.length === 0) throw new Error('no mods to scrape');

    const page = await ctx.newPage();               // a visible, dedicated tab
    const bulk = ids.length > 1;
    if (bulk) await page.route('**/*', (r) => r.abort());   // everything we read is in the HTML string

    runId = startRun(db, kind, target, ids.length);
    log(`run #${runId} (${kind}) started — ${ids.length} mods`);

    const single = (a.mod || (a.count === 0 && !a.modpack)) && ids.length === 1;
    let done = 0, blank = 0;
    const warnOnce = { anon: false };

    for (let b = 0; b < ids.length; b += a.batch) {
      const slice = ids.slice(b, b + a.batch);
      const records = [];
      if (single) {
        await page.goto(CLASS(slice[0]), { waitUntil: 'domcontentloaded', timeout: T.nav });
        records.push(await page.evaluate(extract, slice[0]));
      } else {
        const htmls = await runPool(slice, a.concurrency, (id) => fetchText(ctx, CLASS(id)));
        for (let k = 0; k < slice.length; k++) {
          await page.setContent(htmls[k], { waitUntil: 'domcontentloaded', timeout: T.content });
          records.push(await page.evaluate(extract, slice[k]));
        }
      }
      for (const rec of records) {
        done++;
        if (!rec || !rec.name) { blank++; log(`[${done}/${ids.length}] ${rec?.id ?? '?'} — EMPTY (skipped)`); continue; }
        saveMod(db, rec, stamp);
        if (!warnOnce.anon && rec.stats['推荐'] == null && rec.stats['收藏'] == null) {
          warnOnce.anon = true;
          log('WARNING: 推荐/收藏/关注 are null — the browser session is not signed in to mcmod.cn');
        }
        progressRun(db, runId, done, ids.length, rec.name);
        log(`[${done}/${ids.length}] ${rec.id} ${rec.name}`);
      }
      if (!single) log(`--- batch ${Math.min(b + a.batch, ids.length)}/${ids.length} saved ---`);
    }

    if (packInfo) savePack(db, packInfo.pack, packInfo.mods, stamp);
    await page.close().catch(() => {});

    finishRun(db, runId, 'done', blank ? `${blank} empty pages` : null);
    if (!a.noExport) {
      // keep the reviewable JSON snapshot (roughly 6x smaller than the DB once git compresses it)
      const dbFile = a.db ? resolve(a.db) : (process.env.MCMOD_DB || resolve('data/mcmod.db'));
      const snap = dbFile.replace(/\.db$/, '.json');
      try { const e = exportJson(db, snap); log(`snapshot -> ${snap} (${e.mods} mods, ${e.bytes} bytes)`); }
      catch (err) { log(`WARNING: could not write the JSON snapshot: ${err.message}`); }
    }
    log(`DONE: ${done} mods, ${blank} empty -> ${a.db || 'data/mcmod.db'}`);
    console.log(JSON.stringify({ ok: true, runId, kind, target, total: ids.length, saved: done - blank, empty: blank }, null, 1));
  } catch (e) {
    if (runId) finishRun(db, runId, 'failed', String(e.message || e).slice(0, 500));
    log(`FAILED: ${e.message}`);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
    db.close();
  }
}

main();
