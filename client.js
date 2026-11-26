/**
 * GENERATED FILE — do not edit directly.
 * Source: client.parts/*.js. Run `node dev/build-client.mjs` after editing.
 */
/**
 * dsh-db-mcp — Client half.
 *
 * A plain browser bundle loaded through window.__ModuleLoader__ (same shape as
 * the skill's UI template): no imports of Harness client packages, no iframes,
 * no DOM work outside the component tree, styles from --dsw-alias-* tokens only.
 *
 * The panel owns the data-source registry: create, edit, test, delete, and an
 * importer that reads DBeaver's workspace files. Querying is never done here —
 * the agent reaches these sources through the Python MCP server (P3).
 */
window.__ModuleLoader__.load({
  id: 'dsh-db-mcp',
  factory(require) {
    'use strict'

    const React = require('react')
    const h = React.createElement

    const NS = 'db-mcp'
    /** Top-level tabs of the panel. `sources` also hosts the create/edit/import/structure views. */
    const TABS = [
      { id: 'list' },
      { id: 'create' },
      { id: 'import' },
      { id: 'graph' },
      { id: 'scenes' },
      { id: 'trace' },
      { id: 'clients' },
      { id: 'runtime' },
      { id: 'tools' },
      { id: 'audit' },
    ]

    /** Tab labels stay literal so the i18n check can see every key. */
    function tabLabel(t, id) {
      if (id === 'create') return t('tab.create')
      if (id === 'import') return t('tab.import')
      if (id === 'graph') return t('tab.graph')
      if (id === 'scenes') return t('tab.scenes')
      if (id === 'trace') return t('tab.trace')
      if (id === 'runtime') return t('tab.runtime')
      if (id === 'clients') return t('tab.clients')
      if (id === 'tools') return t('tab.tools')
      if (id === 'audit') return t('tab.audit')
      return t('tab.list')
    }

    /** The tab that owns a view; the form and the schema browser live under a tab. */
    function tabOfMode(mode) {
      if (mode === 'create' || mode === 'edit') return 'create'
      if (mode === 'import') return 'import'
      if (mode === 'graph') return 'graph'
      if (mode === 'scenes') return 'scenes'
      if (mode === 'trace') return 'trace'
      if (mode === 'runtime') return 'runtime'
      if (mode === 'clients') return 'clients'
      if (mode === 'tools') return 'tools'
      if (mode === 'audit') return 'audit'
      return 'list'
    }
    const API = '/plugins/db-mcp/api'
    // Kept in step with `repository.url` in package.json: the masthead links here
    // for the docs, the issues and the star button alike.
    const REPO_URL = 'https://github.com/halcyon6669/dsh-db-mcp'
    const KINDS = ['sqlite', 'postgres', 'gauss', 'mysql', 'oracle']
    const DEFAULT_PORTS = { postgres: '5432', gauss: '5432', mysql: '3306', oracle: '1521' }

    /** Set by apply(); bind() reads the active locale at call time, so only the
     *  re-render subscription has to live on the component side. */
    let localeService = null
    let layoutService = null

    const DICT = {
      en: {
        /* The panel registers connections, not databases: it does not browse
           a server's contents or run SQL. Naming it after the thing it holds
           also matches the two tabs right below it ("Data source list", "New
           data source") and the subtitle, which still says what a source is. */
        'panel.title': 'Data sources',
        'panel.subtitle': 'Manage the database connections this agent can reach through MCP tools.',
        'action.refresh': 'Refresh',
        'action.star': 'Star',
        'action.starHint': 'Star dsh-db-mcp on GitHub — the docs and the issues live there too',
        'action.restartMcp': 'Restart MCP',
        'action.restartMcpHint': 'Restart the Python MCP server and re-publish its tools',
        'action.new': 'New data source',
        'action.import': 'Import from DBeaver',
        'action.save': 'Save',
        'action.saving': 'Saving…',
        'action.edit': 'Edit',
        'action.test': 'Test',
        'action.testing': 'Testing…',
        'action.delete': 'Delete',
        'action.deleteConfirm': 'Delete for real',
        'action.importSelected': 'Import selected',
        'action.importing': 'Importing…',
        'state.connected': 'connected',
        'state.failed': 'failed',
        'state.loading': 'checking…',
        'python.missing': 'no python on PATH',
        'loading': 'Checking the Host…',
        'error.title': 'Host API unreachable',
        'error.retry': 'Retry',
        'notice.saved': 'Saved {name}.',
        'notice.deleted': 'Removed {name}.',
        'notice.imported': 'Imported {n} data source(s).',
        'notice.importedSkipped': 'Imported {n} data source(s); skipped {m} already configured.',
        'notice.probeOk': '{name}: connection OK ({ms} ms).',
        'notice.mcpReady': 'MCP server is up with {count} tool(s).',
        'notice.httpOn': 'HTTP endpoint is running; other agents can connect now.',
        'notice.httpOff': 'HTTP endpoint stopped.',
        'notice.clientReady': '{name} now points at this server over {transport}.',
        'clients.title': 'Connect another agent',
        'clients.hint': 'Point VS Code, Cursor, Claude Code, Claude Desktop or Codex at this MCP server. Everyone shares the same data sources, so nothing has to be typed twice.',
        'clients.running': 'running',
        'clients.stopped': 'stopped',
        'clients.copy': 'Copy',
        'clients.copied': 'Copied',
        'clients.port': 'Port',
        'clients.start': 'Start',
        'clients.stop': 'Stop',
        'clients.writeStdio': 'Write stdio',
        'clients.writeHttp': 'Write HTTP',
        'clients.working': 'Writing…',
        'clients.configured': 'configured',
        'clients.notConfigured': 'not configured yet',
        'clients.noFile': 'not detected',
        'clients.stdioNote': 'Every client can take either form: stdio runs this server as a child process (no port needed), HTTP uses the shared endpoint above and needs it running.',
        'tools.title': 'Tools the agent sees',
        'tools.hint': 'Switch a tool off to take it away from the agent; the change applies on the next restart of the MCP server.',
        'tools.dshOnly': 'This list is DSH only. A client connected to the HTTP endpoint still sees every tool — the Python server publishes all of them, and the filter lives in the plugin.',
        'tools.offCount': '{n} tool(s) switched off.',
        'tools.on': '{name} is on.',
        'tools.off': '{name} is off.',
      'tools.enable': 'Turn on',
      'tools.disable': 'Turn off',
      'tools.rows': 'rows',
      'tools.limitLabel': 'Default rows for {argument}',
      'tools.limitHint': 'Rows used when the agent names no count (1-{max}).',
      'tools.limitSaved': 'Default row count saved.',
        'sources.count': '{n} configured',
        'sources.empty.title': 'No data source yet',
        'sources.empty.body': 'Add one here, or import the connections DBeaver already keeps on this machine. The agent queries real data through MCP tools, never through this page.',
        'sources.readonly': 'read-only',
        'sources.readwrite': 'writable',
        'sources.default': 'default',
        'sources.hasPassword': 'password saved',
        'sources.noPassword': 'no password',
        'sources.secretBroken': 'stored password unreadable',
        'sources.neverProbed': 'never tested',
        'sources.idChip': 'ID',
        'sources.idChipHint': 'this is the identifier every MCP tool takes as its datasource argument — click to copy',
        'sources.idCopied': 'copied',
        'sources.selectAll': 'Select all {n}',
        'sources.selectNone': 'Clear selection',
        'form.edit': 'Edit {name}',
        'form.name': 'Display name',
        'form.id': 'Identifier',
        'form.idHint': 'lowercase letters, digits and dashes; used by MCP tools and never changes',
        'form.paste': 'Connection string',
        'form.pasteHintShort':
          'Paste a JDBC URL, a DSN or the path of a .db file. Type, host, port, database and the identifier are derived from it.',
        'form.savePassword': 'Save password',
        'form.more': 'More settings',
        'form.moreHint': 'name, group, identifier and database settings',
        'form.smart': 'Smart parsing',
        'form.autoApply': 'Saved sources take effect immediately and are registered with the local MCP server.',
        'form.probeOk': '{name}: connection OK ({ms} ms).',
        'form.probeFail': 'Connection failed:',
        'form.probeUnknown': 'no message',
        'form.duplicate': 'A data source already uses this connection and user: {name}. Open that row instead of adding a second one.',
        'form.userPlaceholder': 'e.g. root or postgres',
        'form.pasteHintEdit': 'Paste a new connection string to overwrite the fields below; the identifier stays fixed.',
        'form.pastePlaceholder': 'postgresql://user:pass@localhost:5432/app',
        'form.parseOk': 'recognized',
        'form.parseBad': 'not recognized',
        'form.optional': 'optional',
        'form.sidHint': 'only for the old SID style; wins over the service name when filled',
        'form.untitled': 'Untitled source',
        'form.kind': 'Type',
        'form.file': 'SQLite file',
        'form.fileHint': 'absolute path, for example C:\\data\\app.db',
        'form.host': 'Host',
        'form.port': 'Port',
        'form.database': 'Database',
        'form.user': 'User',
        'form.schema': 'Default schema',
        'form.schemaHint': "Empty uses the connection user's own schema.",
        'form.charset': 'Charset',
        'form.sslMode': 'SSL mode',
        'form.serviceName': 'Service name',
        'form.sid': 'SID',
        'form.password': 'Password',
        'form.passwordKeep': 'leave blank to keep the stored password',
        'form.passwordEmpty': 'no password stored yet',
        'form.readOnly': 'Read-only (recommended)',
        'form.readOnlyHint': 'blocks writes for this source unless the global write switch is on',
        'form.allowDdl': 'Allow DDL',
        'form.allowDdlHint': 'lets this source run create, alter, drop and truncate',
        'form.schemaBroken': 'The stored password cannot be decrypted any more. Type it again to save it with the current key.',
        'form.invalid': 'Fill the required fields first.',
        'form.requiredHint': 'The connection string, user and password are required: fill them, then save.',
        'import.body': 'Reads data-sources.json from the DBeaver workspace and decrypts credentials-config.json when it exists.',
        'import.empty': 'No DBeaver connection found on this machine.',
        'import.file': 'File',
        'import.credentialsFound': 'found and decrypted',
        'import.already': 'already added',
        'import.alreadyAs': 'already added as {name}',
        'import.searchPlaceholder': 'Filter by name, host or user',
        'import.noMatch': 'No DBeaver connection matches this filter.',
        'import.matches': '{n} of {total}',
        'import.selectAll': 'Select all',
        'import.credentialsMissing': 'not present — the password has to be typed in manually later',
        'diag.title': 'Runtime diagnostics',
        'diag.hostApi': 'Host API',
        'diag.node': 'Node',
        'diag.plugin': 'Plugin',
        'diag.python': 'Python',
        'diag.runtimeDir': 'Runtime dir',
        'diag.registry': 'Registry file',
        'diag.sources': 'Data sources',
        'diag.mcp': 'MCP server',
        'diag.mcpPending': 'not wired yet',
        'diag.mcpLive': '{count} tool(s) live',
        'diag.mcpFailed': 'failed:',
        'diag.uptime': 'Host uptime',
        'diag.tip': 'Tip',
        'diag.restartNeeded': 'Restart the DSH desktop app once — the plugin entry is imported at process start, so the tool bridge only activates after a restart.',
        'write.on': 'Global write',
        'write.off': 'Global read-only',
        'write.hint': 'On: a source must still allow writes itself. Off: every write statement is refused.',
        'render.title': 'Context optimisation',
        'render.sampleRows': 'Sample rows',
        'render.sampleRowsHint': 'Rows that sample_rows returns when the agent names no count (1-{max}). A table preview — keep it small.',
        'render.maxRows': 'Query rows',
        'render.maxRowsHint': 'Rows that execute_sql returns when the agent names no count (1-{max}). The ceiling for one query.',
        'render.text': 'Long text in results',
        'render.textHint': 'Cells longer than 200 characters. Fragment keeps the first and last 50 and marks what was cut; Full passes the whole value through.',
        'render.textFragment': 'Fragment (head+tail)',
        'render.textFull': 'Full value',
        'render.textSaved': 'Long-text setting saved.',
        'cost.title': 'Cost thresholds',
        'cost.hint': 'What a trace is allowed to cost. These decide when a step counts as slow, when an edge has earned trust, and when an unindexed column on a big table is worth asking about first.',
        'cost.slowMs': 'Slow step',
        'cost.slowMsUnit': 'ms',
        'cost.slowMsHint': 'A measured step slower than this blocks automatic trust. Only steps under this count as cheap.',
        'cost.timingWindow': 'Timing window',
        'cost.timingWindowUnit': 'step(s)',
        'cost.timingWindowHint': 'How many recent measurements are kept per edge. Older ones are dropped so the average follows the current cost.',
        'cost.trustSamples': 'Samples to trust',
        'cost.trustSamplesUnit': 'step(s)',
        'cost.trustSamplesHint': 'How many measured steps an edge needs before it can be trusted. Cannot be larger than the window.',
        'cost.bigTableRows': 'Large table',
        'cost.bigTableRowsUnit': 'rows',
        'cost.bigTableRowsHint': 'Above this many rows an unindexed column is treated as a full table scan, and tracing asks before running that step. Row counts come from the catalog, never count(*).',
        'cost.saved': 'Cost threshold saved.',
        'scopes.title': 'Conversation limits',
        'scopes.empty': 'No conversation is limited — every session can reach every data source.',
        'scopes.summary': '{n} conversation(s) limited · {rules} rule(s)',
        'scopes.show': 'Show',
        'scopes.hide': 'Hide',
        'scopes.clear': 'Clear all',
        'scopes.remove': 'Remove this limit',
        'scopes.removed': 'Conversation limit removed.',
        'scopes.cleared': 'Every conversation limit is cleared.',
        'scopes.allSources': 'all data sources',
        'scopes.columnId': 'Conversation id',
        'scopes.columnTitle': 'Name',
        'scopes.columnSources': 'Data sources',
        'scopes.noTitle': 'untitled',
        'scopes.parked': 'archived',
        'scopes.parkedHint': '{n} archived conversation(s) keep their limit and get it back when unarchived.',
        'diag.venv': 'Python venv',
        'diag.packages': 'Python packages',
        'diag.venvMissing': 'not created yet',
        'diag.venvHint': 'One click creates <runtime>/.venv and installs server/requirements.txt with that interpreter.',
        'action.installDeps': 'Install / repair deps',
        'action.installing': 'Installing…',
        'notice.depsOk': 'Dependencies are installed.',
        'notice.depsFail': 'Dependency install failed — see the diagnostics output.',
        'notice.writeOn': 'Global writes are on. Sources still stay read-only until you clear their own flag.',
        'notice.writeOff': 'Global writes are off. Every write statement is refused.',
        'audit.title': 'Audit log',
        'audit.empty': 'No tool call has been recorded yet.',
        'audit.file': 'Log file',
        'audit.ok': 'ok',
        'audit.err': 'failed',
        'audit.hint': 'One line per MCP tool call: tool, caller, source, duration and outcome. Query results are never logged.',
        'audit.clientHint': 'The program that made the call: dsh-agent, panel, or the name the MCP client gave when it connected.',
        'audit.rows': '{n} row(s)',
        'audit.loadMore': 'Load more',
        'audit.loadingMore': 'Loading…',
        'audit.tz': 'Times follow your computer clock ({zone}); the log file keeps UTC.',
        'action.lockSource': 'Click to make this source read-only',
        'action.unlockSource': 'Click to allow writes on this source',
        'notice.nowReadOnly': '{name} is read-only now.',
        'notice.nowWritable': '{name} accepts writes now.',
        'notice.nowWritableLocked': '{name} accepts writes now, but the global write switch is still off — turn it on in the data source list header, next to the group box.',
        'sources.ddl': 'DDL',
        'sources.ddlHint': 'This source may run create, alter, drop and truncate.',
        'sources.ddlBlockedHint': 'This source accepts insert, update and delete, but refuses create, alter and drop.',
        'action.schema': 'Structure',
        'action.backToSources': 'Data sources',
        'tab.list': 'Data source list',
        'tab.create': 'New data source',
        'tab.import': 'Import from DBeaver',
        'tab.graph': 'Relations',
        'tab.scenes': 'Scenes',
        'tab.trace': 'Trace',
        'tab.runtime': 'Runtime',
        'tab.clients': 'Connect',
      'tab.tools': 'Tools',
        'tab.audit': 'Audit log',
        'graph.title': 'Relation graph',
        'graph.hint': 'Every join this datasource knows about. An edge is a claim, so it only gets followed once you have confirmed it — pending edges are listed but never walked.',
        'graph.busy': 'working…',
        'graph.noSources': 'Add a data source first; a graph belongs to one datasource.',
        'graph.discover': 'Import foreign keys',
        'graph.mine': 'Mine the log',
        'graph.add': 'Add a join',
        'graph.cancel': 'Cancel',
        'graph.save': 'Save the join',
        'graph.addHint': 'Record a join the catalog does not declare. The left side is the table holding the value; the right side is the table it points at.',
        'graph.fromTable': 'From table',
        'graph.fromColumn': 'From column',
        'graph.toTable': 'To table',
        'graph.toColumn': 'To column',
        'graph.condition': 'Condition (optional)',
        'graph.conditionHint': 'Extra SQL the join needs to be true, for example status = \'POSTED\'. A condition never changes the status of an edge.',
        'graph.conditionPlaceholder': "status = 'POSTED'",
        'graph.saveCondition': 'Save condition',
        'graph.whenClause': 'when',
        'graph.filterAll': 'All',
        'graph.filterPending': 'Pending',
        'graph.filterConfirmed': 'Confirmed',
        'graph.filterBroken': 'Broken',
        'graph.empty': 'No relations recorded yet. Import the declared foreign keys, or add a join by hand.',
        'graph.emptyFiltered': 'No edge in this state.',
        'graph.truncated': 'Showing the first {n} edges; the rest stay in the file.',
        'graph.statusPending': 'pending',
        'graph.statusConfirmed': 'confirmed',
        'graph.statusTrusted': 'trusted',
        'graph.statusStale': 'stale',
        'graph.statusRejected': 'rejected',
        'graph.sourceFk': 'foreign key',
        'graph.sourceManual': 'added by hand',
        'graph.sourceInferred': 'inferred',
        'graph.sourceMined': 'mined from the audit log',
        'graph.confirmedTimes': '{n} confirmed',
        'graph.rejectedTimes': '{n} rejected',
        'graph.fanout': 'fanout {value}',
        'graph.rows': '~{n} rows',
        'graph.avgMs': '{ms}ms per step',
        'graph.indexYes': 'indexed',
        'graph.indexNo': 'no index',
        'graph.indexUnknown': 'index unknown',
        'graph.when': 'on {at}',
        'graph.failedBecause': 'Last attempt failed: {verdict} ({reason})',
        'graph.verdictTooMany': 'matched too many rows',
        'graph.verdictMissing': 'missed rows it should have found',
        'graph.reasonWrongColumn': 'wrong column',
        'graph.reasonNeedsCondition': 'needs a condition',
        'graph.reasonNotUnique': 'value is not unique',
        'graph.rejectHint': 'Why is this join wrong? The answer decides how it is repaired.',
        'graph.confirm': 'Confirm',
        'graph.reject': 'Reject',
        'graph.addCondition': 'Add condition',
        'graph.reopen': 'Reopen',
        'graph.remove': 'Delete',
        'graph.record': 'Confirmation record',
        'graph.hideRecord': 'Hide record',
        'graph.recordHint': 'This edge is followed. Withdraw a confirmation if it was wrong.',
        'graph.noHistory': 'No record yet.',
        'trace.title': 'Trace a value',
        'trace.hint': 'Give it a value and it finds where the value lives, then walks the confirmed joins that carry it across tables. The statements are built here from the relation graph — this page takes a value, never SQL.',
        'trace.noSources': 'Add a data source first; a trace runs against one datasource.',
        'trace.value': 'Value',
        'trace.valuePlaceholder': 'order id, code, sku…',
        'trace.entryTable': 'Entry table (optional)',
        'trace.entryColumn': 'Entry column (optional)',
        'trace.entryOptional': 'leave blank to probe',
        'trace.direction': 'Direction',
        'trace.dirBoth': 'both ways',
        'trace.dirDown': 'down to the rows that reference it',
        'trace.dirUp': 'up to the row it references',
        'trace.run': 'Trace',
        'trace.running': 'walking…',
        'trace.needValue': 'Type a value to look for.',
        'trace.nothing': 'Nothing was reached: no confirmed edge leads anywhere from this value.',
        'trace.summary': 'Started at {table}.{column} — {tables} table(s) reached in {ms}ms',
        'trace.summaryShort': '{tables} table(s) reached in {ms}ms',
        'trace.counts': '{steps} step(s), {rows} row(s) read, depth {depth}',
        'trace.rows': '{n} row(s)',
        'trace.chainBreaks': '0 rows — the chain stops here',
        'trace.stepMs': '{ms}ms',
        'trace.needsConfirmChip': 'full scan',
        'trace.needsConfirm': 'This step would scan the whole table — it has no index and the table is large. It was not run.',
        'trace.continueAnyway': 'Run it anyway',
        'trace.needsConfirmSome': '{n} step(s) were not run because each would scan a whole table. Run the trace with "Run it anyway" if that is what you want.',
        'trace.stepFailed': 'this step failed',
        'trace.truncated': 'capped',
        'trace.stopped': 'Where it stopped',
        'trace.pendingTitle': 'Edges not followed',
        'trace.pendingHint': 'These joins would have continued the walk, but they are still pending. Confirm one on the Relations page and trace again.',
        'trace.warnings': 'Warnings',
        'trace.judgeOk': 'This is right',
        'trace.judgeWrong': 'Something is off',
        'trace.judgeMissing': 'Rows are missing',
        'trace.judgeIrrelevant': 'Not related at all',
        'trace.scene': 'Scene',
        'trace.sceneAll': 'Whole graph',
        'trace.sceneTables': '{n} table(s)',
        'trace.dirBothShort': 'Both',
        'trace.root': 'start',
        'trace.up': 'up',
        'trace.down': 'down',
        'trace.changeEntry': 'Change entry',
        'trace.manualEntry': 'Pick the entry by hand',
        'trace.showRowsN': 'Show {n} row(s)',
        'trace.hideRows': 'Fold',
        'trace.sceneClaim': 'scene claim',
        'trace.outsideCount': '{n} table(s) left outside the scene',
        'trace.outsideTitle': 'Outside the scene',
        'trace.outsideNote': 'The walk stopped at these joins because the table is not part of the scene. Add it to read further.',
        'trace.outsideChip': 'outside',
        'trace.addToScene': 'Add to this scene',
        'trace.legend': 'Join confidence:',
        'trace.legendFeedback': '✓ and ✗ judge that join, not the rows.',
        'trace.appearsIn': 'This value lives in {n} places — start from:',
        'trace.overview': 'The shape of the walk, one column per depth — pick a box to read that step',
        'trace.zoomIn': 'Zoom in',
        'trace.zoomOut': 'Zoom out',
        'trace.zoomReset': 'Reset to 100%',
        'scene.saveAs': 'Save as a scene',
        'scene.save': 'Save scene',
        'scene.overwrite': 'Overwrite scene',
        'scene.overwrites': 'A scene named "{name}" already exists — saving updates it.',
        'scene.cancel': 'Cancel',
        'scene.name': 'Scene name',
        'scene.namePlaceholder': 'e.g. order to cash',
        'scene.note': 'Note',
        'scene.notePlaceholder': 'optional',
        'scene.needName': 'Give the scene a name.',
        'scene.needTables': 'This walk read no table that could be saved.',
        'scene.saved': 'Saved the scene "{name}".',
        'scene.fromWalk': '{n} table(s) from this walk',
        'scene.title': 'Scenes',
        'scene.hint': 'A scene is a named set of tables. It narrows a trace to that slice — it never owns a join, so deleting one leaves every edge in the graph.',
        'scene.new': 'New scene',
        'scene.noSources': 'Add a data source first; scenes belong to one datasource.',
        'scene.listEmpty': 'No scene yet for this datasource.',
        'scene.pickHint': 'Pick a scene on the left, or make a new one.',
        'scene.newHint': 'Name it, add the tables a question spans, then save.',
        'scene.tablesTitle': 'Member tables',
        'scene.tablesEmpty': 'No table yet — add the ones this scene should cover.',
        'scene.addTable': 'Add a table',
        'scene.searchTables': 'Search tables…',
        'scene.removeTable': 'Remove from the scene',
        'scene.keepOne': 'A scene needs at least one table.',
        'scene.catalogEmpty': 'This datasource listed no table.',
        'scene.moreTables': '{n} more — search to narrow it down',
        'scene.linksTitle': 'Confirmed joins between members',
        'scene.linksEmpty': 'No confirmed join between these members yet.',
        'scene.linksHint': 'Both ends are in the scene and the join is confirmed or trusted. Open one on the Relations page.',
        'scene.isolatedTitle': 'Members with no confirmed join inside the scene',
        'scene.isolatedHint': 'Each one is read and then the walk stops. The join belongs to the relation graph, never to the scene.',
        'scene.noJoinAtAll': 'Nothing confirmed joins this table yet — inside the scene or outside it.',
        'scene.joinsOutside': 'Its confirmed joins all lead out of the scene:',
        'scene.adopt': 'Add {n} to the scene',
        'scene.noCandidate': 'No column of this table shares a name with another member.',
        'scene.useCandidate': 'Use {n}',
        'scene.sameName': 'same column name',
        'scene.addLink': 'Add a join',
        'scene.delete': 'Delete scene',
        'scene.deleteConfirm': 'Delete this scene?',
        'scene.deleteNote': 'No connection is deleted — every join stays in the relation graph.',
        'scene.deleteCancel': 'Keep it',
        'scene.deleted': 'Deleted the scene "{name}".',
        'scene.dirty': 'Unsaved changes',
        'notice.discovered': 'Imported the declared foreign keys.',
        'notice.mined': 'Mined the audit log for joins — they arrive as pending.',
        'notice.verdict': 'Recorded "{verdict}".',
        'notice.conditionSet': 'Condition saved.',
        'notice.conditionCleared': 'Condition cleared.',
        'notice.edgeDeleted': 'Edge deleted.',
        'notice.edgeProposed': 'Join recorded; it starts out pending.',
        'header.backToChat': 'Back to chat',
        'form.group': 'Group',
        'form.groupHint': 'Sources sharing a group are listed together',
        'group.unassigned': 'Ungrouped',
        'group.count': '{n}',
        'group.new': 'New group',
        'group.newPlaceholder': 'Group name',
        'group.add': 'Add group',
        'group.renameHint': 'Double-click to rename',
        'group.save': 'Save',
        'group.cancel': 'Cancel',
        'group.delete': 'Delete',
        'group.deleteConfirm': 'Delete group?',
        'group.selectAll': 'Select every source in this group',
        'group.dragHint': 'Drag onto a group to move it; checking rows drags them together',
        'group.empty': 'Drop a source here',
        'bulk.selected': '{n} selected',
        'bulk.test': 'Test selected',
        'bulk.readonly': 'Make read-only',
        'bulk.readwrite': 'Allow writes',
        'bulk.group': 'Move to group',
        'bulk.groupPlaceholder': 'group name (empty clears it)',
        'bulk.apply': 'Apply',
        'bulk.delete': 'Delete selected',
        'bulk.deleteConfirm': 'Confirm delete {n}',
        'bulk.clear': 'Clear',
        'notice.bulkDone': 'Updated {n} data source(s).',
        'notice.bulkGrouped': 'Moved {n} data source(s) into “{group}”.',
        'notice.groupSaved': 'Group “{name}” saved.',
        'notice.groupDeleted': 'Group “{name}” deleted.',
        'notice.moved': 'Moved into “{group}”.',
        'notice.movedMany': 'Moved {n} sources into “{group}”.',
        'schema.title': 'Structure of {name}',
        'schema.tables': 'Tables ({n})',
        'schema.pick': 'Pick a table on the left to see its columns.',
        'schema.empty': 'This source reports no table.',
        'schema.loading': 'Reading the catalog…',
        'schema.error': 'Could not read the catalog.',
        'schema.column': 'Column',
        'schema.type': 'Type',
        'schema.nullable': 'Null',
        'schema.default': 'Default',
        'schema.pk': 'PK',
        'schema.yes': 'yes',
        'schema.no': 'no',
        'schema.columns': '{n} column(s)',
        'schema.matching': '{n} match(es)',
        'schema.search': 'Filter tables',
        'schema.noMatch': 'No table matches this filter.',
        'schema.defaultSchema': 'default schema',
        'schema.readonlyNote': 'Read-only view: this page never runs SQL.',
        'status.mcpOk': 'MCP server healthy',
        'status.mcpDown': 'MCP server down',
        'status.total': 'Total {n}',
        'status.healthy': '{n} healthy',
        'status.failing': '{n} failing',
        'status.failingNames': '({names})',
        'filter.all': 'All',
        'filter.failed': 'Only failures',
        'sources.searchPlaceholder': 'Search data sources…',
        'sources.noMatch': 'No data source matches this filter.',
        'sources.failedLine': 'Connection failed: {message}',
        'group.expand': 'Expand this group',
        'group.collapse': 'Collapse this group',
        'action.copyError': 'Copy',
        'action.copied': 'Copied',
        'action.copyErrorHint': 'Copy the whole failure report',
      },
      zh: {
        'panel.title': '数据源',
        'panel.subtitle': '管理 AI 可以通过 MCP 工具访问的数据库连接。',
        'action.refresh': '刷新',
        'action.star': 'Star',
        'action.starHint': '在 GitHub 上给 dsh-db-mcp 加星——文档和 issue 也都在那里',
        'action.restartMcp': '重启 MCP',
        'action.restartMcpHint': '重启 Python MCP 服务并重新发布工具',
        'action.new': '新建数据源',
        'action.import': '从 DBeaver 导入',
        'action.save': '保存',
        'action.saving': '保存中…',
        'action.edit': '编辑',
        'action.test': '测试',
        'action.testing': '测试中…',
        'action.delete': '删除',
        'action.deleteConfirm': '确认删除',
        'action.importSelected': '导入所选',
        'action.importing': '导入中…',
        'state.connected': '已连接',
        'state.failed': '失败',
        'state.loading': '检查中…',
        'python.missing': 'PATH 上未找到 python',
        'loading': '正在检查 Host…',
        'error.title': '无法访问 Host 接口',
        'error.retry': '重试',
        'notice.saved': '已保存 {name}。',
        'notice.deleted': '已删除 {name}。',
        'notice.imported': '已导入 {n} 个数据源。',
        'notice.importedSkipped': '已导入 {n} 个数据源，跳过 {m} 个已存在的。',
        'notice.probeOk': '{name}：连接正常（{ms} ms）。',
        'notice.mcpReady': 'MCP 服务已就绪，共 {count} 个工具。',
        'notice.httpOn': 'HTTP 端点已启动，其它 agent 现在可以接入。',
        'notice.httpOff': 'HTTP 端点已停止。',
        'notice.clientReady': '已把 {name} 配置为通过 {transport} 使用本服务。',
        'clients.title': '接入其它客户端',
        'clients.hint': '把 VS Code、Cursor、Claude Code、Claude Desktop 或 Codex 指向这个 MCP 服务。它们共用同一份数据源，不用重复填。',
        'clients.running': '运行中',
        'clients.stopped': '已停止',
        'clients.copy': '复制',
        'clients.copied': '已复制',
        'clients.port': '端口',
        'clients.start': '启动',
        'clients.stop': '停止',
        'clients.writeStdio': '写入 stdio',
        'clients.writeHttp': '写入 HTTP',
        'clients.working': '写入中…',
        'clients.configured': '已配置',
        'clients.notConfigured': '尚未配置',
        'clients.noFile': '未检测到',
        'clients.stdioNote': '每个客户端都可任选一种：stdio 把本服务作为子进程启动（不需要端口）；HTTP 复用上面的共享端点，需要先启动它。',
        'tools.title': 'AI 可用的工具',
        'tools.hint': '把工具关掉就从智能体看到的工具列表里摘掉它，下次重启 MCP 服务后生效。',
        'tools.dshOnly': '这份清单只对 DSH 生效。接入 HTTP 端点的客户端仍然能看到全部工具 —— Python 服务照旧发布它们，过滤发生在插件这一侧。',
        'tools.offCount': '已关闭 {n} 个工具。',
        'tools.on': '已开启 {name}。',
        'tools.off': '已关闭 {name}。',
      'tools.enable': '打开',
      'tools.disable': '关掉',
      'tools.rows': '行',
      'tools.limitLabel': '{argument} 的默认行数',
      'tools.limitHint': '模型没指定行数时默认返回多少行（1-{max}）。',
      'tools.limitSaved': '默认行数已保存。',
        'sources.count': '已配置 {n} 个',
        'sources.empty.title': '还没有数据源',
        'sources.empty.body': '可以在这里新增，也可以直接导入这台机器上 DBeaver 已有的连接。AI 通过 MCP 工具查询真实数据，不会在这个页面里执行 SQL。',
        'sources.readonly': '只读',
        'sources.readwrite': '可写',
        'sources.default': '默认',
        'sources.hasPassword': '已存密码',
        'sources.noPassword': '无密码',
        'sources.secretBroken': '已存口令无法解密',
        'sources.neverProbed': '尚未测试',
        'sources.idChip': '标识符',
        'sources.idChipHint': '智能体调用 MCP 工具时，用 datasource 参数传这个标识符 · 点击复制',
        'sources.idCopied': '已复制',
        'sources.selectAll': '全选 {n} 个',
        'sources.selectNone': '取消全选',
        'form.edit': '编辑 {name}',
        'form.name': '显示名称',
        'form.id': '标识符',
        'form.idHint': '小写字母、数字和短横线，供 MCP 工具引用，创建后不可修改',
        'form.paste': '连接串',
        'form.pasteHintShort': '粘贴 JDBC URL、DSN 或 .db 文件路径，类型、主机、端口、库名和标识符都会自动带出。',
        'form.savePassword': '保存密码',
        'form.more': '更多设置',
        'form.moreHint': '名称、分组、标识符及数据库配置',
        'form.smart': '支持智能解析',
        'form.autoApply': '配置将自动生效并注册至本地 MCP 服务节点',
        'form.probeOk': '{name}：连接正常（{ms} ms）',
        'form.probeFail': '连接失败：',
        'form.probeUnknown': '无返回信息',
        'form.duplicate': '已经有一个数据源在用同一个地址和用户：{name}。直接用那一条即可，不必重复添加。',
        'form.userPlaceholder': '例如 root 或 postgres',
        'form.pasteHintEdit': '粘贴新的连接串会覆盖下面的字段；标识符保持不变。',
        'form.pastePlaceholder': 'postgresql://用户:密码@localhost:5432/库名',
        'form.parseOk': '已识别',
        'form.parseBad': '无法识别',
        'form.optional': '可选',
        'form.sidHint': '仅老式 SID 连接需要；填了会优先用 SID',
        'form.untitled': '未命名数据源',
        'form.kind': '类型',
        'form.file': 'SQLite 文件',
        'form.fileHint': '绝对路径，例如 C:\\data\\app.db',
        'form.host': '主机',
        'form.port': '端口',
        'form.database': '数据库',
        'form.user': '用户',
        'form.schema': '默认模式',
        'form.schemaHint': '不填则用连接用户自己的模式（Oracle 里模式就是用户）',
        'form.charset': '字符集',
        'form.sslMode': 'SSL 模式',
        'form.serviceName': '服务名',
        'form.sid': 'SID',
        'form.password': '口令',
        'form.passwordKeep': '留空表示保留已存口令',
        'form.passwordEmpty': '尚未保存口令',
        'form.readOnly': '只读（推荐）',
        'form.readOnlyHint': '未打开全局写开关时，此数据源拒绝写操作',
        'form.allowDdl': '允许 DDL',
        'form.allowDdlHint': '允许此数据源执行 create、alter、drop、truncate',
        'form.schemaBroken': '已存口令无法再用当前密钥解密，请重新输入一次口令以按新密钥保存。',
        'form.invalid': '请先填写必填字段。',
        'form.requiredHint': '连接串、用户与口令都是必填项：填好之后再保存。',
        'import.body': '读取 DBeaver 工作区里的 data-sources.json；存在 credentials-config.json 时一并解密口令。',
        'import.empty': '这台机器上没有找到 DBeaver 连接。',
        'import.file': '文件',
        'import.credentialsFound': '已找到并解密',
        'import.already': '已添加',
        'import.alreadyAs': '已作为 {name} 添加',
        'import.searchPlaceholder': '按名称、主机或用户过滤',
        'import.noMatch': '没有匹配该过滤条件的 DBeaver 连接。',
        'import.matches': '{n} / {total}',
        'import.selectAll': '全选',
        'import.credentialsMissing': '不存在——口令需要稍后手动填写',
        'diag.title': '运行时诊断',
        'diag.hostApi': 'Host 接口',
        'diag.node': 'Node',
        'diag.plugin': '插件',
        'diag.python': 'Python',
        'diag.runtimeDir': '运行时目录',
        'diag.registry': '注册表文件',
        'diag.sources': '数据源数量',
        'diag.mcp': 'MCP 服务名',
        'diag.mcpPending': '尚未接入',
        'diag.mcpLive': '{count} 个工具已就绪',
        'diag.mcpFailed': '启动失败：',
        'diag.uptime': 'Host 已运行',
        'diag.tip': '提示',
        'diag.restartNeeded': '需要重启一次 DSH 桌面应用：插件入口只在进程启动时导入，重启后工具桥接才会生效。',
        'write.on': '全局写',
        'write.off': '全局只读',
        'write.hint': '开启后单个数据源仍须自己允许写；关闭时所有写语句都会被拒绝。',
        'render.title': '上下文优化',
        'render.sampleRows': '默认行数',
        'render.sampleRowsHint': 'AI 没指定数量时 sample_rows 返回的行数（1-{max}）。相当于预览表内容，别设太大。',
        'render.maxRows': '查询行数',
        'render.maxRowsHint': 'AI 没指定数量时 execute_sql 返回的行数（1-{max}）。一次查询的上限。',
        'render.text': '结果里的长文本',
        'render.textHint': '超过 200 字符的单元格。片段：保留头尾各 50 字符并标出省略了多少；完整：原样传给模型。',
        'render.textFragment': '片段（头+尾）',
        'render.textFull': '完整值',
        'render.textSaved': '长文本设置已保存。',
        'cost.title': '代价阈值',
        'cost.hint': '一次追踪最多能花多少代价。这些数字决定哪一步算慢、边什么时候可以自动信任、以及大表上的无索引列什么时候要先问一句。',
        'cost.slowMs': '慢步骤',
        'cost.slowMsUnit': '毫秒',
        'cost.slowMsHint': '实测超过这个耗时的步骤会阻止自动信任。只有低于它的实测才算便宜。',
        'cost.timingWindow': '计时窗口',
        'cost.timingWindowUnit': '步',
        'cost.timingWindowHint': '每条边保留最近多少次耗时。更早的会被丢掉，让平均值跟着当前代价走。',
        'cost.trustSamples': '信任所需样本',
        'cost.trustSamplesUnit': '步',
        'cost.trustSamplesHint': '一条边要累计多少次实测才能被信任。不能大于计时窗口。',
        'cost.bigTableRows': '大表',
        'cost.bigTableRowsUnit': '行',
        'cost.bigTableRowsHint': '超过这个行数的表，无索引列会被当成全表扫描，追踪到这一步会先问一句再跑。行数取自数据库目录统计，绝不是 count(*)。',
        'cost.saved': '代价阈值已保存。',
        'scopes.title': '会话访问范围',
        'scopes.empty': '没有会话被限制——每个会话都能访问所有数据源。',
        'scopes.summary': '{n} 个会话受限 · 共 {rules} 条规则',
        'scopes.show': '展开',
        'scopes.hide': '收起',
        'scopes.clear': '全部清除',
        'scopes.remove': '移除这条限制',
        'scopes.removed': '已移除该会话的限制。',
        'scopes.cleared': '已清除全部会话限制。',
        'scopes.allSources': '全部数据源',
        'scopes.columnId': '会话 id',
        'scopes.columnTitle': '会话名',
        'scopes.columnSources': '访问的数据库',
        'scopes.noTitle': '未命名',
        'scopes.parked': '已归档',
        'scopes.parkedHint': '{n} 个已归档会话保留着限制，取消归档后会恢复。',
        'diag.venv': 'Python 虚拟环境',
        'diag.packages': 'Python 依赖',
        'diag.venvMissing': '尚未创建',
        'diag.venvHint': '一键在 <运行时目录>/.venv 建虚拟环境，并用它安装 server/requirements.txt。',
        'action.installDeps': '安装 / 修复依赖',
        'action.installing': '正在安装…',
        'notice.depsOk': '依赖已安装。',
        'notice.depsFail': '依赖安装失败，见诊断信息。',
        'notice.writeOn': '全局写权限已开启。数据源仍保持只读，直到你取消它自己的只读勾选。',
        'notice.writeOff': '全局写权限已关闭。所有写语句都会被拒绝。',
        'audit.title': '审计日志',
        'audit.empty': '还没有工具调用记录。',
        'audit.file': '日志文件',
        'audit.ok': '成功',
        'audit.err': '失败',
        'audit.hint': '每次 MCP 工具调用记一行：工具、调用方、数据源、耗时与结果。查询结果不会被记录。',
        'audit.clientHint': '发起这次调用的程序：dsh-agent、panel，或者 MCP 客户端连接时报上的名字。',
        'audit.rows': '{n} 行',
        'audit.loadMore': '加载更多',
        'audit.loadingMore': '加载中…',
        'audit.tz': '时间按本机时区显示（{zone}），日志文件里存的是 UTC。',
        'action.lockSource': '点击改为只读',
        'action.unlockSource': '点击允许写',
        'notice.nowReadOnly': '{name} 已改为只读。',
        'notice.nowWritable': '{name} 现在允许写。',
        'notice.nowWritableLocked': '{name} 现在允许写，但全局写开关还关着——到数据源列表标题行、分组输入框右边把它打开。',
        'sources.ddl': 'DDL',
        'sources.ddlHint': '此数据源可执行 create、alter、drop、truncate。',
        'sources.ddlBlockedHint': '此数据源接受 insert、update、delete，但拒绝 create、alter、drop。',
        'action.schema': '结构',
        'action.backToSources': '数据源',
        'tab.list': '数据源列表',
        'tab.create': '新建数据源',
        'tab.import': '从 DBeaver 导入',
        'tab.graph': '关系图',
        'tab.scenes': '场景',
        'tab.trace': '追踪',
        'tab.runtime': '运行时诊断',
        'tab.clients': '接入其它客户端',
      'tab.tools': '工具',
        'tab.audit': '审计日志',
        'graph.title': '关系图',
        'graph.hint': '这个数据源知道的所有表间连接。一条边是一个「说法」，只有你确认过才会被跟随——待确认的边会列出来，但从不参与追踪。',
        'graph.busy': '处理中…',
        'graph.noSources': '先添加数据源；关系图属于某一个数据源。',
        'graph.discover': '导入外键',
        'graph.mine': '从日志挖掘',
        'graph.add': '添加连接',
        'graph.cancel': '取消',
        'graph.save': '保存连接',
        'graph.addHint': '记录一个数据库没有声明的连接。左边是持有值的表，右边是它指向的表。',
        'graph.fromTable': '左表',
        'graph.fromColumn': '左列',
        'graph.toTable': '右表',
        'graph.toColumn': '右列',
        'graph.condition': '适用条件（可选）',
        'graph.conditionHint': "连接成立需要的额外 SQL，例如 status = 'POSTED'。设置条件不会改变边的状态。",
        'graph.conditionPlaceholder': "status = 'POSTED'",
        'graph.saveCondition': '保存条件',
        'graph.whenClause': '条件',
        'graph.filterAll': '全部',
        'graph.filterPending': '待确认',
        'graph.filterConfirmed': '已确认',
        'graph.filterBroken': '已失效',
        'graph.empty': '还没有记录任何连接。导入已声明的外键，或者手动添加一条。',
        'graph.emptyFiltered': '这个状态下没有边。',
        'graph.truncated': '只显示前 {n} 条，其余留在文件里。',
        'graph.statusPending': '待确认',
        'graph.statusConfirmed': '已确认',
        'graph.statusTrusted': '自动信任',
        'graph.statusStale': '已失效',
        'graph.statusRejected': '已拒绝',
        'graph.sourceFk': '外键',
        'graph.sourceManual': '手动添加',
        'graph.sourceInferred': '推断',
        'graph.sourceMined': '从审计日志挖掘',
        'graph.confirmedTimes': '确认 {n} 次',
        'graph.rejectedTimes': '拒绝 {n} 次',
        'graph.fanout': '扇出 {value}',
        'graph.rows': '约 {n} 行',
        'graph.avgMs': '每步 {ms}ms',
        'graph.indexYes': '有索引',
        'graph.indexNo': '无索引',
        'graph.indexUnknown': '索引未知',
        'graph.when': '于 {at}',
        'graph.failedBecause': '上次验证失败：{verdict}（{reason}）',
        'graph.verdictTooMany': '匹配到过多行',
        'graph.verdictMissing': '漏掉了本该找到的行',
        'graph.reasonWrongColumn': '连错列',
        'graph.reasonNeedsCondition': '需要加条件',
        'graph.reasonNotUnique': '值不唯一',
        'graph.rejectHint': '这条连接为什么不对？选择决定它怎么修。',
        'graph.confirm': '确认',
        'graph.reject': '拒绝',
        'graph.addCondition': '加条件',
        'graph.reopen': '重新打开',
        'graph.remove': '删除',
        'graph.record': '确认记录',
        'graph.hideRecord': '收起记录',
        'graph.recordHint': '这条边会被跟随。如果确认错了，可以在这里撤销。',
        'graph.noHistory': '还没有记录。',
        'trace.title': '按值追踪',
        'trace.hint': '给它一个值，它会先找出这个值落在哪张表哪一列，再沿已确认的 join 跨表走。SQL 由服务端按关系图拼装——这一页只收一个值，永远不收 SQL。',
        'trace.noSources': '先添加数据源；追踪是针对单个数据源跑的。',
        'trace.value': '值',
        'trace.valuePlaceholder': '订单号、编码、SKU…',
        'trace.entryTable': '入口表（可选）',
        'trace.entryColumn': '入口列（可选）',
        'trace.entryOptional': '留空则自动探测',
        'trace.direction': '方向',
        'trace.dirBoth': '双向',
        'trace.dirDown': '向下：引用它的行',
        'trace.dirUp': '向上：它引用的行',
        'trace.run': '追踪',
        'trace.running': '正在走…',
        'trace.needValue': '先输入要查的值。',
        'trace.nothing': '什么都没走到：从这个值出发没有已确认的边。',
        'trace.summary': '从 {table}.{column} 出发 — 命中 {tables} 张表，耗时 {ms}ms',
        'trace.summaryShort': '命中 {tables} 张表，耗时 {ms}ms',
        'trace.counts': '{steps} 步，读取 {rows} 行，深度 {depth}',
        'trace.rows': '{n} 行',
        'trace.chainBreaks': '0 行 —— 链路在此中断',
        'trace.stepMs': '{ms}ms',
        'trace.needsConfirmChip': '全表扫描',
        'trace.needsConfirm': '这一步会扫描整张表——该列没有索引，表又很大，所以没有执行。',
        'trace.continueAnyway': '仍然执行',
        'trace.needsConfirmSome': '{n} 步没有执行：这些步骤都会扫描整张表。确认要跑就点「仍然执行」。',
        'trace.stepFailed': '这一步失败了',
        'trace.truncated': '已截断',
        'trace.stopped': '中断位置',
        'trace.pendingTitle': '未跟随的边',
        'trace.pendingHint': '这些 join 本可以继续往下走，但它们还是待确认状态。到「关系图」页确认一条再重新追踪。',
        'trace.warnings': '警告',
        'trace.judgeOk': '这一步是对的',
        'trace.judgeWrong': '不太对',
        'trace.judgeMissing': '漏了行',
        'trace.judgeIrrelevant': '根本无关',
        'trace.scene': '场景',
        'trace.sceneAll': '整张关系图',
        'trace.sceneTables': '{n} 张表',
        'trace.dirBothShort': '双向',
        'trace.root': '起点',
        'trace.up': '向上',
        'trace.down': '向下',
        'trace.changeEntry': '改入口',
        'trace.manualEntry': '手动指定入口',
        'trace.showRowsN': '展开 {n} 行',
        'trace.hideRows': '收起',
        'trace.sceneClaim': '场景声明',
        'trace.outsideCount': '另有 {n} 张场景外的表未展开',
        'trace.outsideTitle': '场景之外',
        'trace.outsideNote': '走到这些连接就停了，因为那张表不在此场景里。把它纳进来才能继续读。',
        'trace.outsideChip': '场景外',
        'trace.addToScene': '纳入本次追踪',
        'trace.legend': '连线可信度：',
        'trace.legendFeedback': '✓ / ✗ 是对这条连线的反馈，不是对结果行的。',
        'trace.appearsIn': '这个值出现在 {n} 处，从这里出发：',
        'trace.overview': '这次追踪的形状，一列一个深度——点方块看那一步的细节',
        'trace.zoomIn': '放大',
        'trace.zoomOut': '缩小',
        'trace.zoomReset': '复位到 100%',
        'scene.saveAs': '存为场景',
        'scene.save': '保存场景',
        'scene.overwrite': '覆盖同名场景',
        'scene.overwrites': '已经有名为「{name}」的场景——保存会覆盖它。',
        'scene.cancel': '取消',
        'scene.name': '场景名',
        'scene.namePlaceholder': '例如：订单到收款',
        'scene.note': '备注',
        'scene.notePlaceholder': '可选',
        'scene.needName': '请给场景起个名字。',
        'scene.needTables': '这次追踪没有读到可以存成场景的表。',
        'scene.saved': '已保存场景「{name}」。',
        'scene.fromWalk': '本次追踪共 {n} 张表',
        'scene.title': '场景',
        'scene.hint': '场景就是一组有名字的表，用来把一次追踪限定在这一片——它不拥有任何连接，所以删掉场景，关系图里的边一条都不会少。',
        'scene.new': '新建场景',
        'scene.noSources': '先加一个数据源；场景是属于某个数据源的。',
        'scene.listEmpty': '这个数据源还没有场景。',
        'scene.pickHint': '从左边选一个场景，或者新建一个。',
        'scene.newHint': '起个名字，把这一个问题会涉及的表加进来，然后保存。',
        'scene.tablesTitle': '成员表',
        'scene.tablesEmpty': '还没有表——把场景要覆盖的表加进来。',
        'scene.addTable': '添加表',
        'scene.searchTables': '搜索表…',
        'scene.removeTable': '从场景中移除',
        'scene.keepOne': '一个场景至少要有 1 张表。',
        'scene.catalogEmpty': '这个数据源没有列出任何表。',
        'scene.moreTables': '还有 {n} 张——用搜索缩小范围',
        'scene.linksTitle': '成员之间已确认的连接',
        'scene.linksEmpty': '这些成员之间还没有已确认的连接。',
        'scene.linksHint': '两端都在场景里、状态为已确认或自动信任的连接。点一条可以到关系图查看。',
        'scene.isolatedTitle': '场景里没有已确认连接的成员',
        'scene.isolatedHint': '读到这些表，追踪就停住了。连接属于关系图，不属于场景。',
        'scene.noJoinAtAll': '这张表目前没有任何已确认的连接——场景内外都没有。',
        'scene.joinsOutside': '它已确认的连接都指向场景外：',
        'scene.adopt': '把 {n} 纳入场景',
        'scene.noCandidate': '这张表的列名和其他成员都不一样。',
        'scene.useCandidate': '用 {n}',
        'scene.sameName': '列名相同',
        'scene.addLink': '添加连接',
        'scene.delete': '删除场景',
        'scene.deleteConfirm': '确定删除这个场景？',
        'scene.deleteNote': '不会删除任何连接——每一条 join 都还在关系图里。',
        'scene.deleteCancel': '保留',
        'scene.deleted': '已删除场景「{name}」。',
        'scene.dirty': '未保存的改动',
        'notice.discovered': '已导入数据库声明的外键。',
        'notice.mined': '已从审计日志挖掘表间连接——它们以「待确认」状态进入关系图。',
        'notice.verdict': '已记录「{verdict}」。',
        'notice.conditionSet': '条件已保存。',
        'notice.conditionCleared': '条件已清除。',
        'notice.edgeDeleted': '边已删除。',
        'notice.edgeProposed': '连接已记录，起始状态为待确认。',
        'header.backToChat': '返回会话',
        'form.group': '分组',
        'form.groupHint': '同一分组的数据源会列在一起',
        'group.unassigned': '未分组',
        'group.count': '{n} 个',
        'group.new': '新建分组',
        'group.newPlaceholder': '分组名称',
        'group.add': '新建',
        'group.renameHint': '双击重命名',
        'group.save': '保存',
        'group.cancel': '取消',
        'group.delete': '删除',
        'group.deleteConfirm': '确认删除分组？',
        'group.selectAll': '全选该分组的数据源',
        'group.dragHint': '拖到分组上即可移动；勾选多行后拖动会整批移动',
        'group.empty': '把数据源拖到这里',
        'bulk.selected': '已选 {n} 个',
        'bulk.test': '批量测试',
        'bulk.readonly': '设为只读',
        'bulk.readwrite': '允许写',
        'bulk.group': '移动到分组',
        'bulk.groupPlaceholder': '分组名（留空表示清除）',
        'bulk.apply': '应用',
        'bulk.delete': '删除所选',
        'bulk.deleteConfirm': '确认删除 {n} 个',
        'bulk.clear': '清空',
        'notice.bulkDone': '已更新 {n} 个数据源。',
        'notice.bulkGrouped': '已把 {n} 个数据源移动到「{group}」。',
        'notice.groupSaved': '已保存分组「{name}」。',
        'notice.groupDeleted': '已删除分组「{name}」。',
        'notice.moved': '已移动到「{group}」。',
        'notice.movedMany': '已将 {n} 个数据源移动到「{group}」。',
        'schema.title': '{name} 的结构',
        'schema.tables': '表（{n}）',
        'schema.pick': '在左侧选一张表查看它的列。',
        'schema.empty': '这个数据源没有返回任何表。',
        'schema.loading': '正在读取结构…',
        'schema.error': '读取结构失败。',
        'schema.column': '列名',
        'schema.type': '类型',
        'schema.nullable': '可空',
        'schema.default': '默认值',
        'schema.pk': '主键',
        'schema.yes': '是',
        'schema.no': '否',
        'schema.columns': '{n} 列',
        'schema.matching': '匹配 {n} 个',
        'schema.search': '过滤表名',
        'schema.noMatch': '没有匹配的表。',
        'schema.defaultSchema': '默认模式',
        'schema.readonlyNote': '只读视图：这个页面不会执行任何 SQL。',
        'status.mcpOk': 'MCP 服务正常',
        'status.mcpDown': 'MCP 服务未就绪',
        'status.total': '总连接 {n}',
        'status.healthy': '{n} 正常',
        'status.failing': '{n} 异常',
        'status.failingNames': '({names})',
        'filter.all': '全部',
        'filter.failed': '仅看异常',
        'sources.searchPlaceholder': '搜索数据源…',
        'sources.noMatch': '没有符合条件的数据源。',
        'sources.failedLine': '连接失败：{message}',
        'group.expand': '展开该分组',
        'group.collapse': '折叠该分组',
        'action.copyError': '复制',
        'action.copied': '已复制',
        'action.copyErrorHint': '复制完整报错信息',
      },
    }

    const CSS = `
      .dbmcp-page {
        height: 100%;
        overflow: auto;
        box-sizing: border-box;
        padding: 22px 26px 40px;
        color: var(--dsw-alias-label-primary);
        background: var(--dsw-alias-bg-base);
        font: inherit;
        font-size: 13px;
        line-height: 1.5;
        -webkit-font-smoothing: antialiased;
      }
      .dbmcp-head h1 {
        margin: 0;
        font-size: 18px;
        font-weight: 600;
        line-height: 1.4;
        letter-spacing: 0.01em;
      }
      /* The masthead is the panel's identity: title, then the state pills, then
         the two links. It sits on the page's own background, separated from the
         content below by the tab rule rather than by a box of its own. */
      .dbmcp-masthead {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 9px;
        margin: 0;
        min-height: 28px;
      }
      .dbmcp-masthead h1 {
        margin: 0;
        font-size: 19px;
        font-weight: 650;
        letter-spacing: -0.005em;
        color: var(--dsw-alias-label-primary);
      }
      .dbmcp-masthead-spacer {
        flex: 1 1 auto;
      }
      .dbmcp-back {
        appearance: none;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        border: 0;
        background: none;
        padding: 2px 6px 2px 0;
        font: inherit;
        font-size: 13px;
        color: var(--dsw-alias-label-secondary);
        cursor: pointer;
        border-radius: 6px;
      }
      .dbmcp-back:hover {
        color: var(--dsw-alias-label-primary);
      }
      .dbmcp-back-caret {
        font-size: 15px;
        line-height: 1;
      }
      /* Seven tabs do not fit a sidebar. They used to be clipped, then they
         scrolled sideways with the bar hidden — which only traded one clipped tab
         for a half-cut pill whenever the active tab was the last one. The row
         wraps to a second line instead: nothing is hidden, and every pill stays
         whole. */
      .dbmcp-tabs {
        display: flex;
        flex-wrap: wrap;
        align-items: stretch;
        gap: 6px 8px;
        margin: 16px 0 0;
        border-bottom: 1px solid var(--dsw-alias-border-l1);
      }
      /* The active tab used to be a 2px underline and nothing else, which is the
         weakest possible signal on a row of eight words in the same colour. It now
         carries a filled pill and brand ink; the row keeps its rule so the tabs
         still read as a strip rather than as loose buttons. The gap above is the
         margin these pills need: at 2px a hovering tab touched the active one and
         the two fills read as a single blob. */
      .dbmcp-tab {
        appearance: none;
        border: 0;
        background: none;
        padding: 5px 11px 7px;
        margin-bottom: 5px;
        border-radius: 7px;
        font: inherit;
        font-size: 13px;
        line-height: 1.4;
        color: var(--dsw-alias-label-secondary);
        cursor: pointer;
        white-space: nowrap;
        transition: color 120ms ease, background 120ms ease;
      }
      /* The first pill sits on the same left edge as the masthead, the notices
         and the cards: its box is the thing that lines up, and the word inside
         keeps its own 11px inset. Pulling the pill left so the *text* landed on
         the heading's axis was the other way round, and it left the fill hanging
         11px outside every other box on the page. */
      .dbmcp-tab:first-child {
        margin-left: 0;
      }
      .dbmcp-tab:hover:not(.is-active) {
        color: var(--dsw-alias-label-primary);
        background: color-mix(in srgb, var(--dsw-alias-label-primary) 6%, transparent);
      }
      .dbmcp-tab:focus-visible {
        outline: 2px solid var(--dsw-alias-brand-primary);
        outline-offset: -1px;
        border-radius: 7px;
      }
      .dbmcp-tab.is-active {
        color: var(--dsw-alias-brand-primary);
        font-weight: 600;
        background: color-mix(in srgb, var(--dsw-alias-brand-primary) 13%, transparent);
      }
      .dbmcp-sub {
        margin: 6px 0 0;
        font-size: 13px;
        line-height: 1.6;
        color: var(--dsw-alias-label-secondary);
      }
      .dbmcp-toolbar {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 10px;
        margin: 16px 0 18px;
      }
      .dbmcp-crumbs {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px;
        margin: 14px 0 0;
        font-size: 13px;
      }
      .dbmcp-crumb {
        appearance: none;
        border: 0;
        background: none;
        padding: 4px 2px;
        font: inherit;
        color: var(--dsw-alias-brand-primary);
        cursor: pointer;
        border-radius: 4px;
        border-bottom: 2px solid transparent;
      }
      .dbmcp-crumb:hover {
        text-decoration: underline;
      }
      .dbmcp-crumb.is-current {
        color: var(--dsw-alias-label-primary);
        cursor: default;
        font-weight: 500;
        text-decoration: none;
        border-bottom-color: var(--dsw-alias-brand-primary);
      }
      .dbmcp-crumb-sep {
        color: var(--dsw-alias-label-secondary);
      }
      .dbmcp-title-switch {
        appearance: none;
        border: 0;
        background: none;
        padding: 0;
        font: inherit;
        color: inherit;
        cursor: pointer;
        border-radius: 4px;
      }
      .dbmcp-title-switch:hover {
        color: var(--dsw-alias-brand-primary);
      }
      .dbmcp-schema-head {
        margin-bottom: 10px;
      }
      .dbmcp-btn {
        appearance: none;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 8px;
        background: var(--dsw-alias-bg-layer-2);
        color: var(--dsw-alias-label-primary);
        font: inherit;
        font-size: 13px;
        line-height: 1.4;
        padding: 6px 14px;
        cursor: pointer;
        transition: border-color 120ms ease, background 120ms ease, color 120ms ease;
      }
      .dbmcp-btn:hover:not(:disabled) {
        border-color: var(--dsw-alias-border-l2);
        background: color-mix(in srgb, var(--dsw-alias-label-primary) 6%, var(--dsw-alias-bg-layer-2));
      }
      .dbmcp-btn:active:not(:disabled) {
        background: color-mix(in srgb, var(--dsw-alias-label-primary) 10%, var(--dsw-alias-bg-layer-2));
      }
      .dbmcp-btn:focus-visible {
        outline: 2px solid var(--dsw-alias-brand-primary);
        outline-offset: 2px;
      }
      .dbmcp-btn:disabled {
        opacity: 0.6;
        cursor: default;
      }
      /* The primary action is the one filled control on the page: an outlined
         button was indistinguishable from every secondary one next to it. */
      .dbmcp-btn.is-primary {
        border-color: var(--dsw-alias-brand-primary);
        background: var(--dsw-alias-brand-primary);
        color: var(--dsw-alias-bg-base);
        font-weight: 500;
      }
      .dbmcp-btn.is-primary:hover:not(:disabled) {
        border-color: var(--dsw-alias-brand-primary);
        background: color-mix(in srgb, var(--dsw-alias-brand-primary) 86%, var(--dsw-alias-label-primary));
      }
      .dbmcp-btn.is-danger {
        border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 45%, transparent);
        color: var(--dsw-alias-state-error-primary);
      }
      .dbmcp-btn.is-danger:hover:not(:disabled) {
        border-color: var(--dsw-alias-state-error-primary);
        background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent);
      }
      .dbmcp-btn.is-small {
        font-size: 12px;
        padding: 3px 9px;
        border-radius: 7px;
      }
      .dbmcp-btn.is-plain {
        border-color: transparent;
        background: transparent;
        color: var(--dsw-alias-label-secondary);
        padding: 3px 8px;
      }
      .dbmcp-btn.is-plain:hover:not(:disabled) {
        border-color: transparent;
        background: var(--dsw-alias-bg-layer-2);
        color: var(--dsw-alias-label-primary);
      }
      .dbmcp-btn.is-plain.is-danger {
        color: var(--dsw-alias-state-error-primary);
      }
      .dbmcp-btn.is-plain.is-danger:hover:not(:disabled) {
        background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent);
        color: var(--dsw-alias-state-error-primary);
      }
      .dbmcp-pill {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 999px;
        padding: 2px 9px;
        font-size: 12px;
        color: var(--dsw-alias-label-secondary);
      }
      /* An anchor styled as a pill: the star sits next to the connection state,
         and the whole thing is a link out to the repository. */
      a.dbmcp-pill.dbmcp-star {
        text-decoration: none;
        cursor: pointer;
        transition: color 120ms ease, border-color 120ms ease;
      }
      a.dbmcp-pill.dbmcp-star:hover {
        color: var(--dsw-alias-brand-primary);
        border-color: var(--dsw-alias-brand-primary);
      }
      /* The star glyph carries the meaning; the word stays so the pill still
         reads as a link when the glyph is missing from the font. */
      .dbmcp-star-mark {
        font-size: 13px;
        line-height: 1;
      }
      /* A row used to carry half a dozen bordered pills, one of which was the
         only thing that could be clicked and looked exactly like the rest. The
         state words are plain text now; the switch below is the only chrome on
         the row, so what can be operated is what looks operable. */
      .dbmcp-note {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        border: 0;
        padding: 0;
        font-size: 12px;
        font-weight: 400;
        color: var(--dsw-alias-label-secondary);
      }
      .dbmcp-note.is-broken {
        color: var(--dsw-alias-state-warn-primary);
      }
      /* The read-only / writable flip. A 36x20 track reads as a control at a
         glance, which is the one thing a pill with a status word on it never
         did — the word beside it still spells out which way the switch is.
         The filled track uses the ink token rather than the brand colour: at
         this size the brand read as a link, while ink reads as "this is
         switched on" in both themes (near-black on light, near-white on dark). */
      .dbmcp-switch {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        flex: 0 0 auto;
        padding: 0;
        border: 0;
        background: transparent;
        font-family: inherit;
        font-size: 12px;
        font-weight: 400;
        color: var(--dsw-alias-label-secondary);
        cursor: pointer;
      }
      .dbmcp-switch-track {
        position: relative;
        flex: 0 0 auto;
        width: 36px;
        height: 20px;
        border-radius: 999px;
        background: color-mix(in srgb, var(--dsw-alias-label-secondary) 32%, transparent);
        transition: background 140ms ease;
      }
      .dbmcp-switch-knob {
        position: absolute;
        top: 2px;
        left: 2px;
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: var(--dsw-alias-bg-base);
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.18);
        transition: transform 140ms ease;
      }
      .dbmcp-switch:hover:not(:disabled) {
        color: var(--dsw-alias-label-primary);
      }
      .dbmcp-switch.is-on {
        color: var(--dsw-alias-label-primary);
      }
      .dbmcp-switch.is-on .dbmcp-switch-track {
        background: var(--dsw-alias-label-primary);
      }
      .dbmcp-switch.is-on .dbmcp-switch-knob {
        transform: translateX(16px);
      }
      .dbmcp-switch:disabled {
        cursor: default;
        opacity: 0.55;
      }
      .dbmcp-switch:focus-visible .dbmcp-switch-track {
        outline: 2px solid var(--dsw-alias-brand-primary);
        outline-offset: 2px;
      }
      .dbmcp-hint.is-warn {
        color: var(--dsw-alias-state-warn-primary);
      }
      /* The identifier is the handle every MCP tool takes as its datasource
         argument, so it gets a chip of its own instead of trailing the target
         string: the label says what it is, the mono value is what gets pasted
         into chat. */
      .dbmcp-idchip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        max-width: 100%;
        padding: 1px 9px;
        border: 1px solid color-mix(in srgb, var(--dsw-alias-brand-primary) 32%, transparent);
        border-radius: 999px;
        background: color-mix(in srgb, var(--dsw-alias-brand-primary) 8%, transparent);
        color: var(--dsw-alias-brand-primary);
        font-family: inherit;
        font-size: 11px;
        line-height: 1.6;
        cursor: pointer;
        transition: border-color 120ms ease, background 120ms ease, color 120ms ease;
      }
      .dbmcp-idchip:hover {
        border-color: var(--dsw-alias-brand-primary);
        background: color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, transparent);
      }
      .dbmcp-idchip-key {
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.02em;
        text-transform: uppercase;
        opacity: 0.75;
        white-space: nowrap;
      }
      .dbmcp-idchip-value {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 12px;
        font-weight: 600;
      }
      .dbmcp-idchip.is-copied {
        border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary) 55%, transparent);
        background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent);
        color: var(--dsw-alias-state-success-primary);
      }
      .dbmcp-idchip-mark {
        font-size: 11px;
        line-height: 1;
      }
      .dbmcp-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
        gap: 16px;
        align-items: start;
      }
      .dbmcp-grid.is-single {
        grid-template-columns: minmax(0, 1fr);
      }
      /* A card sits one step above the page: a hairline border, a faint lift and
         a slightly tighter header. Without the shadow every card and every row
         shared the same plane, which is what made the panel read as a wireframe
         rather than a surface. */
      .dbmcp-card {
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 12px;
        background: var(--dsw-alias-bg-layer-1);
        padding: 10px 14px 12px;
        min-width: 0;
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
      }
      .dbmcp-audit-list {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .dbmcp-audit {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px 8px;
        padding: 4px 10px 5px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 10px;
        background: var(--dsw-alias-bg-layer-1);
        font-size: 13px;
        min-width: 0;
        box-sizing: border-box;
      }
      .dbmcp-audit-time {
        color: var(--dsw-alias-label-secondary);
        font-variant-numeric: tabular-nums;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 12px;
        white-space: nowrap;
      }
      .dbmcp-audit-tool {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 12px;
        color: var(--dsw-alias-label-primary);
        padding: 1px 7px;
        border-radius: 999px;
        border: 1px solid var(--dsw-alias-border-l1);
      }
      /* Who ran the call. Narrower than the tool pill: the tool name is the
         thing you scan for, the caller is the thing you check afterwards. */
      .dbmcp-audit-client {
        font-size: 12px;
        color: var(--dsw-alias-label-secondary);
        max-width: 220px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .dbmcp-audit-ok {
        font-size: 12px;
      }
      .dbmcp-audit-ok.is-ok {
        color: var(--dsw-alias-state-success-primary);
      }
      .dbmcp-audit-ok.is-error {
        color: var(--dsw-alias-state-error-primary);
      }
      /* The statement is the payload of an audit row: the one thing you come to
         this tab to read. It used to be secondary-coloured text inline with the
         metadata, which made a query look like a caption. It now gets its own
         recessed block, ink on the base surface with a brand rule down the left,
         so the row reads as "these facts about that statement". */
      .dbmcp-audit-sql {
        display: block;
        width: 100%;
        margin-top: 1px;
        padding: 5px 9px;
        border-left: 3px solid color-mix(in srgb, var(--dsw-alias-brand-primary) 55%, transparent);
        border-radius: 4px 8px 8px 4px;
        background: var(--dsw-alias-bg-base);
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 12.5px;
        line-height: 1.45;
        color: var(--dsw-alias-label-primary);
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        tab-size: 2;
        user-select: text;
        /* The Host keeps up to 2000 characters of a statement. Rendering all of
           it inline would let one long query push the rest of the audit out of
           sight; the block scrolls instead, and the text stays selectable. */
        max-height: 240px;
        overflow-y: auto;
      }
      .dbmcp-audit-sql.is-error {
        border-left-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 65%, transparent);
        background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 7%, var(--dsw-alias-bg-base));
        color: var(--dsw-alias-state-error-primary);
      }
      .dbmcp-audit-more {
        align-self: center;
        margin: 2px 0 4px;
      }
      .dbmcp-schema-wrap {
        display: flex;
        flex-direction: column;
        gap: 12px;
        /* The panel is a sidebar, so its own width — not the viewport's — decides
           whether two columns still fit. The wrapper is the container because an
           element cannot answer a query about its own size. */
        container-type: inline-size;
      }
      .dbmcp-schema {
        display: grid;
        grid-template-columns: minmax(160px, 220px) minmax(0, 1fr);
        gap: 18px;
        align-items: start;
      }
      /* One column when the panel is narrow: the rail keeps its own scroll box
         above the column list instead of squeezing the names to two characters. */
      @container (max-width: 560px) {
        .dbmcp-schema {
          grid-template-columns: minmax(0, 1fr);
        }
        .dbmcp-schema-groups {
          max-height: 300px;
        }
      }
      .dbmcp-schema-side {
        display: flex;
        flex-direction: column;
        gap: 8px;
        min-width: 0;
        padding: 12px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 12px;
        background: var(--dsw-alias-bg-layer-1);
      }
      .dbmcp-schema-main {
        min-width: 0;
      }
      /* The scene rail. Same box as the catalogue rail beside it, but the rows are
         buttons — a scene is picked, not opened — so the scroll box lives here and
         the page keeps its height no matter how many scenes are saved. */
      .dbmcp-scene-list {
        display: flex;
        flex-direction: column;
        gap: 2px;
        max-height: 420px;
        overflow: auto;
      }
      .dbmcp-scene-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        width: 100%;
        padding: 6px 8px;
        border: 1px solid transparent;
        border-radius: 8px;
        background: var(--dsw-alias-bg-base);
        color: var(--dsw-alias-label-primary);
        font: inherit;
        font-size: 13px;
        text-align: left;
        cursor: pointer;
        transition: background 100ms ease, border-color 100ms ease;
      }
      .dbmcp-scene-row:hover {
        background: var(--dsw-alias-bg-layer-2);
      }
      .dbmcp-scene-row.is-active {
        border-color: var(--dsw-alias-brand-primary);
        background: var(--dsw-alias-bg-layer-2);
      }
      .dbmcp-scene-row .dbmcp-pill {
        flex: 0 0 auto;
      }
      /* A scene name is typed by the reader, so it can be long; the count pill is
         what must stay whole. */
      .dbmcp-scene-name {
        min-width: 0;
        flex: 1 1 auto;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .dbmcp-scene-detail {
        display: flex;
        flex-direction: column;
        gap: 14px;
        min-width: 0;
      }
      .dbmcp-scene-block {
        display: flex;
        flex-direction: column;
        gap: 8px;
        min-width: 0;
        padding-top: 12px;
        border-top: 1px solid var(--dsw-alias-border-l1);
      }
      .dbmcp-scene-members {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .dbmcp-scene-member {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        min-width: 0;
        padding: 5px 8px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 8px;
        background: var(--dsw-alias-bg-layer-1);
      }
      .dbmcp-scene-member-name {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-family: var(--dsw-alias-font-mono);
        font-size: 12px;
        color: var(--dsw-alias-label-primary);
      }
      .dbmcp-scene-member .dbmcp-btn {
        flex: 0 0 auto;
      }
      /* The catalogue picker: a search box and a wrap of candidate chips, scrolling
         on its own so a wide schema does not push the detail panes off the page. */
      .dbmcp-scene-picker {
        display: flex;
        flex-direction: column;
        gap: 8px;
        min-width: 0;
        padding: 10px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 10px;
        background: var(--dsw-alias-bg-layer-1);
      }
      .dbmcp-scene-candidates {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        max-height: 180px;
        overflow: auto;
      }
      .dbmcp-scene-links {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      /* A join row is a link into the Relations page, so it is a button that looks
         like the edge rows there — path on the left, status chip on the right. */
      .dbmcp-scene-link {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        width: 100%;
        min-width: 0;
        padding: 6px 8px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 8px;
        background: var(--dsw-alias-bg-base);
        color: var(--dsw-alias-label-primary);
        font: inherit;
        text-align: left;
        cursor: pointer;
        transition: background 100ms ease, border-color 100ms ease;
      }
      .dbmcp-scene-link:hover {
        background: var(--dsw-alias-bg-layer-2);
        border-color: var(--dsw-alias-border-l2);
      }
      /* The path wraps instead of truncating: at a narrow width an ellipsis cut the
         target column, which is the half of the join a reader came here to see. */
      .dbmcp-scene-link .dbmcp-edge-path {
        min-width: 0;
        overflow-wrap: anywhere;
        line-height: 1.35;
      }
      .dbmcp-scene-link .dbmcp-pill {
        flex: 0 0 auto;
      }
      /* A member with no confirmed join stacks: its name and toggle on one line, then
         what it does connect to, then the candidates the catalogue suggests. */
      .dbmcp-scene-member.is-block {
        flex-direction: column;
        align-items: stretch;
        gap: 6px;
      }
      .dbmcp-scene-member-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        min-width: 0;
      }
      .dbmcp-scene-member-head .dbmcp-btn {
        flex: 0 0 auto;
      }
      /* The adopt row: the names this table joins outside the scene, each one a
         button that takes that table into the membership list. */
      .dbmcp-scene-adopt {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
      }
      .dbmcp-scene-candidate {
        font-family: var(--dsw-alias-font-mono);
        font-size: 12px;
        color: var(--dsw-alias-label-primary);
      }
      .dbmcp-scene-why {
        font-size: 11px;
        color: var(--dsw-alias-label-secondary);
      }
      .dbmcp-scene-actions {
        align-items: center;
        flex-wrap: wrap;
      }
      /* Deleting a scene is a second click and a sentence about what survives it;
         the box is tinted with the error state so it does not read as routine. */
      .dbmcp-scene-confirm {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 10px;
        border: 1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary) 45%, var(--dsw-alias-border-l1));
        border-radius: 10px;
        background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 6%, var(--dsw-alias-bg-base));
      }
      /* Sub-view header row: where you came from, which connection it is, and
         the identifier to hand to the agent — all on one line. */
      .dbmcp-view-bar {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
        min-width: 0;
        margin-bottom: 12px;
      }
      .dbmcp-view-target {
        min-width: 0;
        color: var(--dsw-alias-label-secondary);
        font-size: 12px;
        word-break: break-all;
      }
      .dbmcp-schema-head {
        display: flex;
        align-items: baseline;
        gap: 10px;
        font-size: 12px;
        font-weight: 600;
        color: var(--dsw-alias-label-secondary);
      }
      /* The qualified name of the open table: the same truncation rule as the
         rail, so a long name cannot push the column count out of the card. */
      .dbmcp-schema-title {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--dsw-alias-label-primary);
      }
      .dbmcp-schema-head .dbmcp-hint {
        flex: 0 0 auto;
      }
      .dbmcp-schema-tables {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
        max-height: 420px;
        overflow: auto;
      }
      .dbmcp-schema-groups {
        display: flex;
        flex-direction: column;
        gap: 10px;
        max-height: 460px;
        overflow: auto;
      }
      .dbmcp-schema-group {
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-width: 0;
      }
      .dbmcp-schema-group-head {
        display: flex;
        align-items: center;
        gap: 6px;
        width: 100%;
        padding: 5px 6px;
        border: 0;
        border-radius: 7px;
        background: transparent;
        color: var(--dsw-alias-label-secondary);
        font: inherit;
        font-size: 12px;
        font-weight: 650;
        letter-spacing: 0.01em;
        text-align: left;
        cursor: pointer;
        transition: background 100ms ease;
      }
      .dbmcp-schema-group-head:hover {
        background: var(--dsw-alias-bg-layer-2);
      }
      .dbmcp-schema-caret {
        width: 12px;
        flex: 0 0 auto;
        color: var(--dsw-alias-label-secondary);
      }
      .dbmcp-schema-group-name {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .dbmcp-schema-table {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        width: 100%;
        padding: 6px 8px;
        border: 1px solid transparent;
        border-radius: 8px;
        background: var(--dsw-alias-bg-base);
        color: var(--dsw-alias-label-primary);
        font: inherit;
        font-size: 13px;
        text-align: left;
        cursor: pointer;
        transition: background 100ms ease, border-color 100ms ease;
      }
      /* A GaussDB catalog hands out names like
         global_plancache_status_global_recovery_status — longer than the rail is
         wide. The name gets the room, truncates with an ellipsis, and keeps the
         full value in its title; the kind pill never shrinks. */
      .dbmcp-schema-name {
        min-width: 0;
        flex: 1 1 auto;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .dbmcp-schema-table .dbmcp-pill {
        flex: 0 0 auto;
      }
      .dbmcp-schema-table:hover {
        background: var(--dsw-alias-bg-layer-2);
      }
      .dbmcp-schema-table.is-active {
        border-color: var(--dsw-alias-brand-primary);
        background: var(--dsw-alias-bg-layer-2);
      }
      .dbmcp-schema-tablegrid {
        width: 100%;
        border-collapse: collapse;
        font-size: 13px;
        margin-top: 8px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 10px;
        overflow: hidden;
      }
      /* Five columns of column names, types and defaults do not fit a narrow
         sidebar. The wrapper scrolls rather than letting the rightmost columns
         fall off the panel edge; the table keeps a readable floor so the type
         column still wraps in words instead of one character per line. */
      .dbmcp-schema-tablewrap {
        overflow-x: auto;
        border-radius: 10px;
      }
      .dbmcp-schema-tablewrap .dbmcp-schema-tablegrid {
        min-width: 320px;
      }
      .dbmcp-schema-tablegrid th,
      .dbmcp-schema-tablegrid td {
        text-align: left;
        padding: 5px 9px;
        border-bottom: 1px solid var(--dsw-alias-border-l1);
        vertical-align: top;
      }
      .dbmcp-schema-tablegrid tbody tr:hover {
        background: var(--dsw-alias-bg-layer-1);
      }
      .dbmcp-schema-tablegrid tr:last-child td {
        border-bottom: none;
      }
      .dbmcp-schema-tablegrid th {
        font-weight: 600;
        font-size: 12px;
        color: var(--dsw-alias-label-secondary);
        background: var(--dsw-alias-bg-layer-1);
      }
      .dbmcp-schema-note {
        margin-top: 10px;
      }
      .dbmcp-mono {
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 12px;
      }
      .dbmcp-endpoint {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        margin: 8px 0 12px;
      }
      /* The URL and its three controls share one line. The URL grows into the
         leftover space but keeps a basis wide enough to stay readable; when the
         panel is too narrow for both, the controls wrap underneath instead of
         squeezing the address into a stub. */
      .dbmcp-endpoint-url {
        flex: 1 1 260px;
        min-width: 0;
        padding: 6px 10px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 8px;
        background: var(--dsw-alias-bg-base);
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 12px;
        color: var(--dsw-alias-label-primary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        user-select: all;
      }
      /* The port used to be a bare box between two buttons with only an
         aria-label: on screen nothing said what it held. It carries a visible
         label now, so the row reads "copy · port 8765 · stop". */
      .dbmcp-port-label {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 12px;
        color: var(--dsw-alias-label-secondary);
      }
      .dbmcp-port {
        flex: 0 0 78px;
        width: 78px;
        text-align: center;
        font-variant-numeric: tabular-nums;
      }
      /* The three controls travel as one group so they wrap as a unit under the
         URL rather than splitting across two lines. */
      .dbmcp-endpoint-actions {
        display: flex;
        align-items: center;
        gap: 8px;
        flex: 0 0 auto;
      }
      .dbmcp-clients {
        display: flex;
        flex-direction: column;
        gap: 5px;
      }
      .dbmcp-client {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 6px 9px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 10px;
        background: var(--dsw-alias-bg-layer-1);
        transition: border-color 120ms ease;
      }
      .dbmcp-client:hover {
        border-color: var(--dsw-alias-border-l2);
      }
      .dbmcp-client-main {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
        flex: 1 1 auto;
      }
      .dbmcp-client-name {
        font-size: 13px;
        font-weight: 500;
      }
      .dbmcp-client-main .dbmcp-hint {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .dbmcp-client-actions {
        display: flex;
        align-items: center;
        gap: 6px;
        flex: 0 0 auto;
      }
      .dbmcp-tools-head {
        display: flex;
        align-items: baseline;
        gap: 10px;
        margin: 16px 0 8px;
        flex-wrap: wrap;
      }
      .dbmcp-tools-title {
        margin: 0;
        font-size: 13px;
        font-weight: 650;
        letter-spacing: -0.003em;
        color: var(--dsw-alias-label-primary);
      }
      .dbmcp-tools {
        display: flex;
        flex-direction: column;
        gap: 3px;
      }
      .dbmcp-tool {
        display: flex;
        align-items: center;
        gap: 9px;
        padding: 4px 9px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 9px;
        background: var(--dsw-alias-bg-layer-1);
        cursor: pointer;
        min-width: 0;
        transition: border-color 120ms ease, background 120ms ease;
      }
      .dbmcp-tool:hover {
        border-color: var(--dsw-alias-border-l2);
        background: var(--dsw-alias-bg-layer-2);
      }
      .dbmcp-tool.is-off .dbmcp-tool-main {
        opacity: 0.6;
      }
      /* Same control as the global write switch, so "on" looks the same on both
         pages. It sits where the checkbox used to, and the row itself still
         toggles: the switch stops propagation, so a click on it is one flip. */
      .dbmcp-tool .dbmcp-switch {
        margin-left: 1px;
      }
      .dbmcp-limit-unit { font-size: 12px; color: var(--dsw-alias-label-secondary); }
      /* One card holds the numbers and the long-text setting, one setting per
         line: a labelled control on top, its explanation underneath. */
      .dbmcp-render-fields {
        display: flex;
        flex-direction: column;
        gap: 14px;
      }
      .dbmcp-render-field {
        display: flex;
        flex-direction: column;
        gap: 3px;
        min-width: 0;
      }
      .dbmcp-render-head {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .dbmcp-render-label {
        font-size: 12px;
        font-weight: 500;
        color: var(--dsw-alias-label-primary);
        white-space: nowrap;
      }
      .dbmcp-render-hint {
        margin: 0;
        font-size: 12px;
        line-height: 1.45;
        color: var(--dsw-alias-label-secondary);
      }
      .dbmcp-render-input {
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }
      .dbmcp-render-field .dbmcp-limit {
        width: 72px;
        padding: 2px 6px;
        font-size: 12px;
        text-align: center;
        font-variant-numeric: tabular-nums;
      }
      .dbmcp-textpolicy-select {
        width: auto;
        min-width: 160px;
      }
      .dbmcp-tool-main {
        display: flex;
        flex-direction: column;
        gap: 0;
        min-width: 0;
        flex: 1 1 auto;
      }
      .dbmcp-tool-name {
        font-family: var(--dbmcp-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
        font-size: 12px;
        line-height: 1.4;
        color: var(--dsw-alias-label-primary);
      }
      .dbmcp-tool-desc {
        font-size: 12px;
        line-height: 1.35;
        color: var(--dsw-alias-label-secondary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .dbmcp-card-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        margin-bottom: 10px;
        min-height: 22px;
      }
      .dbmcp-card-title {
        margin: 0;
        font-size: 13px;
        font-weight: 650;
        letter-spacing: -0.003em;
        color: var(--dsw-alias-label-primary);
      }
      .dbmcp-empty {
        padding: 26px 10px;
        text-align: center;
        color: var(--dsw-alias-label-secondary);
        font-size: 13px;
        line-height: 1.7;
      }
      .dbmcp-empty strong {
        display: block;
        margin-bottom: 6px;
        color: var(--dsw-alias-label-primary);
        font-weight: 600;
      }
      .dbmcp-empty p {
        margin: 0 auto;
        max-width: 34em;
      }
      .dbmcp-rows {
        display: flex;
        flex-direction: column;
        gap: 3px;
        font-size: 13px;
        line-height: 1.5;
      }
      /* The list is a table: an id, a name and the data sources are three
         different kinds of thing, and three columns read across far better than
         a line of run-on text. It opens expanded, because a limit is set by the
         agent and the panel is the only place it can be read — hiding it behind
         a click made it invisible to the person who has to check it. The box
         scrolls and the header sticks, so a long list never pushes the page
         around. */
      .dbmcp-scope-box {
        margin-top: 10px;
        max-height: 280px;
        overflow: auto;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 8px;
        background: var(--dsw-alias-bg-base);
      }
      .dbmcp-scope-table {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
      }
      .dbmcp-scope-th {
        position: sticky;
        top: 0;
        z-index: 1;
        padding: 6px 10px;
        text-align: left;
        font-size: 11px;
        font-weight: 500;
        letter-spacing: 0.02em;
        color: var(--dsw-alias-label-secondary);
        background: var(--dsw-alias-bg-layer-1);
        border-bottom: 1px solid var(--dsw-alias-border-l1);
        white-space: nowrap;
      }
      .dbmcp-scope-th.is-id {
        width: 40%;
      }
      .dbmcp-scope-th.is-title {
        width: 28%;
      }
      .dbmcp-scope-th.is-sources {
        width: 26%;
      }
      .dbmcp-scope-th.is-action {
        width: 48px;
      }
      .dbmcp-scope-cell {
        padding: 7px 10px;
        vertical-align: top;
        min-width: 0;
        font-size: 12px;
        color: var(--dsw-alias-label-primary);
      }
      .dbmcp-scope-row + .dbmcp-scope-row .dbmcp-scope-cell {
        border-top: 1px solid var(--dsw-alias-border-l1);
      }
      /* A parked row is informational: the limit belongs to a conversation that
         is no longer in the list, so it is dimmed rather than given a remove
         button the user cannot act on here. */
      .dbmcp-scope-row.is-parked .dbmcp-scope-cell {
        background: var(--dsw-alias-bg-layer-1);
        color: var(--dsw-alias-label-secondary);
      }
      .dbmcp-scope-cell.is-action {
        text-align: right;
        white-space: nowrap;
      }
      /* The id is shown in full: it is the only thing the user can match against
         their own logs, so it wraps instead of being shortened. */
      .dbmcp-scope-id {
        display: block;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 11px;
        line-height: 1.45;
        color: var(--dsw-alias-label-secondary);
        word-break: break-all;
      }
      .dbmcp-scope-title {
        display: block;
        font-weight: 500;
        color: var(--dsw-alias-label-primary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .dbmcp-scope-none {
        color: var(--dsw-alias-label-secondary);
        font-style: italic;
      }
      .dbmcp-scope-sources {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
      }
      .dbmcp-scope-chip {
        max-width: 100%;
        padding: 0 6px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 999px;
        background: var(--dsw-alias-bg-layer-1);
        font-size: 11px;
        line-height: 1.6;
        color: var(--dsw-alias-label-secondary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .dbmcp-scope-tag {
        font-size: 11px;
        color: var(--dsw-alias-label-secondary);
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 999px;
        padding: 0 6px;
        white-space: nowrap;
      }
      .dbmcp-scope-note .dbmcp-scope-cell {
        padding: 8px 10px 4px;
        font-size: 11px;
        color: var(--dsw-alias-label-secondary);
        background: var(--dsw-alias-bg-layer-1);
        border-top: 1px solid var(--dsw-alias-border-l1);
      }
      .dbmcp-scope-remove {
        padding: 0 5px;
        border: 0;
        background: transparent;
        color: var(--dsw-alias-label-secondary);
        font-size: 14px;
        line-height: 1.4;
        cursor: pointer;
        border-radius: 5px;
      }
      .dbmcp-scope-remove:hover:not(:disabled) {
        background: var(--dsw-alias-bg-layer-2);
        color: var(--dsw-alias-label-primary);
      }
      .dbmcp-scope-remove:disabled {
        cursor: default;
        opacity: 0.5;
      }
      .dbmcp-row {
        display: grid;
        grid-template-columns: 116px minmax(0, 1fr);
        column-gap: 10px;
        align-items: baseline;
        padding: 3px 8px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 8px;
        background: var(--dsw-alias-bg-layer-1);
        min-width: 0;
      }
      .dbmcp-k {
        color: var(--dsw-alias-label-secondary);
      }
      .dbmcp-v {
        color: var(--dsw-alias-label-primary);
        word-break: break-all;
      }
      /* A value made of text plus a control needs its own breathing room. */
      .dbmcp-inline {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 10px;
        min-width: 0;
      }
      .dbmcp-dot {
        display: inline-block;
        width: 6px;
        height: 6px;
        border-radius: 50%;
        margin-right: 6px;
        background: var(--dsw-alias-state-idle-primary);
      }
      .dbmcp-dot.is-ok {
        background: var(--dsw-alias-state-success-primary);
      }
      .dbmcp-dot.is-error {
        background: var(--dsw-alias-state-error-primary);
      }
      .dbmcp-error {
        border: 1px solid var(--dsw-alias-state-error-primary);
        border-radius: 12px;
        padding: 16px 18px;
        color: var(--dsw-alias-label-primary);
        font-size: 13px;
        line-height: 1.6;
      }
      .dbmcp-error code {
        display: block;
        margin: 8px 0 12px;
        color: var(--dsw-alias-label-secondary);
        font-size: 12px;
        word-break: break-all;
      }
      .dbmcp-list {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin: 0;
        padding: 0;
        list-style: none;
        /* Rows answer their own width, not the viewport's: in a narrow panel the
           four row buttons used to squeeze into a two-character column. The
           query sits further down, after the rules it overrides. */
        container-type: inline-size;
      }
      /* Rows get a hover plane of their own so a pointer anywhere over the row
         knows which row it is about — the row is a big click target for the
         switch, and previously nothing moved under the cursor. */
      .dbmcp-item {
        display: flex;
        flex-direction: column;
        gap: 4px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 10px;
        background: var(--dsw-alias-bg-layer-2);
        padding: 6px 9px;
        font-size: 13px;
        transition: border-color 120ms ease, background 120ms ease;
      }
      .dbmcp-item:hover {
        border-color: var(--dsw-alias-border-l2);
      }
      .dbmcp-item-row {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 10px;
      }
      .dbmcp-grip {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 18px;
        height: 26px;
        flex: 0 0 18px;
        padding: 0;
        border: none;
        background: transparent;
        cursor: grab;
        user-select: none;
        border-radius: 4px;
      }
      .dbmcp-grip-dots {
        display: block;
        width: 12px;
        height: 15px;
        background-image: radial-gradient(circle, currentColor 1.5px, transparent 1.6px);
        background-size: 6px 5px;
        background-position: 0 0;
        background-repeat: repeat;
        color: var(--dsw-alias-label-secondary);
        opacity: 0.45;
      }
      .dbmcp-grip:hover .dbmcp-grip-dots {
        opacity: 0.85;
      }
      .dbmcp-grip:active {
        cursor: grabbing;
      }
      .dbmcp-kind-badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 26px;
        height: 26px;
        flex: 0 0 26px;
        margin-top: 1px;
        border-radius: 8px;
        border: 1px solid var(--dsw-alias-border-l1);
        background: var(--dsw-alias-bg-layer-2);
        color: var(--dsw-alias-label-primary);
        font-size: 10px;
        font-weight: 650;
        line-height: 1;
        letter-spacing: 0.03em;
        text-transform: uppercase;
        overflow: hidden;
      }
      .dbmcp-item.is-failed {
        border-color: var(--dsw-alias-state-error-primary);
        border-left-width: 3px;
        background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, var(--dsw-alias-bg-layer-2));
      }
      .dbmcp-item-failure {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        color: var(--dsw-alias-state-error-primary);
      }
      .dbmcp-fail-tri {
        flex: 0 0 auto;
        font-size: 13px;
        line-height: 1;
      }
      .dbmcp-fail-text {
        flex: 1 1 260px;
        min-width: 0;
        font-size: 12px;
        overflow-wrap: anywhere;
      }
      /* The strip that carries the MCP state, the counts and the filter chips.
         It is the first thing under the tabs, so it gets the page's one tinted
         surface: a bordered box the same weight as a card just read as another
         card and pushed the list down without saying anything. It carries no
         bottom margin of its own — the grid gap already separates it from the
         list, and the two together left a dead band under the strip. */
      .dbmcp-status {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 10px 12px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 10px;
        background: color-mix(in srgb, var(--dsw-alias-label-primary) 3%, var(--dsw-alias-bg-layer-1));
      }
      .dbmcp-status-row {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        font-size: 12px;
        min-height: 24px;
      }
      .dbmcp-status-row.is-filters {
        gap: 12px;
      }
      .dbmcp-stats {
        display: inline-flex;
        align-items: center;
        gap: 12px;
        padding: 2px 10px;
        border-radius: 999px;
        color: var(--dsw-alias-label-secondary);
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }
      .dbmcp-stat {
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }
      .dbmcp-stat::before {
        content: none;
      }
      .dbmcp-stat.is-ok::before,
      .dbmcp-stat.is-error::before {
        content: '';
        width: 6px;
        height: 6px;
        flex: 0 0 6px;
        border-radius: 50%;
        background: currentColor;
      }
      .dbmcp-stat.is-ok {
        color: var(--dsw-alias-state-success-primary);
      }
      .dbmcp-stat.is-error {
        color: var(--dsw-alias-state-error-primary);
      }
      .dbmcp-stat-sep {
        width: 1px;
        height: 11px;
        background: var(--dsw-alias-border-l2);
      }
      .dbmcp-status-spacer {
        flex: 1 1 auto;
      }
      /* The global write switch lives in the list card's title row, right after
         the group form. It is a decision about these sources, so it sits with
         them rather than in the diagnostics page. */
      .dbmcp-list-write {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        flex: 0 0 auto;
        margin-left: 4px;
      }
      .dbmcp-list-write-label {
        font-size: 12px;
        color: var(--dsw-alias-label-secondary);
        white-space: nowrap;
      }
      .dbmcp-status-label {
        font-weight: 600;
        color: var(--dsw-alias-label-primary);
      }
      .dbmcp-status-sep {
        width: 1px;
        height: 12px;
        background: var(--dsw-alias-border-l2);
      }
      .dbmcp-status-dot {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        color: var(--dsw-alias-label-secondary);
      }
      .dbmcp-status-dot::before {
        content: '';
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: currentColor;
      }
      .dbmcp-status-dot.is-ok {
        color: var(--dsw-alias-state-success-primary);
      }
      .dbmcp-status-dot.is-error {
        color: var(--dsw-alias-state-error-primary);
      }
      .dbmcp-chips {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
      }
      .dbmcp-chip-icon {
        font-size: 12px;
        line-height: 1;
      }
      .dbmcp-chip {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 999px;
        background: transparent;
        color: var(--dsw-alias-label-secondary);
        font-family: inherit;
        font-size: 12px;
        padding: 4px 13px;
        cursor: pointer;
        transition: color 120ms ease, border-color 120ms ease, background 120ms ease;
      }
      .dbmcp-chip:hover {
        color: var(--dsw-alias-label-primary);
        border-color: var(--dsw-alias-label-secondary);
      }
      .dbmcp-chip.is-active {
        background: var(--dsw-alias-label-primary);
        border-color: var(--dsw-alias-label-primary);
        color: var(--dsw-alias-bg-base);
      }
      .dbmcp-chip.is-warn {
        color: var(--dsw-alias-state-error-primary);
        border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 35%, transparent);
      }
      .dbmcp-chip.is-warn.is-active {
        background: var(--dsw-alias-state-error-primary);
        border-color: var(--dsw-alias-state-error-primary);
        color: var(--dsw-alias-bg-base);
      }
      .dbmcp-chip-count {
        opacity: 0.7;
      }
      .dbmcp-status-search {
        flex: 0 0 auto;
        width: 300px;
        max-width: 100%;
      }
      .dbmcp-status-search .dbmcp-input {
        width: 100%;
      }
      .dbmcp-item.is-selected {
        border-color: var(--dsw-alias-brand-primary);
        background: var(--dsw-alias-bg-layer-1);
      }
      .dbmcp-item-pick {
        display: flex;
        align-items: center;
        padding-top: 2px;
        cursor: pointer;
      }
      .dbmcp-item-pick input {
        width: 14px;
        height: 14px;
        accent-color: var(--dsw-alias-brand-primary);
        cursor: pointer;
      }
      .dbmcp-groups {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .dbmcp-group {
        display: flex;
        flex-direction: column;
        gap: 3px;
      }
      .dbmcp-group-head {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 0 2px;
      }
      .dbmcp-group-name {
        font-size: 12px;
        font-weight: 600;
        color: var(--dsw-alias-label-primary);
        letter-spacing: 0.02em;
      }
      .dbmcp-card-head > .dbmcp-pill {
        margin-left: auto;
      }
      .dbmcp-list-head {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        margin: 2px 0 8px;
      }
      .dbmcp-list-head .dbmcp-card-title {
        margin-right: 4px;
        font-size: 13px;
        font-weight: 650;
      }
      .dbmcp-list-spacer {
        flex: 1 1 auto;
      }
      .dbmcp-fold {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 14px;
        height: 18px;
        flex: 0 0 14px;
        padding: 0;
        border: none;
        border-radius: 4px;
        background: transparent;
        color: var(--dsw-alias-label-secondary);
        cursor: pointer;
      }
      .dbmcp-fold::before {
        content: '';
        display: block;
        width: 0;
        height: 0;
        border-style: solid;
        border-width: 4.5px 0 4.5px 6.5px;
        border-color: transparent transparent transparent currentColor;
        transition: transform 130ms ease;
      }
      .dbmcp-fold:hover {
        color: var(--dsw-alias-label-primary);
      }
      .dbmcp-fold.is-open::before {
        transform: rotate(90deg);
      }
      .dbmcp-card-actions {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-left: 4px;
      }
      .dbmcp-group-actions {
        display: flex;
        align-items: center;
        gap: 4px;
        margin-left: auto;
      }
      .dbmcp-group-edit {
        display: flex;
        align-items: center;
        gap: 6px;
        flex: 0 1 auto;
      }
      .dbmcp-group-edit .dbmcp-input {
        width: 170px;
      }
      .dbmcp-group-edit .dbmcp-btn,
      .dbmcp-item-rename .dbmcp-btn {
        flex: 0 0 auto;
        white-space: nowrap;
        padding: 3px 10px;
      }
      .dbmcp-group.is-over {
        outline: 1px dashed var(--dsw-alias-brand-primary);
        outline-offset: 3px;
        border-radius: 6px;
      }
      .dbmcp-item.is-dragging {
        opacity: 0.55;
      }
      /* A checked block drags as one; the tint tells the user the whole block
         is in hand, not just the row under the cursor. */
      .dbmcp-list.is-dragging-block .dbmcp-item.is-dragging {
        opacity: 0.7;
        border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 45%, transparent);
      }
      .dbmcp-item.is-drop-before {
        box-shadow: 0 -2px 0 0 var(--dsw-alias-brand-primary);
      }
      .dbmcp-item.is-drop-after {
        box-shadow: 0 2px 0 0 var(--dsw-alias-brand-primary);
      }
      .dbmcp-item.is-taken {
        opacity: 0.6;
      }
      .dbmcp-item {
        cursor: default;
      }
      .dbmcp-item.is-selected {
        cursor: default;
      }
      .dbmcp-group-create {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .dbmcp-group-create .dbmcp-input {
        width: 170px;
        max-width: 220px;
      }
      .dbmcp-group-pick {
        width: 14px;
        height: 14px;
        accent-color: var(--dsw-alias-brand-primary);
        cursor: pointer;
      }
      .dbmcp-bulk {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px;
        margin-bottom: 6px;
        padding: 4px 8px;
        border: 1px solid var(--dsw-alias-brand-primary);
        border-radius: 10px;
        background: var(--dsw-alias-bg-layer-1);
      }
      .dbmcp-bulk-count {
        font-size: 12px;
        font-weight: 600;
        color: var(--dsw-alias-brand-primary);
      }
      .dbmcp-bulk-group {
        display: flex;
        align-items: center;
        gap: 6px;
        flex: 1 1 220px;
        min-width: 220px;
      }
      .dbmcp-bulk-group .dbmcp-input {
        flex: 1 1 auto;
        min-width: 120px;
      }
      .dbmcp-bulk .dbmcp-btn {
        flex: 0 0 auto;
        white-space: nowrap;
      }
      .dbmcp-item-main {
        min-width: 0;
        flex: 1 1 auto;
      }
      .dbmcp-item-name {
        display: flex;
        align-items: center;
        gap: 8px;
        font-weight: 600;
        flex-wrap: wrap;
      }
      .dbmcp-item-meta {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        min-width: 0;
        margin-top: 3px;
      }
      .dbmcp-item-target {
        color: var(--dsw-alias-label-secondary);
        font-size: 12px;
        word-break: break-all;
        margin-top: 2px;
      }
      .dbmcp-item-meta > .dbmcp-item-target {
        margin-top: 0;
      }
      .dbmcp-item-name > .is-renamable,
      .dbmcp-group-name.is-renamable {
        cursor: text;
      }
      .dbmcp-item-rename {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .dbmcp-item-rename .dbmcp-input {
        flex: 0 0 200px;
        width: 200px;
      }
      .dbmcp-item-actions {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
        justify-content: flex-end;
        /* The buttons keep their size and the name gives way instead: letting
           this box shrink broke the four of them across two lines whenever a
           row carried a long identifier. */
        flex: 0 0 auto;
      }
      /* Narrow rows wrap: the name takes the first line, the four actions drop to
         a second one and start from the left. It has to live here, after the rules
         it overrides — a query above them loses on source order. */
      @container (max-width: 520px) {
        .dbmcp-item-row {
          flex-wrap: wrap;
          /* space-between would strand the checkbox and the badge at the far
             edge, a whole row away from the name they belong to. */
          justify-content: flex-start;
        }
        .dbmcp-item-actions {
          width: 100%;
          justify-content: flex-start;
          padding-left: 2px;
        }
      }
      .dbmcp-probe {
        margin-top: 6px;
        font-size: 12px;
        color: var(--dsw-alias-label-secondary);
      }
      .dbmcp-probe.is-ok {
        color: var(--dsw-alias-state-success-primary);
      }
      .dbmcp-probe.is-error {
        color: var(--dsw-alias-state-error-primary);
      }
      /* A notice is the panel's voice, so it is tinted: a plain bordered box the
         same colour as everything else was easy to read past. */
      .dbmcp-notice {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-left: 3px solid var(--dsw-alias-state-success-primary);
        border-radius: 10px;
        padding: 9px 12px;
        margin-bottom: 12px;
        font-size: 13px;
        line-height: 1.5;
        background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 7%, var(--dsw-alias-bg-layer-2));
      }
      .dbmcp-notice.is-error {
        border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 35%, var(--dsw-alias-border-l1));
        border-left-color: var(--dsw-alias-state-error-primary);
        background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, var(--dsw-alias-bg-layer-2));
      }
      .dbmcp-form {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
        gap: 12px 16px;
        align-items: start;
        font-size: 13px;
      }
      .dbmcp-form.is-compact {
        grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
        gap: 14px 18px;
        max-width: 860px;
      }
      .dbmcp-form.is-compact .dbmcp-paste .dbmcp-check {
        flex: none;
        white-space: nowrap;
        font-size: 12px;
        color: var(--dsw-alias-label-secondary);
      }
      .dbmcp-form.is-page {
        display: flex;
        flex-direction: column;
        gap: 8px;
        width: 100%;
        max-width: none;
        box-sizing: border-box;
        font-size: 13px;
        /* The panel is a sidebar, so its width is the form's width — not the
           viewport's. Two- and three-column rows are declared below and folded
           back to one column by the query at the end of this block. */
        container-type: inline-size;
      }
      .dbmcp-form-section {
        display: flex;
        flex-direction: column;
        gap: 8px;
        min-width: 0;
      }
      .dbmcp-form-section.is-two,
      .dbmcp-form-section.is-three {
        display: grid;
        gap: 16px;
        align-items: start;
      }
      .dbmcp-form-section.is-two {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .dbmcp-form-section.is-three {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
      .dbmcp-form-cell {
        display: flex;
        flex-direction: column;
        gap: 6px;
        min-width: 0;
      }
      .dbmcp-form-head {
        display: flex;
        align-items: center;
        gap: 10px;
        min-height: 20px;
      }
      .dbmcp-form-head .dbmcp-check {
        margin-left: auto;
        font-size: 12px;
        color: var(--dsw-alias-label-secondary);
      }
      .dbmcp-form-label {
        color: var(--dsw-alias-label-primary);
        font-size: 13px;
        font-weight: 500;
      }
      .dbmcp-form-note {
        display: flex;
        align-items: flex-start;
        gap: 6px;
        margin: 0;
        font-size: 12px;
        line-height: 1.5;
        color: var(--dsw-alias-label-secondary);
      }
      .dbmcp-form-mark {
        flex: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 14px;
        height: 14px;
        margin-top: 1px;
        border: 1px solid var(--dsw-alias-border-l2);
        border-radius: 50%;
        font-size: 9px;
        font-style: normal;
        line-height: 1;
        text-transform: lowercase;
        color: var(--dsw-alias-label-secondary);
      }
      .dbmcp-tag {
        margin-left: auto;
        border: 1px solid color-mix(in srgb, var(--dsw-alias-brand-primary) 35%, transparent);
        border-radius: 6px;
        background: color-mix(in srgb, var(--dsw-alias-brand-primary) 10%, transparent);
        color: var(--dsw-alias-brand-primary);
        font-size: 11px;
        line-height: 1;
        padding: 4px 8px;
        white-space: nowrap;
      }
      .dbmcp-form.is-page .dbmcp-input,
      .dbmcp-form.is-page .dbmcp-select {
        padding: 8px 10px;
      }
      .dbmcp-form.is-page .dbmcp-input::placeholder {
        color: var(--dsw-alias-label-secondary);
        opacity: 0.75;
      }
      .dbmcp-form-inner {
        display: flex;
        flex-direction: column;
        gap: 18px;
        padding: 2px 2px 0;
      }
      .dbmcp-advanced.is-page {
        background: transparent;
        padding: 0;
      }
      .dbmcp-advanced.is-page > summary {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 12px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 10px;
        font-size: 13px;
        transition: border-color 120ms ease, background 120ms ease;
      }
      .dbmcp-advanced.is-page > summary:hover {
        border-color: var(--dsw-alias-border-l2);
        background: var(--dsw-alias-bg-layer-1);
      }
      .dbmcp-advanced.is-page[open] > summary {
        margin-bottom: 16px;
      }
      .dbmcp-advanced-title {
        color: var(--dsw-alias-label-primary);
        font-weight: 500;
      }
      .dbmcp-advanced-hint {
        margin-left: auto;
        font-size: 12px;
        color: var(--dsw-alias-label-secondary);
        font-weight: 400;
      }
      .dbmcp-readonly {
        display: flex;
        flex-direction: column;
        gap: 4px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 12px;
        background: var(--dsw-alias-bg-layer-2);
        padding: 14px 16px;
      }
      .dbmcp-readonly .dbmcp-check {
        font-size: 13px;
      }
      .dbmcp-readonly .dbmcp-hint {
        padding-left: 24px;
      }
      /* The DDL switch in the source form. It used to live inside a bordered
         policy block with the writable-schemas field; that field is gone, so the
         switch keeps the same box as the read-only block for visual weight. */
      .dbmcp-policy {
        display: flex;
        align-items: center;
        gap: 8px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 12px;
        background: var(--dsw-alias-bg-layer-2);
        padding: 14px 16px;
      }
      .dbmcp-help {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 14px;
        height: 14px;
        border: 1px solid var(--dsw-alias-border-l2);
        border-radius: 50%;
        font-size: 9px;
        line-height: 1;
        color: var(--dsw-alias-label-secondary);
        cursor: help;
      }
      .dbmcp-btn.is-save {
        min-width: 104px;
        padding: 8px 18px;
      }
      .dbmcp-form-foot-hint {
        margin-left: auto;
        font-size: 12px;
        color: var(--dsw-alias-label-secondary);
      }
      .dbmcp-cell {
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-width: 0;
      }
      .dbmcp-cell.dbmcp-wide {
        grid-column: 1 / -1;
      }
      .dbmcp-label {
        color: var(--dsw-alias-label-secondary);
        font-size: 12px;
        line-height: 1.4;
      }
      .dbmcp-paste {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .dbmcp-paste .dbmcp-input {
        flex: 1 1 auto;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 12px;
      }
      .dbmcp-parse {
        flex: none;
        font-size: 12px;
        white-space: nowrap;
      }
      .dbmcp-parse.is-ok {
        color: var(--dsw-alias-state-success-primary);
      }
      .dbmcp-parse.is-bad {
        color: var(--dsw-alias-state-warn-primary);
      }
      .dbmcp-advanced {
        grid-column: 1 / -1;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 10px;
        background: var(--dsw-alias-bg-layer-2);
        padding: 10px 14px 14px;
      }
      .dbmcp-advanced > summary {
        cursor: pointer;
        font-size: 12px;
        color: var(--dsw-alias-label-secondary);
        padding: 2px 0;
      }
      .dbmcp-advanced > summary:hover {
        color: var(--dsw-alias-label-primary);
      }
      .dbmcp-advanced[open] > summary {
        margin-bottom: 10px;
      }
      .dbmcp-input,
      .dbmcp-select {
        width: 100%;
        box-sizing: border-box;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 8px;
        background: var(--dsw-alias-bg-base);
        color: var(--dsw-alias-label-primary);
        font: inherit;
        font-size: 13px;
        padding: 6px 9px;
        transition: border-color 120ms ease, box-shadow 120ms ease;
      }
      .dbmcp-input:hover:not(:disabled),
      .dbmcp-select:hover:not(:disabled) {
        border-color: var(--dsw-alias-border-l2);
      }
      /* A focus ring, not just a colour change: the border alone disappeared
         among the other borders on a form this dense. */
      .dbmcp-input:focus,
      .dbmcp-select:focus {
        outline: none;
        border-color: var(--dsw-alias-brand-primary);
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-brand-primary) 18%, transparent);
      }
      .dbmcp-input.is-invalid {
        border-color: var(--dsw-alias-state-error-primary);
      }
      .dbmcp-input.is-invalid:focus {
        border-color: var(--dsw-alias-state-error-primary);
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-state-error-primary) 18%, transparent);
      }
      .dbmcp-hint {
        font-size: 12px;
        color: var(--dsw-alias-label-secondary);
        line-height: 1.4;
      }
      /* The tools list is the one switch on this page that an outside client
         never feels, so it says so where the switch is rather than only in the
         safety page. A hanging rule keeps it readable as a caveat. */
      .dbmcp-hint.is-scope {
        margin: 8px 0 10px;
        padding-left: 8px;
        border-left: 2px solid var(--dsw-alias-border-l2);
      }
      .dbmcp-check {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
      }
      .dbmcp-form-foot {
        grid-column: 1 / -1;
        display: flex;
        align-items: center;
        gap: 10px;
        margin-top: 12px;
      }
      .dbmcp-scan {
        display: flex;
        flex-direction: column;
        gap: 14px;
      }
      .dbmcp-scan-file {
        font-size: 12px;
        color: var(--dsw-alias-label-secondary);
        word-break: break-all;
      }
      .dbmcp-scan-bar {
        position: sticky;
        top: 0;
        z-index: 2;
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
        margin: 0 0 14px;
        padding: 10px 12px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 10px;
        background: var(--dsw-alias-bg-layer-1);
      }
      .dbmcp-scan-bar .dbmcp-input {
        flex: 1 1 240px;
        min-width: 180px;
      }
      .dbmcp-scan-bar .dbmcp-btn {
        margin-left: auto;
        flex: 0 0 auto;
      }
      /* The select-all box belongs to the bar, not to the rows: it sits first in
         the reading order of the actions and dims out when the filter leaves
         nothing that could be picked. */
      .dbmcp-scan-all {
        flex: 0 0 auto;
        font-size: 12px;
        color: var(--dsw-alias-label-secondary);
        cursor: pointer;
        user-select: none;
      }
      .dbmcp-scan-all.is-off,
      .dbmcp-scan-all:has(input:disabled) {
        cursor: default;
        opacity: 0.55;
      }
      .dbmcp-scan-all .dbmcp-hint {
        font-variant-numeric: tabular-nums;
      }
      /* Relation graph — page A. An edge is one claim about a join, so the row
         is a small card rather than a table line: the join path, the evidence
         under it, and the buttons the current status allows. */
      .dbmcp-edge-toolbar {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
        margin: 10px 0 4px;
      }
      .dbmcp-edge-toolbar .dbmcp-select {
        width: auto;
        min-width: 140px;
        flex: 0 0 auto;
      }
      .dbmcp-edge-filters {
        display: flex;
        align-items: center;
        gap: 4px;
        flex-wrap: wrap;
      }
      .dbmcp-filter {
        border: 1px solid transparent;
        border-radius: 999px;
        background: transparent;
        color: var(--dsw-alias-label-secondary);
        font: inherit;
        font-size: 12px;
        font-variant-numeric: tabular-nums;
        padding: 3px 10px;
        cursor: pointer;
        transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
      }
      .dbmcp-filter:hover {
        color: var(--dsw-alias-label-primary);
        background: var(--dsw-alias-bg-layer-2);
      }
      .dbmcp-filter.is-on {
        color: var(--dsw-alias-label-primary);
        border-color: var(--dsw-alias-border-l1);
        background: var(--dsw-alias-bg-layer-2);
      }
      .dbmcp-edges {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-top: 10px;
      }
      .dbmcp-edge {
        border: 1px solid var(--dsw-alias-border-l1);
        border-left-width: 3px;
        border-radius: 10px;
        padding: 9px 11px;
        background: var(--dsw-alias-bg-layer-2);
      }
      /* The left border is the status, so a list of edges reads at a glance. */
      .dbmcp-edge.is-pending {
        border-left-color: var(--dsw-alias-state-warn-primary);
      }
      .dbmcp-edge.is-confirmed {
        border-left-color: var(--dsw-alias-state-idle-primary);
      }
      .dbmcp-edge.is-trusted {
        border-left-color: var(--dsw-alias-state-success-primary);
      }
      .dbmcp-edge.is-stale,
      .dbmcp-edge.is-rejected {
        border-left-color: var(--dsw-alias-state-error-primary);
      }
      /* The row a link or the scene page jumped to: a ring, not a colour of its own,
         so it cannot be mistaken for a status. */
      .dbmcp-edge.is-focus {
        outline: 2px solid var(--dsw-alias-brand-primary);
        outline-offset: 2px;
      }
      .dbmcp-edge-head {
        display: flex;
        align-items: center;
        gap: 8px;
        justify-content: space-between;
      }
      .dbmcp-edge-path {
        font-size: 13px;
        color: var(--dsw-alias-label-primary);
        word-break: break-all;
      }
      .dbmcp-edge-arrow {
        color: var(--dsw-alias-label-secondary);
      }
      .dbmcp-edge-chip {
        flex: 0 0 auto;
        text-transform: lowercase;
      }
      .dbmcp-edge-chip.is-pending {
        border-color: var(--dsw-alias-state-warn-primary);
        color: var(--dsw-alias-state-warn-primary);
      }
      .dbmcp-edge-chip.is-confirmed {
        border-color: var(--dsw-alias-state-idle-primary);
        color: var(--dsw-alias-state-idle-primary);
      }
      .dbmcp-edge-chip.is-trusted {
        border-color: var(--dsw-alias-state-success-primary);
        color: var(--dsw-alias-state-success-primary);
      }
      .dbmcp-edge-chip.is-stale,
      .dbmcp-edge-chip.is-rejected {
        border-color: var(--dsw-alias-state-error-primary);
        color: var(--dsw-alias-state-error-primary);
      }
      .dbmcp-edge-meta {
        margin: 4px 0 0;
        font-variant-numeric: tabular-nums;
      }
      .dbmcp-edge-when {
        margin: 2px 0 0;
        color: var(--dsw-alias-label-primary);
      }
      .dbmcp-edge-why {
        margin: 4px 0 0;
        color: var(--dsw-alias-state-error-primary);
      }
      .dbmcp-edge-error {
        margin: 6px 0 0;
        color: var(--dsw-alias-state-error-primary);
      }
      .dbmcp-edge-actions {
        margin-top: 8px;
        flex-wrap: wrap;
      }
      .dbmcp-edge-form {
        margin-top: 8px;
        padding: 8px 10px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 8px;
        background: var(--dsw-alias-bg-base);
      }
      .dbmcp-edge-form.is-new {
        margin: 10px 0 0;
      }
      .dbmcp-edge-form .dbmcp-input {
        margin-bottom: 6px;
      }
      .dbmcp-edge-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
      }
      .dbmcp-edge-record {
        margin-top: 8px;
        padding-top: 6px;
        border-top: 1px solid var(--dsw-alias-border-l1);
      }
      .dbmcp-edge-history {
        list-style: none;
        margin: 4px 0 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
        font-size: 12px;
        color: var(--dsw-alias-label-secondary);
      }
      .dbmcp-edge-history code {
        font-variant-numeric: tabular-nums;
      }

      /* Page B — the trace result. A step is the same shape as an edge row so the
         two pages read alike; the numbered marker is the walk order, which is the
         one thing the edge row cannot show. */
      .dbmcp-trace-form {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin: 4px 0 8px;
      }
      .dbmcp-trace-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        gap: 8px;
        align-items: end;
      }
      .dbmcp-trace-summary {
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: 6px 0;
      }
      .dbmcp-trace-save {
        align-items: center;
        flex-wrap: wrap;
        gap: 8px;
        margin: 2px 0;
      }
      .dbmcp-trace-scene-form {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        gap: 8px;
        align-items: end;
        margin: 4px 0 2px;
      }
      /* The two field cells sit in the grid; the warning and the two buttons
         take the full width so the form reads top-down in a narrow panel. */
      .dbmcp-trace-scene-form > p,
      .dbmcp-trace-scene-form > .dbmcp-inline {
        grid-column: 1 / -1;
      }
      .dbmcp-trace-cut {
        color: var(--dsw-alias-state-warn-primary);
        border-color: var(--dsw-alias-state-warn-primary);
      }
      .dbmcp-trace-judge {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin-top: 4px;
      }
      .dbmcp-trace-reasons {
        flex-wrap: wrap;
        row-gap: 4px;
      }
      .dbmcp-trace-aside {
        display: flex;
        flex-direction: column;
        gap: 2px;
        margin-top: 10px;
        padding-top: 8px;
        border-top: 1px solid var(--dsw-alias-border-l1);
      }
      .dbmcp-trace-pending {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
      }

      /* The overview strip: the same walk as the tree below, but with the shape
         as the subject. One column per depth, so "how deep did this go, and where
         did it fan out" is answered before reading a single row. */
      .dbmcp-trace-overview {
        margin-top: 10px;
        padding: 8px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 10px;
        background: var(--dsw-alias-bg-layer-2);
      }
      /* The picture keeps its own size and scrolls, so zooming never squeezes a
         label: the browser scrolls a canvas instead of re-wrapping text. */
      .dbmcp-trace-scroll {
        overflow: auto;
        max-height: 460px;
      }
      .dbmcp-trace-zoom {
        display: flex;
        align-items: center;
        gap: 4px;
        justify-content: flex-end;
        margin-bottom: 6px;
      }
      .dbmcp-trace-zoom-value {
        min-width: 48px;
        font-variant-numeric: tabular-nums;
      }
      .dbmcp-ov-svg {
        display: block;
        /* A box or a label is a pointer target; zooming out must not turn a click
           into a mis-click on the neighbour. */
        min-width: 1px;
      }
      .dbmcp-ov-head {
        font-size: 10px;
        fill: var(--dsw-alias-label-secondary);
        font-variant-numeric: tabular-nums;
      }
      .dbmcp-ov-link {
        fill: none;
        stroke: var(--dsw-alias-border-l1);
        stroke-width: 1.2;
      }
      .dbmcp-ov-link.is-pending {
        stroke: var(--dsw-alias-state-warn-primary);
        stroke-dasharray: 4 3;
      }
      .dbmcp-ov-link.is-stale {
        stroke: var(--dsw-alias-state-error-primary);
      }
      .dbmcp-ov-link.is-rejected {
        stroke: var(--dsw-alias-state-error-primary);
        stroke-dasharray: 2 3;
      }
      .dbmcp-ov-edge-label {
        font-size: 10px;
        fill: var(--dsw-alias-label-secondary);
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        /* A halo of the card colour, so a label crossing its own curve stays
           readable instead of merging with it. */
        paint-order: stroke;
        stroke: var(--dsw-alias-bg-layer-2);
        stroke-width: 3px;
        stroke-linejoin: round;
      }
      .dbmcp-ov-hit {
        cursor: pointer;
      }
      .dbmcp-ov-hit:focus-visible .dbmcp-ov-node {
        stroke: var(--dsw-alias-brand-primary);
        stroke-width: 2;
      }
      .dbmcp-ov-node {
        fill: var(--dsw-alias-bg-base);
        stroke: var(--dsw-alias-border-l1);
        stroke-width: 1;
      }
      .dbmcp-ov-node.is-pending {
        stroke: var(--dsw-alias-state-warn-primary);
        stroke-dasharray: 3 2;
      }
      .dbmcp-ov-node.is-stale {
        stroke: var(--dsw-alias-state-error-primary);
      }
      .dbmcp-ov-node.is-rejected {
        stroke: var(--dsw-alias-state-error-primary);
        stroke-dasharray: 2 2;
      }
      .dbmcp-ov-node.is-focus {
        stroke: var(--dsw-alias-brand-primary);
        stroke-width: 2;
      }
      .dbmcp-ov-text {
        font-size: 12px;
        fill: var(--dsw-alias-label-primary);
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      .dbmcp-ov-sub {
        font-size: 10px;
        fill: var(--dsw-alias-label-secondary);
        font-variant-numeric: tabular-nums;
      }

      /* The step that was picked in the graph. There is no second tree under the
         graph: the picture carries the shape, and this card carries the values. */
      .dbmcp-trace-detail {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin-top: 10px;
      }
      .dbmcp-trace-node {
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 10px;
        background: var(--dsw-alias-bg-layer-2);
        padding: 8px 10px;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .dbmcp-trace-node.is-stale {
        border-color: var(--dsw-alias-state-error-primary);
      }
      .dbmcp-trace-node.is-pending {
        border-style: dashed;
        border-color: var(--dsw-alias-state-warn-primary);
      }
      .dbmcp-trace-node.is-focus {
        border-color: var(--dsw-alias-brand-primary);
        box-shadow: 0 0 0 1px var(--dsw-alias-brand-primary) inset;
      }
      .dbmcp-trace-node-head {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
      }
      .dbmcp-trace-mark {
        flex: 0 0 auto;
        min-width: 30px;
        text-align: center;
        font-size: 11px;
        line-height: 18px;
        padding: 0 5px;
        border-radius: 999px;
        color: var(--dsw-alias-label-secondary);
        background: var(--dsw-alias-bg-base);
        border: 1px solid var(--dsw-alias-border-l1);
        font-variant-numeric: tabular-nums;
      }
      .dbmcp-trace-name {
        font-size: 13px;
        font-weight: 600;
        color: var(--dsw-alias-label-primary);
      }
      .dbmcp-trace-edge {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
        margin: 0;
      }
      .dbmcp-trace-arrow {
        flex: 0 0 auto;
        color: var(--dsw-alias-label-secondary);
      }
      .dbmcp-trace-edge code {
        font-size: 12px;
        color: var(--dsw-alias-label-secondary);
        word-break: break-all;
      }
      .dbmcp-trace-values {
        margin: 0;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 12px;
        color: var(--dsw-alias-label-primary);
        word-break: break-all;
      }
      .dbmcp-trace-note {
        margin: 0;
        font-size: 12px;
      }
      .dbmcp-trace-more {
        margin-top: 2px;
        flex-wrap: wrap;
        row-gap: 4px;
      }
      .dbmcp-trace-table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 6px;
        font-size: 12px;
        font-variant-numeric: tabular-nums;
      }
      .dbmcp-trace-table th,
      .dbmcp-trace-table td {
        text-align: left;
        padding: 3px 8px;
        border-bottom: 1px solid var(--dsw-alias-border-l1);
        white-space: nowrap;
      }
      .dbmcp-trace-table th {
        font-weight: 600;
        color: var(--dsw-alias-label-secondary);
        background: var(--dsw-alias-bg-base);
      }
      .dbmcp-trace-table th.is-bound,
      .dbmcp-trace-table td.is-bound {
        color: var(--dsw-alias-brand-primary);
        background: var(--dsw-alias-bg-layer-2);
      }
      .dbmcp-trace-candidates {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
        padding: 6px 0;
      }
      .dbmcp-trace-tools {
        flex-wrap: wrap;
        row-gap: 4px;
      }
      .dbmcp-trace-dirs {
        gap: 4px;
      }
      .dbmcp-trace-outside {
        border: 1px dashed var(--dsw-alias-border-l1);
        border-radius: 10px;
        padding: 8px 10px;
        margin-top: 6px;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .dbmcp-trace-legend {
        margin: 10px 0 0;
        padding-top: 8px;
        border-top: 1px solid var(--dsw-alias-border-l1);
        font-size: 12px;
      }
      .dbmcp-edge-chip.is-scene {
        border-color: var(--dsw-alias-brand-primary);
        color: var(--dsw-alias-brand-primary);
      }
      .dbmcp-edge-chip.is-outside {
        border-style: dashed;
        color: var(--dsw-alias-label-secondary);
      }

      /* Narrow sidebar: two- and three-column rows have no room to sit side by
         side, and before this query they simply ran past the right edge — the
         labels and inputs on the right were cut off with no scrollbar to say
         so. Fold them to one column instead. */
      @container (max-width: 560px) {
        .dbmcp-form-section.is-two,
        .dbmcp-form-section.is-three {
          grid-template-columns: minmax(0, 1fr);
        }
        .dbmcp-edge-grid {
          grid-template-columns: minmax(0, 1fr);
        }
        .dbmcp-trace-grid {
          grid-template-columns: minmax(0, 1fr);
        }
        .dbmcp-form-head {
          flex-wrap: wrap;
          row-gap: 4px;
        }
      }
    `

    /** Re-render on locale switch / late dictionary registration. */
    function useLocale() {
      const service = localeService
      const subscribe = React.useCallback(
        (onChange) => (typeof service?.subscribe === 'function' ? service.subscribe(onChange) : () => {}),
        [service],
      )
      const getSnapshot = React.useCallback(
        () => (typeof service?.getSnapshot === 'function' ? service.getSnapshot() : 0),
        [service],
      )
      React.useSyncExternalStore(subscribe, getSnapshot)
      return service
    }

    /* ---------- theme-aware solid surfaces ----------
       A custom theme may paint translucent surfaces over a wallpaper: cards then
       dissolve into the picture and labels lose contrast. Re-derive solid
       equivalents of the alias tokens from the active palette and overlay them
       on the panel subtree, so the panel reads the same on white, black and
       wallpapered themes. */

    let themeService = null
    const themeSubs = new Set()
    const NO_PALETTE = Object.freeze({})
    let paletteCache = NO_PALETTE
    let paletteKey = ''

    function parseColor(value) {
      if (typeof value !== 'string') return null
      const text = value.trim()
      let match = /^#([0-9a-f]{3,8})$/i.exec(text)
      if (match) {
        let hex = match[1]
        if (hex.length === 3 || hex.length === 4) hex = hex.split('').map((part) => part + part).join('')
        if (hex.length !== 6 && hex.length !== 8) return null
        return {
          r: parseInt(hex.slice(0, 2), 16),
          g: parseInt(hex.slice(2, 4), 16),
          b: parseInt(hex.slice(4, 6), 16),
          a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
        }
      }
      match = /^rgba?\(([^)]+)\)$/i.exec(text)
      if (!match) return null
      const parts = match[1].split(/[\s,/]+/).filter(Boolean).map(Number)
      if (parts.length < 3 || parts.slice(0, 3).some((item) => !Number.isFinite(item))) return null
      const alpha = parts.length > 3 && Number.isFinite(parts[3]) ? parts[3] : 1
      return { r: parts[0], g: parts[1], b: parts[2], a: Math.max(0, Math.min(1, alpha)) }
    }

    function composite(color, base) {
      const alpha = Math.max(0, Math.min(1, color.a))
      return {
        r: color.r * alpha + base.r * (1 - alpha),
        g: color.g * alpha + base.g * (1 - alpha),
        b: color.b * alpha + base.b * (1 - alpha),
        a: 1,
      }
    }

    function mixColor(from, to, weight) {
      return {
        r: from.r + (to.r - from.r) * weight,
        g: from.g + (to.g - from.g) * weight,
        b: from.b + (to.b - from.b) * weight,
        a: 1,
      }
    }

    function drift(a, b) {
      return Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b))
    }

    function toCss(color) {
      const channel = (value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')
      return '#' + channel(color.r) + channel(color.g) + channel(color.b)
    }

    function paletteOf(snapshot) {
      const active = (snapshot && snapshot.active) || {}
      const tokens = active.tokens || {}
      const dark = active.colorScheme === 'dark'
      const floor = dark ? { r: 12, g: 12, b: 14, a: 1 } : { r: 255, g: 255, b: 255, a: 1 }
      const token = (name) => parseColor(tokens[name])

      const baseRaw = token('--dsw-alias-bg-base')
      const canvas = baseRaw ? composite(baseRaw, floor) : floor

      const layerRaw = token('--dsw-alias-bg-layer-1')
      let surface = layerRaw ? composite(layerRaw, canvas) : canvas
      const layer2Raw = token('--dsw-alias-bg-layer-2')
      let surface2 = layer2Raw ? composite(layer2Raw, surface) : surface

      const inkRaw = token('--dsw-alias-label-primary') || (dark ? { r: 232, g: 232, b: 236, a: 1 } : { r: 26, g: 26, b: 30, a: 1 })
      const ink = composite(inkRaw, canvas)

      /* On a pure black or pure white scheme the theme's layers collapse onto the
         canvas; lift them a little so cards still separate from the page. */
      if (drift(surface, canvas) < 8) surface = mixColor(canvas, ink, dark ? 0.14 : 0.05)
      if (drift(surface2, surface) < 8) surface2 = mixColor(surface, ink, dark ? 0.2 : 0.07)

      const secondRaw = token('--dsw-alias-label-secondary')
      const ink2 = secondRaw ? composite(secondRaw, surface) : mixColor(surface, ink, 0.45)

      const lineRaw = token('--dsw-alias-border-l1')
      let line = lineRaw ? composite(lineRaw, surface) : mixColor(surface, ink, 0.16)
      if (drift(line, surface) < 10) line = mixColor(surface, ink, 0.18)
      const line2Raw = token('--dsw-alias-border-l2')
      let line2 = line2Raw ? composite(line2Raw, surface2) : mixColor(surface2, ink, 0.24)
      if (drift(line2, surface2) < 10) line2 = mixColor(surface2, ink, 0.26)

      const accent = (name, fallback) => {
        const raw = token(name)
        if (!raw) return fallback
        return raw.a >= 0.999 ? raw : composite(raw, surface)
      }

      return {
        '--dsw-alias-bg-base': toCss(canvas),
        '--dsw-alias-bg-layer-1': toCss(surface),
        '--dsw-alias-bg-layer-2': toCss(surface2),
        '--dsw-alias-bg-overlay': toCss(surface2),
        '--dsw-alias-border-l1': toCss(line),
        '--dsw-alias-border-l2': toCss(line2),
        '--dsw-alias-label-primary': toCss(ink),
        '--dsw-alias-label-secondary': toCss(ink2),
        '--dsw-alias-brand-primary': toCss(accent('--dsw-alias-brand-primary', { r: 36, g: 123, b: 191, a: 1 })),
        '--dsw-alias-state-success-primary': toCss(accent('--dsw-alias-state-success-primary', { r: 38, g: 158, b: 92, a: 1 })),
        '--dsw-alias-state-warn-primary': toCss(accent('--dsw-alias-state-warn-primary', { r: 191, g: 128, b: 20, a: 1 })),
        '--dsw-alias-state-error-primary': toCss(accent('--dsw-alias-state-error-primary', { r: 213, g: 68, b: 68, a: 1 })),
        '--dsw-alias-state-idle-primary': toCss(accent('--dsw-alias-state-idle-primary', mixColor(surface, ink, 0.4))),
      }
    }

    function paletteSnapshot() {
      const service = themeService
      if (!service || typeof service.getTheme !== 'function') return NO_PALETTE
      let snapshot = null
      try {
        snapshot = service.getTheme()
      } catch (error) {
        return NO_PALETTE
      }
      const key = `${(snapshot && snapshot.revision) || ''}:${(snapshot && snapshot.preference) || ''}`
      if (key !== paletteKey) {
        paletteKey = key
        paletteCache = paletteOf(snapshot)
      }
      return paletteCache
    }

    function subscribeTheme(onChange) {
      themeSubs.add(onChange)
      return () => {
        themeSubs.delete(onChange)
      }
    }

    function useThemePalette() {
      return React.useSyncExternalStore(subscribeTheme, paletteSnapshot, paletteSnapshot)
    }

    function fmt(text, values) {
      return String(text).replace(/\{(\w+)\}/g, (all, key) => (values && values[key] !== undefined ? String(values[key]) : all))
    }

    async function apiGet(path) {
      const response = await fetch(API + path, { credentials: 'same-origin', headers: { accept: 'application/json' } })
      const data = await response.json().catch(() => null)
      if (!response.ok || !data) {
        const payload = data || null
        const message = (payload && (payload.error || payload.message)) || `HTTP ${response.status}`
        const error = new Error(String(message))
        error.payload = payload
        throw error
      }
      return data
    }

    async function apiPost(path, body) {
      const response = await fetch(API + path, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify(body || {}),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok || !data) {
        const message = (data && data.error) || `HTTP ${response.status}`
        const error = new Error(message)
        error.payload = data
        throw error
      }
      return data
    }

    /* ---------------------------------------------------------------------
     * Remembering where the panel was.
     *
     * The panel is a slot: the chat takes it away and gives it back, and a
     * page that opens on the first tab every time makes the reader re-type a
     * value and re-pick a datasource for nothing. So the position, the typed
     * inputs and the create form's draft live in localStorage, keyed by one
     * object. Three rules keep that honest:
     *
     *   1. The store is optional. A private-mode or sandboxed page can throw on
     *      access — a panel that cannot remember is still a panel.
     *   2. Nothing secret is written. The draft is stored without its password,
     *      and a pasted connection string is only stored when it carries no
     *      password either; the OS secret store stays the one place for those.
     *   3. A stored value is a suggestion, not a fact. It is checked against
     *      what actually exists before it is used (a tab that no longer exists,
     *      a datasource that was deleted).
     * ------------------------------------------------------------------- */

    /** One key, so the panel's own state is one line in the browser console. */
    const PANEL_KEY = 'dsh-db-mcp:panel'

    /** localStorage when the page has one that works, else null. */
    function panelStore() {
      try {
        if (typeof localStorage === 'undefined' || !localStorage) return null
        return localStorage
      } catch (error) {
        return null
      }
    }

    function readPanel() {
      const store = panelStore()
      if (!store) return {}
      try {
        const raw = store.getItem(PANEL_KEY)
        const parsed = raw ? JSON.parse(raw) : null
        return parsed && typeof parsed === 'object' ? parsed : {}
      } catch (error) {
        return {}
      }
    }

    /** Merge one slice into the remembered state. Never throws. */
    function writePanel(patch) {
      const store = panelStore()
      if (!store) return
      try {
        store.setItem(PANEL_KEY, JSON.stringify({ ...readPanel(), ...patch }))
      } catch (error) {
        /* a full or blocked store must not break the page */
      }
    }

    /** Drop one slice — used when a draft has been saved, cancelled or deleted. */
    function forgetPanel(key) {
      const store = panelStore()
      if (!store) return
      try {
        const next = readPanel()
        delete next[key]
        store.setItem(PANEL_KEY, JSON.stringify(next))
      } catch (error) {
        /* same as writePanel */
      }
    }

    /** A draft is remembered without its password: only the server holds that. */
    function draftForStorage(draft) {
      if (!draft || typeof draft !== 'object') return null
      return { ...draft, password: '' }
    }

    /**
     * The pasted connection string, kept only while it carries no password.
     * `user:secret@host` is the one shape that must not reach browser storage;
     * the draft's own fields already hold host, user and database, so only the
     * secret is left for the reader to type again.
     */
    function rawForStorage(raw) {
      const text = String(raw || '')
      if (!text.trim()) return ''
      const parsed = parseConnectionText(text)
      return parsed && parsed.password ? '' : text
    }

    /**
     * The half-typed new source, laid over a fresh draft so a form saved by an
     * older version still opens with every field the current one expects.
     */
    function createDraftFrom(base) {
      const saved = readPanel().createDraft
      if (!saved || typeof saved !== 'object') return base
      return {
        ...base,
        ...saved,
        config: { ...base.config, ...(saved.config || {}) },
        password: '',
      }
    }

    /** Once a source is saved the scratch draft has done its job. */
    function forgetCreateDraft() {
      forgetPanel('createDraft')
      forgetPanel('createRaw')
    }

    /* ---------------------------------------------------------------------
     * Keeping the last answer.
     *
     * The inputs live in the browser store; the *results* do not. A result is
     * derived data the server can produce again, and it carries table rows —
     * somebody's amounts and names — which have no business sitting in a
     * browser store that any script on the origin can read. They live in this
     * module's memory instead: the panel is unmounted and re-created inside the
     * same loaded bundle, so a walk that was just run is still on screen when
     * the panel is reopened, without a copy of the rows being written down.
     * A full page reload starts from an empty page again, which is also the
     * honest answer: the connection may be gone by then.
     * ------------------------------------------------------------------- */
    const panelResults = { trace: null, graph: null }

    /** Hold one page's last answer, in memory only. */
    function keepResult(name, value) {
      panelResults[name] = value || null
    }

    function readResult(name) {
      return panelResults[name] || null
    }

    /** Sidebar icon: a stacked-database glyph drawn with currentColor. */
    function SidebarIcon(props) {
      const size = props && typeof props.size === 'number' ? props.size : 20
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
          focusable: 'false',
        },
        h('ellipse', { cx: 12, cy: 5.5, rx: 7.5, ry: 3 }),
        h('path', { d: 'M4.5 5.5v6c0 1.66 3.36 3 7.5 3s7.5-1.34 7.5-3v-6' }),
        h('path', { d: 'M4.5 11.5v6c0 1.66 3.36 3 7.5 3s7.5-1.34 7.5-3v-6' }),
      )
    }

    /* The header is skipped entirely when the card carries no title, aside or
       actions. The list card passes title: null and draws its own header, and a
       header that renders empty still took its min-height plus its margin —
       thirty pixels of nothing above the list, measured. */
    function Card(props) {
      const head =
        props.title == null && props.aside == null && props.actions == null
          ? null
          : h(
              'header',
              { className: 'dbmcp-card-head' },
              props.title == null ? null : h('h2', { className: 'dbmcp-card-title' }, props.title),
              props.aside == null ? null : h('span', { className: 'dbmcp-pill' }, props.aside),
              props.actions == null ? null : h('div', { className: 'dbmcp-card-actions' }, props.actions),
            )
      return h('section', { className: 'dbmcp-card' }, head, props.children)
    }

    /** One card per line, matching the audit entries below it. */
    function Row(props) {
      return h(
        'div',
        { className: 'dbmcp-row' },
        h('span', { key: 'k', className: 'dbmcp-k' }, props.label),
        h('div', { key: 'v', className: 'dbmcp-v' }, props.children),
      )
    }

    function Field(props) {
      return h(
        'div',
        { className: 'dbmcp-cell' + (props.wide ? ' dbmcp-wide' : '') },
        h('label', { className: 'dbmcp-label' }, props.label),
        props.children,
        props.hint ? h('div', { className: 'dbmcp-hint' }, props.hint) : null,
      )
    }

    /**
     * A track switch, for the one setting on a source row that can be flipped.
     *
     * The row used to carry a line of identical bordered pills, and the only
     * clickable one was a status word among status words: nothing said where to
     * press until the pointer happened to rest on it. A track reads as something
     * to operate before it is touched, and the state word stays beside it so the
     * direction is spelled out rather than inferred from the knob's position.
     */
    function Switch(props) {
      const on = props.checked === true
      return h(
        'button',
        {
          type: 'button',
          className: 'dbmcp-switch' + (on ? ' is-on' : ''),
          role: 'switch',
          'aria-checked': on ? 'true' : 'false',
          title: props.title || undefined,
          disabled: props.disabled === true,
          onClick: (event) => {
            event.stopPropagation()
            if (props.disabled === true) return
            props.onChange(!on)
          },
        },
        h(
          'span',
          { className: 'dbmcp-switch-track', 'aria-hidden': 'true' },
          h('span', { className: 'dbmcp-switch-knob' }),
        ),
        props.label == null ? null : h('span', null, props.label),
      )
    }

    /**
     * The `readOnly` value to POST when the row's writable switch is clicked.
     *
     * The switch is checked when the source is writable (`readOnly === false`),
     * but the API takes a `readOnly` flag, so the two move in opposite
     * directions: a click must send the opposite of the stored value. 0.9.9
     * shipped the un-inverted value, which re-posted the state already stored —
     * the banner said "is read-only now" and the switch looked dead. Kept here
     * as a pure function so the inversion is pinned by a unit test.
     */
    function nextReadOnly(source) {
      // A read-only source (true) POSTs false; a writable one (false) POSTs true.
      return source.readOnly === false
    }

    function TextInput(props) {
      return h('input', {
        className: 'dbmcp-input' + (props.invalid ? ' is-invalid' : ''),
        type: props.type || 'text',
        value: props.value == null ? '' : props.value,
        placeholder: props.placeholder || '',
        autoComplete: props.autoComplete || 'off',
        autoFocus: props.autoFocus === true,
        spellCheck: false,
        disabled: props.disabled === true,
        title: props.title || undefined,
        'aria-invalid': props.invalid ? 'true' : undefined,
        onChange: (event) => props.onChange(event.target.value),
        onKeyDown: props.onKeyDown || undefined,
      })
    }

    function stripQuotes(value) {
      return String(value == null ? '' : value).trim().replace(/^["']|["']$/g, '')
    }

    function slugId(value) {
      return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 32)
    }

    function baseConfig(kind) {
      return {
        file: '',
        host: kind === 'sqlite' ? '' : 'localhost',
        port: DEFAULT_PORTS[kind] || '',
        database: '',
        user: '',
        schema: '',
        serviceName: '',
        sid: '',
        charset: kind === 'mysql' ? 'utf8mb4' : '',
        sslMode: '',
      }
    }

    function fileStem(file) {
      const name = String(file || '').split(/[\\/]/).pop() || ''
      return name.replace(/\.(db|sqlite3?|db3)$/i, '')
    }

    function decodePart(value) {
      try {
        return decodeURIComponent(value || '')
      } catch (error) {
        return String(value || '')
      }
    }

    function parseQueryString(search) {
      const out = {}
      const text = String(search || '').replace(/^\?/, '')
      if (!text) return out
      text.split('&').forEach((pair) => {
        if (!pair) return
        const index = pair.indexOf('=')
        const key = decodePart(index < 0 ? pair : pair.slice(0, index)).trim().toLowerCase()
        if (!key) return
        out[key] = index < 0 ? '' : decodePart(pair.slice(index + 1))
      })
      return out
    }

    function fromUrl(kind, body) {
      // `new URL` reads `#` and `?` inside a password as fragment and query
      // markers, and rejects a comma-separated node list, so the string is
      // split by hand: credentials up to the last `@`, then the node list up to
      // the first `/`, then the path, then the query.
      let rest = body.startsWith('//') ? body.slice(2) : body
      const infoAt = rest.lastIndexOf('@')
      let info = ''
      if (infoAt >= 0) {
        info = rest.slice(0, infoAt)
        rest = rest.slice(infoAt + 1)
      }
      const slash = rest.indexOf('/')
      const authority = slash >= 0 ? rest.slice(0, slash) : rest
      const tail = slash >= 0 ? rest.slice(slash) : ''
      const mark = tail.indexOf('?')
      const path = mark >= 0 ? tail.slice(0, mark) : tail
      const query = parseQueryString(mark >= 0 ? tail.slice(mark) : '')
      const database = decodePart(path.replace(/^\/+/, ''))

      const nodes = authority
        .split(',')
        .map((piece) => /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(piece.trim()))
        .filter(Boolean)
        .map((match) => ({
          host: match[1].replace(/^\[|\]$/g, ''),
          port: match[2] ? Number(match[2]) : null,
        }))
      if (!nodes.length) return { ok: false, code: 'url' }

      const config = baseConfig(kind)
      config.host = nodes[0].host
      // Form fields hold strings; the node list keeps numbers for the driver.
      config.port = nodes[0].port ? String(nodes[0].port) : DEFAULT_PORTS[kind] || ''
      if (nodes.length > 1) {
        config.hosts = nodes.map((node) => ({ host: node.host, port: node.port || Number(config.port) || null }))
        config.host = nodes.map((node) => node.host).join(',')
      }
      const colon = info.indexOf(':')
      config.user = decodePart(colon >= 0 ? info.slice(0, colon) : info) || query.user || query.username || ''
      if (kind === 'oracle') {
        config.serviceName = database || query.servicename || query.service || ''
        config.sid = query.sid || ''
      } else {
        config.database = database || query.database || query.dbname || ''
      }
      if (query.sslmode) config.sslMode = query.sslmode
      if (query.charset || query.characterencoding) config.charset = query.charset || query.characterencoding
      if (query.schema || query.currentschema || query.searchpath) {
        config.schema = query.schema || query.currentschema || query.searchpath
      }
      // The password stays raw here; `canonicalUrl` never renders it back.
      const password = colon >= 0 ? decodePart(info.slice(colon + 1)) : ''
      const name = kind === 'oracle' ? config.serviceName || config.sid : config.database || config.host
      return { ok: true, kind, config, password, name: name || kind }
    }

    function parseTns(text) {
      const config = baseConfig('oracle')
      /**
       * `DESCRIPTION_LIST` wraps `ADDRESS_LIST` wraps `ADDRESS`, so the values are
       * found by scanning for the named parameter instead of matching a shape.
       * Quotes are optional in TNS, and `PORT` may sit next to its `HOST`.
       */
      const param = (name) => {
        const match = new RegExp(`\\(\\s*${name}\\s*=\\s*([^()]+?)\\s*\\)`, 'i').exec(text)
        return match ? stripQuotes(match[1].trim()) : ''
      }
      config.host = param('HOST') || 'localhost'
      config.port = param('PORT') || '1521'
      config.serviceName = param('SERVICE_NAME')
      config.sid = param('SID')
      if (!config.serviceName && !config.sid) return { ok: false, code: 'tns' }
      return { ok: true, kind: 'oracle', config, password: '', name: config.serviceName || config.sid }
    }

    function parseOracleThin(text) {
      const body = String(text || '').replace(/^@/, '').trim()
      const config = baseConfig('oracle')
      if (body.startsWith('//')) {
        const match = /^\/\/([^/:]+)(?::(\d+))?\/(.+)$/.exec(body)
        if (!match) return { ok: false, code: 'url' }
        config.host = match[1]
        config.port = match[2] || '1521'
        config.serviceName = match[3].split(/[?#]/)[0]
      } else {
        const match = /^([^:]+)(?::(\d+))?:(.+)$/.exec(body)
        if (!match) return { ok: false, code: 'url' }
        config.host = match[1]
        config.port = match[2] || '1521'
        const target = match[3].split(/[?#]/)[0]
        if (target.includes('/') || target.includes('.')) config.serviceName = target
        else config.sid = target
      }
      if (!config.serviceName && !config.sid) return { ok: false, code: 'url' }
      return { ok: true, kind: 'oracle', config, password: '', name: config.serviceName || config.sid }
    }

    function parseSqliteFile(text) {
      let file = stripQuotes(String(text || '').replace(/^file:/i, ''))
      if (/^\/+[A-Za-z]:/.test(file)) file = file.replace(/^\/+/, '')
      else if (/^\/{2,}/.test(file)) file = '/' + file.replace(/^\/+/, '')
      if (!file || file === '/') return { ok: false, code: 'file' }
      const config = baseConfig('sqlite')
      config.file = file
      return { ok: true, kind: 'sqlite', config, password: '', name: fileStem(file) || 'sqlite' }
    }

    /**
     * Accepts a DSN, a JDBC URL, an Oracle TNS descriptor, or a SQLite file path.
     * Returns { ok, kind, config, password, name } so the form can fill itself.
     */
    function parseConnectionText(input) {
      const raw = stripQuotes(input)
      if (!raw) return { ok: false, code: 'empty' }
      if (/^\(\s*DESCRIPTION/i.test(raw)) return parseTns(raw)

      const lower = raw.toLowerCase()
      if (lower.startsWith('jdbc:')) {
        const rest = raw.slice(5)
        const restLower = rest.toLowerCase()
        if (restLower.startsWith('sqlite:')) return parseSqliteFile(rest.slice('sqlite:'.length))
        if (restLower.startsWith('oracle:thin:@')) {
          const body = rest.slice('oracle:thin:@'.length)
          return /^\s*\(/.test(body) ? parseTns(body) : parseOracleThin(body)
        }
        if (restLower.startsWith('postgresql://')) return fromUrl('postgres', rest.slice('postgresql:'.length))
        if (restLower.startsWith('opengauss://')) return fromUrl('gauss', rest.slice('opengauss:'.length))
        if (restLower.startsWith('gaussdb://')) return fromUrl('gauss', rest.slice('gaussdb:'.length))
        if (restLower.startsWith('mysql://')) return fromUrl('mysql', rest.slice('mysql:'.length))
        if (restLower.startsWith('mariadb://')) return fromUrl('mysql', rest.slice('mariadb:'.length))
        return { ok: false, code: 'jdbc' }
      }

      const scheme = /^([a-z][a-z0-9+.-]*):\/\/(.*)$/i.exec(raw)
      if (scheme) {
        const name = scheme[1].toLowerCase()
        const body = '//' + scheme[2]
        if (name === 'sqlite' || name === 'sqlite3' || name === 'file') return parseSqliteFile(body.slice(2))
        if (name === 'oracle') return fromUrl('oracle', body)
        if (name === 'postgres' || name === 'postgresql' || name === 'psql') return fromUrl('postgres', body)
        if (name === 'opengauss' || name === 'gaussdb' || name === 'gauss') return fromUrl('gauss', body)
        if (name === 'mysql' || name === 'mariadb') return fromUrl('mysql', body)
        return { ok: false, code: 'scheme' }
      }

      if (/^@?\s*\(/.test(raw)) return parseTns(raw)
      if (raw.startsWith('@') || /^[\w.-]+:\d{2,5}[:/]/.test(raw)) return parseOracleThin(raw)
      if (!raw.includes('://') && /\.(db|sqlite3?|db3)$/i.test(raw)) return parseSqliteFile(raw)
      if (/^([a-z]:[\\/]|\\\\|\/)/i.test(raw)) return parseSqliteFile(raw)
      return { ok: false, code: 'unrecognized' }
    }

    /** Append -2, -3, ... until the id is free; the registry requires unique ids. */
    function uniqueId(base, taken) {
      const seed = slugId(base) || 'source'
      const used = new Set((taken || []).map((value) => String(value || '').toLowerCase()))
      if (!used.has(seed)) return seed
      for (let index = 2; index < 100; index += 1) {
        const candidate = `${seed.slice(0, 28)}-${index}`
        if (!used.has(candidate)) return candidate
      }
      return seed
    }

    function formatUptime(ms) {
      const total = Math.max(0, Math.floor((ms || 0) / 1000))
      if (total < 60) return `${total}s`
      const minutes = Math.floor(total / 60)
      if (minutes < 60) return `${minutes}m`
      const hours = Math.floor(minutes / 60)
      return `${hours}h ${minutes % 60}m`
    }

    /** Tool descriptions run to several paragraphs; a list row shows the first sentence. */
    function firstLine(value) {
      const text = String(value || '').replace(/\s+/g, ' ').trim()
      if (!text) return ''
      const stop = text.search(/[.!?]\s/)
      const head = stop > 20 ? text.slice(0, stop + 1) : text
      return head.length > 140 ? `${head.slice(0, 137)}…` : head
    }

    /** UTC offset of the viewer's clock, e.g. "UTC+08:00". */
    function zoneLabel() {
      const offset = -new Date().getTimezoneOffset()
      const sign = offset >= 0 ? '+' : '-'
      const abs = Math.abs(offset)
      const pad = (part) => String(part).padStart(2, '0')
      return `UTC${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
    }

    /**
     * The audit log keeps UTC ISO stamps so the file stays comparable across
     * machines; the panel shows them on the viewer's clock instead. Rows can span
     * days and weeks, so the date travels with the time.
     */
    function localClock(value) {
      const text = String(value || '')
      const at = Date.parse(text)
      if (!Number.isFinite(at)) {
        // A stamp we cannot parse is still worth showing: an ISO string keeps its
        // date and time, anything else is printed as it came.
        return text.length >= 19 ? text.slice(0, 19).replace('T', ' ') : text
      }
      const date = new Date(at)
      const pad = (part) => String(part).padStart(2, '0')
      const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
      return `${day} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
    }

    /** Full local timestamp with the zone, used as the hover title of an audit row. */
    function localStamp(value) {
      const at = Date.parse(String(value || ''))
      if (!Number.isFinite(at)) return String(value || '')
      return `${localClock(value)} ${zoneLabel()}`
    }

    function pythonLabel(t, python) {
      if (!python) return '-'
      if (python.ok) return `${python.command} ${python.version}`
      return `${t('state.failed')} · ${t('python.missing')}`
    }

    function emptyDraft() {
      return {
        id: '',
        name: '',
        group: '',
        kind: 'sqlite',
        readOnly: true,
        config: baseConfig('sqlite'),
        // DDL is a separate permission from writing rows: `create table` and
        // `drop table` change what everybody else reads, so they are opted into.
        allowDdl: false,
        password: '',
        hasSecret: false,
        secretBroken: false,
        nameTouched: false,
        idTouched: false,
      }
    }

    function draftFromSource(source) {
      const config = (source && source.config) || {}
      const draft = emptyDraft()
      const fallback = baseConfig(source.kind || 'sqlite')
      draft.id = source.id
      draft.name = source.name || ''
      draft.group = (source && source.group) || ''
      draft.kind = source.kind || 'sqlite'
      draft.readOnly = source.readOnly !== false
      draft.hasSecret = source.hasSecret === true
      draft.secretBroken = source.secretBroken === true
      draft.allowDdl = source.allowDdl === true
      draft.config = {
        ...fallback,
        file: config.file || '',
        host: config.host || fallback.host,
        port: config.port == null ? fallback.port : String(config.port),
        database: config.database || '',
        user: config.user || '',
        schema: config.schema || '',
        serviceName: config.serviceName || '',
        sid: config.sid || '',
        charset: config.charset || fallback.charset,
        sslMode: config.sslMode || '',
      }
      return draft
    }

    /** Render the current draft back to a connection string (never includes the password). */
    function canonicalUrl(draft) {
      const config = draft.config || {}
      if (draft.kind === 'sqlite') return config.file || ''
      const user = config.user ? `${config.user}@` : ''
      const port = config.port ? `:${config.port}` : ''
      const host = config.host || 'localhost'
      if (draft.kind === 'oracle') {
        // Service name and SID are different address forms: only the SID form
        // round-trips through `jdbc:oracle:thin:@host:port:sid`.
        if (config.serviceName) return `oracle://${user}${host}${port}/${config.serviceName}`
        if (config.sid && config.port) return `jdbc:oracle:thin:@${host}${port}:${config.sid}`
        return ''
      }
      // openGauss URLs carry the scheme the driver expects, and every node.
      if (draft.kind === 'gauss') {
        if (!config.database) return ''
        const nodes = Array.isArray(config.hosts) && config.hosts.length > 1
          ? config.hosts.map((node) => `${node.host}${node.port ? `:${node.port}` : ''}`).join(',')
          : `${host}${port}`
        return `opengauss://${user}${nodes}/${config.database}`
      }
      return config.database ? `${draft.kind}://${user}${host}${port}/${config.database}` : ''
    }

    function SourceForm(props) {
      const t = props.t
      /* `persist` is set for a new source only: that form is the one a reader
         leaves half-typed (a connection string copied from somewhere else), so
         its fields outlive the panel. The edit form always starts from the
         source on the server. */
      const persisting = props.persist === true
      const [draft, setDraft] = React.useState(props.draft)
      const [raw, setRaw] = React.useState(() =>
        props.editing ? canonicalUrl(props.draft) : String(readPanel().createRaw || ''),
      )
      const [parsed, setParsed] = React.useState(null)
      const [saveSecret, setSaveSecret] = React.useState(true)
      const [busy, setBusy] = React.useState(false)
      const [probing, setProbing] = React.useState(false)
      const [probeResult, setProbeResult] = React.useState(null)
      const [error, setError] = React.useState(null)
      // Required fields stay unmarked until the first save attempt, so the form
      // does not open in a red state.
      const [missing, setMissing] = React.useState({})
      const editing = props.editing

      /** Every write to the draft goes through here, so the memory is never stale. */
      const commit = (next) => {
        if (persisting) writePanel({ createDraft: draftForStorage(next) })
        return next
      }
      const patch = (changes) => setDraft((prev) => commit({ ...prev, ...changes }))
      const patchConfig = (changes) =>
        setDraft((prev) => commit({ ...prev, config: { ...prev.config, ...changes } }))

      const fillFrom = (result) => {
        setDraft((prev) => {
          const next = { ...prev, kind: result.kind, config: { ...prev.config, ...result.config } }
          if (result.password) next.password = result.password
          if (result.name && (!prev.nameTouched || !prev.name.trim())) next.name = result.name
          if (!editing && (!prev.idTouched || !prev.id.trim())) {
            next.id = uniqueId(result.name || result.kind, props.takenIds)
          }
          return commit(next)
        })
      }

      const onRawChange = (value) => {
        setRaw(value)
        if (persisting) writePanel({ createRaw: rawForStorage(value) })
        if (!value.trim()) {
          setParsed(null)
          // Deleting a recognised connection string also drops what it filled
          // in; editing keeps the identifier and group the source already owns.
          setDraft((prev) => {
            const fresh = emptyDraft()
            if (!editing) return commit(fresh)
            return commit({
              ...fresh,
              id: prev.id,
              nameTouched: prev.nameTouched,
              idTouched: prev.idTouched,
              group: prev.group,
              readOnly: prev.readOnly,
            })
          })
          setMissing({})
          setProbeResult(null)
          return
        }
        const result = parseConnectionText(value)
        setParsed({ ok: result.ok, code: result.code || null })
        if (result.ok) fillFrom(result)
      }

      const changeKind = (kind) => {
        setDraft((prev) =>
          commit({
            ...prev,
            kind,
            config: { ...baseConfig(kind), file: prev.config.file, user: prev.config.user, database: prev.kind === 'oracle' ? '' : prev.config.database },
          }),
        )
      }

      const submit = async () => {
        setError(null)
        // The connection string, the user and the password are what a source
        // cannot work without, so they are checked before anything is sent.
        const needsCredentials = draft.kind !== 'sqlite'
        const gaps = {
          url: !raw.trim(),
          user: needsCredentials && !String(draft.config.user || '').trim(),
          password: needsCredentials && !editing && !draft.hasSecret && !draft.password.trim(),
        }
        setMissing(gaps)
        if (gaps.url || gaps.user || gaps.password) {
          setError(t('form.requiredHint'))
          return
        }
        const needsTarget =
          draft.kind === 'oracle' ? !draft.config.serviceName.trim() && !draft.config.sid.trim() : !draft.config.database.trim()
        const incomplete = draft.kind === 'sqlite' ? !draft.config.file.trim() : !draft.config.host.trim() || needsTarget
        if (incomplete) {
          setError(t('form.invalid'))
          return
        }
        setBusy(true)
        try {
          const body = {
            id: draft.id.trim(),
            name: draft.name.trim() || draft.id || t('form.untitled'),
            group: (draft.group || '').trim(),
            kind: draft.kind,
            readOnly: draft.readOnly,
            config: { ...draft.config, port: draft.config.port ? Number(draft.config.port) : undefined },
            allowDdl: draft.allowDdl === true,
            password: saveSecret && draft.password !== '' ? draft.password : undefined,
          }
          if (!body.id) delete body.id
          const data = await apiPost('/datasources/save', body)
          /* The scratch draft has become a real source: drop it so the next
             "new source" opens empty instead of pre-filled with this one. */
          if (persisting) forgetCreateDraft()
          props.onSaved(data.datasource)
        } catch (caught) {
          const existingId = caught && caught.payload && caught.payload.existingId
          setError(existingId ? fmt(t('form.duplicate'), { name: existingId }) : String((caught && caught.message) || caught))
        } finally {
          setBusy(false)
        }
      }

      /** Probes the draft as typed, before it is saved. */
      const testDraft = async () => {
        setError(null)
        setProbeResult(null)
        const needsTarget =
          draft.kind === 'oracle' ? !String(draft.config.serviceName || '').trim() && !String(draft.config.sid || '').trim() : !String(draft.config.database || '').trim()
        const incomplete = draft.kind === 'sqlite' ? !String(draft.config.file || '').trim() : !String(draft.config.host || '').trim() || needsTarget
        if (incomplete) {
          setError(t('form.invalid'))
          return
        }
        setProbing(true)
        try {
          const body = {
            kind: draft.kind,
            config: { ...draft.config, port: draft.config.port ? Number(draft.config.port) : undefined },
          }
          if (draft.id && props.editing) body.id = draft.id.trim()
          if (draft.password !== '') body.password = draft.password
          const data = await apiPost('/datasources/test', body)
          setProbeResult({
            ok: Boolean(data.probe && data.probe.ok),
            message: (data.probe && data.probe.message) || t('form.probeUnknown'),
            ms: data.probe && data.probe.latencyMs,
          })
        } catch (caught) {
          setProbeResult({ ok: false, message: String((caught && caught.message) || caught) })
        } finally {
          setProbing(false)
        }
      }

      const manual = []
      if (draft.kind === 'sqlite') {
        manual.push(
          h(
            Field,
            { key: 'file', wide: true, label: t('form.file'), hint: t('form.fileHint') },
            h(TextInput, { value: draft.config.file, onChange: (value) => patchConfig({ file: value }) }),
          ),
        )
      } else {
        manual.push(
          h(
            Field,
            { key: 'host', label: t('form.host') },
            h(TextInput, { value: draft.config.host, onChange: (value) => patchConfig({ host: value }) }),
          ),
          h(
            Field,
            { key: 'port', label: t('form.port') },
            h(TextInput, {
              value: draft.config.port,
              placeholder: DEFAULT_PORTS[draft.kind] || '',
              onChange: (value) => patchConfig({ port: value.replace(/[^\d]/g, '') }),
            }),
          ),
        )
        if (draft.kind === 'oracle') {
          manual.push(
            h(
              Field,
              { key: 'serviceName', label: t('form.serviceName') },
              h(TextInput, { value: draft.config.serviceName, onChange: (value) => patchConfig({ serviceName: value }) }),
            ),
            h(
              Field,
              { key: 'sid', label: t('form.sid'), hint: t('form.sidHint') },
              h(TextInput, { value: draft.config.sid, onChange: (value) => patchConfig({ sid: value }) }),
            ),
          )
        } else {
          manual.push(
            h(
              Field,
              { key: 'database', label: t('form.database') },
              h(TextInput, { value: draft.config.database, onChange: (value) => patchConfig({ database: value }) }),
            ),
          )
        }
        manual.push(
          h(
            Field,
            { key: 'schema', label: t('form.schema'), hint: t('form.schemaHint') },
            h(TextInput, { value: draft.config.schema, onChange: (value) => patchConfig({ schema: value }) }),
          ),
        )
      }
      if (draft.kind === 'postgres' || draft.kind === 'gauss') {
        manual.push(
          h(
            Field,
            { key: 'sslMode', label: t('form.sslMode') },
            h(
              'select',
              {
                className: 'dbmcp-select',
                value: draft.config.sslMode || '',
                onChange: (event) => patchConfig({ sslMode: event.target.value }),
              },
              h('option', { value: '' }, 'default'),
              h('option', { value: 'disable' }, 'disable'),
              h('option', { value: 'prefer' }, 'prefer'),
              h('option', { value: 'require' }, 'require'),
            ),
          ),
        )
      }
      if (draft.kind === 'mysql') {
        manual.push(
          h(
            Field,
            { key: 'charset', label: t('form.charset') },
            h(TextInput, { value: draft.config.charset, onChange: (value) => patchConfig({ charset: value }) }),
          ),
        )
      }

      const note = (text, extra) =>
        h(
          'p',
          { className: 'dbmcp-form-note' },
          h('span', { className: 'dbmcp-form-mark', 'aria-hidden': 'true' }, 'i'),
          h('span', null, text),
          extra || null,
        )

      return h(
        'div',
        { className: 'dbmcp-form is-page' },
        error
          ? h(
              'div',
              { className: 'dbmcp-notice is-error' },
              h('span', null, error),
              h('button', { type: 'button', className: 'dbmcp-btn is-small', onClick: () => setError(null) }, '×'),
            )
          : null,
        h(
          'section',
          { className: 'dbmcp-form-section' },
          h(
            'div',
            { className: 'dbmcp-form-head' },
            h('span', { className: 'dbmcp-form-label' }, t('form.paste')),
            h('span', { className: 'dbmcp-tag' }, t('form.smart')),
          ),
          h(TextInput, {
            value: raw,
            onChange: (value) => {
              onRawChange(value)
              if (missing.url) setMissing((prev) => ({ ...prev, url: false }))
            },
            invalid: missing.url === true,
            placeholder: t('form.pastePlaceholder'),
            autoFocus: !editing,
          }),
          note(
            editing ? t('form.pasteHintEdit') : t('form.pasteHintShort'),
            parsed
              ? h(
                  'span',
                  { className: 'dbmcp-parse ' + (parsed.ok ? 'is-ok' : 'is-bad') },
                  parsed.ok ? t('form.parseOk') : t('form.parseBad'),
                )
              : null,
          ),
        ),
        h(
          'section',
          { className: 'dbmcp-form-section is-two' },
          h(
            'div',
            { className: 'dbmcp-form-cell' },
            h('label', { className: 'dbmcp-form-label' }, t('form.user')),
            h(TextInput, {
              value: draft.config.user,
              placeholder: t('form.userPlaceholder'),
              onChange: (value) => {
                patchConfig({ user: value })
                if (missing.user) setMissing((prev) => ({ ...prev, user: false }))
              },
              invalid: missing.user === true,
              autoComplete: 'off',
            }),
          ),
          h(
            'div',
            { className: 'dbmcp-form-cell' },
            h(
              'div',
              { className: 'dbmcp-form-head' },
              h('label', { className: 'dbmcp-form-label' }, t('form.password')),
              h(
                'label',
                { className: 'dbmcp-check' },
                h('input', {
                  type: 'checkbox',
                  checked: saveSecret,
                  onChange: (event) => setSaveSecret(event.target.checked),
                }),
                h('span', null, t('form.savePassword')),
              ),
            ),
            h(TextInput, {
              type: 'password',
              value: draft.password,
              autoComplete: 'new-password',
              invalid: missing.password === true,
              placeholder: draft.hasSecret ? '********' : t('form.passwordEmpty'),
              onChange: (value) => {
                patch({ password: value })
                if (missing.password && value.trim()) setMissing((prev) => ({ ...prev, password: false }))
              },
            }),
            draft.hasSecret ? h('span', { className: 'dbmcp-hint' }, t('form.passwordKeep')) : null,
            draft.secretBroken ? h('span', { className: 'dbmcp-hint is-warn' }, t('form.schemaBroken')) : null,
          ),
        ),
        h(
          'details',
          { className: 'dbmcp-advanced is-page' },
          h(
            'summary',
            null,
            h('span', { className: 'dbmcp-advanced-title' }, t('form.more')),
            h('span', { className: 'dbmcp-advanced-hint' }, t('form.moreHint')),
          ),
          h(
            'div',
            { className: 'dbmcp-form-inner' },
            h(
              'div',
              { className: 'dbmcp-form-section is-three' },
              h(
                Field,
                { key: 'name', label: t('form.name'), hint: t('form.optional') },
                h(TextInput, {
                  value: draft.name,
                  placeholder: draft.id || '',
                  onChange: (value) => patch({ name: value, nameTouched: true }),
                }),
              ),
              h(
                Field,
                { key: 'group', label: t('form.group'), hint: t('form.groupHint') },
                h(TextInput, {
                  value: draft.group || '',
                  placeholder: t('group.unassigned'),
                  onChange: (value) => patch({ group: value }),
                }),
              ),
              h(
                Field,
                { key: 'id', label: t('form.id'), hint: editing ? null : t('form.idHint') },
                h(TextInput, {
                  value: draft.id,
                  disabled: Boolean(editing),
                  placeholder: 'prod-main',
                  onChange: (value) =>
                    patch({ id: value.toLowerCase().replace(/[^a-z0-9-]/g, ''), idTouched: true }),
                }),
              ),
            ),
            h(
              'div',
              { className: 'dbmcp-form-section is-two' },
              h(
                Field,
                { key: 'kind', label: t('form.kind') },
                h(
                  'select',
                  {
                    className: 'dbmcp-select',
                    value: draft.kind,
                    disabled: Boolean(editing),
                    onChange: (event) => changeKind(event.target.value),
                  },
                  KINDS.map((kind) => h('option', { key: kind, value: kind }, kind)),
                ),
              ),
            ),
            h('div', { className: 'dbmcp-form-section is-two' }, manual),
            h(
              'div',
              { className: 'dbmcp-policy' },
              // DDL is its own switch, the same shape as the writable switch on
              // a row: a source can take `insert` and still be one whose tables
              // belong to somebody else, so shape-changing statements opt in.
              h(Switch, {
                checked: draft.allowDdl === true,
                label: t('form.allowDdl'),
                title: t('form.allowDdlHint'),
                onChange: (next) => patch({ allowDdl: next }),
              }),
            ),
            h(
              'div',
              { className: 'dbmcp-readonly' },
              h(
                'label',
                { className: 'dbmcp-check' },
                h('input', {
                  type: 'checkbox',
                  checked: draft.readOnly,
                  onChange: (event) => patch({ readOnly: event.target.checked }),
                }),
                h('span', null, t('form.readOnly')),
                h('span', { className: 'dbmcp-help', title: t('form.readOnlyHint'), 'aria-hidden': 'true' }, '?'),
              ),
              h('span', { className: 'dbmcp-hint' }, t('form.readOnlyHint')),
            ),
          ),
        ),
        probeResult
          ? h(
              'div',
              { className: 'dbmcp-notice' + (probeResult.ok ? '' : ' is-error') },
              h(
                'span',
                null,
                probeResult.ok
                  ? fmt(t('form.probeOk'), { name: draft.name || draft.id || draft.kind, ms: probeResult.ms == null ? '—' : probeResult.ms })
                  : `${t('form.probeFail')} ${probeResult.message}`,
              ),
              h('button', { type: 'button', className: 'dbmcp-btn is-small', onClick: () => setProbeResult(null) }, '×'),
            )
          : null,
        h(
          'div',
          { className: 'dbmcp-form-foot' },
          h(
            'button',
            { type: 'button', className: 'dbmcp-btn', disabled: busy || probing, onClick: testDraft },
            probing ? t('action.testing') : t('action.test'),
          ),
          h(
            'button',
            { type: 'button', className: 'dbmcp-btn is-primary is-save', disabled: busy || probing, onClick: submit },
            busy ? t('action.saving') : t('action.save'),
          ),
          h('span', { className: 'dbmcp-form-foot-hint' }, t('form.autoApply')),
        ),
      )
    }

    /** Tables grouped by schema; the group order is stable and alphabetical. */
    /** Brand colours keep the four engines readable without an icon font. */
const KIND_BADGE = {
  postgres: { label: 'PG', color: '#336791' },
  gauss: { label: 'GS', color: '#00a3a3' },
  mysql: { label: 'MY', color: '#00758f' },
  oracle: { label: 'OR', color: '#c74634' },
  sqlite: { label: 'SQ', color: '#003b5c' },
}

const kindBadge = (kind) => {
  const key = String(kind || '').trim().toLowerCase()
  if (KIND_BADGE[key]) return KIND_BADGE[key]
  const label = key ? key.slice(0, 2).toUpperCase() : '?'
  return { label, color: 'var(--dsw-alias-label-secondary)' }
}

/**
 * The identifier is the value every MCP tool takes as its `datasource`
 * argument, which is why it is a labelled chip and not a tail on the target
 * line: click it to copy the exact token the user has to type in chat.
 */
function IdChip(props) {
  const { t, id, copied, onCopy } = props
  if (!id) return null
  return h(
    'button',
    {
      type: 'button',
      className: 'dbmcp-idchip' + (copied ? ' is-copied' : ''),
      title: copied ? t('sources.idCopied') : `${id} — ${t('sources.idChipHint')}`,
      'aria-label': `${t('sources.idChip')}: ${id}`,
      onClick: (event) => {
        event.stopPropagation()
        if (typeof onCopy === 'function') onCopy(id)
      },
    },
    h('span', { className: 'dbmcp-idchip-key' }, t('sources.idChip')),
    h('code', { className: 'dbmcp-idchip-value' }, id),
    copied ? h('span', { className: 'dbmcp-idchip-mark', 'aria-hidden': 'true' }, '✓') : null,
  )
}

/** Clipboard write that still works when the async API is blocked by the host shell. */
async function copyText(text) {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch (error) {
      /* fall through to the textarea trick */
    }
  }
  const holder = document.createElement('textarea')
  holder.value = text
  holder.setAttribute('readonly', 'readonly')
  holder.style.position = 'fixed'
  holder.style.top = '-1000px'
  holder.style.opacity = '0'
  document.body.appendChild(holder)
  holder.select()
  const done = document.execCommand('copy')
  document.body.removeChild(holder)
  if (!done) throw new Error('the clipboard is not available')
}

/** A stored probe that ended in failure is what the red row is about. */
const probeFailed = (source) => Boolean(source && source.lastProbe && source.lastProbe.ok === false)

/** Older registries still carry `host:port / database`; a pasted report wants no padding. */
const reportTarget = (source) => {
  const raw = String((source && source.target) || '').trim()
  if (!raw) return '-'
  return raw.replace(/\s+\/\s+/g, '/')
}

/** Whole failure report for one source, so it can be pasted straight into an issue. */
const probeReport = (source, plugin) => {
  const probeInfo = (source && source.lastProbe) || {}
  return [
    `datasource: ${source.name || source.id}`,
    `id: ${source.id}`,
    `kind: ${source.kind}`,
    `target: ${reportTarget(source)}`,
    probeInfo.at ? `at: ${localStamp(probeInfo.at)}` : '',
    `error: ${probeInfo.message || '-'}`,
    plugin ? `plugin: ${plugin.name} ${plugin.version}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

const sourceMatches = (source, needle) => {
  const text = String(needle || '').trim().toLowerCase()
  if (!text) return true
  const hay = [source.name, source.id, source.kind, source.target, source.group, source.lastProbe && source.lastProbe.message]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return hay.includes(text)
}

/**
 * Section order for the list. "Ungrouped" is a bucket like any other, but it is
 * not a declared group, so it has to be added here — otherwise filtering on it
 * renders nothing.
 */
function sectionOrder(groupNames, sources, narrowing) {
  const names = groupNames.slice()
  const loose = sources.some((source) => !String(source.group || '').trim())
  if (loose) names.push('')
  if (!narrowing) return names.indexOf('') === -1 ? [...names, ''] : names
  return names.filter((name) => sources.some((source) => String(source.group || '').trim() === name))
}

/**
 * The order a drop should produce.
 *
 * A group of checked rows drags as one block: the block keeps its own relative
 * order and lands whole — above `target`, or below it when `after`. No row in
 * the block is left behind at the old position.
 */
function reorderForDrop(order, moving, target, after) {
  const block = order.filter((id) => moving.includes(id) && id !== target)
  if (block.length === 0) return order.slice()
  const rest = order.filter((id) => !block.includes(id))
  const at = rest.indexOf(target)
  if (at < 0) return rest.concat(block)
  const cut = at + (after ? 1 : 0)
  return rest.slice(0, cut).concat(block, rest.slice(cut))
}

function groupTables(tables) {
  const buckets = new Map()
  for (const table of tables || []) {
    const key = table.schema || ''
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key).push(table)
  }
  return Array.from(buckets.entries()).sort((left, right) => (left[0] || '').localeCompare(right[0] || ''))
}

    function tableMatches(table, needle) {
      if (!needle) return true
      return (
        String(table.name || '').toLowerCase().includes(needle) ||
        String(table.schema || '').toLowerCase().includes(needle)
      )
    }

    function connectionMatches(item, needle) {
      if (!needle) return true
      return [item.name, item.id, item.target, item.user, item.kind].some((value) =>
        String(value || '').toLowerCase().includes(needle),
      )
    }

    function foldName(value) {
      return String(value || '').trim().toLowerCase()
    }

    /* Which family a column type belongs to. Two columns can only be joined when
       their families match: `order_no` as varchar and as integer are different
       questions about the same order, and a join between them would compare text
       to a number. Unknown types fall back to `any`, because refusing to suggest a
       join is worse than suggesting one the reader can decline. */
    function columnFamily(type) {
      const text = String(type || '')
        .trim()
        .toLowerCase()
      if (!text) return 'any'
      if (/(char|text|clob|string|uuid|enum|jsonb?|xml)/.test(text)) return 'text'
      if (/(int|serial|decimal|numeric|real|double|float|money)/.test(text)) return 'number'
      if (/(timestamp|datetime|date|time|interval)/.test(text)) return 'date'
      if (/bool/.test(text)) return 'bool'
      if (/(bytea|blob|binary|bit)/.test(text)) return 'binary'
      return 'any'
    }

    function typesJoin(left, right) {
      const a = columnFamily(left)
      const b = columnFamily(right)
      return a === 'any' || b === 'any' || a === b
    }

    /* Join candidates for one member: a column of this table whose name also
       appears on another member, with a type that can be compared. Same name is
       the only evidence the panel has — it never reads rows to guess a
       relationship — so the reason says exactly that and nothing more. */
    function linkCandidates(columns, others, limit = 5) {
      const found = []
      for (const column of columns || []) {
        const name = String((column && column.name) || '').trim()
        if (!name) continue
        const folded = foldName(name)
        for (const other of others || []) {
          const otherName = String((other && other.table) || '')
          if (!otherName) continue
          for (const partner of other.columns || []) {
            if (foldName(partner && partner.name) !== folded) continue
            if (!typesJoin(column.type, partner.type)) continue
            found.push({
              table: otherName,
              column: String(partner.name || ''),
              fromColumn: name,
              reason: 'same',
            })
          }
        }
      }
      return found.slice(0, Math.max(0, limit))
    }

    function ImportView(props) {
      const t = props.t
      const [state, setState] = React.useState({ status: 'loading', data: null, error: null })
      const [selected, setSelected] = React.useState([])
      const [busy, setBusy] = React.useState(false)
      const [filter, setFilter] = React.useState('')

      React.useEffect(() => {
        let alive = true
        apiGet('/dbeaver/scan')
          .then((data) => {
            if (alive) setState({ status: 'ready', data, error: null })
          })
          .catch((error) => {
            if (alive) setState({ status: 'error', data: null, error: String((error && error.message) || error) })
          })
        return () => {
          alive = false
        }
      }, [])

      const existing = props.existingIds || []
      const all = state.data ? state.data.sources : []

      const toggle = (id) =>
        setSelected((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]))

      const runImport = async () => {
        setBusy(true)
        try {
          const data = await apiPost('/dbeaver/import', { ids: selected })
          props.onImported(data)
        } catch (error) {
          setState((prev) => ({ ...prev, error: String((error && error.message) || error) }))
        } finally {
          setBusy(false)
        }
      }

      const needle = filter.trim().toLowerCase()
      const files = (all || [])
        .map((source) => ({ ...source, connections: (source.connections || []).filter((item) => connectionMatches(item, needle)) }))
        .filter((source) => source.connections.length > 0)
      const totalConnections = (all || []).reduce((sum, source) => sum + (source.connections || []).length, 0)
      const visibleConnections = files.reduce((sum, source) => sum + source.connections.length, 0)

      /* Only what the filter currently shows, and only what can actually be
         imported: a row that is already in the registry can never be picked, so
         it must not hold the button in a half-selected state. */
      const pickable = files.reduce(
        (ids, source) =>
          ids.concat(
            source.connections
              .filter((item) => item.importable && item.alreadyImported !== true && !existing.includes(item.id))
              .map((item) => item.id),
          ),
        [],
      )
      const allPicked = pickable.length > 0 && pickable.every((id) => selected.includes(id))
      const toggleAll = () =>
        setSelected((prev) =>
          allPicked ? prev.filter((id) => !pickable.includes(id)) : Array.from(new Set([...prev, ...pickable])),
        )

      if (state.status === 'loading') return h('div', { className: 'dbmcp-empty' }, t('loading'))
      if (state.status === 'error') {
        return h('div', { className: 'dbmcp-error' }, h('div', null, state.error))
      }

      return h(
        'div',
        { className: 'dbmcp-scan' },
        // The bar stays put while the list scrolls, so the action never leaves
        // the viewport no matter how many connections DBeaver knows about.
        h(
          'div',
          { className: 'dbmcp-scan-bar' },
          h(TextInput, {
            value: filter,
            placeholder: t('import.searchPlaceholder'),
            label: t('import.searchPlaceholder'),
            onChange: setFilter,
          }),
          h('span', { className: 'dbmcp-hint' }, fmt(t('import.matches'), { n: visibleConnections, total: totalConnections })),
          h(
            'label',
            { className: 'dbmcp-check dbmcp-scan-all' + (pickable.length === 0 ? ' is-off' : '') },
            h('input', {
              type: 'checkbox',
              checked: allPicked,
              disabled: pickable.length === 0,
              onChange: toggleAll,
            }),
            h('span', null, t('import.selectAll')),
            pickable.length > 0 ? h('span', { className: 'dbmcp-hint' }, `(${pickable.length})`) : null,
          ),
          h(
            'button',
            { type: 'button', className: 'dbmcp-btn is-primary', disabled: busy || selected.length === 0, onClick: runImport },
            busy ? t('action.importing') : `${t('action.importSelected')} (${selected.length})`,
          ),
        ),
        h('p', { className: 'dbmcp-sub' }, t('import.body')),
        all.length === 0
          ? h(
              'div',
              { className: 'dbmcp-empty' },
              h('strong', null, t('import.empty')),
              h(
                'p',
                null,
                state.data.roots.join(' · '),
              ),
            )
          : visibleConnections === 0
            ? h('div', { className: 'dbmcp-empty' }, t('import.noMatch'))
            : files.map((source) =>
              h(
                'div',
                { key: source.file },
                h(Card, { title: t('import.file'), aside: source.credentialsFound ? t('import.credentialsFound') : t('import.credentialsMissing') },
                  h('div', { className: 'dbmcp-scan-file' }, source.file),
                  h(
                    'ul',
                    { className: 'dbmcp-list', style: { marginTop: '10px' } },
                    source.connections.map((item) => {
                      const duplicate = item.alreadyImported === true
                      const taken = duplicate || existing.includes(item.id)
                      return h(
                        'li',
                        { className: 'dbmcp-item' + (duplicate ? ' is-taken' : ''), key: item.id },
                        h(
                          'div',
                          { className: 'dbmcp-item-main' },
                          h(
                            'div',
                            { className: 'dbmcp-item-name' },
                            item.importable
                              ? h('input', {
                                  type: 'checkbox',
                                  checked: selected.includes(item.id),
                                  disabled: taken,
                                  title: duplicate ? t('import.already') : undefined,
                                  onChange: () => toggle(item.id),
                                })
                              : null,
                            h('span', null, item.name || item.id),
                            item.kind ? h('span', { className: 'dbmcp-pill' }, item.kind) : null,
                            duplicate ? h('span', { className: 'dbmcp-pill' }, t('import.already')) : null,
                          ),
                          h(
                            'div',
                            { className: 'dbmcp-item-target' },
                            duplicate
                              ? t('import.alreadyAs').replace('{name}', item.duplicateName || item.duplicateId || '')
                              : [item.importable ? item.target : item.reason, item.user].filter(Boolean).join(' · '),
                          ),
                          duplicate
                            ? null
                            : h(
                                'div',
                                { className: 'dbmcp-item-target' },
                                item.importable ? (item.hasPassword ? t('sources.hasPassword') : t('sources.noPassword')) : '',
                              ),
                        ),
                      )
                    }),
                  ),
                ),
              ),
            ),
      )
    }

    /** P7: read-only structure browser. Only lists tables and columns. */
    function SchemaView(props) {
      const { t, source, onBack } = props
      const [tables, setTables] = React.useState(null)
      // A table is identified by schema + name: the same name can live in two
      // schemas, and describe_table needs the schema to find the right one.
      const [picked, setPicked] = React.useState(null)
      const [detail, setDetail] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [busy, setBusy] = React.useState(true)
      const [filter, setFilter] = React.useState('')
      const [collapsed, setCollapsed] = React.useState({})

      const refresh = React.useCallback(async () => {
        const data = await apiGet(`/schema?datasource=${encodeURIComponent(source.id)}`)
        if (!data.ok) {
          const failure = data.error || {}
          const error = new Error(failure.message || t('schema.error'))
          error.payload = failure
          throw error
        }
        return data
      }, [source.id, t])

      React.useEffect(() => {
        let alive = true
        setBusy(true)
        ;(async () => {
          try {
            const data = await refresh()
            if (alive) {
              setTables(data.tables || [])
              setError(null)
            }
          } catch (failure) {
            if (!alive) return
            const payload = (failure && failure.payload) || {}
            setError(payload.hint ? `${payload.error || failure.message} — ${payload.hint}` : String((failure && failure.message) || failure))
            setTables([])
          } finally {
            if (alive) setBusy(false)
          }
        })()
        return () => {
          alive = false
        }
      }, [refresh])

      const pickedSchema = picked ? picked.schema || '' : ''
      const pickedName = picked ? picked.name : ''

      React.useEffect(() => {
        if (!picked) {
          setDetail(null)
          return undefined
        }
        let alive = true
        setDetail({ loading: true })
        ;(async () => {
          try {
            const schemaPart = picked.schema ? `&schema=${encodeURIComponent(picked.schema)}` : ''
            const data = await apiGet(
              `/schema?datasource=${encodeURIComponent(source.id)}&table=${encodeURIComponent(picked.name)}${schemaPart}`,
            )
            if (alive) setDetail(data)
          } catch (failure) {
            const payload = (failure && failure.payload) || {}
            if (alive) setDetail({ ok: false, error: { message: payload.error || String((failure && failure.message) || failure) } })
          }
        })()
        return () => {
          alive = false
        }
      }, [pickedSchema, pickedName, source.id])

      const groups = React.useMemo(() => groupTables(tables), [tables])

      const needle = filter.trim().toLowerCase()
      const visible = groups
        .map(([schema, items]) => [schema, items.filter((table) => tableMatches(table, needle))])
        .filter(([, items]) => items.length > 0)
      const visibleCount = visible.reduce((sum, [, items]) => sum + items.length, 0)
      const groupLabel = (schema) => (schema ? schema : t('schema.defaultSchema'))

      const side = h(
        'div',
        { className: 'dbmcp-schema-side' },
        h(
          'div',
          { className: 'dbmcp-schema-head' },
          h('span', null, fmt(t('schema.tables'), { n: tables ? tables.length : 0 })),
          needle ? h('span', { className: 'dbmcp-hint' }, fmt(t('schema.matching'), { n: visibleCount })) : null,
        ),
        h(TextInput, {
          value: filter,
          placeholder: t('schema.search'),
          label: t('schema.search'),
          onChange: setFilter,
        }),
        !tables || tables.length === 0
          ? h('div', { className: 'dbmcp-empty' }, t('schema.empty'))
          : visibleCount === 0
            ? h('div', { className: 'dbmcp-empty' }, t('schema.noMatch'))
            : h(
                'div',
                { className: 'dbmcp-schema-groups' },
                visible.map(([schema, items]) => {
                  const closed = collapsed[schema] === true
                  return h(
                    'section',
                    { key: `group-${schema || '_'}`, className: 'dbmcp-schema-group' },
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'dbmcp-schema-group-head',
                        'aria-expanded': closed ? 'false' : 'true',
                        onClick: () => setCollapsed({ ...collapsed, [schema]: !closed }),
                      },
                      h('span', { className: 'dbmcp-schema-caret', 'aria-hidden': 'true' }, closed ? '▸' : '▾'),
                      h('span', { className: 'dbmcp-schema-group-name', title: groupLabel(schema) }, groupLabel(schema)),
                      h('span', { className: 'dbmcp-hint' }, String(items.length)),
                    ),
                    closed
                      ? null
                      : h(
                          'ul',
                          { className: 'dbmcp-schema-tables' },
                          items.map((table) => {
                            const active = pickedName === table.name && pickedSchema === (table.schema || '')
                            return h(
                              'li',
                              { key: `${table.schema || ''}.${table.name}` },
                              h(
                                'button',
                                {
                                  type: 'button',
                                  className: 'dbmcp-schema-table' + (active ? ' is-active' : ''),
                                  onClick: () => setPicked({ schema: table.schema || '', name: table.name }),
                                },
                                h('span', { className: 'dbmcp-schema-name', title: table.name }, table.name),
                                table.type ? h('span', { className: 'dbmcp-pill' }, table.type) : null,
                              ),
                            )
                          }),
                        ),
                  )
                }),
              ),
      )

      let content
      if (busy && !tables) {
        content = h('div', { className: 'dbmcp-empty' }, t('schema.loading'))
      } else if (error) {
        content = h('div', { className: 'dbmcp-error' }, h('div', null, t('schema.error')), h('code', null, error))
      } else {
        content = h(
          'div',
          { className: 'dbmcp-schema' },
          side,
          h(
            'div',
            { className: 'dbmcp-schema-main' },
            !picked
              ? h('div', { className: 'dbmcp-empty' }, t('schema.pick'))
              : detail && detail.loading
                ? h('div', { className: 'dbmcp-empty' }, t('schema.loading'))
                : detail && detail.ok === false
                  ? h(
                      'div',
                      { className: 'dbmcp-error' },
                      h('code', null, (detail.error && detail.error.message) || t('schema.error')),
                    )
                  : detail && detail.ok
                    ? h(
                        'div',
                        null,
                        h(
                          'div',
                          { className: 'dbmcp-schema-head' },
                          h(
                            'span',
                            { className: 'dbmcp-schema-title', title: pickedSchema ? `${pickedSchema}.${detail.table}` : detail.table },
                            pickedSchema ? `${pickedSchema}.${detail.table}` : detail.table,
                          ),
                          h('span', { className: 'dbmcp-hint' }, fmt(t('schema.columns'), { n: (detail.columns || []).length })),
                        ),
                        h(
                          'div',
                          { className: 'dbmcp-schema-tablewrap' },
                          h(
                            'table',
                            { className: 'dbmcp-schema-tablegrid' },
                            h(
                              'thead',
                              null,
                              h(
                                'tr',
                                null,
                                h('th', null, t('schema.column')),
                                h('th', null, t('schema.type')),
                                h('th', null, t('schema.nullable')),
                                h('th', null, t('schema.default')),
                                h('th', null, t('schema.pk')),
                              ),
                            ),
                            h(
                              'tbody',
                              null,
                              (detail.columns || []).map((column) =>
                                h(
                                  'tr',
                                  { key: column.name },
                                  h('td', null, column.name),
                                  h('td', { className: 'dbmcp-mono' }, column.type || ''),
                                  h('td', null, column.nullable ? t('schema.yes') : t('schema.no')),
                                  h('td', { className: 'dbmcp-mono' }, column.default === null || column.default === undefined ? '' : String(column.default)),
                                  h('td', null, column.primaryKey ? '●' : ''),
                                ),
                              ),
                            ),
                          ),
                        ),
                        h('div', { className: 'dbmcp-hint dbmcp-schema-note' }, t('schema.readonlyNote')),
                      )
                    : null,
          ),
        )
      }

      return h('div', { className: 'dbmcp-schema-wrap' }, content)
    }

    function crumbLabel(t, view) {
      if (view.mode === 'schema' && view.source) return view.source.name || view.source.id
      if (view.mode === 'create') return t('action.new')
      if (view.mode === 'edit' && view.source) return fmt(t('form.edit'), { name: view.source.name || view.source.id })
      if (view.mode === 'import') return t('action.import')
      return t('panel.title')
    }

    function Breadcrumbs({ t, trail }) {
      const items = []
      trail.forEach((step, index) => {
        if (index > 0) items.push(h('span', { key: `sep-${index}`, className: 'dbmcp-crumb-sep' }, '/'))
        if (typeof step.onSelect === 'function') {
          items.push(
            h('button', { key: `step-${index}`, type: 'button', className: 'dbmcp-crumb', onClick: step.onSelect }, step.label),
          )
        } else {
          items.push(h('span', { key: `step-${index}`, className: 'dbmcp-crumb is-current' }, step.label))
        }
      })
      return h('nav', { className: 'dbmcp-crumbs', 'aria-label': t('panel.title') }, items)
    }

    /**
     * The global write switch, drawn where the sources are listed.
     *
     * It used to sit in the diagnostics card, reading as one more fact among
     * facts; it then moved to the status strip and finally here, in the list
     * card's title row next to the group form — the same row as the sources it
     * governs. Renders nothing when the panel hands it no handler, so a
     * read-only host cannot show a switch that would do nothing.
     */
    function WriteSwitch(props) {
      const { t, allowWrite, busy, onWrite } = props
      if (typeof onWrite !== 'function') return null
      const on = allowWrite === true
      return h(
        'span',
        { className: 'dbmcp-list-write' },
        h(Switch, {
          checked: on,
          title: t('write.hint'),
          disabled: busy === true,
          onChange: (next) => onWrite(next),
        }),
        h('span', { className: 'dbmcp-list-write-label' }, on ? t('write.on') : t('write.off')),
      )
    }

    /** Quiet strip above the list: bridge health, totals, filters and search. */
  function StatusStrip(props) {
    const { t, data, sources, failedSources, groupNames, filter, setFilter, query, setQuery } = props
    if (!data) return null
    const mcpReady = Boolean(data.mcp && data.mcp.phase === 'ready')
    const failed = failedSources.length
    const healthy = Math.max(sources.length - failed, 0)
    const chips = [{ id: 'all', label: t('filter.all'), count: sources.length }]
    for (const name of groupNames) {
      const count = sources.filter((source) => String(source.group || '').trim() === name).length
      chips.push({ id: 'group:' + name, label: name, count })
    }
    const loose = sources.filter((source) => !String(source.group || '').trim()).length
    if (loose > 0) chips.push({ id: 'group:', label: t('group.unassigned'), count: loose })
    if (failed > 0) chips.push({ id: 'failed', label: t('filter.failed'), count: failed, warn: true })
    return h(
      'div',
      { className: 'dbmcp-status' },
      h(
        'div',
        { className: 'dbmcp-status-row' },
        h('span', { className: 'dbmcp-dot ' + (mcpReady ? 'is-ok' : 'is-error') }),
        h('span', { className: 'dbmcp-status-label' }, mcpReady ? t('status.mcpOk') : t('status.mcpDown')),
        h(
          'span',
          { className: 'dbmcp-stats' },
          h('span', { className: 'dbmcp-stat' }, t('status.total').replace('{n}', String(sources.length))),
          h('span', { className: 'dbmcp-stat-sep' }),
          h(
            'span',
            { className: 'dbmcp-stat is-ok' },
            t('status.healthy').replace('{n}', String(healthy)),
          ),
          failed > 0 ? h('span', { className: 'dbmcp-stat-sep' }) : null,
          failed > 0
            ? h(
                'span',
                { className: 'dbmcp-stat is-error' },
                t('status.failing').replace('{n}', String(failed)),
                ' ',
                t('status.failingNames').replace(
                  '{names}',
                  failedSources.map((source) => source.name || source.id).join(', '),
                ),
              )
            : null,
        ),
        h('span', { className: 'dbmcp-status-spacer' }),
        h('div', { className: 'dbmcp-status-search' }, h(TextInput, {
          value: query,
          onChange: setQuery,
          placeholder: t('sources.searchPlaceholder'),
          title: t('sources.searchPlaceholder'),
        })),
      ),
      h(
        'div',
        { className: 'dbmcp-status-row is-filters' },
        h(
          'div',
          { className: 'dbmcp-chips' },
          chips.map((chip) =>
            h(
              'button',
              {
                key: chip.id,
                type: 'button',
                className: 'dbmcp-chip' + (filter === chip.id ? ' is-active' : '') + (chip.warn ? ' is-warn' : ''),
                onClick: () => setFilter(filter === chip.id ? 'all' : chip.id),
              },
              chip.warn ? h('span', { className: 'dbmcp-chip-icon', 'aria-hidden': 'true' }, '⚠') : null,
              chip.label,
              h('span', { className: 'dbmcp-chip-count' }, String(chip.count)),
            ),
          ),
        ),
      ),
    )
  }

  function MainPanel() {
      const service = useLocale()
      const palette = useThemePalette()
      const t = React.useMemo(() => (service ? service.bind(NS) : (key) => key), [service])
      const [state, setState] = React.useState({ status: 'loading', data: null, error: null })
      const [busy, setBusy] = React.useState(false)
      /* The panel comes back where it was left: the remembered tab is checked
         against the tabs that actually exist, and a sub-view that belongs to one
         datasource (the structure browser, the edit form) opens its own tab
         instead of guessing which row the reader meant. */
      const [view, setView] = React.useState(() => {
        const saved = String(readPanel().tab || '')
        if (!TABS.some((entry) => entry.id === saved)) return { mode: 'list' }
        return { mode: saved }
      })
      const tab = tabOfMode(view.mode)
      const [notice, setNotice] = React.useState(null)
      const [probing, setProbing] = React.useState(null)
      const [pendingDelete, setPendingDelete] = React.useState(null)
      const [selected, setSelected] = React.useState([])
      const [bulkGroup, setBulkGroup] = React.useState('')
      const [pendingBulkDelete, setPendingBulkDelete] = React.useState(false)
      const [groupDraft, setGroupDraft] = React.useState('')
      const [editingGroup, setEditingGroup] = React.useState(null)
      const [pendingGroupDelete, setPendingGroupDelete] = React.useState(null)
      const [dragIds, setDragIds] = React.useState([])
      const [dragOverGroup, setDragOverGroup] = React.useState(null)
      const [dropMark, setDropMark] = React.useState(null)
      const [renamingSource, setRenamingSource] = React.useState(null)
      /* The typed boxes come back filled: the search text, the filter chip, the
         folded groups, the datasource picked on each page and the trace form.
         `remember` writes the new value and hands it to the setter, so one line
         both updates the screen and the memory. */
      const savedPanel = readPanel()
      const remember = (key, setter) => (value) => {
        setter(value)
        writePanel({ [key]: value })
      }
      const [query, setQuery] = React.useState(() => String(savedPanel.query || ''))
      const [filter, setFilter] = React.useState(() => String(savedPanel.filter || 'all'))
      const [copiedId, setCopiedId] = React.useState(null)
      const [copiedEndpoint, setCopiedEndpoint] = React.useState(false)
      const [copiedChip, setCopiedChip] = React.useState(null)
      const [collapsed, setCollapsed] = React.useState(() =>
        Array.isArray(savedPanel.collapsed) ? savedPanel.collapsed : [],
      )

      const toggleFolded = (name) => {
        const next = collapsed.includes(name) ? collapsed.filter((item) => item !== name) : collapsed.concat(name)
        setCollapsed(next)
        writePanel({ collapsed: next })
      }

      /** Switching a tab only swaps the card below; the chrome never moves. */
      const selectTab = (id) => {
        setView({ mode: id })
      }

      const backToChat = () => {
        const layout = layoutService
        if (!layout || typeof layout.selectPanel !== 'function') return
        try {
          layout.selectPanel(null)
        } catch (error) {
          /* older shells may not expose selectPanel; staying on the panel is fine */
        }
      }
      const AUDIT_PAGE = 12
      const [settings, setSettings] = React.useState(null)
      const [audit, setAudit] = React.useState({ entries: [], total: 0, file: null })
      const [auditBusy, setAuditBusy] = React.useState(false)
      const [env, setEnv] = React.useState(null)
      const [installing, setInstalling] = React.useState(false)
      const [scopes, setScopes] = React.useState(null)
      const [scopesOpen, setScopesOpen] = React.useState(true)
      const [http, setHttp] = React.useState(null)
      const [clients, setClients] = React.useState(null)
      const [tools, setTools] = React.useState(null)
      const [portDraft, setPortDraft] = React.useState('')
      const [clientBusy, setClientBusy] = React.useState('')
      /* Page A — the relation graph. One datasource at a time, every edge it
         knows, and the four verdicts that move an edge between states. */
      /* The last answer of each page survives the panel being unmounted, but
         only in memory — see keepResult: rows are not written to the browser
         store, only the inputs are. */
      const [graph, setGraphState] = React.useState(() => readResult('graph'))
      const setGraph = (value) => {
        keepResult('graph', value)
        setGraphState(value)
      }
      const [graphBusy, setGraphBusy] = React.useState(false)
      const [graphError, setGraphError] = React.useState(null)
      const [graphSource, setGraphSource] = React.useState(() => String(savedPanel.graphSource || ''))
      const [graphFilter, setGraphFilter] = React.useState(() => String(savedPanel.graphFilter || 'all'))
      const [graphOpen, setGraphOpen] = React.useState('')
      const [graphForm, setGraphForm] = React.useState(null)
      const [graphReason, setGraphReason] = React.useState('')
      const [graphCondition, setGraphCondition] = React.useState(null)
      const [graphConditionDraft, setGraphConditionDraft] = React.useState('')
      /* The trace form is remembered field by field, not as a whole: the value
         and the datasource are what a reader re-types most often. */
      const [traceValue, setTraceValue] = React.useState(() => String(savedPanel.traceValue || ''))
      const [traceTable, setTraceTable] = React.useState(() => String(savedPanel.traceTable || ''))
      const [traceColumn, setTraceColumn] = React.useState(() => String(savedPanel.traceColumn || ''))
      const [traceDirection, setTraceDirection] = React.useState(() => String(savedPanel.traceDirection || 'both'))
      const [traceSource, setTraceSource] = React.useState(() => String(savedPanel.traceSource || ''))
      const [trace, setTraceState] = React.useState(() => readResult('trace'))
      const setTrace = (value) => {
        keepResult('trace', value)
        setTraceState(value)
      }
      const [traceBusy, setTraceBusy] = React.useState(false)
      const [traceError, setTraceError] = React.useState(null)
      const [traceOpen, setTraceOpen] = React.useState('')
      const [traceScene, setTraceScene] = React.useState(() => String(savedPanel.traceScene || ''))
      const [scenes, setScenes] = React.useState([])
      /* The walk just taken can be saved as a scene. The table list is the one
         the walk actually read, so the scene records what the reader saw instead
         of a second guess at which tables matter. The draft is transient: a name
         is typed, the answer is stored, the form closes. */
      const [traceSceneDraft, setTraceSceneDraft] = React.useState(null)
      /* The manual entry columns stay hidden until asked for: most walks start
         from "wherever the value lives", and two empty boxes over the form read
         as required fields. */
      const [traceManual, setTraceManual] = React.useState(() => savedPanel.traceManual === true)
      /* Nodes arrive open: the rows are how a step is checked, so a reader who
         picked a box should not have to click again to see what it read. The set
         therefore holds the folded ones instead of the open ones. It is kept
         with the walk it belongs to, so reopening the panel returns to the same
         step rather than to the first one. */
      const [traceFolded, setTraceFoldedState] = React.useState(() => {
        const saved = readResult('traceFolded')
        return Array.isArray(saved) ? saved : []
      })
      const setTraceFolded = (value) => {
        keepResult('traceFolded', value)
        setTraceFoldedState(value)
      }
      /* Which node the overview strip is pointing at — set by clicking a box up
         there, cleared when the walk is re-run. */
      const [traceFocus, setTraceFocusState] = React.useState(() => {
        const saved = readResult('traceFocus')
        return typeof saved === 'number' ? saved : 0
      })
      const setTraceFocus = (value) => {
        keepResult('traceFocus', value)
        setTraceFocusState(value)
      }
      /* How much the graph is magnified. A walk that fans out into five lanes does
         not fit any card, and shrinking the text to fit makes the labels unreadable,
         so the picture keeps its own size and the reader scales it. */
      const [traceZoom, setTraceZoomState] = React.useState(() => {
        const saved = readResult('traceZoom')
        return typeof saved === 'number' ? saved : 1
      })
      const setTraceZoom = (value) => {
        keepResult('traceZoom', value)
        setTraceZoomState(value)
      }
      /* The Scenes page edits one scene at a time: `sceneEdit` is the draft on the
         right, `scenePicked` the id of the row on the left. The draft is separate
         from the list so typing a name does not rename the list entry until the
         save button says so — a scene that is renamed by accident is not obvious
         afterwards, because there is no undo. */
      const [sceneSource, setSceneSource] = React.useState(() => String(savedPanel.sceneSource || ''))
      const [sceneRows, setSceneRows] = React.useState([])
      const [scenePicked, setScenePicked] = React.useState('')
      /* A draft that is not a stored scene yet. It cannot be `scenePicked`:
         that state is a row id, and a new scene has none until it is saved. */
      const [sceneNew, setSceneNew] = React.useState(false)
      const [sceneEdit, setSceneEdit] = React.useState(null)
      const [sceneDirty, setSceneDirty] = React.useState(false)
      const [sceneBusy, setSceneBusy] = React.useState(false)
      const [sceneError, setSceneError] = React.useState(null)
      const [sceneQuery, setSceneQuery] = React.useState('')
      const [sceneCatalog, setSceneCatalog] = React.useState(null)
      const [sceneCatalogError, setSceneCatalogError] = React.useState(null)
      const [sceneAddOpen, setSceneAddOpen] = React.useState(false)
      const [sceneDeleteAsk, setSceneDeleteAsk] = React.useState(false)
      /* The edge list of the edited datasource, for the one thing the scene row
         cannot answer: an "isolated" member may still be joined to tables that are
         not in the scene. The scene shows that difference and offers to take the
         other end in; the edges themselves stay where they live. */
      const [sceneGraph, setSceneGraph] = React.useState(null)
      /* Which member has its join candidates open, and the columns those
         candidates are read from. One `describe_table` per member table, cached by
         name: the catalogue is the only thing consulted, never a row. */
      const [sceneLinkFor, setSceneLinkFor] = React.useState('')
      const [sceneColumns, setSceneColumns] = React.useState({})

      const load = React.useCallback(async () => {
        setBusy(true)
        try {
          const data = await apiGet('/health')
          setState({ status: 'ready', data, error: null })
          if (data.settings) setSettings(data.settings)
          void apiGet(`/audit?limit=${AUDIT_PAGE}`)
            .then((payload) =>
              setAudit({
                entries: payload.entries || [],
                total: payload.total || 0,
                file: payload.file || null,
              }),
            )
            .catch(() => {})
          void apiGet('/python/env')
            .then((payload) => setEnv(payload))
            .catch(() => {})
          void apiGet('/scopes')
            .then((payload) => setScopes({ sessions: payload.sessions || [], archived: payload.archived || [] }))
            .catch(() => {})
          void apiGet('/http/status')
            .then((payload) => setHttp(payload))
            .catch(() => {})
          void apiGet('/clients')
            .then((payload) => setClients(payload))
            .catch(() => {})
          void apiGet('/tools')
            .then((payload) => setTools(payload))
            .catch(() => {})
        } catch (error) {
          setState({ status: 'error', data: null, error: String((error && error.message) || error) })
        } finally {
          setBusy(false)
        }
      }, [])

      React.useEffect(() => {
        load()
      }, [load])

      /* One writer for the tab: a screen that is reopened lands where it was
         left. Sub-views keep their tab (the structure browser is a list screen,
         the import runs under its own tab), so this is the tab bar's state. */
      React.useEffect(() => {
        writePanel({ tab })
      }, [tab])

      /* The audit log can hold up to 200 lines. readAudit always returns the
         newest `limit`, so asking for a bigger limit and taking the tail keeps
         the same newest-first order while revealing older entries. */
      const loadMoreAudit = React.useCallback(async () => {
        if (auditBusy) return
        setAuditBusy(true)
        try {
          const next = Math.min(200, audit.entries.length + AUDIT_PAGE)
          const payload = await apiGet(`/audit?limit=${next}`)
          setAudit({
            entries: payload.entries || [],
            total: payload.total || 0,
            file: payload.file || null,
          })
        } catch {
          /* keep the entries already on screen */
        } finally {
          setAuditBusy(false)
        }
      }, [audit.entries.length, auditBusy])

      const data = state.data
      const apiOk = state.status === 'ready' && data && data.ok === true
      const sources = (data && data.datasources) || []

      const finish = (message, isError) => {
        setNotice({ message, isError: Boolean(isError) })
        setView({ mode: 'list' })
        load()
      }

      const save = (source) => finish(fmt(t('notice.saved'), { name: source.name || source.id }), false)

      const remove = async (source) => {
        if (pendingDelete !== source.id) {
          setPendingDelete(source.id)
          return
        }
        setPendingDelete(null)
        try {
          await apiPost('/datasources/delete', { id: source.id })
          finish(fmt(t('notice.deleted'), { name: source.name || source.id }), false)
        } catch (error) {
          setNotice({ message: String((error && error.message) || error), isError: true })
        }
      }

      const toggleSelected = (id) => {
        setPendingBulkDelete(false)
        setSelected((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]))
      }

      const runBulk = async (action, extra = {}) => {
        if (selected.length === 0) return
        setBusy(true)
        try {
          const payload = await apiPost('/datasources/bulk', { action, ids: selected, ...extra })
          const affected = Number(payload && payload.affected) || selected.length
          setSelected([])
          setPendingBulkDelete(false)
          setBulkGroup('')
          if (action === 'group') {
            const name = String(extra.group || '').trim() || t('group.unassigned')
            finish(t('notice.bulkGrouped').replace('{n}', String(affected)).replace('{group}', name), false)
          } else {
            finish(t('notice.bulkDone').replace('{n}', String(affected)), false)
          }
        } catch (error) {
          setNotice({ message: String((error && error.message) || error), isError: true })
        } finally {
          setBusy(false)
        }
      }

      /**
       * Flip one source between read-only and writable from its row switch.
       *
       * Writable now means "may write to every schema it can see": there is no
       * whitelist to ask about, so the switch is a pure flag flip.
       */
      const toggleReadOnly = async (source) => {
        await setReadOnly(source, nextReadOnly(source))
      }

      /** POST the flag; `allowDdl` rides along when a DDL switch flips. */
      const setReadOnly = async (source, readOnly, allowDdl) => {
        const name = source.name || source.id
        setBusy(true)
        try {
          const body = { action: 'readOnly', ids: [source.id], readOnly }
          if (allowDdl !== undefined) body.allowDdl = allowDdl === true
          await apiPost('/datasources/bulk', body)
          const globalOpen = Boolean(settings && settings.allowWrite)
          const message = readOnly
            ? t('notice.nowReadOnly').replace('{name}', name)
            : globalOpen
              ? t('notice.nowWritable').replace('{name}', name)
              : t('notice.nowWritableLocked').replace('{name}', name)
          setNotice({ message, isError: false })
          load()
        } catch (error) {
          setNotice({ message: String((error && error.message) || error), isError: true })
          throw error
        } finally {
          setBusy(false)
        }
      }

      /** Flip the DDL switch, which rides alongside the writable flag. */
      const toggleDdl = async (source) => {
        await setReadOnly(source, false, source.allowDdl !== true)
      }

      const bulkDelete = async () => {
        if (selected.length === 0) return
        if (!pendingBulkDelete) {
          setPendingBulkDelete(true)
          return
        }
        await runBulk('delete')
      }

      const probe = async (source) => {        setProbing(source.id)
        try {
          const result = await apiPost('/datasources/test', { id: source.id })
          const probeInfo = result.probe || {}
          if (probeInfo.ok) {
            setNotice({ message: fmt(t('notice.probeOk'), { name: source.name, ms: probeInfo.latencyMs }), isError: false })
          } else {
            /* the failing row already carries the message; a banner on top would just repeat it */
            setNotice(null)
          }
          load()
        } catch (error) {
          setNotice({ message: String((error && error.message) || error), isError: true })
        } finally {
          setProbing(null)
        }
      }

      const restartMcp = async () => {
        setBusy(true)
        try {
          const result = await apiPost('/mcp/restart', {})
          setNotice({
            message: result.ok
              ? t('notice.mcpReady').replace('{count}', String((result.tools || []).length))
              : `${t('diag.mcpFailed')} ${result.error || ''}`,
            isError: !result.ok,
          })
          await load()
        } catch (error) {
          setNotice({ message: String((error && error.message) || error), isError: true })
        } finally {
          setBusy(false)
        }
      }

      const copyProbe = async (source) => {
        try {
          await copyText(probeReport(source, data.plugin))
          setCopiedId(source.id)
          setTimeout(() => setCopiedId((prev) => (prev === source.id ? null : prev)), 1600)
        } catch (error) {
          setNotice({ message: String((error && error.message) || error), isError: true })
        }
      }

      /** The chip copies the bare id: that is the token the user pastes in chat. */
      const copyId = async (id) => {
        try {
          await copyText(id)
          setCopiedChip(id)
          setTimeout(() => setCopiedChip((prev) => (prev === id ? null : prev)), 1600)
        } catch (error) {
          setNotice({ message: String((error && error.message) || error), isError: true })
        }
      }

      /** Copy the MCP endpoint, ready to paste into another agent's settings. */
      const copyEndpoint = async (url) => {
        if (!url) return
        try {
          await copyText(url)
          setCopiedEndpoint(true)
          setTimeout(() => setCopiedEndpoint(false), 1600)
        } catch (error) {
          setNotice({ message: String((error && error.message) || error), isError: true })
        }
      }

      const toggleWrite = async (next) => {
        try {
          const payload = await apiPost('/settings', { allowWrite: next })
          setSettings(payload.settings || { allowWrite: next })
          setNotice({ message: next ? t('notice.writeOn') : t('notice.writeOff'), isError: false })
          load()
        } catch (error) {
          setNotice({ message: String((error && error.message) || error), isError: true })
        }
      }

      /** Drop the limits the agent put on one conversation. */
      const removeScope = async (session) => {
        try {
          const payload = await apiPost('/scopes/delete', { session })
          setScopes({ sessions: payload.sessions || [], archived: payload.archived || [] })
          setNotice({ message: t('scopes.removed'), isError: false })
        } catch (error) {
          setNotice({ message: String((error && error.message) || error), isError: true })
        }
      }

      /** Drop every conversation limit at once. */
      const clearScopes = async () => {
        try {
          await apiPost('/scopes/clear', {})
          setScopes({ sessions: [], archived: [] })
          setNotice({ message: t('scopes.cleared'), isError: false })
        } catch (error) {
          setNotice({ message: String((error && error.message) || error), isError: true })
        }
      }

      const installDeps = async () => {
        setInstalling(true)
        setNotice(null)
        try {
          const payload = await apiPost('/python/setup', {})
          if (payload && payload.python) setEnv(payload.python)
          setNotice({ message: payload && payload.ok ? t('notice.depsOk') : t('notice.depsFail'), isError: !(payload && payload.ok) })
          load()
        } catch (error) {
          setNotice({ message: `${t('notice.depsFail')} ${String((error && error.message) || error)}`, isError: true })
        } finally {
          setInstalling(false)
        }
      }

      /** Start or stop the HTTP endpoint other agents connect to. */
      const controlHttp = async (action) => {
        setBusy(true)
        try {
          const port = Number(portDraft || (http && http.port) || (settings && settings.httpPort) || 8765)
          const payload = await apiPost(`/http/${action}`, action === 'start' ? { port } : {})
          if (payload && payload.http) setHttp(payload.http)
          setNotice({
            message: payload && payload.http && payload.http.running ? t('notice.httpOn') : t('notice.httpOff'),
            isError: !(payload && payload.ok !== false),
          })
          await load()
        } catch (error) {
          setNotice({ message: String((error && error.message) || error), isError: true })
        } finally {
          setBusy(false)
        }
      }

      /** Write this server into one client's own configuration file. */
      const configureClient = async (client, transport) => {
        const busyKey = `${client.id}:${transport}`
        setClientBusy(busyKey)
        setNotice(null)
        try {
          const payload = await apiPost('/clients/configure', { client: client.id, transport })
          setNotice({
            message: fmt(t('notice.clientReady'), { name: client.label, transport: payload.transport || transport }),
            isError: false,
          })
          await load()
        } catch (error) {
          const body = (error && error.payload) || {}
          const hint = body.hint ? ` ${body.hint}` : ''
          setNotice({ message: `${String((error && error.message) || error)}${hint}`, isError: true })
        } finally {
          setClientBusy('')
        }
      }

      /** Publish or withdraw one tool for the agent. */
      const [limitDraft, setLimitDraft] = React.useState({})

      /* The four numbers that decide what a step may cost. They live in
         settings.json like the row limits do, so the panel edits them and the
         Python side re-reads the file on the next trace. */
      const [costDraft, setCostDraft] = React.useState({})

      /* Same defaults and caps as `COST_DEFAULTS` / `COST_CAPS` in
         server/relations.py and src/host.js: the three layers have to agree or an
         input the panel accepts would be silently changed underneath. */
      const COST_RULES = [
        { key: 'slowMs', min: 10, max: 60000, fallback: 200 },
        { key: 'timingWindow', min: 1, max: 20, fallback: 5 },
        { key: 'trustSamples', min: 1, max: 20, fallback: 3 },
        { key: 'bigTableRows', min: 1000, max: 1000000000, fallback: 1000000 },
      ]

      /* Named one by one rather than built from the key string: the i18n check
         reads the source for literal translate calls, so a template literal here
         would hide the lookup and leave the keys unreachable. */
      const costName = (rule) =>
        rule.key === 'slowMs'
          ? t('cost.slowMs')
          : rule.key === 'timingWindow'
            ? t('cost.timingWindow')
            : rule.key === 'trustSamples'
              ? t('cost.trustSamples')
              : t('cost.bigTableRows')

      const costUnit = (rule) =>
        rule.key === 'slowMs'
          ? t('cost.slowMsUnit')
          : rule.key === 'timingWindow'
            ? t('cost.timingWindowUnit')
            : rule.key === 'trustSamples'
              ? t('cost.trustSamplesUnit')
              : t('cost.bigTableRowsUnit')

      const costHint = (rule) =>
        rule.key === 'slowMs'
          ? t('cost.slowMsHint')
          : rule.key === 'timingWindow'
            ? t('cost.timingWindowHint')
            : rule.key === 'trustSamples'
              ? t('cost.trustSamplesHint')
              : t('cost.bigTableRowsHint')

      const costValues = React.useMemo(() => {
        const stored = (tools && tools.cost) || {}
        const values = {}
        for (const rule of COST_RULES) {
          const raw = Number(stored[rule.key])
          values[rule.key] = Number.isInteger(raw) ? raw : rule.fallback
        }
        return values
      }, [tools])

      /* ------------------------------------------------------- relation graph
         Page A reads one datasource's graph and nothing else. The panel has no
         SQL box on purpose: every action here is one of the six graph tools, so
         a page that only ever moves edges cannot become a query console. */

      /** The datasource the graph page is showing: the pick, else the default. */
      const graphTarget = React.useMemo(() => {
        if (graphSource && sources.some((item) => item.id === graphSource)) return graphSource
        const fallback = sources.find((item) => item.isDefault === true) || sources[0]
        return fallback ? fallback.id : ''
      }, [graphSource, sources])

      const loadGraph = React.useCallback(async () => {
        if (!graphTarget) {
          setGraph({ edges: [], counts: null, total: 0, truncated: false })
          setGraphError(null)
          return
        }
        setGraphBusy(true)
        try {
          const payload = await apiGet(`/relations?datasource=${encodeURIComponent(graphTarget)}`)
          if (payload.ok === false) {
            const failure = payload.error || {}
            setGraphError(failure.hint ? `${failure.message || 'list_edges failed'} — ${failure.hint}` : failure.message || 'list_edges failed')
            setGraph({ edges: [], counts: null, total: 0, truncated: false })
            return
          }
          setGraphError(null)
          setGraph({
            edges: payload.edges || [],
            counts: payload.counts || null,
            total: payload.total || 0,
            truncated: payload.truncated === true,
          })
        } catch (error) {
          const body = (error && error.payload) || {}
          setGraphError(String(body.message || (error && error.message) || error))
          setGraph({ edges: [], counts: null, total: 0, truncated: false })
        } finally {
          setGraphBusy(false)
        }
      }, [graphTarget])

      React.useEffect(() => {
        if (tab !== 'graph') return
        void loadGraph()
      }, [tab, loadGraph])

      /** Run one graph write and fold its outcome back into the notice line. */
      const graphAction = async (path, body, message) => {
        setGraphBusy(true)
        setNotice(null)
        try {
          const payload = await apiPost(path, { ...body, datasource: graphTarget })
          if (payload && payload.ok === false) {
            const failure = payload.error || {}
            const hint = failure.hint ? ` — ${failure.hint}` : ''
            setNotice({ message: `${failure.message || payload.message || 'the tool reported an error'}${hint}`, isError: true })
            return null
          }
          if (message) setNotice({ message, isError: false })
          await loadGraph()
          return payload
        } catch (error) {
          const body2 = (error && error.payload) || {}
          const failure = body2.error || {}
          const message2 = failure.message || body2.message || String((error && error.message) || error)
          const hint = failure.hint ? ` — ${failure.hint}` : ''
          setNotice({ message: `${message2}${hint}`, isError: true })
          return null
        } finally {
          setGraphBusy(false)
        }
      }

      const discoverEdges = () => graphAction('/relations/discover', {}, t('notice.discovered'))

      const mineEdges = () => graphAction('/relations/mine', {}, t('notice.mined'))

      const sendFeedback = (edge, verdict, reason) =>
        graphAction(
          '/relations/feedback',
          { edge_id: edge.id, verdict, reason: reason || undefined },
          fmt(t('notice.verdict'), { verdict }),
        )

      const saveCondition = (edge, condition) =>
        graphAction(
          '/relations/condition',
          { edge_id: edge.id, condition },
          condition ? t('notice.conditionSet') : t('notice.conditionCleared'),
        )

      const removeEdge = (edge) => graphAction('/relations/delete', { edge_id: edge.id }, t('notice.edgeDeleted'))

      const proposeEdge = async () => {
        const draft = graphForm || {}
        const payload = await graphAction('/relations/propose', {
          from_table: draft.from_table || '',
          from_column: draft.from_column || '',
          to_table: draft.to_table || '',
          to_column: draft.to_column || '',
          condition: draft.condition || undefined,
          note: draft.note || undefined,
        }, t('notice.edgeProposed'))
        if (payload) {
          setGraphForm(null)
          setGraphOpen('')
        }
      }

      /** The datasource the trace page walks: the pick, else the default. */
      const traceTarget = React.useMemo(() => {
        if (traceSource && sources.some((item) => item.id === traceSource)) return traceSource
        const fallback = sources.find((item) => item.isDefault === true) || sources[0]
        return fallback ? fallback.id : ''
      }, [traceSource, sources])

      /** The scenes of this datasource. A scene is a named table list, so it can
       * only ever narrow a walk — it never adds a join the graph does not hold. */
      const loadScenes = React.useCallback(async () => {
        if (!traceTarget) {
          setScenes([])
          return
        }
        try {
          const payload = await apiGet(`/scenes?datasource=${encodeURIComponent(traceTarget)}`)
          setScenes(payload && payload.ok !== false && Array.isArray(payload.scenes) ? payload.scenes : [])
        } catch {
          setScenes([])
        }
      }, [traceTarget])

      React.useEffect(() => {
        if (tab !== 'trace') return
        void loadScenes()
      }, [tab, loadScenes])

      /** The datasource the Scenes page edits: the pick, else the default. */
      const sceneTarget = React.useMemo(() => {
        if (sceneSource && sources.some((item) => item.id === sceneSource)) return sceneSource
        const fallback = sources.find((item) => item.isDefault === true) || sources[0]
        return fallback ? fallback.id : ''
      }, [sceneSource, sources])

      /** The same listing the trace page reads, but kept for the Scenes page.
       *
       * Each row already carries the joins among its members and the members no
       * join reaches — the server derives both from the relation graph, so this
       * page never has to guess at an edge to draw one. */
      const loadSceneRows = React.useCallback(async () => {
        if (!sceneTarget) {
          setSceneRows([])
          return
        }
        setSceneBusy(true)
        setSceneError(null)
        try {
          const payload = await apiGet(`/scenes?datasource=${encodeURIComponent(sceneTarget)}`)
          const rows = payload && payload.ok !== false && Array.isArray(payload.scenes) ? payload.scenes : []
          setSceneRows(rows)
          /* Re-seed the open draft from what came back, so the ids and the
             derived fields on screen are the stored ones rather than a stale
             copy of the row that was clicked. */
          setScenePicked((current) => {
            if (!current) return ''
            return rows.some((scene) => scene.id === current) ? current : ''
          })
        } catch (error) {
          setSceneRows([])
          setSceneError(String((error && error.message) || error))
        } finally {
          setSceneBusy(false)
        }
      }, [sceneTarget])

      React.useEffect(() => {
        if (tab !== 'scenes') return
        void loadSceneRows()
      }, [tab, loadSceneRows])

      /* The draft follows the picked row. A rename or a table change lives in
         `sceneEdit` until Save, and `sceneDirty` is what tells the reader that
         leaving the row would throw that away. A draft that is still new is left
         alone: it has no row to follow. */
      React.useEffect(() => {
        if (sceneNew) return
        if (!scenePicked) {
          setSceneEdit(null)
          setSceneDirty(false)
          return
        }
        const row = sceneRows.find((scene) => scene.id === scenePicked) || null
        setSceneEdit(row ? { id: row.id, name: row.name || '', note: row.note || '', tables: (row.tables || []).slice() } : null)
        setSceneDirty(false)
        setSceneDeleteAsk(false)
        setSceneAddOpen(false)
        setSceneLinkFor('')
      }, [sceneNew, scenePicked, sceneRows])

      /* The edges of the edited datasource, fetched only when a scene is open and
         an isolated member would otherwise have no explanation. A read of the same
         relation graph the Relations page shows — never a write. */
      const loadSceneGraph = React.useCallback(async () => {
        if (!sceneTarget) {
          setSceneGraph(null)
          return
        }
        try {
          const payload = await apiGet(`/relations?datasource=${encodeURIComponent(sceneTarget)}`)
          if (payload && payload.ok === false) {
            setSceneGraph({ edges: [], counts: null, total: 0 })
            return
          }
          setSceneGraph({
            edges: Array.isArray(payload.edges) ? payload.edges : [],
            counts: payload.counts || null,
            total: payload.total || 0,
          })
        } catch {
          setSceneGraph({ edges: [], counts: null, total: 0 })
        }
      }, [sceneTarget])

      const sceneHasIsolated = Boolean(sceneEdit && sceneEdit.id && sceneRows.find((scene) => scene.id === sceneEdit.id && (scene.isolated || []).length))
      React.useEffect(() => {
        if (tab !== 'scenes' || !sceneHasIsolated) return
        void loadSceneGraph()
      }, [tab, sceneHasIsolated, loadSceneGraph])

      /** The columns of one member table, read once and kept by name. */
      const loadSceneColumns = React.useCallback(
        async (table) => {
          const name = String(table || '').trim()
          if (!name || !sceneTarget) return
          if (sceneColumns[name]) return
          try {
            const payload = await apiGet(
              `/schema?datasource=${encodeURIComponent(sceneTarget)}&table=${encodeURIComponent(name)}`,
            )
            const columns = payload && Array.isArray(payload.columns) ? payload.columns : []
            setSceneColumns((current) => (current[name] ? current : { ...current, [name]: columns }))
          } catch {
            setSceneColumns((current) => (current[name] ? current : { ...current, [name]: [] }))
          }
        },
        [sceneTarget, sceneColumns],
      )

      /** The catalogue of the edited datasource: only table names, read through
       * list_tables. Nothing here can run a statement. */
      const loadSceneCatalog = React.useCallback(async () => {
        if (!sceneTarget) {
          setSceneCatalog(null)
          return
        }
        try {
          const payload = await apiGet(`/schema?datasource=${encodeURIComponent(sceneTarget)}`)
          if (payload && payload.ok === false) {
            setSceneCatalogError((payload.error && payload.error.message) || t('scene.catalogEmpty'))
            setSceneCatalog([])
            return
          }
          setSceneCatalogError(null)
          setSceneCatalog(Array.isArray(payload.tables) ? payload.tables : [])
        } catch (error) {
          setSceneCatalogError(String((error && error.message) || error))
          setSceneCatalog([])
        }
      }, [sceneTarget, t])

      React.useEffect(() => {
        if (tab !== 'scenes' || !sceneAddOpen) return
        void loadSceneCatalog()
      }, [tab, sceneAddOpen, loadSceneCatalog])

      /** Patch the draft on screen; it is only written when Save is pressed. */
      const patchScene = (changes) => {
        setSceneEdit((current) => (current ? { ...current, ...changes } : current))
        setSceneDirty(true)
      }

      const startNewScene = () => {
        setScenePicked('')
        setSceneNew(true)
        setSceneEdit({ id: '', name: '', note: '', tables: [] })
        setSceneDirty(true)
        setSceneError(null)
        setSceneDeleteAsk(false)
        setSceneAddOpen(true)
      }

      /** One write path for create and update: `scene_id` makes it a rename,
       * its absence lets save_scene match the name (and update that scene). */
      const saveSceneDraft = async () => {
        const draft = sceneEdit || {}
        const name = String(draft.name || '').trim()
        if (!name) {
          setSceneError(t('scene.needName'))
          return
        }
        if (!draft.tables || draft.tables.length === 0) {
          setSceneError(t('scene.keepOne'))
          return
        }
        setSceneBusy(true)
        setSceneError(null)
        try {
          const payload = await apiPost('/scenes/save', {
            datasource: sceneTarget,
            scene_id: draft.id || undefined,
            name,
            /* An empty string, not omitted: the store treats a missing note as
               "leave it alone", so a note could never be cleared from here. */
            note: String(draft.note || '').trim(),
            tables: draft.tables,
          })
          if (payload && payload.ok === false) {
            const failure = payload.error || {}
            setSceneError(`${failure.message || 'save_scene failed'}${failure.hint ? ` — ${failure.hint}` : ''}`)
            return
          }
          const saved = (payload && payload.scene) || null
          setNotice({ message: fmt(t('scene.saved'), { name }), isError: false })
          setSceneNew(false)
          await loadSceneRows()
          setSceneDirty(false)
          if (saved && saved.id) setScenePicked(saved.id)
          /* The trace page keeps its own copy of the list. */
          void loadScenes()
        } catch (error) {
          setSceneError(String((error && error.message) || error))
        } finally {
          setSceneBusy(false)
        }
      }

      const deleteSceneDraft = async () => {
        const draft = sceneEdit || {}
        if (!draft.id) return
        setSceneBusy(true)
        setSceneError(null)
        try {
          const payload = await apiPost('/scenes/delete', { datasource: sceneTarget, scene_id: draft.id })
          if (payload && payload.ok === false) {
            const failure = payload.error || {}
            setSceneError(`${failure.message || 'delete_scene failed'}${failure.hint ? ` — ${failure.hint}` : ''}`)
            return
          }
          setNotice({ message: fmt(t('scene.deleted'), { name: draft.name }), isError: false })
          setScenePicked('')
          setSceneNew(false)
          setSceneEdit(null)
          setSceneDeleteAsk(false)
          await loadSceneRows()
          void loadScenes()
        } catch (error) {
          setSceneError(String((error && error.message) || error))
        } finally {
          setSceneBusy(false)
        }
      }

      /** A member is a table name; removing one edits the draft, not the store. */
      const addSceneTable = (table) => {
        const name = String(table || '').trim()
        if (!name) return
        const current = (sceneEdit && sceneEdit.tables) || []
        if (current.some((item) => String(item).toLowerCase() === name.toLowerCase())) return
        patchScene({ tables: current.concat(name) })
      }

      const removeSceneTable = (table) => {
        const wanted = String(table || '').toLowerCase()
        const current = (sceneEdit && sceneEdit.tables) || []
        patchScene({ tables: current.filter((item) => String(item).toLowerCase() !== wanted) })
      }

      /** Go to the Relations page with one join open.
       *
       * The scene page decides which member to connect; the graph is where that
       * decision is written, so every "add a join" ends up here rather than in a
       * second copy of the edge model. */
      const openInGraph = (edgeId, preset) => {
        remember('graphSource', setGraphSource)(sceneTarget)
        remember('graphFilter', setGraphFilter)('all')
        setGraphOpen(edgeId || '')
        setGraphForm(preset || null)
        setGraphCondition('')
        setGraphReason('')
        setView({ mode: 'graph' })
        if (!edgeId || typeof document === 'undefined') return
        /* The row is painted on the next frame, so the scroll waits for it
           instead of guessing a delay that is right on one machine only. */
        const settle = (left) => {
          const host = document.getElementById(`dbmcp-edge-${edgeId}`)
          if (host && typeof host.scrollIntoView === 'function') {
            host.scrollIntoView({ block: 'center', behavior: 'smooth' })
            return
          }
          if (left > 0) setTimeout(() => settle(left - 1), 40)
        }
        settle(12)
      }

      /** The join form, prefilled with the member that has no confirmed edge. The
       * reader still fills the other end — the panel has no way to guess it. */
      const addLinkFor = (table) => openInGraph('', { from_table: String(table || ''), from_column: '', to_table: '', to_column: '' })

      /** A candidate the panel can prove from the catalogue: same column name on
       * another member, a type that can be compared. Clicking one only fills the
       * form — the join is still proposed and still starts out pending. */
      const addJoinFrom = (candidate) =>
        openInGraph('', {
          from_table: String((sceneLinkFor && candidate && candidate.fromTable) || sceneLinkFor || ''),
          from_column: String((candidate && candidate.fromColumn) || ''),
          to_table: String((candidate && candidate.table) || ''),
          to_column: String((candidate && candidate.column) || ''),
        })

      /** Take an outside table into the scene, so the join the reader just saw can
       * be drawn between two members. It is an ordinary save of the membership
       * list — no edge is written, and the join is untouched. */
      const adoptIntoScene = async (table) => {
        const draft = sceneEdit
        const name = String(table || '').trim()
        if (!draft || !name || !draft.id) return
        const tables = (draft.tables || []).slice()
        if (tables.some((item) => String(item).toLowerCase() === name.toLowerCase())) return
        tables.push(name)
        setSceneBusy(true)
        setSceneError(null)
        try {
          const payload = await apiPost('/scenes/save', {
            datasource: sceneTarget,
            scene_id: draft.id,
            name: String(draft.name || '').trim(),
            note: String(draft.note || '').trim(),
            tables,
          })
          if (payload && payload.ok === false) {
            const failure = payload.error || {}
            setSceneError(`${failure.message || 'save_scene failed'}${failure.hint ? ` — ${failure.hint}` : ''}`)
            return
          }
          await loadSceneRows()
          setSceneDirty(false)
          void loadScenes()
        } catch (error) {
          setSceneError(String((error && error.message) || error))
        } finally {
          setSceneBusy(false)
        }
      }

      /** Follow one value; the panel never sends a statement, only a value.
       *
       * `confirmSlow` is the user saying yes to a full table scan the previous
       * run refused to pay for. Nothing else in the panel can set it.
       *
       * `startAt` lets a candidate row in the result start the walk again from
       * that column: the same value, a different entry. It is how the reader
       * moves the start instead of re-typing the table and column by hand. */
      const runTrace = async (confirmSlow, startAt) => {
        const value = String(traceValue || '').trim()
        if (!value) {
          setTraceError(t('trace.needValue'))
          return
        }
        const entryTable = startAt && startAt.table ? startAt.table : traceTable.trim()
        const entryColumn = startAt && startAt.column ? startAt.column : traceColumn.trim()
        setTraceBusy(true)
        setTraceError(null)
        setTraceOpen('')
        setTraceFolded([])
        setTraceFocus(0)
        setTraceZoom(1)
        try {
          const payload = await apiPost('/trace', {
            value,
            datasource: traceTarget,
            entry_table: entryTable || undefined,
            entry_column: entryColumn || undefined,
            direction: traceDirection,
            confirm_slow: confirmSlow === true ? true : undefined,
            scene: traceScene || undefined,
          })
          if (payload && payload.ok === false) {
            const failure = payload.error || {}
            const hint = failure.hint ? ` — ${failure.hint}` : ''
            setTraceError(`${failure.message || payload.message || 'trace_by_key failed'}${hint}`)
            setTrace(null)
            return
          }
          setTrace(payload || null)
        } catch (error) {
          const body = (error && error.payload) || {}
          const failure = body.error || {}
          const hint = failure.hint ? ` — ${failure.hint}` : ''
          setTraceError(`${failure.message || body.message || String((error && error.message) || error)}${hint}`)
          setTrace(null)
        } finally {
          setTraceBusy(false)
        }
      }

      /** Judge one step of the walk; the edge it travelled is the thing judged. */
      const judgeStep = async (edgeId, verdict, reason) => {
        setNotice(null)
        try {
          const payload = await apiPost('/relations/feedback', {
            datasource: traceTarget,
            edge_id: edgeId,
            verdict,
            reason: reason || undefined,
          })
          if (payload && payload.ok === false) {
            const failure = payload.error || {}
            const hint = failure.hint ? ` — ${failure.hint}` : ''
            setNotice({ message: `${failure.message || 'feedback failed'}${hint}`, isError: true })
            return
          }
          setNotice({ message: fmt(t('notice.verdict'), { verdict }), isError: false })
          setTraceOpen('')
          await runTrace()
        } catch (error) {
          const body = (error && error.payload) || {}
          const failure = body.error || {}
          const hint = failure.hint ? ` — ${failure.hint}` : ''
          setNotice({ message: `${failure.message || String((error && error.message) || error)}${hint}`, isError: true })
        }
      }

      /** Drafted value of the long-text policy while the select is open. */
      const [textPolicyDraft, setTextPolicyDraft] = React.useState(undefined)

      /** Save the chosen long-text policy; the server clamps invalid values. */
      const commitTextPolicy = async () => {
        const next = textPolicyDraft !== undefined ? textPolicyDraft : (tools && tools.textPolicy) || 'auto'
        if (next === ((tools && tools.textPolicy) || 'auto')) return
        try {
          await apiPost('/settings', { textPolicy: next })
          setTextPolicyDraft(undefined)
          setNotice({ message: t('render.textSaved'), isError: false })
          await load()
        } catch (error) {
          setTextPolicyDraft(undefined)
          setNotice({ message: String((error && error.message) || error), isError: true })
        }
      }

      /** Save one default row count; the server clamps it to its own cap. */
      const commitLimit = async (limit) => {
        const raw = Number(limitDraft[limit.key])
        if (!Number.isInteger(raw) || raw < limit.min || raw > limit.max) {
          setLimitDraft({ ...limitDraft, [limit.key]: String(limit.value) })
          return
        }
        if (raw === limit.value) return
        const next = { ...((tools && tools.limits) || {}), [limit.key]: raw }
        try {
          await apiPost('/settings', { limits: next })
          setLimitDraft({ ...limitDraft, [limit.key]: undefined })
          setNotice({ message: t('tools.limitSaved'), isError: false })
          await load()
        } catch (error) {
          setLimitDraft({ ...limitDraft, [limit.key]: String(limit.value) })
          setNotice({ message: String((error && error.message) || error), isError: true })
        }
      }

      /** Save one cost threshold; the server clamps it to the same range. */
      const commitCost = async (rule) => {
        const raw = Number(costDraft[rule.key])
        if (!Number.isInteger(raw) || raw < rule.min || raw > rule.max) {
          const fallback = costValues[rule.key]
          setCostDraft({ ...costDraft, [rule.key]: fallback === undefined ? undefined : String(fallback) })
          return
        }
        if (raw === costValues[rule.key]) return
        const next = { ...costValues, [rule.key]: raw }
        try {
          await apiPost('/settings', { cost: next })
          setCostDraft({ ...costDraft, [rule.key]: undefined })
          setNotice({ message: t('cost.saved'), isError: false })
          await load()
        } catch (error) {
          setCostDraft({ ...costDraft, [rule.key]: String(costValues[rule.key]) })
          setNotice({ message: String((error && error.message) || error), isError: true })
        }
      }

      const toggleTool = async (name, on) => {
        const current = (tools && Array.isArray(tools.disabled) ? tools.disabled : []).filter((item) => item !== name)
        const next = on ? current : [...current, name]
        setBusy(true)
        setNotice(null)
        try {
          await apiPost('/settings', { disabledTools: next })
          setNotice({ message: on ? fmt(t('tools.on'), { name }) : fmt(t('tools.off'), { name }), isError: false })
          await load()
        } catch (error) {
          setNotice({ message: String((error && error.message) || error), isError: true })
        } finally {
          setBusy(false)
        }
      }

      /** Declared groups plus any group that a source already carries. */
      const groupNames = (() => {
        const seen = new Set()
        const declared = data && Array.isArray(data.groups) ? data.groups : []
        for (const name of declared) {
          const key = String(name || '').trim()
          if (key) seen.add(key)
        }
        for (const source of sources) {
          const key = String(source.group || '').trim()
          if (key) seen.add(key)
        }
        return [...seen].sort((a, b) => a.localeCompare(b))
      })()

      const reportError = (error) => {
        setNotice({ message: String((error && error.message) || error), isError: true })
      }

      const createGroup = async () => {
        const name = groupDraft.trim()
        if (!name) return
        try {
          await apiPost('/groups/save', { name })
          setGroupDraft('')
          setNotice({ message: t('notice.groupSaved').replace('{name}', name), isError: false })
          load()
        } catch (error) {
          reportError(error)
        }
      }

      const renameGroup = async () => {
        if (!editingGroup) return
        const name = String(editingGroup.name || '').trim()
        if (!name) return
        try {
          await apiPost('/groups/save', { name, from: editingGroup.from })
          setEditingGroup(null)
          setNotice({ message: t('notice.groupSaved').replace('{name}', name), isError: false })
          load()
        } catch (error) {
          reportError(error)
        }
      }

      /** A source keeps its id; double-clicking the name only changes the label. */
      const renameSource = async () => {
        if (!renamingSource) return
        const name = String(renamingSource.name || '').trim()
        const source = sources.find((item) => item.id === renamingSource.id)
        if (!source || !name) {
          setRenamingSource(null)
          return
        }
        try {
          await apiPost('/datasources/save', {
            id: source.id,
            name,
            kind: source.kind,
            readOnly: source.readOnly,
            isDefault: source.isDefault,
            tags: source.tags,
            group: source.group,
            config: source.config,
          })
          setRenamingSource(null)
          setNotice({ message: t('notice.saved').replace('{name}', name), isError: false })
          load()
        } catch (error) {
          reportError(error)
        }
      }

      const removeGroup = async (name) => {
        if (pendingGroupDelete !== name) {
          setPendingGroupDelete(name)
          return
        }
        setPendingGroupDelete(null)
        try {
          await apiPost('/groups/delete', { name })
          setNotice({ message: t('notice.groupDeleted').replace('{name}', name), isError: false })
          load()
        } catch (error) {
          reportError(error)
        }
      }

      /**
       * Drop the tick from rows that were just moved as a block. Dragging a row
       * that was not checked leaves the existing selection alone — the user did
       * not ask to move those.
       */
      const clearMovedSelection = (moved) => {
        const allMoved = moved.length > 0 && moved.every((id) => selected.includes(id))
        if (allMoved) setSelected([])
      }

      /**
       * Move a dragged block into a group.
       *
       * `ids` is usually one row, but grabbing a checked row drags every checked
       * row, so the call takes the whole block and the backend moves them in one
       * write.
       */
      const moveToGroup = async (ids, name) => {
        const list = Array.isArray(ids) ? ids : [ids]
        if (list.length === 0) return
        try {
          await apiPost('/datasources/bulk', { action: 'group', ids: list, group: name })
          const label = name || t('group.unassigned')
          setNotice({
            message:
              list.length > 1
                ? t('notice.movedMany').replace('{n}', String(list.length)).replace('{group}', label)
                : t('notice.moved').replace('{group}', label),
            isError: false,
          })
          clearMovedSelection(list)
          load()
        } catch (error) {
          reportError(error)
        }
      }

      /**
       * Dropping a block onto a row: adopt that row's group, then sit above or
       * below it. A multi-row drag stays in one piece and keeps its own order.
       */
      const dropOnRow = async (movedIds, target, after = false) => {
        const moving = (Array.isArray(movedIds) ? movedIds : [movedIds]).filter((id) => id && id !== target.id)
        if (moving.length === 0) return
        try {
          const group = String(target.group || '').trim()
          const leaving = moving.some((id) => {
            const row = sources.find((item) => item.id === id)
            return row && String(row.group || '').trim() !== group
          })
          if (leaving) {
            await apiPost('/datasources/bulk', { action: 'group', ids: moving, group })
          }
          const ids = reorderForDrop(sources.map((item) => item.id), moving, target.id, after)
          await apiPost('/datasources/reorder', { ids })
          setDragIds([])
          clearMovedSelection(moving)
          load()
        } catch (error) {
          reportError(error)
        }
      }

      const toggleGroup = (items) => {
        const ids = items.map((item) => item.id)
        const allChecked = ids.length > 0 && ids.every((id) => selected.includes(id))
        setPendingBulkDelete(false)
        setSelected((prev) => (allChecked ? prev.filter((id) => !ids.includes(id)) : [...new Set([...prev, ...ids])]))
      }

      /** Everything the strip and the list need to know about health. */
      const failedSources = sources.filter(probeFailed)

      const visibleSources = sources.filter((source) => {
        if (filter === 'failed' && !probeFailed(source)) return false
        if (filter.indexOf('group:') === 0 && String(source.group || '').trim() !== filter.slice(6)) return false
        return sourceMatches(source, query)
      })

      /* "All of them" means all of what is on screen: with a search or a chip
         narrowing the list, selecting everything would touch rows the reader
         cannot see. The button therefore takes the visible set as the selection
         and gives it back when the whole of it is already checked, so what is
         selected is always what was pointed at. With nothing narrowed that is
         every source there is. */
      const visibleIds = visibleSources.map((source) => source.id)
      const allVisible = visibleIds.length > 0 && visibleIds.every((id) => selected.includes(id))

      const toggleVisible = () => {
        setPendingBulkDelete(false)
        setSelected(allVisible ? [] : visibleIds.slice())
      }

      const renderItem = (source) => {
        const probeInfo = source.lastProbe
        const failed = probeFailed(source)
        const checked = selected.includes(source.id)
        const dragging = dragIds.includes(source.id)
        const badge = kindBadge(source.kind)
        return h(
          'li',
          {
            className:
              'dbmcp-item' +
              (checked ? ' is-selected' : '') +
              (dragging ? ' is-dragging' : '') +
              (dropMark && dropMark.id === source.id ? (dropMark.after ? ' is-drop-after' : ' is-drop-before') : '') +
              (failed ? ' is-failed' : ''),
            key: source.id,
            onDragOver: (event) => {
              if (dragIds.length === 0 || dragging) return
              event.preventDefault()
              event.stopPropagation()
              /* Landing below the middle of a row means "after this one". */
              const rect = event.currentTarget.getBoundingClientRect()
              const after = event.clientY > rect.top + rect.height / 2
              if (!dropMark || dropMark.id !== source.id || dropMark.after !== after) {
                setDropMark({ id: source.id, after })
              }
            },
            onDragLeave: () => setDropMark((prev) => (prev && prev.id === source.id ? null : prev)),
            onDrop: (event) => {
              event.preventDefault()
              event.stopPropagation()
              const after = Boolean(dropMark && dropMark.id === source.id && dropMark.after)
              setDropMark(null)
              if (dragIds.length === 0 || dragging) return
              void dropOnRow(dragIds, source, after)
            },
          },
          h(
            'div',
            { className: 'dbmcp-item-row' },
            h(
              'span',
              {
                className: 'dbmcp-grip',
                title: t('group.dragHint'),
                draggable: true,
                onDragStart: (event) => {
                  /* Grabbing a checked row drags the whole checked block, so the
                     selection is the drag: one row, or all of them. */
                  const batch = checked ? selected.slice() : [source.id]
                  setDragIds(batch)
                  try {
                    event.dataTransfer.setData('text/plain', source.id)
                    event.dataTransfer.setData('application/x-dbmcp-rows', JSON.stringify(batch))
                    event.dataTransfer.effectAllowed = 'move'
                    const row = event.currentTarget.closest('.dbmcp-item')
                    if (row) event.dataTransfer.setDragImage(row, 16, 16)
                  } catch (error) {
                    /* some shells hand out a read-only dataTransfer; dragIds still carries the block */
                  }
                },
                onDragEnd: () => setDragIds([]),
              },
              h('span', { className: 'dbmcp-grip-dots', 'aria-hidden': 'true' }),
            ),
            h(
              'label',
              { className: 'dbmcp-item-pick', title: source.name || source.id },
              h('input', {
                type: 'checkbox',
                checked,
                onChange: () => toggleSelected(source.id),
                'aria-label': source.name || source.id,
              }),
            ),
            h(
              'span',
              {
                className: 'dbmcp-kind-badge',
                style: {
                  color: badge.color,
                  background: `color-mix(in srgb, ${badge.color} 12%, transparent)`,
                  borderColor: `color-mix(in srgb, ${badge.color} 26%, transparent)`,
                },
                title: source.kind,
              },
              badge.label,
            ),
            h(
              'div',
              { className: 'dbmcp-item-main' },
              renamingSource && renamingSource.id === source.id
                ? h(
                    'form',
                    {
                      className: 'dbmcp-item-rename',
                      onClick: (event) => event.stopPropagation(),
                      onSubmit: (event) => {
                        event.preventDefault()
                        void renameSource()
                      },
                    },
                    h(TextInput, {
                      value: renamingSource.name,
                      onChange: (value) => setRenamingSource({ id: source.id, name: value }),
                      autoFocus: true,
                      onKeyDown: (event) => {
                        if (event.key === 'Escape') setRenamingSource(null)
                      },
                    }),
                    h('button', { type: 'submit', className: 'dbmcp-btn is-small is-primary' }, t('group.save')),
                    h(
                      'button',
                      { type: 'button', className: 'dbmcp-btn is-small', onClick: () => setRenamingSource(null) },
                      t('group.cancel'),
                    ),
                  )
                : h(
                    'div',
                    { className: 'dbmcp-item-name' },
                    h(
                      'span',
                      {
                        className: 'is-renamable',
                        title: t('group.renameHint'),
                        onDoubleClick: (event) => {
                          event.stopPropagation()
                          setRenamingSource({ id: source.id, name: source.name || source.id })
                        },
                      },
                      source.name || source.id,
                    ),
                    /* The engine already shows as the kind badge to the left of
                       the row, so the name line no longer repeats it. */
                    h(Switch, {
                      checked: source.readOnly === false,
                      label: source.readOnly === false ? t('sources.readwrite') : t('sources.readonly'),
                      title: source.readOnly === false ? t('action.lockSource') : t('action.unlockSource'),
                      disabled: busy,
                      onChange: () => {
                        void toggleReadOnly(source)
                      },
                    }),
                    // DDL is its own switch, right beside the writable one. It
                    // only means anything while the source is writable, so hide
                    // it entirely until the writable switch is turned on.
                    source.readOnly === false
                      ? h(Switch, {
                          checked: source.allowDdl === true,
                          label: t('sources.ddl'),
                          title: source.allowDdl === true ? t('sources.ddlHint') : t('sources.ddlBlockedHint'),
                          disabled: busy,
                          onChange: () => {
                            void toggleDdl(source)
                          },
                        })
                      : null,
                    source.secretBroken === true
                      ? h('span', { className: 'dbmcp-note is-broken' }, t('sources.secretBroken'))
                      : null,
                  ),
              h(
                'div',
                { className: 'dbmcp-item-meta' },
                source.target ? h('span', { className: 'dbmcp-item-target' }, source.target) : null,
                h(IdChip, { t, id: source.id, copied: copiedChip === source.id, onCopy: copyId }),
              ),
              failed
                ? null
                : h(
                    'div',
                    { className: 'dbmcp-probe ' + (probeInfo ? (probeInfo.ok ? 'is-ok' : 'is-error') : '') },
                    probeInfo ? '● ' + probeInfo.message : t('sources.neverProbed'),
                  ),
            ),
            h(
              'div',
              { className: 'dbmcp-item-actions', onClick: (event) => event.stopPropagation() },
              h(
                'button',
                { type: 'button', className: 'dbmcp-btn is-small is-plain', disabled: probing === source.id, onClick: () => probe(source) },
                probing === source.id ? t('action.testing') : t('action.test'),
              ),
              h('button', { type: 'button', className: 'dbmcp-btn is-small is-plain', onClick: () => setView({ mode: 'schema', source }) }, t('action.schema')),
              h('button', { type: 'button', className: 'dbmcp-btn is-small is-plain', onClick: () => setView({ mode: 'edit', source }) }, t('action.edit')),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dbmcp-btn is-small is-plain is-danger',
                  onClick: () => remove(source),
                  onBlur: () => setPendingDelete((prev) => (prev === source.id ? null : prev)),
                },
                pendingDelete === source.id ? t('action.deleteConfirm') : t('action.delete'),
              ),
            ),
          ),
          failed
            ? h(
                'div',
                { className: 'dbmcp-item-failure' },
                h('span', { className: 'dbmcp-fail-tri', 'aria-hidden': 'true' }, '⚠'),
                h(
                  'span',
                  { className: 'dbmcp-fail-text' },
                  fmt(t('sources.failedLine'), { message: (probeInfo && probeInfo.message) || t('state.failed') }),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dbmcp-btn is-small is-plain',
                    title: t('action.copyErrorHint'),
                    onClick: (event) => {
                      event.stopPropagation()
                      void copyProbe(source)
                    },
                  },
                  copiedId === source.id ? t('action.copied') : t('action.copyError'),
                ),
              )
            : null,
        )
      }

      /** One group: a chevron, a select-all box and rename/delete, plus a drop zone. */
      const renderGroup = (name, items) => {
        const allChecked = items.length > 0 && items.every((item) => selected.includes(item.id))
        const renaming = editingGroup !== null && editingGroup.from === name
        const dropTarget = name
        const folded = collapsed.includes(name)
        return h(
          'section',
          {
            className: 'dbmcp-group' + (dragOverGroup === dropTarget ? ' is-over' : ''),
            key: name || '__none',
            onDragOver: (event) => {
              event.preventDefault()
              if (dragOverGroup !== dropTarget) setDragOverGroup(dropTarget)
            },
            onDragLeave: () => setDragOverGroup((prev) => (prev === dropTarget ? null : prev)),
            onDrop: (event) => {
              event.preventDefault()
              setDragOverGroup(null)
              let ids = dragIds
              try {
                const packed = event.dataTransfer.getData('application/x-dbmcp-rows')
                if (packed) ids = JSON.parse(packed)
              } catch (error) {
                /* fall back to the block remembered on dragstart */
              }
              setDragIds([])
              if (Array.isArray(ids) && ids.length > 0) void moveToGroup(ids, name)
            },
          },
          h(
            'header',
            { className: 'dbmcp-group-head' },
            h('input', {
              type: 'checkbox',
              className: 'dbmcp-group-pick',
              checked: allChecked,
              onChange: () => toggleGroup(items),
              title: t('group.selectAll'),
              'aria-label': t('group.selectAll'),
            }),
            h('button', {
              type: 'button',
              className: 'dbmcp-fold' + (folded ? '' : ' is-open'),
              'aria-expanded': !folded,
              'aria-label': name || t('group.unassigned'),
              title: folded ? t('group.expand') : t('group.collapse'),
              onClick: () => toggleFolded(name),
            }),
            renaming
              ? h(
                  'form',
                  {
                    className: 'dbmcp-group-edit',
                    onSubmit: (event) => {
                      event.preventDefault()
                      void renameGroup()
                    },
                  },
                  h(TextInput, {
                    value: editingGroup.name,
                    onChange: (value) => setEditingGroup({ from: name, name: value }),
                    autoFocus: true,
                    onKeyDown: (event) => {
                      if (event.key === 'Escape') setEditingGroup(null)
                    },
                  }),
                  h('button', { type: 'submit', className: 'dbmcp-btn is-small is-primary' }, t('group.save')),
                  h('button', { type: 'button', className: 'dbmcp-btn is-small', onClick: () => setEditingGroup(null) }, t('group.cancel')),
                )
              : h(
                  'span',
                  {
                    className: 'dbmcp-group-name' + (name ? ' is-renamable' : ''),
                    title: name ? t('group.renameHint') : undefined,
                    onDoubleClick: () => {
                      if (name) setEditingGroup({ from: name, name })
                    },
                  },
                  name || t('group.unassigned'),
                ),
            h('span', { className: 'dbmcp-hint' }, t('group.count').replace('{n}', String(items.length))),
            name === '' || renaming
              ? null
              : h(
                  'span',
                  { className: 'dbmcp-group-actions' },
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dbmcp-btn is-small is-plain is-danger',
                      onClick: () => void removeGroup(name),
                      onBlur: () => setPendingGroupDelete((prev) => (prev === name ? null : prev)),
                    },
                    pendingGroupDelete === name ? t('group.deleteConfirm') : t('group.delete'),
                  ),
                ),
          ),
          folded || items.length === 0
            ? folded
              ? null
              : h('div', { className: 'dbmcp-hint dbmcp-group-empty' }, t('group.empty'))
            : h('ul', { className: 'dbmcp-list' + (dragIds.length > 1 ? ' is-dragging-block' : '') }, items.map(renderItem)),
        )
      }

      const renderGroupCreate = () =>
        h(
          'form',
          {
            className: 'dbmcp-group-create',
            onSubmit: (event) => {
              event.preventDefault()
              void createGroup()
            },
          },
          h(TextInput, {
            value: groupDraft,
            onChange: setGroupDraft,
            placeholder: t('group.newPlaceholder'),
            title: t('group.new'),
          }),
          h('button', { type: 'submit', className: 'dbmcp-btn is-small', disabled: !groupDraft.trim() }, t('group.add')),
        )

      const renderList = () => {
        if (sources.length === 0 && groupNames.length === 0) {
          return h(
            'div',
            { className: 'dbmcp-empty' },
            h('strong', null, t('sources.empty.title')),
            h('p', null, t('sources.empty.body')),
          )
        }
        if (visibleSources.length === 0) {
          return h('div', { className: 'dbmcp-empty' }, h('strong', null, t('sources.noMatch')))
        }
        const buckets = new Map()
        for (const name of groupNames) buckets.set(name, [])
        for (const source of visibleSources) {
          const key = String(source.group || '').trim()
          if (!buckets.has(key)) buckets.set(key, [])
          buckets.get(key).push(source)
        }
        /* An empty group still earns its section: it is the drop target for "put this here". */
        const narrowing = filter !== 'all' || query.trim() !== ''
        const order = sectionOrder(groupNames, visibleSources, narrowing)
        const loose = buckets.get('') || []
        /* A single unnamed bucket with rows in it needs no heading. */
        if (order.length === 1 && !order[0] && loose.length > 0) {
          return h('ul', { className: 'dbmcp-list' + (dragIds.length > 1 ? ' is-dragging-block' : '') }, loose.map(renderItem))
        }
        return h(
          'div',
          { className: 'dbmcp-groups' },
          order.map((name) => renderGroup(name, buckets.get(name) || [])),
        )
      }

      const renderBulk = () => {
        if (selected.length === 0) return null
        const count = selected.length
        return h(
          'div',
          { className: 'dbmcp-bulk' },
          h('span', { className: 'dbmcp-bulk-count' }, t('bulk.selected').replace('{n}', String(count))),
          h('button', { type: 'button', className: 'dbmcp-btn is-small', disabled: busy, onClick: () => runBulk('test') }, t('bulk.test')),
          h(
            'button',
            { type: 'button', className: 'dbmcp-btn is-small', disabled: busy, onClick: () => runBulk('readOnly', { readOnly: true }) },
            t('bulk.readonly'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dbmcp-btn is-small',
              disabled: busy,
              onClick: () => void runBulk('readOnly', { readOnly: false }),
            },
            t('bulk.readwrite'),
          ),
          h(
            'div',
            { className: 'dbmcp-bulk-group' },
            h(TextInput, {
              value: bulkGroup,
              onChange: setBulkGroup,
              placeholder: t('bulk.groupPlaceholder'),
              title: t('bulk.group'),
            }),
            h(
              'button',
              { type: 'button', className: 'dbmcp-btn is-small', disabled: busy, onClick: () => runBulk('group', { group: bulkGroup }) },
              t('bulk.apply'),
            ),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dbmcp-btn is-small is-danger',
              disabled: busy,
              onClick: () => bulkDelete(),
              onBlur: () => setPendingBulkDelete(false),
            },
            pendingBulkDelete ? t('bulk.deleteConfirm').replace('{n}', String(count)) : t('bulk.delete'),
          ),
          h(
            'button',
            { type: 'button', className: 'dbmcp-btn is-small', onClick: () => setSelected([]) },
            t('bulk.clear'),
          ),
        )
      }

      const renderStatus = () =>
        h(StatusStrip, {
          t,
          data,
          sources,
          failedSources,
          groupNames,
          filter,
          /* The search box and the chip are part of the position the panel
             returns to, so they are written through. */
          setFilter: remember('filter', setFilter),
          query,
          setQuery: remember('query', setQuery),
        })

      /** `stdio` stays lowercase (it is an abbreviation of standard I/O); HTTP is an acronym. */
      const transportLabel = (transport) =>
        transport === 'stdio' ? 'stdio' : String(transport || '').toUpperCase()

      /** One row per outside client: detected, configured, stdio or HTTP in one click. */
      const renderClientRow = (client) =>
        h(
          'div',
          { className: 'dbmcp-client', key: client.id },
          h(
            'div',
            { className: 'dbmcp-client-main' },
            h('span', { className: 'dbmcp-client-name' }, client.label),
            h('span', { className: 'dbmcp-hint dbmcp-mono' }, client.file || ''),
          ),
          client.configured
            ? h('span', { className: 'dbmcp-pill is-open' }, `${t('clients.configured')}${client.transport ? ` · ${transportLabel(client.transport)}` : ''}`)
            : h('span', { className: 'dbmcp-hint' }, client.exists ? t('clients.notConfigured') : t('clients.noFile')),
          h(
            'div',
            { className: 'dbmcp-client-actions' },
            h(
              'button',
              {
                type: 'button',
                className: 'dbmcp-btn is-small',
                disabled: clientBusy === `${client.id}:stdio`,
                onClick: () => configureClient(client, 'stdio'),
              },
              clientBusy === `${client.id}:stdio` ? t('clients.working') : t('clients.writeStdio'),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'dbmcp-btn is-small',
                disabled: clientBusy === `${client.id}:http`,
                onClick: () => configureClient(client, 'http'),
              },
              clientBusy === `${client.id}:http` ? t('clients.working') : t('clients.writeHttp'),
            ),
          ),
        )

      /** The HTTP card: the URL to paste, the port, and who is already wired up. */
      const renderClients = () =>
        h(
          Card,
          {
            title: t('clients.title'),
            aside: h(
              'span',
              { className: http && http.running ? 'dbmcp-pill is-open' : 'dbmcp-pill' },
              http && http.running ? t('clients.running') : t('clients.stopped'),
            ),
          },
          h('p', { className: 'dbmcp-hint' }, t('clients.hint')),
          h(
            'div',
            { className: 'dbmcp-endpoint' },
            h('code', { className: 'dbmcp-endpoint-url' }, (http && http.url) || (clients && clients.url) || '—'),
            h(
              'div',
              { className: 'dbmcp-endpoint-actions' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'dbmcp-btn is-small',
                  onClick: () => copyEndpoint((http && http.url) || (clients && clients.url) || ''),
                },
                copiedEndpoint ? t('clients.copied') : t('clients.copy'),
              ),
              h(
                'label',
                { className: 'dbmcp-port-label' },
                h('span', null, t('clients.port')),
                h('input', {
                  className: 'dbmcp-input dbmcp-port',
                  inputMode: 'numeric',
                  placeholder: String((settings && settings.httpPort) || 8765),
                  value: portDraft,
                  onChange: (event) => setPortDraft(event.target.value),
                }),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dbmcp-btn is-small',
                  disabled: busy,
                  onClick: () => controlHttp(http && http.running ? 'stop' : 'start'),
                },
                http && http.running ? t('clients.stop') : t('clients.start'),
              ),
            ),
          ),
          http && http.error ? h('p', { className: 'dbmcp-hint is-error' }, http.error) : null,
          h(
            'div',
            { className: 'dbmcp-clients' },
            (clients && clients.clients ? clients.clients : []).map(renderClientRow),
          ),
          h('p', { className: 'dbmcp-hint' }, t('clients.stdioNote')),
        )

      /** Which tools the agent can see at all; the Python server still serves all of them. */
      const renderTools = () =>
        h(
          Card,
          {
            title: t('tools.title'),
            aside: h(
              'span',
              { className: 'dbmcp-pill' },
              `${tools && tools.tools ? tools.tools.filter((tool) => tool.enabled !== false).length : 0} / ${tools && tools.tools ? tools.tools.length : 0}`,
            ),
          },
          h('p', { className: 'dbmcp-hint' }, t('tools.hint')),
          h('p', { className: 'dbmcp-hint is-scope' }, t('tools.dshOnly')),
          h(
            'div',
            { className: 'dbmcp-tools' },
            (tools && tools.tools ? tools.tools : []).map((tool) =>
              h(
                'div',
                {
                  key: tool.name,
                  className: tool.enabled ? 'dbmcp-tool' : 'dbmcp-tool is-off',
                  title: tool.description || tool.name,
                  /* The whole row flips, the way the old label did. The switch
                     stops its own click, so a click either lands on exactly one
                     control or on the row. */
                  onClick: () => {
                    if (!busy) void toggleTool(tool.name, tool.enabled === false)
                  },
                },
                h(Switch, {
                  checked: tool.enabled !== false,
                  title: tool.enabled !== false ? t('tools.disable') : t('tools.enable'),
                  disabled: busy,
                  onChange: (next) => toggleTool(tool.name, next),
                }),
                h(
                  'div',
                  { className: 'dbmcp-tool-main' },
                  h('code', { className: 'dbmcp-tool-name' }, tool.full || tool.name),
                  h('span', { className: 'dbmcp-tool-desc' }, firstLine(tool.description)),
                ),
              ),
            ),
          ),
          tools && tools.disabled && tools.disabled.length
            ? h('p', { className: 'dbmcp-hint' }, fmt(t('tools.offCount'), { n: tools.disabled.length }))
            : null,
        )

      /* The row counts and the long-text policy are not per-tool decisions, but
         they used to hang off the two rows that carry them — one lone select
         under a list of eight switches, and a number box parked far away from
         the name it belonged to. They now share one card of their own, one
         setting per line so each can say what it does. */
      const limitRules = (() => {
        const seen = new Map()
        for (const tool of tools && tools.tools ? tools.tools : []) {
          if (tool.limit && !seen.has(tool.limit.key)) seen.set(tool.limit.key, tool.limit)
        }
        return [...seen.values()]
      })()

      const limitName = (rule) =>
        rule.key === 'sampleRows'
          ? t('render.sampleRows')
          : rule.key === 'maxRows'
            ? t('render.maxRows')
            : rule.argument

      const limitHint = (rule) =>
        rule.key === 'sampleRows'
          ? fmt(t('render.sampleRowsHint'), { max: rule.max })
          : rule.key === 'maxRows'
            ? fmt(t('render.maxRowsHint'), { max: rule.max })
            : fmt(t('tools.limitHint'), { max: rule.max })

      const renderResults = () =>
        h(
          Card,
          { title: t('render.title') },
          h(
            'div',
            { className: 'dbmcp-render-fields' },
            limitRules.map((rule) =>
              h(
                'div',
                { key: rule.key, className: 'dbmcp-render-field' },
                h(
                  'label',
                  { className: 'dbmcp-render-head' },
                  h('span', { className: 'dbmcp-render-label' }, limitName(rule)),
                  h(
                    'span',
                    { className: 'dbmcp-render-input' },
                    h('input', {
                      type: 'number',
                      className: 'dbmcp-input dbmcp-limit',
                      min: rule.min,
                      max: rule.max,
                      step: 1,
                      value: limitDraft[rule.key] !== undefined ? limitDraft[rule.key] : rule.value,
                      'aria-label': fmt(t('tools.limitLabel'), { argument: rule.argument }),
                      disabled: busy,
                      onClick: (event) => event.stopPropagation(),
                      onChange: (event) => setLimitDraft({ ...limitDraft, [rule.key]: event.target.value }),
                      onBlur: () => commitLimit(rule),
                      onKeyDown: (event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          event.currentTarget.blur()
                        }
                      },
                    }),
                    h('span', { className: 'dbmcp-limit-unit' }, t('tools.rows')),
                  ),
                ),
                h('p', { className: 'dbmcp-render-hint' }, limitHint(rule)),
              ),
            ),
            h(
              'div',
              { className: 'dbmcp-render-field' },
              h(
                'label',
                { className: 'dbmcp-render-head' },
                h('span', { className: 'dbmcp-render-label' }, t('render.text')),
                h(
                  'select',
                  {
                    className: 'dbmcp-input dbmcp-textpolicy-select',
                    value: textPolicyDraft !== undefined ? textPolicyDraft : (tools && tools.textPolicy) || 'auto',
                    disabled: busy,
                    onClick: (event) => event.stopPropagation(),
                    onChange: (event) => setTextPolicyDraft(event.target.value),
                    onBlur: () => commitTextPolicy(),
                  },
                  h('option', { value: 'auto' }, t('render.textFragment')),
                  h('option', { value: 'full' }, t('render.textFull')),
                ),
              ),
              h('p', { className: 'dbmcp-render-hint' }, t('render.textHint')),
            ),
          ),
        )

      /* The cost thresholds answer one question the graph cannot: is walking this
         edge cheap? They set what counts as slow, how many measurements are kept,
         how many are needed before an edge is trusted, and how large a table has
         to be before an unindexed column means a full scan worth asking about. */
      const renderCost = () =>
        h(
          Card,
          { title: t('cost.title') },
          h('p', { className: 'dbmcp-hint' }, t('cost.hint')),
          h(
            'div',
            { className: 'dbmcp-render-fields' },
            COST_RULES.map((rule) =>
              h(
                'div',
                { key: rule.key, className: 'dbmcp-render-field' },
                h(
                  'label',
                  { className: 'dbmcp-render-head' },
                  h('span', { className: 'dbmcp-render-label' }, costName(rule)),
                  h(
                    'span',
                    { className: 'dbmcp-render-input' },
                    h('input', {
                      type: 'number',
                      className: 'dbmcp-input dbmcp-limit',
                      min: rule.min,
                      max: rule.max,
                      step: 1,
                      value: costDraft[rule.key] !== undefined ? costDraft[rule.key] : costValues[rule.key],
                      'aria-label': costName(rule),
                      disabled: busy,
                      onClick: (event) => event.stopPropagation(),
                      onChange: (event) => setCostDraft({ ...costDraft, [rule.key]: event.target.value }),
                      onBlur: () => commitCost(rule),
                      onKeyDown: (event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          event.currentTarget.blur()
                        }
                      },
                    }),
                    h('span', { className: 'dbmcp-limit-unit' }, costUnit(rule)),
                  ),
                ),
                h('p', { className: 'dbmcp-render-hint' }, costHint(rule)),
              ),
            ),
          ),
        )

      /* A conversation limit has no other screen: it is set by the agent through
         MCP, so the panel is the only place it can be read or removed. It lives
         on the Sources page next to the global write switch — both answer "who
         may touch which data". The table starts expanded rather than behind a
         click: whoever opens this page is here to check or lift a limit, and a
         collapsed card just makes them hunt for it. An empty list still shows
         the card, with one line saying nothing is limited. */
      const renderScopes = () => {
        const list = (scopes && scopes.sessions) || []
        const parked = (scopes && scopes.archived) || []
        const rules = list.reduce((sum, entry) => sum + ((entry.ids || []).length), 0)
        const empty = list.length === 0 && parked.length === 0
        const sources = (entry) =>
          (entry.ids || []).length === 0
            ? h('span', { className: 'dbmcp-scope-none' }, t('scopes.allSources'))
            : h(
                'div',
                { className: 'dbmcp-scope-sources' },
                (entry.ids || []).map((id) =>
                  h('span', { className: 'dbmcp-scope-chip', key: id, title: id }, id),
                ),
              )
        const row = (entry, isParked) =>
          h(
            'tr',
            {
              className: isParked ? 'dbmcp-scope-row is-parked' : 'dbmcp-scope-row',
              key: `${isParked ? 'a' : 'l'}:${entry.session}`,
            },
            /* The full id is what the user can match against their own records,
               so it wraps in its own column rather than being shortened. */
            h(
              'td',
              { className: 'dbmcp-scope-cell' },
              h('code', { className: 'dbmcp-scope-id', title: entry.session }, entry.session || '—'),
            ),
            h(
              'td',
              { className: 'dbmcp-scope-cell' },
              entry.title
                ? h('span', { className: 'dbmcp-scope-title', title: entry.title }, entry.title)
                : h('span', { className: 'dbmcp-scope-none' }, t('scopes.noTitle')),
            ),
            h('td', { className: 'dbmcp-scope-cell' }, sources(entry)),
            h(
              'td',
              { className: 'dbmcp-scope-cell is-action' },
              isParked
                ? h('span', { className: 'dbmcp-scope-tag' }, t('scopes.parked'))
                : h(
                    'button',
                    {
                      type: 'button',
                      className: 'dbmcp-scope-remove',
                      title: t('scopes.remove'),
                      'aria-label': t('scopes.remove'),
                      disabled: busy,
                      onClick: () => void removeScope(entry.session),
                    },
                    '×',
                  ),
            ),
          )
        const header = h(
          'tr',
          null,
          h('th', { className: 'dbmcp-scope-th is-id', scope: 'col' }, t('scopes.columnId')),
          h('th', { className: 'dbmcp-scope-th is-title', scope: 'col' }, t('scopes.columnTitle')),
          h('th', { className: 'dbmcp-scope-th is-sources', scope: 'col' }, t('scopes.columnSources')),
          h('th', { className: 'dbmcp-scope-th is-action', scope: 'col' }, ''),
        )
        return h(
          Card,
          {
            title: t('scopes.title'),
            aside: empty ? null : String(list.length),
            actions: empty
              ? null
              : h(
                  'div',
                  { className: 'dbmcp-inline' },
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dbmcp-btn is-small',
                      disabled: busy,
                      onClick: () => setScopesOpen(!scopesOpen),
                    },
                    scopesOpen ? t('scopes.hide') : t('scopes.show'),
                  ),
                  h(
                    'button',
                    { type: 'button', className: 'dbmcp-btn is-small', disabled: busy, onClick: clearScopes },
                    t('scopes.clear'),
                  ),
                ),
          },
          h(
            'p',
            { className: 'dbmcp-hint' },
            empty ? t('scopes.empty') : fmt(t('scopes.summary'), { n: list.length, rules }),
          ),
          empty || !scopesOpen
            ? null
            : h(
                'div',
                { className: 'dbmcp-scope-box' },
                h(
                  'table',
                  { className: 'dbmcp-scope-table' },
                  h('colgroup', null,
                    h('col', { style: { width: '40%' } }),
                    h('col', { style: { width: '28%' } }),
                    h('col', { style: { width: '26%' } }),
                    h('col', { style: { width: '48px' } }),
                  ),
                  h('thead', null, header),
                  h(
                    'tbody',
                    null,
                    list.map((entry) => row(entry, false)),
                    parked.length === 0
                      ? null
                      : h(
                          'tr',
                          { className: 'dbmcp-scope-note' },
                          h(
                            'td',
                            { className: 'dbmcp-scope-cell', colSpan: 4 },
                            fmt(t('scopes.parkedHint'), { n: parked.length }),
                          ),
                        ),
                    parked.map((entry) => row(entry, true)),
                  ),
                ),
              ),
        )
      }

      /* Page A — the relation graph.
         An edge reads as a join path, not as a row of foreign-key metadata: the
         left side is where the value lives, the right side is what it points
         at. The status chip is the only thing that decides which buttons the
         row offers, because a pending edge and a trusted edge are not the same
         kind of claim. */
      const edgeStatusClass = (status) => `dbmcp-pill dbmcp-edge-chip is-${status || 'pending'}`

      const edgeStatusLabel = (status) =>
        status === 'confirmed'
          ? t('graph.statusConfirmed')
          : status === 'trusted'
            ? t('graph.statusTrusted')
            : status === 'rejected'
              ? t('graph.statusRejected')
              : status === 'stale'
                ? t('graph.statusStale')
                : t('graph.statusPending')

      const edgeSourceLabel = (source) =>
        source === 'fk'
          ? t('graph.sourceFk')
          : source === 'inferred'
            ? t('graph.sourceInferred')
            : source === 'audit_mined'
              ? t('graph.sourceMined')
              : t('graph.sourceManual')

      const edgeFanout = (edge) => {
        const value = edge.stats && edge.stats.avgFanout
        return typeof value === 'number' ? value.toFixed(1) : '—'
      }

      /** What searching this edge's target column costs, as far as we know. */
      const edgeCost = (edge) => (edge && edge.cost) || {}

      const edgeIndexLabel = (cost) =>
        cost.indexed === true ? t('graph.indexYes') : cost.indexed === false ? t('graph.indexNo') : t('graph.indexUnknown')

      const edgeMeta = (edge) => {
        const parts = [edgeSourceLabel(edge.source)]
        const confirmed = (edge.stats && edge.stats.confirmCount) || 0
        if (confirmed) parts.push(fmt(t('graph.confirmedTimes'), { n: confirmed }))
        const rejected = (edge.stats && edge.stats.rejectCount) || 0
        if (rejected) parts.push(fmt(t('graph.rejectedTimes'), { n: rejected }))
        parts.push(fmt(t('graph.fanout'), { value: edgeFanout(edge) }))
        const cost = edgeCost(edge)
        parts.push(edgeIndexLabel(cost))
        if (typeof cost.rowEstimate === 'number') parts.push(fmt(t('graph.rows'), { n: cost.rowEstimate }))
        if (typeof cost.avgMs === 'number') parts.push(fmt(t('graph.avgMs'), { ms: cost.avgMs }))
        return parts.join(' · ')
      }

      /** The line under the join path: why it stopped being trusted, if it did. */
      const edgeReason = (edge) => {
        const failure = edge.stats && edge.stats.lastFailure
        if (!failure) return null
        const verdict = failure.verdict === 'too_many' ? t('graph.verdictTooMany') : failure.verdict === 'missing' ? t('graph.verdictMissing') : failure.verdict
        const reason = failure.reason
          ? failure.reason === 'wrong_column'
            ? t('graph.reasonWrongColumn')
            : failure.reason === 'needs_condition'
              ? t('graph.reasonNeedsCondition')
              : failure.reason === 'not_unique'
                ? t('graph.reasonNotUnique')
                : failure.reason
          : ''
        const when = failure.at ? ` ${fmt(t('graph.when'), { at: localClock(failure.at) })}` : ''
        return h(
          'p',
          { className: 'dbmcp-hint dbmcp-edge-why' },
          reason ? fmt(t('graph.failedBecause'), { verdict, reason }) : verdict,
          when,
        )
      }

      /** The confirmation record: who moved this edge and when. */
      const edgeHistory = (edge) => {
        const history = (edge.history || []).slice(-6).reverse()
        if (history.length === 0) return h('p', { className: 'dbmcp-hint' }, t('graph.noHistory'))
        return h(
          'ul',
          { className: 'dbmcp-edge-history' },
          history.map((entry, index) =>
            h(
              'li',
              { key: `${entry.at}:${index}` },
              h('code', null, localClock(entry.at)),
              ' ',
              h('span', null, entry.action || '—'),
              entry.note ? h('span', { className: 'dbmcp-hint' }, ` — ${entry.note}`) : null,
            ),
          ),
        )
      }

      /** Inline editor for the free-form SQL predicate an edge may carry. */
      const edgeConditionEditor = (edge) => {
        const open = graphCondition === edge.id
        if (!open) return null
        const value = edge.condition || ''
        return h(
          'div',
          { className: 'dbmcp-edge-form' },
          h('p', { className: 'dbmcp-hint' }, t('graph.conditionHint')),
          h('input', {
            className: 'dbmcp-input dbmcp-mono',
            defaultValue: value,
            placeholder: t('graph.conditionPlaceholder'),
            onChange: (event) => setGraphConditionDraft(event.target.value),
          }),
          h(
            'div',
            { className: 'dbmcp-inline' },
            h(
              'button',
              {
                type: 'button',
                className: 'dbmcp-btn is-small is-primary',
                disabled: graphBusy,
                onClick: () => {
                  void saveCondition(edge, graphConditionDraft)
                  setGraphCondition('')
                  setGraphConditionDraft('')
                },
              },
              t('graph.saveCondition'),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'dbmcp-btn is-small',
                onClick: () => {
                  setGraphCondition('')
                  setGraphConditionDraft('')
                },
              },
              t('graph.cancel'),
            ),
          ),
        )
      }

      /** The reject buttons, one per reason; picking one is the whole answer. */
      const edgeRejectMenu = (edge) => {
        const open = graphReason === edge.id
        if (!open) return null
        const pick = (reason) => {
          setGraphReason('')
          void sendFeedback(edge, 'too_many', reason)
        }
        return h(
          'div',
          { className: 'dbmcp-edge-form' },
          h('p', { className: 'dbmcp-hint' }, t('graph.rejectHint')),
          h(
            'div',
            { className: 'dbmcp-inline' },
            h('button', { type: 'button', className: 'dbmcp-btn is-small', disabled: graphBusy, onClick: () => pick('wrong_column') }, t('graph.reasonWrongColumn')),
            h('button', { type: 'button', className: 'dbmcp-btn is-small', disabled: graphBusy, onClick: () => pick('needs_condition') }, t('graph.reasonNeedsCondition')),
            h('button', { type: 'button', className: 'dbmcp-btn is-small', disabled: graphBusy, onClick: () => pick('not_unique') }, t('graph.reasonNotUnique')),
            h('button', { type: 'button', className: 'dbmcp-btn is-small is-plain', onClick: () => setGraphReason('') }, t('graph.cancel')),
          ),
        )
      }

      /** The row actions each status offers — the state machine, made visible. */
      const edgeActions = (edge) => {
        const status = edge.status || 'pending'
        const buttons = []
        if (status === 'pending') {
          buttons.push(
            h('button', { key: 'ok', type: 'button', className: 'dbmcp-btn is-small is-primary', disabled: graphBusy, onClick: () => void sendFeedback(edge, 'ok') }, t('graph.confirm')),
            h('button', { key: 'no', type: 'button', className: 'dbmcp-btn is-small is-danger', disabled: graphBusy, onClick: () => setGraphReason(edge.id) }, t('graph.reject')),
            h('button', { key: 'when', type: 'button', className: 'dbmcp-btn is-small', disabled: graphBusy, onClick: () => { setGraphCondition(edge.id); setGraphConditionDraft(edge.condition || '') } }, t('graph.addCondition')),
          )
        } else if (status === 'stale') {
          buttons.push(
            h('button', { key: 'ok', type: 'button', className: 'dbmcp-btn is-small is-primary', disabled: graphBusy, onClick: () => void sendFeedback(edge, 'ok') }, t('graph.confirm')),
            h('button', { key: 'when', type: 'button', className: 'dbmcp-btn is-small', disabled: graphBusy, onClick: () => { setGraphCondition(edge.id); setGraphConditionDraft(edge.condition || '') } }, t('graph.addCondition')),
            h('button', { key: 'gone', type: 'button', className: 'dbmcp-btn is-small is-danger', disabled: graphBusy, onClick: () => void removeEdge(edge) }, t('graph.remove')),
          )
        } else if (status === 'rejected') {
          buttons.push(
            h('button', { key: 'ok', type: 'button', className: 'dbmcp-btn is-small', disabled: graphBusy, onClick: () => void sendFeedback(edge, 'ok') }, t('graph.reopen')),
            h('button', { key: 'gone', type: 'button', className: 'dbmcp-btn is-small is-danger', disabled: graphBusy, onClick: () => void removeEdge(edge) }, t('graph.remove')),
          )
        }
        /* confirmed and trusted rows carry no buttons: they are the answer, and
           the only way to change one is to open its record and withdraw it. */
        if (status === 'confirmed' || status === 'trusted') {
          const open = graphOpen === edge.id
          buttons.push(
            h(
              'button',
              {
                key: 'record',
                type: 'button',
                className: 'dbmcp-btn is-small is-plain',
                onClick: () => setGraphOpen(open ? '' : edge.id),
              },
              open ? t('graph.hideRecord') : t('graph.record'),
            ),
          )
        }
        return buttons.length === 0 ? null : h('div', { className: 'dbmcp-inline dbmcp-edge-actions' }, buttons)
      }

      const renderEdge = (edge) => {
        const status = edge.status || 'pending'
        const open = graphOpen === edge.id
        /* An opened row is also the row something jumped to, so it gets a focus ring:
           on a page with thirteen edges, the record alone does not say which one. */
        return h(
          'div',
          {
            key: edge.id,
            id: `dbmcp-edge-${edge.id}`,
            className: `dbmcp-edge is-${status}${open ? ' is-focus' : ''}`,
          },
          h(
            'div',
            { className: 'dbmcp-edge-head' },
            h(
              'code',
              { className: 'dbmcp-edge-path' },
              h('span', null, `${edge.from.table}.${edge.from.column}`),
              h('span', { className: 'dbmcp-edge-arrow' }, ' → '),
              h('span', null, `${edge.to.table}.${edge.to.column}`),
            ),
            h('span', { className: edgeStatusClass(status) }, edgeStatusLabel(status)),
          ),
          h('p', { className: 'dbmcp-hint dbmcp-edge-meta' }, edgeMeta(edge)),
          edge.condition ? h('p', { className: 'dbmcp-hint dbmcp-edge-when' }, `${t('graph.whenClause')} ${edge.condition}`) : null,
          status === 'stale' || status === 'rejected' ? edgeReason(edge) : null,
          edgeActions(edge),
          edgeRejectMenu(edge),
          edgeConditionEditor(edge),
          open ? h('div', { className: 'dbmcp-edge-record' }, h('p', { className: 'dbmcp-hint' }, t('graph.recordHint')), edgeHistory(edge)) : null,
        )
      }

      /** The form that adds a join the catalog does not declare. */
      const renderEdgeForm = () => {
        const draft = graphForm || {}
        const field = (key, label, placeholder) =>
          h(
            'label',
            { className: 'dbmcp-cell' },
            h('span', { className: 'dbmcp-label' }, label),
            h('input', {
              className: 'dbmcp-input dbmcp-mono',
              defaultValue: draft[key] || '',
              placeholder,
              onChange: (event) => setGraphForm({ ...draft, [key]: event.target.value }),
            }),
          )
        return h(
          'div',
          { className: 'dbmcp-edge-form is-new' },
          h('p', { className: 'dbmcp-hint' }, t('graph.addHint')),
          h(
            'div',
            { className: 'dbmcp-edge-grid' },
            field('from_table', t('graph.fromTable'), 'T_TRANS'),
            field('from_column', t('graph.fromColumn'), 'ORDER_ID'),
            field('to_table', t('graph.toTable'), 'T_ORDER'),
            field('to_column', t('graph.toColumn'), 'ID'),
          ),
          h(
            'label',
            { className: 'dbmcp-cell' },
            h('span', { className: 'dbmcp-label' }, t('graph.condition')),
            h('input', {
              className: 'dbmcp-input dbmcp-mono',
              defaultValue: draft.condition || '',
              placeholder: t('graph.conditionPlaceholder'),
              onChange: (event) => setGraphForm({ ...draft, condition: event.target.value }),
            }),
          ),
          h(
            'div',
            { className: 'dbmcp-inline' },
            h('button', { type: 'button', className: 'dbmcp-btn is-small is-primary', disabled: graphBusy, onClick: () => void proposeEdge() }, t('graph.save')),
            h('button', { type: 'button', className: 'dbmcp-btn is-small', onClick: () => setGraphForm(null) }, t('graph.cancel')),
          ),
        )
      }

      const renderGraph = () => {
        const list = (graph && graph.edges) || []
        const counts = (graph && graph.counts) || null
        const total = (graph && graph.total) || 0
        const pending = counts ? counts.pending : 0
        const confirmed = counts ? counts.confirmed + counts.trusted : 0
        const broken = counts ? counts.stale + counts.rejected : 0
        const filters = [
          { id: 'all', label: t('graph.filterAll'), count: total },
          { id: 'pending', label: t('graph.filterPending'), count: pending },
          { id: 'confirmed', label: t('graph.filterConfirmed'), count: confirmed },
          { id: 'broken', label: t('graph.filterBroken'), count: broken },
        ]
        const matches = (edge) => {
          if (graphFilter === 'all') return true
          if (graphFilter === 'confirmed') return edge.status === 'confirmed' || edge.status === 'trusted'
          if (graphFilter === 'broken') return edge.status === 'stale' || edge.status === 'rejected'
          return (edge.status || 'pending') === graphFilter
        }
        const visible = list.filter(matches)
        const sourcePick = sources.length
          ? h(
              'select',
              {
                className: 'dbmcp-input dbmcp-select',
                value: graphTarget,
                onChange: (event) => {
                  remember('graphSource', setGraphSource)(event.target.value)
                  setGraphOpen('')
                  setGraphCondition('')
                  setGraphReason('')
                },
              },
              sources.map((item) => h('option', { key: item.id, value: item.id }, item.name || item.id)),
            )
          : null
        return h(
          Card,
          {
            title: t('graph.title'),
            aside: graphBusy ? h('span', { className: 'dbmcp-pill' }, t('graph.busy')) : h('span', { className: 'dbmcp-pill' }, `${total}`),
            actions: h(
              'div',
              { className: 'dbmcp-inline' },
              h('button', { type: 'button', className: 'dbmcp-btn is-small', disabled: graphBusy || !graphTarget, onClick: () => void discoverEdges() }, t('graph.discover')),
              h('button', { type: 'button', className: 'dbmcp-btn is-small', disabled: graphBusy || !graphTarget, onClick: () => void mineEdges() }, t('graph.mine')),
              h('button', { type: 'button', className: 'dbmcp-btn is-small', disabled: graphBusy || !graphTarget, onClick: () => setGraphForm(graphForm ? null : {}) }, graphForm ? t('graph.cancel') : t('graph.add')),
            ),
          },
          h('p', { className: 'dbmcp-hint' }, t('graph.hint')),
          sources.length === 0
            ? h('p', { className: 'dbmcp-hint' }, t('graph.noSources'))
            : h(
                'div',
                { className: 'dbmcp-edge-toolbar' },
                sourcePick,
                h(
                  'div',
                  { className: 'dbmcp-edge-filters' },
                  filters.map((filter) =>
                    h(
                      'button',
                      {
                        key: filter.id,
                        type: 'button',
                        className: graphFilter === filter.id ? 'dbmcp-filter is-on' : 'dbmcp-filter',
                        onClick: () => remember('graphFilter', setGraphFilter)(filter.id),
                      },
                      `${filter.label} ${filter.count}`,
                    ),
                  ),
                ),
              ),
          graphForm ? renderEdgeForm() : null,
          graphError ? h('p', { className: 'dbmcp-hint dbmcp-edge-error' }, graphError) : null,
          graphBusy && !graph ? h('p', { className: 'dbmcp-hint' }, t('loading')) : null,
          sources.length === 0 ? null : visible.length === 0
            ? h('p', { className: 'dbmcp-hint' }, graphFilter === 'all' ? t('graph.empty') : t('graph.emptyFiltered'))
            : h('div', { className: 'dbmcp-edges' }, visible.map(renderEdge)),
          graph && graph.truncated ? h('p', { className: 'dbmcp-hint' }, fmt(t('graph.truncated'), { n: total })) : null,
        )
      }

      /* Page C — the scenes.
         A scene is a named set of tables, so this page edits a membership list and
         nothing else. The joins a scene's members share are shown, because they are
         what makes the set useful, but they are read from the relation graph and the
         only way to change them is to go there: a scene that owned edges would make
         deleting one a loss of work nobody could see. */
      const renderScenes = () => {
        const stored = scenePicked ? sceneRows.find((scene) => scene.id === scenePicked) || null : null
        const draft = sceneEdit || null
        const links = (stored && stored.edges) || []
        const isolated = (stored && stored.isolated) || []
        const members = (draft && draft.tables) || []
        const needle = sceneQuery.trim().toLowerCase()
        const catalogue = (sceneCatalog || []).filter(
          (table) =>
            tableMatches(table, needle) &&
            !members.some((item) => String(item).toLowerCase() === String(table.name || '').toLowerCase()),
        )
        /* A wide schema lists hundreds of tables; twenty chips are enough to pick from
           and the search box is right above them for the rest. */
        const CATALOG_LIMIT = 20
        const shown = catalogue.slice(0, CATALOG_LIMIT)
        const hiddenCount = catalogue.length - shown.length
        const sourcePick = sources.length
          ? h(
              'select',
              {
                className: 'dbmcp-input dbmcp-select',
                value: sceneTarget,
                onChange: (event) => {
                  remember('sceneSource', setSceneSource)(event.target.value)
                  setScenePicked('')
                  setSceneNew(false)
                  setSceneEdit(null)
                  setView({ mode: 'scenes' })
                },
              },
              sources.map((item) => h('option', { key: item.id, value: item.id }, item.name || item.id)),
            )
          : null

        const railRows = sceneRows.length === 0
          ? h('p', { className: 'dbmcp-hint' }, t('scene.listEmpty'))
          : sceneRows.map((scene) =>
              h(
                'button',
                {
                  key: scene.id,
                  type: 'button',
                  className: scenePicked === scene.id ? 'dbmcp-scene-row is-active' : 'dbmcp-scene-row',
                  'aria-label': `${scene.name} — ${fmt(t('trace.sceneTables'), { n: scene.tableCount })}`,
                  onClick: () => {
                    if (sceneDirty && !window.confirm(t('scene.dirty'))) return
                    setSceneNew(false)
                    setScenePicked(scene.id)
                    setSceneError(null)
                  },
                },
                h('span', { className: 'dbmcp-scene-name' }, scene.name),
                h('span', { className: 'dbmcp-pill' }, fmt(t('trace.sceneTables'), { n: scene.tableCount })),
              ),
            )

        const memberRows = members.length === 0
          ? h('p', { className: 'dbmcp-hint' }, t('scene.tablesEmpty'))
          : h(
              'div',
              { className: 'dbmcp-scene-members' },
              members.map((table) =>
                h(
                  'div',
                  { key: table, className: 'dbmcp-scene-member' },
                  h('code', { className: 'dbmcp-scene-member-name' }, table),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dbmcp-btn is-small',
                      'aria-label': `${t('scene.removeTable')}: ${table}`,
                      onClick: () => removeSceneTable(table),
                    },
                    t('scene.removeTable'),
                  ),
                ),
              ),
            )

        const picker = !sceneAddOpen
          ? null
          : h(
              'div',
              { className: 'dbmcp-scene-picker' },
              h('input', {
                className: 'dbmcp-input',
                value: sceneQuery,
                placeholder: t('scene.searchTables'),
                'aria-label': t('scene.searchTables'),
                onChange: (event) => setSceneQuery(event.target.value),
              }),
              sceneCatalogError ? h('p', { className: 'dbmcp-hint dbmcp-edge-error' }, sceneCatalogError) : null,
              catalogue.length === 0
                ? h('p', { className: 'dbmcp-hint' }, sceneCatalog === null ? t('loading') : t('scene.catalogEmpty'))
                : h(
                    'div',
                    { className: 'dbmcp-scene-candidates' },
                    shown.map((table) =>
                      h(
                        'button',
                        {
                          key: `${table.schema || ''}.${table.name}`,
                          type: 'button',
                          className: 'dbmcp-btn is-small',
                          'aria-label': `${t('scene.addTable')}: ${table.name}`,
                          onClick: () => addSceneTable(table.name),
                        },
                        table.schema ? `${table.schema}.${table.name}` : table.name,
                      ),
                    ),
                  ),
              hiddenCount > 0 ? h('p', { className: 'dbmcp-hint' }, fmt(t('scene.moreTables'), { n: hiddenCount })) : null,
            )

        const linkRows = links.length === 0
          ? h('p', { className: 'dbmcp-hint' }, t('scene.linksEmpty'))
          : h(
              'div',
              { className: 'dbmcp-scene-links' },
              links.map((edge) =>
                h(
                  'button',
                  {
                    key: edge.id || `${edge.from.table}.${edge.from.column}`,
                    type: 'button',
                    className: 'dbmcp-scene-link',
                    'aria-label': `${edge.from.table}.${edge.from.column} → ${edge.to.table}.${edge.to.column}`,
                    onClick: () => openInGraph(edge.id, null),
                  },
                  h(
                    'code',
                    { className: 'dbmcp-edge-path' },
                    `${edge.from.table}.${edge.from.column}`,
                    h('span', { className: 'dbmcp-edge-arrow' }, ' → '),
                    `${edge.to.table}.${edge.to.column}`,
                  ),
                  h('span', { className: edgeStatusClass(edge.status) }, edgeStatusLabel(edge.status)),
                ),
              ),
            )

        /* Only members with nothing confirmed. The group disappears rather than
           showing an empty box: "nothing left to connect" is not worth a heading.

           Two things can leave a member here, and they ask for different work, so
           they are shown apart: a table with no confirmed join at all (the reader
           has to find one), and a table whose confirmed joins all leave the scene
           (the join exists — the other end just is not a member yet, and taking it
           in is one click). `isolated` itself stays exactly as the server derives
           it; the difference is read here from the relation graph. */
        const known = new Set(members.map((item) => foldName(item)))
        const outsideOf = (table) => {
          const folded = foldName(table)
          const edges = (sceneGraph && sceneGraph.edges) || []
          const names = []
          for (const edge of edges) {
            const status = String((edge && edge.status) || '')
            if (status !== 'confirmed' && status !== 'trusted') continue
            const from = (edge.from && edge.from.table) || ''
            const to = (edge.to && edge.to.table) || ''
            if (foldName(from) === folded && !known.has(foldName(to)) && to) names.push(String(to))
            if (foldName(to) === folded && !known.has(foldName(from)) && from) names.push(String(from))
          }
          const seen = new Set()
          return names.filter((name) => {
            const key = foldName(name)
            if (seen.has(key)) return false
            seen.add(key)
            return true
          })
        }
        /* The candidates for one member: its own columns against every other
           member's. The panel reads columns, never rows, and only ever shows the
           first few — a wall of suggestions is another way of saying nothing. */
        const candidatesFor = (table) => {
          const own = sceneColumns[table]
          if (!own || own.length === 0) return []
          const others = members
            .filter((item) => foldName(item) !== foldName(table))
            .map((item) => ({ table: item, columns: sceneColumns[item] || [] }))
            .filter((item) => item.columns.length > 0)
          return linkCandidates(own, others).map((item) => ({ ...item, fromTable: table }))
        }
        const isolatedBlock = isolated.length === 0
          ? null
          : h(
              'div',
              { className: 'dbmcp-scene-block' },
              h('p', { className: 'dbmcp-label' }, t('scene.isolatedTitle')),
              h('p', { className: 'dbmcp-hint' }, t('scene.isolatedHint')),
              h(
                'div',
                { className: 'dbmcp-scene-members' },
                isolated.map((table) => {
                  const outside = outsideOf(table)
                  const open = foldName(sceneLinkFor) === foldName(table)
                  const candidates = open ? candidatesFor(table) : []
                  const loading = open && !sceneColumns[table]
                  return h(
                    'div',
                    { key: table, className: 'dbmcp-scene-member is-block' },
                    h(
                      'div',
                      { className: 'dbmcp-scene-member-head' },
                      h('code', { className: 'dbmcp-scene-member-name' }, table),
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'dbmcp-btn is-small',
                          'aria-label': `${t('scene.addLink')}: ${table}`,
                          'aria-expanded': open ? 'true' : 'false',
                          onClick: () => {
                            const next = open ? '' : table
                            setSceneLinkFor(next)
                            if (next) {
                              void loadSceneColumns(next)
                              for (const item of members) if (foldName(item) !== foldName(table)) void loadSceneColumns(item)
                            }
                          },
                        },
                        open ? t('scene.cancel') : t('scene.addLink'),
                      ),
                    ),
                    h(
                      'p',
                      { className: 'dbmcp-hint' },
                      outside.length === 0
                        ? t('scene.noJoinAtAll')
                        : `${t('scene.joinsOutside')} ${outside.slice(0, 3).join('、')}${outside.length > 3 ? '…' : ''}`,
                    ),
                    outside.length === 0
                      ? null
                      : h(
                          'div',
                          { className: 'dbmcp-scene-adopt' },
                          outside.slice(0, 3).map((name) =>
                            h(
                              'button',
                              {
                                key: name,
                                type: 'button',
                                className: 'dbmcp-btn is-small',
                                disabled: sceneBusy,
                                'aria-label': `${fmt(t('scene.adopt'), { n: name })}`,
                                onClick: () => void adoptIntoScene(name),
                              },
                              fmt(t('scene.adopt'), { n: name }),
                            ),
                          ),
                        ),
                    loading ? h('p', { className: 'dbmcp-hint' }, t('loading')) : null,
                    open && !loading && candidates.length === 0
                      ? h(
                          'div',
                          { className: 'dbmcp-scene-adopt' },
                          h('p', { className: 'dbmcp-hint' }, t('scene.noCandidate')),
                          h(
                            'button',
                            {
                              type: 'button',
                              className: 'dbmcp-btn is-small',
                              'aria-label': `${t('scene.addLink')}: ${table}`,
                              onClick: () => addLinkFor(table),
                            },
                            t('scene.addLink'),
                          ),
                        )
                      : null,
                    candidates.length === 0
                      ? null
                      : h(
                          'div',
                          { className: 'dbmcp-scene-candidates' },
                          candidates.map((item) =>
                            h(
                              'button',
                              {
                                key: `${item.table}.${item.column}`,
                                type: 'button',
                                className: 'dbmcp-btn is-small',
                                'aria-label': `${fmt(t('scene.useCandidate'), { n: `${item.table}.${item.column}` })}`,
                                onClick: () => addJoinFrom(item),
                              },
                              h('code', { className: 'dbmcp-scene-candidate' }, `${item.table}.${item.column}`),
                              h('span', { className: 'dbmcp-scene-why' }, t('scene.sameName')),
                            ),
                          ),
                        ),
                  )
                }),
              ),
            )

        const deleteBlock = !draft || !draft.id
          ? null
          : !sceneDeleteAsk
            ? h(
                'div',
                { className: 'dbmcp-inline' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dbmcp-btn is-small is-danger',
                    disabled: sceneBusy,
                    onClick: () => setSceneDeleteAsk(true),
                  },
                  t('scene.delete'),
                ),
              )
            : h(
                'div',
                { className: 'dbmcp-scene-confirm' },
                h('p', { className: 'dbmcp-label' }, t('scene.deleteConfirm')),
                h('p', { className: 'dbmcp-hint' }, t('scene.deleteNote')),
                h(
                  'div',
                  { className: 'dbmcp-inline' },
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dbmcp-btn is-small is-danger',
                      disabled: sceneBusy,
                      onClick: () => void deleteSceneDraft(),
                    },
                    t('scene.delete'),
                  ),
                  h('button', { type: 'button', className: 'dbmcp-btn is-small', onClick: () => setSceneDeleteAsk(false) }, t('scene.deleteCancel')),
                ),
              )

        const detail = !draft
          ? h('p', { className: 'dbmcp-hint' }, sceneRows.length === 0 ? t('scene.newHint') : t('scene.pickHint'))
          : h(
              'div',
              { className: 'dbmcp-scene-detail' },
              h(
                'div',
                { className: 'dbmcp-trace-grid' },
                h(
                  'label',
                  { className: 'dbmcp-cell' },
                  h('span', { className: 'dbmcp-label' }, t('scene.name')),
                  h('input', {
                    className: 'dbmcp-input',
                    value: draft.name,
                    placeholder: t('scene.namePlaceholder'),
                    onChange: (event) => patchScene({ name: event.target.value }),
                  }),
                ),
                h(
                  'label',
                  { className: 'dbmcp-cell' },
                  h('span', { className: 'dbmcp-label' }, t('scene.note')),
                  h('input', {
                    className: 'dbmcp-input',
                    value: draft.note,
                    placeholder: t('scene.notePlaceholder'),
                    onChange: (event) => patchScene({ note: event.target.value }),
                  }),
                ),
              ),
              h(
                'div',
                { className: 'dbmcp-inline dbmcp-scene-actions' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dbmcp-btn is-small is-primary',
                    disabled: sceneBusy || (!sceneDirty && Boolean(draft.id)),
                    onClick: () => void saveSceneDraft(),
                  },
                  t('scene.save'),
                ),
                sceneDirty ? h('span', { className: 'dbmcp-pill' }, t('scene.dirty')) : null,
                deleteBlock,
              ),
              sceneError ? h('p', { className: 'dbmcp-hint dbmcp-edge-error' }, sceneError) : null,
              h(
                'div',
                { className: 'dbmcp-scene-block' },
                h('p', { className: 'dbmcp-label' }, t('scene.tablesTitle')),
                memberRows,
                h(
                  'div',
                  { className: 'dbmcp-inline' },
                  h(
                    'button',
                    { type: 'button', className: 'dbmcp-btn is-small', onClick: () => setSceneAddOpen(!sceneAddOpen) },
                    sceneAddOpen ? t('scene.cancel') : t('scene.addTable'),
                  ),
                ),
                picker,
              ),
              draft.id
                ? h(
                    'div',
                    { className: 'dbmcp-scene-block' },
                    h('p', { className: 'dbmcp-label' }, t('scene.linksTitle')),
                    h('p', { className: 'dbmcp-hint' }, t('scene.linksHint')),
                    linkRows,
                  )
                : null,
              draft.id ? isolatedBlock : null,
            )

        return h(
          Card,
          {
            title: t('scene.title'),
            aside: sceneBusy ? h('span', { className: 'dbmcp-pill' }, t('graph.busy')) : h('span', { className: 'dbmcp-pill' }, String(sceneRows.length)),
            actions: h(
              'div',
              { className: 'dbmcp-inline' },
              h('button', { type: 'button', className: 'dbmcp-btn is-small', disabled: !sceneTarget, onClick: startNewScene }, t('scene.new')),
              h('button', { type: 'button', className: 'dbmcp-btn is-small', disabled: sceneBusy || !sceneTarget, onClick: () => void loadSceneRows() }, t('action.refresh')),
            ),
          },
          h('p', { className: 'dbmcp-hint' }, t('scene.hint')),
          sources.length === 0
            ? h('p', { className: 'dbmcp-hint' }, t('scene.noSources'))
            : h(
                'div',
                { className: 'dbmcp-schema-wrap' },
                h(
                  'div',
                  { className: 'dbmcp-schema' },
                  h(
                    'div',
                    { className: 'dbmcp-schema-side' },
                    sourcePick,
                    h('div', { className: 'dbmcp-scene-list' }, railRows),
                  ),
                  h('div', { className: 'dbmcp-schema-main' }, detail),
                ),
              ),
        )
      }

      /* Page B — the trace result.
         The page takes a value and nothing else that could look like a query: the
         statements are built server-side from the relation graph, so the panel
         cannot become a SQL console by degrees. What comes back is a walk, and the
         walk is what the reader has to judge — so every step carries the feedback
         buttons for the edge that carried it there.

         A walk is a shape, so it is read as one: the lanes are the depths the
         server reported, and the edge between two boxes is the join that carried
         the value there. A box opens the rows behind that step. */

      /** Which way the value travelled over this edge to reach this node. */
      const traceStepDirection = (edge, table) => {
        if (!edge || !edge.to || !table) return 'down'
        return String(edge.to.table || '').toLowerCase() === String(table).toLowerCase() ? 'up' : 'down'
      }

      /** The chip that explains how much this join is trusted.
       *
       * Inside a scene a hand-added or mined edge is a claim the scene makes, and
       * saying "confirmed" there would overstate it: the database never declared
       * that join. So the chip says what the edge actually is. */
      const traceEdgeChip = (edge, sceneOn) => {
        if (!edge) return null
        if (sceneOn && (edge.source === 'manual' || edge.source === 'audit_mined')) {
          return h('span', { className: 'dbmcp-pill dbmcp-edge-chip is-scene' }, t('trace.sceneClaim'))
        }
        return h('span', { className: edgeStatusClass(edge.status) }, edgeStatusLabel(edge.status))
      }

      /** The values the walk carried into a node, as one readable line. */
      const traceValues = (step) => {
        const binds = ((step.condition || {}).binds || []).map((item) => String(item))
        if (binds.length === 0) return '—'
        const shown = binds.length > 4 ? binds.slice(0, 4).concat('…') : binds
        return shown.join(' · ')
      }

      /** The rows behind a node, opened on demand. The column the walk bound to is
       * highlighted because that is the one the reader is checking. */
      const traceRows = (step) => {
        const sample = step.sample || {}
        const columns = sample.columns || []
        const rows = sample.rows || []
        if (columns.length === 0 || rows.length === 0) return null
        const bound = ((step.condition || {}).column || '').toLowerCase()
        return h(
          'table',
          { className: 'dbmcp-trace-table' },
          h(
            'thead',
            null,
            h(
              'tr',
              null,
              columns.map((column) =>
                h(
                  'th',
                  { key: column, className: String(column).toLowerCase() === bound ? 'is-bound' : undefined },
                  column,
                ),
              ),
            ),
          ),
          h(
            'tbody',
            null,
            rows.map((row, rowIndex) =>
              h(
                'tr',
                { key: rowIndex },
                columns.map((column, columnIndex) =>
                  h(
                    'td',
                    { key: `${column}:${columnIndex}`, className: String(column).toLowerCase() === bound ? 'is-bound' : undefined },
                    row[columnIndex] === null || row[columnIndex] === undefined ? '∅' : String(row[columnIndex]),
                  ),
                ),
              ),
            ),
          ),
        )
      }

      const toggleTraceRows = (index) => {
        /* The wrapper setter takes a value, not an updater — it also keeps the
           last answer, so it must see the finished list rather than a function. */
        setTraceFolded(
          traceFolded.includes(index) ? traceFolded.filter((item) => item !== index) : traceFolded.concat(index),
        )
      }

      /** One step, read in full: the join that carried the value there, the values
       * it was bound to, how many rows it hit and how long it took. This is what
       * sits under the graph for whichever table the reader picked, so the shape
       * and the values are one view instead of two stacked ones. */
      const traceDetailNode = (node, sceneOn) => {
        const status = node.status || 'hit'
        const edge = node.edge || null
        const slow = status === 'needs_confirm'
        const open = !traceFolded.includes(node.index)
        const rows = node.rows || 0
        const direction = node.index === 1 || !edge ? null : traceStepDirection(edge, node.table)
        return h(
          'div',
          {
            key: `n${node.index}`,
            className: `dbmcp-trace-node is-${slow ? 'pending' : status === 'empty' ? 'stale' : status === 'error' ? 'rejected' : 'confirmed'}`,
          },
          h(
            'div',
            { className: 'dbmcp-trace-node-head' },
            h(
              'span',
              { className: 'dbmcp-trace-mark' },
              node.index === 1 ? t('trace.root') : `d${node.depth}`,
            ),
            h('code', { className: 'dbmcp-trace-name' }, node.table),
            h('span', { className: 'dbmcp-pill' }, fmt(t('trace.rows'), { n: rows })),
            node.truncated ? h('span', { className: 'dbmcp-pill dbmcp-trace-cut' }, t('trace.truncated')) : null,
            slow ? h('span', { className: edgeStatusClass('pending') }, t('trace.needsConfirmChip')) : null,
            node.index === 1
              ? h(
                  'span',
                  { className: 'dbmcp-inline' },
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dbmcp-btn is-small is-plain',
                      onClick: () => {
                        /* Naming the entry from a step pre-fills the manual
                           boxes; they are remembered like typed ones. */
                        const table = node.table
                        const column = node.condition ? node.condition.column : ''
                        setTraceTable(table)
                        setTraceColumn(column)
                        writePanel({ traceTable: table, traceColumn: column })
                      },
                    },
                    t('trace.changeEntry'),
                  ),
                )
              : null,
          ),
          direction
            ? h(
                'p',
                { className: 'dbmcp-hint dbmcp-trace-edge' },
                h('span', { className: 'dbmcp-trace-arrow' }, direction === 'up' ? `↑ ${t('trace.up')}` : `↓ ${t('trace.down')}`),
                ' ',
                h(
                  'code',
                  null,
                  edge ? `${edge.from.table}.${edge.from.column} → ${edge.to.table}.${edge.to.column}` : '',
                ),
                ' ',
                traceEdgeChip(edge, sceneOn),
                edge
                  ? h(
                      'span',
                      { className: 'dbmcp-inline dbmcp-trace-judge' },
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'dbmcp-btn is-small is-plain',
                          title: t('trace.judgeOk'),
                          onClick: () => void judgeStep(edge.id, 'ok'),
                        },
                        '✓',
                      ),
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'dbmcp-btn is-small is-plain',
                          title: t('trace.judgeWrong'),
                          onClick: () => setTraceOpen(traceOpen === `${node.index}` ? '' : `${node.index}`),
                        },
                        '✗',
                      ),
                    )
                  : null,
              )
            : null,
          h(
            'p',
            { className: 'dbmcp-hint dbmcp-trace-values' },
            slow
              ? t('trace.needsConfirm')
              : status === 'empty'
                ? t('trace.chainBreaks')
                : status === 'error'
                  ? t('trace.stepFailed')
                  : traceValues(node),
            slow ? '' : typeof node.ms === 'number' ? ` · ${fmt(t('trace.stepMs'), { ms: node.ms })}` : '',
            slow ? '' : typeof node.fanout === 'number' ? ` · ${fmt(t('graph.fanout'), { value: node.fanout.toFixed(1) })}` : '',
          ),
          slow
            ? h(
                'div',
                { className: 'dbmcp-inline dbmcp-trace-judge' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dbmcp-btn is-small',
                    disabled: traceBusy,
                    onClick: () => {
                      void runTrace(true)
                    },
                  },
                  t('trace.continueAnyway'),
                ),
              )
            : null,
          slow ? null : node.note ? h('p', { className: 'dbmcp-hint dbmcp-trace-note' }, node.note) : null,
          slow || rows === 0
            ? null
            : h(
                'div',
                { className: 'dbmcp-inline dbmcp-trace-more' },
                h(
                  'button',
                  { type: 'button', className: 'dbmcp-btn is-small is-plain', onClick: () => toggleTraceRows(node.index) },
                  open ? t('trace.hideRows') : fmt(t('trace.showRowsN'), { n: rows }),
                ),
                traceOpen === `${node.index}`
                  ? h(
                      'span',
                      { className: 'dbmcp-inline dbmcp-trace-reasons' },
                      h('button', { type: 'button', className: 'dbmcp-btn is-small', onClick: () => void judgeStep(edge.id, 'too_many', 'not_unique') }, t('graph.reasonNotUnique')),
                      h('button', { type: 'button', className: 'dbmcp-btn is-small', onClick: () => void judgeStep(edge.id, 'too_many', 'wrong_column') }, t('graph.reasonWrongColumn')),
                      h('button', { type: 'button', className: 'dbmcp-btn is-small', onClick: () => void judgeStep(edge.id, 'too_many', 'needs_condition') }, t('graph.reasonNeedsCondition')),
                      h('button', { type: 'button', className: 'dbmcp-btn is-small is-plain', onClick: () => void judgeStep(edge.id, 'missing') }, t('trace.judgeMissing')),
                      h('button', { type: 'button', className: 'dbmcp-btn is-small is-danger', onClick: () => void judgeStep(edge.id, 'irrelevant') }, t('trace.judgeIrrelevant')),
                    )
                  : null,
              ),
          open ? traceRows(node) : null,
        )
      }

      /** Fold a table into the scene the reader is currently using, then re-run.
       * The scene is the only thing that decides what a walk may read, so this is
       * the one click that turns "not read" into "read". */
      const traceAddToScene = async (table) => {
        const scene = scenes.find((item) => item.id === traceScene)
        if (!scene) return
        const tables = Array.from(new Set([...(scene.tables || []), table]))
        setTraceBusy(true)
        try {
          const payload = await apiPost('/scenes/save', {
            datasource: traceTarget,
            scene_id: scene.id,
            name: scene.name,
            tables,
            note: scene.note || undefined,
          })
          if (payload && payload.ok === false) {
            const failure = payload.error || {}
            setTraceError(failure.message || 'save_scene failed')
            return
          }
          await loadScenes()
          await runTrace()
        } catch (error) {
          setTraceError(String((error && error.message) || error))
        } finally {
          setTraceBusy(false)
        }
      }

      /** Save the walk just taken as a scene: the tables it actually read.
       *
       * A scene of the same name is updated rather than duplicated — that is
       * `save_scene`'s own rule — so the form asks before writing over it, and
       * the confirmation is part of the same control that saves. */
      const saveTraceAsScene = async (name, tables, note) => {
        const wanted = String(name || '').trim()
        if (!wanted) {
          setTraceError(t('scene.needName'))
          return
        }
        if (!tables || tables.length === 0) {
          setTraceError(t('scene.needTables'))
          return
        }
        setTraceBusy(true)
        setTraceError(null)
        try {
          const payload = await apiPost('/scenes/save', {
            datasource: traceTarget,
            name: wanted,
            /* Sent as a string even when empty: an omitted note means "leave
               the stored one alone", which is not what typing nothing means. */
            note: String(note || '').trim(),
            tables,
          })
          if (payload && payload.ok === false) {
            const failure = payload.error || {}
            const hint = failure.hint ? ` — ${failure.hint}` : ''
            setTraceError(`${failure.message || 'save_scene failed'}${hint}`)
            return
          }
          const saved = (payload && payload.scene) || null
          await loadScenes()
          if (saved && saved.id) remember('traceScene', setTraceScene)(saved.id)
          setTraceSceneDraft(null)
          setNotice({ message: fmt(t('scene.saved'), { name: wanted }), isError: false })
        } catch (error) {
          setTraceError(String((error && error.message) || error))
        } finally {
          setTraceBusy(false)
        }
      }

      /** Clicking a box in the graph asks for that step's values, which are read
       * underneath the picture — one view, not a graph next to a tree. */
      const focusTraceNode = (index) => {
        setTraceFocus(index)
        if (typeof document === 'undefined') return
        const host = document.getElementById('dbmcp-trace-detail')
        if (host && typeof host.scrollIntoView === 'function') {
          host.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
        }
      }

      /** Every node, depth first, so the panel can find the one the graph points at. */
      const traceAllNodes = (nodes) => {
        const out = []
        const visit = (list) => {
          list.forEach((node) => {
            out.push(node)
            if (node.children && node.children.length) visit(node.children)
          })
        }
        visit(nodes)
        return out
      }

      /**
       * The walk as a picture: one column per depth, left to right, one box per
       * table reached, and every join drawn as an edge labelled with the pair of
       * columns it compares. A join walk is a shape, so the shape is the whole
       * view; clicking a box reads that step underneath it.
       */
      const traceLanes = (nodes) => {
        const lanes = []
        const place = (list) => {
          list.forEach((node) => {
            const depth = node.depth || 0
            while (lanes.length <= depth) lanes.push([])
            lanes[depth].push(node)
            if (node.children && node.children.length) place(node.children)
          })
        }
        place(nodes)
        return lanes
      }

      /**
       * The rows inside each lane, in the order that draws no crossings.
       *
       * Every step has exactly one parent, and a parent always sits one lane to
       * the left, so two edges can only cross when their boxes sit in the opposite
       * order to the boxes they hang off. Sorting each lane once, top-down, by the
       * row its parent occupies therefore leaves nothing to cross: by the time a
       * lane is sorted the lane it hangs off is already final, and children of the
       * same parent keep the order the walk reached them in. Arrival order, which
       * is what a breadth-first walk hands us, is exactly the order that draws the
       * most crossings.
       */
      const traceOrder = (lanes) => {
        const ordered = lanes.map((lane) => lane.slice())
        for (let depth = 1; depth < ordered.length; depth += 1) {
          const above = {}
          ordered[depth - 1].forEach((node, row) => { above[node.index] = row })
          ordered[depth] = ordered[depth]
            .map((node, row) => ({ node, row, weight: above[node.parent] }))
            .sort((left, right) => {
              const a = left.weight === undefined ? left.row : left.weight
              const b = right.weight === undefined ? right.row : right.weight
              return a === b ? left.row - right.row : a - b
            })
            .map((item) => item.node)
        }
        return ordered
      }

      /* How far the picture may be magnified. 40% fits a wide walk into a card,
         250% makes a single label comfortable to read; past either end the picture
         stops being a picture. */
      const ZOOM_MIN = 0.4
      const ZOOM_MAX = 2.5
      const ZOOM_STEP = 0.2

      const traceOverview = () => {
        const nodes = (trace && trace.nodes) || []
        if (nodes.length === 0) return null
        const lanes = traceOrder(traceLanes(nodes))
        /* Nothing picked yet means the entry: the walk starts somewhere, and the
           detail under the graph should start there too. */
        const current = traceFocus || (nodes[0] && nodes[0].index) || 0
        /* One lane per depth, so the walk reads left to right: the entry on the
           left, everything it drags in further right. Each lane ends with a
           gutter that only that lane's labels use: the curve stops at the
           gutter's left edge and a short horizontal stub carries it into the
           box, so a label written above the stub has no other curve to fight
           with. Labels written into the middle of the gap, which is what we did
           first, get crossed by every sibling curve that sweeps past them. */
        const LANE_W = 340
        const ROW_H = 58
        const PAD = 18
        const HEAD = 22
        const BOX_W = 150
        const BOX_H = 40
        const GUTTER = 150
        const width = PAD * 2 + Math.max(lanes.length - 1, 0) * LANE_W + BOX_W
        let busiest = 0
        lanes.forEach((lane) => {
          if (lane.length > busiest) busiest = lane.length
        })
        const height = HEAD + PAD + Math.max(busiest, 1) * ROW_H
        const spots = {}
        lanes.forEach((lane, depth) => {
          lane.forEach((node, row) => {
            spots[node.index] = {
              depth,
              x: PAD + depth * LANE_W,
              y: HEAD + PAD + row * ROW_H,
            }
          })
        })
        const links = []
        const labels = []
        const boxes = []
        /* A parent with six children used to launch all six curves from the same
           point, which reads as one grey smear. Spreading the exits down its
           right edge keeps each join a line you can follow. */
        const fanout = {}
        lanes.forEach((lane) => {
          lane.forEach((node) => {
            if (node.parent) fanout[node.parent] = (fanout[node.parent] || 0) + 1
          })
        })
        const taken = {}
        lanes.forEach((lane) => {
          lane.forEach((node) => {
            const here = spots[node.index]
            if (!here) return
            const name = String(node.table || '')
            const short = name.length > 20 ? `${name.slice(0, 19)}…` : name
            const status = node.status || 'hit'
            const focused = node.index === current
            boxes.push(
              h(
                'g',
                {
                  key: `ov${node.index}`,
                  className: 'dbmcp-ov-hit',
                  onClick: () => focusTraceNode(node.index),
                  onKeyDown: (event) => {
                    if (event.key === 'Enter' || event.key === ' ') focusTraceNode(node.index)
                  },
                  tabIndex: 0,
                  role: 'button',
                  'aria-label': `${node.table} · ${fmt(t('trace.rows'), { n: node.rows || 0 })}`,
                },
                h('rect', {
                  className: `dbmcp-ov-node is-${status === 'needs_confirm' ? 'pending' : status === 'empty' ? 'stale' : status === 'error' ? 'rejected' : status}${focused ? ' is-focus' : ''}`,
                  x: here.x,
                  y: here.y,
                  width: BOX_W,
                  height: BOX_H,
                  rx: 7,
                }),
                h(
                  'text',
                  { className: 'dbmcp-ov-text', x: here.x + BOX_W / 2, y: here.y + 17, textAnchor: 'middle' },
                  short,
                ),
                h(
                  'text',
                  { className: 'dbmcp-ov-sub', x: here.x + BOX_W / 2, y: here.y + 31, textAnchor: 'middle' },
                  fmt(t('trace.rows'), { n: node.rows || 0 }),
                ),
                h('title', null, `${node.table} · ${fmt(t('trace.rows'), { n: node.rows || 0 })}`),
              ),
            )
            const parent = node.parent ? spots[node.parent] : null
            if (!parent) return
            /* Walk the exits down the parent's right edge instead of stacking
               them at one point. */
            const order = taken[node.parent] || 0
            taken[node.parent] = order + 1
            const count = fanout[node.parent] || 1
            /* Spread the exits evenly down the box's right edge. A fixed step
               crowded every exit past the third onto the same point, which is the
               smear this is meant to avoid; dividing the box height by the number
               of exits keeps them distinct however many there are. */
            const inner = BOX_H - 8
            const offset = count > 1 ? 4 + (inner / (count - 1)) * order : BOX_H / 2
            const x1 = parent.x + BOX_W
            const y1 = parent.y + offset
            /* The curve ends in the gutter, then a straight stub enters the box:
               the label lives above the stub, and the only line in that band is
               the stub itself, so nothing can cross the text. */
            const x2 = here.x
            const y2 = here.y + BOX_H / 2
            const elbow = x2 - GUTTER
            const mid = (x1 + elbow) / 2
            links.push(
              h('path', {
                key: `ln${node.index}`,
                className: `dbmcp-ov-link is-${status === 'needs_confirm' ? 'pending' : status === 'empty' ? 'stale' : status === 'error' ? 'rejected' : 'walked'}`,
                d: `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${elbow} ${y2} L ${x2} ${y2}`,
              }),
            )
            /* The edge carries the pair of columns it compares, written in the
               gutter above its own stub. Nothing else is drawn in that band — the
               curves all stop at the gutter's left edge and only horizontal stubs
               cross it, each on its own row — so the text cannot be crossed. */
            const edge = node.edge || null
            const join = edge ? `${edge.from.column} → ${edge.to.column}` : ''
            const clipped = join.length > 24 ? `${join.slice(0, 23)}…` : join
            if (clipped) {
              labels.push(
                h(
                  'text',
                  {
                    key: `el${node.index}`,
                    className: 'dbmcp-ov-edge-label',
                    x: x2 - GUTTER + 8,
                    y: y2 - 6,
                    textAnchor: 'start',
                  },
                  clipped,
                ),
              )
            }
          })
        })
        const heads = lanes.map((lane, depth) =>
          h(
            'text',
            {
              key: `hd${depth}`,
              className: 'dbmcp-ov-head',
              x: PAD + depth * LANE_W + BOX_W / 2,
              y: 12,
              textAnchor: 'middle',
            },
            depth === 0 ? t('trace.root') : `d${depth}`,
          ),
        )
        return h(
          'div',
          { className: 'dbmcp-trace-overview' },
          h(
            'div',
            { className: 'dbmcp-trace-zoom' },
            h(
              'button',
              {
                type: 'button',
                className: 'dbmcp-btn is-small is-plain',
                disabled: traceZoom <= ZOOM_MIN,
                title: t('trace.zoomOut'),
                'aria-label': t('trace.zoomOut'),
                onClick: () => setTraceZoom(Math.max(ZOOM_MIN, Math.round((traceZoom - ZOOM_STEP) * 100) / 100)),
              },
              '−',
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'dbmcp-btn is-small is-plain dbmcp-trace-zoom-value',
                title: t('trace.zoomReset'),
                'aria-label': t('trace.zoomReset'),
                onClick: () => setTraceZoom(1),
              },
              `${Math.round(traceZoom * 100)}%`,
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'dbmcp-btn is-small is-plain',
                disabled: traceZoom >= ZOOM_MAX,
                title: t('trace.zoomIn'),
                'aria-label': t('trace.zoomIn'),
                onClick: () => setTraceZoom(Math.min(ZOOM_MAX, Math.round((traceZoom + ZOOM_STEP) * 100) / 100)),
              },
              '+',
            ),
          ),
          h(
            'div',
            { className: 'dbmcp-trace-scroll' },
            h(
              'svg',
              {
                className: 'dbmcp-ov-svg',
                viewBox: `0 0 ${width} ${height}`,
                /* The viewBox keeps the drawing; only the rendered size changes, so
                   zooming never re-lays out a lane or re-wraps a label. */
                style: { width: `${Math.round(width * traceZoom)}px`, height: `${Math.round(height * traceZoom)}px` },
                role: 'img',
                'aria-label': t('trace.overview'),
              },
              heads,
              links,
              labels,
              boxes,
            ),
          ),
        )
      }

      const renderTrace = () => {
        const summary = (trace && trace.summary) || null
        const steps = (trace && trace.steps) || []
        const nodes = (trace && trace.nodes) || []
        const outside = (trace && trace.outside) || []
        const pending = (trace && trace.pending) || []
        const warnings = (trace && trace.warnings) || []
        const stopped = (trace && trace.stoppedAt) || []
        const entry = (trace && trace.entry) || null
        const candidates = (entry && Array.isArray(entry.candidates)) ? entry.candidates : []
        const sceneOn = Boolean(traceScene)
        /* What "save as a scene" records: the tables this walk actually read.
           A table reached from two parents is still one member. */
        const traceSceneTables = []
        const traceSceneSeen = new Set()
        steps.forEach((step) => {
          const name = String((step && step.table) || '')
          const key = name.toLowerCase()
          if (!name || traceSceneSeen.has(key)) return
          traceSceneSeen.add(key)
          traceSceneTables.push(name)
        })
        /* save_scene updates a scene of the same name instead of adding a
           second one, so the form says so before the button is pressed. */
        const draftName = traceSceneDraft ? String(traceSceneDraft.name || '').trim().toLowerCase() : ''
        const draftOverwrite =
          Boolean(draftName) &&
          scenes.some((item) => String(item.name || '').trim().toLowerCase() === draftName)
        const directions = [
          { id: 'both', label: t('trace.dirBoth') },
          { id: 'down', label: t('trace.dirDown') },
          { id: 'up', label: t('trace.dirUp') },
        ]
        const sourcePick = sources.length
          ? h(
              'select',
              {
                className: 'dbmcp-input dbmcp-select',
                value: traceTarget,
                onChange: (event) => {
                  remember('traceSource', setTraceSource)(event.target.value)
                  setTraceScene('')
                  writePanel({ traceScene: '' })
                  setTrace(null)
                  setTraceError(null)
                },
              },
              sources.map((item) => h('option', { key: item.id, value: item.id }, item.name || item.id)),
            )
          : null
        const scenePick = h(
          'select',
          {
            className: 'dbmcp-input dbmcp-select',
            value: traceScene,
            onChange: (event) => remember('traceScene', setTraceScene)(event.target.value),
          },
          h('option', { value: '' }, t('trace.sceneAll')),
          scenes.map((item) =>
            h('option', { key: item.id, value: item.id }, `${item.name} · ${fmt(t('trace.sceneTables'), { n: item.tableCount })}`),
          ),
        )
        const dirPick = h(
          'div',
          { className: 'dbmcp-inline dbmcp-trace-dirs' },
          directions.map((item) =>
            h(
              'button',
              {
                key: item.id,
                type: 'button',
                className: `dbmcp-btn is-small${traceDirection === item.id ? ' is-primary' : ''}`,
                title: item.label,
                onClick: () => remember('traceDirection', setTraceDirection)(item.id),
              },
              item.id === 'both' ? t('trace.dirBothShort') : item.id === 'up' ? '↑' : '↓',
            ),
          ),
        )
        return h(
          Card,
          { title: t('trace.title') },
          h('p', { className: 'dbmcp-hint' }, t('trace.hint')),
          sources.length === 0
            ? h('p', { className: 'dbmcp-hint' }, t('trace.noSources'))
            : h(
                'div',
                { className: 'dbmcp-trace-form' },
                h(
                  'label',
                  { className: 'dbmcp-cell' },
                  h('span', { className: 'dbmcp-label' }, t('trace.value')),
                  h('input', {
                    className: 'dbmcp-input dbmcp-mono',
                    value: traceValue,
                    placeholder: t('trace.valuePlaceholder'),
                    onChange: (event) => remember('traceValue', setTraceValue)(event.target.value),
                    onKeyDown: (event) => {
                      if (event.key === 'Enter') void runTrace()
                    },
                  }),
                ),
                h(
                  'div',
                  { className: 'dbmcp-trace-grid' },
                  sourcePick,
                  h(
                    'label',
                    { className: 'dbmcp-cell' },
                    h('span', { className: 'dbmcp-label' }, t('trace.scene')),
                    scenePick,
                  ),
                  h(
                    'label',
                    { className: 'dbmcp-cell' },
                    h('span', { className: 'dbmcp-label' }, t('trace.direction')),
                    dirPick,
                  ),
                ),
                h(
                  'div',
                  { className: 'dbmcp-inline' },
                  h(
                    'button',
                    { type: 'button', className: 'dbmcp-btn is-small is-primary', disabled: traceBusy || !traceTarget, onClick: () => void runTrace() },
                    traceBusy ? t('trace.running') : t('trace.run'),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: `dbmcp-btn is-small${traceManual ? ' is-primary' : ' is-plain'}`,
                      onClick: () => remember('traceManual', setTraceManual)(!traceManual),
                      title: t('trace.manualEntry'),
                    },
                    t('trace.manualEntry'),
                  ),
                ),
                traceManual
                  ? h(
                      'div',
                      { className: 'dbmcp-trace-grid' },
                      h(
                        'label',
                        { className: 'dbmcp-cell' },
                        h('span', { className: 'dbmcp-label' }, t('trace.entryTable')),
                        h('input', {
                          className: 'dbmcp-input dbmcp-mono',
                          value: traceTable,
                          placeholder: t('trace.entryOptional'),
                          onChange: (event) => remember('traceTable', setTraceTable)(event.target.value),
                        }),
                      ),
                      h(
                        'label',
                        { className: 'dbmcp-cell' },
                        h('span', { className: 'dbmcp-label' }, t('trace.entryColumn')),
                        h('input', {
                          className: 'dbmcp-input dbmcp-mono',
                          value: traceColumn,
                          placeholder: t('trace.entryOptional'),
                          onChange: (event) => remember('traceColumn', setTraceColumn)(event.target.value),
                        }),
                      ),
                    )
                  : null,
              ),
          traceError ? h('p', { className: 'dbmcp-hint dbmcp-edge-error' }, traceError) : null,
          traceBusy && !trace ? h('p', { className: 'dbmcp-hint' }, t('loading')) : null,
          trace && steps.length === 0 ? h('p', { className: 'dbmcp-hint' }, t('trace.nothing')) : null,
          trace && candidates.length > 1
            ? h(
                'div',
                { className: 'dbmcp-trace-candidates' },
                h('span', { className: 'dbmcp-hint' }, fmt(t('trace.appearsIn'), { n: candidates.length })),
                candidates.map((item, index) =>
                  h(
                    'button',
                    {
                      key: `${item.table}:${item.column}:${index}`,
                      type: 'button',
                      className: `dbmcp-btn is-small${item.table === (entry && entry.table) && item.column === (entry && entry.column) ? ' is-primary' : ''}`,
                      onClick: () => void runTrace(undefined, { table: item.table, column: item.column }),
                    },
                    `${item.table}.${item.column}${typeof item.matches === 'number' ? ` · ${fmt(t('trace.rows'), { n: item.matches })}` : ''}`,
                  ),
                ),
              )
            : null,
          trace && summary && steps.length > 0
            ? h(
                'div',
                { className: 'dbmcp-trace-summary' },
                h(
                  'p',
                  { className: 'dbmcp-hint' },
                  entry
                    ? fmt(t('trace.summary'), { table: entry.table || '—', column: entry.column || '—', tables: summary.tablesHit, ms: trace.elapsedMs })
                    : fmt(t('trace.summaryShort'), { tables: summary.tablesHit, ms: trace.elapsedMs }),
                ),
                h(
                  'p',
                  { className: 'dbmcp-hint' },
                  fmt(t('trace.counts'), {
                    steps: summary.steps,
                    rows: summary.rowsRead,
                    depth: summary.depthReached,
                  }),
                  summary.outside ? ` · ${fmt(t('trace.outsideCount'), { n: summary.outside })}` : '',
                ),
                summary.needsConfirm
                  ? h('p', { className: 'dbmcp-hint dbmcp-edge-why' }, fmt(t('trace.needsConfirmSome'), { n: summary.needsConfirm }))
                  : null,
                h(
                  'div',
                  { className: 'dbmcp-inline dbmcp-trace-save' },
                  /* The button opens the form and then steps aside: the form carries
                     its own Cancel, and two of them read as two different actions. */
                  traceSceneDraft
                    ? null
                    : h(
                        'button',
                        {
                          type: 'button',
                          className: 'dbmcp-btn is-small',
                          disabled: traceBusy || !traceTarget,
                          'aria-label': t('scene.saveAs'),
                          onClick: () =>
                            setTraceSceneDraft({ name: String((entry && entry.table) || ''), note: '' }),
                        },
                        t('scene.saveAs'),
                      ),

                  traceSceneDraft
                    ? h(
                        'span',
                        { className: 'dbmcp-hint' },
                        fmt(t('scene.fromWalk'), { n: traceSceneTables.length }),
                      )
                    : null,
                ),
                traceSceneDraft
                  ? h(
                      'div',
                      { className: 'dbmcp-trace-scene-form' },
                      h(
                        'label',
                        { className: 'dbmcp-cell' },
                        h('span', { className: 'dbmcp-label' }, t('scene.name')),
                        h('input', {
                          className: 'dbmcp-input',
                          value: traceSceneDraft.name,
                          placeholder: t('scene.namePlaceholder'),
                          'aria-label': t('scene.name'),
                          onChange: (event) => setTraceSceneDraft({ ...traceSceneDraft, name: event.target.value }),
                        }),
                      ),
                      h(
                        'label',
                        { className: 'dbmcp-cell' },
                        h('span', { className: 'dbmcp-label' }, t('scene.note')),
                        h('input', {
                          className: 'dbmcp-input',
                          value: traceSceneDraft.note,
                          placeholder: t('scene.notePlaceholder'),
                          'aria-label': t('scene.note'),
                          onChange: (event) => setTraceSceneDraft({ ...traceSceneDraft, note: event.target.value }),
                        }),
                      ),
                      draftOverwrite
                        ? h('p', { className: 'dbmcp-hint dbmcp-edge-why' }, fmt(t('scene.overwrites'), { name: traceSceneDraft.name }))
                        : null,
                      h(
                        'div',
                        { className: 'dbmcp-inline' },
                        h(
                          'button',
                          {
                            type: 'button',
                            className: 'dbmcp-btn is-small is-primary',
                            disabled: traceBusy,
                            'aria-label': t('scene.save'),
                            onClick: () => void saveTraceAsScene(traceSceneDraft.name, traceSceneTables, traceSceneDraft.note),
                          },
                          draftOverwrite ? t('scene.overwrite') : t('scene.save'),
                        ),
                        h(
                          'button',
                          { type: 'button', className: 'dbmcp-btn is-small', onClick: () => setTraceSceneDraft(null) },
                          t('scene.cancel'),
                        ),
                      ),
                    )
                  : null,
              )
            : null,
          steps.length > 0 ? traceOverview() : null,
          steps.length > 0
            ? h(
                'div',
                { className: 'dbmcp-trace-detail', id: 'dbmcp-trace-detail' },
                traceDetailNode(
                  traceAllNodes(nodes).find((node) => node.index === traceFocus) || nodes[0],
                  sceneOn,
                ),
              )
            : null,
          outside.length > 0
            ? h(
                'div',
                { className: 'dbmcp-trace-aside' },
                h('p', { className: 'dbmcp-label' }, t('trace.outsideTitle')),
                h('p', { className: 'dbmcp-hint' }, t('trace.outsideNote')),
                outside.map((item, index) =>
                  h(
                    'div',
                    { key: `${item.table}:${index}`, className: 'dbmcp-trace-outside' },
                    h('div', { className: 'dbmcp-trace-node-head' },
                      h('code', { className: 'dbmcp-trace-name' }, item.table),
                      h('span', { className: 'dbmcp-pill dbmcp-edge-chip is-outside' }, t('trace.outsideChip')),
                    ),
                    h('p', { className: 'dbmcp-hint' }, item.reason),
                    sceneOn
                      ? h(
                          'button',
                          {
                            type: 'button',
                            className: 'dbmcp-btn is-small',
                            disabled: traceBusy,
                            onClick: () => void traceAddToScene(item.table),
                          },
                          t('trace.addToScene'),
                        )
                      : null,
                  ),
                ),
              )
            : null,
          steps.length > 0
            ? h(
                'p',
                { className: 'dbmcp-hint dbmcp-trace-legend' },
                `${t('trace.legend')} ${t('graph.statusTrusted')} / ${t('graph.statusConfirmed')} / ${t('trace.sceneClaim')} / ${t('trace.outsideChip')} — ${t('trace.legendFeedback')}`,
              )
            : null,
          stopped.length > 0
            ? h(
                'div',
                { className: 'dbmcp-trace-aside' },
                h('p', { className: 'dbmcp-label' }, t('trace.stopped')),
                stopped.map((item, index) =>
                  h('p', { key: `${item.table}:${index}`, className: 'dbmcp-hint dbmcp-edge-why' }, `${item.table} — ${item.reason}`),
                ),
              )
            : null,
          pending.length > 0
            ? h(
                'div',
                { className: 'dbmcp-trace-aside' },
                h('p', { className: 'dbmcp-label' }, t('trace.pendingTitle')),
                h('p', { className: 'dbmcp-hint' }, t('trace.pendingHint')),
                pending.map((item, index) =>
                  h(
                    'p',
                    { key: `${item.wouldReach}:${index}`, className: 'dbmcp-hint dbmcp-trace-pending' },
                    h('span', { className: edgeStatusClass('pending') }, edgeStatusLabel('pending')),
                    ' ',
                    item.edge ? `${item.edge.from.table}.${item.edge.from.column} → ${item.edge.to.table}.${item.edge.to.column}` : '',
                    item.wouldReach ? ` → ${item.wouldReach}` : '',
                  ),
                ),
              )
            : null,
          warnings.length > 0
            ? h(
                'div',
                { className: 'dbmcp-trace-aside' },
                h('p', { className: 'dbmcp-label' }, t('trace.warnings')),
                warnings.map((item, index) =>
                  h('p', { key: `${item.code}:${index}`, className: 'dbmcp-hint dbmcp-edge-why' }, `[${item.code}] ${item.message}`),
                ),
              )
            : null,
        )
      }

      let body
      if (state.status === 'loading') {
        body = h('div', { className: 'dbmcp-empty' }, t('loading'))
      } else if (state.status === 'error') {
        body = h(
          'div',
          { className: 'dbmcp-error' },
          h('div', null, t('error.title')),
          h('code', null, state.error),
          h('button', { type: 'button', className: 'dbmcp-btn', onClick: load }, t('error.retry')),
        )
      } else if (view.mode === 'create') {
        body = h(Card, { title: null }, h(SourceForm, {
          t,
          draft: createDraftFrom(emptyDraft()),
          /* A new source is the one form a reader leaves half-typed, so its
             fields outlive the panel; the edit form always starts from the
             source the server holds. */
          persist: true,
          editing: null,
          takenIds: sources.map((item) => item.id),
          onSaved: save,
          onCancel: () => setView({ mode: 'list' }),
        }))
      } else if (view.mode === 'edit') {
        body = h(Card, {
          title: fmt(t('form.edit'), { name: view.source.name || view.source.id }),
          children: h(SourceForm, {
            t,
            draft: draftFromSource(view.source),
            editing: view.source,
            takenIds: sources.map((item) => item.id),
            onSaved: save,
            onCancel: () => setView({ mode: 'list' }),
          }),
        })
      } else if (view.mode === 'schema') {
        body = h(Card, { title: fmt(t('schema.title'), { name: view.source.name || view.source.id }) },
          h(
            'div',
            { className: 'dbmcp-view-bar' },
            h(
              'button',
              { type: 'button', className: 'dbmcp-btn is-small', onClick: () => setView({ mode: 'list' }) },
              `← ${t('action.backToSources')}`,
            ),
            view.source.target ? h('span', { className: 'dbmcp-view-target' }, view.source.target) : null,
            h(IdChip, {
              t,
              id: view.source.id,
              copied: copiedChip === view.source.id,
              onCopy: copyId,
            }),
          ),
          h(SchemaView, {
            t,
            source: view.source,
            onBack: () => setView({ mode: 'list' }),
          }),
        )
      } else if (view.mode === 'import') {
        body = h(Card, { title: null }, h(ImportView, {
          t,
          existingIds: sources.map((item) => item.id),
          onImported: (payload) => {
            const count = (payload.imported || []).length
            const skippedCount = (payload.skipped || []).length
            const message =
              skippedCount > 0
                ? t('notice.importedSkipped').replace('{n}', String(count)).replace('{m}', String(skippedCount))
                : fmt(t('notice.imported'), { n: count })
            finish(message, false)
          },
          onCancel: () => setView({ mode: 'list' }),
        }))
      } else {
        body = h(
          'div',
          { className: 'dbmcp-grid is-single' },
          tab === 'list' ? renderStatus() : null,
          tab === 'list'
            ? h(
                Card,
                { title: null },
                h(
                  'header',
                  { className: 'dbmcp-list-head' },
                  h('h2', { className: 'dbmcp-card-title' }, t('tab.list')),
                  renderGroupCreate(),
                  h(WriteSwitch, {
                    t,
                    allowWrite: Boolean(settings && settings.allowWrite),
                    busy,
                    onWrite: toggleWrite,
                  }),
                  h('span', { className: 'dbmcp-list-spacer' }),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dbmcp-btn is-small',
                      disabled: visibleIds.length === 0,
                      title: allVisible ? t('sources.selectNone') : fmt(t('sources.selectAll'), { n: visibleIds.length }),
                      onClick: toggleVisible,
                    },
                    allVisible ? t('sources.selectNone') : fmt(t('sources.selectAll'), { n: visibleIds.length }),
                  ),
                  h('span', { className: 'dbmcp-pill' }, t('sources.count').replace('{n}', String(sources.length))),
                  h('button', { type: 'button', className: 'dbmcp-btn is-small', disabled: busy, onClick: load }, t('action.refresh')),
                ),
                renderBulk(),
                renderList(),
              )
            : null,
          tab !== 'list' ? null : renderScopes(),
          tab !== 'runtime'
            ? null
            : h(
            Card,
            {
              title: t('diag.title'),
              actions: h(
                'button',
                {
                  type: 'button',
                  className: 'dbmcp-btn is-small',
                  disabled: busy,
                  title: t('action.restartMcpHint'),
                  onClick: restartMcp,
                },
                t('action.restartMcp'),
              ),
            },
            h(
              'div',
              { className: 'dbmcp-rows' },
              h(Row, { label: t('diag.hostApi') }, h('span', { className: 'dbmcp-dot is-ok' }), t('state.connected')),
              h(Row, { label: t('diag.node') }, (data.host && data.host.node) || '-'),
              h(Row, { label: t('diag.plugin') }, `${data.plugin.name} ${data.plugin.version}`),
              h(Row, { label: t('diag.python') }, pythonLabel(t, data.python)),
              h(Row, { label: t('diag.runtimeDir') }, (data.runtime && data.runtime.dir) || '-'),
              h(
                Row,
                { label: t('diag.registry') },
                data.runtime && data.runtime.registryError
                  ? `${data.runtime.registryFile} — ${data.runtime.registryError}`
                  : (data.runtime && data.runtime.registryFile) || '-',
              ),
              h(Row, { label: t('diag.sources') }, String(sources.length)),
              h(
                Row,
                { label: t('diag.mcp') },
                `${data.mcp.serverName} · ${
                  data.mcp.wired
                    ? t('diag.mcpLive').replace('{count}', String((data.mcp.tools || []).length))
                    : data.mcp.phase === 'failed'
                      ? `${t('diag.mcpFailed')} ${data.mcp.error || ''}`.trim()
                      : t('diag.mcpPending')
                }`,
              ),
              h(
                Row,
                { label: t('diag.venv') },
                env && env.venvPython ? env.venvPython : h('span', { className: 'dbmcp-hint' }, t('diag.venvMissing')),
              ),
              h(
                Row,
                { label: t('diag.packages') },
                h(
                  'span',
                  { className: 'dbmcp-inline' },
                  h('span', { className: 'dbmcp-hint' }, (env && env.packages) || '—'),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dbmcp-btn is-small',
                      disabled: installing,
                      title: t('diag.venvHint'),
                      onClick: installDeps,
                    },
                    installing ? t('action.installing') : t('action.installDeps'),
                  ),
                ),
              ),
              data.mcp && data.mcp.phase === 'failed' && /tools`? service/.test(String(data.mcp.error || ''))
                ? h(Row, { label: t('diag.tip') }, h('span', { className: 'dbmcp-hint' }, t('diag.restartNeeded')))
                : null,
              h(Row, { label: t('diag.uptime') }, formatUptime(data.host && data.host.uptimeMs)),
            ),
          ),
          tab !== 'graph' ? null : renderGraph(),
          tab !== 'graph' ? null : renderCost(),
          tab !== 'scenes' ? null : renderScenes(),
          tab !== 'trace' ? null : renderTrace(),
          tab !== 'clients' ? null : renderClients(),
          tab !== 'tools' ? null : renderTools(),
          tab !== 'tools' ? null : renderResults(),
          tab !== 'audit'
            ? null
            : h(            Card,
            { title: t('audit.title'), aside: audit.entries.length ? String(audit.entries.length) : null },
            h(
              'div',
              { className: 'dbmcp-audit-list' },
              audit.entries.length === 0
                ? h('div', { className: 'dbmcp-empty' }, t('audit.empty'))
                : audit.entries.map((entry, index) =>
                    h(
                      'div',
                      { className: 'dbmcp-audit', key: `${entry.at || 'entry'}-${index}` },
                      h(
                        'span',
                        { className: 'dbmcp-audit-time', title: localStamp(entry.at) },
                        localClock(entry.at),
                      ),
                      h('span', { className: 'dbmcp-audit-tool' }, entry.tool || '?'),
                      h('span', { className: 'dbmcp-audit-client', title: t('audit.clientHint') }, entry.client || '?'),
                      h('span', { className: 'dbmcp-pill' }, entry.datasource || t('sources.default')),
                      h('span', { className: 'dbmcp-hint' }, `${entry.ms ?? 0}ms`),
                      h(
                        'span',
                        { className: entry.ok ? 'dbmcp-audit-ok is-ok' : 'dbmcp-audit-ok is-error' },
                        entry.ok ? t('audit.ok') : t('audit.err'),
                      ),
                      typeof entry.rows === 'number'
                        ? h('span', { className: 'dbmcp-hint' }, t('audit.rows').replace('{n}', String(entry.rows)))
                        : null,
                      entry.sql ? h('code', { className: 'dbmcp-audit-sql' }, entry.sql) : null,
                      entry.error ? h('code', { className: 'dbmcp-audit-sql is-error' }, entry.error) : null,
                    ),
                  ),
              audit.entries.length < audit.total
                ? h(
                    'button',
                    {
                      type: 'button',
                      className: 'dbmcp-btn is-small dbmcp-audit-more',
                      disabled: auditBusy,
                      onClick: loadMoreAudit,
                    },
                    auditBusy ? t('audit.loadingMore') : t('audit.loadMore'),
                  )
                : null,
              h('p', { className: 'dbmcp-hint' }, t('audit.hint')),
              h('p', { className: 'dbmcp-hint' }, t('audit.tz').replace('{zone}', zoneLabel())),
              audit.file ? h('p', { className: 'dbmcp-hint' }, `${t('audit.file')}: ${audit.file}`) : null,
            ),
          ),
        )
      }

      /* Sub-views get the same full-width column the list uses: a bare Card in
         the panel's flex row would shrink to the intrinsic width of its inputs. */
      if (view.mode === 'create' || view.mode === 'edit' || view.mode === 'schema' || view.mode === 'import') {
        body = h('div', { className: 'dbmcp-grid is-single' }, body)
      }

      return h(
        'div',
        { className: 'dbmcp-page', style: palette },
        h('style', null, CSS),
        h(
          'header',
          { className: 'dbmcp-masthead' },
          h(
            'button',
            { type: 'button', className: 'dbmcp-back', onClick: backToChat },
            h('span', { className: 'dbmcp-back-caret', 'aria-hidden': 'true' }, '‹'),
            t('header.backToChat'),
          ),
          h('h1', null, t('panel.title')),
          h('span', { className: 'dbmcp-sub' }, t('panel.subtitle')),
          h('span', { className: 'dbmcp-masthead-spacer' }),
          h(
            'span',
            { className: 'dbmcp-pill' },
            h('span', { className: 'dbmcp-dot ' + (apiOk ? 'is-ok' : state.status === 'error' ? 'is-error' : '') }),
            apiOk ? t('state.connected') : state.status === 'loading' ? t('state.loading') : t('state.failed'),
          ),
          h(
            'a',
            {
              className: 'dbmcp-pill dbmcp-star',
              href: REPO_URL,
              target: '_blank',
              rel: 'noreferrer noopener',
              title: t('action.starHint'),
            },
            h('span', { className: 'dbmcp-star-mark', 'aria-hidden': 'true' }, '★'),
            t('action.star'),
          ),
          data && data.plugin ? h('span', { className: 'dbmcp-pill' }, `${data.plugin.name} ${data.plugin.version}`) : null,
        ),
        h(
          'nav',
          { className: 'dbmcp-tabs', role: 'tablist' },
          TABS.map((entry) =>
            h(
              'button',
              {
                key: entry.id,
                type: 'button',
                role: 'tab',
                'aria-selected': tab === entry.id,
                className: 'dbmcp-tab' + (tab === entry.id ? ' is-active' : ''),
                onClick: () => selectTab(entry.id),
              },
              tabLabel(t, entry.id),
            ),
          ),
        ),
        notice
          ? h(
              'div',
              { className: 'dbmcp-notice' + (notice.isError ? ' is-error' : '') },
              h('span', null, notice.message || notice),
              h('button', { type: 'button', className: 'dbmcp-btn is-small', onClick: () => setNotice(null) }, '×'),
            )
          : null,
        body,
      )
    }

    return {
      inject: ['slots', 'locale', 'layout', 'theme'],
      /** Parser and components exposed for the offline tests in dev/. */
      __test: {
        TABS,
        tabLabel,
        parseConnectionText,
        uniqueId,
        slugId,
        canonicalUrl,
        emptyDraft,
        draftFromSource,
        SourceForm,
        SchemaView,
        ImportView,
        groupTables,
        tableMatches,
        connectionMatches,
        /* Scene join suggestions: pure, so the offline tests can check every case. */
        foldName,
        columnFamily,
        typesJoin,
        linkCandidates,
        localClock,
        localStamp,
        TextInput,
        Switch,
        nextReadOnly,
        Card,
        Breadcrumbs,
        MainPanel,
        IdChip,
        kindBadge,
        probeFailed,
        probeReport,
        reportTarget,
        StatusStrip,
        WriteSwitch,
        sourceMatches,
        sectionOrder,
        reorderForDrop,
        paletteOf,
        parseColor,
        /* The panel's memory, so the offline tests can prove what it stores. */
        readPanel,
        writePanel,
        forgetPanel,
        draftForStorage,
        rawForStorage,
        createDraftFrom,
        /* Results are memory-only, and the tests need to see that they are. */
        keepResult,
        readResult,
      },
      apply(ctx) {
        localeService = ctx.locale
        layoutService = ctx.layout || null
        themeService = ctx.theme || null
        /* Two ways the active theme can change under us: the service tells its
           own subscribers, and the host echoes a theme/change event. Listen to
           both; either one invalidates the cached palette. */
        const refreshPalette = () => {
          paletteKey = ''
          themeSubs.forEach((notify) => notify())
        }
        if (themeService && typeof themeService.subscribe === 'function') {
          ctx.effect(() => themeService.subscribe(refreshPalette))
        }
        if (typeof ctx.on === 'function') {
          ctx.effect(() => ctx.on('theme/change', refreshPalette))
        }
        ctx.effect(() => ctx.locale.register(NS, 'en', DICT.en))
        ctx.effect(() => ctx.locale.register(NS, 'zh', DICT.zh))

        const t = ctx.locale.bind(NS)

        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            { name: 'sidebar.panellist', id: 'db-mcp', order: 25, label: () => t('panel.title') },
            SidebarIcon,
          ),
        )

        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'db-mcp' }, MainPanel))
      },
    }
  },
})
