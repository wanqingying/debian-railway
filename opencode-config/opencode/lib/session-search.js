/**
 * lib/session-search.js — cross-session recall over the opencode session store.
 *
 * Answers "which session dealt with X?" — the one question no OpenCode or OpenChamber API can
 * answer. Their tool surface can read a session once you know its id, and `session.list` can only
 * order sessions by directory and time; there is no action that searches by content, and walking
 * 180+ sessions through HTTP to find one is not a plan.
 *
 * Reads `opencode.db` directly, read-only. The path resolves exactly as `entrypoint.sh:103` does
 * (`$XDG_DATA_HOME/opencode/opencode.db`, else `~/.local/share/...`), so one copy serves every
 * container: Railway sets `XDG_DATA_HOME=/workspace/.opencode/data`, a devcontainer leaves it unset.
 *
 * Performance rule — SQL `LIKE` prefilters the raw JSON and only matching rows are parsed. Parsing
 * all ~9k messages takes 2.2 s; the prefiltered path 55–180 ms. Do not "simplify" this back into a
 * full parse. The keyword is JSON-escaped before it becomes a LIKE pattern, because the stored row
 * is JSON: without that step a query like `"foo"` or `a\b` matched nothing and the tool answered
 * "no such session".
 *
 * Coverage: user text and assistant `text` parts. Tool output is deliberately excluded — it is
 * ~19x the text volume and the densest place for secrets, so searching it is the one change that
 * would make redaction worth its cost; revisit that decision if it is ever enabled.
 *
 * Output is NOT redacted, decided 2026-10-28 after measuring. It protected nothing here: the corpus
 * held no real credentials (0 of 6,909 messages matched a provider-token, JWT, url-credential or
 * private-key pattern), `session.messages` hands out the same text unredacted so the rule was never
 * a boundary, and both providers are internal gateways (ada-cli-golang.ctripcorp.com,
 * aigw.fx.ctripcorp.com) rather than a third-party API. What it did do was mask config values in
 * snippets with `***` — the exact text a "how is GITHUB_TOKEN set" search exists to read. Snippets
 * stay short (~120 chars) for legibility, not for safety.
 *
 * Also runs as a CLI: `node lib/session-search.js <keyword> [--json] [--limit N] ...`.
 */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const SNIPPET_PAD = 60;
const BUSY_TIMEOUT_MS = 2_000;
const DEFAULT_BUDGET_MS = 2_000;
const DEADLINE_CHECK_EVERY = 512;

export function resolveDbPath() {
  const dataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local/share');
  return path.join(dataHome, 'opencode', 'opencode.db');
}

// The budget guards the parse loop, never the answer: a slow scan that has already produced hits is
// still worth returning, and discarding it (the first version did) turned a usable 83-hit search
// into "nothing" purely because the page cache was cold. The LIKE scan runs inside one synchronous
// SQLite call and cannot be interrupted anyway, so the only thing a deadline can usefully cut is the
// JSON parsing that follows.

// A short window around the first match: enough to recognise the session, small enough not to flood
// a context window.
function buildSnippet(text, needle, firstOffset) {
  const lower = text.toLowerCase();
  const at = lower.indexOf(needle);
  const pos = at >= 0 ? at : Math.min(firstOffset, text.length);
  const start = Math.max(0, pos - SNIPPET_PAD);
  const end = Math.min(text.length, pos + needle.length + SNIPPET_PAD);
  return text.slice(start, end).replace(/\s+/g, ' ').trim();
}

/**
 * @param {object} options
 * @param {string} options.query            keyword (case-insensitive for ASCII; CJK as written)
 * @param {'title'|'content'|'both'} [options.match]  default 'content'
 * @param {string} [options.directory]      substring filter on the session directory
 * @param {number} [options.days]           only sessions updated in the last N days (must be > 0)
 * @param {number} [options.limit]          hits returned, default 20, clamped to 100
 * @param {number} [options.budgetMs]       wall-clock budget, default 2000 (tests shrink it)
 * @param {boolean} [options.includeArchived]
 * @param {boolean} [options.includeChildren]
 * @param {boolean} [options.includeTmp]    include sessions under /tmp
 * @param {string} [options.dbPath]         override the resolved path (tests)
 */
export async function searchSessions(options = {}) {
  const query = String(options.query ?? '').trim();
  if (!query) return { status: 'error', message: 'query is required' };

  const match = options.match || 'content';
  if (!['title', 'content', 'both'].includes(match)) {
    return { status: 'error', message: "match must be 'title', 'content' or 'both'" };
  }

  if (options.days !== undefined && options.days !== null) {
    const days = Number(options.days);
    // A negative window silently matched nothing, which reads exactly like "no such session".
    if (!Number.isFinite(days) || days <= 0) return { status: 'error', message: 'days must be a positive number' };
  }

  const nodeMajor = Number(process.versions.node.split('.')[0]);
  if (!(nodeMajor >= 22)) {
    return { status: 'unsupported-node', message: `需要 Node >= 22（node:sqlite），当前 ${process.versions.node}` };
  }
  const { DatabaseSync } = await import('node:sqlite');

  const dbPath = options.dbPath || resolveDbPath();
  if (!existsSync(dbPath)) {
    return {
      status: 'no-db',
      message: `找不到会话库: ${dbPath}（XDG_DATA_HOME=${process.env.XDG_DATA_HOME || '(未设)'}）`,
    };
  }

  const limit = Math.min(Math.max(Number(options.limit ?? DEFAULT_LIMIT) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const budgetMs = Number.isFinite(Number(options.budgetMs)) ? Number(options.budgetMs) : DEFAULT_BUDGET_MS;
  const t0 = Date.now();
  const db = new DatabaseSync(dbPath, { readOnly: true });
  db.exec(`pragma busy_timeout = ${BUSY_TIMEOUT_MS}`);

  try {
    // One filter clause, used by both queries so the two can never disagree.
    const where = [];
    const params = [];
    if (!options.includeArchived) where.push('s.time_archived is null');
    if (!options.includeChildren) where.push('s.parent_id is null');
    if (!options.includeTmp) where.push("s.directory not like '/tmp%'");
    if (options.directory) { where.push('s.directory like ?'); params.push(`%${options.directory}%`); }
    if (options.days) { where.push('s.time_updated >= ?'); params.push(Date.now() - Number(options.days) * 86_400_000); }
    const whereSql = where.length ? `where ${where.join(' and ')}` : '';

    const sessions = db
      .prepare(`select s.id, s.title, s.directory, s.time_updated from session_v2 s ${whereSql}`)
      .all(...params);
    const byId = new Map(sessions.map((s) => [s.id, s]));

    const needle = query.toLowerCase();
    // The full text is kept for the first hit in each session so the snippet can be cut from it
    // after sorting — but only for sessions that hit, never for every row scanned.
    const hits = new Map(); // session id -> { matches, text, first, titleMatch }
    let rowsRead = 0;
    let truncated = false;

    if (match === 'title' || match === 'both') {
      for (const s of sessions) {
        if ((s.title || '').toLowerCase().includes(needle)) {
          hits.set(s.id, { matches: 0, text: '', first: 0, titleMatch: true });
        }
      }
    }

    if (match === 'content' || match === 'both') {
      // The stored row is JSON, so `"` and `\` appear escaped there. Escape the keyword the same way
      // before building the LIKE pattern: a raw pattern for `"浅合并"` would match nothing and the
      // tool would answer "no such session" instead of scanning. JSON.stringify also leaves CJK
      // alone, which is why CJK queries need no special case.
      const jsonEscaped = JSON.stringify(query).slice(1, -1);
      const escaped = jsonEscaped.replace(/[\\%_]/g, (c) => `\\${c}`);
      const selectRows = `select m.session_id, m.type, m.data from session_message m
             join session_v2 s on s.id = m.session_id ${whereSql}`;
      const rows = db
        .prepare(`${selectRows}${whereSql ? ' and' : ' where'} m.data like ? escape '\\'`)
        .all(...params, `%${escaped}%`);
      rowsRead = rows.length;

      let sinceCheck = 0;
      for (const row of rows) {
        if (++sinceCheck >= DEADLINE_CHECK_EVERY && Date.now() - t0 > budgetMs) {
          truncated = true;
          break;
        }

        let text = '';
        try {
          const data = JSON.parse(row.data);
          if (row.type === 'user') text = data.text || '';
          else if (row.type === 'assistant') {
            text = (data.content || [])
              .filter((part) => part.type === 'text')
              .map((part) => part.text || '')
              .join('\n');
          } else continue;
        } catch {
          continue;
        }

        const lower = text.toLowerCase();
        let from = 0;
        let count = 0;
        let first = -1;
        while ((from = lower.indexOf(needle, from)) !== -1) {
          if (first < 0) first = from;
          count++;
          from += needle.length;
        }
        if (count === 0) continue;

        const existing = hits.get(row.session_id);
        if (existing) {
          existing.matches += count;
          if (!existing.text) { existing.text = text; existing.first = first; }
        } else {
          hits.set(row.session_id, { matches: count, text, first, titleMatch: false });
        }
      }
    }

    const results = [];
    for (const [id, hit] of hits) {
      const session = byId.get(id);
      if (!session) continue;
      results.push({
        session: id,
        title: session.title || '',
        directory: session.directory,
        project: path.basename(session.directory),
        at: new Date(session.time_updated).toISOString().slice(0, 16).replace('T', ' '),
        matches: hit.matches,
        title_match: hit.titleMatch,
        snippet: hit.text ? buildSnippet(hit.text, needle, hit.first) : '',
      });
    }
    // Heaviest coverage first: a session that mentions the term 30 times is a better lead than one
    // that mentions it once, regardless of age.
    results.sort((a, b) => b.matches - a.matches || (a.at < b.at ? 1 : -1));

    return {
      status: 'ok',
      query,
      match,
      candidates: sessions.length,
      rows_read: rowsRead,
      total: results.length,
      // True when the parse loop hit the budget and stopped early: the answer is real but built from
      // only part of the matching rows, which is worth saying rather than reporting as complete.
      truncated,
      elapsed_ms: Date.now() - t0,
      hits: results.slice(0, limit),
    };
  } finally {
    db.close();
  }
}

// ---- CLI ---------------------------------------------------------------------------------------
// Same code path as the tool, so a failure here is a failure there. `node:sqlite` is imported
// dynamically above because it does not exist below Node 22.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const VALUE_OPTS = new Set(['--match', '--dir', '--days', '--limit']);
  const FLAG_OPTS = new Set(['--include-archived', '--include-children', '--include-tmp', '--json']);
  const opts = {};
  const positional = [];
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (VALUE_OPTS.has(arg)) opts[arg.slice(2)] = argv[++i];
    else if (FLAG_OPTS.has(arg)) opts[arg.slice(2)] = true;
    else if (arg.startsWith('--')) { console.error(`unknown option: ${arg}`); process.exit(1); }
    else positional.push(arg);
  }

  const result = await searchSessions({
    query: positional.join(' '),
    match: opts.match,
    directory: opts.dir,
    days: opts.days,
    limit: opts.limit,
    includeArchived: Boolean(opts['include-archived']),
    includeChildren: Boolean(opts['include-children']),
    includeTmp: Boolean(opts['include-tmp']),
  });

  if (result.status === 'error') { console.error(result.message); process.exit(1); }
  if (result.status === 'unsupported-node' || result.status === 'no-db') { console.error(result.message); process.exit(3); }
  if (result.truncated) console.error(`注意：解析在 ${result.elapsed_ms}ms 处达预算上限，结果只覆盖了部分命中行（${result.rows_read} 行已扫）`);

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`${result.total} 个会话命中 · ${result.candidates} 个候选 · 解析 ${result.rows_read} 行 · ${result.elapsed_ms} ms\n`);
    for (const hit of result.hits) {
      // A title-only hit has zero body occurrences; printing `0×` there reads as "no match".
      const label = hit.matches > 0 ? `${hit.matches}×` : 'T';
      console.log(`${hit.at}  ${label.padStart(4)}  ${hit.project.padEnd(22)} ${hit.title}`);
      if (hit.snippet) console.log(`                     …${hit.snippet}…`);
      console.log(`                     ${hit.session}`);
    }
  }
}
