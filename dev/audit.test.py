"""Regression tests for `server/audit.py`, the HTTP child's own audit writer.

The bug this guards against: a client pointed straight at the HTTP endpoint never
touched the Host half, so its calls left no line in `logs/audit.jsonl` at all.

`audit.record` is a no-op unless `DB_MCP_AUDIT=1` and `auditLog` in `settings.json`
is not false, so most tests flip the environment and point `DB_MCP_RUNTIME` at a
temporary directory. Run it through `dev/engines.test.mjs` (`npm run test:engines`),
which picks the right interpreter.
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
# `audit.py` reaches `import store` the same way `engines.py` reaches `writes`.
sys.path.insert(0, str(PACKAGE / "server"))
SPEC = importlib.util.spec_from_file_location("db_mcp_audit", PACKAGE / "server" / "audit.py")
audit = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(audit)


class AuditTest(unittest.TestCase):
    def setUp(self):
        self.saved = {
            key: os.environ.get(key)
            for key in ("DB_MCP_AUDIT", "DB_MCP_RUNTIME", "DB_MCP_MAX_ROWS")
        }
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        os.environ["DB_MCP_RUNTIME"] = str(self.dir)
        os.environ["DB_MCP_AUDIT"] = "1"

    def tearDown(self):
        for key, value in self.saved.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        self.tmp.cleanup()

    def _settings(self, **payload):
        path = self.dir / "settings.json"
        path.write_text(json.dumps(payload), encoding="utf-8")

    def _lines(self):
        target = self.dir / "logs" / "audit.jsonl"
        if not target.exists():
            return []
        text = target.read_text(encoding="utf-8")
        return [json.loads(line) for line in text.splitlines() if line.strip()]

    # -- what a line looks like -------------------------------------------

    def test_a_read_records_the_tool_the_source_and_the_row_count(self):
        line = audit.entry(
            "execute_sql",
            {"datasource": "sqlite", "sql": "select 1"},
            100.0,
            {"ok": True, "columns": ["n"], "rows": [[1], [2], [3]]},
            None,
            now=100.25,
        )
        self.assertEqual(line["tool"], "mcp__db__execute_sql")
        self.assertEqual(line["datasource"], "sqlite")
        self.assertEqual(line["sql"], "select 1")
        self.assertTrue(line["ok"])
        self.assertEqual(line["ms"], 250)
        self.assertEqual(line["rows"], 3)
        self.assertRegex(line["at"], r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$")

    def test_a_change_records_affected_rows_and_the_table(self):
        line = audit.entry(
            "execute_sql",
            {"datasource": "pg", "sql": "update t set a = 1", "table": "t"},
            0.0,
            {"ok": True, "affectedRows": 7, "columns": [], "rows": []},
            None,
            now=0.0,
        )
        self.assertEqual(line["rows"], 7)
        self.assertEqual(line["table"], "t")

    def test_a_rowcount_beats_a_row_list(self):
        line = audit.entry("execute_sql", {}, 0.0, {"ok": True, "rowCount": 12, "rows": []}, None, now=0)
        self.assertEqual(line["rows"], 12)

    def test_result_rows_are_never_written(self):
        line = audit.entry(
            "execute_sql",
            {"sql": "select secret from t"},
            0.0,
            {"ok": True, "columns": ["secret"], "rows": [["hunter2"]]},
            None,
            now=0,
        )
        self.assertNotIn("hunter2", json.dumps(line))
        self.assertNotIn("columns", line)

    def test_binding_values_are_never_written(self):
        # A bound value is a cell's real content — the same thing the row sample
        # is — so `binds` must not travel into the log the way `sql` does.
        line = audit.entry(
            "execute_sql",
            {"sql": "select * from t_order where order_no = ?", "binds": ["SO-TOPSECRET-42"]},
            0.0,
            {"ok": True, "rowCount": 1},
            None,
            now=0,
        )
        self.assertNotIn("binds", line)
        self.assertNotIn("SO-TOPSECRET-42", json.dumps(line))

    def test_a_password_argument_is_never_written(self):
        # A tool may be handed a credential (a datasource test, an import). It
        # belongs in the OS secret store, never in a line anyone can read back.
        line = audit.entry(
            "save_datasource",
            {"datasource": "pg", "password": "hunter2", "#password": "hunter2"},
            0.0,
            {"ok": True},
            None,
            now=0,
        )
        self.assertNotIn("password", line)
        self.assertNotIn("#password", line)
        self.assertNotIn("hunter2", json.dumps(line))

    def test_an_error_message_can_still_name_a_binding_safely(self):
        # The exception text is allowed through (it is how a failure is read),
        # but it is the driver's own wording, not the arguments we passed.
        line = audit.entry(
            "execute_sql",
            {"sql": "select 1", "binds": ["hunter2"]},
            0.0,
            None,
            ValueError("bad table"),
            now=0,
        )
        self.assertEqual(line["error"], "ValueError: bad table")
        self.assertNotIn("hunter2", json.dumps(line))

    def test_a_failure_returned_as_data_keeps_the_code(self):
        line = audit.entry(
            "execute_sql",
            {"datasource": "sqlite", "sql": "drop table t"},
            0.0,
            {"ok": False, "error": {"code": "user_error", "message": "not allowed", "hint": "x"}},
            None,
            now=0,
        )
        self.assertFalse(line["ok"])
        self.assertEqual(line["code"], "user_error")
        self.assertEqual(line["error"], "not allowed")
        self.assertNotIn("rows", line)

    def test_an_exception_is_promoted_to_the_error_field(self):
        try:
            raise RuntimeError("connection lost")
        except RuntimeError as error:
            line = audit.entry("list_tables", {"datasource": "pg"}, 0.0, None, error, now=0)
        self.assertFalse(line["ok"])
        self.assertEqual(line["error"], "RuntimeError: connection lost")

    def test_a_long_statement_is_cut_to_its_head(self):
        line = audit.entry("execute_sql", {"sql": "x" * 5000}, 0.0, {"ok": True}, None, now=0)
        self.assertEqual(len(line["sql"]), audit.MAX_SQL)

    def test_no_datasource_is_still_a_key(self):
        line = audit.entry("list_datasources", {}, 0.0, {"ok": True}, None, now=0)
        self.assertIsNone(line["datasource"])
        self.assertNotIn("sql", line)
        self.assertNotIn("table", line)

    # -- who called ---------------------------------------------------------

    def test_a_line_names_the_caller_when_one_is_given(self):
        line = audit.entry("execute_sql", {"sql": "select 1"}, 0.0, {"ok": True}, None, now=0, client="panel")
        self.assertEqual(line["client"], "panel")

    def test_a_line_without_a_caller_has_no_client_key(self):
        line = audit.entry("execute_sql", {}, 0.0, {"ok": True}, None, now=0)
        self.assertNotIn("client", line)

    def test_a_blank_caller_is_not_written(self):
        line = audit.entry("execute_sql", {}, 0.0, {"ok": True}, None, now=0, client="   ")
        self.assertNotIn("client", line)

    def test_the_recorded_line_carries_the_caller_through_record(self):
        audit.record("execute_sql", {"sql": "select 1"}, 0.0, {"ok": True}, None, client="panel")
        self.assertEqual(self._lines()[0]["client"], "panel")

    def test_the_host_writes_the_caller_for_the_calls_it_owns(self):
        # The stdio child does not own the log, so the Host's word is the only one.
        audit.record("list_tables", {}, 0.0, {"ok": True}, None, client="dsh-agent")
        self.assertEqual(self._lines()[0]["client"], "dsh-agent")

    def test_outside_a_request_there_is_no_client_name(self):
        # A direct call has no MCP session to ask, so the field stays absent
        # instead of inventing a name.
        self.assertIsNone(audit.client_name())

    # -- when it writes at all ---------------------------------------------

    def test_the_switch_off_means_no_line(self):
        os.environ.pop("DB_MCP_AUDIT", None)
        audit.record("list_tables", {}, 0.0, {"ok": True}, None)
        self.assertEqual(self._lines(), [])

    def test_settings_can_switch_it_off_even_when_the_env_says_yes(self):
        self._settings(auditLog=False)
        audit.record("list_tables", {}, 0.0, {"ok": True}, None)
        self.assertEqual(self._lines(), [])

    def test_settings_saying_true_keeps_writing(self):
        self._settings(auditLog=True)
        audit.record("list_tables", {}, 0.0, {"ok": True}, None)
        self.assertEqual(len(self._lines()), 1)

    def test_missing_settings_falls_back_to_writing(self):
        audit.record("list_tables", {}, 0.0, {"ok": True}, None)
        self.assertEqual(len(self._lines()), 1)

    def test_malformed_settings_falls_back_to_writing(self):
        (self.dir / "settings.json").write_text("{not json", encoding="utf-8")
        audit.record("list_tables", {}, 0.0, {"ok": True}, None)
        self.assertEqual(len(self._lines()), 1)

    # -- the file itself ----------------------------------------------------

    def test_each_call_appends_one_line(self):
        audit.record("list_tables", {}, 0.0, {"ok": True}, None)
        audit.record("describe_table", {"table": "t"}, 0.0, {"ok": True}, None)
        lines = self._lines()
        self.assertEqual([line["tool"] for line in lines], ["mcp__db__list_tables", "mcp__db__describe_table"])

    def test_the_file_is_private_to_the_user(self):
        if os.name == "nt":
            self.skipTest("POSIX permissions only")
        audit.record("list_tables", {}, 0.0, {"ok": True}, None)
        mode = (self.dir / "logs" / "audit.jsonl").stat().st_mode & 0o777
        self.assertEqual(mode, 0o600)

    def test_an_oversized_file_is_rotated(self):
        target = self.dir / "logs" / "audit.jsonl"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text("x" * (audit.AUDIT_LIMIT_BYTES + 10), encoding="utf-8")
        audit.record("list_tables", {}, 0.0, {"ok": True}, None)
        self.assertFalse(target.exists())
        self.assertTrue((self.dir / "logs" / "audit.1.jsonl").exists())

    def test_a_broken_directory_never_breaks_the_call(self):
        # A file where the directory should be: mkdir fails, and record swallows it.
        (self.dir / "logs").write_text("not a directory", encoding="utf-8")
        audit.record("list_tables", {}, 0.0, {"ok": True}, None)  # must not raise


if __name__ == "__main__":
    unittest.main(verbosity=2)
