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

Run through `dev/engines.test.mjs` (`npm test`).
"""

from __future__ import annotations

import importlib.util
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


if __name__ == "__main__":
    sys.exit(unittest.main(verbosity=2))
