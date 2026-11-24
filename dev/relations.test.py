"""Regression tests for `server/relations.py`, the per-datasource relation graph.

The bug this guards against: an edge the user confirmed by hand used to be lost
the next time the catalog was re-read, and a rejected edge used to be impossible
to reopen — both make the graph something the user cannot trust as their own.

The module writes under `store.runtime_dir()`, so every test points
`DB_MCP_RUNTIME` at a temporary directory. Run it through `dev/engines.test.mjs`
(`npm run test:engines`), which picks the right interpreter.
"""

from __future__ import annotations

import importlib.util
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

PACKAGE = Path(__file__).resolve().parent.parent
# `relations.py` reaches `import store`, which is how `main.py` imports it too.
sys.path.insert(0, str(PACKAGE / "server"))
SPEC = importlib.util.spec_from_file_location("db_mcp_relations", PACKAGE / "server" / "relations.py")
relations = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(relations)


def source(identity: str = "shop") -> dict:
    return {"id": identity, "name": identity, "kind": "sqlite", "config": {}, "readOnly": True}


def fk(table, column, ref_table, ref_column, name=None) -> dict:
    return {"table": table, "column": column, "refTable": ref_table, "refColumn": ref_column, "name": name}


class RelationGraph(unittest.TestCase):
    def setUp(self):
        self.saved = os.environ.get("DB_MCP_RUNTIME")
        self.tmp = tempfile.TemporaryDirectory()
        os.environ["DB_MCP_RUNTIME"] = self.tmp.name

    def tearDown(self):
        if self.saved is None:
            os.environ.pop("DB_MCP_RUNTIME", None)
        else:
            os.environ["DB_MCP_RUNTIME"] = self.saved
        self.tmp.cleanup()

    def _file(self, identity: str = "shop") -> Path:
        return Path(self.tmp.name) / "relations" / f"{identity}.json"

    # -- storage -----------------------------------------------------------

    def test_a_missing_file_is_an_empty_graph_not_an_error(self):
        listed = relations.list_edges(source())
        self.assertEqual(listed["edges"], [])
        self.assertEqual(listed["counts"], {"pending": 0, "confirmed": 0, "trusted": 0, "stale": 0, "rejected": 0})
        self.assertFalse(self._file().exists(), "reading must not create the file")

    def test_the_graph_lands_in_the_runtime_directory(self):
        relations.propose(source(), "t_trans", "order_id", "t_order", "id")
        written = self._file()
        self.assertTrue(written.exists())
        payload = json.loads(written.read_text(encoding="utf-8"))
        self.assertEqual(payload["schemaVersion"], 1)
        self.assertEqual(payload["datasource"], "shop")
        self.assertEqual(payload["kind"], "sqlite")
        self.assertEqual(len(payload["edges"]), 1)

    def test_a_corrupt_file_is_reported_rather_than_reset(self):
        # Silently starting over would discard edges the user confirmed by hand.
        target = self._file()
        target.parent.mkdir(parents=True)
        target.write_text("{not json", encoding="utf-8")
        with self.assertRaises(Exception) as caught:
            relations.list_edges(source())
        self.assertEqual(getattr(caught.exception, "code", None), "infra_error")

    def test_two_datasources_do_not_share_a_graph(self):
        relations.propose(source("shop"), "a", "id", "b", "id")
        self.assertEqual(len(relations.list_edges(source("shop"))["edges"]), 1)
        self.assertEqual(len(relations.list_edges(source("crm"))["edges"]), 0)

    def test_an_inline_source_gets_its_own_file(self):
        inline = {"id": None, "name": "inline test", "kind": "sqlite", "config": {"file": "x.db"}}
        relations.propose(inline, "a", "id", "b", "id")
        files = list((Path(self.tmp.name) / "relations").glob("inline-*.json"))
        self.assertEqual(len(files), 1)

    # -- proposing ---------------------------------------------------------

    def test_a_proposed_edge_starts_pending(self):
        result = relations.propose(source(), "t_trans", "order_id", "t_order", "id")
        edge = result["edge"]
        self.assertTrue(result["created"])
        self.assertEqual(edge["status"], "pending")
        self.assertEqual(edge["source"], "manual")
        self.assertEqual(edge["from"], {"table": "t_trans", "column": "order_id"})
        self.assertEqual(edge["to"], {"table": "t_order", "column": "id"})
        self.assertEqual(edge["stats"]["confirmCount"], 0)
        self.assertEqual([entry["action"] for entry in edge["history"]], ["created"])

    def test_proposing_the_same_pair_twice_updates_one_edge(self):
        first = relations.propose(source(), "t_trans", "order_id", "t_order", "id")
        second = relations.propose(source(), "t_trans", "order_id", "t_order", "id", note="order lookup")
        self.assertFalse(second["created"])
        self.assertEqual(first["edge"]["id"], second["edge"]["id"])
        self.assertEqual(len(relations.list_edges(source())["edges"]), 1)
        self.assertEqual(second["edge"]["note"], "order lookup")

    def test_the_id_ignores_case_so_one_join_cannot_become_two(self):
        first = relations.propose(source(), "T_TRANS", "ORDER_ID", "T_ORDER", "ID")
        second = relations.propose(source(), "t_trans", "order_id", "t_order", "id")
        self.assertEqual(first["edge"]["id"], second["edge"]["id"])
        self.assertEqual(len(relations.list_edges(source())["edges"]), 1)

    def test_an_incomplete_endpoint_is_a_user_error(self):
        with self.assertRaises(Exception) as caught:
            relations.propose(source(), "t_trans", "", "t_order", "id")
        self.assertEqual(getattr(caught.exception, "code", None), "user_error")

    # -- discovery ---------------------------------------------------------

    def test_discovery_imports_what_the_catalog_declares(self):
        result = relations.import_edges(source(), [fk("t_trans", "order_id", "t_order", "id", "fk_order")])
        self.assertEqual(result["imported"], 1)
        self.assertEqual(result["updated"], 0)
        self.assertEqual(result["skipped"], 0)
        edge = result["edges"][0]
        self.assertEqual(edge["source"], "fk")
        self.assertEqual(edge["status"], "pending")
        self.assertEqual(edge["note"], "fk_order")

    def test_discovery_does_not_demote_a_confirmed_edge(self):
        relations.propose(source(), "t_trans", "order_id", "t_order", "id")
        doc = relations.load(source())
        doc["edges"][0]["status"] = "confirmed"
        relations.save(source(), doc)
        result = relations.import_edges(source(), [fk("t_trans", "order_id", "t_order", "id")])
        self.assertEqual(result["imported"], 0)
        self.assertEqual(result["edges"][0]["status"], "confirmed", "a confirmed edge must survive a re-scan")
        # The status is what the walker reads; the source is provenance, and the
        # catalog declaring the key is stronger evidence than a hand proposal.
        self.assertEqual(result["edges"][0]["source"], "fk")

    def test_discovery_never_weakens_the_source_of_an_edge(self):
        relations.propose(source(), "t_trans", "order_id", "t_order", "id")
        relations.import_edges(source(), [fk("t_trans", "order_id", "t_order", "id")])
        weaker = relations.import_edges(
            source(),
            [{"table": "t_trans", "column": "order_id", "refTable": "t_order", "refColumn": "id"}],
            source="audit_mined",
        )
        self.assertEqual(weaker["edges"][0]["source"], "fk", "a mined guess must not overwrite a declared key")

    def test_discovery_revives_a_stale_edge(self):
        relations.propose(source(), "t_trans", "order_id", "t_order", "id")
        doc = relations.load(source())
        doc["edges"][0]["status"] = "stale"
        relations.save(source(), doc)
        result = relations.import_edges(source(), [fk("t_trans", "order_id", "t_order", "id")])
        self.assertEqual(result["updated"], 1)
        self.assertEqual(result["edges"][0]["status"], "pending")

    def test_discovery_upgrades_a_guessed_edge_to_a_real_key(self):
        relations.propose(source(), "t_trans", "order_id", "t_order", "id")
        result = relations.import_edges(source(), [fk("t_trans", "order_id", "t_order", "id")])
        self.assertEqual(result["updated"], 1)
        self.assertEqual(result["edges"][0]["source"], "fk")
        self.assertEqual(result["edges"][0]["status"], "pending")

    def test_discovery_skips_a_row_it_cannot_use(self):
        result = relations.import_edges(source(), [{"table": "a", "column": None, "refTable": "b", "refColumn": "id"}])
        self.assertEqual(result["skipped"], 1)
        self.assertEqual(result["imported"], 0)

    # -- filtering and counting --------------------------------------------

    def test_counts_cover_every_status_whatever_the_filter(self):
        relations.propose(source(), "a", "id", "b", "id")
        relations.propose(source(), "c", "id", "d", "id")
        doc = relations.load(source())
        doc["edges"][0]["status"] = "confirmed"
        doc["edges"][1]["status"] = "rejected"
        relations.save(source(), doc)
        listed = relations.list_edges(source(), status="confirmed")
        self.assertEqual(len(listed["edges"]), 1)
        self.assertEqual(listed["counts"]["confirmed"], 1)
        self.assertEqual(listed["counts"]["rejected"], 1, "the counts stay complete while a filter is on")

    def test_an_unknown_filter_is_a_user_error(self):
        for keyword, value in (("status", "maybe"), ("source", "guess")):
            with self.subTest(keyword=keyword):
                with self.assertRaises(Exception) as caught:
                    relations.list_edges(source(), **{keyword: value})
                self.assertEqual(getattr(caught.exception, "code", None), "user_error")

    def test_a_source_filter_selects_one_kind_of_edge(self):
        relations.import_edges(source(), [fk("a", "id", "b", "id")])
        relations.propose(source(), "c", "id", "d", "id")
        self.assertEqual(len(relations.list_edges(source(), source="manual")["edges"]), 1)
        self.assertEqual(len(relations.list_edges(source(), source="fk")["edges"]), 1)

    def test_the_listing_is_stable_and_can_be_capped(self):
        for table in ("c", "a", "b"):
            relations.propose(source(), table, "id", "z", "id")
        listed = relations.list_edges(source())
        self.assertEqual([edge["from"]["table"] for edge in listed["edges"]], ["a", "b", "c"])
        capped = relations.list_edges(source(), limit=2)
        self.assertEqual(len(capped["edges"]), 2)
        self.assertTrue(capped["truncated"])
        self.assertEqual(capped["total"], 3)

    # -- editing -----------------------------------------------------------

    def test_a_condition_can_be_set_and_cleared(self):
        edge = relations.propose(source(), "t_trans", "order_id", "t_order", "id")["edge"]
        set_result = relations.set_condition(source(), edge["id"], "status = 'POSTED'")
        self.assertTrue(set_result["changed"])
        self.assertEqual(set_result["edge"]["condition"], "status = 'POSTED'")
        cleared = relations.set_condition(source(), edge["id"], "   ")
        self.assertTrue(cleared["changed"])
        self.assertIsNone(cleared["edge"]["condition"])

    def test_setting_the_same_condition_twice_changes_nothing(self):
        edge = relations.propose(source(), "a", "id", "b", "id", condition="x = 1")["edge"]
        result = relations.set_condition(source(), edge["id"], "x = 1")
        self.assertFalse(result["changed"])
        self.assertEqual([entry["action"] for entry in result["edge"]["history"]], ["created"])

    def test_deleting_an_edge_removes_it(self):
        edge = relations.propose(source(), "a", "id", "b", "id")["edge"]
        removed = relations.delete_edge(source(), edge["id"])
        self.assertEqual(removed["deleted"]["id"], edge["id"])
        self.assertEqual(relations.list_edges(source())["edges"], [])

    def test_an_unknown_edge_id_is_a_user_error(self):
        for call in (
            lambda: relations.set_condition(source(), "e_nope", "x"),
            lambda: relations.delete_edge(source(), "e_nope"),
        ):
            with self.assertRaises(Exception) as caught:
                call()
            self.assertEqual(getattr(caught.exception, "code", None), "user_error")

    def test_history_is_bounded(self):
        edge = relations.propose(source(), "a", "id", "b", "id")["edge"]
        for index in range(60):
            relations.set_condition(source(), edge["id"], f"x = {index}")
        stored = relations.list_edges(source())["edges"][0]
        self.assertEqual(len(stored["history"]), relations.HISTORY_LIMIT)
        self.assertEqual(stored["history"][-1]["action"], "condition set")

    # -- feedback and the status machine -----------------------------------

    def _edge(self, **kwargs) -> dict:
        return relations.propose(source(), "t_trans", "order_id", "t_order", "id", **kwargs)["edge"]

    def _stored(self, edge_id: str) -> dict:
        return next(edge for edge in relations.list_edges(source())["edges"] if edge["id"] == edge_id)

    def test_an_ok_confirms_a_pending_edge(self):
        edge = self._edge()
        result = relations.feedback(source(), edge["id"], "ok", fanout=1.0)
        self.assertEqual(result["previousStatus"], "pending")
        self.assertEqual(result["edge"]["status"], "confirmed")
        self.assertEqual(result["edge"]["stats"]["confirmCount"], 1)
        self.assertIsNotNone(result["edge"]["stats"]["lastVerifiedAt"])

    def test_three_confirmations_on_an_indexed_column_earn_trust(self):
        edge = self._edge()
        relations.feedback(source(), edge["id"], "ok", indexed=True, fanout=1.0)
        relations.feedback(source(), edge["id"], "ok", indexed=True, fanout=1.0)
        result = relations.feedback(source(), edge["id"], "ok", indexed=True, fanout=1.0)
        self.assertEqual(result["edge"]["status"], "trusted")
        self.assertEqual(result["edge"]["stats"]["confirmCount"], 3)

    def test_two_confirmations_are_not_enough_for_trust(self):
        edge = self._edge()
        relations.feedback(source(), edge["id"], "ok", indexed=True, fanout=1.0)
        result = relations.feedback(source(), edge["id"], "ok", indexed=True, fanout=1.0)
        self.assertEqual(result["edge"]["status"], "confirmed")

    def test_an_unindexed_column_never_becomes_trusted(self):
        edge = self._edge()
        for _ in range(5):
            result = relations.feedback(source(), edge["id"], "ok", indexed=False, unique=False, fanout=1.0)
        self.assertEqual(result["edge"]["status"], "confirmed")
        self.assertEqual(result["edge"]["stats"]["confirmCount"], 5)

    def test_a_unique_column_earns_trust_without_an_index(self):
        edge = self._edge()
        relations.feedback(source(), edge["id"], "ok", indexed=False, unique=True, fanout=1.0)
        relations.feedback(source(), edge["id"], "ok", indexed=False, unique=True, fanout=1.0)
        result = relations.feedback(source(), edge["id"], "ok", indexed=False, unique=True, fanout=1.0)
        self.assertEqual(result["edge"]["status"], "trusted")

    def test_a_wide_fanout_blocks_trust(self):
        edge = self._edge()
        relations.feedback(source(), edge["id"], "ok", indexed=True, fanout=1.0)
        relations.feedback(source(), edge["id"], "ok", indexed=True, fanout=1.0)
        result = relations.feedback(source(), edge["id"], "ok", indexed=True, fanout=9.0)
        self.assertEqual(result["edge"]["status"], "confirmed")
        self.assertEqual(result["edge"]["stats"]["avgFanout"], 9.0)

    def test_trust_falls_back_when_the_fanout_grows(self):
        edge = self._edge()
        for _ in range(3):
            relations.feedback(source(), edge["id"], "ok", indexed=True, fanout=1.0)
        self.assertEqual(self._stored(edge["id"])["status"], "trusted")
        result = relations.feedback(source(), edge["id"], "ok", indexed=True, fanout=12.0)
        self.assertEqual(result["edge"]["status"], "confirmed", "trust is recomputed, not latched")

    def test_a_standing_rejection_blocks_trust(self):
        edge = self._edge()
        relations.feedback(source(), edge["id"], "too_many", reason="not_unique")
        for _ in range(3):
            result = relations.feedback(source(), edge["id"], "ok", indexed=True, fanout=1.0)
        self.assertEqual(result["edge"]["status"], "confirmed")
        self.assertEqual(result["edge"]["stats"]["rejectCount"], 1)

    def test_too_many_needs_a_known_reason(self):
        edge = self._edge()
        for reason in (None, "because"):
            with self.subTest(reason=reason):
                with self.assertRaises(Exception) as caught:
                    relations.feedback(source(), edge["id"], "too_many", reason=reason)
                self.assertEqual(getattr(caught.exception, "code", None), "user_error")

    def test_too_many_makes_the_edge_stale(self):
        edge = self._edge()
        result = relations.feedback(source(), edge["id"], "too_many", reason="needs_condition")
        self.assertEqual(result["edge"]["status"], "stale")
        self.assertEqual(result["edge"]["stats"]["lastFailure"]["reason"], "needs_condition")
        self.assertEqual(result["edge"]["stats"]["rejectCount"], 1)

    def test_missing_makes_the_edge_stale_too(self):
        edge = self._edge()
        result = relations.feedback(source(), edge["id"], "missing")
        self.assertEqual(result["edge"]["status"], "stale")
        self.assertEqual(result["edge"]["stats"]["lastFailure"]["verdict"], "missing")

    def test_irrelevant_puts_the_edge_on_the_blacklist(self):
        edge = self._edge()
        result = relations.feedback(source(), edge["id"], "irrelevant")
        self.assertEqual(result["edge"]["status"], "rejected")
        self.assertEqual(relations.list_edges(source(), status="rejected")["counts"]["rejected"], 1)

    def test_an_unknown_verdict_is_a_user_error(self):
        edge = self._edge()
        with self.assertRaises(Exception) as caught:
            relations.feedback(source(), edge["id"], "great")
        self.assertEqual(getattr(caught.exception, "code", None), "user_error")

    def test_proposing_a_stale_edge_again_reopens_it(self):
        edge = self._edge()
        relations.feedback(source(), edge["id"], "missing")
        reopened = relations.propose(source(), "t_trans", "order_id", "t_order", "id")
        self.assertTrue(reopened["reopened"])
        self.assertEqual(reopened["edge"]["status"], "pending")
        self.assertEqual(reopened["edge"]["stats"]["rejectCount"], 0)

    def test_feedback_leaves_a_trail(self):
        edge = self._edge()
        relations.feedback(source(), edge["id"], "ok", indexed=True, fanout=1.0)
        actions = [entry["action"] for entry in self._stored(edge["id"])["history"]]
        self.assertEqual(actions[0], "created")
        self.assertEqual(actions[-1], "confirmed")


if __name__ == "__main__":
    unittest.main(verbosity=2)
