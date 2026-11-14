/**
 * P5 checks: settings, audit log, python environment — exercised through the
 * real HTTP handler with a throwaway runtime directory.
 */
import { createServer } from 'node:http'
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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

const host = await createHost({ dir, config: {}, log: () => {} })
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
  check('failed entry keeps its error', listing.body.entries[0].error === 'boom')
  const limited = await get('/audit?limit=1')
  check('limit is honoured', limited.body.entries.length === 1)

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
  await post('/http/stop', {})

  const clients = await get('/clients')
  const ids = (clients.body?.clients || []).map((item) => item.id)
  // Only the clients this platform can actually write are listed.
  const portable = ['cursor', 'jetbrains-air', 'claude-code', 'codex']
  const expected =
    process.platform === 'win32' || process.platform === 'darwin'
      ? ['vscode', 'vscode-insiders', ...portable.slice(0, 3), 'claude-desktop', portable[3]]
      : ['vscode', 'vscode-insiders', ...portable]
  check(
    'the client list covers the supported agents',
    clients.status === 200 && expected.every((id) => ids.includes(id)),
    ids.join(','),
  )
  check(
    'Claude Code and Codex are both offered',
    ids.includes('claude-code') && ids.includes('codex'),
    ids.join(','),
  )
  const air = (clients.body?.clients || []).find((item) => item.id === 'jetbrains-air')
  check(
    'JetBrains Air is offered and points at its own mcp.json',
    Boolean(air) && air.file.endsWith(join('.jetbrains', 'mcp', 'mcp.json')) && air.shape === 'mcpServers',
    JSON.stringify(air),
  )
  check(
    'each client knows its config file',
    (clients.body?.clients || []).every((item) => typeof item.file === 'string' && item.file.length > 0),
  )

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

  const limitTools = (limits.body?.tools || []).filter((tool) => tool.limit)
  check(
    'row-limited tools advertise their range',
    limitTools.every((tool) => tool.limit.min >= 1 && tool.limit.max >= tool.limit.value),
    JSON.stringify(limitTools.map((tool) => [tool.name, tool.limit])),
  )

  const unknown = await post('/clients/configure', { client: 'nope' })
  check('an unknown client is refused', unknown.status === 404 && /unknown client/.test(String(unknown.body?.error || '')))
} finally {
  await new Promise((resolve) => server.close(resolve))
  await host.dispose?.().catch(() => {})
  await rm(dir, { recursive: true, force: true })
}

console.log(`\n${passed}/${passed + failed} checks passed`)
process.exitCode = failed === 0 ? 0 : 1
// Let the (failed) child-process handles settle before the event loop drains.
await new Promise((resolve) => setTimeout(resolve, 400))
