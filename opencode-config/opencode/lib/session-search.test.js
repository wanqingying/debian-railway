/**
 * Tests for lib/session-search.js. Run: node --test opencode-config/opencode/lib/session-search.test.js
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
import { searchSessions } from './session-search.js';

// The two tables the tool touches, with only the columns it selects or filters on.
const SCHEMA = `
  create table session_v2 (
    id text primary key, title text, directory text not null, parent_id text,
    time_archived integer, time_updated integer not null
  );
  create table session_message (
    id text primary key, session_id text not null, type text not null, seq integer not null,
    time_created integer not null, time_updated integer not null, data text not null
  );
`;

const NOW = Date.now();

function userText(text) {
  return JSON.stringify({ time: { created: NOW }, text, files: [] });
}

function assistantText(parts) {
  return JSON.stringify({
    time: { created: NOW },
    content: parts.map((text) => ({ type: 'text', text })),
  });
}

function buildFixture(sessions) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'session-search-'));
  const dbPath = path.join(dir, 'opencode.db');
  const db = new DatabaseSync(dbPath);
  db.exec(SCHEMA);

  const insertSession = db.prepare(
    'insert into session_v2 (id, title, directory, parent_id, time_archived, time_updated) values (?,?,?,?,?,?)',
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
    assert.equal(r.total, 1);
    assert.match(r.hits[0].snippet, /GITHUB_TOKEN=abc123def/);
  } finally {
    fx.cleanup();
  }
});

test('defaults drop archived, child and /tmp sessions', async () => {
  const message = [{ type: 'user', data: userText('needle in the haystack') }];
  const fx = buildFixture([
    { id: 'ses_live', title: 'live', messages: message },
    { id: 'ses_arch', title: 'archived', archived: true, messages: message },
    { id: 'ses_child', title: 'child', parentId: 'ses_live', messages: message },
    { id: 'ses_tmp', title: 'scratch', directory: '/tmp/scratch', messages: message },
  ]);
  try {
    const narrow = await searchSessions({ query: 'needle', dbPath: fx.dbPath });
    assert.deepEqual(narrow.hits.map((h) => h.session), ['ses_live']);

    const wide = await searchSessions({
      query: 'needle',
      dbPath: fx.dbPath,
      includeArchived: true,
      includeChildren: true,
      includeTmp: true,
    });
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
    assert.equal(all.status, 'ok');
    assert.equal(all.total, 5);
    assert.equal(all.hits.length, 5);

    const one = await searchSessions({ query: 'common', limit: 1, dbPath: fx.dbPath });
    assert.equal(one.hits.length, 1);
    assert.equal(one.total, 5); // total counts every hit, not just the page
  } finally {
    fx.cleanup();
  }
});

test('a tiny budget reports too-slow rather than running unbounded', async () => {
  const sessions = Array.from({ length: 40 }, (_, i) => ({
    id: `ses_slow_${i}`,
    title: `s${i}`,
    messages: Array.from({ length: 30 }, () => ({ type: 'user', data: userText('busy busy busy') })),
  }));
  const fx = buildFixture(sessions);
  try {
    const r = await searchSessions({ query: 'busy', budgetMs: 0, dbPath: fx.dbPath });
    assert.equal(r.status, 'too-slow');
    assert.ok(r.elapsed_ms >= 0);
  } finally {
    fx.cleanup();
  }
});

test('title-only hits are marked and carry no snippet', async () => {
  const fx = buildFixture([{ id: 'ses_title', title: 'light merge 冲突处理', messages: [] }]);
  try {
    const r = await searchSessions({ query: 'light merge', match: 'title', dbPath: fx.dbPath });
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
