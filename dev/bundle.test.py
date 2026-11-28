"""Regression tests for `server/bundle.py`: sharing a graph as a bundle.

A bundle is data the owner chose to hand to somebody else. It must be checked
before it is trusted: limits, a known version, and known fields only. Importing
is a pure calculation until the panel confirms it, so a preview can never touch
the relation or scene files. Run through `dev/engines.test.mjs` (`npm test`).
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
sys.path.insert(0, str(PACKAGE / "server"))


def _load(name: str):
    spec = importlib.util.spec_from_file_location(name, PACKAGE / "server" / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


# Load the modules bundle.py imports BEFORE bundle itself. `import store` inside
# bundle picks up whatever is in sys.modules at that moment; loading bundle first
# would give it a different StoreError class than the one these tests assert on.
store = _load("store")
relations = _load("relations")
scenes = _load("scenes")
bundle = _load("bundle")


def _edge(frm_table, frm_column, to_table, to_column, **extra):
    frm = relations._endpoint(frm_table, frm_column, "from")
    to = relations._endpoint(to_table, to_column, "to")
    edge = relations._blank_edge(frm, to, "inferred", None)
    edge.update(extra)
    return edge


def _scene(name="订单到收款", tables=None, **extra):
    scene = {
        "id": scenes._new_id(),
        "name": name,
        "tables": tables or ["t_order", "t_payment"],
        "note": "a shared scene",
        "createdAt": "2026-01-01T00:00:00.000Z",
        "updatedAt": "2026-01-01T00:00:00.000Z",
    }
    scene.update(extra)
    return scene


class BundleShape(unittest.TestCase):
    def test_a_fingerprint_is_the_sha1_of_sorted_endpoints(self):
        first = _edge("T_ORDER", "id", "t_line", "order_id")
        second = _edge("t_line", "order_id", "t_order", "id")
        # The two written directions are the same pair of endpoints.
        self.assertEqual(bundle.bundle_fingerprint([first]), bundle.bundle_fingerprint([second]))
        seed = "t_line.order_id->t_order.id"
        import hashlib

        self.assertEqual(
            bundle.bundle_fingerprint([first]), hashlib.sha1(seed.encode("utf-8")).hexdigest()[:12]
        )

    def test_export_carries_the_shape_and_not_the_local_counters(self):
        edge = _edge("t_order", "id", "t_line", "order_id", status="trusted")
        edge["stats"]["confirmCount"] = 3
        exported = bundle.export_bundle(
            {"edges": [edge], "schemaVersion": relations.SCHEMA_VERSION},
            {"scenes": [_scene()], "schemaVersion": scenes.SCHEMA_VERSION},
            datasource="trace-demo",
        )
        self.assertEqual(exported["schemaVersion"], bundle.SCHEMA_VERSION)
        self.assertEqual(exported["datasource"], "trace-demo")
        self.assertEqual(len(exported["edges"]), 1)
        self.assertEqual(len(exported["scenes"]), 1)
        # Trust is local: a shared edge arrives pending, with zero confirmations.
        self.assertNotIn("confirmCount", json.dumps(exported["edges"][0]))
        self.assertIn("fingerprint", exported)
        # The status travels only as a *hint* — the recipient recomputes its own.
        self.assertEqual(exported["edges"][0]["status"], "trusted")

    def test_export_does_not_carry_confirm_count_or_history(self):
        edge = _edge("t_order", "id", "t_line", "order_id", status="confirmed")
        edge["stats"]["confirmCount"] = 3
        edge["history"] = [{"at": "x", "what": "trusted"}]
        exported = bundle.export_bundle({"edges": [edge]}, {"scenes": []})
        self.assertNotIn("confirmCount", json.dumps(exported["edges"][0]))
        self.assertNotIn("history", exported["edges"][0])
        self.assertNotIn("stats", exported["edges"][0])

    def test_a_missing_source_file_is_an_empty_bundle(self):
        result = bundle.export_bundle(
            {"edges": [], "schemaVersion": relations.SCHEMA_VERSION},
            {"scenes": [], "schemaVersion": scenes.SCHEMA_VERSION},
        )
        self.assertEqual(result["edges"], [])
        self.assertEqual(result["scenes"], [])


class ImportingABundle(unittest.TestCase):
    def setUp(self):
        self.saved = dict(os.environ)
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        os.environ["DB_MCP_RUNTIME"] = str(self.dir)
        self.profile = {"id": "trace-demo", "kind": "gauss"}

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self.saved)
        self.tmp.cleanup()

    def _bundle(self, edges=None, scenes_list=None, **extra):
        payload = {
            "schemaVersion": bundle.SCHEMA_VERSION,
            "kind": bundle.KIND,
            "edges": edges if edges is not None else [],
            "scenes": scenes_list if scenes_list is not None else [],
        }
        payload.update(extra)
        return payload

    def _wire(self, edge):
        return {
            "from": dict(edge["from"]),
            "to": dict(edge["to"]),
            "condition": edge.get("condition"),
            "note": edge.get("note"),
            "places": list(edge.get("places") or []),
        }

    # -- dry run and idempotence -------------------------------------------

    def test_dry_run_changes_nothing_on_disk(self):
        edge = self._wire(_edge("t_order", "id", "t_line", "order_id"))
        relations.save(self.profile, relations._blank(self.profile))
        scenes.save(self.profile, scenes._blank(self.profile))
        before = (relations.path_of(self.profile).read_bytes(), scenes.path_of(self.profile).read_bytes())
        result = bundle.import_bundle(self.profile, self._bundle(edges=[edge]))
        self.assertEqual(result["imported"], 1)
        self.assertEqual((relations.path_of(self.profile).read_bytes(), scenes.path_of(self.profile).read_bytes()), before)
        self.assertIn("relationsDoc", result)
        self.assertIn("scenesDoc", result)

    def test_two_round_trips_are_idempotent(self):
        edge = self._wire(_edge("t_order", "id", "t_line", "order_id"))
        first = bundle.import_bundle(self.profile, self._bundle(edges=[edge]))
        exported = bundle.export_bundle(first["relationsDoc"], first["scenesDoc"])
        again = bundle.import_bundle(self.profile, exported, first["relationsDoc"], first["scenesDoc"])
        self.assertEqual(again["imported"], 0)
        self.assertEqual(again["updated"], 0)
        self.assertEqual(again["skipped"], 1)
        again_exported = bundle.export_bundle(again["relationsDoc"], again["scenesDoc"])
        self.assertEqual(exported["fingerprint"], again_exported["fingerprint"])

    def test_a_forged_edge_fingerprint_is_ignored(self):
        edge = self._wire(_edge("t_order", "id", "t_line", "order_id"))
        edge["fingerprint"] = "e_deadbe"
        edge["id"] = "e_deadbe"
        result = bundle.import_bundle(self.profile, self._bundle(edges=[edge]))
        expected = relations.edge_id(edge["from"], edge["to"])
        self.assertEqual(result["relationsDoc"]["edges"][0]["id"], expected)
        self.assertNotIn("e_deadbe", json.dumps(result["relationsDoc"]["edges"][0]))

    def test_a_whole_bundle_fingerprint_mismatch_is_only_a_hint(self):
        edge = self._wire(_edge("t_order", "id", "t_line", "order_id"))
        payload = self._bundle(edges=[edge], fingerprint="not-this-bundle")
        result = bundle.import_bundle(self.profile, payload)
        self.assertFalse(result["fingerprintMatches"])
        self.assertEqual(result["imported"], 1)

    # -- trust and conflicts ------------------------------------------------

    def test_an_imported_edge_starts_pending_with_zero_confirmations(self):
        edge = self._wire(_edge("t_order", "id", "t_line", "order_id", status="trusted"))
        result = bundle.import_bundle(self.profile, self._bundle(edges=[edge]))
        imported = result["relationsDoc"]["edges"][0]
        self.assertEqual(imported["status"], "pending")
        self.assertEqual(imported["stats"]["confirmCount"], 0)
        self.assertEqual(imported["source"], "imported")
        self.assertTrue(imported.get("importId"))
        self.assertTrue(relations.needs_confirm(imported["stats"]) is False)

    def test_a_different_condition_keeps_the_local_one(self):
        wire = self._wire(_edge("t_order", "id", "t_line", "order_id"))
        wire["condition"] = "o.state = 'PAID'"
        local_edges = [_edge("t_order", "id", "t_line", "order_id", condition="o.state = 'NEW'")]
        result = bundle.import_bundle(
            self.profile,
            self._bundle(edges=[wire]),
            {"edges": local_edges, "schemaVersion": relations.SCHEMA_VERSION},
            {"scenes": [], "schemaVersion": scenes.SCHEMA_VERSION},
        )
        self.assertEqual(result["relationsDoc"]["edges"][0]["condition"], "o.state = 'NEW'")
        self.assertEqual(len(result["conflicts"]), 1)
        self.assertEqual(result["updated"], 0)

    def test_a_condition_the_local_edge_lacks_is_a_conflict_too(self):
        wire = self._wire(_edge("t_order", "id", "t_line", "order_id"))
        wire["condition"] = "o.state = 'PAID'"
        local_edges = [_edge("t_order", "id", "t_line", "order_id")]
        result = bundle.import_bundle(
            self.profile,
            self._bundle(edges=[wire]),
            {"edges": local_edges, "schemaVersion": relations.SCHEMA_VERSION},
            {"scenes": [], "schemaVersion": scenes.SCHEMA_VERSION},
        )
        self.assertIsNone(result["relationsDoc"]["edges"][0]["condition"])
        self.assertEqual(len(result["conflicts"]), 1)

    def test_an_identical_condition_is_not_a_conflict(self):
        wire = self._wire(_edge("t_order", "id", "t_line", "order_id"))
        wire["condition"] = "o.state = 'PAID'"
        local_edges = [_edge("t_order", "id", "t_line", "order_id", condition="o.state = 'PAID'")]
        result = bundle.import_bundle(
            self.profile,
            self._bundle(edges=[wire]),
            {"edges": local_edges, "schemaVersion": relations.SCHEMA_VERSION},
            {"scenes": [], "schemaVersion": scenes.SCHEMA_VERSION},
        )
        self.assertEqual(result["conflicts"], [])

    # -- scenes -------------------------------------------------------------

    def test_scene_ids_are_regenerated(self):
        old = _scene()
        result = bundle.import_bundle(self.profile, self._bundle(scenes_list=[old]))
        imported = result["scenesDoc"]["scenes"][0]
        self.assertNotEqual(imported["id"], old["id"])
        self.assertEqual(imported["importId"], result["importId"])

    def test_a_scene_with_a_missing_table_is_marked_stale_and_reported(self):
        scene = _scene(
            tables=["t_order", "t_payment"],
            aliases={"serial": [{"table": "t_gone", "column": "order_no"}]},
            weakMatch=[{"fromStage": "Paid", "fromColumn": "paid_at", "toColumn": "t_ghost.code", "op": "eq"}],
            stages=[{"name": "Paid", "table": "t_payment", "locate": "edge"}],
        )
        result = bundle.import_bundle(self.profile, self._bundle(scenes_list=[scene]))
        self.assertTrue(result["stale"])
        self.assertTrue(any("t_gone" in str(item) for item in result["stale"]))
        self.assertTrue(any("t_ghost" in str(item) for item in result["stale"]))

    def test_unknown_scene_fields_are_dropped(self):
        scene = _scene(secretOwner="someone-else")
        result = bundle.import_bundle(self.profile, self._bundle(scenes_list=[scene]))
        self.assertNotIn("secretOwner", result["scenesDoc"]["scenes"][0])

    # -- limits and validation ---------------------------------------------

    def test_an_unknown_schema_version_is_rejected(self):
        with self.assertRaises(store.StoreError) as caught:
            bundle.import_bundle(self.profile, self._bundle(schemaVersion=999))
        self.assertEqual(caught.exception.code, "user_error")

    def test_too_many_edges_is_rejected(self):
        edges = [self._wire(_edge("t_a", "id", "t_b", "a_id")) for _ in range(bundle.MAX_EDGES + 1)]
        with self.assertRaises(store.StoreError):
            bundle.import_bundle(self.profile, self._bundle(edges=edges))

    def test_too_many_scenes_is_rejected(self):
        many = [_scene(name=f"s{i}") for i in range(bundle.MAX_SCENES + 1)]
        with self.assertRaises(store.StoreError):
            bundle.import_bundle(self.profile, self._bundle(scenes_list=many))

    def test_an_oversized_string_is_rejected(self):
        wire = self._wire(_edge("t_a", "id", "t_b", "a_id"))
        wire["note"] = "x" * (bundle.MAX_STRING + 1)
        with self.assertRaises(store.StoreError):
            bundle.import_bundle(self.profile, self._bundle(edges=[wire]))

    def test_unknown_fields_are_ignored_and_not_persisted(self):
        wire = self._wire(_edge("t_a", "id", "t_b", "a_id"))
        wire["someFutureField"] = "whatever"
        result = bundle.import_bundle(self.profile, self._bundle(edges=[wire], futureTopLevel=1))
        self.assertNotIn("someFutureField", result["relationsDoc"]["edges"][0])
        self.assertNotIn("futureTopLevel", json.dumps(result["relationsDoc"]))

    # -- applying and undoing ----------------------------------------------

    def test_apply_writes_and_undo_removes_only_that_import(self):
        wire = self._wire(_edge("t_order", "id", "t_line", "order_id"))
        result = bundle.import_bundle(self.profile, self._bundle(edges=[wire], scenes_list=[_scene()]))
        bundle.apply_import(self.profile, result)
        self.assertEqual(len(relations.load(self.profile)["edges"]), 1)
        self.assertEqual(len(scenes.load(self.profile)["scenes"]), 1)
        undo = bundle.undo_import(self.profile, result["importId"])
        bundle.apply_import(self.profile, undo)
        self.assertEqual(relations.load(self.profile)["edges"], [])
        self.assertEqual(scenes.load(self.profile)["scenes"], [])

    def test_a_failed_second_write_leaves_both_files_unchanged(self):
        original_replace = bundle.os.replace
        calls = {"n": 0}

        def _fail_on_second(src, dst):
            calls["n"] += 1
            if calls["n"] == 2:
                raise OSError("disk full")
            return original_replace(src, dst)

        relations.save(self.profile, relations._blank(self.profile))
        scenes.save(self.profile, scenes._blank(self.profile))
        before = (relations.path_of(self.profile).read_bytes(), scenes.path_of(self.profile).read_bytes())
        wire = self._wire(_edge("t_order", "id", "t_line", "order_id"))
        result = bundle.import_bundle(self.profile, self._bundle(edges=[wire], scenes_list=[_scene()]))
        bundle.os.replace = _fail_on_second
        try:
            with self.assertRaises(OSError):
                bundle.apply_import(self.profile, result)
        finally:
            bundle.os.replace = original_replace
        self.assertEqual((relations.path_of(self.profile).read_bytes(), scenes.path_of(self.profile).read_bytes()), before)


class StatusFromCatalog(unittest.TestCase):
    """Trust is local: a shared status is a hint, checked against a local catalog.

    The catalog is a *cached* table/column directory passed in by the caller. No
    connection is opened here. With no catalog the reader cannot compare, so all
    edges arrive pending with a reason the panel can show.
    """

    def setUp(self):
        self.saved = dict(os.environ)
        self.tmp = tempfile.TemporaryDirectory()
        os.environ["DB_MCP_RUNTIME"] = str(self.tmp.name)
        self.profile = {"id": "trace-demo", "kind": "gauss"}

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self.saved)
        self.tmp.cleanup()

    def _catalog(self):
        return {
            "tables": {
                "t_order": {"columns": {"id": "integer", "code": "character varying(16)"}},
                "t_line": {"columns": {"order_id": "integer", "sku": "character varying(32)"}},
            }
        }

    def _wire(self, status, frm=("t_order", "id"), to=("t_line", "order_id")):
        edge = _edge(frm[0], frm[1], to[0], to[1], status=status)
        wire = {
            "from": dict(edge["from"]),
            "to": dict(edge["to"]),
            "condition": None,
            "note": None,
            "places": [],
            "status": status,
        }
        return wire

    def _payload(self, *wires):
        return {"schemaVersion": bundle.SCHEMA_VERSION, "edges": list(wires), "scenes": []}

    def test_no_catalog_means_all_pending_with_a_reason(self):
        result = bundle.import_bundle(self.profile, self._payload(self._wire("trusted")))
        edge = result["relationsDoc"]["edges"][0]
        self.assertEqual(edge["status"], "pending")
        self.assertFalse(result.get("catalogChecked"))
        self.assertTrue(result.get("catalogHint"))
        self.assertTrue(any(item.get("reason") == "not_checked" for item in result.get("downgraded", [])))

    def test_catalog_checked_confirmed_stays_confirmed_with_zero_count(self):
        wire = self._wire("confirmed")
        wire["stats"] = {"confirmCount": 3}
        result = bundle.import_bundle(self.profile, self._payload(wire), catalog=self._catalog())
        edge = result["relationsDoc"]["edges"][0]
        self.assertTrue(result.get("catalogChecked"))
        self.assertEqual(edge["status"], "confirmed")
        self.assertEqual(edge["stats"]["confirmCount"], 0)
        self.assertEqual(result.get("downgraded"), [])

    def test_catalog_checked_trusted_becomes_confirmed(self):
        result = bundle.import_bundle(self.profile, self._payload(self._wire("trusted")), catalog=self._catalog())
        self.assertEqual(result["relationsDoc"]["edges"][0]["status"], "confirmed")

    def test_pending_stays_pending_even_with_catalog(self):
        result = bundle.import_bundle(self.profile, self._payload(self._wire("pending")), catalog=self._catalog())
        self.assertEqual(result["relationsDoc"]["edges"][0]["status"], "pending")

    def test_missing_table_is_pending_with_a_reason(self):
        wire = self._wire("trusted", frm=("t_order", "id"), to=("t_ghost", "order_id"))
        result = bundle.import_bundle(self.profile, self._payload(wire), catalog=self._catalog())
        edge = result["relationsDoc"]["edges"][0]
        self.assertEqual(edge["status"], "pending")
        self.assertTrue(edge.get("stale"))
        self.assertTrue(any(item.get("reason") == "missing_table" for item in result.get("downgraded", [])))

    def test_missing_column_is_pending_with_a_reason(self):
        wire = self._wire("trusted", frm=("t_order", "id"), to=("t_line", "no_such_col"))
        result = bundle.import_bundle(self.profile, self._payload(wire), catalog=self._catalog())
        edge = result["relationsDoc"]["edges"][0]
        self.assertEqual(edge["status"], "pending")
        self.assertTrue(any(item.get("reason") == "missing_column" for item in result.get("downgraded", [])))

    def test_type_incompatible_is_pending_with_a_reason(self):
        wire = self._wire("trusted", frm=("t_order", "code"), to=("t_line", "order_id"))
        result = bundle.import_bundle(self.profile, self._payload(wire), catalog=self._catalog())
        edge = result["relationsDoc"]["edges"][0]
        self.assertEqual(edge["status"], "pending")
        self.assertTrue(any(item.get("reason") == "type_incompatible" for item in result.get("downgraded", [])))

    def test_catalog_lookup_is_case_insensitive(self):
        wire = self._wire("confirmed", frm=("T_ORDER", "ID"), to=("T_LINE", "ORDER_ID"))
        result = bundle.import_bundle(self.profile, self._payload(wire), catalog=self._catalog())
        self.assertEqual(result["relationsDoc"]["edges"][0]["status"], "confirmed")

    def test_toggle_pending_all_forces_everything_pending(self):
        result = bundle.import_bundle(
            self.profile, self._payload(self._wire("trusted")), catalog=self._catalog(), respect_status=False
        )
        self.assertEqual(result["relationsDoc"]["edges"][0]["status"], "pending")
        self.assertTrue(any(item.get("reason") == "pending_all" for item in result.get("downgraded", [])))

    def test_rejected_with_condition_conflict_keeps_the_local_edge(self):
        wire = self._wire("rejected")
        wire["condition"] = "o.state = 'PAID'"
        local = [_edge("t_order", "id", "t_line", "order_id", condition="o.state = 'NEW'")]
        result = bundle.import_bundle(
            self.profile,
            self._payload(wire),
            relations_doc={"edges": local, "schemaVersion": relations.SCHEMA_VERSION},
            scenes_doc={"scenes": [], "schemaVersion": scenes.SCHEMA_VERSION},
            catalog=self._catalog(),
        )
        self.assertEqual(result["relationsDoc"]["edges"][0]["condition"], "o.state = 'NEW'")
        self.assertEqual(len(result["conflicts"]), 1)

    def test_a_catalog_cache_round_trips_and_missing_is_none(self):
        catalog = self._catalog()
        self.assertIsNone(store.load_catalog(self.profile))
        store.save_catalog(self.profile, catalog)
        self.assertEqual(store.load_catalog(self.profile), catalog)


if __name__ == "__main__":
    unittest.main(verbosity=2)
