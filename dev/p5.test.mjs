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
      JSON.stringify({ at: '2026-11-07T14:01:00.000Z', tool: 'mcp__db__run_query', ok: false, ms: 30, error: 'boom' }),
      '',
    ].join('\n'),
    'utf8',
  )
  const listing = await get('/audit?limit=5')
  check('audit entries parse newest first', listing.body.entries.length === 2 && listing.body.entries[0].tool === 'mcp__db__run_query')
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
} finally {
  await new Promise((resolve) => server.close(resolve))
  await host.dispose?.().catch(() => {})
  await rm(dir, { recursive: true, force: true })
}

console.log(`\n${passed}/${passed + failed} checks passed`)
process.exitCode = failed === 0 ? 0 : 1
// Let the (failed) child-process handles settle before the event loop drains.
await new Promise((resolve) => setTimeout(resolve, 400))
