English | [中文](guide.zh.md)

# Guide

Everything the panel can do, in the order you meet it. For the wire protocol and
file formats see [reference.md](reference.md); for build and release see
[development.md](development.md).

## The whole path, on one page

You set connections up on the panel side (left); the conversation does the
querying (right). The only hand-off is a data source that exists.

![The path from a DBeaver connection to an answer in chat](../asset/usage-guide.en.png)

## Install and upgrade

`dsh plugin` forwards its arguments to pnpm inside the profile directory, so it
needs `--profile` before the pnpm verb:

```sh
dsh plugin --profile desktop add dsh-db-mcp     # fresh install, desktop app
dsh plugin --profile web add dsh-db-mcp         # the web UI's profile
dsh plugin --profile desktop add dsh-db-mcp@0.8.0     # pin a version
dsh plugin --profile desktop remove dsh-db-mcp         # uninstall
dsh plugin --profile desktop why dsh-db-mcp            # which version is installed
```

`desktop` and `web` ship with DSH; any other name is initialized on first use
(`--profile scratch add dsh-db-mcp`). Check what a profile has with
`dsh plugin --profile desktop list dsh-db-mcp`.

From a source checkout, install the directory instead — the profile then links it,
so edits are live:

```sh
dsh plugin --profile desktop add C:\path\to\dsh-db-mcp
```

Three things to know about upgrades:

- pnpm caches a package's metadata. A version published minutes ago may be
  invisible to the dist-tag; naming the version sidesteps it.
- pnpm holds new releases behind a cooldown (`minimumReleaseAge`, 1440 minutes by
  default) so a freshly published — possibly compromised — version is not resolved
  automatically. Asking for an exact version makes pnpm record that version in
  `minimumReleaseAgeExclude` inside the profile's `pnpm-workspace.yaml`; that is the
  `Added 1 entry to minimumReleaseAgeExclude …` line you will see. Nothing is broken:
  the exclusion is per version and only lets *that* pin through. To be asked instead,
  set `minimumReleaseAgeStrict: true` in the profile's `pnpm-workspace.yaml`; to drop
  stale entries, set `minimumReleaseAgeExcludePrune: true`.
- Upgrading needs either an exact version or a removed lock entry: `add` will not
  move a dependency that still satisfies its existing range.

If the sidebar entry disappears after a restart, see [Troubleshooting](#troubleshooting).

## The panel

Sidebar → **Database**. The masthead carries **‹ Back to chat**, the title, and the
connection and version pills. Below it, five tabs:

| Tab | What it does |
| ---- | ------------ |
| Data source list | the registry: health strip, search, group chips, rows grouped by label, bulk actions, refresh |
| New data source | one connection string, user, password; also used for editing |
| Import from DBeaver | scan, tick, import |
| Runtime | Host facts, tool count, global write switch, venv and driver versions |
| Audit log | the last dozen tool calls, converted to your time zone |

**New data source** and **Import from DBeaver** swap only the card under the tabs —
the masthead and tabs stay put, and every earlier step is still a tab away.

The list opens with a status strip: whether the MCP bridge is up, the total number of
sources, how many probed healthy, and which ones failed (with their names), with the
search box on the right of that first row. Filter chips — **All**, one chip per group,
**Ungrouped** and **Only failures** — take the second row. The box matches the name,
identifier, host, kind and the last probe message; chips and the box narrow the list
together, and a failed source keeps its red row and an expandable **Error details**
block either way.

Under each source's connection target sits its identifier as a chip labelled **ID**:
that is the value every MCP tool takes as its `datasource` argument, so it is shown as
a handle of its own rather than buried at the end of the target line. Click the chip
to copy the bare identifier and paste it into chat ("query the `chinook` source"), or
hover it to see the full value when it is too long for the row.

## Adding a source

The form is as small as DBeaver's connection dialog: **connection string**, **user**,
**password** (with a *save password* box). The string field is marked *smart parsing*
and fills type, host, port, database/service, name and identifier as you paste. The
derived values only appear under **More settings** — name, group and identifier in one
row, then the engine, the connection fields and the read-only switch.

The connection string, the user and the password are required for every engine but
SQLite (which needs only the file): saving with one of them empty stops at the form,
marks the empty field in red and leaves your typing alone. **Test** sits next to
**Save** and runs the login without saving anything, reporting the result above the
buttons. Editing an existing source may leave the password empty — that keeps the
stored one.

One endpoint may exist only once: the same host, port, database and user (SQLite: the
same file) cannot be added twice. A second attempt comes back as `409` and names the
row that already holds it, so the agent never sees two indistinguishable sources. The
import screen enforces the same rule.

The footer repeats where a saved source goes: it is live in the panel at once and
registered with the local MCP server, so the agent can use it without a restart.

Accepted shapes — a DSN, a JDBC URL, an Oracle TNS descriptor, a JDBC thin
descriptor, or a bare database file:

```
postgresql://alice:secret@db.example.com:6543/orders?sslmode=require
jdbc:postgresql://localhost:5432/appdb
mysql://root:pw@127.0.0.1:3306/shop?charset=utf8mb4
jdbc:mariadb://10.0.0.5:3307/legacy
oracle://system:oracle@localhost:1521/XEPDB1
jdbc:oracle:thin:@//ora:1521/ORCLPDB1        # service name
jdbc:oracle:thin:@ora:1521:ORCL              # SID
(DESCRIPTION=(ADDRESS=(HOST=tns-host)(PORT=1522))(CONNECT_DATA=(SERVICE_NAME=svc1)))
jdbc:oracle:thin:@(DESCRIPTION_LIST=(DESCRIPTION=(ADDRESS_LIST=(ADDRESS=(PROTOCOL=TCP)(HOST=rac-1)(PORT=1521)))(CONNECT_DATA=(SERVICE_NAME=ORCLPDB1))))
jdbc:opengauss://h1:30100,h2:30100,h3:30100/demo?targetServerType=master
jdbc:sqlite:C:\data\app.db
sqlite:///C:/data/chinook.db
C:\data\app.db
/var/lib/app.sqlite3
```

A password found inside the URL is sent once and then only stored; it is never
echoed back. URL separators inside a password are fine too: `#`, `?` and `/`
survive, and `#` works both literally and as `%23`. `id` is immutable once
created — rename the *display name* instead (double-click the name on a row).

openGauss and GaussDB are their own kind: their SHA256 authentication is outside
what libpq negotiates, so the server talks to them with the pure-Python
`py_opengauss` driver (installed with the other Python dependencies) and falls
back to psycopg only for clusters that still use md5. Paste the cluster URL and
every node is kept, in order — the panel shows `h1 +2:30100`. The structure page
leaves out the `BIN$…` tables a cluster keeps in its recycle bin.

## Importing from DBeaver

The importer looks for `data-sources.json` under
`%APPDATA%\DBeaverData\workspace*\General\.dbeaver\`, plus the `General` and
Linux/macOS layouts. When the sibling `credentials-config.json` exists it is
decrypted with DBeaver's built-in key (AES-128-CBC, zero IV, 16-byte prefix — see
[Tatsh/dbeaver-creds](https://github.com/Tatsh/dbeaver-creds)). Ticked entries are
copied into the registry, their passwords into `secrets.json`.

A few details make real DBeaver workspaces work:

- Connections created through the driver dialog often carry only a JDBC URL
  (`configurationType: URL`) with no `database` field and no `user`. The importer
  parses the URL for whatever the form fields omit and takes the user from the
  decrypted credentials.
- openGauss/GaussDB entries added with a driver jar are filed as `generic` in
  `data-sources.json`; the importer recognises them from the `jdbc:opengauss:` /
  `jdbc:gaussdb:` scheme instead of reporting `unsupported provider: generic`.
- A connection already configured is not offered twice. Sources are identified by
  kind + host + port + database/service/SID + user (SQLite by file path); a match
  comes back as `alreadyImported`, the checkbox is disabled and the row says
  *already added as …*. Calling the import route directly does not bypass this: the
  entry lands in `skipped` instead.
- The list has a filter box (name, host or user) and a bar pinned to the top of the
  view, so *Import selected* stays in reach however long the workspace is.

A workspace that never saved passwords is fine: the connection is imported with an
empty password and the row shows **no password**. Fill it in once and it stays.

## Testing a connection

**Test** performs a real login: SQLite is opened read-only through `node:sqlite`,
the other engines go through the Python drivers, which authenticate and run
`select 1` (Oracle: `select 1 from dual`). The row then shows the banner, the user
and database, and how long the login took:

```
Oracle AI Database 26ai Free Release 23.26.3.0.0 · DEMO@FREEPDB1 · select 1 from dual ok
PostgreSQL 15.19 · demo@demo · select version() ok
MySQL 8.0.46 · demo@%@demo · select version() ok
```

Wrong passwords now surface the driver's own message (`ORA-01017`, `DPY-6005`,
`password authentication failed`) instead of "port reachable". An unsaved form can
be tested too. When the Python server cannot start, the probe degrades to a TCP
check and says so.

A failing row keeps the message inline — expand it with `⌄` for the raw driver
text, or press **Copy** to put the whole report on the clipboard:

```
datasource: mysql
id: mysql
kind: mysql
target: 127.0.0.1:3306/demo
at: 2026-11-09 21:41:06 UTC+08:00
error: MySQL connection failed: (2003, "Can't connect to MySQL server on '127.0.0.1' …")
plugin: dsh-db-mcp 0.8.0
```

The panel does not repeat probe failures in the banner above the tabs — that strip
is for panel operations such as saving, deleting or installing dependencies.

## Groups and bulk actions

Every source carries an optional **group** label, editable under *More settings*.

- **Create** — type a name in **New group**.
- **Rename** — double-click the group name; **delete** drops the label from its
  members.
- **Collapse** — the triangle next to the group name folds the section; an empty group
  stays visible as a drop target.
- **Move** — drag a source row onto a group, or onto **Ungrouped** to clear it.
- **Reorder** — drag a row onto another row: the top half of the target puts it before,
  the bottom half after. Dropping across groups re-groups and repositions in one go.
- **Rename a source** — double-click its name; the id never changes.
- **Select** — each group header has a select-all box, so grouped sources join bulk
  work exactly like loose ones. A row itself is selected by its checkbox (the row body
  no longer toggles, so double-click stays free for renaming).

With a selection made, the bulk bar can test, flip read-only, move into a group, or
delete (two-step confirmation).

## Structure browser

**Structure** on a source row opens a read-only view: tables and views on the left,
columns of the selected table on the right (name, type, nullability, default,
primary-key marker). Tables are grouped by schema and each group folds open and
closed; the filter box above the tree matches table names and schema names. The
controller sends the table's schema along with its name, so two tables with the
same name in different schemas stay distinct. It is served by `GET /schema`,
which only forwards `list_tables` / `describe_table` to the MCP server — the page
cannot run SQL, and nothing is cached. The header row keeps the way back to the
list, the connection target and the same identifier chip, so the handle the agent
needs is in view while you read the tables.

## Safety switches

Two independent gates decide whether a statement may write:

1. **Global switch** — `allowWrite` in `<runtime>/settings.json`, toggled on the
   *Runtime* tab. Off by default; while off every write is refused with
   `user_error` and a hint pointing at the switch.
2. **Per-source flag** — `readOnly` on the source, on by default. Click the
   *read-only* / *writable* pill on a row to flip it in one click; the pill turns
   amber while that source accepts writes.

The Python server reads the global flag at start-up and the host restarts it
whenever the switch flips. Read-only is enforced again at the driver where the
engine allows it (`mode=ro` for SQLite, `default_transaction_read_only` for
PostgreSQL, `SET SESSION TRANSACTION READ ONLY` for MySQL).

## Limiting one conversation

A conversation can be narrowed to a subset of sources. Ask the assistant in plain
words — *"in this conversation only use pg-demo and oracle-demo"* — and it calls the
`mcp__db__session_scope` tool with those identifiers. Nothing new to fill in, no file
to edit; the identifiers are the ones the list shows under each name.

While a limit is saved for that conversation:

- `list_datasources` only returns the allowed rows;
- a call that names another source is refused with `user_error`;
- a call that leaves `datasource` out either uses the single allowed source or
  reports which identifiers are available;
- `test_connection` cannot be used with an inline connection string, because that
  would go around the list.

Say *"stop limiting this conversation"* (or call the tool with `all: true`) and the
limit is removed. Conversations with no saved limit keep access to every source, and
the *Runtime* tab lists the conversations that are limited so you can see it at a
glance. The limit is a per-conversation convenience, not a security boundary: the
files under the runtime directory stay readable by your account.

## Connect another agent

The Python server speaks MCP over stdio, so DSH is only one of the clients that can
use it. The **Connect** tab in the panel shows the address other agents can point at
and writes their configuration for you.

The endpoint is `http://127.0.0.1:8765/dsh-db-mcp` by default. It starts with the plugin, the
port can be changed in that tab, and the address has a copy button. If Windows refuses
the preferred port, the server moves to the next free one and the tab shows where it
landed.

One click writes the entry into each client's own configuration file:

| Client | File | What is written |
| --- | --- | --- |
| Visual Studio Code | `%APPDATA%\Code\User\mcp.json` | HTTP entry under `servers` |
| VS Code Insiders | `%APPDATA%\Code - Insiders\User\mcp.json` | HTTP entry under `servers` |
| Cursor | `~/.cursor/mcp.json` | HTTP entry under `mcpServers` |
| Claude Code | `~/.claude.json` | HTTP entry under `mcpServers` |
| Claude Desktop | `%APPDATA%\Claude\claude_desktop_config.json` | stdio entry (python + `server/main.py`) |
| Codex CLI | `~/.codex/config.toml` | `[mcp_servers.dsh-db-mcp]` stdio entry |

Claude Desktop and Codex get a stdio entry instead of a URL because that form needs no
listening port; the other three take the HTTP address so they always see the same
process the panel manages. Every client reads the same `datasources.json` and
`secrets.json`, so a source added in the panel shows up everywhere without a restart
of the client — only of the MCP server itself.

Two things are DSH-only and are **not** available to those clients: the audit log
(written by the plugin's host half) and the per-conversation limit (it keys off the
DSH conversation id). Read-only enforcement still applies, because it lives in Python.

The **Tools** tab shows **Tools the agent sees** — one row per tool with
a checkbox. Unchecking a tool stops the plugin from publishing it, so the model never
sees it; the Python server still offers it over stdio/HTTP, which means the switch trims
the DSH agent's tool list rather than the database's capabilities. `mcp__db__session_scope`
is not on the list: switching it off would strand a conversation that already has a limit.

Two rows carry a small number box: `sample_rows` and `execute_sql`. It is the row count the
agent gets when it does not ask for one (`20` and `200` out of the box, capped at `200` and
`2000`). The model can still pass a larger number up to that cap, so this is a default, not
a hard limit — the hard cap lives in the Python server (`DB_MCP_MAX_ROWS_HARD`).

To run the server yourself, `server/main.py` accepts `--stdio` (default), `--http`,
`--sse`, `--host`, `--port` and `--path` (the streamable-HTTP path, `/dsh-db-mcp` by
default), and the same values through `DB_MCP_TRANSPORT`, `DB_MCP_HOST`, `DB_MCP_PORT`
and `DB_MCP_PATH`.

## Audit log

Every MCP tool call appends one JSON line to `<runtime>/logs/audit.jsonl` (0600):
time, tool, source, duration, row count, the SQL truncated to 2000 characters, and
the error when it failed. Result rows are never logged. The file rotates to
`audit.1.jsonl` at 512 KiB and logging can be switched off with `auditLog: false`.

The panel shows the last dozen entries **on your own clock**, date included, so a
call from yesterday is not mistaken for one from an hour ago; the file keeps UTC so
it stays comparable across machines. Each stamp carries the same instant with its
zone in the tooltip.

## Runtime layout

```
$DSH_HOME/db-mcp/
  datasources.json   # sources and groups, never passwords, 0600
  secrets.json       # per-source password, 0600, Host-only
  settings.json      # global write switch + audit switch, 0600
  sessions.json      # per-conversation source limits, 0600
  logs/mcp.log       # masked log
  logs/audit.jsonl   # one line per MCP tool call, rotates at 512 KiB
  .venv/             # plugin-local venv: mcp, psycopg, py-opengauss, PyMySQL, oracledb
```

### Installing the Python dependencies by hand

**Install / repair dependencies** in the *Runtime* card runs exactly two
commands. Run them yourself when the Host cannot reach the package index
(a proxy only your shell knows), or when you want the full `pip` output instead
of the last few lines.

```bat
REM cmd.exe — create the venv once, then install / repair
python -m venv %USERPROFILE%\.dsh\db-mcp\.venv
%USERPROFILE%\.dsh\db-mcp\.venv\Scripts\python.exe -m pip install --disable-pip-version-check -r %USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-db-mcp\server\requirements.txt
```

```powershell
# PowerShell — same two steps
python -m venv "$env:USERPROFILE\.dsh\db-mcp\.venv"
& "$env:USERPROFILE\.dsh\db-mcp\.venv\Scripts\python.exe" -m pip install --disable-pip-version-check -r "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-db-mcp\server\requirements.txt"
```

Only the first line is once-per-machine; the `pip install` line is the one worth
re-running after an upgrade. Swap `desktop` for `web` if you installed into the
web profile. If you linked a source checkout with `dsh plugin add <path>`, the
package lives in that directory instead, so point `-r` at
`<path>\server\requirements.txt` — the venv stays under `$DSH_HOME\db-mcp`.

When it finishes, press **Restart MCP** in the same card (the button does this
for you) and the dependency line should read five versions with no `missing`.

## Test databases in Docker

Nothing has to be installed on the host; each engine below is a throwaway
container with a demo account (`demo` / `dbmcp-demo`).

```sh
# PostgreSQL — smallest and fastest, the recommended first target
docker run -d --name dbmcp-pg -p 5432:5432 \
  -e POSTGRES_USER=demo -e POSTGRES_PASSWORD=dbmcp-demo -e POSTGRES_DB=demo \
  postgres:15-alpine

# MySQL
docker run -d --name dbmcp-mysql -p 3306:3306 \
  -e MYSQL_USER=demo -e MYSQL_PASSWORD=dbmcp-demo -e MYSQL_DATABASE=demo \
  -e MYSQL_ROOT_PASSWORD=dbmcp-root mysql:8.0-debian

# Oracle Free — several GB, a minute or two to become healthy
docker run -d --name dbmcp-oracle -p 1521:1521 -e ORACLE_PASSWORD=dbmcp-demo \
  gvenzl/oracle-free:23-slim
```

On Windows, 1521 often falls inside a Hyper-V reserved port block and `docker run`
fails with *"An attempt was made to access a socket in a way forbidden by its access
permissions"*. Check `netsh interface ipv4 show excludedportrange protocol=tcp` and
publish another host port, e.g. `-p 11521:1521`; point the datasource at 11521.

Then import or create a source with the matching string:

```
postgresql://demo:dbmcp-demo@127.0.0.1:5432/demo
mysql://demo:dbmcp-demo@127.0.0.1:3306/demo
oracle://system:dbmcp-demo@127.0.0.1:1521/FREEPDB1
```

## Troubleshooting

| Symptom | Cause | Fix |
| ------- | ----- | --- |
| Sidebar entry gone, plugin card says *not installed* | `package.json` carries a UTF-8 BOM, so the host's `JSON.parse` fails and the bundle is skipped silently | rewrite the file without a BOM (any editor's "UTF-8 without BOM"), then toggle the plugin off and on in the **Plugins** panel |
| Panel says *Host interface disconnected* | the Host half is not mounted (plugin disabled, or bundle failed to load) | check the plugin card, then reload the page |
| Edited `src/host.js` but nothing changed | the Cordis entry is imported once per process | `POST /plugins/db-mcp/api/reload`, or restart DSH after changing `index.js` |
| Tools missing from the agent | the Python server never started | *Runtime* → tools count and error; then **Restart MCP** in that card |
| `unknown tool "mcp__db__…"` right after a restart | tool registration was disposed with the old process | restart DSH once, then drive restarts from **Restart MCP** under *Runtime* |
| Oracle login fails with `DPY-6005` | listener unreachable, or host/port wrong | `docker ps`, then *Test* again |
| `ORA-01950` on first write | Oracle user has no tablespace quota | `alter user <user> quota unlimited on users` |
| Import row red: *incomplete host/database* | the DBeaver entry has neither fields nor a parsable URL | open the connection in DBeaver once, or create the source by hand |
