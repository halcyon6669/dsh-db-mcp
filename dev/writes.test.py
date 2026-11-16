"""Regression tests for `server/writes.py`, the DDL guard.

The rule under test: a writable source may change rows freely, but statements
that change the shape of the database (`create`, `alter`, `drop` and friends)
are refused unless the source opted into DDL. Reads are never restricted. The
guard is a mistake guard, so it errs on the side of no.

Run it through `dev/engines.test.mjs` (`npm run test:engines`), which picks the
right interpreter. Only the standard library is needed.
"""

from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

PACKAGE = Path(__file__).resolve().parent.parent
# `server/main.py` runs with its own directory first on sys.path, which is how
# `engines.py` reaches `import writes`.
sys.path.insert(0, str(PACKAGE / "server"))
SPEC = importlib.util.spec_from_file_location("db_mcp_writes", PACKAGE / "server" / "writes.py")
writes = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(writes)


def profile(kind="postgres", allow_ddl=False, **config):
    base = {"host": "localhost", "port": 5432, "database": "app", "user": "alice"}
    base.update(config)
    return {
        "id": "pg-test",
        "kind": kind,
        "config": base,
        "allowDdl": allow_ddl,
    }


class Statements(unittest.TestCase):
    def test_splits_on_semicolons(self):
        self.assertEqual(len(writes.statements("select 1; update t set a = 1")), 2)

    def test_ignores_semicolons_inside_strings(self):
        parts = writes.statements("insert into t values ('a;b'); select 1")
        self.assertEqual(len(parts), 2)
        self.assertIn("'a;b'", parts[0])

    def test_doubled_quote_stays_inside_the_string(self):
        parts = writes.statements("insert into t values ('it''s; fine')")
        self.assertEqual(len(parts), 1)

    def test_blank_statements_are_dropped(self):
        self.assertEqual(writes.statements(" ; ; select 1 ;; "), ["select 1"])

    def test_empty_input(self):
        self.assertEqual(writes.statements(""), [])

    def test_keyword_skips_a_leading_line_comment(self):
        self.assertEqual(writes.keyword("-- note\nupdate t set a = 1"), "update")

    def test_keyword_skips_a_leading_block_comment(self):
        self.assertEqual(writes.keyword("/* note */ delete from t"), "delete")

    def test_keyword_of_an_empty_string(self):
        self.assertEqual(writes.keyword(""), "")


class DdlSwitch(unittest.TestCase):
    """DDL is a second permission: writing rows must not imply changing the shape."""

    def test_create_alter_drop_are_ddl(self):
        for statement in ("create table t (id int)", "alter table t add c int", "drop table t"):
            self.assertTrue(writes.is_ddl(statement), statement)

    def test_truncate_is_ddl(self):
        # It keeps the table but throws every row away: as destructive as a drop.
        self.assertTrue(writes.is_ddl("truncate table sales.orders"))

    def test_rename_grant_revoke_are_ddl(self):
        for statement in (
            "rename table a to b",
            "grant select on sales.orders to bob",
            "revoke select on sales.orders from bob",
        ):
            self.assertTrue(writes.is_ddl(statement), statement)

    def test_row_writes_are_not_ddl(self):
        for statement in (
            "insert into t values (1)",
            "update t set a = 1",
            "delete from t",
            "merge into t using s on 1 = 1 when matched then delete",
        ):
            self.assertFalse(writes.is_ddl(statement), statement)

    def test_reads_are_not_ddl(self):
        self.assertFalse(writes.is_ddl("select * from t"))
        self.assertFalse(writes.is_ddl("explain create table t (id int)"))

    def test_a_batch_is_ddl_if_any_statement_is(self):
        self.assertTrue(writes.is_ddl("insert into sales.t values (1); drop table sales.t"))

    def test_a_leading_comment_does_not_hide_ddl(self):
        self.assertTrue(writes.is_ddl("-- tidy\n/* why not */ drop table sales.t"))

    def test_ddl_absent_means_refused(self):
        self.assertFalse(writes.allows_ddl({"id": "x"}))
        self.assertFalse(writes.allows_ddl({"id": "x", "allowDdl": "yes"}))
        self.assertTrue(writes.allows_ddl({"id": "x", "allowDdl": True}))

    def test_ddl_is_refused_on_a_source_that_did_not_opt_in(self):
        with self.assertRaises(writes.WriteBlocked) as caught:
            writes.check("create table sales.orders (id int)", profile())
        self.assertIn("does not allow DDL", caught.exception.message)
        self.assertIn("Data sources panel", caught.exception.hint)

    def test_ddl_passes_once_the_switch_is_on(self):
        writes.check("create table sales.orders (id int)", profile(allow_ddl=True))

    def test_a_row_write_is_unaffected_by_the_ddl_switch(self):
        writes.check("insert into sales.orders values (1)", profile(allow_ddl=False))

    def test_a_batch_mixing_read_and_ddl_still_needs_the_switch(self):
        with self.assertRaises(writes.WriteBlocked):
            writes.check("select 1; drop table sales.orders", profile())

    def test_sqlite_ddl_needs_the_switch_too(self):
        with self.assertRaises(writes.WriteBlocked):
            writes.check("create table t (id int)", profile(kind="sqlite", file="a.db"))

    def test_a_read_is_always_allowed(self):
        writes.check("select * from hr.payroll", profile())

    def test_a_write_to_any_schema_passes(self):
        # There is no whitelist any more: writable means every schema.
        writes.check("insert into hr.payroll values (1)", profile())

    def test_a_write_passes_on_a_writable_source(self):
        writes.check("update t set a = 1", profile())


if __name__ == "__main__":
    unittest.main(verbosity=2)
