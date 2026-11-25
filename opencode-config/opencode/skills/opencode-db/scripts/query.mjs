/** Bounded read-only queries against OpenCode v2 metadata. Node with setAuthorizer required. */
import { DatabaseSync, constants as C } from 'node:sqlite';
import { execFileSync, fork } from 'node:child_process';
import { readSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const MAX_SQL = 16384;
const MAX_ROWS = 100;
const MAX_BYTES = 24576;
const TABLES = {
  session_v2: 'id project_id workspace_id parent_id fork_session_id fork_boundary directory title agent model cost tokens_input tokens_output tokens_reasoning tokens_cache_read tokens_cache_write time_created time_updated time_idle idle_outcome time_archived time_compacting time_suspended time_busy',
  session_message: 'id session_id type seq time_created time_updated',
  session_part: 'message_id session_id ordinal type call_id time_created time_updated',
  project: 'id worktree vcs name time_created time_updated time_archived',
  project_directory: 'project_id directory type strategy time_created',
  worktree: 'project_id directory strategy time_created',
};
const USAGE = {
  provider_id: ['model', 'providerID', 'TEXT'], model_id: ['model', 'id', 'TEXT'],
  cost: ['cost', null, 'REAL'],
  tokens_input: ['tokens', 'input', 'INTEGER'], tokens_output: ['tokens', 'output', 'INTEGER'],
  tokens_reasoning: ['tokens', 'reasoning', 'INTEGER'],
  tokens_cache_read: ['tokens', 'cache.read', 'INTEGER'],
  tokens_cache_write: ['tokens', 'cache.write', 'INTEGER'],
};
const USAGE_SCHEMA = { message_id: 'TEXT', session_id: 'TEXT', time_created: 'INTEGER',
  ...Object.fromEntries(Object.entries(USAGE).map(([key, value]) => [key, value[2]])), copy_of: 'TEXT' };
const FUNCTIONS = new Set(('abs avg cast char coalesce concat count cume_dist date datetime dense_rank first_value glob group_concat hex ifnull iif instr json json_array json_extract json_object json_quote json_type json_valid julianday lag last_value lead length like lower ltrim max min nth_value ntile nullif percent_rank printf rank replace round row_number rtrim strftime substr substring sum time total trim typeof unicode unixepoch upper').split(' '));

function schema(db) {
  const result = {};
  for (const [table, names] of Object.entries(TABLES)) {
    const allowed = new Set(names.split(' '));
    const columns = db.prepare(`PRAGMA main.table_info(${table})`).all()
      .filter(row => allowed.has(row.name));
    if (columns.length) result[table] = Object.fromEntries(columns.map(row => [row.name, row.type]));
  }
  if (!result.session_v2 || !result.session_message) throw new Error('OpenCode v2 tables not found; check `opencode debug paths db`.');
  return { ...result, session_usage: USAGE_SCHEMA, session_usage_dedup: USAGE_SCHEMA };
}

function usageValue(data, [root, path, kind]) {
  let value = data?.[root];
  if (path) for (const key of path.split('.')) value = value?.[key];
  if (kind === 'TEXT') return typeof value === 'string' ? value : null;
  return typeof value === 'number' && Number.isFinite(value)
    && (kind !== 'INTEGER' || Number.isSafeInteger(value)) ? value : null;
}

// Decode each message once, not once per JSON field in every aggregate.
function loadUsage(db, table, columns) {
  db.exec('BEGIN'); // Keep ancestry and copied-message fingerprints in one read snapshot.
  const has = name => columns.session_v2[name] !== undefined;
  const sessions = db.prepare(`SELECT id, ${has('fork_session_id') ? 'fork_session_id' : 'NULL AS fork_session_id'}, ${has('parent_id') ? 'parent_id' : 'NULL AS parent_id'} FROM main.session_v2`).all();
  const origins = new Map(sessions.map(row => [row.id, [row.fork_session_id, row.parent_id].filter(Boolean)]));
  const ancestors = new Map();
  for (const session of sessions) {
    const seen = new Set([session.id]);
    const pending = [...origins.get(session.id)];
    while (pending.length) {
      const id = pending.pop();
      if (seen.has(id)) continue;
      seen.add(id);
      pending.push(...(origins.get(id) ?? []));
    }
    seen.delete(session.id);
    ancestors.set(session.id, seen);
  }
  const rows = [];
  const signatures = new Map();
  for (const message of db.prepare("SELECT id, session_id, time_created, data FROM main.session_message WHERE type = 'assistant'").iterate()) {
    let data;
    try { data = JSON.parse(message.data); } catch { data = null; }
    const values = Object.values(USAGE).map(spec => usageValue(data, spec));
    const signature = values[0] !== null && values[1] !== null && values.slice(3).some(value => value !== null)
      ? createHash('sha256').update(JSON.stringify([message.time_created, ...values])).digest('hex') : null;
    const row = { id: message.id, session: message.session_id, time: message.time_created, values, signature };
    rows.push(row);
    if (signature) {
      if (!signatures.has(signature)) signatures.set(signature, new Map());
      const candidates = signatures.get(signature);
      if (!candidates.has(row.session)) candidates.set(row.session, row.id);
    }
  }
  const insert = db.prepare(`INSERT INTO temp.${table} VALUES (${Object.keys(USAGE_SCHEMA).map(() => '?').join(',')})`);
  for (const row of rows) {
    let copy = null;
    if (row.signature) for (const origin of ancestors.get(row.session) ?? []) {
      // Malformed cyclic ancestry cannot establish an original; keep both records.
      if (ancestors.get(origin)?.has(row.session)) continue;
      copy = signatures.get(row.signature).get(origin) ?? null;
      if (copy) break;
    }
    insert.run(row.id, row.session, row.time, ...row.values, copy);
  }
  db.exec('COMMIT');
}

function run({ path, sql, operation }) {
  const db = new DatabaseSync(path, { readOnly: true, timeout: 250, allowExtension: false });
  try {
    if (typeof db.setAuthorizer !== 'function') throw new Error('Node node:sqlite.setAuthorizer is required; upgrade Node (tested on 24.14.0).');
    const columns = schema(db);
    if (operation === 'schema') return columns;
    const backing = `usage_${randomBytes(16).toString('hex')}`;
    db.exec('PRAGMA trusted_schema=OFF');
    db.exec(`CREATE TEMP TABLE ${backing} (${Object.entries(USAGE_SCHEMA).map(([key, type]) => `${key} ${type}`).join(',')})`);
    db.exec(`CREATE TEMP VIEW session_usage AS SELECT * FROM ${backing}`);
    db.exec(`CREATE TEMP VIEW session_usage_dedup AS SELECT * FROM ${backing} WHERE copy_of IS NULL`);
    let needsUsage = false;
    const authorize = (action, table, column, database) => {
      table = table?.toLowerCase(); column = column?.toLowerCase();
      if (action === C.SQLITE_SELECT || action === C.SQLITE_RECURSIVE) return C.SQLITE_OK;
      if (action === C.SQLITE_READ) {
        if (database === 'main' && columns[table] && Object.hasOwn(TABLES, table)
          && (!column || Object.hasOwn(columns[table], column))) return C.SQLITE_OK;
        if (database === 'temp' && [backing, 'session_usage', 'session_usage_dedup'].includes(table)
          && (!column || Object.hasOwn(USAGE_SCHEMA, column))) {
          needsUsage = true;
          return C.SQLITE_OK;
        }
        // SQLite may omit the database name for a table-only COUNT(*) on a view.
        if (!column && database == null && ['session_usage', 'session_usage_dedup'].includes(table)) {
          needsUsage = true;
          return C.SQLITE_OK;
        }
      }
      if (action === C.SQLITE_FUNCTION && FUNCTIONS.has(column)) return C.SQLITE_OK;
      return C.SQLITE_DENY;
    };
    db.setAuthorizer(authorize);
    // prepare() accepts a trailing statement; reject it rather than silently ignoring it.
    // Reading each row exposes only the statement compiled under the authorizer.
    const statement = db.prepare(sql);
    if (statement.sourceSQL.trim() !== sql.trim()) throw new Error('Submit one SELECT or WITH ... SELECT statement (SQL via stdin or one argument).');
    if (needsUsage) {
      db.setAuthorizer(null);
      loadUsage(db, backing, columns);
      db.exec('PRAGMA query_only=ON');
      db.setAuthorizer(authorize);
    }
    const names = statement.columns().map(column => column.name);
    statement.setReturnArrays(true);
    const rows = [];
    let bytes = Buffer.byteLength(JSON.stringify(names)) + 128;
    if (bytes > MAX_BYTES) throw new Error('Column names exceed the output budget; use shorter aliases.');
    let truncated = false;
    for (const values of statement.iterate()) {
      if (values.some(value => value instanceof Uint8Array)) throw new Error('BLOB output is unsupported; select scalar metadata columns.');
      const encoded = JSON.stringify(values);
      if (rows.length === MAX_ROWS || bytes + Buffer.byteLength(encoded) + 1 > MAX_BYTES) { truncated = true; break; }
      bytes += Buffer.byteLength(encoded) + 1;
      rows.push(values);
    }
    return { columns: names, rows, truncated };
  } finally { db.close(); }
}

if (process.argv[2] === '--query-child' && process.send) {
  process.once('message', input => {
    let message;
    try { message = { result: run(input) }; }
    catch (error) { message = { error: error.message }; }
    process.send(message, () => process.disconnect());
  });
} else {
  try {
    const [operation, argument, ...extra] = process.argv.slice(2);
    if (!['path', 'schema', 'query'].includes(operation) || extra.length || (operation !== 'query' && argument !== undefined)) {
      throw new Error('Usage: node query.mjs path|schema|query [SQL]; query also reads SQL from stdin.');
    }
    let sql = '';
    if (operation === 'query') {
      if (argument !== undefined) sql = argument;
      else {
        const buffer = Buffer.alloc(MAX_SQL + 1);
        let length = 0, count;
        while (length < buffer.length && (count = readSync(0, buffer, length, buffer.length - length))) length += count;
        sql = buffer.subarray(0, length).toString('utf8');
      }
    }
    if (operation === 'query' && (!sql.trim() || Buffer.byteLength(sql) > MAX_SQL)) throw new Error(`Provide one SQL statement (up to ${MAX_SQL} bytes).`);
    const path = execFileSync('opencode', ['debug', 'paths', 'db'], { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (!isAbsolute(path) || !statSync(path).isFile()) throw new Error('Local database file not found; check `opencode debug paths db`.');
    if (operation === 'path') console.log(path);
    else {
      // Native SQLite does not yield to worker termination; a process deadline can kill it.
      const child = fork(fileURLToPath(import.meta.url), ['--query-child'], {
        execArgv: ['--max-old-space-size=256'], silent: true,
      });
      child.stderr.pipe(process.stderr);
      child.stdout.resume();
      for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
        process.once(signal, () => { child.kill('SIGKILL'); process.exit(code); });
      }
      const timer = setTimeout(() => { child.kill('SIGKILL'); console.error('opencode-db: query timed out (30s); narrow the session or time range.'); process.exitCode = 1; }, 30000);
      child.once('message', message => {
        clearTimeout(timer);
        if (message.error) { console.error(`opencode-db: ${message.error}; use schema and select only exposed metadata.`); process.exitCode = 1; }
        else console.log(JSON.stringify(message.result));
      });
      child.once('error', error => { clearTimeout(timer); console.error(`opencode-db: ${error.message}`); process.exitCode = 1; });
      child.once('exit', code => { clearTimeout(timer); if (code !== 0 && !process.exitCode) { console.error('opencode-db: query process failed.'); process.exitCode = 1; } });
      child.send({ path, sql, operation });
    }
  } catch (error) { console.error(`opencode-db: ${error.message}`); process.exitCode = 1; }
}
