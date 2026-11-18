"""Write guard: DDL is its own permission, off by default.

The plugin already has two coarser switches — the global write switch in the
plugin settings and the per-source read-only flag. This is the third one: a
source that accepts `insert`, `update` and `delete` may still be one whose
tables belong to somebody else, so statements that change the shape of the
database (`create`, `alter`, `drop`, and friends) are refused unless the source
opted into DDL. Reads are never restricted, and neither are row writes once the
source is writable — the guard is only about shape-changing statements.

The guard is not an authorization system — the database's own GRANTs remain the
real boundary. It is a mistake guard, so it errs on the side of refusing.
"""

from __future__ import annotations

import re

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


class WriteBlocked(Exception):
    """A statement the source's DDL switch does not allow.

    `code` matches the shape of `DbError` and `StoreError`, so `main._error` can
    report it without a special case. It says `user_error` because that is what
    the caller is told: `engines.ensure_readable` turns this into a `DbError`, and
    a refusal is a mistake in the request, not a fault of the engine.
    """

    code = "user_error"

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


def check(sql: str, profile: dict) -> None:
    """Raise WriteBlocked when `sql` changes the shape and the source said no."""
    if is_ddl(sql) and not allows_ddl(profile):
        raise WriteBlocked(
            f"datasource {profile.get('id')} does not allow DDL; the schema was left untouched",
            "turn on DDL for this source in the Data sources panel, or run the statement in a client that is not guarded",
        )
