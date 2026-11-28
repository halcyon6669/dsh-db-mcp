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

    # -- where the edge was read ------------------------------------------

    def test_a_scanned_edge_keeps_the_places_it_was_read_from(self):
        row = fk("t_trans", "order_id", "t_order", "id")
        row["places"] = ["src/main/resources/mapper/OrderMapper.xml:12", "src/main/java/A.java:40"]
        edge = relations.import_edges(source(), [row], source="audit_mined")["edges"][0]
        self.assertEqual(edge["places"], row["places"])

    def test_a_second_scan_merges_new_places_instead_of_replacing_them(self):
        first = fk("t_trans", "order_id", "t_order", "id")
        first["places"] = ["mapper/A.xml:3"]
        relations.import_edges(source(), [first], source="audit_mined")
        second = fk("t_trans", "order_id", "t_order", "id")
        second["places"] = ["mapper/B.xml:9", "mapper/A.xml:3"]
        edge = relations.import_edges(source(), [second], source="audit_mined")["edges"][0]
        self.assertEqual(edge["places"], ["mapper/A.xml:3", "mapper/B.xml:9"], "a place already known is not repeated")

    def test_places_are_bounded_so_one_edge_cannot_grow_forever(self):
        row = fk("t_trans", "order_id", "t_order", "id")
        row["places"] = [f"mapper/A.xml:{index}" for index in range(40)]
        edge = relations.import_edges(source(), [row], source="audit_mined")["edges"][0]
        self.assertLessEqual(len(edge["places"]), relations.PLACES_LIMIT)

    def test_an_edge_without_places_carries_an_empty_list(self):
        edge = relations.import_edges(source(), [fk("t_trans", "order_id", "t_order", "id")])["edges"][0]
        self.assertEqual(edge["places"], [])

    def test_a_hand_proposal_says_nothing_about_where_it_was_read(self):
        edge = relations.propose(source(), "t_trans", "order_id", "t_order", "id")["edge"]
        self.assertEqual(edge["places"], [])

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

    def test_three_fast_confirmations_earn_trust(self):
        edge = self._edge()
        for _ in range(2):
            relations.feedback(source(), edge["id"], "ok", indexed=True, fanout=1.0, ms=20)
        result = relations.feedback(source(), edge["id"], "ok", indexed=True, fanout=1.0, ms=20)
        self.assertEqual(result["edge"]["status"], "trusted")
        self.assertEqual(result["edge"]["stats"]["confirmCount"], 3)

    def test_two_confirmations_are_not_enough_for_trust(self):
        edge = self._edge()
        relations.feedback(source(), edge["id"], "ok", indexed=True, fanout=1.0, ms=20)
        result = relations.feedback(source(), edge["id"], "ok", indexed=True, fanout=1.0, ms=20)
        self.assertEqual(result["edge"]["status"], "confirmed")

    def test_confirmation_without_a_measurement_cannot_be_trusted(self):
        edge = self._edge()
        for _ in range(4):
            result = relations.feedback(source(), edge["id"], "ok", indexed=True, fanout=1.0)
        self.assertEqual(result["edge"]["status"], "confirmed", "no timing means no evidence it is fast")
        self.assertEqual(result["edge"]["stats"]["timings"], [])

    def test_an_unindexed_column_can_still_be_trusted(self):
        # The index is a hint, not the badge: a small unindexed table walked fast
        # three times is exactly as trustworthy as an indexed one.
        edge = self._edge()
        for _ in range(3):
            result = relations.feedback(source(), edge["id"], "ok", indexed=False, unique=False, fanout=1.0, ms=5)
        self.assertEqual(result["edge"]["status"], "trusted")
        self.assertFalse(relations.cost_of(result["edge"])["indexed"])

    def test_a_slow_edge_never_becomes_trusted(self):
        edge = self._edge()
        for _ in range(3):
            result = relations.feedback(source(), edge["id"], "ok", indexed=True, fanout=1.0, ms=900)
        self.assertEqual(result["edge"]["status"], "confirmed", "fast is the whole point")
        self.assertEqual(relations.cost_of(result["edge"])["avgMs"], 900.0)

    def test_one_slow_sample_in_the_window_blocks_trust(self):
        edge = self._edge()
        relations.feedback(source(), edge["id"], "ok", indexed=True, fanout=1.0, ms=10)
        relations.feedback(source(), edge["id"], "ok", indexed=True, fanout=1.0, ms=700)
        result = relations.feedback(source(), edge["id"], "ok", indexed=True, fanout=1.0, ms=10)
        self.assertEqual(result["edge"]["status"], "confirmed")

    def test_the_timing_window_keeps_the_last_five(self):
        edge = self._edge()
        relations.feedback(source(), edge["id"], "ok", indexed=True, fanout=1.0, ms=900)
        for _ in range(5):
            relations.feedback(source(), edge["id"], "ok", indexed=True, fanout=1.0, ms=10)
        stats = self._stored(edge["id"])["stats"]
        self.assertEqual(len(stats["timings"]), relations.TIMING_WINDOW)
        self.assertNotIn(900, stats["timings"], "the slow sample has aged out of the window")
        self.assertEqual(self._stored(edge["id"])["status"], "trusted")

    def test_a_wide_fanout_blocks_trust(self):
        edge = self._edge()
        relations.feedback(source(), edge["id"], "ok", indexed=True, fanout=1.0, ms=10)
        relations.feedback(source(), edge["id"], "ok", indexed=True, fanout=1.0, ms=10)
        result = relations.feedback(source(), edge["id"], "ok", indexed=True, fanout=9.0, ms=10)
        self.assertEqual(result["edge"]["status"], "confirmed")
        self.assertEqual(result["edge"]["stats"]["avgFanout"], 9.0)

    def test_trust_falls_back_when_the_fanout_grows(self):
        edge = self._edge()
        for _ in range(3):
            relations.feedback(source(), edge["id"], "ok", indexed=True, fanout=1.0, ms=10)
        self.assertEqual(self._stored(edge["id"])["status"], "trusted")
        result = relations.feedback(source(), edge["id"], "ok", indexed=True, fanout=12.0, ms=10)
        self.assertEqual(result["edge"]["status"], "confirmed", "trust is recomputed, not latched")

    def test_a_rejection_clears_the_run_of_confirmations(self):
        # Trust is earned by a run of confirmations, not by a lifetime tally: a
        # rejection says the join was wrong, so whatever it counted before no
        # longer stands. `rejectCount` stays as evidence of what happened.
        edge = self._edge()
        relations.feedback(source(), edge["id"], "ok", indexed=True, fanout=1.0, ms=10)
        relations.feedback(source(), edge["id"], "ok", indexed=True, fanout=1.0, ms=10)
        rejected = relations.feedback(source(), edge["id"], "too_many", reason="not_unique")
        self.assertEqual(rejected["edge"]["status"], "stale")
        self.assertEqual(rejected["edge"]["stats"]["confirmCount"], 0)
        self.assertEqual(rejected["edge"]["stats"]["rejectCount"], 1)
        # Three more confirmations in a row are needed again, and they are enough.
        for _ in range(2):
            relations.feedback(source(), edge["id"], "ok", indexed=True, fanout=1.0, ms=10)
        self.assertEqual(self._stored(edge["id"])["status"], "confirmed", "two of three is not a run yet")
        result = relations.feedback(source(), edge["id"], "ok", indexed=True, fanout=1.0, ms=10)
        self.assertEqual(result["edge"]["status"], "trusted")
        self.assertEqual(result["edge"]["stats"]["confirmCount"], 3)

    def test_an_irrelevant_verdict_is_not_evidence_about_the_join(self):
        # "This edge has nothing to do with the value" is a fact about one walk,
        # not about the join: it blacklists the edge but must not spend the run of
        # confirmations, otherwise a single stray click silently resets trust.
        edge = self._edge()
        relations.feedback(source(), edge["id"], "ok", indexed=True, fanout=1.0, ms=10)
        relations.feedback(source(), edge["id"], "ok", indexed=True, fanout=1.0, ms=10)
        rejected = relations.feedback(source(), edge["id"], "irrelevant")
        self.assertEqual(rejected["edge"]["status"], "rejected")
        self.assertEqual(rejected["edge"]["stats"]["confirmCount"], 2, "the run is untouched")
        self.assertEqual(rejected["edge"]["stats"]["rejectCount"], 0, "rejectCount is for join evidence only")
        result = relations.feedback(source(), edge["id"], "ok", indexed=True, fanout=1.0, ms=10)
        self.assertEqual(result["edge"]["status"], "trusted", "the third confirmation completes the run")

    def test_one_sporadic_slow_sample_does_not_withdraw_trust(self):
        edge = self._edge()
        for _ in range(3):
            relations.feedback(source(), edge["id"], "ok", indexed=True, fanout=1.0, ms=10)
        self.assertEqual(self._stored(edge["id"])["status"], "trusted")
        relations.note_timings(source(), {edge["id"]: 900})
        self.assertEqual(
            self._stored(edge["id"])["status"],
            "trusted",
            "one bad sample among fast ones is noise, not a trend",
        )

    def test_a_majority_of_slow_samples_withdraws_trust(self):
        edge = self._edge()
        for _ in range(3):
            relations.feedback(source(), edge["id"], "ok", indexed=True, fanout=1.0, ms=10)
        self.assertEqual(self._stored(edge["id"])["status"], "trusted")
        relations.note_timings(source(), {edge["id"]: 900})
        relations.note_timings(source(), {edge["id"]: 800})
        self.assertEqual(self._stored(edge["id"])["status"], "trusted", "two of five is not a majority yet")
        relations.note_timings(source(), {edge["id"]: 700})
        stored = self._stored(edge["id"])
        self.assertEqual(stored["status"], "confirmed", "three of five slow is a trend")
        actions = [entry["action"] for entry in stored["history"]]
        self.assertEqual(actions.count("trust withdrawn"), 1, "the fall-back is written down once, not per trace")
        self.assertIn("mostly over the slow threshold", stored["history"][-1]["note"])

    def test_a_rejection_that_already_happened_blocks_trust_until_three_more(self):
        edge = self._edge()
        relations.feedback(source(), edge["id"], "missing")
        result = relations.feedback(source(), edge["id"], "ok", indexed=True, fanout=1.0, ms=10)
        self.assertEqual(result["edge"]["status"], "confirmed")
        self.assertEqual(result["edge"]["stats"]["confirmCount"], 1)

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


class EdgeCost(unittest.TestCase):
    """What an edge costs to walk, and when that cost has to be asked about.

    The whole point of these numbers is to stop a trace from quietly scanning a
    ten-million-row table with no index. So the two decisions have to be separate:
    a big table with no index asks before running, and a fast edge earns trust
    whatever its index says. Mixing the two would either block every unindexed
    join or let one slow edge be trusted forever.
    """

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

    def _edge(self, indexed=None, rows=None):
        return relations.propose(
            source(), "t_trans", "order_id", "t_order", "id", indexed=indexed, row_estimate=rows
        )["edge"]

    def _stored(self, edge_id: str) -> dict:
        return next(edge for edge in relations.list_edges(source())["edges"] if edge["id"] == edge_id)

    # -- recording the cost ------------------------------------------------

    def test_a_proposal_records_the_index_and_the_row_count(self):
        edge = self._edge(indexed=False, rows=4_000_000)
        self.assertIs(edge["stats"]["indexed"], False)
        self.assertEqual(edge["stats"]["rowEstimate"], 4_000_000)

    def test_a_proposal_without_figures_leaves_them_unknown(self):
        stats = self._edge()["stats"]
        self.assertIsNone(stats["indexed"])
        self.assertIsNone(stats["rowEstimate"])

    def test_a_feedback_without_figures_keeps_what_it_had(self):
        edge = self._edge(indexed=True, rows=900)
        result = relations.feedback(source(), edge["id"], "ok", fanout=1.0, ms=10)
        self.assertIs(result["edge"]["stats"]["indexed"], True)
        self.assertEqual(result["edge"]["stats"]["rowEstimate"], 900)

    def test_rediscovery_carries_the_cost_onto_a_known_edge(self):
        edge = relations.propose(source(), "t_trans", "order_id", "t_order", "id")["edge"]
        row = {"table": "t_trans", "column": "order_id", "refTable": "t_order", "refColumn": "id", "indexed": True, "rowEstimate": 120}
        relations.import_edges(source(), [row], source="fk")
        stats = self._stored(edge["id"])["stats"]
        self.assertIs(stats["indexed"], True)
        self.assertEqual(stats["rowEstimate"], 120)

    # -- the trust badge ---------------------------------------------------

    def test_trust_needs_three_measured_samples(self):
        stats = {"confirmCount": 3, "rejectCount": 0, "avgFanout": 1.0, "timings": [10, 10]}
        self.assertFalse(relations._earns_trust(stats))
        stats["timings"] = [10, 10, 10]
        self.assertTrue(relations._earns_trust(stats))

    def test_a_measured_edge_needs_no_index(self):
        stats = {"confirmCount": 3, "rejectCount": 0, "avgFanout": 1.0, "timings": [1, 1, 1], "indexed": False}
        self.assertTrue(relations._earns_trust(stats))

    def test_the_slowest_sample_decides(self):
        stats = {"confirmCount": 3, "rejectCount": 0, "avgFanout": 1.0, "timings": [1, relations.SLOW_MS, 1]}
        self.assertFalse(relations._earns_trust(stats))

    def test_the_timer_counts_whole_milliseconds(self):
        stats = relations._blank_edge(
            {"table": "a", "column": "b"}, {"table": "c", "column": "d"}, "manual", None
        )["stats"]
        relations._timed(stats, 12.4)
        relations._timed(stats, "nonsense")
        self.assertEqual(stats["timings"], [12])
        self.assertEqual(stats["lastMs"], 12)
        self.assertEqual(stats["avgMs"], 12.0)

    def test_trace_timings_land_on_the_edge_they_belong_to(self):
        edge = self._edge()
        relations.note_timings(source(), {edge["id"]: 40})
        relations.note_timings(source(), {edge["id"]: 60})
        stats = self._stored(edge["id"])["stats"]
        self.assertEqual(stats["timings"], [40, 60])
        self.assertEqual(stats["lastMs"], 60)
        self.assertEqual(stats["avgMs"], 50.0)

    def test_timings_for_an_unknown_edge_are_ignored(self):
        self.assertEqual(relations.note_timings(source(), {"e_nope": 10}), 0)

    # -- the full-scan gate ------------------------------------------------

    def test_a_big_unindexed_target_asks_first(self):
        self.assertTrue(relations.needs_confirm({"rowEstimate": relations.BIG_TABLE_ROWS, "indexed": False}))

    def test_a_big_indexed_target_does_not(self):
        self.assertFalse(relations.needs_confirm({"rowEstimate": relations.BIG_TABLE_ROWS, "indexed": True}))

    def test_a_small_unindexed_target_does_not(self):
        self.assertFalse(relations.needs_confirm({"rowEstimate": relations.BIG_TABLE_ROWS - 1, "indexed": False}))

    def test_an_unknown_row_count_never_blocks_the_walk(self):
        self.assertFalse(relations.needs_confirm({"rowEstimate": None, "indexed": False}))

    def test_an_unknown_index_never_blocks_the_walk(self):
        self.assertFalse(
            relations.needs_confirm({"rowEstimate": relations.BIG_TABLE_ROWS * 2, "indexed": None}),
            "blocking on a catalog we could not read would stop every trace",
        )

    def test_the_cost_summary_carries_all_of_it(self):
        edge = self._edge(indexed=False, rows=2_000_000)
        relations.feedback(source(), edge["id"], "ok", fanout=1.0, ms=340)
        cost = relations.cost_of(self._stored(edge["id"]))
        self.assertIs(cost["indexed"], False)
        self.assertEqual(cost["rowEstimate"], 2_000_000)
        self.assertEqual(cost["lastMs"], 340)
        self.assertEqual(cost["avgMs"], 340.0)
        self.assertTrue(cost["needsConfirm"])

    def test_the_listing_carries_the_cost_without_being_asked(self):
        edge = self._edge(indexed=True, rows=10)
        listed = next(item for item in relations.list_edges(source())["edges"] if item["id"] == edge["id"])
        self.assertIn("cost", listed)
        self.assertIs(listed["cost"]["indexed"], True)
        self.assertFalse(listed["cost"]["needsConfirm"])


class CostSettings(unittest.TestCase):
    """The four cost thresholds are editable, so where they come from now matters.

    A value written by the panel has to reach the very next decision, without a
    restart — that is the whole point of moving them out of module constants. The
    other half is that a broken file cannot make the rules meaningless: a window
    of zero or a "slow" step of one millisecond would flip every edge, so every
    number is clamped into a range where it still says something.
    """

    def setUp(self):
        self.saved = os.environ.get("DB_MCP_RUNTIME")
        self.tmp = tempfile.TemporaryDirectory()
        os.environ["DB_MCP_RUNTIME"] = self.tmp.name
        self.file = Path(self.tmp.name) / "settings.json"

    def tearDown(self):
        if self.saved is None:
            os.environ.pop("DB_MCP_RUNTIME", None)
        else:
            os.environ["DB_MCP_RUNTIME"] = self.saved
        self.tmp.cleanup()

    def _write(self, payload) -> None:
        self.file.write_text(json.dumps(payload), encoding="utf-8")

    def test_the_defaults_apply_without_a_settings_file(self):
        self.assertEqual(relations.cost_settings(), dict(relations.COST_DEFAULTS))

    def test_a_written_value_reaches_the_next_decision(self):
        self._write({"cost": {"slowMs": 50, "bigTableRows": 2_000}})
        cost = relations.cost_settings()
        self.assertEqual(cost["slowMs"], 50)
        self.assertEqual(cost["bigTableRows"], 2_000)
        # 3_000 rows clears the new threshold, so this stats dict now asks.
        self.assertTrue(relations.needs_confirm({"rowEstimate": 3_000, "indexed": False}))

    def test_a_lowered_large_table_threshold_starts_asking_earlier(self):
        self.assertFalse(relations.needs_confirm({"rowEstimate": 20_000, "indexed": False}))
        self._write({"cost": {"bigTableRows": 10_000}})
        self.assertTrue(relations.needs_confirm({"rowEstimate": 20_000, "indexed": False}))

    def test_a_raised_slow_threshold_lets_a_slow_edge_be_trusted(self):
        edge = relations.propose(source(), "t_trans", "order_id", "t_order", "id")["edge"]
        for _ in range(3):
            relations.feedback(source(), edge["id"], "ok", fanout=1.0, ms=300)
        stored = next(item for item in relations.list_edges(source())["edges"] if item["id"] == edge["id"])
        self.assertEqual(stored["status"], "confirmed")
        self._write({"cost": {"slowMs": 400}})
        relations.feedback(source(), edge["id"], "ok", fanout=1.0, ms=300)
        stored = next(item for item in relations.list_edges(source())["edges"] if item["id"] == edge["id"])
        self.assertEqual(stored["status"], "trusted")

    def test_a_window_of_one_keeps_only_the_newest_sample(self):
        edge = relations.propose(source(), "t_trans", "order_id", "t_order", "id")["edge"]
        self._write({"cost": {"timingWindow": 1}})
        for ms in (10, 20, 30):
            relations.feedback(source(), edge["id"], "ok", fanout=1.0, ms=ms)
        stored = next(item for item in relations.list_edges(source())["edges"] if item["id"] == edge["id"])
        self.assertEqual(stored["stats"]["timings"], [30])
        self.assertEqual(stored["stats"]["lastMs"], 30)
        self.assertEqual(stored["stats"]["avgMs"], 30.0)

    def test_out_of_range_and_broken_values_fall_back(self):
        self._write(
            {
                "cost": {
                    "slowMs": 0,
                    "timingWindow": 999,
                    "trustSamples": "fast",
                    "bigTableRows": True,
                }
            }
        )
        cost = relations.cost_settings()
        self.assertEqual(cost["slowMs"], relations.COST_CAPS["slowMs"][0])
        self.assertEqual(cost["timingWindow"], relations.COST_CAPS["timingWindow"][1])
        self.assertEqual(cost["trustSamples"], relations.COST_DEFAULTS["trustSamples"])
        self.assertEqual(cost["bigTableRows"], relations.COST_DEFAULTS["bigTableRows"])

    def test_a_broken_settings_file_falls_back_to_the_defaults(self):
        self.file.write_text("{ not json", encoding="utf-8")
        self.assertEqual(relations.cost_settings(), dict(relations.COST_DEFAULTS))


if __name__ == "__main__":
    unittest.main(verbosity=2)
