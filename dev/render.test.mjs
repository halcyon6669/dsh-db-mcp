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
  check('main panel: seven tabs', tabs.length === 7, String(tabs.length))
  check(
    'main panel: first tab is active',
    tabs.length === 7 && tabs[0].props['aria-selected'] === true && tabs[1].props['aria-selected'] === false,
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
    'main panel: the tabs line up left to right',
    tabs.length === 7 && tabs.map((node) => texts(node).join('')).join(',') === order.map((id) => `tab.${id}`).join(','),
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
check('renderer: describe lists the foreign key as a path', described.includes('TrackId -> Track.TrackId'), described)
check('renderer: describe lists indexes with their columns', described.includes('IFK_InvoiceLineTrackId (TrackId)'), described)
check('renderer: describe keeps the column comments', described.includes('-- which track'), described)
check('renderer: a describe with no keys does not print empty sections', !renderResult({ ok: true, table: 't', columns: [{ name: 'a', type: 'TEXT', nullable: true, primaryKey: false }], primaryKey: [], foreignKeys: [], indexes: [], comment: null, rowEstimate: null }).includes('foreign keys:'))

const related = renderResult({
  ok: true,
  schema: 'public',
  relations: [
    { table: 'orders', column: 'customer_id', refTable: 'customers', refColumn: 'id', name: 'orders_customer_fkey' },
  ],
  truncated: false,
  total: 1,
})
check('renderer: relations reads as join paths', related === 'orders.customer_id -> customers.id  (orders_customer_fkey)', related)
check('renderer: an empty schema says so', renderResult({ ok: true, schema: 'public', relations: [], total: 0, truncated: false }) === 'no foreign keys in public')

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
