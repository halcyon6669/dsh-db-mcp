"""Manual smoke run: how long does a catalog refresh take on a real database?

Not part of `npm test` — it needs a database with hundreds of tables, which CI
does not have. Run it against the Docker engines on this machine:

    # a catalog of 520 tables on the local PostgreSQL container
    python dev/manual/catalog-smoke.py --kind postgres --port 15433 --password testpass

    # the same on openGauss (already holds a wide schema)
    python dev/manual/catalog-smoke.py --kind gauss --port 15432 \
        --database postgres --user gaussdb --password 'Gauss#Db2026' --no-create

It prints what the run cost — total wall time, the per-table distribution
(p50 / p95 / max), and how many tables came back timed out or unreadable — and
then *suggests* a per-table timeout and a total budget. It never edits a
default: `bundle_cli.refresh`'s `timeout_ms` and the engine statement timeout
are changed by a person, from data like this, not by a script.

The refresh is the real `bundle_cli.refresh`, driven through a bundle payload
whose scene names every table — that is exactly how the panel fills the cache.
Only `engines.describe_table` is wrapped, to time each table on its own.
"""

from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
import tempfile
import time
from pathlib import Path

PACKAGE = Path(__file__).resolve().parent.parent.parent
SERVER = PACKAGE / "server"
# The server modules import each other by bare name (`import store`), so the
# directory has to be on the path before the first one is loaded.
if str(SERVER) not in sys.path:
    sys.path.insert(0, str(SERVER))


# One table shape, spelled for each engine: `create table if not exists` and
# `character varying` are not portable, and a smoke run has to reach all four.
DDL = {
    "postgres": (
        "create table if not exists {name} (id integer primary key, order_no character varying(32) not null,"
        " customer_code character varying(32), amount numeric(12,2), state character varying(16),"
        " created_at timestamp)"
    ),
    "gauss": (
        "create table if not exists {name} (id integer primary key, order_no character varying(32) not null,"
        " customer_code character varying(32), amount numeric(12,2), state character varying(16),"
        " created_at timestamp)"
    ),
    "mysql": (
        "create table if not exists {name} (id integer primary key, order_no varchar(32) not null,"
        " customer_code varchar(32), amount numeric(12,2), state varchar(16), created_at datetime)"
    ),
    "oracle": (
        "create table {name} (id integer primary key, order_no varchar2(32) not null,"
        " customer_code varchar2(32), amount number(12,2), state varchar2(16), created_at timestamp)"
    ),
}


def existing_tables(connection, kind: str, count: int) -> list[str]:
    """The first `count` tables already present, for --no-create."""
    cursor = connection.cursor()
    try:
        if kind in ("postgres", "gauss"):
            cursor.execute(
                "select table_name from information_schema.tables "
                "where table_schema not in ('pg_catalog','information_schema') "
                f"order by table_name limit {count}"
            )
        elif kind == "mysql":
            cursor.execute(
                "select table_name from information_schema.tables "
                f"where table_schema = database() order by table_name limit {count}"
            )
        else:
            cursor.execute(
                "select table_name from user_tables "
                f"where rownum <= {count} order by table_name"
            )
        return [str(row[0]) for row in cursor.fetchall()]
    finally:
        cursor.close()


def build_tables(engines, profile: dict, kind: str, count: int, dry: bool) -> list[str]:
    """Create `count` tables shaped like a business table, or discover existing ones.

    The refresh itself reads a read-only connection, the way the panel does. The
    setup needs a writable one, so it is opened from a copy of the profile with
    `readOnly` cleared.
    """
    password = os.environ.get("SMOKE_PASSWORD")
    writable = dict(profile, readOnly=False)
    connection, close = engines.connect(writable, password)
    names: list[str] = []
    try:
        if dry:
            return existing_tables(connection, kind, count)
        cursor = connection.cursor()
        # Oracle refuses `if not exists`, so a repeat run drops its own tables
        # first; the other three keep whatever is there.
        for index in range(count):
            name = f"smoke_t{index:04d}"
            statement = DDL[kind].format(name=name)
            try:
                cursor.execute(statement)
            except Exception as error:  # noqa: BLE001 - an existing table is not a failure
                if kind != "oracle" or "already" not in str(error).lower():
                    raise
            names.append(name)
        connection.commit()
        cursor.close()
    finally:
        close()
    return names


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--kind", default="postgres", help="postgres, gauss, mysql, oracle (default: postgres)")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=15433)
    parser.add_argument("--user", default=None)
    parser.add_argument("--password", default=None, help="omit to read SMOKE_PASSWORD")
    parser.add_argument("--database", default=None)
    parser.add_argument("--schema", default=None, help="the schema to read (default: the engine's own)")
    parser.add_argument("--tables", type=int, default=520, help="how many tables to refresh (default: 520)")
    parser.add_argument("--no-create", action="store_true", help="use the tables already there instead of creating them")
    parser.add_argument("--timeout-ms", type=int, default=0, help="total budget to pass to refresh (0 = none)")
    parser.add_argument("--json", action="store_true", help="print the numbers as JSON, for a log")
    args = parser.parse_args()

    if args.password:
        os.environ["SMOKE_PASSWORD"] = args.password
    # A throwaway runtime dir: this run must not touch the real catalog cache.
    temp_runtime = tempfile.mkdtemp(prefix="dbmcp-smoke-")
    os.environ["DB_MCP_RUNTIME"] = temp_runtime

    # Import them the way the server does — `import engines` / `import store` —
    # rather than by file path. Loading by path gives each module its own copy of
    # its dependencies, and then a patch on `store` never reaches `bundle_cli`.
    import bundle_cli
    import engines
    import store
    # The refresh asks the secrets store for the password; a smoke run keeps the
    # secret on the command line instead of writing it into a throwaway store.
    smoke_password = os.environ.get("SMOKE_PASSWORD")
    store.password_of = lambda profile, secrets=None: smoke_password
    store.load_secrets = lambda: {}

    config = {"host": args.host, "port": args.port}
    if args.user:
        config["user"] = args.user
    if args.database:
        # Oracle has no `database` in a connection: the value is a service name.
        config["serviceName" if args.kind == "oracle" else "database"] = args.database
    profile = {"id": "smoke", "name": "smoke", "kind": args.kind, "config": config, "readOnly": True}

    created = build_tables(engines, profile, args.kind, args.tables, args.no_create)
    if len(created) < args.tables:
        print(f"warning: only {len(created)} table(s) available, asked for {args.tables}", file=sys.stderr)

    # Time each describe_table call; refresh does the rest exactly as the panel does.
    timings: list[tuple[str, float, str]] = []
    original = engines.describe_table

    def timed(profile_arg, connection, table, schema=None):
        started = time.perf_counter()
        outcome = "ok"
        try:
            return original(profile_arg, connection, table, schema)
        except Exception as error:  # noqa: BLE001 - the point of the run is to see failures
            outcome = engines._is_timeout(error) and "timeout" or f"{type(error).__name__}"
            raise
        finally:
            timings.append((str(table), (time.perf_counter() - started) * 1000.0, outcome))

    engines.describe_table = timed
    payload = {"schemaVersion": 1, "kind": "db-mcp-bundle", "edges": [], "scenes": [{"name": "smoke", "tables": created}]}
    started = time.perf_counter()
    try:
        result = bundle_cli.refresh(profile, payload=payload, schema=args.schema,
                                    timeout_ms=args.timeout_ms or None)
    finally:
        engines.describe_table = original
        total_ms = (time.perf_counter() - started) * 1000.0

    durations = sorted(ms for _, ms, outcome in timings if outcome == "ok")
    timed_out = [name for name, _, outcome in timings if outcome == "timeout"]
    failed = [(name, outcome) for name, _, outcome in timings if outcome not in ("ok", "timeout")]

    def percentile(values: list[float], fraction: float) -> float:
        if not values:
            return 0.0
        index = min(len(values) - 1, max(0, int(round((len(values) - 1) * fraction))))
        return values[index]

    summary = {
        "kind": args.kind,
        "schema": args.schema,
        "asked": len(created),
        "checked": len(result.get("checked") or []),
        "missing": len(result.get("missing") or []),
        "notChecked": len(result.get("notChecked") or []),
        "timedOut": len(timed_out),
        "failed": len(failed),
        "totalMs": round(total_ms, 1),
        "perTable": {
            "p50": round(percentile(durations, 0.50), 2),
            "p95": round(percentile(durations, 0.95), 2),
            "max": round(max(durations) if durations else 0.0, 2),
            "mean": round(statistics.fmean(durations), 2) if durations else 0.0,
        },
    }

    if args.json:
        print(json.dumps(summary, ensure_ascii=False, indent=2))
    else:
        print(f"engine          {summary['kind']}"
              + (f"  schema {summary['schema']}" if summary["schema"] else ""))
        print(f"tables asked    {summary['asked']}")
        print(f"  checked       {summary['checked']}")
        print(f"  missing       {summary['missing']}")
        print(f"  not checked   {summary['notChecked']}")
        print(f"  timed out     {summary['timedOut']}")
        print(f"  failed        {summary['failed']}")
        print(f"total time      {summary['totalMs']:.0f} ms")
        print(f"per table       p50 {summary['perTable']['p50']:.2f} ms · "
              f"p95 {summary['perTable']['p95']:.2f} ms · "
              f"max {summary['perTable']['max']:.2f} ms · "
              f"mean {summary['perTable']['mean']:.2f} ms")
        if timed_out[:5]:
            print(f"timed out       {', '.join(timed_out[:5])}{' …' if len(timed_out) > 5 else ''}")
        if failed[:5]:
            print(f"failed          " + ", ".join(f"{name} ({outcome})" for name, outcome in failed[:5]))

        # A suggestion, not a default. Rules of thumb made explicit:
        #  * a per-table timeout a few times the p95 leaves room for a slow
        #    table without letting one hang hold the run;
        #  * the budget covers the whole batch at p95 pace with headroom, so a
        #    refresh of the tables a reader actually looks at finishes.
        # The numbers below come from tables this script just created empty, in
        # Docker on one machine, over a loopback network. A catalog lookup cost
        # depends on the engine, the load and the network, so these are a floor
        # to reason from, not a setting to copy onto a remote database.
        p95 = summary["perTable"]["p95"] or 0.0
        suggested_table = max(1000, int(round(p95 * 5 / 250.0)) * 250) if p95 else None
        batch = summary["checked"] or summary["asked"]
        suggested_budget = max(5000, int(round(batch * p95 * 3 / 1000.0)) * 1000) if p95 else None
        print()
        print("suggestion (report only — nothing here changes a default):")
        print("  based on empty tables created just now, in Docker on this machine,")
        print("  over loopback. For reference only: not valid for a remote database,")
        print("  where network latency and engine load dominate the same lookup.")
        if suggested_table:
            print(f"  per-table timeout ≈ {suggested_table} ms   (≈5× p95 {p95:.0f} ms)")
        if suggested_budget:
            print(f"  total budget      ≈ {suggested_budget} ms   ({batch} tables at 3× p95 pace)")
        else:
            print("  not enough successful reads to suggest anything")

    print(f"\nruntime dir (throwaway): {temp_runtime}")
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(main())
