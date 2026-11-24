"""Regression tests for `server/tracing.py`, the walker behind `trace_by_key`.

The cases that matter are the ones where a trace would otherwise look complete
but not be: a join nobody confirmed, a chain that stops halfway, a value with
more matches than the row cap, a table that appears twice in one walk. Each test
builds a real SQLite file, because the walker reads through `engines` and a stub
connection would not exercise the bound-parameter path at all.

Run it through `dev/engines.test.mjs` (`npm run test:engines`), which picks the
right interpreter.
"""

from __future__ import annotations

import importlib.util
import os
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

PACKAGE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PACKAGE / "server"))


def _load(name: str):
    spec = importlib.util.spec_from_file_location(name, PACKAGE / "server" / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


engines = _load("engines")
relations = _load("relations")
tracing = _load("tracing")


SCHEMA = """
create table t_order (id integer primary key, code text);
create table t_trans (id integer primary key, order_id integer references t_order(id), state text);
create table t_line (id integer primary key, trans_id integer references t_trans(id), sku text);
create table t_orphan (id integer primary key, note text);
create index t_order_code on t_order(code);
"""

SEED = """
insert into t_order (id, code) values (1, 'A001'), (2, 'A002');
insert into t_trans (id, order_id, state) values (10, 1, 'POSTED'), (11, 1, 'DRAFT'), (12, 2, 'POSTED');
insert into t_line (id, trans_id, sku) values (100, 10, 'SKU-1'), (101, 10, 'SKU-2'), (102, 11, 'SKU-3');
insert into t_orphan (id, note) values (1, 'nobody points here');
"""


class TraceOnARealDatabase(unittest.TestCase):
    def setUp(self):
        self.saved = os.environ.get("DB_MCP_RUNTIME")
        self.tmp = tempfile.TemporaryDirectory()
        os.environ["DB_MCP_RUNTIME"] = self.tmp.name
        self.path = Path(self.tmp.name) / "shop.db"
        seed = sqlite3.connect(str(self.path))
        try:
            seed.executescript(SCHEMA)
            seed.executescript(SEED)
            seed.commit()
        finally:
            seed.close()
        self.profile = {
            "id": "shop",
            "name": "shop",
            "kind": "sqlite",
            "config": {"file": str(self.path)},
            "readOnly": True,
        }
        self.connection, self.close = engines.connect(self.profile, None)

    def tearDown(self):
        self.close()
        if self.saved is None:
            os.environ.pop("DB_MCP_RUNTIME", None)
        else:
            os.environ["DB_MCP_RUNTIME"] = self.saved
        self.tmp.cleanup()

    # -- helpers -----------------------------------------------------------

    def _edge(self, from_table, from_column, to_table, to_column, status="confirmed"):
        """Record one edge and force its status, skipping the feedback stage."""
        relations.propose(self.profile, from_table, from_column, to_table, to_column)
        doc = relations.load(self.profile)
        for edge in doc["edges"]:
            if (
                edge["from"]["table"] == from_table
                and edge["from"]["column"] == from_column
                and edge["to"]["table"] == to_table
                and edge["to"]["column"] == to_column
            ):
                edge["status"] = status
        relations.save(self.profile, doc)

    def _chain(self, status="confirmed"):
        self._edge("t_trans", "order_id", "t_order", "id", status)
        self._edge("t_line", "trans_id", "t_trans", "id", status)

    def _trace(self, value, **kwargs):
        return tracing.trace(self.profile, self.connection, value, **kwargs)

    # -- the happy path ----------------------------------------------------

    def test_down_walks_into_the_rows_that_reference_it(self):
        self._chain()
        result = self._trace("1", entry_table="t_order", entry_column="id", direction="down")
        self.assertTrue(result["entry"]["picked"])
        self.assertEqual(result["entry"]["table"], "t_order")
        tables = [step["table"] for step in result["steps"]]
        self.assertEqual(tables, ["t_order", "t_trans", "t_line"])
        self.assertEqual(result["summary"]["depthReached"], 2)
        self.assertTrue(all(step["status"] == "hit" for step in result["steps"]))

    def test_the_value_never_appears_in_the_sql_text(self):
        self._chain()
        result = self._trace("1", entry_table="t_order", entry_column="id")
        for step in result["steps"]:
            self.assertNotIn("'1'", step["sql"])
            self.assertIn("?", step["sql"])
        self.assertEqual([str(item) for item in result["steps"][0]["condition"]["binds"]], ["1"])

    def test_a_quote_in_the_value_cannot_change_the_statement(self):
        self._chain()
        result = self._trace("1' or '1'='1", entry_table="t_order", entry_column="id")
        self.assertFalse(result["entry"]["picked"])
        self.assertEqual(result["steps"], [])
        self.assertIn("no_entry", [warning["code"] for warning in result["warnings"]])

    def test_up_walks_to_the_referenced_row(self):
        self._chain()
        result = self._trace("10", entry_table="t_trans", entry_column="id", direction="up")
        self.assertEqual([step["table"] for step in result["steps"]], ["t_trans", "t_order"])
        self.assertEqual(result["steps"][0]["rows"], 1)

    def test_both_finds_the_parent_and_the_children(self):
        self._chain()
        result = self._trace("1", entry_table="t_order", entry_column="id", direction="both")
        tables = [step["table"] for step in result["steps"]]
        self.assertEqual(tables[0], "t_order")
        self.assertIn("t_trans", tables)
        self.assertIn("t_line", tables)

    # -- the edges that must not be followed ------------------------------

    def test_a_pending_edge_is_reported_but_not_walked(self):
        self._chain(status="pending")
        result = self._trace("1", entry_table="t_order", entry_column="id")
        self.assertEqual([step["table"] for step in result["steps"]], ["t_order"])
        self.assertEqual(len(result["pending"]), 1)
        self.assertEqual(result["pending"][0]["wouldReach"]["table"], "t_trans")
        self.assertIn("no_edges", [warning["code"] for warning in result["warnings"]])

    def test_a_rejected_edge_is_not_followed(self):
        self._edge("t_trans", "order_id", "t_order", "id", status="rejected")
        result = self._trace("1", entry_table="t_order", entry_column="id")
        self.assertEqual([step["table"] for step in result["steps"]], ["t_order"])
        self.assertEqual(result["pending"], [])

    def test_a_trusted_edge_is_walked(self):
        self._chain(status="trusted")
        result = self._trace("1", entry_table="t_order", entry_column="id", direction="down")
        self.assertEqual([step["table"] for step in result["steps"]], ["t_order", "t_trans", "t_line"])

    # -- chains that break ------------------------------------------------

    def test_a_broken_chain_says_where_it_stopped(self):
        self._chain()
        result = self._trace("2", entry_table="t_order", entry_column="id", direction="down")
        statuses = [(step["table"], step["status"]) for step in result["steps"]]
        self.assertEqual(statuses[0], ("t_order", "hit"))
        self.assertEqual(statuses[1], ("t_trans", "hit"))
        # Order 2 has one transaction, which has no lines: the third hop is empty.
        self.assertEqual(statuses[2], ("t_line", "empty"))
        self.assertEqual(result["steps"][2]["rows"], 0)
        self.assertEqual(result["stoppedAt"][0]["table"], "t_line")
        self.assertIn("0 rows", result["steps"][2]["note"])

    def test_a_value_nobody_holds_stops_at_the_entry(self):
        self._chain()
        result = self._trace("999", entry_table="t_order", entry_column="id")
        self.assertFalse(result["entry"]["picked"])
        self.assertIn("no_entry", [warning["code"] for warning in result["warnings"]])

    # -- limits -----------------------------------------------------------

    def test_a_crowded_table_is_truncated_and_says_so(self):
        self._chain()
        result = self._trace(
            "1",
            entry_table="t_order",
            entry_column="id",
            direction="down",
            max_rows_per_table=1,
        )
        trans = [step for step in result["steps"] if step["table"] == "t_trans"][0]
        self.assertTrue(trans["truncated"])
        self.assertEqual(trans["rows"], 1)
        self.assertIn("1 rows", trans["note"])

    def test_the_depth_cap_is_reported(self):
        self._chain()
        result = self._trace("1", entry_table="t_order", entry_column="id", max_depth=1)
        self.assertEqual([step["table"] for step in result["steps"]], ["t_order", "t_trans"])
        self.assertIn("depth_limit", [warning["code"] for warning in result["warnings"]])

    def test_the_depth_cap_is_clamped(self):
        self._chain()
        result = self._trace("1", entry_table="t_order", entry_column="id", max_depth=99)
        self.assertLessEqual(result["summary"]["depthReached"], tracing.MAX_DEPTH_LIMIT)

    def test_an_unknown_direction_is_a_user_error(self):
        with self.assertRaises(Exception) as caught:
            self._trace("1", direction="sideways")
        self.assertEqual(getattr(caught.exception, "code", None), "user_error")

    def test_an_empty_value_is_a_user_error(self):
        with self.assertRaises(Exception) as caught:
            self._trace("   ")
        self.assertEqual(getattr(caught.exception, "code", None), "user_error")

    def test_a_named_column_that_does_not_exist_is_a_user_error(self):
        self._chain()
        with self.assertRaises(Exception) as caught:
            self._trace("1", entry_table="t_order", entry_column="nope")
        self.assertEqual(getattr(caught.exception, "code", None), "user_error")

    # -- probing without being told where to start ------------------------

    def test_it_finds_the_entry_without_being_told(self):
        self._chain()
        result = self._trace("1", direction="down")
        self.assertTrue(result["entry"]["picked"])
        # "1" lives in t_order.id, t_trans.id and t_trans.order_id, so which
        # table wins is a heuristic (the busiest one); what must hold is that
        # the picked column really is the first step and holds the value.
        self.assertTrue(result["steps"])
        first = result["steps"][0]
        self.assertEqual(first["table"], result["entry"]["table"])
        self.assertEqual(first["condition"]["column"], result["entry"]["column"])
        self.assertEqual([str(item) for item in first["condition"]["binds"]], ["1"])
        self.assertGreaterEqual(first["rows"], 1)
        # `candidates` lists what the probe actually tried before it hit, so the
        # picked column is always the last entry and the reasons are readable.
        tried = result["entry"]["candidates"]
        self.assertTrue(tried)
        self.assertEqual((tried[-1]["table"], tried[-1]["column"]), (result["entry"]["table"], result["entry"]["column"]))
        self.assertTrue(all(candidate["reason"] for candidate in tried))

    def test_the_entry_candidates_explain_themselves(self):
        self._chain()
        result = self._trace("1", direction="down")
        reasons = [candidate["reason"] for candidate in result["entry"]["candidates"]]
        self.assertTrue(reasons)
        self.assertTrue(all(isinstance(reason, str) and reason for reason in reasons))

    # -- cycles -----------------------------------------------------------

    def test_a_cycle_does_not_repeat_a_table_forever(self):
        self._chain()
        # A second edge back to the start: without the (table, column, value)
        # guard the walk would keep bouncing between the two tables.
        self._edge("t_order", "id", "t_trans", "id", status="confirmed")
        result = self._trace("1", entry_table="t_order", entry_column="id", direction="both", max_depth=6)
        visited = [
            (step["table"], step["condition"]["column"], tuple(str(item) for item in step["condition"]["binds"]))
            for step in result["steps"]
        ]
        self.assertEqual(len(visited), len(set(visited)), visited)
        self.assertLessEqual(len(result["steps"]), tracing.MAX_STEPS)
        # The same (table, column) may legitimately come back with a different
        # value; the guard is per value, not per column.
        self.assertGreater(len({(table, column) for table, column, _ in visited}), 1)

    # -- conditions -------------------------------------------------------

    def test_a_condition_narrows_the_side_that_holds_the_value(self):
        relations.propose(
            self.profile,
            "t_trans",
            "order_id",
            "t_order",
            "id",
            condition="state = 'POSTED'",
        )
        doc = relations.load(self.profile)
        doc["edges"][0]["status"] = "confirmed"
        relations.save(self.profile, doc)
        result = self._trace("1", entry_table="t_order", entry_column="id", direction="down")
        trans = [step for step in result["steps"] if step["table"] == "t_trans"][0]
        self.assertEqual(trans["condition"]["extra"], "state = 'POSTED'")
        self.assertEqual(trans["rows"], 1, "the DRAFT transaction must be filtered out")

    def test_a_condition_on_a_missing_column_falls_back_instead_of_failing(self):
        # A condition is a guess about a column that may not exist on this table.
        # The typo must cost the narrowing, not the whole trace.
        self._chain()
        relations.propose(
            self.profile,
            "t_line",
            "trans_id",
            "t_trans",
            "id",
            condition="no_such_column = 1",
        )
        result = self._trace("1", entry_table="t_order", entry_column="id", direction="down")
        self.assertNotIn("error", result, result.get("warnings"))
        line = [step for step in result["steps"] if step["table"] == "t_line"][0]
        self.assertEqual(line["status"], "hit")
        self.assertGreater(line["rows"], 0)
        self.assertIsNone(
            line["condition"]["extra"], "the step must report the statement that ran"
        )
        self.assertNotIn("no_such_column", line["sql"])
        codes = [warning["code"] for warning in result["warnings"]]
        self.assertIn("condition_failed", codes)

    def test_the_condition_is_not_applied_to_the_referenced_side(self):
        relations.propose(
            self.profile,
            "t_trans",
            "order_id",
            "t_order",
            "id",
            condition="state = 'POSTED'",
        )
        doc = relations.load(self.profile)
        doc["edges"][0]["status"] = "confirmed"
        relations.save(self.profile, doc)
        result = self._trace("1", entry_table="t_order", entry_column="id", direction="down")
        order = [step for step in result["steps"] if step["table"] == "t_order"][0]
        self.assertIsNone(order["condition"]["extra"])

    # -- sampling ---------------------------------------------------------

    def test_a_sample_stays_small_and_prefers_the_keys(self):
        self._chain()
        result = self._trace("1", entry_table="t_order", entry_column="id", direction="down")
        for step in result["steps"]:
            self.assertLessEqual(len(step["sample"]["rows"]), tracing.SAMPLE_ROWS)
            self.assertLessEqual(len(step["sample"]["columns"]), tracing.SAMPLE_COLUMNS)
            self.assertEqual(step["sample"]["columns"][0], "id", "the primary key leads the sample")

    def test_an_empty_step_carries_no_sample(self):
        self._chain()
        result = self._trace("2", entry_table="t_order", entry_column="id", direction="down")
        empty = [step for step in result["steps"] if step["status"] == "empty"][0]
        self.assertEqual(empty["sample"], {"columns": [], "rows": []})


class TraceShape(unittest.TestCase):
    """The reply shape a panel and a model both read."""

    def setUp(self):
        self.saved = os.environ.get("DB_MCP_RUNTIME")
        self.tmp = tempfile.TemporaryDirectory()
        os.environ["DB_MCP_RUNTIME"] = self.tmp.name
        self.profile = {
            "id": "empty",
            "name": "empty",
            "kind": "sqlite",
            "config": {"file": str(Path(self.tmp.name) / "nothing.db")},
            "readOnly": True,
        }

    def tearDown(self):
        if self.saved is None:
            os.environ.pop("DB_MCP_RUNTIME", None)
        else:
            os.environ["DB_MCP_RUNTIME"] = self.saved
        self.tmp.cleanup()

    def test_an_empty_graph_returns_the_whole_shape(self):
        path = Path(self.tmp.name) / "nothing.db"
        seed = sqlite3.connect(str(path))
        try:
            seed.execute("create table t (id integer primary key)")
            seed.commit()
        finally:
            seed.close()
        connection, close = engines.connect(self.profile, None)
        try:
            result = tracing.trace(self.profile, connection, "1")
        finally:
            close()
        self.assertEqual(
            set(result),
            {"value", "direction", "elapsedMs", "entry", "summary", "steps", "pending", "warnings", "stoppedAt"},
        )
        self.assertEqual(set(result["summary"]), {"tablesHit", "tablesVisited", "rowsRead", "steps", "depthReached"})
        self.assertIn("no_edges", [warning["code"] for warning in result["warnings"]])

    def test_the_clamps_are_applied(self):
        self.assertEqual(tracing._clamp(99, 1, 6, 3), 6)
        self.assertEqual(tracing._clamp(0, 1, 6, 3), 1)
        self.assertEqual(tracing._clamp("x", 1, 6, 3), 3)
        self.assertEqual(tracing._clamp(None, 1, 200, 20), 20)


if __name__ == "__main__":
    sys.exit(unittest.main(verbosity=2))
