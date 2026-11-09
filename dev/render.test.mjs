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
    const found = collect(tree, (node) => node.type === 'label' && String(node.children[0]) === label)
    check(`${name}: label ${label}`, found.length > 0)
  }
  return tree
}

const noop = () => {}

const sqliteTree = render(
  'create form (sqlite)',
  () => SourceForm({ t, draft: emptyDraft(), editing: null, takenIds: [], onSaved: noop, onCancel: noop }),
  {
    inputs: 9,
    selects: 1,
    details: true,
    labels: ['form.paste', 'form.user', 'form.password', 'form.file'],
  },
)
if (sqliteTree) {
  const summary = collect(sqliteTree, (node) => node.type === 'summary')
  check('create form: more-settings summary', summary.length === 1 && String(summary[0].children[0]) === 'form.more')
}

const pgDraft = emptyDraft()
pgDraft.kind = 'postgres'
pgDraft.config = { ...pgDraft.config, host: 'localhost', port: '5432', database: 'app', user: 'alice' }
render(
  'create form (postgres)',
  () => SourceForm({ t, draft: pgDraft, editing: null, takenIds: ['app'], onSaved: noop, onCancel: noop }),
  { inputs: 12, selects: 2, details: true, labels: ['form.host', 'form.port', 'form.database'] },
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
  check('main panel: five tabs', tabs.length === 5, String(tabs.length))
  check(
    'main panel: first tab is active',
    tabs.length === 5 && tabs[0].props['aria-selected'] === true && tabs[1].props['aria-selected'] === false,
  )
  const back = collect(panel, (node) => node.type === 'button' && node.props.className === 'dbmcp-back')
  check('main panel: back-to-chat button', back.length === 1, String(back.length))
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
const { groupTables, tableMatches, connectionMatches } = mod.__test
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
const { kindBadge, probeFailed, sourceMatches } = mod.__test
check('status: a failed probe is a failure', probeFailed({ lastProbe: { ok: false } }) === true)
check('status: a healthy probe is not a failure', probeFailed({ lastProbe: { ok: true } }) === false)
check('status: an untested source is not a failure', probeFailed({}) === false)
const pgBadge = kindBadge('postgres')
check('status: engine badge keeps its brand colour', pgBadge.label === 'PG' && pgBadge.color === '#336791', JSON.stringify(pgBadge))
const oddBadge = kindBadge('duckdb')
check('status: unknown engines still get a badge', oddBadge.label === 'DU' && typeof oddBadge.color === 'string', JSON.stringify(oddBadge))
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

const total = passed + failures.length
if (failures.length > 0) {
  console.log(`render.test: ${passed}/${total} passed`)
  for (const failure of failures) console.log(`  FAIL ${failure}`)
  process.exit(1)
}
console.log(`render.test: ${passed}/${total} passed`)
