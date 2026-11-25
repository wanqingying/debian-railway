"""Run bounded read-only SQL against the local OpenCode v2 metadata."""

import argparse
from contextlib import closing
import json
from pathlib import Path
from secrets import token_hex
import sqlite3
from string import ascii_lowercase, ascii_uppercase
import subprocess
import sys
from time import monotonic


MAX_SQL = 16_384
MAX_ROWS = 100
MAX_BYTES = 24_576
TABLES = {
    "session_v2": frozenset("""
        id project_id workspace_id parent_id fork_session_id fork_boundary directory
        title agent model cost tokens_input tokens_output tokens_reasoning
        tokens_cache_read tokens_cache_write time_created time_updated time_idle
        idle_outcome time_archived time_compacting time_suspended time_busy
    """.split()),
    "session_message": frozenset("id session_id type seq time_created time_updated".split()),
    "session_part": frozenset("message_id session_id ordinal type call_id time_created time_updated".split()),
    "project": frozenset("id worktree vcs name time_created time_updated time_archived".split()),
    "project_directory": frozenset("project_id directory type strategy time_created".split()),
    "worktree": frozenset("project_id directory strategy time_created".split()),
}
USAGE = {
    "provider_id": ("$.model.providerID", "TEXT"),
    "model_id": ("$.model.id", "TEXT"),
    "cost": ("$.cost", "REAL"),
    "tokens_input": ("$.tokens.input", "INTEGER"),
    "tokens_output": ("$.tokens.output", "INTEGER"),
    "tokens_reasoning": ("$.tokens.reasoning", "INTEGER"),
    "tokens_cache_read": ("$.tokens.cache.read", "INTEGER"),
    "tokens_cache_write": ("$.tokens.cache.write", "INTEGER"),
}
JSON_TYPES = {"TEXT": "('text')", "REAL": "('integer', 'real')", "INTEGER": "('integer')"}
ASCII_FOLD = str.maketrans(ascii_uppercase, ascii_lowercase)
FUNCTIONS = frozenset("""
    abs avg cast char coalesce concat count cume_dist date datetime dense_rank
    first_value glob group_concat hex ifnull iif instr json json_array json_extract
    json_object json_quote json_type json_valid julianday lag last_value lead length
    like lower ltrim max min nth_value ntile nullif percent_rank printf rank replace
    round row_number rtrim strftime substr substring sum time total trim typeof
    unicode unixepoch upper
""".split())


def authorize(usage_view, action, table, column, database, source):
    if action in (sqlite3.SQLITE_SELECT, sqlite3.SQLITE_RECURSIVE):
        return sqlite3.SQLITE_OK
    if action == sqlite3.SQLITE_READ:
        table, column, database, source = (
            value.translate(ASCII_FOLD) if value is not None else None
            for value in (table, column, database, source)
        )
        if not column and database is None and table in (*TABLES, "session_usage"):
            return sqlite3.SQLITE_OK  # SQLite's table-only signal for COUNT(*) on views.
        if database == "main" and table in TABLES:
            if column == "" or column in TABLES[table]:
                return sqlite3.SQLITE_OK
            if table == "session_message" and column == "data" and source == usage_view:
                return sqlite3.SQLITE_OK
        if database == "temp" and (column in ("", "message_id", "session_id", "time_created") or column in USAGE):
            if table == "session_usage" or (table == usage_view and source == "session_usage"):
                return sqlite3.SQLITE_OK
    if action == sqlite3.SQLITE_FUNCTION and column in FUNCTIONS:
        return sqlite3.SQLITE_OK
    return sqlite3.SQLITE_DENY


def schema(db):
    tables = {
        name: {column: kind for _, column, kind, *_ in db.execute(f"PRAGMA main.table_info({name})")
               if column in allowed}
        for name, allowed in TABLES.items()
    }
    if not tables["session_v2"] or not tables["session_message"]:
        raise ValueError("OpenCode v2 tables not found; check `opencode debug paths db`.")
    tables["session_usage"] = {
        "message_id": "TEXT", "session_id": "TEXT", "time_created": "INTEGER",
        **{name: kind for name, (_, kind) in USAGE.items()},
    }
    return {name: columns for name, columns in tables.items() if columns}


def prepare(db):
    # SQLite reports CTE names as authorizer sources too. A fixed privileged name
    # could be forged by a user CTE. Keep this internal name fresh per query.
    usage_view = f"usage_{token_hex(16)}"
    # A nested CASE short-circuits malformed JSON before inspecting its fields.
    expressions = ", ".join(
        f"CASE WHEN json_valid(data) THEN CASE WHEN json_type(data, '{path}') IN {JSON_TYPES[kind]} "
        f"THEN CAST(json_extract(data, '{path}') AS {kind}) END END AS {name}"
        for name, (path, kind) in USAGE.items()
    )
    db.execute("PRAGMA trusted_schema=OFF")
    db.execute(f"""CREATE TEMP VIEW {usage_view} AS
        SELECT id AS message_id, session_id, time_created, {expressions}
        FROM main.session_message WHERE type = 'assistant'""")
    db.execute(f"CREATE TEMP VIEW session_usage AS SELECT * FROM temp.{usage_view}")
    db.execute("PRAGMA query_only=ON")
    db.set_authorizer(lambda *args: authorize(usage_view, *args))
    # The busy timeout is separate; the progress handler bounds SQLite execution.
    deadline = monotonic() + 3
    db.set_progress_handler(lambda: monotonic() >= deadline, 1000)
    db.setlimit(sqlite3.SQLITE_LIMIT_LENGTH, 16 * 1024 * 1024)
    db.setlimit(sqlite3.SQLITE_LIMIT_COLUMN, 128)


def dump(value):
    return json.dumps(value, separators=(",", ":"), ensure_ascii=True, allow_nan=False)


def query(db, sql):
    with closing(db.execute(sql)) as cursor:
        if cursor.description is None:
            raise ValueError("Submit one SELECT or WITH ... SELECT statement.")
        columns = [column[0] for column in cursor.description]
        encoded_columns = dump(columns)
        remaining = MAX_BYTES - len(encoded_columns) - 64
        if remaining < 0:
            raise ValueError("Column names exceed the output budget; use shorter aliases.")
        rows = []
        truncated = False
        for row in cursor:
            if len(rows) == MAX_ROWS:
                truncated = True
                break
            if any(isinstance(value, bytes) for value in row):
                raise ValueError("BLOB output is unsupported; select scalar metadata columns.")
            encoded = dump(row)
            if len(encoded) + 1 > remaining:
                truncated = True
                break
            remaining -= len(encoded) + 1
            rows.append(encoded)
        return f'{{"columns":{encoded_columns},"rows":[{",".join(rows)}],"truncated":{dump(truncated)}}}'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=("path", "schema", "query"),
                        help="show the DB path, inspect the live schema, or read one SQL statement from stdin")
    args = parser.parse_args()
    try:
        if args.operation == "query":
            sql = sys.stdin.buffer.read(MAX_SQL + 1)
            if not sql.strip() or len(sql) > MAX_SQL:
                raise ValueError(f"Provide one SQL statement on stdin (up to {MAX_SQL} bytes).")
        path = subprocess.check_output(["opencode", "debug", "paths", "db"],
                                        text=True, timeout=2, stderr=subprocess.DEVNULL).strip()
        if not Path(path).is_absolute() or not Path(path).is_file():
            raise ValueError("Local database file not found; check `opencode debug paths db`.")
        if args.operation == "path":
            print(path)
            return
        with closing(sqlite3.connect(Path(path).as_uri() + "?mode=ro", uri=True, timeout=0.25)) as db:
            tables = schema(db)
            if args.operation == "schema":
                print(dump(tables))
            else:
                prepare(db)
                print(query(db, sql.decode("utf-8")))
    except (OSError, subprocess.SubprocessError):
        parser.exit(1, "opencode-db: cannot resolve the database; check `opencode debug paths db`.\n")
    except sqlite3.Error as error:
        code = getattr(error, "sqlite_errorcode", None)
        if code == sqlite3.SQLITE_INTERRUPT:
            parser.exit(1, "opencode-db: query timed out; narrow the session or time range.\n")
        if code in (sqlite3.SQLITE_AUTH, sqlite3.SQLITE_PERM):
            parser.exit(1, "opencode-db: access denied; use `schema` and select only exposed metadata.\n")
        parser.exit(1, f"opencode-db: {error}; use `schema` to check names and submit one read-only statement.\n")
    except ValueError as error:
        parser.exit(1, f"opencode-db: {error}\n")


if __name__ == "__main__":
    main()
