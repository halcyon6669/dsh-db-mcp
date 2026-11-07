"""Per-engine connection, introspection and query helpers.

Each public function takes a resolved datasource profile (the registry entry) and
returns plain JSON-able data. Nothing here keeps a connection alive between
calls: a tool call opens, uses and closes its own connection, which keeps the
process stateless and safe to restart.
"""

from __future__ import annotations

import datetime as _dt
import decimal
import os
import re
import sqlite3
import time
from pathlib import Path

READ_STARTERS = ("select", "with", "show", "describe", "desc", "explain", "pragma", "values", "table", "set")


def allow_write() -> bool:
    """Global write switch, exported by the host when it spawns this server."""
    return os.environ.get("DB_MCP_ALLOW_WRITE", "0") == "1"
MAX_TEXT = 4000


class DbError(Exception):
    def __init__(self, code: str, message: str, hint: str | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.hint = hint


# --------------------------------------------------------------------------- #
# helpers


def _first_keyword(sql: str) -> str:
    text = sql or ""
    # drop leading line/block comments so `-- hi\nselect 1` still reads as SELECT
    while True:
        stripped = text.lstrip()
        if stripped.startswith("--"):
            newline = stripped.find("\n")
            text = "" if newline < 0 else stripped[newline + 1 :]
            continue
        if stripped.startswith("/*"):
            end = stripped.find("*/")
            text = "" if end < 0 else stripped[end + 2 :]
            continue
        text = stripped
        break
    match = re.match(r"[A-Za-z]+", text)
    return match.group(0).lower() if match else ""


def ensure_readable(sql: str, profile: dict) -> None:
    """Refuse changing statements on a read-only source, before touching the DB."""
    keyword = _first_keyword(sql)
    if keyword in READ_STARTERS:
        return
    if not allow_write():
        raise DbError(
            "user_error",
            f"writes are disabled for the whole plugin; `{keyword or 'this'} ` statements are refused",
            "turn on the global write switch in the Database panel first",
        )
    if profile.get("readOnly"):
        raise DbError(
            "user_error",
            f"datasource {profile.get('id')} is read-only; `{keyword or 'this'} ` statements are refused",
            "uncheck read-only for this source in the Database panel to allow writes",
        )


def _cell(value):
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, decimal.Decimal):
        return str(value)
    if isinstance(value, (_dt.datetime, _dt.date, _dt.time)):
        return value.isoformat()
    if isinstance(value, (bytes, bytearray, memoryview)):
        raw = bytes(value)
        return f"<{len(raw)} bytes> " + raw[:64].hex()
    text = str(value)
    return text if len(text) <= MAX_TEXT else text[:MAX_TEXT] + f"… (+{len(text) - MAX_TEXT})"


def _rows(cursor, max_rows: int) -> tuple[list[str], list[list], bool]:
    columns = [str(description[0]) for description in (cursor.description or [])]
    rows: list[list] = []
    truncated = False
    for index, row in enumerate(cursor):
        if index >= max_rows:
            truncated = True
            break
        rows.append([_cell(value) for value in row])
    return columns, rows, truncated


def _quote(kind: str, name: str) -> str:
    text = str(name)
    if kind == "mysql":
        return "`" + text.replace("`", "``") + "`"
    if kind == "oracle":
        # Oracle folds unquoted identifiers to upper case; quoting a lower-case
        # name would look for a table that was never created that way.
        return '"' + text.upper().replace('"', '""') + '"'
    return '"' + text.replace('"', '""') + '"'


def qualified(profile: dict, table: str) -> str:
    kind = profile.get("kind")
    schema = (profile.get("config") or {}).get("schema") or None
    if kind == "oracle":
        schema = (schema or (profile.get("config") or {}).get("user") or "").upper() or None
    if schema and kind in ("postgres", "oracle", "mysql"):
        return f"{_quote(kind, schema)}.{_quote(kind, table)}"
    return _quote(kind, table)


def _limit_clause(kind: str, limit: int) -> str:
    if kind == "oracle":
        return f" FETCH FIRST {int(limit)} ROWS ONLY"
    return f" LIMIT {int(limit)}"


# --------------------------------------------------------------------------- #
# connections


def connect(profile: dict, password: str | None):
    """Open one connection for `profile`. Returns (connection, close-callable)."""
    kind = profile.get("kind")
    config = profile.get("config") or {}
    if kind == "sqlite":
        return _connect_sqlite(profile, config)
    if kind == "postgres":
        return _connect_postgres(profile, config, password)
    if kind == "mysql":
        return _connect_mysql(profile, config, password)
    if kind == "oracle":
        return _connect_oracle(profile, config, password)
    raise DbError("user_error", f"unsupported datasource kind: {kind}")


def _connect_sqlite(profile: dict, config: dict):
    path = config.get("file")
    if not path:
        raise DbError("user_error", "this SQLite datasource has no file path")
    target = Path(str(path)).expanduser()
    if not target.exists():
        raise DbError("db_error", f"SQLite file not found: {target}")
    timeout = float(config.get("busyTimeoutMs") or 5000) / 1000.0
    if profile.get("readOnly"):
        uri = target.resolve().as_uri() + "?mode=ro"
        connection = sqlite3.connect(uri, uri=True, timeout=timeout)
    else:
        connection = sqlite3.connect(str(target), timeout=timeout)
    return connection, connection.close


def _connect_postgres(profile: dict, config: dict, password: str | None):
    try:
        import psycopg
    except ImportError as error:  # pragma: no cover - environment problem
        raise DbError("infra_error", f"psycopg is not installed: {error}", "run the plugin's Python setup again")
    options = "-c default_transaction_read_only=on" if profile.get("readOnly") else None
    try:
        connection = psycopg.connect(
            host=config.get("host") or "localhost",
            port=int(config.get("port") or 5432),
            dbname=config.get("database") or None,
            user=config.get("user") or None,
            password=password,
            connect_timeout=10,
            options=options,
            application_name=config.get("applicationName") or "dsh-db-mcp",
        )
    except Exception as error:  # noqa: BLE001 - driver specific exception types
        raise DbError("db_error", f"PostgreSQL connection failed: {error}")
    return connection, connection.close


def _connect_mysql(profile: dict, config: dict, password: str | None):
    try:
        import pymysql
    except ImportError as error:  # pragma: no cover - environment problem
        raise DbError("infra_error", f"PyMySQL is not installed: {error}", "run the plugin's Python setup again")
    try:
        connection = pymysql.connect(
            host=config.get("host") or "localhost",
            port=int(config.get("port") or 3306),
            database=config.get("database") or None,
            user=config.get("user") or None,
            password=password or "",
            connect_timeout=10,
            charset=config.get("charset") or "utf8mb4",
            autocommit=False,
        )
    except Exception as error:  # noqa: BLE001 - driver specific exception types
        raise DbError("db_error", f"MySQL connection failed: {error}")
    if profile.get("readOnly"):
        try:
            with connection.cursor() as cursor:
                cursor.execute("SET SESSION TRANSACTION READ ONLY")
        except Exception:  # noqa: BLE001 - older servers do not support the switch
            pass
    return connection, connection.close


def _connect_oracle(profile: dict, config: dict, password: str | None):
    try:
        import oracledb
    except ImportError as error:  # pragma: no cover - environment problem
        raise DbError("infra_error", f"oracledb is not installed: {error}", "run the plugin's Python setup again")
    host = config.get("host") or "localhost"
    port = int(config.get("port") or 1521)
    if config.get("serviceName"):
        dsn = oracledb.makedsn(host, port, service_name=str(config["serviceName"]))
    elif config.get("sid"):
        dsn = oracledb.makedsn(host, port, sid=str(config["sid"]))
    else:
        raise DbError("user_error", "this Oracle datasource needs a service name or a SID")
    try:
        connection = oracledb.connect(user=config.get("user") or None, password=password, dsn=dsn)
    except Exception as error:  # noqa: BLE001 - driver specific exception types
        raise DbError("db_error", f"Oracle connection failed: {error}")
    return connection, connection.close


# --------------------------------------------------------------------------- #
# connection probe (used by the panel's Test button)


def _fetch(kind: str, connection, sql: str):
    if kind == "sqlite":
        return connection.execute(sql).fetchone()
    cursor = connection.cursor()
    try:
        cursor.execute(sql)
        return cursor.fetchone()
    finally:
        cursor.close()


def _probe_identity(kind: str, connection, profile: dict) -> dict:
    config = profile.get("config") or {}
    if kind == "sqlite":
        row = _fetch(kind, connection, "select sqlite_version()")
        return {"server": f"SQLite {row[0] if row else ''}".strip(), "database": config.get("file")}
    if kind == "postgres":
        row = _fetch(kind, connection, "select version()")
        banner = str(row[0]) if row else "PostgreSQL"
        row = _fetch(kind, connection, "select current_database(), current_user, current_schema()")
        database, user, schema = row if row else (None, None, None)
        return {
            "server": banner.split(" on ")[0],
            "database": database,
            "user": user,
            "schema": schema,
        }
    if kind == "mysql":
        row = _fetch(kind, connection, "select version()")
        version = str(row[0]) if row else ""
        row = _fetch(kind, connection, "select database(), current_user()")
        database, user = row if row else (None, None)
        return {"server": f"MySQL {version}".strip(), "database": database, "user": user}
    # oracle
    banner = "Oracle"
    try:
        row = _fetch(kind, connection, "select banner from v$version where rownum = 1")
        if row and row[0]:
            banner = str(row[0]).split("\n")[0].split(" - ")[0].strip()
    except DbError:
        raise
    except Exception:  # noqa: BLE001 - v$version is not always readable
        banner = "Oracle"
    row = _fetch(
        kind,
        connection,
        "select sys_context('USERENV','DB_NAME'), sys_context('USERENV','CURRENT_SCHEMA'), "
        "sys_context('USERENV','SESSION_USER') from dual",
    )
    database, schema, user = row if row else (None, None, None)
    return {"server": banner, "database": database, "user": user, "schema": schema}


def _probe_message(kind: str, identity: dict) -> str:
    parts = [identity.get("server") or kind]
    user = identity.get("user")
    database = identity.get("database")
    if user and database:
        parts.append(f"{user}@{database}")
    elif database:
        parts.append(str(database))
    example = {
        "sqlite": "select 1",
        "postgres": "select version()",
        "mysql": "select version()",
        "oracle": "select 1 from dual",
    }[kind]
    parts.append(f"{example} ok")
    return " · ".join(parts)


def probe(profile: dict, password: str | None) -> dict:
    """Log in for real, run one trivial query, and report server, user and schema."""
    started = time.perf_counter()
    kind = profile.get("kind")
    connection, close = connect(profile, password)
    try:
        identity = _probe_identity(kind, connection, profile)
        _fetch(kind, connection, "select 1 from dual" if kind == "oracle" else "select 1")
    finally:
        close()
    latency = int((time.perf_counter() - started) * 1000)
    detail = {"stage": "login"}
    for key, value in identity.items():
        if value is not None:
            detail[key] = str(value)
    return {
        "ok": True,
        "kind": kind,
        "latencyMs": latency,
        "message": _probe_message(kind, identity),
        "detail": detail,
    }


# --------------------------------------------------------------------------- #
# introspection


def list_tables(profile: dict, connection, schema: str | None, limit: int = 500) -> dict:
    kind = profile.get("kind")
    config = profile.get("config") or {}
    effective = schema or config.get("schema") or None
    cursor = connection.cursor()
    try:
        if kind == "sqlite":
            cursor.execute(
                "select name, type from sqlite_master where type in ('table','view') "
                "and name not like 'sqlite_%' order by type, name"
            )
            rows = [[name, "view" if kind_of == "view" else "table", "main"] for name, kind_of in cursor.fetchall()]
        elif kind == "postgres":
            base = (
                "select table_schema, table_name, table_type from information_schema.tables "
                "where table_schema not in ('pg_catalog','information_schema')"
            )
            if effective:
                cursor.execute(base + " and table_schema = %s order by table_schema, table_name", (str(effective),))
            else:
                cursor.execute(base + " order by table_schema, table_name")
            rows = [[name, "view" if "VIEW" in str(kind_of).upper() else "table", owner] for owner, name, kind_of in cursor.fetchall()]
        elif kind == "mysql":
            cursor.execute(
                "select table_schema, table_name, table_type from information_schema.tables "
                "where table_schema = coalesce(%s, database()) order by table_name",
                (effective,),
            )
            rows = [[name, "view" if "VIEW" in str(kind_of).upper() else "table", owner] for owner, name, kind_of in cursor.fetchall()]
        elif kind == "oracle":
            owner = (effective or config.get("user") or "").upper() or None
            cursor.execute(
                "select owner, table_name, 'TABLE' from all_tables where owner = :1 "
                "union all select owner, view_name, 'VIEW' from all_views where owner = :2 "
                "order by 1, 2",
                [owner, owner],
            )
            rows = [[name, "view" if kind_of == "VIEW" else "table", owner_name] for owner_name, name, kind_of in cursor.fetchall()]
        else:
            raise DbError("user_error", f"unsupported datasource kind: {kind}")
    finally:
        cursor.close()
    truncated = len(rows) > limit
    return {
        "schema": effective,
        "tables": [{"schema": item[2], "name": item[0], "type": item[1]} for item in rows[:limit]],
        "truncated": truncated,
        "total": len(rows),
    }


def describe_table(profile: dict, connection, table: str, schema: str | None) -> dict:
    kind = profile.get("kind")
    config = profile.get("config") or {}
    effective = schema or config.get("schema") or None
    columns: list[dict] = []
    primary: list[str] = []
    cursor = connection.cursor()
    try:
        if kind == "sqlite":
            cursor.execute(f"PRAGMA table_info({_quote('sqlite', table)})")
            for _cid, name, type_name, notnull, default, pk in cursor.fetchall():
                columns.append(
                    {
                        "name": name,
                        "type": type_name or "",
                        "nullable": not bool(notnull),
                        "default": default,
                        "primaryKey": bool(pk),
                    }
                )
                if pk:
                    primary.append(name)
        elif kind in ("postgres", "mysql"):
            owner = effective or (config.get("database") if kind == "mysql" else "public")
            placeholder = "%s"
            cursor.execute(
                "select column_name, data_type, is_nullable, column_default, character_maximum_length, numeric_precision, numeric_scale "
                f"from information_schema.columns where table_name = {placeholder} and table_schema = {placeholder} "
                "order by ordinal_position",
                (table, owner),
            )
            for name, data_type, nullable, default, char_len, precision, scale in cursor.fetchall():
                type_name = data_type
                if char_len:
                    type_name = f"{data_type}({char_len})"
                elif data_type in ("numeric", "decimal", "number") and precision:
                    type_name = f"{data_type}({precision},{scale or 0})"
                columns.append(
                    {
                        "name": name,
                        "type": type_name,
                        "nullable": str(nullable).upper() == "YES",
                        "default": default,
                        "primaryKey": False,
                    }
                )
            cursor.execute(
                "select kcu.column_name from information_schema.table_constraints tc "
                "join information_schema.key_column_usage kcu "
                "  on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema "
                f"where tc.constraint_type = 'PRIMARY KEY' and tc.table_name = {placeholder} and tc.table_schema = {placeholder} "
                "order by kcu.ordinal_position",
                (table, owner),
            )
            primary = [row[0] for row in cursor.fetchall()]
            for column in columns:
                column["primaryKey"] = column["name"] in primary
        elif kind == "oracle":
            owner = (effective or config.get("user") or "").upper() or None
            cursor.execute(
                "select column_name, data_type, data_length, data_precision, data_scale, nullable, data_default "
                "from all_tab_columns where owner = :1 and table_name = :2 order by column_id",
                [owner, table.upper()],
            )
            for name, data_type, length, precision, scale, nullable, default in cursor.fetchall():
                type_name = data_type
                if data_type in ("VARCHAR2", "CHAR", "NVARCHAR2") and length:
                    type_name = f"{data_type}({length})"
                elif data_type == "NUMBER" and precision:
                    type_name = f"NUMBER({precision},{scale or 0})"
                columns.append(
                    {
                        "name": name,
                        "type": type_name,
                        "nullable": str(nullable).upper() == "Y",
                        "default": (default or "").strip() or None,
                        "primaryKey": False,
                    }
                )
            cursor.execute(
                "select cc.column_name from all_constraints c join all_cons_columns cc "
                "  on c.owner = cc.owner and c.constraint_name = cc.constraint_name "
                "where c.constraint_type = 'P' and c.owner = :1 and c.table_name = :2 order by cc.position",
                [owner, table.upper()],
            )
            primary = [row[0] for row in cursor.fetchall()]
            for column in columns:
                column["primaryKey"] = column["name"] in primary
        else:
            raise DbError("user_error", f"unsupported datasource kind: {kind}")
    finally:
        cursor.close()
    if not columns:
        raise DbError("user_error", f"table not found: {table}", "call list_tables to see the available tables")
    return {"table": table, "schema": effective, "columns": columns, "primaryKey": primary}


# --------------------------------------------------------------------------- #
# DDL


def table_ddl(profile: dict, connection, table: str, schema: str | None = None) -> dict:
    """Return a CREATE TABLE statement for one table.

    SQLite keeps the original text in `sqlite_master`, so that is returned
    verbatim. Every other engine is rebuilt from the column metadata that
    `describe_table` already reads, which works without extra privileges and
    keeps the four engines consistent.
    """
    kind = profile.get("kind")
    if kind == "sqlite":
        cursor = connection.cursor()
        try:
            cursor.execute(
                "select sql from sqlite_master where type in ('table', 'view') and name = ?",
                (table,),
            )
            row = cursor.fetchone()
        finally:
            cursor.close()
        if not row or not row[0]:
            raise DbError(
                "user_error",
                f"no DDL recorded for {table}",
                "virtual tables and internal objects do not keep their statement",
            )
        return {
            "table": table,
            "schema": None,
            "ddl": row[0].strip().rstrip(";") + ";",
            "source": "sqlite_master",
        }

    info = describe_table(profile, connection, table, schema)
    effective = info.get("schema") or None
    if effective and kind in ("postgres", "oracle", "mysql"):
        target = f"{_quote(kind, effective)}.{_quote(kind, table)}"
    else:
        target = _quote(kind, table)

    lines: list[str] = []
    for column in info["columns"]:
        piece = f"  {_quote(kind, column['name'])} {column['type'] or 'text'}"
        if not column["nullable"] and not column["primaryKey"]:
            piece += " not null"
        if column.get("default") not in (None, ""):
            piece += f" default {column['default']}"
        lines.append(piece)
    if info["primaryKey"]:
        keys = ", ".join(_quote(kind, name) for name in info["primaryKey"])
        lines.append(f"  primary key ({keys})")
    return {
        "table": table,
        "schema": effective,
        "ddl": f"create table {target} (\n" + ",\n".join(lines) + "\n);",
        "source": "columns",
    }


# --------------------------------------------------------------------------- #
# queries


def run_query(profile: dict, connection, sql: str, max_rows: int) -> dict:
    ensure_readable(sql, profile)
    kind = profile.get("kind")
    started = time.perf_counter()
    cursor = connection.cursor()
    try:
        if kind == "oracle" and profile.get("readOnly"):
            try:
                cursor.execute("SET TRANSACTION READ ONLY")
            except Exception:  # noqa: BLE001 - not every session allows the switch
                pass
        cursor.execute(sql)
        columns, rows, truncated = _rows(cursor, max_rows)
        if profile.get("readOnly") or not connection_autocommit(kind):
            try:
                connection.rollback()
            except Exception:  # noqa: BLE001 - nothing to roll back
                pass
    finally:
        cursor.close()
    return {
        "sql": sql,
        "columns": columns,
        "rows": rows,
        "rowCount": len(rows),
        "truncated": truncated,
        "elapsedMs": int((time.perf_counter() - started) * 1000),
    }


def connection_autocommit(kind: str) -> bool:
    return kind == "sqlite"


def sample_rows(profile: dict, connection, table: str, limit: int, schema: str | None) -> dict:
    sql = f"SELECT * FROM {qualified(profile, table)}{_limit_clause(profile.get('kind'), limit)}"
    result = run_query(profile, connection, sql, limit)
    result["table"] = table
    result["schema"] = schema or (profile.get("config") or {}).get("schema") or None
    return result


def explain_query(profile: dict, connection, sql: str) -> dict:
    ensure_readable(sql, profile)
    kind = profile.get("kind")
    cursor = connection.cursor()
    try:
        if kind == "sqlite":
            cursor.execute(f"EXPLAIN QUERY PLAN {sql}")
            plan = "\n".join(" | ".join(str(part) for part in row) for row in cursor.fetchall())
        elif kind == "postgres":
            cursor.execute(f"EXPLAIN {sql}")
            plan = "\n".join(str(row[0]) for row in cursor.fetchall())
        elif kind == "mysql":
            cursor.execute(f"EXPLAIN {sql}")
            header = [str(description[0]) for description in (cursor.description or [])]
            plan = "\n".join(" | ".join(f"{key}={value}" for key, value in zip(header, row)) for row in cursor.fetchall())
        elif kind == "oracle":
            cursor.execute(f"EXPLAIN PLAN FOR {sql}")
            cursor.execute("select plan_table_output from table(dbms_xplan.display(null, null, 'BASIC'))")
            plan = "\n".join(str(row[0]) for row in cursor.fetchall())
        else:
            raise DbError("user_error", f"unsupported datasource kind: {kind}")
    finally:
        cursor.close()
    return {"sql": sql, "plan": plan}
