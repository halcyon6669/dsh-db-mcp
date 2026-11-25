"""db-mcp: the MCP server that lets the agent read the databases registered in
the dsh-db-mcp plugin panel.

Run over stdio (the plugin Host half spawns it):

    python main.py

Every tool re-reads `datasources.json` and `secrets.json`, so sources added or
edited in the panel are visible without a restart. Tools never return passwords.
"""

from __future__ import annotations

import functools
import inspect
import json
import os
import sys
import time
from typing import Any, Optional

from mcp.server.fastmcp import FastMCP

import audit
import engines
import mining
import relations
import sources
import tracing
import writes
import store

DEFAULT_MAX_ROWS = int(os.environ.get("DB_MCP_MAX_ROWS") or 200)
HARD_MAX_ROWS = int(os.environ.get("DB_MCP_MAX_ROWS_HARD") or 2000)

USAGE = """usage: main.py [--stdio | --http | --sse] [--host HOST] [--port PORT] [--path PATH]

  --stdio     speak MCP over stdin/stdout (default; what the DSH plugin spawns)
  --http      serve streamable HTTP at --path (for VS Code, Cursor, Codex, Claude)
  --sse       serve the older SSE transport at /sse
  --host      interface to bind for --http/--sse (default 127.0.0.1)
  --port      port to bind for --http/--sse (default 8000)
  --path      streamable-HTTP path (default /dsh-db-mcp)

The same registry is read in every mode, so an HTTP client sees exactly the
data sources the panel manages. DB_MCP_TRANSPORT, DB_MCP_HOST, DB_MCP_PORT and
DB_MCP_PATH set the same four options through the environment.
"""

TRANSPORTS = {"stdio", "sse", "streamable-http"}
DEFAULT_PATH = "/dsh-db-mcp"


def _transport_args(argv: list[str]) -> dict:
    """Parse the transport flags without pulling in argparse at import time."""
    options = {
        "transport": (os.environ.get("DB_MCP_TRANSPORT") or "stdio").strip() or "stdio",
        "host": os.environ.get("DB_MCP_HOST") or "127.0.0.1",
        "port": os.environ.get("DB_MCP_PORT") or "8000",
        "path": os.environ.get("DB_MCP_PATH") or DEFAULT_PATH,
        "help": False,
    }
    index = 0
    while index < len(argv):
        arg = argv[index]
        if arg in ("--help", "-h"):
            options["help"] = True
            index += 1
        elif arg == "--stdio":
            options["transport"] = "stdio"
            index += 1
        elif arg in ("--http", "--streamable-http"):
            options["transport"] = "streamable-http"
            index += 1
        elif arg == "--sse":
            options["transport"] = "sse"
            index += 1
        elif arg in ("--transport", "--host", "--port", "--path"):
            if index + 1 >= len(argv):
                raise SystemExit(f"{arg} needs a value\n{USAGE}")
            options[arg[2:]] = argv[index + 1]
            index += 2
        elif arg.startswith("--transport=") or arg.startswith("--host=") or arg.startswith("--port=") or arg.startswith("--path="):
            name, _, value = arg[2:].partition("=")
            options[name] = value
            index += 1
        else:
            raise SystemExit(f"unknown argument: {arg}\n{USAGE}")
    normalised = options["transport"].strip().lower()
    if normalised == "http":
        normalised = "streamable-http"
    if normalised not in TRANSPORTS:
        raise SystemExit(f"unknown transport: {options['transport']}\n{USAGE}")
    options["transport"] = normalised
    try:
        port = int(options["port"])
    except (TypeError, ValueError):
        raise SystemExit(f"port must be a number, got {options['port']!r}\n{USAGE}")
    if not 1 <= port <= 65535:
        raise SystemExit(f"port must be between 1 and 65535, got {port}\n{USAGE}")
    options["port"] = port
    options["host"] = str(options["host"]).strip() or "127.0.0.1"
    path = str(options["path"]).strip() or DEFAULT_PATH
    if not path.startswith("/"):
        path = "/" + path
    options["path"] = path
    return options


ARGS = _transport_args(sys.argv[1:])

mcp = FastMCP(
    "db-mcp",
    instructions=(
        "Work with the databases the user registered in the DSH Data sources panel. "
        "Start with list_datasources, then list_tables, describe_table and finally "
        "execute_sql. execute_sql runs any single statement: SELECT and EXPLAIN when "
        "the source is read-only, INSERT/UPDATE/DELETE/DDL only when writes are "
        "enabled. Prefer these tools over guessing table names. To join tables, call "
        "list_edges for the relation graph instead of guessing the key columns; "
        "discover_relations imports the declared foreign keys, and propose_relation "
        "records a join the catalog does not declare."
    ),
    host=ARGS["host"],
    port=ARGS["port"],
    streamable_http_path=ARGS["path"],
)


def _clamp_rows(limit: Optional[int]) -> int:
    try:
        value = int(limit) if limit is not None else DEFAULT_MAX_ROWS
    except (TypeError, ValueError):
        value = DEFAULT_MAX_ROWS
    if value <= 0:
        value = DEFAULT_MAX_ROWS
    return min(value, HARD_MAX_ROWS)


def _error(error: Exception) -> dict:
    if isinstance(error, (engines.DbError, store.StoreError, writes.WriteBlocked)):
        payload = {"ok": False, "error": {"code": error.code, "message": error.message}}
        if error.hint:
            payload["error"]["hint"] = error.hint
        return payload
    # A driver exception that reached this far is almost always about the SQL
    # itself (a syntax error, a missing table) rather than about the plugin's own
    # machinery, so it is a `db_error`. `infra_error` is reserved for the cases
    # that really are ours — see `engines` where the driver is imported and the
    # connection is opened.
    return {
        "ok": False,
        "error": {"code": "db_error", "message": f"{type(error).__name__}: {error}"},
    }


def _open(datasource: Optional[str]):
    profile, secrets = store.resolve(datasource)
    password = store.password_of(profile, secrets)
    return profile, engines.connect(profile, password)


def _source(profile: dict) -> dict:
    config = profile.get("config") or {}
    kind = profile.get("kind")
    if kind == "sqlite":
        target = config.get("file") or ""
    elif kind == "oracle":
        target = f"{config.get('host')}:{config.get('port') or 1521}/{config.get('serviceName') or config.get('sid') or ''}"
    elif kind == "gauss" and isinstance(config.get("hosts"), list) and len(config["hosts"]) > 1:
        nodes = ",".join(str(node.get("host")) for node in config["hosts"] if isinstance(node, dict))
        target = f"{nodes}:{config.get('port') or 5432}/{config.get('database') or ''}"
    else:
        target = f"{config.get('host')}:{config.get('port') or ''}/{config.get('database') or ''}"
    return {
        "id": profile.get("id"),
        "name": profile.get("name"),
        "kind": kind,
        "readOnly": bool(profile.get("readOnly")),
        "isDefault": bool(profile.get("isDefault")),
        "target": target,
    }


def _inline_profile(kind: str, config: Any, read_only: Optional[bool]) -> dict:
    if not isinstance(config, dict):
        raise store.StoreError("user_error", "inline test needs a config object", "pass kind plus config")
    if kind not in ("sqlite", "postgres", "gauss", "mysql", "oracle"):
        raise store.StoreError("user_error", f"unsupported datasource kind: {kind}")
    return {
        "id": None,
        "name": "inline test",
        "kind": kind,
        "config": config,
        "readOnly": True if read_only is None else bool(read_only),
        "isDefault": False,
        "tags": [],
    }


def _unique_columns(
    profile: dict,
    connection,
    table: str,
    schema: Optional[str],
    cache: dict[str, set[str]],
) -> set[str]:
    """The columns of `table` that are unique on their own.

    Only a single-column key makes its column unique: `ledger(account_no, seq)`
    has `account_no` repeating across `seq`, so taking every key column would call
    it unique and leave a join that clearly points at `account` ambiguous.
    """
    key = str(table).casefold()
    if key in cache:
        return cache[key]
    try:
        info = engines.describe_table(profile, connection, table, schema)
    except Exception:  # noqa: BLE001 - an unreadable table is just unknown
        cache[key] = set()
        return cache[key]
    covered: set[str] = set()
    primary = [name for name in (info.get("primaryKey") or []) if name]
    if len(primary) == 1:
        covered.add(primary[0])
    for index in info.get("indexes") or []:
        columns = [name for name in index.get("columns") or [] if name]
        if bool(index.get("unique")) and len(columns) == 1:
            covered.add(columns[0])
    cache[key] = {name.casefold() for name in covered}
    return cache[key]


def _orient(profile: dict, connection, schema: Optional[str], pairs: list[dict]) -> tuple[list[dict], list[dict]]:
    """Decide which side of each pair is the parent, or report why it cannot.

    An equality says the columns are equal, not who owns whom. The catalog
    answers it: the side whose column is unique on its own is the parent (`to`),
    the other side is the child (`from`). A pair where neither side looks unique,
    or where both do, is reported instead of guessed into the graph.
    """
    found: list[dict] = []
    ambiguous: list[dict] = []
    cache: dict[str, set[str]] = {}
    for item in pairs:
        left = item["left"]
        right = item["right"]
        left_unique = str(left["column"]).casefold() in _unique_columns(profile, connection, left["table"], schema, cache)
        right_unique = str(right["column"]).casefold() in _unique_columns(
            profile, connection, right["table"], schema, cache
        )
        if left_unique == right_unique:
            ambiguous.append({**item, "reason": "both unique" if left_unique else "neither unique"})
            continue
        parent, child = (left, right) if left_unique else (right, left)
        found.append(
            {
                "table": child["table"],
                "column": child["column"],
                "refTable": parent["table"],
                "refColumn": parent["column"],
                "name": item.get("name") or f"seen {item['hits']} time(s)",
            }
        )
    return found, ambiguous


def _audited(fn):
    """Record one audit line per call, when this process owns the log.

    The Host's wrapper only sees the calls it forwarded itself, so a client pointed
    straight at the HTTP endpoint would otherwise leave no trace. Every tool goes
    through here; `audit.record` is a no-op unless the Host set `DB_MCP_AUDIT=1`,
    which it does for the HTTP child only — so the stdio path keeps exactly one
    writer and the file never gets two lines for one call.

    `functools.wraps` keeps the signature FastMCP reads for the tool schema.
    """

    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        started = time.time()
        # FastMCP calls tools by keyword, but a direct call in the tests may not:
        # zip the extra positional ones back onto the parameter names so the
        # recorded line always carries `datasource`, `sql` and `table`.
        call = dict(kwargs)
        names = list(inspect.signature(fn).parameters)
        for index, value in enumerate(args):
            if index < len(names):
                call.setdefault(names[index], value)
        outcome = None
        failure = None
        try:
            outcome = fn(*args, **kwargs)
            return outcome
        except BaseException as error:  # noqa: BLE001 - re-raised, but logged first
            failure = error
            raise
        finally:
            audit.record(fn.__name__, call, started, outcome, failure)

    return wrapper


@mcp.tool()
@_audited
def test_connection(
    datasource: Optional[str] = None,
    kind: Optional[str] = None,
    config: Optional[dict] = None,
    password: Optional[str] = None,
    read_only: Optional[bool] = None,
) -> dict:
    """Log in to a database and run one trivial query, without returning data.

    Use a stored `datasource` id, or pass `kind` plus `config` (and optionally
    `password`, `read_only`) to test a connection that has not been saved yet.
    Returns the server banner, the connected user, the database/schema and how
    long the login took.
    """
    try:
        if kind and config is not None:
            profile = _inline_profile(kind, config, read_only)
            secret = password
        else:
            profile, secrets = store.resolve(datasource)
            secret = password if password is not None else store.password_of(profile, secrets)
        result = engines.probe(profile, secret)
        return {**result, "datasource": _source(profile)}
    except Exception as error:  # noqa: BLE001 - reported as structured data
        payload = _error(error)
        payload["latencyMs"] = 0
        return payload


@mcp.tool()
@_audited
def list_datasources() -> dict:
    """List the database connections the user registered in DSH.

    Call this first. Use the returned `id` as the `datasource` argument of the
    other tools. The default datasource may be omitted everywhere.
    """
    try:
        sources = store.all_sources()
        return {
            "ok": True,
            "datasources": [_source(source) for source in sources],
            "count": len(sources),
        }
    except Exception as error:  # noqa: BLE001 - reported as structured data
        return _error(error)


@mcp.tool()
@_audited
def list_tables(datasource: Optional[str] = None, schema: Optional[str] = None) -> dict:
    """List the tables and views of one datasource.

    `datasource` is an id from list_datasources; omit it to use the default
    source. `schema` narrows the listing when the engine has several schemas.
    """
    try:
        profile, (connection, close) = _open(datasource)
        try:
            result = engines.list_tables(profile, connection, schema)
        finally:
            close()
        return {"ok": True, "datasource": _source(profile), **result}
    except Exception as error:  # noqa: BLE001
        return _error(error)


@mcp.tool()
@_audited
def describe_table(table: str, datasource: Optional[str] = None, schema: Optional[str] = None) -> dict:
    """Describe one table: columns, types, nullability, defaults and primary key.

    Also reports `indexes` (name, columns, whether unique), `comment` and the
    per-column `comment`, and `rowEstimate` — the planner's row count, not a
    `count(*)`. Any of those the engine or the permissions cannot answer comes
    back as `[]` or `null`; the describe call still succeeds. Call this before
    writing SQL so the column names are exact.

    What joins this table to another is not here: call list_edges, which reports
    the relation graph for the whole datasource.
    """
    try:
        profile, (connection, close) = _open(datasource)
        try:
            result = engines.describe_table(profile, connection, table, schema)
        finally:
            close()
        return {"ok": True, "datasource": _source(profile), **result}
    except Exception as error:  # noqa: BLE001
        return _error(error)


@mcp.tool()
@_audited
def list_edges(
    datasource: Optional[str] = None,
    status: Optional[str] = None,
    source: Optional[str] = None,
) -> dict:
    """List the relation graph: which column joins which, and how far it is trusted.

    This is the only place that answers "what joins what". An edge is
    directional like a foreign key: `from` holds the value (the many side), `to`
    is what it points at (the one side), so `T_TRANS.ORDER_ID -> T_ORDER.ID`.

    `status` narrows to one of pending, confirmed, trusted, stale, rejected;
    `source` to fk, manual, inferred, audit_mined. `counts` always covers every
    status, so it stays useful while a filter is on. Only confirmed and trusted
    edges are walked by trace_by_key; a pending edge is a suggestion, and a
    rejected one is on the blacklist.
    """
    try:
        profile, _secrets = store.resolve(datasource)
        result = relations.list_edges(profile, status=status, source=source)
        return {"ok": True, "datasource": _source(profile), **result}
    except Exception as error:  # noqa: BLE001
        return _error(error)


@mcp.tool()
@_audited
def propose_relation(
    from_table: str,
    from_column: str,
    to_table: str,
    to_column: str,
    datasource: Optional[str] = None,
    condition: Optional[str] = None,
    note: Optional[str] = None,
) -> dict:
    """Record a join the catalog does not know about. It starts out `pending`.

    Use it when a schema has no foreign keys but the data clearly joins — a
    legacy database, a warehouse table, a code column. `from` is the side holding
    the value, `to` is the side it points at.

    `condition` is an extra predicate the join needs to be true (a status filter,
    a soft-delete flag); it is kept with the edge so the walker can apply it.
    Proposing the same pair twice updates that one edge instead of adding a
    second, and reopens it if it had been rejected.

    The edge records what searching the referenced column costs — whether an index
    can serve it and roughly how many rows the table holds. That is what lets a
    later trace warn instead of launching a full scan on a huge table. The figures
    come from the catalog; when the datasource cannot be reached right now they are
    left unknown, and a trace fills them in the first time it walks the edge.
    """
    try:
        profile, _secrets = store.resolve(datasource)
        cost = {"indexed": None, "rowEstimate": None}
        try:
            _profile, (connection, close) = _open(datasource)
            try:
                cost = engines.column_cost(profile, connection, to_table, to_column)
            finally:
                close()
        except Exception:  # noqa: BLE001 - the edge stands without the figures
            cost = {"indexed": None, "rowEstimate": None}
        result = relations.propose(
            profile,
            from_table,
            from_column,
            to_table,
            to_column,
            condition=condition,
            note=note,
            indexed=cost.get("indexed"),
            row_estimate=cost.get("rowEstimate"),
        )
        return {"ok": True, "datasource": _source(profile), "cost": relations.cost_of(result["edge"]), **result}
    except Exception as error:  # noqa: BLE001
        return _error(error)


@mcp.tool()
@_audited
def discover_relations(datasource: Optional[str] = None, schema: Optional[str] = None) -> dict:
    """Import the foreign keys the engine declares into the relation graph.

    Reads the catalog and merges what it finds: a key the graph already has keeps
    its status, so a confirmed edge does not fall back to pending just because it
    was discovered again. `imported` counts the new edges, `updated` the ones
    whose status or source changed, `skipped` the ones already present.

    Engines without declared keys (or a schema where they were dropped) come back
    with nothing imported — that is the case propose_relation exists for.
    """
    try:
        profile, (connection, close) = _open(datasource)
        try:
            found = engines.list_relations(profile, connection, schema)
        finally:
            close()
        result = relations.import_edges(profile, found.get("relations") or [])
        return {"ok": True, "datasource": _source(profile), **result}
    except Exception as error:  # noqa: BLE001
        return _error(error)


@mcp.tool()
@_audited
def mine_relations(
    datasource: Optional[str] = None,
    schema: Optional[str] = None,
    limit: int = 20,
) -> dict:
    """Import joins someone already wrote, mined from the audit log.

    `discover_relations` reads what the engine declares; this reads what was
    actually typed. Every `execute_sql` and `explain_query` line keeps its
    statement, so a join written last week is evidence that the join exists — the
    cheapest source there is for a schema with no declared keys.

    Nothing is trusted on sight: mined edges arrive as `pending` with source
    `audit_mined`, exactly like a proposal, and the walker ignores them until a
    trace confirms them. A join the catalog declares is not relabelled by this, and
    a source already stronger (a hand proposal) is not downgraded.

    Which side is the child cannot be read off the statement — `a.id = b.a_id`
    says the columns are equal, not who owns whom. So each pair is oriented from
    the catalog: the side whose column is a primary key or a unique index is the
    parent (`to`), the other side is the child (`from`). A pair where neither side
    looks unique, or where both do, is reported under `ambiguous` instead of being
    guessed into the graph.

    `limit` caps how many pairs are considered, highest hit count first. No
    statement is ever run again, and no row data is involved.
    """
    try:
        profile, _secrets = store.resolve(datasource)
        keys = [item for item in (profile.get("id"), profile.get("name")) if isinstance(item, str)]
        rows = audit.lines()
        mined = mining.candidates(rows, keys, include_anonymous=bool(profile.get("isDefault")), limit=limit)
        for item in mined:
            item["name"] = f"mined from {item['hits']} statement(s)"
        ambiguous: list[dict] = []
        found: list[dict] = []
        if mined:
            _profile, (connection, close) = _open(datasource)
            try:
                found, ambiguous = _orient(profile, connection, schema, mined)
            finally:
                close()
        result = relations.import_edges(profile, found, source="audit_mined")
        return {
            "ok": True,
            "datasource": _source(profile),
            "mined": len(mined),
            "ambiguous": ambiguous,
            **result,
        }
    except Exception as error:  # noqa: BLE001
        return _error(error)


@mcp.tool()
@_audited
def scan_code_relations(
    root: str,
    datasource: Optional[str] = None,
    schema: Optional[str] = None,
    limit: int = 20,
) -> dict:
    """Import joins written in a Spring Boot project, read from its source tree.

    `mine_relations` reads statements that were executed; this reads the ones that
    were committed. Three places hold them, and only those are read:

    * MyBatis mapper XML — the bodies of `select`/`insert`/`update`/`delete`/`sql`,
      including whatever sits inside `<if>`/`<foreach>`/`<where>`;
    * MyBatis annotations — `@Select`, `@Insert`, `@Update`, `@Delete`;
    * MyBatis-Plus fragments — `.apply(...)`, `.last(...)`, `.inSql(...)`,
      `.exists(...)`, `.notExists(...)`, `.having(...)`.

    Every other string literal in a `.java` file is skipped on purpose: a log
    message or a regex read as SQL would invent tables and joins, and a scanner
    that guesses is worse than one that finds nothing. `build`, `target`, `.git`
    and friends are skipped too, so generated copies do not count twice.

    `root` is the project directory. `datasource` is the graph the joins are
    imported into — the direction cannot be decided without a catalog to ask, so a
    source must be registered and reachable. Edges arrive as `pending` with source
    `audit_mined`, like every other guess, and nothing is executed: the files are
    read, never run.

    A pair whose parent side cannot be decided from the catalog (neither column is
    unique on its own, or both are) is reported under `ambiguous` instead of being
    guessed into the graph. `limit` caps how many pairs are considered, highest
    occurrence count first.
    """
    try:
        profile, _secrets = store.resolve(datasource)
        found_files = sources.statements(root, limit=2000)
        statements = [item["sql"] for item in found_files]
        mined = mining.statements_candidates(statements, limit=limit)
        # Where each pair was seen, so the report points at the file to fix rather
        # than at a statement nobody can locate again.
        places: dict[tuple[str, str, str, str], list[str]] = {}
        for item in found_files:
            for left, right in mining._joins(item["sql"]):
                key = mining._key(left, right)
                spot = f"{item['file']}:{item['line']}"
                bucket = places.setdefault(key, [])
                if spot not in bucket and len(bucket) < 5:
                    bucket.append(spot)
        for item in mined:
            left = item["left"]
            right = item["right"]
            key = (
                min(
                    (left["table"].casefold(), left["column"].casefold()),
                    (right["table"].casefold(), right["column"].casefold()),
                )
                + max(
                    (left["table"].casefold(), left["column"].casefold()),
                    (right["table"].casefold(), right["column"].casefold()),
                )
            )
            seen_at = places.get(key) or []
            item["name"] = f"read from {seen_at[0]}" if seen_at else "read from the source tree"
            item["places"] = seen_at
        ambiguous: list[dict] = []
        found: list[dict] = []
        if mined:
            _profile, (connection, close) = _open(datasource)
            try:
                found, ambiguous = _orient(profile, connection, schema, mined)
            finally:
                close()
        result = relations.import_edges(profile, found, source="audit_mined")
        return {
            "ok": True,
            "datasource": _source(profile),
            "root": str(root),
            "scanned": len(found_files),
            "mined": len(mined),
            "ambiguous": ambiguous,
            **result,
        }
    except Exception as error:  # noqa: BLE001
        return _error(error)


@mcp.tool()
@_audited
def feedback_relation(
    edge_id: str,
    verdict: str,
    reason: Optional[str] = None,
    note: Optional[str] = None,
    datasource: Optional[str] = None,
    fanout: Optional[float] = None,
    ms: Optional[float] = None,
) -> dict:
    """Record what a trace step showed, and move the edge accordingly.

    `verdict` is one of:

    - `ok` — the step returned the rows it should have. This is the only verdict
      that confirms an edge; three confirmations, no rejection left, a fanout of 5
      or less and recent steps all faster than the slow threshold make it
      `trusted`, which the walker follows without asking again. An index on the
      referenced column is a bonus, not a requirement — timing is what proves the
      step is cheap.
    - `too_many` — the step matched rows it should not have. `reason` says why:
      `wrong_column` (the column is not the key), `needs_condition` (the join is
      only true under a filter — set it with set_relation_condition),
      `not_unique` (the reference column repeats, so one value has several
      parents). The edge becomes `stale` and stops being walked.
    - `missing` — a row that should have been reached was not. Also `stale`.
    - `irrelevant` — the edge has nothing to do with this value at all. The edge
      is `rejected`, which is the blacklist: only proposing it again lifts it.

    `fanout` is the average number of rows the parent side matched; pass what the
    trace reported so trust can be recomputed from real measurements rather than
    guessed. `ms` is how long that step took — it is kept with the edge and is what
    the trust rule reads. Whether the referenced column is indexed and how big its
    table is are read from the catalog here, so the caller does not have to say.
    """
    try:
        profile, _secrets = store.resolve(datasource)
        indexed = None
        unique = None
        row_estimate = None
        try:
            _profile, (connection, close) = _open(datasource)
            try:
                doc = relations.load(profile)
                target = next((edge for edge in doc["edges"] if edge.get("id") == edge_id), None)
                if target is not None:
                    table = (target.get("to") or {}).get("table")
                    column = (target.get("to") or {}).get("column")
                    if table and column:
                        cost = engines.column_cost(profile, connection, table, column)
                        indexed = cost.get("indexed")
                        row_estimate = cost.get("rowEstimate")
                        described = engines.describe_table(profile, connection, table, None)
                        unique = any(
                            bool(index.get("unique"))
                            and [str(part).casefold() for part in index.get("columns") or []]
                            == [str(column).casefold()]
                            for index in described.get("indexes") or []
                        )
            finally:
                close()
        except Exception:  # noqa: BLE001 - the verdict stands without the hints
            indexed = None
            unique = None
            row_estimate = None
        result = relations.feedback(
            profile,
            edge_id,
            verdict,
            reason=reason,
            note=note,
            indexed=indexed,
            unique=unique,
            fanout=fanout,
            row_estimate=row_estimate,
            ms=ms,
        )
        return {
            "ok": True,
            "datasource": _source(profile),
            "indexed": indexed,
            "unique": unique,
            "cost": relations.cost_of(result["edge"]),
            **result,
        }
    except Exception as error:  # noqa: BLE001
        return _error(error)


@mcp.tool()
@_audited
def set_relation_condition(
    edge_id: str,
    condition: Optional[str] = None,
    datasource: Optional[str] = None,
) -> dict:
    """Attach (or clear) the extra predicate an edge needs to be true.

    Some joins only hold under a filter — `T_TRANS.STATUS = 'POSTED'`, a
    soft-delete flag, a partition. Keeping the predicate with the edge is what
    lets the walker build the right `where` without a model in the loop. Pass an
    empty or missing `condition` to clear it.

    Setting a condition does not change the status: a `stale` edge stays stale
    until the next trace step confirms it, so adding a filter never silently
    re-enables a join that was rejected for a reason.
    """
    try:
        profile, _secrets = store.resolve(datasource)
        result = relations.set_condition(profile, edge_id, condition)
        return {"ok": True, "datasource": _source(profile), **result}
    except Exception as error:  # noqa: BLE001
        return _error(error)


@mcp.tool()
@_audited
def delete_edge(edge_id: str, datasource: Optional[str] = None) -> dict:
    """Remove one edge from the relation graph for good.

    Use it when a join is simply wrong and no verdict describes it — a `rejected`
    edge is kept on purpose so the same wrong join is not proposed again, but a
    typo is not worth remembering. `discover_relations` brings back anything the
    catalog still declares.
    """
    try:
        profile, _secrets = store.resolve(datasource)
        result = relations.delete_edge(profile, edge_id)
        return {"ok": True, "datasource": _source(profile), **result}
    except Exception as error:  # noqa: BLE001
        return _error(error)


@mcp.tool()
@_audited
def trace_by_key(
    value: str,
    datasource: Optional[str] = None,
    entry_table: Optional[str] = None,
    entry_column: Optional[str] = None,
    max_depth: int = 3,
    max_rows_per_table: int = 20,
    direction: str = "both",
    confirm_slow: bool = False,
) -> dict:
    """Follow one value across the joins the relation graph trusts.

    Pass a key — an order id, a customer code, a document number — and this walks
    from wherever it lives along confirmed and trusted edges. It never runs a
    statement that changes data, and the value travels as a bind parameter, so a
    quote in it cannot alter the query.

    Without `entry_table` the walker probes the columns a join already points at,
    then the indexed key-shaped columns of the most connected tables. Naming the
    table and column skips that search and is faster on a large schema.

    `direction` is `down` (follow foreign keys: child to parent), `up` (parent to
    children) or `both`. `max_depth` is clamped to 6 and `max_rows_per_table` to
    200.

    A step whose column has no index and whose table is very large is a full table
    scan. The trace does not pay for it on its own: that step comes back with
    `status: "needs_confirm"` and `summary.needsConfirm` counts them. Look at which
    table and how big, then call again with `confirm_slow=True` to allow it.

    Every step reports the table, the bound condition, the SQL that ran, how many
    rows came back, how long it took and a few sample cells; `status: "empty"` is a
    chain that broke there. Pending edges are listed under `pending` — confirming
    one lets the trace follow it — and anything truncated or skipped is in
    `warnings` or `stoppedAt` rather than quietly missing.
    """
    try:
        profile, (connection, close) = _open(datasource)
        try:
            result = tracing.trace(
                profile,
                connection,
                value,
                entry_table=entry_table,
                entry_column=entry_column,
                max_depth=max_depth,
                max_rows_per_table=max_rows_per_table,
                direction=direction,
                confirm_slow=confirm_slow,
            )
        finally:
            close()
        return {"ok": True, "datasource": _source(profile), **result}
    except Exception as error:  # noqa: BLE001
        return _error(error)


@mcp.tool()
@_audited
def sample_rows(
    table: str,
    datasource: Optional[str] = None,
    limit: int = 20,
    schema: Optional[str] = None,
) -> dict:
    """Return a few rows from one table, to see what the data looks like."""
    try:
        rows = _clamp_rows(limit)
        profile, (connection, close) = _open(datasource)
        try:
            result = engines.sample_rows(profile, connection, table, rows, schema)
        finally:
            close()
        return {"ok": True, "datasource": _source(profile), **result}
    except Exception as error:  # noqa: BLE001
        return _error(error)


@mcp.tool()
@_audited
def execute_sql(
    sql: str,
    datasource: Optional[str] = None,
    max_rows: Optional[int] = None,
    full_text: Optional[bool] = None,
) -> dict:
    """Execute one SQL statement — a query or, when writes are enabled, a change.

    Read-only datasources accept SELECT/WITH/SHOW/EXPLAIN statements only; every
    other statement is refused before it reaches the database. Results are capped by
    `max_rows` (default 200) and `truncated` says whether more rows existed. Writes
    (INSERT/UPDATE/DELETE/DDL) are committed and report `affectedRows` instead of a
    result set. One statement per call: no scripts, no `;`-separated batches.

    Long text cells are summarised so a wide table cannot flood the context; pass
    `full_text: true` when the whole value matters (for example before writing it
    somewhere else). The setting in the panel decides the default.
    """
    try:
        limit = _clamp_rows(max_rows)
        profile, (connection, close) = _open(datasource)
        try:
            result = engines.execute_sql(profile, connection, sql, limit, bool(full_text))
        finally:
            close()
        return {"ok": True, "datasource": _source(profile), **result}
    except Exception as error:  # noqa: BLE001
        return _error(error)


@mcp.tool()
@_audited
def explain_query(sql: str, datasource: Optional[str] = None) -> dict:
    """Show the query plan of one statement, without running it.

    One statement per call, the same as execute_sql.
    """
    try:
        profile, (connection, close) = _open(datasource)
        try:
            result = engines.explain_query(profile, connection, sql)
        finally:
            close()
        return {"ok": True, "datasource": _source(profile), **result}
    except Exception as error:  # noqa: BLE001
        return _error(error)


@mcp.tool()
@_audited
def get_ddl(table: str, datasource: Optional[str] = None, schema: Optional[str] = None) -> dict:
    """Show the CREATE TABLE statement of one table.

    SQLite returns the statement recorded at creation time; PostgreSQL, MySQL
    and Oracle have theirs rebuilt from the column metadata.
    """
    try:
        profile, (connection, close) = _open(datasource)
        try:
            result = engines.table_ddl(profile, connection, table, schema)
        finally:
            close()
        return {"ok": True, "datasource": _source(profile), **result}
    except Exception as error:  # noqa: BLE001
        return _error(error)


def main() -> None:
    args = _transport_args(sys.argv[1:])
    if args["help"]:
        print(USAGE)
        return
    mcp.run(transport=args["transport"])


if __name__ == "__main__":
    main()
