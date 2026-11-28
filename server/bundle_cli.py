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
import math
import sys
import time

import bundle
import engines
import relations
import scenes
import store


def _wanted_tables(payload: dict) -> list:
    """The tables a bundle actually mentions, most trustworthy first.

    Edge endpoints come before scene members, and an edge whose status is
    ``confirmed``/``trusted`` comes before a ``pending`` one. That order is what a
    limited budget should spend itself on: a confirmed join is the one a reader
    will act on, while a pending edge is a guess the sender has not checked. A
    scene member sits in between — someone wrote it down on purpose.

    Reading "the first 500 tables" answered a question nobody asked and left the
    rest of a real schema silently unknown; this reads what is needed and nothing
    else, with no ceiling.
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
    trusted = {"confirmed", "trusted"}
    edge_items = [edge for edge in (edges if isinstance(edges, list) else []) if isinstance(edge, dict)]

    def add_edges(want_trusted: bool) -> None:
        for edge in edge_items:
            if (str(edge.get("status") or "").casefold() in trusted) != want_trusted:
                continue
            for side in ("from", "to"):
                point = edge.get(side)
                if isinstance(point, dict):
                    add(point.get("table"))

    # Confirmed/trusted endpoints first, then scene members, then pending edges:
    # a scene is someone's deliberate table list, a pending edge is a guess.
    add_edges(True)
    scenes = payload.get("scenes") if isinstance(payload, dict) else None
    for scene in scenes if isinstance(scenes, list) else []:
        if not isinstance(scene, dict):
            continue
        for name in scene.get("tables") or []:
            add(name)
    add_edges(False)
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


def _percentile(values: list[int], fraction: float) -> int:
    """The nearest-rank percentile: no interpolation, whole milliseconds."""
    if not values:
        return 0
    ordered = sorted(values)
    rank = max(0, min(len(ordered) - 1, math.ceil(fraction * len(ordered)) - 1))
    return int(ordered[rank])


def _timing_summary(elapsed: list[int]) -> dict:
    """How long the reads took, in the numbers a person actually reads."""
    if not elapsed:
        return {"count": 0, "p50": 0, "p95": 0, "max": 0, "mean": 0}
    return {
        "count": len(elapsed),
        "p50": _percentile(elapsed, 0.5),
        "p95": _percentile(elapsed, 0.95),
        "max": max(elapsed),
        "mean": int(sum(elapsed) / len(elapsed)),
    }


def refresh(profile: dict, payload: dict | None = None, schema: str | None = None,
            timeout_ms: int | None = None, clock=None, timer=None) -> dict:
    """Read the tables a bundle mentions and say what happened to each.

    Three outcomes, kept apart on purpose:

    * ``checked``    — described, so the cache may speak for it;
    * ``missing``    — every case variant was asked for and none existed;
    * ``notChecked`` — the deadline passed, one table took longer than its own
      limit, the statement timed out, or the read failed. Never "missing":
      calling an unread table absent turns "look again" into "your join is wrong".

    Two limits apply, both read from `settings.json` (see `store.catalog_limits`):
    a per-table limit and a limit for the whole run. A single slow table used to
    hold the connection up to the engine's thirty-second statement timeout, and a
    graph with hundreds of tables could run for minutes. The whole-run limit stops
    the batch; tables it never reached are "not checked", not "missing".

    Only the tables read this time get a fresh stamp; everything else in the
    cache keeps its own. ``timeout_ms`` overrides the configured run limit, and
    the result carries the read timings so the first refresh against a real
    database reports what that database costs.
    """
    payload = payload if isinstance(payload, dict) else {}
    wanted = _wanted_tables(payload)
    schema = str(schema).strip() if isinstance(schema, str) and schema.strip() else None
    limits = store.catalog_limits()
    budget = int(timeout_ms) if isinstance(timeout_ms, int) and timeout_ms > 0 else limits["totalMs"]
    per_table = limits["perTableMs"]
    now = clock or (lambda: int(time.time() * 1000))
    # A separate clock for timings: `clock` is wall-clock milliseconds and is what
    # tests drive to simulate a deadline; measuring one table's cost must not eat
    # the same ticks, so the timer defaults to a monotonic reading of its own.
    timer = timer or (lambda: int(time.perf_counter() * 1000))
    started = now()

    password = store.password_of(profile, store.load_secrets())
    connection, close = engines.connect(profile, password)
    checked: list[str] = []
    missing: list[str] = []
    not_checked: list[str] = []
    read: list = []
    elapsed: list[int] = []
    try:
        for name in wanted:
            if budget is not None and now() - started > budget:
                not_checked.append(name)
                continue
            described = None
            absent = False
            began = timer()
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
            spent = max(0, timer() - began)
            if described is None:
                if absent:
                    missing.append(name)
                else:
                    not_checked.append(name)
                continue
            if spent > per_table:
                # It answered, but nothing that slow belongs in a cache refreshed
                # from a panel click — the next run may well time out instead.
                not_checked.append(name)
                continue
            elapsed.append(spent)
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
        "timing": _timing_summary(elapsed),
        "limits": {"perTableMs": per_table, "totalMs": budget},
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
