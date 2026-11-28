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
- **Share a graph between machines.** A new **Share** tab exports one data source's
  relation graph and every scene as a single JSON bundle (no passwords, connection
  details or result rows), previews an import before writing anything, applies it
  atomically, and can undo exactly that import by its `importId`. The panel reaches
  it through `GET /bundle/export` and `POST /bundle/preview|import|undo`, backed by
  a thin Python CLI — no new MCP tool. Per-edge fingerprints and ids in the file
  are ignored in favour of locally recomputed ids. **Trust is never inherited;
  a confirmation is only a reference**: an imported edge's status is decided by
  the local cached catalog first, then the sender's status as a hint — a missing
  table/column, incompatible types or no catalog to check forces `pending` (with
  a downgrade reason), while a catalog-checked `confirmed`/`trusted` arrives as
  `confirmed` with `confirmCount` reset to zero. A preview toggle chooses
  "use the sender status" (default) or "make every join pending"; the preview
  reads no connection and writes nothing. **Refresh directory** fills the local
  table/column catalog (metadata only, no row data); the cache is also filled as
  you browse catalogs, is timestamped, and a cache older than seven days is
  treated as stale — a hint that still lets you continue. Imports run under a
  lock, re-read the current graph, detect a stale preview, write 0600 temp and
  final files (POSIX), and can be undone by `importId`.
- **An edge now knows what it costs.** `propose_relation` and `feedback_relation`
  read the target column's index and the table's row estimate from the catalogue
  (`pg_class.reltuples`, `information_schema.TABLES.TABLE_ROWS`, `ALL_TABLES.NUM_ROWS`
  — an estimate, never a `count(*)`), every trace records how long each step actually
  took, and each edge keeps the last five durations with `lastMs` / `avgMs`. The
  Relations tab shows whether the target column is indexed and the average step cost;
  the Trace tab shows each step's `ms`.
- **A full table scan asks before it runs.** A step whose target column has no index
  and whose table the catalogue estimates at a million rows or more is not executed:
  it comes back as `status: "needs_confirm"` with the statement omitted, and the Trace
  tab offers **Run it anyway**, which re-runs the trace with `confirm_slow: true`.
  An unknown row estimate or an unknown index never blocks a trace.
- `feedback_relation` takes `ms`, so a confirmation made outside a trace still
  carries its measurement.
- **The cost thresholds are yours to set.** What used to be four constants in
  `server/relations.py` — the slow-step cut-off (200ms), the timing window (5 steps),
  the samples trust needs (3) and the large-table cut-off (a million rows) — now lives
  in `settings.json` under `cost` and has a **Cost thresholds** card on the Relations
  tab. The Python server re-reads them on every decision, so a change applies to the
  next trace without a restart. The fanout cap stays a constant.
- **Scenes.** A scene is a named set of tables for one datasource, managed with
  `list_scenes`, `save_scene` and `delete_scene` (and the `/scenes` routes). A scene
  owns no joins: it only says which tables a walk may read, so deleting one loses no
  edge. Passing `scene` to `trace_by_key` narrows the walk to those tables — a join
  leading out of the set is not followed, and the table it would reach is reported
  under `outside` with the join and the reason.
- **A walk comes back as a graph, not only a list.** `trace_by_key` now returns
  `nodes`: the same steps linked by the join that reached each one, with `children`
  under every node. `steps` stays the flat list and the only source of truth — the
  graph is a reading of it. Each node also carries its `condition` (with the bound
  `binds`), `sql` and `sample`, so a reader can render a step without re-reading
  `steps`. A table the walk already read is not reported a second time: its rows came
  from upstream, so a repeat would only show the same data twice. The walk skips such
  a candidate instead, which also means a cycle walks every table exactly once instead
  of fanning out forever. The entry probe reports every candidate it tried with its row count
  (`entry.candidates[].matches`), so a value that lives in several places can be
  started from the one that was meant.
- **The Trace tab draws that graph.** The walk is no longer a list of steps: it is one
  column per depth from left to right, one box per table the walk reached, and every
  join drawn as a line labelled with the pair of columns it compares — so the shape of
  the walk is the whole view instead of a picture next to a list. Clicking a box reads
  that step underneath it: the values it was bound to, its rows with the bound column
  highlighted, and the ✓/✗ judgement for the join. Each lane is ordered by where its
  parents landed in the lane to the left, so no two joins cross and each join label
  sits in its own gutter where no curve can run through it. The graph is the only
  view of a walk — the flat list is gone.
- **The graph zooms instead of shrinking to fit.** A walk that fans out into five
  lanes does not fit any card, and scaling the text down to fit makes the labels
  unreadable. The picture keeps its own size behind a scroll box and the reader
  scales it from 40% to 250%, with the percentage itself resetting to 100%. Zooming
  changes only the rendered size — the viewBox is untouched, so no lane is re-laid
  out and no label is re-wrapped.
- **A walk can be saved as a scene.** The Trace tab offers **Save as a scene** beside
  the summary: it names the walk (default: the entry table) and stores the tables it
  actually read, so the same scope can be picked next time instead of narrowed by
  hand. A scene of that name is overwritten rather than duplicated, and the form says
  so before the save.
- **A Scenes tab, for the set itself.** Scenes in the tab bar edits a scene as what it
  is — a membership list: name and note, member tables added from the source's own
  catalogue with a search box, the confirmed joins between members as `a.col → b.col`
  (pressing one opens that edge in the Relations tab), and a separate group for members
  no confirmed join reaches, each with **Add a connection** that opens the Relations
  form. Deleting a scene asks twice and says in the confirmation that no connection is
  deleted, because a scene owns none.
- **`list_scenes` tells you how a scene connects.** Each scene now carries `edges` (the
  `confirmed`/`trusted` joins whose both ends are members, as `{ id, from, to, status }`)
  and `isolated` (the members no such join reaches). Both are read from the relation
  graph on every call and never written to the scene file, so an agent can see the
  shape of a scene before it walks one. The tool result renders those fields as text —
  tables, confirmed joins and stranded members — and the published `trace_by_key`
  description tells the agent to check `list_scenes` first when a question describes a
  business process, passing a matching scene's name as `scene`.
- **A scene can be read as its business stages.** `save_scene` now takes `stages`:
  an ordered list of `{ name, table, locate, displayColumns, statusColumn,
  statusLabels, amountColumn, timeColumn }` (up to four display columns, stage
  tables must be members). `trace_by_key` returns a `stages` view — one row per
  declared stage in business order instead of the BFS walk order — with a grey
  **not found** placeholder naming the stage the walk missed, folded SQL/binds/
  timing/edge detail, and status/amount/time read from the sample through the
  scene's own labels. A free walk still has no `stages`. The Trace tab gains a
  **按场景运行 / free trace** switch: the scene mode reads one row per stage,
  keeps feedback only on pending edges, abnormal fanout and empty steps, and
  folds the rest behind a `⋯` menu.
- **A scene can name its business keys, and match loosely where no join exists.**
  `save_scene` now takes `aliases` (`{"流水号": [{"table": "t_order", "column":
  "order_no"}]}`, up to 20 keys and 50 columns in total), `input_alias` (which key the
  typed value is typed into, required as soon as a stage locates by alias) and
  `weak_match` (`{ fromStage, fromColumn, toColumn, op }` with `op` equal, same day
  or within N minutes). A stage whose term is not a column name can therefore be
  reached by `locate: "alias"` — the value is bound to each target column by its
  family, so the same key works whether the column is text or numeric, and a value a
  column cannot hold is skipped with a warning instead of failing the walk. A
  `locate: "weak"` stage is reported under `stages.weak` with the rule it matched on
  and its IN list capped at 50 values, but never becomes a walk step: it does not
  seed the walk, is not counted in `tablesHit` or `steps`, and is never written into
  the relation graph. Every alias and weak lookup runs bounded, parameter-bound and
  under the statement timeout; a timeout marks the stage `incomplete` instead of
  "no row". A scene whose member or column disappeared marks the key `stale` rather
  than dropping it silently.
- **`preview_aliases` tries a saved scene's business keys before you trust them.**
  It returns one row per alias column — table, column, type, hits, a few real
  samples, the time it took and a warning — with a 0-hit key called out, a
  disagreeing type family flagged, and a stale catalog name reported instead of
  guessed at. Names are whitelisted against a live `describe_table`, so a scene file
  cannot name a column that reaches SQL, and neither samples nor hit counts are ever
  written to the audit log. The Scenes page runs it from the editor: the Save button
  asks for an explicit acknowledgement when a previewed key found nothing.
- **The scene editor and the stage rows show the new reading.** The Scenes page gains
  a **business keys** block (one card per key, a column picker per member table and a
  radio marking the input key), a **preview** table and a **weak links** block. The
  Trace tab's stage rows carry a dashed style for a weak row, a warning style plus the
  reason for an incomplete one, the matched-on rule text, and an "IN list was
  truncated" note — so a loose match is visibly a hint, not a walked step.
- **Every refused scan is one decision, not one run per step.** `trace_by_key` now
  returns `confirmTargets`: each hop it declined to run, with the table, column, the
  catalog's row estimate, the edge id and why it was refused (no index on a large
  table, or a timing window that is persistently far over the slow threshold — a
  series of bad samples now asks on its own, whatever the table's size). `confirm_slow`
  takes the **edge ids** the caller has agreed to pay for; only those steps run, and
  the rest still come back as `needs_confirm`. A bare `true` names no step, so the
  agent tool ignores it — the panel is the one caller allowed to waive the check, and
  it asks with one checkbox per target, smallest table ticked by default, no "run
  all". Every approval is written to the audit log as edge ids and a count, never the
  rows they read, and an approved scan that hits the statement timeout comes back
  marked `timedOut` instead of looking like an empty result.
- **A scene says what it would cost before you walk it.** `list_scenes` returns
  `costly` — the joins inside the scene that would read a whole table, each with its
  edge, table, column, row estimate and reason. It is computed from the join facts
  already on disk, so opening or saving a scene runs no statement at all. The Scenes
  page shows it above the isolated members, and the cost hint is a label, not a query.
- **The relation graph answers what joins what.** The catalog used to answer that
  question in two places — `describe_table` repeated each table's foreign keys, and
  `list_relations` flattened a whole schema — so the answer a model read was not
  the answer a walker would follow. Both are gone. `discover_relations` imports the
  declared foreign keys into a per-datasource graph stored in
  `relations/<sourceId>.json`, `propose_relation` records a join the catalog does not
  declare, and `list_edges` reports every edge with its source (`fk`, `manual`,
  `inferred`, `audit_mined`), status (`pending`, `confirmed`, `trusted`, `stale`,
  `rejected`), optional `condition`, and counts. A proposed edge starts `pending` and
  is not followed until it is confirmed.
- **`trace_by_key` follows a value across tables.** Give it a value and it finds
  where the value lives, then walks the relation graph hop by hop — reporting each
  table, the condition it used, the statement it ran, how many rows came back, and
  which edge carried it there. It follows only `confirmed` and `trusted` edges; a
  pending edge that would have continued the walk is listed separately with the
  reason, and a step with no rows is reported as the place the chain breaks rather
  than silently ending the trace. Values are always bound parameters, so the SQL it
  reports is safe to log, and `max_depth` (1–6) and `max_rows_per_table` (1–200) bound
  the work.
- **An edge now has a state machine, and trust is measured rather than assumed.**
  `feedback_relation` records what a trace step showed. `ok` is the only verdict
  that confirms an edge; `too_many` (with `wrong_column`, `needs_condition` or
  `not_unique`) and `missing` make it `stale`, which stops the walker following it
  until the column is fixed or the condition is added; `irrelevant` sends it to
  `rejected`, the blacklist only a fresh `propose_relation` can lift. An edge
  becomes `trusted` — followed without asking again — only after three
  confirmations, with no rejection left standing, on an indexed or unique reference
  column, with an average fanout of 5 or less; that badge is recomputed on every
  confirmation rather than latched, so a join whose fanout grows falls back to
  `confirmed`. `set_relation_condition` attaches the predicate a join needs without
  changing its status, and `delete_edge` removes a typo outright. Traces now report
  per-step fanout so a caller can pass the measured figure back.
- **The relation graph has a page of its own.** The panel gained a **Relations**
  tab: pick a data source, then read its edges as a list — each row shows the join
  path (`t_line.trans_id → t_trans.id`), a status chip, the source, and how many
  times it was confirmed. Filter chips narrow the list to all / pending / confirmed
  / stale while the counters keep counting the whole graph, so a filter never hides
  how much work is left. A pending edge offers confirm, reject (with the reason that
  made the trace wrong) and add-condition; a stale edge shows what failed last and
  offers a re-check or a delete; a rejected edge can be re-opened; a confirmed or
  trusted edge shows its confirmation record. The page only calls the graph tools
  through dedicated routes — it cannot run SQL.
- **The trace result has a page too.** The **Trace** tab takes one value plus an
  optional entry table, entry column and direction, and shows the walk as numbered
  steps: the table, the condition with its bound values, the row count, a few sample
  cells, the edge that carried it there, and that edge's status. Steps where the
  chain broke (`0 rows — the chain stops here`), where the read was capped, or where
  a warning was raised are marked in place; edges that were not followed because
  they are still pending are listed separately with a pointer back to the graph. Each
  step can be judged right / too many (with a reason) / missing / unrelated, and the
  judgement is recorded against the edge behind it — so a wrong walk is also how the
  graph gets corrected. The page accepts a value and never a statement: the SQL is
  built server-side from the graph and bound as parameters, and the value itself is
  never echoed back into the page.
- **Joins can be mined out of the audit log.** Plenty of schemas declare no foreign
  keys at all, yet the statements that already joined those tables are sitting in
  `logs/audit.jsonl`. `mine_relations` reads the `execute_sql` and `explain_query`
  lines, parses the equalities in their `on` clauses, and turns the recurring pairs
  into edges — no statement is run again and no row data is involved. The statement
  says the columns are equal, not which side owns the other, so the catalog decides:
  the side whose column is a primary key or a single-column unique index becomes the
  parent. A pair where neither side looks unique, or where both do, is reported under
  `ambiguous` and left out of the graph instead of being guessed — the walker follows
  every confirmed edge, so a wrong one is worse than a missing one. Mined edges
  arrive `pending` with source `audit_mined`, and a source is never weakened (`fk` >
  `manual` > `audit_mined` > `inferred`), so re-mining cannot relabel a declared key
  or downgrade a hand proposal. The Relations page gained a **Mine the log** button
  beside **Import foreign keys**.
- **Joins can be mined out of a project's source tree too.** The log miner only sees
  statements that already ran, which is nothing on the day a schema is first
  explored — but a Spring Boot project has written its joins down. `scan_code_relations`
  reads a project directory and takes SQL from exactly three places: mapper XML
  (`select`/`insert`/`update`/`delete`/`sql`, with `<if>`/`<foreach>`/`<where>`
  flattened the way MyBatis builds them), `@Select`/`@Insert`/`@Update`/`@Delete`
  annotations, and MyBatis-Plus fragments (`.apply`, `.last`, `.inSql`, `.exists`,
  `.notExists`, `.having`). Every other string literal is skipped on purpose: a log
  message or a regex read as SQL would invent tables, and a scanner that guesses is
  worse than one that finds nothing. `build`, `target` and `.git` are skipped so
  generated copies do not count twice, and each edge records the `file:line` it came
  from. Direction and ambiguity work exactly as in the log miner — the catalog decides
  the parent side, and an undecidable pair is reported rather than guessed — and the
  edges arrive `pending` with source `audit_mined`. Nothing is executed: the files are
  read, never run. A project that only uses `BaseMapper` and single-table wrappers
  reports zero, which is the correct answer for it.
- **The audit log loads more as you scroll.** The panel used to show only the
  newest 12 calls with no way to reach the older ones. A **Load more** button now
  sits at the bottom of the audit card while entries remain, fetching the next
  page without losing the ones on screen; it disappears once every stored line is
  shown. `GET /audit` now returns a `total` alongside the page so the panel knows
  when to stop.
- **Every outside client can be configured for stdio or HTTP.** The client card
  used to decide the transport itself: Claude Desktop and Codex always got a
  stdio entry, while VS Code, Cursor, JetBrains Air and Claude Code had to have
  the HTTP endpoint running before they could be configured. Each client row now
  has two buttons — **Write stdio** and **Write HTTP** — so any of them can run
  this server as a child process with no port open, or use the shared endpoint.
  Writing one form replaces the other, and the configured pill shows which form
  is in place. `POST /clients/configure` takes an optional `transport`; omitting
  it keeps the old per-client default.
- **A Spring Boot project can be scanned from the panel.** `scan_code_relations`
  already read a repository, but only an agent could reach it; the Relations page now
  has **Scan a project** beside *Import foreign keys* and *Mine the log*. Type the
  folder or pick it with the host's directory dialog, then read back the counts, the
  pairs the catalog could not orient and the files the scanner could not read — both
  lists always shown, because a scan that quietly dropped half a project would look
  identical to one that found nothing. Every edge a scan creates still arrives
  `pending`.
- **The scanner reads the MyBatis that real projects write.** `<include refid>`
  fragments are expanded (and a `<choose>` contributes one branch, not all of them),
  `@Select` strings concatenated over several lines and in `{...}` array form are one
  statement each, `<resultMap>` `<association>`/`<collection>` entries that carry both
  `column=` and `select=` become the join that convention stands for (resolved across
  mapper files), and equalities are found in every shape SQL writes them: inner/left
  joins, comma-separated `from` lists with their `where`, Oracle `(+)` outer joins,
  and correlated `in (select …)` / `exists (select …)` subqueries. Table names are
  compared case-insensitively, and a spelled-out schema stays a hint instead of
  becoming part of an edge's identity.
- **An edge remembers where it was read from.** Edges carry `places` — the
  `file:line` spots a scan found the join in, up to ten, merged when a later scan
  finds it written again somewhere else — and the Relations page prints them under the
  join path. A catalog key or a hand proposal carries none, because it did not come
  from a file.
- **A stdio client that spawns the entry itself now writes audit lines too.** Only the
  HTTP child used to own a `logs/audit.jsonl`; a Claude Desktop or Codex process started
  from the printed stdio entry had its calls recorded by nobody, because they never come
  back through the Host. That entry's `env` now carries `DB_MCP_AUDIT=1`, so the process
  that ran the statement writes the line and stamps it with the client name from the MCP
  handshake. The Host's own stdio child is still started without the variable and keeps
  having its calls recorded by the Host, so one call is still one line.
- **Every panel switch is live, in every process.** `allowWrite`, `textPolicy` and the
  row defaults used to be read once, when a Python child started, which is why flipping
  the write switch had to replace both children — and could never reach a stdio process
  an outside client had started. The Python side now re-reads `settings.json` per call
  (`server/store.py` `load_settings`, comparing the file's bytes so an unchanged file
  only costs a read and no parse), `audit.enabled()` already did, and the Host reads
  the row limits per call as well. A restart is no longer part of saving a setting.

### Changed
- **Trust is withdrawn when the measurements turn, and a rejection resets the count.**
  `trusted` used to need three confirmations and "no rejection left standing", which
  meant one rejected edge could never earn trust again however many times it was
  confirmed. It now needs three confirmations **in a row** after the most recent
  rejection: `too_many` and `missing` clear the run, while `irrelevant` — "this edge
  has nothing to do with the value" — no longer counts as evidence about the join at
  all, and `rejectCount` is kept for the history and the panel rather than as a gate.
  In the other direction, a trusted edge whose majority of recent samples are over the
  slow threshold drops back to `confirmed` and says so once in its history; a single
  slow sample among fast ones still changes nothing, because an average that hides the
  one bad step is exactly what the timing window exists to prevent. `cost_of` now also
  returns the `timings` list, so the panel can show the samples rather than only their
  average.
- **Numbers and verdicts read as words, not internal tokens.** A judgement notice
  now says *Confirmed this step* / *Flagged: too many rows* instead of printing
  `ok` / `too_many`, and a step status is shown through the scene's own labels.
  The graph's "fanout N" reads "N row(s) per value on average", and "index
  unknown" is only shown where it changes a judgement, not on every join.
- **The panel reopens where you left it.** A position used to last only as long as the
  page stayed mounted: open the panel again and it was back on the first tab with every
  box empty. The tab, the search text, the filter chip, the folded groups, the
  Relations and Trace inputs and a half-typed *new source* form now live in one
  `localStorage` key (`dsh-db-mcp:panel`), so reopening lands on the same tab with the
  same text. A remembered tab that no longer exists falls back to the list, a draft is
  stored with its password blanked, a pasted connection string is kept only when it
  carries no password, and storage that is unavailable simply drops the memory.
- **The last answer comes back too.** Inputs were only half of it: closing the panel also
  lost the walk on the Trace page and the edges on the Relations page. Both are now kept
  in the module's memory, so reopening returns to the same graph, the same picked step,
  the same folded rows and the same zoom. They are deliberately *not* written to
  `localStorage` — a result is derived data the server can produce again and it carries
  table rows, which do not belong in a store any script on the origin can read. A full
  page reload starts empty, which is also when the connection may be gone.
- **The Trace tab has one view, and it does not cross itself.** The flat list and the
  Graph / Flat switch are gone: a walk is read as the graph and nothing else. Because a
  table is now reported once, the graph is a tree — every box hangs off exactly one
  parent one lane to the left — so laying each lane out in the order its parents sit in
  is enough to leave zero crossings. The barycentre passes that tried to minimise
  crossings for a multi-parent DAG are gone with them.
- **`trace_by_key` no longer reports `repeated`.** The `repeated` flag on a step and
  `summary.repeated` are gone, and a step or node for a table the walk already read is
  no longer emitted at all.
- **A step's rows arrive open, and there are more of them.** The picked step used to
  open folded, so checking what it read meant one more click; the rows are now shown
  already, with **Fold** to put them away. The sample keeps up to 10 rows instead of 3
  (still the first few columns, primary key and bound column first) — enough to see
  whether a fanout looks right without re-running anything.
- **An index is no longer a condition for trust.** An edge becomes `trusted` after
  three confirmations, with no rejection left standing, an average fanout of 5 or
  less, and its recent steps all faster than 200ms — at least three measured ones, so
  an edge nobody timed stays `confirmed`. An unindexed column that is genuinely fast
  earns trust all the same, and an edge whose steps slow down falls back.
- **Select all on the source list means all of what is shown.** Ticking a dozen rows for
  a bulk action used to be a dozen clicks. The list header now has a button that takes
  the rows the search box and the filter chip left visible, and says how many in its
  label; pressing it again clears the selection. Rows hidden by a filter are never
  pulled in, so narrowing the list narrowing the selection stays true; with nothing
  narrowed the button is simply every source there is.
- **A stranded scene member says why, and offers the next step.** The isolated group no
  longer treats two different situations alike: a table with no confirmed join at all
  reads differently from one whose joins all lead to tables outside the scene, which
  now offers a one-click **Add {table} to the scene** that saves the membership list
  (never an edge). Opening **Add a connection** on a member also offers up to five
  target columns from other members, matched by name and a compatible type from the
  catalogue — each labelled `table.column` with the reason "same column name" — and
  only writes a pending edge when a suggestion is clicked. Where no column matches, the
  old add-join form is still one click away.
- **A join suggestion ignores a column every table happens to have.** Offering
  `id → id` for two unrelated tables is noise: nearly every table carries one, so the
  match says nothing about how they relate. Candidate columns now skip the bare
  `id`, `code`, `name`, `status`, `type`, `created_at` and `updated_at`; a prefixed
  name such as `order_id` or `customer_code` still counts, because that prefix is
  the evidence.
- **`npm test` now covers the MCP client too.** `dev/mcp.test.mjs` already checked
  the tool surface an agent sees, but nothing ran it: it is part of `npm test` now.
  Its query checks need a SQLite source, which a machine without one cannot offer, so
  that one check reports itself as skipped instead of failing — a green run no longer
  depends on what happens to be registered here.
- **The README says exactly what the panel runs.** The old line claimed the panel
  only did catalogue reads, which stopped being true when the Trace and Scenes pages
  arrived: both run read-only statements built server-side from the relation graph,
  and the structure browser is the one that only forwards `list_tables` and
  `describe_table`. Both READMEs now say that, and `docs.check` fails if their tool
  tables drift from the tools actually registered — so a new tool cannot ship
  undocumented.
- **The Scenes page was looked at in a browser, both themes.** A screenshot pass over
  the picked scene, a new draft, the walk's save-as-scene form and a relation jump
  caught three things a source-level test cannot: join paths were cut off at 420px and
  now wrap, the table picker showed every table in a wide schema at once and now shows
  twenty with a count of the rest, and the save-as-scene form had two *Cancel* buttons
  — the opener now steps aside once the form is open. Jumping to a join also marks its
  row as focused. The data that pass needed — a scene with one member nothing joins and
  one whose joins all lead out of it — is checked in under `dev/fixtures/scenes-isolated/`,
  so the pass can be repeated and the fixture itself is guarded by tests.
- **VS Code is configured through the Copilot harness file.** VS Code 1.147 and
  newer read MCP servers from `$COPILOT_HOME/mcp-config.json` (the Copilot CLI
  file, `~/.copilot/mcp-config.json` by default) and treat the per-profile
  `mcp.json` as a deprecated destination — entries there keep working through
  editor forwarding, but VS Code puts a **Migrate MCP Server** banner on them.
  The VS Code row now writes the Copilot file with the portable entry shape
  (`type` plus `tools: ["*"]`), and the separate VS Code Insiders row is gone
  because both channels share that one file. Writing it also removes a stale
  `dsh-db-mcp` entry from the deprecated profile files (other entries are left
  alone), so the server is not registered twice and the banner has nothing to
  point at.

### Removed

- **`list_relations` and `describe_table.foreignKeys` are gone.** Two copies of the
  same answer invited a model to read the one the walker would not use. The catalog
  still holds the foreign keys, and `discover_relations` still reads them — it just
  puts them in the relation graph instead of answering per call. `engines.list_relations`
  stays as an internal helper.

### Behavior changes

These change what an existing caller observes; they are collected here so an
upgrade can be reviewed before the version is cut. No version number is changed
by this section.
- **`confirm_slow` is now a list of edge ids, not a boolean.** It used to be
  `confirm_slow: true` meaning "run everything"; it now takes exactly the ids the
  caller has agreed to pay for (`confirm_slow: ["e_1a2b", …]`), and only those
  steps run. On the **agent** path a bare `true` is deliberately ignored — a
  blanket yes is how a whole table gets read by accident — so an agent that still
  sends the old boolean must change to the list and, before doing so, must ask the
  person which joins they agree to. The **panel** HTTP route is the one caller
  allowed to waive the check; it collects the ids from the checkbox bar, so people
  using the UI need do nothing. The result now also carries `confirmTargets` —
  every hop that was refused, with its edge id and reason — where before a refusal
  was only a warning line. Approvals are written to the audit log as edge ids and a
  count, never the rows they returned.
- **Trust needs three consecutive confirmations after the last rejection.**
  `trusted` used to require "no rejection left standing", which permanently
  blocked an edge that had ever been rejected. It now requires `confirmCount >= 3`
  *since the most recent rejection*: `too_many` and `missing` reset that run, so
  the next three `ok` verdicts re-earn the badge. `rejectCount` is no longer a
  gate — it is kept for the audit trail and the panel only. `irrelevant` no longer
  counts as evidence about the join either: "this edge has nothing to do with
  this value" says nothing about whether the join is correct, and that verdict is
  still undone by proposing the edge again.
- **Trust can be withdrawn from measured cost.** A `trusted` edge whose majority
  of recent timing samples exceed the slow threshold now drops back to `confirmed`
  when a trace reports its timings, with one `trust withdrawn` line in the edge
  history; a single slow sample among fast ones does not. `cost_of` also returns
  the `timings` window, not just `lastMs`/`avgMs`.
- **Saving a setting no longer replaces a Python child.** Flipping the write switch
  used to restart both children, which meant a brief window with no endpoint and, for
  the stdio process an outside client started, no effect at all. The switches are
  re-read per call now, so the PID stays put and the next statement sees the new answer.
  Only the disabled-tool list still re-registers the tools, because that list is applied
  once, when the Host publishes them.
- **Business-key and weak-match lookups now take the same approval gate as a walk
  step.** A costly alias or weak query is refused and listed in `confirmTargets`
  with a `query id` rather than a relation edge id — `alias:<hash(table,column)>`
  or `weak:<hash(fromTable,fromColumn,toTable,toColumn,op,minutes)>` over
  case-folded names. A caller that approves by edge id alone will not approve these:
  it must pass the query id from `confirmTargets`. These ids are **not** valid for
  `feedback_relation`. A refused stage reads `pendingConfirm: true` and keeps the
  rows already found instead of showing 0 rows or "not found". Callers that use the
  panel need do nothing; the checkbox bar handles query ids and walk-edge ids alike.
- **How old files are handled on upgrade.** Existing `relations/*.json` and
  `scenes/*.json` are read as-is — no migration step, no file rewrite on load. An
  old edge has no `timings`, `indexed` or `rowEstimate`: it keeps its saved
  `status` (an old `trusted` edge is **not** demoted just by upgrading, and an old
  `confirmed` edge is **not** promoted without new measurements), its cost reads
  as `timings: []` / `needsConfirm: false` / unknown row estimate, and the first
  trace that walks it fills in the timings. An old scene has no `stages`,
  `aliases`, `inputAlias` or `weakMatch`: these read as empty lists / no input
  alias, and saving after the upgrade adds them without losing the scene's id or
  membership. `dev/upgrade.test.py` writes the exact 1.1.0 file shapes and asserts
  all of the above, so the behaviour is checked on every test run.

### Fixed
- **An audit-log review tightened the guarantees.** `load_settings()` no longer
  carries an unreachable second `return`. Regression tests now assert that a
  recorded line still omits binding values, a password argument and result rows
  even when the audit switch is on, so none of them can leak into the log file.
  Recorded SQL is now written with single-quoted literals replaced by `?` before
  the 2000-character cut, so a phone number, an ID card number or a name pasted
  into a predicate no longer survives in `logs/audit.jsonl` — only the statement
  shape and its table names do.
- **The Scenes / business-key / weak-link pass.** A batch of fixes to how a scene
  is previewed, saved and read: **Try it** now previews the keys in the unsaved draft
  (not only the last saved scene) and a 0-hit key is flagged independently of any
  type warning, so the acknowledgement checkbox can no longer disappear; new scenes
  get a random id so renaming one frees the name, and renaming onto an existing name
  is refused; a raw DBAPI driver error (a SQLite timeout, a bad column) on one alias
  or weak lookup no longer fails the whole trace; a weak target must name a table in
  the scene; an alias-only scene with no join reports its rows; weak matching pushes
  its `eq` / `same-day` / `within-minutes` condition into a bound SQL query so a late
  target row is not missed by a Python-side filter; stage status/amount/time are read
  from the full result row rather than the six-column sample; a refused or failed step
  reads **not run** / **failed** instead of "0 rows"; the agent-facing renderer prints
  stages, weak matches, refused queries and outside tables without ever echoing the
  traced value; removing a scene member clears the stages and keys that named it and
  removing a business key leaves weak links intact. Old `scenes/*.json` still load
  unchanged; checks are strict on save only.
- **The self-test no longer reads this machine's DBeaver.** Its DBeaver check pointed
  the scan at the real `%APPDATA%\DBeaverData`, so deleting the sample connection in
  the editor turned `npm test` red for a reason that had nothing to do with the code.
  The suite now writes a throwaway DBeaver home (a workspace with one SQLite
  connection) and hands it to `createHost` as `dbeaverRoots`; the scan and the import
  route use those roots when they get them, and fall back to the real ones otherwise.
- **A table outside `public` is found by name.** A datasource that does not pin a
  schema used to send every single-table read to `search_path`, so on openGauss a
  table in `sales` came back as "does not exist" while the relation graph insisted
  it was there — which also made `feedback_relation` report `indexed: null` and
  `trace_by_key` fail its entry probe. The name is now resolved against the
  catalogue when exactly one schema holds it; an ambiguous name keeps the old
  behaviour rather than reading the wrong table.
- **A self-referencing edge is walked in both directions.** `_incident` used one
  `if/elif`, so a table appearing on both sides of its own edge (`parent_id ->
  ticket.id`) only reported the `from` half: every parent/child hierarchy could be
  climbed or descended, never both. Both halves are reported now.
- **A column of a composite key is not unique on its own.** `mine_relations` read
  every key column as a candidate parent, so `ledger(account_no, seq)` looked
  unique on `account_no` and a clear ledger→account join was dropped as "both
  unique". Only a single-column key counts.
- **The depth cap is reported once, and only for what it hid.** A graph with a cycle
  (`order_item → sales_order → order_item`) puts every step at the cap, so the walk
  emitted one `depth_limit` warning per table it could have reached — five lines each
  naming a table already on screen, with nothing to act on. The cap is now collected
  during the walk and reported once, naming only the tables the walk never read.

## [1.0.0] - 2026-11-19

### Added

- **Outside MCP clients reach the audit log.** A client pointed straight at the
  HTTP endpoint (VS Code, Cursor…) never passes through the Host, so its calls left
  no line in `logs/audit.jsonl` — the very calls you would most want a record of.
  The Python server now writes the log itself, in the shape the panel already parses
  (no result rows, SQL cut to 2000 characters, rotating to `audit.1.jsonl` at
  512 KiB). Each process writes only for itself: the Host keeps recording the stdio
  child's calls, the HTTP child records its own, so one call still yields one line
  and the agent's trail is unchanged.

- **The audit line says who made the call.** A shared HTTP endpoint is reached by
  the agent, the panel and whatever outside client you pointed at it, and the log
  could not tell them apart. Every entry now carries `client`: the Host stamps
  `dsh-agent` for the calls it drives on the agent's behalf and `panel` for its own
  probes, and the HTTP child stamps the name the MCP client announced at connect
  time (`Cursor 0.44.0`, `unnamed client` when it announced nothing). A line written
  outside any request has no `client` key. The panel shows the caller next to the
  tool name, with the meaning on hover.

- **`describe_table` answers the join questions, and `list_relations` answers them
  for a whole schema.** Knowing the columns is not enough to write a correct join:
  the model also needs what each column points at, which columns are indexed, what
  the team calls the table, and roughly how big it is. `describe_table` now returns
  `foreignKeys`, `indexes` (name, columns, unique), the table and per-column
  `comment`, and `rowEstimate` — the planner's number, not a `count(*)`. The new
  `list_relations` returns every foreign key in one schema as flat rows
  `{table, column, refTable, refColumn, name}`, so a multi-table query costs one call
  instead of one describe per table. Anything the engine or the grants cannot answer
  comes back as `[]` or `null` rather than failing the call, and an Oracle table
  created with a quoted lower-case name now resolves: the catalog is asked which
  spelling it stores instead of folding the name to upper case.

- **A statement deadline, and reads that stop fetching early.** `connect_timeout` was
  the only bound on a call, so a runaway query could occupy the child until the server
  gave up, and a `SELECT` over a large table pulled the whole result set into memory
  before `max_rows` trimmed the output. Every statement now carries a deadline —
  `DB_MCP_STATEMENT_TIMEOUT_MS`, default 30 s, `0` to disable — pushed down to the
  engine (`statement_timeout` on PostgreSQL/openGauss, `max_execution_time` on MySQL,
  `call_timeout` on Oracle, a progress handler on SQLite), and a timeout comes back as
  `code: "timeout"` with a hint saying how to change it. Reads run on a server-side
  cursor (psycopg named cursor, PyMySQL `SSCursor`) and stop at `max_rows + 1`; writes
  keep the ordinary cursor. MySQL applies its limit to `SELECT` only, which the
  reference states.

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
  otherwise permanent — the panel had no way to show or lift one. A _Conversation
  limits_ card now sits under the source list, next to the global write switch: both
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

- **The TLS section says where a trust root has to come from.** `verify-ca` and
  `verify-full` were documented as "chain checked", which reads as if the plugin does
  the checking with something it holds. It does not: there is no `sslCa` key, so libpq
  looks for `root.crt` in `%APPDATA%\postgresql` (Windows) or `~/.postgresql`, and
  PyMySQL uses the system trust store. With no such file the connection is refused
  rather than downgraded, and `verify-full` compares the certificate name against the
  configured `host` — so a container reached as `127.0.0.1` fails a certificate issued
  for its name. Both facts are now in `docs/reference.md#sslmode` and
  `docs/safety.md#tls`, and the MySQL deadline note says outright that
  `max_execution_time` does not interrupt a statement that is merely waiting.

- **The conversation-limit card left the Tools tab.** It had been folded in under the
  tool list, where a setting that only the agent writes is the last thing anyone looks
  for. It now lives on the _Data source list_ tab with the global write switch, since
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

- **MySQL `disable` did not disable TLS.** PyMySQL 2.x negotiates TLS on its own
  whenever the server offers it, so "pass no `ssl` argument" left the connection
  encrypted: a source marked `disable` still came up with `Ssl_cipher` set. The
  driver only refuses TLS when it is told `ssl_disabled=True`, which is what the
  plugin now passes for `disable`, `disabled` and `allow`. `prefer` and an unset
  field keep the driver default — opportunistic TLS, which is what `prefer` means
  on this engine.

- **A DBeaver connection behind an SSH tunnel was imported as if it were local.**
  DBeaver keeps the tunnel in `configuration.handlers` and writes the tunnel's
  _local_ end into the connection fields, so the import produced a source pointing
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

- **The panel is called _Data sources_**, in the sidebar entry, the heading, the
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
  _Tools_ tab now says that its list is DSH-only: a client connected to the HTTP
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

- The guide spells out the two commands behind the panel's _Install / repair
  dependencies_ button, so a failed environment can be fixed by hand.
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

- **Restart MCP** moved to the _Runtime_ tab, where the process actually lives; probe
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
- The DBeaver import pins its action bar, keeps _Import selected_ in it, and filters
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

[Unreleased]: https://github.com/halcyon6669/dsh-db-mcp/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/halcyon6669/dsh-db-mcp/compare/v0.9.10...v1.0.0
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
