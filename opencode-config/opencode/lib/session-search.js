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
 * all ~9k messages takes 2.2 s; the prefiltered path 55–180 ms (cold page cache ~550 ms). Do not
 * "simplify" this back into a full parse.
 *
 * Coverage: user text and assistant `text` parts. Tool output is deliberately excluded — it is
 * ~19x the text volume and the densest place for secrets. Snippets still pass through `redact()`.
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

// Same list the control-plane design mandates for anything returning session text.
const SECRET_PATTERNS = [
  [/\b([A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD))=\S+/g, '$1=***'],
  [/\bsk-[A-Za-z0-9_-]{12,}/g, 'sk-***'],
  [/\b(ghp|gho|ghu|ghs)_[A-Za-z0-9]{20,}/g, '$1_***'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, 'github_pat_***'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/g, 'xox-***'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g, 'eyJ***'],
  [/(https?:\/\/)[^/\s:@]+:[^/\s@]+@/g, '$1***:***@'],
];

export function redact(text) {
  let out = String(text ?? '');
  for (const [pattern, replacement] of SECRET_PATTERNS) out = out.replace(pattern, replacement);
  return out;
}

export function resolveDbPath() {
  const dataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local/share');
  return path.join(dataHome, 'opencode', 'opencode.db');
}

/**
 * @param {object} options
 * @param {string} options.query            keyword (case-insensitive; CJK unaffected)
 * @param {'title'|'content'|'both'} [options.match]  default 'content'
 * @param {string} [options.directory]      substring filter on the session directory
 * @param {number} [options.days]           only sessions updated in the last N days
 * @param {number} [options.limit]          hits returned, default 20, max 100
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
    const hits = new Map(); // session id -> { matches, snippet, titleMatch }
    let rowsRead = 0;

    if (match === 'title' || match === 'both') {
      for (const s of sessions) {
        if ((s.title || '').toLowerCase().includes(needle)) {
          hits.set(s.id, { matches: 0, snippet: '', titleMatch: true });
        }
      }
    }

    if (match === 'content' || match === 'both') {
      // LIKE runs in C over the raw JSON: ASCII case-insensitivity is what we want here and CJK is
      // unaffected. Rows whose JSON merely contains the field names still fall through the
      // occurrence count below, so they cost one parse and no false hit.
      const escaped = query.replace(/[\\%_]/g, (c) => `\\${c}`);
      const rows = db
        .prepare(
          `select m.session_id, m.type, m.data from session_message m
             join session_v2 s on s.id = m.session_id
             ${whereSql ? `${whereSql} and` : 'where'} m.data like ? escape '\\'`,
        )
        .all(...params, `%${escaped}%`);
      rowsRead = rows.length;

      for (const row of rows) {
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
        if (existing) existing.matches += count;
        else {
          const start = Math.max(0, first - SNIPPET_PAD);
          const end = Math.min(text.length, first + needle.length + SNIPPET_PAD);
          hits.set(row.session_id, {
            matches: count,
            snippet: redact(text.slice(start, end).replace(/\s+/g, ' ').trim()),
            titleMatch: false,
          });
        }
      }
    }

    const results = [];
    for (const [id, hit] of hits) {
      const session = byId.get(id);
      if (!session) continue;
      results.push({
        session: id,
        title: redact(session.title || ''),
        directory: session.directory,
        project: path.basename(session.directory),
        at: new Date(session.time_updated).toISOString().slice(0, 16).replace('T', ' '),
        matches: hit.matches,
        title_match: hit.titleMatch,
        snippet: hit.snippet,
      });
    }
    // Heaviest coverage first: a session that mentions the term 30 times is a better lead than one
    // that mentions it once, regardless of age.
    results.sort((a, b) => b.matches - a.matches || (a.at < b.at ? 1 : -1));

    return {
      query,
      match,
      candidates: sessions.length,
      rows_read: rowsRead,
      total: results.length,
      elapsed_ms: Date.now() - t0,
      hits: results.slice(0, limit),
    };
  } finally {
    db.close();
  }
}

// ---- CLI ---------------------------------------------------------------------------------------
// Same code path as the tool, so a failure here is a failure there. `sqlite` is unavailable below
// Node 22 and the import above is deferred for exactly that reason.
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
