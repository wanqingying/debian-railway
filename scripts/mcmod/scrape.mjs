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
 *   scripts/mcmod/scrape.mjs --pack-list --count 300      # 300 modpacks' metadata+members (no mod stats)
 *   options: --list <modlist url> --batch N --concurrency N --db <file> --no-export
 *
 * Progress: one line per mod on stderr, plus a `runs` row in the DB that a second process can poll
 * (see docs/mcmod-db.md). Exits non-zero on failure.
 */
import { chromium } from 'playwright-core';
import { resolve } from 'node:path';
import { openDb, saveMod, savePack, startRun, progressRun, finishRun, interruptStaleRuns, nowStamp } from './db.mjs';
import { exportJson } from './export.mjs';

const CDP = process.env.CDP || 'http://127.0.0.1:9222';
const UA = process.env.UA || 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154 Safari/537.36';
const DEFAULT_LIST = 'https://www.mcmod.cn/modlist.html?mcver=1.18.2&platform=1';
const CLASS = (id) => `https://www.mcmod.cn/class/${id}.html`;
const MODPACK_LIST = 'https://www.mcmod.cn/modpack.html';
const PACK_URL = (id) => `https://www.mcmod.cn/modpack/${id}.html`;

const T = { connect: 15000, request: 20000, nav: 25000, content: 20000, eval: 20000 };

function parseArgs(argv) {
  const a = { list: DEFAULT_LIST, index: 1, count: 0, mod: null, modpack: null, batch: 25, concurrency: 6, noExport: false, packOnly: false, packList: null };
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
    else if (k === '--pack-only') a.packOnly = true;   // refresh just the modpack's own row + description
    else if (k === '--pack-list') a.packList = (argv[i + 1] && !argv[i + 1].startsWith('--')) ? next() : MODPACK_LIST;
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

/** Modpack ids on a /modpack.html page — same `<div class="modlist-block">` list markup as mods. */
const packIdsOf = (html) => html.split('<div class="modlist-block"').slice(1)
  .map((b) => { const m = b.match(/\/modpack\/(\d+)\.html/); return m ? m[1] : null; })
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

/** Parse a modpack page (server-rendered): its own metadata + description, and its mod list. */
export function parsePack(html, url) {
  const plain = (s) => String(s || '').replace(/&nbsp;/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const pick = (re) => (html.match(re) || [])[1];
  const nn = (v) => (v === undefined || v === '' ? null : v);
  const exact = (v) => (v && typeof v === 'object' ? v['精确'] : null);
  const shown = (v) => (v && typeof v === 'object' ? v['显示'] : v);

  const id = (url.match(/\/modpack\/(\d+)/) || [])[1] || '';
  const titleTag = (html.match(/<title>([^<]*)/) || [])[1] || '';
  const head = pick(/<div class="class-title">([\s\S]{0,300}?)<\/div>/);
  // `.match()` returns [full, group]; take group 1 explicitly (String() on the array would join them)
  const g1 = (re, src = html) => ((src || '').match(re) || [])[1];
  const name = plain(g1(/<h3>([^<]*)</, head)) || plain(titleTag.replace(/\s*-\s*MC百科.*$/, ''));
  const name_en = nn(plain(g1(/<h4>([^<]*)</, head)));
  const short_name = nn(plain(g1(/class="short-name"[^>]*>([^<]*)</, head)));

  // label/value rows — same shape as a mod page (exact timestamps live in data-original-title)
  const info = {};
  for (const m of html.matchAll(/<li class="col-lg-4"([^>]*)>([\s\S]*?)<\/li>/g)) {
    const kv = plain(m[2]).match(/^([^:：]+)[:：]\s*(.*)$/);
    if (!kv) continue;
    const ex = (m[1].match(/data-original-title="([^"]*)"/) || [])[1];
    info[kv[1].trim()] = ex ? { 显示: kv[2].trim(), 精确: ex } : kv[2].trim();
  }

  const tags = [];
  const tagBlock = html.match(/<li class="col-lg-12 tag">([\s\S]*?)<\/ul>/);
  if (tagBlock) for (const a of tagBlock[1].matchAll(/<a[^>]*>([\s\S]*?)<\/a>/g)) tags.push(plain(a[1]));

  const votes = [...html.matchAll(/data-original-title="(\d+)票"/g)].map((m) => +m[1]);
  const infosBlock = html.match(/<div class="infos">([\s\S]*?)<\/div>\s*<\/div>/);
  const views = infosBlock ? (infosBlock[1].match(/title="(\d+)"/) || [])[1] : null;
  const views_display = infosBlock ? plain((infosBlock[1].match(/<p class="n">([^<]*)</) || [])[1]) : null;

  // 推荐/收藏 — the same login-gated action bar a mod page carries (a modpack has no 关注, only 分享).
  // Anonymous sessions omit the whole block, so these come back null without a signed-in browser.
  const acts = {};
  const fuc = html.match(/<div class="col-lg-12 common-fuc-group"[\s\S]*?<\/ul>/);
  if (fuc) for (const m of fuc[0].matchAll(/<span>\s*([^<]+?)\s*<\/span><\/div>\s*<div[^>]*title="(\d+)"[^>]*class="nums"/g))
    acts[m[1]] = +m[2];

  // 指数/评分 — the same `.class-excount` block a mod page has (0–5 score + a descriptive grade)
  const ex = html.match(/<div class="class-excount">([\s\S]{0,1400}?)<\/div><\/div>/);
  const rating = ex ? (ex[1].match(/<p class="up">([^<]*)</) || [])[1] || null : null;
  const rating_label = ex ? plain((ex[1].match(/<p class="down">([^<]*)</) || [])[1]) || null : null;
  let yesterday_idx = null, avg_idx = null;
  // no trailing `<` in the pattern: the block ends mid-element, so the last div has no closing tag
  if (ex) for (const d of ex[1].matchAll(/<div class="text"[^>]*>([^<]*)/g)) {
    const t = plain(d[1]);
    if (/昨日平均指数/.test(t)) avg_idx = (t.match(/([\d.]+)\s*$/) || [])[1] ?? null;
    else if (/昨日指数/.test(t)) yesterday_idx = (t.match(/(\d+)/) || [])[1] ?? null;
  }

  // 制作团队 — `<span class="member">` with the person's name and every role they played
  const authors = [];
  // up to `</ul>`: the block's own `<li>`s would end a non-greedy `</li>` match after the first member
  const au = html.match(/<li class="col-lg-12 author">([\s\S]*?)<\/ul>/);
  if (au) for (const m of au[1].matchAll(/class="name"[^>]*>([\s\S]*?)<\/span>[\s\S]*?class="position"[^>]*>([\s\S]*?)<\/span>/g))
    authors.push({ name: plain(m[1]), role: plain(m[2]) || null });

  // 支持的MC版本 — same `platform-block` shape as a mod page (loader family → versions)
  const versions = {};
  const mc = html.match(/<li class="col-lg-12 mcver[^"]*">([\s\S]*?)<\/li>/);
  if (mc) {
    let fam = null;
    for (const el of mc[1].matchAll(/<div class="mcver-title">([\s\S]*?)<\/div>|<div class="mcver-row">([\s\S]*?)<\/div>/g)) {
      if (el[1] != null) { fam = plain(el[1]).replace(/\(共.*$/, '').replace(/[:：]\s*$/, '').trim(); versions[fam] = []; }
      else if (fam) for (const a of el[2].matchAll(/<a[^>]*>([^<]+)<\/a>/g)) {
        const v = plain(a[1]); if (v && !versions[fam].includes(v)) versions[fam].push(v);
      }
    }
  }

  // every tab/section of the page (前言 / 模组列表 / 教程 …) — the first titled one is the description
  const texts = [];
  const parts = html.split(/<li data-id="(\d+)" class="text-area[^"]*"[^>]*>/);
  for (let i = 1; i < parts.length; i += 2) {
    const raw = parts[i + 1] || '';
    const t = raw.match(/common-text-title[^"]*">([^<]*)</);
    const title = t ? plain(t[1]) : null;
    let text = plain(raw);
    // `plain()` keeps the section's own heading at the front; it is already in `title`, so drop it.
    if (title && text.startsWith(title)) text = text.slice(title.length).trim();
    texts.push({ section: parts[i], title, text, raw });
  }
  // The page's first tab is the description (前言). It is not always wrapped in a `common-text-title` —
  // packs that never set one have bare prose — so take the first section that is not the mod list.
  const description = (texts.find((s) => !/class-relation-list/.test(s.raw)) || {}).text || null;

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

  return {
    pack: {
      id, name, name_en, short_name, url, modCount: mods.length,
      pack_type: nn(shown(info['整合包类型'])), run_mode: nn(shown(info['运作方式'])),
      pack_method: nn(shown(info['打包方式'])), published_at: exact(info['收录时间']),
      last_edit_at: exact(info['最后编辑']), last_rec_at: exact(info['最后推荐']),
      edit_count: info['编辑次数'] ? parseInt(String(shown(info['编辑次数'])).replace(/[^0-9]/g, ''), 10) : null,
      votes_for: votes[0] ?? null, votes_against: votes[1] ?? null,
      views: views ? +views : null, views_display,
      recommend: acts['推荐'] ?? null, favorite: acts['收藏'] ?? null,
      rating, rating_label, yesterday_idx, avg_idx,
      authors, versions,
      description, tags, texts,
    },
    mods,
  };
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
  const stale = interruptStaleRuns(db);          // a killed run would otherwise read as live forever
  if (stale) log(`marked ${stale} stale run(s) interrupted`);
  const stamp = nowStamp();

  // keep the reviewable JSON snapshot (roughly 4x smaller than the DB once git compresses it)
  const writeSnapshot = () => {
    if (a.noExport) return;
    const dbFile = a.db ? resolve(a.db) : (process.env.MCMOD_DB || resolve('data/mcmod.db'));
    const snap = dbFile.replace(/\.db$/, '.json');
    try { const e = exportJson(db, snap); log(`snapshot -> ${snap} (${e.mods} mods, ${e.bytes} bytes)`); }
    catch (err) { log(`WARNING: could not write the JSON snapshot: ${err.message}`); }
  };

  let browser;
  let runId = null;
  try {
    log(`connecting to the container browser at ${CDP}`);
    browser = await chromium.connectOverCDP(CDP, { timeout: T.connect });
    const ctx = browser.contexts()[0];
    if (!ctx) throw new Error('the browser has no context — is it the container Chromium?');

    // --pack-list: many modpacks, metadata only. The pack page is server-rendered and parsePack is a
    // pure string parser, so this needs no page at all — just the request client, at high concurrency.
    // Members are recorded as ids+versions in modpack_mods and their own stats are left for a later run.
    if (a.packList) {
      const want = a.count > 0 ? a.count : 300;
      const pids = [], seenPack = new Set();
      for (let p = 1; pids.length < want && p <= 60; p++) {
        const sep = a.packList.includes('?') ? '&' : '?';
        const html = await fetchText(ctx, p === 1 ? a.packList : `${a.packList}${sep}page=${p}`);
        const got = packIdsOf(html);
        if (!got.length) break;
        for (const id of got) if (pids.length < want && !seenPack.has(id)) { seenPack.add(id); pids.push(id); }
      }
      if (pids.length < want) throw new Error(`the modpack list yielded only ${pids.length} of ${want} ids`);
      runId = startRun(db, 'packlist', a.packList, pids.length);
      log(`run #${runId} (packlist) started — ${pids.length} modpacks`);
      let done = 0, failed = 0;
      await runPool(pids, a.concurrency, async (pid) => {
        try {
          const html = await fetchText(ctx, PACK_URL(pid));
          const info = parsePack(html, PACK_URL(pid));
          savePack(db, info.pack, info.mods, stamp);
          done++;
          progressRun(db, runId, done, pids.length, info.pack.name);
          log(`[${done}/${pids.length}] ${pid} ${info.pack.name} (${info.mods.length} mods)`);
        } catch (e) { failed++; log(`  ${pid} FAILED: ${String(e.message || e).split('\n')[0]}`); }
      });
      finishRun(db, runId, failed ? 'partial' : 'done', failed ? `${failed} failed` : null);
      writeSnapshot();
      log(`DONE: ${done} modpacks (${failed} failed) -> ${a.db || 'data/mcmod.db'}`);
      console.log(JSON.stringify({ ok: true, runId, kind: 'packlist', target: a.packList,
        total: pids.length, saved: done, failed }, null, 1));
      return;
    }

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
      if (a.packOnly) {
        // The member mods are already in the DB; only this pack's own row/description is refreshed.
        const rid = startRun(db, 'pack', target, ids.length);
        savePack(db, packInfo.pack, packInfo.mods, stamp);
        finishRun(db, rid, 'done', 'metadata only');
        writeSnapshot();
        log(`pack ${packInfo.pack.id} saved (metadata only) — ${packInfo.pack.name}`);
        console.log(JSON.stringify({ ok: true, packOnly: true, packId: packInfo.pack.id,
          name: packInfo.pack.name, mods: ids.length, description: (packInfo.pack.description || '').length }, null, 1));
        return;
      }
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
    writeSnapshot();
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

// Run only when invoked directly, so the parser can be imported and tested.
if (import.meta.url === `file://${process.argv[1]}`) main();
