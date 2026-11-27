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
    inputs: 9,
    selects: 1,
    details: true,
    labels: ['form.paste', 'form.user', 'form.password', 'form.file'],
  },
)
if (sqliteTree) {
  const summary = collect(sqliteTree, (node) => node.type === 'summary')
  check('create form: more-settings summary', summary.length === 1 && texts(summary[0]).includes('form.more'))
  check('create form: smart-parsing tag', texts(sqliteTree).includes('form.smart'))
  check('create form: footer hint', texts(sqliteTree).includes('form.autoApply'))
  check('create form: DDL is its own switch', texts(sqliteTree).includes('form.allowDdl'))
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
  check('main panel: ten tabs', tabs.length === 10, String(tabs.length))
  check(
    'main panel: first tab is active',
    tabs.length === 10 && tabs[0].props['aria-selected'] === true && tabs[1].props['aria-selected'] === false,
  )
  check(
    'main panel: the tools tab is its own step',
    mod.__test.TABS.some((tab) => tab.id === 'tools') && mod.__test.tabLabel((key) => key, 'tools') === 'tab.tools',
  )
  const order = mod.__test.TABS.map((tab) => tab.id)
  check(
    'main panel: the endpoint tab sits before the runtime tab',
    order.indexOf('clients') + 1 === order.indexOf('runtime'),
    order.join(','),
  )
  check(
    'main panel: the trace tab sits before the endpoint tab',
    order.indexOf('trace') + 1 === order.indexOf('clients'),
    order.join(','),
  )
  check(
    'main panel: the tabs line up left to right',
    tabs.length === 10 && tabs.map((node) => texts(node).join('')).join(',') === order.map((id) => `tab.${id}`).join(','),
    tabs.map((node) => texts(node).join('')).join(','),
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

// The panel comes back where it was left. Node has no localStorage, so a
// minimal one is installed for these checks and removed afterwards; the
// storage layer must work with whatever the browser hands it.
const { readPanel, writePanel, forgetPanel, draftForStorage, rawForStorage, createDraftFrom } = mod.__test
const { keepResult, readResult } = mod.__test
if (typeof readPanel !== 'function' || typeof writePanel !== 'function' || typeof keepResult !== 'function') {
  check('panel memory: exported for testing', false, 'storage helpers missing')
} else {
  check('panel memory: no storage means an empty memory, not a crash', JSON.stringify(readPanel()) === '{}')
  check(
    'panel memory: a draft is stored without its password',
    (draftForStorage({ ...emptyDraft(), password: 'hunter2' }) || {}).password === '',
  )
  check(
    'panel memory: a pasted string that carries a password is not stored',
    rawForStorage('postgres://alice:hunter2@db:5432/app') === '',
  )
  const plainUrl = 'postgres://db:5432/app'
  check('panel memory: a pasted string without a password is kept', rawForStorage(plainUrl) === plainUrl)

  const bag = new Map()
  globalThis.localStorage = {
    getItem: (key) => (bag.has(key) ? bag.get(key) : null),
    setItem: (key, value) => bag.set(key, String(value)),
    removeItem: (key) => bag.delete(key),
  }
  writePanel({ tab: 'list', query: 'SO-1001' })
  check(
    'panel memory: values are written under one key',
    bag.size === 1 && JSON.parse([...bag.values()][0]).query === 'SO-1001',
  )
  /* The list page only renders its strip once the sources have loaded, so the
     seeded search text is checked in the source rather than in a tree. */
  check(
    'panel memory: the list page seeds its search and filter from memory',
    /const \[query, setQuery\] = React\.useState\(\(\) => String\(savedPanel\.query \|\| ''\)\)/.test(source) &&
      /const \[filter, setFilter\] = React\.useState\(\(\) => String\(savedPanel\.filter \|\| 'all'\)\)/.test(source) &&
      /Array\.isArray\(savedPanel\.collapsed\)/.test(source),
  )
  writePanel({ tab: 'trace' })
  const reopened = render('main panel', () => MainPanel({ t: (key) => key, useResource: undefined, useWorkspaces: undefined }))
  if (reopened) {
    const reopenedTabs = collect(reopened, (node) => node.type === 'button' && node.props.role === 'tab')
    const traceTab = reopenedTabs.find((node) => texts(node).join('') === 'tab.trace')
    check(
      'panel memory: the tab it was left on is the one that opens',
      Boolean(traceTab) && traceTab.props['aria-selected'] === true,
      JSON.stringify(reopenedTabs.map((node) => [texts(node).join(''), node.props['aria-selected']])),
    )
  }
  writePanel({ tab: 'no-such-tab' })
  const fallback = render('main panel', () => MainPanel({ t: (key) => key, useResource: undefined, useWorkspaces: undefined }))
  if (fallback) {
    const fallbackTabs = collect(fallback, (node) => node.type === 'button' && node.props.role === 'tab')
    check('panel memory: a tab that no longer exists falls back to the list', fallbackTabs[0].props['aria-selected'] === true)
  }
  writePanel({ createDraft: { ...emptyDraft(), name: 'typed-but-unsaved' } })
  check(
    'panel memory: the half-typed new source is laid over a fresh draft',
    createDraftFrom(emptyDraft()).name === 'typed-but-unsaved',
  )
  forgetPanel('createDraft')
  check('panel memory: forgetting one slice keeps the rest', readPanel().tab === 'no-such-tab' && !('createDraft' in readPanel()))

  /* A result is kept in the module's memory, never in the browser store: it is
     derived data that carries somebody's rows. These checks pin both halves of
     that rule — the last answer comes back, and no row is ever written down. */
  keepResult('trace', { steps: [{ table: 't_order', rows: 1 }], summary: { steps: 1 } })
  const kept = readResult('trace')
  check(
    'panel memory: the last answer survives the panel being reopened',
    kept && kept.steps.length === 1 && kept.summary.steps === 1,
  )
  check(
    'panel memory: an empty answer clears the last one instead of keeping it',
    (keepResult('trace', null), readResult('trace') === null),
  )
  check(
    'panel memory: results are never written to the browser store',
    ![...bag.values()].some((value) => value.includes('t_order')) &&
      !('trace' in readPanel()) &&
      !('graph' in readPanel()),
  )
  check(
    'panel memory: both result pages seed themselves from memory',
    /const \[graph, setGraphState\] = React\.useState\(\(\) => readResult\('graph'\)\)/.test(source) &&
      /const \[trace, setTraceState\] = React\.useState\(\(\) => readResult\('trace'\)\)/.test(source) &&
      !/const \[trace, setTrace\] = React\.useState\(null\)/.test(source) &&
      !/const \[graph, setGraph\] = React\.useState\(null\)/.test(source),
  )
  delete globalThis.localStorage
}

/* Select-all works on what the search box and the filter chip left on screen,
   not on every row in the file: a narrowed list must not quietly select sources
   the reader cannot see. The rule runs inside MainPanel's closure, so it is
   pinned in the source the way the other list-page rules are. */
check(
  'list page: select all takes the visible rows, never the hidden ones',
  /const visibleIds = visibleSources\.map\(\(source\) => source\.id\)/.test(source) &&
    /const allVisible = visibleIds\.length > 0 && visibleIds\.every\(\(id\) => selected\.includes\(id\)\)/.test(source) &&
    /setSelected\(allVisible \? \[\] : visibleIds\.slice\(\)\)/.test(source),
)
check(
  'list page: the select-all button says how many it will take',
  /title: allVisible \? t\('sources\.selectNone'\) : fmt\(t\('sources\.selectAll'\), \{ n: visibleIds\.length \}\)/.test(source) &&
    /disabled: visibleIds\.length === 0/.test(source) &&
    /allVisible \? t\('sources\.selectNone'\) : fmt\(t\('sources\.selectAll'\), \{ n: visibleIds\.length \}\)/.test(source),
)

check(
  'trace page: saving a walk as a scene sends the note the form asked for',
  /const saveTraceAsScene = async \(name, tables, note\) => \{/.test(source) &&
    /note: String\(note \|\| ''\)\.trim\(\),/.test(source) &&
    /saveTraceAsScene\(traceSceneDraft\.name, traceSceneTables, traceSceneDraft\.note\)/.test(source),
)
check(
  'trace page: a walk that names an existing scene says it will overwrite it',
  /const draftOverwrite =/.test(source) &&
    /t\('scene\.overwrites'\)/.test(source) &&
    /draftOverwrite \? t\('scene\.overwrite'\) : t\('scene\.save'\)/.test(source),
)

/* The Scenes tab edits a membership list and nothing else. These rules are the
   ones a future reader would break by accident — writing an edge into the scene
   file, deleting the scene together with its joins, or hiding the panel's only
   way to connect two members — so they are pinned in the source. */
const sceneCard = source.slice(source.indexOf('const renderScenes = () =>'), source.indexOf('const renderTrace = () =>'))
const sceneLogic = source.slice(source.indexOf('const loadSceneRows ='), source.indexOf('const renderScenes = () =>'))
check('scenes page: it is its own tab between relations and the walk', /tab !== 'scenes' \? null : renderScenes\(\)/.test(source))
check(
  'scenes page: the tab sits between relations and the walk',
  (() => {
    const order = mod.__test.TABS.map((tab) => tab.id)
    return order.indexOf('scenes') + 1 === order.indexOf('trace') && order.indexOf('scenes') - 1 === order.indexOf('graph')
  })(),
  mod.__test.TABS.map((tab) => tab.id).join(','),
)
check(
  'scenes page: adding a join goes to the relation graph, never into the scene',
  /const openInGraph = \(edgeId, preset\) => \{/.test(source) &&
    /setView\(\{ mode: 'graph' \}\)/.test(source) &&
    /setGraphForm\(preset \|\| null\)/.test(source) &&
    /apiPost\('\/scenes\/save', \{[^}]*tables/s.test(sceneLogic) &&
    !/apiPost\('\/relations\/propose'/.test(sceneLogic),
)
check(
  'scenes page: deleting says the joins stay',
  /t\('scene\.deleteNote'\)/.test(sceneCard) && /'scene\.deleteNote'/.test(source),
)
check(
  'scenes page: the isolated group is absent when no member is stranded',
  /const isolatedBlock = isolated\.length === 0\s*\n?\s*\? null/.test(sceneCard),
)
check(
  'scenes page: a rename keeps the id so it cannot fork a second scene',
  /scene_id: draft\.id \|\| undefined/.test(sceneLogic) && /name,/.test(sceneLogic),
)
check(
  'scenes page: the rail scrolls instead of stretching the page',
  /\.dbmcp-scene-list \{[\s\S]{0,220}max-height: 420px;[\s\S]{0,80}overflow: auto;/.test(source),
)
check(
  'scenes page: a new draft is not cleared by the row it is not following',
  /const \[sceneNew, setSceneNew\] = React\.useState\(false\)/.test(source) &&
    /if \(sceneNew\) return/.test(sceneLogic) &&
    /setSceneNew\(true\)/.test(source),
)
check(
  'scenes page: a cleared note is sent as an empty string, so it can be removed',
  /note: String\(draft\.note \|\| ''\)\.trim\(\),/.test(sceneLogic) &&
    !/note: String\(draft\.note \|\| ''\)\.trim\(\) \|\| undefined/.test(sceneLogic),
)
check(
  'scenes page: a join opens the row it names on the relation graph',
  /id: `dbmcp-edge-\$\{edge\.id\}`/.test(source) &&
    /document\.getElementById\(`dbmcp-edge-\$\{edgeId\}`\)/.test(source) &&
    /scrollIntoView\(\{ block: 'center', behavior: 'smooth' \}\)/.test(source) &&
    /setGraphOpen\(edgeId \|\| ''\)/.test(source),
)
check(
  'scenes page: every scene button names itself for a screen reader',
  /'aria-label': `\$\{scene\.name\} — \$\{fmt\(t\('trace\.sceneTables'\), \{ n: scene\.tableCount \}\)\}`/.test(sceneCard) &&
    /'aria-label': `\$\{t\('scene\.removeTable'\)\}: \$\{table\}`/.test(sceneCard) &&
    /'aria-label': `\$\{t\('scene\.addLink'\)\}: \$\{table\}`/.test(sceneCard),
)
check(
  'scenes page: a stranded member says whether its joins leave the scene',
  /t\('scene\.noJoinAtAll'\)/.test(sceneCard) &&
    /t\('scene\.joinsOutside'\)/.test(sceneCard) &&
    /fmt\(t\('scene\.adopt'\), \{ n: name \}\)/.test(sceneCard) &&
    /outsideOf = \(table\) =>/.test(sceneCard),
)
check(
  'scenes page: adopting a table saves the membership list, never an edge',
  /const adoptIntoScene = async \(table\) =>/.test(sceneLogic) &&
    /apiPost\('\/scenes\/save', \{/.test(sceneLogic) &&
    !/adoptIntoScene[\s\S]{0,400}relations\/propose/.test(sceneLogic),
)
check(
  'scenes page: a wide catalogue is capped and the rest are counted',
  /const CATALOG_LIMIT = 20/.test(sceneCard) &&
    /catalogue\.slice\(0, CATALOG_LIMIT\)/.test(sceneCard) &&
    /fmt\(t\('scene\.moreTables'\), \{ n: hiddenCount \}\)/.test(sceneCard),
)
check(
  'scenes page: the join path wraps at narrow width instead of ellipsis',
  /\.dbmcp-scene-link \.dbmcp-edge-path \{[\s\S]{0,220}overflow-wrap: anywhere;/.test(source) &&
    !/\.dbmcp-scene-link \.dbmcp-edge-path \{[\s\S]{0,220}text-overflow: ellipsis/.test(source),
)
check(
  'scenes page: a jumped-to join is visibly focused',
  /\$\{open \? ' is-focus' : ''\}/.test(source) &&
    /\.dbmcp-edge\.is-focus \{[\s\S]{0,160}outline: 2px solid var\(--dsw-alias-brand-primary\)/.test(source),
)
check(
  'trace page: the save-as button steps aside once its form is open',
  /traceSceneDraft\s*\n\s*\? null\s*\n\s*: h\(/.test(source) &&
    /'aria-label': t\('scene\.saveAs'\)/.test(source),
)


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
// The form row sizes itself against the panel, not the viewport: before the
// container query below existed, the two- and three-column rows ran past the
// right edge of a narrow sidebar and their right-hand fields were cut off.
const formRule = source.slice(source.indexOf('.dbmcp-form.is-page {'), source.indexOf('.dbmcp-form.is-page {') + 700)
check('source form: it is its own container', formRule.includes('container-type: inline-size'), formRule.slice(0, 90))
check(
  'source form: wide rows fold to one column',
  /@container \(max-width: 560px\) \{\s*\.dbmcp-form-section\.is-two,\s*\.dbmcp-form-section\.is-three \{\s*grid-template-columns: minmax\(0, 1fr\)/
    .test(source),
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

// The scene page offers join candidates from column names and types only — it
// never reads rows. These four cases are the whole contract a reader relies on.
const { foldName, columnFamily, typesJoin, linkCandidates } = mod.__test
const col = (name, type) => ({ name, type })
check('scene join: a column family is read from the type', columnFamily('character varying(16)') === 'text' && columnFamily('numeric(12,2)') === 'number' && columnFamily('') === 'any')
check(
  'scene join: a name matches across case and spelling',
  linkCandidates([col('Order_No', 'varchar(16)')], [{ table: 'payment', columns: [col('order_no', 'character varying(16)')] }]).length === 1,
)
check(
  'scene join: a type mismatch is never suggested',
  linkCandidates([col('order_no', 'varchar(16)')], [{ table: 'payment', columns: [col('order_no', 'integer')] }]).length === 0,
)
check(
  'scene join: no shared name means no candidate',
  linkCandidates([col('id', 'integer')], [{ table: 'payment', columns: [col('order_no', 'varchar(16)')] }]).length === 0,
)
check(
  'scene join: more than five candidates are cut to five',
  linkCandidates(
    Array.from({ length: 8 }, (_, index) => col(`k${index}`, 'varchar(16)')),
    [{ table: 'other', columns: Array.from({ length: 8 }, (_, index) => col(`K${index}`, 'text')) }],
  ).length === 5,
)
// `id` / `created_at` are on nearly every table: matching them would suggest a
// join between unrelated rows. A prefixed business key stays eligible.
const generic = ['id', 'code', 'name', 'status', 'type', 'created_at', 'updated_at']
for (const name of generic) {
  check(
    `scene join: generic column ${name} is not a candidate`,
    linkCandidates([col(name, 'varchar(32)')], [{ table: 'other', columns: [col(name.toUpperCase(), 'text')] }]).length === 0,
  )
}
check(
  'scene join: a prefixed business key is still a candidate',
  linkCandidates([col('order_id', 'integer')], [{ table: 'other', columns: [col('ORDER_ID', 'bigint')] }]).length === 1,
)
check('scene join: the folded name is case-insensitive', foldName(' Order_NO ') === 'order_no')

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
  /\.dbmcp-switch\.is-on \.dbmcp-switch-knob \{[^}]*transform: translateX\(16px\)/.test(source),
)
check(
  'row switch: a keyboard focus ring lands on the track',
  /\.dbmcp-switch:focus-visible \.dbmcp-switch-track \{[^}]*outline: 2px solid/.test(source),
)
check(
  'row switch: the track is a 36x20 capsule',
  /\.dbmcp-switch-track \{[^}]*width: 36px[^}]*height: 20px/.test(source),
)
check(
  'row switch: the on-track is ink, not the brand colour',
  /\.dbmcp-switch\.is-on \.dbmcp-switch-track \{[^}]*background: var\(--dsw-alias-label-primary\)/.test(source),
)
check(
  'row notes: state words are frameless text',
  /\.dbmcp-note \{[^}]*border: 0/.test(source) || !/\.dbmcp-note \{[^}]*border: 1px/.test(source),
)
check('row pills: no clickable pill rule is left', !/button\.dbmcp-pill \{/.test(source))

// The switch is checked for "writable" while the API takes a `readOnly` flag,
// so the value POSTed is the opposite of the stored one. 0.9.9 shipped the
// un-inverted value and the switch became a no-op ("可写切换不了").
const { nextReadOnly } = mod.__test
check(
  'row switch: clicking a read-only source asks to unlock it',
  nextReadOnly({ readOnly: true }) === false,
  String(nextReadOnly({ readOnly: true })),
)
check(
  'row switch: clicking a writable source asks to lock it',
  nextReadOnly({ readOnly: false }) === true,
  String(nextReadOnly({ readOnly: false })),
)
check(
  'row switch: a source with no flag counts as read-only',
  nextReadOnly({}) === false,
  String(nextReadOnly({})),
)

// A 2px underline under one of eight same-coloured words was too weak a signal
// for "this is the page you are on", so the active tab fills in as well.
const tabRule = source.slice(source.indexOf('      .dbmcp-tab {'), source.indexOf('      .dbmcp-sub {'))
check(
  'panel tabs: the active tab is filled, not just underlined',
  /\.dbmcp-tab\.is-active \{[^}]*background: color-mix\(in srgb, var\(--dsw-alias-brand-primary\)/.test(tabRule),
)
check(
  'panel tabs: the active tab takes brand ink and weight',
  /\.dbmcp-tab\.is-active \{[^}]*color: var\(--dsw-alias-brand-primary\)[^}]*font-weight: 600/.test(tabRule),
)
check('panel tabs: the old underline is gone', !/\.dbmcp-tab \{[^}]*border-bottom: 2px solid transparent/.test(tabRule))
check(
  'panel tabs: hovering a tab tints it without borrowing the active fill',
  /\.dbmcp-tab:hover:not\(\.is-active\) \{[^}]*background: color-mix\(in srgb, var\(--dsw-alias-label-primary\) 6%/.test(
    tabRule,
  ),
)
// Scrolling sideways hid the last tab instead of clipping it, and a partly
// scrolled strip cut the active pill in half. The row wraps so nothing is lost.
const tabsRule = source.slice(source.indexOf('      .dbmcp-tabs {'), source.indexOf('      .dbmcp-tab {'))
check('panel tabs: the row wraps instead of scrolling', /flex-wrap: wrap/.test(tabsRule), tabsRule.slice(0, 80))
check('panel tabs: nothing can scroll out of view', !/overflow-x: auto/.test(tabsRule))
check(
  'panel tabs: the pills keep a gap so two fills never touch',
  /gap: 6px 8px/.test(tabsRule),
  (tabsRule.match(/gap: [^;]+/) || [''])[0],
)
// The first tab used to zero its left padding so its word lined up with the
// heading — correct while the active state was a bare underline, wrong once that
// word sat inside a filled pill, where it jammed the text against a square edge.
// It was then pulled left by one padding, which moved the word onto the axis but
// hung the pill's fill 11px outside every other box on the page. The box aligns
// now; the word keeps its inset.
check(
  'panel tabs: the first pill box sits on the page axis',
  /\.dbmcp-tab:first-child \{[^}]*margin-left: 0/.test(tabRule) &&
    !/\.dbmcp-tab:first-child \{[^}]*padding-left: 0/.test(tabRule),
  (tabRule.match(/\.dbmcp-tab:first-child \{[^}]*\}/) || [''])[0].replace(/\s+/g, ' '),
)

// The audit statement is the payload of a row, not a caption beside the facts.
// These three keep it that way: its own surface, ink text, and a rule down the
// left edge that turns red when the call failed.
const auditSqlRule = source.slice(source.indexOf('      .dbmcp-audit-sql {'), source.indexOf('      .dbmcp-schema-wrap {'))
check('audit sql: it gets its own recessed block', /background: var\(--dsw-alias-bg-base\)/.test(auditSqlRule), auditSqlRule.slice(0, 120))
check('audit sql: it reads as primary ink, not a hint', /color: var\(--dsw-alias-label-primary\)/.test(auditSqlRule))
check('audit sql: a brand rule marks the left edge', /border-left: 3px solid color-mix\(in srgb, var\(--dsw-alias-brand-primary\)/.test(auditSqlRule))
check('audit sql: a failed call turns that rule red', /\.is-error \{[^}]*border-left-color: color-mix\(in srgb, var\(--dsw-alias-state-error-primary\)/.test(auditSqlRule))

// A shared endpoint is reached by the agent, the panel and outside clients, so a
// row has to say which one called. The caller rides beside the tool name and is
// quieter than it — the tool is what you scan, the caller is what you check after.
const auditClientRule = source.slice(source.indexOf('      .dbmcp-audit-client {'), source.indexOf('      .dbmcp-audit-ok {'))
check('audit caller: it renders beside the tool', /dbmcp-audit-client/.test(source) && /entry\.client/.test(source))
check('audit caller: it is quieter than the tool pill', /color: var\(--dsw-alias-label-secondary\)/.test(auditClientRule), auditClientRule.slice(0, 120))
check('audit caller: a long client name is cut, not wrapped', /text-overflow: ellipsis/.test(auditClientRule) && /white-space: nowrap/.test(auditClientRule))
check('audit caller: the meaning is on hover', /audit\.clientHint/.test(source))

// The log can hold up to 200 lines but the panel only shows a page at a time,
// so a "load more" button sits at the bottom until every entry is on screen.
check('audit paging: a load-more button is wired to a handler', /className: 'dbmcp-btn is-small dbmcp-audit-more'/.test(source) && /onClick: loadMoreAudit/.test(source))
check('audit paging: the button hides once every entry is shown', /audit\.entries\.length < audit\.total/.test(source))
check('audit paging: a page is fetched with a bounded limit', /const AUDIT_PAGE = 12/.test(source) && /Math\.min\(200, audit\.entries\.length \+ AUDIT_PAGE\)/.test(source))
check('audit paging: the button reports a busy state', /auditBusy \? t\('audit\.loadingMore'\) : t\('audit\.loadMore'\)/.test(source))

// Every outside client can be wired up either way: one button writes a stdio
// command entry, the other writes the shared HTTP endpoint. The chosen form is
// sent explicitly so the Host does not have to guess from the client's shape.
const clientsCard = source.slice(source.indexOf('const renderClientRow ='), source.indexOf('const renderTools = ()'))
check('clients: each row offers both a stdio and an HTTP button', /onClick: \(\) => configureClient\(client, 'stdio'\)/.test(clientsCard) && /onClick: \(\) => configureClient\(client, 'http'\)/.test(clientsCard))
check('clients: the chosen transport is sent to the Host', /apiPost\('\/clients\/configure', \{ client: client\.id, transport \}\)/.test(source))
check('clients: the busy state is per client and transport', /clientBusy === `\$\{client\.id\}:stdio`/.test(clientsCard) && /clientBusy === `\$\{client\.id\}:http`/.test(clientsCard))
check('clients: a configured row shows which transport it uses', /transportLabel\(client\.transport\)/.test(clientsCard) && /const transportLabel = \(transport\) =>\s*\n\s*transport === 'stdio' \? 'stdio' : String\(transport \|\| ''\)\.toUpperCase\(\)/.test(source))

// The tools card used to answer with a checkbox while every other on/off in the
// panel was a track switch. Same control now, so "on" looks the same everywhere;
// the checkbox class is gone rather than left behind unused.
const toolRule = source.slice(source.indexOf('      .dbmcp-tool {'), source.indexOf('      .dbmcp-card-head {'))
check('tools card: the checkbox styling is gone', !/\.dbmcp-tool-pick\s*\{/.test(source))
check(
  'tools card: the row switch reuses the panel switch',
  /\.dbmcp-tool \.dbmcp-switch \{/.test(toolRule),
  (toolRule.match(/\.dbmcp-tool \.dbmcp-switch \{[^}]*\}/) || [''])[0].replace(/\s+/g, ' '),
)
check('tools card: rows are the height of one line of text', /padding: 4px 9px/.test(toolRule), toolRule.slice(0, 60))
const toolsCard = source.slice(source.indexOf('const renderTools = ()'), source.indexOf('let body'))
check('tools card: each row flips through the switch component', /h\(Switch, \{/.test(toolsCard), toolsCard.slice(0, 60))
check('tools card: no checkbox input is left in the row', !/className: 'dbmcp-tool-pick'/.test(source))
// The list is the one setting on this page that an outside client never feels:
// the filter runs in the Host, so HTTP clients still see every tool. The card
// has to say that itself rather than rely on the safety page.
check(
  'tools card: it says the list is DSH-only',
  /className: 'dbmcp-hint is-scope' \}, t\('tools\.dshOnly'\)/.test(toolsCard),
)
check(
  'tools card: the DSH-only note names the other path',
  /tools\.dshOnly'/.test(source) &&
    /HTTP endpoint still sees every tool/.test(source) &&
    /接入 HTTP 端点的客户端仍然能看到全部工具/.test(source),
)

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

// describe_table also reports the join facts. They belong under the column list,
// not in a JSON blob the model has to parse.
const described = renderResult({
  ok: true,
  datasource: { id: 'chinook', kind: 'sqlite' },
  table: 'InvoiceLine',
  schema: 'main',
  comment: 'one row per sold item',
  rowEstimate: 2240,
  primaryKey: ['InvoiceLineId'],
  columns: [
    { name: 'InvoiceLineId', type: 'INTEGER', nullable: false, default: null, primaryKey: true },
    { name: 'TrackId', type: 'INTEGER', nullable: false, default: null, primaryKey: false, comment: 'which track' },
  ],
  foreignKeys: [{ column: 'TrackId', refTable: 'Track', refColumn: 'TrackId', name: null }],
  indexes: [{ name: 'IFK_InvoiceLineTrackId', columns: ['TrackId'], unique: false }],
})
check('renderer: describe names the table and its comment', described.includes('main.InvoiceLine') && described.includes('-- one row per sold item'), described)
check('renderer: describe shows the row estimate', described.includes('~2240 row(s) (estimate)'), described)
check('renderer: describe leaves joins to the relation graph', !described.includes('foreign keys:'), described)
check('renderer: describe lists indexes with their columns', described.includes('IFK_InvoiceLineTrackId (TrackId)'), described)
check('renderer: describe keeps the column comments', described.includes('-- which track'), described)
check('renderer: a describe with no keys does not print empty sections', !renderResult({ ok: true, table: 't', columns: [{ name: 'a', type: 'TEXT', nullable: true, primaryKey: false }], primaryKey: [], indexes: [], comment: null, rowEstimate: null }).includes('indexes:'))

const related = renderResult({
  ok: true,
  datasource: { id: 'shop', kind: 'sqlite' },
  edges: [
    {
      id: 'e_9c1f2a',
      from: { table: 'orders', column: 'customer_id' },
      to: { table: 'customers', column: 'id' },
      source: 'fk',
      status: 'confirmed',
      condition: null,
      stats: { confirmCount: 3, avgFanout: 1 },
    },
  ],
  counts: { pending: 2, confirmed: 1, trusted: 0, stale: 0, rejected: 1 },
  total: 1,
  truncated: false,
})
check('renderer: edges read as join paths', related.includes('orders.customer_id -> customers.id'), related)
check('renderer: an edge carries its source and status', related.includes('fk · confirmed'), related)
check('renderer: the edge header counts every status', related.includes('2 pending') && related.includes('1 rejected'), related)
check(
  'renderer: a filtered graph with no rows still counts what exists',
  renderResult({ ok: true, edges: [], counts: { pending: 2, confirmed: 0, trusted: 0, stale: 0, rejected: 0 }, total: 0, truncated: false }).startsWith('no edges match — 2 pending'),
)
check(
  'renderer: an empty graph points at discover_relations',
  renderResult({ ok: true, edges: [], counts: { pending: 0, confirmed: 0, trusted: 0, stale: 0, rejected: 0 }, total: 0, truncated: false }).includes('discover_relations'),
)
check(
  'renderer: an edge condition is shown with the path',
  renderResult({
    ok: true,
    edges: [
      {
        from: { table: 't_trans', column: 'order_id' },
        to: { table: 't_order', column: 'id' },
        source: 'manual',
        status: 'trusted',
        condition: "status = 'POSTED'",
        stats: {},
      },
    ],
    counts: { pending: 0, confirmed: 0, trusted: 1, stale: 0, rejected: 0 },
    total: 1,
    truncated: false,
  }).includes("when status = 'POSTED'"),
)

const feedback = renderResult({
  ok: true,
  previousStatus: 'pending',
  edge: {
    from: { table: 't_trans', column: 'order_id' },
    to: { table: 't_order', column: 'id' },
    source: 'fk',
    status: 'confirmed',
    stats: { confirmCount: 1, rejectCount: 0, avgFanout: 1, lastFailure: null },
  },
})
check('renderer: feedback reads as a status move', feedback.includes('fk · pending -> confirmed'), feedback)
check('renderer: feedback reports the counters it changed', feedback.includes('1 confirmed') && feedback.includes('fanout 1'), feedback)
check(
  'renderer: a rejection carries its reason',
  renderResult({
    ok: true,
    previousStatus: 'pending',
    edge: {
      from: { table: 'a', column: 'id' },
      to: { table: 'b', column: 'id' },
      source: 'manual',
      status: 'stale',
      stats: { confirmCount: 0, rejectCount: 1, lastFailure: { verdict: 'too_many', reason: 'not_unique' } },
    },
  }).includes('last failure: too_many (not_unique)'),
)
check(
  'renderer: proposing a new edge says it starts out pending',
  renderResult({
    ok: true,
    created: true,
    edge: {
      from: { table: 'a', column: 'id' },
      to: { table: 'b', column: 'id' },
      source: 'manual',
      status: 'pending',
      stats: {},
    },
  }).includes('new edge — it starts out pending'),
)
check(
  'renderer: clearing a condition says so',
  renderResult({
    ok: true,
    changed: true,
    edge: {
      from: { table: 'a', column: 'id' },
      to: { table: 'b', column: 'id' },
      source: 'manual',
      status: 'confirmed',
      condition: null,
      stats: {},
    },
  }).includes('condition cleared'),
)
check(
  'renderer: deleting an edge names it and counts what is left',
  renderResult({
    ok: true,
    deleted: { from: { table: 'a', column: 'id' }, to: { table: 'b', column: 'id' } },
    counts: { pending: 2, confirmed: 0, trusted: 0, stale: 0, rejected: 0 },
  }).includes('removed a.id -> b.id  (2 pending left)'),
)

const minedClean = renderResult({
  ok: true,
  mined: 2,
  ambiguous: [],
  imported: 1,
  updated: 0,
  skipped: 1,
  edges: [],
  counts: { pending: 1, confirmed: 0, trusted: 0, stale: 0, rejected: 0 },
})
check('renderer: a mined join says where it came from', minedClean.includes('mined 2 join(s) from the audit log'), minedClean)
check('renderer: mining reports what was new and what was already known', minedClean.includes('1 new, 1 already known'), minedClean)
check('renderer: mining shows the graph it left behind', minedClean.includes('graph now: 1 pending'), minedClean)

const minedAmbiguous = renderResult({
  ok: true,
  mined: 2,
  imported: 0,
  updated: 0,
  skipped: 0,
  edges: [],
  counts: { pending: 0, confirmed: 0, trusted: 0, stale: 0, rejected: 0 },
  ambiguous: [
    { left: { table: 't_note', column: 'trans_id' }, right: { table: 't_trans', column: 'id' }, hits: 1, reason: 'neither unique' },
  ],
})
check(
  'renderer: an undecidable direction names both columns and why',
  minedAmbiguous.includes('t_note.trans_id = t_trans.id  (neither unique)'),
  minedAmbiguous,
)
check('renderer: an ambiguous pair points at the way to decide it', minedAmbiguous.includes('propose_relation'), minedAmbiguous)

const minedEmpty = renderResult({ ok: true, mined: 0, ambiguous: [], imported: 0, updated: 0, skipped: 0, edges: [], counts: {} })
check('renderer: an empty log says so instead of pretending', minedEmpty.includes('holds no statement that joined two tables'), minedEmpty)

const scannedClean = renderResult({
  ok: true,
  root: 'E:/project/backend/Record',
  scanned: 12,
  mined: 2,
  ambiguous: [],
  imported: 1,
  updated: 0,
  skipped: 1,
  edges: [],
  counts: { pending: 1, confirmed: 0, trusted: 0, stale: 0, rejected: 0 },
})
check('renderer: a scanned project says how much it read', scannedClean.includes('scanned 12 statement(s) under E:/project/backend/Record'), scannedClean)
check('renderer: scanning reports what was new and what was already known', scannedClean.includes('mined 2 join(s), 1 new, 1 already known'), scannedClean)
check('renderer: scanning shows the graph it left behind', scannedClean.includes('graph now: 1 pending'), scannedClean)

const scannedAmbiguous = renderResult({
  ok: true,
  root: 'E:/project/backend/Record',
  scanned: 3,
  mined: 1,
  imported: 0,
  updated: 0,
  skipped: 0,
  edges: [],
  counts: { pending: 0, confirmed: 0, trusted: 0, stale: 0, rejected: 0 },
  ambiguous: [
    { left: { table: 'account', column: 'id' }, right: { table: 'warehouse', column: 'id' }, hits: 1, reason: 'both unique' },
  ],
})
check(
  'renderer: a scanned undecidable direction names both columns and why',
  scannedAmbiguous.includes('account.id = warehouse.id  (both unique)'),
  scannedAmbiguous,
)

const scannedEmpty = renderResult({
  ok: true,
  root: 'E:/project/backend/Record',
  scanned: 1,
  mined: 0,
  ambiguous: [],
  imported: 0,
  updated: 0,
  skipped: 0,
  edges: [],
  counts: {},
})
check('renderer: a project with no join says so instead of pretending', scannedEmpty.includes('no mapper XML, @Select/@Update annotation'), scannedEmpty)
check('renderer: a BaseMapper-only project is not reported as a failure', scannedEmpty.includes('that is not a failure'), scannedEmpty)

const walked = renderResult({
  ok: true,
  value: 'A001',
  direction: 'down',
  elapsedMs: 12,
  entry: { table: 't_order', column: 'id', picked: true, candidates: [] },
  summary: { tablesHit: 2, tablesVisited: 3, rowsRead: 4, steps: 2, depthReached: 1 },
  steps: [
    {
      index: 1,
      depth: 0,
      table: 't_order',
      condition: { column: 'id', operator: 'in', binds: ['1'], extra: null },
      sql: 'select * from t_order where "id" in (?) limit 2',
      rows: 1,
      truncated: false,
      status: 'hit',
      edge: null,
      sample: { columns: ['id'], rows: [[1]] },
      note: null,
    },
    {
      index: 2,
      depth: 1,
      table: 't_trans',
      condition: { column: 'order_id', operator: 'in', binds: ['1'], extra: null },
      sql: 'select * from t_trans where "order_id" in (?) limit 2',
      rows: 0,
      truncated: false,
      status: 'empty',
      edge: { source: 'fk', status: 'confirmed', from: { table: 't_trans', column: 'order_id' }, to: { table: 't_order', column: 'id' } },
      sample: { columns: [], rows: [] },
      note: null,
    },
  ],
  pending: [
    {
      edge: { from: { table: 't_line', column: 'trans_id' }, to: { table: 't_trans', column: 'id' }, status: 'pending' },
      wouldReach: 't_trans',
      reason: 'not confirmed',
    },
  ],
  warnings: [{ code: 'depth_limit', message: 'stopped at depth 1' }],
  stoppedAt: [{ table: 't_trans', reason: 'the value is not there' }],
})
check('renderer: a trace names where it started', walked.includes('trace t_order.id'), walked)
check('renderer: a trace counts the tables it reached', walked.includes('2 table(s) hit'), walked)
check('renderer: every step is a numbered line', walked.includes('1. t_order.id') && walked.includes('2. t_trans.order_id'), walked)
check('renderer: a broken step says the chain stops there', walked.includes('the chain stops here'), walked)
check('renderer: a step names the edge it followed', walked.includes('fk · confirmed'), walked)
check('renderer: an unfollowed pending edge is reported, not walked', walked.includes('was not followed'), walked)
check('renderer: warnings and stop reasons are listed', walked.includes('warning [depth_limit]') && walked.includes('stopped at t_trans'), walked)
check('renderer: the traced value is never printed', !walked.includes('A001'), walked)

// A scene result is read before a question is asked: the agent sees the tables,
// the joins among them and the members with no join at all.
const sceneListing = renderResult({
  ok: true,
  datasource: 'shop',
  scenes: [
    {
      id: 's_a9aa88',
      name: 'order to cash',
      note: 'the demo path',
      tableCount: 3,
      tables: ['sales_order', 'order_item', 'payment'],
      edges: [{ id: 'e_1', from: { table: 'payment', column: 'order_no' }, to: { table: 'sales_order', column: 'order_no' }, status: 'confirmed' }],
      isolated: ['order_item'],
    },
  ],
  total: 1,
})
check('renderer: a scene list is named and counted', sceneListing.includes('1 scene(s)') && sceneListing.includes('order to cash'), sceneListing)
check('renderer: a scene shows its confirmed joins', sceneListing.includes('payment.order_no -> sales_order.order_no') && sceneListing.includes('[confirmed]'), sceneListing)
check('renderer: a scene names its stranded members', sceneListing.includes('no join reaches: order_item'), sceneListing)
check('renderer: a scene result teaches the agent how to use it', sceneListing.includes('pass the scene name as `scene` to trace_by_key'), sceneListing)
check(
  'renderer: an empty scene list says what to do instead',
  renderResult({ ok: true, datasource: 'shop', scenes: [], total: 0 }).includes('trace the whole graph'),
)

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
// Dropping a block of checked rows: the block lands whole, in its own order.
const { reorderForDrop } = mod.__test
check(
  'drag: a single row lands above its target',
  reorderForDrop(['a', 'b', 'c', 'd'], ['d'], 'b', false).join('|') === 'a|d|b|c',
  reorderForDrop(['a', 'b', 'c', 'd'], ['d'], 'b', false).join('|'),
)
check(
  'drag: landing after a row puts it below',
  reorderForDrop(['a', 'b', 'c', 'd'], ['a'], 'c', true).join('|') === 'b|c|a|d',
  reorderForDrop(['a', 'b', 'c', 'd'], ['a'], 'c', true).join('|'),
)
check(
  'drag: a checked block moves together and keeps its order',
  reorderForDrop(['a', 'b', 'c', 'd', 'e'], ['b', 'd'], 'a', true).join('|') === 'a|b|d|c|e',
  reorderForDrop(['a', 'b', 'c', 'd', 'e'], ['b', 'd'], 'a', true).join('|'),
)
check(
  'drag: the row under the cursor is not moved twice',
  reorderForDrop(['a', 'b', 'c'], ['a', 'b'], 'b', false).join('|') === 'a|b|c',
  reorderForDrop(['a', 'b', 'c'], ['a', 'b'], 'b', false).join('|'),
)
check(
  'drag: dragging the only checked row is a plain reorder',
  reorderForDrop(['a', 'b'], ['a'], 'b', true).join('|') === 'b|a',
  reorderForDrop(['a', 'b'], ['a'], 'b', true).join('|'),
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

/* The global write switch has moved twice: out of the diagnostics card, then
   off the status strip and into the list card's title row — the row that holds
   the sources it governs. It renders only when the panel hands it a handler. */
const { WriteSwitch } = mod.__test
const writeTree = render('write switch', () => WriteSwitch({ t, allowWrite: true, busy: false, onWrite: noop }))
if (writeTree) {
  const spots = collect(writeTree, (node) => node.props.className === 'dbmcp-list-write')
  check('write switch: it has one home', spots.length === 1, `got ${spots.length}`)
  check('write switch: the on state reads out', texts(writeTree).includes('write.on'), texts(writeTree).join('|'))
  const offTree = WriteSwitch({ t, allowWrite: false, busy: false, onWrite: noop })
  check('write switch: the off state reads out too', texts(offTree).includes('write.off'), texts(offTree).join('|'))
  check(
    'write switch: no switch when the panel has no handler',
    WriteSwitch({ t, allowWrite: true, busy: false }) === null,
  )
  const switchNode = collect(writeTree, (node) => node.type === 'button' && node.props.role === 'switch')[0]
  check(
    'write switch: it is a switch, not a checkbox',
    Boolean(switchNode) && switchNode.props['aria-checked'] === 'true',
    JSON.stringify(switchNode && switchNode.props['aria-checked']),
  )
  const busyTree = WriteSwitch({ t, allowWrite: true, busy: true, onWrite: noop })
  const busyNode = collect(busyTree, (node) => node.type === 'button' && node.props.role === 'switch')[0]
  check('write switch: a busy panel disables it', Boolean(busyNode) && busyNode.props.disabled === true)
}

/* The conversation-limit card answers the same question as the write switch —
   who may touch which data — so it sits on the same page, not on the Tools tab
   where nobody would look for it. It used to vanish when no limit existed, which
   made a feature that only the agent writes invisible until it was already in
   use; the card now always renders and says so in one line. */
const scopesCard = source.slice(source.indexOf('const renderScopes = ()'), source.indexOf('let body'))
check('scopes card: it lives on the data source list', /tab !== 'list' \? null : renderScopes\(\)/.test(source))
check('scopes card: the tools tab no longer carries it', !/tab !== 'tools' \? null : renderScopes\(\)/.test(source))
check('scopes card: an empty list still renders the card', !/if \(list\.length === 0\) return null/.test(scopesCard), scopesCard.slice(0, 80))
check('scopes card: the empty state has a line of its own', /empty \? t\('scopes\.empty'\)/.test(scopesCard))
check('scopes card: the folded line counts conversations and rules', /fmt\(t\('scopes\.summary'\), \{ n: list\.length, rules \}\)/.test(scopesCard))
/* A limit is set by the agent, so the panel is the only place it can be read;
   hiding the table behind a click made the person who has to check it hunt for
   it. It therefore starts open. */
check('scopes card: the table starts expanded', /const \[scopesOpen, setScopesOpen\] = React\.useState\(true\)/.test(source))
check('scopes card: collapsing is still possible', /onClick: \(\) => setScopesOpen\(!scopesOpen\)/.test(scopesCard) && /t\('scopes\.hide'\)/.test(scopesCard))
check('scopes card: every row can be removed', /onClick: \(\) => void removeScope\(entry\.session\)/.test(scopesCard))
check('scopes card: the whole set can be cleared', /onClick: clearScopes/.test(scopesCard))
check(
  'scopes card: the conversation id is shown in full',
  /entry\.session \|\| '—'/.test(scopesCard) && !/shortSession/.test(source),
  scopesCard.slice(0, 120),
)
check('scopes card: a known title is shown above the id', /entry\.title\s*\n?\s*\? h\('span', \{ className: 'dbmcp-scope-title'/.test(scopesCard))
check('scopes card: archived conversations keep a parked section', /parked\.map\(\(entry\) => row\(entry, true\)\)/.test(scopesCard))
check('scopes card: parked rows explain why they are still listed', /t\('scopes\.parkedHint'\)/.test(scopesCard))

/* The list is a table, not a stack of chips: an id, a name and a set of data
   sources are three different kinds of thing, and columns read across far
   better than a run-on line. The header sticks so a long list cannot scroll it
   away, and each column declares its own width so a long id cannot squeeze the
   name out of view. */
check('scopes card: the rows are table rows', /h\(\s*'tr'/.test(scopesCard) && /h\(\s*'tbody'/.test(scopesCard))
check('scopes card: every column has a heading', /t\('scopes\.columnId'\)/.test(scopesCard) && /t\('scopes\.columnTitle'\)/.test(scopesCard) && /t\('scopes\.columnSources'\)/.test(scopesCard))
check('scopes card: a missing name still has a cell', /t\('scopes\.noTitle'\)/.test(scopesCard))
check('scopes card: the header sticks while the body scrolls', /\.dbmcp-scope-th \{[^}]*position: sticky/.test(source))
check('scopes card: the id column wraps instead of truncating', /\.dbmcp-scope-id \{[^}]*word-break: break-all/.test(source))
check('scopes card: the box scrolls on its own', /\.dbmcp-scope-box \{[^}]*overflow: auto/.test(source))

/* Page A — the relation graph. Two things matter and both are visible here:
   an edge reads as a join path rather than as metadata, and the buttons a row
   offers are decided by its status. A pending edge can be confirmed; a trusted
   one cannot be quietly changed. */
const graphCard = source.slice(source.indexOf('const edgeStatusClass ='), source.indexOf('let body'))
check('graph page: it is its own tab', /tab !== 'graph' \? null : renderGraph\(\)/.test(source))
check(
  'graph page: the tab sits between import and connect',
  mod.__test.TABS.map((tab) => tab.id).indexOf('graph') === 3,
  mod.__test.TABS.map((tab) => tab.id).join(','),
)
check('graph page: an edge reads left to right', /edge\.from\.table\}\.\$\{edge\.from\.column/.test(graphCard) && /edge\.to\.table\}\.\$\{edge\.to\.column/.test(graphCard))
check('graph page: the arrow says the direction', /dbmcp-edge-arrow/.test(graphCard) && /' → '/.test(graphCard))
check('graph page: the status is a chip of its own', /edgeStatusClass\(status\)/.test(graphCard))
check('graph page: the second line carries the evidence', /edgeMeta\(edge\)/.test(graphCard))
check(
  'graph page: the evidence names the source and the counters',
  /graph\.sourceFk/.test(source) && /graph\.confirmedTimes/.test(source) && /graph\.fanout/.test(source),
)
check('graph page: four filters, each with a count', /graph\.filterAll/.test(graphCard) && /graph\.filterPending/.test(graphCard) && /graph\.filterConfirmed/.test(graphCard) && /graph\.filterBroken/.test(graphCard))
check(
  'graph page: a filter button shows its count',
  /\$\{filter\.label\} \$\{filter\.count\}/.test(graphCard),
)
check('graph page: a pending edge offers confirm and reject', /status === 'pending'/.test(graphCard) && /sendFeedback\(edge, 'ok'\)/.test(graphCard) && /setGraphReason\(edge\.id\)/.test(graphCard))
check('graph page: rejecting asks for the reason', /graph\.rejectHint/.test(source) && /pick\('wrong_column'\)/.test(graphCard) && /pick\('needs_condition'\)/.test(graphCard) && /pick\('not_unique'\)/.test(graphCard))
check('graph page: a condition can be attached from the row', /setGraphCondition\(edge\.id\)/.test(graphCard) && /saveCondition\(edge, graphConditionDraft\)/.test(graphCard))
check(
  'graph page: a stale edge says why it broke',
  /status === 'stale' \|\| status === 'rejected' \? edgeReason\(edge\)/.test(graphCard) && /graph\.failedBecause/.test(source),
)
check(
  'graph page: a stale edge can be repaired or dropped',
  /status === 'stale'/.test(graphCard) && /removeEdge\(edge\)/.test(graphCard),
)
check(
  'graph page: a confirmed or trusted edge has no verdict buttons',
  /status === 'confirmed' \|\| status === 'trusted'/.test(graphCard) && !/status === 'confirmed'[^\n]*sendFeedback/.test(graphCard),
)
check(
  'graph page: its confirmation record can be opened',
  /setGraphOpen\(open \? '' : edge\.id\)/.test(graphCard) && /edgeHistory\(edge\)/.test(graphCard),
)
check('graph page: a new join is added from a form', /renderEdgeForm\(\)/.test(graphCard) && /graph\.addHint/.test(source))
check('graph page: the foreign keys can be imported', /discoverEdges\(\)/.test(graphCard) && /graph\.discover/.test(graphCard))
check('graph page: the datasource is picked, not typed', /className: 'dbmcp-input dbmcp-select'/.test(graphCard))
check(
  'graph page: a datasource is required before anything is read',
  /sources\.length === 0/.test(graphCard) && /graph\.noSources/.test(source),
)
check('graph page: an empty graph explains what to do next', /graph\.empty/.test(graphCard) && /graph\.emptyFiltered/.test(graphCard))
check('graph page: the row border carries the status colour', /\.dbmcp-edge\.is-pending \{/.test(source) && /\.dbmcp-edge\.is-trusted \{/.test(source))

/* The second line answers "what does this join cost me" before the reader has to
   ask: whether the target column is indexed, how big the table is and how long a
   step took last time. An edge whose cost was never measured keeps the line
   readable instead of printing "undefined". */
check(
  'graph page: the evidence says whether the column is indexed',
  /edgeIndexLabel\(cost\)/.test(graphCard) && /indexed === true/.test(graphCard),
)
check(
  'graph page: an unmeasured edge still reads',
  /graph\.indexUnknown/.test(source) && /graph\.indexYes/.test(source) && /graph\.indexNo/.test(source),
)
check(
  'graph page: the evidence carries the row count and the step time',
  /graph\.rows/.test(graphCard) && /graph\.avgMs/.test(graphCard) && /cost\.avgMs/.test(graphCard),
)

/* The four thresholds that decide what a step may cost used to be module
   constants; they are now a card of their own on the graph page. The card has to
   be reachable from the graph tab, save one field at a time, and quote the same
   caps the server clamps to. */
const costCard = source.slice(source.indexOf('const COST_RULES ='), source.indexOf('const renderScopes ='))
check(
  'graph page: the cost thresholds have a card of their own',
  /tab !== 'graph' \? null : renderCost\(\)/.test(source) && /const renderCost = \(\)/.test(source) && /cost\.title/.test(source),
)
check(
  'graph page: the four thresholds are editable numbers',
  /key: 'slowMs'/.test(costCard) &&
    /key: 'timingWindow'/.test(costCard) &&
    /key: 'trustSamples'/.test(costCard) &&
    /key: 'bigTableRows'/.test(costCard),
)
check(
  'graph page: a threshold is saved on its own',
  /apiPost\('\/settings', \{ cost: next \}\)/.test(costCard) && /cost\.saved/.test(source),
)
check(
  'graph page: each threshold names itself and explains what it changes',
  /cost\.slowMsHint/.test(costCard) &&
    /cost\.timingWindowHint/.test(costCard) &&
    /cost\.trustSamplesHint/.test(costCard) &&
    /cost\.bigTableRowsHint/.test(costCard),
)
check(
  'graph page: the panel caps match the ones the server clamps to',
  /min: 10, max: 60000/.test(costCard) && /min: 1000, max: 1000000000/.test(costCard),
)

// Page B — the trace result. The page must take a value and nothing else that
// could look like a statement, and every step must be judgeable.
const traceCard = source.slice(source.indexOf('const traceStepDirection ='), source.indexOf('let body'))
const traceLogic = source.slice(source.indexOf('const traceTarget ='), source.indexOf('const [textPolicyDraft'))
check('trace page: it is its own tab', /tab !== 'trace' \? null : renderTrace\(\)/.test(source))
check(
  'trace page: the tab sits after relations and scenes',
  mod.__test.TABS.map((tab) => tab.id).indexOf('trace') === 5,
  mod.__test.TABS.map((tab) => tab.id).join(','),
)
check(
  'trace page: it takes a value, never a statement',
  /apiPost\('\/trace', \{/.test(traceLogic) && /value,/.test(traceLogic) && !/\bsql\s*:/.test(traceLogic),
)
check(
  'trace page: the entry table and column are optional',
  /const entryTable = startAt && startAt\.table \? startAt\.table : traceTable\.trim\(\)/.test(traceLogic) &&
    /const entryColumn = startAt && startAt\.column \? startAt\.column : traceColumn\.trim\(\)/.test(traceLogic) &&
    /entry_table: entryTable \|\| undefined/.test(traceLogic) &&
    /entry_column: entryColumn \|\| undefined/.test(traceLogic),
)
check(
  'trace page: the direction is one of three',
  /trace\.dirBoth/.test(source) && /trace\.dirDown/.test(source) && /trace\.dirUp/.test(source),
)
check('trace page: a blank value is refused before the walk', /trace\.needValue/.test(traceLogic))
check(
  'trace page: a step reads as its depth, its table and its rows',
  /dbmcp-trace-mark/.test(traceCard) && /node\.table/.test(traceCard) && /trace\.rows/.test(traceCard),
)
check(
  'trace page: a broken chain says so in the step',
  /status === 'empty'/.test(traceCard) && /trace\.chainBreaks/.test(source),
)
check('trace page: a capped step is marked', /node\.truncated/.test(traceCard) && /trace\.truncated/.test(source))
check(
  'trace page: each step shows the edge it travelled',
  /edge\.from\.table/.test(traceCard) &&
    /edge\.to\.column/.test(traceCard) &&
    /edgeStatusClass\(edge\.status\)/.test(traceCard),
)
check(
  'trace page: each step carries the four judgements',
  /judgeStep\(edge\.id, 'ok'\)/.test(traceCard) &&
    /judgeStep\(edge\.id, 'too_many', 'not_unique'\)/.test(traceCard) &&
    /judgeStep\(edge\.id, 'missing'\)/.test(traceCard) &&
    /judgeStep\(edge\.id, 'irrelevant'\)/.test(traceCard),
)
check(
  'trace page: judging a step feeds the edge behind it',
  /judgeStep\(edge\.id,/.test(traceCard) && /edge_id: edgeId/.test(source),
)
check(
  'trace page: pending edges are listed but not walked',
  /trace\.pendingTitle/.test(source) && /trace\.pendingHint/.test(source) && /pending\.map/.test(traceCard),
)
check(
  'trace page: the summary names the entry it picked',
  /trace\.summary/.test(source) && /entry\.table/.test(traceCard) && /entry\.column/.test(traceCard),
)
check(
  'trace page: warnings and stops stay visible',
  /trace\.warnings/.test(source) && /trace\.stopped/.test(source) && /warnings\.map/.test(traceCard) && /stopped\.map/.test(traceCard),
)
check('trace page: the value itself is never echoed back', !/traceValue\}/.test(traceCard))
check('trace page: a datasource is required before anything is walked', /trace\.noSources/.test(source))

/* A step that would scan a whole table is a question, not a result: it says why
   it did not run and offers the one button that lets it run, which re-sends the
   trace with confirm_slow. The panel itself can never set that flag any other
   way — no input fields, no state, only that click. */
check(
  'trace page: a full scan is stopped before it runs',
  /status === 'needs_confirm'/.test(traceCard) && /trace\.needsConfirm/.test(source),
)
check(
  'trace page: the stopped step offers the one way to allow it',
  /trace\.continueAnyway/.test(traceCard) && /runTrace\(true\)/.test(traceCard),
)
check(
  'trace page: only that button sends confirm_slow',
  /confirm_slow: confirmSlow === true \? true : undefined/.test(traceLogic) &&
    (traceLogic.match(/confirm_slow/g) || []).length === 1,
)
check(
  'trace page: each step reports how long it took',
  /trace\.stepMs/.test(traceCard) && /node\.ms/.test(traceCard),
)
check(
  'trace page: the summary counts the steps it refused',
  /summary\.needsConfirm/.test(traceCard) && /trace\.needsConfirmSome/.test(source),
)

/* The walk is read as one picture: the graph is the view — there is no second
   view to switch to — and the step you pick in it is read underneath. */
check(
  'trace page: the graph is the only reading',
  /steps\.length > 0 \? traceOverview\(\) : null/.test(traceCard) &&
    !/renderTraceFlat/.test(source) &&
    !/traceView/.test(source) &&
    !/trace\.viewGraph/.test(source) &&
    !/trace\.viewFlat/.test(source),
)
check(
  'trace page: the step picked in the graph is read under it, not in a second tree',
  /const traceDetailNode = \(node, sceneOn\) =>/.test(traceCard) &&
    /const traceAllNodes = \(nodes\) =>/.test(traceCard) &&
    /className: 'dbmcp-trace-detail', id: 'dbmcp-trace-detail'/.test(traceCard) &&
    /traceAllNodes\(nodes\)\.find\(\(node\) => node\.index === traceFocus\) \|\| nodes\[0\]/.test(traceCard) &&
    !/dbmcp-trace-kids/.test(traceCard),
)
check(
  'trace page: the entry node is marked as the start and can be changed',
  /trace\.root/.test(source) && /trace\.changeEntry/.test(source) && /traceDetailNode/.test(traceCard),
)
check(
  'trace page: a table already read upstream is not drawn a second time',
  /dbmcp-trace-node is-/.test(traceCard) &&
    !/node\.repeated/.test(source) &&
    !/trace\.repeatedNote/.test(source) &&
    !/is-repeat/.test(source) &&
    !/dbmcp-trace-index/.test(source) &&
    !/dbmcp-trace-cell/.test(source),
)
check(
  'trace page: rows are open under the picked step, and fold on demand',
  /trace\.showRowsN/.test(source) &&
    /traceRows\(node\)/.test(traceCard) &&
    /is-bound/.test(traceCard) &&
    /const \[traceFolded, setTraceFoldedState\] = React\.useState\(\(\) => \{/.test(source) &&
    /const open = !traceFolded\.includes\(node\.index\)/.test(traceCard) &&
    !/traceExpanded/.test(source),
)
check(
  'trace page: a join carries its own confidence chip',
  /const traceEdgeChip = \(edge, sceneOn\)/.test(traceCard) &&
    /trace\.sceneClaim/.test(source) &&
    /edgeStatusClass\(edge\.status\)/.test(traceCard),
)
check(
  'trace page: the legend separates the join from the rows',
  /trace\.legend/.test(source) && /trace\.legendFeedback/.test(source),
)
check(
  'trace page: more than one place to start becomes a chip, not a guess',
  /trace\.appearsIn/.test(source) && /runTrace\(undefined, \{ table/.test(traceCard) && /candidates\.map/.test(traceCard),
)
check(
  'trace page: the scene is a filter the reader can pick',
  /trace\.sceneAll/.test(source) && /scenes\.map/.test(traceCard) && /scene: traceScene \|\| undefined/.test(traceLogic),
)
check(
  'trace page: a table outside the scene says so and can be folded in',
  /trace\.outsideTitle/.test(source) &&
    /trace\.outsideNote/.test(source) &&
    /trace\.addToScene/.test(source) &&
    /traceAddToScene\(item\.table\)/.test(traceCard) &&
    /apiPost\('\/scenes\/save'/.test(traceCard),
)
check(
  'trace page: a node carries the values it was bound to, not a placeholder',
  /const traceValues = \(step\)/.test(traceCard) && /\(step\.condition \|\| \{\}\)\.binds/.test(traceCard),
)
check(
  'trace page: the shape is drawn once, left to right',
  /const traceOverview = \(\) =>/.test(traceCard) &&
    /className: 'dbmcp-trace-overview'/.test(traceCard) &&
    /'svg',/.test(traceCard) &&
    /const LANE_W = 340/.test(traceCard) &&
    /const GUTTER = 150/.test(traceCard),
)
check(
  'trace page: one column per depth, one box per table the walk reached',
  /const traceLanes = \(nodes\) =>/.test(traceCard) &&
    /lanes\[depth\]\.push\(node\)/.test(traceCard) &&
    /const BOX_W = 150/.test(traceCard) &&
    /dbmcp-ov-node is-/.test(traceCard),
)
check(
  'trace page: every taken join is a line in the graph, named by its columns',
  /const parent = node\.parent \? spots\[node\.parent\] : null/.test(traceCard) &&
    /className: `dbmcp-ov-link is-/.test(traceCard) &&
    /dbmcp-ov-edge-label/.test(traceCard) &&
    /edge\.from\.column/.test(traceCard),
)
check(
  'trace page: joins leave the parent on separate rows, not one smeared point',
  /const fanout = \{\}/.test(traceCard) &&
    /taken\[node\.parent\] = order \+ 1/.test(traceCard) &&
    /* The exits divide the box height, so the tenth child is as distinct as the
       second; a fixed step collapsed everything past the third onto one point. */
    /const inner = BOX_H - 8/.test(traceCard) &&
    /const offset = count > 1 \? 4 \+ \(inner \/ \(count - 1\)\) \* order : BOX_H \/ 2/.test(traceCard),
)
/* The lanes must be ordered so no two joins cross. Every step has one parent in
   the lane to its left, so ordering each lane by its parent's row is enough — and
   that is a property worth running, not just reading. */
const layoutSrc = source.slice(
  source.indexOf('const traceOrder = (lanes) =>'),
  source.indexOf('/* How far the picture may be magnified'),
)
const traceOrder = new Function(`${layoutSrc}\nreturn traceOrder`)()
const width = (lane) => lane.map((node) => node.index)
const crossings = (lanes) => {
  let count = 0
  const rows = {}
  lanes.forEach((lane) => lane.forEach((node, row) => { rows[node.index] = row }))
  for (let depth = 1; depth < lanes.length; depth += 1) {
    const pairs = lanes[depth].filter((node) => rows[node.parent] !== undefined)
    for (let a = 0; a < pairs.length; a += 1) {
      for (let b = a + 1; b < pairs.length; b += 1) {
        if (rows[pairs[a].parent] > rows[pairs[b].parent]) count += 1
      }
    }
  }
  return count
}
check(
  'trace page: joins are ordered so none of them cross, not by arrival order',
  /const traceOrder = \(lanes\) =>/.test(traceCard) &&
    !/const crossings = \(state\) =>/.test(traceCard) &&
    !/barycenter|barycentre/i.test(traceCard) &&
    /traceOrder\(traceLanes\(nodes\)\)/.test(traceCard),
)
{
  // Arrival order is breadth first, so two branch's children interleave:
  // lane 2 arrives 4,6,5,7 where 4/5 hang off 2 and 6/7 off 3 — one crossing.
  const lanes = [
    [{ index: 1, parent: null }],
    [{ index: 2, parent: 1 }, { index: 3, parent: 1 }],
    [
      { index: 4, parent: 2 },
      { index: 6, parent: 3 },
      { index: 5, parent: 2 },
      { index: 7, parent: 3 },
    ],
  ]
  const ordered = traceOrder(lanes)
  check(
    'trace page: the ordering really leaves zero crossings',
    crossings(ordered) === 0,
    `expected 0, got ${crossings(ordered)} in ${width(ordered[1])} / ${width(ordered[2])}`,
  )
  check(
    'trace page: siblings keep the order the walk reached them in',
    width(ordered[1]).join(',') === '2,3' && width(ordered[2]).join(',') === '4,5,6,7',
    `${width(ordered[1]).join(',')} / ${width(ordered[2]).join(',')}`,
  )
  check(
    'trace page: ordering a lane does not mutate the one it was given',
    width(lanes[1]).join(',') === '2,3' && width(lanes[2]).join(',') === '4,6,5,7',
    `${width(lanes[1]).join(',')} / ${width(lanes[2]).join(',')}`,
  )
}
check(
  'trace page: the graph can be zoomed instead of shrunk to fit',
  /const \[traceZoom, setTraceZoomState\] = React\.useState\(\(\) => \{/.test(source) &&
    /const ZOOM_MIN = 0\.4/.test(traceCard) &&
    /const ZOOM_MAX = 2\.5/.test(traceCard) &&
    /className: 'dbmcp-trace-zoom'/.test(traceCard) &&
    /setTraceZoom\(1\)/.test(traceCard),
)
check(
  'trace page: zooming resizes the picture, it does not re-lay it out',
  /viewBox: `0 0 \$\{width\} \$\{height\}`/.test(traceCard) &&
    /width: `\$\{Math\.round\(width \* traceZoom\)\}px`/.test(traceCard) &&
    /className: 'dbmcp-trace-scroll'/.test(traceCard) &&
    /Math\.round\(\(traceZoom \+ ZOOM_STEP\) \* 100\) \/ 100/.test(traceCard) &&
    /Math\.round\(\(traceZoom - ZOOM_STEP\) \* 100\) \/ 100/.test(traceCard),
)
check(
  'trace page: the join label sits in its own gutter, clear of every curve',
  /const elbow = x2 - GUTTER/.test(traceCard) &&
    /L \$\{x2\} \$\{y2\}/.test(traceCard) &&
    /x: x2 - GUTTER \+ 8/.test(traceCard) &&
    /textAnchor: 'start'/.test(traceCard),
)
check(
  'trace page: clicking a box reads that step underneath',
  /const focusTraceNode = \(index\) =>/.test(traceCard) &&
    /onClick: \(\) => focusTraceNode\(node\.index\)/.test(traceCard) &&
    /getElementById\('dbmcp-trace-detail'\)/.test(traceCard) &&
    /node\.index === current/.test(traceCard),
)

// the component's own header still took a min-height plus a bottom margin when
// it rendered empty — about thirty pixels of nothing above the list.
const { Card } = mod.__test
if (typeof Card !== 'function') {
  check('card: exported for testing', false, 'Card missing')
} else {
  const bare = Card({ title: null, children: 'body' })
  const bareHeads = collect(bare, (node) => node.props.className === 'dbmcp-card-head')
  check('card: no header at all when it has nothing to say', bareHeads.length === 0, `got ${bareHeads.length}`)
  const titled = Card({ title: 'Audit', children: 'body' })
  const titledHeads = collect(titled, (node) => node.props.className === 'dbmcp-card-head')
  const titledNames = collect(titled, (node) => node.props.className === 'dbmcp-card-title')
  check('card: a titled card still gets its header', titledHeads.length === 1 && titledNames.length === 1)
  const asideOnly = Card({ title: null, aside: '3', children: 'body' })
  check(
    'card: an aside alone still earns the header',
    collect(asideOnly, (node) => node.props.className === 'dbmcp-card-head').length === 1,
  )
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
