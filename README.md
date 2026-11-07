# dsh-db-mcp

[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

DSH plugin that adds a **Database** entry to the sidebar with a data-source
management panel, backed by a Python MCP server that lets the agent query those
databases through tools (not through the page).

- One panel for every engine: SQLite, PostgreSQL, MySQL, Oracle.
- One connection string fills the whole form; passwords never leave the machine
  and never come back to the page.
- Import the connections DBeaver already has, including its encrypted passwords.
- Read-only by default, with two independent write gates and an audit log.
- The agent gets seven MCP tools, not a SQL editor in the UI.

Requirements and staged plan: [`docs/requirements.md`](docs/requirements.md).

## What exists today (P7)

- **Host half** (`index.js` 鈫?`src/host.js`): a Cordis plugin serving
  `/plugins/db-mcp/api` from the DSH web server.
  | Route | Purpose |
  | ----- | ------- |
  | `GET /health` | plugin version, Host facts, Python discovery, runtime paths, registry state, MCP status, settings |
  | `GET /datasources` | registry, credentials projected away |
  | `GET /schema?datasource=鈥&table=鈥[&schema=鈥` | read-only structure: tables, or the columns of one table |
  | `GET /dbeaver/scan` | connections already configured in DBeaver |
  | `GET /mcp/status` | Python server phase, tool list, last error, stderr tail |
  | `GET /settings` 路 `POST /settings` | global write switch and audit switch |
  | `GET /audit?limit=N` | the tail of the tool-call audit log |
  | `GET /python/env` | interpreter, venv path, installed driver versions |
  | `POST /python/setup` | create the venv and `pip install -r server/requirements.txt` |
  | `POST /datasources/save` | create or update a source (`id` is immutable) |
  | `POST /datasources/delete` | remove a source and its stored secret |
  | `POST /datasources/test` | real login probe: SQLite over `node:sqlite`, the rest through the Python drivers |
  | `POST /dbeaver/import` | copy selected DBeaver connections into the registry |
  | `POST /mcp/start` 路 `POST /mcp/restart` | start or restart the Python MCP server |
  | `POST /mcp/call` | dev helper: call one MCP tool through the panel |
  | `POST /reload` | dev helper: re-import `src/host.js` without restarting DSH |
- **Client half** (`client.js`): sidebar entry (`db-mcp`, order 25) plus the main
  panel with the source list, the minimal create/edit form (one connection string),
  test/delete/default actions, a read-only *structure* browser, the DBeaver import
  flow, a *Restart MCP* button, the runtime diagnostics card (tool count, global
  write switch, venv and package versions with a one-click install) and an
  *audit log* card. Copy is localized (zh/en) through the client `locale` service.
- **Python server** (`server/`): `main.py` (FastMCP, seven tools), `engines.py`
  (per-engine connect/introspect/query), `store.py` (reads the registry).
  The plugin spawns it over stdio and publishes its tools as `mcp__db__*` on the
  host `tools` service 鈥?it does not go through a `dsh-mcp-client` Loader row.

### Tools the agent gets

| Tool | Purpose |
| ---- | ------- |
| `mcp__db__list_datasources` | the registered sources (id, kind, target, read-only) |
| `mcp__db__list_tables` | tables/views of one source |
| `mcp__db__describe_table` | columns, types, nullability, primary key |
| `mcp__db__sample_rows` | a few rows of one table |
| `mcp__db__run_query` | one statement; read-only sources refuse writes |
| `mcp__db__explain_query` | query plan |
| `mcp__db__get_ddl` | `CREATE TABLE` statement (SQLite: as created; others: rebuilt from the catalog) |
| `mcp__db__test_connection` | log in for real, run `select 1`, report server/user/schema |

`datasource` is optional everywhere: omitted, the default source is used.

### Python environment

Interpreter discovery order: plugin config `pythonPath` 鈫?`<DSH_HOME>/db-mcp/.venv/Scripts/python.exe` 鈫?that venv on POSIX 鈫?`python` 鈫?`python3`. Dependencies live in the runtime venv, not in the package:

    python -m venv C:\Users\<you>\.dsh\db-mcp\.venv
    C:\Users\<you>\.dsh\db-mcp\.venv\Scripts\python.exe -m pip install -r server\requirements.txt

`mcp` must stay on 1.x (2.x renamed `FastMCP` to `MCPServer`).

## Does the Test button really log in?

Yes. For PostgreSQL, MySQL and Oracle the panel's **Test** action calls
`mcp__db__test_connection` over the Python MCP server, so the probe is a real
authenticated login plus `select 1` (Oracle uses `select 1 from dual`). The
panel row then shows the server banner, the connected user and database, and how
long the login took, for example:

```
Oracle AI Database 26ai Free Release 23.26.3.0.0 路 DEMO@FREEPDB1 路 select 1 from dual ok
PostgreSQL 15.19 路 demo@demo 路 select version() ok
MySQL 8.0.46 路 demo@%@demo 路 select version() ok
```

A wrong password or an unreachable listener now surfaces the driver's own
message (`ORA-01017`, `DPY-6005`, `password authentication failed` 鈥? instead of
"port reachable". Testing an unsaved form works too: `test_connection` accepts
`kind` + `config` + `password` without writing the registry first. When the
Python server cannot start, the probe degrades to a TCP check and says so.

## Filling the form from one string

The create/edit form is deliberately as small as DBeaver's connection dialog:
**connection string**, **user**, **password** (with a *save password* box), and
that is it. Pasting a JDBC URL, a DSN, an Oracle TNS descriptor or a `.db` path
fills type, host, port, database/service, name and identifier; the derived values
only show up under **More settings**, together with schema, SID, SSL mode,
charset and the read-only switch.

Accepted shapes (see `dev/parse.test.mjs` for the full matrix):

```
postgresql://alice:secret@db.example.com:6543/orders?sslmode=require
jdbc:postgresql://localhost:5432/appdb
mysql://root:pw@127.0.0.1:3306/shop?charset=utf8mb4
jdbc:mariadb://10.0.0.5:3307/legacy
oracle://system:oracle@localhost:1521/XEPDB1
jdbc:oracle:thin:@//ora:1521/ORCLPDB1        # service name
jdbc:oracle:thin:@ora:1521:ORCL              # SID
(DESCRIPTION=(ADDRESS=(HOST=tns-host)(PORT=1522))(CONNECT_DATA=(SERVICE_NAME=svc1)))
jdbc:sqlite:C:\data\app.db
sqlite:///C:/data/chinook.db
C:\data\app.db          /  /var/lib/app.sqlite3
```

A password found inside the URL is sent once to `POST /datasources/save` and
then only stored in `secrets.json`; it is never echoed back.

Writes are `POST` only (the same-origin check compares `Origin` with `Host`).
Passwords never enter `datasources.json`; they live in `secrets.json` and are
never returned to the page (`hasSecret` is the only signal).

## DBeaver import

`GET /dbeaver/scan` looks for `data-sources.json` under
`%APPDATA%\DBeaverData\workspace*\General\.dbeaver\` (plus the `General` and
Linux/macOS layouts). When the sibling `credentials-config.json` exists it is
decrypted with DBeaver's built-in key (AES-128-CBC, zero IV, 16-byte prefix 鈥?see `Tatsh/dbeaver-creds`). A workspace that never saved passwords simply
imports the connection with an empty password, which the UI shows as
`no password`.

Connections created through the DBeaver driver dialog carry only a JDBC URL
(`configurationType: URL`) 鈥?no `database` field at all and no `user`. The
importer therefore parses `jdbc:mysql://host:port/db`,
`jdbc:postgresql://鈥 and `jdbc:oracle:thin:@鈥 for whatever the form fields
omit, and takes the user from the decrypted credentials when it is stored
there. The imported source is named after the DBeaver connection name (slugged
into an id), keeps `readOnly: true`, and gets the saved password copied into
`secrets.json`. Anything still missing is reported in `warnings`.

The panel navigates with breadcrumbs (`鏁版嵁搴?/ 鏂板缓鏁版嵁婧恅): the trailing step
is plain text, every earlier step is a link back, and no page needs a separate
"back to list" button.

## Test databases in Docker

Nothing has to be installed on the host; every engine below is a throwaway
container with a demo account (`demo` / `dbmcp-demo`).

```
# PostgreSQL 鈥?smallest and fastest to start, the recommended first target
docker run -d --name dbmcp-pg -p 5432:5432 \
  -e POSTGRES_USER=demo -e POSTGRES_PASSWORD=dbmcp-demo -e POSTGRES_DB=demo \
  postgres:15-alpine

# MySQL
docker run -d --name dbmcp-mysql -p 3306:3306 \
  -e MYSQL_USER=demo -e MYSQL_PASSWORD=dbmcp-demo -e MYSQL_DATABASE=demo \
  -e MYSQL_ROOT_PASSWORD=dbmcp-root mysql:8.0-debian

# Oracle Free 鈥?several GB, a minute or two to become healthy
docker run -d --name dbmcp-oracle -p 1521:1521 -e ORACLE_PASSWORD=dbmcp-demo \
  gvenzl/oracle-free:23-slim
```

On Windows, 1521 often falls inside a Hyper-V reserved port block and `docker run`
fails with *"An attempt was made to access a socket in a way forbidden by its
access permissions"*. Check `netsh interface ipv4 show excludedportrange
protocol=tcp` and publish another host port instead, e.g. `-p 11521:1521`; the
datasource then points at port 11521.

Then create a source in the panel with the matching connection string, e.g.
`postgresql://demo:dbmcp-demo@127.0.0.1:5432/demo`,
`mysql://demo:dbmcp-demo@127.0.0.1:3306/demo` or
`oracle://system:dbmcp-demo@127.0.0.1:1521/FREEPDB1`.

## Install into a profile

```
plugin_manager install_bundle  target=<absolute path to this directory>
```

The bundle patch (`cordis.patch.yml`) inserts one Loader row with id `db-mcp`.
The profile links this directory, so file edits are live; the Host module is
imported once per process, hence `POST /plugins/db-mcp/api/reload` (or an app
restart) after changing `src/host.js`.

## Panel layout

The page follows the same chrome as the other first-party panels:

- a masthead with **鈥?杩斿洖浼氳瘽** (closes the panel through `ctx.layout.selectPanel(null)`),
  the `鏁版嵁搴揱 title, and the connection/version pills;
- a tab row 鈥?**鏁版嵁婧?/ 杩愯鏃惰瘖鏂?/ 瀹¤鏃ュ織** 鈥?with the active tab underlined;
- the action bar under the tabs (new, import, refresh, restart MCP), which belongs
  to the first tab only.

Create, edit, import and structure are sub-views of the **鏁版嵁婧?* tab: the tab
stays active while the form is open, and both the tab and the `鈫?鏁版嵁婧恅 button
return to the list.

## Schema overview
The **Structure** button on a source row opens a read-only browser: the tables
(or views) of that source on the left, and the columns of the selected table on
the right 鈥?name, type, nullability, default value and primary-key marker. It is
served by `GET /schema`, which only forwards `list_tables` / `describe_table` to
the MCP server, so the page itself can never run SQL. Nothing is cached: each
open reads the live catalog.

## Groups and bulk actions

Every source carries an optional **group** label (`group` in the registry,
editable under *More settings*). The list renders one section per group, sorted by
name with the ungrouped sources last; a source with no group keeps the flat list
look until at least one group exists.

Tick the checkbox on a row to open the bulk bar: test all selected sources, flip
them to read-only or writable, move them into a group, or delete them (two-step
confirmation). Bulk work goes through `POST /datasources/bulk` with
`{ action: 'test' | 'readOnly' | 'group' | 'delete', ids: [...], 鈥?}`, so one
request does the whole batch and the response carries the refreshed list.

## Development

```
node dev/selftest.mjs     # mounts src/host.js on a throwaway port, 36 checks
node dev/shims.test.mjs   # mounts index.js, checks routes, /reload, tool publication
node dev/parse.test.mjs   # 24 checks: connection-string parser (DSN/JDBC/TNS/paths)
node dev/render.test.mjs  # 36 checks: components render with a stub React
node dev/i18n.test.mjs    # 12 checks: en/zh parity, no dead keys, no stray copy
node dev/p5.test.mjs      # 15 checks: settings, audit log, python environment
node dev/mcp.test.mjs     # 19 checks: real Python server over stdio, real SQLite + Oracle logins
```

`npm test` runs everything except `mcp.test.mjs`, which needs the venv and the
Oracle container. `node dev/bump.mjs 0.6.1` updates both version strings.

## Safety switches

Two independent gates decide whether a statement may write:

1. **Global switch** 鈥?`allowWrite` in `<runtime>/settings.json`, toggled from the
   diagnostics card. Off by default; while off every write statement is refused
   with `user_error` and a hint pointing at the switch.
2. **Per-source flag** 鈥?`readOnly` on the data source, on by default. A source
   stays read-only even when the global switch is on until you clear its flag.

The Python server reads the global flag from `DB_MCP_ALLOW_WRITE` at start-up; the
host restarts it whenever the switch flips. Read-only is also enforced by the
driver itself where the engine allows it (`mode=ro` for SQLite,
`default_transaction_read_only` for PostgreSQL, `SET SESSION TRANSACTION READ ONLY`
for MySQL).

## Audit log

Every MCP tool call appends one JSON line to `<runtime>/logs/audit.jsonl` (0600):
time, tool, source, duration, row count, the SQL truncated to 2000 characters and
the error when it failed. Result rows are never logged. The file rotates to
`audit.1.jsonl` at 512 KiB and logging can be turned off with `auditLog: false` in
`settings.json`. The panel shows the last dozen entries.

`dev/shims.test.mjs` also asserts that `package.json` has no UTF-8 BOM: the host
parses it with `JSON.parse`, which rejects a BOM, and the plugin then shows up as
`availability: missing` instead of loading. Editors that "add BOM" will break the
bundle silently 鈥?if the sidebar entry disappears after a restart, check this
first.

## Stage map

| Stage | Content |
| ----- | ------- |
| P1 | installable skeleton: sidebar entry, empty panel, Host health API (done) |
| P2 | data-source CRUD, connection test, DBeaver import (done) |
| P3 | Python MCP server, tools published as `mcp__db__*` (done) |
| P4 | PostgreSQL / MySQL / Oracle dialects (done) |
| P5 | diagnostics, one-click venv, reload, audit log, global write switch (done) |
| P6 | i18n polish and docs (done) |
| P7 | read-only schema overview (done) |

## License

Apache License 2.0 鈥?see [LICENSE](LICENSE).

## Runtime layout

```
$DSH_HOME/db-mcp/
  datasources.json   # profiles, never passwords, 0600
  secrets.json       # per-source password, 0600, Host-only
  settings.json      # global write switch + audit switch, 0600
  logs/mcp.log       # masked log
  logs/audit.jsonl   # one line per MCP tool call, rotates at 512 KiB
  .venv/             # plugin-local venv: mcp, psycopg, PyMySQL, oracledb
```
