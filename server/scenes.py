"""Named table sets a trace may wander inside.

A scene is the smallest thing that answers "which tables are in play here": a
name and a list of tables on one datasource. It exists because a real schema is
wider than any one question — a trace over an order should not silently fan out
into the category table just because an edge happens to reach it, and it should
say so rather than pretend the table is not there.

Deliberately not here: scenes do not own edges. Joins live in the relation graph,
which is the only place that claims two tables are connected; a scene only decides
which of those connections a given trace is allowed to use. Keeping the two apart
means deleting a scene can never lose a join somebody confirmed.
"""

from __future__ import annotations

import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path

import store

SCHEMA_VERSION = 1
SCENE_LIMIT = 50
TABLE_LIMIT = 500

# The two edge states a walk trusts. Repeated here rather than imported from
# `tracing` because tracing imports this module; a scene's "confirmed" answer must
# mean exactly what the walker will follow.
LINK_STATUSES = ("confirmed", "trusted")


def _fold(text) -> str:
    return str(text or "").strip().casefold()


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _source_key(profile: dict) -> str:
    if profile.get("id"):
        return str(profile["id"])
    seed = json.dumps(
        {
            "kind": profile.get("kind"),
            "name": profile.get("name"),
            "config": profile.get("config"),
        },
        sort_keys=True,
        default=str,
    )
    return "inline-" + hashlib.sha1(seed.encode("utf-8")).hexdigest()[:12]


def path_of(profile: dict) -> Path:
    return store.runtime_dir() / "scenes" / f"{_source_key(profile)}.json"


def _blank(profile: dict) -> dict:
    return {
        "schemaVersion": SCHEMA_VERSION,
        "datasource": profile.get("id") or _source_key(profile),
        "kind": profile.get("kind"),
        "updatedAt": None,
        "scenes": [],
    }


def load(profile: dict) -> dict:
    """Read the scene file, or start an empty one.

    A file that exists but does not parse is reported rather than reset: the
    scenes in it are work somebody typed, and silently starting over would look
    like the panel had lost them.
    """
    target = path_of(profile)
    try:
        with target.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
    except FileNotFoundError:
        return _blank(profile)
    except json.JSONDecodeError as error:
        raise store.StoreError(
            "infra_error",
            f"{target.name} is not valid JSON: {error}",
            f"repair or delete {target} — deleting it starts with no scenes",
        ) from error
    if not isinstance(data, dict) or not isinstance(data.get("scenes"), list):
        raise store.StoreError(
            "infra_error",
            f"{target.name} has no scenes array",
            f"repair or delete {target} — deleting it starts with no scenes",
        )
    doc = _blank(profile)
    doc.update({key: value for key, value in data.items() if key != "scenes"})
    doc["scenes"] = [scene for scene in data["scenes"] if isinstance(scene, dict)]
    return doc


def save(profile: dict, doc: dict) -> None:
    """Write the scene file atomically, so a crash cannot truncate it."""
    target = path_of(profile)
    target.parent.mkdir(parents=True, exist_ok=True)
    doc["schemaVersion"] = SCHEMA_VERSION
    doc["updatedAt"] = _now()
    temporary = target.with_suffix(".json.tmp")
    with temporary.open("w", encoding="utf-8") as handle:
        json.dump(doc, handle, indent=2, ensure_ascii=False)
        handle.write("\n")
    os.replace(temporary, target)
    try:
        os.chmod(target, 0o600)
    except OSError:  # pragma: no cover - a filesystem without POSIX modes
        pass


def _uuid(name: str) -> str:
    return "s_" + hashlib.sha1(name.casefold().encode("utf-8")).hexdigest()[:6]


def _table_list(tables) -> list[str]:
    """Deduplicate the table names, keeping the spelling the user typed.

    Case is folded for the comparison only: a scene naming `T_ORDER` and a trace
    asked about `t_order` are talking about the same table, and the panel should
    not create a second entry because of it.
    """
    if isinstance(tables, str):
        tables = [piece.strip() for piece in tables.replace(",", "\n").splitlines()]
    if not isinstance(tables, (list, tuple)):
        raise store.StoreError(
            "user_error",
            "tables must be a list of table names",
            "pass tables as an array, for example [\"t_order\", \"t_trans\"]",
        )
    seen: set[str] = set()
    chosen: list[str] = []
    for item in tables:
        text = str(item or "").strip()
        if not text:
            continue
        key = text.casefold()
        if key in seen:
            continue
        seen.add(key)
        chosen.append(text)
    if len(chosen) > TABLE_LIMIT:
        raise store.StoreError(
            "user_error",
            f"a scene holds at most {TABLE_LIMIT} tables, got {len(chosen)}",
            "narrow the scene to the tables one question actually touches",
        )
    return chosen


def list_scenes(profile: dict, with_links: bool = True) -> dict:
    """Every scene of one datasource, with the joins its members already share.

    A scene is only a table list, so on its own it says nothing about how those
    tables connect — an agent reading it would still have to guess or look at the
    whole graph. The two extra fields close that gap without giving the scene any
    authority over edges: `edges` is a read-only projection of the relation graph
    restricted to this scene's members, and `isolated` names the members that no
    confirmed join reaches. Both are derived on every call, never stored.

    `with_links=False` skips the graph read for callers that only need the list.
    """
    doc = load(profile)
    scenes = doc.get("scenes") or []
    edges = []
    if with_links and scenes:
        # Imported here rather than at module scope: relations is a larger module
        # and this keeps the dependency one-way and lazy for the write paths.
        import relations

        edges = relations.load(profile).get("edges") or []
    return {
        "scenes": [_described(scene, edges) for scene in scenes],
        "total": len(scenes),
    }


def _described(scene: dict, edges: list[dict]) -> dict:
    """One scene plus the confirmed joins among its own members."""
    tables = list(scene.get("tables") or [])
    members = {_fold(name) for name in tables}
    links = []
    touched = set()
    for edge in edges:
        if str(edge.get("status") or "") not in LINK_STATUSES:
            continue
        frm = edge.get("from") or {}
        to = edge.get("to") or {}
        here = _fold(frm.get("table"))
        there = _fold(to.get("table"))
        # Both ends inside the scene: a join that leaves it is not a statement
        # about how the members relate, and the trace would not walk it anyway.
        if here not in members or there not in members:
            continue
        links.append(
            {
                "id": edge.get("id"),
                "from": {"table": frm.get("table"), "column": frm.get("column")},
                "to": {"table": to.get("table"), "column": to.get("column")},
                "status": edge.get("status"),
            }
        )
        touched.add(here)
        touched.add(there)
    links.sort(
        key=lambda link: (
            _fold(link["from"]["table"]),
            _fold(link["from"]["column"]),
            _fold(link["to"]["table"]),
            _fold(link["to"]["column"]),
        )
    )
    isolated = [name for name in tables if _fold(name) not in touched]
    return {
        "id": scene.get("id"),
        "name": scene.get("name"),
        "tables": tables,
        "tableCount": len(tables),
        "note": scene.get("note"),
        "createdAt": scene.get("createdAt"),
        "updatedAt": scene.get("updatedAt"),
        "edges": links,
        "isolated": isolated,
    }


def find(doc: dict, target: str) -> dict:
    wanted = str(target or "").strip()
    if not wanted:
        raise store.StoreError("user_error", "scene is required", "pass a scene name or id")
    for scene in doc.get("scenes") or []:
        if str(scene.get("id")) == wanted:
            return scene
    for scene in doc.get("scenes") or []:
        if str(scene.get("name") or "").casefold() == wanted.casefold():
            return scene
    known = ", ".join(str(scene.get("name")) for scene in doc.get("scenes") or []) or "none yet"
    raise store.StoreError(
        "user_error",
        f"unknown scene: {target}",
        f"known scenes: {known}",
    )


def resolve(profile: dict, target) -> dict | None:
    """The scene a trace was asked for, or None when no scene was named."""
    text = str(target or "").strip()
    if not text:
        return None
    return find(load(profile), text)


def table_set(scene: dict | None) -> set[str] | None:
    """Folded table names of a scene; None means "no scene, the whole graph"."""
    if not scene:
        return None
    return {str(table).casefold() for table in scene.get("tables") or [] if str(table).strip()}


def save_scene(
    profile: dict,
    name: str,
    tables,
    note: str | None = None,
    scene_id: str | None = None,
) -> dict:
    """Create a scene, or replace the tables of the one this name already owns.

    Saving by name means the panel does not have to track ids to rename a scene's
    table list, and saving the same name twice updates instead of piling up
    duplicates that then disagree about which one a trace uses.
    """
    wanted = str(name or "").strip()
    if not wanted:
        raise store.StoreError(
            "user_error",
            "a scene needs a name",
            "give it the name of the question it answers, for example the order-to-cash tables",
        )
    chosen = _table_list(tables)
    if not chosen:
        raise store.StoreError(
            "user_error",
            "a scene needs at least one table",
            "list the tables this question touches",
        )
    doc = load(profile)
    scenes = doc.get("scenes") or []
    now = _now()
    target_id = str(scene_id or "").strip() or _uuid(wanted)
    for scene in scenes:
        same_id = str(scene.get("id")) == target_id
        same_name = str(scene.get("name") or "").casefold() == wanted.casefold()
        if same_id or same_name:
            scene["name"] = wanted
            scene["tables"] = chosen
            if note is not None:
                scene["note"] = str(note).strip() or None
            scene["updatedAt"] = now
            doc["scenes"] = scenes
            save(profile, doc)
            return {"scene": scene, "created": False}
    if len(scenes) >= SCENE_LIMIT:
        raise store.StoreError(
            "user_error",
            f"this datasource already holds {SCENE_LIMIT} scenes",
            "delete one you no longer trace through",
        )
    scene = {
        "id": target_id,
        "name": wanted,
        "tables": chosen,
        "note": str(note).strip() if note else None,
        "createdAt": now,
        "updatedAt": now,
    }
    scenes.append(scene)
    doc["scenes"] = scenes
    save(profile, doc)
    return {"scene": scene, "created": True}


def delete_scene(profile: dict, scene_id: str) -> dict:
    """Remove one scene. The relation graph is untouched — it never lived here."""
    doc = load(profile)
    scene = find(doc, scene_id)
    doc["scenes"] = [
        candidate for candidate in doc.get("scenes") or [] if candidate.get("id") != scene.get("id")
    ]
    save(profile, doc)
    return {"deleted": scene.get("id"), "name": scene.get("name")}
