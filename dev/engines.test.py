"""Regression tests for `server/engines.py`, using a stub DB-API connection.

The bug this guards against: `execute_sql` used to roll back every statement on
non-SQLite engines, so a permitted `INSERT` returned "ok, 0 rows" and silently
vanished when the connection closed. Run it through `dev/engines.test.mjs`
(`npm run test:engines`), which picks the right interpreter.
"""

from __future__ import annotations

import importlib.util
import json
import os
import shutil
import socket
import sqlite3
import ssl
import sys
import tempfile
import time
import unittest
from pathlib import Path

# Recorded before any test can install the shim: the shim only exists to replace
# a `ssl.wrap_socket` that Python 3.12 removed, so on an older interpreter the
# two cases below have nothing to prove.
HAS_NATIVE_WRAP_SOCKET = hasattr(ssl, "wrap_socket")

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

    def execute(self, sql: str, params=None) -> None:
        self.executed.append(sql)
        if self.fail_with is not None:
            raise self.fail_with

    def fetchall(self):
        return list(self._rows)

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
        self.cursor_calls: list[dict] = []

    def cursor(self, *args, **kwargs):
        self.cursor_calls.append({"args": args, "kwargs": dict(kwargs)})
        return self._cursor

    def commit(self) -> None:
        self.commits += 1

    def rollback(self) -> None:
        self.rollbacks += 1


class ServerSideCursorConnection(FakeConnection):
    """A connection whose `cursor(name=…)` really returns a different cursor.

    psycopg3 needs the `name` argument to hand back a server-side cursor; a stub
    that ignores it cannot tell the two paths apart, which is how the memory
    problem stayed invisible.
    """

    def __init__(self, plain: FakeCursor, named: FakeCursor):
        super().__init__(plain)
        self._plain = plain
        self._named = named
        self.named_calls = 0

    def cursor(self, *args, **kwargs):
        self.cursor_calls.append({"args": args, "kwargs": dict(kwargs)})
        if kwargs.get("name"):
            self.named_calls += 1
            return self._named
        return self._plain


class FakeSqliteConnection(FakeConnection):
    """Records the progress handler, so arming and disarming are observable."""

    def __init__(self, cursor: FakeCursor):
        super().__init__(cursor)
        self.handlers: list = []

    def set_progress_handler(self, handler, steps):
        self.handlers.append((handler, steps))


CONFIG = {
    "sqlite": {},
    "postgres": {"schema": "public"},
    "gauss": {"schema": "public"},
    "mysql": {"database": "testdb"},
    "oracle": {"user": "TEST"},
}


class LiveSettings(unittest.TestCase):
    """The panel's switches are read from `settings.json`, on every call.

    The bug this guards against: `allowWrite` and the text policy were read once,
    when the process started. Flipping a switch in the panel therefore had to
    replace both Python children — and could never reach the stdio process an
    outside client had started, which no restart of ours can replace.

    The environment still wins when it says something, which is why the classes
    above can keep flipping `DB_MCP_ALLOW_WRITE` without writing a settings file.
    """

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.saved_runtime = os.environ.get("DB_MCP_RUNTIME")
        self.saved_write = os.environ.get("DB_MCP_ALLOW_WRITE")
        self.saved_policy = os.environ.get("DB_MCP_TEXT_POLICY")
        self.saved_policy_value = engines.TEXT_POLICY
        os.environ["DB_MCP_RUNTIME"] = self.tmp.name
        os.environ.pop("DB_MCP_ALLOW_WRITE", None)
        os.environ.pop("DB_MCP_TEXT_POLICY", None)

    def tearDown(self):
        engines.TEXT_POLICY = self.saved_policy_value
        for key, value in (
            ("DB_MCP_RUNTIME", self.saved_runtime),
            ("DB_MCP_ALLOW_WRITE", self.saved_write),
            ("DB_MCP_TEXT_POLICY", self.saved_policy),
        ):
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        self.tmp.cleanup()

    def _write(self, **payload):
        (Path(self.tmp.name) / "settings.json").write_text(json.dumps(payload), encoding="utf-8")

    def test_no_settings_file_reads_as_no_permission(self):
        self.assertFalse(engines.allow_write())

    def test_the_write_switch_comes_from_the_file_when_the_environment_is_silent(self):
        self._write(allowWrite=True)
        self.assertTrue(engines.allow_write())
        self._write(allowWrite=False)
        self.assertFalse(engines.allow_write(), "a rewrite must be seen on the next call")

    def test_only_a_real_true_grants_a_write(self):
        for value in ("true", 1, "yes", None):
            with self.subTest(value=value):
                self._write(allowWrite=value)
                self.assertFalse(engines.allow_write())

    def test_the_environment_still_overrides_the_file(self):
        self._write(allowWrite=True)
        os.environ["DB_MCP_ALLOW_WRITE"] = "0"
        self.assertFalse(engines.allow_write())
        self._write(allowWrite=False)
        os.environ["DB_MCP_ALLOW_WRITE"] = "1"
        self.assertTrue(engines.allow_write())

    def test_the_text_policy_is_refreshed_from_the_file(self):
        self._write(textPolicy="full")
        engines.apply_settings()
        self.assertEqual(engines.TEXT_POLICY, "full")
        long = "x" * 300
        self.assertEqual(engines._cell(long), long)
        self._write(textPolicy="auto")
        engines.apply_settings()
        self.assertEqual(engines.TEXT_POLICY, "auto")
        self.assertIn("…(300 chars)…", engines._cell(long))

    def test_an_unknown_policy_in_the_file_falls_back_to_auto(self):
        self._write(textPolicy="headtail")
        engines.apply_settings()
        self.assertEqual(engines.TEXT_POLICY, "auto")

    def test_an_exported_policy_wins_over_the_file(self):
        os.environ["DB_MCP_TEXT_POLICY"] = "auto"
        self._write(textPolicy="full")
        engines.apply_settings()
        self.assertEqual(engines.TEXT_POLICY, "auto")

    def test_a_settings_document_can_be_passed_in(self):
        self._write(textPolicy="auto")
        engines.apply_settings({"textPolicy": "full"})
        self.assertEqual(engines.TEXT_POLICY, "full")

    def test_a_corrupt_settings_file_is_no_preference_not_a_crash(self):
        (Path(self.tmp.name) / "settings.json").write_text("{not json", encoding="utf-8")
        self.assertFalse(engines.allow_write())
        engines.apply_settings()
        self.assertEqual(engines.TEXT_POLICY, "auto")


class SettingsCache(unittest.TestCase):
    """`store.load_settings` is called on every tool call, so it caches the parse.

    A cache that merely expires after a fixed delay is not enough: the panel writes
    the file, and the very next call has to see it. These cases pin that, and pin
    that a rewrite is noticed even when it lands with the same length.
    """

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.saved = os.environ.get("DB_MCP_RUNTIME")
        os.environ["DB_MCP_RUNTIME"] = self.tmp.name
        import store

        self.store = store
        self.path = Path(self.tmp.name) / "settings.json"
        store._settings_cache = None

    def tearDown(self):
        self.store._settings_cache = None
        if self.saved is None:
            os.environ.pop("DB_MCP_RUNTIME", None)
        else:
            os.environ["DB_MCP_RUNTIME"] = self.saved
        self.tmp.cleanup()

    def test_a_missing_file_is_an_empty_document(self):
        self.assertEqual(self.store.load_settings(), {})

    def test_a_rewrite_is_visible_on_the_very_next_call(self):
        self.path.write_text(json.dumps({"allowWrite": False}), encoding="utf-8")
        self.assertFalse(self.store.load_settings()["allowWrite"])
        self.path.write_text(json.dumps({"allowWrite": True}), encoding="utf-8")
        self.assertTrue(self.store.load_settings()["allowWrite"])

    def test_a_same_length_rewrite_is_still_noticed(self):
        # `auto` and `full` are the same length, so a cache keyed on size — or one
        # that trusts a timestamp with a coarse granularity — would hand back the
        # old policy. The bytes themselves have to be compared.
        self.path.write_text(json.dumps({"textPolicy": "auto"}), encoding="utf-8")
        self.assertEqual(self.store.load_settings()["textPolicy"], "auto")
        self.path.write_text(json.dumps({"textPolicy": "full"}), encoding="utf-8")
        self.assertEqual(self.store.load_settings()["textPolicy"], "full")

    def test_a_corrupt_file_reads_as_no_preference(self):
        self.path.write_text("{not json", encoding="utf-8")
        self.assertEqual(self.store.load_settings(), {})


def profile(kind: str, read_only: bool = False, allow_ddl: bool = False) -> dict:
    """A source that may write; unqualified writes land in its default schema."""
    return {
        "id": f"{kind}-test",
        "kind": kind,
        "config": dict(CONFIG[kind]),
        "readOnly": read_only,
        "allowDdl": allow_ddl,
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
        result = engines.execute_sql(profile("mysql", allow_ddl=True), connection, "create table t (id int)", 200)
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

    def test_ddl_without_the_switch_never_reaches_the_driver(self):
        self.allow_write()
        cursor = FakeCursor(rowcount=-1)
        connection = FakeConnection(cursor)
        with self.assertRaises(engines.DbError) as caught:
            engines.execute_sql(profile("mysql"), connection, "drop table products", 200)
        self.assertEqual(caught.exception.code, "user_error")
        self.assertIn("does not allow DDL", caught.exception.message)
        self.assertEqual(cursor.executed, [], "a refused drop must not reach the driver")
        self.assertEqual(connection.commits, 0)

    def test_ddl_reaches_the_driver_once_the_switch_is_on(self):
        self.allow_write()
        cursor = FakeCursor(rowcount=-1)
        connection = FakeConnection(cursor)
        engines.execute_sql(profile("mysql", allow_ddl=True), connection, "create table t (id int)", 200)
        self.assertEqual(len(cursor.executed), 1)
        self.assertEqual(connection.commits, 1)


class GuardChain(unittest.TestCase):
    """The read/write decision, end to end, through `execute_sql` and `explain_query`.

    The bug this guards against: `ensure_readable` only looked at the first
    keyword, so `select 1; drop table t` was allowed because it started with
    `select`, and `writes.check` was never called.
    """

    def setUp(self):
        self._previous = os.environ.get("DB_MCP_ALLOW_WRITE")

    def tearDown(self):
        if self._previous is None:
            os.environ.pop("DB_MCP_ALLOW_WRITE", None)
        else:
            os.environ["DB_MCP_ALLOW_WRITE"] = self._previous

    def allow_write(self, allowed: bool = True):
        os.environ["DB_MCP_ALLOW_WRITE"] = "1" if allowed else "0"

    def refused(self, sql: str, kind: str = "postgres", read_only: bool = False, allow_ddl: bool = False):
        """Run `sql` and return the DbError it raised, asserting nothing reached the driver."""
        cursor = FakeCursor(rowcount=-1)
        connection = FakeConnection(cursor)
        with self.assertRaises(engines.DbError) as caught:
            engines.execute_sql(profile(kind, read_only=read_only, allow_ddl=allow_ddl), connection, sql, 200)
        self.assertEqual(cursor.executed, [], "a refused statement must not reach the driver")
        self.assertEqual(connection.commits, 0)
        return caught.exception

    def test_a_batch_is_refused_even_when_it_starts_with_select(self):
        self.allow_write()
        error = self.refused("select 1; drop table t", kind="sqlite")
        self.assertEqual(error.code, "user_error")
        self.assertIn("2 statements", error.message)
        self.assertIn("one at a time", error.hint)

    def test_a_batch_is_refused_on_a_writable_source_with_ddl_on(self):
        # Even a source that allows DDL takes one statement per call: the point
        # is that a half-applied batch cannot be reported honestly.
        self.allow_write()
        error = self.refused("select 1; select 2", allow_ddl=True)
        self.assertIn("2 statements", error.message)

    def test_a_semicolon_inside_a_string_is_not_a_batch(self):
        self.allow_write()
        cursor = FakeCursor(description=[("note",)], rows=[("a;b",)])
        connection = FakeConnection(cursor)
        result = engines.execute_sql(profile("sqlite"), connection, "select 'a;b' as note", 200)
        self.assertEqual(result["rows"], [["a;b"]])
        self.assertEqual(len(cursor.executed), 1)

    def test_a_trailing_semicolon_is_still_one_statement(self):
        self.allow_write()
        cursor = FakeCursor(description=[("n",)], rows=[(1,)])
        connection = FakeConnection(cursor)
        result = engines.execute_sql(profile("sqlite"), connection, "select 1 as n;", 200)
        self.assertEqual(result["rowCount"], 1)

    def test_a_leading_comment_does_not_hide_a_ddl_batch(self):
        self.allow_write()
        error = self.refused("-- tidy up\n/* why not */ drop table t")
        self.assertIn("does not allow DDL", error.message)

    def test_a_cte_that_deletes_is_a_write_and_is_committed(self):
        self.allow_write()
        cursor = FakeCursor(rowcount=2)
        connection = FakeConnection(cursor)
        result = engines.execute_sql(
            profile("postgres"),
            connection,
            "with gone as (delete from orders where id = 1 returning id) select * from gone",
            200,
        )
        self.assertEqual(connection.commits, 1, "a data-changing CTE must be committed, not rolled back")
        self.assertEqual(connection.rollbacks, 0)
        self.assertEqual(result["affectedRows"], 2)

    def test_a_cte_that_deletes_is_refused_when_the_switch_is_off(self):
        self.allow_write(False)
        error = self.refused("with gone as (delete from orders returning id) select * from gone")
        self.assertIn("writes are disabled", error.message)

    def test_a_cte_that_only_reads_is_still_a_read(self):
        self.allow_write()
        cursor = FakeCursor(description=[("n",)], rows=[(1,)])
        connection = FakeConnection(cursor)
        engines.execute_sql(profile("postgres"), connection, "with x as (select 1 as n) select * from x", 200)
        self.assertEqual(connection.commits, 0)
        self.assertEqual(connection.rollbacks, 1)

    def test_a_write_word_inside_a_string_does_not_make_a_read_a_write(self):
        self.allow_write()
        cursor = FakeCursor(description=[("n",)], rows=[(1,)])
        connection = FakeConnection(cursor)
        engines.execute_sql(profile("postgres"), connection, "with x as (select 1) select * from x where 'delete' = 'delete'", 200)
        self.assertEqual(connection.commits, 0, "a quoted word must not turn a read into a write")

    def test_set_search_path_is_allowed_on_a_read_only_source(self):
        self.allow_write(False)
        cursor = FakeCursor(description=[("n",)], rows=[(1,)])
        connection = FakeConnection(cursor)
        engines.execute_sql(profile("postgres", read_only=True), connection, "set search_path to public", 200)
        self.assertEqual(len(cursor.executed), 1)

    def test_any_other_set_is_refused_on_a_read_only_source(self):
        # The global switch stays on so the refusal can only come from the source.
        self.allow_write()
        error = self.refused("set default_transaction_read_only = off", read_only=True)
        self.assertIn("read-only", error.message)

    def test_set_is_refused_on_a_read_only_mysql_source_too(self):
        self.allow_write()
        error = self.refused("set autocommit = 1", kind="mysql", read_only=True)
        self.assertIn("read-only", error.message)

    def test_mysql_names_is_allowed(self):
        self.allow_write(False)
        cursor = FakeCursor()
        connection = FakeConnection(cursor)
        engines.execute_sql(profile("mysql", read_only=True), connection, "set names utf8mb4", 200)
        self.assertEqual(len(cursor.executed), 1)

    def test_a_reporting_pragma_is_allowed_on_a_read_only_sqlite_source(self):
        self.allow_write(False)
        cursor = FakeCursor(description=[("name",)], rows=[("id",)])
        connection = FakeConnection(cursor)
        engines.execute_sql(profile("sqlite", read_only=True), connection, "pragma table_info('orders')", 200)
        self.assertEqual(len(cursor.executed), 1)

    def test_a_pragma_that_sets_is_refused(self):
        self.allow_write()
        error = self.refused("pragma journal_mode = wal", kind="sqlite", read_only=True)
        self.assertIn("read-only", error.message)

    def test_a_pragma_argument_form_that_writes_is_refused(self):
        self.allow_write()
        error = self.refused("pragma journal_mode(wal)", kind="sqlite", read_only=True)
        self.assertIn("read-only", error.message)

    def test_an_unknown_pragma_is_refused(self):
        self.allow_write()
        error = self.refused("pragma writable_schema = on", kind="sqlite", read_only=True)
        self.assertIn("read-only", error.message)

    def test_explain_of_a_write_only_plans(self):
        self.allow_write(False)
        cursor = FakeCursor(description=[("plan",)], rows=[("scan",)])
        connection = FakeConnection(cursor)
        engines.execute_sql(profile("postgres", read_only=True), connection, "explain delete from t", 200)
        self.assertEqual(len(cursor.executed), 1, "EXPLAIN does not run the statement, so it is a read")

    def test_explain_analyze_of_a_write_is_a_write(self):
        self.allow_write()
        error = self.refused("explain analyze delete from t", read_only=True)
        self.assertIn("read-only", error.message)

    def test_explain_analyze_of_a_read_is_a_read(self):
        self.allow_write(False)
        cursor = FakeCursor(description=[("plan",)], rows=[("scan",)])
        connection = FakeConnection(cursor)
        engines.execute_sql(profile("postgres", read_only=True), connection, "explain analyze select 1", 200)
        self.assertEqual(len(cursor.executed), 1)

    def test_explain_query_refuses_a_batch(self):
        self.allow_write()
        cursor = FakeCursor(description=[("plan",)], rows=[("scan",)])
        connection = FakeConnection(cursor)
        with self.assertRaises(engines.DbError) as caught:
            engines.explain_query(profile("postgres"), connection, "explain select 1; drop table t")
        self.assertIn("2 statements", caught.exception.message)
        self.assertEqual(cursor.executed, [])

    def test_explain_query_runs_one_statement(self):
        self.allow_write()
        cursor = FakeCursor(description=[("plan",)], rows=[("scan",)])
        connection = FakeConnection(cursor)
        result = engines.explain_query(profile("postgres"), connection, "select 1")
        self.assertEqual(result["sql"], "select 1")
        self.assertEqual(cursor.executed, ["EXPLAIN select 1"])

    def test_an_oracle_anonymous_block_stays_one_statement(self):
        self.allow_write()
        block = "begin\n  update t set a = 1;\n  commit;\nend;"
        self.assertEqual(engines.statements_of(block, "oracle"), [block])

    def test_an_empty_statement_is_refused(self):
        self.allow_write()
        cursor = FakeCursor()
        connection = FakeConnection(cursor)
        with self.assertRaises(engines.DbError) as caught:
            engines.execute_sql(profile("sqlite"), connection, "   ", 200)
        self.assertEqual(caught.exception.code, "user_error")
        self.assertEqual(cursor.executed, [])

    def test_full_text_keeps_a_long_cell(self):
        self.allow_write()
        long = "x" * 300
        cursor = FakeCursor(description=[("body",)], rows=[(long,)])
        connection = FakeConnection(cursor)
        engines.TEXT_POLICY = "auto"
        try:
            plain = engines.execute_sql(profile("sqlite"), connection, "select body from t", 200)
            full = engines.execute_sql(profile("sqlite"), connection, "select body from t", 200, True)
        finally:
            engines.TEXT_POLICY = "auto"
        self.assertIn("(300 chars)", plain["rows"][0][0])
        self.assertEqual(full["rows"][0][0], long)


class SslMapping(unittest.TestCase):
    """`sslMode` reaches the driver instead of sitting unused in the config.

    The field was stored by the importer and never read, so a source that said
    `require` still connected in plaintext — the exact failure a user cannot see.
    """

    def test_unset_stays_unset(self):
        # psycopg already defaults to `prefer`; writing the value out would
        # change the behaviour of a source saved before the field existed.
        self.assertIsNone(engines._pg_sslmode({}))
        self.assertIsNone(engines._pg_sslmode({"sslMode": "  "}))

    def test_postgres_modes_pass_through(self):
        for mode in ("disable", "allow", "prefer", "require", "verify-ca", "verify-full"):
            self.assertEqual(engines._pg_sslmode({"sslMode": mode}), mode)

    def test_postgres_accepts_the_mysql_spelling(self):
        # A PostgreSQL source copied from a MySQL connection carries
        # `verify_ca`; refusing it would silently drop back to plaintext.
        self.assertEqual(engines._pg_sslmode({"sslMode": "verify_ca"}), "verify-ca")
        self.assertEqual(engines._pg_sslmode({"sslMode": "verify_identity"}), "verify-full")
        self.assertEqual(engines._pg_sslmode({"sslMode": "required"}), "require")

    def test_an_unknown_mode_does_not_crash_the_connection(self):
        self.assertIsNone(engines._pg_sslmode({"sslMode": "on"}))

    def test_mysql_required_skips_verification(self):
        context = engines._mysql_tls({"sslMode": "required"})["ssl"]
        self.assertIsNotNone(context)
        self.assertFalse(context.check_hostname)
        self.assertEqual(context.verify_mode, engines.ssl.CERT_NONE)

    def test_mysql_verify_identity_checks_the_hostname(self):
        context = engines._mysql_tls({"sslMode": "verify_identity"})["ssl"]
        self.assertTrue(context.check_hostname)
        self.assertEqual(context.verify_mode, engines.ssl.CERT_REQUIRED)

    def test_mysql_verify_ca_checks_the_chain_only(self):
        context = engines._mysql_tls({"sslMode": "verify_ca"})["ssl"]
        self.assertFalse(context.check_hostname)
        self.assertEqual(context.verify_mode, engines.ssl.CERT_REQUIRED)

    def test_mysql_disable_actually_turns_tls_off(self):
        # PyMySQL 2.x negotiates TLS whenever the server offers it, so returning
        # "no argument" for `disable` left the connection encrypted. The driver
        # needs `ssl_disabled` to refuse it.
        for mode in ("disable", "disabled", "allow"):
            self.assertEqual(engines._mysql_tls({"sslMode": mode}), {"ssl_disabled": True})

    def test_mysql_unset_and_prefer_leave_the_driver_default(self):
        for mode in (None, "", "preferred", "prefer"):
            self.assertEqual(engines._mysql_tls({"sslMode": mode} if mode is not None else {}), {})


class RenderContract(unittest.TestCase):
    """`affectedRows` is surfaced for writes and absent for reads: keys only."""

    def test_write_result_shape(self):
        os.environ["DB_MCP_ALLOW_WRITE"] = "1"
        result = engines.execute_sql(profile("mysql"), FakeConnection(FakeCursor(rowcount=2)), "update t set a = 1", 200)
        self.assertEqual(sorted(result), ["affectedRows", "columns", "elapsedMs", "rowCount", "rows", "sql", "truncated"])
        self.assertEqual(result["rowCount"], 0)
        self.assertEqual(result["affectedRows"], 2)


class ResourceLimits(unittest.TestCase):
    """A query that runs too long, or returns too much, is stopped rather than buffered.

    Before this, the only bound was `connect_timeout=10`: a statement could run
    for as long as the server allowed, and `max_rows` trimmed the *output* of a
    result set the driver had already loaded in full.
    """

    def setUp(self):
        self._previous = os.environ.get("DB_MCP_ALLOW_WRITE")
        self._previous_timeout = engines.STATEMENT_TIMEOUT_MS
        os.environ["DB_MCP_ALLOW_WRITE"] = "1"

    def tearDown(self):
        engines.STATEMENT_TIMEOUT_MS = self._previous_timeout
        if self._previous is None:
            os.environ.pop("DB_MCP_ALLOW_WRITE", None)
        else:
            os.environ["DB_MCP_ALLOW_WRITE"] = self._previous

    def test_the_default_is_thirty_seconds(self):
        os.environ.pop("DB_MCP_STATEMENT_TIMEOUT_MS", None)
        self.assertEqual(engines.statement_timeout_ms(), 30_000)

    def test_a_bad_value_keeps_the_default(self):
        os.environ["DB_MCP_STATEMENT_TIMEOUT_MS"] = "soon"
        try:
            self.assertEqual(engines.statement_timeout_ms(), engines.DEFAULT_STATEMENT_TIMEOUT_MS)
        finally:
            os.environ.pop("DB_MCP_STATEMENT_TIMEOUT_MS", None)

    def test_zero_disables_the_limit(self):
        os.environ["DB_MCP_STATEMENT_TIMEOUT_MS"] = "0"
        try:
            self.assertEqual(engines.statement_timeout_ms(), 0)
        finally:
            os.environ.pop("DB_MCP_STATEMENT_TIMEOUT_MS", None)

    def test_postgres_gets_the_timeout_and_the_read_only_switch(self):
        engines.STATEMENT_TIMEOUT_MS = 1500
        options = engines._pg_options(profile("postgres", read_only=True))
        self.assertIn("default_transaction_read_only=on", options)
        self.assertIn("statement_timeout=1500", options)

    def test_postgres_options_vanish_when_nothing_is_set(self):
        engines.STATEMENT_TIMEOUT_MS = 0
        self.assertIsNone(engines._pg_options(profile("postgres")))

    def test_a_read_uses_a_server_side_cursor(self):
        plain = FakeCursor(description=[("n",)], rows=[(1,)])
        named = FakeCursor(description=[("n",)], rows=[(1,)])
        connection = ServerSideCursorConnection(plain, named)
        engines.execute_sql(profile("postgres"), connection, "select 1 as n", 200)
        self.assertEqual(connection.named_calls, 1)
        self.assertEqual(named.executed, ["select 1 as n"])
        self.assertEqual(plain.executed, [])

    def test_a_write_uses_a_plain_cursor(self):
        # A named cursor cannot run DDL or a DML statement that returns no rows.
        cursor = FakeCursor(rowcount=3)
        connection = FakeConnection(cursor)
        engines.execute_sql(profile("postgres"), connection, "update t set a = 1", 200)
        self.assertEqual(cursor.executed, ["update t set a = 1"])
        self.assertEqual(connection.commits, 1)

    def test_mysql_reads_use_the_unbuffered_cursor(self):
        plain = FakeCursor(description=[("n",)], rows=[(1,)])
        connection = FakeConnection(plain)
        # PyMySQL is not a hard dependency of the test run, so the class lookup
        # is stubbed the same way the driver would supply it.
        class Cursors:
            SSCursor = object()

        class FakePymysql:
            cursors = Cursors

        previous = sys.modules.get("pymysql")
        sys.modules["pymysql"] = FakePymysql
        try:
            engines.execute_sql(profile("mysql"), connection, "select 1 as n", 200)
        finally:
            if previous is None:
                sys.modules.pop("pymysql", None)
            else:
                sys.modules["pymysql"] = previous
        self.assertEqual(len(connection.cursor_calls), 1)
        self.assertEqual(connection.cursor_calls[0]["args"], (Cursors.SSCursor,))

    def test_sqlite_arms_and_disarms_the_progress_handler(self):
        engines.STATEMENT_TIMEOUT_MS = 5000
        cursor = FakeCursor(description=[("n",)], rows=[(1,)])
        connection = FakeSqliteConnection(cursor)
        engines.execute_sql(profile("sqlite"), connection, "select 1 as n", 200)
        self.assertEqual(len(connection.handlers), 2)
        self.assertIsNotNone(connection.handlers[0][0])
        self.assertIsNone(connection.handlers[1][0])

    def test_the_progress_handler_stops_a_slow_statement(self):
        engines.STATEMENT_TIMEOUT_MS = 1
        cursor = FakeCursor(description=[("n",)], rows=[(1,)])
        connection = FakeSqliteConnection(cursor)
        engines.execute_sql(profile("sqlite"), connection, "select 1 as n", 200)
        handler = connection.handlers[0][0]
        self.assertEqual(handler(), 0, "a fresh deadline must not interrupt")
        # Rewind the deadline instead of sleeping for it.
        engines.STATEMENT_TIMEOUT_MS = 1
        import time as _time

        original = _time.monotonic
        try:
            _time.monotonic = lambda: original() + 10
            self.assertEqual(handler(), 1)
        finally:
            _time.monotonic = original

    def test_a_timeout_becomes_a_timeout_error(self):
        engines.STATEMENT_TIMEOUT_MS = 2000
        cursor = FakeCursor()
        cursor.fail_with = RuntimeError("canceling statement due to statement timeout")
        connection = FakeConnection(cursor)
        with self.assertRaises(engines.DbError) as caught:
            engines.execute_sql(profile("postgres"), connection, "select pg_sleep(60)", 200)
        self.assertEqual(caught.exception.code, "timeout")
        self.assertIn("2s", caught.exception.message)
        self.assertIn("DB_MCP_STATEMENT_TIMEOUT_MS", caught.exception.hint)

    def test_a_plain_error_keeps_its_own_shape(self):
        cursor = FakeCursor()
        cursor.fail_with = RuntimeError('relation "nope" does not exist')
        connection = FakeConnection(cursor)
        with self.assertRaises(RuntimeError):
            engines.execute_sql(profile("postgres"), connection, "select * from nope", 200)


class SqliteTimeoutOnARealDatabase(unittest.TestCase):
    """The one engine that can be exercised without a server: a real interrupt.

    A stub connection can show that the progress handler is installed, but not
    that SQLite actually stops the statement — that only happens when the
    callback runs from inside the virtual machine.
    """

    def setUp(self):
        self._previous_timeout = engines.STATEMENT_TIMEOUT_MS
        self._previous_write = os.environ.get("DB_MCP_ALLOW_WRITE")
        os.environ["DB_MCP_ALLOW_WRITE"] = "1"
        self.dir = tempfile.mkdtemp(prefix="db-mcp-timeout-")
        self.path = Path(self.dir) / "slow.db"
        seed = sqlite3.connect(str(self.path))
        try:
            seed.execute("create table t (n integer)")
            seed.commit()
        finally:
            seed.close()
        self.profile = {
            "id": "slow",
            "kind": "sqlite",
            "config": {"file": str(self.path)},
            "readOnly": False,
            "allowDdl": False,
        }

    def tearDown(self):
        engines.STATEMENT_TIMEOUT_MS = self._previous_timeout
        if self._previous_write is None:
            os.environ.pop("DB_MCP_ALLOW_WRITE", None)
        else:
            os.environ["DB_MCP_ALLOW_WRITE"] = self._previous_write
        shutil.rmtree(self.dir, ignore_errors=True)

    def test_a_runaway_recursive_query_is_interrupted(self):
        # 2^40 rows: it would run for minutes if nothing stopped it.
        runaway = (
            "with recursive c(x) as (select 1 union all select x + 1 from c where x < 1099511627776) "
            "select count(*) from c"
        )
        engines.STATEMENT_TIMEOUT_MS = 150
        connection, close = engines.connect(self.profile, None)
        started = time.monotonic()
        try:
            with self.assertRaises(engines.DbError) as caught:
                engines.execute_sql(self.profile, connection, runaway, 200)
        finally:
            close()
        elapsed = time.monotonic() - started
        self.assertEqual(caught.exception.code, "timeout")
        self.assertLess(elapsed, 10, "the interrupt has to arrive near the deadline")
        self.assertIn("DB_MCP_STATEMENT_TIMEOUT_MS", caught.exception.hint)

    def test_a_normal_query_still_finishes(self):
        engines.STATEMENT_TIMEOUT_MS = 5000
        connection, close = engines.connect(self.profile, None)
        try:
            result = engines.execute_sql(self.profile, connection, "select count(*) as n from t", 200)
        finally:
            close()
        self.assertEqual(result["rows"], [[0]])


class RoutingCursor:
    """A cursor that answers by statement, so a multi-query call can be tested.

    `describe_table` asks four or five questions, each with its own result. A
    single canned row list cannot tell them apart; matching on a fragment of the
    statement can. The longest matching needle wins, so a call that names one
    table by name beats the generic PRAGMA it is shaped like.
    """

    def __init__(self, answers: dict, fail: tuple = ()):
        self.answers = dict(answers)
        self.fail = tuple(fail)
        self.executed: list[str] = []
        self.closed = False
        self.description = None
        self.rowcount = -1
        self._rows: list = []

    def execute(self, sql, params=None) -> None:
        text = str(sql)
        self.executed.append(text)
        for needle in self.fail:
            if needle in text:
                raise RuntimeError(f"{needle} is not available")
        for needle in sorted(self.answers, key=len, reverse=True):
            if needle in text:
                self._rows = list(self.answers[needle])
                return
        self._rows = []

    def fetchall(self):
        return list(self._rows)

    def fetchone(self):
        return self._rows[0] if self._rows else None

    def __iter__(self):
        return iter(self._rows)

    def close(self) -> None:
        self.closed = True


class DescribeExtras(unittest.TestCase):
    """`describe_table` answers the join questions too, and never fails over them.

    A model that has to guess whether a foreign key exists writes the join wrong;
    a missing column comment, on the other hand, is not worth a failed call.
    """

    def test_sqlite_reports_indexes_and_size(self):
        cursor = RoutingCursor(
            {
                'PRAGMA table_info("t")': [
                    (0, "id", "INTEGER", 0, None, 1),
                    (1, "pid", "INTEGER", 1, None, 0),
                ],
                'PRAGMA index_list("t")': [(0, "idx_pid", 0, "c", 0)],
                'PRAGMA index_info("idx_pid")': [(0, 1, "pid")],
            }
        )
        result = engines.describe_table(profile("sqlite"), FakeConnection(cursor), "t", None)
        self.assertEqual(
            sorted(result),
            ["columns", "comment", "indexes", "primaryKey", "rowEstimate", "schema", "table"],
        )
        self.assertEqual(result["primaryKey"], ["id"])
        self.assertEqual(result["indexes"], [{"name": "idx_pid", "columns": ["pid"], "unique": False}])
        self.assertIsNone(result["comment"])
        self.assertIsNone(result["rowEstimate"])

    def test_a_refused_extra_leaves_the_rest_intact(self):
        # A driver or a grant that will not answer the index PRAGMA must not turn
        # a describe call into an error: the columns are the part that matters.
        cursor = RoutingCursor(
            {'PRAGMA table_info("t")': [(0, "id", "INTEGER", 0, None, 1)]},
            fail=("index_list",),
        )
        result = engines.describe_table(profile("sqlite"), FakeConnection(cursor), "t", None)
        self.assertEqual([column["name"] for column in result["columns"]], ["id"])
        self.assertEqual(result["indexes"], [])

    def test_foreign_keys_are_not_answered_here(self):
        # The relation graph is the one place that answers "what joins what";
        # describe_table offering a second, weaker answer invites the model to
        # pick the one the walker does not use.
        cursor = RoutingCursor({'PRAGMA table_info("t")': [(0, "id", "INTEGER", 0, None, 1)]})
        result = engines.describe_table(profile("sqlite"), FakeConnection(cursor), "t", None)
        self.assertNotIn("foreignKeys", result)

    def test_postgres_gets_indexes_and_a_row_estimate(self):
        cursor = RoutingCursor(
            {
                "from pg_indexes": [("t_pkey", "CREATE UNIQUE INDEX t_pkey ON public.t USING btree (id)")],
                "reltuples": [(1234,)],
            }
        )
        extras = engines._describe_extras("postgres", cursor, "t", "public")
        self.assertEqual(extras["indexes"], [{"name": "t_pkey", "columns": ["id"], "unique": True}])
        self.assertEqual(extras["rowEstimate"], 1234)
        self.assertNotIn("foreignKeys", extras)

    def test_a_never_analysed_table_has_no_estimate(self):
        # `reltuples` is -1 before the first ANALYZE; reporting that as a row
        # count would be a lie the model would act on.
        cursor = RoutingCursor({"reltuples": [(-1,)]})
        self.assertIsNone(engines._pg_row_estimate(cursor, "t", "public"))

    def test_index_columns_survive_an_expression(self):
        self.assertEqual(engines._index_columns("CREATE INDEX i ON t USING btree (a, b)"), ["a", "b"])
        self.assertEqual(engines._index_columns("CREATE INDEX i ON t USING btree (lower(x), y)"), ["lower(x)", "y"])
        self.assertEqual(engines._index_columns("CREATE INDEX i ON t"), [])

    def test_oracle_resolves_the_spelling_the_catalog_stores(self):
        exact = "select table_name from all_tables where owner = :1 and table_name = :2"
        fuzzy = "upper(table_name) = upper(:2)"
        stored = RoutingCursor({exact: [("lower_t",)]})
        self.assertEqual(engines._oracle_catalog_name(stored, "TEST", "LOWER_T"), "lower_t")
        # Nothing matched the two exact spellings; the case-insensitive pass does.
        loose = RoutingCursor({exact: [], fuzzy: [("MixedCase",)]})
        self.assertEqual(engines._oracle_catalog_name(loose, "TEST", "mixedcase"), "MixedCase")


class Relations(unittest.TestCase):
    """`list_relations` answers every join path for a schema in one call.

    It is an internal helper now — `discover_relations` imports its rows into the
    relation graph — so these tests call it directly rather than through a tool.
    """

    def test_sqlite_walks_the_tables_it_has(self):
        cursor = RoutingCursor(
            {
                "sqlite_master": [("a",), ("b",)],
                'PRAGMA foreign_key_list("a")': [(0, 0, "parent", "pid", "id", "NO ACTION", "NO ACTION", "NONE")],
                'PRAGMA foreign_key_list("b")': [],
            }
        )
        result = engines.list_relations(profile("sqlite"), FakeConnection(cursor), None)
        self.assertEqual(sorted(result), ["relations", "schema", "total", "truncated"])
        self.assertEqual(
            result["relations"],
            [{"table": "a", "column": "pid", "refTable": "parent", "refColumn": "id", "name": None}],
        )
        self.assertEqual(result["total"], 1)
        self.assertFalse(result["truncated"])

    def test_postgres_asks_once_for_the_whole_schema(self):
        cursor = RoutingCursor({"FOREIGN KEY": [("orders", "customer_id", "customers", "id", "orders_customer_fkey")]})
        result = engines.list_relations(profile("postgres"), FakeConnection(cursor), None)
        self.assertEqual(
            result["relations"],
            [
                {
                    "table": "orders",
                    "column": "customer_id",
                    "refTable": "customers",
                    "refColumn": "id",
                    "name": "orders_customer_fkey",
                }
            ],
        )
        self.assertEqual(len(cursor.executed), 1, "one round trip, not one per table")

    def test_a_schema_without_keys_says_so(self):
        cursor = RoutingCursor({"FOREIGN KEY": []})
        result = engines.list_relations(profile("postgres"), FakeConnection(cursor), None)
        self.assertEqual(result["relations"], [])
        self.assertEqual(result["total"], 0)


class RecordingCursor(RoutingCursor):
    """RoutingCursor that also keeps the bind values, in order.

    oracledb counts every placeholder occurrence positionally, and a repeated
    `:1` written twice in a `union all` still wants two values. Only the count
    is observable here, and the count is exactly what went wrong.
    """

    def __init__(self, answers: dict, fail: tuple = ()):
        super().__init__(answers, fail)
        self.binds: list[list] = []

    def execute(self, sql, params=None) -> None:
        self.binds.append(list(params) if params is not None else [])
        super().execute(sql, params)


class SqlShapes(unittest.TestCase):
    """The shapes of the statements the extras ask, checked against real engines.

    Each case here is a bug that only appeared against a live server: unit tests
    with canned rows cannot see a missing join term or a bind count.
    """

    def test_mysql_primary_key_query_pins_the_table_name(self):
        # MySQL calls every primary key `PRIMARY`, so the constraint name alone
        # joins the key columns of every table in the schema: a single-column key
        # came back as `id, id, id, id` on a three-table database.
        cursor = RoutingCursor(
            {
                "from information_schema.columns": [("id", "int", "NO", None, None, None, None)],
                "PRIMARY KEY": [("id",)],
            }
        )
        engines.describe_table(profile("mysql"), FakeConnection(cursor), "orders", None)
        primary = [text for text in cursor.executed if "PRIMARY KEY" in text]
        self.assertTrue(primary, "the primary-key query never ran")
        self.assertIn("kcu.table_name = tc.table_name", primary[0])

    def test_postgres_foreign_key_query_pins_the_table_name(self):
        # Constraint names are unique per table in PostgreSQL, not per schema, so
        # the same missing term pulled in keys from sibling tables.
        cursor = RoutingCursor({"FOREIGN KEY": []})
        engines._pg_foreign_keys(cursor, "orders", "public")
        self.assertIn("kcu.table_name = tc.table_name", cursor.executed[0])

    def test_oracle_lists_only_tables_a_user_made(self):
        # `all_tables` in a SYSTEM schema is mostly Oracle's own catalogue
        # (MVIEW$_ADV_*, 19 objects on an empty database). ORACLE_MAINTAINED is
        # the flag that separates them.
        statement, takes_owner = engines._relations_sql("oracle")
        self.assertTrue(takes_owner)
        self.assertIn("oracle_maintained = 'N'", statement)

    def test_oracle_catalog_name_binds_every_placeholder(self):
        # `union all` repeats :1 and :2, and oracledb wants four values for four
        # occurrences even though only two names are written.
        cursor = RecordingCursor({"table_name": [("lower_t",)]})
        self.assertEqual(engines._oracle_catalog_name(cursor, "TEST", "lower_t"), "lower_t")
        self.assertEqual([len(binds) for binds in cursor.binds], [4])


class TableSchemaLookup(unittest.TestCase):
    """Where a bare table name lives, when the datasource does not pin a schema.

    openGauss carries `dbe_perf` and `db4ai` next to the user's own work, and the
    relation graph stores a bare name. Without this lookup every read of a table
    outside `public` went to `search_path` and came back as "does not exist".
    """

    def unpinned(self, kind: str) -> dict:
        source = profile(kind)
        source["config"].pop("schema", None)
        return source

    def test_a_table_in_one_other_schema_is_resolved(self):
        cursor = RoutingCursor({"information_schema.tables": [("sales",)]})
        found = engines.table_schema(self.unpinned("postgres"), FakeConnection(cursor), "customer")
        self.assertEqual(found, "sales")
        self.assertIn("information_schema.tables", cursor.executed[0])

    def test_a_name_in_two_schemas_stays_unresolved(self):
        # Guessing between two candidates would read the wrong table quietly.
        cursor = RoutingCursor({"information_schema.tables": [("sales",), ("archive",)]})
        self.assertIsNone(
            engines.table_schema(self.unpinned("postgres"), FakeConnection(cursor), "customer")
        )

    def test_a_pinned_schema_is_never_asked(self):
        cursor = RoutingCursor({"information_schema.tables": [("sales",)]})
        self.assertIsNone(engines.table_schema(profile("postgres"), FakeConnection(cursor), "customer"))
        self.assertEqual(cursor.executed, [], "a pinned profile must not query the catalogue")

    def test_a_catalogue_that_cannot_answer_falls_back(self):
        cursor = RoutingCursor({}, fail=("information_schema.tables",))
        self.assertIsNone(
            engines.table_schema(self.unpinned("postgres"), FakeConnection(cursor), "customer")
        )

    def test_qualified_carries_the_schema_it_was_given(self):
        source = self.unpinned("postgres")
        self.assertEqual(engines.qualified(source, "customer"), '"customer"')
        self.assertEqual(
            engines.qualified(source, "customer", schema="sales"), '"sales"."customer"'
        )

    def test_other_dialects_keep_their_own_answer(self):
        # MySQL calls its schema a database and SQLite has only one, so neither
        # should start querying information_schema for a table name.
        mysql = self.unpinned("mysql")
        self.assertEqual(engines.table_schema(mysql, FakeConnection(RoutingCursor({})), "orders"), "testdb")
        sqlite = profile("sqlite")
        cursor = RoutingCursor({})
        self.assertIsNone(engines.table_schema(sqlite, FakeConnection(cursor), "orders"))
        self.assertEqual(cursor.executed, [])

    def test_a_session_setting_does_not_get_a_server_side_cursor(self):
        # psycopg rewrites a named cursor as `DECLARE … CURSOR FOR <sql>`, and a
        # `SET` is not legal there: it came back as a syntax error.
        plain = FakeCursor(description=[], rows=[])
        named = FakeCursor(description=[], rows=[])
        connection = ServerSideCursorConnection(plain, named)
        engines.execute_sql(profile("postgres"), connection, "set search_path to public", 200)
        self.assertEqual(connection.named_calls, 0)
        self.assertEqual(plain.executed, ["set search_path to public"])


class BusinessKeyLookups(unittest.TestCase):
    """The three helpers a business key needs: family, a count, a few samples.

    All three are read-only and all three take a whitelist from the catalogue, so
    a scene file can never name a column that reaches SQL. The value always
    travels as a bind parameter — the count case below asserts that the statement
    text does not contain it.
    """

    def test_a_type_name_maps_to_a_binding_family(self):
        self.assertEqual(engines.column_family("character varying(16)"), "char")
        self.assertEqual(engines.column_family("VARCHAR2"), "char")
        self.assertEqual(engines.column_family("numeric(12,2)"), "number")
        self.assertEqual(engines.column_family("integer"), "number")
        self.assertEqual(engines.column_family("timestamp without time zone"), "date")
        self.assertEqual(engines.column_family("date"), "date")
        self.assertEqual(engines.column_family("jsonb"), "any")
        self.assertEqual(engines.column_family(""), "any")
        self.assertEqual(engines.column_family(None), "any")

    def test_a_value_is_bound_by_family(self):
        self.assertEqual(engines.bind_value("1", "number"), 1)
        self.assertEqual(engines.bind_value("1.5", "number"), 1.5)
        self.assertEqual(engines.bind_value("007", "char"), "007", "leading zeros survive")
        self.assertEqual(engines.bind_value("A001", "date"), "A001")
        self.assertIsNone(engines.bind_value("not a number", "number"))

    def test_a_column_outside_the_catalogue_is_refused_before_any_sql(self):
        cursor = FakeCursor()
        payload = engines.sample_values(
            profile("sqlite"), FakeConnection(cursor), "t_order", "note", {("t_order", "id")}
        )
        self.assertFalse(payload["ok"])
        self.assertEqual(payload["reason"], "unknown_table_or_column")
        self.assertEqual(payload["values"], [])
        self.assertEqual(cursor.executed, [], "no statement may be built for an unknown column")

    def test_a_count_outside_the_catalogue_is_refused_before_any_sql(self):
        cursor = FakeCursor()
        payload = engines.count_matching(
            profile("sqlite"), FakeConnection(cursor), "t_order", "note", "x", {("t_order", "id")}
        )
        self.assertFalse(payload["ok"])
        self.assertEqual(payload["reason"], "unknown_table_or_column")
        self.assertEqual(payload["hits"], 0)
        self.assertEqual(cursor.executed, [])

    def test_the_count_binds_its_value_instead_of_printing_it(self):
        cursor = FakeCursor(
            description=[("id",), ("code",)], rows=[(1, "A001"), (2, "A001")], rowcount=2
        )
        payload = engines.count_matching(
            profile("sqlite"),
            FakeConnection(cursor),
            "t_order",
            "code",
            "A001",
            {("t_order", "code")},
            limit=10,
        )
        self.assertTrue(payload["ok"], payload)
        self.assertEqual(payload["hits"], 2)
        self.assertFalse(payload["truncated"])
        self.assertEqual(len(cursor.executed), 1)
        self.assertIn("?", cursor.executed[0], "sqlite wants a placeholder")
        self.assertNotIn("A001", cursor.executed[0], "the value must not be in the statement")

    def test_one_row_past_the_limit_is_reported_as_truncated(self):
        cursor = FakeCursor(
            description=[("id",)], rows=[(1,), (2,), (3,)], rowcount=3
        )
        payload = engines.count_matching(
            profile("sqlite"), FakeConnection(cursor), "t_order", "code", 1, {("t_order", "code")}, limit=2
        )
        self.assertTrue(payload["ok"], payload)
        self.assertEqual(payload["hits"], 2, "the extra row proves there are more but is not counted")
        self.assertTrue(payload["truncated"])

    def test_samples_skip_nulls_and_dedupe_in_python(self):
        cursor = FakeCursor(description=[("code",)], rows=[("A001",), ("A001",), (None,), ("A002",)])
        payload = engines.sample_values(
            profile("sqlite"), FakeConnection(cursor), "t_order", "code", {("t_order", "code")}, limit=10
        )
        self.assertTrue(payload["ok"], payload)
        self.assertEqual(payload["values"], ["A001", "A002"])
        statement = cursor.executed[0]
        self.assertIn("IS NOT NULL", statement)
        self.assertNotIn("DISTINCT", statement.upper(), "no DISTINCT: it would scan the whole table")

    def test_oracle_date_ranges_bind_datetimes_not_iso_strings(self):
        """Oracle converts ISO strings to TIMESTAMP by NLS_DATE_FORMAT (DD-MON-YY),
        so binding '2026-01-02' to a TIMESTAMP comparison raises ORA-01843. The
        rule helpers must bind real datetime objects on Oracle for same_day and
        within_minutes, while leaving the target column bare so an index works.

        Verified against a real Oracle Free container; this guards the shape.
        """
        import datetime

        class BindCursor(FakeCursor):
            def __init__(self):
                super().__init__(description=[("paid_at",)], rows=[])
                self.params = None

            def execute(self, sql, params=None):
                self.params = params
                super().execute(sql, params)

        for op, minutes in (("same_day", 0), ("within_minutes", 30)):
            with self.subTest(op=op):
                cursor = BindCursor()
                result = engines.weak_candidates(
                    profile("oracle"), FakeConnection(cursor), "T_TRANS", "PAID_AT",
                    ["2026-01-02 10:00:00"], op, minutes, 50,
                )
                self.assertNotIn('"PAID_AT" =', result["sql"])
                # column stays bare: a comparison, never TO_DATE(PAID_AT)
                self.assertIn('"PAID_AT" >=', result["sql"])
                self.assertNotIn("TO_DATE", result["sql"].upper())
                self.assertTrue(cursor.params)
                for bound in cursor.params:
                    self.assertIsInstance(
                        bound, datetime.datetime,
                        f"Oracle date bind must be a datetime, got {bound!r}",
                    )


class TimeoutRecognition(unittest.TestCase):
    """A real driver's timeout message is recognised across every engine.

    The alias/weak lookups catch raw DBAPI exceptions (they have no common base
    with DbError), so the marker list is the only thing telling a timeout apart
    from a bad table. Each line below is the wording a driver actually emits.
    """

    def test_each_drivers_own_timeout_message_is_recognised(self):
        messages = [
            sqlite3.OperationalError("interrupted"),  # SQLite progress handler
            Exception("canceling statement due to statement timeout"),  # PG/gauss
            Exception("Query execution was interrupted, maximum statement execution time exceeded"),
            Exception("ORA-01013: user requested cancel of current operation"),
            Exception("ORA-12170: TNS:Connect timeout occurred"),
        ]
        for error in messages:
            with self.subTest(message=str(error)):
                self.assertTrue(engines._is_timeout(error), str(error))

    def test_an_ordinary_error_is_not_mistaken_for_a_timeout(self):
        self.assertFalse(engines._is_timeout(sqlite3.OperationalError("no such table: t_gone")))


class CellPolicy(unittest.TestCase):
    """`_cell` summarises long text under `auto`, keeps it under `full`."""

    def _set_policy(self, policy: str) -> None:
        engines.TEXT_POLICY = policy

    def test_short_text_is_untouched_under_auto(self):
        self._set_policy("auto")
        self.assertEqual(engines._cell("hello"), "hello")

    def test_long_text_is_summarised_under_auto(self):
        self._set_policy("auto")
        long = "x" * 300
        rendered = engines._cell(long)
        self.assertTrue(rendered.startswith("x" * 50))
        self.assertTrue(rendered.endswith("x" * 50))
        self.assertIn("…(300 chars)…", rendered)
        self.assertLess(len(rendered), 200)

    def test_unknown_policy_falls_back_to_auto(self):
        self.assertEqual(engines.text_policy("headtail"), "auto")
        self.assertEqual(engines.text_policy("FULL"), "full")
        self.assertEqual(engines.text_policy(None), "auto")

    def test_full_keeps_the_whole_cell(self):
        self._set_policy("full")
        long = "b" * 300
        self.assertEqual(engines._cell(long), long)

    def test_max_text_truncation_still_applies_under_full(self):
        self._set_policy("full")
        huge = "c" * (engines.MAX_TEXT + 100)
        rendered = engines._cell(huge)
        self.assertEqual(len(rendered), engines.MAX_TEXT + len("… (+100)"))
        self.assertIn("(+100)", rendered)

    def test_blob_is_never_summarised(self):
        self._set_policy("auto")
        blob = b"\x01\x02" * 5000
        rendered = engines._cell(blob)
        self.assertTrue(rendered.startswith(f"<{len(blob)} bytes> "))
        self.assertNotIn("(共", rendered)

    def test_numbers_and_nulls_are_untouched_under_auto(self):
        self._set_policy("auto")
        self.assertEqual(engines._cell(None), None)
        self.assertEqual(engines._cell(42), 42)


class GaussPlumbing(unittest.TestCase):
    """The openGauss path without a server: host list, IRI, TLS shim, placeholders.

    These started as a hand-run script, which meant the one engine that cannot be
    reached from a container had no automatic coverage at all.
    """

    def test_a_comma_host_list_keeps_per_host_ports(self):
        hosts = engines._host_list({"host": "10.0.0.1,10.0.0.2:30101", "port": 30100})
        self.assertEqual(hosts, [("10.0.0.1", 30100), ("10.0.0.2", 30101)])

    def test_a_declared_hosts_array_wins_over_host(self):
        hosts = engines._host_list({"hosts": [{"host": "h1", "port": 1}, "h2"], "port": 5432})
        self.assertEqual(hosts, [("h1", 1), ("h2", 5432)])

    def test_an_empty_config_still_names_one_host(self):
        self.assertEqual(engines._host_list({}), [("localhost", 5432)])

    def test_the_iri_carries_every_host(self):
        iri = engines._gauss_iri({"host": "a,b:2", "port": 1, "database": "demo", "user": "u"}, "p@ss")
        self.assertEqual(iri, "opengauss://u:p%40ss@a:1,b:2/demo")

    def test_the_iri_escapes_the_password(self):
        iri = engines._gauss_iri({"host": "h", "user": "u"}, "p@ss/word")
        self.assertNotIn("p@ss", iri)
        self.assertIn("p%40ss%2Fword", iri)

    def test_a_password_only_source_has_no_credentials_prefix(self):
        self.assertEqual(engines._gauss_iri({"host": "h", "database": "d"}, None), "opengauss://h:5432/d")

    def test_one_placeholder_becomes_a_dollar_bind(self):
        rewrite = engines._GaussCursor._rewrite
        self.assertEqual(rewrite("where a = %s", 1), "where a = $1")
        self.assertEqual(rewrite("where a = %s and b = %s", 2), "where a = $1 and b = $2")

    def test_a_statement_the_rewriter_cannot_match_is_left_alone(self):
        rewrite = engines._GaussCursor._rewrite
        self.assertEqual(rewrite("select 1", 0), "select 1")
        # A count that does not match is not ours to guess at: the server reports it.
        self.assertEqual(rewrite("where a = %s and b = %s", 1), "where a = %s and b = %s")


@unittest.skipIf(HAS_NATIVE_WRAP_SOCKET, "this interpreter still ships ssl.wrap_socket")
class SslShim(unittest.TestCase):
    """The replacement for `ssl.wrap_socket`, which Python 3.12 removed.

    py_opengauss calls it, so without the shim the driver raises AttributeError
    before the handshake. The subtlety is the default: `wrap_socket` never
    verified, while `PROTOCOL_TLS_CLIENT` does — a naive replacement would fail
    every connection to a server with a self-signed certificate.
    """

    def tearDown(self):
        # Leave the module as it was found; the shim is installed on the `ssl`
        # module itself, so leaking it would change every later test.
        if not HAS_NATIVE_WRAP_SOCKET and hasattr(ssl, "wrap_socket"):
            del ssl.wrap_socket

    def _wrapped(self, **kwargs):
        engines._ssl_shim()
        self.assertTrue(hasattr(ssl, "wrap_socket"), "the shim did not install")
        client, server = socket.socketpair()
        self.addCleanup(server.close)
        wrapped = ssl.wrap_socket(client, do_handshake_on_connect=False, **kwargs)
        self.addCleanup(wrapped.close)
        return wrapped

    def test_the_shim_does_not_verify_by_default(self):
        wrapped = self._wrapped()
        self.assertEqual(wrapped.context.verify_mode, ssl.CERT_NONE)
        self.assertFalse(wrapped.context.check_hostname)

    def test_a_caller_that_asks_for_verification_gets_it(self):
        wrapped = self._wrapped(cert_reqs=ssl.CERT_REQUIRED)
        self.assertEqual(wrapped.context.verify_mode, ssl.CERT_REQUIRED)
        # Hostname checking has to stay off even then: the shim has no host to
        # check against, and turning it on makes `wrap_socket` raise.
        self.assertFalse(wrapped.context.check_hostname)

    def test_a_server_side_socket_uses_the_server_protocol(self):
        client, server = socket.socketpair()
        self.addCleanup(client.close)
        engines._ssl_shim()
        wrapped = ssl.wrap_socket(server, server_side=True, do_handshake_on_connect=False)
        self.addCleanup(wrapped.close)
        self.assertEqual(wrapped.context.protocol, ssl.PROTOCOL_TLS_SERVER)


class OracleCatalogueFallback(unittest.TestCase):
    """A catalogue older than 12c has no `ORACLE_MAINTAINED`, and must still list.

    The first query filters Oracle's own bookkeeping out of `all_tables`; the
    fallback drops that filter rather than failing the call. Only a server that
    rejects the column can show which one ran, so the cursor is told to fail on
    the fragment that names it.
    """

    def test_a_catalogue_without_the_flag_falls_back_to_the_plain_listing(self):
        cursor = RoutingCursor(
            {"all_tables": [("TEST", "ORDERS", "TABLE")]},
            fail=("oracle_maintained",),
        )
        result = engines.list_tables(profile("oracle"), FakeConnection(cursor), "TEST")
        self.assertEqual([table["name"] for table in result["tables"]], ["ORDERS"])
        self.assertEqual(len(cursor.executed), 2, "the fallback query never ran")
        self.assertIn("oracle_maintained", cursor.executed[0])
        self.assertNotIn("oracle_maintained", cursor.executed[1])
        self.assertIn("all_objects", cursor.executed[0])
        self.assertNotIn("all_objects", cursor.executed[1])

    def test_the_fallback_still_binds_the_owner_twice(self):
        # Two `:1`/`:2` placeholders over a `union all`: oracledb counts the
        # occurrences, not the distinct names.
        cursor = RecordingCursor({"all_tables": []}, fail=("oracle_maintained",))
        engines.list_tables(profile("oracle"), FakeConnection(cursor), "TEST")
        self.assertEqual([len(binds) for binds in cursor.binds], [2, 2])


class RelationTruncation(unittest.TestCase):
    """`limit` trims the reply, and `truncated` says it did.

    Verified against a live PostgreSQL first; this keeps it from regressing now
    that the row count is the only signal a caller gets.
    """

    def _rows(self, count: int):
        return [(f"t{index}", "fk", "parent", "id", f"fk_{index}") for index in range(count)]

    def test_a_schema_under_the_limit_is_not_truncated(self):
        cursor = RoutingCursor({"FOREIGN KEY": self._rows(2)})
        result = engines.list_relations(profile("postgres"), FakeConnection(cursor), None)
        self.assertEqual(result["total"], 2)
        self.assertEqual(len(result["relations"]), 2)
        self.assertFalse(result["truncated"])

    def test_a_schema_over_the_limit_reports_how_many_it_held(self):
        cursor = RoutingCursor({"FOREIGN KEY": self._rows(5)})
        result = engines.list_relations(profile("postgres"), FakeConnection(cursor), None, limit=2)
        self.assertEqual(len(result["relations"]), 2)
        self.assertEqual(result["total"], 5, "the caller needs the real size, not the trimmed one")
        self.assertTrue(result["truncated"])

    def test_sqlite_truncates_the_same_way(self):
        cursor = RoutingCursor(
            {
                "sqlite_master": [("a",), ("b",), ("c",)],
                'PRAGMA foreign_key_list("a")': [(0, 0, "parent", "pid", "id", "NO ACTION", "NO ACTION", "NONE")],
                'PRAGMA foreign_key_list("b")': [(0, 0, "parent", "pid", "id", "NO ACTION", "NO ACTION", "NONE")],
                'PRAGMA foreign_key_list("c")': [(0, 0, "parent", "pid", "id", "NO ACTION", "NO ACTION", "NONE")],
            }
        )
        result = engines.list_relations(profile("sqlite"), FakeConnection(cursor), None, limit=1)
        self.assertEqual(len(result["relations"]), 1)
        self.assertEqual(result["total"], 3)
        self.assertTrue(result["truncated"])


class MissingDriverIsInfraError(unittest.TestCase):
    """`infra_error` means "the installation is broken", and only that.

    It survives in exactly three places — the driver imports. Everything else,
    including a driver that rejects the statement, is a `db_error`. A `None` in
    `sys.modules` makes the import raise the same ImportError a broken venv does.
    """

    def _blocked(self, name: str):
        previous = sys.modules.get(name)
        sys.modules[name] = None
        self.addCleanup(lambda: sys.modules.pop(name, None) if previous is None else sys.modules.__setitem__(name, previous))

    def test_a_missing_postgres_driver_is_an_infra_error(self):
        self._blocked("psycopg")
        with self.assertRaises(engines.DbError) as caught:
            engines._connect_postgres(profile("postgres"), {"host": "localhost"}, None)
        self.assertEqual(caught.exception.code, "infra_error")
        self.assertIn("psycopg", caught.exception.message)
        self.assertIn("setup again", caught.exception.hint)

    def test_a_missing_mysql_driver_is_an_infra_error(self):
        self._blocked("pymysql")
        with self.assertRaises(engines.DbError) as caught:
            engines._connect_mysql(profile("mysql"), {"host": "localhost"}, None)
        self.assertEqual(caught.exception.code, "infra_error")
        self.assertIn("PyMySQL", caught.exception.message)

    def test_a_missing_oracle_driver_is_an_infra_error(self):
        self._blocked("oracledb")
        with self.assertRaises(engines.DbError) as caught:
            engines._connect_oracle(profile("oracle"), {"host": "localhost", "serviceName": "FREE"}, None)
        self.assertEqual(caught.exception.code, "infra_error")
        self.assertIn("oracledb", caught.exception.message)


if __name__ == "__main__":
    sys.exit(unittest.main(verbosity=2))
