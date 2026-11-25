"""Regression tests for `server/main.py`, the tool layer around `engines`.

The case that prompted this file: every exception that was not one of the
plugin's own error types came back as `infra_error`, which the reference
documents as "the interpreter is missing or the venv is broken". A driver
raising a syntax error therefore told the model to go and repair an
installation that was perfectly fine. A plain driver exception is a `db_error`.

`main.py` imports `mcp.server.fastmcp`, so these cases need the plugin venv.
The suite skips itself when that import is unavailable rather than turning a
docs-only checkout into a broken test run.
"""

from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

PACKAGE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PACKAGE / "server"))

try:
    SPEC = importlib.util.spec_from_file_location("db_mcp_main", PACKAGE / "server" / "main.py")
    main = importlib.util.module_from_spec(SPEC)
    SPEC.loader.exec_module(main)
    HAVE_MAIN = True
except Exception:  # pragma: no cover - environment problem
    HAVE_MAIN = False


@unittest.skipUnless(HAVE_MAIN, "the MCP SDK is not installed for this interpreter")
class ErrorShape(unittest.TestCase):
    """`_error` is the one place a tool failure turns into the reply the model reads."""

    def test_a_plugin_error_keeps_its_code_and_hint(self):
        error = main.engines.DbError("timeout", "the statement ran too long", hint="select fewer rows")
        payload = main._error(error)
        self.assertFalse(payload["ok"])
        self.assertEqual(payload["error"]["code"], "timeout")
        self.assertEqual(payload["error"]["message"], "the statement ran too long")
        self.assertEqual(payload["error"]["hint"], "select fewer rows")

    def test_a_plugin_error_without_a_hint_omits_the_field(self):
        payload = main._error(main.engines.DbError("user_error", "no such table"))
        self.assertEqual(set(payload["error"]), {"code", "message"})

    def test_a_blocked_write_reads_as_a_user_error(self):
        # A refusal is the caller's mistake, not the engine's: the same code
        # `engines.ensure_readable` raises for the global and read-only switches.
        blocked = main.writes.WriteBlocked("DDL is off here", hint="turn it on for this source")
        payload = main._error(blocked)
        self.assertEqual(payload["error"]["code"], "user_error")
        self.assertEqual(payload["error"]["hint"], "turn it on for this source")

    def test_a_driver_exception_is_a_db_error_not_an_infra_error(self):
        payload = main._error(RuntimeError("syntax error at or near \"pragma\""))
        self.assertEqual(payload["error"]["code"], "db_error")
        self.assertIn("RuntimeError", payload["error"]["message"])
        self.assertIn("pragma", payload["error"]["message"])

    def test_infra_error_is_not_the_fallback(self):
        # Guards the regression directly: the fallback used to be infra_error.
        for error in (RuntimeError("boom"), ValueError("bad"), KeyError("k")):
            self.assertEqual(main._error(error)["error"]["code"], "db_error")


@unittest.skipUnless(HAVE_MAIN, "the MCP SDK is not installed for this interpreter")
class RowClamp(unittest.TestCase):
    """`_clamp_rows` bounds what a caller may ask for."""

    def test_a_missing_value_takes_the_default(self):
        self.assertEqual(main._clamp_rows(None), main.DEFAULT_MAX_ROWS)
        self.assertEqual(main._clamp_rows(0), main.DEFAULT_MAX_ROWS)

    def test_a_large_value_is_capped(self):
        self.assertEqual(main._clamp_rows(10**9), main.HARD_MAX_ROWS)

    def test_a_normal_value_passes_through(self):
        self.assertEqual(main._clamp_rows(5), 5)


@unittest.skipUnless(HAVE_MAIN, "the MCP SDK is not installed for this interpreter")
class ToolSurface(unittest.TestCase):
    """The tool list is a contract: one answer per question, no leftovers.

    `list_relations` used to answer "what joins what" from the catalog, and
    `describe_table` used to repeat it per table. Both are gone: the relation
    graph is the single answer, so a model cannot pick the copy the walker does
    not use.
    """

    def test_the_removed_tools_are_gone(self):
        self.assertFalse(hasattr(main, "list_relations"))

    def test_the_trace_tool_is_registered(self):
        self.assertTrue(callable(getattr(main, "trace_by_key", None)))
        text = main.trace_by_key.__doc__ or ""
        self.assertIn("value", text)

    def test_the_graph_tools_are_registered(self):
        for name in (
            "list_edges",
            "propose_relation",
            "discover_relations",
            "mine_relations",
            "scan_code_relations",
            "feedback_relation",
            "set_relation_condition",
            "delete_edge",
        ):
            self.assertTrue(callable(getattr(main, name, None)), name)

    def test_the_scanner_tool_explains_what_it_skips(self):
        text = main.scan_code_relations.__doc__ or ""
        self.assertIn("mapper XML", text)
        self.assertIn("@Select", text)
        self.assertIn("pending", text)
        self.assertIn("ambiguous", text)
        self.assertIn("never run", text, "the docstring must say nothing is executed")

    def test_the_mining_tool_explains_where_it_reads(self):
        text = main.mine_relations.__doc__ or ""
        self.assertIn("audit log", text)
        self.assertIn("audit_mined", text)
        self.assertIn("ambiguous", text)

    def test_the_feedback_tool_explains_every_verdict(self):
        text = main.feedback_relation.__doc__ or ""
        for verdict in ("ok", "too_many", "missing", "irrelevant"):
            self.assertIn(verdict, text)
        for reason in ("wrong_column", "needs_condition", "not_unique"):
            self.assertIn(reason, text)

    def test_describe_table_no_longer_promises_foreign_keys(self):
        text = main.describe_table.__doc__ or ""
        self.assertNotIn("foreignKeys", text)
        self.assertIn("list_edges", text)


@unittest.skipUnless(HAVE_MAIN, "the MCP SDK is not installed for this interpreter")
class GraphTools(unittest.TestCase):
    """The graph tools run without a database: the graph is a file, not a query."""

    def setUp(self):
        import json
        import os
        import tempfile

        self.tmp = tempfile.TemporaryDirectory()
        self.saved = os.environ.get("DB_MCP_RUNTIME")
        os.environ["DB_MCP_RUNTIME"] = self.tmp.name
        registry = {
            "schemaVersion": 1,
            "datasources": [
                {
                    "id": "shop",
                    "name": "shop",
                    "kind": "sqlite",
                    "config": {"file": str(Path(self.tmp.name) / "shop.db")},
                    "readOnly": True,
                    "isDefault": True,
                }
            ],
        }
        (Path(self.tmp.name) / "datasources.json").write_text(json.dumps(registry), encoding="utf-8")

    def tearDown(self):
        import os

        if self.saved is None:
            os.environ.pop("DB_MCP_RUNTIME", None)
        else:
            os.environ["DB_MCP_RUNTIME"] = self.saved
        self.tmp.cleanup()

    def test_an_empty_graph_lists_nothing_with_full_counts(self):
        payload = main.list_edges()
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["edges"], [])
        self.assertEqual(set(payload["counts"]), {"pending", "confirmed", "trusted", "stale", "rejected"})
        self.assertEqual(payload["datasource"]["id"], "shop")

    def test_proposing_an_edge_makes_it_listable(self):
        proposed = main.propose_relation("t_trans", "order_id", "t_order", "id", note="legacy join")
        self.assertTrue(proposed["ok"])
        self.assertTrue(proposed["created"])
        self.assertEqual(proposed["edge"]["status"], "pending")
        listed = main.list_edges()
        self.assertEqual(len(listed["edges"]), 1)
        self.assertEqual(listed["counts"]["pending"], 1)
        self.assertEqual(listed["edges"][0]["note"], "legacy join")

    def test_a_bad_status_filter_comes_back_as_a_user_error(self):
        payload = main.list_edges(status="maybe")
        self.assertFalse(payload["ok"])
        self.assertEqual(payload["error"]["code"], "user_error")

    def test_feedback_moves_an_edge_without_a_database(self):
        edge = main.propose_relation("t_trans", "order_id", "t_order", "id")["edge"]
        payload = main.feedback_relation(edge["id"], "irrelevant")
        self.assertTrue(payload["ok"], payload)
        self.assertEqual(payload["previousStatus"], "pending")
        self.assertEqual(payload["edge"]["status"], "rejected")
        self.assertEqual(main.list_edges()["counts"]["rejected"], 1)

    def test_a_bad_verdict_comes_back_as_a_user_error(self):
        edge = main.propose_relation("t_trans", "order_id", "t_order", "id")["edge"]
        payload = main.feedback_relation(edge["id"], "great")
        self.assertFalse(payload["ok"])
        self.assertEqual(payload["error"]["code"], "user_error")

    def test_a_condition_can_be_attached_and_cleared(self):
        edge = main.propose_relation("t_trans", "order_id", "t_order", "id")["edge"]
        set_result = main.set_relation_condition(edge["id"], "status = 'POSTED'")
        self.assertTrue(set_result["changed"])
        self.assertEqual(set_result["edge"]["condition"], "status = 'POSTED'")
        cleared = main.set_relation_condition(edge["id"])
        self.assertTrue(cleared["changed"])
        self.assertIsNone(cleared["edge"]["condition"])

    def test_deleting_an_edge_empties_the_graph(self):
        edge = main.propose_relation("a", "id", "b", "id")["edge"]
        payload = main.delete_edge(edge["id"])
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["deleted"]["id"], edge["id"])
        self.assertEqual(main.list_edges()["edges"], [])


@unittest.skipUnless(HAVE_MAIN, "the MCP SDK is not installed for this interpreter")
class MiningTheAuditLog(unittest.TestCase):
    """`mine_relations` turns past statements into pending edges.

    The statement says the columns are equal; only the catalog says which side is
    the parent. A pair where that cannot be decided must be reported, not guessed
    into the graph — the walker follows every confirmed edge, so a wrong one is
    worse than a missing one.
    """

    def setUp(self):
        import json
        import os
        import sqlite3
        import tempfile

        self.tmp = tempfile.TemporaryDirectory()
        self.saved = os.environ.get("DB_MCP_RUNTIME")
        os.environ["DB_MCP_RUNTIME"] = self.tmp.name
        path = Path(self.tmp.name) / "shop.db"
        seed = sqlite3.connect(str(path))
        try:
            seed.executescript(
                "create table t_order (id integer primary key, code text);"
                "create table t_trans (id integer primary key, order_id integer references t_order(id));"
                "create table t_note (id integer primary key, trans_id integer);"
                "create table t_account (id integer primary key, account_no text not null);"
                "create unique index t_account_no on t_account(account_no);"
                "create table t_ledger (account_no text not null, seq integer not null, primary key(account_no, seq));"
            )
            seed.commit()
        finally:
            seed.close()
        registry = {
            "schemaVersion": 1,
            "datasources": [
                {
                    "id": "shop",
                    "name": "shop",
                    "kind": "sqlite",
                    "config": {"file": str(path)},
                    "readOnly": True,
                    "isDefault": True,
                }
            ],
        }
        (Path(self.tmp.name) / "datasources.json").write_text(json.dumps(registry), encoding="utf-8")
        self.log = Path(self.tmp.name) / "logs" / "audit.jsonl"
        self.log.parent.mkdir(parents=True, exist_ok=True)

    def tearDown(self):
        import os

        if self.saved is None:
            os.environ.pop("DB_MCP_RUNTIME", None)
        else:
            os.environ["DB_MCP_RUNTIME"] = self.saved
        self.tmp.cleanup()

    def _write_log(self, *statements: str, datasource: str | None = "shop") -> None:
        import json

        with self.log.open("w", encoding="utf-8") as handle:
            for sql in statements:
                record = {"tool": "mcp__db__execute_sql", "datasource": datasource, "sql": sql}
                handle.write(json.dumps(record) + "\n")

    def test_a_join_from_the_log_becomes_a_pending_edge(self):
        self._write_log("select * from t_trans t join t_order o on o.id = t.order_id")
        payload = main.mine_relations()
        self.assertTrue(payload["ok"], payload)
        self.assertEqual(payload["mined"], 1)
        self.assertEqual(payload["imported"], 1)
        self.assertEqual(payload["edges"][0]["source"], "audit_mined")
        self.assertEqual(payload["edges"][0]["status"], "pending", "a mined edge is a guess until a trace confirms it")
        self.assertEqual(payload["edges"][0]["from"], {"table": "t_trans", "column": "order_id"})
        self.assertEqual(payload["edges"][0]["to"], {"table": "t_order", "column": "id"})

    def test_an_empty_log_mines_nothing(self):
        payload = main.mine_relations()
        self.assertTrue(payload["ok"], payload)
        self.assertEqual(payload["mined"], 0)
        self.assertEqual(payload["edges"], [])

    def test_a_pair_with_no_unique_side_is_reported_not_imported(self):
        # Neither `t_trans.order_id` nor `t_note.trans_id` is unique, so nothing
        # says which one owns the other.
        self._write_log("select * from t_note n join t_trans t on t.order_id = n.trans_id")
        payload = main.mine_relations()
        self.assertTrue(payload["ok"], payload)
        self.assertEqual(payload["imported"], 0)
        self.assertEqual(len(payload["ambiguous"]), 1)
        self.assertEqual(payload["ambiguous"][0]["reason"], "neither unique")

    def test_mining_twice_does_not_duplicate_an_edge(self):
        self._write_log("select * from t_trans t join t_order o on o.id = t.order_id")
        main.mine_relations()
        again = main.mine_relations()
        self.assertEqual(again["imported"], 0)
        self.assertEqual(again["skipped"], 1)
        self.assertEqual(len(main.list_edges()["edges"]), 1)

    def test_a_composite_key_column_is_not_unique_on_its_own(self):
        # `t_ledger` is keyed by (account_no, seq), so account_no repeats once per
        # seq and cannot be the parent side. Reading every key column as unique
        # made this pair look like "both unique" and dropped a join that is
        # plainly a ledger pointing at an account.
        self._write_log("select * from t_ledger l join t_account a on a.account_no = l.account_no")
        payload = main.mine_relations()
        self.assertTrue(payload["ok"], payload)
        self.assertEqual(payload["ambiguous"], [], "one side is unique, so this is decidable")
        self.assertEqual(payload["imported"], 1)
        self.assertEqual(payload["edges"][0]["from"], {"table": "t_ledger", "column": "account_no"})
        self.assertEqual(payload["edges"][0]["to"], {"table": "t_account", "column": "account_no"})

    def test_a_hand_proposal_is_not_downgraded_by_a_mined_join(self):
        edge = main.propose_relation("t_trans", "order_id", "t_order", "id")["edge"]
        self.assertEqual(edge["source"], "manual")
        self._write_log("select * from t_trans t join t_order o on o.id = t.order_id")
        payload = main.mine_relations()
        self.assertEqual(payload["edges"][0]["source"], "manual", "the catalog is not the only thing a person knows")


@unittest.skipUnless(HAVE_MAIN, "the MCP SDK is not installed for this interpreter")
class ScanningTheSourceTree(unittest.TestCase):
    """`scan_code_relations` turns committed SQL into pending edges.

    Same contract as `mine_relations` — the catalog decides the direction and an
    undecidable pair is reported rather than guessed — but the statements come
    from mapper XML and MyBatis annotations instead of the audit log.
    """

    def setUp(self):
        import json
        import os
        import sqlite3
        import tempfile

        self.tmp = tempfile.TemporaryDirectory()
        self.saved = os.environ.get("DB_MCP_RUNTIME")
        os.environ["DB_MCP_RUNTIME"] = self.tmp.name
        path = Path(self.tmp.name) / "shop.db"
        seed = sqlite3.connect(str(path))
        try:
            seed.executescript(
                "create table t_order (id integer primary key, code text);"
                "create table t_trans (id integer primary key, order_id integer);"
                "create table t_user (id integer primary key, name text);"
            )
            seed.commit()
        finally:
            seed.close()
        registry = {
            "schemaVersion": 1,
            "datasources": [
                {
                    "id": "shop",
                    "name": "shop",
                    "kind": "sqlite",
                    "config": {"file": str(path)},
                    "readOnly": True,
                    "isDefault": True,
                }
            ],
        }
        (Path(self.tmp.name) / "datasources.json").write_text(json.dumps(registry), encoding="utf-8")
        self.project = Path(self.tmp.name) / "project"

    def tearDown(self):
        import os

        if self.saved is None:
            os.environ.pop("DB_MCP_RUNTIME", None)
        else:
            os.environ["DB_MCP_RUNTIME"] = self.saved
        self.tmp.cleanup()

    def _write(self, relative: str, body: str) -> None:
        path = self.project / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(body, encoding="utf-8")

    def _scan(self, **kwargs):
        return main.scan_code_relations(str(self.project), **kwargs)

    def test_a_mapper_join_becomes_a_pending_edge(self):
        self._write(
            "src/main/resources/mapper/TransMapper.xml",
            """<mapper namespace="demo.TransMapper">
  <select id="find">
    select * from t_trans t join t_order o on o.id = t.order_id
  </select>
</mapper>""",
        )
        payload = self._scan()
        self.assertTrue(payload["ok"], payload)
        self.assertEqual(payload["scanned"], 1)
        self.assertEqual(payload["mined"], 1)
        self.assertEqual(payload["imported"], 1)
        self.assertEqual(payload["edges"][0]["source"], "audit_mined")
        self.assertEqual(payload["edges"][0]["status"], "pending")
        self.assertEqual(payload["edges"][0]["from"], {"table": "t_trans", "column": "order_id"})
        self.assertEqual(payload["edges"][0]["to"], {"table": "t_order", "column": "id"})

    def test_an_annotation_join_is_read(self):
        self._write(
            "src/main/java/demo/UserMapper.java",
            'package demo;\ninterface UserMapper {\n'
            '  @Select("select * from t_trans t join t_user u on u.id = t.order_id")\n'
            "  Object rows();\n}\n",
        )
        payload = self._scan()
        self.assertEqual(payload["mined"], 1, payload)
        self.assertEqual(payload["edges"][0]["from"], {"table": "t_trans", "column": "order_id"})
        self.assertEqual(payload["edges"][0]["to"], {"table": "t_user", "column": "id"})

    def test_a_project_without_joins_reports_zero_and_imports_nothing(self):
        self._write(
            "src/main/java/demo/Repo.java",
            'package demo;\nclass Repo { void go() { wrapper.apply("username = {0}"); } }',
        )
        payload = self._scan()
        self.assertTrue(payload["ok"], payload)
        self.assertEqual(payload["scanned"], 1)
        self.assertEqual(payload["mined"], 0)
        self.assertEqual(payload["edges"], [])

    def test_the_edge_notes_the_file_it_came_from(self):
        self._write(
            "src/main/resources/mapper/TransMapper.xml",
            '<mapper namespace="x"><select id="a">select * from t_trans t join t_order o on o.id = t.order_id</select></mapper>',
        )
        payload = self._scan()
        self.assertEqual(payload["edges"][0]["note"], "read from src/main/resources/mapper/TransMapper.xml:1")

    def test_an_undecidable_pair_is_reported(self):
        # Both sides are primary keys, so nothing says which one owns the other.
        self._write(
            "src/main/resources/mapper/TransMapper.xml",
            '<mapper namespace="x"><select id="a">select * from t_trans t join t_order o on o.id = t.id</select></mapper>',
        )
        payload = self._scan()
        self.assertEqual(payload["imported"], 0)
        self.assertEqual(len(payload["ambiguous"]), 1)
        self.assertEqual(payload["ambiguous"][0]["reason"], "both unique")

    def test_scanning_twice_does_not_duplicate_an_edge(self):
        self._write(
            "src/main/resources/mapper/TransMapper.xml",
            '<mapper namespace="x"><select id="a">select * from t_trans t join t_order o on o.id = t.order_id</select></mapper>',
        )
        self._scan()
        again = self._scan()
        self.assertEqual(again["imported"], 0)
        self.assertEqual(again["skipped"], 1)
        self.assertEqual(len(main.list_edges()["edges"]), 1)

    def test_a_missing_root_comes_back_as_an_error(self):
        payload = main.scan_code_relations(str(self.project / "nope"))
        # A directory that is not there yields nothing to import; it is not a crash.
        self.assertTrue(payload["ok"], payload)
        self.assertEqual(payload["scanned"], 0)
        self.assertEqual(payload["edges"], [])


@unittest.skipUnless(HAVE_MAIN, "the MCP SDK is not installed for this interpreter")
class FeedbackReadsTheCatalog(unittest.TestCase):
    """`feedback_relation` reads the catalog for the trust hints.

    A wrong call signature here would be swallowed by the tool's own `except`
    and quietly turn every confirmation into `indexed: null` — which looks like
    "not indexed" and can never earn trust. That is why this suite exists.
    """

    def setUp(self):
        import json
        import os
        import sqlite3
        import tempfile

        self.tmp = tempfile.TemporaryDirectory()
        self.saved = os.environ.get("DB_MCP_RUNTIME")
        os.environ["DB_MCP_RUNTIME"] = self.tmp.name
        path = Path(self.tmp.name) / "shop.db"
        seed = sqlite3.connect(str(path))
        try:
            seed.executescript(
                "create table t_order (id integer primary key, code text);"
                "create table t_trans (id integer primary key, order_id integer references t_order(id));"
                "create unique index t_trans_id on t_trans(id);"
            )
            seed.commit()
        finally:
            seed.close()
        registry = {
            "schemaVersion": 1,
            "datasources": [
                {
                    "id": "shop",
                    "name": "shop",
                    "kind": "sqlite",
                    "config": {"file": str(path)},
                    "readOnly": True,
                    "isDefault": True,
                }
            ],
        }
        (Path(self.tmp.name) / "datasources.json").write_text(json.dumps(registry), encoding="utf-8")

    def tearDown(self):
        import os

        if self.saved is None:
            os.environ.pop("DB_MCP_RUNTIME", None)
        else:
            os.environ["DB_MCP_RUNTIME"] = self.saved
        self.tmp.cleanup()

    def test_the_primary_key_counts_as_an_index(self):
        edge = main.propose_relation("t_trans", "order_id", "t_order", "id")["edge"]
        payload = main.feedback_relation(edge["id"], "ok", fanout=1)
        self.assertTrue(payload["ok"], payload)
        self.assertIs(payload["indexed"], True)
        self.assertEqual(payload["edge"]["stats"]["confirmCount"], 1)

    def test_a_unique_column_is_reported_as_unique(self):
        edge = main.propose_relation("t_trans", "order_id", "t_trans", "id")["edge"]
        payload = main.feedback_relation(edge["id"], "ok", fanout=1)
        self.assertTrue(payload["ok"], payload)
        self.assertIs(payload["unique"], True)

    def test_three_confirmations_earn_trust(self):
        edge = main.propose_relation("t_trans", "order_id", "t_order", "id")["edge"]
        for _ in range(3):
            payload = main.feedback_relation(edge["id"], "ok", fanout=2, ms=20)
            self.assertTrue(payload["ok"], payload)
        self.assertEqual(payload["edge"]["status"], "trusted")
        self.assertEqual(payload["edge"]["stats"]["lastMs"], 20)
        self.assertEqual(payload["edge"]["stats"]["avgMs"], 20.0)

    def test_a_confirmation_without_a_measurement_stays_confirmed(self):
        edge = main.propose_relation("t_trans", "order_id", "t_order", "id")["edge"]
        for _ in range(4):
            payload = main.feedback_relation(edge["id"], "ok", fanout=2)
            self.assertTrue(payload["ok"], payload)
        self.assertEqual(payload["edge"]["status"], "confirmed")

    def test_the_proposal_carries_the_cost_of_the_target_column(self):
        payload = main.propose_relation("t_trans", "order_id", "t_order", "id")
        self.assertTrue(payload["ok"], payload)
        self.assertIs(payload["cost"]["indexed"], True, "t_order.id is the primary key")
        self.assertIs(payload["cost"]["needsConfirm"], False)
        self.assertEqual(payload["edge"]["stats"]["indexed"], True)

    def test_the_feedback_records_the_measurement(self):
        edge = main.propose_relation("t_trans", "order_id", "t_order", "id")["edge"]
        payload = main.feedback_relation(edge["id"], "ok", fanout=1, ms=42)
        self.assertTrue(payload["ok"], payload)
        self.assertEqual(payload["cost"]["avgMs"], 42.0)
        self.assertEqual(payload["cost"]["lastMs"], 42)

    def test_an_unreachable_database_leaves_the_hints_unknown(self):
        # The verdict still stands: a broken connection must not swallow it.
        import json

        registry = {
            "schemaVersion": 1,
            "datasources": [
                {
                    "id": "shop",
                    "name": "shop",
                    "kind": "sqlite",
                    "config": {"file": str(Path(self.tmp.name) / "missing.db")},
                    "readOnly": True,
                    "isDefault": True,
                }
            ],
        }
        (Path(self.tmp.name) / "datasources.json").write_text(json.dumps(registry), encoding="utf-8")
        edge = main.propose_relation("t_trans", "order_id", "t_order", "id")["edge"]
        payload = main.feedback_relation(edge["id"], "ok")
        self.assertTrue(payload["ok"], payload)
        self.assertIsNone(payload["indexed"])
        self.assertEqual(payload["edge"]["status"], "confirmed")


if __name__ == "__main__":
    sys.exit(unittest.main(verbosity=2))
