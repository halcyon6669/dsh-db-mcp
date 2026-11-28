"""Regression tests for the catalog cache layout in `server/store.py`.

The cache exists so a bundle preview can answer "is this table still there, with
this column, of this type" without opening a database. Two properties matter and
neither is visible from the outside:

* every table carries the moment *it* was read, so one narrow listing cannot make
  a table that was read last week look fresh;
* the file is keyed by datasource **and** schema, because the same table name in
  two schemas is two different tables — while a cache written before schemas were
  part of the key must still load.

Run through `dev/engines.test.mjs` (`npm test`).
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

PACKAGE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PACKAGE / "server"))

import store  # noqa: E402  (path set above)


def source(identity: str = "shop", **extra) -> dict:
    profile = {"id": identity, "name": identity, "kind": "sqlite", "config": {}, "readOnly": True}
    profile.update(extra)
    return profile


class CatalogTimestamps(unittest.TestCase):
    """Per-table read times, and the file stamp as the fallback for old caches."""

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

    def test_a_table_carries_the_moment_it_was_read(self):
        doc = store.save_catalog(
            self.profile,
            {"tables": {"t_order": {"columns": {"id": "integer"}}}},
            read=[("t_order", {"id": "integer"})],
        )
        entry = doc["tables"]["t_order"]
        self.assertTrue(entry.get("readAt"), "a table that was just read carries its own stamp")
        self.assertTrue(doc.get("savedAt"), "the file still carries a write stamp")

    def test_a_second_partial_read_leaves_the_first_table_stamp_alone(self):
        first = store.save_catalog(
            self.profile,
            {"tables": {"t_order": {"columns": {"id": "integer"}}}},
            read=[("t_order", {"id": "integer"})],
        )
        before = first["tables"]["t_order"]["readAt"]
        # A listing that only saw another table must not restamp the first one.
        second = store.save_catalog(
            self.profile,
            {
                "tables": {
                    "t_order": {"columns": {"id": "integer"}, "readAt": before},
                    "t_line": {"columns": {"sku": "text"}},
                }
            },
            read=[("t_line", {"sku": "text"})],
        )
        self.assertEqual(second["tables"]["t_order"]["readAt"], before)
        self.assertTrue(second["tables"]["t_line"].get("readAt"))
        # The file stamp follows this write, and the table read now carries it.
        # Two writes inside the same millisecond legitimately share a stamp, so
        # the assertion is on which stamp the new table got, not on inequality.
        self.assertEqual(second["tables"]["t_line"]["readAt"], second["savedAt"])
        self.assertEqual(first["tables"]["t_order"]["readAt"], before)

    def test_a_cache_written_before_per_table_times_falls_back_to_the_file_stamp(self):
        stamp = "2026-01-02T03:04:05.678Z"
        path = store.catalog_path(self.profile)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps({"savedAt": stamp, "tables": {"t_order": {"columns": {"id": "integer"}}}}),
            encoding="utf-8",
        )
        loaded = store.load_catalog(self.profile)
        self.assertIsNotNone(loaded)
        self.assertEqual(store.table_stamp(loaded, "t_order"), stamp)
        self.assertEqual(store.table_stamp(loaded, "unknown_table"), stamp)

    def test_a_table_stamp_wins_over_the_file_stamp(self):
        doc = {
            "savedAt": "2026-01-10T00:00:00.000Z",
            "tables": {"t_order": {"columns": {}, "readAt": "2026-01-01T00:00:00.000Z"}},
        }
        self.assertEqual(store.table_stamp(doc, "T_ORDER"), "2026-01-01T00:00:00.000Z")


class CatalogBySchema(unittest.TestCase):
    """The key is datasource + schema; the old key must keep loading."""

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

    def test_two_schemas_are_two_files(self):
        public = store.save_catalog(self.profile, {"tables": {"t_order": {"columns": {}}}}, schema="public")
        sales = store.save_catalog(self.profile, {"tables": {"t_order": {"columns": {}}}}, schema="sales")
        self.assertNotEqual(store.catalog_path(self.profile, "public"), store.catalog_path(self.profile, "sales"))
        self.assertEqual(store.load_catalog(self.profile, "public")["schema"], "public")
        self.assertEqual(store.load_catalog(self.profile, "sales")["schema"], "sales")
        self.assertTrue(public["savedAt"])
        self.assertTrue(sales["savedAt"])

    def test_a_cache_written_before_schemas_were_asked_for_still_loads(self):
        # The file a 1.1.0 install already has: no schema in the name, no schema key.
        path = store.catalog_path(self.profile)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps({"savedAt": "2026-01-01T00:00:00.000Z", "tables": {"t_order": {"columns": {}}}}),
            encoding="utf-8",
        )
        loaded = store.load_catalog(self.profile)
        self.assertIsNotNone(loaded, "an old cache must not disappear because a schema is now known")
        self.assertIsNone(loaded.get("schema"))

    def test_a_schema_lookup_falls_back_to_the_schema_free_cache(self):
        store.save_catalog(self.profile, {"tables": {"t_order": {"columns": {"id": "integer"}}}})
        # Asking for a named schema: the plain file is the only thing on disk, and
        # it is still the best local answer rather than "never checked".
        self.assertIsNotNone(store.load_catalog(self.profile, "public"))

    def test_the_configured_schema_names_the_file(self):
        configured = source(config={"schema": "sales"})
        self.assertEqual(store.catalog_schema(configured), "sales")
        self.assertIsNone(store.catalog_schema(source()))

    def test_every_cached_schema_for_one_datasource_can_be_listed(self):
        store.save_catalog(self.profile, {"tables": {"t_order": {"columns": {}}}}, schema="public")
        store.save_catalog(self.profile, {"tables": {"t_order": {"columns": {}}}}, schema="sales")
        store.save_catalog(self.profile, {"tables": {"t_order": {"columns": {}}}})
        found = store.catalog_schemas(self.profile)
        self.assertIn("public", found)
        self.assertIn("sales", found)
        self.assertIn(None, found)


if __name__ == "__main__":
    sys.exit(unittest.main(verbosity=2))
