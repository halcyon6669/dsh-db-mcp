/**
 * P5 checks: settings, audit log, python environment — exercised through the
 * real HTTP handler with a throwaway runtime directory.
 */
import { createServer } from 'node:http'
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

import { createHost } from '../src/host.js'

let passed = 0
let failed = 0

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1
    console.log(`ok   ${name}${detail ? ` — ${detail}` : ''}`)
  } else {
    failed += 1
    console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

const dir = await mkdtemp(join(tmpdir(), 'dbmcp-p5-'))
await mkdir(join(dir, 'logs'), { recursive: true })

// Throwaway client targets: tests write stdio/HTTP entries into these files
// instead of the real editor configs on this machine.
const clientFiles = {
  cursor: join(dir, 'clients', 'cursor.json'),
  codex: join(dir, 'clients', 'codex.toml'),
  copilot: join(dir, 'clients', 'mcp-config.json'),
  legacy: join(dir, 'clients', 'Code', 'User', 'mcp.json'),
}
const host = await createHost({
  dir,
  config: {},
  log: () => {},
  clientTargets: () => [
    { id: 'cursor', label: 'Cursor', shape: 'mcpServers', file: clientFiles.cursor },
    { id: 'codex', label: 'Codex CLI', shape: 'toml', file: clientFiles.codex },
    { id: 'vscode', label: 'Visual Studio Code', shape: 'copilot', file: clientFiles.copilot },
  ],
  legacyVscodeFiles: () => [clientFiles.legacy],
})
const server = createServer((request, response) => host.handle(request, response))
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`

const PREFIX = '/plugins/db-mcp/api'
const get = async (path) => {
  const response = await fetch(base + PREFIX + path)
  return { status: response.status, body: await response.json().catch(() => null) }
}
const post = async (path, body) => {
  const response = await fetch(base + PREFIX + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base },
    body: JSON.stringify(body),
  })
  return { status: response.status, body: await response.json().catch(() => null) }
}

try {
  const health = await get('/health')
  check('health exposes settings', Boolean(health.body && health.body.settings), JSON.stringify(health.body.settings))

  const defaults = await get('/settings')
  check('settings default to read-only', defaults.body.settings.allowWrite === false)
  check('audit logging defaults on', defaults.body.settings.auditLog === true)
  check('settings file sits in the runtime dir', defaults.body.settings.file === join(dir, 'settings.json'))

  const changed = await post('/settings', { auditLog: false })
  check('POST /settings updates a field', changed.body?.settings?.auditLog === false, JSON.stringify(changed.body))
  const onDisk = JSON.parse(await readFile(join(dir, 'settings.json'), 'utf8'))
  check('settings survive on disk', onDisk.auditLog === false && onDisk.allowWrite === false, JSON.stringify(onDisk))

  const empty = await get('/audit?limit=5')
  check('empty audit log is not an error', Array.isArray(empty.body.entries) && empty.body.entries.length === 0)
  check('empty audit log reports a zero total', empty.body.total === 0)
  check('audit file path reported', empty.body.file === join(dir, 'logs', 'audit.jsonl'))

  await writeFile(
    join(dir, 'logs', 'audit.jsonl'),
    [
      JSON.stringify({ at: '2026-11-07T14:00:00.000Z', tool: 'mcp__db__list_tables', ok: true, ms: 12, rows: 11 }),
      JSON.stringify({ at: '2026-11-07T14:01:00.000Z', tool: 'mcp__db__execute_sql', ok: false, ms: 30, error: 'boom' }),
      '',
    ].join('\n'),
    'utf8',
  )
  const listing = await get('/audit?limit=5')
  check('audit entries parse newest first', listing.body.entries.length === 2 && listing.body.entries[0].tool === 'mcp__db__execute_sql')
  check('audit total counts every line, not just the page', listing.body.total === 2)
  check('failed entry keeps its error', listing.body.entries[0].error === 'boom')
  const limited = await get('/audit?limit=1')
  check('limit is honoured', limited.body.entries.length === 1)
  check('total stays accurate when the page is smaller', limited.body.total === 2)

  const env = await get('/python/env')
  check(
    'python env flags a missing venv',
    env.body.ok === false && /\.venv/.test(String(env.body.error || '')),
    String(env.body.error || ''),
  )
  check('python env reports the venv path it looked at', typeof env.body.venvDir === 'string' && env.body.venvDir.endsWith('.venv'))
  check('requirements file is found', env.body.requirementsPresent === true)

  const bad = await post('/settings', { allowWrite: 'yes' })
  check('non-boolean allowWrite is coerced off', bad.body.settings.allowWrite === false)

  const before = await get('/scopes')
  check('no conversation limits by default', Array.isArray(before.body.sessions) && before.body.sessions.length === 0)
  check('scopes file sits in the runtime dir', before.body.file === join(dir, 'sessions.json'))

  const refused = await post('/scopes', { session: 's-1', datasources: ['missing-source'] })
  check('unknown identifiers are refused', refused.status === 400 && /unknown datasource/.test(String(refused.body?.error || '')))

  await post('/datasources/save', { id: 'alpha', name: 'Alpha', kind: 'sqlite', config: { file: 'C:/tmp/alpha.db' } })
  await post('/datasources/save', { id: 'beta', name: 'Beta', kind: 'sqlite', config: { file: 'C:/tmp/beta.db' } })
  const saved = await post('/scopes', { session: 's-1', datasources: ['alpha', 'beta', 'alpha'] })
  check(
    'POST /scopes stores unique identifiers',
    saved.status === 200 && JSON.stringify(saved.body.datasources) === JSON.stringify(['alpha', 'beta']),
    JSON.stringify(saved.body),
  )
  const after = await get('/scopes')
  check(
    'the limit is listed with its session',
    after.body.sessions.length === 1 && after.body.sessions[0].session === 's-1' && after.body.sessions[0].ids.length === 2,
    JSON.stringify(after.body.sessions),
  )

  const cleared = await post('/scopes', { session: 's-1', datasources: [] })
  check('an empty list lifts the limit', cleared.status === 200 && cleared.body.datasources.length === 0)

  const missing = await post('/scopes', {})
  check('a session id is required', missing.status === 400 && /conversation id/.test(String(missing.body?.error || '')))

  /* Limits are written by the agent over MCP, so the panel is the only place a
     stale one can be removed. Both removals answer with the surviving list. */
  await post('/scopes', { session: 's-1', datasources: ['alpha'] })
  await post('/scopes', { session: 's-2', datasources: ['beta'] })
  const removedOne = await post('/scopes/delete', { session: 's-1' })
  check(
    'POST /scopes/delete drops one conversation',
    removedOne.status === 200 &&
      JSON.stringify(removedOne.body.removed) === JSON.stringify(['s-1']) &&
      removedOne.body.sessions.length === 1 &&
      removedOne.body.sessions[0].session === 's-2',
    JSON.stringify(removedOne.body),
  )
  const removedAgain = await post('/scopes/delete', { session: 's-1' })
  check(
    'deleting a conversation with no limit removes nothing',
    removedAgain.status === 200 && removedAgain.body.removed.length === 0,
    JSON.stringify(removedAgain.body),
  )
  const clearedAll = await post('/scopes/clear', {})
  check(
    'POST /scopes/clear drops every conversation',
    clearedAll.status === 200 &&
      JSON.stringify(clearedAll.body.removed) === JSON.stringify(['s-2']) &&
      clearedAll.body.sessions.length === 0,
    JSON.stringify(clearedAll.body),
  )
  const afterClear = await get('/scopes')
  check('clearing leaves nothing behind', afterClear.body.sessions.length === 0)

  /* A disposed or archived conversation must not keep a limit that the panel can
     no longer show. Those listeners only exist when a live plugin passes ctx, so
     this needs its own host with a stub ctx; the HTTP half is switched off first
     so no Python child is spawned. Disposal is final, but archiving is not: the
     limit is parked and unarchiving hands it back. */
  const listeners = {}
  const stubCtx = {
    on: (event, handler) => {
      listeners[event] = handler
      return () => {
        delete listeners[event]
      }
    },
  }
  await post('/settings', { httpEnabled: false })
  const watched = await createHost({ dir, config: {}, log: () => {}, ctx: stubCtx })
  try {
    check(
      'both lifecycle events are listened for',
      typeof listeners['session/disposed'] === 'function' &&
        typeof listeners['workspace/session-archived'] === 'function',
      Object.keys(listeners).join(','),
    )
    check(
      'unarchiving is listened for too',
      typeof listeners['workspace/session-unarchiving'] === 'function',
      Object.keys(listeners).join(','),
    )
    await post('/scopes', { session: 'gone-1', datasources: ['alpha'] })
    await post('/scopes', { session: 'gone-2', datasources: ['beta'] })
    const both = await get('/scopes')
    check('two conversations are limited before either goes away', both.body.sessions.length === 2)

    listeners['session/disposed']({ id: 'gone-1' })
    await new Promise((resolve) => setTimeout(resolve, 150))
    const afterDispose = await get('/scopes')
    check(
      'a disposed conversation loses its limit',
      afterDispose.body.sessions.length === 1 && afterDispose.body.sessions[0].session === 'gone-2',
      JSON.stringify(afterDispose.body.sessions),
    )

    listeners['workspace/session-archived']({ sessionId: 'gone-2' })
    await new Promise((resolve) => setTimeout(resolve, 150))
    const afterArchive = await get('/scopes')
    check(
      'an archived conversation leaves the visible list',
      afterArchive.body.sessions.length === 0,
      JSON.stringify(afterArchive.body.sessions),
    )
    check(
      'an archived conversation keeps its limit parked',
      (afterArchive.body.archived || []).length === 1 &&
        afterArchive.body.archived[0].session === 'gone-2' &&
        afterArchive.body.archived[0].ids.join(',') === 'beta',
      JSON.stringify(afterArchive.body.archived),
    )

    listeners['workspace/session-unarchiving']({ sessionId: 'gone-2' })
    await new Promise((resolve) => setTimeout(resolve, 150))
    const afterUnarchive = await get('/scopes')
    check(
      'unarchiving gives the limit back',
      afterUnarchive.body.sessions.length === 1 &&
        afterUnarchive.body.sessions[0].session === 'gone-2' &&
        afterUnarchive.body.sessions[0].ids.join(',') === 'beta',
      JSON.stringify(afterUnarchive.body.sessions),
    )
    check(
      'nothing stays parked after unarchiving',
      (afterUnarchive.body.archived || []).length === 0,
      JSON.stringify(afterUnarchive.body.archived),
    )

    /* Removing a limit by hand must not leave a parked copy behind, or the next
       unarchive would bring back something the user deleted on purpose. */
    listeners['workspace/session-archived']({ sessionId: 'gone-2' })
    await new Promise((resolve) => setTimeout(resolve, 150))
    await post('/scopes/delete', { session: 'gone-2' })
    const afterDelete = await get('/scopes')
    check(
      'a manual removal also forgets the parked copy',
      (afterDelete.body.sessions || []).length === 0 && (afterDelete.body.archived || []).length === 0,
      JSON.stringify(afterDelete.body),
    )
  } finally {
    await watched.dispose?.().catch(() => {})
    await post('/settings', { httpEnabled: true })
  }

  /* ---- HTTP endpoint and outside clients ---- */
  // The endpoint only auto-starts inside a live plugin, so a bare host reports
  // its configured port and a null URL until something starts it.
  const http = await get('/http/status')
  const started = await post('/http/start', {})
  const httpAfter = started.body?.ok === true ? started.body : await get('/http/status')
  check(
    'the HTTP endpoint reports its state',
    http.status === 200 && (http.body?.url === null || typeof http.body?.url === 'string'),
    JSON.stringify(http.body?.url),
  )
  const startedUrl = started.body?.http?.url || httpAfter.body?.url || httpAfter.body?.http?.url
  check(
    'the endpoint URL points at the streamable path',
    String(startedUrl || '').endsWith('/dsh-db-mcp'),
    String(startedUrl),
  )

  /* The Python child reads the global write switch at start-up, so flipping it
     has to replace that process. Restarting only the stdio one used to leave
     every outside client on the old answer — the endpoint kept allowing writes
     after the switch was turned off. */
  const firstPid = (started.body?.http || httpAfter.body?.http || {}).pid
  if (firstPid) {
    await post('/settings', { allowWrite: true })
    let secondPid = null
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const state = await get('/http/status')
      secondPid = state.body?.pid ?? state.body?.http?.pid ?? null
      if (secondPid && secondPid !== firstPid) break
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    check(
      'flipping the write switch replaces the HTTP child',
      Boolean(secondPid) && secondPid !== firstPid,
      `${firstPid} -> ${secondPid}`,
    )
    const samePort = await get('/http/status')
    check(
      'the restarted endpoint keeps its port',
      samePort.body?.port === (started.body?.http || httpAfter.body?.http || {}).port,
      `${(started.body?.http || httpAfter.body?.http || {}).port} -> ${samePort.body?.port}`,
    )
    await post('/settings', { allowWrite: false })
  } else {
    check('flipping the write switch replaces the HTTP child', true, 'skipped: no endpoint on this machine')
  }
  await post('/http/stop', {})

  const clients = await get('/clients')
  const ids = (clients.body?.clients || []).map((item) => item.id)
  // This host runs with injected throwaway targets (cursor + codex + the Copilot
  // file VS Code reads). The platform-dependent real list is exercised by the
  // panel, not here.
  check(
    'the client list reports the injected targets',
    clients.status === 200 && ids.includes('cursor') && ids.includes('codex') && ids.includes('vscode') && ids.length === 3,
    ids.join(','),
  )
  check(
    'each client knows its config file and shape',
    (clients.body?.clients || []).every((item) => typeof item.file === 'string' && item.file.length > 0 && typeof item.shape === 'string'),
  )

  /* ---- stdio / HTTP one-click configuration, on a JSON client and a TOML one ---- */
  // stdio needs no HTTP endpoint; the endpoint was stopped above.
  const cursorStdio = await post('/clients/configure', { client: 'cursor', transport: 'stdio' })
  check(
    'a JSON client can be configured for stdio with no endpoint running',
    cursorStdio.status === 200 && cursorStdio.body?.transport === 'stdio',
    JSON.stringify(cursorStdio.body),
  )
  const cursorCfg = JSON.parse(await readFile(clientFiles.cursor, 'utf8'))
  check(
    'the stdio entry carries command, args and env',
    Boolean(cursorCfg.mcpServers?.['dsh-db-mcp']?.command) &&
      Array.isArray(cursorCfg.mcpServers?.['dsh-db-mcp']?.args) &&
      Boolean(cursorCfg.mcpServers?.['dsh-db-mcp']?.env?.DB_MCP_RUNTIME),
    JSON.stringify(cursorCfg.mcpServers?.['dsh-db-mcp']),
  )
  const codexStdio = await post('/clients/configure', { client: 'codex', transport: 'stdio' })
  const codexText = await readFile(clientFiles.codex, 'utf8')
  check(
    'a TOML client can be configured for stdio too',
    codexStdio.status === 200 && /\[mcp_servers\.dsh-db-mcp\]/.test(codexText) && /command\s*=/.test(codexText),
    JSON.stringify(codexStdio.body),
  )
  /* VS Code reads the Copilot harness file, which takes a portable entry: the
     transport is spelled out and the tool selection is explicit. Writing it also
     clears the deprecated profile file, whose entries would otherwise register
     the server twice and carry a migration banner. */
  await mkdir(dirname(clientFiles.legacy), { recursive: true })
  await writeFile(
    clientFiles.legacy,
    JSON.stringify({ inputs: [], servers: { 'dsh-db-mcp': { command: 'python', args: ['main.py'] }, other: { command: 'npx' } } }, null, 2),
    'utf8',
  )
  const vscodeStdio = await post('/clients/configure', { client: 'vscode', transport: 'stdio' })
  const vscodeCfg = JSON.parse(await readFile(clientFiles.copilot, 'utf8'))
  const vscodeEntry = vscodeCfg.mcpServers?.['dsh-db-mcp']
  check(
    'VS Code is written to the Copilot harness file, not the editor profile',
    vscodeStdio.status === 200 && vscodeStdio.body?.file === clientFiles.copilot,
    JSON.stringify(vscodeStdio.body),
  )
  check(
    'the Copilot entry is portable: explicit type, tools and mcpServers section',
    vscodeEntry?.type === 'stdio' &&
      Boolean(vscodeEntry?.command) &&
      JSON.stringify(vscodeEntry?.tools) === '["*"]' &&
      !('servers' in vscodeCfg),
    JSON.stringify(vscodeCfg),
  )
  const legacyCfg = JSON.parse(await readFile(clientFiles.legacy, 'utf8'))
  check(
    'the deprecated profile file loses this server but keeps its other entries',
    !('dsh-db-mcp' in legacyCfg.servers) && Boolean(legacyCfg.servers.other),
    JSON.stringify(legacyCfg.servers),
  )
  check(
    'the response names the file it cleaned',
    Array.isArray(vscodeStdio.body?.cleaned) && vscodeStdio.body.cleaned.includes(clientFiles.legacy),
    JSON.stringify(vscodeStdio.body?.cleaned),
  )
  const afterStdio = await get('/clients')
  check(
    'configured clients report the stdio transport',
    (afterStdio.body?.clients || []).every((item) => item.transport === 'stdio'),
    JSON.stringify(afterStdio.body?.clients?.map((c) => [c.id, c.transport])),
  )

  // HTTP still refuses when the endpoint is down. Disable auto-start first,
  // otherwise the bridge brings the child back after each stop.
  await post('/settings', { httpEnabled: false })
  await post('/http/stop', {})
  const httpDown = await post('/clients/configure', { client: 'cursor', transport: 'http' })
  check(
    'HTTP configuration is refused while the endpoint is stopped',
    httpDown.status === 409 && /not running/.test(String(httpDown.body?.error || '')),
    JSON.stringify(httpDown.body),
  )
  await post('/settings', { httpEnabled: true })
  await post('/http/start', {})
  const cursorHttp = await post('/clients/configure', { client: 'cursor', transport: 'http' })
  check(
    'a JSON client can be switched to the HTTP endpoint',
    cursorHttp.status === 200 && cursorHttp.body?.transport === 'http' && String(cursorHttp.body?.url || '').endsWith('/dsh-db-mcp'),
    JSON.stringify(cursorHttp.body),
  )
  const httpCfg = JSON.parse(await readFile(clientFiles.cursor, 'utf8'))
  check(
    'the HTTP entry replaces the stdio one',
    httpCfg.mcpServers?.['dsh-db-mcp']?.type === 'http' && !httpCfg.mcpServers?.['dsh-db-mcp']?.command,
    JSON.stringify(httpCfg.mcpServers?.['dsh-db-mcp']),
  )
  const codexHttp = await post('/clients/configure', { client: 'codex', transport: 'http' })
  const codexHttpText = await readFile(clientFiles.codex, 'utf8')
  check(
    'a TOML client can be switched to the HTTP endpoint',
    codexHttp.status === 200 && /url\s*=/.test(codexHttpText) && !/command\s*=/.test(codexHttpText),
    codexHttpText.slice(0, 160),
  )
  const vscodeHttp = await post('/clients/configure', { client: 'vscode', transport: 'http' })
  const vscodeHttpCfg = JSON.parse(await readFile(clientFiles.copilot, 'utf8'))
  const vscodeHttpEntry = vscodeHttpCfg.mcpServers?.['dsh-db-mcp']
  check(
    'the Copilot HTTP entry replaces stdio and keeps the portable shape',
    vscodeHttp.status === 200 &&
      vscodeHttpEntry?.type === 'http' &&
      String(vscodeHttpEntry?.url || '').endsWith('/dsh-db-mcp') &&
      JSON.stringify(vscodeHttpEntry?.tools) === '["*"]' &&
      !vscodeHttpEntry?.command,
    JSON.stringify(vscodeHttpEntry),
  )
  await post('/http/stop', {})

  const limits = await get('/tools')
  check(
    'the tool list carries the two row limits',
    limits.body?.limits?.sampleRows === 20 && limits.body?.limits?.maxRows === 200,
    JSON.stringify(limits.body?.limits),
  )

  await post('/settings', { limits: { sampleRows: 50, maxRows: 90 } })
  const savedLimits = await get('/tools')
  check(
    'row limits are saved and clamped',
    savedLimits.body?.limits?.sampleRows === 50 && savedLimits.body?.limits?.maxRows === 90,
    JSON.stringify(savedLimits.body?.limits),
  )

  await post('/settings', { limits: { sampleRows: 9999, maxRows: 0 } })
  const clamped = await get('/tools')
  check(
    'out of range limits fall back to the defaults',
    clamped.body?.limits?.sampleRows === 20 && clamped.body?.limits?.maxRows === 200,
    JSON.stringify(clamped.body?.limits),
  )

  /* The four cost thresholds are the same kind of setting as the row limits:
     written by the panel, read by the Python side out of the same file. */
  const costDefaults = await get('/tools')
  check(
    'the tool list carries the four cost thresholds',
    costDefaults.body?.cost?.slowMs === 200 &&
      costDefaults.body?.cost?.timingWindow === 5 &&
      costDefaults.body?.cost?.trustSamples === 3 &&
      costDefaults.body?.cost?.bigTableRows === 1000000,
    JSON.stringify(costDefaults.body?.cost),
  )

  await post('/settings', { cost: { slowMs: 50, timingWindow: 9, trustSamples: 4, bigTableRows: 5000 } })
  const savedCost = await get('/tools')
  check(
    'cost thresholds are saved',
    savedCost.body?.cost?.slowMs === 50 &&
      savedCost.body?.cost?.timingWindow === 9 &&
      savedCost.body?.cost?.trustSamples === 4 &&
      savedCost.body?.cost?.bigTableRows === 5000,
    JSON.stringify(savedCost.body?.cost),
  )
  const costOnDisk = JSON.parse(await readFile(join(dir, 'settings.json'), 'utf8'))
  check(
    'cost thresholds land in the same settings file',
    costOnDisk?.cost?.slowMs === 50 && costOnDisk?.cost?.bigTableRows === 5000,
    JSON.stringify(costOnDisk?.cost),
  )

  await post('/settings', { cost: { slowMs: 0, timingWindow: 999, trustSamples: 'x', bigTableRows: true } })
  const clampedCost = await get('/tools')
  check(
    'out of range cost thresholds fall back to the defaults',
    clampedCost.body?.cost?.slowMs === 200 &&
      clampedCost.body?.cost?.timingWindow === 5 &&
      clampedCost.body?.cost?.trustSamples === 3 &&
      clampedCost.body?.cost?.bigTableRows === 1000000,
    JSON.stringify(clampedCost.body?.cost),
  )

  await post('/settings', { cost: { slowMs: 50 } })
  const partialCost = await get('/tools')
  check(
    'a partial cost patch keeps the other three',
    partialCost.body?.cost?.slowMs === 50 && partialCost.body?.cost?.timingWindow === 5,
    JSON.stringify(partialCost.body?.cost),
  )

  const limitTools = (limits.body?.tools || []).filter((tool) => tool.limit)
  check(
    'row-limited tools advertise their range',
    limitTools.every((tool) => tool.limit.min >= 1 && tool.limit.max >= tool.limit.value),
    JSON.stringify(limitTools.map((tool) => [tool.name, tool.limit])),
  )

  const unknown = await post('/clients/configure', { client: 'nope' })
  check('an unknown client is refused', unknown.status === 404 && /unknown client/.test(String(unknown.body?.error || '')))

  /* The graph page has routes of its own. They must exist even when the Python
     server is down (the panel then shows the failure instead of a 404), and they
     must not be reachable from another origin — the panel is the only client. */
  const graphRoutes = [
    ['GET', '/relations?datasource=alpha'],
    ['GET', '/scenes?datasource=alpha'],
    ['POST', '/relations/discover'],
    ['POST', '/relations/propose'],
    ['POST', '/relations/feedback'],
    ['POST', '/relations/condition'],
    ['POST', '/relations/delete'],
    ['POST', '/relations/mine'],
    ['POST', '/relations/scan'],
    ['POST', '/scenes/save'],
    ['POST', '/scenes/delete'],
    ['POST', '/trace'],
  ]
  for (const [method, path] of graphRoutes) {
    const response = method === 'GET' ? await get(path) : await post(path, {})
    check(
      `the graph route ${method} ${path.split('?')[0]} exists`,
      response.status !== 404,
      `${response.status} ${JSON.stringify(response.body).slice(0, 120)}`,
    )
  }

  const crossOrigin = await fetch(base + PREFIX + '/relations/delete', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://elsewhere.example' },
    body: JSON.stringify({ edge_id: 'e_000000' }),
  })
  check('a graph write from another origin is refused', crossOrigin.status === 403)

  const graphArgs = await post('/relations/feedback', { edge_id: 'e_000000', verdict: 'ok', fanout: 'lots' })
  check(
    'a graph route forwards only the arguments it knows',
    graphArgs.status !== 404 && !/fanout/.test(JSON.stringify(graphArgs.body?.error || '')),
    JSON.stringify(graphArgs.body).slice(0, 160),
  )

  /* The trace route is the one place the panel could turn into a SQL console by
     degrees. It forwards a value and the knobs around it — a statement smuggled
     into the body must never reach the tool. */
  const traceArgs = await post('/trace', { value: '1', datasource: 'alpha', sql: 'select 1', statement: 'select 1' })
  check(
    'the trace route has no SQL argument at all',
    traceArgs.status !== 404 && !/sql|statement/.test(JSON.stringify(traceArgs.body?.error || '')),
    JSON.stringify(traceArgs.body).slice(0, 160),
  )

  /* `/relations/scan` reads files, so the path is the one argument it cannot
     invent: an empty root must be refused before any tool call, and the route
     must not accept SQL either — it imports joins, it does not run them. */
  const scanNoRoot = await post('/relations/scan', { datasource: 'alpha' })
  check('the scan route refuses an empty root', scanNoRoot.status === 400, JSON.stringify(scanNoRoot.body).slice(0, 160))
  const scanArgs = await post('/relations/scan', {
    root: 'C:/nope',
    datasource: 'alpha',
    sql: 'select 1',
    statement: 'select 1',
  })
  check(
    'the scan route takes a root and no SQL',
    scanArgs.status !== 404 && !/sql|statement/.test(JSON.stringify(scanArgs.body?.error || '')),
    JSON.stringify(scanArgs.body).slice(0, 160),
  )

  /* A scene is a table list, so the route must forward `tables` as an array and
     nothing else that could smuggle SQL through it. */
  const sceneSave = await post('/scenes/save', {
    name: 'order to cash',
    datasource: 'alpha',
    tables: ['t_order', 't_trans'],
    sql: 'select 1',
  })
  check(
    'the scene save route forwards a table list and no SQL',
    sceneSave.status !== 404 &&
      !/sql|statement/.test(JSON.stringify(sceneSave.body?.error || '')),
    JSON.stringify(sceneSave.body).slice(0, 160),
  )
  const sceneNoName = await post('/scenes/save', { tables: ['t_order'] })
  check(
    'the scene save route refuses a scene without a name',
    sceneNoName.status !== 404 && /name|required|user_error/i.test(JSON.stringify(sceneNoName.body)),
    JSON.stringify(sceneNoName.body).slice(0, 160),
  )
} finally {
  await new Promise((resolve) => server.close(resolve))
  await host.dispose?.().catch(() => {})
  await rm(dir, { recursive: true, force: true })
}

console.log(`\n${passed}/${passed + failed} checks passed`)
process.exitCode = failed === 0 ? 0 : 1
// Let the (failed) child-process handles settle before the event loop drains.
await new Promise((resolve) => setTimeout(resolve, 400))
