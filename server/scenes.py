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
import uuid
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

# How a scene stage locates its rows. `edge` follows a confirmed join; `alias`
# locates straight on a business key; `weak` is a deliberately loose association
# that is never used as a walk seed (phase C).
LOCATE_KINDS = ("edge", "alias", "weak")
STAGE_LIMIT = 50
DISPLAY_COLUMN_LIMIT = 4

# Business-key aliases: one key name mapped to its column in several tables, so
# a value can locate a table with no foreign key between them.
ALIAS_LIMIT = 20
ALIAS_KEY_LIMIT = 50
WEAK_MATCH_LIMIT = 20
IN_VALUE_CAP = 50
WEAK_OPS = ("eq", "same_day", "within_minutes")


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
    """Legacy name-derived id — kept so pre-existing scenes still resolve."""
    return "s_" + hashlib.sha1(name.casefold().encode("utf-8")).hexdigest()[:6]


def _new_id() -> str:
    """A fresh id for a new scene: unique regardless of the name it starts with."""
    return "s_" + uuid.uuid4().hex[:10]


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


def _stage_list(stages) -> list[dict]:
    """Validate and normalise a scene's stage declarations.

    A stage is the reading order a business question implies (order, payment,
    shipment), independent of the order a breadth-first walk happens to reach
    those tables. Only the fields a trace can actually use are kept, so a typo
    cannot silently become a stage that never matches.
    """
    if stages is None:
        return []
    if isinstance(stages, str):
        try:
            stages = json.loads(stages)
        except (TypeError, ValueError) as error:
            raise store.StoreError(
                "user_error",
                "stages must be a JSON array",
                "pass stages as an array of {name, table, ...} objects",
            ) from error
    if not isinstance(stages, (list, tuple)):
        raise store.StoreError(
            "user_error",
            "stages must be a list",
            "pass stages as an array, for example [{\"name\": \"下单\", \"table\": \"sales_order\"}]",
        )
    if len(stages) > STAGE_LIMIT:
        raise store.StoreError(
            "user_error",
            f"a scene holds at most {STAGE_LIMIT} stages, got {len(stages)}",
            "keep only the stages one question actually walks through",
        )
    chosen: list[dict] = []
    for item in stages:
        if not isinstance(item, dict):
            raise store.StoreError(
                "user_error", "each stage must be an object", "pass stages as objects with a name and table"
            )
        name = str(item.get("name") or "").strip()
        table = str(item.get("table") or "").strip()
        if not name or not table:
            raise store.StoreError(
                "user_error",
                "a stage needs a name and a table",
                "give each stage a name (what the reader sees) and the table it reads",
            )
        locate = str(item.get("locate") or "edge").strip().lower()
        if locate not in LOCATE_KINDS:
            raise store.StoreError(
                "user_error",
                f"unknown stage locate kind: {locate}",
                "locate must be one of " + ", ".join(LOCATE_KINDS),
            )
        raw_columns = item.get("displayColumns") or []
        if isinstance(raw_columns, str):
            raw_columns = [piece.strip() for piece in raw_columns.replace(",", "\n").splitlines()]
        if not isinstance(raw_columns, (list, tuple)):
            raise store.StoreError(
                "user_error",
                "displayColumns must be a list of column names",
                "pass displayColumns as an array, at most 4 names",
            )
        display_columns = [str(column).strip() for column in raw_columns if str(column).strip()]
        if len(display_columns) > DISPLAY_COLUMN_LIMIT:
            raise store.StoreError(
                "user_error",
                f"a stage shows at most {DISPLAY_COLUMN_LIMIT} columns, got {len(display_columns)}",
                "pick the few columns a reader needs to recognise the row",
            )
        raw_labels = item.get("statusLabels") or {}
        if not isinstance(raw_labels, dict):
            raise store.StoreError(
                "user_error",
                "statusLabels must be an object",
                "map a stored value to the words a reader should see, for example {\"PAID\": \"已支付\"}",
            )
        status_labels = {str(key): str(value) for key, value in raw_labels.items()}
        stage = {
            "name": name,
            "table": table,
            "locate": locate,
            "displayColumns": display_columns,
            "statusLabels": status_labels,
        }
        for optional in ("statusColumn", "amountColumn", "timeColumn"):
            value = item.get(optional)
            if value is not None and str(value).strip():
                stage[optional] = str(value).strip()
        chosen.append(stage)
    return chosen


def _alias_map(aliases) -> dict:
    """Validate and normalise a scene's business-key aliases.

    An alias is one business key (a name like 流水号) mapped to the columns that
    carry that value across tables — T_A.SERIAL_NO, T_B.TRACE_NO, T_C.REF_NO.
    A value can therefore locate a table with no foreign key between them.
    Structural checks only: whether the column exists in the catalogue is a live
    question answered by `describe_aliases`, not by saving.
    """
    if aliases is None:
        return {}
    if isinstance(aliases, str):
        try:
            aliases = json.loads(aliases)
        except (TypeError, ValueError) as error:
            raise store.StoreError(
                "user_error",
                "aliases must be a JSON object",
                "pass aliases as an object of key name to [{table, column}]",
            ) from error
    if not isinstance(aliases, dict):
        raise store.StoreError(
            "user_error",
            "aliases must be an object",
            "map each business key to the columns that carry it",
        )
    if len(aliases) > ALIAS_LIMIT:
        raise store.StoreError(
            "user_error",
            f"a scene holds at most {ALIAS_LIMIT} aliases, got {len(aliases)}",
            "keep only the keys this question actually matches on",
        )
    chosen: dict[str, list[dict]] = {}
    total = 0
    for key, columns in aliases.items():
        name = str(key or "").strip()
        if not name:
            raise store.StoreError(
                "user_error", "an alias needs a name", "name the business key, for example 流水号"
            )
        # A {table: column} object is a convenient shorthand for [{table, column}].
        if isinstance(columns, dict):
            columns = [{"table": table, "column": column} for table, column in columns.items()]
        if not isinstance(columns, (list, tuple)):
            raise store.StoreError(
                "user_error",
                f"alias {name} must be a list of columns",
                "pass [{table, column}] for each table that carries the key",
            )
        entries: list[dict] = []
        for item in columns:
            if isinstance(item, (list, tuple)) and len(item) == 2:
                item = {"table": item[0], "column": item[1]}
            if not isinstance(item, dict):
                raise store.StoreError(
                    "user_error",
                    f"alias {name} has a malformed column",
                    "each column is {table, column}",
                )
            table = str(item.get("table") or "").strip()
            column = str(item.get("column") or "").strip()
            if not table or not column:
                raise store.StoreError(
                    "user_error",
                    f"alias {name} has a column without a table or column name",
                    "give each entry both a table and a column",
                )
            entries.append({"table": table, "column": column})
        if not entries:
            raise store.StoreError(
                "user_error",
                f"alias {name} has no columns",
                "list at least one table.column that carries this key",
            )
        total += len(entries)
        chosen[name] = entries
    if total > ALIAS_KEY_LIMIT:
        raise store.StoreError(
            "user_error",
            f"a scene holds at most {ALIAS_KEY_LIMIT} alias columns, got {total}",
            "keep only the columns this question actually matches on",
        )
    return chosen


def _input_alias(value) -> str | None:
    """The alias the panel input supplies, or None when there is none."""
    return str(value or "").strip() or None


def _weak_match_list(weak) -> list[dict]:
    """Validate loose column-pair matches. These never seed the walk."""
    if weak is None:
        return []
    if isinstance(weak, str):
        try:
            weak = json.loads(weak)
        except (TypeError, ValueError) as error:
            raise store.StoreError(
                "user_error",
                "weakMatch must be a JSON array",
                "pass weakMatch as [{fromStage, fromColumn, toColumn, op}]",
            ) from error
    if not isinstance(weak, (list, tuple)):
        raise store.StoreError(
            "user_error",
            "weakMatch must be a list",
            "pass weakMatch as [{fromStage, fromColumn, toColumn, op}]",
        )
    if len(weak) > WEAK_MATCH_LIMIT:
        raise store.StoreError(
            "user_error",
            f"a scene holds at most {WEAK_MATCH_LIMIT} weak matches, got {len(weak)}",
            "keep only the loose matches a reader actually needs",
        )
    chosen: list[dict] = []
    for item in weak:
        if not isinstance(item, dict):
            raise store.StoreError(
                "user_error", "each weak match must be an object", "pass fromStage, fromColumn, toColumn and op"
            )
        from_stage = str(item.get("fromStage") or "").strip()
        from_column = str(item.get("fromColumn") or "").strip()
        to_column = str(item.get("toColumn") or "").strip()
        raw_op = str(item.get("op") or "eq").strip().lower()
        if not from_stage or not from_column or not to_column:
            raise store.StoreError(
                "user_error",
                "a weak match needs fromStage, fromColumn and toColumn",
                "name the stage whose row supplies the value, and the column to compare",
            )
        minutes = None
        if raw_op.startswith("within_minutes"):
            if "(" in raw_op:
                try:
                    minutes = int(raw_op.split("(", 1)[1].split(")")[0])
                except ValueError as error:
                    raise store.StoreError(
                        "user_error",
                        "within_minutes needs a whole number",
                        "for example within_minutes(30)",
                    ) from error
                raw_op = "within_minutes"
            if minutes is None:
                minutes = 60
            if minutes <= 0:
                raise store.StoreError(
                    "user_error", "within_minutes must be positive", "for example within_minutes(30)"
                )
        elif raw_op not in ("eq", "same_day"):
            raise store.StoreError(
                "user_error",
                f"unknown weak match op: {raw_op}",
                "op must be eq, same_day or within_minutes(N)",
            )
        match = {"fromStage": from_stage, "fromColumn": from_column, "toColumn": to_column, "op": raw_op}
        if minutes is not None:
            match["minutes"] = minutes
        chosen.append(match)
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
    # The one cost fact a scene can state without asking the database: how many of
    # its joins point at a table that would be scanned whole. It is read off the
    # edge facts already on disk (index flag, row estimate, recent samples), so
    # opening or saving a scene never runs a statement to find out.
    import relations

    costly = []
    for edge in edges:
        if str(edge.get("status") or "") not in LINK_STATUSES:
            continue
        if _fold((edge.get("from") or {}).get("table")) not in members:
            continue
        if _fold((edge.get("to") or {}).get("table")) not in members:
            continue
        cost = relations.cost_of(edge)
        if cost.get("needsConfirm"):
            costly.append(
                {
                    "edge": edge.get("id"),
                    "table": (edge.get("to") or {}).get("table"),
                    "column": (edge.get("to") or {}).get("column"),
                    "rowEstimate": cost.get("rowEstimate"),
                    "reason": relations.why_confirm(edge),
                }
            )
    stages = _stage_list(scene.get("stages"))
    aliases = _alias_map(scene.get("aliases"))
    weak = _weak_match_list(scene.get("weakMatch"))
    stage_names = {_fold(stage["name"]) for stage in stages}
    # Structural staleness we can answer without the catalogue: an alias column
    # on a table that is no longer a member, or a weak match whose fromStage is
    # gone. Column-level staleness (the column was dropped) needs a live read and
    # is reported by `describe_aliases`.
    members = {_fold(name) for name in tables}
    for key, columns in aliases.items():
        for column in columns:
            column["stale"] = _fold(column["table"]) not in members
    for match in weak:
        match["stale"] = _fold(match["fromStage"]) not in stage_names
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
        "costly": costly,
        "stages": stages,
        "aliases": aliases,
        "inputAlias": _input_alias(scene.get("inputAlias")),
        "weakMatch": weak,
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
    stages=None,
    aliases=None,
    input_alias=None,
    weak_match=None,
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
    # Stages are optional; passing None leaves an existing scene's stages alone,
    # while an explicit [] clears them (an empty list is a decision, not an omission).
    if stages is None:
        stage_update = None
    else:
        stage_update = _stage_list(stages)
        stage_names = {_fold(stage["table"]) for stage in stage_update}
        stray = [name for name in stage_names if name not in {_fold(table) for table in chosen}]
        if stray:
            raise store.StoreError(
                "user_error",
                "stages reference tables outside the scene: " + ", ".join(stray),
                "add those tables to the scene first, or remove the stages",
            )
    # Phase C: aliases, the entry alias and loose matches are all optional. None
    # leaves an existing scene's values alone; an explicit empty value clears them.
    alias_update = _alias_map(aliases) if aliases is not None else None
    weak_update = _weak_match_list(weak_match) if weak_match is not None else None
    # An empty string is a caller saying "there is no entry alias", which must
    # clear it; only None means "did not ask". Collapsing both to None would
    # make the panel unable to drop the input key, and removing that key would
    # then fail validation as an alias the scene no longer carries.
    input_update = (_input_alias(input_alias) or "") if input_alias is not None else None
    members = {_fold(table) for table in chosen}
    if alias_update:
        for key, columns in alias_update.items():
            stray = [f"{c['table']}.{c['column']}" for c in columns if _fold(c["table"]) not in members]
            if stray:
                raise store.StoreError(
                    "user_error",
                    f"alias {key} references tables outside the scene: " + ", ".join(stray),
                    "add those tables to the scene first, or remove those columns",
                )
    doc = load(profile)
    scenes = doc.get("scenes") or []
    now = _now()
    # A new scene gets a fresh random id, not a hash of its name: renaming an
    # old scene keeps that id (so an in-flight panel still finds it), and the
    # freed-up name must be available for a genuinely NEW scene. Reusing the
    # name's hash made the second "订单" match the renamed "退款" and overwrite
    # it. Old hash ids in existing files keep working — they are never rewritten.
    target_id = str(scene_id or "").strip() or _new_id()

    def apply_fields(scene: dict, creating: bool) -> None:
        """Write all optional fields onto a scene, then validate their links."""
        scene["name"] = wanted
        scene["tables"] = chosen
        if note is not None:
            scene["note"] = str(note).strip() or None
        if stage_update is not None:
            if stage_update:
                scene["stages"] = stage_update
            else:
                scene.pop("stages", None)
        if alias_update is not None:
            if alias_update:
                scene["aliases"] = alias_update
            else:
                scene.pop("aliases", None)
        if weak_update is not None:
            if weak_update:
                scene["weakMatch"] = weak_update
            else:
                scene.pop("weakMatch", None)
        if input_update is not None:
            if input_update:
                scene["inputAlias"] = input_update
            else:
                scene.pop("inputAlias", None)
        # A stage that locates by alias can only be filled by the entry alias
        # with the scene input value. Structural checks only — type compatibility
        # is a live question answered by preview_aliases.
        stages_now = scene.get("stages") or []
        if any(stage.get("locate") == "alias" for stage in stages_now):
            alias_now = scene.get("aliases") or {}
            input_now = scene.get("inputAlias")
            if not input_now:
                raise store.StoreError(
                    "user_error",
                    "a stage locates by alias but the scene has no inputAlias",
                    "set inputAlias to the key the panel input supplies",
                )
            if input_now not in alias_now:
                raise store.StoreError(
                    "user_error",
                    f"inputAlias {input_now} is not one of the scene's aliases",
                    "name one of the keys in aliases as the input alias",
                )
        # A weak match names a source stage and a target as `table.column`. Both
        # ends must be real: the fromStage must be declared, and the target table
        # must be a member of this scene (a scene holds no edges, so there is no
        # other place to check the target against).
        weak_now = scene.get("weakMatch") or []
        if weak_now:
            stage_names = {_fold(stage.get("name") or "") for stage in stages_now}
            members_now = {_fold(table) for table in chosen}
            for match in weak_now:
                source = str(match.get("fromStage") or "")
                if _fold(source) not in stage_names:
                    raise store.StoreError(
                        "user_error",
                        f"weak match names an unknown stage: {source}",
                        "fromStage must be one of this scene's stages",
                    )
                target = str(match.get("toColumn") or "")
                if "." not in target:
                    raise store.StoreError(
                        "user_error",
                        f"weak match target is not table.column: {target}",
                        "write the target as table.column, e.g. t_trans.paid_at",
                    )
                target_table, _, _ = target.partition(".")
                if _fold(target_table) not in members_now:
                    raise store.StoreError(
                        "user_error",
                        f"weak match target table is not in the scene: {target_table}",
                        "add that table to the scene, or point the match at a member",
                    )
        scene["updatedAt"] = now

    asked_id = str(scene_id or "").strip()
    if asked_id:
        # An explicit id means this is a rename. Check the whole file first: if a
        # DIFFERENT scene already carries the wanted name, refuse rather than
        # produce two scenes with one name. A plain save without an id keeps the
        # old behaviour — saving an existing name updates that scene.
        for scene in scenes:
            same_id = str(scene.get("id")) == target_id
            same_name = str(scene.get("name") or "").casefold() == wanted.casefold()
            if same_name and not same_id:
                raise store.StoreError(
                    "user_error",
                    f"another scene is already named {scene.get('name')}",
                    "rename this scene to a name that is not already used",
                )
    for scene in scenes:
        same_id = str(scene.get("id")) == target_id
        same_name = str(scene.get("name") or "").casefold() == wanted.casefold()
        if same_id or same_name:
            apply_fields(scene, creating=False)
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
        "note": str(note).strip() if note else None,
        "createdAt": now,
    }
    apply_fields(scene, creating=True)
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
