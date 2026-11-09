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
}

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

const total = passed + failures.length
if (failures.length > 0) {
  console.log(`render.test: ${passed}/${total} passed`)
  for (const failure of failures) console.log(`  FAIL ${failure}`)
  process.exit(1)
}
console.log(`render.test: ${passed}/${total} passed`)
