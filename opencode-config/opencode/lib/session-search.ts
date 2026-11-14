/**
 * lib/session-search.ts — cross-session recall over the opencode session store.
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
 * Fork copies (measured 2026-11-14 on the live store): 17 of 101 in-scope sessions were forked
 * children, and 22–33% of every result set was a fork copy — the same conversation twice. They are
 * NOT dropped: 16 of those 17 carried messages their parent does not (70–100% unique for most, since
 * a fork diverges and keeps working), and 1–6 fork hits per query had no parent hit at all. So each
 * hit is labelled with `fork_of` + `fork_of_title` instead, and the `(fork #N)` title suffix — which
 * made a search for "fork" return five copies of unrelated sessions — is stripped before matching.
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
 * Also runs as a CLI: `node lib/session-search.ts <keyword> [--json] [--limit N] ...`.
 *
 * TypeScript, run by Node's own type stripping (Node >= 24): no build step, and nothing
 * non-erasable (`enum`, `namespace`, parameter properties) is used.
 */

import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const SNIPPET_PAD = 60;
const BUSY_TIMEOUT_MS = 2_000;
const DEFAULT_BUDGET_MS = 2_000;
const DEADLINE_CHECK_EVERY = 512;
// Forking appends " (fork #1)", " (fork #2)" to the title. That suffix is metadata, not content: it
// made a search for "fork" return copies of unrelated sessions before it was excluded from matching.
const FORK_SUFFIX = /\s*\(fork #\d+\)\s*$/i;
const WORKSPACE_ROOT = '/workspace';

export type MatchMode = 'title' | 'content' | 'both';

export interface SearchSessionsOptions {
  /** Keyword (case-insensitive for ASCII; CJK as written). */
  query?: string;
  /** Default 'both'. */
  match?: MatchMode | string;
  /** Substring filter on the session directory. */
  directory?: string;
  /** Only sessions updated in the last N days (must be > 0). */
  days?: number | string | null;
  /** Hits returned, default 20, clamped to 100. */
  limit?: number | string;
  /** Wall-clock budget, default 2000 (tests shrink it). */
  budgetMs?: number | string;
  includeArchived?: boolean;
  includeChildren?: boolean;
  /** Include sessions under /tmp. */
  includeTmp?: boolean;
  /** Override the resolved path (tests). */
  dbPath?: string;
}

export interface SessionHit {
  session: string;
  title: string;
  directory: string;
  project: string;
  at: string;
  matches: number;
  title_match: boolean;
  snippet: string;
  /** Parent session id when this hit is a fork copy of another session; '' otherwise. */
  fork_of: string;
  /** Title of that parent, so a copy is recognisable without a second lookup. */
  fork_of_title: string;
}

export interface SearchSessionsSuccess {
  status: 'ok';
  query: string;
  match: string;
  candidates: number;
  rows_read: number;
  total: number;
  /** The parse loop hit its budget: the answer is real but built from part of the matching rows. */
  truncated: boolean;
  elapsed_ms: number;
  hits: SessionHit[];
}

export interface SearchSessionsFailure {
  status: 'error' | 'unsupported-node' | 'no-db';
  message: string;
}

export type SearchSessionsResult = SearchSessionsSuccess | SearchSessionsFailure;

interface SessionRow {
  id: string;
  title: string | null;
  directory: string;
  time_updated: number;
  fork_session_id: string | null;
}

interface MessageRow {
  session_id: string;
  type: string;
  data: string;
}

interface Hit {
  matches: number;
  text: string;
  first: number;
  titleMatch: boolean;
}

export function resolveDbPath(): string {
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
function buildSnippet(text: string, needle: string, firstOffset: number): string {
  const lower = text.toLowerCase();
  const at = lower.indexOf(needle);
  const pos = at >= 0 ? at : Math.min(firstOffset, text.length);
  const start = Math.max(0, pos - SNIPPET_PAD);
  const end = Math.min(text.length, pos + needle.length + SNIPPET_PAD);
  return text.slice(start, end).replace(/\s+/g, ' ').trim();
}

// `basename` collapsed 14 of the 26 in-scope directories onto an already-used name ("assistant" for
// 12 sessions, "debian-railway" for 23), so the short label is the path below /workspace instead.
function projectLabel(directory: string): string {
  if (directory.startsWith(`${WORKSPACE_ROOT}/`)) return directory.slice(WORKSPACE_ROOT.length + 1);
  return path.basename(directory) || directory;
}

export async function searchSessions(options: SearchSessionsOptions = {}): Promise<SearchSessionsResult> {
  const query = String(options.query ?? '').trim();
  if (!query) return { status: 'error', message: 'query is required' };

  const match = options.match || 'both';
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
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (!options.includeArchived) where.push('s.time_archived is null');
    if (!options.includeChildren) where.push('s.parent_id is null');
    if (!options.includeTmp) where.push("s.directory not like '/tmp%'");
    if (options.directory) { where.push('s.directory like ?'); params.push(`%${options.directory}%`); }
    if (options.days) { where.push('s.time_updated >= ?'); params.push(Date.now() - Number(options.days) * 86_400_000); }
    const whereSql = where.length ? `where ${where.join(' and ')}` : '';

    const sessions = db
      .prepare(
        `select s.id, s.title, s.directory, s.time_updated, s.fork_session_id from session_v2 s ${whereSql}`,
      )
      .all(...params) as unknown as SessionRow[];
    const byId = new Map(sessions.map((s) => [s.id, s]));

    const needle = query.toLowerCase();
    // The full text is kept for the first hit in each session so the snippet can be cut from it
    // after sorting — but only for sessions that hit, never for every row scanned.
    const hits = new Map<string, Hit>(); // session id -> { matches, text, first, titleMatch }
    let rowsRead = 0;
    let truncated = false;

    if (match === 'title' || match === 'both') {
      for (const s of sessions) {
        // The fork suffix is metadata: matching it made "fork" return copies of unrelated sessions.
        if ((s.title || '').replace(FORK_SUFFIX, '').toLowerCase().includes(needle)) {
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
        .all(...params, `%${escaped}%`) as unknown as MessageRow[];
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
              .filter((part: { type?: string }) => part.type === 'text')
              .map((part: { text?: string }) => part.text || '')
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

    // Fork parents are often outside the filtered scope (archived, older than `days`), so their
    // titles are fetched directly instead of from `byId`.
    const forkParents = new Set<string>();
    for (const [id] of hits) {
      const parent = byId.get(id)?.fork_session_id;
      if (parent) forkParents.add(parent);
    }
    const parentTitles = new Map<string, string>();
    if (forkParents.size) {
      const ids = [...forkParents];
      const rows = db
        .prepare(`select id, title from session_v2 where id in (${ids.map(() => '?').join(',')})`)
        .all(...ids) as unknown as { id: string; title: string | null }[];
      for (const row of rows) parentTitles.set(row.id, row.title || '');
    }

    const results: SessionHit[] = [];
    const updatedAt = new Map<string, number>();
    for (const [id, hit] of hits) {
      const session = byId.get(id);
      if (!session) continue;
      const parent = session.fork_session_id || '';
      updatedAt.set(id, session.time_updated);
      results.push({
        session: id,
        title: session.title || '',
        directory: session.directory,
        project: projectLabel(session.directory),
        at: new Date(session.time_updated).toISOString().slice(0, 16).replace('T', ' '),
        matches: hit.matches,
        title_match: hit.titleMatch,
        snippet: hit.text ? buildSnippet(hit.text, needle, hit.first) : '',
        fork_of: parent,
        // A deleted parent leaves only the fork's own title, which still carries the original name.
        fork_of_title: parent ? (parentTitles.get(parent) || (session.title || '').replace(FORK_SUFFIX, '')) : '',
      });
    }
    // Heaviest coverage first: a session that mentions the term 30 times is a better lead than one
    // that mentions it once, regardless of age. A title match counts as one occurrence, otherwise a
    // title-only hit sorts below every body mention and is cut off by `limit` — measured: all five
    // title-only hits for "fork" fell outside the default 20, including "巡检 2026-11-06 20:25", the
    // only session a date search could ever find. Ties break on the raw timestamp: `at` is truncated
    // to the minute, so comparing it left sessions updated in the same minute in arbitrary order.
    const rank = (h: SessionHit) => h.matches + (h.title_match ? 1 : 0);
    results.sort((a, b) => rank(b) - rank(a) || (updatedAt.get(b.session) ?? 0) - (updatedAt.get(a.session) ?? 0));

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
if (import.meta.main) {
  const VALUE_OPTS = new Set(['--match', '--dir', '--days', '--limit']);
  const FLAG_OPTS = new Set(['--include-archived', '--include-children', '--include-tmp', '--json', '--help']);
  const opts: Record<string, string | boolean> = {};
  const positional: string[] = [];
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (VALUE_OPTS.has(arg)) opts[arg.slice(2)] = argv[++i];
    else if (FLAG_OPTS.has(arg)) opts[arg.slice(2)] = true;
    else if (arg.startsWith('--')) { console.error(`unknown option: ${arg} (try --help)`); process.exit(1); }
    else positional.push(arg);
  }

  if (opts.help) {
    console.log(`usage: node session-search.ts <keyword...> [options]

  --match <title|content|both>  where to look (default both)
  --dir <substring>             only sessions whose directory contains it
  --days <n>                    only sessions updated in the last n days
  --limit <n>                   rows to return (default 20, max 100)
  --include-archived            include archived sessions
  --include-children            include subagent child sessions
  --include-tmp                 include sessions under /tmp
  --json                        print the raw result object`);
    process.exit(0);
  }

  const result = await searchSessions({
    query: positional.join(' '),
    match: opts.match as string | undefined,
    directory: opts.dir as string | undefined,
    days: opts.days as string | undefined,
    limit: opts.limit as string | undefined,
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
    // Column widths follow the data: `project` is now a path below /workspace and can be long.
    // Legacy worktree paths run 90+ characters, so the CLI shows their tail and the JSON keeps all.
    const short = (p: string) => (p.length > 34 ? `…${p.slice(-33)}` : p);
    const projectWidth = Math.min(34, Math.max(7, ...result.hits.map((h) => short(h.project).length)));
    for (const hit of result.hits) {
      // A title-only hit has zero body occurrences; printing `0×` there reads as "no match".
      const label = hit.matches > 0 ? `${hit.matches}×` : 'T';
      const fork = hit.fork_of ? ` ↳ fork of "${hit.fork_of_title || hit.fork_of}"` : '';
      console.log(`${hit.at}  ${label.padStart(4)}  ${short(hit.project).padEnd(projectWidth)} ${hit.title}${fork}`);
      if (hit.snippet) console.log(`${' '.repeat(projectWidth + 9)}…${hit.snippet}…`);
      console.log(`${' '.repeat(projectWidth + 9)}${hit.session}`);
    }
  }
}
