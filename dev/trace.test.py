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
scenes = _load("scenes")
tracing = _load("tracing")


SCHEMA = """
create table t_order (id integer primary key, code text);
create table t_trans (id integer primary key, order_id integer references t_order(id), state text);
create table t_line (id integer primary key, trans_id integer references t_trans(id), sku text);
create table t_orphan (id integer primary key, note text);
create table t_node (id integer primary key, parent_id integer references t_node(id), name text);
create table t_left (id integer primary key, order_id integer);
create table t_right (id integer primary key, order_id integer);
create table t_shared (id integer primary key, name text, left_id integer, right_id integer);
create index t_order_code on t_order(code);
"""

SEED = """
insert into t_order (id, code) values (1, 'A001'), (2, 'A002');
insert into t_trans (id, order_id, state) values (10, 1, 'POSTED'), (11, 1, 'DRAFT'), (12, 2, 'POSTED');
insert into t_line (id, trans_id, sku) values (100, 10, 'SKU-1'), (101, 10, 'SKU-2'), (102, 11, 'SKU-3');
insert into t_orphan (id, note) values (1, 'nobody points here');
insert into t_node (id, parent_id, name) values (1, null, 'root'), (2, 1, 'child'), (3, 2, 'grandchild'), (4, 3, 'great');
insert into t_left (id, order_id) values (900, 1);
insert into t_right (id, order_id) values (910, 1);
insert into t_shared (id, name, left_id, right_id) values (500, 'via left', 900, null), (501, 'via right', null, 910);
"""


class _Walk(unittest.TestCase):
    """The fixture every walk test needs: a real SQLite file and a connection.

    Kept as a plain base so a subclass can add its own cases without inheriting
    (and re-running) every case of the main suite.
    """

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


class TraceOnARealDatabase(_Walk):
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

    def test_the_depth_cap_is_one_line_naming_what_it_hid(self):
        """A cap is worth one line, and only for a table the walk never read.

        A graph with a cycle puts every step at the cap, so a warning per capped
        step would be several lines each naming a table already on screen.
        """
        self._chain()
        result = self._trace("1", entry_table="t_order", entry_column="id", max_depth=1)
        warnings = [warning for warning in result["warnings"] if warning["code"] == "depth_limit"]
        self.assertEqual(len(warnings), 1)
        message = warnings[0]["message"]
        self.assertIn("t_line", message)
        self.assertNotIn("t_trans", message)
        self.assertIn("raise max_depth", message)

    def test_a_depth_cap_that_hid_nothing_says_nothing(self):
        """Deep enough to read everything: no cap warning at all."""
        self._chain()
        result = self._trace("1", entry_table="t_order", entry_column="id", max_depth=5)
        self.assertNotIn("depth_limit", [warning["code"] for warning in result["warnings"]])

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

    # -- self references ---------------------------------------------------

    def test_a_self_reference_walks_both_ways(self):
        # `t_node.parent_id -> t_node.id` touches one table on both sides. The
        # walker must see both halves, or a hierarchy can only be climbed or only
        # descended, never both.
        self._edge("t_node", "parent_id", "t_node", "id", status="confirmed")
        down = self._trace("1", entry_table="t_node", entry_column="id", direction="down", max_depth=4)
        self.assertEqual(down["summary"]["tablesHit"], 1, down["summary"])
        self.assertIn("parent_id", [step["condition"]["column"] for step in down["steps"]])
        self.assertGreaterEqual(down["steps"][-1]["depth"], 1)
        reached = [str(item) for step in down["steps"] for item in step["condition"]["binds"]]
        self.assertIn("2", reached, "the child must be reachable from the parent")

        up = self._trace("4", entry_table="t_node", entry_column="id", direction="up", max_depth=4)
        self.assertIn("id", [step["condition"]["column"] for step in up["steps"]])
        self.assertEqual(up["steps"][-1]["depth"], 3, "four rows means three hops to the root")

    def test_a_self_reference_does_not_walk_the_same_value_twice(self):
        self._edge("t_node", "parent_id", "t_node", "id", status="confirmed")
        result = self._trace("1", entry_table="t_node", entry_column="id", direction="both", max_depth=6)
        seen = [
            (step["table"], step["condition"]["column"], tuple(str(item) for item in step["condition"]["binds"]))
            for step in result["steps"]
        ]
        self.assertEqual(len(seen), len(set(seen)), seen)

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

    # -- the cost of a step ------------------------------------------------

    def _costly(self, indexed=False, rows=5_000_000):
        """Put a cost fact on the trans→order edge: an unindexed big target."""
        doc = relations.load(self.profile)
        edge = next(item for item in doc["edges"] if item["to"]["table"] == "t_order")
        edge["stats"]["indexed"] = indexed
        edge["stats"]["rowEstimate"] = rows
        relations.save(self.profile, doc)
        return edge["id"]

    def test_a_full_scan_is_not_run_without_permission(self):
        self._chain()
        edge_id = self._costly()
        result = self._trace("10", entry_table="t_trans", entry_column="id", direction="up")
        statuses = [(step["table"], step["status"]) for step in result["steps"]]
        self.assertEqual(statuses[0], ("t_trans", "hit"))
        self.assertEqual(statuses[1], ("t_order", "needs_confirm"), "the scan is asked about, not paid for")
        self.assertEqual(result["summary"]["needsConfirm"], 1)
        self.assertIn("needs_confirm", [warning["code"] for warning in result["warnings"]])
        self.assertEqual(result["stoppedAt"][0]["table"], "t_order")

    def test_the_stopped_step_carries_no_rows_and_no_statement(self):
        self._chain()
        self._costly()
        result = self._trace("10", entry_table="t_trans", entry_column="id", direction="up")
        stopped = [step for step in result["steps"] if step["status"] == "needs_confirm"][0]
        self.assertEqual(stopped["rows"], 0)
        self.assertEqual(stopped["sql"], "", "nothing ran, so there is no statement to report")
        self.assertEqual(stopped["sample"], {"columns": [], "rows": []})
        self.assertEqual(stopped["cost"]["rowEstimate"], 5_000_000)
        self.assertEqual([str(item) for item in stopped["condition"]["binds"]], ["1"], "the parent id the walk arrived with")

    def test_a_refused_scan_is_listed_as_a_target_to_confirm(self):
        # One trace collects every expensive hop it met, so the reader can decide
        # once. The list is what the panel turns into checkboxes: which join, what
        # it would cost, and why it is expensive.
        self._chain()
        edge_id = self._costly()
        result = self._trace("10", entry_table="t_trans", entry_column="id", direction="up")
        targets = result["confirmTargets"]
        self.assertEqual(len(targets), 1)
        target = targets[0]
        self.assertEqual(target["table"], "t_order")
        self.assertEqual(target["column"], "id")
        self.assertEqual(target["edge"], edge_id)
        self.assertEqual(target["rowEstimate"], 5_000_000)
        self.assertIn("no index", target["reason"])

    def test_no_confirmation_asked_means_an_empty_target_list(self):
        self._chain()
        result = self._trace("1", entry_table="t_order", entry_column="id", direction="down")
        self.assertEqual(result["confirmTargets"], [])

    def test_approving_one_edge_runs_only_that_edge(self):
        # The list is a set of ids, not a switch: approving the hop the reader
        # ticked must not wave through a different expensive hop further on.
        self._chain()
        approved_id = self._costly()
        doc = relations.load(self.profile)
        for edge in doc["edges"]:
            edge["stats"]["indexed"] = False
            edge["stats"]["rowEstimate"] = 5_000_000
        relations.save(self.profile, doc)
        result = self._trace(
            "10",
            entry_table="t_trans",
            entry_column="id",
            direction="up",
            confirm_slow=[approved_id],
        )
        statuses = [(step["table"], step["status"]) for step in result["steps"]]
        self.assertEqual(statuses[1], ("t_order", "hit"), "the approved hop ran")
        approved = [step for step in result["steps"] if step["status"] == "hit" and step.get("confirmed")]
        self.assertTrue(approved, "the step says it was approved, not that it was free")

    def test_an_unapproved_edge_still_stops_the_walk(self):
        self._chain()
        self._costly()
        other = "e_not_this_one"
        result = self._trace(
            "10",
            entry_table="t_trans",
            entry_column="id",
            direction="up",
            confirm_slow=[other],
        )
        statuses = [(step["table"], step["status"]) for step in result["steps"]]
        self.assertEqual(statuses[1], ("t_order", "needs_confirm"), "an unknown id approves nothing")

    def test_an_approved_scan_that_times_out_is_marked_unfinished(self):
        # Approving a scan buys the attempt, not the answer: if the statement hits
        # its timeout the step must read as unfinished rather than as "0 rows".
        self._chain()
        edge_id = self._costly()
        real = tracing.engines.fetch_matching

        def explode(profile, connection, table, column, *args, **kwargs):
            # Only the expensive hop may fail: the entry probe runs through the same
            # call, and blowing that up would test "no entry" instead.
            if str(table).lower() == "t_order":
                raise tracing.engines.DbError("timeout", "canceling statement due to statement timeout")
            return real(profile, connection, table, column, *args, **kwargs)

        tracing.engines.fetch_matching = explode
        try:
            result = self._trace(
                "10",
                entry_table="t_trans",
                entry_column="id",
                direction="up",
                confirm_slow=[edge_id],
            )
        finally:
            tracing.engines.fetch_matching = real
        step = [item for item in result["steps"] if item["table"] == "t_order"][0]
        self.assertTrue(step.get("timedOut"), "a cut-short scan is not a zero-row answer")
        self.assertIn("statement timeout", str(step.get("note") or ""))

    def test_persistently_slow_samples_ask_even_with_a_small_table(self):
        # A small table that takes seconds every single time is worth asking about
        # just as much as a big one; the rule does not depend on the row estimate.
        self._chain()
        doc = relations.load(self.profile)
        edge = next(item for item in doc["edges"] if item["to"]["table"] == "t_order")
        edge["stats"]["indexed"] = True
        edge["stats"]["rowEstimate"] = 100
        edge["stats"]["timings"] = [1500, 1600, 1700]
        relations.save(self.profile, doc)
        result = self._trace("10", entry_table="t_trans", entry_column="id", direction="up")
        statuses = [(step["table"], step["status"]) for step in result["steps"]]
        self.assertEqual(statuses[1], ("t_order", "needs_confirm"), "indexed and small, but slow every time")
        self.assertIn("1000ms", result["confirmTargets"][0]["reason"])

    def test_confirm_slow_runs_the_scan(self):
        self._chain()
        self._costly()
        result = self._trace("10", entry_table="t_trans", entry_column="id", direction="up", confirm_slow=True)
        statuses = [(step["table"], step["status"]) for step in result["steps"]]
        self.assertEqual(statuses[1], ("t_order", "hit"))
        self.assertEqual(result["summary"]["needsConfirm"], 0)
        self.assertNotIn("needs_confirm", [warning["code"] for warning in result["warnings"]])

    def test_an_indexed_big_table_is_not_asked_about(self):
        self._chain()
        self._costly(indexed=True)
        result = self._trace("10", entry_table="t_trans", entry_column="id", direction="up")
        self.assertNotIn("needs_confirm", [step["status"] for step in result["steps"]])
        self.assertEqual(result["summary"]["needsConfirm"], 0)

    def test_a_small_unindexed_table_is_not_asked_about(self):
        self._chain()
        self._costly(indexed=False, rows=90)
        result = self._trace("10", entry_table="t_trans", entry_column="id", direction="up")
        self.assertNotIn("needs_confirm", [step["status"] for step in result["steps"]])

    def test_each_step_reports_how_long_it_took(self):
        self._chain()
        result = self._trace("1", entry_table="t_order", entry_column="id", direction="down")
        for step in result["steps"]:
            self.assertIsInstance(step["ms"], int)
            self.assertGreaterEqual(step["ms"], 0)

    def test_a_trace_stores_its_timings_on_the_edge(self):
        self._chain()
        result = self._trace("1", entry_table="t_order", entry_column="id", direction="down")
        walked = [step for step in result["steps"] if step.get("edge") and step["status"] in ("hit", "empty")]
        self.assertTrue(walked, "the walk has to travel an edge for a timing to land somewhere")
        listed = {edge["id"]: edge for edge in relations.list_edges(self.profile)["edges"]}
        for step in walked:
            stats = listed[step["edge"]["id"]]["stats"]
            self.assertTrue(stats["timings"], f"{step['table']} left no timing")
            self.assertEqual(stats["lastMs"], step["ms"])
            self.assertIsInstance(stats["avgMs"], float)


class ScenesNarrowTheWalk(_Walk):
    """A scene chooses which tables a walk may read; it must never hide the join."""

    def _scene(self, name, tables):
        return scenes.save_scene(self.profile, name, tables)["scene"]

    def test_a_scene_keeps_the_walk_inside(self):
        self._chain()
        scene = self._scene("orders only", ["t_order", "t_trans"])
        result = self._trace(
            "1",
            entry_table="t_order",
            entry_column="id",
            direction="down",
            scene=scene["id"],
        )
        self.assertEqual([step["table"] for step in result["steps"]], ["t_order", "t_trans"])
        self.assertEqual(result["scene"]["id"], scene["id"])
        self.assertEqual(result["summary"]["outside"], 1)
        self.assertEqual([item["table"] for item in result["outside"]], ["t_line"])

    def test_the_table_left_out_is_reported_not_silently_dropped(self):
        self._chain()
        scene = self._scene("orders only", ["t_order", "t_trans"])
        result = self._trace(
            "1", entry_table="t_order", entry_column="id", direction="down", scene=scene["name"]
        )
        outside = result["outside"][0]
        self.assertEqual(outside["table"], "t_line")
        self.assertEqual(outside["from"]["table"], "t_trans")
        self.assertIn("scene", outside["reason"])
        self.assertTrue(outside["edge"]["id"], "the join it would have taken is named")

    def test_the_same_walk_without_a_scene_reaches_everything(self):
        self._chain()
        result = self._trace("1", entry_table="t_order", entry_column="id", direction="down")
        self.assertEqual([step["table"] for step in result["steps"]], ["t_order", "t_trans", "t_line"])
        self.assertEqual(result["outside"], [])
        self.assertIsNone(result["scene"])

    def test_an_unknown_scene_is_a_user_error(self):
        self._chain()
        with self.assertRaises(Exception) as caught:
            self._trace("1", entry_table="t_order", entry_column="id", scene="nope")
        self.assertEqual(getattr(caught.exception, "code", None), "user_error")

    def test_every_step_says_whether_it_was_inside_the_scene(self):
        self._chain()
        scene = self._scene("orders only", ["t_order", "t_trans"])
        result = self._trace(
            "1", entry_table="t_order", entry_column="id", direction="down", scene=scene["id"]
        )
        for step in result["steps"]:
            self.assertTrue(step["inside"], step["table"])

    def test_a_scene_with_stages_is_read_in_business_order(self):
        self._chain()
        scene = self._scene("cash", ["t_order", "t_trans", "t_line"])
        scenes.save_scene(
            self.profile, "cash", ["t_order", "t_trans", "t_line"],
            stages=[
                {"name": "Order", "table": "t_order", "locate": "edge"},
                {"name": "Transaction", "table": "t_trans", "locate": "edge"},
                {"name": "Line", "table": "t_line", "locate": "edge"},
            ],
        )
        result = self._trace(
            "1", entry_table="t_order", entry_column="id", direction="down", scene=scene["id"]
        )
        stages = result["stages"]
        self.assertEqual(stages["mode"], "scene")
        self.assertEqual([r["stage"] for r in stages["rows"]], ["Order", "Transaction", "Line"])
        self.assertTrue(all(not r["missed"] for r in stages["rows"]))
        self.assertEqual(stages["rows"][0]["found"], 1)
        self.assertEqual(stages["rows"][1]["found"], 2)

    def test_a_stage_the_walk_missed_is_a_grey_placeholder(self):
        scenes.save_scene(
            self.profile, "cash", ["t_order", "t_orphan"],
            stages=[
                {"name": "Order", "table": "t_order", "locate": "edge"},
                {"name": "Orphan", "table": "t_orphan", "locate": "edge"},
            ],
        )
        result = self._trace(
            "1", entry_table="t_order", entry_column="id", direction="down", scene="cash"
        )
        stages = result["stages"]
        self.assertEqual(len(stages["rows"]), 2)
        self.assertTrue(stages["rows"][0]["missed"] is False)
        self.assertTrue(stages["rows"][1]["missed"])
        self.assertEqual(stages["rows"][1]["found"], 0)
        self.assertIsNone(stages["rows"][1]["step"])

    def test_a_scene_without_stages_has_no_stage_view(self):
        self._chain()
        scene = self._scene("orders only", ["t_order", "t_trans"])
        result = self._trace(
            "1", entry_table="t_order", entry_column="id", direction="down", scene=scene["id"]
        )
        self.assertIsNone(result["stages"])

    def test_a_free_walk_has_no_stage_view(self):
        self._chain()
        result = self._trace("1", entry_table="t_order", entry_column="id", direction="down")
        self.assertIsNone(result["stages"])


class PhaseCBusinessKeys(_Walk):
    """Phase C: a stage can be located by a business key or a loose match.

    The rules these cases guard are the ones that keep the new locators honest:
    an alias stage must work with no edge at all, a value the column's family
    cannot hold must be skipped with a warning instead of failing the walk, weak
    matches must never feed the BFS counters, and a table reachable both by edge
    and by alias must be read once.
    """

    def _scene(self, stages, aliases=None, input_alias=None, weak=None, tables=None):
        return scenes.save_scene(
            self.profile,
            "cash",
            tables or ["t_order", "t_trans", "t_shared"],
            stages=stages,
            aliases=aliases,
            input_alias=input_alias,
            weak_match=weak,
        )["scene"]

    # -- decision 1: an alias stage needs no edge -------------------------

    def test_an_alias_stage_is_located_without_any_edge(self):
        scene = self._scene(
            [
                {"name": "Order", "table": "t_order", "locate": "edge"},
                {"name": "Payment", "table": "t_trans", "locate": "alias"},
            ],
            aliases={"serial": [{"table": "t_trans", "column": "order_id"}]},
            input_alias="serial",
            tables=["t_order", "t_trans"],
        )
        result = self._trace(
            "1", entry_table="t_order", entry_column="id", direction="down", scene=scene["id"]
        )
        # No join between the two tables at all: the walk alone reads t_order.
        self.assertEqual([step["table"] for step in result["steps"]], ["t_order"])
        rows = {row["stage"]: row for row in result["stages"]["rows"]}
        self.assertEqual(rows["Payment"]["locate"], "alias")
        self.assertEqual(rows["Payment"]["found"], 2, "order_id = 1 holds two rows")
        self.assertFalse(rows["Payment"]["missed"])
        self.assertIn("serial", rows["Payment"]["matchRule"])

    # -- decision 4: inputAlias is required -------------------------------

    def test_a_stage_that_locates_by_alias_needs_an_input_alias(self):
        with self.assertRaises(Exception) as caught:
            self._scene(
                [{"name": "Payment", "table": "t_trans", "locate": "alias"}],
                aliases={"serial": [{"table": "t_trans", "column": "order_id"}]},
                tables=["t_order", "t_trans"],
            )
        self.assertEqual(getattr(caught.exception, "code", None), "user_error")
        self.assertIn("inputAlias", str(caught.exception))

    def test_the_input_alias_must_be_one_of_the_aliases(self):
        with self.assertRaises(Exception) as caught:
            self._scene(
                [{"name": "Payment", "table": "t_trans", "locate": "alias"}],
                aliases={"serial": [{"table": "t_trans", "column": "order_id"}]},
                input_alias="unknown",
                tables=["t_order", "t_trans"],
            )
        self.assertEqual(getattr(caught.exception, "code", None), "user_error")

    # -- decision 5: convert by column family, skip with a warning --------

    def test_a_binding_is_converted_to_the_target_column_family(self):
        self.assertEqual(tracing._convert_binding("1", "number"), 1)
        self.assertEqual(tracing._convert_binding("1.5", "number"), 1.5)
        self.assertEqual(tracing._convert_binding("A001", "char"), "A001")
        self.assertEqual(tracing._convert_binding("A001", "date"), "A001")
        self.assertIsNone(tracing._convert_binding("not a number", "number"))

    def test_a_value_the_column_cannot_hold_is_skipped_with_a_warning(self):
        scene = self._scene(
            [{"name": "Payment", "table": "t_trans", "locate": "alias"}],
            aliases={"serial": [{"table": "t_trans", "column": "order_id"}]},
            input_alias="serial",
            tables=["t_order", "t_trans"],
        )
        # t_order.code is text (so "A001" is a valid entry) while the alias
        # target t_trans.order_id is an integer: the key cannot be bound there.
        result = self._trace(
            "A001",
            entry_table="t_order",
            entry_column="code",
            direction="down",
            scene=scene["id"],
        )
        codes = [warning.get("code") for warning in result["warnings"]]
        self.assertIn("alias_bind_failed", codes)
        row = result["stages"]["rows"][0]
        self.assertEqual(row["found"], 0)
        self.assertTrue(row["missed"])

    # -- decision 2: weak rows never seed and never count ------------------

    def test_a_weak_match_is_reported_but_never_walked(self):
        scene = self._scene(
            [
                {"name": "Order", "table": "t_order", "locate": "edge"},
                {"name": "Shared", "table": "t_shared", "locate": "weak"},
            ],
            weak=[{"fromStage": "Order", "fromColumn": "id", "toColumn": "t_shared.left_id", "op": "eq"}],
            tables=["t_order", "t_shared"],
        )
        result = self._trace(
            "1", entry_table="t_order", entry_column="id", direction="down", scene=scene["id"]
        )
        step_tables = [step["table"] for step in result["steps"]]
        self.assertNotIn("t_shared", step_tables, "a weak match must not be a walk step")
        self.assertEqual(result["summary"]["steps"], len(result["steps"]))
        self.assertEqual(
            result["summary"]["tablesHit"],
            len({step["table"] for step in result["steps"]}),
            "weak tables must not join the hit count",
        )
        weak = result["stages"]["weak"]
        self.assertEqual(len(weak), 1)
        self.assertEqual(weak[0]["table"], "t_shared")
        self.assertTrue(weak[0]["weak"])

    # -- decision 6: the loose ops and their rule text ---------------------

    def test_same_day_and_within_minutes_filter_loosely(self):
        self.assertTrue(tracing._weak_compare("2026-01-01 10:00:00", ["2026-01-01"], "same_day", 60))
        self.assertFalse(tracing._weak_compare("2026-01-02 10:00:00", ["2026-01-01"], "same_day", 60))
        self.assertTrue(
            tracing._weak_compare("2026-01-01 10:20:00", ["2026-01-01 10:00:00"], "within_minutes", 30)
        )
        self.assertFalse(
            tracing._weak_compare("2026-01-01 10:45:00", ["2026-01-01 10:00:00"], "within_minutes", 30)
        )
        self.assertTrue(tracing._weak_compare("7", ["7"], "eq", 0))
        self.assertFalse(tracing._weak_compare(None, ["7"], "eq", 0))

    def test_the_weak_rule_says_what_it_matched_on(self):
        match = {"fromStage": "Order", "fromColumn": "created_at", "toColumn": "t_ship.created_at"}
        self.assertIn("Order.created_at", tracing._weak_rule(match, "same_day", 60))
        self.assertIn("same day", tracing._weak_rule(match, "same_day", 60))
        self.assertIn("within 30 minutes", tracing._weak_rule(match, "within_minutes", 30))
        self.assertIn("equal", tracing._weak_rule(match, "eq", 60))

    # -- decision 7: the IN cap is 50, and truncation is reported ----------

    def test_the_weak_in_list_is_capped_and_says_so(self):
        declared = [
            {"name": "Order", "table": "t_order", "locate": "edge"},
            {"name": "Shared", "table": "t_shared", "locate": "weak"},
        ]
        scene = {
            "stages": declared,
            "weakMatch": [
                {"fromStage": "Order", "fromColumn": "id", "toColumn": "t_shared.left_id", "op": "eq"}
            ],
        }
        source = {"sample": {"columns": ["id"], "rows": [[index] for index in range(60)]}}
        # tracing imports engines through sys.path, which is a different module
        # object from the one this test file loaded: patch the one it calls.
        original = tracing.engines.scan_bounded
        tracing.engines.scan_bounded = lambda *args, **kwargs: {
            "columns": ["left_id"], "rows": [[900]], "truncated": False, "sql": "select * from t_shared"
        }
        try:
            warnings = []
            rows = tracing._weak_rows(
                self.profile, self.connection, scene, declared, {"Order": source}, warnings
            )
        finally:
            tracing.engines.scan_bounded = original
        self.assertEqual(len(rows), 1)
        self.assertEqual(len(rows[0]["inValues"]), scenes.IN_VALUE_CAP)
        self.assertTrue(rows[0]["inTruncated"], "60 source values do not fit the cap")

    # -- decision 8: a timeout is an incomplete stage, not an empty one ----

    def test_a_timed_out_weak_lookup_is_incomplete_not_zero(self):
        declared = [
            {"name": "Order", "table": "t_order", "locate": "edge"},
            {"name": "Shared", "table": "t_shared", "locate": "weak"},
        ]
        scene = {
            "stages": declared,
            "weakMatch": [
                {"fromStage": "Order", "fromColumn": "id", "toColumn": "t_shared.left_id", "op": "eq"}
            ],
        }
        source = {"sample": {"columns": ["id"], "rows": [[1]]}}
        # Same reason as above: tracing calls the sys.path engines module.
        original = tracing.engines.scan_bounded

        def boom(*args, **kwargs):
            raise tracing.engines.DbError("timeout", "canceling statement due to statement timeout")

        tracing.engines.scan_bounded = boom
        try:
            warnings = []
            rows = tracing._weak_rows(
                self.profile, self.connection, scene, declared, {"Order": source}, warnings
            )
        finally:
            tracing.engines.scan_bounded = original
        self.assertEqual(len(rows), 1)
        self.assertTrue(rows[0]["incomplete"])
        self.assertFalse(rows[0]["missed"], "a timeout is not the same as no match")
        self.assertEqual(rows[0]["found"], 0)
        self.assertIn("weak_timeout", [warning.get("code") for warning in warnings])

    # -- decision 9: a declared locate wins over an edge -------------------

    def test_a_table_reachable_both_ways_is_read_once(self):
        self._edge("t_trans", "order_id", "t_order", "id")
        scene = self._scene(
            [
                {"name": "Order", "table": "t_order", "locate": "edge"},
                {"name": "Payment", "table": "t_trans", "locate": "alias"},
            ],
            aliases={"serial": [{"table": "t_trans", "column": "order_id"}]},
            input_alias="serial",
            tables=["t_order", "t_trans"],
        )
        result = self._trace(
            "1", entry_table="t_order", entry_column="id", direction="down", scene=scene["id"]
        )
        stage_rows = result["stages"]["rows"]
        self.assertEqual([row["stage"] for row in stage_rows], ["Order", "Payment"])
        self.assertEqual(len(stage_rows), 2, "the edge hit and the alias hit must not both be printed")
        self.assertEqual(result["stages"]["other"], [], "the claimed step is not re-listed as other")
        self.assertEqual(stage_rows[1]["locate"], "alias")


class TheTreeShape(_Walk):
    """`nodes` mirrors `steps`, indented; a table already read is not repeated."""

    def _edge(self, from_table, from_column, to_table, to_column, status="confirmed"):
        super()._edge(from_table, from_column, to_table, to_column, status)

    def _fan(self):
        """t_order -> t_left and t_order -> t_right both reach t_shared."""
        self._edge("t_left", "order_id", "t_order", "id")
        self._edge("t_right", "order_id", "t_order", "id")
        self._edge("t_shared", "left_id", "t_left", "id")
        self._edge("t_shared", "right_id", "t_right", "id")

    def test_the_tree_mirrors_the_steps(self):
        self._fan()
        result = self._trace("1", entry_table="t_order", entry_column="id", direction="down")
        flat = [
            (step["index"], step["table"], step["depth"], step["parent"]) for step in result["steps"]
        ]
        walked = []

        def walk(nodes):
            for node in nodes:
                walked.append((node["index"], node["table"], node["depth"], node["parent"]))
                walk(node["children"])

        walk(result["nodes"])
        # `steps` is the breadth-first order the walker took; the tree is the same
        # nodes read depth-first. Same set, and the parent links must agree — the
        # order differs on purpose, so compare sorted by index.
        self.assertEqual(sorted(walked), sorted(flat))

    def test_the_entry_is_the_only_root(self):
        self._chain()
        result = self._trace("1", entry_table="t_order", entry_column="id", direction="down")
        self.assertEqual(len(result["nodes"]), 1)
        self.assertIsNone(result["nodes"][0]["parent"])
        self.assertIsNone(result["nodes"][0]["edge"])

    def test_a_child_hangs_off_the_step_that_reached_it(self):
        self._chain()
        result = self._trace("1", entry_table="t_order", entry_column="id", direction="down")
        root = result["nodes"][0]
        self.assertEqual(root["table"], "t_order")
        self.assertEqual([child["table"] for child in root["children"]], ["t_trans"])
        grandchild = root["children"][0]["children"][0]
        self.assertEqual(grandchild["table"], "t_line")
        self.assertEqual(grandchild["depth"], 2)

    def test_a_table_reached_twice_is_reported_once(self):
        """A table the walk already read is not reported again: its rows were
        fetched upstream, so a second box would only repeat them."""
        self._fan()
        result = self._trace("1", entry_table="t_order", entry_column="id", direction="down")
        shared = [step for step in result["steps"] if step["table"] == "t_shared"]
        self.assertEqual(len(shared), 1)
        self.assertNotIn("repeated", result["summary"])
        self.assertNotIn("repeated", shared[0])

    def test_a_table_already_read_is_not_walked_a_second_time(self):
        self._fan()
        result = self._trace("1", entry_table="t_order", entry_column="id", direction="down")
        rows = {
            (step["table"], tuple(str(item) for item in step["condition"]["binds"]))
            for step in result["steps"]
        }
        self.assertEqual(len(rows), len(set(rows)))
        tables = [step["table"] for step in result["steps"]]
        self.assertEqual(len(tables), len(set(tables)))

    def test_a_table_that_comes_back_after_a_detour_is_not_reported_again(self):
        """A -> B -> A is not a continuation: the second A holds no rows the
        reader does not already have.

        A cycle through other tables used to be excepted because A was an
        ancestor on the path, so a walk that left t_order, read t_trans and
        came back reported t_order a second time.
        """
        self._chain()
        # One more edge back into t_trans, so the walk can return to t_order.
        self._edge("t_order", "id", "t_trans", "id")
        result = self._trace("1", entry_table="t_order", entry_column="id", direction="both", max_depth=6)
        tables = [step["table"] for step in result["steps"]]
        self.assertEqual(tables.count("t_order"), 1, tables)
        self.assertIn("t_trans", tables, "the walk must still go on along the cycle")

    def test_a_node_carries_what_the_panel_needs_to_read_it(self):
        """The panel shows the bound values and the sample rows off the node, so
        the node has to carry them — otherwise every step reads as a dash."""
        self._chain()
        result = self._trace("1", entry_table="t_order", entry_column="id", direction="down")
        root = result["nodes"][0]
        self.assertIn("condition", root)
        self.assertIn("binds", root["condition"])
        self.assertEqual(root["condition"]["binds"], ["1"])
        self.assertIn("sql", root)
        self.assertIn("sample", root)
        child = root["children"][0]
        self.assertEqual(
            [str(item) for item in child["condition"]["binds"]], [str(root["sample"]["rows"][0][0])]
        )

    def test_the_summary_counts_the_tables_outside_the_scene(self):
        self._fan()
        scene = scenes.save_scene(self.profile, "no shared", ["t_order", "t_left", "t_right"])["scene"]
        result = self._trace(
            "1", entry_table="t_order", entry_column="id", direction="down", scene=scene["id"]
        )
        self.assertGreaterEqual(result["summary"]["outside"], 1)
        self.assertNotIn("repeated", result["summary"])


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
            {
                "value",
                "direction",
                "elapsedMs",
                "scene",
                "entry",
                "summary",
                "nodes",
                "steps",
                "stages",
                "outside",
                "pending",
                "warnings",
                "stoppedAt",
                "confirmTargets",
            },
        )
        self.assertEqual(
            set(result["summary"]),
            {
                "tablesHit",
                "tablesVisited",
                "rowsRead",
                "steps",
                "depthReached",
                "needsConfirm",
                "outside",
            },
        )
        self.assertIn("no_edges", [warning["code"] for warning in result["warnings"]])

    def test_the_clamps_are_applied(self):
        self.assertEqual(tracing._clamp(99, 1, 6, 3), 6)
        self.assertEqual(tracing._clamp(0, 1, 6, 3), 1)
        self.assertEqual(tracing._clamp("x", 1, 6, 3), 3)
        self.assertEqual(tracing._clamp(None, 1, 200, 20), 20)


if __name__ == "__main__":
    sys.exit(unittest.main(verbosity=2))
