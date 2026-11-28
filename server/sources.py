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


def _local(tag) -> str:
    """The element name without its namespace."""
    return (tag if isinstance(tag, str) else "").rsplit("}", 1)[-1]


def _render(element, fragments: dict[str, object]) -> str:
    """One element's text, with `<include>` expanded and `<choose>` resolved.

    A mapper is read statically: nothing here evaluates an `<if test>`, so every
    branch that is written is treated as reachable — that is the point, a join in
    a rarely used branch is still a join someone wrote. `<choose>` is the one
    exception, because its branches are alternatives of the *same* join: taking
    all of them would count one join twice, so the first `<when>` (else the
    `<otherwise>`) is read and the rest are left alone.
    """
    name = _local(element.tag)
    if name == "include":
        target = fragments.get((element.get("refid") or "").strip())
        return _render(target, fragments) if target is not None else ""
    if name == "choose":
        children = list(element)
        picked = next((child for child in children if _local(child.tag) == "when"), None)
        if picked is None:
            picked = next((child for child in children if _local(child.tag) == "otherwise"), None)
        return _render(picked, fragments) if picked is not None else ""
    parts = [element.text or ""]
    for child in list(element):
        parts.append(_render(child, fragments))
        parts.append(child.tail or "")
    return "".join(parts)


# A fragment that is a whole statement stands on its own; one that is a bare
# `join ...` clause only means something once included, and reading it alone would
# report a statement with no `from` at all.
STATEMENT_START = re.compile(r"^\s*(select|insert|update|delete)\b", re.IGNORECASE)

# The schema someone spelled out, e.g. `from app.t_order`. It is kept as a hint:
# the same join written without it is the same edge, so it must not become part of
# the edge's identity.
SCHEMA_HINT = re.compile(r"\b(?:from|join)\s+([`\"\[]?[A-Za-z_][\w$#]*[`\"\]]?)\s*\.", re.IGNORECASE)


def _schema_hint(sql: str) -> str | None:
    match = SCHEMA_HINT.search(sql or "")
    if not match:
        return None
    hint = match.group(1).strip().strip('"`[]')
    return hint or None


def _xml_document(text: str) -> dict | None:
    """The parts of one mapper XML that a later pass needs to resolve."""
    if not MAPPER_HINT.search(text):
        return None
    try:
        root = ElementTree.fromstring(text)
    except ElementTree.ParseError:
        return None
    fragments: dict[str, object] = {}
    result_maps: dict[str, list[tuple[str, str]]] = {}
    selects: dict[str, object] = {}
    for element in root.iter():
        name = _local(element.tag).casefold()
        if name == "sql":
            key = (element.get("id") or "").strip()
            if key:
                fragments[key] = element
        elif name == "resultmap":
            key = (element.get("id") or "").strip()
            links: list[tuple[str, str]] = []
            for child in element.iter():
                if _local(child.tag).casefold() not in ("association", "collection"):
                    continue
                column = (child.get("column") or "").strip()
                target = (child.get("select") or "").strip()
                # Without both halves there is no link: a nested association that
                # inlines its columns says nothing about another table.
                if column and target:
                    links.append((column, target))
            if key:
                result_maps[key] = links
        elif name in XML_TAGS:
            key = (element.get("id") or "").strip()
            if key:
                selects[key] = element
    return {
        "namespace": (root.get("namespace") or "").strip(),
        "fragments": fragments,
        "result_maps": result_maps,
        "selects": selects,
    }


def _statement_id(namespace: str, key: str) -> str:
    return f"{namespace}.{key}" if namespace else key


# One identifier, possibly quoted: `order`, `"order"`, `` `order` ``, `[order]`.
_IDENT = r"[`\"\[]?[A-Za-z_][\w$#]*[`\"\]]?"
# One table reference, optionally schema-qualified: `t_order`, `app.t_order`.
_TABLE = rf"{_IDENT}(?:\.{_IDENT})?"

# The table a statement reads and the column it filters its parameter on. That
# pair is what a nested `<association select=...>` passes its `column` into, so it
# is the join the convention stands for.
FROM_TABLE = re.compile(rf"\bfrom\s+({_TABLE})", re.IGNORECASE)
PARAM_FILTER = re.compile(
    rf"(?:({_IDENT})\.)?({_IDENT})\s*=\s*#\{{\s*[^}}]+\}}",
    re.IGNORECASE,
)


def _anchor(sql: str) -> tuple[str, str] | None:
    """The table a statement reads and the column its parameter is matched to."""
    table = FROM_TABLE.search(sql or "")
    if not table:
        return None
    column = PARAM_FILTER.search(sql or "")
    if not column:
        return None
    return _clean_name(table.group(1)), _clean_name(column.group(2))


def _clean_name(name: str) -> str:
    text = (name or "").strip().strip('"`[]')
    if "." in text:
        text = text.rsplit(".", 1)[-1]
    return text.strip().strip('"`[]')


def _xml_elements(text: str) -> list:
    """Every element of a mapper XML, in document order."""
    try:
        root = ElementTree.fromstring(text)
    except ElementTree.ParseError:
        return []
    return list(root.iter())


def _result_map_links(element, document: dict) -> list[tuple[str, str]]:
    """The `(column, select)` links a statement pulls in through `resultMap=`."""
    wanted = (element.get("resultMap") or "").strip()
    if not wanted:
        return []
    maps = document.get("result_maps") or {}
    namespace = document.get("namespace") or ""
    for key in (wanted, _statement_id(namespace, wanted), wanted.rsplit(".", 1)[-1]):
        if key in maps:
            return maps[key]
    return []


def _xml_statements(text: str, anchors: dict[str, tuple[str, str]] | None = None) -> list[tuple[int, str]]:
    """Statement bodies of one mapper XML, with their line numbers."""
    document = _xml_document(text)
    if document is None:
        return []
    fragments = document["fragments"]
    found: list[tuple[int, str]] = []
    # Elements arrive in document order, so the opening tag can be found by
    # searching forward from the previous one. That keeps the reported line honest
    # even when the body is reflowed, which a search for the body itself cannot do.
    cursor = 0
    for element in _xml_elements(text):
        local = _local(element.tag)
        if local.casefold() not in XML_TAGS:
            continue
        # itertext() would flatten `<if>`/`<foreach>`/`<where>`, but it cannot
        # expand `<include>` and it reads every `<choose>` branch at once.
        body = _collapse(_render(element, fragments))
        if local.casefold() == "sql" and not STATEMENT_START.match(body or ""):
            continue
        opening = re.compile(rf"<{local}\b", re.IGNORECASE)
        match = opening.search(text, cursor)
        if match:
            cursor = match.end()
            line = _line_of(text, match.start())
        else:
            line = 0
        if body:
            found.append((line, body))
        # A resultMap link is not SQL: the join only exists across two statements,
        # so it is written out here as the join the convention stands for.
        for column, target in _result_map_links(element, document):
            parent = _anchor(body)
            child = (anchors or {}).get(target)
            if not parent or not child:
                continue
            found.append(
                (
                    line,
                    f"select 1 from {parent[0]} join {child[0]} on {child[0]}.{child[1]} = {parent[0]}.{column}",
                )
            )
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
    report does not leak absolute paths into the audit log. When the statement
    spells out a schema (`from app.t_order`), `schema` carries it as a hint: the
    join is the same edge with or without it, so it never becomes part of what the
    edge is, only of where a reader can go and look.
    """
    found: list[dict] = []
    paths = list(_walk(Path(root), limit))
    # A `<association select="...">` names a statement that usually lives in
    # another file, so every mapper is read once to learn where its statements
    # point before any of them is turned into a join.
    anchors: dict[str, tuple[str, str]] = {}
    for path in paths:
        if path.suffix.casefold() != ".xml":
            continue
        text = _text(path)
        document = _xml_document(text or "") if text else None
        if document is None:
            continue
        namespace = document.get("namespace") or ""
        for key, element in (document.get("selects") or {}).items():
            anchor = _anchor(_collapse(_render(element, document["fragments"])))
            if anchor:
                anchors[_statement_id(namespace, key)] = anchor
    for path in paths:
        text = _text(path)
        if not text:
            continue
        try:
            relative = str(path.relative_to(root)).replace("\\", "/")
        except ValueError:
            relative = path.name
        entries = (
            _xml_statements(text, anchors) if path.suffix.casefold() == ".xml" else _java_statements(text)
        )
        for line, sql in entries:
            if len(found) >= limit:
                return found
            item = {"file": relative, "line": line, "sql": sql}
            hint = _schema_hint(sql)
            if hint:
                item["schema"] = hint
            found.append(item)
    return found
