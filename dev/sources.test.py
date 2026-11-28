"""Regression tests for `server/sources.py`, the source-tree join scanner.

The bug this guards against: a project's joins live in mapper XML and MyBatis
annotations, never in the audit log, so a schema with no declared keys gets no
edges at all — even though the joins are written down in the repository.

The dangerous failure is the opposite one: a scanner that reads every string
literal turns log messages, regexes and column names into tables, and the walker
then follows joins that were never written. So most of these tests are about what
must *not* be picked up.

The scanner is pure (files in, statements out), so these tests need no database.
Run through `dev/engines.test.mjs`.
"""

from __future__ import annotations

import importlib.util
import tempfile
import unittest
from pathlib import Path

PACKAGE = Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location("db_mcp_sources", PACKAGE / "server" / "sources.py")
sources = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(sources)

SPEC_MINING = importlib.util.spec_from_file_location("db_mcp_mining_src", PACKAGE / "server" / "mining.py")
mining = importlib.util.module_from_spec(SPEC_MINING)
SPEC_MINING.loader.exec_module(mining)

MAPPER = """<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE mapper PUBLIC "-//mybatis.org//DTD Mapper 3.0//EN" "http://mybatis.org/dtd/mybatis-3-mapper.dtd">
<mapper namespace="demo.UserMapper">
  <select id="findOrders" resultType="map">
    select o.id, u.name
    from t_order o
    join t_user u on u.id = o.user_id
    <where>
      <if test="state != null">and o.state = #{state}</if>
    </where>
  </select>
  <sql id="lineJoin">
    select l.id from t_line l join t_order o on o.id = l.order_id
  </sql>
</mapper>
"""

JAVA = """package demo;

public interface UserMapper {
  @Select("select p.id from t_product p join t_category c on c.id = p.category_id")
  Object products();

  String MESSAGE = "this is not sql, and joins nothing";

  @Update({"update t_order set state = #{state}",
           "where id = #{id}"})
  int touch(Object o);
}
"""

WRAPPER = """package demo;

public class Repo {
  void go() {
    wrapper.apply("select * from t_a a join t_b b on b.id = a.b_id");
    wrapper.eq("id", 1);
  }
}
"""

GENERATED = """<mapper namespace="gen">
  <select id="g">select * from t_generated g join t_other o on o.id = g.other_id</select>
</mapper>
"""


class Scanner(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def _write(self, relative: str, body: str) -> Path:
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(body, encoding="utf-8")
        return path

    def _scan(self) -> list[dict]:
        return sources.statements(self.root)

    def _sql(self) -> list[str]:
        return [item["sql"] for item in self._scan()]

    def _pairs(self) -> list[set[tuple[str, str]]]:
        found = mining.statements_candidates(self._sql())
        return [{(item["left"]["table"], item["left"]["column"]), (item["right"]["table"], item["right"]["column"])} for item in found]


class MapperXml(Scanner):
    def test_a_join_inside_a_select_is_found(self):
        self._write("src/main/resources/mapper/UserMapper.xml", MAPPER)
        pairs = self._pairs()
        self.assertIn({("t_order", "user_id"), ("t_user", "id")}, pairs)

    def test_a_sql_fragment_counts_too(self):
        self._write("src/main/resources/mapper/UserMapper.xml", MAPPER)
        self.assertIn({("t_line", "order_id"), ("t_order", "id")}, self._pairs())

    def test_a_where_block_does_not_become_a_join(self):
        self._write("src/main/resources/mapper/UserMapper.xml", MAPPER)
        for pair in self._pairs():
            self.assertNotIn(("t_order", "state"), pair)

    def test_the_reported_line_points_at_the_statement(self):
        self._write("src/main/resources/mapper/UserMapper.xml", MAPPER)
        entries = [item for item in self._scan() if "t_user" in item["sql"]]
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0]["line"], 4, "the select opens on line 4")

    def test_the_file_is_relative_to_the_root(self):
        self._write("src/main/resources/mapper/UserMapper.xml", MAPPER)
        for item in self._scan():
            self.assertFalse(item["file"].startswith("C:"), item["file"])
            self.assertTrue(item["file"].startswith("src/main/resources/mapper/"), item["file"])

    def test_a_non_mapper_xml_is_ignored(self):
        self._write("src/main/resources/logback.xml", "<configuration><appender name='x'/></configuration>")
        self.assertEqual(self._scan(), [])

    def test_a_broken_mapper_does_not_raise(self):
        self._write("src/main/resources/mapper/Broken.xml", "<mapper namespace='x'><select>select 1</mapper>")
        self.assertEqual(self._scan(), [])


class Annotations(Scanner):
    def test_a_select_annotation_is_read(self):
        self._write("src/main/java/demo/UserMapper.java", JAVA)
        self.assertIn({("t_product", "category_id"), ("t_category", "id")}, self._pairs())

    def test_an_update_annotation_is_read(self):
        self._write("src/main/java/demo/UserMapper.java", JAVA)
        self.assertTrue(any(item["sql"].startswith("update t_order") for item in self._scan()))

    def test_an_array_of_literals_is_joined(self):
        self._write("src/main/java/demo/UserMapper.java", JAVA)
        joined = [item["sql"] for item in self._scan() if item["sql"].startswith("update t_order")]
        self.assertTrue(any("where id = #{id}" in sql for sql in joined), joined)

    def test_an_unrelated_string_literal_is_not_sql(self):
        self._write("src/main/java/demo/UserMapper.java", JAVA)
        for sql in self._sql():
            self.assertNotIn("this is not sql", sql)

    def test_a_wrapper_apply_is_read(self):
        self._write("src/main/java/demo/Repo.java", WRAPPER)
        self.assertIn({("t_a", "b_id"), ("t_b", "id")}, self._pairs())

    def test_a_wrapper_eq_is_not_read(self):
        self._write("src/main/java/demo/Repo.java", WRAPPER)
        for sql in self._sql():
            self.assertNotIn("eq", sql)


class Skipped(Scanner):
    def test_generated_output_is_skipped(self):
        self._write("build/generated/Gen.xml", GENERATED)
        self._write("target/classes/Gen.xml", GENERATED)
        self.assertEqual(self._scan(), [])

    def test_a_git_directory_is_skipped(self):
        self._write(".git/hooks/Gen.xml", GENERATED)
        self.assertEqual(self._scan(), [])

    def test_an_unrelated_suffix_is_skipped(self):
        self._write("src/main/resources/schema.sql", "select * from a join b on b.id = a.b_id")
        self.assertEqual(self._scan(), [])

    def test_a_file_without_joins_still_reports_its_statement(self):
        self._write("src/main/resources/mapper/Plain.xml", "<mapper namespace='x'><select id='a'>select 1</select></mapper>")
        self.assertEqual(len(self._scan()), 1)
        self.assertEqual(self._pairs(), [])

    def test_limit_caps_the_number_of_statements(self):
        for index in range(5):
            self._write(f"src/main/java/demo/M{index}.java", f'package demo;\nclass M{index} {{ @Select("select * from t{index}") void go(); }}')
        self.assertEqual(len(sources.statements(self.root, limit=2)), 2)


class CarriageReturns(Scanner):
    """CRLF files must scan exactly like LF ones.

    A Windows checkout with `core.autocrlf=true` hands every file to the reader
    with `\\r\\n`. Line-anchored regular expressions then match nothing, and the
    failure is silent: the project looks like it has no joins at all. The fix is
    `\\r?` before every anchor; this class is the alarm that rings if one loses it.
    """

    def _write_crlf(self, relative: str, body: str) -> Path:
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(body.replace("\n", "\r\n").encode("utf-8"))
        return path

    def test_a_crlf_mapper_yields_the_same_joins(self):
        self._write_crlf("src/main/resources/mapper/UserMapper.xml", MAPPER)
        pairs = self._pairs()
        self.assertIn({("t_order", "user_id"), ("t_user", "id")}, pairs)
        self.assertIn({("t_line", "order_id"), ("t_order", "id")}, pairs)

    def test_a_crlf_file_reports_the_line_the_statement_opens_on(self):
        self._write_crlf("src/main/resources/mapper/UserMapper.xml", MAPPER)
        entries = [item for item in self._scan() if "t_user" in item["sql"]]
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0]["line"], 4, "the select still opens on line 4")

    def test_a_crlf_java_annotation_yields_its_join(self):
        self._write_crlf("src/main/java/demo/UserMapper.java", JAVA)
        self.assertIn({("t_product", "category_id"), ("t_category", "id")}, self._pairs())

    def test_a_crlf_statement_carries_no_line_endings_into_sql(self):
        self._write_crlf("src/main/resources/mapper/UserMapper.xml", MAPPER)
        for sql in self._sql():
            self.assertNotIn("\r", sql)


class MissingRoot(unittest.TestCase):
    def test_a_root_that_does_not_exist_yields_nothing(self):
        self.assertEqual(sources.statements(Path(tempfile.gettempdir()) / "dbmcp-no-such-dir-xyz"), [])


if __name__ == "__main__":
    unittest.main()
