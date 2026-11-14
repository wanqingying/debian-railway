/**
 * Tests for lib/session-search.ts. Run: node --test opencode-config/opencode/lib/session-search.test.ts
 *
 * Every case runs against a throwaway SQLite fixture, never the real session store: the tool reads
 * another process's live database, so a test that depended on its contents would rot within a day.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { searchSessions } from './session-search.ts';

interface FixtureMessage {
  type: string;
  data: string;
}

interface FixtureSession {
  id: string;
  title?: string;
  directory?: string;
  parentId?: string;
  forkOf?: string;
  archived?: boolean;
  updated?: number;
  messages?: FixtureMessage[];
}

interface Fixture {
  dbPath: string;
  cleanup: () => void;
}

// The two tables the tool touches, with only the columns it selects or filters on.
const SCHEMA = `
  create table session_v2 (
    id text primary key, title text, directory text not null, parent_id text,
    fork_session_id text, time_archived integer, time_updated integer not null
  );
  create table session_message (
    id text primary key, session_id text not null, type text not null, seq integer not null,
    time_created integer not null, time_updated integer not null, data text not null
  );
`;

const NOW = Date.now();

function userText(text: string): string {
  return JSON.stringify({ time: { created: NOW }, text, files: [] });
}

function assistantText(parts: string[]): string {
  return JSON.stringify({
    time: { created: NOW },
    content: parts.map((text) => ({ type: 'text', text })),
  });
}

function buildFixture(sessions: FixtureSession[]): Fixture {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'session-search-'));
  const dbPath = path.join(dir, 'opencode.db');
  const db = new DatabaseSync(dbPath);
  db.exec(SCHEMA);

  const insertSession = db.prepare(
    'insert into session_v2 (id, title, directory, parent_id, fork_session_id, time_archived, time_updated) values (?,?,?,?,?,?,?)',
  );
  const insertMessage = db.prepare(
    'insert into session_message (id, session_id, type, seq, time_created, time_updated, data) values (?,?,?,?,?,?,?)',
  );

  let seq = 0;
  for (const s of sessions) {
    insertSession.run(
      s.id,
      s.title ?? null,
      s.directory ?? '/workspace/demo',
      s.parentId ?? null,
      s.forkOf ?? null,
      s.archived ? NOW : null,
      s.updated ?? NOW,
    );
    for (const message of s.messages ?? []) {
      insertMessage.run(`${s.id}-m${seq}`, s.id, message.type, seq++, NOW, NOW, message.data);
    }
  }
  db.close();
  return { dbPath, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('a query containing a double quote still finds the text', async () => {
  // Regression: `"` is JSON-escaped in the stored row, so the LIKE prefilter matched nothing and the
  // tool answered "no such session" instead of scanning.
  const fx = buildFixture([
    { id: 'ses_quote', title: 'quoted', messages: [{ type: 'user', data: userText('he said "浅合并" loudly') }] },
  ]);
  try {
    const r = await searchSessions({ query: '"浅合并"', dbPath: fx.dbPath });
    assert.equal(r.status, 'ok');
    if (r.status !== 'ok') return;
    assert.equal(r.total, 1);
    assert.match(r.hits[0].snippet, /浅合并/);
  } finally {
    fx.cleanup();
  }
});

test('snippets keep config values readable', async () => {
  // Decided 2026-10-28: output is not redacted, so a "how was this configured" search must return
  // the value itself rather than `***`. This test pins that decision.
  const fx = buildFixture([
    {
      id: 'ses_cfg',
      title: 'config',
      messages: [{ type: 'user', data: userText('set GITHUB_TOKEN=abc123def in the env') }],
    },
  ]);
  try {
    const r = await searchSessions({ query: 'GITHUB_TOKEN', dbPath: fx.dbPath });
    if (r.status !== 'ok') throw new Error(`expected ok, got ${r.status}`);
    assert.equal(r.total, 1);
    assert.match(r.hits[0].snippet, /GITHUB_TOKEN=abc123def/);
  } finally {
    fx.cleanup();
  }
});

test('defaults drop archived, child and /tmp sessions', async () => {
  const message: FixtureMessage[] = [{ type: 'user', data: userText('needle in the haystack') }];
  const fx = buildFixture([
    { id: 'ses_live', title: 'live', messages: message },
    { id: 'ses_arch', title: 'archived', archived: true, messages: message },
    { id: 'ses_child', title: 'child', parentId: 'ses_live', messages: message },
    { id: 'ses_tmp', title: 'scratch', directory: '/tmp/scratch', messages: message },
  ]);
  try {
    const narrow = await searchSessions({ query: 'needle', dbPath: fx.dbPath });
    if (narrow.status !== 'ok') throw new Error(`expected ok, got ${narrow.status}`);
    assert.deepEqual(narrow.hits.map((h) => h.session), ['ses_live']);

    const wide = await searchSessions({
      query: 'needle',
      dbPath: fx.dbPath,
      includeArchived: true,
      includeChildren: true,
      includeTmp: true,
    });
    if (wide.status !== 'ok') throw new Error(`expected ok, got ${wide.status}`);
    assert.equal(wide.total, 4);
  } finally {
    fx.cleanup();
  }
});

test('rejects bad arguments instead of answering something empty-looking', async () => {
  const fx = buildFixture([{ id: 'ses_a', title: 'a', messages: [] }]);
  try {
    assert.equal((await searchSessions({ query: '  ', dbPath: fx.dbPath })).status, 'error');
    assert.equal((await searchSessions({ query: 'x', match: 'nope', dbPath: fx.dbPath })).status, 'error');
    // A negative window used to return zero hits, indistinguishable from "nothing found".
    assert.equal((await searchSessions({ query: 'x', days: -5, dbPath: fx.dbPath })).status, 'error');
    assert.equal((await searchSessions({ query: 'x', days: 0, dbPath: fx.dbPath })).status, 'error');
  } finally {
    fx.cleanup();
  }
});

test('limit is clamped and success carries a status', async () => {
  const sessions = Array.from({ length: 5 }, (_, i) => ({
    id: `ses_${i}`,
    title: `t${i}`,
    messages: [{ type: 'user', data: userText('common term here') }],
  }));
  const fx = buildFixture(sessions);
  try {
    const all = await searchSessions({ query: 'common', limit: 999, dbPath: fx.dbPath });
    if (all.status !== 'ok') throw new Error(`expected ok, got ${all.status}`);
    assert.equal(all.status, 'ok');
    assert.equal(all.total, 5);
    assert.equal(all.hits.length, 5);

    const one = await searchSessions({ query: 'common', limit: 1, dbPath: fx.dbPath });
    if (one.status !== 'ok') throw new Error(`expected ok, got ${one.status}`);
    assert.equal(one.hits.length, 1);
    assert.equal(one.total, 5); // total counts every hit, not just the page
  } finally {
    fx.cleanup();
  }
});

test('a tiny budget returns partial hits instead of discarding them', async () => {
  // Regression: the first version checked the deadline after doing all the work and then threw the
  // results away, so a cold-cache 83-hit search answered "nothing". A budget that stops the parse
  // early must still return what it found, marked truncated.
  const sessions = Array.from({ length: 40 }, (_, i) => ({
    id: `ses_slow_${i}`,
    title: `s${i}`,
    messages: Array.from({ length: 30 }, () => ({ type: 'user', data: userText('busy busy busy') })),
  }));
  const fx = buildFixture(sessions);
  try {
    const r = await searchSessions({ query: 'busy', budgetMs: 0, dbPath: fx.dbPath });
    if (r.status !== 'ok') throw new Error(`expected ok, got ${r.status}`);
    assert.equal(r.status, 'ok');
    assert.equal(r.truncated, true);
    assert.ok(r.total > 0, 'partial hits should still be returned');
    assert.ok(r.total < 40, 'the budget should have stopped the scan early');
  } finally {
    fx.cleanup();
  }
});

test('title-only hits are marked and carry no snippet', async () => {
  const fx = buildFixture([{ id: 'ses_title', title: 'light merge 冲突处理', messages: [] }]);
  try {
    const r = await searchSessions({ query: 'light merge', match: 'title', dbPath: fx.dbPath });
    if (r.status !== 'ok') throw new Error(`expected ok, got ${r.status}`);
    assert.equal(r.total, 1);
    assert.equal(r.hits[0].title_match, true);
    assert.equal(r.hits[0].matches, 0);
    assert.equal(r.hits[0].snippet, '');
  } finally {
    fx.cleanup();
  }
});

test('a missing database is reported, not thrown', async () => {
  const r = await searchSessions({ query: 'x', dbPath: path.join(os.tmpdir(), 'definitely-not-here', 'opencode.db') });
  assert.equal(r.status, 'no-db');
});

test('the default also searches titles, and a title-only hit is not buried by limit', async () => {
  // Measured on the live store: a date like "巡检 2026-11-06" exists only in a title, and every
  // title-only hit sorted last because it had zero body occurrences — so it was cut off by `limit`.
  const fx = buildFixture([
    { id: 'ses_body', title: 'unrelated', messages: [{ type: 'user', data: userText('巡检 once') }] },
    { id: 'ses_title', title: '巡检 2026-11-06 20:25', updated: NOW + 1000, messages: [] },
  ]);
  try {
    const r = await searchSessions({ query: '巡检', limit: 1, dbPath: fx.dbPath });
    if (r.status !== 'ok') throw new Error(`expected ok, got ${r.status}`);
    assert.equal(r.total, 2);
    assert.equal(r.hits.length, 1);
    assert.equal(r.hits[0].session, 'ses_title');
    assert.equal(r.hits[0].title_match, true);
    assert.equal(r.hits[0].matches, 0);
  } finally {
    fx.cleanup();
  }
});

test('a fork copy is labelled with its parent, and its title suffix is not a hit', async () => {
  // 22-33% of every live result set was a fork copy of a session that was already in it. They are
  // kept (a fork diverges and usually holds content its parent does not) but have to be recognisable
  // — and the " (fork #1)" suffix made a search for "fork" return unrelated sessions.
  const fx = buildFixture([
    { id: 'ses_parent', title: 'debian-railway 优化容器', messages: [{ type: 'user', data: userText('needle') }] },
    { id: 'ses_fork', title: '优化容器 (fork #1)', forkOf: 'ses_parent', messages: [{ type: 'user', data: userText('needle again') }] },
  ]);
  try {
    const r = await searchSessions({ query: 'needle', dbPath: fx.dbPath });
    if (r.status !== 'ok') throw new Error(`expected ok, got ${r.status}`);
    assert.equal(r.total, 2);
    const fork = r.hits.find((h) => h.session === 'ses_fork');
    const parent = r.hits.find((h) => h.session === 'ses_parent');
    assert.equal(fork?.fork_of, 'ses_parent');
    assert.equal(fork?.fork_of_title, 'debian-railway 优化容器');
    assert.equal(parent?.fork_of, '');

    const suffix = await searchSessions({ query: 'fork', dbPath: fx.dbPath });
    if (suffix.status !== 'ok') throw new Error(`expected ok, got ${suffix.status}`);
    assert.equal(suffix.total, 0);
  } finally {
    fx.cleanup();
  }
});

test('project is the path below /workspace, not a colliding basename', async () => {
  // 14 of 26 live directories shared a basename ("assistant" covered 12 sessions), so a short label
  // could not tell two sessions apart.
  const fx = buildFixture([
    { id: 'ses_a', title: 'a', directory: '/workspace/lark-work-assistant/assistant', messages: [{ type: 'user', data: userText('needle') }] },
    { id: 'ses_b', title: 'b', directory: '/workspace/worktrees/win10-compat', messages: [{ type: 'user', data: userText('needle') }] },
    { id: 'ses_c', title: 'c', directory: '/root', messages: [{ type: 'user', data: userText('needle') }] },
  ]);
  try {
    const r = await searchSessions({ query: 'needle', dbPath: fx.dbPath });
    if (r.status !== 'ok') throw new Error(`expected ok, got ${r.status}`);
    const project = new Map(r.hits.map((h) => [h.session, h.project]));
    assert.equal(project.get('ses_a'), 'lark-work-assistant/assistant');
    assert.equal(project.get('ses_b'), 'worktrees/win10-compat');
    assert.equal(project.get('ses_c'), 'root');
  } finally {
    fx.cleanup();
  }
});

test('keywords rank by how many distinct terms a session covers', async () => {
  // A sentence as `query` is a literal substring and matched nothing in all five measured cases;
  // the model supplies the terms instead, and coverage has to outrank raw repetition.
  const fx = buildFixture([
    {
      id: 'ses_one_term',
      title: 'single',
      messages: [{ type: 'user', data: userText('pids pids pids pids pids pids pids pids pids pids') }],
    },
    {
      id: 'ses_two_terms',
      title: 'both',
      messages: [{ type: 'user', data: userText('pids 打满 once, nothing else') }],
    },
    {
      id: 'ses_none',
      title: 'none',
      messages: [{ type: 'user', data: userText('unrelated text') }],
    },
  ]);
  try {
    const r = await searchSessions({ query: '容器里 pids 打满之后怎么恢复', keywords: ['pids', '打满'], dbPath: fx.dbPath });
    if (r.status !== 'ok') throw new Error(`expected ok, got ${r.status}`);
    assert.deepEqual(r.terms, ['pids', '打满']);
    assert.deepEqual(r.hits.map((h) => h.session), ['ses_two_terms', 'ses_one_term']);
    assert.equal(r.hits[0].coverage, 2);
    assert.deepEqual(r.hits[0].matched_terms, ['pids', '打满']);
    assert.equal(r.hits[1].coverage, 1);
  } finally {
    fx.cleanup();
  }
});

test("require:'all' keeps only sessions containing every term, and its empty result names the way out", async () => {
  const fx = buildFixture([
    { id: 'ses_both', title: 'both', messages: [{ type: 'user', data: userText('alpha and beta') }] },
    { id: 'ses_alpha', title: 'alpha', messages: [{ type: 'user', data: userText('alpha only') }] },
  ]);
  try {
    const all = await searchSessions({ keywords: ['alpha', 'beta'], require: 'all', dbPath: fx.dbPath });
    if (all.status !== 'ok') throw new Error(`expected ok, got ${all.status}`);
    assert.deepEqual(all.hits.map((h) => h.session), ['ses_both']);
    assert.equal(all.hint, undefined);

    // The hint has to say that 'any' would have found something — a bare 0 reads as "never happened".
    const none = await searchSessions({ keywords: ['alpha', 'gamma'], require: 'all', dbPath: fx.dbPath });
    if (none.status !== 'ok') throw new Error(`expected ok, got ${none.status}`);
    assert.equal(none.total, 0);
    assert.match(none.hint ?? '', /2 contain at least one.*require:'any'/);
  } finally {
    fx.cleanup();
  }
});

test('an empty result explains that matching is literal, not word-AND', async () => {
  const fx = buildFixture([{ id: 'ses_a', title: 'a', messages: [{ type: 'user', data: userText('pids 打满之后怎么恢复') }] }]);
  try {
    const r = await searchSessions({ query: '容器里 pids 打满之后怎么恢复', dbPath: fx.dbPath });
    if (r.status !== 'ok') throw new Error(`expected ok, got ${r.status}`);
    assert.equal(r.total, 0);
    assert.match(r.hint ?? '', /literal substring/);
  } finally {
    fx.cleanup();
  }
});

test('too many keywords is refused with the limit, not silently truncated', async () => {
  const fx = buildFixture([{ id: 'ses_a', title: 'a', messages: [] }]);
  try {
    const r = await searchSessions({ keywords: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], dbPath: fx.dbPath });
    assert.equal(r.status, 'error');
    assert.match((r as { message: string }).message, /max 6/);
    // Neither argument is optional in practice: both empty has to say what to pass.
    const empty = await searchSessions({ dbPath: fx.dbPath });
    assert.equal(empty.status, 'error');
    assert.match((empty as { message: string }).message, /query.*keywords/);
  } finally {
    fx.cleanup();
  }
});
