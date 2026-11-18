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


# How long one statement may run. A query that runs for minutes holds a server
# slot and the caller has no way to cancel it — the model is simply waiting. 0
# disables the limit for people who need a long report to finish.
DEFAULT_STATEMENT_TIMEOUT_MS = 30_000


def statement_timeout_ms() -> int:
    """Read the limit from the environment; a bad value keeps the default."""
    raw = (os.environ.get("DB_MCP_STATEMENT_TIMEOUT_MS") or "").strip()
    if not raw:
        return DEFAULT_STATEMENT_TIMEOUT_MS
    try:
        value = int(raw)
    except ValueError:
        return DEFAULT_STATEMENT_TIMEOUT_MS
    return max(0, value)


STATEMENT_TIMEOUT_MS = statement_timeout_ms()


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


def _returns_rows(sql: str) -> bool:
    """Whether a statement is worth a server-side cursor.

    Only these shapes produce a result set the caller iterates. A `SET`, `SHOW` or
    a bare `EXPLAIN` returns a handful of rows, and PostgreSQL refuses to put them
    behind a named cursor at all (it rewrites to `DECLARE … CURSOR FOR <sql>`).
    """
    keyword = writes.keyword(sql)
    if keyword == "with":
        # A data-modifying CTE returns its RETURNING rows, so it does read; a plain
        # `with … select` is a read either way. Both are safe behind a cursor.
        return True
    return keyword in ("select", "values", "table")


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
            # The marker is English like every other string this server emits: the
            # reader is a model, and the host exposes no locale service to ask.
            return f"{text[:TEXT_FRAGMENT]}…({len(text)} chars)…{text[-TEXT_FRAGMENT:]}"
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


def _quote_exact(kind: str, name: str) -> str:
    """Quote a name the catalog already resolved, keeping its case.

    `_quote` assumes the name was written the way Oracle stores unquoted
    identifiers (upper case). Once `_oracle_catalog_name` has told us the real
    spelling — which may be lower case for a table created with a quoted name —
    folding it again would point at a table that does not exist.
    """
    text = str(name)
    if kind == "mysql":
        return "`" + text.replace("`", "``") + "`"
    return '"' + text.replace('"', '""') + '"'


def qualified(profile: dict, table: str, exact: bool = False) -> str:
    kind = profile.get("kind")
    schema = (profile.get("config") or {}).get("schema") or None
    if kind == "oracle":
        schema = (schema or (profile.get("config") or {}).get("user") or "").upper() or None
    quote = _quote_exact if exact else _quote
    if schema and kind in ("postgres", "gauss", "oracle", "mysql"):
        return f"{_quote(kind, schema)}.{quote(kind, table)}"
    return quote(kind, table)


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


# --------------------------------------------------------------------------- #
# statement timeout

# Driver messages that mean "the server stopped this because it ran too long".
# Every engine words it differently and some of them (SQLite) only say
# "interrupted", so the check has to be a list rather than one substring.
TIMEOUT_MARKERS = (
    "timeout",
    "timed out",
    "canceling statement",
    "interrupted",
    "max_execution_time",
    "max_statement_time",
    "ora-01013",
    "ora-12170",
)


def _is_timeout(error: BaseException) -> bool:
    text = str(error).lower()
    return any(marker in text for marker in TIMEOUT_MARKERS)


def _timeout_error(kind: str, error: BaseException) -> DbError:
    seconds = STATEMENT_TIMEOUT_MS / 1000.0
    return DbError(
        "timeout",
        f"the statement ran longer than {seconds:g}s and was stopped: {error}",
        "narrow the query (a WHERE clause, a smaller LIMIT, fewer columns) or raise "
        "DB_MCP_STATEMENT_TIMEOUT_MS; 0 turns the limit off",
    )


def _arm_sqlite_timeout(connection) -> None:
    """Interrupt a SQLite statement that runs past the limit.

    SQLite has no server-side timeout, but it calls a progress handler every N
    virtual-machine steps and stops the statement when the handler returns
    non-zero. That is the only way to bound a runaway query without a second
    thread.
    """
    if STATEMENT_TIMEOUT_MS <= 0 or not hasattr(connection, "set_progress_handler"):
        return
    deadline = time.monotonic() + STATEMENT_TIMEOUT_MS / 1000.0
    connection.set_progress_handler(lambda: 1 if time.monotonic() > deadline else 0, 10_000)


def _disarm_sqlite_timeout(connection) -> None:
    if not hasattr(connection, "set_progress_handler"):
        return
    try:
        connection.set_progress_handler(None, 0)
    except Exception:  # noqa: BLE001 - a closed connection needs no cleanup
        pass


PG_SSL_MODES = ("disable", "allow", "prefer", "require", "verify-ca", "verify-full")
MYSQL_SSL_MODES = (
    "disable",
    "preferred",
    "required",
    "verify_ca",
    "verify_identity",
)


def _pg_sslmode(config: dict) -> str | None:
    """The `sslmode` to hand psycopg, or None to let it keep its default.

    psycopg already defaults to `prefer`, so an unset field stays unset rather
    than being written out — that keeps the behaviour of a source saved before
    the field existed.
    """
    value = str(config.get("sslMode") or "").strip().lower()
    if not value:
        return None
    if value in PG_SSL_MODES:
        return value
    # DBeaver also writes the MySQL spelling into PostgreSQL sources that were
    # copied from a MySQL connection; map the two that have a clear equivalent.
    if value in ("required",):
        return "require"
    if value in ("verify_ca",):
        return "verify-ca"
    if value in ("verify_identity", "verify_identity_full"):
        return "verify-full"
    return None


def _mysql_ssl(config: dict):
    """An `ssl.SSLContext` for PyMySQL, or None to leave TLS off.

    PyMySQL takes either a dict or a context; a context is used here so the
    three DBeaver levels map to something exact. `preferred` cannot be honoured
    — PyMySQL has no opportunistic TLS — so it falls back to the previous
    behaviour (plaintext) and the docs say so.
    """
    value = str(config.get("sslMode") or "").strip().lower()
    if not value or value in ("disable", "disabled", "preferred", "prefer"):
        return None
    if value in ("required", "require"):
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE
        return context
    if value in ("verify_ca", "verify-ca"):
        context = ssl.create_default_context()
        context.check_hostname = False
        context.verify_mode = ssl.CERT_REQUIRED
        return context
    if value in ("verify_identity", "verify-identity", "verify-full", "verify_full"):
        context = ssl.create_default_context()
        context.check_hostname = True
        context.verify_mode = ssl.CERT_REQUIRED
        return context
    return None


def _pg_options(profile: dict) -> str | None:
    """`options` for libpq: the read-only switch and the statement timeout.

    Both are session settings, so they have to be on the connection itself —
    psycopg has no per-cursor timeout, and setting it after connect leaves a
    window where the first statement is unbounded.
    """
    parts = []
    if profile.get("readOnly"):
        parts.append("-c default_transaction_read_only=on")
    if STATEMENT_TIMEOUT_MS > 0:
        parts.append(f"-c statement_timeout={STATEMENT_TIMEOUT_MS}")
    return " ".join(parts) or None


def _connect_postgres(profile: dict, config: dict, password: str | None):
    try:
        import psycopg
    except ImportError as error:  # pragma: no cover - environment problem
        raise DbError("infra_error", f"psycopg is not installed: {error}", "run the plugin's Python setup again")
    options = _pg_options(profile)
    sslmode = _pg_sslmode(config)
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
            **({"sslmode": sslmode} if sslmode else {}),
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
        if STATEMENT_TIMEOUT_MS > 0:
            try:
                wrapped.cursor().execute(f"SET statement_timeout = {int(STATEMENT_TIMEOUT_MS)}")
            except Exception:  # noqa: BLE001 - older builds refuse the setting
                pass
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
    ssl_context = _mysql_ssl(config)
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
            **({"ssl": ssl_context} if ssl_context is not None else {}),
        )
    except Exception as error:  # noqa: BLE001 - driver specific exception types
        raise DbError("db_error", f"MySQL connection failed: {error}")
    if STATEMENT_TIMEOUT_MS > 0:
        # `max_execution_time` is the only server-side limit MySQL offers, and it
        # applies to SELECT statements alone — an UPDATE that runs for an hour is
        # not stopped by it. Said plainly here so the docs can say it too.
        try:
            with connection.cursor() as cursor:
                cursor.execute(f"SET SESSION max_execution_time = {int(STATEMENT_TIMEOUT_MS)}")
        except Exception:  # noqa: BLE001 - servers before 5.7.8 have no such setting
            pass
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
    if STATEMENT_TIMEOUT_MS > 0:
        # oracledb takes the limit per call (`Connection.call_timeout`, in
        # milliseconds), and it covers the round trip rather than the server's
        # own execution time. It is the only knob the driver exposes.
        try:
            connection.call_timeout = int(STATEMENT_TIMEOUT_MS)
        except Exception:  # noqa: BLE001 - older driver builds ignore it
            pass
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
            # Oracle keeps its own catalogue objects (MVIEW$_ADV_* and friends) in
            # the same namespace as the user's tables, so `all_tables` alone lists
            # mostly Oracle's bookkeeping. `ALL_OBJECTS.ORACLE_MAINTAINED = 'N'`
            # is the flag that separates them, and it is what a browser of the
            # schema wants. Pre-12c catalogues have no such column, so that query
            # falls back to the plain listing rather than failing.
            try:
                cursor.execute(
                    "select t.owner, t.table_name, 'TABLE' from all_tables t "
                    "join all_objects o on o.owner = t.owner and o.object_name = t.table_name "
                    "  and o.object_type = 'TABLE' "
                    "where o.owner = :1 and o.oracle_maintained = 'N' "
                    "union all "
                    "select v.owner, v.view_name, 'VIEW' from all_views v "
                    "join all_objects o on o.owner = v.owner and o.object_name = v.view_name "
                    "  and o.object_type = 'VIEW' "
                    "where o.owner = :2 and o.oracle_maintained = 'N' "
                    "order by 1, 2",
                    [owner, owner],
                )
            except Exception:  # noqa: BLE001 - a catalogue older than 12c
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


# --------------------------------------------------------------------------- #
# relations, indexes, comments and size
#
# `describe_table` answers "what is in this table". These helpers answer the four
# follow-up questions a model has before it writes a join: what does it point at,
# how is it indexed, what does the team call it, and roughly how big is it. Each
# one returns [] or None when the engine or the permissions cannot answer, so a
# missing comment never fails a describe call.


def _index_columns(definition: str) -> list[str]:
    """Columns named in a `pg_indexes.indexdef` string.

    The definition is `CREATE [UNIQUE] INDEX … USING btree (a, b)`; the column
    list is the first balanced parenthesis group. Expressions such as `lower(x)`
    come back as written, which is what the model needs to recognise the index.
    """
    text = str(definition or "")
    start = text.find("(")
    if start < 0:
        return []
    depth = 0
    piece: list[str] = []
    parts: list[str] = []
    for char in text[start:]:
        if char == "(":
            depth += 1
            if depth == 1:
                continue
        elif char == ")":
            depth -= 1
            if depth == 0:
                parts.append("".join(piece))
                break
        elif char == "," and depth == 1:
            parts.append("".join(piece))
            piece = []
            continue
        piece.append(char)
    return [part.strip().strip('"') for part in parts if part.strip()]


def _sqlite_foreign_keys(cursor, table: str) -> list[dict]:
    cursor.execute(f"PRAGMA foreign_key_list({_quote('sqlite', table)})")
    return [
        {"column": row[3], "refTable": row[2], "refColumn": row[4], "name": None}
        for row in cursor.fetchall()
    ]


def _sqlite_indexes(cursor, table: str) -> list[dict]:
    cursor.execute(f"PRAGMA index_list({_quote('sqlite', table)})")
    listing = cursor.fetchall()
    indexes: list[dict] = []
    for row in listing:
        name = row[1]
        cursor.execute(f"PRAGMA index_info({_quote('sqlite', name)})")
        indexes.append(
            {
                "name": name,
                "columns": [item[2] for item in cursor.fetchall()],
                "unique": bool(row[2]),
            }
        )
    return indexes


def _pg_foreign_keys(cursor, table: str, owner: str) -> list[dict]:
    # A constraint name only has to be unique within its table, so the join needs
    # table_name too: otherwise two tables that both call a key `fk_owner` swap
    # column lists. (Oracle's constraint names are unique per owner, so its
    # queries join on owner and name alone.)
    cursor.execute(
        "select kcu.column_name, ccu.table_name, ccu.column_name, tc.constraint_name "
        "from information_schema.table_constraints tc "
        "join information_schema.key_column_usage kcu "
        "  on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema "
        "  and kcu.table_name = tc.table_name "
        "join information_schema.constraint_column_usage ccu "
        "  on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema "
        "where tc.constraint_type = 'FOREIGN KEY' "
        "  and tc.table_name = %s and tc.table_schema = %s "
        "order by tc.constraint_name, kcu.ordinal_position",
        (table, owner),
    )
    return [
        {"column": column, "refTable": ref_table, "refColumn": ref_column, "name": name}
        for column, ref_table, ref_column, name in cursor.fetchall()
    ]


def _pg_indexes(cursor, table: str, owner: str) -> list[dict]:
    cursor.execute(
        "select indexname, indexdef from pg_indexes where schemaname = %s and tablename = %s order by indexname",
        (owner, table),
    )
    return [
        {
            "name": name,
            "columns": _index_columns(definition),
            "unique": str(definition or "").upper().startswith("CREATE UNIQUE"),
        }
        for name, definition in cursor.fetchall()
    ]


def _pg_comments(cursor, table: str, owner: str) -> tuple[str | None, dict[str, str]]:
    cursor.execute(
        "select obj_description(c.oid, 'pg_class') from pg_class c "
        "join pg_namespace n on n.oid = c.relnamespace where c.relname = %s and n.nspname = %s",
        (table, owner),
    )
    row = cursor.fetchone()
    comment = str(row[0]) if row and row[0] else None
    cursor.execute(
        "select a.attname, col_description(c.oid, a.attnum) from pg_class c "
        "join pg_namespace n on n.oid = c.relnamespace "
        "join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped "
        "where c.relname = %s and n.nspname = %s",
        (table, owner),
    )
    return comment, {str(name): str(text) for name, text in cursor.fetchall() if text}


def _pg_row_estimate(cursor, table: str, owner: str) -> int | None:
    # `reltuples` is what ANALYZE recorded; it is -1 on a table never analysed,
    # and it is an estimate — never turn it into a count(*) here.
    cursor.execute(
        "select c.reltuples::bigint from pg_class c "
        "join pg_namespace n on n.oid = c.relnamespace where c.relname = %s and n.nspname = %s",
        (table, owner),
    )
    row = cursor.fetchone()
    if not row or row[0] is None:
        return None
    value = int(row[0])
    return value if value >= 0 else None


def _mysql_foreign_keys(cursor, table: str, owner: str) -> list[dict]:
    cursor.execute(
        "select column_name, referenced_table_name, referenced_column_name, constraint_name "
        "from information_schema.key_column_usage "
        "where table_schema = %s and table_name = %s and referenced_table_name is not null "
        "order by constraint_name, ordinal_position",
        (owner, table),
    )
    return [
        {"column": column, "refTable": ref_table, "refColumn": ref_column, "name": name}
        for column, ref_table, ref_column, name in cursor.fetchall()
    ]


def _mysql_indexes(cursor, table: str, owner: str) -> list[dict]:
    cursor.execute(
        "select index_name, non_unique, column_name from information_schema.statistics "
        "where table_schema = %s and table_name = %s order by index_name, seq_in_index",
        (owner, table),
    )
    grouped: dict[str, dict] = {}
    for name, non_unique, column in cursor.fetchall():
        entry = grouped.setdefault(
            str(name),
            {"name": str(name), "columns": [], "unique": not int(non_unique or 0)},
        )
        entry["columns"].append(column)
    return list(grouped.values())


def _mysql_comments(cursor, table: str, owner: str) -> tuple[str | None, dict[str, str]]:
    cursor.execute(
        "select table_comment from information_schema.tables where table_schema = %s and table_name = %s",
        (owner, table),
    )
    row = cursor.fetchone()
    comment = str(row[0]).strip() if row and row[0] and str(row[0]).strip() else None
    cursor.execute(
        "select column_name, column_comment from information_schema.columns "
        "where table_schema = %s and table_name = %s",
        (owner, table),
    )
    return comment, {str(name): str(text) for name, text in cursor.fetchall() if text}


def _mysql_row_estimate(cursor, table: str, owner: str) -> int | None:
    cursor.execute(
        "select table_rows from information_schema.tables where table_schema = %s and table_name = %s",
        (owner, table),
    )
    row = cursor.fetchone()
    return int(row[0]) if row and row[0] is not None else None


def _oracle_foreign_keys(cursor, table: str, owner: str) -> list[dict]:
    cursor.execute(
        "select cc.column_name, rc.table_name, rcc.column_name, c.constraint_name "
        "from all_constraints c "
        "join all_cons_columns cc on cc.owner = c.owner and cc.constraint_name = c.constraint_name "
        "join all_constraints rc on rc.owner = c.r_owner and rc.constraint_name = c.r_constraint_name "
        "join all_cons_columns rcc on rcc.owner = rc.owner and rcc.constraint_name = rc.constraint_name "
        "  and rcc.position = cc.position "
        "where c.constraint_type = 'R' and c.owner = :1 and c.table_name = :2 "
        "order by c.constraint_name, cc.position",
        [owner, table],
    )
    return [
        {"column": column, "refTable": ref_table, "refColumn": ref_column, "name": name}
        for column, ref_table, ref_column, name in cursor.fetchall()
    ]


def _oracle_indexes(cursor, table: str, owner: str) -> list[dict]:
    cursor.execute(
        "select i.index_name, i.uniqueness, c.column_name "
        "from all_indexes i join all_ind_columns c "
        "  on c.index_owner = i.owner and c.index_name = i.index_name "
        "where i.table_owner = :1 and i.table_name = :2 order by i.index_name, c.column_position",
        [owner, table],
    )
    grouped: dict[str, dict] = {}
    for name, uniqueness, column in cursor.fetchall():
        entry = grouped.setdefault(
            str(name),
            {"name": str(name), "columns": [], "unique": str(uniqueness).upper() == "UNIQUE"},
        )
        entry["columns"].append(column)
    return list(grouped.values())


def _oracle_comments(cursor, table: str, owner: str) -> tuple[str | None, dict[str, str]]:
    cursor.execute(
        "select comments from all_tab_comments where owner = :1 and table_name = :2",
        [owner, table],
    )
    row = cursor.fetchone()
    comment = str(row[0]).strip() if row and row[0] and str(row[0]).strip() else None
    cursor.execute(
        "select column_name, comments from all_col_comments where owner = :1 and table_name = :2",
        [owner, table],
    )
    return comment, {str(name): str(text) for name, text in cursor.fetchall() if text}


def _oracle_row_estimate(cursor, table: str, owner: str) -> int | None:
    cursor.execute(
        "select num_rows from all_tables where owner = :1 and table_name = :2",
        [owner, table],
    )
    row = cursor.fetchone()
    return int(row[0]) if row and row[0] is not None else None


def _describe_extras(kind: str, cursor, table: str, owner: str | None) -> dict:
    """The optional half of `describe_table`, never fatal.

    A driver that refuses one of these queries (a missing grant on
    `information_schema`, a catalog view a GaussDB build does not carry) leaves
    that field empty and the describe call still succeeds.
    """
    extras = {"foreignKeys": [], "indexes": [], "comment": None, "rowEstimate": None}
    if kind == "sqlite":
        pairs = (
            ("foreignKeys", lambda: _sqlite_foreign_keys(cursor, table)),
            ("indexes", lambda: _sqlite_indexes(cursor, table)),
        )
    elif kind in PG_LIKE:
        pairs = (
            ("foreignKeys", lambda: _pg_foreign_keys(cursor, table, owner or "public")),
            ("indexes", lambda: _pg_indexes(cursor, table, owner or "public")),
            ("rowEstimate", lambda: _pg_row_estimate(cursor, table, owner or "public")),
        )
    elif kind == "mysql":
        pairs = (
            ("foreignKeys", lambda: _mysql_foreign_keys(cursor, table, owner)),
            ("indexes", lambda: _mysql_indexes(cursor, table, owner)),
            ("rowEstimate", lambda: _mysql_row_estimate(cursor, table, owner)),
        )
    elif kind == "oracle":
        pairs = (
            ("foreignKeys", lambda: _oracle_foreign_keys(cursor, table, owner)),
            ("indexes", lambda: _oracle_indexes(cursor, table, owner)),
            ("rowEstimate", lambda: _oracle_row_estimate(cursor, table, owner)),
        )
    else:
        return extras
    for key, read in pairs:
        try:
            extras[key] = read()
        except Exception:  # noqa: BLE001 - a missing grant must not fail describe
            extras[key] = [] if key != "rowEstimate" else None
    return extras


def _describe_comments(kind: str, cursor, table: str, owner: str | None) -> tuple[str | None, dict[str, str]]:
    try:
        if kind in PG_LIKE:
            return _pg_comments(cursor, table, owner or "public")
        if kind == "mysql":
            return _mysql_comments(cursor, table, owner)
        if kind == "oracle":
            return _oracle_comments(cursor, table, owner)
    except Exception:  # noqa: BLE001 - comments are a nicety, not a requirement
        pass
    return None, {}


def _oracle_catalog_name(cursor, owner: str | None, table: str) -> str:
    """The name Oracle actually stores for `table`.

    Oracle folds unquoted identifiers to upper case, but a table created with a
    quoted lower-case name keeps that case. Ask the catalog which spelling exists
    instead of guessing, so both kinds of table resolve.
    """
    wanted = str(table)
    # oracledb (thin) counts every placeholder occurrence positionally, so the
    # same `:1` written twice in a `union all` still wants two values. Number the
    # four slots distinctly instead of repeating two.
    check = (
        "select table_name from all_tables where owner = :1 and table_name = :2 "
        "union all select view_name from all_views where owner = :3 and view_name = :4"
    )
    fuzzy = (
        "select table_name from all_tables where owner = :1 and upper(table_name) = upper(:2) "
        "union all select view_name from all_views where owner = :3 and upper(view_name) = upper(:4)"
    )
    for candidate in dict.fromkeys((wanted, wanted.upper())):
        cursor.execute(check, [owner, candidate, owner, candidate])
        row = cursor.fetchone()
        if row:
            return str(row[0])
    cursor.execute(fuzzy, [owner, wanted, owner, wanted])
    row = cursor.fetchone()
    return str(row[0]) if row else wanted


def describe_table(profile: dict, connection, table: str, schema: str | None) -> dict:
    kind = profile.get("kind")
    config = profile.get("config") or {}
    effective = schema or config.get("schema") or None
    columns: list[dict] = []
    primary: list[str] = []
    owner: str | None = None
    comment: str | None = None
    column_comments: dict[str, str] = {}
    extras: dict = {"foreignKeys": [], "indexes": [], "comment": None, "rowEstimate": None}
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
                # MySQL names every primary key `PRIMARY`, so the constraint name
                # alone does not identify a table: without the table_name term the
                # join pulls in the key columns of every table in the schema, and a
                # single-column primary key comes back once per table.
                "  on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema "
                "  and kcu.table_name = tc.table_name "
                f"where tc.constraint_type = 'PRIMARY KEY' and tc.table_name = {placeholder} and tc.table_schema = {placeholder} "
                "order by kcu.ordinal_position",
                (table, owner),
            )
            primary = [row[0] for row in cursor.fetchall()]
            for column in columns:
                column["primaryKey"] = column["name"] in primary
        elif kind == "oracle":
            owner = (effective or config.get("user") or "").upper() or None
            # Ask the catalog which spelling it stores: an unquoted table is
            # folded to upper case, a quoted lower-case one keeps its case.
            resolved = _oracle_catalog_name(cursor, owner, table)
            cursor.execute(
                "select column_name, data_type, data_length, data_precision, data_scale, nullable, data_default "
                "from all_tab_columns where owner = :1 and table_name = :2 order by column_id",
                [owner, resolved],
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
                [owner, resolved],
            )
            primary = [row[0] for row in cursor.fetchall()]
            for column in columns:
                column["primaryKey"] = column["name"] in primary
            table = resolved
        else:
            raise DbError("user_error", f"unsupported datasource kind: {kind}")
        comment, column_comments = _describe_comments(kind, cursor, table, owner)
        extras = _describe_extras(kind, cursor, table, owner)
    finally:
        cursor.close()
    if not columns:
        raise DbError("user_error", f"table not found: {table}", "call list_tables to see the available tables")
    for column in columns:
        if column_comments.get(column["name"]):
            column["comment"] = column_comments[column["name"]]
    return {
        "table": table,
        "schema": effective,
        "columns": columns,
        "primaryKey": primary,
        "foreignKeys": extras["foreignKeys"],
        "indexes": extras["indexes"],
        "comment": comment or extras.get("comment"),
        "rowEstimate": extras["rowEstimate"],
    }


# --------------------------------------------------------------------------- #
# relations


def _relations_sql(kind: str) -> tuple[str, bool]:
    """One query that lists every foreign key in a schema.

    Returns the statement and whether it takes the owner as a parameter. Doing it
    in one round trip matters: the model asks this before writing joins, and a
    per-table loop turns one tool call into a hundred.
    """
    if kind == "sqlite":
        return "", False
    if kind in PG_LIKE:
        return (
            "select tc.table_name, kcu.column_name, ccu.table_name, ccu.column_name, tc.constraint_name "
            "from information_schema.table_constraints tc "
            "join information_schema.key_column_usage kcu "
            "  on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema "
            "  and kcu.table_name = tc.table_name "
            "join information_schema.constraint_column_usage ccu "
            "  on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema "
            "where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = %s "
            "order by tc.table_name, tc.constraint_name, kcu.ordinal_position",
            True,
        )
    if kind == "mysql":
        return (
            "select table_name, column_name, referenced_table_name, referenced_column_name, constraint_name "
            "from information_schema.key_column_usage "
            "where table_schema = %s and referenced_table_name is not null "
            "order by table_name, constraint_name, ordinal_position",
            True,
        )
    if kind == "oracle":
        # `all_constraints` covers Oracle's own catalogue tables too, and those
        # carry dozens of internal foreign keys. Join `all_objects` to keep only
        # the tables the user created.
        return (
            "select c.table_name, cc.column_name, rc.table_name, rcc.column_name, c.constraint_name "
            "from all_constraints c "
            "join all_cons_columns cc on cc.owner = c.owner and cc.constraint_name = c.constraint_name "
            "join all_constraints rc on rc.owner = c.r_owner and rc.constraint_name = c.r_constraint_name "
            "join all_cons_columns rcc on rcc.owner = rc.owner and rcc.constraint_name = rc.constraint_name "
            "  and rcc.position = cc.position "
            "join all_objects o on o.owner = c.owner and o.object_name = c.table_name "
            "  and o.object_type = 'TABLE' and o.oracle_maintained = 'N' "
            "where c.constraint_type = 'R' and c.owner = :1 "
            "order by c.table_name, c.constraint_name, cc.position",
            True,
        )
    return "", False


def list_relations(profile: dict, connection, schema: str | None, limit: int = 500) -> dict:
    """Every foreign key in one schema, as flat rows ready to become joins."""
    kind = profile.get("kind")
    config = profile.get("config") or {}
    effective = schema or config.get("schema") or None
    owner = effective or (config.get("database") if kind == "mysql" else "public")
    if kind == "oracle":
        owner = (effective or config.get("user") or "").upper() or None
    relations: list[dict] = []
    cursor = connection.cursor()
    try:
        if kind == "sqlite":
            # SQLite has no catalog-wide foreign-key view: walk the tables.
            cursor.execute(
                "select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name"
            )
            names = [row[0] for row in cursor.fetchall()]
            for name in names:
                for entry in _sqlite_foreign_keys(cursor, name):
                    relations.append({"table": name, **entry})
        else:
            statement, takes_owner = _relations_sql(kind)
            if not statement:
                raise DbError("user_error", f"unsupported datasource kind: {kind}")
            cursor.execute(statement, (owner,) if kind in PG_LIKE or kind == "mysql" else [owner])
            for table, column, ref_table, ref_column, name in cursor.fetchall():
                relations.append(
                    {
                        "table": table,
                        "column": column,
                        "refTable": ref_table,
                        "refColumn": ref_column,
                        "name": name,
                    }
                )
    finally:
        cursor.close()
    truncated = len(relations) > limit
    return {
        "schema": effective,
        "relations": relations[:limit],
        "truncated": truncated,
        "total": len(relations),
    }


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
    # `describe_table` resolves the spelling Oracle actually stores; quote that,
    # not the argument, or a quoted lower-case table comes back upper-cased.
    resolved = info.get("table") or table
    quote = _quote_exact if kind == "oracle" else _quote
    if effective and kind in ("postgres", "gauss", "oracle", "mysql"):
        target = f"{_quote(kind, effective)}.{quote(kind, resolved)}"
    else:
        target = quote(kind, resolved)

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


def _read_cursor(connection, kind: str, is_write: bool, statement: str = ""):
    """A cursor that does not pull the whole result set into memory.

    A client-side cursor fetches every row on `execute()`, so `max_rows` only
    trimmed what was *rendered* while the driver had already buffered a million
    rows. A server-side cursor sends the query and reads rows on demand, which is
    what makes the row cap a real bound on memory.

    Only a statement that returns rows may be wrapped: PostgreSQL's named cursor
    becomes `DECLARE … CURSOR FOR <sql>`, and a `SET`, `SHOW` or `EXPLAIN` is not
    legal there. Those go through the ordinary cursor — they return a handful of
    rows at most.
    """
    if is_write or not _returns_rows(statement):
        return connection.cursor()
    try:
        if kind in PG_LIKE:
            # psycopg3's named cursor needs a transaction block; the caller is in
            # one already (the connection is not autocommit), so this is safe.
            return connection.cursor(name="db_mcp_read")
        if kind == "mysql":
            import pymysql

            return connection.cursor(pymysql.cursors.SSCursor)
    except Exception:  # noqa: BLE001 - fall back to the plain cursor
        pass
    return connection.cursor()


def execute_sql(profile: dict, connection, sql: str, max_rows: int, full_text: bool = False) -> dict:
    ensure_readable(sql, profile)
    kind = profile.get("kind")
    statement = statements_of(sql, kind)[0]
    started = time.perf_counter()
    # The first keyword is not enough: `with x as (delete … returning *) select …`
    # starts with `with` but changes rows, and used to be rolled back here.
    is_write = not read_only_statement(statement, kind)
    if kind == "sqlite":
        _arm_sqlite_timeout(connection)
    cursor = _read_cursor(connection, kind, is_write, statement)
    affected = None
    try:
        if kind == "oracle" and profile.get("readOnly"):
            try:
                cursor.execute("SET TRANSACTION READ ONLY")
            except Exception:  # noqa: BLE001 - not every session allows the switch
                pass
        try:
            cursor.execute(statement)
            columns, rows, truncated = _rows(cursor, max_rows, full_text)
        except Exception as error:  # noqa: BLE001 - re-raised as a DbError below
            if _is_timeout(error):
                raise _timeout_error(kind, error) from error
            raise

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
        if kind == "sqlite":
            _disarm_sqlite_timeout(connection)
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
    kind = profile.get("kind")
    if kind == "oracle":
        # Resolve the spelling the catalog stores before quoting: `_quote` folds
        # to upper case, which misses a table created with a quoted lower-case name.
        owner = ((schema or (profile.get("config") or {}).get("schema") or (profile.get("config") or {}).get("user") or "") or "").upper() or None
        cursor = connection.cursor()
        try:
            table = _oracle_catalog_name(cursor, owner, table)
        finally:
            cursor.close()
    sql = f"SELECT * FROM {qualified(profile, table, exact=True)}{_limit_clause(kind, limit)}"
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

