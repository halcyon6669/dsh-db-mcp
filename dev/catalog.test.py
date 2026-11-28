"""Regression tests for the catalog refresh in `server/bundle_cli.py`.

A refresh used to describe "the first 500 tables" — a number that says nothing
about what the caller cares about, and that quietly hides the rest. It now reads
exactly the tables the bundle mentions (edge endpoints and scene members), tries
the case variants a real engine may insist on, and reports three separate
outcomes instead of one:

* ``checked``    — described, so the preview may trust the cache for it;
* ``missing``    — every case variant was asked for and none existed;
* ``notChecked`` — timed out, over a limit, or failed. Never "missing": the
  difference decides whether a join is called absent or merely unknown.

A refresh also carries a limit of its own — five seconds for one table, sixty for
the whole run — because a single slow table used to hold the connection until the
statement timeout at thirty seconds, and a graph with hundreds of tables could
run for minutes. The numbers live in ``settings.json`` so the panel can change
them without restarting the MCP process.

The run reports how long the reads took (p50 / p95 / max in milliseconds), so the
first refresh against a real database says what that database costs instead of
leaving the reader to guess from a total.

Run through `dev/engines.test.mjs` (`npm test`).
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


store = _load("store")
engines = _load("engines")
relations = _load("relations")
scenes = _load("scenes")
bundle_cli = _load("bundle_cli")


class FakeEngine:
    """A catalogue that answers from a dict, with per-table behaviour hooks."""

    # The code under test asks the engine module itself for its error type, so the
    # fake carries the real one rather than a lookalike.
    DbError = engines.DbError
    column_family = staticmethod(engines.column_family)

    def __init__(self, tables: dict[str, dict] | None = None, casefold: bool = True):
        self.tables = tables or {}
        self.casefold = casefold
        self.asked: list[str] = []
        self.schemas: list[str | None] = []
        self.failing: dict[str, Exception] = {}
        self.connect_error: Exception | None = None

    def connect(self, profile, password):  # noqa: ARG002 - signature parity
        if self.connect_error is not None:
            raise self.connect_error
        return object(), lambda: None

    def describe_table(self, profile, connection, table, schema=None):  # noqa: ARG002
        self.asked.append(table)
        self.schemas.append(schema)
        wanted = table.casefold() if self.casefold else table
        for key, error in self.failing.items():
            if key.casefold() == table.casefold():
                raise error
        for name, columns in self.tables.items():
            looked = name.casefold() if self.casefold else name
            if looked == wanted:
                return {
                    "ok": True,
                    "table": name,
                    "columns": [{"name": key, "type": value} for key, value in columns.items()],
                }
        raise engines.DbError(
            "user_error",
            f"table not found: {table}",
            "call list_tables to see the available tables",
        )


def _profile(identity: str = "shop", **config) -> dict:
    return {
        "id": identity,
        "name": identity,
        "kind": "sqlite",
        "config": dict(config),
        "readOnly": True,
    }


def _bundle(*pairs: tuple[str, str]) -> dict:
    """A bundle whose edges mention the given ``table.column`` endpoints."""
    edges = []
    for index in range(0, len(pairs), 2):
        left = pairs[index]
        right = pairs[index + 1]
        edges.append(
            {
                "from": {"table": left[0], "column": left[1]},
                "to": {"table": right[0], "column": right[1]},
                "status": "pending",
            }
        )
    return {"schemaVersion": 1, "kind": "db-mcp-bundle", "edges": edges, "scenes": []}


def _status_bundle(*edges: tuple[str, str, str, str, str], scenes: list | None = None) -> dict:
    """A bundle whose edges carry a status: ``(from_table, from_col, to_table, to_col, status)``."""
    items = []
    for frm_table, frm_column, to_table, to_column, status in edges:
        items.append(
            {
                "from": {"table": frm_table, "column": frm_column},
                "to": {"table": to_table, "column": to_column},
                "status": status,
            }
        )
    return {"schemaVersion": 1, "kind": "db-mcp-bundle", "edges": items, "scenes": list(scenes or [])}


class RefreshScope(unittest.TestCase):
    """Which tables a refresh reads, and what it reports about the rest."""

    def setUp(self):
        self.saved = os.environ.get("DB_MCP_RUNTIME")
        self.tmp = tempfile.TemporaryDirectory()
        os.environ["DB_MCP_RUNTIME"] = self.tmp.name
        self.profile = _profile()
        self.engine = FakeEngine(
            {
                "t_order": {"id": "integer", "code": "text"},
                "t_line": {"order_id": "integer", "sku": "text"},
                "t_payment": {"id": "integer", "order_id": "integer"},
                "t_unrelated": {"id": "integer"},
            }
        )
        self.saved_engines = bundle_cli.engines
        bundle_cli.engines = self.engine

    def tearDown(self):
        bundle_cli.engines = self.saved_engines
        if self.saved is None:
            os.environ.pop("DB_MCP_RUNTIME", None)
        else:
            os.environ["DB_MCP_RUNTIME"] = self.saved
        self.tmp.cleanup()

    def test_only_the_tables_the_bundle_mentions_are_read(self):
        result = bundle_cli.refresh(
            self.profile,
            payload=_bundle(("t_order", "id"), ("t_line", "order_id")),
        )
        self.assertEqual(sorted(self.engine.asked), ["t_line", "t_order"])
        self.assertNotIn("t_unrelated", self.engine.asked)
        self.assertEqual(sorted(result["checked"]), ["t_line", "t_order"])
        self.assertNotIn("t_unrelated", (store.load_catalog(self.profile) or {}).get("tables", {}))

    def test_a_scene_endpoint_is_read_even_when_no_edge_names_it(self):
        payload = _bundle(("t_order", "id"), ("t_line", "order_id"))
        payload["scenes"] = [{"name": "订单到收款", "tables": ["t_payment"]}]
        result = bundle_cli.refresh(self.profile, payload=payload)
        self.assertIn("t_payment", result["checked"])

    def test_a_table_that_does_not_exist_under_any_case_is_missing(self):
        result = bundle_cli.refresh(self.profile, payload=_bundle(("t_ghost", "id"), ("t_order", "id")))
        self.assertEqual(result["missing"], ["t_ghost"])
        self.assertEqual(result["notChecked"], [])

    def test_a_merely_unreadable_table_is_not_checked_rather_than_missing(self):
        self.engine.failing["t_line"] = engines.DbError(
            "db_error", "canceling statement due to statement timeout"
        )
        result = bundle_cli.refresh(self.profile, payload=_bundle(("t_order", "id"), ("t_line", "order_id")))
        self.assertEqual(result["missing"], [])
        self.assertEqual(result["notChecked"], ["t_line"])

    def test_the_case_variants_an_engine_insists_on_are_tried(self):
        engine = FakeEngine({"T_ORDER": {"ID": "integer"}}, casefold=True)
        bundle_cli.engines = engine
        result = bundle_cli.refresh(self.profile, payload=_bundle(("t_order", "id"), ("t_order", "id")))
        self.assertEqual(result["checked"], ["t_order"])
        self.assertEqual(result["missing"], [])
        self.assertEqual(engine.asked[0], "t_order")

    def test_a_table_over_the_old_five_hundred_limit_is_still_read(self):
        tables = {f"t_{index:04d}": {"id": "integer"} for index in range(520)}
        bundle_cli.engines = FakeEngine(tables)
        payload = _bundle(*[(name, "id") for name in sorted(tables)])
        result = bundle_cli.refresh(self.profile, payload=payload)
        self.assertEqual(len(result["checked"]), 520, "no arbitrary ceiling")
        self.assertEqual(result["missing"], [])

    def test_the_total_deadline_leaves_the_rest_unchecked(self):
        # A clock that jumps past the budget after the first table. Tables are
        # read in the order the bundle mentions them (each edge's from side, then
        # its to side), so `t_order` is the one that fits inside the budget.
        ticks = iter([0, 1, 10_000, 10_000, 10_000, 10_000])
        bundle_cli.engines = self.engine
        result = bundle_cli.refresh(
            self.profile,
            payload=_bundle(("t_order", "id"), ("t_line", "order_id"), ("t_payment", "id"), ("t_order", "code")),
            timeout_ms=5_000,
            clock=lambda: next(ticks),
        )
        self.assertEqual(result["checked"], ["t_order"])
        self.assertEqual(sorted(result["notChecked"]), ["t_line", "t_payment"])
        self.assertEqual(result["missing"], [])

    def test_every_outcome_is_reported_with_the_read_time(self):
        self.engine.failing["t_line"] = RuntimeError("driver went away")
        result = bundle_cli.refresh(self.profile, payload=_bundle(("t_order", "id"), ("t_line", "order_id")))
        for key in ("checked", "missing", "notChecked", "savedAt"):
            self.assertIn(key, result)
        self.assertTrue(result["savedAt"])
        self.assertEqual(result["checked"], ["t_order"])
        self.assertEqual(result["notChecked"], ["t_line"])

    def test_a_failed_connection_is_an_error_not_an_empty_catalog(self):
        self.engine.connect_error = engines.DbError("db_error", "could not connect to server")
        with self.assertRaises(engines.DbError):
            bundle_cli.refresh(self.profile, payload=_bundle(("t_order", "id"), ("t_order", "id")))
        self.assertIsNone(store.load_catalog(self.profile), "a failed refresh writes nothing")

    def test_a_refresh_keeps_tables_it_did_not_read_this_time(self):
        store.save_catalog(
            self.profile,
            {"tables": {"t_payment": {"columns": {"id": "integer"}, "readAt": "2026-01-01T00:00:00.000Z"}}},
        )
        bundle_cli.refresh(self.profile, payload=_bundle(("t_order", "id"), ("t_order", "id")))
        cached = store.load_catalog(self.profile)
        self.assertIn("t_payment", cached["tables"], "a partial refresh never erases another table")
        self.assertEqual(cached["tables"]["t_payment"]["readAt"], "2026-01-01T00:00:00.000Z")

    def test_the_schema_asked_for_is_the_one_cached(self):
        bundle_cli.refresh(self.profile, payload=_bundle(("t_order", "id"), ("t_order", "id")), schema="sales")
        self.assertEqual(self.engine.schemas[0], "sales")
        cached = store.load_catalog(self.profile, "sales")
        self.assertIsNotNone(cached, "the cache is keyed by datasource + schema")
        self.assertIsNone(store.load_catalog(self.profile), "no schema-free file is written")


class RefreshOrder(unittest.TestCase):
    """A budget is spent on what matters, not on whatever came first in the JSON.

    A bundle lists edges in the order the sender's file happened to hold them, and
    a pending edge is the one whose tables are least likely to be in the cache. So
    the read order is by weight: endpoints of a confirmed/trusted edge, then scene
    members, then endpoints of a pending edge.
    """

    def setUp(self):
        self.saved = os.environ.get("DB_MCP_RUNTIME")
        self.tmp = tempfile.TemporaryDirectory()
        os.environ["DB_MCP_RUNTIME"] = self.tmp.name
        self.profile = _profile()
        self.engine = FakeEngine(
            {
                "t_confirmed": {"id": "integer"},
                "t_scene": {"id": "integer"},
                "t_pending": {"id": "integer"},
                "t_trusted": {"id": "integer"},
            }
        )
        self.saved_engines = bundle_cli.engines
        bundle_cli.engines = self.engine

    def tearDown(self):
        bundle_cli.engines = self.saved_engines
        if self.saved is None:
            os.environ.pop("DB_MCP_RUNTIME", None)
        else:
            os.environ["DB_MCP_RUNTIME"] = self.saved
        self.tmp.cleanup()

    def _payload(self) -> dict:
        # Deliberately listed backwards: the pending edge first, the trusted one
        # last, so a reader that just follows the JSON order fails this test.
        return _status_bundle(
            ("t_pending", "id", "t_pending", "id", "pending"),
            ("t_scene", "id", "t_scene", "id", "pending"),
            ("t_confirmed", "id", "t_confirmed", "id", "confirmed"),
            ("t_trusted", "id", "t_trusted", "id", "trusted"),
            scenes=[{"name": "订单到收款", "tables": ["t_scene"]}],
        )

    def test_a_trusted_endpoint_is_read_before_a_pending_one(self):
        bundle_cli.refresh(self.profile, payload=self._payload())
        asked = [name.casefold() for name in self.engine.asked]
        self.assertLess(asked.index("t_confirmed"), asked.index("t_pending"))
        self.assertLess(asked.index("t_trusted"), asked.index("t_pending"))

    def test_a_scene_member_sits_between_a_confirmation_and_a_pending_edge(self):
        bundle_cli.refresh(self.profile, payload=self._payload())
        asked = [name.casefold() for name in self.engine.asked]
        self.assertLess(asked.index("t_confirmed"), asked.index("t_scene"))
        self.assertLess(asked.index("t_scene"), asked.index("t_pending"))

    def test_each_table_is_asked_for_once_however_many_edges_named_it(self):
        payload = _status_bundle(
            ("t_confirmed", "id", "t_pending", "id", "confirmed"),
            ("t_confirmed", "code", "t_trusted", "id", "trusted"),
        )
        bundle_cli.refresh(self.profile, payload=payload)
        asked = [name.casefold() for name in self.engine.asked]
        self.assertEqual(asked.count("t_confirmed"), 1, asked)

    def test_the_budget_gives_up_on_the_last_batch_not_a_mixed_one(self):
        # Two tables fit inside the budget, two are left over. The leftovers must
        # be exactly the pending endpoints — never a confirmed one. The pending
        # edges are listed FIRST, so a refresh that follows the JSON order fails.
        ticks = iter([0, 1, 1, 10_000, 10_000, 10_000, 10_000])
        payload = _status_bundle(
            ("t_pending", "id", "t_pending", "id", "pending"),
            ("t_scene", "id", "t_scene", "id", "pending"),
            ("t_confirmed", "id", "t_confirmed", "id", "confirmed"),
            ("t_trusted", "id", "t_trusted", "id", "trusted"),
            scenes=[{"name": "订单到收款", "tables": ["t_scene"]}],
        )
        result = bundle_cli.refresh(self.profile, payload=payload, timeout_ms=5_000, clock=lambda: next(ticks))
        self.assertEqual(result["checked"], ["t_confirmed", "t_trusted"], result)
        self.assertEqual(sorted(name.casefold() for name in result["notChecked"]), ["t_pending", "t_scene"])


class RefreshLimits(unittest.TestCase):
    """A refresh stops itself before the engine's or the reader's patience runs out.

    The numbers live in `settings.json` under `catalog`, so the panel can change
    them and the next refresh obeys without the MCP process being restarted.
    """

    def setUp(self):
        self.saved = os.environ.get("DB_MCP_RUNTIME")
        self.tmp = tempfile.TemporaryDirectory()
        os.environ["DB_MCP_RUNTIME"] = self.tmp.name
        self.profile = _profile()
        self.engine = FakeEngine(
            {
                "t_order": {"id": "integer"},
                "t_line": {"order_id": "integer"},
                "t_payment": {"id": "integer"},
            }
        )
        self.saved_engines = bundle_cli.engines
        bundle_cli.engines = self.engine

    def tearDown(self):
        bundle_cli.engines = self.saved_engines
        if self.saved is None:
            os.environ.pop("DB_MCP_RUNTIME", None)
        else:
            os.environ["DB_MCP_RUNTIME"] = self.saved
        self.tmp.cleanup()

    def _settings(self, **catalog) -> None:
        path = Path(self.tmp.name) / "settings.json"
        path.write_text(json.dumps({"catalog": catalog}), encoding="utf-8")

    def _three_tables(self) -> dict:
        return _bundle(("t_order", "id"), ("t_line", "order_id"), ("t_payment", "id"), ("t_order", "id"))

    def test_the_defaults_are_five_seconds_for_a_table_and_sixty_for_the_run(self):
        self.assertEqual(store.catalog_limits(), {"perTableMs": 5000, "totalMs": 60000})

    def test_the_numbers_can_be_changed_in_the_settings_file(self):
        self._settings(perTableMs=1500, totalMs=9000)
        self.assertEqual(store.catalog_limits(), {"perTableMs": 1500, "totalMs": 9000})

    def test_a_value_out_of_range_falls_back_to_the_default_like_the_cost_settings(self):
        self._settings(perTableMs=1, totalMs="soon")
        self.assertEqual(store.catalog_limits(), {"perTableMs": 500, "totalMs": 60000}, "the floor, not a broken number")
        self._settings(perTableMs=10_000_000, totalMs=True)
        self.assertEqual(store.catalog_limits(), {"perTableMs": 60000, "totalMs": 60000}, "the ceiling, and True is not a number")

    def test_a_table_slower_than_the_limit_is_left_unchecked(self):
        self._settings(perTableMs=5000, totalMs=60000)
        # Each read asks the timer twice: before the describe and after it. The
        # first table takes six seconds, the others ten milliseconds each.
        ticks = iter([0, 6000, 6100, 6110, 6200, 6210])
        result = bundle_cli.refresh(self.profile, payload=self._three_tables(), timer=lambda: next(ticks))
        self.assertEqual(result["checked"], ["t_line", "t_payment"])
        self.assertEqual(sorted(result["notChecked"]), ["t_order"])
        self.assertEqual(result["missing"], [], "slow is unknown, not absent")

    def test_a_slow_table_does_not_stop_the_ones_after_it(self):
        self._settings(perTableMs=5000, totalMs=60000)
        ticks = iter([0, 6000, 6100, 6110, 6200, 6210])
        result = bundle_cli.refresh(self.profile, payload=self._three_tables(), timer=lambda: next(ticks))
        self.assertEqual(len(result["checked"]), 2)

    def test_the_sixty_second_budget_applies_without_being_asked_for(self):
        # The caller passes no timeout_ms, so the default 60 s must bite.
        ticks = iter([0, 70_000, 70_001, 70_002, 70_003])
        result = bundle_cli.refresh(self.profile, payload=self._three_tables(), clock=lambda: next(ticks))
        self.assertEqual(result["checked"], [])
        self.assertEqual(sorted(result["notChecked"]), ["t_line", "t_order", "t_payment"])

    def test_an_explicit_timeout_still_wins_over_the_setting(self):
        self._settings(perTableMs=5000, totalMs=60000)
        ticks = iter([0, 2_000, 2_001, 2_002, 2_003])
        result = bundle_cli.refresh(self.profile, payload=self._three_tables(), timeout_ms=1_000, clock=lambda: next(ticks))
        self.assertEqual(result["checked"], [])


class RefreshTiming(unittest.TestCase):
    """What the reads cost, in the unit a person reads: milliseconds."""

    def setUp(self):
        self.saved = os.environ.get("DB_MCP_RUNTIME")
        self.tmp = tempfile.TemporaryDirectory()
        os.environ["DB_MCP_RUNTIME"] = self.tmp.name
        self.profile = _profile()
        tables = {"t_order": {"id": "integer"}, "t_line": {"id": "integer"}, "t_payment": {"id": "integer"}, "t_note": {"id": "integer"}}
        self.engine = FakeEngine(tables)
        self.saved_engines = bundle_cli.engines
        bundle_cli.engines = self.engine

    def tearDown(self):
        bundle_cli.engines = self.saved_engines
        if self.saved is None:
            os.environ.pop("DB_MCP_RUNTIME", None)
        else:
            os.environ["DB_MCP_RUNTIME"] = self.saved
        self.tmp.cleanup()

    def test_the_run_reports_p50_p95_and_max(self):
        payload = _bundle(("t_order", "id"), ("t_line", "id"), ("t_payment", "id"), ("t_note", "id"))
        # Four reads: 4, 8, 15, 42 ms.
        ticks = iter([0, 4, 10, 18, 30, 45, 100, 142])
        result = bundle_cli.refresh(self.profile, payload=payload, timer=lambda: next(ticks))
        timing = result["timing"]
        self.assertEqual(timing["count"], 4)
        self.assertEqual(timing["max"], 42)
        self.assertEqual(timing["p50"], 8, "the lower median of an even count")
        self.assertEqual(timing["p95"], 42)

    def test_the_percentiles_are_whole_milliseconds(self):
        payload = _bundle(("t_order", "id"), ("t_line", "id"), ("t_payment", "id"), ("t_note", "id"))
        ticks = iter([0, 4, 10, 18, 30, 45, 100, 142])
        result = bundle_cli.refresh(self.profile, payload=payload, timer=lambda: next(ticks))
        for key in ("p50", "p95", "max", "mean"):
            self.assertIsInstance(result["timing"][key], int, key)

    def test_only_tables_that_were_actually_read_are_timed(self):
        self.engine.failing["t_line"] = RuntimeError("driver went away")
        payload = _bundle(("t_order", "id"), ("t_line", "id"), ("t_payment", "id"), ("t_note", "id"))
        ticks = iter([0, 4, 10, 12, 30, 35, 100, 142])
        result = bundle_cli.refresh(self.profile, payload=payload, timer=lambda: next(ticks))
        self.assertEqual(result["timing"]["count"], 3)
        self.assertEqual(result["timing"]["max"], 42, "4 + 5 + 42 for the three that answered")

    def test_a_run_with_nothing_to_read_reports_zeroes_rather_than_raising(self):
        result = bundle_cli.refresh(self.profile, payload={"schemaVersion": 1, "edges": [], "scenes": []})
        self.assertEqual(result["timing"], {"count": 0, "p50": 0, "p95": 0, "max": 0, "mean": 0})


if __name__ == "__main__":
    sys.exit(unittest.main(verbosity=2))
