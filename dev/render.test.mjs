// Render smoke test: runs the React components of client.js with a stub React.
// It cannot check pixels, but it does prove that every component executes
// without throwing and produces the expected input controls.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = fs.readFileSync(path.join(here, '..', 'client.js'), 'utf8')

const ReactStub = {
  Fragment: 'fragment',
  // Like React: a function component is invoked and its output takes its place.
  createElement: (type, props, ...children) => {
    const element = { type, props: props || {}, children }
    if (typeof type === 'function') {
      return type({ ...(props || {}), children: children.length <= 1 ? children[0] : children })
    }
    return element
  },
  useState: (value) => [typeof value === 'function' ? value() : value, () => {}],
  useEffect: () => {},
  useCallback: (fn) => fn,
  useMemo: (fn) => fn(),
  useRef: (value) => ({ current: value }),
  useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(),
}

let captured = null
const fakeWindow = { __ModuleLoader__: { load: (mod) => { captured = mod } } }
const requireShim = (id) => {
  if (id === 'react') return ReactStub
  throw new Error(`unexpected require: ${id}`)
}

new Function('window', 'require', source)(fakeWindow, requireShim)
const mod = captured.factory(requireShim)
const { SourceForm, SchemaView, MainPanel, emptyDraft, draftFromSource } = mod.__test

const t = (key) => key

function walk(node, visit) {
  if (node == null || typeof node !== 'object') return
  visit(node)
  for (const child of node.children || []) {
    if (Array.isArray(child)) child.forEach((item) => walk(item, visit))
    else walk(child, visit)
  }
}

function collect(tree, predicate) {
  const found = []
  walk(tree, (node) => {
    if (predicate(node)) found.push(node)
  })
  return found
}

/** Every string child in the tree — walk() only visits objects, so text needs its own pass. */
function texts(tree) {
  const found = []
  walk(tree, (node) => {
    for (const child of node.children || []) {
      if (typeof child === 'string') found.push(child)
      else if (Array.isArray(child)) for (const item of child) if (typeof item === 'string') found.push(item)
    }
  })
  return found
}

let passed = 0
const failures = []
function check(name, condition, extra) {
  if (condition) {
    passed += 1
    return
  }
  failures.push(`${name}${extra ? ` — ${extra}` : ''}`)
}

function render(name, factory, options) {
  let tree
  try {
    tree = factory()
  } catch (error) {
    check(name, false, String((error && error.message) || error))
    return null
  }
  check(name, tree != null && typeof tree === 'object')
  if (!tree || !options) return tree
  if (options.inputs != null) {
    const inputs = collect(tree, (node) => node.type === 'input')
    check(`${name}: input count`, inputs.length === options.inputs, `got ${inputs.length}`)
  }
  if (options.selects != null) {
    const selects = collect(tree, (node) => node.type === 'select')
    check(`${name}: select count`, selects.length === options.selects, `got ${selects.length}`)
  }
  if (options.details != null) {
    const details = collect(tree, (node) => node.type === 'details')
    check(`${name}: advanced block`, (details.length > 0) === options.details, `got ${details.length}`)
  }
  for (const label of options.labels || []) {
    const found = collect(
      tree,
      (node) =>
        (node.type === 'label' || (node.type === 'span' && node.props && node.props.className === 'dbmcp-form-label')) &&
        String(node.children[0]) === label,
    )
    check(`${name}: label ${label}`, found.length > 0)
  }
  return tree
}

const noop = () => {}

const sqliteTree = render(
  'create form (sqlite)',
  () => SourceForm({ t, draft: emptyDraft(), editing: null, takenIds: [], onSaved: noop, onCancel: noop }),
  {
    inputs: 11,
    selects: 1,
    details: true,
    labels: ['form.paste', 'form.user', 'form.password', 'form.file', 'form.schemaAccess'],
  },
)
if (sqliteTree) {
  const summary = collect(sqliteTree, (node) => node.type === 'summary')
  check('create form: more-settings summary', summary.length === 1 && texts(summary[0]).includes('form.more'))
  check('create form: smart-parsing tag', texts(sqliteTree).includes('form.smart'))
  check('create form: footer hint', texts(sqliteTree).includes('form.autoApply'))
  check('create form: writable schemas are asked for', texts(sqliteTree).includes('form.schemaAccessHint'))
  check('create form: DDL is its own switch', texts(sqliteTree).includes('form.allowDdl'))
}

const pgDraft = emptyDraft()
pgDraft.kind = 'postgres'
pgDraft.config = { ...pgDraft.config, host: 'localhost', port: '5432', database: 'app', user: 'alice' }
render(
  'create form (postgres)',
  () => SourceForm({ t, draft: pgDraft, editing: null, takenIds: ['app'], onSaved: noop, onCancel: noop }),
  { inputs: 14, selects: 2, details: true, labels: ['form.host', 'form.port', 'form.database'] },
)

const oracleDraft = emptyDraft()
oracleDraft.kind = 'oracle'
oracleDraft.config = { ...oracleDraft.config, host: 'ora', port: '1521', serviceName: 'XEPDB1', user: 'system' }
render(
  'create form (oracle)',
  () => SourceForm({ t, draft: oracleDraft, editing: null, takenIds: [], onSaved: noop, onCancel: noop }),
  { labels: ['form.serviceName', 'form.sid'] },
)

const editingDraft = draftFromSource({
  id: 'chinook',
  name: 'Chinook',
  kind: 'sqlite',
  readOnly: true,
  hasSecret: false,
  config: { file: 'C:\\data\\chinook.db' },
})
const editTree = render(
  'edit form (sqlite)',
  () => SourceForm({ t, draft: editingDraft, editing: { id: 'chinook' }, takenIds: ['chinook'], onSaved: noop, onCancel: noop }),
  { labels: ['form.paste', 'form.file'] },
)
if (editTree) {
  const idInput = collect(editTree, (node) => node.type === 'input' && node.props.disabled === true)
  check('edit form: identifier is locked', idInput.length === 1, `got ${idInput.length}`)
  const firstInput = collect(editTree, (node) => node.type === 'input')[0]
  check(
    'edit form: connection box is prefilled',
    Boolean(firstInput) && String(firstInput.props.value || '').includes('chinook.db'),
    JSON.stringify(firstInput && firstInput.props.value),
  )
}

const panel = render('main panel', () => MainPanel({ t: (key) => key, useResource: undefined, useWorkspaces: undefined }))
if (panel) {
  const header = collect(panel, (node) => node.type === 'h1')
  check('main panel: title rendered', header.length === 1)
  const tabs = collect(panel, (node) => node.type === 'button' && node.props.role === 'tab')
  check('main panel: seven tabs', tabs.length === 7, String(tabs.length))
  check(
    'main panel: first tab is active',
    tabs.length === 7 && tabs[0].props['aria-selected'] === true && tabs[1].props['aria-selected'] === false,
  )
  check(
    'main panel: the tools tab is its own step',
    mod.__test.TABS.some((tab) => tab.id === 'tools') && mod.__test.tabLabel((key) => key, 'tools') === 'tab.tools',
  )
  const back = collect(panel, (node) => node.type === 'button' && node.props.className === 'dbmcp-back')
  check('main panel: back-to-chat button', back.length === 1, String(back.length))
  const star = collect(panel, (node) => node.type === 'a' && String(node.props.className).includes('dbmcp-star'))
  check('main panel: star link next to the status pill', star.length === 1, String(star.length))
  check(
    'main panel: the star link points at the repository',
    star.length === 1 && star[0].props.href === 'https://github.com/halcyon6669/dsh-db-mcp',
    JSON.stringify(star.length === 1 ? star[0].props.href : null),
  )
  check(
    'main panel: the star link opens in a new tab without handing over the referrer',
    star.length === 1 && star[0].props.target === '_blank' && String(star[0].props.rel).includes('noopener'),
    JSON.stringify(star.length === 1 ? star[0].props.rel : null),
  )
  check(
    'main panel: the star link shows the star glyph beside the word',
    star.length === 1 &&
      collect(star[0], (node) => node.props.className === 'dbmcp-star-mark').length === 1 &&
      texts(collect(star[0], (node) => node.props.className === 'dbmcp-star-mark')[0]).join('') === '★',
    JSON.stringify(star.length === 1 ? texts(star[0]).join('') : null),
  )
  const crumbs = collect(panel, (node) => node.props.className === 'dbmcp-crumbs')
  check('main panel: tabs replace the breadcrumb trail', crumbs.length === 0, String(crumbs.length))
  const toolbar = collect(panel, (node) => node.props.className === 'dbmcp-toolbar')
  check('main panel: no second navigation row', toolbar.length === 0, `got ${toolbar.length}`)
}

const schemaView = render('schema view', () =>
  SchemaView({ t, source: { id: 'chinook', name: 'Chinook', kind: 'sqlite' }, onBack: noop }),
)
if (schemaView) {
  const backButton = collect(
    schemaView,
    (node) => node.type === 'button' && String(node.children[0]) === 'action.back',
  )
  check('schema view: no page-level back button (breadcrumb owns navigation)', backButton.length === 0, `got ${backButton.length}`)
  // The card header already names the source, so the view must not repeat it.
  const repeated = texts(schemaView).filter((text) => text.includes('schema.title'))
  check('schema view: the title appears once, in the card header', repeated.length === 0, `got ${repeated.length}`)
}

// A catalog can hand out names longer than the rail is wide (GaussDB's
// global_plancache_status…). Pixels are out of reach here, so pin the rules that
// do the work: the name truncates and keeps its full value in `title`, and the
// kind pill never shrinks to make room for it.
const schemaNameRule = source.slice(source.indexOf('.dbmcp-schema-name {'), source.indexOf('.dbmcp-schema-name {') + 260)
check('schema list: the name truncates', schemaNameRule.includes('text-overflow: ellipsis'), schemaNameRule.slice(0, 80))
check('schema list: the name may shrink', schemaNameRule.includes('min-width: 0'), schemaNameRule.slice(0, 80))
check(
  'schema list: the kind pill keeps its width',
  /\.dbmcp-schema-table \.dbmcp-pill \{[^}]*flex: 0 0 auto/.test(source),
)
check('schema list: the name carries the full value as a title', source.includes("title: table.name"))
check(
  'schema list: one column when the panel is narrow',
  source.includes('@container (max-width: 560px)') && source.includes('container-type: inline-size'),
)

// Required-field marking only shows up after a save attempt, so check the input
// primitive can carry the state the form turns on.
const { TextInput } = mod.__test
const plainInput = TextInput({ value: '', onChange: noop })
const markedInput = TextInput({ value: '', onChange: noop, invalid: true })
check('input: unmarked by default', plainInput.props.className === 'dbmcp-input', plainInput.props.className)
check(
  'input: invalid marks the field',
  markedInput.props.className === 'dbmcp-input is-invalid' && markedInput.props['aria-invalid'] === 'true',
  JSON.stringify(markedInput.props),
)

// The table list is grouped per schema and filterable; both helpers are pure so
// they can be checked without a live MCP server.
const { groupTables, tableMatches, connectionMatches, writableNames, showsWritable } = mod.__test
const grouped = groupTables([
  { name: 'orders', schema: 'sales' },
  { name: 'customers', schema: 'sales' },
  { name: 'settings', schema: 'public' },
  { name: 'plain', schema: '' },
])
check(
  'schema grouping keeps every table',
  grouped.reduce((sum, [, items]) => sum + items.length, 0) === 4,
  JSON.stringify(grouped.map(([schema, items]) => `${schema}:${items.length}`)),
)
check('schema grouping sorts groups', grouped.map(([schema]) => schema).join(',') === ',public,sales', grouped.map(([schema]) => schema).join(','))
check('schema filter matches table names', tableMatches({ name: 'Orders' }, 'ord') === true)
check('schema filter matches schema names', tableMatches({ name: 'x', schema: 'Sales' }, 'sales') === true)
check('schema filter drops non-matches', tableMatches({ name: 'x', schema: 'y' }, 'zzz') === false)

// The writable-schemas pill is a statement about a permission that is in force.
// The list survives a switch back to read-only, so the pill must not: showing
// "writable main" on a locked row would claim something that is not true.
check(
  'writable pill: shown on a writable source that names schemas',
  showsWritable({ readOnly: false, writableSchemas: ['main'] }) === true,
)
check(
  'writable pill: hidden when the source is read-only',
  showsWritable({ readOnly: true, writableSchemas: ['main'] }) === false,
)
check(
  'writable pill: hidden when the source names no schema',
  showsWritable({ readOnly: false, writableSchemas: [] }) === false,
)
check(
  'writable pill: a missing list counts as empty',
  writableNames({}).length === 0 && showsWritable({ readOnly: false }) === false,
)
check(
  'writable pill: blank names are not a list',
  showsWritable({ readOnly: false, writableSchemas: ['', '  '] }) === false,
)

// A row carries several status words and exactly one control. The control is a
// track switch, because a bordered pill with "read-only" on it read as one more
// label: nothing told the pointer where it could press until hover.
const { Switch } = mod.__test
const offSwitch = Switch({ t, checked: false, label: 'read-only', onChange: () => {} })
check(
  'row switch: off is announced as a switch',
  offSwitch.props.role === 'switch' && offSwitch.props['aria-checked'] === 'false',
  JSON.stringify([offSwitch.props.role, offSwitch.props['aria-checked']]),
)
check(
  'row switch: it is a button, not a pill',
  offSwitch.type === 'button' && !String(offSwitch.props.className).includes('dbmcp-pill'),
  String(offSwitch.props.className),
)
check(
  'row switch: the track and the knob are drawn',
  collect(offSwitch, (node) => node.props.className === 'dbmcp-switch-track').length === 1 &&
    collect(offSwitch, (node) => node.props.className === 'dbmcp-switch-knob').length === 1,
)
check(
  'row switch: the state word stays beside it',
  texts(offSwitch).join('') === 'read-only',
  texts(offSwitch).join(''),
)

const onSwitch = Switch({ t, checked: true, label: 'writable', onChange: () => {} })
check(
  'row switch: on carries the is-on class',
  String(onSwitch.props.className).includes('is-on') && onSwitch.props['aria-checked'] === 'true',
  String(onSwitch.props.className),
)

const clicks = []
Switch({ t, checked: false, label: 'read-only', onChange: (next) => clicks.push(next) }).props.onClick({
  stopPropagation: () => {},
})
Switch({ t, checked: true, label: 'writable', onChange: (next) => clicks.push(next) }).props.onClick({
  stopPropagation: () => {},
})
check('row switch: clicking asks for the opposite state', clicks.join(',') === 'true,false', clicks.join(','))

const frozen = []
Switch({ t, checked: false, disabled: true, onChange: (next) => frozen.push(next) }).props.onClick({
  stopPropagation: () => {},
})
check('row switch: a disabled switch ignores clicks', frozen.length === 0 && String(Switch({ t, checked: false, disabled: true }).props.disabled) === 'true')

// Style assertions: the track has to be visibly a switch, and the state words
// must not keep the bordered-pill look that made them read as buttons.
check(
  'row switch: the knob slides the width of the track',
  /\.dbmcp-switch\.is-on \.dbmcp-switch-knob \{[^}]*transform: translateX\(10px\)/.test(source),
)
check(
  'row switch: a keyboard focus ring lands on the track',
  /\.dbmcp-switch:focus-visible \.dbmcp-switch-track \{[^}]*outline: 2px solid/.test(source),
)
check(
  'row switch: the track is a 22x12 capsule',
  /\.dbmcp-switch-track \{[^}]*width: 22px[^}]*height: 12px/.test(source),
)
check(
  'row notes: state words are frameless text',
  /\.dbmcp-note \{[^}]*border: 0/.test(source) || !/\.dbmcp-note \{[^}]*border: 1px/.test(source),
)
check(
  'row notes: adjacent state words are separated by a middot',
  /\.dbmcp-item-name \.dbmcp-note \+ \.dbmcp-note::before \{[^}]*content: '·'/.test(source),
)
check('row pills: no clickable pill rule is left', !/button\.dbmcp-pill \{/.test(source))

check(
  'import filter matches name/host/user',
  connectionMatches({ name: 'mysql', target: '127.0.0.1:3306 / demo', user: 'demo' }, 'demo') === true &&
    connectionMatches({ name: 'mysql' }, 'postgres') === false,
)

const { Breadcrumbs } = mod.__test
const { localClock, localStamp } = mod.__test
const crumbs = render('breadcrumbs', () =>
  Breadcrumbs({ t, trail: [{ label: 'panel.title', onSelect: noop }, { label: 'form.new' }] }),
)
if (crumbs) {
  const nav = collect(crumbs, (node) => node.type === 'nav')
  const links = collect(crumbs, (node) => node.type === 'button' && node.props.className === 'dbmcp-crumb')
  const current = collect(crumbs, (node) => node.type === 'span' && node.props.className === 'dbmcp-crumb is-current')
  check('breadcrumbs: nav rendered', nav.length === 1)
  check('breadcrumbs: root step is a button', links.length === 1)
  check('breadcrumbs: current step is plain text', current.length === 1)
}

// src/tools.js renderer: a write has no result set, so its one-line summary must
// report the affected rows instead of a misleading "0 row(s)".
const { renderResult } = await import('../src/tools.js')
const writeText = renderResult({ ok: true, sql: 'update t set a = 1', columns: [], rows: [], rowCount: 0, affectedRows: 2, elapsedMs: 7 })
check('renderer: write reports affected rows', writeText === 'ok: 2 row(s) affected, 7ms', writeText)
const readText = renderResult({ ok: true, sql: 'select 1 as n', columns: ['n'], rows: [[1]], rowCount: 1, elapsedMs: 1 })
check('renderer: select keeps the table shape', readText.startsWith('n\n') && readText.endsWith('(1 row(s), 1ms)'), readText)
const ddlText = renderResult({ ok: true, sql: 'insert into t values (1)', columns: [], rows: [], rowCount: 0, elapsedMs: 2 })
check('renderer: a write without a rowcount still renders as a result set', ddlText.includes('(0 row(s), 2ms)'), ddlText)

// The audit card may hold entries from earlier days, so a bare clock is not enough.
const clock = localClock('2026-11-09T11:29:38.782Z')
check('audit clock carries the date', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(clock), clock)
const stamp = localStamp('2026-11-09T11:29:38.782Z')
check('audit stamp appends the zone', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC[+-]\d{2}:\d{2}$/.test(stamp), stamp)
check('audit clock survives a malformed stamp', localClock('not-a-date') === 'not-a-date', localClock('not-a-date'))

// The list strip classifies rows by their last stored probe, so the classifier
// has to treat "never probed" and "probe ok" very differently from a failure.
const { kindBadge, probeFailed, sourceMatches, probeReport, reportTarget } = mod.__test
const { sectionOrder } = mod.__test
const looseRow = [{ id: 'sq', name: 'Chinook', kind: 'sqlite', group: '' }]
const groupedRow = [{ id: 'pg', name: 'pg', kind: 'postgres', group: 'docker' }]
check('sections: the ungrouped filter still finds its rows', sectionOrder(['docker'], looseRow, true).join('|') === '')
check(
  'sections: a filtered group list drops empty groups',
  sectionOrder(['docker', 'staging'], groupedRow, true).join('|') === 'docker',
)
check(
  'sections: the whole list keeps every group plus ungrouped',
  sectionOrder(['docker'], groupedRow, false).join('|') === 'docker|',
)
check('status: a failed probe is a failure', probeFailed({ lastProbe: { ok: false } }) === true)
check('status: a healthy probe is not a failure', probeFailed({ lastProbe: { ok: true } }) === false)
check('status: an untested source is not a failure', probeFailed({}) === false)

const mysqlReport = probeReport(
  {
    id: 'mysql',
    name: 'mysql',
    kind: 'mysql',
    target: '127.0.0.1:3306 / demo',
    readOnly: false,
    lastProbe: { ok: false, message: 'MySQL connection failed: (2003, ...)', at: '2026-11-09T13:41:06.000Z' },
  },
  { name: 'dsh-db-mcp', version: '0.7.5' },
)
check('report: the target loses the spaces around the slash', reportTarget({ target: '127.0.0.1:3306 / demo' }) === '127.0.0.1:3306/demo', JSON.stringify(reportTarget({ target: '127.0.0.1:3306 / demo' })))
check('report: a file target is left alone', reportTarget({ target: 'C:\\data\\app.db' }) === 'C:\\data\\app.db')
check('report: the target line is the compact form', mysqlReport.includes('target: 127.0.0.1:3306/demo'), mysqlReport)
check('report: it carries the error verbatim', mysqlReport.includes('error: MySQL connection failed: (2003, ...)'), mysqlReport)
check('report: it carries the plugin version', mysqlReport.includes('plugin: dsh-db-mcp 0.7.5'), mysqlReport)
check('report: it carries the source id once', mysqlReport.split('\n').filter((line) => line.startsWith('id: ')).length === 1, mysqlReport)
const pgBadge = kindBadge('postgres')
check('status: engine badge keeps its brand colour', pgBadge.label === 'PG' && pgBadge.color === '#336791', JSON.stringify(pgBadge))
const oddBadge = kindBadge('duckdb')
check('status: unknown engines still get a badge', oddBadge.label === 'DU' && typeof oddBadge.color === 'string', JSON.stringify(oddBadge))

// The identifier is what MCP tools take as `datasource`, so the row shows it as
// a labelled chip that copies the bare id — not a tail on the target string.
const { IdChip } = mod.__test
let copiedArg = null
const idChip = IdChip({ t, id: 'chinook', copied: false, onCopy: (value) => { copiedArg = value } })
check('id chip: labelled with its own key', texts(idChip).includes('sources.idChip'), texts(idChip).join('|'))
check('id chip: carries the identifier verbatim', texts(idChip).includes('chinook'), texts(idChip).join('|'))
check(
  'id chip: the tooltip names the datasource role',
  String(idChip.props.title).includes('sources.idChipHint') && String(idChip.props.title).includes('chinook'),
  String(idChip.props.title),
)
idChip.props.onClick({ stopPropagation: noop })
check('id chip: a click copies the bare id', copiedArg === 'chinook', String(copiedArg))
const copiedIdChip = IdChip({ t, id: 'chinook', copied: true, onCopy: noop })
check(
  'id chip: the copied state is visible',
  /is-copied/.test(String(copiedIdChip.props.className)) && texts(copiedIdChip).includes('✓'),
  String(copiedIdChip.props.className),
)
check('id chip: an empty id renders nothing', IdChip({ t, id: '', onCopy: noop }) === null)
const sample = { name: 'mysql', id: 'mysql', kind: 'mysql', target: '127.0.0.1:3306 / demo', group: 'docker', lastProbe: { ok: false, message: 'WinError 10061' } }
check('status: search matches the name', sourceMatches(sample, 'mys') === true)
check('status: search matches the target', sourceMatches(sample, '3306') === true)
check('status: search matches the probe message', sourceMatches(sample, '10061') === true)
check('status: search drops non-matches', sourceMatches(sample, 'oracle') === false)
check('status: an empty search keeps everything', sourceMatches(sample, '   ') === true)

const { StatusStrip } = mod.__test
const stripTree = render('status strip', () =>
  StatusStrip({
    t,
    data: { mcp: { phase: 'ready' }, plugin: { version: '0.7.5' } },
    sources: [
      { id: 'pg', name: 'PostgreSQL demo', kind: 'postgres', group: 'docker', lastProbe: { ok: true } },
      { id: 'my', name: 'mysql', kind: 'mysql', group: 'docker', lastProbe: { ok: false, message: 'WinError 10061' } },
      { id: 'sq', name: 'Chinook', kind: 'sqlite', group: '', lastProbe: { ok: true } },
    ],
    failedSources: [{ id: 'my', name: 'mysql' }],
    groupNames: ['docker'],
    filter: 'all',
    setFilter: noop,
    query: '',
    setQuery: noop,
  }),
)
if (stripTree) {
  const chips = collect(stripTree, (node) => node.type === 'button' && String(node.props.className).startsWith('dbmcp-chip'))
  const labelOf = (chip) => String((chip.children || []).find((child) => typeof child === 'string') || '')
  const countOf = (chip) =>
    String(
      ((chip.children || []).filter((child) => child && typeof child === 'object' && /dbmcp-chip-count/.test(String(child.props.className)))[0] || { children: [] })
        .children[0] || '',
    )
  const labels = chips.map(labelOf)
  check('strip: one chip per group plus all and failures', labels.join('|') === 'filter.all|docker|group.unassigned|filter.failed', labels.join('|'))
  check(
    'strip: chips carry counts',
    chips.map(countOf).join(',') === '3,2,1,1',
    chips.map(countOf).join(','),
  )
  check('strip: the failure chip is flagged', /is-warn/.test(String(chips[3].props.className)))
  const labelsText = texts(stripTree)
  check('strip: reports the failure count', labelsText.includes('status.failing'), labelsText.join('|'))
  // Totals, healthy and failing live inside one outlined pill, not three loose spans.
  const stats = collect(stripTree, (node) => node.props.className === 'dbmcp-stats')
  const statParts = stats.length === 1 ? collect(stats[0], (node) => /dbmcp-stat( |$)/.test(String(node.props.className)) && !/sep/.test(String(node.props.className))) : []
  check('strip: the three counters share one pill', statParts.length === 3, `stats=${stats.length} parts=${statParts.length}`)
  check('strip: search box present', collect(stripTree, (node) => node.type === 'input').length === 1)
  // The masthead already carries the version, so the strip must not repeat it.
  const versionPill = collect(stripTree, (node) => node.props.className === 'dbmcp-pill')
  check('strip: no repeated version pill', versionPill.length === 0, `got ${versionPill.length}`)
}

// Palette assertions: custom themes may hand us translucent tokens (a wallpaper
// shines through), so the panel composites them into opaque colours.
const paletteOf = mod.__test.paletteOf
const parseColor = mod.__test.parseColor
const HEX = /^#[0-9a-f]{6}$/
const luma = (hex) => {
  const n = Number.parseInt(hex.slice(1), 16)
  return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)
}

if (typeof paletteOf !== 'function' || typeof parseColor !== 'function') {
  check('palette: exported for testing', false, 'paletteOf/parseColor missing')
} else {
  // A translucent wallpaper theme: every background arrives with alpha < 1.
  const wallpaper = {
    active: {
      id: 'wallpaper',
      colorScheme: 'dark',
      tokens: {
        '--dsw-alias-bg-base': 'rgba(20, 24, 31, 0.35)',
        '--dsw-alias-bg-layer-1': 'rgba(255, 255, 255, 0.06)',
        '--dsw-alias-bg-layer-2': 'rgba(255, 255, 255, 0.12)',
        '--dsw-alias-border-l1': 'rgba(255, 255, 255, 0.14)',
        '--dsw-alias-label-primary': 'rgba(255, 255, 255, 0.92)',
        '--dsw-alias-brand-primary': 'rgba(90, 160, 255, 0.8)',
      },
    },
    revision: 7,
  }
  const palette = paletteOf(wallpaper)
  const opaque = Object.entries(palette).filter(([, value]) => !HEX.test(String(value)))
  check('palette: every alias resolves to an opaque hex', opaque.length === 0, JSON.stringify(opaque))
  check('palette: covers the aliases the stylesheet reads', Object.keys(palette).length >= 12, `${Object.keys(palette).length}`)
  check('palette: a translucent canvas is flattened, not dropped', luma(palette['--dsw-alias-bg-base']) < 60, palette['--dsw-alias-bg-base'])
  check(
    'palette: layers stay distinguishable from the canvas',
    palette['--dsw-alias-bg-layer-1'] !== palette['--dsw-alias-bg-base'] &&
      palette['--dsw-alias-bg-layer-2'] !== palette['--dsw-alias-bg-layer-1'],
    `${palette['--dsw-alias-bg-base']} / ${palette['--dsw-alias-bg-layer-1']} / ${palette['--dsw-alias-bg-layer-2']}`,
  )
  check('palette: secondary ink is dimmer than primary', luma(palette['--dsw-alias-label-secondary']) < luma(palette['--dsw-alias-label-primary']))

  // Pure black: the theme offers no layer colours at all, so they are lifted.
  const black = paletteOf({ active: { id: 'black', colorScheme: 'dark', tokens: {} }, revision: 1 })
  check('palette: pure black keeps the page near-black', luma(black['--dsw-alias-bg-base']) < 16, black['--dsw-alias-bg-base'])
  check(
    'palette: pure black still separates cards',
    luma(black['--dsw-alias-bg-layer-1']) > luma(black['--dsw-alias-bg-base']) + 8,
    `${black['--dsw-alias-bg-base']} -> ${black['--dsw-alias-bg-layer-1']}`,
  )
  check(
    'palette: pure black borders are visible',
    luma(black['--dsw-alias-border-l1']) > luma(black['--dsw-alias-bg-layer-1']) + 8,
    `${black['--dsw-alias-bg-layer-1']} vs ${black['--dsw-alias-border-l1']}`,
  )

  // Pure white: the same lift, in the other direction.
  const white = paletteOf({ active: { id: 'white', colorScheme: 'light', tokens: {} }, revision: 2 })
  check('palette: pure white keeps the page white', luma(white['--dsw-alias-bg-base']) > 247, white['--dsw-alias-bg-base'])
  check(
    'palette: pure white still separates cards',
    luma(white['--dsw-alias-bg-layer-1']) < luma(white['--dsw-alias-bg-base']) - 4,
    `${white['--dsw-alias-bg-base']} -> ${white['--dsw-alias-bg-layer-1']}`,
  )
  check('palette: parseColor understands the shapes themes send', ['#abc', '#aabbcc', 'rgb(1, 2, 3)', 'rgba(1, 2, 3, 0.5)'].every((value) => parseColor(value) !== null))
}

const total = passed + failures.length
if (failures.length > 0) {
  console.log(`render.test: ${passed}/${total} passed`)
  for (const failure of failures) console.log(`  FAIL ${failure}`)
  process.exit(1)
}
console.log(`render.test: ${passed}/${total} passed`)
