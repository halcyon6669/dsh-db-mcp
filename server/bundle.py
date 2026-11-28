"""Share a relation graph and its scenes as a bundle.

A bundle is a file somebody chose to hand to somebody else. It is *not* a
database backup: it carries the joins we believe exist and the scenes we read
through, but no connection details, no credentials and no local trust. Trust is
earned in the reader's own graph, one confirmation at a time.

Two rules shape this module:

* ``import_bundle`` is pure. It computes what *would* change and hands the new
  documents back; it never touches disk. The panel previews those numbers, and
  only ``apply_import`` writes — atomically, so a failure leaves both files as
  they were.
* Nothing in a bundle is trusted as identity. A join's id is recomputed from
  its endpoints with the local ``relations.edge_id``; a scene's id is always
  regenerated. The whole-bundle fingerprint is only a hint that the two sides
  are looking at the same set of tables.
* Trust is never inherited, but a confirmation is a reference. A sender's
  ``status`` travels as a hint only. The real status is recomputed against the
  reader's *cached* catalog: a join whose endpoints exist there with compatible
  types keeps a confirmed/trusted sender status (downgraded to ``confirmed``,
  with ``confirmCount`` reset to zero); an endpoint missing from the catalog, a
  type clash, or no catalog at all means ``pending``. Nobody's trust verdict is
  copied blindly into somebody else's graph.
"""

from __future__ import annotations

import copy
import hashlib
import json
import os
import uuid
from pathlib import Path

import engines
import relations
import scenes
import store

SCHEMA_VERSION = 1
KIND = "db-mcp-bundle"

# Bounds are constants so there is one number to test and one to change.
MAX_EDGES = relations.EDGE_LIMIT          # 500 joins is already a big graph
MAX_SCENES = scenes.SCENE_LIMIT           # 50 scenes per datasource
MAX_STRING = 2000                         # a note, condition or name
MAX_PACKAGE_BYTES = 5 * 1024 * 1024       # five megabytes of text is plenty

# Only these scene fields travel. Anything else in a bundle is future data (or
# somebody's private note) and is dropped rather than persisted.
SCENE_FIELDS = {
    "id", "name", "tables", "note", "stages", "aliases", "inputAlias",
    "weakMatch", "createdAt", "updatedAt", "statusColumn", "displayColumns",
    "amountColumn", "timeColumn",
}


def _now() -> str:
    return relations._now()


def bundle_fingerprint(edges) -> str:
    """A hint of "is this the same set of tables?", not an identity.

    Every endpoint is a ``table.column`` pair; the set of them, case-folded and
    sorted, is hashed. Two bundles describing the same joins from opposite
    directions get the same fingerprint. A forged per-edge fingerprint cannot
    influence it because the ids are not read at all.
    """
    points = set()
    for edge in edges or []:
        try:
            frm = edge["from"]
            to = edge["to"]
            points.add(f"{frm['table']}.{frm['column']}".casefold())
            points.add(f"{to['table']}.{to['column']}".casefold())
        except (KeyError, TypeError):
            continue
    seed = "->".join(sorted(points))
    return hashlib.sha1(seed.encode("utf-8")).hexdigest()[:12]


def _wire_edge(edge: dict) -> dict:
    """The shareable part of an edge: endpoints, condition, note, places, status.

    ``status`` travels only as a *hint* — the recipient recomputes its own status
    against the cached catalog (see ``_resolve_status``). Deliberately absent:
    stats/confirmCount, history and source, which are local decisions and never
    cross a trust boundary.
    """
    return {
        "from": dict(edge.get("from") or {}),
        "to": dict(edge.get("to") or {}),
        "condition": edge.get("condition"),
        "note": edge.get("note"),
        "places": list(edge.get("places") or []),
        "status": edge.get("status"),
    }


def _resolve_status(wire: dict, catalog: dict | None, respect_status: bool):
    """Recompute a join's status from the reader's cached catalog.

    Returns ``(status, reason, stale)``. The sender's ``status`` is only consulted
    *after* the catalog says both endpoints exist with compatible types; it is a
    reference for a confirmation, never inherited trust. A reason is returned
    whenever the join lands in ``pending`` so the panel can explain the downgrade.
    """
    sender = wire.get("status")
    if not respect_status:
        return "pending", "pending_all", False
    if not isinstance(catalog, dict):
        return "pending", "not_checked", False

    frm = wire.get("from") or {}
    to = wire.get("to") or {}
    raw_tables = catalog.get("tables")
    if not isinstance(raw_tables, dict):
        return "pending", "not_checked", False
    tables = {
        str(name).casefold(): (info if isinstance(info, dict) else {})
        for name, info in raw_tables.items()
    }

    def lookup(table_info, column):
        cols = table_info.get("columns") or {}
        if isinstance(cols, dict):
            folded = {str(name).casefold(): value for name, value in cols.items()}
            return folded.get(str(column or "").casefold())
        for item in cols:
            if isinstance(item, dict) and str(item.get("name", "")).casefold() == str(column or "").casefold():
                return item.get("type")
        return None

    left = tables.get(str(frm.get("table") or "").casefold())
    right = tables.get(str(to.get("table") or "").casefold())
    if left is None or right is None:
        return "pending", "missing_table", True
    left_type = lookup(left, frm.get("column"))
    right_type = lookup(right, to.get("column"))
    if left_type is None or right_type is None:
        return "pending", "missing_column", True
    left_family = engines.column_family(left_type)
    right_family = engines.column_family(right_type)
    if left_family != right_family and "any" not in (left_family, right_family):
        return "pending", "type_incompatible", False
    if sender in ("confirmed", "trusted"):
        # A confirmation is a reference; trust is earned here, so the ceiling is
        # `confirmed` and the count starts again at zero.
        return "confirmed", None, False
    return "pending", None, False


def _wire_scene(scene: dict) -> dict:
    return {key: copy.deepcopy(value) for key, value in scene.items() if key in SCENE_FIELDS}


def export_bundle(relations_doc: dict | None, scenes_doc: dict | None, datasource: str | None = None) -> dict:
    """Build a portable bundle from the two on-disk documents.

    Pure: neither document is changed. A missing document exports as empty.
    """
    edges = [_wire_edge(edge) for edge in (relations_doc or {}).get("edges", []) if isinstance(edge, dict)]
    items = [_wire_scene(scene) for scene in (scenes_doc or {}).get("scenes", []) if isinstance(scene, dict)]
    return {
        "schemaVersion": SCHEMA_VERSION,
        "kind": KIND,
        "datasource": datasource or (relations_doc or {}).get("datasource"),
        "edges": edges,
        "scenes": items,
        "fingerprint": bundle_fingerprint(edges),
    }


def _check_strings(value, path: str = "$") -> None:
    """Reject an over-long string anywhere in a bundle, keys included."""
    if isinstance(value, str):
        if len(value) > MAX_STRING:
            raise store.StoreError(
                "user_error",
                f"{path} is too long",
                f"keep it under {MAX_STRING} characters",
            )
    elif isinstance(value, dict):
        for key, item in value.items():
            _check_strings(key, path)
            _check_strings(item, f"{path}.{key}")
    elif isinstance(value, (list, tuple)):
        for index, item in enumerate(value):
            _check_strings(item, f"{path}[{index}]")


def import_bundle(
    profile: dict,
    payload: dict,
    relations_doc: dict | None = None,
    scenes_doc: dict | None = None,
    catalog: dict | None = None,
    respect_status: bool = True,
    expected_revision: str | None = None,
) -> dict:
    """Calculate an import without writing anything.

    ``relations_doc``/``scenes_doc`` let a caller preview against documents it
    already holds (for instance a previous preview). When they are omitted the
    current files are read, but never changed. ``catalog`` is the reader's cached
    table/column directory: no connection is opened, no data is queried. It is
    the yardstick every sender status is checked against. ``respect_status=False``
    is the panel's "make everything pending" toggle. The returned documents are
    what ``apply_import`` will write.
    """
    if not isinstance(payload, dict):
        raise store.StoreError("user_error", "a bundle must be an object", "export one from the sharing page and paste it as-is")
    if payload.get("schemaVersion") != SCHEMA_VERSION:
        raise store.StoreError(
            "user_error",
            f"unknown bundle schemaVersion {payload.get('schemaVersion')!r}",
            f"this plugin reads bundles of version {SCHEMA_VERSION}",
        )
    try:
        size = len(json.dumps(payload, ensure_ascii=False))
    except (TypeError, ValueError):
        size = MAX_PACKAGE_BYTES + 1
    if size > MAX_PACKAGE_BYTES:
        raise store.StoreError(
            "user_error",
            "the bundle is too large",
            f"keep it under {MAX_PACKAGE_BYTES} bytes",
        )
    raw_edges = payload.get("edges")
    raw_scenes = payload.get("scenes")
    if not isinstance(raw_edges, list) or not isinstance(raw_scenes, list):
        raise store.StoreError("user_error", "a bundle needs edges and scenes arrays", "export one from the sharing page")
    if len(raw_edges) > MAX_EDGES:
        raise store.StoreError("user_error", f"the bundle has more than {MAX_EDGES} edges", "split it into smaller bundles")
    if len(raw_scenes) > MAX_SCENES:
        raise store.StoreError("user_error", f"the bundle has more than {MAX_SCENES} scenes", "split it into smaller bundles")
    _check_strings(payload)

    current_rel = copy.deepcopy(relations_doc) if relations_doc is not None else copy.deepcopy(relations.load(profile))
    current_scn = copy.deepcopy(scenes_doc) if scenes_doc is not None else copy.deepcopy(scenes.load(profile))
    current_rel["schemaVersion"] = relations.SCHEMA_VERSION
    current_scn["schemaVersion"] = scenes.SCHEMA_VERSION

    # A revision is a fingerprint of what the preview actually looked at. If the
    # caller re-imports with a stale one, it must recompute against the latest
    # files instead of committing a plan made over documents that changed.
    revision = _revision(current_rel, current_scn)
    stale_preview = bool(expected_revision) and str(expected_revision) != revision

    import_id = "i_" + uuid.uuid4().hex[:10]
    by_id = {edge.get("id"): edge for edge in current_rel.get("edges", [])}
    imported = 0
    updated = 0
    skipped = 0
    conflicts: list[dict] = []
    unknown: list[str] = []
    downgraded: list[dict] = []

    for wire in raw_edges:
        if not isinstance(wire, dict):
            unknown.append("an edge was not an object")
            continue
        try:
            source = wire.get("from") or {}
            target = wire.get("to") or {}
            frm = relations._endpoint(source.get("table"), source.get("column"), "from")
            to = relations._endpoint(target.get("table"), target.get("column"), "to")
        except (store.StoreError, AttributeError):
            unknown.append("an edge had incomplete endpoints")
            continue
        # The id is recomputed. Nothing a sender wrote as `id`/`fingerprint`
        # gets a say in which local edge this is.
        target_id = relations.edge_id(frm, to)
        condition = wire.get("condition")
        local = by_id.get(target_id)
        status, reason, stale = _resolve_status(wire, catalog, respect_status)
        if local is None:
            edge = relations._blank_edge(frm, to, "imported", wire.get("note"))
            edge["condition"] = condition
            edge["importId"] = import_id
            edge["status"] = status
            # A confirmed arrival earns a fresh confirmation run, never the
            # sender's count. Pending keeps its zero count.
            edge["stats"]["confirmCount"] = 0
            if stale:
                edge["stale"] = True
            if reason:
                edge["downgradeReason"] = reason
                downgraded.append({
                    "edge": target_id,
                    "table": frm["table"],
                    "column": frm["column"],
                    "reason": reason,
                })
            places = wire.get("places")
            if isinstance(places, list):
                edge["places"] = [str(place) for place in places if str(place).strip()][:relations.PLACES_LIMIT]
            current_rel.setdefault("edges", []).append(edge)
            by_id[target_id] = edge
            imported += 1
            continue
        # A condition is a decision, not data to merge: keep the local one and
        # report the difference for a person to resolve.
        if (local.get("condition") or None) != (condition or None):
            conflicts.append({
                "edge": target_id,
                "table": frm["table"],
                "column": frm["column"],
                "local": local.get("condition"),
                "incoming": condition,
            })
            skipped += 1
            continue
        skipped += 1

    stale: list[str] = []
    for wire in raw_scenes:
        if not isinstance(wire, dict):
            unknown.append("a scene was not an object")
            continue
        scene = _wire_scene(wire)
        scene["id"] = scenes._new_id()
        scene["importId"] = import_id
        scene["createdAt"] = scene.get("createdAt") or _now()
        scene["updatedAt"] = _now()
        members = {scenes._fold(table) for table in (scene.get("tables") or []) if isinstance(table, str)}
        for key, columns in (scene.get("aliases") or {}).items():
            if not isinstance(columns, list):
                continue
            for item in columns:
                if not isinstance(item, dict):
                    continue
                if scenes._fold(item.get("table")) not in members:
                    stale.append(f"key {key}: {item.get('table')}.{item.get('column')}")
        for match in scene.get("weakMatch") or []:
            if not isinstance(match, dict):
                continue
            target = str(match.get("toColumn") or "")
            table = target.split(".", 1)[0]
            if scenes._fold(table) not in members:
                stale.append(f"weak {match.get('fromStage')}: {target}")
        current_scn.setdefault("scenes", []).append(scene)

    fingerprint = bundle_fingerprint(raw_edges)
    catalog_checked = isinstance(catalog, dict)
    return {
        "imported": imported,
        "updated": updated,
        "skipped": skipped,
        "conflicts": conflicts,
        "unknown": unknown,
        "stale": stale,
        "downgraded": downgraded,
        "catalogChecked": catalog_checked,
        "catalogHint": not catalog_checked,
        "respectStatus": bool(respect_status),
        "revision": revision,
        "stalePreview": stale_preview,
        "fingerprint": fingerprint,
        "fingerprintMatches": str(payload.get("fingerprint") or "") == fingerprint,
        "importId": import_id,
        "relationsDoc": current_rel,
        "scenesDoc": current_scn,
    }


def _revision(relations_doc: dict, scenes_doc: dict) -> str:
    """Fingerprint the two documents a preview was calculated against."""
    payload = json.dumps(
        {
            "edges": [
                [edge.get("id"), edge.get("status"), edge.get("condition"), edge.get("importId")]
                for edge in (relations_doc or {}).get("edges", [])
                if isinstance(edge, dict)
            ],
            "scenes": [
                [scene.get("id"), scene.get("name"), scene.get("tables"), scene.get("importId")]
                for scene in (scenes_doc or {}).get("scenes", [])
                if isinstance(scene, dict)
            ],
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha1(payload.encode("utf-8")).hexdigest()[:12]


def _lock_path(profile: dict) -> Path:
    return Path(store.runtime_dir()) / "relations" / (store._source_key(profile) + ".bundle.lock")


def acquire_lock(profile: dict) -> Path | None:
    """Claim the import lock, or return None if another writer holds it."""
    path = _lock_path(profile)
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        handle = os.open(str(path), os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError:
        return None
    try:
        os.write(handle, str(os.getpid()).encode("ascii"))
    finally:
        os.close(handle)
    return path


def release_lock(profile: dict, lock) -> None:
    """Release a lock returned by ``acquire_lock`` (idempotent)."""
    if lock is None:
        return
    try:
        Path(lock).unlink(missing_ok=True)
    except OSError:
        pass


def _write_document(path, document: dict) -> None:
    """Write one document to a private temporary file, then make it private on disk."""
    path.parent.mkdir(parents=True, exist_ok=True)
    # Create with 0600 from the start: a bundle can carry another team's table
    # names and join conditions, so it must never be world-readable, not even
    # for the instant before the final chmod.
    descriptor = os.open(str(path), os.O_CREAT | os.O_TRUNC | os.O_WRONLY, 0o600)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(document, handle, indent=2, ensure_ascii=False)
            handle.write("\n")
    except Exception:
        try:
            Path(path).unlink(missing_ok=True)
        except OSError:
            pass
        raise
    try:
        os.chmod(str(path), 0o600)
    except OSError:
        # Windows does not implement POSIX mode bits; the ACL inherited from
        # the private runtime directory still restricts access.
        pass


def apply_import(profile: dict, result: dict) -> dict:
    """Commit a calculated import atomically across both files.

    Both temporary files are prepared before either target is replaced, and the
    original bytes are kept in memory. If the second replace fails, the first
    file is restored, so a half-written share never leaves one file new and the
    other old.
    """
    if not isinstance(result, dict) or "relationsDoc" not in result or "scenesDoc" not in result:
        raise store.StoreError("user_error", "there is no calculated import to apply", "preview a bundle first")
    lock = acquire_lock(profile)
    if lock is None:
        raise store.StoreError(
            "user_error",
            "the import lock is held by another writer",
            "wait a moment and try again",
        )
    try:
        return _apply_import_locked(profile, result)
    finally:
        release_lock(profile, lock)


def _apply_import_locked(profile: dict, result: dict) -> dict:
    """The commit itself, run with the import lock held."""
    rpath = relations.path_of(profile)
    spath = scenes.path_of(profile)
    originals = {}
    for path in (rpath, spath):
        try:
            originals[path] = path.read_bytes()
        except FileNotFoundError:
            originals[path] = None
    rtmp = rpath.with_name(rpath.name + ".bundle.tmp")
    stmp = spath.with_name(spath.name + ".bundle.tmp")
    _write_document(rtmp, result["relationsDoc"])
    _write_document(stmp, result["scenesDoc"])
    try:
        os.replace(rtmp, rpath)
        os.replace(stmp, spath)
    except Exception:
        for path, raw in originals.items():
            try:
                if raw is None:
                    path.unlink(missing_ok=True)
                else:
                    path.write_bytes(raw)
            except OSError:
                pass
        for temporary in (rtmp, stmp):
            try:
                temporary.unlink(missing_ok=True)
            except OSError:
                pass
        raise
    return {
        "ok": True,
        "importId": result.get("importId"),
        "imported": result.get("imported", 0),
        "scenes": len(result.get("scenesDoc", {}).get("scenes", [])),
    }


def undo_import(profile: dict, import_id: str) -> dict:
    """Calculate the removal of one import. Pure; apply with ``apply_import``."""
    if not import_id:
        raise store.StoreError("user_error", "there is no import to undo", "choose an import from the sharing page")
    rdoc = copy.deepcopy(relations.load(profile))
    sdoc = copy.deepcopy(scenes.load(profile))
    rdoc["edges"] = [edge for edge in rdoc.get("edges", []) if edge.get("importId") != import_id]
    sdoc["scenes"] = [scene for scene in sdoc.get("scenes", []) if scene.get("importId") != import_id]
    return {
        "relationsDoc": rdoc,
        "scenesDoc": sdoc,
        "importId": import_id,
        "removedEdges": len(rdoc.get("edges", [])),
        "removedScenes": len(sdoc.get("scenes", [])),
    }
