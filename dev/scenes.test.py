"""Regression tests for `server/scenes.py`, the named table sets a trace stays inside.

The point of a scene is that it is *only* a table list: it must never own an edge,
or deleting one would quietly lose a join somebody confirmed. Most of what is
guarded here follows from that one rule — save by name updates instead of piling
up duplicates, case differences do not create a second scene, and delete leaves
the relation graph untouched.

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
# `scenes.py` reaches `import store`, which is how `main.py` imports it too.
sys.path.insert(0, str(PACKAGE / "server"))
SPEC = importlib.util.spec_from_file_location("db_mcp_scenes", PACKAGE / "server" / "scenes.py")
scenes = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(scenes)


def source(identity: str = "shop") -> dict:
    return {"id": identity, "name": identity, "kind": "sqlite", "config": {}, "readOnly": True}


class SceneFile(unittest.TestCase):
    """The file itself: atomic writes, a blank start, and a refusal to reset."""

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

    def test_a_missing_file_starts_empty(self):
        doc = scenes.load(self.profile)
        self.assertEqual(doc["scenes"], [])
        self.assertEqual(doc["datasource"], "shop")

    def test_the_path_is_per_datasource(self):
        one = scenes.path_of(source("shop"))
        two = scenes.path_of(source("warehouse"))
        self.assertNotEqual(one, two)
        self.assertEqual(one.parent.name, "scenes")

    def test_saving_then_loading_round_trips(self):
        scenes.save_scene(self.profile, "order to cash", ["sales_order", "payment"])
        again = scenes.load(self.profile)
        self.assertEqual(len(again["scenes"]), 1)
        self.assertEqual(again["scenes"][0]["tables"], ["sales_order", "payment"])

    def test_a_broken_file_is_reported_not_reset(self):
        target = scenes.path_of(self.profile)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text("{not json", encoding="utf-8")
        with self.assertRaises(Exception) as caught:
            scenes.load(self.profile)
        self.assertEqual(getattr(caught.exception, "code", None), "infra_error")
        # The file is still there, untouched: its scenes were somebody's work.
        self.assertTrue(target.exists())
        self.assertEqual(target.read_text(encoding="utf-8"), "{not json")

    def test_the_file_is_not_world_readable(self):
        scenes.save_scene(self.profile, "order to cash", ["sales_order"])
        target = scenes.path_of(self.profile)
        if os.name == "nt":  # pragma: no cover - Windows has no POSIX mode bits
            self.skipTest("no POSIX modes on Windows")
        self.assertEqual(target.stat().st_mode & 0o077, 0)


class SavingScenes(unittest.TestCase):
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

    def test_a_new_scene_is_created(self):
        result = scenes.save_scene(self.profile, "order to cash", ["t_order", "t_trans"])
        self.assertTrue(result["created"])
        self.assertEqual(result["scene"]["name"], "order to cash")
        self.assertEqual(result["scene"]["tables"], ["t_order", "t_trans"])
        self.assertTrue(result["scene"]["id"].startswith("s_"))

    def test_saving_the_same_name_updates_instead_of_duplicating(self):
        first = scenes.save_scene(self.profile, "order to cash", ["t_order"])
        second = scenes.save_scene(self.profile, "order to cash", ["t_order", "t_trans"])
        self.assertFalse(second["created"])
        self.assertEqual(first["scene"]["id"], second["scene"]["id"])
        self.assertEqual(len(scenes.load(self.profile)["scenes"]), 1)
        self.assertEqual(second["scene"]["tables"], ["t_order", "t_trans"])

    def test_the_name_is_matched_without_case(self):
        first = scenes.save_scene(self.profile, "Order To Cash", ["t_order"])
        second = scenes.save_scene(self.profile, "order to cash", ["t_order", "t_trans"])
        self.assertFalse(second["created"])
        self.assertEqual(first["scene"]["id"], second["scene"]["id"])
        self.assertEqual(second["scene"]["name"], "order to cash")

    def test_the_id_lets_a_scene_be_renamed(self):
        first = scenes.save_scene(self.profile, "order to cash", ["t_order"])
        renamed = scenes.save_scene(
            self.profile, "revenue", ["t_order"], scene_id=first["scene"]["id"]
        )
        self.assertFalse(renamed["created"])
        self.assertEqual(renamed["scene"]["name"], "revenue")
        self.assertEqual(len(scenes.load(self.profile)["scenes"]), 1)

    def test_duplicate_tables_collapse_ignoring_case(self):
        result = scenes.save_scene(
            self.profile, "order to cash", ["t_order", "T_ORDER", " t_order ", "t_trans"]
        )
        self.assertEqual(result["scene"]["tables"], ["t_order", "t_trans"])

    def test_a_comma_separated_string_is_accepted(self):
        result = scenes.save_scene(self.profile, "order to cash", "t_order, t_trans\nt_payment")
        self.assertEqual(result["scene"]["tables"], ["t_order", "t_trans", "t_payment"])

    def test_a_scene_needs_a_name(self):
        with self.assertRaises(Exception) as caught:
            scenes.save_scene(self.profile, "  ", ["t_order"])
        self.assertEqual(getattr(caught.exception, "code", None), "user_error")

    def test_a_scene_needs_at_least_one_table(self):
        with self.assertRaises(Exception) as caught:
            scenes.save_scene(self.profile, "empty", [])
        self.assertEqual(getattr(caught.exception, "code", None), "user_error")

    def test_blank_entries_are_ignored(self):
        result = scenes.save_scene(self.profile, "order to cash", ["t_order", "", "  ", None])
        self.assertEqual(result["scene"]["tables"], ["t_order"])

    def test_the_note_is_kept(self):
        result = scenes.save_scene(self.profile, "order to cash", ["t_order"], note="the ten tables a question spans")
        self.assertEqual(result["scene"]["note"], "the ten tables a question spans")

    def test_saving_without_a_note_keeps_the_old_one(self):
        scenes.save_scene(self.profile, "order to cash", ["t_order"], note="first")
        again = scenes.save_scene(self.profile, "order to cash", ["t_order", "t_trans"])
        self.assertEqual(again["scene"]["note"], "first")


class StageLayout(unittest.TestCase):
    """A scene can describe the stages a walk is read in business order."""

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

    def test_stages_are_saved_with_the_scene(self):
        stages = [
            {"name": "Order", "table": "t_order", "locate": "edge",
             "displayColumns": ["order_no", "amount"], "statusColumn": "state",
             "statusLabels": {"paid": "Paid"}, "amountColumn": "amount", "timeColumn": "created_at"},
            {"name": "Payment", "table": "t_trans", "locate": "alias"},
        ]
        result = scenes.save_scene(
            self.profile, "cash", ["t_order", "t_trans"], stages=stages,
            aliases={"serial": [{"table": "t_trans", "column": "order_no"}]},
            input_alias="serial",
        )
        saved = result["scene"]["stages"]
        self.assertEqual([s["name"] for s in saved], ["Order", "Payment"])
        self.assertEqual(saved[0]["statusLabels"], {"paid": "Paid"})
        self.assertEqual(saved[0]["locate"], "edge")

    def test_a_stage_table_must_belong_to_the_scene(self):
        with self.assertRaises(Exception) as caught:
            scenes.save_scene(
                self.profile, "cash", ["t_order"],
                stages=[{"name": "Ghost", "table": "t_trans", "locate": "edge"}],
            )
        self.assertEqual(getattr(caught.exception, "code", None), "user_error")

    def test_display_columns_are_capped_at_four(self):
        with self.assertRaises(Exception) as caught:
            scenes.save_scene(
                self.profile, "cash", ["t_order"],
                stages=[{"name": "Order", "table": "t_order", "locate": "edge",
                         "displayColumns": ["a", "b", "c", "d", "e"]}],
            )
        self.assertEqual(getattr(caught.exception, "code", None), "user_error")

    def test_unknown_locate_kind_is_rejected(self):
        with self.assertRaises(Exception) as caught:
            scenes.save_scene(
                self.profile, "cash", ["t_order"],
                stages=[{"name": "Order", "table": "t_order", "locate": "magic"}],
            )
        self.assertEqual(getattr(caught.exception, "code", None), "user_error")

    def test_saving_without_stages_leaves_them_alone(self):
        scenes.save_scene(
            self.profile, "cash", ["t_order", "t_trans"],
            stages=[{"name": "Order", "table": "t_order", "locate": "edge"}],
        )
        again = scenes.save_scene(self.profile, "cash", ["t_order", "t_trans"])
        self.assertEqual(len(again["scene"]["stages"]), 1)

    def test_an_empty_input_alias_clears_it_instead_of_meaning_leave_alone(self):
        """The panel posts '' when its key is removed; that must clear, not keep.

        Guarding the column removal is the reason: leaving the old inputAlias
        behind made the next save fail with "inputAlias ... is not one of the
        scene's aliases" because the key it named had already gone.
        """
        scenes.save_scene(
            self.profile, "cash", ["t_order", "t_trans"],
            stages=[{"name": "Payment", "table": "t_trans", "locate": "alias"}],
            aliases={"serial": [{"table": "t_trans", "column": "order_no"}]},
            input_alias="serial",
        )
        dropped = scenes.save_scene(
            self.profile, "cash", ["t_order", "t_trans"],
            stages=[{"name": "Payment", "table": "t_trans", "locate": "edge"}],
            aliases={},
            input_alias="",
        )
        self.assertNotIn("inputAlias", dropped["scene"])
        self.assertNotIn("aliases", dropped["scene"])

    def test_leaving_input_alias_out_keeps_the_old_one(self):
        scenes.save_scene(
            self.profile, "cash", ["t_order", "t_trans"],
            aliases={"serial": [{"table": "t_trans", "column": "order_no"}]},
            input_alias="serial",
        )
        again = scenes.save_scene(self.profile, "cash", ["t_order", "t_trans"])
        self.assertEqual(again["scene"]["inputAlias"], "serial")

    def test_an_empty_stage_list_clears_them(self):
        scenes.save_scene(
            self.profile, "cash", ["t_order"],
            stages=[{"name": "Order", "table": "t_order", "locate": "edge"}],
        )
        cleared = scenes.save_scene(self.profile, "cash", ["t_order"], stages=[])
        self.assertEqual(cleared["scene"].get("stages", []), [])

    def test_listed_scenes_carry_stages(self):
        scenes.save_scene(
            self.profile, "cash", ["t_order"],
            stages=[{"name": "Order", "table": "t_order", "locate": "edge"}],
        )
        listed = scenes.list_scenes(self.profile)["scenes"][0]
        self.assertEqual(listed["stages"][0]["name"], "Order")


class ReadingScenes(unittest.TestCase):
    def setUp(self):
        self.saved = os.environ.get("DB_MCP_RUNTIME")
        self.tmp = tempfile.TemporaryDirectory()
        os.environ["DB_MCP_RUNTIME"] = self.tmp.name
        self.profile = source()
        scenes.save_scene(self.profile, "order to cash", ["t_order", "t_trans"], note="six tables")
        scenes.save_scene(self.profile, "stock", ["t_stock"])

    def tearDown(self):
        if self.saved is None:
            os.environ.pop("DB_MCP_RUNTIME", None)
        else:
            os.environ["DB_MCP_RUNTIME"] = self.saved
        self.tmp.cleanup()

    def test_listing_reports_a_table_count(self):
        result = scenes.list_scenes(self.profile)
        self.assertEqual(result["total"], 2)
        names = [scene["name"] for scene in result["scenes"]]
        self.assertEqual(names, ["order to cash", "stock"])
        self.assertEqual(result["scenes"][0]["tableCount"], 2)

    def test_find_by_name_and_by_id(self):
        doc = scenes.load(self.profile)
        by_name = scenes.find(doc, "order to cash")
        by_id = scenes.find(doc, by_name["id"])
        self.assertEqual(by_name["id"], by_id["id"])

    def test_find_is_case_insensitive(self):
        doc = scenes.load(self.profile)
        self.assertEqual(scenes.find(doc, "ORDER TO CASH")["name"], "order to cash")

    def test_an_unknown_scene_names_the_ones_that_exist(self):
        with self.assertRaises(Exception) as caught:
            scenes.find(scenes.load(self.profile), "nope")
        self.assertEqual(getattr(caught.exception, "code", None), "user_error")
        self.assertIn("order to cash", str(caught.exception.hint))

    def test_resolve_without_a_target_is_none(self):
        self.assertIsNone(scenes.resolve(self.profile, None))
        self.assertIsNone(scenes.resolve(self.profile, "   "))

    def test_table_set_is_folded(self):
        scene = scenes.find(scenes.load(self.profile), "order to cash")
        self.assertEqual(scenes.table_set(scene), {"t_order", "t_trans"})

    def test_no_scene_means_the_whole_graph(self):
        self.assertIsNone(scenes.table_set(None))


class DeletingScenes(unittest.TestCase):
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

    def test_delete_removes_only_that_scene(self):
        kept = scenes.save_scene(self.profile, "order to cash", ["t_order"])
        gone = scenes.save_scene(self.profile, "stock", ["t_stock"])
        result = scenes.delete_scene(self.profile, gone["scene"]["id"])
        self.assertEqual(result["deleted"], gone["scene"]["id"])
        remaining = scenes.list_scenes(self.profile)["scenes"]
        self.assertEqual([scene["id"] for scene in remaining], [kept["scene"]["id"]])

    def test_delete_never_touches_the_relation_graph(self):
        # The graph lives in a different file; the scene file simply has no say.
        before = scenes.path_of(self.profile)
        scenes.save_scene(self.profile, "order to cash", ["t_order"])
        scenes.delete_scene(self.profile, scenes.list_scenes(self.profile)["scenes"][0]["id"])
        self.assertFalse((before.parent.parent / "relations").exists())

    def test_deleting_a_scene_that_is_not_there_is_a_user_error(self):
        with self.assertRaises(Exception) as caught:
            scenes.delete_scene(self.profile, "s_nope")
        self.assertEqual(getattr(caught.exception, "code", None), "user_error")


class SceneLinks(unittest.TestCase):
    """What a listing says about how a scene's own tables connect.

    A scene is a table list, so on its own it cannot answer "how do these tables
    join". The listing projects the relation graph onto the scene instead: the
    confirmed joins among members, and the members no such join reaches. Neither is
    stored with the scene, so this class also checks the projection is derived.
    """

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

    def _confirm(self, frm, frm_column, to, to_column):
        """One confirmed join, the way the Relations page leaves it."""
        import relations

        proposed = relations.propose(self.profile, frm, frm_column, to, to_column)
        relations.feedback(self.profile, proposed["edge"]["id"], "ok")

    def test_the_link_statuses_match_what_the_walker_follows(self):
        """A scene advertises exactly the edges a trace would follow. If the two
        lists drift, a panel could show a join as usable that the walker refuses
        (or hide one it does follow), so the duplication is guarded here."""
        import tracing

        self.assertEqual(tuple(scenes.LINK_STATUSES), tuple(tracing.WALK_STATUSES))

    def test_a_confirmed_join_between_members_is_reported(self):
        self._confirm("t_order", "id", "t_trans", "order_id")
        scenes.save_scene(self.profile, "order to cash", ["t_order", "t_trans"])
        scene = scenes.list_scenes(self.profile)["scenes"][0]
        self.assertEqual(len(scene["edges"]), 1)
        edge = scene["edges"][0]
        self.assertEqual(edge["from"], {"table": "t_order", "column": "id"})
        self.assertEqual(edge["to"], {"table": "t_trans", "column": "order_id"})
        self.assertIn(edge["status"], ("confirmed", "trusted"))

    def test_a_join_leaving_the_scene_is_not_reported(self):
        self._confirm("t_order", "id", "t_trans", "order_id")
        scenes.save_scene(self.profile, "orders only", ["t_order"])
        scene = scenes.list_scenes(self.profile)["scenes"][0]
        self.assertEqual(scene["edges"], [])

    def test_a_pending_join_is_not_reported_and_leaves_both_ends_isolated(self):
        import relations

        relations.propose(self.profile, "t_order", "id", "t_trans", "order_id")
        scenes.save_scene(self.profile, "order to cash", ["t_order", "t_trans"])
        scene = scenes.list_scenes(self.profile)["scenes"][0]
        self.assertEqual(scene["edges"], [])
        self.assertEqual(sorted(scene["isolated"]), ["t_order", "t_trans"])

    def test_isolated_names_only_the_unconnected_members(self):
        self._confirm("t_order", "id", "t_trans", "order_id")
        scenes.save_scene(
            self.profile,
            "order to cash",
            ["t_order", "t_trans", "t_stock"],
        )
        scene = scenes.list_scenes(self.profile)["scenes"][0]
        self.assertEqual(scene["isolated"], ["t_stock"])

    def test_a_member_that_only_joins_outwards_is_still_isolated(self):
        # The one confirmed join points at a table outside the scene, so it says
        # nothing about how the members relate.
        self._confirm("t_order", "id", "t_customer", "id")
        scenes.save_scene(self.profile, "orders and stock", ["t_order", "t_stock"])
        scene = scenes.list_scenes(self.profile)["scenes"][0]
        self.assertEqual(scene["edges"], [])
        self.assertEqual(scene["isolated"], ["t_order", "t_stock"])

    def test_table_names_match_without_case(self):
        self._confirm("T_ORDER", "ID", "T_TRANS", "ORDER_ID")
        scenes.save_scene(self.profile, "order to cash", ["t_order", "t_trans"])
        scene = scenes.list_scenes(self.profile)["scenes"][0]
        self.assertEqual(len(scene["edges"]), 1)
        self.assertEqual(scene["isolated"], [])

    def test_the_links_are_not_written_into_the_scene_file(self):
        self._confirm("t_order", "id", "t_trans", "order_id")
        scenes.save_scene(self.profile, "order to cash", ["t_order", "t_trans"])
        stored = json.loads(scenes.path_of(self.profile).read_text(encoding="utf-8"))
        self.assertNotIn("edges", stored["scenes"][0])
        self.assertNotIn("isolated", stored["scenes"][0])

    def test_deleting_the_scene_leaves_the_join_in_the_graph(self):
        import relations

        self._confirm("t_order", "id", "t_trans", "order_id")
        saved = scenes.save_scene(self.profile, "order to cash", ["t_order", "t_trans"])
        scenes.delete_scene(self.profile, saved["scene"]["id"])
        self.assertEqual(len(relations.load(self.profile)["edges"]), 1)

    def test_the_links_are_derived_not_stored(self):
        # Reading the listing twice from different graph states proves the fields
        # come from the graph rather than from anything written next to the scene.
        scenes.save_scene(self.profile, "order to cash", ["t_order", "t_trans"])
        before = scenes.list_scenes(self.profile)["scenes"][0]
        self._confirm("t_order", "id", "t_trans", "order_id")
        after = scenes.list_scenes(self.profile)["scenes"][0]
        self.assertEqual(before["edges"], [])
        self.assertEqual(len(after["edges"]), 1)


class IsolatedFixture(unittest.TestCase):
    """The committed fixture the panel's isolated-member UI is checked against.

    A browser pass cannot invent its own data, so the two cases the Scenes page has
    to tell apart live here as files: a member nothing confirmed joins at all, and a
    member whose confirmed joins all lead out of the scene. If the fixture stops
    expressing one of them, the screenshot pass would silently stop testing it.
    """

    def setUp(self):
        self.folder = PACKAGE / "dev" / "fixtures" / "scenes-isolated"
        self.scenes = json.loads((self.folder / "scenes.json").read_text(encoding="utf-8"))
        self.relations = json.loads((self.folder / "relations.json").read_text(encoding="utf-8"))
        self.columns = json.loads((self.folder / "columns.json").read_text(encoding="utf-8"))

    def test_the_fixture_has_a_scene_with_two_stranded_members(self):
        scene = self.scenes["scenes"][0]
        self.assertGreaterEqual(len(scene["isolated"]), 2)

    def test_one_stranded_member_has_no_confirmed_join_at_all(self):
        scene = self.scenes["scenes"][0]
        members = {name.casefold() for name in scene["tables"]}
        joined = set()
        for edge in self.relations["edges"]:
            if edge["status"] not in scenes.LINK_STATUSES:
                continue
            joined.add(edge["from"]["table"].casefold())
            joined.add(edge["to"]["table"].casefold())
        lonely = [name for name in scene["isolated"] if name.casefold() not in joined]
        self.assertTrue(lonely, "the fixture needs a member with no confirmed join at all")

    def test_one_stranded_member_only_joins_out_of_the_scene(self):
        scene = self.scenes["scenes"][0]
        members = {name.casefold() for name in scene["tables"]}
        outward = []
        for name in scene["isolated"]:
            folded = name.casefold()
            for edge in self.relations["edges"]:
                if edge["status"] not in scenes.LINK_STATUSES:
                    continue
                ends = {edge["from"]["table"].casefold(), edge["to"]["table"].casefold()}
                if folded in ends and len(ends - members) == 1:
                    outward.append(name)
                    break
        self.assertTrue(outward, "the fixture needs a member whose joins all leave the scene")

    def test_the_stranded_members_share_a_column_name_with_a_member(self):
        # The candidate columns are the only way to add a join from the panel, so
        # at least one stranded member must have something to offer.
        scene = self.scenes["scenes"][0]
        members = [name for name in scene["tables"] if name in self.columns]
        self.assertGreaterEqual(len(members), 2)
        for name in scene["isolated"]:
            if name not in self.columns:
                continue
            mine = {column["name"].casefold() for column in self.columns[name]}
            for other in members:
                if other == name:
                    continue
                shared = mine & {column["name"].casefold() for column in self.columns[other]}
                if shared:
                    return
        self.fail("no isolated member shares a column name with another member")


class Limits(unittest.TestCase):
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

    def test_too_many_scenes_is_refused(self):
        for index in range(scenes.SCENE_LIMIT):
            scenes.save_scene(self.profile, f"scene {index}", [f"t_{index}"])
        with self.assertRaises(Exception) as caught:
            scenes.save_scene(self.profile, "one more", ["t_extra"])
        self.assertEqual(getattr(caught.exception, "code", None), "user_error")

    def test_a_scene_too_wide_is_refused(self):
        with self.assertRaises(Exception) as caught:
            scenes.save_scene(self.profile, "everything", [f"t_{index}" for index in range(scenes.TABLE_LIMIT + 1)])
        self.assertEqual(getattr(caught.exception, "code", None), "user_error")


if __name__ == "__main__":
    sys.exit(unittest.main(verbosity=2))
