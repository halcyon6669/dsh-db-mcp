"""Regression tests for `server/mining.py`, the audit-log join miner.

The bug this guards against: a schema with no declared foreign keys gives the
walker nothing to follow, even though the statements that already joined those
tables are sitting in the audit log. Mining them is only safe if the parser never
invents a join — a wrong edge is worse than a missing one, because the walker
follows it and reports rows that do not belong together.

A mined pair is a *pair*: which side is the child is a question for the catalog,
so these tests compare sets of columns rather than an ordered arrow. The parser
must also survive the trap that used to break it — `from a join b` reading `join`
as a's alias, which silently dropped every join in the statement.

The parser is pure (records in, candidates out), so these tests need no database
and no runtime directory. Run through `dev/engines.test.mjs`.
"""

from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path

PACKAGE = Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location("db_mcp_mining", PACKAGE / "server" / "mining.py")
mining = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(mining)


def line(sql: str, datasource: str | None = "shop", tool: str = "mcp__db__execute_sql") -> dict:
    return {"tool": tool, "datasource": datasource, "sql": sql}


def mine(sql: str, **kwargs) -> list[set[tuple[str, str]]]:
    """The joins in one statement, each as a set of two (table, column) columns."""
    found = mining.candidates([line(sql)], ("shop",), **kwargs)
    return [{(_column(item["left"])), _column(item["right"])} for item in found]


def _column(side: dict) -> tuple[str, str]:
    return (side["table"], side["column"])


class AliasResolution(unittest.TestCase):
    def test_an_explicit_alias_resolves_the_column(self):
        self.assertEqual(
            mine("select * from Invoice i join Customer c on c.CustomerId = i.CustomerId"),
            [{("invoice", "customerid"), ("customer", "customerid")}],
        )

    def test_a_table_name_without_an_alias_still_resolves(self):
        self.assertEqual(
            mine("select * from t_trans join t_order on t_order.id = t_trans.order_id"),
            [{("t_trans", "order_id"), ("t_order", "id")}],
        )

    def test_as_before_the_alias_is_read_the_same_way(self):
        self.assertEqual(
            mine("select * from t_trans as t join t_order as o on o.id = t.order_id"),
            [{("t_trans", "order_id"), ("t_order", "id")}],
        )

    def test_a_schema_prefix_is_dropped(self):
        self.assertEqual(
            mine('select * from "public"."t_trans" t join "public"."t_order" o on o.id = t.order_id'),
            [{("t_trans", "order_id"), ("t_order", "id")}],
        )


class ConservativeParsing(unittest.TestCase):
    def test_a_statement_without_a_join_yields_nothing(self):
        self.assertEqual(mine("select * from t_order where id = 1"), [])

    def test_an_unqualified_column_is_ignored_when_two_tables_are_in_play(self):
        # `id = order_id` names no table; attributing it to either side would be a
        # guess, and a guessed edge is what this module exists to avoid.
        self.assertEqual(mine("select * from t_trans join t_order on id = order_id"), [])

    def test_an_equality_against_a_literal_is_not_a_join(self):
        self.assertEqual(
            mine("select * from t_trans t join t_order o on o.id = t.order_id and t.state = 'POSTED'"),
            [{("t_trans", "order_id"), ("t_order", "id")}],
        )

    def test_a_self_join_does_not_become_an_edge(self):
        self.assertEqual(mine("select * from t_node a join t_node b on b.parent_id = a.id"), [])

    def test_a_join_without_an_on_clause_yields_nothing(self):
        self.assertEqual(mine("select * from t_trans cross join t_order"), [])

    def test_an_equality_after_the_where_clause_is_not_mined(self):
        # Only the `on` clause is evidence: a where-clause equality is usually a
        # filter, not the join condition.
        self.assertEqual(
            mine("select * from t_trans t join t_order o on o.id = t.order_id where t.id = o.id"),
            [{("t_trans", "order_id"), ("t_order", "id")}],
        )


class CandidateSelection(unittest.TestCase):
    def test_only_statement_tools_are_read(self):
        rows = [
            line("select * from a join b on b.id = a.b_id", tool="mcp__db__list_tables"),
            line("select * from c join d on d.id = c.d_id"),
        ]
        found = mining.candidates(rows, ("shop",))
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0]["left"]["table"], "c")

    def test_a_line_without_a_datasource_is_skipped_unless_allowed(self):
        rows = [line("select * from a join b on b.id = a.b_id", datasource=None)]
        self.assertEqual(mining.candidates(rows, ("shop",)), [])
        self.assertEqual(len(mining.candidates(rows, ("shop",), include_anonymous=True)), 1)

    def test_another_datasource_is_not_mined_into_this_graph(self):
        rows = [line("select * from a join b on b.id = a.b_id", datasource="other")]
        self.assertEqual(mining.candidates(rows, ("shop",)), [])

    def test_the_hit_count_ranks_a_repeated_join_first(self):
        rows = [
            line("select * from a join b on b.id = a.b_id"),
            line("select * from c join d on d.id = c.d_id"),
            line("select * from c join d on d.id = c.d_id"),
        ]
        found = mining.candidates(rows, ("shop",))
        self.assertEqual(found[0]["left"]["table"], "c")
        self.assertEqual(found[0]["hits"], 2)
        self.assertEqual(found[1]["hits"], 1)

    def test_the_same_join_written_two_ways_counts_twice(self):
        rows = [
            line("select * from t_trans join t_order on t_order.id = t_trans.order_id"),
            line("select * from t_trans t join t_order o on o.id = t.order_id"),
        ]
        found = mining.candidates(rows, ("shop",))
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0]["hits"], 2, "the pair is the key, not the spelling")

    def test_a_flipped_equality_is_the_same_pair(self):
        # `a.x = b.y` and `b.y = a.x` describe one join; two rows for it would let
        # the same edge be proposed twice.
        rows = [
            line("select * from t_trans t join t_order o on t.order_id = o.id"),
            line("select * from t_order o join t_trans t on o.id = t.order_id"),
        ]
        self.assertEqual(len(mining.candidates(rows, ("shop",))), 1)

    def test_the_limit_caps_the_result(self):
        rows = [line(f"select * from t{i} join u{i} on u{i}.id = t{i}.u_id") for i in range(5)]
        self.assertEqual(len(mining.candidates(rows, ("shop",), limit=3)), 3)


class StatementShapes(unittest.TestCase):
    def test_a_multi_hop_query_yields_every_join(self):
        sql = (
            "select * from t_line l "
            "join t_trans t on t.id = l.trans_id "
            "join t_order o on o.id = t.order_id"
        )
        found = mine(sql)
        self.assertCountEqual(
            found,
            [
                {("t_line", "trans_id"), ("t_trans", "id")},
                {("t_trans", "order_id"), ("t_order", "id")},
            ],
        )

    def test_a_quoted_statement_is_not_confused_by_a_string_literal(self):
        sql = "select * from t_trans t join t_order o on o.id = t.order_id and t.note = 'join on x = y'"
        self.assertEqual(mine(sql), [{("t_trans", "order_id"), ("t_order", "id")}])

    def test_the_columns_are_reported_lower_case(self):
        self.assertEqual(
            mine("select * from T_TRANS T join T_ORDER O on O.ID = T.ORDER_ID"),
            [{("t_trans", "order_id"), ("t_order", "id")}],
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
