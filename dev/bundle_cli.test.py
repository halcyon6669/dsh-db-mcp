"""Regression tests for `server/bundle_cli.py`, the stdin/stdout bridge the
panel Host uses to reach the pure bundle functions without adding MCP tools.

The CLI speaks one JSON object in, one JSON object out. It must never let a
StoreError escape as a traceback (the Host parses stdout), must resolve the
datasource by name, and must keep preview read-only while apply writes.
Run through `dev/engines.test.mjs` (`npm test`).
"""

from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

PACKAGE = Path(__file__).resolve().parent.parent
CLI = PACKAGE / "server" / "bundle_cli.py"
VENV = Path(os.environ.get("DB_MCP_RUNTIME") or Path.home() / ".dsh" / "db-mcp") / ".venv"


def _python() -> str:
    for candidate in (
        VENV / "Scripts" / "python.exe",
        VENV / "bin" / "python",
    ):
        if candidate.exists():
            return str(candidate)
    return sys.executable


def _invoke(command: dict, runtime: Path) -> dict:
    env = dict(os.environ)
    env["DB_MCP_RUNTIME"] = str(runtime)
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUTF8"] = "1"
    proc = subprocess.run(
        [_python(), str(CLI)],
        input=json.dumps(command, ensure_ascii=False),
        text=True,
        capture_output=True,
        env=env,
        cwd=str(PACKAGE / "server"),
        timeout=30,
    )
    lines = [line for line in proc.stdout.splitlines() if line.strip()]
    if not lines:
        return {"ok": False, "error": {"code": "no_output", "message": proc.stderr[-400:]}}
    return json.loads(lines[-1])


class BundleCli(unittest.TestCase):
    def setUp(self):
        self.saved = dict(os.environ)
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        # A registry with one default source, so store.resolve("trace-demo")
        # works inside the child process.
        registry = {
            "schemaVersion": 1,
            "datasources": [{"id": "trace-demo", "name": "trace-demo", "kind": "sqlite", "isDefault": True, "config": {}}],
            "groups": [],
        }
        (self.dir / "datasources.json").write_text(json.dumps(registry), encoding="utf-8")

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self.saved)
        self.tmp.cleanup()

    def test_export_reads_the_current_graph(self):
        result = _invoke({"op": "export", "datasource": "trace-demo"}, self.dir)
        self.assertTrue(result.get("ok"), result)
        self.assertEqual(result["bundle"]["edges"], [])
        self.assertEqual(result["bundle"]["scenes"], [])

    def test_preview_is_read_only_and_reports_imports(self):
        edge = {
            "from": {"table": "t_order", "column": "id"},
            "to": {"table": "t_line", "column": "order_id"},
        }
        bundle = {"schemaVersion": 1, "kind": "db-mcp-bundle", "edges": [edge], "scenes": []}
        result = _invoke({"op": "preview", "datasource": "trace-demo", "payload": bundle}, self.dir)
        self.assertTrue(result.get("ok"), result)
        self.assertEqual(result["plan"]["imported"], 1)
        self.assertFalse((self.dir / "relations" / "trace-demo.json").exists())

    def test_a_store_error_is_json_not_a_traceback(self):
        result = _invoke({"op": "preview", "datasource": "trace-demo", "payload": {"schemaVersion": 999}}, self.dir)
        self.assertFalse(result.get("ok"))
        self.assertEqual(result["error"]["code"], "user_error")
        self.assertIn("schemaVersion", result["error"]["message"])

    def test_unknown_op_is_a_clean_error(self):
        result = _invoke({"op": "nope", "datasource": "trace-demo"}, self.dir)
        self.assertFalse(result.get("ok"))
        self.assertIn("op", result["error"]["message"])

    def test_preview_without_a_catalog_hints_it_was_not_checked(self):
        edge = {
            "from": {"table": "t_order", "column": "id"},
            "to": {"table": "t_line", "column": "order_id"},
            "status": "trusted",
        }
        bundle = {"schemaVersion": 1, "kind": "db-mcp-bundle", "edges": [edge], "scenes": []}
        result = _invoke({"op": "preview", "datasource": "trace-demo", "payload": bundle}, self.dir)
        self.assertTrue(result.get("ok"), result)
        self.assertTrue(result["plan"]["catalogHint"])
        self.assertTrue(result["plan"]["respectStatus"])
        self.assertEqual(result["plan"]["downgraded"][0]["reason"], "not_checked")

    def test_preview_respect_status_toggle_forces_pending(self):
        edge = {
            "from": {"table": "t_order", "column": "id"},
            "to": {"table": "t_line", "column": "order_id"},
            "status": "trusted",
        }
        bundle = {"schemaVersion": 1, "kind": "db-mcp-bundle", "edges": [edge], "scenes": []}
        result = _invoke(
            {"op": "preview", "datasource": "trace-demo", "payload": bundle, "respectStatus": False},
            self.dir,
        )
        self.assertTrue(result.get("ok"), result)
        self.assertFalse(result["plan"]["respectStatus"])
        self.assertTrue(all(item["reason"] == "pending_all" for item in result["plan"]["downgraded"]))

    def test_a_stale_revision_is_reported(self):
        bundle = {"schemaVersion": 1, "kind": "db-mcp-bundle", "edges": [], "scenes": []}
        first = _invoke({"op": "preview", "datasource": "trace-demo", "payload": bundle}, self.dir)
        revision = first["plan"]["revision"]
        stale = _invoke(
            {"op": "preview", "datasource": "trace-demo", "payload": bundle, "expectedRevision": revision + "x"},
            self.dir,
        )
        self.assertTrue(stale.get("ok"), stale)
        self.assertTrue(stale["plan"]["stalePreview"])


class RefreshCatalogCli(unittest.TestCase):
    """The refresh op reads metadata from a real database and stamps the cache."""

    def setUp(self):
        import sqlite3

        self.saved = dict(os.environ)
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.db = self.dir / "shop.db"
        seed = sqlite3.connect(str(self.db))
        try:
            seed.executescript(
                "create table t_order (id integer primary key, code text);"
                "create table t_trans (id integer primary key, order_id integer);"
            )
            seed.commit()
        finally:
            seed.close()
        registry = {
            "schemaVersion": 1,
            "datasources": [{
                "id": "shop", "name": "shop", "kind": "sqlite", "isDefault": True,
                "config": {"file": str(self.db)},
            }],
            "groups": [],
        }
        (self.dir / "datasources.json").write_text(json.dumps(registry), encoding="utf-8")

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self.saved)
        self.tmp.cleanup()

    def test_refresh_reports_a_saved_at_and_the_tables_it_read(self):
        result = _invoke({"op": "refresh_catalog", "datasource": "shop"}, self.dir)
        self.assertTrue(result.get("ok"), result)
        self.assertTrue(result.get("savedAt"))
        self.assertEqual(result.get("tableCount"), 2)
        cache = self.dir / "catalog" / "shop.json"
        self.assertTrue(cache.exists(), "refresh writes a timestamped cache")
        doc = json.loads(cache.read_text(encoding="utf-8"))
        self.assertEqual(doc["savedAt"], result["savedAt"])
        self.assertIn("t_order", doc["tables"])
        self.assertIn("t_trans", doc["tables"])

    def test_a_preview_after_refresh_uses_the_fresh_catalog(self):
        refreshed = _invoke({"op": "refresh_catalog", "datasource": "shop"}, self.dir)
        self.assertTrue(refreshed.get("ok"), refreshed)
        edge = {
            "from": {"table": "t_trans", "column": "order_id"},
            "to": {"table": "t_order", "column": "id"},
            "status": "trusted",
        }
        bundle = {"schemaVersion": 1, "kind": "db-mcp-bundle", "edges": [edge], "scenes": []}
        result = _invoke({"op": "preview", "datasource": "shop", "payload": bundle}, self.dir)
        self.assertTrue(result.get("ok"), result)
        self.assertFalse(result["plan"]["catalogHint"])
        self.assertFalse(result["plan"]["catalogStale"])
        self.assertNotIn("not_checked", [item["reason"] for item in result["plan"]["downgraded"]])


if __name__ == "__main__":
    unittest.main(verbosity=2)
