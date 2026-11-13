"""Regression tests for `server/engines.py`, using a stub DB-API connection.

The bug this guards against: `execute_sql` used to roll back every statement on
non-SQLite engines, so a permitted `INSERT` returned "ok, 0 rows" and silently
vanished when the connection closed. Run it through `dev/engines.test.mjs`
(`npm run test:engines`), which picks the right interpreter.
"""

from __future__ import annotations

import importlib.util
import os
import sys
import unittest
from pathlib import Path

PACKAGE = Path(__file__).resolve().parent.parent
# `server/main.py` runs with its own directory first on sys.path, which is how
# `engines.py` reaches `import writes`. Loading it by path here has to set the
# same thing up, or the module fails to import before any test runs.
sys.path.insert(0, str(PACKAGE / "server"))
SPEC = importlib.util.spec_from_file_location("db_mcp_engines", PACKAGE / "server" / "engines.py")
engines = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(engines)


class FakeCursor:
    """Minimal DB-API cursor: records the statement, yields canned rows."""

    def __init__(self, rowcount: int = -1, description=None, rows=()):
        self.rowcount = rowcount
        self.description = description
        self._rows = list(rows)
        self.executed: list[str] = []
        self.closed = False
        self.fail_with: Exception | None = None

    def execute(self, sql: str) -> None:
        self.executed.append(sql)
        if self.fail_with is not None:
            raise self.fail_with

    def __iter__(self):
        return iter(self._rows)

    def close(self) -> None:
        self.closed = True


class PsycopgLikeCursor(FakeCursor):
    """A cursor that raises when iterated without a result set, as psycopg does.

    `psycopg` answers `"the last operation didn't produce records"` when a write
    statement is iterated. That exception used to escape `_rows()` before
    `connection.commit()`, so the write was rolled back even though the server
    had applied it.
    """

    def __iter__(self):
        if not self.description:
            raise RuntimeError("the last operation didn't produce records")
        return iter(self._rows)


class FakeConnection:
    def __init__(self, cursor: FakeCursor):
        self._cursor = cursor
        self.commits = 0
        self.rollbacks = 0

    def cursor(self):
        return self._cursor

    def commit(self) -> None:
        self.commits += 1

    def rollback(self) -> None:
        self.rollbacks += 1


CONFIG = {
    "sqlite": {},
    "postgres": {"schema": "public"},
    "gauss": {"schema": "public"},
    "mysql": {"database": "testdb"},
    "oracle": {"user": "TEST"},
}
DEFAULT_SCHEMA = {"sqlite": "main", "postgres": "public", "gauss": "public", "mysql": "testdb", "oracle": "TEST"}


def profile(kind: str, read_only: bool = False) -> dict:
    """A source that may write, with the schema its unqualified writes land in."""
    return {
        "id": f"{kind}-test",
        "kind": kind,
        "config": dict(CONFIG[kind]),
        "readOnly": read_only,
        "writableSchemas": [DEFAULT_SCHEMA[kind]],
    }


class WritePermission(unittest.TestCase):
    def setUp(self):
        self._previous = os.environ.get("DB_MCP_ALLOW_WRITE")

    def tearDown(self):
        if self._previous is None:
            os.environ.pop("DB_MCP_ALLOW_WRITE", None)
        else:
            os.environ["DB_MCP_ALLOW_WRITE"] = self._previous

    def allow_write(self, allowed: bool = True):
        os.environ["DB_MCP_ALLOW_WRITE"] = "1" if allowed else "0"

    def test_insert_is_committed_on_mysql(self):
        self.allow_write()
        connection = FakeConnection(FakeCursor(rowcount=1))
        result = engines.execute_sql(profile("mysql"), connection, "insert into products (id) values (1)", 200)
        self.assertEqual(connection.commits, 1, "a MySQL write must be committed, not rolled back")
        self.assertEqual(connection.rollbacks, 0)
        self.assertEqual(result["affectedRows"], 1)
        self.assertEqual(result["rows"], [])

    def test_insert_is_committed_on_postgres_and_oracle(self):
        self.allow_write()
        for kind in ("postgres", "oracle"):
            with self.subTest(kind=kind):
                connection = FakeConnection(FakeCursor(rowcount=3))
                result = engines.execute_sql(profile(kind), connection, "update t set a = 1", 200)
                self.assertEqual(connection.commits, 1, f"{kind} write not committed")
                self.assertEqual(connection.rollbacks, 0)
                self.assertEqual(result["affectedRows"], 3)

    def test_select_still_rolls_back(self):
        self.allow_write()
        cursor = FakeCursor(rowcount=-1, description=[("n",)], rows=[(1,)])
        connection = FakeConnection(cursor)
        result = engines.execute_sql(profile("mysql"), connection, "select 1 as n", 200)
        self.assertEqual(connection.commits, 0, "a read must not commit")
        self.assertEqual(connection.rollbacks, 1, "a read must release the session")
        self.assertNotIn("affectedRows", result)
        self.assertEqual(result["rows"], [[1]])
        self.assertTrue(cursor.closed)

    def test_leading_comment_is_still_a_read(self):
        self.allow_write()
        connection = FakeConnection(FakeCursor(description=[("n",)], rows=[(1,)]))
        engines.execute_sql(profile("mysql"), connection, "-- note\nselect 1", 200)
        self.assertEqual(connection.commits, 0)
        self.assertEqual(connection.rollbacks, 1)

    def test_sqlite_write_is_committed(self):
        self.allow_write()
        connection = FakeConnection(FakeCursor(rowcount=1))
        result = engines.execute_sql(profile("sqlite"), connection, "insert into t values (1)", 200)
        # `sqlite3.connect` uses the legacy implicit-transaction mode: without this
        # commit the row would vanish with the connection too.
        self.assertEqual(connection.commits, 1, "a SQLite write must be committed")
        self.assertEqual(connection.rollbacks, 0)
        self.assertEqual(result["affectedRows"], 1)

    def test_unknown_rowcount_omits_affected_rows(self):
        self.allow_write()
        connection = FakeConnection(FakeCursor(rowcount=-1))
        result = engines.execute_sql(profile("mysql"), connection, "create table t (id int)", 200)
        self.assertEqual(connection.commits, 1)
        self.assertNotIn("affectedRows", result)

    def test_global_switch_off_refuses_before_touching_the_database(self):
        self.allow_write(False)
        cursor = FakeCursor(rowcount=1)
        connection = FakeConnection(cursor)
        with self.assertRaises(engines.DbError) as caught:
            engines.execute_sql(profile("mysql"), connection, "delete from products", 200)
        self.assertEqual(caught.exception.code, "user_error")
        self.assertEqual(cursor.executed, [], "refused writes must not reach the driver")
        self.assertEqual(connection.commits, 0)

    def test_read_only_source_refuses_the_write(self):
        self.allow_write()
        cursor = FakeCursor(rowcount=1)
        connection = FakeConnection(cursor)
        with self.assertRaises(engines.DbError) as caught:
            engines.execute_sql(profile("mysql", read_only=True), connection, "insert into products (id) values (9)", 200)
        self.assertEqual(caught.exception.code, "user_error")
        self.assertEqual(cursor.executed, [])
        self.assertEqual(connection.commits, 0)

    def test_read_only_source_still_reads(self):
        self.allow_write()
        connection = FakeConnection(FakeCursor(rowcount=-1, description=[("n",)], rows=[(1,)]))
        result = engines.execute_sql(profile("postgres", read_only=True), connection, "select 1", 200)
        self.assertEqual(result["rowCount"], 1)
        self.assertEqual(connection.commits, 0)
        self.assertEqual(connection.rollbacks, 1)

    def test_write_without_result_set_is_still_committed(self):
        """A driver that raises on iterating a write must not undo the commit."""
        self.allow_write()
        cursor = PsycopgLikeCursor(rowcount=1)
        connection = FakeConnection(cursor)
        result = engines.execute_sql(profile("gauss"), connection, "insert into demo_items (id) values (1)", 200)
        self.assertEqual(connection.commits, 1, "the write must be committed, not lost to the read attempt")
        self.assertEqual(connection.rollbacks, 0)
        self.assertEqual(result["rows"], [])
        self.assertEqual(result["columns"], [])
        self.assertEqual(result["affectedRows"], 1)

    def test_failed_write_is_not_committed(self):
        self.allow_write()
        cursor = FakeCursor(rowcount=1)
        cursor.fail_with = RuntimeError("duplicate key")
        connection = FakeConnection(cursor)
        with self.assertRaises(RuntimeError):
            engines.execute_sql(profile("mysql"), connection, "insert into t values (1)", 200)
        self.assertEqual(connection.commits, 0, "a failed statement must not be committed")
        self.assertTrue(cursor.closed)


class RenderContract(unittest.TestCase):
    """`affectedRows` is surfaced for writes and absent for reads: keys only."""

    def test_write_result_shape(self):
        os.environ["DB_MCP_ALLOW_WRITE"] = "1"
        result = engines.execute_sql(profile("mysql"), FakeConnection(FakeCursor(rowcount=2)), "update t set a = 1", 200)
        self.assertEqual(sorted(result), ["affectedRows", "columns", "elapsedMs", "rowCount", "rows", "sql", "truncated"])
        self.assertEqual(result["rowCount"], 0)
        self.assertEqual(result["affectedRows"], 2)


if __name__ == "__main__":
    sys.exit(unittest.main(verbosity=2))
