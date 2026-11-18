# Changelog

Notable changes to this plugin, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the versions are
[Semantic Versioning](https://semver.org/spec/v2.0.0.html): a breaking change to a
tool name or a stored file bumps the minor version while the project is pre-1.0.

Unreleased collects what is on `main` but not yet published. Publishing a version
means cutting that section with `node dev/bump.mjs <version>`, which dates it and
renames it, and then creating the GitHub release from the same section:

```sh
node dev/changelog.mjs notes 0.9.8 > /tmp/notes.md
gh release create v0.9.8 --title "v0.9.8 - <one line>" --notes-file /tmp/notes.md --verify-tag
```

The file is the single source for release notes; the release page is a copy of one
section of it. Publishing to npm started at 0.6.4 — the work before that release is
described in [docs/design-notes.md](docs/design-notes.md), which also carries the
report of each version in more detail.

## [Unreleased]

### Added

- **`execute_sql` takes `full_text`.** The long-text setting decides the default, but
  a single call can now ask for the whole value: `full_text: true` skips both the
  fragment summary and the 4000-character cap, for the case where the model is about
  to write that value somewhere else and half of it is worse than none.

- **Long text in query results is summarised before it reaches the model.** A new
  "Long text in results" setting on the Context optimisation card picks how cell
  values are rendered into the model context: `Fragment (head+tail)` keeps the first
  and last 50 characters of every cell longer than 200 characters and marks how much
  was cut, `Full value` passes the whole value through. The policy applies in the
  render step, so the underlying rows are never thrown away — the model just stops
  being flooded by walls of text. Binary/blob cells are untouched (they were already
  compressed to a size tag).

- **A ticked block of sources drags as one.** Grab the handle of any checked row
  and the whole selection travels together, keeping its own order, and lands above
  or below the row it was dropped on. Dropping on a group moves all of them.

- **Conversation limits are visible and removable on the data source list.** The
  limits an agent sets through `session_scope` are written by the agent and were
  otherwise permanent — the panel had no way to show or lift one. A *Conversation
  limits* card now sits under the source list, next to the global write switch: both
  answer who may touch which data. It gives every conversation a remove button and
  the whole set a "Clear all", and a conversation that is disposed or archived loses
  its limit automatically, so the list cannot grow forever. With no limit in place the
  card stays and says so, rather than hiding a feature that only appears once the agent
  has already used it. The card is a three-column table — conversation id, name, data
  sources — open by default, because an id, a title
  and a set of sources are three different kinds of thing and columns read across far
  better than a run-on line; the header sticks while the box scrolls. Each row names
  the conversation when the host knows its title and always shows the full id beside
  it — the id is what the file keys on, so abbreviating it made two conversations look
  alike. Archiving parks the limit instead of deleting it, and unarchiving hands it
  back: a limit you set on purpose should survive a trip through the archive. Removing
  one by hand forgets the parked copy as well, so an unarchive cannot resurrect
  something you deleted.

### Changed

- **The conversation-limit card left the Tools tab.** It had been folded in under the
  tool list, where a setting that only the agent writes is the last thing anyone looks
  for. It now lives on the *Data source list* tab with the global write switch, since
  both answer the same question — who may touch which data — and the Tools tab is back
  to being about tools.

- **The Context optimisation card collects the three output settings.** The row
  counts and the long-text setting are not per-tool decisions, so they no longer hang
  off the tool rows — where one number box sat far from the name it belonged to and
  the policy select trailed the end of the list. The Tools tab now has one card with
  the sample-row default, the query-row maximum and the long-text setting, one setting
  per line, each with a sentence saying what it does.

- **The global write switch moved out of diagnostics.** It lived in the Runtime tab
  among read-only facts, so the one control on that page read as another line of
  diagnostics. It now sits in the data source list's title row, right after the group
  box — the same row as the sources whose writes it governs — and the Runtime tab is
  pure information again. Its label reads **Global write** / **Global read-only**
  instead of "writes allowed" / "writes blocked", so the switch says what it switches
  rather than describing a state in passing.

- **Emptying a group deletes it.** Deleting the last source in a group removes the
  group too, instead of leaving behind an empty section nobody created. A group that
  was already empty before the delete survives — that one is a drop target the user
  made on purpose, and the two cases are told apart by whether the group held a
  source at the time of the delete.

### Fixed

- **`sslMode` was stored and never used.** The DBeaver importer copied the field
  into the source config, and both connection paths ignored it: a source that said
  `require` still connected in plaintext, which is the kind of failure nobody sees.
  PostgreSQL now gets `sslmode` and MySQL gets an `ssl` context; the two engines
  spell the levels differently and either spelling is accepted on either engine.
  Unset keeps the driver's own default, so nothing changes for an existing source.
  openGauss still skips certificate verification — that limitation is now written
  down in [docs/safety.md](docs/safety.md#tls) instead of being implicit.

- **A DBeaver connection behind an SSH tunnel was imported as if it were local.**
  DBeaver keeps the tunnel in `configuration.handlers` and writes the tunnel's
  *local* end into the connection fields, so the import produced a source pointing
  at `localhost` — it failed, or worse, reached an unrelated local server while the
  panel said the import succeeded. The importer now reads `handlers` first and
  reports the entry as not importable, naming the handler it found. Proxy handlers
  are treated the same way; a handler with `enabled: false` routes nothing and does
  not block.

- **A batch starting with `SELECT` could carry a `DROP TABLE` past the write guard.**
  `ensure_readable` looked only at the first keyword, so `select 1; drop table t` was
  classified as a read, the DDL switch was never consulted, and every statement in
  the batch reached the engine. The guard now splits the call first and refuses a
  batch outright: one statement per call, matching what the tool description has
  always said. Semicolons inside quotes do not split, and a trailing semicolon is
  still one statement.

- **`SET` and `PRAGMA` no longer count as reads by themselves.** Both were in the
  read whitelist, so `pragma journal_mode = wal` or `set default_transaction_read_only
  = off` passed on a read-only source. Each engine now has a short list of settings a
  read-only source may change — `search_path` and friends on PostgreSQL, `names` and
  the charset settings on MySQL, the reporting pragmas on SQLite — and anything else
  is treated as a change and refused.

- **A CTE that changes rows was rolled back as if it were a read.** `with gone as
  (delete from orders where id = 1 returning id) select * from gone` starts with
  `with`, so it was treated as a read and the surrounding transaction was rolled
  back: the agent was told the write succeeded while the rows stayed put. A CTE whose
  body contains `insert`, `update`, `delete` or `merge` now counts as a write, goes
  through the global switch, the read-only flag and the DDL check, and is committed
  on a writable source.

- **`EXPLAIN ANALYZE` of a write was treated as a read.** A bare `EXPLAIN` only
  plans, but `EXPLAIN ANALYZE` runs the statement it wraps — including a `DELETE`.
  The inner statement now decides.

## [0.9.10] - 2026-11-16

### Fixed

- **The writable switch on a data-source row can be flipped again.** 0.9.9
  re-posted the state a source was already in: clicking a read-only row sent
  `readOnly: true` and clicking a writable one sent `readOnly: false`, so the
  switch looked dead and the banner claimed the source had just become
  read-only. The switch is checked for "writable" while the API takes a
  `readOnly` flag, so the value posted has to be the opposite of the stored
  one. Both directions are now pinned by a unit test.

## [0.9.9] - 2026-11-16

### Changed

- **The writable-schemas allow list is gone.** A writable source may write to every
  schema its login can see; the per-source choice is now just the DDL switch. The
  gates drop from four to three: the global write switch, the per-source
  `readOnly` flag, and `allowDdl`. `server/writes.py` no longer resolves a
  statement's target schema, a save body that still sends `writableSchemas` is
  accepted but the key is not stored, and registries carrying the legacy
  `schemas` or `writableSchemas` keys have them dropped on mount.
- **DDL is a switch on the row**, beside the writable one — same 36×20 track, not
  a text note or a checkbox. It is disabled while the source is read-only, since
  it only means anything then. The unlock dialog is gone with the list it asked
  for: flipping a row writable is a plain toggle, and the bulk route no longer
  needs a schema answer.

## [0.9.8] - 2026-11-15

### Added

- **DDL is its own permission.** `allowDdl` sits beside `writableSchemas` and is off
  by default: a writable source may still refuse `create` / `alter` / `drop` /
  `truncate` / `rename` / `grant` / `revoke`, and the check runs before the target
  schema is even resolved, so a DDL statement is never half-judged. Omitting the
  field when saving keeps the current value, so a caller that does not know about it
  cannot switch DDL on or off by accident.
- **JetBrains Air** joins the one-click client list, written to
  `~/.jetbrains/mcp/mcp.json`.
- A **Star link** in the panel masthead.

### Changed

- **The panel is called *Data sources***, in the sidebar entry, the heading, the
  plugin card and the hints the Python server returns. The old name described the
  thing being connected rather than the thing being managed.
- **The row switch is a switch.** Read-only / writable used to be a pill that shared
  its shape with the plain-text notes beside it, so the only way to find the one
  clickable thing on a row was to hover. It is now a track switch; the schema list,
  the DDL state and a broken secret are plain text, and the first pill of the tab bar
  aligns to the page axis instead of hanging outside it.
- **Visual hierarchy across the panel**: cards carry a shadow, buttons gained hover
  and focus states, the primary action is filled rather than outlined, form focus
  rings are visible on the field, notices read as a bar rather than a box, and the
  tabs wrap instead of clipping the last one.
- **Tool rows are tighter**, and each tool has the same switch as a data source. The
  *Tools* tab now says that its list is DSH-only: a client connected to the HTTP
  endpoint still sees every tool, because the filter lives in the plugin.
- **Audit statements are readable**: each SQL statement sits in its own recessed block
  with a blue left rule (red when the call failed) and scrolls past about a dozen
  lines, instead of reading as another line of grey metadata.
- **Docs split by task**: `docs/guide.md` is the panel walkthrough, and the safety
  rules, the outside-client endpoint and the runtime/troubleshooting material moved to
  `docs/safety.md`, `docs/clients.md` and `docs/runtime.md` (each with a Chinese
  edition). The safety page gains a table saying which rules follow you out of DSH —
  the four gates do, the audit log, the tool list and the conversation-level limit do
  not.
- **Release notes live in this file.** The per-version `docs/release-*.md` pages are
  gone; `node dev/changelog.mjs notes <version>` prints the section a release page is
  built from, and `dev/bump.mjs` refuses to cut a version with nothing under
  `[Unreleased]`.
- **The design log caught up.** `docs/design-notes.md` had stopped at 0.6.5; it now
  describes the state the code is actually in (five drivers including openGauss, the
  four gates, the files under the runtime directory, the nine tools). Per-version
  history lives in this changelog and in `git log`, not in the design notes.

### Fixed

- **The HTTP endpoint restarted when the write switch flips.** `allowWrite` is read by
  the Python child at startup, so flipping it restarted only the stdio child and left
  every outside client on the old answer. The endpoint now restarts on the same port.
- A card with no header no longer renders an empty one: the list card draws its own
  header, and the unused one still took its height plus its margin — thirty pixels of
  nothing above the list.
- The endpoint address and its three controls share one line again, wrapping the
  controls underneath only when the panel is too narrow for both.

## [0.9.7] - 2026-11-14

### Added

- **Passwords are encrypted at rest.** `secrets.json` no longer holds plaintext: each
  source's password is an AES-256-GCM envelope (`v1.<iv>.<tag>.<ciphertext>`), opened
  with a 32-byte `secret.key` created beside it on first use (mode `0600`). The source
  id is the additional authenticated data, so an envelope copied onto another source
  does not decrypt. A runtime directory written by an older build is sealed on the next
  mount. Deleting `secret.key` revokes every stored password at once.
- **Writable schemas.** Turning a source from read-only to writable opens a dialog
  listing the schemas that source actually reports, one checkbox each; nothing is saved
  until at least one is ticked. The list is stored on the source as `writableSchemas`,
  survives a switch back to read-only, and comes back pre-ticked on the next unlock. The
  row shows it only while the source is writable, so a locked row never claims a
  permission that is not in force.
- **Architecture diagrams** in `docs/architecture.drawio` — three pages covering the
  file layout, the code call graph and the runtime picture — with PNG exports for the
  READMEs.

### Changed

- **A write is checked against the chosen schemas.** `server/writes.py` splits each
  statement on `;`, resolves the object it writes to (insert / update / delete / merge /
  truncate / DDL / grant / call, with `create index` resolved through its `on` clause)
  and refuses anything aimed outside the list. A statement whose target cannot be
  worked out is refused rather than guessed at. Reads stay unrestricted. The check runs
  in the Python server, so the panel, the agent and every external MCP client meet the
  same rule.
- The panel lists the schemas of a source from `list_tables`, which now returns them as
  a plain array alongside the tables.
- A source may not be writable with an empty list: both the single save and the bulk
  route refuse it with a `400`.

### Fixed

- A write that returns no result set is committed. psycopg raises "the last operation
  didn't produce records" when such a cursor is iterated, and that exception escaped
  before `connection.commit()`, rolling back a write the server had already applied.
- Long catalog names are readable in the structure browser: a name wider than the rail
  truncates with an ellipsis and keeps its full value in the tooltip, the kind pill
  beside it keeps its width, and a narrow panel stacks the tree above the column list.
- A registry from the earlier allow/deny build is migrated on mount: an `allow` list
  becomes `writableSchemas`, a `deny` list becomes an empty list (inverting "everything
  except these" would grant the whole catalog), and the old key is dropped.

## [0.9.6] - 2026-11-13

### Added

- **Streamable HTTP endpoint** at `http://127.0.0.1:8765/dsh-db-mcp`, started
  automatically with the plugin. The path follows `--path` / `DB_MCP_PATH`, and if 8765
  is taken the next free port is used.
- **Connect tab**: shows the endpoint and its port, starts and stops the service, and
  writes the MCP entry for VS Code, VS Code Insiders, Cursor, Claude Code, Claude
  Desktop and Codex in one click (HTTP for the editor/CLI clients, stdio for Claude
  Desktop and Codex).
- **Tools tab**: lists the nine agent tools with an individual switch, plus a default
  row count for `sample_rows` (20) and `execute_sql` (200). `mcp__db__session_scope` is
  deliberately not switchable — turning it off would strand a limited conversation.
- The Python server accepts `--stdio` / `--http` / `--sse` / `--host` / `--port` /
  `--path`, with `DB_MCP_TRANSPORT`, `DB_MCP_HOST`, `DB_MCP_PORT` and `DB_MCP_PATH` as
  equivalents.

### Changed

- READMEs rewritten around the **import → shared registry → shared MCP server** story,
  each opening with a one-page map of the whole flow, and a new bilingual usage map
  (`asset/usage-guide.en.png`, `usage-guide.zh.png`) with an optional "point another
  agent at the same server" step.
- Docs: a "Connect another agent" chapter, the `/http/*` and `/clients` routes, and the
  runtime requirements — **Node 22.5+** for the in-process SQLite probe, **Python 3.10+**
  for the bundled server (both floors come from the actual dependency metadata).

### Fixed

- The dependency list no longer touches its "Install / repair dependencies" button, and
  the row-count fields are centred on one column.
- "Default row count saved." now actually appears after saving a limit (it was posted as
  a bare string and rendered as an empty banner), and a failed save reports its error.
- The Connect tab only lists clients this platform can configure: VS Code paths resolve
  per OS (`APPDATA`, `~/Library/Application Support`, `~/.config`) and Claude Desktop is
  hidden where it does not exist.
- The client button says **Write config** instead of "Auto-configure" — it writes one
  file on click rather than silently configuring anything.

## [0.9.5] - 2026-11-12

### Added

- A one-page usage map in both READMEs.

### Changed

- The panel composites the active theme's translucent tokens into opaque surfaces, so
  custom and wallpaper themes no longer shine through the cards, and pure black / pure
  white schemes keep a readable three-level depth.

## [0.9.4] - 2026-11-11

### Changed

- The READMEs lead with the **DBeaver import**: point the panel at the connections
  DBeaver already knows, and the shared MCP server does the rest. Manual connection
  entry moved further down.

## [0.9.3] - 2026-11-10

Documentation release.

### Added

- The READMEs show what the plugin looks like: the data source list, the import page and
  the panel as a whole.

### Changed

- The guide spells out the two commands behind the panel's *Install / repair
  dependencies* button, so a failed environment can be fixed by hand.
- The download badge was removed; the install command is the count that matters.

## [0.9.2] - 2026-11-10

### Fixed

- **openGauss / GaussDB against real clusters**, found while testing a docker container:
  DBeaver entries typed `generic` are recognised by their URL scheme, `$n` placeholders
  bind as expected, `BIN$…` recycle-bin tables are hidden, passwords containing `#`, `?`
  or `/` survive the connection-string parser, and a failed row no longer shows an
  expand arrow with nothing inside it.
- The runtime tab reports the openGauss driver it will actually use.

## [0.9.0] - 2026-11-10

### Added

- **Per-conversation limits.** Ask a conversation to stay on a few sources and it calls
  `mcp__db__session_scope` with those identifiers. `list_datasources` then returns only
  the allowed rows, a call naming another source is refused, a call that omits
  `datasource` uses the single allowed row (or reports the choices), and an inline
  `test_connection` is refused so the list cannot be bypassed. `all: true` lifts the
  limit; no entry, or an empty list, keeps full access.
- The **Runtime** tab lists the conversations that carry a limit. Limits live in
  `sessions.json` (0600) next to `settings.json`.

## [0.8.0] - 2026-11-09

The panel became a connection manager, and a source can only exist once.

### Added

- **Data source list**: a status strip (MCP state, total sources, how many probed
  healthy, which ones failed) with the search box on its right; filter chips on their
  own row (All, one per group, Ungrouped, Only failures); rows carry an engine badge,
  the group label and inline probe results, and a failed row stays red with an
  expandable error block and a **Copy** button.
- **Adding a source**: the form is rebuilt around one connection string — a DSN, a JDBC
  URL, an Oracle TNS / `DESCRIPTION_LIST` descriptor, an openGauss cluster URL or a
  `.db` path fills everything in. Name, group, identifier, engine fields and the
  read-only switch live under **More settings**. **Test** next to **Save** runs the real
  login before anything is written. Connection string, user and password are required
  (SQLite needs only the file) and are marked in red before the first save attempt.
- Drag by the six-dot grip only: onto a group to move, onto the top or bottom half of
  another row to place it before or after. Ungrouped is always a drop target; groups
  fold from a caret and empty groups stay visible.
- The docs check (`npm run test:docs`) validates fenced blocks, table widths, relative
  links and heading anchors in every Markdown file.

### Changed

- **Restart MCP** moved to the *Runtime* tab, where the process actually lives; probe
  failures stay in the row they belong to instead of repeating in a banner.
- Runtime rows use the same card treatment as audit entries, and audit times carry the
  date on your own clock (the file keeps UTC).
- `package.json` declares `engines.dsh >= 0.2.0-rc.2` so the market can show the host
  requirement.

### Fixed

- One endpoint may exist once: the same host + port + database + user (SQLite: the same
  file) is refused with `409`, naming the row that already holds it. The DBeaver import
  enforces the same rule, including within a single batch.

### Removed

- **Set as default source.** With one list and one shared server the setting had nothing
  left to decide; `isDefault` is still read from an older registry but no longer written.

## [0.7.5] - 2026-11-09

### Added

- **openGauss / GaussDB connect**: their SHA256 authentication is outside what libpq
  negotiates, so the server drives them through `py_opengauss` with a cursor adapter and
  a psycopg fallback for md5 clusters. Multi-node URLs keep every host, and the panel
  shows `h1 +2:30100`.
- The structure view sends the table schema, so tables sharing a name across schemas stop
  colliding, and its tree groups by schema with folding and a filter.
- The DBeaver import pins its action bar, keeps *Import selected* in it, and filters
  connections by name, host or user.

### Fixed

- An Oracle `DESCRIPTION_LIST` pasted into the create form is recognised, including
  nested `ADDRESS_LIST` entries; the importer already read them.
- Audit rows show the date as well as the time, on your clock.
- The create form requires the connection string, user and password before saving
  (SQLite only needs its file) and marks the empty field in red.
- The structure view no longer repeats the source name under the card header.

## [0.7.1] - 2026-11-08

### Added

- **`docs/guide.zh.md`** (new) — a full Chinese translation of `docs/guide.md`, section
  for section: install and upgrade, the panel tabs, connection strings, the DBeaver
  import, connection tests, groups and bulk actions, the schema browser, the safety
  gates, the audit log, the runtime directory, the Docker test databases and the
  troubleshooting table.

### Changed

- `docs/guide.md` and `docs/guide.zh.md` carry an `English | 中文` switcher at the top.
- `README.zh.md` points its documentation table at `docs/guide.zh.md`; the English index
  lists English documents only.

No behaviour change: `server/`, `src/` and `client.js` are untouched.

## [0.7.0] - 2026-11-08

### Changed

- **Breaking:** `mcp__db__run_query` is now **`mcp__db__execute_sql`**. The tool always
  ran any single statement, and with writes enabled it does `INSERT` / `UPDATE` /
  `DELETE` / `DDL` and returns `affectedRows` — the old name implied SELECT only.
  Prompts that name the old tool need the new name.
- Install commands lost the `@latest` suffix: `dsh plugin --profile desktop add
  dsh-db-mcp` already resolves the newest version pnpm's cooldown allows.
- New `docs/guide.md`, `docs/reference.md` and `docs/development.md`; the old
  requirements document became `docs/design-notes.md` (a design log, not user
  documentation). Both READMEs lead with the zero-configuration story and link out.

## [0.6.10] - 2026-11-08

### Changed

- The README leads with the zero-configuration story and splits the manual
  installation steps into their own section.

## [0.6.9] - 2026-11-08

### Fixed

- The Python child process is handed a short environment allowlist instead of the whole
  parent environment.
- The Host's version string stays in step with `package.json`, so the panel and
  `/health` cannot report the previous release.

## [0.6.8] - 2026-11-08

### Added

- Clicking a source's read-only pill flips it, without opening the edit form.

### Fixed

- **Writes are committed on every backend.** MySQL, PostgreSQL and Oracle rolled the
  write back after applying it: the commit branch asked `connection_autocommit(kind)`,
  which only answered true for SQLite. The decision now follows the statement, and a
  write reports `affectedRows`. SQLite commits as well, since `sqlite3.connect` uses a
  legacy implicit transaction.
- Audit timestamps follow the viewer's time zone instead of slicing the stored UTC
  string, and a full local timestamp is available on hover.

### Changed

- The README is rewritten in English with a Chinese translation alongside it.

## [0.6.5] - 2026-11-08

### Added

- Rename a group or a source by double-clicking its name.
- The publish workflow gains a Python toolchain, so the server suites run before a
  release.

## [0.6.4] - 2026-11-08

First published version, and the point this changelog starts from: everything before
it shipped as a single unreleased tree.

### Added

- Nine MCP tools over SQLite, PostgreSQL, MySQL, Oracle and openGauss: `test_connection`,
  `list_datasources`, `list_tables`, `describe_table`, `sample_rows`, `execute_sql`,
  `explain_query`, `get_ddl` and `session_scope`.
- **DBeaver import**: reads the connections DBeaver already knows, including URL-only
  entries and their saved passwords, and skips the ones already configured.
- The panel: masthead with back-to-chat, tabs for sources / runtime / audit, a structure
  browser, groups with drag-and-drop, bulk test and delete, and an audit log.
- Read-only by default; a source becomes writable only when you say so.
- Publishing through npm trusted publishing, so no token lives in the repository.

[Unreleased]: https://github.com/halcyon6669/dsh-db-mcp/compare/v0.9.10...HEAD
[0.9.10]: https://github.com/halcyon6669/dsh-db-mcp/compare/v0.9.9...v0.9.10
[0.9.9]: https://github.com/halcyon6669/dsh-db-mcp/compare/v0.9.8...v0.9.9
[0.9.8]: https://github.com/halcyon6669/dsh-db-mcp/compare/v0.9.7...v0.9.8
[0.9.7]: https://github.com/halcyon6669/dsh-db-mcp/compare/v0.9.6...v0.9.7
[0.9.6]: https://github.com/halcyon6669/dsh-db-mcp/compare/v0.9.5...v0.9.6
[0.9.5]: https://github.com/halcyon6669/dsh-db-mcp/compare/v0.9.4...v0.9.5
[0.9.4]: https://github.com/halcyon6669/dsh-db-mcp/compare/v0.9.3...v0.9.4
[0.9.3]: https://github.com/halcyon6669/dsh-db-mcp/compare/v0.9.2...v0.9.3
[0.9.2]: https://github.com/halcyon6669/dsh-db-mcp/compare/v0.9.0...v0.9.2
[0.9.0]: https://github.com/halcyon6669/dsh-db-mcp/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/halcyon6669/dsh-db-mcp/compare/v0.7.5...v0.8.0
[0.7.5]: https://github.com/halcyon6669/dsh-db-mcp/compare/v0.7.1...v0.7.5
[0.7.1]: https://github.com/halcyon6669/dsh-db-mcp/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/halcyon6669/dsh-db-mcp/compare/v0.6.10...v0.7.0
[0.6.10]: https://github.com/halcyon6669/dsh-db-mcp/compare/v0.6.9...v0.6.10
[0.6.9]: https://github.com/halcyon6669/dsh-db-mcp/compare/v0.6.8...v0.6.9
[0.6.8]: https://github.com/halcyon6669/dsh-db-mcp/compare/v0.6.5...v0.6.8
[0.6.5]: https://github.com/halcyon6669/dsh-db-mcp/compare/v0.6.4...v0.6.5
[0.6.4]: https://github.com/halcyon6669/dsh-db-mcp/releases/tag/v0.6.4
