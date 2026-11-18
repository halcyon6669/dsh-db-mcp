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
import sqlite3
import ssl
import time
from pathlib import Path
from urllib.parse import quote

import writes

# Statements that only read. `set` and `pragma` used to sit here, which let a
# source marked read-only change session state — and, on SQLite, the database file
# itself (`pragma journal_mode = wal`). They are allowlisted per engine below
# instead, and anything not on those lists counts as a change.
READ_STARTERS = ("select", "values", "table", "show", "describe", "desc", "explain")

# SQLite PRAGMAs that only report. `pragma x = value` and `pragma x(value)` set
# something, so the `=` form is refused even for a name on this list.
SQLITE_READ_PRAGMAS = frozenset(
    {
        "collation_list",
        "compile_options",
        "data_version",
        "database_list",
        "encoding",
        "foreign_key_check",
        "foreign_key_list",
        "freelist_count",
        "function_list",
        "index_info",
        "index_list",
        "index_xinfo",
        "integrity_check",
        "journal_mode",
        "module_list",
        "page_count",
        "page_size",
        "pragma_list",
        "quick_check",
        "schema_version",
        "table_info",
        "table_list",
        "table_xinfo",
        "user_version",
    }
)

# `set` statements that only point the session at a different name space. Every
# other `set` is treated as a change, because it can turn a session into one that
# may write.
PG_READ_SETTINGS = (
    "search_path",
    "time zone",
    "timezone",
    "datestyle",
    "client_encoding",
    "client_min_messages",
    "extra_float_digits",
    "statement_timeout",
    "lock_timeout",
    "idle_in_transaction_session_timeout",
    "application_name",
)
MYSQL_READ_SETTINGS = (
    "names",
    "charset",
    "character_set_client",
    "character_set_results",
    "character_set_connection",
    "sql_mode",
    "time_zone",
)

# GaussDB/openGauss speaks the PostgreSQL wire protocol and its catalogs are
# PostgreSQL shaped, so every introspection path treats the two alike. Only the
# driver differs: openGauss servers answer SASL with SHA256, which libpq-based
# drivers (psycopg) cannot negotiate.
PG_LIKE = ("postgres", "gauss")


def allow_write() -> bool:
    """Global write switch, exported by the host when it spawns this server."""
    return os.environ.get("DB_MCP_ALLOW_WRITE", "0") == "1"


# How long cell values are rendered before they are summarised. The panel lets
# the user pick the policy; the default keeps long text out of the model context
# while preserving a head/tail fragment the model can reason about.
TEXT_POLICIES = ("auto", "full")


def text_policy(value: str | None) -> str:
    """Normalise a policy name; anything unknown becomes the default."""
    name = (value or "").strip().lower()
    return name if name in TEXT_POLICIES else "auto"


TEXT_POLICY = text_policy(os.environ.get("DB_MCP_TEXT_POLICY", "auto"))
# A cell longer than this many characters is summarised under `auto`.
TEXT_SUMMARY_AT = 200
# Fragment kept from each side of a long cell under `auto`.
TEXT_FRAGMENT = 50

MAX_TEXT = 4000


class DbError(Exception):
    def __init__(self, code: str, message: str, hint: str | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.hint = hint


# --------------------------------------------------------------------------- #
# helpers


def _words(sql: str) -> list[str]:
    """Every bare word outside quotes, lower-cased.

    Quoted strings and quoted identifiers are skipped, so `where note = 'delete'`
    and `with "update" as (...)` do not look like statements that change data.
    """
    text = sql or ""
    words: list[str] = []
    index = 0
    quote = ""
    while index < len(text):
        char = text[index]
        if quote:
            if char == quote:
                if index + 1 < len(text) and text[index + 1] == quote:
                    index += 2
                    continue
                quote = ""
            index += 1
            continue
        if char in ("'", '"', "`"):
            quote = char
            index += 1
            continue
        if char.isalpha() or char == "_":
            start = index
            while index < len(text) and (text[index].isalnum() or text[index] == "_"):
                index += 1
            words.append(text[start:index].lower())
            continue
        index += 1
    return words


# Words that mean a `with` statement changes data rather than reading it. A CTE
# body may hold one, and the main statement after the CTEs may be one too.
CTE_WRITE_WORDS = ("insert", "update", "delete", "merge")


def _has_write_word(sql: str) -> bool:
    return any(word in CTE_WRITE_WORDS for word in _words(sql))


def _allowed_set(sql: str, kind: str) -> bool:
    """`set` only points the session somewhere; every other form may enable writes."""
    allowed = PG_READ_SETTINGS if kind in PG_LIKE else MYSQL_READ_SETTINGS if kind == "mysql" else ()
    if not allowed:
        return False
    # `set [session|local] name [to|=] value` — the name is the third word at most.
    words = _words(sql)
    if not words or words[0] != "set":
        return False
    rest = words[1:]
    if rest and rest[0] in ("session", "local", "global"):
        rest = rest[1:]
    if not rest:
        return False
    name = rest[0]
    # Multi-word settings we allow ("time zone") need the pair, not just "time".
    pair = " ".join(rest[:2])
    return name in allowed or pair in allowed


def _allowed_pragma(sql: str, kind: str) -> bool:
    """A SQLite PRAGMA that only reports. The `= value` form always sets."""
    if kind != "sqlite":
        return False
    text = (sql or "").strip().rstrip(";")
    words = _words(text)
    if not words or words[0] != "pragma":
        return False
    if "=" in text:
        return False
    name = words[1] if len(words) > 1 else ""
    if name not in SQLITE_READ_PRAGMAS:
        return False
    # `pragma table_info(t)` passes an argument in parentheses; that is a read.
    # `pragma journal_mode(wal)` looks identical but writes, so only the pragmas
    # whose argument is a table name may take one.
    if len(words) > 2:
        return name in ("table_info", "table_xinfo", "index_info", "index_list", "index_xinfo", "foreign_key_list")
    return True


def read_only_statement(sql: str, kind: str) -> bool:
    """Whether this one statement only reads, for this engine.

    Anything not positively identified as a read counts as a change, so a
    statement nobody thought about is refused on a read-only source instead of
    slipping through.
    """
    keyword = writes.keyword(sql)
    if keyword == "set":
        return _allowed_set(sql, kind)
    if keyword == "pragma":
        return _allowed_pragma(sql, kind)
    if keyword == "explain":
        # EXPLAIN ANALYZE runs the statement it plans, so the inner statement
        # decides; a bare EXPLAIN only plans, whatever it wraps.
        text = sql.strip()
        rest = text[len("explain") :].lstrip()
        inner_words = _words(rest)
        planned_only = not inner_words or inner_words[0] not in ("analyze",)
        if planned_only:
            return True
        return read_only_statement(rest[len("analyze") :].lstrip(), kind)
    if keyword == "with":
        # `with x as (delete … returning *) select …` reads like a select but
        # changes rows. The body decides.
        return not _has_write_word(sql)
    return keyword in READ_STARTERS



def statements_of(sql: str, kind: str | None = None) -> list[str]:
    """Split a batch, keeping an Oracle anonymous block whole.

    `begin … end;` and `declare … begin … end;` carry semicolons that are part of
    one statement, so splitting them would refuse a statement Oracle accepts.
    """
    text = sql or ""
    head = writes.keyword(text)
    if kind == "oracle" and head in ("begin", "declare"):
        return [text.strip()] if text.strip() else []
    return writes.statements(text)


def ensure_readable(sql: str, profile: dict) -> None:
    """Refuse changing statements on a read-only source, before touching the DB.

    Every statement in the text is checked, not only the first: `select 1; drop
    table t` used to pass because it started with `select`. Batches are refused
    outright, which also matches what the tool tells the model.
    """
    kind = profile.get("kind")
    parts = statements_of(sql, kind)
    if not parts:
        raise DbError("user_error", "the statement is empty", "pass one SQL statement")
    if len(parts) > 1:
        raise DbError(
            "user_error",
            f"this call carries {len(parts)} statements; only one runs per call",
            "send the statements one at a time — a batch would apply halfway and cannot be undone here",
        )
    statement = parts[0]
    if read_only_statement(statement, kind):
        return
    keyword = writes.keyword(statement) or "this"
    if not allow_write():
        raise DbError(
            "user_error",
            f"writes are disabled for the whole plugin; `{keyword}` statements are refused",
            "turn on the global write switch in the Data sources panel first",
        )
    if profile.get("readOnly"):
        raise DbError(
            "user_error",
            f"datasource {profile.get('id')} is read-only; `{keyword}` statements are refused",
            "uncheck read-only for this source in the Data sources panel to allow writes",
        )
    # The source is writable, so only the DDL switch is left to check.
    try:
        writes.check(statement, profile)
    except writes.WriteBlocked as blocked:
        raise DbError("user_error", blocked.message, blocked.hint) from blocked



def _cell(value, full_text: bool = False):
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
    if len(text) <= MAX_TEXT:
        # Under `auto` a long-but-not-huge cell still eats a lot of context;
        # keep a readable fragment instead of the full wall of text. A caller
        # that asked for `full_text` gets the value as stored.
        if not full_text and TEXT_POLICY != "full" and len(text) > TEXT_SUMMARY_AT:
            return f"{text[:TEXT_FRAGMENT]}…(共{len(text)}字)…{text[-TEXT_FRAGMENT:]}"
        return text
    if full_text:
        # Still bounded: one cell must not be able to blow up the response.
        return text
    return text[:MAX_TEXT] + f"… (+{len(text) - MAX_TEXT})"


def _rows(cursor, max_rows: int, full_text: bool = False) -> tuple[list[str], list[list], bool]:
    columns = [str(description[0]) for description in (cursor.description or [])]
    if not columns:
        # A write returns no result set. psycopg raises "the last operation
        # didn't produce records" when the cursor is iterated anyway, and that
        # exception escaped before `connection.commit()`, rolling the write back.
        # No columns means nothing to read: report zero rows.
        return [], [], False
    rows: list[list] = []
    truncated = False
    for index, row in enumerate(cursor):
        if index >= max_rows:
            truncated = True
            break
        rows.append([_cell(value, full_text) for value in row])
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
    if schema and kind in ("postgres", "gauss", "oracle", "mysql"):
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
    if kind == "gauss":
        return _connect_gauss(profile, config, password)
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


def _host_list(config: dict) -> list[tuple[str, int]]:
    """Hosts to try, in order. `hosts` wins over `host`, and a comma list works too.

    openGauss clusters are usually given as three addresses with
    `targetServerType=master`, so the shape has to survive the trip from the URL.
    """
    default_port = int(config.get("port") or 5432)
    entries: list[tuple[str, int]] = []
    declared = config.get("hosts")
    if isinstance(declared, list):
        for item in declared:
            if isinstance(item, dict) and item.get("host"):
                entries.append((str(item["host"]), int(item.get("port") or default_port)))
            elif isinstance(item, str) and item.strip():
                entries.append((item.strip(), default_port))
    if not entries:
        for piece in str(config.get("host") or "localhost").split(","):
            piece = piece.strip()
            if not piece:
                continue
            host, _, maybe_port = piece.rpartition(":")
            if host and maybe_port.isdigit():
                entries.append((host, int(maybe_port)))
            else:
                entries.append((piece, default_port))
    return entries or [("localhost", default_port)]


def _gauss_iri(config: dict, password: str | None) -> str:
    user = quote(str(config.get("user") or ""), safe="")
    secret = quote(password or "", safe="")
    authority = ",".join(f"{host}:{port}" for host, port in _host_list(config))
    database = quote(str(config.get("database") or ""), safe="")
    credentials = f"{user}:{secret}@" if user else ""
    return f"opengauss://{credentials}{authority}/{database}"


def _ssl_shim() -> None:
    """Give py_opengauss back `ssl.wrap_socket`, which Python 3.12 removed.

    The shim has to switch certificate checking off explicitly: `wrap_socket`
    defaulted to CERT_NONE, while PROTOCOL_TLS_CLIENT defaults to verifying, so a
    naive replacement would fail every TLS handshake against these servers.
    """
    if hasattr(ssl, "wrap_socket"):
        return

    def wrap_socket(
        sock,
        keyfile=None,
        certfile=None,
        server_side=False,
        cert_reqs=ssl.CERT_NONE,
        ssl_version=None,
        ca_certs=None,
        do_handshake_on_connect=True,
        suppress_ragged_eofs=True,
        ciphers=None,
    ):
        protocol = ssl.PROTOCOL_TLS_SERVER if server_side else ssl.PROTOCOL_TLS_CLIENT
        context = ssl.SSLContext(protocol)
        context.check_hostname = False
        context.verify_mode = cert_reqs if cert_reqs is not None else ssl.CERT_NONE
        if certfile:
            context.load_cert_chain(certfile, keyfile)
        if ca_certs:
            context.load_verify_locations(ca_certs)
        if ciphers:
            context.set_ciphers(ciphers)
        return context.wrap_socket(
            sock,
            server_side=server_side,
            do_handshake_on_connect=do_handshake_on_connect,
            suppress_ragged_eofs=suppress_ragged_eofs,
        )

    ssl.wrap_socket = wrap_socket


class _GaussCursor:
    """A DB-API cursor over py_opengauss' native statement API.

    py_opengauss 1.3.x ships its DB-API module with a TabError, so
    `connection.cursor()` does not exist on the connection `open()` returns. What
    does work is `connection.prepare(sql)(*params)`.

    `prepare` sends the statement to the server as written, and the server only
    binds `$1, $2 …`, so the `%s` placeholders the rest of this module emits are
    rewritten here. A statement whose `%s` count does not match the parameters is
    passed through untouched, because that shape is not ours to guess at.
    """

    def __init__(self, connection):
        self._connection = connection
        self._rows: list = []
        self._index = 0
        self.description = None
        self.rowcount = -1

    @staticmethod
    def _rewrite(sql: str, count: int) -> str:
        if count <= 0:
            return sql
        parts = sql.split("%s")
        if len(parts) - 1 != count:
            return sql
        out = parts[0]
        for index, piece in enumerate(parts[1:], start=1):
            out += f"${index}" + piece
        return out

    def execute(self, sql: str, params=()):
        values = tuple(params or ())
        statement = self._connection.prepare(self._rewrite(sql, len(values)))
        result = statement(*values)
        names = list(getattr(statement, "column_names", None) or [])
        self._rows = list(result or [])
        self._index = 0
        self.rowcount = len(self._rows)
        self.description = (
            [(name, None, None, None, None, None, None) for name in names] if names else None
        )
        return self

    def fetchone(self):
        if self._index >= len(self._rows):
            return None
        row = self._rows[self._index]
        self._index += 1
        return row

    def fetchall(self):
        rows = self._rows[self._index :]
        self._index = len(self._rows)
        return rows

    def __iter__(self):
        while True:
            row = self.fetchone()
            if row is None:
                return
            yield row

    def close(self):
        self._rows = []
        self._index = 0


class _GaussConnection:
    """Keeps the commit/rollback/close surface `execute_sql` expects."""

    def __init__(self, raw):
        self.raw = raw

    def cursor(self):
        return _GaussCursor(self.raw)

    def _plain(self, statement: str) -> None:
        try:
            self.raw.execute(statement)
        except Exception:  # noqa: BLE001 - closing a dead session must not raise
            pass

    def commit(self):
        self._plain("COMMIT")

    def rollback(self):
        self._plain("ROLLBACK")

    def close(self):
        try:
            self.raw.close()
        except Exception:  # noqa: BLE001 - already gone
            pass


def _connect_gauss(profile: dict, config: dict, password: str | None):
    """openGauss/GaussDB, where libpq cannot do the SHA256 SASL handshake.

    The pure-Python driver is tried first because it is the only one that speaks
    that handshake; psycopg stays as a fallback for clusters configured with
    md5/native passwords, and its error is reported only when both fail.
    """
    _ssl_shim()
    errors: list[str] = []
    try:
        import py_opengauss

        connection = py_opengauss.open(_gauss_iri(config, password))
        wrapped = _GaussConnection(connection)
        if profile.get("readOnly"):
            try:
                wrapped.cursor().execute("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY")
            except Exception:  # noqa: BLE001 - older builds refuse the switch
                pass
        return wrapped, wrapped.close
    except ImportError as error:
        errors.append(f"py_opengauss is not installed ({error})")
    except Exception as error:  # noqa: BLE001 - driver specific exception types
        errors.append(f"py_opengauss: {error}")
    try:
        return _connect_postgres(profile, config, password)
    except DbError as error:
        errors.append(f"psycopg: {error}")
    raise DbError(
        "db_error",
        "GaussDB connection failed: " + " | ".join(errors),
        "openGauss SHA256 authentication needs the pure-Python driver "
        "(py_opengauss); install the plugin dependencies again",
    )


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
    if kind in PG_LIKE:
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
        "gauss": "select version()",
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
        elif kind in PG_LIKE:
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
    # openGauss/Oracle keep dropped tables in a recycle bin under `BIN$…` names;
    # they are not part of the schema a user browses.
    rows = [item for item in rows if not str(item[0]).startswith("BIN$")]
    truncated = len(rows) > limit
    result = {
        "schema": effective,
        "tables": [{"schema": item[2], "name": item[0], "type": item[1]} for item in rows[:limit]],
        "truncated": truncated,
        "total": len(rows),
        # Every schema the catalog returned, with the write switch each one would
        # get: the structure view asks which schemas this source may write to.
        "schemas": sorted({str(item[2]) for item in rows if item[2]}),
    }
    return result


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
        elif kind in ("postgres", "gauss", "mysql"):
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
    if effective and kind in ("postgres", "gauss", "oracle", "mysql"):
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


def execute_sql(profile: dict, connection, sql: str, max_rows: int, full_text: bool = False) -> dict:
    ensure_readable(sql, profile)
    kind = profile.get("kind")
    statement = statements_of(sql, kind)[0]
    started = time.perf_counter()
    # The first keyword is not enough: `with x as (delete … returning *) select …`
    # starts with `with` but changes rows, and used to be rolled back here.
    is_write = not read_only_statement(statement, kind)
    cursor = connection.cursor()
    affected = None
    try:
        if kind == "oracle" and profile.get("readOnly"):
            try:
                cursor.execute("SET TRANSACTION READ ONLY")
            except Exception:  # noqa: BLE001 - not every session allows the switch
                pass
        cursor.execute(statement)
        columns, rows, truncated = _rows(cursor, max_rows, full_text)

        if is_write:
            affected = _affected_rows(cursor)
        if not is_write or profile.get("readOnly"):
            # Reads (and anything on a read-only source) must not hold the session
            # open in a transaction; writes need the commit below instead.
            if not connection_autocommit(kind):
                try:
                    connection.rollback()
                except Exception:  # noqa: BLE001 - nothing to roll back
                    pass
        else:
            # No engine here autocommits by default: `sqlite3.connect` runs in the
            # legacy implicit-transaction mode, and MySQL/PostgreSQL/Oracle are
            # explicit-commit. A write not committed here dies with the connection.
            connection.commit()
    finally:
        cursor.close()
    result = {
        "sql": sql,
        "columns": columns,
        "rows": rows,
        "rowCount": len(rows),
        "truncated": truncated,
        "elapsedMs": int((time.perf_counter() - started) * 1000),
    }
    if affected is not None:
        result["affectedRows"] = affected
    return result


def _affected_rows(cursor) -> int | None:
    """Rows touched by a write, when the driver reports it.

    `rowcount` is -1 for statements whose count is unknown (and some drivers raise
    instead), so anything but a real, non-negative int becomes `None`.
    """
    try:
        value = cursor.rowcount
    except Exception:  # noqa: BLE001 - drivers without a usable rowcount
        return None
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else None


def connection_autocommit(kind: str) -> bool:
    return kind == "sqlite"


def sample_rows(profile: dict, connection, table: str, limit: int, schema: str | None) -> dict:
    sql = f"SELECT * FROM {qualified(profile, table)}{_limit_clause(profile.get('kind'), limit)}"
    result = execute_sql(profile, connection, sql, limit)
    result["table"] = table
    result["schema"] = schema or (profile.get("config") or {}).get("schema") or None
    return result


def explain_query(profile: dict, connection, sql: str) -> dict:
    ensure_readable(sql, profile)
    kind = profile.get("kind")
    statement = statements_of(sql, kind)[0]
    cursor = connection.cursor()
    try:
        if kind == "sqlite":
            cursor.execute(f"EXPLAIN QUERY PLAN {statement}")
            plan = "\n".join(" | ".join(str(part) for part in row) for row in cursor.fetchall())
        elif kind in PG_LIKE:
            cursor.execute(f"EXPLAIN {statement}")
            plan = "\n".join(str(row[0]) for row in cursor.fetchall())
        elif kind == "mysql":
            cursor.execute(f"EXPLAIN {statement}")
            header = [str(description[0]) for description in (cursor.description or [])]
            plan = "\n".join(" | ".join(f"{key}={value}" for key, value in zip(header, row)) for row in cursor.fetchall())
        elif kind == "oracle":
            cursor.execute(f"EXPLAIN PLAN FOR {statement}")
            cursor.execute("select plan_table_output from table(dbms_xplan.display(null, null, 'BASIC'))")
            plan = "\n".join(str(row[0]) for row in cursor.fetchall())
        else:
            raise DbError("user_error", f"unsupported datasource kind: {kind}")
    finally:
        cursor.close()
    return {"sql": statement, "plan": plan}

