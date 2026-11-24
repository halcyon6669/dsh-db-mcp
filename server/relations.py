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

# How much a source is worth when two of them describe the same join. The catalog
# outranks everything (it is enforced by the engine); a person outranks a log line
# (they said it on purpose); a log line outranks a guess from column names.
# Importing a weaker source over a stronger one would quietly throw away evidence.
SOURCE_RANK = {"inferred": 0, "audit_mined": 1, "manual": 2, "fk": 3}

# What it takes to stop asking the user about an edge. Three separate
# confirmations, no rejection left standing, a reference column the engine
# actually indexes (so a value cannot match several parents), and a fanout the
# walker can live with.
TRUST_CONFIRMS = 3
TRUST_FANOUT = 5.0

VERDICTS = ("ok", "too_many", "missing", "irrelevant")
TOO_MANY_REASONS = ("wrong_column", "needs_condition", "not_unique")


def _now() -> str:
    stamp = datetime.now(timezone.utc)
    return stamp.strftime("%Y-%m-%dT%H:%M:%S.") + f"{stamp.microsecond // 1000:03d}Z"


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
        "stats": {
            "confirmCount": 0,
            "rejectCount": 0,
            "lastVerifiedAt": None,
            "avgFanout": None,
            "hitCount": 0,
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
    return {
        "edges": selected[:cap],
        "counts": tally,
        "total": total,
        "truncated": total > cap,
    }


def propose(
    profile: dict,
    from_table: str,
    from_column: str,
    to_table: str,
    to_column: str,
    condition: str | None = None,
    note: str | None = None,
    source: str = "manual",
) -> dict:
    """Add or update one hand-specified edge; it starts out `pending`.

    Proposing an edge that a previous round rejected reopens it: asking again is
    an explicit statement that the earlier verdict no longer applies, and a
    blacklist nobody can get out of is worse than one that can be re-argued.
    """
    frm = _endpoint(from_table, from_column, "from")
    to = _endpoint(to_table, to_column, "to")
    if source not in SOURCES:
        raise store.StoreError("user_error", f"unknown source: {source}", "use one of: " + ", ".join(SOURCES))
    doc = load(profile)
    wanted = edge_id(frm, to)
    for edge in doc["edges"]:
        if edge.get("id") == wanted:
            changed = False
            reopened = False
            if condition is not None and edge.get("condition") != (condition or None):
                edge["condition"] = condition or None
                changed = True
            if note is not None and edge.get("note") != (note or None):
                edge["note"] = note or None
                changed = True
            if edge.get("status") == "rejected":
                edge["status"] = "pending"
                edge["stats"]["rejectCount"] = 0
                _record(edge, "reopened", note=note)
                changed = True
                reopened = True
            elif edge.get("status") == "stale":
                # Re-proposing a stale edge is the user saying the join is right
                # after all — most often right after fixing the column or adding
                # the condition it was missing. It goes back to pending, so the
                # next trace has to earn its confirmation again.
                edge["status"] = "pending"
                edge["stats"]["rejectCount"] = 0
                _record(edge, "reopened", note=note)
                changed = True
                reopened = True
            elif changed:
                _record(edge, "edited", note=note)
            if changed:
                save(profile, doc)
            return {"edge": edge, "created": False, "reopened": reopened}
    edge = _blank_edge(frm, to, source, note)
    if condition:
        edge["condition"] = condition
    doc["edges"].append(edge)
    save(profile, doc)
    return {"edge": edge, "created": True, "reopened": False}


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
            doc["edges"].append(edge)
            by_id[wanted] = edge
            imported += 1
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
        "edges": edges,
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
    return stats


def _earns_trust(stats: dict, indexed: bool | None, unique: bool | None) -> bool:
    """Whether an edge has earned the right to be walked without asking again.

    All four have to hold, and the two the graph cannot know on its own
    (`indexed`, `unique`) must be reported as true by the caller — an unknown
    answer keeps the edge at `confirmed`, which still walks but stays visible as
    something a person vouched for rather than something measured.
    """
    fanout = stats.get("avgFanout")
    return (
        stats.get("confirmCount", 0) >= TRUST_CONFIRMS
        and stats.get("rejectCount", 0) == 0
        and bool(indexed or unique)
        and isinstance(fanout, (int, float))
        and float(fanout) <= TRUST_FANOUT
    )


def feedback(
    profile: dict,
    target_id: str,
    verdict: str,
    reason: str | None = None,
    note: str | None = None,
    indexed: bool | None = None,
    unique: bool | None = None,
    fanout: float | None = None,
) -> dict:
    """Record what one trace step showed, and move the edge accordingly.

    `ok` is the only verdict that confirms an edge: it means the step returned the
    rows it should have. `too_many`, `missing` and `irrelevant` all reject it, and
    the difference is what happens next — `too_many` and `missing` make the edge
    `stale`, so it stops being walked until someone fixes the column or adds the
    condition, while `irrelevant` sends it to `rejected`, the blacklist that only
    a fresh `propose_relation` can lift.

    Trust is recomputed on every `ok` rather than latched: an edge whose fanout
    grew or whose reject count stopped being zero falls back to `confirmed`
    instead of keeping a badge it no longer deserves.
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

    if wanted_verdict == "ok":
        stats["confirmCount"] = int(stats.get("confirmCount") or 0) + 1
        stats["lastVerifiedAt"] = now
        stats["lastFailure"] = None
        if isinstance(fanout, (int, float)):
            stats["avgFanout"] = round(float(fanout), 2)
        edge["status"] = "trusted" if _earns_trust(stats, indexed, unique) else "confirmed"
        action = "confirmed" if edge["status"] == "confirmed" else "trusted"
        if previous != edge["status"]:
            _record(edge, action, note=note)
        else:
            _record(edge, "reconfirmed", note=note)
    elif wanted_verdict == "irrelevant":
        stats["rejectCount"] = int(stats.get("rejectCount") or 0) + 1
        stats["lastFailure"] = {"verdict": wanted_verdict, "reason": wanted_reason, "at": now}
        edge["status"] = "rejected"
        _record(edge, "rejected", note=note or wanted_reason)
    else:
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
