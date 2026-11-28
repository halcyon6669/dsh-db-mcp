"""A stdin/stdout bridge to the pure bundle functions.

The panel Host reaches this file with ``execFile`` (see the ``/bundle/*``
routes in src/host.js). It exists so sharing does not add a seventh graph tool
to the MCP catalog: the Host already knows how to spawn Python with
``DB_MCP_RUNTIME``, and the real work lives in the tested ``bundle.py``.

Protocol: one JSON object on stdin, exactly one JSON object on stdout, always.
A ``StoreError`` becomes ``{"ok": false, "error": {...}}`` rather than a
traceback, because the Host parses the last stdout line. Operations:

* ``export``   -> ``{"bundle": ...}``
* ``preview``  -> ``{"plan": ...}`` (pure; no disk write)
* ``import``   -> ``{"applied": ...}`` (atomically writes both documents)
* ``undo``     -> ``{"applied": ...}`` (removes one importId)
"""

from __future__ import annotations

import json
import sys

import bundle
import relations
import scenes
import store


def _fail(code: str, message: str, hint: str | None = None) -> dict:
    error = {"code": code, "message": message}
    if hint:
        error["hint"] = hint
    return {"ok": False, "error": error}


def run(command: dict) -> dict:
    if not isinstance(command, dict):
        return _fail("user_error", "a command must be an object")
    op = str(command.get("op") or "")
    try:
        profile, _secrets = store.resolve(command.get("datasource"))
    except store.StoreError as error:
        return _fail(error.code, error.message, getattr(error, "hint", None))

    if op == "export":
        return {
            "ok": True,
            "bundle": bundle.export_bundle(
                relations.load(profile),
                scenes.load(profile),
                datasource=profile.get("id"),
            ),
        }

    if op == "preview":
        payload = command.get("payload")
        plan = bundle.import_bundle(profile, payload)
        # The documents are large and private; the panel only needs the counts
        # and the conflicts to ask for a decision.
        plan.pop("relationsDoc", None)
        plan.pop("scenesDoc", None)
        return {"ok": True, "plan": plan}

    if op == "import":
        payload = command.get("payload")
        # Apply re-derives the plan against the current files so a preview that
        # sat open while somebody edited the graph cannot stamp over them.
        result = bundle.import_bundle(profile, payload)
        applied = bundle.apply_import(profile, result)
        return {"ok": True, "applied": applied, "importId": result.get("importId")}

    if op == "undo":
        import_id = str(command.get("importId") or "")
        plan = bundle.undo_import(profile, import_id)
        applied = bundle.apply_import(profile, plan)
        return {"ok": True, "applied": applied}

    return _fail("user_error", f"unknown op {op!r}", "export, preview, import or undo")


def main() -> None:
    try:
        command = json.loads(sys.stdin.read() or "{}")
    except (ValueError, TypeError) as error:
        response = _fail("user_error", f"the command is not JSON: {error}")
    else:
        try:
            response = run(command)
        except store.StoreError as error:
            response = _fail(error.code, error.message, getattr(error, "hint", None))
        except Exception as error:  # never leak a traceback to the Host's parser
            response = _fail("infra_error", f"{type(error).__name__}: {error}")
    sys.stdout.write(json.dumps(response, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()
