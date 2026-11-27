"""Upgrade compatibility: 1.1.0-format files read by the current code.

Round 3 added cost fields to relation edges (``timings``, ``indexed``,
``rowEstimate``) and business fields to scenes (``stages``, ``aliases``,
``inputAlias``, ``weakMatch``). A user upgrading does not regenerate those files —
the same JSON is loaded by the new code on the first tool call. This suite writes
files in the exact shape 1.1.0 produced (taken from the 1.1.0 release commit) and
checks that:

* both files load without error and keep every edge and scene;
* an old ``trusted`` edge is not silently demoted just because it has no timings,
  and an old ``confirmed`` edge is not promoted without the new evidence;
* the missing fields get sane defaults — empty timings, no ``needsConfirm``, empty
  stages/aliases/weakMatch, and no input alias — so the panel renders them
  rather than crashing on ``undefined``.

Run it through ``dev/engines.test.mjs`` like the other Python suites.
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


def _load(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, PACKAGE / "server" / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


relations = _load("db_mcp_relations_upgrade", "relations.py")
scenes = _load("db_mcp_scenes_upgrade", "scenes.py")


def source(identity: str = "shop") -> dict:
    return {"id": identity, "name": identity, "kind": "sqlite", "config": {}, "readOnly": True}


# The 1.1.0 edge shape: stats carried confirmCount / rejectCount / lastVerifiedAt /
# avgFanout / hitCount and nothing else — no timings, no indexed, no rowEstimate.
def old_edge(edge_id: str, status: str, confirm_count: int, reject_count: int) -> dict:
    return {
        "id": edge_id,
        "from": {"table": "t_trans", "column": "order_id"},
        "to": {"table": "t_order", "column": "id"},
        "source": "manual",
        "status": status,
        "condition": None,
        "note": None,
        "stats": {
            "confirmCount": confirm_count,
            "rejectCount": reject_count,
            "lastVerifiedAt": None,
            "avgFanout": 1.5,
            "hitCount": 0,
        },
        "history": [{"at": "2026-11-25T00:00:00.000Z", "action": "created", "by": "agent", "note": None}],
        "createdAt": "2026-11-25T00:00:00.000Z",
        "updatedAt": "2026-11-25T00:00:00.000Z",
    }


# The 1.1.0 scene shape: an id, name, tables, note and timestamps — none of the
# business-order / alias / weak-link fields introduced in Round 3.
def old_scene() -> dict:
    return {
        "id": "s_1111",
        "name": "order to cash",
        "tables": ["t_order", "t_trans"],
        "note": None,
        "createdAt": "2026-11-25T00:00:00.000Z",
        "updatedAt": "2026-11-25T00:00:00.000Z",
    }


class UpgradeFrom110(unittest.TestCase):
    def setUp(self):
        self.saved = os.environ.get("DB_MCP_RUNTIME")
        self.tmp = tempfile.TemporaryDirectory()
        os.environ["DB_MCP_RUNTIME"] = self.tmp.name
        self.profile = source()

    def tearDown(self):
        if self.saved is None:
            os.environ.pop("DB_MCP_RUNTIME", None)
        else:
            os.environ["DB_MCP_RUNTIME"] = self.saved
        self.tmp.cleanup()

    def _write(self, module, payload: dict):
        target = module.path_of(self.profile)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")

    def _relations_file(self):
        self._write(
            relations,
            {
                "schemaVersion": 1,
                "datasource": "shop",
                "kind": "sqlite",
                "updatedAt": "2026-11-25T00:00:00.000Z",
                # One already-trusted edge (with a historical rejection) and one
                # merely confirmed. Neither has any timing data.
                "edges": [
                    old_edge("e_trusted", "trusted", 3, 1),
                    old_edge("e_confirmed", "confirmed", 1, 0),
                ],
            },
        )

    def _scenes_file(self):
        self._write(
            scenes,
            {
                "schemaVersion": 1,
                "datasource": "shop",
                "kind": "sqlite",
                "updatedAt": "2026-11-25T00:00:00.000Z",
                "scenes": [old_scene()],
            },
        )

    # -- relations ----------------------------------------------------------

    def test_an_old_relations_file_loads_without_error_or_loss(self):
        self._relations_file()
        doc = relations.load(self.profile)
        self.assertEqual(len(doc["edges"]), 2)
        self.assertEqual({edge["id"] for edge in doc["edges"]}, {"e_trusted", "e_confirmed"})

    def test_an_old_trusted_edge_is_not_demoted_just_by_loading(self):
        self._relations_file()
        doc = relations.load(self.profile)
        trusted = next(edge for edge in doc["edges"] if edge["id"] == "e_trusted")
        self.assertEqual(trusted["status"], "trusted")

        # The new withdrawal rule needs a majority of *measured* slow samples.
        # With no timings at all there is nothing to withdraw on, so a trace that
        # happens to walk it cannot strip the badge on day one.
        stats = trusted["stats"]
        self.assertEqual(relations._samples(stats), [])
        self.assertFalse(relations.mostly_slow(stats))
        self.assertEqual(relations.note_timings(self.profile, {"e_trusted": 12}), 1)
        again = relations.load(self.profile)
        still = next(edge for edge in again["edges"] if edge["id"] == "e_trusted")
        self.assertEqual(still["status"], "trusted", "a fast sample must not demote it")

    def test_an_old_confirmed_edge_is_not_promoted_without_new_evidence(self):
        self._relations_file()
        doc = relations.load(self.profile)
        confirmed = next(edge for edge in doc["edges"] if edge["id"] == "e_confirmed")
        # Three confirmations used to be enough; now timing samples are required
        # too, so the old stats alone must not silently mint a trusted edge.
        self.assertFalse(relations._earns_trust(confirmed["stats"]))

    def test_missing_cost_fields_get_sane_defaults(self):
        self._relations_file()
        doc = relations.load(self.profile)
        for edge in doc["edges"]:
            cost = relations.cost_of(edge)
            self.assertEqual(cost["timings"], [])
            self.assertFalse(cost["needsConfirm"])
            self.assertIsNone(cost["rowEstimate"])
            self.assertIsNone(cost["indexed"])
            self.assertIsNone(cost["lastMs"])

    # -- scenes -------------------------------------------------------------

    def test_an_old_scenes_file_loads_and_describes_with_defaults(self):
        self._scenes_file()
        result = scenes.list_scenes(self.profile)
        self.assertEqual(result["total"], 1)
        described = result["scenes"][0]
        self.assertEqual(described["name"], "order to cash")
        self.assertEqual(described["tables"], ["t_order", "t_trans"])
        self.assertEqual(described["stages"], [])
        self.assertEqual(described["aliases"], {})
        self.assertEqual(described["weakMatch"], [])
        self.assertIsNone(described["inputAlias"])
        self.assertEqual(described["costly"], [])

    def test_an_old_scene_can_be_resaved_without_losing_its_identity(self):
        self._scenes_file()
        found = scenes.resolve(self.profile, "s_1111")
        self.assertIsNotNone(found, "the old id must still resolve by id")
        # Saving a new field onto an old scene keeps the id and the existing
        # membership; the new fields are added, not used to rebuild the scene.
        updated = scenes.save_scene(
            self.profile,
            "order to cash",
            ["t_order", "t_trans"],
            scene_id="s_1111",
            stages=[{"name": "Order", "table": "t_order"}],
        )
        self.assertEqual(updated["scene"]["id"], "s_1111")
        self.assertEqual(updated["scene"]["stages"][0]["name"], "Order")
        self.assertEqual(len(updated["scene"]["stages"]), 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
