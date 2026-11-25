"""Exercise the documented CLI against a disposable OpenCode v2 fixture."""

import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).with_name("query.py")


class QueryTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        directory = tempfile.TemporaryDirectory()
        cls.addClassCleanup(directory.cleanup)
        cls.path = Path(directory.name) / "opencode.db"
        db = sqlite3.connect(cls.path)
        try:
            db.executescript("""
                CREATE TABLE credential(secret TEXT);
                INSERT INTO credential VALUES ('not-public');
                CREATE TABLE session_v2(id TEXT PRIMARY KEY, title TEXT, metadata TEXT);
                INSERT INTO session_v2 VALUES ('s1', 'Example', 'not-public');
                CREATE TABLE session_message(id TEXT, session_id TEXT, type TEXT, time_created INTEGER, data TEXT);
                INSERT INTO session_message VALUES ('m1', 's1', 'assistant', 123,
                   '{"model":{"providerID":"test","id":"m"},"tokens":{"input":42},"content":"not-public"}');
                INSERT INTO session_message VALUES
                    ('m2', 's1', 'assistant', 124, '{"model":{"providerID":{}},"tokens":{"input":[1,2]}}'),
                    ('m3', 's1', 'assistant', 125, 'malformed'),
                    ('m4', 's1', 'user', 126, '{"tokens":{"input":99}}');
            """)
        finally:
            db.close()

    def cli(self, operation, sql=""):
        return subprocess.run([sys.executable, str(SCRIPT), operation], input=sql,
                              capture_output=True, text=True, timeout=6,
                              env={**os.environ, "OPENCODE_DB": str(self.path)})

    def result(self, operation, sql=""):
        result = self.cli(operation, sql)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def test_schema_and_join(self):
        path = self.cli("path")
        self.assertEqual(path.returncode, 0, path.stderr)
        self.assertEqual(path.stdout.strip(), str(self.path))
        tables = self.result("schema")
        self.assertEqual(set(tables), {"session_v2", "session_message", "session_usage"})
        self.assertNotIn("data", tables["session_message"])
        self.assertNotIn("metadata", tables["session_v2"])
        result = self.result("query", """
            WITH recent AS (SELECT id FROM session_v2 WHERE title = 'Example')
            SELECT provider_id, model_id, SUM(tokens_input), SUM(tokens_output)
            FROM session_usage JOIN recent ON recent.id = session_usage.session_id
            WHERE provider_id IS NOT NULL
            GROUP BY 1, 2;
        """)
        self.assertEqual(result["rows"], [["test", "m", 42, None]])

    def test_usage_filters_types_and_accepts_uppercase(self):
        self.assertEqual(self.result("query", "SELECT COUNT(*) FROM SESSION_MESSAGE")["rows"], [[4]])
        result = self.result("query", "SELECT MESSAGE_ID, PROVIDER_ID, TOKENS_INPUT FROM SESSION_USAGE ORDER BY 1")
        self.assertEqual(result["rows"], [["m1", "test", 42], ["m2", None, None], ["m3", None, None]])

    def test_denied(self):
        for sql in (
            "SELECT secret FROM credential",
            "SELECT metadata FROM session_v2",
            "SELECT data FROM session_message",
            "WITH session_usage AS (SELECT data FROM session_message) SELECT data FROM session_usage",
            "WITH SESSION_USAGE AS (SELECT DATA FROM SESSION_MESSAGE) SELECT DATA FROM SESSION_USAGE",
            "SELECT name FROM sqlite_schema",
            "DELETE FROM session_v2",
            "ATTACH DATABASE ':memory:' AS other",
            "PRAGMA writable_schema=ON",
            "SELECT load_extension('unused')",
            "SELECT 1; SELECT 2",
        ):
            with self.subTest(sql=sql):
                result = self.cli("query", sql)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(result.stdout, "")
                self.assertIn("opencode-db:", result.stderr)

    def test_budgets(self):
        result = self.result("query", """
            WITH RECURSIVE nums(n) AS (VALUES (1) UNION ALL SELECT n+1 FROM nums WHERE n < 101)
            SELECT n FROM nums ORDER BY n;
        """)
        self.assertEqual(len(result["rows"]), 100)
        self.assertTrue(result["truncated"])
        result = self.result("query", "SELECT printf('%30000s', 'x')")
        self.assertEqual(result["rows"], [])
        self.assertTrue(result["truncated"])
        result = self.cli("query", """
            WITH RECURSIVE nums(n) AS (VALUES (1) UNION ALL SELECT n+1 FROM nums)
            SELECT SUM(n) FROM nums;
        """)
        self.assertEqual(result.returncode, 1)
        self.assertIn("query timed out", result.stderr)


if __name__ == "__main__":
    unittest.main()
