"""Trace one value through the relation graph.

The walker is deliberately dumb. It never invents a join: it only follows edges
somebody confirmed, it reads rows with bound parameters, and it reports every
place the walk stopped instead of quietly returning a shorter answer.

Two rules keep the output honest:

* a value never enters the SQL text. `fetch_matching` binds it, so the statement
  reported next to a step is the statement that ran, and a value containing a
  quote cannot change it.
* a step that found nothing is a step. `status: "empty"` is the chain breaking,
  and the caller sees it instead of a silently missing branch.
"""

from __future__ import annotations

import time
from collections import deque

import engines
import relations
import scenes
import store

MAX_DEPTH_LIMIT = 6
MAX_ROWS_LIMIT = 200
MAX_STEPS = 200
PROBE_COLUMNS = 8
PROBE_ROWS = 5
PROBE_SECONDS = 3.0
SAMPLE_ROWS = 10
SAMPLE_COLUMNS = 6

# Only these two are walked. A pending edge is a suggestion nobody confirmed, and
# a rejected one is on the blacklist; following either would make the trace
# assert joins the graph itself does not claim.
WALK_STATUSES = ("confirmed", "trusted")
DIRECTIONS = ("down", "up", "both")

# The status a step carries when the walker stopped to ask instead of paying for
# a full table scan. It is not an error and not a hit: nothing ran.
NEEDS_CONFIRM = "needs_confirm"


def _clamp(value, low: int, high: int, default: int) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return default
    return max(low, min(high, number))


def _fold(text) -> str:
    return str(text or "").casefold()


def _direction(value) -> str:
    text = str(value or "").strip().lower() or "both"
    if text not in DIRECTIONS:
        raise store.StoreError(
            "user_error",
            f"unknown direction: {value}",
            "use one of: " + ", ".join(DIRECTIONS),
        )
    return text


def _edge_summary(edge: dict) -> dict:
    return {
        "id": edge.get("id"),
        "source": edge.get("source"),
        "status": edge.get("status"),
        "from": dict(edge.get("from") or {}),
        "to": dict(edge.get("to") or {}),
        # The cost facts travel with every step, so the panel can label it without
        # a second round trip.
        "cost": relations.cost_of(edge),
    }


def _walkable(edges) -> list[dict]:
    return [edge for edge in edges if edge.get("status") in WALK_STATUSES]


def _incident(edges, table: str) -> list[tuple]:
    """Edges touching `table`, each with the endpoint on that table's side.

    The tuple is (edge, side, here, there): `here` is the endpoint in `table`,
    `there` the endpoint in the other table. `side` says which side of the edge
    `table` sits on, which is what the direction filter needs.

    A self-reference (`ticket.parent_id -> ticket.id`) touches the same table on
    both sides, so it is reported twice — once per side. Reporting only the
    `from` side would make every parent/child hierarchy untraceable, because the
    walker would never see the half that leads to the children.
    """
    wanted = _fold(table)
    found = []
    for edge in edges:
        frm = edge.get("from") or {}
        to = edge.get("to") or {}
        on_from = _fold(frm.get("table")) == wanted
        on_to = _fold(to.get("table")) == wanted
        if on_from:
            found.append((edge, "from", frm, to))
        if on_to:
            found.append((edge, "to", to, frm))
    return found


def _follows(side: str, direction: str) -> bool:
    """Whether a hop off `side` is allowed in `direction`.

    `to` is the referenced side (the one side), so leaving it walks towards the
    rows that point at it — `down`, the direction data flows. `from` holds the
    value, so leaving it follows the foreign key to the row it names — `up`.
    """
    if side == "to":
        return direction in ("down", "both")
    return direction in ("up", "both")


def _column_index(columns, name):
    wanted = _fold(name)
    for index, label in enumerate(columns):
        if _fold(label) == wanted:
            return index
    return None


def _entry_tables(edges) -> list[str]:
    """Tables worth probing for an entry point, most connected first.

    A table nobody joins to is a bad guess, so the order follows how many edges
    touch a table. Ties go by name to keep the report stable.
    """
    tally: dict[str, int] = {}
    spelling: dict[str, str] = {}
    for edge in edges:
        for endpoint in (edge.get("from") or {}, edge.get("to") or {}):
            table = endpoint.get("table")
            if not table:
                continue
            key = _fold(table)
            tally[key] = tally.get(key, 0) + 1
            spelling.setdefault(key, str(table))
    order = sorted(tally, key=lambda key: (-tally[key], key))
    return [spelling[key] for key in order]


def _known_columns(edges, table: str) -> list[str]:
    """Columns of `table` that an edge already points at."""
    wanted = _fold(table)
    names = []
    for edge in edges:
        for endpoint in (edge.get("from") or {}, edge.get("to") or {}):
            if _fold(endpoint.get("table")) == wanted and endpoint.get("column"):
                names.append(str(endpoint["column"]))
    return names


def _probe(profile, connection, edges, value, entry_table, entry_column, tables=None):
    """Find where the value enters. Returns (picked, candidates, warnings).

    `tables` restricts the search to a scene. A value usually lives in more than
    one column — an order id is on the order, its lines and its payments — so every
    column that held it is reported with how many rows it held, and the first one
    is the one the walk starts from. The caller chooses between them instead of
    the walker guessing and hiding the alternatives.
    """
    warnings = []
    candidates: list[dict] = []
    if entry_table:
        candidates = engines.entry_candidates(
            profile,
            connection,
            entry_table,
            column=entry_column,
            value=value,
            known=_known_columns(edges, entry_table),
            limit=PROBE_COLUMNS,
        )
    else:
        order = _entry_tables(edges)
        if tables is not None:
            kept = [table for table in order if _fold(table) in tables]
            if kept:
                order = kept
            else:
                warnings.append(
                    {
                        "code": "scene_empty",
                        "message": (
                            "no table of the scene carries a join — name the entry "
                            "table and column, or widen the scene"
                        ),
                    }
                )
                order = []
        for table in order:
            candidates.extend(
                engines.entry_candidates(
                    profile,
                    connection,
                    table,
                    value=value,
                    known=_known_columns(edges, table),
                    limit=PROBE_COLUMNS,
                )
            )
            if len(candidates) >= PROBE_COLUMNS:
                break
    started = time.perf_counter()
    tried = []
    for candidate in candidates[:PROBE_COLUMNS]:
        if time.perf_counter() - started > PROBE_SECONDS:
            warnings.append(
                {
                    "code": "probe_timeout",
                    "message": (
                        f"stopped probing after {PROBE_SECONDS:g}s; "
                        "name the entry table and column to skip the search"
                    ),
                }
            )
            break
        entry = dict(candidate)
        entry["matches"] = 0
        tried.append(entry)
        try:
            found = engines.fetch_matching(
                profile,
                connection,
                candidate["table"],
                candidate["column"],
                [value],
                PROBE_ROWS,
            )
        except engines.DbError as error:
            warnings.append(
                {
                    "code": "probe_failed",
                    "message": f"{candidate['table']}.{candidate['column']}: {error}",
                }
            )
            continue
        entry["matches"] = len(found["rows"])
        entry["truncated"] = bool(found.get("truncated"))
        if found["rows"]:
            return entry, tried, warnings
    return None, tried, warnings


def _sample(columns, rows, primary, current_column) -> dict:
    """A few readable cells per row: the keys first, then the rest."""
    if not rows:
        return {"columns": [], "rows": []}
    preferred = []
    for name in list(primary or []) + [current_column]:
        if name and _column_index(columns, name) is not None and _fold(name) not in {
            _fold(item) for item in preferred
        }:
            preferred.append(name)
    chosen = list(preferred)
    for label in columns:
        if len(chosen) >= SAMPLE_COLUMNS:
            break
        if _fold(label) not in {_fold(item) for item in chosen}:
            chosen.append(label)
    indexes = [index for index in (_column_index(columns, name) for name in chosen) if index is not None]
    return {
        "columns": [columns[index] for index in indexes],
        "rows": [[row[index] for index in indexes] for row in rows[:SAMPLE_ROWS]],
    }


def _nodes(steps) -> list[dict]:
    """The walk as a tree, keeping the flat `steps` list as the source of truth.

    A step already carries everything a node shows; the tree is just the parent
    link and the child list, so the panel can indent without re-deriving the
    shape from `parent` indexes itself.
    """
    by_index = {step["index"]: step for step in steps}
    children: dict[int, list[int]] = {}
    roots: list[int] = []
    for step in steps:
        parent = step.get("parent")
        if parent and parent in by_index:
            children.setdefault(parent, []).append(step["index"])
        else:
            roots.append(step["index"])

    def node_of(index: int) -> dict:
        step = by_index[index]
        return {
            "index": index,
            "parent": step.get("parent"),
            "depth": step.get("depth"),
            "table": step.get("table"),
            "schema": step.get("schema"),
            "column": (step.get("condition") or {}).get("column"),
            # The panel shows the bound values, the sample rows and the statement
            # straight off the node; without them it can only print a placeholder
            # dash for every step, which is exactly what made the tree unreadable.
            "condition": step.get("condition"),
            "sql": step.get("sql"),
            "sample": step.get("sample"),
            "rows": step.get("rows"),
            "status": step.get("status"),
            "truncated": step.get("truncated"),
            "inside": step.get("inside", True),
            "ms": step.get("ms"),
            "fanout": step.get("fanout"),
            "edge": step.get("edge"),
            "note": step.get("note"),
            "cost": step.get("cost"),
            "confirmed": step.get("confirmed", False),
            "timedOut": step.get("timedOut", False),
            "children": [node_of(child) for child in children.get(index, [])],
        }

    return [node_of(index) for index in roots]


def _convert_binding(value, family):
    """Coerce one bind value into a target column's family.

    The rule lives in `engines.bind_value` so a trace bind and a preview bind can
    never drift apart: char and date values stay text (so a leading-zero business
    key keeps its zeros), a numeric target gets a real number, and a value that
    cannot be coerced returns None — the caller skips that key with a warning
    rather than failing the whole walk.
    """
    return engines.bind_value(value, family)


def _column_family(info: dict, column: str) -> str:
    for item in (info.get("columns") or []):
        if _fold(item.get("name")) == _fold(column):
            return engines.column_family(item.get("type"))
    return "any"


def _alias_rows(
    profile, connection, chosen_scene, text, row_limit, describe, warnings
) -> list[dict]:
    """Locate alias stages straight on the scene's input business key.

    Only the input alias is used, with the scene input value (decision 3): an
    alias stage never depends on a graph edge, so it still runs when the edge
    chain breaks. Each query is bounded by LIMIT and the statement timeout; a
    timeout becomes a flagged, incomplete stage rather than a silent zero.
    """
    if not chosen_scene:
        return []
    declared = scenes._stage_list(chosen_scene.get("stages"))
    aliases = chosen_scene.get("aliases") or {}
    input_alias = chosen_scene.get("inputAlias")
    if not any(stage.get("locate") == "alias" for stage in declared):
        return []
    if not input_alias or input_alias not in aliases:
        return []
    rows: list[dict] = []
    for stage in declared:
        if stage.get("locate") != "alias":
            continue
        table = stage["table"]
        targets = [c for c in aliases[input_alias] if _fold(c.get("table")) == _fold(table)]
        if not targets:
            warnings.append(
                {
                    "code": "alias_no_column",
                    "message": f"stage {stage['name']}: input alias {input_alias!r} has no column on {table}",
                }
            )
            continue
        binds = []
        columns_used = []
        for target in targets:
            column = target["column"]
            info = describe(table)
            value = _convert_binding(text, _column_family(info, column))
            if value is None:
                warnings.append(
                    {
                        "code": "alias_bind_failed",
                        "message": f"{table}.{column}: could not convert {text!r} for this column; skipped",
                    }
                )
                continue
            binds.append(value)
            columns_used.append(column)
        if not binds:
            continue
        # One query per distinct column; combine the results into one stage.
        combined = {"columns": [], "rows": [], "sql": "", "truncated": False}
        timed_out = False
        total_ms = 0
        for column, value in zip(columns_used, binds):
            started = time.perf_counter()
            try:
                found = engines.fetch_matching(
                    profile, connection, table, column, [value], row_limit
                )
            except engines.DbError as error:
                if engines._is_timeout(error):
                    timed_out = True
                    warnings.append(
                        {
                            "code": "alias_timeout",
                            "message": f"{table}.{column}: the alias lookup timed out; stage left incomplete",
                        }
                    )
                else:
                    warnings.append(
                        {"code": "alias_failed", "message": f"{table}.{column}: {error}"}
                    )
                continue
            if not combined["columns"]:
                combined["columns"] = found["columns"]
            for row in found["rows"]:
                if row not in combined["rows"]:
                    combined["rows"].append(row)
            combined["sql"] = combined["sql"] + ("\n" if combined["sql"] else "") + found["sql"]
            combined["truncated"] = combined["truncated"] or found["truncated"]
            total_ms += int((time.perf_counter() - started) * 1000)
        rows.append(
            {
                "stage": stage["name"],
                "table": table,
                "locate": "alias",
                "found": len(combined["rows"]),
                "missed": not combined["rows"] and not timed_out,
                "incomplete": timed_out,
                "matchRule": f"input alias {input_alias}",
                "parent": None,
                "step": None,
                "sample": _sample(combined["columns"], combined["rows"], [], columns_used[0]),
                "sql": combined["sql"],
                "ms": total_ms,
                "truncated": combined["truncated"],
                "display": stage.get("displayColumns", []),
                "statusLabels": stage.get("statusLabels", {}),
                "amountColumn": stage.get("amountColumn"),
                "timeColumn": stage.get("timeColumn"),
                "statusColumn": stage.get("statusColumn"),
            }
        )
    return rows


def _weak_rows(
    profile, connection, chosen_scene, declared, stage_steps, warnings
) -> list[dict]:
    """Read loose (weak) stage matches without feeding them back into the walk.

    Weak rows are not BFS seeds, are not counted in the hit tables, and never
    write a relation edge (decision 2). They are read with a bounded scan and a
    statement timeout, filtered in Python by the declared op, and carry the
    match rule text so a reader can see why they are only weak.
    """
    if not chosen_scene or not declared:
        return []
    weak = chosen_scene.get("weakMatch") or []
    if not weak:
        return []
    by_name = {stage["name"]: stage for stage in declared}
    rows: list[dict] = []
    for match in weak:
        stage = by_name.get(match.get("fromStage"))
        if stage is None:
            continue
        # toColumn is "table.column"; the stage whose table it names is the one
        # this weak match fills. A loose match between two declared stages is
        # reported on the destination stage.
        dest_table, dest_column = _split_table_column(match.get("toColumn"))
        if not dest_table or not dest_column:
            warnings.append(
                {"code": "weak_bad_column", "message": f"weak match {match!r} has no table.column target"}
            )
            continue
        dest_stage = next(
            (s for s in declared if _fold(s["table"]) == _fold(dest_table)), None
        )
        source = stage_steps.get(stage["name"])
        if not source:
            continue
        op = match.get("op")
        minutes = match.get("minutes") or 60
        rule_text = _weak_rule(match, op, minutes)
        # Source values come from the fromStage hit rows.
        src_values = _row_values(source, match.get("fromColumn"))
        if not src_values:
            continue
        started = time.perf_counter()
        try:
            found = engines.scan_bounded(
                profile, connection, dest_table, scenes.IN_VALUE_CAP
            )
        except engines.DbError as error:
            flag = engines._is_timeout(error)
            warnings.append(
                {
                    "code": "weak_timeout" if flag else "weak_failed",
                    "message": f"{dest_table}: weak lookup {'timed out; stage left incomplete' if flag else str(error)}",
                }
            )
            rows.append(
                {
                    "stage": (dest_stage or {}).get("name", dest_table),
                    "table": dest_table,
                    "locate": "weak",
                    "found": 0,
                    "missed": False,
                    "incomplete": flag,
                    "matchRule": rule_text,
                    "parent": stage["name"],
                    "step": None,
                    "sample": {"columns": [], "rows": []},
                    "sql": "",
                    "ms": int((time.perf_counter() - started) * 1000),
                    "truncated": False,
                    "weak": True,
                }
            )
            continue
        col_index = _column_index(found["columns"], dest_column)
        matched = []
        if col_index is not None:
            for row in found["rows"]:
                if col_index >= len(row):
                    continue
                if _weak_compare(row[col_index], src_values, op, minutes):
                    matched.append(row)
        rows.append(
            {
                "stage": (dest_stage or {}).get("name", dest_table),
                "table": dest_table,
                "locate": "weak",
                "found": len(matched),
                "missed": not matched,
                "weak": True,
                "matchRule": rule_text,
                "parent": stage["name"],
                "step": None,
                "sample": _sample(found["columns"], matched, [], dest_column),
                "sql": found["sql"],
                "ms": int((time.perf_counter() - started) * 1000),
                "truncated": found["truncated"],
                "inValues": src_values[: scenes.IN_VALUE_CAP],
                "inTruncated": len(src_values) > scenes.IN_VALUE_CAP,
            }
        )
    return rows


def _split_table_column(value):
    text = str(value or "").strip()
    if "." not in text:
        return None, None
    table, column = text.rsplit(".", 1)
    return table.strip(), column.strip()


def _row_values(source, column):
    sample = source.get("sample") or {}
    columns = [str(name) for name in (sample.get("columns") or [])]
    index = _column_index(columns, column)
    if index is None:
        return []
    values = []
    for row in sample.get("rows") or []:
        if index < len(row) and row[index] is not None and str(row[index]) not in {str(v) for v in values}:
            values.append(row[index])
    return values


def _weak_compare(candidate, sources, op, minutes):
    if candidate is None:
        return False
    for source in sources:
        if op == "eq":
            if str(candidate) == str(source):
                return True
        elif op == "same_day":
            if str(candidate)[:10] == str(source)[:10]:
                return True
        elif op == "within_minutes":
            try:
                import datetime
                a = datetime.datetime.fromisoformat(str(candidate)[:19])
                b = datetime.datetime.fromisoformat(str(source)[:19])
                if abs((a - b).total_seconds()) <= minutes * 60:
                    return True
            except (ValueError, TypeError):
                continue
    return False


def _weak_rule(match, op, minutes):
    parts = [f"{match.get('fromStage')}.{match.get('fromColumn')} → {match.get('toColumn')}"]
    if op == "same_day":
        parts.append("same day")
    elif op == "within_minutes":
        parts.append(f"within {minutes} minutes")
    else:
        parts.append("equal")
    return " + ".join(parts)


def _stage_display(stage, sample):
    """Pull the reader-facing cells out of one sample for a declared stage."""
    columns = [str(name) for name in (sample.get("columns") or [])]
    first_row = (sample.get("rows") or [None])[0]
    display = {}
    if first_row is not None:
        for name in stage.get("displayColumns", []):
            for index, column in enumerate(columns):
                if _fold(column) == _fold(name):
                    display[name] = first_row[index] if index < len(first_row) else None
                    break
    status_value = None
    status_text = None
    status_column = stage.get("statusColumn")
    if status_column:
        for index, column in enumerate(columns):
            if _fold(column) == _fold(status_column):
                status_value = first_row[index] if first_row and index < len(first_row) else None
                status_text = stage.get("statusLabels", {}).get(str(status_value), status_value)
                break
    amount = None
    amount_column = stage.get("amountColumn")
    if amount_column:
        for index, column in enumerate(columns):
            if _fold(column) == _fold(amount_column):
                amount = first_row[index] if first_row and index < len(first_row) else None
                break
    when = None
    time_column = stage.get("timeColumn")
    if time_column:
        for index, column in enumerate(columns):
            if _fold(column) == _fold(time_column):
                when = first_row[index] if first_row and index < len(first_row) else None
                break
    return display, status_text, status_value, amount, when


def _stage_view(chosen_scene, steps, alias_rows=None, weak_rows=None) -> dict | None:
    """The walk read in the scene's business order, one row per declared stage.

    The BFS walk answers "what value reaches what", which is the right shape for a
    free trace but not for a reader following an order through payment and
    shipment. Where the scene declares stages, this groups the steps by table in
    declaration order: the same hit is never printed twice, a stage the walk did
    not reach becomes a grey placeholder, and the expensive detail (SQL, binds,
    timing, edge) stays on the step for the panel to unfold on demand.

    With Phase C a stage's declared `locate` decides where its row comes from:
    `edge` uses the BFS step, `alias` the input-alias lookup, `weak` the loose
    match. Only one of them is read per table (decision 9), so a table reachable
    both ways is never reported twice.
    """
    if not chosen_scene:
        return None
    declared = scenes._stage_list(chosen_scene.get("stages"))
    if not declared:
        return None
    alias_by_name = {row["stage"]: row for row in (alias_rows or [])}
    weak_by_name = {row["stage"]: row for row in (weak_rows or [])}
    by_table: dict[str, list[dict]] = {}
    for step in steps:
        by_table.setdefault(_fold(step.get("table")), []).append(step)
    used: set[int] = set()
    rows: list[dict] = []
    previous: str | None = None
    for stage in declared:
        locate = stage.get("locate", "edge")
        # Claim all BFS steps for this table up front: a stage's declared locate
        # wins, so a table reachable both by edge and by alias is read once only
        # (decision 9). Unclaimed steps are listed under "other" at the end.
        table_steps = by_table.get(_fold(stage["table"]), [])
        for item in table_steps:
            used.add(item["index"])
        base = {
            "stage": stage["name"],
            "table": stage["table"],
            "locate": locate,
            "found": 0,
            "missed": True,
            "parent": previous,
            "step": None,
            "detail": None,
            "display": stage.get("displayColumns", []),
            "statusLabels": stage.get("statusLabels", {}),
            "amountColumn": stage.get("amountColumn"),
            "timeColumn": stage.get("timeColumn"),
        }

        if locate in ("alias", "weak"):
            source = (alias_by_name if locate == "alias" else weak_by_name).get(stage["name"])
            if source:
                display, status, status_value, amount, when = _stage_display(
                    stage, source.get("sample") or {}
                )
                base.update(
                    {
                        "found": source.get("found", 0),
                        "missed": bool(source.get("missed")),
                        "incomplete": bool(source.get("incomplete")),
                        "matchRule": source.get("matchRule"),
                        "weak": locate == "weak",
                        "status": status,
                        "statusValue": status_value,
                        "amount": amount,
                        "time": when,
                        "display": display,
                        "detail": {
                            "sql": source.get("sql"),
                            "ms": source.get("ms"),
                            "truncated": source.get("truncated"),
                            "inValues": source.get("inValues"),
                            "inTruncated": source.get("inTruncated"),
                        },
                    }
                )
            rows.append(base)
            previous = stage["name"]
            continue

        step = table_steps[0] if table_steps else None
        if step is not None:
            sample = step.get("sample") or {}
            display, status, status_value, amount, when = _stage_display(stage, sample)
            base.update(
                {
                    "found": step.get("rows") or 0,
                    "missed": False,
                    "step": step["index"],
                    "status": status,
                    "statusValue": status_value,
                    "amount": amount,
                    "time": when,
                    "display": display,
                    "detail": {
                        "sql": step.get("sql"),
                        "condition": step.get("condition"),
                        "ms": step.get("ms"),
                        "edge": step.get("edge"),
                        "fanout": step.get("fanout"),
                        "values": (step.get("condition") or {}).get("binds") or [],
                    },
                    "feedback": {
                        "pending": bool((step.get("edge") or {}).get("status") == "pending"),
                        "abnormalFanout": bool((step.get("fanout") or 0) > 10),
                        "empty": not (step.get("rows") or 0),
                    },
                }
            )
        rows.append(base)
        previous = stage["name"]

    # A table outside the declared stages is still a hit; list it under an
    # explicit tail group rather than dropping it from the report.
    extra = []
    for step in steps:
        if step["index"] in used:
            continue
        extra.append(
            {
                "stage": step.get("table"),
                "table": step.get("table"),
                "locate": "edge",
                "found": step.get("rows") or 0,
                "missed": False,
                "parent": None,
                "step": step["index"],
                "detail": {
                    "sql": step.get("sql"),
                    "condition": step.get("condition"),
                    "ms": step.get("ms"),
                    "edge": step.get("edge"),
                    "fanout": step.get("fanout"),
                },
            }
        )
        used.add(step["index"])
    return {
        "mode": "scene",
        "scene": chosen_scene.get("name"),
        "rows": rows,
        "other": extra,
        "weak": weak_rows or [],
    }


def trace(
    profile: dict,
    connection,
    value,
    entry_table: str | None = None,
    entry_column: str | None = None,
    max_depth=3,
    max_rows_per_table=20,
    direction="both",
    confirm_slow: bool | list | None = False,
    scene: str | None = None,
) -> dict:
    """Follow one value across every confirmed join that touches it."""
    started = time.perf_counter()
    text = str(value if value is not None else "").strip()
    if not text:
        raise store.StoreError(
            "user_error",
            "trace_by_key needs a value to look for",
            "pass the key itself, for example an order id or a customer code",
        )
    # `confirm_slow` names the steps the caller has agreed to pay for. The panel
    # sends the edge ids it showed as checkboxes, so approving one expensive hop
    # does not approve the next one; `True` stays accepted for an older panel and
    # for a caller that really does mean "all of them".
    approved: set[str] = set()
    if isinstance(confirm_slow, (list, tuple, set, frozenset)):
        approved = {str(item) for item in confirm_slow if item}
    allow_all = confirm_slow is True
    depth_limit = _clamp(max_depth, 1, MAX_DEPTH_LIMIT, 3)
    row_limit = _clamp(max_rows_per_table, 1, MAX_ROWS_LIMIT, 20)
    heading = _direction(direction)

    chosen_scene = scenes.resolve(profile, scene)
    inside = scenes.table_set(chosen_scene)
    scene_report = (
        {
            "id": chosen_scene.get("id"),
            "name": chosen_scene.get("name"),
            "tables": list(chosen_scene.get("tables") or []),
        }
        if chosen_scene
        else None
    )

    doc = relations.load(profile)
    all_edges = doc.get("edges") or []
    walkable = _walkable(all_edges)
    pending = [edge for edge in all_edges if edge.get("status") == "pending"]

    warnings: list[dict] = []
    if not walkable:
        warnings.append(
            {
                "code": "no_edges",
                "message": (
                    "no confirmed edge to follow — run discover_relations to import "
                    "the declared foreign keys, or propose_relation for a join the "
                    "catalog does not declare"
                ),
            }
        )

    picked, tried, probe_warnings = _probe(
        profile, connection, walkable, text, entry_table, entry_column, tables=inside
    )
    warnings.extend(probe_warnings)
    entry = {
        "table": (picked or {}).get("table") or entry_table,
        "column": (picked or {}).get("column") or entry_column,
        "picked": picked is not None,
        "candidates": tried,
    }
    if picked is None:
        warnings.append(
            {
                "code": "no_entry",
                "message": (
                    f"no column held {text!r} in any table worth probing — "
                    "name the entry table and column if you know where it lives"
                ),
            }
        )
        return {
            "value": text,
            "direction": heading,
            "elapsedMs": int((time.perf_counter() - started) * 1000),
            "scene": scene_report,
            "entry": entry,
            "summary": {
                "tablesHit": 0,
                "tablesVisited": 0,
                "rowsRead": 0,
                "steps": 0,
                "depthReached": 0,
                "needsConfirm": 0,
                "outside": 0,
            },
            "nodes": [],
            "steps": [],
            "outside": [],
            "pending": [],
            "warnings": warnings,
            "stoppedAt": [],
            "stages": _stage_view(chosen_scene, []),
            "confirmTargets": [],
        }

    # One metadata read per table, reused for the sample and the pending hints.
    described: dict[str, dict] = {}

    def describe(table: str) -> dict:
        key = _fold(table)
        if key not in described:
            try:
                described[key] = engines.describe_table(profile, connection, table, None)
            except engines.DbError:
                described[key] = {}
        return described[key]

    steps: list[dict] = []
    stopped: list[dict] = []
    outside: list[dict] = []
    # Every expensive hop this walk refused to pay for, so one decision can cover
    # all of them instead of one trace per step.
    confirm_targets: list[dict] = []
    seen: set[tuple[str, str, str]] = set()
    hit_tables: set[str] = set()
    visited_tables: set[str] = set()
    expanded: set[str] = set()
    # Tables the depth cap kept out of the walk, collected while walking and judged
    # once it ends: the report names only the ones still unread, so a cycle that
    # makes every step sit at the cap does not produce five lines of noise.
    capped: set[str] = set()
    capped_names: list[str] = []
    rows_read = 0
    depth_reached = 0

    queue = deque(
        [
            {
                "table": entry["table"],
                "column": entry["column"],
                "values": [text],
                "depth": 0,
                "edge": None,
                "side": None,
                "parent": None,
            }
        ]
    )

    while queue and len(steps) < MAX_STEPS:
        node = queue.popleft()
        table = node["table"]
        column = node["column"]
        depth = node["depth"]
        fresh = []
        for candidate in node["values"]:
            key = (_fold(table), _fold(column), str(candidate))
            if key in seen:
                continue
            seen.add(key)
            fresh.append(candidate)
        if not fresh:
            continue

        edge = node["edge"]
        # A condition describes the side holding the value, so it only narrows a
        # query against that side. Applying it to the referenced table would ask
        # for a column that lives somewhere else.
        extra = None
        if edge and edge.get("condition"):
            here = _fold((edge.get("from") or {}).get("table"))
            if here == _fold(table):
                extra = edge["condition"]

        # A table the walk already read is not read or reported again. Its rows
        # were fetched upstream, so a second box would only repeat data the reader
        # already holds; the walk goes on along the other branches instead.
        #
        # The one exception is a table reached straight from itself: a
        # self-referencing key (a manager_id pointing at its own table) reads new
        # rows on every hop, so it is a continuation of the same chain rather than
        # the same table showing up twice. Only the immediate parent counts, so a
        # table that comes back after a detour through other tables is skipped.
        parent = steps[node["parent"] - 1]["table"] if node["parent"] else None
        if _fold(table) in expanded and _fold(parent) != _fold(table):
            continue

        info = describe(table)

        # An unindexed column on a big table turns one hop into a full scan. That
        # is a cost the operator should agree to, not one a trace spends on their
        # behalf: stop here, say so, and let the panel run it again with the edges
        # this reader ticked off (`confirm_slow` as a list of ids). The step is
        # reported rather than skipped, so the answer still shows where the walk
        # wanted to go — and every refusal in this walk is listed in
        # `summary.confirmTargets`, so five expensive hops need one decision
        # instead of five separate traces.
        cost = relations.cost_of(edge) if edge is not None else {}
        edge_id = (edge or {}).get("id")
        if cost.get("needsConfirm") and not allow_all and edge_id not in approved:
            if not any(item.get("edge") == edge_id for item in confirm_targets):
                confirm_targets.append(
                    {
                        "table": table,
                        "column": column,
                        "rowEstimate": cost.get("rowEstimate"),
                        "edge": edge_id,
                        "reason": relations.why_confirm(edge) if edge else None,
                    }
                )
            steps.append(
                {
                    "index": len(steps) + 1,
                    "parent": node["parent"],
                    "depth": depth,
                    "table": table,
                    "schema": info.get("schema"),
                    "condition": {
                        "column": column,
                        "operator": "in",
                        "binds": list(fresh),
                        "extra": extra,
                    },
                    "sql": "",
                    "rows": 0,
                    "truncated": False,
                    "status": NEEDS_CONFIRM,
                    "edge": _edge_summary(edge) if edge else None,
                    "sample": {"columns": [], "rows": []},
                    "fanout": None,
                    "ms": 0,
                    "note": "this step would scan the whole table",
                    "cost": cost,
                    "inside": True,
                }
            )
            warnings.append(
                {
                    "code": "needs_confirm",
                    "message": (
                        f"{table}.{column}: {relations.why_confirm(edge) if edge else 'this step is expensive'}"
                        " — that step is a full scan. Approve it in the panel, or run "
                        "the trace again with confirm_slow set to its edge id."
                    ),
                }
            )
            stopped.append({"table": table, "reason": "a full table scan needs confirmation"})
            continue

        failure = None
        # This step is being paid for because the caller approved it. Marking it
        # is not decoration: a step that ran after a confirmation has to be
        # distinguishable from one that ran because it was cheap, and if the
        # approved scan then times out the reader must see that it was cut short
        # rather than that the table held nothing.
        approved_here = bool(cost.get("needsConfirm")) and (allow_all or edge_id in approved)
        step_started = time.perf_counter()
        timed_out = False
        try:
            found = engines.fetch_matching(
                profile,
                connection,
                table,
                column,
                fresh,
                row_limit,
                extra_condition=extra,
            )
            status = "hit" if found["rows"] else "empty"
        except engines.DbError as error:
            found = {"columns": [], "rows": [], "truncated": False, "sql": "", "binds": fresh}
            status = "error"
            failure = str(error)
            timed_out = engines._is_timeout(error)
        except Exception as error:  # a driver error the guard did not classify
            found = {"columns": [], "rows": [], "truncated": False, "sql": "", "binds": fresh}
            status = "error"
            failure = str(error)
            timed_out = False
        # A condition is a user's guess about a column that may not exist. Losing
        # the whole trace over a typo in it would be worse than losing the
        # narrowing: retry without it, say so, and keep walking. The step then
        # reports the statement that actually ran, so `extra` is cleared.
        if status == "error" and extra:
            try:
                found = engines.fetch_matching(
                    profile, connection, table, column, fresh, row_limit
                )
                status = "hit" if found["rows"] else "empty"
                failure = None
                warnings.append(
                    {
                        "code": "condition_failed",
                        "message": (
                            f"{table}: the condition {extra!r} could not be applied, "
                            "so this step ran without it"
                        ),
                    }
                )
                extra = None
            except Exception:
                pass
        if failure is not None:
            warnings.append(
                {
                    "code": "step_failed",
                    "message": f"{table}.{column}: {failure}",
                }
            )
        step_ms = int((time.perf_counter() - step_started) * 1000)

        rows = found["rows"]
        visited_tables.add(_fold(table))
        if rows:
            hit_tables.add(_fold(table))
        rows_read += len(rows)
        depth_reached = max(depth_reached, depth)

        # Fanout is rows-per-value, and it only means something measured on the
        # referencing side: how many children one parent value pulled in. Measured
        # while walking the other way it would say "how many parents one child
        # has", which is not the number that makes a join expensive, so the walker
        # reports nothing there rather than a misleading figure.
        fanout = None
        if edge is not None and _fold((edge.get("from") or {}).get("table")) == _fold(table) and fresh:
            fanout = round(len(rows) / len(fresh), 2)

        step = {
            "index": len(steps) + 1,
            "parent": node["parent"],
            "depth": depth,
            "table": table,
            "schema": info.get("schema"),
            "condition": {
                "column": column,
                "operator": "in",
                "binds": list(found.get("binds") or fresh),
                "extra": extra,
            },
            "sql": found["sql"],
            "rows": len(rows),
            "truncated": bool(found["truncated"]),
            "status": status,
            "edge": _edge_summary(edge) if edge else None,
            "sample": _sample(found["columns"], rows, info.get("primaryKey"), column),
            "fanout": fanout,
            "ms": step_ms,
            "note": None,
            "inside": inside is None or _fold(table) in inside,
        }
        if approved_here:
            step["confirmed"] = True
            if timed_out:
                # The caller said yes to a full scan and the statement was still cut
                # off by the timeout. That is not "the table held nothing" and not
                # "the scan finished": say so, and keep the step out of the timing
                # window it would otherwise poison.
                step["timedOut"] = True
                step["note"] = (
                    "the approved scan hit the statement timeout; this step is unfinished"
                )
        if status == "empty":
            step["note"] = "0 rows, the chain breaks here"
            stopped.append({"table": table, "reason": f"no row held the value in {column}"})
        elif found["truncated"]:
            step["note"] = f"stopped at {row_limit} rows; the value has more matches than that"
        steps.append(step)

        if not rows:
            continue
        expanded.add(_fold(table))
        if depth >= depth_limit:
            # A depth cap is only worth reporting when it actually hid a table. In a
            # graph with a cycle (order_item -> sales_order -> order_item) every step
            # sits at the cap and raising it would walk the same tables again, so one
            # warning per capped step would be five lines saying nothing happened.
            # The tables are collected here and judged after the walk, because a table
            # this step could not reach may still be reached from a sibling.
            for other_edge, side, here, there in _incident(walkable, table):
                if not _follows(side, heading):
                    continue
                other = there.get("table")
                if other and _fold(other) not in capped:
                    capped.add(_fold(other))
                    capped_names.append(other)
            continue

        for other_edge, side, here, there in _incident(walkable, table):
            if not _follows(side, heading):
                continue
            other_table = there.get("table")
            other_column = there.get("column")
            if not other_table or not other_column:
                continue
            index = _column_index(found["columns"], here.get("column"))
            if index is None:
                continue
            values = []
            for row in rows:
                cell = row[index]
                if cell is None:
                    continue
                if str(cell) not in {str(item) for item in values}:
                    values.append(cell)
            if not values:
                continue
            # A scene narrows what the walk is allowed to read. The join is not
            # hidden — it is listed as `outside`, so the reader sees the table the
            # value would have reached and can add it to the scene deliberately
            # instead of wondering why the walk stopped.
            if inside is not None and _fold(other_table) not in inside:
                if not any(_fold(item["table"]) == _fold(other_table) for item in outside):
                    outside.append(
                        {
                            "table": other_table,
                            "column": other_column,
                            "rows": len(values),
                            "from": {"table": table, "column": here.get("column")},
                            "edge": _edge_summary(other_edge),
                            "reason": (
                                f"{other_table} is not in the scene "
                                f"{chosen_scene.get('name')!r}"
                            ),
                        }
                    )
                continue
            queue.append(
                {
                    "table": other_table,
                    "column": other_column,
                    "values": values,
                    "depth": depth + 1,
                    "edge": other_edge,
                    "side": side,
                    "parent": step["index"],
                }
            )

    if queue and len(steps) >= MAX_STEPS:
        warnings.append(
            {
                "code": "step_limit",
                "message": f"stopped after {MAX_STEPS} steps; narrow the value or lower max_depth",
            }
        )

    # One line for the whole depth cap, and only for the tables the walk never read:
    # "customer and region are still unread" is actionable, five lines that each name
    # a table already on screen are noise.
    unread = [name for name in capped_names if _fold(name) not in expanded]
    if unread:
        warnings.append(
            {
                "code": "depth_limit",
                "message": (
                    f"max_depth {depth_limit} left {len(unread)} table(s) unread: "
                    f"{', '.join(unread)}; raise max_depth to read further"
                ),
            }
        )

    # Every step that measured something is reported back to the graph, so the
    # cost of an edge comes from traces that actually happened instead of from a
    # separate bookkeeping call nobody makes.
    measured = {
        step["edge"]["id"]: step["ms"]
        for step in steps
        if step.get("edge")
        and step.get("edge", {}).get("id")
        and step.get("status") in ("hit", "empty")
        and not step.get("timedOut")
    }
    try:
        relations.note_timings(profile, measured)
    except store.StoreError:
        pass

    # Pending edges are reported, not followed: they are the next thing the
    # caller can turn on, and silently ignoring them looks like a missing join.
    hints = []
    for edge in pending:
        frm = edge.get("from") or {}
        to = edge.get("to") or {}
        if _fold(frm.get("table")) in visited_tables:
            hints.append(
                {
                    "edge": _edge_summary(edge),
                    "wouldReach": {"table": to.get("table"), "column": to.get("column")},
                    "reason": "the edge is pending — confirm it to let the trace follow it",
                }
            )
        elif _fold(to.get("table")) in visited_tables:
            hints.append(
                {
                    "edge": _edge_summary(edge),
                    "wouldReach": {"table": frm.get("table"), "column": frm.get("column")},
                    "reason": "the edge is pending — confirm it to let the trace follow it",
                }
            )

    # Phase C: alias stages are located straight on the input business key and
    # weak stages are loose, look-ahead matches. Neither feeds the BFS queue, so
    # both run after the walk and are reported only in the stage view.
    declared_stages = scenes._stage_list(chosen_scene.get("stages")) if chosen_scene else []
    alias_rows = _alias_rows(profile, connection, chosen_scene, text, row_limit, describe, warnings)
    # Weak matches read their source values from the hit rows of an earlier
    # stage, which came from the BFS walk (alias stages have no step).
    stage_steps = {}
    for stage in declared_stages:
        match = next(
            (item for item in steps if _fold(item.get("table")) == _fold(stage["table"])), None
        )
        if match:
            stage_steps[stage["name"]] = match
    weak_rows = _weak_rows(
        profile, connection, chosen_scene, declared_stages, stage_steps, warnings
    )

    return {
        "value": text,
        "direction": heading,
        "elapsedMs": int((time.perf_counter() - started) * 1000),
        "scene": scene_report,
        "entry": entry,
        "summary": {
            "tablesHit": len(hit_tables),
            "tablesVisited": len(visited_tables),
            "rowsRead": rows_read,
            "steps": len(steps),
            "depthReached": depth_reached,
            "needsConfirm": sum(1 for step in steps if step.get("status") == NEEDS_CONFIRM),
            "outside": len(outside),
        },
        "confirmTargets": confirm_targets,
        "nodes": _nodes(steps),
        "steps": steps,
        "outside": outside,
        "pending": hints,
        "warnings": warnings,
        "stoppedAt": stopped,
        "stages": _stage_view(chosen_scene, steps, alias_rows, weak_rows),
    }
