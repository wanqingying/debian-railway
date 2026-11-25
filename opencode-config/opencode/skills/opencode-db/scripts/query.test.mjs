/** Disposable fixture tests; never run against the live OpenCode store. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

let directory, path;
const script = new URL('./query.mjs', import.meta.url).pathname;
before(() => {
  directory = mkdtempSync(join(tmpdir(), 'opencode-db-test-'));
  path = join(directory, 'opencode.db');
  writeFileSync(join(directory, 'opencode'), `#!/bin/sh\nprintf '%s\\n' '${path}'\n`, { mode: 0o755 });
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE credential(secret TEXT);
    INSERT INTO credential VALUES ('not-public');
    CREATE TABLE session_v2(id TEXT PRIMARY KEY, title TEXT, fork_session_id TEXT, parent_id TEXT, metadata TEXT);
    INSERT INTO session_v2 VALUES ('s1','Example',NULL,NULL,'not-public'),
      ('s2','Fork','s1',NULL,NULL),('s3','Nested fork','s2',NULL,NULL),
      ('s4','Unrelated',NULL,NULL,NULL),('s5','Child',NULL,'s1',NULL);
    CREATE TABLE session_message(id TEXT, session_id TEXT, type TEXT, time_created INTEGER, data TEXT);
  `);
  const insert = db.prepare('INSERT INTO session_message VALUES (?,?,?,?,?)');
  const data = JSON.stringify({ model: { providerID: 'test', id: 'm' }, tokens: { input: 42, output: 3 }, content: 'not-public' });
  for (const [id, session] of [['m1','s1'],['copy','s2'],['nested','s3'],['independent','s4'],['child','s5']]) insert.run(id, session, 'assistant', 123, data);
  insert.run('new', 's2', 'assistant', 124, data);
  insert.run('invalid', 's1', 'assistant', 125, '{"model":{"providerID":{}},"tokens":{"input":[1,2]}}');
  insert.run('broken', 's1', 'assistant', 126, 'malformed');
  insert.run('user', 's1', 'user', 127, data);
  // Exercise aggregates at the live store's scale without large private payloads.
  db.exec('BEGIN');
  for (let i = 0; i < 25000; i++) insert.run(`bulk${i}`, 's1', 'assistant', 1000+i, data);
  db.exec('COMMIT');
  db.close();
});
after(() => rmSync(directory, { recursive: true, force: true }));

function cli(operation, sql = '', argument = false) {
  return spawnSync(process.execPath, [script, operation, ...(argument ? [sql] : [])], {
    input: argument ? '' : sql, encoding: 'utf8', timeout: 35000,
    env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, NODE_NO_WARNINGS: '1' },
  });
}
function result(operation, sql, argument) {
  const output = cli(operation, sql, argument);
  assert.equal(output.status, 0, output.stderr);
  return JSON.parse(output.stdout);
}

test('path, schema and SQL passed either as stdin or one argument', () => {
  assert.equal(cli('path').stdout.trim(), path);
  const tables = result('schema');
  assert.deepEqual(Object.keys(tables), ['session_v2','session_message','session_usage','session_usage_dedup']);
  assert.equal(tables.session_message.data, undefined);
  assert.equal(tables.session_v2.metadata, undefined);
  for (const argument of [false, true]) assert.deepEqual(result('query', "SELECT title FROM session_v2 WHERE id='s1'", argument).rows, [['Example']]);
});

test('time functions and real-scale aggregate work', () => {
  assert.ok(result('query', "SELECT unixepoch('2026-11-25T00:00:00+08:00') AS start").rows[0][0] > 0);
  const start = performance.now();
  assert.deepEqual(result('query', 'SELECT COUNT(*),SUM(tokens_input),SUM(tokens_output),SUM(tokens_reasoning) FROM session_usage').rows, [[25008, 25006*42,25006*3,null]]);
  assert.ok(performance.now()-start < 10000, '25k-row aggregation should finish within 10s');
});

test('bare table counts and part metadata work without exposing private columns', () => {
  const db = new DatabaseSync(path);
  db.exec("CREATE TABLE session_part(message_id TEXT, ordinal INTEGER, type TEXT, data TEXT); INSERT INTO session_part VALUES ('m1',0,'tool','not-public'),('m1',1,'text','not-public')");
  db.close();
  try {
    for (const name of ['session_v2', 'SESSION_V2']) {
      assert.deepEqual(result('query', `SELECT COUNT(*) FROM ${name}`).rows, [[5]]);
      assert.deepEqual(result('query', `SELECT COUNT(id) FROM ${name}`).rows, [[5]]);
      assert.deepEqual(result('query', `WITH all_sessions AS (SELECT COUNT(*) AS n FROM ${name}) SELECT n FROM all_sessions`).rows, [[5]]);
    }
    assert.deepEqual(result('query', 'SELECT COUNT(*) FROM session_message').rows, [[25009]]);
    assert.deepEqual(result('query', 'SELECT COUNT(*) FROM session_part').rows, [[2]]);
    assert.deepEqual(result('query', 'SELECT type,COUNT(*) FROM session_part GROUP BY type ORDER BY type').rows, [['text',1],['tool',1]]);
    for (const sql of ['SELECT COUNT(*) FROM credential', 'SELECT COUNT(secret) FROM credential',
      'SELECT COUNT(data) FROM session_part', "SELECT COUNT(*) FROM session_part WHERE data='not-public'", 'SELECT data FROM session_part',
      'SELECT * FROM session_part', 'SELECT COUNT(metadata) FROM session_v2']) {
      const output = cli('query', sql);
      assert.equal(output.status, 1, sql);
      assert.equal(output.stdout, '', sql);
    }
  } finally {
    const cleanup = new DatabaseSync(path);
    cleanup.exec('DROP TABLE session_part');
    cleanup.close();
  }
});

test('invalid usage remains NULL; lowercase and uppercase names work', () => {
  assert.deepEqual(result('query', "SELECT MESSAGE_ID,PROVIDER_ID,TOKENS_INPUT FROM SESSION_USAGE WHERE MESSAGE_ID IN ('invalid','broken') ORDER BY 1").rows, [['broken',null,null],['invalid',null,null]]);
});

test('dedup removes ancestor copies, retains unrelated collisions and new work', () => {
  assert.deepEqual(result('query', 'SELECT COUNT(*),SUM(tokens_input) FROM session_usage_dedup').rows, [[25005,25003*42]]);
  assert.deepEqual(result('query', "SELECT message_id FROM session_usage_dedup WHERE time_created<125 ORDER BY 1").rows, [['independent'],['m1'],['new']]);
  assert.deepEqual(result('query', "SELECT copy_of IS NOT NULL FROM session_usage WHERE message_id='nested'").rows, [[1]]);
  // Deduplication must happen across the ancestry before a child-only filter.
  assert.deepEqual(result('query', "SELECT message_id FROM session_usage_dedup WHERE session_id='s2'").rows, [['new']]);
});

test('missing origins and cyclic ancestry are retained', () => {
  const db = new DatabaseSync(path);
  db.exec("INSERT INTO session_v2 VALUES ('lost','Missing origin','gone',NULL,NULL),('cycle1','Cycle','cycle2',NULL,NULL),('cycle2','Cycle','cycle1',NULL,NULL)");
  const data = JSON.stringify({ model: { providerID: 'test', id: 'm' }, tokens: { input: 42, output: 3 } });
  const insert = db.prepare('INSERT INTO session_message VALUES (?,?,?,?,?)');
  for (const id of ['lost','cycle1','cycle2']) insert.run(id,id,'assistant',123,data);
  db.close();
  try {
    assert.deepEqual(result('query', "SELECT message_id FROM session_usage_dedup WHERE session_id IN ('lost','cycle1','cycle2') ORDER BY 1").rows, [['cycle1'],['cycle2'],['lost']]);
  } finally {
    const cleanup = new DatabaseSync(path);
    cleanup.exec("DELETE FROM session_message WHERE session_id IN ('lost','cycle1','cycle2'); DELETE FROM session_v2 WHERE id IN ('lost','cycle1','cycle2')");
    cleanup.close();
  }
});

test('reads private fields, writes, forged views, attachments and multiple statements are denied', () => {
  for (const sql of [
    'SELECT secret FROM credential', 'SELECT metadata FROM session_v2',
    'SELECT data FROM session_message', 'SELECT * FROM session_message',
    'WITH session_usage AS (SELECT data FROM session_message) SELECT data FROM session_usage',
    'WITH SESSION_USAGE AS (SELECT DATA FROM SESSION_MESSAGE) SELECT DATA FROM SESSION_USAGE',
    'SELECT name FROM sqlite_schema', 'DELETE FROM session_v2',
    "ATTACH DATABASE ':memory:' AS other", 'PRAGMA writable_schema=ON',
    "SELECT load_extension('unused')", 'SELECT 1; SELECT 2',
    'SELECT 1; DELETE FROM session_v2', 'SELECT random()',
  ]) {
    const output = cli('query', sql);
    assert.equal(output.status, 1, sql);
    assert.equal(output.stdout, '', sql);
    assert.match(output.stderr, /opencode-db:/);
  }
  const db = new DatabaseSync(path, { readOnly: true });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM session_v2').get().n, 5);
  db.close();
});

test('row and byte budgets, duplicate column names and CTEs', () => {
  const output = result('query', 'WITH RECURSIVE nums(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM nums WHERE n<101) SELECT n FROM nums ORDER BY n');
  assert.equal(output.rows.length, 100);
  assert.equal(output.truncated, true);
  assert.deepEqual(result('query', "SELECT printf('%30000s','x')").rows, []);
  assert.equal(result('query', "SELECT printf('%30000s','x')").truncated, true);
  assert.deepEqual(result('query', 'SELECT 1 AS n,2 AS n').rows, [[1,2]]);
  assert.equal(cli('query', 'x'.repeat(16385)).status, 1);
});

test('process deadline stops an unbounded aggregate', () => {
  const output = cli('query', 'WITH RECURSIVE nums(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM nums) SELECT SUM(n) FROM nums');
  assert.equal(output.status, 1, output.stderr);
  assert.match(output.stderr, /query timed out/);
});
