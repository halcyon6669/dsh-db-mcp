"""The relation graph: which column of one table joins which column of another.

`engines.list_relations` can only answer with the foreign keys the engine itself
declares. Plenty of real schemas have none — no constraints on a warehouse table,
a join on a code column, a legacy database where the keys were dropped years ago —
and a model asked to follow a value across such tables has nothing to go on.

This module keeps that knowledge. It is a per-datasource JSON file under
`<runtime_dir>/relations/`, owned entirely by the Python side: the panel never
writes it directly, it calls the tools. That keeps one writer per file, and it
means an edge confirmed from the panel is the same edge the agent walks.

An edge is directional in the same sense as a foreign key: `from` is the side
that holds the value (the child, the many), `to` is the side it points at (the
parent, the one). `T_TRANS.ORDER_ID -> T_ORDER.ID` reads "follow an order id from
a transaction to its order".
"""

from __future__ import annotations

import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path

import store

SCHEMA_VERSION = 1
STATUSES = ("pending", "confirmed", "trusted", "stale", "rejected")
SOURCES = ("fk", "manual", "inferred", "audit_mined")
HISTORY_LIMIT = 50
EDGE_LIMIT = 500
# How many `file:line` places one edge keeps. A join written in a dozen mappers is
# still one join; the list is there so a reader can go and look, not to hold every
# copy of the same statement.
PLACES_LIMIT = 10

# How much a source is worth when two of them describe the same join. The catalog
# outranks everything (it is enforced by the engine); a person outranks a log line
# (they said it on purpose); a log line outranks a guess from column names.
# Importing a weaker source over a stronger one would quietly throw away evidence.
SOURCE_RANK = {"inferred": 0, "audit_mined": 1, "manual": 2, "fk": 3}

# What it takes to stop asking the user about an edge: three separate
# confirmations, no rejection left standing, a fanout the walker can live with,
# and a measured cost that is not going to make every later trace slow. An index
# on the reference column is a bonus — it makes the edge cheap — but plenty of
# correct joins sit on unindexed columns in small tables, so it is no longer a
# hard requirement. Timing is what actually tells the two apart.
TRUST_CONFIRMS = 3
TRUST_FANOUT = 5.0

# A step slower than this is the sort of thing that turns a trace into a coffee
# break. The window keeps the most recent measurements, newest last.
SLOW_MS = 200
TIMING_WINDOW = 5
# Trust is evaluated on real measurements, so a window of one lucky trace cannot
# promote an edge; three samples is the least that says anything.
TRUST_SAMPLES = 3

# A step that keeps taking this many times `slowMs` is treated as expensive even
# when nobody could read a row estimate: five bad samples in a row say more about
# what the next walk will pay than any catalog guess. One slow sample, or two,
# is noise — a cache miss, a lock — and does not stop the walk.
SLOW_FACTOR = 5

# Above this many rows an unindexed column means a full table scan. The estimate
# comes from the catalog (pg_class.reltuples, information_schema.TABLES.TABLE_ROWS,
# ALL_TABLES.NUM_ROWS) — never a count(*), which would cost what it is trying to
# avoid.
BIG_TABLE_ROWS = 1_000_000

# The four numbers above are only the defaults. The panel edits them, and the
# values live in `settings.json` under "cost" — the same file `auditLog` comes
# from. `cost_settings()` re-reads it on every use, so a change applies to the
# next trace without restarting the process.
COST_DEFAULTS = {
    "slowMs": SLOW_MS,
    "timingWindow": TIMING_WINDOW,
    "trustSamples": TRUST_SAMPLES,
    "bigTableRows": BIG_TABLE_ROWS,
}

# Each cap keeps the setting in a range where the rule still says something: a
# window of zero keeps no history, and a "slow" step of one millisecond would call
# every edge slow.
COST_CAPS = {
    "slowMs": (10, 60_000),
    "timingWindow": (1, 20),
    "trustSamples": (1, 20),
    "bigTableRows": (1_000, 1_000_000_000),
}

VERDICTS = ("ok", "too_many", "missing", "irrelevant")
TOO_MANY_REASONS = ("wrong_column", "needs_condition", "not_unique")


def _now() -> str:
    stamp = datetime.now(timezone.utc)
    return stamp.strftime("%Y-%m-%dT%H:%M:%S.") + f"{stamp.microsecond // 1000:03d}Z"


def _clamp_cost(key: str, value) -> int:
    """One cost setting, forced into the range where its rule still applies."""
    low, high = COST_CAPS[key]
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return COST_DEFAULTS[key]
    number = int(value)
    if number < low:
        return low
    if number > high:
        return high
    return number


def cost_settings() -> dict:
    """The four cost thresholds, read fresh from `settings.json` on every call.

    Re-reading rather than caching at import matters: the panel writes the file
    and the next trace should already use the new numbers, without restarting the
    MCP process. A missing or broken settings file falls back to the defaults, the
    same way `audit.py` treats `auditLog`.
    """
    values = dict(COST_DEFAULTS)
    try:
        with (store.runtime_dir() / "settings.json").open("r", encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, ValueError):
        return values
    cost = data.get("cost") if isinstance(data, dict) else None
    if not isinstance(cost, dict):
        return values
    for key in COST_DEFAULTS:
        if key in cost:
            values[key] = _clamp_cost(key, cost[key])
    return values


def _source_key(profile: dict) -> str:
    """A stable file name for one datasource.

    Saved sources have an id. An inline profile (only `test_connection` builds
    those) has none, so hash what identifies it instead of sharing one file
    between unrelated connections.
    """
    identity = profile.get("id")
    if identity:
        return str(identity)
    seed = json.dumps(
        {"kind": profile.get("kind"), "name": profile.get("name"), "config": profile.get("config")},
        sort_keys=True,
        default=str,
    )
    return "inline-" + hashlib.sha1(seed.encode("utf-8")).hexdigest()[:12]


def path_of(profile: dict) -> Path:
    return store.runtime_dir() / "relations" / f"{_source_key(profile)}.json"


def _blank(profile: dict) -> dict:
    return {
        "schemaVersion": SCHEMA_VERSION,
        "datasource": profile.get("id") or _source_key(profile),
        "kind": profile.get("kind"),
        "updatedAt": None,
        "edges": [],
    }


def load(profile: dict) -> dict:
    """Read the graph, or start an empty one.

    A file that exists but does not parse is an error rather than a silent reset:
    quietly discarding confirmed edges would lose work the user did by hand.
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
            f"repair or delete {target} — deleting it starts an empty relation graph",
        ) from error
    if not isinstance(data, dict) or not isinstance(data.get("edges"), list):
        raise store.StoreError(
            "infra_error",
            f"{target.name} has no edges array",
            f"repair or delete {target} — deleting it starts an empty relation graph",
        )
    doc = _blank(profile)
    doc.update({key: value for key, value in data.items() if key != "edges"})
    doc["edges"] = [edge for edge in data["edges"] if isinstance(edge, dict)]
    return doc


def save(profile: dict, doc: dict) -> None:
    """Write the graph atomically, so a crash mid-write cannot truncate it."""
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


def _endpoint(table: str, column: str, side: str) -> dict:
    table = str(table or "").strip()
    column = str(column or "").strip()
    if not table or not column:
        raise store.StoreError(
            "user_error",
            f"an edge needs a table and a column on both sides ({side} is incomplete)",
            "pass from_table, from_column, to_table and to_column",
        )
    return {"table": table, "column": column}


def edge_id(frm: dict, to: dict) -> str:
    """A stable id from the two endpoints.

    Proposing the same join twice must update one edge, not add a second; the
    case-folded key means `T_ORDER.id` and `t_order.ID` are the same edge.
    """
    seed = f"{frm['table']}.{frm['column']}->{to['table']}.{to['column']}".casefold()
    return "e_" + hashlib.sha1(seed.encode("utf-8")).hexdigest()[:6]


def _blank_edge(frm: dict, to: dict, source: str, note: str | None) -> dict:
    now = _now()
    return {
        "id": edge_id(frm, to),
        "from": frm,
        "to": to,
        "source": source,
        "status": "pending",
        "condition": None,
        "note": note,
        # Where a scan read this join, as `file:line`. Empty for an edge that came
        # from the catalog or from a person: those do not come from a file.
        "places": [],
        "stats": {
            "confirmCount": 0,
            "rejectCount": 0,
            "lastVerifiedAt": None,
            "avgFanout": None,
            "hitCount": 0,
            "indexed": None,
            "rowEstimate": None,
            "timings": [],
            "lastMs": None,
            "avgMs": None,
        },
        "history": [{"at": now, "action": "created", "by": "agent", "note": note}],
        "createdAt": now,
        "updatedAt": now,
    }


def _record(edge: dict, action: str, by: str = "agent", note: str | None = None) -> None:
    now = _now()
    edge["updatedAt"] = now
    history = edge.setdefault("history", [])
    history.append({"at": now, "action": action, "by": by, "note": note})
    del history[:-HISTORY_LIMIT]


def find(profile: dict, target_id: str) -> tuple[dict, dict]:
    """The document and the one edge with this id."""
    doc = load(profile)
    wanted = str(target_id or "").strip()
    for edge in doc["edges"]:
        if edge.get("id") == wanted:
            return doc, edge
    known = ", ".join(str(edge.get("id")) for edge in doc["edges"][:10])
    raise store.StoreError(
        "user_error",
        f"unknown edge: {target_id}",
        f"call list_edges to see the ids ({known or 'none yet'})",
    )


def counts(edges: list[dict]) -> dict:
    tally = {status: 0 for status in STATUSES}
    for edge in edges:
        status = edge.get("status")
        if status in tally:
            tally[status] += 1
    return tally


def _sort_key(edge: dict) -> tuple:
    frm = edge.get("from") or {}
    to = edge.get("to") or {}
    return (
        str(frm.get("table") or "").casefold(),
        str(frm.get("column") or "").casefold(),
        str(to.get("table") or "").casefold(),
        str(to.get("column") or "").casefold(),
    )


def list_edges(
    profile: dict,
    status: str | None = None,
    source: str | None = None,
    limit: int = EDGE_LIMIT,
) -> dict:
    """Every edge of one datasource, with the per-status counts."""
    doc = load(profile)
    wanted_status = str(status or "").strip().lower() or None
    if wanted_status and wanted_status not in STATUSES:
        raise store.StoreError(
            "user_error",
            f"unknown status: {status}",
            "use one of: " + ", ".join(STATUSES),
        )
    wanted_source = str(source or "").strip().lower() or None
    if wanted_source and wanted_source not in SOURCES:
        raise store.StoreError(
            "user_error",
            f"unknown source: {source}",
            "use one of: " + ", ".join(SOURCES),
        )
    edges = doc["edges"]
    tally = counts(edges)
    selected = [
        edge
        for edge in edges
        if (wanted_status is None or edge.get("status") == wanted_status)
        and (wanted_source is None or edge.get("source") == wanted_source)
    ]
    selected.sort(key=_sort_key)
    total = len(selected)
    cap = max(1, int(limit))
    shown = selected[:cap]
    return {
        # Every row carries its cost facts, so the panel can show "no index, ~4M
        # rows, 820ms" without a second call per edge.
        "edges": [dict(edge, cost=cost_of(edge)) for edge in shown],
        "counts": tally,
        "total": total,
        "truncated": total > cap,
    }


def note_timings(profile: dict, measured: dict[str, float]) -> int:
    """Fold the step durations of one trace into the edges they belong to.

    A trace is the only place that sees how long a hop really took, so it reports
    them back here rather than the operator having to file a verdict per step.
    Edges that no longer exist are skipped.

    A timing is not a confirmation — the counts do not move — but it can take a
    badge away: a `trusted` edge whose recent window is mostly over the slow
    threshold falls back to `confirmed`, because the promise of "walk this without
    asking" was about cost and the cost changed. The window is what makes that
    decision honest; one slow sample does not do it (see `mostly_slow`), and an
    edge already `confirmed` writes nothing, so a slow streak leaves one line in
    the history rather than one per trace.
    """
    if not measured:
        return 0
    doc = load(profile)
    touched = 0
    for edge in doc["edges"]:
        ms = measured.get(edge.get("id"))
        if ms is None:
            continue
        stats = _stats_of(edge)
        _timed(stats, ms)
        if edge.get("status") == "trusted" and mostly_slow(stats):
            edge["status"] = "confirmed"
            _record(edge, "trust withdrawn", note="the recent steps are mostly over the slow threshold")
        touched += 1
    if touched:
        save(profile, doc)
    return touched


def propose(
    profile: dict,
    from_table: str,
    from_column: str,
    to_table: str,
    to_column: str,
    condition: str | None = None,
    note: str | None = None,
    source: str = "manual",
    indexed: bool | None = None,
    row_estimate: int | None = None,
) -> dict:
    """Add or update one hand-specified edge; it starts out `pending`.

    Proposing an edge that a previous round rejected reopens it: asking again is
    an explicit statement that the earlier verdict no longer applies, and a
    blacklist nobody can get out of is worse than one that can be re-argued.

    `indexed` and `row_estimate` describe the referenced column. The caller reads
    them from the catalog when it can; a proposal made without a connection leaves
    both unknown, and the edge is simply not eligible for the "needs a full scan"
    warning until a trace fills them in.
    """
    frm = _endpoint(from_table, from_column, "from")
    to = _endpoint(to_table, to_column, "to")
    if source not in SOURCES:
        raise store.StoreError("user_error", f"unknown source: {source}", "use one of: " + ", ".join(SOURCES))
    doc = load(profile)
    wanted = edge_id(frm, to)
    for edge in doc["edges"]:
        if edge.get("id") == wanted:
            stats = _stats_of(edge)
            changed = False
            reopened = False
            if isinstance(indexed, bool) and stats.get("indexed") != indexed:
                stats["indexed"] = indexed
                changed = True
            if isinstance(row_estimate, (int, float)) and not isinstance(row_estimate, bool):
                if stats.get("rowEstimate") != int(row_estimate):
                    stats["rowEstimate"] = int(row_estimate)
                    changed = True
            if condition is not None and edge.get("condition") != (condition or None):
                edge["condition"] = condition or None
                changed = True
            if note is not None and edge.get("note") != (note or None):
                edge["note"] = note or None
                changed = True
            if edge.get("status") == "rejected":
                edge["status"] = "pending"
                stats["rejectCount"] = 0
                _record(edge, "reopened", note=note)
                changed = True
                reopened = True
            elif edge.get("status") == "stale":
                # Re-proposing a stale edge is the user saying the join is right
                # after all — most often right after fixing the column or adding
                # the condition it was missing. It goes back to pending, so the
                # next trace has to earn its confirmation again.
                edge["status"] = "pending"
                stats["rejectCount"] = 0
                _record(edge, "reopened", note=note)
                changed = True
                reopened = True
            elif changed:
                _record(edge, "edited", note=note)
            if changed:
                save(profile, doc)
            return {"edge": edge, "created": False, "reopened": reopened}
    edge = _blank_edge(frm, to, source, note)
    stats = _stats_of(edge)
    if isinstance(indexed, bool):
        stats["indexed"] = indexed
    if isinstance(row_estimate, (int, float)) and not isinstance(row_estimate, bool):
        stats["rowEstimate"] = int(row_estimate)
    if condition:
        edge["condition"] = condition
    doc["edges"].append(edge)
    save(profile, doc)
    return {"edge": edge, "created": True, "reopened": False}


def _carry_places(edge: dict, row: dict) -> bool:
    """Merge the `file:line` places a scan read this join from. Returns True on change.

    A re-scan usually finds the same statements again, so this must be a union, not
    an overwrite: the second file that writes the same join is evidence, and losing
    it would make the graph say "read from one place" when it was read from three.
    """
    incoming = row.get("places")
    if not isinstance(incoming, list):
        return False
    current = edge.get("places")
    if not isinstance(current, list):
        current = []
    merged = list(current)
    for place in incoming:
        text = str(place or "").strip()
        if text and text not in merged and len(merged) < PLACES_LIMIT:
            merged.append(text)
    if merged == current:
        return False
    edge["places"] = merged
    return True


def _carry_cost(edge: dict, row: dict) -> None:
    """Copy whatever cost facts a discovery row happens to carry onto an edge.

    Discovery normally knows nothing about indexes — it reads constraints, not
    plans — so this is a no-op for most sources. It exists so a caller that does
    have the figures (a scan that also described the table, say) does not need a
    second write to record them.
    """
    indexed = row.get("indexed")
    estimate = row.get("rowEstimate")
    if not isinstance(indexed, bool) and not isinstance(estimate, (int, float)):
        return
    stats = _stats_of(edge)
    if isinstance(indexed, bool):
        stats["indexed"] = indexed
    if isinstance(estimate, (int, float)) and not isinstance(estimate, bool):
        stats["rowEstimate"] = int(estimate)


def import_edges(profile: dict, found: list[dict], source: str = "fk") -> dict:
    """Merge discovered joins into the graph.

    A key the graph already knows keeps its status — a `confirmed` edge must not
    drop back to `pending` just because the catalog still has it. Only a `stale`
    edge (one that had stopped resolving) returns to `pending`, because being
    rediscovered is exactly the evidence that it works again.

    `source` says where the rows came from, and it is only ever upgraded, never
    downgraded: a join the catalog declares must not be relabelled as a guess just
    because a later audit scan found the same statement. The rank lives in
    `SOURCE_RANK`; the note carries the constraint name or the hit count.
    """
    doc = load(profile)
    by_id = {edge.get("id"): edge for edge in doc["edges"]}
    imported = 0
    updated = 0
    skipped = 0
    for row in found:
        try:
            frm = _endpoint(row.get("table"), row.get("column"), "from")
            to = _endpoint(row.get("refTable"), row.get("refColumn"), "to")
        except store.StoreError:
            skipped += 1
            continue
        wanted = edge_id(frm, to)
        edge = by_id.get(wanted)
        if edge is None:
            edge = _blank_edge(frm, to, source, None)
            edge["source"] = source
            edge["note"] = row.get("name") or None
            _carry_cost(edge, row)
            _carry_places(edge, row)
            doc["edges"].append(edge)
            by_id[wanted] = edge
            imported += 1
            continue
        # A rediscovery can still tell us something new about cost, even when it
        # changes nothing else about the edge.
        _carry_cost(edge, row)
        # ...and about where the join is written. This is deliberately outside the
        # branch below: a second file writing the same join adds evidence even when
        # the source rank does not change and nothing else about the edge moves.
        if _carry_places(edge, row):
            updated += 1
            _record(edge, "read again somewhere else", note=", ".join(edge["places"][-1:]) or None)
            continue
        current = edge.get("source") if edge.get("source") in SOURCE_RANK else "inferred"
        if edge.get("status") == "stale":
            edge["status"] = "pending"
            _record(edge, "rediscovered")
            updated += 1
        elif SOURCE_RANK.get(source, 0) > SOURCE_RANK.get(current, 0):
            # Stronger evidence for a join we only had a guess about: keep the row,
            # keep its status, record where it really came from.
            edge["source"] = source
            if row.get("name"):
                edge["note"] = row["name"]
            _record(edge, f"source {current} -> {source}")
            updated += 1
        else:
            skipped += 1
    if imported or updated:
        save(profile, doc)
    edges = sorted(doc["edges"], key=_sort_key)
    return {
        "imported": imported,
        "updated": updated,
        "skipped": skipped,
        "edges": [dict(edge, cost=cost_of(edge)) for edge in edges],
        "counts": counts(edges),
    }


def _stats_of(edge: dict) -> dict:
    """The counters of one edge, repaired in place if the file predates them."""
    stats = edge.get("stats")
    if not isinstance(stats, dict):
        stats = {}
        edge["stats"] = stats
    stats.setdefault("confirmCount", 0)
    stats.setdefault("rejectCount", 0)
    stats.setdefault("lastVerifiedAt", None)
    stats.setdefault("avgFanout", None)
    stats.setdefault("hitCount", 0)
    stats.setdefault("lastFailure", None)
    stats.setdefault("indexed", None)
    stats.setdefault("unique", None)
    stats.setdefault("rowEstimate", None)
    if not isinstance(stats.get("timings"), list):
        stats["timings"] = []
    stats.setdefault("lastMs", None)
    stats.setdefault("avgMs", None)
    return stats


def _timed(stats: dict, ms, window: int | None = None) -> None:
    """Record one measured step duration and refresh the running figures.

    Only the last `timingWindow` samples are kept: an edge is as expensive as it
    is now, and an average dragged down by a year of fast traces would hide the
    query that started doing a full scan yesterday.
    """
    if not isinstance(ms, (int, float)) or isinstance(ms, bool):
        return
    if window is None:
        window = cost_settings()["timingWindow"]
    value = max(0, int(round(float(ms))))
    timings = stats.get("timings")
    if not isinstance(timings, list):
        timings = []
        stats["timings"] = timings
    timings.append(value)
    del timings[:-window]
    # `lastMs` and `avgMs` are projections of `timings`, kept alongside so the
    # panel and the trust rule do not each re-derive them from the list.
    stats["lastMs"] = value
    stats["avgMs"] = round(sum(timings) / len(timings), 1)


def _samples(stats: dict) -> list[float]:
    """The measured durations of the window, oldest first, ignoring noise."""
    timings = stats.get("timings")
    if not isinstance(timings, list):
        return []
    return [
        float(sample)
        for sample in timings
        if isinstance(sample, (int, float)) and not isinstance(sample, bool)
    ]


def mostly_slow(stats: dict) -> bool:
    """Whether most of the recent window is over the slow threshold.

    A majority, not one sample: a single 800ms hop is a cache miss or a lock
    wait, and withdrawing a badge for it would make trust flicker on every busy
    afternoon. Half the window is not enough either — `2 of 4` is a tie, and a
    tie does not say the edge got slower, only that it is sometimes slow.
    """
    samples = _samples(stats)
    if not samples:
        return False
    slow = sum(1 for sample in samples if sample >= cost_settings()["slowMs"])
    return slow * 2 > len(samples)


def persistently_slow(stats: dict) -> bool:
    """Whether every recent sample is many times over the slow threshold.

    This is the cost signal that needs no catalogue: five samples all past
    `SLOW_FACTOR * slowMs` say what the next walk will pay even when nobody could
    read a row estimate for the target table. One sample is not "persistently"
    anything, so a window of one is ignored; two in a row already says the same
    query did it twice.
    """
    samples = _samples(stats)
    if len(samples) < 2:
        return False
    limit = cost_settings()["slowMs"] * SLOW_FACTOR
    return all(sample > limit for sample in samples)


def _earns_trust(stats: dict) -> bool:
    """Whether an edge has earned the right to be walked without asking again.

    All four have to hold, and none of them is a guess about the schema: three
    confirmations, no rejection left standing, a fanout the walker can absorb, and
    a measured cost whose recent samples are all under the slow threshold.

    `confirmCount` counts *consecutive* confirmations — a rejection clears it — so
    "three confirmations" means three in a row after the last rejection. That is
    what `rejectCount == 0` used to approximate, except `rejectCount` only ever
    grew: an edge rejected once could never earn trust again, however many correct
    walks followed. `rejectCount` is now kept for the audit trail and the panel.

    An index is **not** required. It used to be, on the theory that only an
    indexed reference column could be cheap — but that is the wrong question. A
    correct join on an unindexed column of a 200-row table is faster than an
    indexed one on a 20-million-row table, and only timing knows the difference.
    The index and the row estimate are recorded and shown; they inform the
    operator, they do not decide the badge.
    """
    cost = cost_settings()
    fanout = stats.get("avgFanout")
    if int(stats.get("confirmCount") or 0) < TRUST_CONFIRMS:
        return False
    if not isinstance(fanout, (int, float)) or float(fanout) > TRUST_FANOUT:
        return False
    timings = stats.get("timings")
    if not isinstance(timings, list) or len(timings) < cost["trustSamples"]:
        return False
    return all(isinstance(sample, (int, float)) and float(sample) < cost["slowMs"] for sample in timings)


def needs_confirm(stats: dict) -> bool:
    """Whether walking this edge should ask before paying for a full scan.

    True when the reference column has no index and the table is big enough that
    a scan is not free. The answer for an unknown row estimate is "no": refusing
    to walk a table whose size nobody can read would block the trace entirely,
    which is worse than one slow step.

    A window of persistently slow measurements is the second reason, and it does
    not depend on the row estimate — the walk itself is the evidence.
    """
    if persistently_slow(stats):
        return True
    row_estimate = stats.get("rowEstimate")
    if not isinstance(row_estimate, (int, float)):
        return False
    if float(row_estimate) < cost_settings()["bigTableRows"]:
        return False
    return stats.get("indexed") is False


def why_confirm(edge: dict) -> str | None:
    """The short sentence a caller shows next to a step it wants approved.

    None when the edge is cheap enough to walk without asking, so the caller can
    use the return value as the test itself. The wording says which of the two
    reasons fired, because "no index on a big table" and "the last five walks were
    slow" call for different decisions.
    """
    stats = _stats_of(edge)
    if persistently_slow(stats):
        slow = cost_settings()["slowMs"]
        return f"the recent steps are all over {slow * SLOW_FACTOR}ms"
    if needs_confirm(stats):
        return f"no index, and the table holds about {stats.get('rowEstimate')} rows"
    return None


def cost_of(edge: dict) -> dict:
    """The cost facts a caller — a tool, the panel — needs about one edge.

    `timings` is the window itself, newest last, not just its average: one 900ms
    sample among four fast ones is exactly the thing an average hides, and it is
    what makes the next walk ask.
    """
    stats = _stats_of(edge)
    return {
        "indexed": stats.get("indexed"),
        "unique": stats.get("unique"),
        "rowEstimate": stats.get("rowEstimate"),
        "lastMs": stats.get("lastMs"),
        "avgMs": stats.get("avgMs"),
        "timings": list(stats.get("timings") or []),
        "needsConfirm": needs_confirm(stats),
    }


def feedback(
    profile: dict,
    target_id: str,
    verdict: str,
    reason: str | None = None,
    note: str | None = None,
    indexed: bool | None = None,
    unique: bool | None = None,
    fanout: float | None = None,
    row_estimate: int | None = None,
    ms: float | None = None,
) -> dict:
    """Record what one trace step showed, and move the edge accordingly.

    `ok` is the only verdict that confirms an edge: it means the step returned the
    rows it should have. `too_many`, `missing` and `irrelevant` all reject it, and
    the difference is what happens next — `too_many` and `missing` make the edge
    `stale`, so it stops being walked until someone fixes the column or adds the
    condition, while `irrelevant` sends it to `rejected`, the blacklist that only
    a fresh `propose_relation` can lift.

    Trust is recomputed on every `ok` rather than latched: an edge whose fanout
    grew, whose reject count stopped being zero, or whose recent steps got slow
    falls back to `confirmed` instead of keeping a badge it no longer deserves.

    `indexed` and `row_estimate` are the cost facts of the referenced column. They
    are recorded on every call — including rejections, because when a join is wrong
    the cost of the column it points at is still worth knowing — and they are what
    the panel shows next to the edge.
    """
    wanted_verdict = str(verdict or "").strip().lower()
    if wanted_verdict not in VERDICTS:
        raise store.StoreError(
            "user_error",
            f"unknown verdict: {verdict}",
            "use one of: " + ", ".join(VERDICTS),
        )
    wanted_reason = str(reason or "").strip().lower() or None
    if wanted_verdict == "too_many" and wanted_reason not in TOO_MANY_REASONS:
        raise store.StoreError(
            "user_error",
            f"too_many needs a reason, got: {reason or 'nothing'}",
            "use one of: " + ", ".join(TOO_MANY_REASONS),
        )
    doc, edge = find(profile, target_id)
    stats = _stats_of(edge)
    previous = edge.get("status")
    now = _now()

    # The cost facts stand on their own: whether this verdict confirms the join or
    # rejects it, what the column costs to search is true either way.
    if isinstance(indexed, bool):
        stats["indexed"] = indexed
    if isinstance(unique, bool):
        stats["unique"] = unique
    if isinstance(row_estimate, (int, float)) and not isinstance(row_estimate, bool):
        stats["rowEstimate"] = int(row_estimate)
    _timed(stats, ms)

    if wanted_verdict == "ok":
        stats["confirmCount"] = int(stats.get("confirmCount") or 0) + 1
        stats["lastVerifiedAt"] = now
        stats["lastFailure"] = None
        if isinstance(fanout, (int, float)):
            stats["avgFanout"] = round(float(fanout), 2)
        edge["status"] = "trusted" if _earns_trust(stats) else "confirmed"
        action = "confirmed" if edge["status"] == "confirmed" else "trusted"
        if previous != edge["status"]:
            _record(edge, action, note=note)
        else:
            _record(edge, "reconfirmed", note=note)
    elif wanted_verdict == "irrelevant":
        # "This edge has nothing to do with the value" is not evidence about the
        # cost or the correctness of the join, so it does not touch the
        # confirmation run. It is a statement about this walk, and the blacklist it
        # produces is undone by proposing the edge again.
        stats["lastFailure"] = {"verdict": wanted_verdict, "reason": wanted_reason, "at": now}
        edge["status"] = "rejected"
        _record(edge, "rejected", note=note or wanted_reason)
    else:
        # A rejection is evidence that the last confirmations were wrong, so the
        # run starts again from zero: trust needs three confirmations *in a row*
        # after the most recent rejection, not three ever. `rejectCount` keeps
        # counting for the audit trail and the panel; it no longer gates anything.
        stats["confirmCount"] = 0
        stats["rejectCount"] = int(stats.get("rejectCount") or 0) + 1
        stats["lastFailure"] = {"verdict": wanted_verdict, "reason": wanted_reason, "at": now}
        edge["status"] = "stale"
        _record(edge, "stale", note=note or wanted_reason or wanted_verdict)

    save(profile, doc)
    return {"edge": edge, "previousStatus": previous}


def set_condition(profile: dict, target_id: str, condition: str | None) -> dict:
    """Attach (or clear) the extra predicate an edge needs to be true.

    Some joins are only correct under a filter — `T_TRANS.STATUS = 'POSTED'`, a
    soft-delete flag, a partition. Keeping the predicate with the edge is what
    lets the walker build the right `where` without the model in the loop.
    """
    doc, edge = find(profile, target_id)
    text = (condition or "").strip() or None
    if edge.get("condition") == text:
        return {"edge": edge, "changed": False}
    edge["condition"] = text
    _record(edge, "condition cleared" if text is None else "condition set", note=text)
    save(profile, doc)
    return {"edge": edge, "changed": True}


def delete_edge(profile: dict, target_id: str) -> dict:
    doc, edge = find(profile, target_id)
    doc["edges"] = [candidate for candidate in doc["edges"] if candidate.get("id") != edge.get("id")]
    save(profile, doc)
    return {"deleted": edge, "counts": counts(doc["edges"])}
