"""db-mcp: the MCP server that lets the agent read the databases registered in
the dsh-db-mcp plugin panel.

Run over stdio (the plugin Host half spawns it):

    python main.py

Every tool re-reads `datasources.json` and `secrets.json`, so sources added or
edited in the panel are visible without a restart. Tools never return passwords.
"""

from __future__ import annotations

import json
import os
import time
from typing import Any, Optional

from mcp.server.fastmcp import FastMCP

import engines
import store

DEFAULT_MAX_ROWS = int(os.environ.get("DB_MCP_MAX_ROWS") or 200)
HARD_MAX_ROWS = int(os.environ.get("DB_MCP_MAX_ROWS_HARD") or 2000)

mcp = FastMCP(
    "db-mcp",
    instructions=(
        "Work with the databases the user registered in the DSH Database panel. "
        "Start with list_datasources, then list_tables, describe_table and finally "
        "execute_sql. execute_sql runs any single statement: SELECT and EXPLAIN when "
        "the source is read-only, INSERT/UPDATE/DELETE/DDL only when writes are "
        "enabled. Prefer these tools over guessing table names."
    ),
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
    if isinstance(error, (engines.DbError, store.StoreError)):
        payload = {"ok": False, "error": {"code": error.code, "message": error.message}}
        if error.hint:
            payload["error"]["hint"] = error.hint
        return payload
    return {
        "ok": False,
        "error": {"code": "infra_error", "message": f"{type(error).__name__}: {error}"},
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
    if kind not in ("sqlite", "postgres", "mysql", "oracle"):
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


@mcp.tool()
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
def describe_table(table: str, datasource: Optional[str] = None, schema: Optional[str] = None) -> dict:
    """Describe one table: column names, types, nullability, defaults and primary key.

    Call this before writing SQL so the column names are exact.
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
def execute_sql(sql: str, datasource: Optional[str] = None, max_rows: Optional[int] = None) -> dict:
    """Execute one SQL statement — a query or, when writes are enabled, a change.

    Read-only datasources accept SELECT/WITH/SHOW/EXPLAIN statements only; every
    other statement is refused before it reaches the database. Results are capped by
    `max_rows` (default 200) and `truncated` says whether more rows existed. Writes
    (INSERT/UPDATE/DELETE/DDL) are committed and report `affectedRows` instead of a
    result set. One statement per call: no scripts, no `;`-separated batches.
    """
    try:
        limit = _clamp_rows(max_rows)
        profile, (connection, close) = _open(datasource)
        try:
            result = engines.execute_sql(profile, connection, sql, limit)
        finally:
            close()
        return {"ok": True, "datasource": _source(profile), **result}
    except Exception as error:  # noqa: BLE001
        return _error(error)


@mcp.tool()
def explain_query(sql: str, datasource: Optional[str] = None) -> dict:
    """Show the query plan of one statement, without running it."""
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
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
