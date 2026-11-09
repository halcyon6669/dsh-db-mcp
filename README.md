# dsh-db-mcp

[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/dsh-db-mcp.svg)](https://www.npmjs.com/package/dsh-db-mcp)
[![npm downloads](https://img.shields.io/npm/dm/dsh-db-mcp.svg?label=downloads%2Fmonth)](https://www.npmjs.com/package/dsh-db-mcp)
[![npm downloads total](https://img.shields.io/npm/dt/dsh-db-mcp.svg?label=downloads%20total)](https://www.npmjs.com/package/dsh-db-mcp)

English | [中文](README.zh.md)

A [DSH](https://github.com/deepseek-ai/deepseek-harness) plugin that hands your
databases to the agent. It adds a **Database** panel to the sidebar and publishes
every registered source as `mcp__db__*` tools.

**Zero configuration.** There is nothing to edit in DSH and no connection to type
twice: import the connections DBeaver already knows, then just ask.

## Zero configuration, in three senses

- **No DSH files.** The bundle patch inserts one Loader row. The plugin starts its
  own Python MCP server over stdio and registers the tools on the host `tools`
  service — no `dsh-mcp-client` row, no JSON to hand-edit, no env var to export.
- **No data source to fill in.** The importer reads `data-sources.json` from the
  DBeaver workspace and decrypts `credentials-config.json` with DBeaver's own key,
  so host, port, database, user and saved password arrive together. Ticking a box
  is the whole setup step.
- **No Python to prepare.** The panel finds an interpreter, creates the venv and
  installs the four driver packages from **Runtime → Install / repair
  dependencies**.

## Run

```sh
dsh plugin --profile desktop add dsh-db-mcp   # desktop app
dsh plugin --profile web add dsh-db-mcp       # web UI
```

`--profile` picks the profile to install into (`desktop` and `web` ship with DSH;
any other name is created on first use). Remove with
`dsh plugin --profile desktop remove dsh-db-mcp`.

Then:

1. Sidebar → **Database**.
2. **Import from DBeaver** → tick the connections → **Import selected**.
3. Ask the agent something like *"which tables does my Chinook database have?"*

A connection whose password was never saved shows **no password**; open the source
once and type it — it goes to `secrets.json` and never comes back to the page.

Prefer to start from scratch? **New data source** takes one connection string
(`postgresql://user:pw@host:5432/db`, a JDBC URL, an Oracle TNS descriptor or a
`.db` path) and fills the form from it.

## What the agent gets

| Tool | Purpose |
| ---- | ------- |
| `mcp__db__list_datasources` | registered sources: id, kind, target, read-only |
| `mcp__db__list_tables` | tables and views of a source |
| `mcp__db__describe_table` | columns, types, nullability, primary key |
| `mcp__db__sample_rows` | a few rows of a table |
| `mcp__db__execute_sql` | execute one statement — a query, or a write when that is allowed |
| `mcp__db__explain_query` | query plan |
| `mcp__db__get_ddl` | `CREATE TABLE` statement |
| `mcp__db__test_connection` | real login, `select 1`, server/user/schema |

`datasource` is optional on all of them: omitted, the default source is used.
Queries run **in the conversation**; the panel is for managing connections, not a
SQL console.

## Safety

- **Read-only by default**, with two independent gates: a global write switch and a
  per-source flag. Both must be open before a statement may write.
- **Passwords stay local.** They live in `secrets.json` (mode `0600`); no HTTP route
  ever returns one, and the Python child receives a short environment allowlist
  rather than the whole DSH environment.
- **Every tool call is audited** to `logs/audit.jsonl` — tool, source, duration, row
  count, SQL. Result rows are never logged.
- **Nothing runs from the panel except catalog reads.** The structure browser only
  forwards `list_tables` and `describe_table`.

## Documentation

| Document | Contents |
| -------- | -------- |
| [docs/guide.md](docs/guide.md) | Panel walkthrough, connection strings, groups, Docker test databases, troubleshooting |
| [docs/reference.md](docs/reference.md) | HTTP routes, tool contracts, registry and settings files, plugin config |
| [docs/development.md](docs/development.md) | Repository layout, hot reload, test suites, release flow |
| [docs/design-notes.md](docs/design-notes.md) | Historical design log (P1 → P7) and the decisions behind them |

## License

Apache License 2.0 — see [LICENSE](LICENSE).
