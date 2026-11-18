"""Regression tests for `server/main.py`, the tool layer around `engines`.

The case that prompted this file: every exception that was not one of the
plugin's own error types came back as `infra_error`, which the reference
documents as "the interpreter is missing or the venv is broken". A driver
raising a syntax error therefore told the model to go and repair an
installation that was perfectly fine. A plain driver exception is a `db_error`.

`main.py` imports `mcp.server.fastmcp`, so these cases need the plugin venv.
The suite skips itself when that import is unavailable rather than turning a
docs-only checkout into a broken test run.
"""

from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

PACKAGE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PACKAGE / "server"))

try:
    SPEC = importlib.util.spec_from_file_location("db_mcp_main", PACKAGE / "server" / "main.py")
    main = importlib.util.module_from_spec(SPEC)
    SPEC.loader.exec_module(main)
    HAVE_MAIN = True
except Exception:  # pragma: no cover - environment problem
    HAVE_MAIN = False


@unittest.skipUnless(HAVE_MAIN, "the MCP SDK is not installed for this interpreter")
class ErrorShape(unittest.TestCase):
    """`_error` is the one place a tool failure turns into the reply the model reads."""

    def test_a_plugin_error_keeps_its_code_and_hint(self):
        error = main.engines.DbError("timeout", "the statement ran too long", hint="select fewer rows")
        payload = main._error(error)
        self.assertFalse(payload["ok"])
        self.assertEqual(payload["error"]["code"], "timeout")
        self.assertEqual(payload["error"]["message"], "the statement ran too long")
        self.assertEqual(payload["error"]["hint"], "select fewer rows")

    def test_a_plugin_error_without_a_hint_omits_the_field(self):
        payload = main._error(main.engines.DbError("user_error", "no such table"))
        self.assertEqual(set(payload["error"]), {"code", "message"})

    def test_a_blocked_write_reads_as_a_user_error(self):
        # A refusal is the caller's mistake, not the engine's: the same code
        # `engines.ensure_readable` raises for the global and read-only switches.
        blocked = main.writes.WriteBlocked("DDL is off here", hint="turn it on for this source")
        payload = main._error(blocked)
        self.assertEqual(payload["error"]["code"], "user_error")
        self.assertEqual(payload["error"]["hint"], "turn it on for this source")

    def test_a_driver_exception_is_a_db_error_not_an_infra_error(self):
        payload = main._error(RuntimeError("syntax error at or near \"pragma\""))
        self.assertEqual(payload["error"]["code"], "db_error")
        self.assertIn("RuntimeError", payload["error"]["message"])
        self.assertIn("pragma", payload["error"]["message"])

    def test_infra_error_is_not_the_fallback(self):
        # Guards the regression directly: the fallback used to be infra_error.
        for error in (RuntimeError("boom"), ValueError("bad"), KeyError("k")):
            self.assertEqual(main._error(error)["error"]["code"], "db_error")


@unittest.skipUnless(HAVE_MAIN, "the MCP SDK is not installed for this interpreter")
class RowClamp(unittest.TestCase):
    """`_clamp_rows` bounds what a caller may ask for."""

    def test_a_missing_value_takes_the_default(self):
        self.assertEqual(main._clamp_rows(None), main.DEFAULT_MAX_ROWS)
        self.assertEqual(main._clamp_rows(0), main.DEFAULT_MAX_ROWS)

    def test_a_large_value_is_capped(self):
        self.assertEqual(main._clamp_rows(10**9), main.HARD_MAX_ROWS)

    def test_a_normal_value_passes_through(self):
        self.assertEqual(main._clamp_rows(5), 5)


if __name__ == "__main__":
    sys.exit(unittest.main(verbosity=2))
