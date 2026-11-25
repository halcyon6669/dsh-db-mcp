"""Mine the audit log for joins someone actually wrote.

`discover_relations` can only import what the engine declares, and plenty of
schemas declare nothing. But a person (or a model) who already wrote
`... join t_trans t on t.order_id = o.id` has told us the join exists — the audit
log keeps that statement, so it is the cheapest source of real evidence there is.

This module is deliberately only a parser: it turns statements into candidate
column pairs and nothing else. Deciding which side is the child needs the
catalog, so that happens in `main.mine_relations`, and the result is imported as
`pending` like any other guess. Nothing here is trusted on sight — a statement
in a log is evidence that someone believed the join, not proof that it holds.

Only `execute_sql` and `explain_query` lines are read: those are the tools whose
`sql` argument is a statement. No row data is involved, and no statement is ever
run again.
"""

from __future__ import annotations

import re

# Words that can follow a table name without being an alias. Anything here ends
# the alias slot, so `from t_order where ...` does not read `where` as an alias.
RESERVED = frozenset(
    """
    on where join inner left right full outer cross natural using group order having
    limit offset union except intersect select from as and or not null is in like
    between case when then else end fetch first next rows row only for update set
    values with returning into
    """.split()
)

# Longest first, so `outer` wins over a hypothetical `out`.
_RESERVED_ALT = "|".join(sorted(RESERVED, key=lambda word: (-len(word), word)))

# One identifier, with the quoting any dialect may use around it.
_IDENT = r"[`\"\[]?[A-Za-z_][\w$#]*[`\"\]]?"

# A table reference, optionally schema-qualified.
_TABLE = rf"{_IDENT}(?:\.{_IDENT})?"

TABLE_REF = re.compile(
    rf"\b(from|join)\s+({_TABLE})"
    # The alias slot must not swallow the next keyword: without the lookahead,
    # `from a join b` reads `join` as a's alias and the join itself is lost.
    rf"(?:\s+(?:as\s+)?((?!{_RESERVED_ALT}\b){_IDENT}))?",
    re.IGNORECASE,
)

# `a.col = b.col`, `a.col = col` and `col = b.col`. Both sides end up as
# (qualifier or "", column) so the alias map can resolve them.
EQUALITY = re.compile(
    rf"(?<![\w$.])(?:({_IDENT})\.)?({_IDENT})\s*=\s*"
    rf"(?:({_IDENT})\.)?({_IDENT})(?![\w$.(])",
)

# The on-clause ends at the next clause keyword. An equality after `where` is a
# filter, not the join condition, and must not be mined as one.
CLAUSE_END = re.compile(
    r"\b(where|group|order|having|limit|offset|union|except|intersect|join|inner|left|right|full|cross|natural|using)\b",
    re.IGNORECASE,
)

# A statement is only interesting if it joins something.
JOIN_WORDS = re.compile(r"\bjoin\b", re.IGNORECASE)


def _clean(name: str) -> str:
    """Drop quoting and any schema prefix: `"public"."t_order"` -> `t_order`."""
    text = (name or "").strip().strip('"`[]')
    if "." in text:
        text = text.rsplit(".", 1)[-1]
    return text.strip().strip('"`[]')


def _alias_map(statement: str) -> dict[str, str]:
    """Which alias means which table, from the `from` and `join` clauses."""
    found: dict[str, str] = {}
    for match in TABLE_REF.finditer(statement):
        table = _clean(match.group(2))
        if not table:
            continue
        alias = _clean(match.group(3) or "")
        if alias and alias.casefold() not in RESERVED:
            found[alias.casefold()] = table
        found.setdefault(table.casefold(), table)
    return found


def _side(qualifier: str, column: str, aliases: dict[str, str], tables: set[str]) -> dict | None:
    """Resolve one operand of an equality to a table and column."""
    name = _clean(column)
    if not name:
        return None
    key = _clean(qualifier).casefold()
    if key:
        table = aliases.get(key)
        if not table:
            return None
        return {"table": table, "column": name}
    # An unqualified column is only usable when the statement has one table it
    # could belong to; guessing among several would invent a join.
    if len(tables) != 1:
        return None
    return {"table": next(iter(tables)), "column": name}


def _on_clause(statement: str, start: int, end: int) -> str | None:
    """The text after `on` in one join, cut at the next clause keyword."""
    clause = statement[start:end]
    on = re.search(r"\bon\b", clause, re.IGNORECASE)
    if not on:
        return None
    rest = clause[on.end() :]
    stop = CLAUSE_END.search(rest)
    if stop:
        rest = rest[: stop.start()]
    return rest


def _joins(statement: str) -> list[tuple[dict, dict]]:
    """Every equality between two different tables in this statement's joins."""
    aliases = _alias_map(statement)
    tables = set(aliases.values())
    if len(tables) < 2:
        return []
    pairs: list[tuple[dict, dict]] = []
    matches = list(TABLE_REF.finditer(statement))
    for position, match in enumerate(matches):
        if match.group(1).casefold() != "join":
            continue
        end = matches[position + 1].start() if position + 1 < len(matches) else len(statement)
        rest = _on_clause(statement, match.end(), end)
        if not rest:
            continue
        for equality in EQUALITY.finditer(rest):
            left = _side(equality.group(1) or "", equality.group(2), aliases, tables)
            right = _side(equality.group(3) or "", equality.group(4), aliases, tables)
            if not left or not right:
                continue
            if left["table"].casefold() == right["table"].casefold():
                continue
            pairs.append((left, right))
    return pairs


def _key(left: dict, right: dict) -> tuple[str, str, str, str]:
    """A spelling-independent key, so `a.b = c.d` and `c.d = a.b` are one pair."""
    one = (left["table"].casefold(), left["column"].casefold())
    two = (right["table"].casefold(), right["column"].casefold())
    if two < one:
        one, two = two, one
    return one[0], one[1], two[0], two[1]


def _rank(seen: dict[tuple[str, str, str, str], int], limit: int) -> list[dict]:
    """The counted pairs, most frequent first, in the shape every caller expects."""
    ordered = sorted(seen.items(), key=lambda item: (-item[1], item[0]))
    mined: list[dict] = []
    for (ltable, lcolumn, rtable, rcolumn), hits in ordered[: max(1, limit)]:
        mined.append(
            {
                "left": {"table": ltable, "column": lcolumn},
                "right": {"table": rtable, "column": rcolumn},
                "hits": hits,
            }
        )
    return mined


def statements_candidates(statements, limit: int = 500) -> list[dict]:
    """Candidate column pairs mined from statements that were never run.

    The source-tree scanner feeds this: a mapper XML or an `@Select` holds SQL
    nobody has executed yet, but it is still a person's statement that the join
    exists. Everything else is the same as `candidates` — pairs are counted and
    returned in a canonical order, because the child side is the catalog's call.
    """
    seen: dict[tuple[str, str, str, str], int] = {}
    for sql in statements:
        if not isinstance(sql, str) or not JOIN_WORDS.search(sql):
            continue
        for left, right in _joins(sql):
            key = _key(left, right)
            seen[key] = seen.get(key, 0) + 1
    return _rank(seen, limit)


def candidates(rows, datasources=(), include_anonymous: bool = False, limit: int = 500) -> list[dict]:
    """Candidate column pairs mined from audit lines.

    `rows` are parsed audit records. `datasources` limits the scan to the keys of
    one datasource (its id and name); an empty sequence scans everything, which is
    only useful when the log holds a single source.

    `include_anonymous` keeps the lines that named no datasource. Those ran against
    whatever the registry calls the default, so the caller may only pass True when
    the source being mined is that one; otherwise a statement against another
    database would be attributed to this graph.

    Each candidate counts how many statements showed the same pair, so a join
    written a hundred times ranks above one written once. The two sides come back
    in a canonical order (by table, then column), because which side is the child
    is a question for the catalog, not for the way someone happened to spell the
    equality.
    """
    wanted = {str(item).casefold() for item in datasources if item}
    seen: dict[tuple[str, str, str, str], int] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        if row.get("tool") not in ("mcp__db__execute_sql", "mcp__db__explain_query"):
            continue
        owner = row.get("datasource")
        if not isinstance(owner, str) or not owner.strip():
            if not include_anonymous:
                continue
        elif wanted and owner.strip().casefold() not in wanted:
            continue
        sql = row.get("sql")
        if not isinstance(sql, str) or not JOIN_WORDS.search(sql):
            continue
        for left, right in _joins(sql):
            key = _key(left, right)
            seen[key] = seen.get(key, 0) + 1
    return _rank(seen, limit)
