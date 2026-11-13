"""Regression tests for `server/writes.py`, the writable-schema guard.

The rule under test: a source switched to writable names the schemas it may write
to, and every changing statement is checked against that list before it reaches
the database. Reads are never restricted. A statement whose target cannot be
worked out is refused rather than waved through — the guard is a mistake guard,
so it errs on the side of no.

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


def profile(kind="postgres", schemas=("sales",), **config):
    base = {"host": "localhost", "port": 5432, "database": "app", "user": "alice"}
    base.update(config)
    return {"id": "pg-test", "kind": kind, "config": base, "writableSchemas": list(schemas)}


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


class Targets(unittest.TestCase):
    def test_insert_into(self):
        self.assertEqual(writes.targets("insert into sales.orders values (1)"), [("sales", "orders")])

    def test_insert_without_into(self):
        self.assertEqual(writes.targets("insert sales.orders values (1)"), [("sales", "orders")])

    def test_quoted_names(self):
        self.assertEqual(writes.targets('update "Sales"."Orders" set a = 1'), [("Sales", "Orders")])

    def test_backtick_names(self):
        self.assertEqual(writes.targets("delete from `sales`.`orders`"), [("sales", "orders")])

    def test_unqualified_name_has_no_schema(self):
        self.assertEqual(writes.targets("update orders set a = 1"), [(None, "orders")])

    def test_truncate_table(self):
        self.assertEqual(writes.targets("truncate table sales.orders"), [("sales", "orders")])

    def test_merge_into(self):
        self.assertEqual(writes.targets("merge into sales.orders t using x on 1=1"), [("sales", "orders")])

    def test_create_table(self):
        self.assertEqual(writes.targets("create table sales.orders (id int)"), [("sales", "orders")])

    def test_create_table_if_not_exists(self):
        self.assertEqual(writes.targets("create table if not exists sales.orders (id int)"), [("sales", "orders")])

    def test_create_or_replace_view(self):
        self.assertEqual(writes.targets("create or replace view sales.v as select 1"), [("sales", "v")])

    def test_drop_table(self):
        self.assertEqual(writes.targets("drop table sales.orders"), [("sales", "orders")])

    def test_alter_table(self):
        self.assertEqual(writes.targets("alter table sales.orders add column c int"), [("sales", "orders")])

    def test_create_index_lands_on_the_table(self):
        # `create index i on t` adds rows to t's index, not to a table called i.
        self.assertEqual(writes.targets("create index i on sales.orders (id)"), [("sales", "orders")])

    def test_create_unique_index(self):
        self.assertEqual(writes.targets("create unique index i on sales.orders (id)"), [("sales", "orders")])

    def test_create_index_concurrently(self):
        self.assertEqual(writes.targets("create index concurrently i on sales.orders (id)"), [("sales", "orders")])

    def test_grant(self):
        self.assertEqual(writes.targets("grant select on sales.orders to bob"), [("sales", "orders")])

    def test_call(self):
        self.assertEqual(writes.targets("call sales.refresh()"), [("sales", "refresh")])

    def test_select_has_no_target(self):
        self.assertIsNone(writes.targets("select * from sales.orders"))

    def test_unreadable_statement(self):
        self.assertIsNone(writes.targets("insert into"))


class DefaultSchema(unittest.TestCase):
    def test_postgres_defaults_to_public(self):
        self.assertEqual(writes.default_schema(profile()), "public")

    def test_postgres_uses_the_configured_schema(self):
        self.assertEqual(writes.default_schema(profile(schema="reporting")), "reporting")

    def test_mysql_uses_the_database(self):
        self.assertEqual(writes.default_schema(profile(kind="mysql")), "app")

    def test_oracle_uses_the_user_in_upper_case(self):
        self.assertEqual(writes.default_schema(profile(kind="oracle", user="scott")), "SCOTT")

    def test_oracle_prefers_the_configured_schema(self):
        self.assertEqual(writes.default_schema(profile(kind="oracle", schema="hr")), "HR")

    def test_sqlite_is_main(self):
        self.assertEqual(writes.default_schema(profile(kind="sqlite", file="a.db")), "main")


class Allowed(unittest.TestCase):
    def test_reads_the_list(self):
        self.assertEqual(writes.allowed(profile(schemas=("sales", "billing"))), ["sales", "billing"])

    def test_missing_list_is_empty(self):
        self.assertEqual(writes.allowed({"id": "x"}), [])

    def test_blank_names_are_dropped(self):
        self.assertEqual(writes.allowed({"id": "x", "writableSchemas": ["sales", "  ", ""]}), ["sales"])

    def test_a_non_list_is_empty(self):
        self.assertEqual(writes.allowed({"id": "x", "writableSchemas": "sales"}), [])


class Check(unittest.TestCase):
    def test_a_read_is_always_allowed(self):
        writes.check("select * from hr.payroll", profile())

    def test_reads_with_a_cte_are_allowed(self):
        writes.check("with x as (select 1) select * from x", profile())

    def test_show_is_a_read(self):
        writes.check("show tables", profile())

    def test_explain_is_a_read(self):
        writes.check("explain select * from hr.payroll", profile())

    def test_a_write_to_a_listed_schema_passes(self):
        writes.check("insert into sales.orders values (1)", profile())

    def test_the_list_is_case_insensitive(self):
        writes.check("insert into SALES.orders values (1)", profile(schemas=("sales",)))

    def test_an_unqualified_write_uses_the_default_schema(self):
        writes.check("insert into orders values (1)", profile(schema="sales"))

    def test_a_write_to_another_schema_is_refused(self):
        with self.assertRaises(writes.WriteBlocked) as caught:
            writes.check("update hr.payroll set pay = 0", profile())
        self.assertIn("hr is not a writable schema of pg-test", caught.exception.message)
        self.assertIn("sales", caught.exception.hint)

    def test_an_unqualified_write_to_the_wrong_default_is_refused(self):
        with self.assertRaises(writes.WriteBlocked) as caught:
            writes.check("delete from orders", profile(schema="hr"))
        self.assertIn("hr is not a writable schema", caught.exception.message)

    def test_a_source_without_a_list_refuses_everything(self):
        with self.assertRaises(writes.WriteBlocked) as caught:
            writes.check("insert into sales.orders values (1)", profile(schemas=()))
        self.assertIn("names no writable schema", caught.exception.message)

    def test_every_statement_in_a_batch_is_checked(self):
        with self.assertRaises(writes.WriteBlocked):
            writes.check("insert into sales.orders values (1); delete from hr.payroll", profile())

    def test_a_read_in_a_batch_does_not_excuse_a_write(self):
        writes.check("select 1; insert into sales.orders values (1)", profile())

    def test_an_unreadable_statement_is_refused(self):
        with self.assertRaises(writes.WriteBlocked) as caught:
            writes.check("insert into", profile())
        self.assertIn("could not work out", caught.exception.message)

    def test_ddl_to_another_schema_is_refused(self):
        with self.assertRaises(writes.WriteBlocked):
            writes.check("create table hr.payroll (id int)", profile())

    def test_ddl_to_a_listed_schema_passes(self):
        writes.check("create table sales.orders (id int)", profile())

    def test_a_leading_comment_does_not_hide_a_write(self):
        with self.assertRaises(writes.WriteBlocked):
            writes.check("-- tidy up\nupdate hr.payroll set pay = 0", profile())

    def test_a_quoted_other_schema_is_refused(self):
        with self.assertRaises(writes.WriteBlocked):
            writes.check('update "HR"."payroll" set pay = 0', profile())

    def test_sqlite_writes_to_main(self):
        writes.check("insert into orders values (1)", profile(kind="sqlite", schemas=("main",), file="a.db"))

    def test_sqlite_writes_to_another_schema_are_refused(self):
        with self.assertRaises(writes.WriteBlocked):
            writes.check("insert into other.orders values (1)", profile(kind="sqlite", schemas=("main",), file="a.db"))

    def test_a_column_named_like_a_schema_is_not_a_target(self):
        # `select hr from payroll` reads a column, it does not write to `hr`.
        writes.check("select hr from payroll", profile())


if __name__ == "__main__":
    unittest.main(verbosity=2)
