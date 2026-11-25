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
| `GET /clients` | the endpoint URL plus every supported outside client: config file, detected, configured, and the configured `transport` (`stdio` or `http`) |
| `GET /tools` | every tool the Python server offers, with its `enabled` state and row-limit metadata, plus the current `limits`, `textPolicy` and `cost` thresholds, so the panel can switch them |
| `POST /clients/configure` | write this server into one client's config (`{ client, transport? }`); `transport` is `stdio` (command/args/env, no endpoint needed) or `http` (shared endpoint, must be running). Omitting it keeps the old per-client default; writing one form replaces the other. VS Code is written to the Copilot harness file (`$COPILOT_HOME/mcp-config.json`) with the portable entry shape (`type`, `tools`) |
| `GET /settings` · `POST /settings` | global write switch, audit switch, row limits, the long-text setting and the `cost` thresholds (`{ cost?: { slowMs?, timingWindow?, trustSamples?, bigTableRows? } }`; a partial patch keeps the rest) |
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
| `GET /relations?datasource=…[&status=…][&source=…]` | the relation graph of one datasource: every edge with its endpoints, source, status, condition, counters and history, plus `counts` over the whole graph (the filter never shrinks the counters) |
| `POST /relations/discover` | import the foreign keys the catalog declares (`{ datasource, schema? }`) |
| `POST /relations/propose` | record a join the catalog does not declare (`{ from_table, from_column, to_table, to_column, datasource?, condition?, note? }`); it starts out `pending` |
| `POST /relations/feedback` | move one edge (`{ edge_id, verdict, reason?, note?, datasource?, fanout?, ms? }`); `verdict` is `ok`, `too_many`, `missing` or `irrelevant` |
| `POST /relations/condition` | attach or clear the extra predicate a join needs (`{ edge_id, condition, datasource? }`; an empty condition clears it) |
| `POST /relations/delete` | remove one edge (`{ edge_id, datasource? }`) |
| `POST /relations/mine` | mine joins out of the audit log (`{ datasource?, schema?, limit? }`) |
| `POST /relations/scan` | mine joins out of a project's source tree (`{ root, datasource?, schema?, limit? }`) |
| `GET /scenes?datasource=…` | the scenes of one datasource: `{ scenes, total }` |
| `POST /scenes/save` | create or update a scene (`{ name, tables, datasource?, note?, scene_id? }`) |
| `POST /scenes/delete` | remove one scene (`{ scene_id, datasource? }`) — the edges stay |
| `POST /trace` | follow one value across tables (`{ value, datasource?, entry_table?, entry_column?, scene?, max_depth?, max_rows_per_table?, direction?, confirm_slow? }`) — a read-only walk, never a SQL entry point; `scene` narrows it to that scene's tables and reports the rest under `outside`; `confirm_slow` allows a step that would scan a whole table |
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

Every statement also has a deadline: `DB_MCP_STATEMENT_TIMEOUT_MS` (default 30000,
`0` disables it). It is set per engine — `statement_timeout` on PostgreSQL and
openGauss, `max_execution_time` on MySQL (which the server applies to `SELECT` only,
and which does not interrupt a statement that is merely waiting — `select sleep(60)`
runs to completion and returns a row; the same query against a real table is stopped),
`call_timeout` on Oracle, and a SQLite progress handler. A statement that hits it
comes back as `{ ok: false, error: { code: "timeout", … } }`, and the hint says how
to raise or disable the limit. Reads additionally run on a server-side cursor
(psycopg named cursor, PyMySQL `SSCursor`) so a wide result set is not pulled into
memory before `max_rows` trims it; writes keep the ordinary cursor.

| Tool | Parameters | Returns |
| ---- | ---------- | ------- |
| `list_datasources` | — | `[{ id, name, kind, target, readOnly, isDefault }]` |
| `list_tables` | `datasource?`, `schema?` | `{ datasource, tables: [{ schema, name, type }], schemas: [string] }` |
| `describe_table` | `table`, `datasource?`, `schema?` | `{ columns: [{ name, type, nullable, default, primaryKey, comment? }], primaryKey, indexes, comment, rowEstimate }` |
| `list_edges` | `datasource?`, `status?`, `source?` | `{ edges: [{ id, from, to, source, status, condition, note, stats, cost, createdAt, updatedAt }], counts, total, truncated }` |
| `propose_relation` | `from_table`, `from_column`, `to_table`, `to_column`, `datasource?`, `condition?`, `note?` | `{ edge, cost, created, reopened }` — the edge starts as `pending`; `cost` reads the target column's index and the table's row estimate |
| `discover_relations` | `datasource?`, `schema?` | `{ imported, updated, skipped, edges, counts }` — imports the declared foreign keys into the graph |
| `mine_relations` | `datasource?`, `schema?`, `limit=20` | `{ mined, ambiguous, imported, updated, skipped, edges, counts }` — mines joins out of the audit log; see below |
| `scan_code_relations` | `root`, `datasource?`, `schema?`, `limit=20` | `{ root, scanned, mined, ambiguous, imported, updated, skipped, edges, counts }` — mines joins out of a project's mapper XML, `@Select`-style annotations and MyBatis-Plus fragments; see below |
| `feedback_relation` | `edge_id`, `verdict`, `reason?`, `note?`, `datasource?`, `fanout?`, `ms?` | `{ edge, cost, previousStatus, indexed, unique }` — `verdict` is `ok`, `too_many`, `missing` or `irrelevant`; `ms` records how long this step took; see below |
| `set_relation_condition` | `edge_id`, `condition?`, `datasource?` | `{ edge, changed }` — an empty `condition` clears it |
| `delete_edge` | `edge_id`, `datasource?` | `{ deleted, counts }` |
| `trace_by_key` | `value`, `datasource?`, `entry_table?`, `entry_column?`, `scene?`, `max_depth=3`, `max_rows_per_table=20`, `direction=both`, `confirm_slow=false` | `{ value, direction, elapsedMs, scene, entry, summary, nodes, steps, outside, pending, warnings, stoppedAt }` — walks only `confirmed` and `trusted` edges; `scene` narrows the walk to that scene's tables and reports the rest under `outside`; `nodes` is the same walk as a parent/child tree; `confirm_slow` allows a step that would scan a whole table; see below |
| `list_scenes` | `datasource?` | `{ scenes: [{ id, name, tables, tableCount, note, createdAt, updatedAt }], total }` — a scene is a named set of tables, nothing more |
| `save_scene` | `name`, `tables`, `datasource?`, `note?`, `scene_id?` | `{ scene, created }` — updates the scene with that `scene_id`, else the one with that name, else creates one; a scene holds no joins, so deleting one never loses an edge |
| `delete_scene` | `scene_id`, `datasource?` | `{ deleted }` — removes the table set only; the relation graph keeps every edge |
| `sample_rows` | `table`, `datasource?`, `limit=20`, `schema?` | `{ columns, rows, rowCount, truncated }` |
| `execute_sql` | `sql`, `datasource?`, `max_rows?`, `full_text?` | `{ columns, rows, rowCount, truncated, elapsedMs }`, or `{ affectedRows }` for a write |
| `explain_query` | `sql`, `datasource?` | `{ sql, plan }` (engine-specific text) |
| `get_ddl` | `table`, `datasource?`, `schema?` | `{ ddl, source: 'sqlite_master' \| 'columns' }` |
| `test_connection` | `datasource?` or `kind`+`config`+`password?`, `read_only?` | `{ ok, latencyMs, message, detail: { stage, server, database, user, schema } }` |
| `session_scope` | `datasources?`, `all?` | the limit saved for this conversation; `all: true` or an empty list lifts it |

`session_scope` is not an MCP tool: the Host registers it next to the twenty bridged
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
| `db_error` | the engine refused or failed: authentication, syntax |
| `timeout` | the statement ran past `DB_MCP_STATEMENT_TIMEOUT_MS` and was stopped |
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

`settings.json` holds `{ "allowWrite": false, "auditLog": true, "httpEnabled": true, "httpPort": 8765, "disabledTools": [], "textPolicy": "auto", "cost": { … }, "updatedAt": "…" }`.
`limits` holds `{ "sampleRows": 20, "maxRows": 200 }`: the row counts handed to `sample_rows`
and `execute_sql` when the model does not name one. Out-of-range values fall back to those
defaults.
`cost` holds `{ "slowMs": 200, "timingWindow": 5, "trustSamples": 3, "bigTableRows": 1000000 }`:
the four thresholds that decide what a traced step may cost. They are set on the relation
graph page and read by the Python server on every decision, so a change applies to the next
trace without a restart. Out-of-range values fall back to those defaults; see
[How an edge earns trust](#how-an-edge-earns-trust).
`textPolicy` is `auto` (default) or `full`: how a cell longer than 200 characters is
rendered into the model context. `auto` keeps the first and last 50 characters around a
`…(N chars)…` marker, `full` returns the value untouched, and blob cells are compressed to a
size tag either way. The marker is English like every other string the Python server emits:
it has no locale service to ask, and a reader that is a model does not need one. The policy
is applied when the result is rendered, so the rows themselves are never truncated. An
unknown value falls back to `auto`; the Python server reads it from `DB_MCP_TEXT_POLICY` at
spawn time, so changing it restarts the child.
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

`relations/<sourceId>.json` holds the relation graph of one datasource — the only
place that answers "what joins what". An inline source gets `inline-<hash>.json`.
The Python child owns these files; the panel never writes them, it asks a tool.

```json
{
  "schemaVersion": 1,
  "datasource": "pg-demo",
  "kind": "postgres",
  "updatedAt": "…",
  "edges": [
    {
      "id": "e_9c1f2a",
      "from": { "table": "t_trans", "column": "order_id" },
      "to": { "table": "t_order", "column": "id" },
      "source": "fk",
      "status": "confirmed",
      "condition": null,
      "note": "t_trans_order_id_fkey",
      "stats": {
        "confirmCount": 8, "rejectCount": 0, "lastVerifiedAt": "…",
        "avgFanout": 1.0, "hitCount": 8,
        "indexed": true, "unique": true, "rowEstimate": 1200,
        "timings": [12, 9, 14, 11, 10], "lastMs": 10, "avgMs": 11.2
      },
      "history": [{ "at": "…", "action": "created", "by": "agent", "note": null }],
      "createdAt": "…",
      "updatedAt": "…"
    }
  ]
}
```

`from` is the side that holds the key (the child table), `to` is the side it points
at. `source` is `fk` (imported from the catalog by `discover_relations`), `manual`
(proposed by a person or a model), `inferred`, or `audit_mined`. `status` is
`pending`, `confirmed`, `trusted`, `stale`, or `rejected`; only `confirmed` and
`trusted` are followed. `condition` narrows a join the key alone does not express
(`when status = 'POSTED'`). `history` keeps the last 50 actions. A missing file is
an empty graph, not an error; a corrupt one is reported rather than reset, because
resetting would throw away joins somebody confirmed by hand.

`stats` also carries what the edge costs, and every edge is returned with a `cost`
object holding the same values: `indexed` (is the target column the leading column
of an index or a single-column primary key — `null` when the catalog could not be
read), `unique`, `rowEstimate` (the engine's own estimate: `pg_class.reltuples` for
PostgreSQL and openGauss, `information_schema.TABLES.TABLE_ROWS` for MySQL,
`ALL_TABLES.NUM_ROWS` for Oracle — never a `count(*)`), `timings` (the last
`cost.timingWindow` measured step durations in milliseconds, five by default),
`lastMs`, `avgMs`, and `needsConfirm`.
`propose_relation` and `feedback_relation` fill `indexed` / `rowEstimate` from the
catalog; every trace adds the step durations it measured to `timings`.

### How `trace_by_key` walks

`trace_by_key` answers "where does this value appear, and how do those rows
connect". It starts at one column, then follows graph edges one hop at a time:

- **Entry.** With `entry_table` + `entry_column` it uses exactly that column. With
  only a value it probes candidates in order — columns the graph already points at,
  then the primary key, then indexed columns whose name looks like a key — stopping
  at the first column that holds the value. Probing is capped at 8 columns and 3
  seconds, and `entry.candidates` reports what was tried.
- **Direction.** `from` holds the key, `to` is the row it names. Leaving `from` goes
  `up` to the referenced row; leaving `to` goes `down` to the rows that reference it.
  `both` does each.
- **Only confirmed edges.** `pending`, `stale`, and `rejected` edges are never
  walked. A pending edge that would have continued the walk is listed under
  `pending` with the reason, so a trace that stops early says why.
- **The value never enters the SQL text.** Every statement binds it (`?` / `%s` /
  `:1`), and `condition.binds` carries the real value; `sql` is safe to log.
- **Bounded.** `max_depth` is clamped to 1–6, `max_rows_per_table` to 1–200, and a
  step reads one row more than the cap to know it truncated. Revisiting the same
  `(table, column, value)` stops the walk.
- **Reported, not hidden.** A step with no rows is `status: "empty"` — the chain
  breaks there. `warnings` carries `no_edges`, `no_entry`, `probe_timeout`,
  `probe_failed`, `step_failed`, `depth_limit`, and `step_limit`; `stoppedAt` names
  the table and reason for each dead end.
- **A full scan asks first.** A join whose target column has no index and whose
  table the catalog estimates at a million rows or more is not run: the step comes
  back as `status: "needs_confirm"` with `sql` empty, `rows: 0`, and the cost it
  would pay, and `summary.needsConfirm` counts them. Run the trace again with
  `confirm_slow: true` to allow it. An unknown row estimate or an unknown index
  never blocks — a catalog that cannot be read must not freeze the walk.
- **Every step is timed.** Each step reports `ms`, and a finished trace writes the
  durations of the steps it actually ran onto their edges, where `lastMs` / `avgMs`
  keep the last `cost.timingWindow` (five by default).
- **The walk is also a graph.** `nodes` holds the same steps linked by `parent`, with
  `children` under each node, so a reader can see which join reached which table.
  Each node carries what the panel needs to render it without re-reading `steps`:
  `condition` (with the bound `binds`), `sql`, and `sample`. `steps` is still the flat
  list and the only source of truth — the graph is a reading of it, and the panel's
  graph and flat list are both built from `steps`.
- **A table is expanded once.** When the walk reaches a table it already expanded at a
  shallower depth, that step is marked `repeated` and its children are not walked
  again; its rows are still reported, and `summary.repeated` counts them.
- **A scene narrows what may be read.** Passing `scene` restricts the walk to the
  tables that scene names. A join leading out of the set is not followed: the table is
  recorded under `outside` with the join and the reason, and `summary.outside` counts
  it. A scene holds table names only — never joins — so saving or deleting one cannot
  change the relation graph.

### Scenes

A scene is a named set of tables for one datasource, stored beside the relation graph
in `<runtime>/scenes/<source>.json`. It exists so a walk can be scoped to "order to
cash" without narrowing the graph itself. `list_scenes`, `save_scene` and
`delete_scene` manage them; `save_scene` updates by `scene_id` first, then by name
(case-insensitively), and creates only when neither matches. Duplicate tables collapse,
and the limits are 50 scenes per datasource and 500 tables per scene.

### How an edge earns trust

Every edge starts `pending`. `feedback_relation` is how a walk changes that, and
the verdict decides what happens next:

| Verdict | `reason` | Status becomes | Effect |
| ------- | -------- | -------------- | ------ |
| `ok` | — | `confirmed`, or `trusted` once earned | the edge is followed from now on |
| `too_many` | `wrong_column` / `needs_condition` / `not_unique` | `stale` | stops being followed until fixed |
| `missing` | — | `stale` | a row that should have been reached was not |
| `irrelevant` | — | `rejected` | blacklisted; only proposing it again lifts it |

`trusted` is recomputed on every `ok`, never latched, and needs all four: three
confirmations, no rejection left standing, an average fanout of 5 or less, and the
last few measured steps all faster than the slow threshold (`cost.slowMs`, 200ms by
default) — at least `cost.trustSamples` (three) of them, so an edge nobody timed
cannot be trusted. An index is a bonus, not a condition: an unindexed column that is
genuinely fast earns trust all the same. An edge whose fanout later grows, or whose
steps slow down, falls back to `confirmed` — which still walks, but stays visible as
something a person vouched for rather than something measured.

Three of those thresholds are editable on the relation graph page, together with the
large-table cut-off (`cost.bigTableRows`, a million rows by default); the fanout cap
stays a constant. They live in `settings.json` under `cost`, and the Python server
re-reads them each time it decides, so a change applies to the next trace without a
restart.

A `stale` edge returns to `pending` when it is proposed again or when
`discover_relations` finds its key in the catalog; the next trace then has to earn
its confirmation back. `set_relation_condition` never changes a status on its own,
so adding a filter cannot silently re-enable a join that was rejected for a reason.

A condition that names a column the table does not have costs the narrowing, not
the walk: that step is retried without the condition, reports the statement that
actually ran (`condition.extra` is `null`), and adds a `condition_failed` warning.
A condition is a guess about a schema; losing a whole trace to a typo in one would
be worse than losing the filter.

### Mining joins out of the audit log

`discover_relations` can only import what the engine declares, and many schemas
declare nothing. `mine_relations` reads the statements already in `logs/audit.jsonl`
— every `execute_sql` and `explain_query` line keeps its `sql` — and turns the
`on`-clause equalities it finds into candidate pairs. No statement is run again and
no row data is involved: the log is evidence that someone believed the join, which
is cheaper than asking and weaker than the catalog.

The statement says the two columns are equal; it does not say which side is the
parent. That comes from the catalog: the side whose column is a primary key or a
single-column unique index is the parent (`to`), the other is the child (`from`).
A column of a **composite** key does not count — in `ledger(account_no, seq)` the
`account_no` repeats once per `seq`, so it cannot be the one side on its own.
A pair where neither side looks unique, or where both do, is reported under
`ambiguous` and **not** imported — the walker follows every confirmed edge, so a
wrong one is worse than a missing one. Call `propose_relation` for those: it records
the direction you know.

Mined edges arrive `pending` with source `audit_mined`, exactly like a proposal, and
the walker ignores them until a trace confirms them. A source is never weakened:
`fk` beats `manual` beats `audit_mined` beats `inferred`, so re-mining cannot
relabel a declared key, and a hand proposal is not downgraded by a log line.

Only statements attributed to this data source are read, plus the lines that named
none when this source is the default one — those ran against whatever the registry
calls the default, and attributing them to another graph would invent joins across
databases.

### Mining joins out of the source tree

A Spring Boot project writes its joins down before it ever runs them. The log
miner above only sees what has already been executed, which is nothing on the day
a schema is first explored — so `scan_code_relations` reads the repository
instead. `root` is the project directory; three places are read and nothing else:

- MyBatis mapper XML — the bodies of `select` / `insert` / `update` / `delete` /
  `sql`, with `<if>` / `<foreach>` / `<where>` children flattened the way MyBatis
  builds them;
- MyBatis annotations — `@Select`, `@Insert`, `@Update`, `@Delete`;
- MyBatis-Plus fragments — `.apply(...)`, `.last(...)`, `.inSql(...)`,
  `.exists(...)`, `.notExists(...)`, `.having(...)`.

Every other string literal in a `.java` file is skipped on purpose. A log message
or a regex read as SQL would invent tables, and a scanner that guesses is worse
than one that finds nothing — the same reason the parser refuses an unqualified
column when a statement names more than one table. `build`, `target`, `out`,
`.git`, `node_modules` and friends are skipped so generated copies do not count
twice, and each statement carries `file:line` so the report points at the source.

Direction works exactly as it does for the log miner: the statement says the two
columns are equal, the catalog says which side is the parent, and a pair where
that cannot be decided is reported under `ambiguous` instead of imported. Edges
arrive `pending` with source `audit_mined` — a committed statement is evidence,
not proof — and nothing is executed: the files are read, never run. A source that
is not reachable therefore fails the call, because without a catalog there is no
way to orient anything.

A project that only uses `BaseMapper` and single-table wrappers has no join to
find, and reporting zero is the correct answer for it, not a failure.

### The panel pages

The panel has two pages that talk to the graph, and neither of them accepts SQL:

- **Relations** (data source level) lists the edges of one data source with a
  status chip, the source (`fk` / `manual` / `inferred` / `audit_mined`) and the
  counters; filter chips for all / pending / confirmed / stale; the actions each
  status allows (confirm, reject with a reason, add a condition, re-open, delete);
  and the confirmation record of an edge that is already confirmed or trusted.
  Two buttons fill the graph: **Import foreign keys** reads the catalog, and
  **Mine the log** reads the statements already audited.
- **Trace** takes a value and an optional entry table/column, walks it, and shows
  the steps with the row counts, the sample rows, the edge status, and the points
  where the chain broke or was truncated. Every step carries the four judgements
  (`ok` / `too_many` with a reason / `missing` / `irrelevant`), and judging a step
  feeds the edge that carried it — so the page is also the place where a walk
  teaches the graph. Edges that were not followed because they are still pending
  are listed separately, with a pointer back to the Relations page.

`logs/audit.jsonl` — one JSON object per tool call; rotates to `audit.1.jsonl` at
512 KiB:

```json
{"at":"2026-11-08T06:20:28.000Z","tool":"mcp__db__execute_sql","datasource":"pg-demo","ok":true,"ms":41,"rows":3,"sql":"select id, name from customers order by id","client":"dsh-agent"}
```

The writer is the Python process that ran the call, which is what lets a call that
came straight into the HTTP endpoint appear here. `DB_MCP_AUDIT=1` in the child's
environment marks it as the one owning the file; the Host sets it for the HTTP child
only and records the stdio child's calls itself, so a call never produces two lines.
`auditLog: false` in `settings.json` stops the Python writer too — it re-reads the
file on every call, so no restart is needed.

`client` says who made the call. The Host stamps `dsh-agent` for the stdio child it
drives on the agent's behalf, and `panel` for the calls the panel's own probe route
makes. A call that arrives over HTTP is stamped by the Python child from the
`clientInfo` the MCP client sent when it connected — `"Cursor 0.44.0"`,
`"probe-client 9.9.9"` — so a shared endpoint can be told apart from the agent. A
client that sends no name is recorded as `unnamed client`; a line written outside any
request (a direct call from a script) simply has no `client` key.

### Data source fields

| Kind | `config` keys |
| ---- | ------------- |
| `sqlite` | `file` (absolute path), `readOnlyOpen?`, `busyTimeoutMs?` |
| `postgres` | `host`, `port` (5432), `database`, `user`, `schema?`, `sslMode?` |
| `gauss` | same as `postgres`, plus `hosts: [{ host, port }]` for an openGauss cluster; `host` may also be `h1:1,h2:2` |
| `mysql` | `host`, `port` (3306), `database`, `user`, `charset?`, `sslMode?` |
| `oracle` | `host`, `port` (1521), `serviceName` **or** `sid`, `user`, `schema?` |

`id` must match `^[a-z0-9][a-z0-9-]{0,31}$` and never changes; `name` ≤ 64
characters; `group` ≤ 48.

### `sslMode`

Unset keeps the driver's own default (psycopg `prefer`, PyMySQL negotiates TLS
whenever the server offers it), so a source saved before the field existed behaves
as it did. The two engines spell the levels differently; the plugin accepts either
spelling on either engine and maps it:

| Value | PostgreSQL (`psycopg`) | MySQL (`PyMySQL`) |
| ----- | ---------------------- | ----------------- |
| `disable` | no TLS | no TLS — the driver is told `ssl_disabled` |
| `allow` / `preferred` | try plaintext first | no TLS — PyMySQL has no opportunistic mode |
| `prefer` | try TLS first (default) | driver default — TLS when the server offers it |
| `require` / `required` | TLS, no certificate check | TLS, no certificate check |
| `verify-ca` / `verify_ca` | TLS, chain checked | TLS, chain checked |
| `verify-full` / `verify_identity` | TLS, chain and hostname checked | TLS, chain and hostname checked |

MySQL needed a correction here: PyMySQL 2.x already negotiates TLS on its own, so
`disable` cannot be expressed by *omitting* the argument — it has to pass
`ssl_disabled=True`, which is what the plugin does now. Before that fix a source
marked `disable` was still encrypted whenever the server supported it.

An unrecognised value is ignored rather than failing the connection, so a typo
cannot turn a working source into a broken one — it just leaves the default in
place. openGauss always skips certificate verification (see
[safety.md](safety.md#tls)), because the driver's TLS hook is shimmed.

The verifying levels need a certificate the client trusts, and there is no config
key for one: libpq looks for `root.crt` in `%APPDATA%\postgresql` (Windows) or
`~/.postgresql` (elsewhere), and PyMySQL uses the system trust store. Without that
file `verify-ca` and `verify-full` fail with *root certificate file … does not
exist or is not readable* rather than quietly connecting unverified — which is the
right failure, but it means a self-signed server cannot be verified through this
plugin yet. `verify-full` additionally compares the certificate's name against the
`host` you configured, so `127.0.0.1` fails against a certificate issued for the
container name; `verify-ca` is the level to use when the address is an IP.

The DBeaver importer carries `sslMode` across, and refuses a connection that needs
an SSH tunnel or a proxy: DBeaver stores the *tunnel's* local end in the connection
fields, so importing one would produce a source pointing at `localhost`. Those
entries show up in the import list with the reason instead of a checkbox.

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
`DB_MCP_AUDIT`, `DB_MCP_MAX_ROWS`, `DB_MCP_MAX_ROWS_HARD` and
`DB_MCP_STATEMENT_TIMEOUT_MS`; the Host sets the first four when spawning — and sets
`DB_MCP_AUDIT=1` for the HTTP child only, because that child is the sole writer for
calls that arrive over HTTP. `DB_MCP_STATEMENT_TIMEOUT_MS` is read by the
Python child itself, so setting it in the environment before DSH starts is enough —
it does not have to be a bundle option.

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
