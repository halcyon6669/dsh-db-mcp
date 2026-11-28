"""A stdin/stdout bridge to the pure bundle functions.

The panel Host reaches this file with ``execFile`` (see the ``/bundle/*``
routes in src/host.js). It exists so sharing does not add a seventh graph tool
to the MCP catalog: the Host already knows how to spawn Python with
``DB_MCP_RUNTIME``, and the real work lives in the tested ``bundle.py``.

Protocol: one JSON object on stdin, exactly one JSON object on stdout, always.
A ``StoreError`` becomes ``{"ok": false, "error": {...}}`` rather than a
traceback, because the Host parses the last stdout line. Operations:

* ``refresh_catalog`` -> ``{"savedAt": ..., "tableCount": N}`` (metadata only)
* ``export``   -> ``{"bundle": ...}``
* ``preview``  -> ``{"plan": ...}`` (pure; no disk write, no connection)
* ``import``   -> ``{"applied": ...}`` (atomically writes both documents)
* ``undo``     -> ``{"applied": ...}`` (removes one importId)
"""

from __future__ import annotations

import json
import sys

import bundle
import engines
import relations
import scenes
import store


def _refresh_catalog(profile: dict) -> dict:
    """Re-read the table/column directory from the datasource — metadata only.

    This is the one operation that opens a connection, and it is triggered by a
    person pressing "refresh directory". It lists tables and describes each one;
    it never runs a SELECT against table data. The result is saved through
    ``store.save_catalog``, which timestamps it.
    """
    password = store.password_of(profile, store.load_secrets())
    connection, close = engines.connect(profile, password)
    tables: dict[str, dict] = {}
    try:
        listed = engines.list_tables(profile, connection, None)
        for item in listed.get("tables") or []:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or "")
            if name:
                tables.setdefault(name, {})
        # Describe every table so types are available for status comparison.
        # Cap the work so a huge schema cannot turn one click into a huge read.
        for name in list(tables)[:500]:
            try:
                described = engines.describe_table(profile, connection, name, None)
            except Exception:  # a single unreadable table must not lose the rest
                continue
            cols = {}
            for col in described.get("columns") or []:
                if isinstance(col, dict) and col.get("name"):
                    cols[str(col["name"])] = col.get("type")
            tables[name] = {"columns": cols}
    finally:
        close()
    saved = store.save_catalog(profile, {"tables": tables})
    return {"ok": True, "savedAt": saved.get("savedAt"), "tableCount": len(tables)}


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
        profile, secrets = store.resolve(command.get("datasource"))
    except store.StoreError as error:
        return _fail(error.code, error.message, getattr(error, "hint", None))

    if op == "refresh_catalog":
        try:
            return _refresh_catalog(profile)
        except Exception as error:  # noqa: BLE001 - keep the one-line protocol
            return _fail("db_error", f"{type(error).__name__}: {error}")

    if op == "export":
        return {
            "ok": True,
            "bundle": bundle.export_bundle(
                relations.load(profile),
                scenes.load(profile),
                datasource=profile.get("id"),
            ),
        }

    # The cached catalog is read only: no connection is opened, no data queried.
    # When it is absent the resolver reports "not checked" and imports pending.
    catalog = store.load_catalog(profile)
    respect_status = command.get("respectStatus") is not False
    expected_revision = command.get("expectedRevision")

    if op == "preview":
        payload = command.get("payload")
        plan = bundle.import_bundle(
            profile,
            payload,
            catalog=catalog,
            respect_status=respect_status,
            expected_revision=expected_revision,
        )
        # The documents are large and private; the panel only needs the counts
        # and the conflicts to ask for a decision.
        plan.pop("relationsDoc", None)
        plan.pop("scenesDoc", None)
        return {"ok": True, "plan": plan}

    if op == "import":
        payload = command.get("payload")
        # Apply re-derives the plan against the current files so a preview that
        # sat open while somebody edited the graph cannot stamp over them.
        result = bundle.import_bundle(
            profile,
            payload,
            catalog=catalog,
            respect_status=respect_status,
            expected_revision=expected_revision,
        )
        if result.get("stalePreview"):
            return _fail(
                "stale_preview",
                "the graph changed since the preview",
                "look at the new preview and confirm it again",
            )
        applied = bundle.apply_import(profile, result)
        return {"ok": True, "applied": applied, "importId": result.get("importId")}

    if op == "undo":
        import_id = str(command.get("importId") or "")
        plan = bundle.undo_import(profile, import_id)
        applied = bundle.apply_import(profile, plan)
        return {"ok": True, "applied": applied}

    return _fail("user_error", f"unknown op {op!r}", "refresh_catalog, export, preview, import or undo")


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
