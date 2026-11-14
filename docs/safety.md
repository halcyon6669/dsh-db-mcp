English | [中文](safety.zh.md)

# Safety

What may write, where, and which of those rules still hold when the caller is not DSH.

The short version: every rule that decides *whether a statement may touch the
database* is enforced in the Python server, so it covers the panel, the DSH agent and
every outside MCP client alike. The two that key off a DSH conversation — the audit
log and the per-conversation limit — stop at DSH's edge.

## Safety switches

Four independent gates decide whether a statement may write:

1. **Global switch** — `allowWrite` in `<runtime>/settings.json`, toggled on the
   *Runtime* tab. Off by default; while off every write is refused with
   `user_error` and a hint pointing at the switch.
2. **Per-source flag** — `readOnly` on the source, on by default. A switch on the
   row flips it in one click, and the word beside the switch says which way it is
   set. It is the only control on a row: everything else there — the schema list,
   the DDL state, a broken secret — is plain text, so the thing that can be
   operated is the thing that looks operable.
3. **Writable schemas** — a writable source also says which schemas it may write
   to. Turning it writable asks first, and a statement aimed anywhere else is
   refused. The row shows that list only while the source is writable: the list
   survives a switch back to read-only, but a note on a locked row would claim a
   permission that is not in force.
4. **DDL** — `allowDdl` on the source, off by default. Writing rows and changing
   the shape of the database are different decisions: a source that is happy to
   take an `insert` may still be one whose tables belong to somebody else. While
   it is off, `create`, `alter`, `drop`, `truncate`, `rename`, `grant` and
   `revoke` are refused before they reach the database; `insert`, `update` and
   `delete` are unaffected. The switch is asked for in the same unlock dialog,
   and the row carries a *DDL allowed* or *DDL blocked* note so the answer is
   visible without opening anything.

The Python server reads the global flag at start-up and the host restarts it
whenever the switch flips. Read-only is enforced again at the driver where the
engine allows it (`mode=ro` for SQLite, `default_transaction_read_only` for
PostgreSQL, `SET SESSION TRANSACTION READ ONLY` for MySQL).

## Which rules follow you out of DSH

The four gates live in the Python server, which is the process that actually opens the
connection. DSH never sees the SQL of an outside client, so nothing that lives only in
the host half can apply to one. That line is the whole table:

| Rule | Enforced in | DSH agent | Outside MCP client |
| --- | --- | --- | --- |
| Global write switch (`allowWrite`) | Python, read from the environment when the child starts | yes | yes — the host also replaces the HTTP child when the switch flips |
| `readOnly` per source | Python, re-read from the registry on every call | yes | yes |
| `writableSchemas` | Python, before the statement reaches the driver | yes | yes |
| `allowDdl` | Python, before the target schema is even resolved | yes | yes |
| Per-conversation limit (`mcp__db__session_scope`) | Host, keyed by the DSH conversation id | yes | no — an outside client has no conversation to key off |
| Audit log | Host, written by the wrapper around each tool call | yes | no — outside calls leave no line in `logs/audit.jsonl` |
| Row-count defaults (`sample_rows`, `execute_sql` in the panel) | Host, injected into the arguments before the call | yes | no — but the server's own hard cap still applies |
| Unchecked rows on the *Tools* tab | Host, filtered when the tools are registered | yes | no — the Python server still publishes every tool |

Two consequences worth knowing:

- Turning a tool off on the *Tools* tab trims what the model can see. It does not take
  the capability away: an outside client can still call that tool, and so can the
  panel's own `/mcp/call` route.
- Because `allowWrite` is read once at start-up, flipping it replaces both Python
  children — the stdio one behind the agent and the HTTP one behind outside clients.
  Both come back on the same port, so a client already pointed at the endpoint does not
  need to be reconfigured.

## Writable schemas

Reads stay unrestricted: the agent can look at every schema the login can see. A
write is different — a source that accepts writes has to name the schemas it may
write to.

Flip a row from *read-only* to *writable* and a dialog asks where it may write. It
lists the schemas of that source with one checkbox each — nothing to type. A schema
the source already writes to stays on the list even when the catalog no longer
shows it. Nothing is preselected on a source that never had a list; a source that
had one comes back with the same boxes ticked, because switching back to read-only
keeps the list. **Allow writes** stays disabled until at least one box is ticked.

The same dialog carries one more question: **Also allow DDL**. It is off unless it
was turned on before, and it means what it says — `create`, `alter`, `drop`,
`truncate`, `rename`, `grant` and `revoke` are refused on a source that has not
opted in, before the statement reaches the database. `insert`, `update` and
`delete` keep working either way. The switch only widens *which statements* may
run; the schemas ticked above still bound *where* they may land, so a `drop table`
aimed outside the list is refused even with DDL on.

The same names can be edited later in **Edit** → **More settings** → *Writable
schemas*, comma separated; the DDL switch sits next to them as *Allow DDL*. Both
are stored on the source, so the dialog and the form always agree.

The guard runs in the Python server, which means it covers the agent, the HTTP
endpoint and the panel alike:

- Every statement in a batch is checked; a leading `--` comment or a `;` does not
  hide one.
- Reads (`select`, `with`, `show`, `explain`, …) always pass.
- A write is resolved to the schema it lands on — `insert into sales.orders`,
  `update "hr".employees`, `create table audit.log`, `create index i on
  sales.orders`, `grant … on sales.orders`, `call sales.recalc()`.
- A statement that changes the shape of the database is refused unless the source
  allows DDL; `truncate` counts, because it empties a table just as thoroughly as
  `drop` would.
- An unqualified target takes the source's own default: `main` for SQLite, the
  configured database for MySQL, the configured schema (or the Oracle user) for
  the rest, and `public` for PostgreSQL when nothing is set.
- A statement whose target cannot be read is refused, not allowed through.
- A source that is writable with no list at all refuses every write; the panel
  will not put it in that state, but a hand-edited registry can.

This is a guard, not a grant. It keeps the agent from writing outside the schemas
it was given, but the real boundary stays in the database: a login that can write
`hr.employees` can still do it over any other client. For a hard limit, give the
source a narrower `GRANT` as well.

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
the *Runtime* tab lists the conversations that are limited so you can see it at a
glance. The limit is a per-conversation convenience, not a security boundary: the
files under the runtime directory stay readable by your account.

## Audit log

Every MCP tool call appends one JSON line to `<runtime>/logs/audit.jsonl` (0600):
time, tool, source, duration, row count, the SQL truncated to 2000 characters, and
the error when it failed. Result rows are never logged. The file rotates to
`audit.1.jsonl` at 512 KiB and logging can be switched off with `auditLog: false`.

The panel shows the last dozen entries **on your own clock**, date included, so a
call from yesterday is not mistaken for one from an hour ago; the file keeps UTC so
it stays comparable across machines. Each stamp carries the same instant with its
zone in the tooltip.

The statement is the part of an entry you actually came to read, so it gets its own
recessed block under the facts: monospaced, full ink rather than hint grey, with a
rule down the left edge — blue for a call that succeeded, red for one that failed.
Long statements wrap inside that block and scroll past about a dozen lines instead
of pushing the rest of the log off the page.
