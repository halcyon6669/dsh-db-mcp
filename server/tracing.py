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
            "children": [node_of(child) for child in children.get(index, [])],
        }

    return [node_of(index) for index in roots]


def trace(
    profile: dict,
    connection,
    value,
    entry_table: str | None = None,
    entry_column: str | None = None,
    max_depth=3,
    max_rows_per_table=20,
    direction="both",
    confirm_slow: bool = False,
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
        # behalf: stop here, say so, and let the panel run it again with
        # `confirm_slow`. The step is reported rather than skipped, so the answer
        # still shows where the walk wanted to go.
        cost = relations.cost_of(edge) if edge is not None else {}
        if not confirm_slow and cost.get("needsConfirm"):
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
                        f"{table}.{column} has no index and the table holds about "
                        f"{cost.get('rowEstimate')} rows — that step is a full scan. "
                        "Run the trace again with confirm_slow to allow it."
                    ),
                }
            )
            stopped.append({"table": table, "reason": "a full table scan needs confirmation"})
            continue

        failure = None
        step_started = time.perf_counter()
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
        except Exception as error:  # a driver error the guard did not classify
            found = {"columns": [], "rows": [], "truncated": False, "sql": "", "binds": fresh}
            status = "error"
            failure = str(error)
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
        if step.get("edge") and step.get("edge", {}).get("id") and step.get("status") in ("hit", "empty")
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
        "nodes": _nodes(steps),
        "steps": steps,
        "outside": outside,
        "pending": hints,
        "warnings": warnings,
        "stoppedAt": stopped,
    }
