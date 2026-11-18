# Reference

Wire-level details: HTTP routes, tool contracts, the files on disk, and the plugin
configuration. For usage see [guide.md](guide.md).

Everything below is served under `/plugins/db-mcp/api` on the DSH web origin. Reads
are `GET`; every mutation is `POST` (the same-origin check compares `Origin` with
`Host`). Responses are JSON with `cache-control: no-store`.

## HTTP routes

| Route | Purpose |
| ----- | ------- |
| `GET /health` | plugin version, Host facts, Python discovery, runtime paths, registry state, MCP status, settings |
| `GET /datasources` | registry, credentials projected away |
| `GET /schema?datasource=…&table=…[&schema=…]` | tables, or the columns of one table |
| `GET /groups` | declared groups plus every group label in use |
| `GET /dbeaver/scan` | DBeaver connections; never includes passwords |
| `GET /mcp/status` | Python server phase, tool list, last error, stderr tail |
| `GET /http/status` | streamable-HTTP endpoint state: running, host, port, `url` (`http://host:port/dsh-db-mcp`), `sseUrl`, stderr tail |
| `POST /http/start` · `POST /http/stop` | start (optional `{ port }`) or stop the HTTP endpoint |
| `GET /clients` | the endpoint URL plus every supported outside client: config file, detected, configured |
| `GET /tools` | every tool the Python server offers, with its `enabled` state and row-limit metadata, plus the current `limits` and `textPolicy`, so the panel can switch them |
| `POST /clients/configure` | write this server into one client's config (`{ client }`) |
| `GET /settings` · `POST /settings` | global write switch, audit switch, row limits and the long-text setting |
| `GET /scopes` · `POST /scopes` | per-conversation data-source limits (`{ session, datasources }`; an empty list lifts the limit). `GET` returns `{ sessions, archived }`, each row `{ session, ids, updatedAt, title }` — `title` is the conversation's folded title when the host can read it, else `null`; `archived` holds the limits parked by archiving |
| `POST /scopes/delete` · `POST /scopes/clear` | drop one conversation's limit (`{ session }`) or every limit at once; both return what they removed. Deleting also drops the parked copy, so unarchiving cannot resurrect it |
| `GET /audit?limit=N` | tail of the tool-call audit log (default 20, max 200) |
| `GET /python/env` · `GET /python/status` | interpreter, venv path, installed driver versions |
| `POST /python/setup` | create the venv and install `server/requirements.txt` |
| `POST /datasources/save` | create or update a source (`id` immutable); a second row for the same host + port + database + user is refused with `409` |
| `POST /datasources/delete` | remove a source and its stored secret |
| `POST /datasources/test` | real login probe (accepts `id`, or an inline `kind` + `config` + `password`) |
| `POST /datasources/bulk` | `action: test \| readOnly \| group \| delete` over `ids`; `readOnly: false` also takes `allowDdl` |
| `POST /datasources/reorder` | rewrite the row order given `ids`; sources it does not name keep their place at the end |
| `POST /groups/save` · `POST /groups/delete` | create, rename (`from`) or delete a group |
| `POST /dbeaver/import` | copy selected DBeaver connections into the registry |
| `POST /mcp/start` · `POST /mcp/restart` | start or restart the Python MCP server |
| `POST /mcp/call` | dev helper: call one MCP tool through the panel |
| `POST /reload` | dev helper: re-import `src/host.js` without restarting DSH |

### The MCP HTTP endpoint

`POST /http/start` takes `{ port }` only. The host is fixed at `127.0.0.1` in
`startHttp` (`src/tools.js`), so the endpoint is unreachable from another machine and
cannot be widened through the panel or through `settings.json`.

It has no authentication. Every route above sits behind the same-origin check, but
the MCP endpoint does not: any process on this machine that can open a TCP socket to
the port can speak JSON-RPC to it and call every tool the Python server publishes,
`execute_sql` included. Treat loopback as the boundary.

What still applies is everything the Python server enforces on arrival: the read-only
flag, `allowDdl`, the row caps (`DB_MCP_MAX_ROWS`, `DB_MCP_MAX_ROWS_HARD`) and
`DB_MCP_ALLOW_WRITE`, which the Host passes at spawn time from the global write switch.
What does **not** apply is the disabled-tool list: `disabledTools` is filtered in the
Host when it registers `mcp__db__*` with DSH, so it narrows the agent's tool list only
and an outside client still sees every tool. Stopping the endpoint (`POST /http/stop`)
or setting `httpEnabled: false` closes it without affecting the stdio path DSH itself
uses.

### Status codes

| Code | Meaning |
| ---- | ------- |
| 200 | success; bodies carry `ok: true` |
| 400 | validation error (`id must match …`, `oracle requires config.serviceName or config.sid`, `group name is required`, …) |
| 403 | `Origin` present and different from `Host` |
| 404 | unknown route, unknown datasource (`unknown datasources: …`), unknown group |
| 405 | method not GET/HEAD/POST |
| 409 | a source already uses this host + port + database + user; the body carries `existingId` |
| 500 | unexpected failure, including a Host module that failed to load |
| 503 | MCP server not ready (`start the MCP server from the panel and try again`) |

## Tools

Names are prefixed at publication time: `mcp__db__list_datasources` and so on.
`datasource` is optional everywhere — omitted, the server falls back to the source
flagged `isDefault`, else the first entry in the registry. The panel stopped offering
a "make default" action in 0.8, so `isDefault` normally stays on the imported sample
or the very first source created.
Row limits come from the server: `DB_MCP_MAX_ROWS` (default 200) per call, capped at
`DB_MCP_MAX_ROWS_HARD` (default 2000).

| Tool | Parameters | Returns |
| ---- | ---------- | ------- |
| `list_datasources` | — | `[{ id, name, kind, target, readOnly, isDefault }]` |
| `list_tables` | `datasource?`, `schema?` | `{ datasource, tables: [{ schema, name, type }], schemas: [string] }` |
| `describe_table` | `table`, `datasource?`, `schema?` | `{ columns: [{ name, type, nullable, default, primaryKey }] }` |
| `sample_rows` | `table`, `datasource?`, `limit=20`, `schema?` | `{ columns, rows, rowCount, truncated }` |
| `execute_sql` | `sql`, `datasource?`, `max_rows?`, `full_text?` | `{ columns, rows, rowCount, truncated, elapsedMs }`, or `{ affectedRows }` for a write |
| `explain_query` | `sql`, `datasource?` | `{ sql, plan }` (engine-specific text) |
| `get_ddl` | `table`, `datasource?`, `schema?` | `{ ddl, source: 'sqlite_master' \| 'columns' }` |
| `test_connection` | `datasource?` or `kind`+`config`+`password?`, `read_only?` | `{ ok, latencyMs, message, detail: { stage, server, database, user, schema } }` |
| `session_scope` | `datasources?`, `all?` | the limit saved for this conversation; `all: true` or an empty list lifts it |

`session_scope` is not an MCP tool: the Host registers it next to the eight bridged
ones so a conversation can narrow itself. While a limit is saved for the calling
conversation, `list_datasources` only returns the allowed rows, a call that names
another source fails with `user_error`, and a call that omits `datasource` either
picks the single allowed row or asks for one. `test_connection` cannot be used with
an inline `kind` + `config` while a limit is active, because that would sidestep the
check. Conversations without an entry — and entries with an empty list — keep access
to everything.

Failures come back as `{ ok: false, error: { code, message, hint? } }` with

| Code | Meaning |
| ---- | ------- |
| `user_error` | the request is wrong: unknown datasource, refused write, bad table name, a DDL statement on a source that has not opted in |
| `db_error` | the engine refused or failed: authentication, syntax, timeout |
| `infra_error` | the plugin could not get that far: interpreter missing, venv broken |

## Files

All under `$DSH_HOME/db-mcp` (override with the `runtimeDir` option), mode `0600`,
written atomically via a temporary file plus rename. `secret.key` is created once
and never rewritten by the Host.

`datasources.json`

```json
{
  "schemaVersion": 1,
  "updatedAt": "2026-11-07T09:00:00.000Z",
  "groups": ["docker"],
  "datasources": [
    {
      "id": "pg-demo",
      "name": "PostgreSQL demo",
      "kind": "postgres",
      "group": "docker",
      "config": { "host": "127.0.0.1", "port": 5432, "database": "demo", "user": "demo", "schema": "public" },
      "readOnly": false,
      "allowDdl": false,
      "isDefault": true,
      "tags": [],
      "createdAt": "…",
      "updatedAt": "…",
      "lastProbe": { "ok": true, "message": "PostgreSQL 15.19 · demo@demo · select version() ok", "latencyMs": 140, "at": "…" }
    }
  ]
}
```

A writable source may write to every schema its login can see — there is no
per-schema allow list. The remaining per-source choice is `allowDdl` (below).

A registry from the earlier builds carries `schemas: { mode, names }` or a
`writableSchemas` list. The Host drops both keys once, on mount: neither is read
any more, so nothing is carried over.

`secrets.json` holds `{ "schemaVersion": 1, "secrets": { "<id>": { "password": "v1.…" } } }`
and is read only by the Host and its Python child, never sent to the page.

Each password is an AES-256-GCM envelope:

```
v1.<iv base64url>.<tag base64url>.<ciphertext base64url>
```

The key lives next to it in `secret.key` (32 random bytes, base64url, mode `0600`),
created on first use and never rotated by the plugin. The data source `id` is the
additional authenticated data, so an envelope moved to another source fails to
decrypt instead of quietly returning the wrong password. A plaintext value left by
an older build still opens, and the next write replaces it with an envelope.

What this protects: a copy of `secrets.json` on its own — a backup, a sync folder,
a file pasted into an issue — no longer carries any password. What it does not:
anything that can read both files as your user can still decrypt them. Delete
`secret.key` to make every stored password unreadable at once; the panel then asks
for them again instead of reporting a bogus authentication failure.

`settings.json` holds `{ "allowWrite": false, "auditLog": true, "httpEnabled": true, "httpPort": 8765, "disabledTools": [], "textPolicy": "auto", "updatedAt": "…" }`.
`limits` holds `{ "sampleRows": 20, "maxRows": 200 }`: the row counts handed to `sample_rows`
and `execute_sql` when the model does not name one. Out-of-range values fall back to those
defaults.
`textPolicy` is `auto` (default) or `full`: how a cell longer than 200 characters is
rendered into the model context. `auto` keeps the first and last 50 characters around a
`…(共N字)…` marker, `full` returns the value untouched, and blob cells are compressed to a
size tag either way. The policy is applied when the result is rendered, so the rows
themselves are never truncated. An unknown value falls back to `auto`; the Python server
reads it from `DB_MCP_TEXT_POLICY` at spawn time, so changing it restarts the child.
`disabledTools` lists tool names without the `mcp__db__` prefix (for example `["get_ddl"]`):
those are left out of the agent's registry, while the Python server keeps serving them over
stdio and HTTP.
`allowWrite` counts only when it is exactly `true`; `httpEnabled` defaults to `true`, and
`httpPort` must fall between 1024 and 65535 (the server moves to the next free port when
Windows refuses the requested one, and the panel shows the port actually in use).

`sessions.json` holds the conversation limits:

```json
{
  "schemaVersion": 1,
  "sessions": { "session-617a10ed-…": { "ids": ["pg-demo", "oracle-demo"], "updatedAt": "…" } }
}
```

A conversation missing from that map, or listed with an empty `ids`, may use every
data source.

`logs/audit.jsonl` — one JSON object per tool call; rotates to `audit.1.jsonl` at
512 KiB:

```json
{"at":"2026-11-08T06:20:28.000Z","tool":"mcp__db__execute_sql","datasource":"pg-demo","ok":true,"ms":41,"rows":3,"sql":"select id, name from customers order by id"}
```

### Data source fields

| Kind | `config` keys |
| ---- | ------------- |
| `sqlite` | `file` (absolute path), `readOnlyOpen?`, `busyTimeoutMs?` |
| `postgres` | `host`, `port` (5432), `database`, `user`, `schema?`, `sslMode?` |
| `gauss` | same as `postgres`, plus `hosts: [{ host, port }]` for an openGauss cluster; `host` may also be `h1:1,h2:2` |
| `mysql` | `host`, `port` (3306), `database`, `user`, `charset?` |
| `oracle` | `host`, `port` (1521), `serviceName` **or** `sid`, `user`, `schema?` |

`id` must match `^[a-z0-9][a-z0-9-]{0,31}$` and never changes; `name` ≤ 64
characters; `group` ≤ 48.

### The DDL switch

Reads are never restricted by schema, and neither are writes on a source that is
not read-only — a writable source may write to every schema its login can see. The
only per-source choice left is whether it may change the shape of the database.

```json
"readOnly": false,
"allowDdl": false
```

| Field | Meaning |
| ----- | ------- |
| `allowDdl` | `true` lets this source run `create`, `alter`, `drop`, `truncate`, `rename`, `grant` and `revoke`; absent or `false` refuses them |

`allowDdl` is stored on the source and defaults to off, so a registry written before
the field existed does not start accepting `drop table` on the next load. A save
that omits the field keeps the stored value rather than revoking it, so a caller
that does not know about the switch cannot silently turn it off.

The guard runs in the Python child (`server/writes.py` and `engines.ensure_readable`),
so the agent, the HTTP endpoint and the panel all hit it:

- One statement per call. `select 1; drop table t` is refused as a batch before
  anything reaches the engine — the old guard looked only at the first keyword, so
  it let that through. Semicolons inside quotes do not count, and a trailing
  semicolon is still one statement.
- Every statement is classified on its own. A leading `--` or `/* */` comment does
  not hide what follows.
- Reads (`select`, `values`, `table`, `show`, `describe`, `explain`, …) always pass.
  `explain` plans rather than runs, so it passes even over a write; `explain
  analyze` runs the statement, so the inner statement decides.
- `insert`, `update` and `delete` pass on a writable source. A CTE counts as a
  write when its body changes rows: `with gone as (delete … returning *) select …
  from gone` is committed, not rolled back as a read.
- `set` and `pragma` are no longer blanket reads. Only a short per-engine list is
  allowed on a read-only source (`set search_path`, `set names`, the reporting
  `pragma table_info`/`index_list`/…); anything else is treated as a change.
- A statement that changes the shape of the database is refused unless the source
  has `allowDdl: true`; `truncate` counts as DDL — it keeps the table but empties
  it.

This is a guard, not a grant. It keeps the agent from changing a schema it was not
given permission to change; the real boundary stays in the database. A login that
can write `hr.employees` can still do it over any other client, so a source that
needs less should also get a narrower `GRANT`.

The panel shows the same switch on the row, beside the writable one, and in the
edit form's *More settings*.

## Plugin configuration

The bundle row in the profile accepts these options (all optional):

| Key | Default | Meaning |
| --- | ------- | ------- |
| `pythonPath` | auto | interpreter to use ahead of the venv and `PATH` |
| `runtimeDir` | `$DSH_HOME/db-mcp` | where the registry, secrets, settings and logs live |
| `probeTimeoutMs` | `10000` | per-probe timeout for *Test* |
| `mcpServerName` | `db` | prefix after `mcp__` when publishing tools |
| `debug` | `false` | log Host activity to the DSH console |

The Python side reads `DB_MCP_RUNTIME`, `DB_MCP_ALLOW_WRITE`, `DB_MCP_TEXT_POLICY`,
`DB_MCP_MAX_ROWS` and `DB_MCP_MAX_ROWS_HARD`; the Host sets the first three when
spawning.

## Runtime requirements

- DSH `>=0.2.0-rc.2`, declared as `engines.dsh` in `package.json` so the market can
  show the host requirement and refuse an incompatible install.
- Node 22.5+ on the Host for the in-process SQLite probe (`node:sqlite`). DSH ships
  24.x; if the module is missing the probe falls back to the Python driver and the
  panel reports it instead of failing.
- A Python 3.10+ interpreter for the MCP server, with the packages from
  `server/requirements.txt`. 3.10 is the floor set by `mcp`, `psycopg`, `oracledb`
  and `pydantic`; the panel's one-click install builds the venv for you.
  `mcp` must stay on 1.x — 2.x renamed `FastMCP`. `cryptography` opens the stored
  password envelopes; without it every source reports `infra_error` instead of
  connecting.
- Windows, macOS or Linux. The venv layout (`Scripts/python.exe` vs `bin/python`)
  and the DBeaver workspace path are resolved per platform.
