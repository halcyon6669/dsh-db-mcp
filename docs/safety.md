English | [中文](safety.zh.md)

# Safety

What may write, and which of those rules still hold when the caller is not DSH.

The short version: every rule that decides *whether a statement may touch the
database* is enforced in the Python server, so it covers the panel, the DSH agent and
every outside MCP client alike. The two that key off a DSH conversation — the audit
log and the per-conversation limit — stop at DSH's edge.

## Safety switches

Three independent gates decide whether a statement may write:

1. **Global switch** — `allowWrite` in `<runtime>/settings.json`, toggled in the
   *Data source list* tab, in the list card's title row right after the group box.
   Off by default; while off every write is refused with `user_error` and a hint
   pointing at the switch.
2. **Per-source flag** — `readOnly` on the source, on by default. A switch on the
   row flips it in one click, and the word beside the switch says which way it is
   set. Apart from that switch and the DDL one below it, everything on the row (a
   broken secret, the probe result) is plain text, so the things that can be
   operated are the things that look operable.
3. **DDL** — `allowDdl` on the source, off by default, and its own switch right
   beside the writable one. Writing rows and changing the shape of the database are
   different decisions: a source that is happy to take an `insert` may still be one
   whose tables belong to somebody else. While it is off, `create`, `alter`, `drop`,
   `truncate`, `rename`, `grant` and `revoke` are refused before they reach the
   database; `insert`, `update` and `delete` are unaffected. The switch only means
   anything while the source is writable, so a read-only row does not show it at
   all — a control that can never be used is noise on the row.

A writable source may write to every schema its login can see — there is no
per-schema allow list any more. The remaining boundary is the database itself: a
login that can write `hr.employees` can still do it over any other client. For a
hard limit, give the source a narrower `GRANT` as well.

The Python server reads the global flag at start-up and the host restarts it
whenever the switch flips. Read-only is enforced again at the driver where the
engine allows it (`mode=ro` for SQLite, `default_transaction_read_only` for
PostgreSQL, `SET SESSION TRANSACTION READ ONLY` for MySQL).

## Which rules follow you out of DSH

The three gates live in the Python server, which is the process that actually opens the
connection. DSH never sees the SQL of an outside client, so nothing that lives only in
the host half can apply to one. That line is the whole table:

| Rule | Enforced in | DSH agent | Outside MCP client |
| --- | --- | --- | --- |
| Global write switch (`allowWrite`) | Python, read from the environment when the child starts | yes | yes — the host also replaces the HTTP child when the switch flips |
| `readOnly` per source | Python, re-read from the registry on every call | yes | yes |
| `allowDdl` | Python, before the target schema is even resolved | yes | yes |
| Per-conversation limit (`mcp__db__session_scope`) | Host, keyed by the DSH conversation id | yes | no — an outside client has no conversation to key off |
| Audit log | Python, one line per call from the process that ran it | yes | yes — the HTTP child writes the same file |
| Row-count defaults (`sample_rows`, `execute_sql` in the panel) | Host, injected into the arguments before the call | yes | no — but the server's own hard cap still applies |
| Rows switched off on the *Tools* tab | Host, filtered when the tools are registered | yes | no — the Python server still publishes every tool |

Two consequences worth knowing:

- Turning a tool off on the *Tools* tab trims what the model can see. It does not take
  the capability away: an outside client can still call that tool, and so can the
  panel's own `/mcp/call` route.
- Because `allowWrite` is read once at start-up, flipping it replaces both Python
  children — the stdio one behind the agent and the HTTP one behind outside clients.
  Both come back on the same port, so a client already pointed at the endpoint does not
  need to be reconfigured.

## DDL

Reads stay unrestricted: the agent can look at every schema the login can see, and a
writable source can write to all of them too. The only remaining per-source choice is
whether it may change the shape of the database.

The DDL switch on a row turns it on in one click. It means what it says —
`create`, `alter`, `drop`, `truncate`, `rename`, `grant` and `revoke` are refused on
a source that has not opted in, before the statement reaches the database. `insert`,
`update` and `delete` keep working either way. The same switch appears in **Edit** →
**More settings** as *Allow DDL*, so the row and the form always agree.

The guard runs in the Python server, which means it covers the agent, the HTTP
endpoint and the panel alike:

- Every statement in a batch is checked; a leading `--` comment or a `;` does not
  hide one.
- Reads (`select`, `with`, `show`, `explain`, …) always pass.
- `insert`, `update` and `delete` pass on a writable source.
- A statement that changes the shape of the database is refused unless the source
  allows DDL; `truncate` counts, because it empties a table just as thoroughly as
  `drop` would.

This is a guard, not a grant. It keeps the agent from changing a schema it was not
given permission to change, but the real boundary stays in the database. For a hard
limit, give the source a narrower `GRANT` as well.

Stored passwords are encrypted at rest. `secrets.json` holds an AES-256-GCM
envelope per source and the key lives beside it in `secret.key` (mode `0600`,
created on first use). A copy of `secrets.json` alone — a backup, a sync folder, a
file pasted into an issue — no longer carries any password, and an envelope moved
onto another source fails to decrypt instead of handing back the wrong one.
Anything running as your user can still read both files, so the panel tells you
when a stored password cannot be decrypted (*stored password unreadable* on the
row) and asks you to type it again. Deleting `secret.key` makes every stored
password unreadable at once, which is the fastest way to revoke them all.

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
the *Conversation limits* card on the *Data source list* tab lists the conversations
that are limited, with a remove button per conversation, a "Clear all", and an automatic
removal when a conversation is disposed or archived, so the list cannot grow without
bound. Archiving is not deletion: the limit is parked in
the same file and handed back when the conversation is unarchived, because a limit you
set on purpose should survive a trip through the archive. Removing a limit by hand
forgets the parked copy too, so an unarchive cannot bring back something you deleted.
The card is always there, saying "no conversation is limited" when the list is empty.
It is a three-column table — conversation id, name, data sources — open by default,
because an id, a title and a set of sources are three different kinds of thing, and
columns read across far better than a line of run-on text. The header sticks while the
box scrolls, so a long list never pushes the page around.
Each row shows the conversation's title when the host knows it, and the full id beside
it — the id is what the file keys on, so it is never abbreviated. The limit is a
per-conversation convenience, not a security boundary: the files under the runtime
directory stay readable by your account.

## TLS

`sslMode` on a source decides what the driver negotiates; the mapping is in
[reference.md](reference.md#sslmode). Two things are worth knowing before relying on
it:

- **openGauss does not verify certificates.** The driver's TLS entry point is
  shimmed (Python 3.12 removed `ssl.wrap_socket`), and the shim runs with
  `CERT_NONE`, so a connection to an openGauss server is encrypted but not
  authenticated: a machine in the middle can present any certificate. Keep those
  servers on a network you control, or put TLS termination in front of them.
- **A DBeaver connection that needs an SSH tunnel is not imported.** DBeaver keeps
  the tunnel in `configuration.handlers` and writes the tunnel's local end into the
  connection fields, so importing one would create a source pointing at `localhost`.
  The import list shows such entries with the reason and no checkbox. The same goes
  for proxy handlers. If you need those connections, publish the database endpoint
  another way and add it by hand.

## Resource limits

A runaway query is the failure mode that looks like a hang rather than an error, so
two bounds sit on every call:

- **A statement deadline.** `DB_MCP_STATEMENT_TIMEOUT_MS` (default 30 s, `0` turns it
  off) is pushed to the engine itself — `statement_timeout` on PostgreSQL and
  openGauss, `max_execution_time` on MySQL, `call_timeout` on Oracle, a progress
  handler on SQLite. The engine, not the plugin, stops the work, so the connection
  stays usable afterwards. MySQL applies it to `SELECT` only; a long `UPDATE` there
  still runs to completion. A timeout comes back as `code: "timeout"` with a hint
  naming the variable, which is the signal for the agent to narrow the query rather
  than retry it.
- **A server-side cursor for reads.** Without one, the driver pulls the whole result
  set into memory before `max_rows` trims the output, so a `SELECT` over a large
  table could exhaust the child process while returning 200 rows. Reads now use a
  psycopg named cursor or a PyMySQL `SSCursor` and stop fetching at `max_rows + 1`;
  writes keep the ordinary cursor because a named one cannot run DDL.

Both are about the child process, not about permissions: they bound what a
well-behaved call can cost, and they do not replace the write switch or the DDL
opt-in.

## Audit log

Every MCP tool call appends one JSON line to `<runtime>/logs/audit.jsonl` (0600):
time, tool, source, duration, row count, the SQL truncated to 2000 characters, and
the error when it failed. Result rows are never logged. The file rotates to
`audit.1.jsonl` at 512 KiB and logging can be switched off with `auditLog: false`.

The line is written by the Python process that ran the call, not by the Host. That
matters for outside clients: a VS Code or Cursor pointed straight at the HTTP
endpoint never passes through the Host, so a Host-side wrapper could not see it.
Each process writes only for itself — the Host records the stdio child's calls, the
HTTP child records its own — so one call still leaves exactly one line.

The panel shows the last dozen entries **on your own clock**, date included, so a
call from yesterday is not mistaken for one from an hour ago; the file keeps UTC so
it stays comparable across machines. Each stamp carries the same instant with its
zone in the tooltip.

The statement is the part of an entry you actually came to read, so it gets its own
recessed block under the facts: monospaced, full ink rather than hint grey, with a
rule down the left edge — blue for a call that succeeded, red for one that failed.
Long statements wrap inside that block and scroll past about a dozen lines instead
of pushing the rest of the log off the page.
