"""Find the joins someone wrote in the source tree, not in the audit log.

`mine_relations` reads statements that were actually executed; this reads the
statements that were committed. A Spring Boot project keeps them in three places:

* MyBatis mapper XML — `<select>`, `<insert>`, `<update>`, `<delete>` and `<sql>`
  bodies, including whatever is nested inside `<if>`/`<foreach>`/`<where>`;
* MyBatis annotations — `@Select`, `@Insert`, `@Update`, `@Delete`;
* MyBatis-Plus fragments — `.apply(...)`, `.last(...)`, `.inSql(...)`,
  `.exists(...)`.

Only those places are read. Picking every string literal out of every `.java`
file would turn log messages and regexes into tables, and a scanner that invents
joins is worse than one that finds none.

This module is a parser and a file walker, nothing more: it yields `(file, line,
sql)` triples. Whether a pair is a real join, and which side is the child, is
decided in `main.scan_code_relations` against the catalog — exactly as
`mine_relations` does it.
"""

from __future__ import annotations

import re
import xml.etree.ElementTree as ElementTree
from pathlib import Path

# Directories that never hold the project's own source. `build`/`target` are
# generated output, so a join in them is a copy of one already found (or stale).
SKIP_DIRS = frozenset(
    {".git", ".gradle", ".idea", ".vscode", "target", "build", "out", "bin", "logs", "node_modules", ".mvn"}
)

# Mapper XML elements whose body is a statement. `sql` is a fragment included
# elsewhere, so its joins still describe the schema.
XML_TAGS = ("select", "insert", "update", "delete", "sql")

# MyBatis annotations whose argument is SQL.
ANNOTATIONS = re.compile(r"@(?:Select|Insert|Update|Delete)\s*\(", re.IGNORECASE)

# MyBatis-Plus wrapper calls whose argument is a SQL fragment. These are the only
# ones that can carry a join; `eq`/`in`/`like` take column names and values.
WRAPPERS = re.compile(r"\.(?:apply|last|inSql|exists|notExists|having)\s*\(", re.IGNORECASE)

# A mapper XML is identified by its namespace root, not by its file name: plenty
# of projects call the file after the entity.
MAPPER_HINT = re.compile(r"<(?:!DOCTYPE\s+mapper|mapper\b)", re.IGNORECASE)

# Big files are generated or vendored far more often than they are hand written.
MAX_BYTES = 2 * 1024 * 1024


def _skip(path: Path) -> bool:
    return any(part.casefold() in SKIP_DIRS for part in path.parts)


def _walk(root: Path, limit: int) -> list[Path]:
    """Source files under `root`, in a stable order, capped at `limit`."""
    found: list[Path] = []
    try:
        candidates = sorted(root.rglob("*"))
    except OSError:
        return found
    for path in candidates:
        if len(found) >= limit:
            break
        if path.suffix.casefold() not in (".xml", ".java"):
            continue
        try:
            relative = path.relative_to(root)
        except ValueError:
            continue
        if _skip(relative):
            continue
        found.append(path)
    return found


def _text(path: Path) -> str | None:
    try:
        if path.stat().st_size > MAX_BYTES:
            return None
        return path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None


def _line_of(text: str, offset: int) -> int:
    return text.count("\n", 0, offset) + 1


def _collapse(sql: str) -> str:
    """One line per statement: the parser reads keywords, not layout."""
    return re.sub(r"\s+", " ", sql or "").strip()


def _xml_statements(text: str) -> list[tuple[int, str]]:
    """Statement bodies of one mapper XML, with their line numbers."""
    if not MAPPER_HINT.search(text):
        return []
    try:
        root = ElementTree.fromstring(text)
    except ElementTree.ParseError:
        return []
    found: list[tuple[int, str]] = []
    # Elements arrive in document order, so the opening tag can be found by
    # searching forward from the previous one. That keeps the reported line honest
    # even when the body is reflowed, which a search for the body itself cannot do.
    cursor = 0
    for element in root.iter():
        tag = element.tag if isinstance(element.tag, str) else ""
        local = tag.rsplit("}", 1)[-1]
        if local.casefold() not in XML_TAGS:
            continue
        # itertext() flattens `<if>`/`<foreach>`/`<where>` children, which is what
        # the SQL looks like once MyBatis has built it.
        body = _collapse("".join(element.itertext()))
        opening = re.compile(rf"<{local}\b", re.IGNORECASE)
        match = opening.search(text, cursor)
        if match:
            cursor = match.end()
            line = _line_of(text, match.start())
        else:
            line = 0
        if body:
            found.append((line, body))
    return found


def _literals(fragment: str) -> list[str]:
    """Java string literals in one fragment, text blocks first.

    Text blocks are consumed before ordinary literals so `\"\"\"` does not read as
    an empty string followed by garbage.
    """
    out: list[str] = []
    rest = fragment
    for block in re.finditer(r'"""(.*?)"""', rest, re.DOTALL):
        out.append(block.group(1))
    rest = re.sub(r'""".*?"""', '""', rest, flags=re.DOTALL)
    for match in re.finditer(r'"((?:[^"\\\n]|\\.)*)"', rest):
        out.append(match.group(1))
    return [_unescape(item) for item in out]


def _unescape(value: str) -> str:
    return (
        value.replace("\\n", " ")
        .replace("\\r", " ")
        .replace("\\t", " ")
        .replace('\\"', '"')
        .replace("\\\\", "\\")
    )


def _argument(text: str, open_paren: int) -> str:
    """The balanced `(...)` body starting at `open_paren`."""
    depth = 0
    index = open_paren
    while index < len(text):
        character = text[index]
        if character == "(":
            depth += 1
        elif character == ")":
            depth -= 1
            if depth == 0:
                return text[open_paren + 1 : index]
        index += 1
    return text[open_paren + 1 :]


def _java_statements(text: str) -> list[tuple[int, str]]:
    """SQL held in MyBatis annotations and MyBatis-Plus wrapper calls."""
    found: list[tuple[int, str]] = []
    for anchor in list(ANNOTATIONS.finditer(text)) + list(WRAPPERS.finditer(text)):
        argument = _argument(text, anchor.end() - 1)
        # `@Update({"update ...", "where ..."})` is one statement: MyBatis joins
        # the array with spaces before it runs anything, so splitting here would
        # report two half statements and lose the join between them.
        body = _collapse(" ".join(_literals(argument)))
        if body:
            found.append((_line_of(text, anchor.start()), body))
    return found


def statements(root: Path, limit: int = 2000) -> list[dict]:
    """Every SQL statement this scanner recognises under `root`.

    Each item is `{file, line, sql}`, where `file` is relative to `root` so the
    report does not leak absolute paths into the audit log.
    """
    found: list[dict] = []
    for path in _walk(Path(root), limit):
        text = _text(path)
        if not text:
            continue
        try:
            relative = str(path.relative_to(root)).replace("\\", "/")
        except ValueError:
            relative = path.name
        entries = _xml_statements(text) if path.suffix.casefold() == ".xml" else _java_statements(text)
        for line, sql in entries:
            if len(found) >= limit:
                return found
            found.append({"file": relative, "line": line, "sql": sql})
    return found
