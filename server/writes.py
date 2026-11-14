"""Write guard: a writable source may only write to the schemas it names.

The plugin already has two coarser switches — the global write switch in the
plugin settings and the per-source read-only flag. This is the third and
narrowest one: switching a source to writable asks which schemas may be written
to, and every changing statement is checked against that list before it reaches
the database. Reads are never restricted; the list is about writes only.

The guard is not an authorization system — the database's own GRANTs remain the
real boundary. It is a mistake guard, so it errs on the side of refusing: a
statement whose target cannot be worked out is refused instead of waved through.
"""

from __future__ import annotations

import re

# Statements that do not change data. `set` is here because session settings are
# the only thing `set` does in the engines this plugin talks to, and `comment`
# changes metadata rather than rows.
READ_STARTERS = (
    "select",
    "with",
    "show",
    "describe",
    "desc",
    "explain",
    "pragma",
    "values",
    "table",
    "set",
    "use",
    "begin",
    "commit",
    "rollback",
    "savepoint",
    "release",
    "start",
    "analyze",
    "vacuum",
    "lock",
    "comment",
)

# Statements that change the shape of the database rather than its rows. They are
# a switch of their own on the source: a source may be perfectly happy to take an
# `insert` and still be one where the tables belong to somebody else, so DDL is
# opted into per source instead of riding along with the write switch.
DDL_STARTERS = (
    "create",
    "alter",
    "drop",
    "truncate",
    "rename",
    "grant",
    "revoke",
)

# Object kinds that can follow CREATE/ALTER/DROP before the name.
_OBJECT_KINDS = (
    "table",
    "view",
    "materialized",
    "index",
    "sequence",
    "schema",
    "database",
    "function",
    "procedure",
    "trigger",
    "type",
    "domain",
    "extension",
    "role",
    "user",
    "tablespace",
    "server",
    "publication",
    "subscription",
    "policy",
    "rule",
    "statistics",
    "aggregate",
    "operator",
    "cast",
    "collation",
    "conversion",
    "language",
    "event",
)

# Modifiers that may sit between the verb and the object kind.
_MODIFIERS = (
    "or",
    "replace",
    "unique",
    "temp",
    "temporary",
    "unlogged",
    "if",
    "not",
    "exists",
    "global",
    "local",
    "clustered",
    "nonclustered",
    "force",
    "noforce",
    "concurrently",
)

# An object kind that hangs off another object: `create index i on t`,
# `create trigger g on t`. The writable target is the name after `on`.
_ATTACHED_KINDS = ("index", "trigger", "rule", "policy", "statistics")

_IDENT = r'(?:"([^"]+)"|`([^`]+)`|([A-Za-z_][\w$#@]*))'
_QUALIFIED = re.compile(
    r"^\s*" + _IDENT + r"(?:\s*\.\s*" + _IDENT + r")?",
)

# Keywords that can sit where a name is expected. A truncated statement such as
# `insert into` leaves `into` behind, and reading it as a table name would turn a
# parse failure into a confident (and wrong) refusal naming a schema that has
# nothing to do with the statement. None of these can be an unquoted table name.
_NOT_A_NAME = frozenset(
    {
        "into",
        "from",
        "table",
        "only",
        "if",
        "exists",
        "set",
        "values",
        "using",
        "where",
        "select",
        "on",
        "as",
    }
)

_INSERT = re.compile(r"^\s*(?:insert|replace)\s+(?:into\s+)?", re.I)
_UPDATE = re.compile(r"^\s*update\s+", re.I)
_DELETE = re.compile(r"^\s*delete\s+(?:from\s+)?", re.I)
_MERGE = re.compile(r"^\s*merge\s+(?:into\s+)?", re.I)
_TRUNCATE = re.compile(r"^\s*truncate\s+(?:table\s+)?", re.I)
_DDL = re.compile(r"^\s*(?:create|alter|drop)\s+", re.I)
_GRANT = re.compile(r"^\s*(?:grant|revoke)\b.*?\bon\s+", re.I | re.S)
_CALL = re.compile(r"^\s*(?:call|exec|execute)\s+", re.I)


class WriteBlocked(Exception):
    """A write that the source's writable-schema list does not allow."""

    def __init__(self, message: str, hint: str | None = None):
        super().__init__(message)
        self.message = message
        self.hint = hint


def _strip_leading_noise(text: str) -> str:
    """Drop leading comments so `-- hi\nupdate …` still reads as an update."""
    rest = text
    while True:
        stripped = rest.lstrip()
        if stripped.startswith("--"):
            newline = stripped.find("\n")
            rest = "" if newline < 0 else stripped[newline + 1 :]
            continue
        if stripped.startswith("/*"):
            end = stripped.find("*/")
            rest = "" if end < 0 else stripped[end + 2 :]
            continue
        return stripped


def statements(sql: str) -> list[str]:
    """Split on `;` while ignoring semicolons inside quotes.

    A driver may reject multi-statement strings anyway; splitting here only
    means every statement is checked rather than only the first one.
    """
    pieces: list[str] = []
    current: list[str] = []
    quote = ""
    index = 0
    text = sql or ""
    while index < len(text):
        char = text[index]
        if quote:
            current.append(char)
            if char == quote:
                # Doubled quote inside a string stays inside the string.
                if index + 1 < len(text) and text[index + 1] == quote:
                    current.append(text[index + 1])
                    index += 2
                    continue
                quote = ""
            index += 1
            continue
        if char in ("'", '"', "`"):
            quote = char
            current.append(char)
            index += 1
            continue
        if char == ";":
            pieces.append("".join(current))
            current = []
            index += 1
            continue
        current.append(char)
        index += 1
    pieces.append("".join(current))
    return [piece.strip() for piece in pieces if piece.strip()]


def keyword(sql: str) -> str:
    text = _strip_leading_noise(sql)
    match = re.match(r"[A-Za-z]+", text)
    return match.group(0).lower() if match else ""


def is_ddl(sql: str) -> bool:
    """True when any statement in `sql` changes the shape of the database."""
    for statement in statements(sql):
        if keyword(statement) in DDL_STARTERS:
            return True
    return False


def allows_ddl(profile: dict) -> bool:
    """Whether this source opted into DDL. Absent means no."""
    return profile.get("allowDdl") is True


def _identifier(text: str) -> tuple[str | None, str | None]:
    """Read `schema.table`, `table` or a quoted form of either."""
    match = _QUALIFIED.match(text)
    if not match:
        return None, None
    first = match.group(1) or match.group(2) or match.group(3)
    second = match.group(4) or match.group(5) or match.group(6)
    if second:
        return first, second
    # `insert into` with nothing after it: the optional `into` was not consumed
    # by the verb pattern, so the keyword itself must not read as a table name.
    if first and first.lower() in _NOT_A_NAME:
        return None, None
    return None, first


def _drop_modifiers(text: str) -> str:
    rest = text.lstrip()
    while True:
        match = re.match(r"([A-Za-z]+)\b", rest)
        if not match:
            return rest
        word = match.group(1).lower()
        if word in _MODIFIERS:
            rest = rest[match.end() :].lstrip()
            continue
        return rest


def _ddl_target(text: str) -> tuple[str | None, str | None]:
    rest = _drop_modifiers(text)
    kind = ""
    match = re.match(r"([A-Za-z]+)\b", rest)
    if match and match.group(1).lower() in _OBJECT_KINDS:
        kind = match.group(1).lower()
        rest = _drop_modifiers(rest[match.end() :])
    if kind in _ATTACHED_KINDS:
        # `create index i on t`: the object that gains a row is `t`.
        attached = re.search(r"\bon\s+", rest, re.I)
        if attached:
            rest = rest[attached.end() :]
    return _identifier(rest)


def targets(statement: str) -> list[tuple[str | None, str | None]] | None:
    """The objects one statement writes to, or None when it cannot be read."""
    text = _strip_leading_noise(statement)
    if not text:
        return []
    for pattern in (_INSERT, _UPDATE, _DELETE, _MERGE, _TRUNCATE, _CALL):
        match = pattern.match(text)
        if match:
            found = _identifier(text[match.end() :])
            return [found] if found[1] else None
    match = _GRANT.match(text)
    if match:
        found = _identifier(text[match.end() :])
        return [found] if found[1] else None
    match = _DDL.match(text)
    if match:
        found = _ddl_target(text[match.end() :])
        return [found] if found[1] else None
    return None


def default_schema(profile: dict) -> str | None:
    """The schema an unqualified name lands in, per engine."""
    kind = profile.get("kind")
    config = profile.get("config") or {}
    if kind == "sqlite":
        return "main"
    if kind == "mysql":
        return config.get("database") or None
    if kind == "oracle":
        schema = config.get("schema") or config.get("user") or ""
        return str(schema).upper() or None
    return config.get("schema") or "public"


def allowed(profile: dict) -> list[str]:
    declared = profile.get("writableSchemas")
    if not isinstance(declared, list):
        return []
    return [str(name) for name in declared if str(name).strip()]


def check(sql: str, profile: dict) -> None:
    """Raise WriteBlocked unless every write in `sql` targets a writable schema."""
    if is_ddl(sql) and not allows_ddl(profile):
        raise WriteBlocked(
            f"datasource {profile.get('id')} does not allow DDL; the schema was left untouched",
            "turn on DDL for this source in the Database panel, or run the statement in a client that is not guarded",
        )
    names = allowed(profile)
    if not names:
        raise WriteBlocked(
            f"datasource {profile.get('id')} is writable but names no writable schema",
            "pick at least one writable schema for this source in the Database panel",
        )
    permitted = {name.casefold() for name in names}
    listing = ", ".join(names)

    for statement in statements(sql):
        if keyword(statement) in READ_STARTERS:
            continue
        found = targets(statement)
        if found is None:
            raise WriteBlocked(
                "could not work out which schema this statement writes to, so it was refused",
                f"only writes to {listing} are allowed on this source; qualify the table name",
            )
        for schema, table in found:
            effective = schema or default_schema(profile)
            if not effective:
                raise WriteBlocked(
                    f"could not work out the schema of {table}, so the write was refused",
                    f"qualify the name as schema.{table}, or set a default schema for this source",
                )
            if effective.casefold() not in permitted:
                raise WriteBlocked(
                    f"{effective} is not a writable schema of {profile.get('id')}",
                    f"this source may only write to {listing}; allow the schema in the Database panel",
                )
