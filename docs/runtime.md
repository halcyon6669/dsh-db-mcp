English | [中文](runtime.zh.md)

# Runtime

Where the files live, how the Python half gets installed, and what to check when
something is not working.

## Runtime layout

```
$DSH_HOME/db-mcp/
  datasources.json   # sources and groups, never passwords, 0600
  secrets.json       # per-source password envelope, 0600, Host-only
  secret.key         # key for those envelopes, 0600, created on first use
  settings.json      # global write switch + audit switch, 0600
  sessions.json      # per-conversation source limits, 0600
  logs/mcp.log       # masked log
  logs/audit.jsonl   # one line per MCP tool call, rotates at 512 KiB
  .venv/             # plugin-local venv: mcp, psycopg, py-opengauss, PyMySQL, oracledb, cryptography
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
for you) and the dependency line should read six versions with no `missing`.

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
