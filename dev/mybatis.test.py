"""Regression tests for the MyBatis scan hardening, one class per promise.

Each class reads one committed fixture under `dev/fixtures/mybatis/`, so the
input a reader can inspect is exactly the input the scanner sees. The fixtures
are miniature Spring Boot trees: `src/main/resources/mapper/*.xml` and
`src/main/java/**/*.java`.

Two kinds of assertion live here:

* what the scan must find (a join written in a fragment, a comma join, an Oracle
  outer join, a subquery, a resultMap association);
* what it must not invent (a wrapper predicate is not a table, a schema prefix is
  a hint rather than part of the edge's identity, one `<choose>` is one join).

The scanner is pure, so nothing here needs a database. Run through
`dev/engines.test.mjs`.
"""

from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path

PACKAGE = Path(__file__).resolve().parent.parent
FIXTURES = PACKAGE / "dev" / "fixtures" / "mybatis"

SPEC = importlib.util.spec_from_file_location("db_mcp_sources_mybatis", PACKAGE / "server" / "sources.py")
sources = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(sources)

SPEC_MINING = importlib.util.spec_from_file_location("db_mcp_mining_mybatis", PACKAGE / "server" / "mining.py")
mining = importlib.util.module_from_spec(SPEC_MINING)
SPEC_MINING.loader.exec_module(mining)


def _pairs(folder: str) -> list[set[tuple[str, str]]]:
    """The canonical pairs the scanner reports for one fixture."""
    statements = sources.statements(FIXTURES / folder)
    found = mining.statements_candidates([item["sql"] for item in statements])
    return [
        {(item["left"]["table"], item["left"]["column"]), (item["right"]["table"], item["right"]["column"])}
        for item in found
    ]


def _counts(folder: str) -> dict[tuple[str, str, str, str], int]:
    """The canonical pairs with their occurrence counts."""
    statements = sources.statements(FIXTURES / folder)
    found = mining.statements_candidates([item["sql"] for item in statements])
    return {
        (
            item["left"]["table"],
            item["left"]["column"],
            item["right"]["table"],
            item["right"]["column"],
        ): item["hits"]
        for item in found
    }


def _statements(folder: str) -> list[dict]:
    return sources.statements(FIXTURES / folder)


class XmlDynamicSql(unittest.TestCase):
    """`<include refid>`, `<if>`/`<where>`/`<foreach>`/`<choose>`, `${}` and `#{}`."""

    def test_a_fragment_pulled_in_by_include_joins_its_tables(self):
        self.assertIn({("t_line", "order_id"), ("t_order", "id")}, _pairs("xml-dynamic"))

    def test_a_join_inside_a_where_block_is_found(self):
        self.assertIn({("t_order", "payment_id"), ("t_payment", "id")}, _pairs("xml-dynamic"))

    def test_one_choose_is_one_join_not_one_per_branch(self):
        counts = _counts("xml-dynamic")
        region = [
            hits
            for key, hits in counts.items()
            if {key[0], key[2]} == {"t_order", "t_region"}
        ]
        self.assertEqual(region, [1], "both branches spell the same join")

    def test_placeholders_do_not_break_the_statement(self):
        # `#{}` and `${}` are MyBatis syntax, not SQL: they must survive into the
        # text (a reader can see what was bound) without stopping the parse. The
        # statement carrying both still yields its join.
        carrying = [item for item in _statements("xml-dynamic") if "${sort}" in item["sql"]]
        self.assertEqual(len(carrying), 1)
        self.assertIn("#{code}", carrying[0]["sql"])
        self.assertIn({("t_order", "payment_id"), ("t_payment", "id")}, _pairs("xml-dynamic"))

    def test_the_fragment_alone_does_not_become_a_statement_of_its_own(self):
        for item in _statements("xml-dynamic"):
            self.assertTrue(item["sql"].lower().startswith(("select", "insert", "update", "delete")), item["sql"])


class JoinShapes(unittest.TestCase):
    """Comma joins with WHERE, Oracle `(+)`, `IN (SELECT ...)`, `EXISTS (...)`."""

    def test_a_comma_join_with_a_where_clause_is_found(self):
        pairs = _pairs("joins")
        self.assertIn({("t_shipment", "customer_code"), ("t_customer", "code")}, pairs)
        self.assertIn({("t_shipment", "warehouse_id"), ("t_warehouse", "id")}, pairs)

    def test_an_oracle_outer_join_marker_is_not_part_of_the_column(self):
        self.assertIn({("t_order", "order_no"), ("t_payment", "order_no")}, _pairs("joins"))

    def test_an_in_subquery_join_is_found(self):
        self.assertIn({("t_line", "order_id"), ("t_order", "id")}, _pairs("joins"))

    def test_an_exists_subquery_join_is_found(self):
        self.assertIn({("t_order", "order_no"), ("t_refund", "order_no")}, _pairs("joins"))

    def test_an_aliased_join_still_resolves_its_aliases(self):
        pairs = _pairs("joins")
        self.assertIn({("t_order", "id"), ("t_trans", "order_id")}, pairs)
        self.assertIn({("t_customer", "code"), ("t_order", "customer_code")}, pairs)


class ResultMapLinks(unittest.TestCase):
    """`<association column= select=>` and `<collection column= select=>`."""

    def test_an_association_column_and_its_select_make_one_join(self):
        self.assertIn({("t_customer", "code"), ("t_order", "customer_code")}, _pairs("resultmap"))

    def test_a_collection_column_and_its_select_make_one_join(self):
        self.assertIn({("t_line", "order_id"), ("t_order", "id")}, _pairs("resultmap"))

    def test_a_nested_association_without_a_select_invents_nothing(self):
        pairs = _pairs("resultmap")
        self.assertNotIn({("t_order", "region_id"), ("t_region", "id")}, pairs)


class Annotations(unittest.TestCase):
    """`@Select` concatenation and the array form."""

    def test_a_multi_line_concatenation_is_one_statement(self):
        joined = [item["sql"] for item in _statements("annotations") if "t_line" in item["sql"]]
        self.assertEqual(len(joined), 1, joined)
        self.assertIn("where o.code", joined[0])

    def test_an_array_form_is_one_statement(self):
        joined = [item["sql"] for item in _statements("annotations") if "t_payment" in item["sql"]]
        self.assertEqual(len(joined), 1, joined)

    def test_the_two_joins_are_found(self):
        pairs = _pairs("annotations")
        self.assertIn({("t_line", "order_id"), ("t_order", "id")}, pairs)
        self.assertIn({("t_order", "order_no"), ("t_payment", "order_no")}, pairs)

    def test_a_string_constant_is_not_a_statement(self):
        for item in _statements("annotations"):
            self.assertNotIn("t_not_a_real_table", item["sql"])


class Identifiers(unittest.TestCase):
    """Case-insensitive table names; a schema is a hint, not part of the edge."""

    def test_a_table_written_in_upper_case_is_the_same_table(self):
        self.assertIn({("t_line", "order_id"), ("t_order", "id")}, _pairs("identifiers"))

    def test_a_schema_prefix_does_not_split_the_edge(self):
        counts = _counts("identifiers")
        payment = [hits for key, hits in counts.items() if {key[0], key[2]} == {"t_order", "t_payment"}]
        self.assertEqual(payment, [2], "app.t_order and t_order are one edge")

    def test_the_schema_is_kept_as_a_hint(self):
        hints = [item.get("schema") for item in _statements("identifiers") if "app." in item["sql"]]
        self.assertTrue(hints, "the statement that names a schema should carry the hint")
        self.assertEqual({hint for hint in hints if hint}, {"app"})


class Evidence(unittest.TestCase):
    """Every edge keeps the `file:line` places it was read from."""

    def test_the_same_join_written_twice_keeps_both_places(self):
        places: dict[tuple[str, str, str, str], list[str]] = {}
        for item in _statements("evidence"):
            for left, right in mining._joins(item["sql"]):
                key = mining._key(left, right)
                spot = f"{item['file']}:{item['line']}"
                bucket = places.setdefault(key, [])
                if spot not in bucket:
                    bucket.append(spot)
        wanted = [spots for key, spots in places.items() if {key[0], key[2]} == {"t_order", "t_line"}]
        self.assertEqual(len(wanted), 1)
        self.assertEqual(len(wanted[0]), 2, wanted)

    def test_a_place_names_the_file_and_the_line(self):
        for item in _statements("evidence"):
            self.assertRegex(f"{item['file']}:{item['line']}", r"^src/main/resources/mapper/EvidenceMapper\.xml:\d+$")


class Wrappers(unittest.TestCase):
    """A wrapper predicate is not a join; a wrapper fragment that holds SQL is."""

    def test_a_predicate_chain_is_not_read(self):
        for item in _statements("wrappers"):
            self.assertNotIn("eq(", item["sql"])
            self.assertNotIn("orderByDesc", item["sql"])

    def test_an_apply_fragment_is_read(self):
        self.assertIn({("t_line", "order_id"), ("t_order", "id")}, _pairs("wrappers"))


if __name__ == "__main__":
    unittest.main()
