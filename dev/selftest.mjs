/**
 * Standalone self-test for the Host half: mounts the plugin on a stub Cordis
 * context, serves its route on a throwaway port, and drives the CRUD + DBeaver
 * import + probe paths against a temporary runtime dir.
 *
 *   node dev/selftest.mjs
 *
 * It never touches <DSH_HOME>/db-mcp; pass --dir=<path> to keep the output.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHost } from '../src/host.js'

const keep = process.argv.includes('--keep')
const explicit = process.argv.find((arg) => arg.startsWith('--dir='))
const dir = explicit ? explicit.slice(6) : await mkdtemp(join(tmpdir(), 'dbmcp-selftest-'))

const host = createHost({ dir, config: { probeTimeoutMs: 5000 } })
const server = createServer((req, res) => host.handle(req, res))
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`

const results = []
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition), detail })
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}

async function call(method, path, body, headers) {
  const response = await fetch(`${base}/plugins/db-mcp/api${path}`, {
    method,
    headers: { accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await response.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    json = { raw: text.slice(0, 200) }
  }
  return { status: response.status, body: json }
}

try {
  const health = await call('GET', '/health')
  check('health 200', health.status === 200, `phase=${health.body.plugin?.phase}`)
  check('health has no secrets', !JSON.stringify(health.body).includes('password"'))

  const created = await call('POST', '/datasources/save', {
    id: 'chinook',
    name: 'Chinook (SQLite)',
    kind: 'sqlite',
    config: { file: join(process.env.APPDATA || '', 'DBeaverData', 'workspace6', '.metadata', 'sample-database-sqlite-1', 'Chinook.db') },
    password: 'p@ss',
  })
  check('save creates', created.status === 200 && created.body.datasource?.id === 'chinook', JSON.stringify(created.body.error || ''))
  check('save never echoes the password', !JSON.stringify(created.body).includes('p@ss'))

  const listed = await call('GET', '/datasources')
  const item = listed.body.datasources?.[0]
  check('list returns one source', listed.body.datasources?.length === 1)
  check('list marks the stored secret', item?.hasSecret === true)
  check('first source becomes default', item?.isDefault === true)

  const probed = await call('POST', '/datasources/test', { id: 'chinook' })
  check('sqlite probe opens the file', probed.body.probe?.ok === true, probed.body.probe?.message)

  const renamed = await call('POST', '/datasources/save', { id: 'chinook', name: 'Chinook renamed', kind: 'sqlite', config: { file: item.config.file } })
  check('update keeps the secret when password is omitted', renamed.body.datasource?.hasSecret === true)
  check('update renames', renamed.body.datasource?.name === 'Chinook renamed')

  const bad = await call('POST', '/datasources/save', { id: 'Bad Id', name: 'x', kind: 'sqlite', config: { file: 'x' } })
  check('invalid id rejected', bad.status === 400, bad.body.error)

  const badKind = await call('POST', '/datasources/save', { id: 'x1', name: 'x', kind: 'mongo', config: {} })
  check('unknown kind rejected', badKind.status === 400, badKind.body.error)

  const cross = await call('POST', '/datasources/save', { id: 'x2', name: 'x', kind: 'sqlite', config: { file: 'y' } }, { origin: 'http://evil.example' })
  check('cross-origin write rejected', cross.status === 403)

  const scan = await call('GET', '/dbeaver/scan')
  const all = (scan.body.sources || []).flatMap((source) => source.connections)
  check('dbeaver scan finds the sample connection', all.some((entry) => entry.kind === 'sqlite'), `${all.length} connection(s)`)

  // A connection saved through the DBeaver driver dialog carries only the JDBC
  // URL; host/database/user must come out of it.
  const urlOnly = host.__test.mapDBeaverConnection({
    provider: 'mysql',
    driver: 'mysql8',
    name: 'mysql',
    configuration: {
      host: 'localhost',
      port: '3306',
      url: 'jdbc:mysql://127.0.0.1:3306/demo',
      configurationType: 'URL',
    },
  })
  check('dbeaver URL-only entry maps', urlOnly.ok === true, urlOnly.reason)
  check(
    'dbeaver URL-only entry reads host/port/database',
    urlOnly.config?.host === '127.0.0.1' && urlOnly.config?.port === 3306 && urlOnly.config?.database === 'demo',
    JSON.stringify(urlOnly.config),
  )
  const pgUrl = host.__test.parseJdbcUrl('jdbc:postgresql://alice@db.internal:6543/orders?sslmode=require')
  check(
    'jdbc url parse keeps user/port/database',
    pgUrl?.host === 'db.internal' && pgUrl?.port === 6543 && pgUrl?.database === 'orders' && pgUrl?.user === 'alice',
    JSON.stringify(pgUrl),
  )

  const importable = all.find((entry) => entry.importable && entry.kind === 'sqlite')
  if (importable) {
    const imported = await call('POST', '/dbeaver/import', { ids: [importable.id] })
    check('dbeaver import creates a source', imported.body.imported?.length === 1, JSON.stringify(imported.body.failed || []))
    const importedId = imported.body.imported?.[0]?.id
    const importedProbe = await call('POST', '/datasources/test', { id: importedId })
    check('imported source probes green', importedProbe.body.probe?.ok === true, importedProbe.body.probe?.message)
  }

  const registryText = await readFile(join(dir, 'datasources.json'), 'utf8')
  check('registry file has no password', !/p@ss/.test(registryText))
  const secretsText = await readFile(join(dir, 'secrets.json'), 'utf8')
  check('secrets file exists', secretsText.includes('p@ss'))

  const removed = await call('POST', '/datasources/delete', { id: 'chinook' })
  check('delete removes the source', removed.status === 200 && !removed.body.datasources.some((entry) => entry.id === 'chinook'))
  const secretsAfter = await readFile(join(dir, 'secrets.json'), 'utf8')
  check('delete drops the stored secret', !/p@ss/.test(secretsAfter))

  const missing = await call('POST', '/datasources/save', { id: 'pg1', name: 'pg', kind: 'postgres', config: { host: '127.0.0.1', port: 5999, database: 'x' } })
  check('postgres source validates', missing.status === 200, missing.body.error)
  const pgProbe = await call('POST', '/datasources/test', { id: 'pg1' })
  check('closed port reports a failure', pgProbe.body.probe?.ok === false, pgProbe.body.probe?.message)

  const method = await call('DELETE', '/datasources')
  check('non-POST write method rejected', method.status === 405)

  const schemaNoSource = await call('GET', '/schema')
  check('schema needs a datasource', schemaNoSource.status === 400, schemaNoSource.body.error)

  const schemaUnknown = await call('GET', '/schema?datasource=ghost')
  check('schema rejects unknown sources', schemaUnknown.status === 404, schemaUnknown.body.error)

  const unknown = await call('GET', '/nope')
  check('unknown route 404', unknown.status === 404)
} finally {
  server.close()
  const failed = results.filter((entry) => !entry.ok)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  if (failed.length > 0) {
    console.log(`runtime dir kept for inspection: ${dir}`)
    process.exitCode = 1
  } else if (keep) {
    console.log(`runtime dir: ${dir}`)
  } else {
    await rm(dir, { recursive: true, force: true })
  }
}
