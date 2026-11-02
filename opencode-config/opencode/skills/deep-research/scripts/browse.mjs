#!/usr/bin/env node
// Read a page through the container's single visible Chromium over CDP.
//
// Why this exists: a plain fetch returns an empty shell for JavaScript-rendered
// docs, and cannot see anything behind a sign-in the user completed by hand in
// the VNC browser. This attaches to that same browser, opens a NEW tab (never
// navigates the one a person is looking at), reads the main content, and closes
// it again.
//
// Usage:
//   node browse.mjs --check                      # is the browser reachable?
//   node browse.mjs <url> [--max 8000] [--json]
//                        [--wait domcontentloaded|networkidle|load]
//                        [--shot] [--full] [--auth] [--timeout 30000]
//   node browse.mjs --file urls.txt [--max 8000]  # one URL per line, reads in series
//
// Output (--json): { url, finalUrl, title, status, access, chars, truncated, text, screenshot }
// access: "render" by default, "authenticated" with --auth (pass it whenever the
// page only loads because the browser holds a session — the report has to admit
// which claims a reader cannot re-check).

const CDP = process.env.PW_CDP || 'http://127.0.0.1:9222';
const PW_CANDIDATES = [
  'playwright',
  '/usr/lib/node_modules/playwright/index.mjs',
  '/usr/local/lib/node_modules/playwright/index.mjs',
];

const argv = process.argv.slice(2);
const flags = {};
const positional = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith('--')) {
    positional.push(a);
    continue;
  }
  const [k, inline] = a.slice(2).split('=');
  if (inline !== undefined) flags[k] = inline;
  else if (argv[i + 1] && !argv[i + 1].startsWith('--') && k !== 'check' && k !== 'shot' && k !== 'full' && k !== 'auth' && k !== 'json') flags[k] = argv[++i];
  else flags[k] = true;
}

const MAX = Number(flags.max || 8000);
const TIMEOUT = Number(flags.timeout || 30000);
const waitUntil = flags.wait || 'domcontentloaded';

async function loadPlaywright() {
  for (const spec of [process.env.PW_PKG, ...PW_CANDIDATES].filter(Boolean)) {
    try {
      const m = await import(spec);
      const pw = m.chromium ? m : m.default;
      if (pw?.chromium) return pw;
    } catch {
      /* try next */
    }
  }
  throw new Error(
    `playwright not resolvable (tried: ${PW_CANDIDATES.filter(Boolean).join(', ')}). Set PW_PKG to its index.mjs.`
  );
}

async function connect() {
  const pw = await loadPlaywright();
  const browser = await pw.chromium.connectOverCDP(CDP, { noDefaults: true, isLocal: true });
  // The default context is the one the user is signed in to; a fresh context
  // would lose every cookie and make lane C impossible.
  const context = browser.contexts()[0];
  if (!context) throw new Error('no browser context on the CDP endpoint');
  return { browser, context };
}

// Runs in the page. Prefers the page's real content container over <body>, so
// navigation, cookie banners and footers do not eat the extraction budget.
const EXTRACT = () => {
  const CANDIDATES = ['article', 'main', '[role=main]', '#content', '.markdown-body', '.prose'];
  const root =
    CANDIDATES.map((s) => document.querySelector(s)).find((el) => el && (el.innerText || '').trim().length > 400) ||
    document.body;
  if (!root) return '';
  const clone = root.cloneNode(true);
  clone.querySelectorAll('script, style, noscript, svg, nav, footer, form, aside').forEach((n) => n.remove());
  return (clone.innerText || '').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
};

async function readOne(context, url) {
  const page = await context.newPage();
  const started = Date.now();
  try {
    let resp = null;
    let navError = null;
    try {
      resp = await page.goto(url, { waitUntil, timeout: TIMEOUT });
    } catch (e) {
      navError = e.message.split('\n')[0];
    }
    // Give late XHR-driven content a chance without paying the full networkidle
    // penalty on pages that never go idle (chat widgets, analytics beacons).
    await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});
    const text = await page.evaluate(EXTRACT).catch(() => '');

    const out = {
      url,
      finalUrl: page.url(),
      title: await page.title().catch(() => ''),
      status: resp ? resp.status() : null,
      access: flags.auth ? 'authenticated' : 'render',
      chars: text.length,
      truncated: text.length > MAX,
      text: text.slice(0, MAX),
      elapsedMs: Date.now() - started,
    };
    if (navError) out.error = navError;
    if (text.length < 200) {
      out.warning =
        'very little text extracted — the content may need a click/scroll, may be behind a login (try the VNC browser, then --auth), or the selector missed';
    }
    if (flags.shot) {
      const name = flags.shot === true ? url.replace(/[^a-z0-9]+/gi, '-').slice(0, 60) : flags.shot;
      const path = `${process.cwd()}/screenshots/${name}-${Date.now()}.png`;
      await import('node:fs').then((fs) => fs.mkdirSync(`${process.cwd()}/screenshots`, { recursive: true }));
      await page.screenshot({ path, fullPage: Boolean(flags.full) });
      out.screenshot = path;
    }
    return out;
  } finally {
    await page.close().catch(() => {});
  }
}

async function main() {
  if (flags.check) {
    const pw = await loadPlaywright();
    const browser = await pw.chromium.connectOverCDP(CDP, { noDefaults: true, isLocal: true });
    const pages = browser.contexts().flatMap((c) => c.pages());
    console.log(
      JSON.stringify(
        { cdp: CDP, browser: browser.version(), contexts: browser.contexts().length, pages: pages.length, playwright: 'ok' },
        null,
        2
      )
    );
    await browser.close().catch(() => {});
    return;
  }

  const urls = flags.file
    ? (await import('node:fs')).readFileSync(flags.file, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean)
    : positional;
  if (!urls.length) {
    console.error('usage: node browse.mjs <url> [...] | --file urls.txt | --check');
    process.exit(1);
  }

  const { browser, context } = await connect();
  const results = [];
  try {
    for (const url of urls) {
      const r = await readOne(context, url);
      results.push(r);
      if (!flags.json) {
        console.log(`\n=== ${r.title || r.url}\n${r.finalUrl}  [${r.status ?? 'no response'}] ${r.access} · ${r.chars} chars · ${r.elapsedMs} ms`);
        if (r.error) console.log(`! navigation: ${r.error}`);
        if (r.warning) console.log(`! ${r.warning}`);
        if (r.screenshot) console.log(`screenshot: ${r.screenshot}`);
        console.log('---');
        console.log(r.text);
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }
  if (flags.json) console.log(JSON.stringify(results.length === 1 ? results[0] : results, null, 2));
}

main().catch((e) => {
  console.error(`browse: ${e.message}`);
  process.exit(1);
});
