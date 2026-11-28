"""A stdin/stdout bridge to the pure bundle functions.

The panel Host reaches this file with ``execFile`` (see the ``/bundle/*``
routes in src/host.js). It exists so sharing does not add a seventh graph tool
to the MCP catalog: the Host already knows how to spawn Python with
``DB_MCP_RUNTIME``, and the real work lives in the tested ``bundle.py``.

Protocol: one JSON object on stdin, exactly one JSON object on stdout, always.
A ``StoreError`` becomes ``{"ok": false, "error": {...}}`` rather than a
traceback, because the Host parses the last stdout line. Operations:

* ``refresh_catalog`` -> ``{"checked": [...], "missing": [...], "notChecked": [...], "savedAt": ...}``
  (metadata only; reads the tables the bundle mentions, never table data)
* ``export``   -> ``{"bundle": ...}``
* ``preview``  -> ``{"plan": ...}`` (pure; no disk write, no connection)
* ``import``   -> ``{"applied": ...}`` (atomically writes both documents)
* ``undo``     -> ``{"applied": ...}`` (removes one importId)
"""

from __future__ import annotations

import json
import sys
import time

import bundle
import engines
import relations
import scenes
import store


def _wanted_tables(payload: dict) -> list:
    """The tables a bundle actually mentions, in the order it mentions them.

    Edge endpoints come first (the joins are what a preview compares), then scene
    members. Reading "the first 500 tables" answered a question nobody asked and
    left the rest of a real schema silently unknown; this reads what is needed and
    nothing else, with no ceiling.
    """
    order: list = []
    seen: set[str] = set()

    def add(name) -> None:
        text = str(name or "").strip()
        if not text or text.casefold() in seen:
            return
        seen.add(text.casefold())
        order.append(text)

    edges = payload.get("edges") if isinstance(payload, dict) else None
    for edge in edges if isinstance(edges, list) else []:
        if not isinstance(edge, dict):
            continue
        for side in ("from", "to"):
            point = edge.get(side)
            if isinstance(point, dict):
                add(point.get("table"))
    scenes = payload.get("scenes") if isinstance(payload, dict) else None
    for scene in scenes if isinstance(scenes, list) else []:
        if not isinstance(scene, dict):
            continue
        for name in scene.get("tables") or []:
            add(name)
    return order


def _case_variants(name: str) -> list:
    """The spellings a real engine may insist on (Oracle upper, GaussDB lower)."""
    variants = [name]
    for candidate in (name.upper(), name.lower(), name.casefold()):
        if candidate not in variants:
            variants.append(candidate)
    return variants


def _is_absent(error: Exception) -> bool:
    """Only "no such table" makes a table missing; anything else is "not read"."""
    if isinstance(error, engines.DbError):
        text = str(getattr(error, "message", "") or error).casefold()
        return "not found" in text or "does not exist" in text or "unknown table" in text
    return False


def refresh(profile: dict, payload: dict | None = None, schema: str | None = None,
            timeout_ms: int | None = None, clock=None) -> dict:
    """Read the tables a bundle mentions and say what happened to each.

    Three outcomes, kept apart on purpose:

    * ``checked``    — described, so the cache may speak for it;
    * ``missing``    — every case variant was asked for and none existed;
    * ``notChecked`` — the deadline passed, the statement timed out, or the read
      failed. Never "missing": calling an unread table absent turns "look again"
      into "your join is wrong".

    Only the tables read this time get a fresh stamp; everything else in the
    cache keeps its own. ``timeout_ms`` bounds the whole refresh (not one
    statement), so one slow schema cannot hold the panel.
    """
    payload = payload if isinstance(payload, dict) else {}
    wanted = _wanted_tables(payload)
    schema = str(schema).strip() if isinstance(schema, str) and schema.strip() else None
    budget = int(timeout_ms) if isinstance(timeout_ms, int) and timeout_ms > 0 else None
    now = clock or (lambda: int(time.time() * 1000))
    started = now()

    password = store.password_of(profile, store.load_secrets())
    connection, close = engines.connect(profile, password)
    checked: list[str] = []
    missing: list[str] = []
    not_checked: list[str] = []
    read: list = []
    try:
        for name in wanted:
            if budget is not None and now() - started > budget:
                not_checked.append(name)
                continue
            described = None
            absent = False
            for variant in _case_variants(name):
                try:
                    described = engines.describe_table(profile, connection, variant, schema)
                    break
                except Exception as error:  # noqa: BLE001 - one table never loses the rest
                    if _is_absent(error):
                        absent = True
                        continue
                    absent = False
                    break
            if described is None:
                if absent:
                    missing.append(name)
                else:
                    not_checked.append(name)
                continue
            columns = {}
            for col in described.get("columns") or []:
                if isinstance(col, dict) and col.get("name"):
                    columns[str(col["name"])] = col.get("type")
            read.append((str(described.get("table") or name), columns))
            checked.append(name)
    finally:
        close()

    catalog = store.load_catalog(profile, schema) or {"tables": {}}
    tables = catalog.get("tables")
    if not isinstance(tables, dict):
        tables = {}
        catalog["tables"] = tables
    # Keep what other reads already put here; a partial refresh is not a reset.
    for name, columns in read:
        entry = tables.get(name)
        if not isinstance(entry, dict):
            entry = {}
            tables[name] = entry
        known = entry.get("columns")
        if not isinstance(known, dict):
            known = {}
            entry["columns"] = known
        known.update(columns)
    previous = [str(item) for item in (catalog.get("unread") or []) if item]
    keep = [item for item in previous if item.casefold() not in {name.casefold() for name in checked}]
    catalog["unread"] = sorted({*keep, *not_checked}, key=str.casefold)
    saved = store.save_catalog(profile, catalog, schema=schema, read=read)
    return {
        "ok": True,
        "checked": checked,
        "missing": missing,
        "notChecked": not_checked,
        "savedAt": saved.get("savedAt"),
        "tableCount": len(tables),
        "schema": schema,
    }



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
            payload = command.get("payload")
            if not isinstance(payload, dict):
                # Without a bundle there is nothing to scope the read to; export
                # the current graph so the refresh still reads what the graph uses.
                payload = bundle.export_bundle(
                    relations.load(profile),
                    scenes.load(profile),
                    datasource=profile.get("id"),
                )
            schema = command.get("schema")
            if not isinstance(schema, str) or not schema.strip():
                schema = store.catalog_schema(profile)
            return refresh(
                profile,
                payload=payload,
                schema=schema,
                timeout_ms=command.get("timeoutMs"),
            )
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
    preferred = command.get("schema")
    if not isinstance(preferred, str) or not preferred.strip():
        preferred = store.catalog_schema(profile)
    catalog = store.load_catalog(profile, preferred)
    schemas = {
        name: store.load_catalog(profile, name)
        for name in store.catalog_schemas(profile)
        if name and name != preferred
    }
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
            schemas=schemas,
            preferred_schema=preferred,
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
            schemas=schemas,
            preferred_schema=preferred,
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
