/**
 * Standalone self-test for the Host half: mounts the plugin on a stub Cordis
 * context, serves its route on a throwaway port, and drives the CRUD + DBeaver
 * import + probe paths against a temporary runtime dir.
 *
 *   node dev/selftest.mjs
 *
 * It never touches <DSH_HOME>/db-mcp; pass --dir=<path> to keep the output.
 */
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
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
const sqliteFile = join(process.env.APPDATA || '', 'DBeaverData', 'workspace6', '.metadata', 'sample-database-sqlite-1', 'Chinook.db')
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

  // Two rows pointing at the same file and login would be indistinguishable to
  // the agent, so the second save is refused.
  const twin = await call('POST', '/datasources/save', { id: 'chinook-copy', name: 'Copy', kind: 'sqlite', config: { file: item.config.file } })
  check('the same endpoint is not saved twice', twin.status === 409, twin.body.error)
  check('the duplicate error names the existing row', twin.body.existingId === 'chinook', twin.body.existingId)

  // The identity a save compares is host + port + database + user, so a second
  // account on the same server is a different source while the same account is not.
  const identity = host.__test && host.__test.sourceIdentity
  const account = (user) => identity('mysql', { host: '10.1.2.3', port: 3306, database: 'shop', user }, user)
  check('identity treats the same account as one endpoint', account('demo') === account('demo'))
  check('identity separates two accounts on one server', account('demo') !== account('reporter'))

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

  const pgTarget = await call('POST', '/datasources/save', {
    id: 'target-check',
    name: 'Target check',
    kind: 'postgres',
    config: { host: '127.0.0.1', port: 5432, database: 'appdb', user: 'demo' },
    readOnly: true,
  })
  check(
    'target reads host:port/database without padding',
    pgTarget.body.datasource?.target === '127.0.0.1:5432/appdb',
    JSON.stringify(pgTarget.body.datasource?.target),
  )
  await call('POST', '/datasources/delete', { id: 'target-check' })

  // openGauss lists every cluster node in the authority and hangs options off a
  // query string; falling back to the postgres parser must not lose them.
  const gaussUrl = host.__test.parseJdbcUrl(
    'jdbc:opengauss://h1:30100,h2:30100,h3:30100/demo?targetServerType=master&connectionExtraInfo=true',
  )
  check(
    'opengauss url keeps all three hosts',
    gaussUrl?.hosts?.length === 3 && gaussUrl.hosts[2].port === 30100 && gaussUrl.database === 'demo',
    JSON.stringify(gaussUrl?.hosts),
  )
  check(
    'opengauss url keeps its query options',
    gaussUrl?.params?.targetServerType === 'master',
    JSON.stringify(gaussUrl?.params),
  )

  const gaussEntry = host.__test.mapDBeaverConnection({
    provider: 'generic',
    driver: 'opengauss-jdbc',
    name: 'gauss',
    configuration: {
      url: 'jdbc:opengauss://10.0.0.1:30100,10.0.0.2:30100/app?targetServerType=master',
      user: 'gauss_user',
      configurationType: 'URL',
    },
  })
  check('dbeaver opengauss entry maps', gaussEntry.ok === true && gaussEntry.kind === 'gauss', String(gaussEntry.reason))
  check('dbeaver opengauss keeps both nodes', gaussEntry.config?.hosts?.length === 2, JSON.stringify(gaussEntry.config?.hosts))

  // DBeaver files a driver-jar connection as `generic`; the URL is the only hint
  // that it is openGauss, and that is what used to fail with "unsupported provider".
  const genericGauss = host.__test.mapDBeaverConnection({
    provider: 'generic',
    driver: '',
    configuration: {
      url: 'jdbc:gaussdb://gauss_user:Gauss%23Db2026@db.example.com:15432/postgres',
      configurationType: 'URL',
    },
  })
  check(
    'dbeaver generic entry maps by url scheme',
    genericGauss.ok === true && genericGauss.kind === 'gauss' && genericGauss.config?.port === 15432,
    JSON.stringify(genericGauss),
  )

  const oracleList = host.__test.parseOracleUrl(
    'jdbc:oracle:thin:@(DESCRIPTION_LIST=(LOAD_BALANCE=ON)(FAILOVER=ON)' +
      '(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=ora-1.example.com)(PORT=1522))' +
      '(CONNECT_DATA=(SERVICE_NAME=ORCLPDB1))))',
  )
  check(
    'oracle DESCRIPTION_LIST yields host/port/service',
    oracleList?.host === 'ora-1.example.com' && oracleList.port === 1522 && oracleList.serviceName === 'ORCLPDB1',
    JSON.stringify(oracleList),
  )

  const oracleSid = host.__test.parseOracleUrl('jdbc:oracle:thin:@ora.example.com:1521:ORCL')
  check('oracle thin SID url still parses', oracleSid?.sid === 'ORCL' && oracleSid.serviceName === '', JSON.stringify(oracleSid))

  // DBeaver writes RAC services with ADDRESS_LIST inside DESCRIPTION_LIST; the
  // importer must still find the host, port and service.
  const nested = host.__test.mapDBeaverConnection({
    name: 'ora-rac',
    provider: 'oracle',
    driver: 'oracle_thin',
    configuration: {
      configurationType: 'URL',
      url:
        'jdbc:oracle:thin:@(DESCRIPTION_LIST=(LOAD_BALANCE=ON)(FAILOVER=ON)' +
        '(DESCRIPTION=(ENABLE=BROKEN)(CONNECT_TIMEOUT=3)(RETRY_COUNT=2)' +
        '(ADDRESS_LIST=(LOAD_BALANCE=ON)(FAILOVER=ON)(ADDRESS=(PROTOCOL=TCP)(HOST=rac-1)(PORT=1521)))' +
        '(CONNECT_DATA=(SERVICE_NAME=ORCLPDB1))))',
    },
  })
  check(
    'DBeaver oracle ADDRESS_LIST maps to a source',
    nested.ok && nested.kind === 'oracle' && nested.config.host === 'rac-1' && nested.config.serviceName === 'ORCLPDB1',
    JSON.stringify(nested),
  )

  const importable = all.find((entry) => entry.importable && entry.kind === 'sqlite')
  if (importable) {
    // `chinook` already points at the same file and account, so the scan must
    // mark it and the import must refuse to create a second copy.
    const preScan = await call('GET', '/dbeaver/scan')
    const preAll = preScan.body.sources.flatMap((source) => source.connections)
    const flagged = preAll.find((entry) => entry.id === importable.id)
    check(
      'dbeaver scan flags the already configured connection',
      flagged?.alreadyImported === true && flagged?.duplicateId === 'chinook',
      JSON.stringify(flagged),
    )
    const blocked = await call('POST', '/dbeaver/import', { ids: [importable.id] })
    check(
      'importing a configured endpoint is skipped',
      blocked.body.imported?.length === 0 && blocked.body.skipped?.[0]?.existingId === 'chinook',
      JSON.stringify(blocked.body.skipped || blocked.body.imported),
    )

    // Once the duplicate is gone the same entry imports again.
    await call('POST', '/datasources/delete', { id: 'chinook' })
    const imported = await call('POST', '/dbeaver/import', { ids: [importable.id] })
    check('dbeaver import creates a source', imported.body.imported?.length === 1, JSON.stringify(imported.body.failed || []))
    const importedId = imported.body.imported?.[0]?.id
    const importedProbe = await call('POST', '/datasources/test', { id: importedId })
    check('imported source probes green', importedProbe.body.probe?.ok === true, importedProbe.body.probe?.message)

    const again = await call('POST', '/dbeaver/import', { ids: [importable.id] })
    check(
      'importing the same endpoint twice is skipped',
      again.body.imported?.length === 0 && again.body.skipped?.[0]?.existingId === importedId,
      JSON.stringify(again.body.skipped || again.body.imported),
    )

    const identity = host.__test.sourceIdentity('postgres', { host: 'DB.Example.com', port: 5432, database: 'app', user: 'Alice' })
    const sameIdentity = host.__test.sourceIdentity('postgres', { host: 'db.example.com', port: '5432', database: 'APP', user: 'alice' })
    const otherUser = host.__test.sourceIdentity('postgres', { host: 'db.example.com', port: 5432, database: 'app', user: 'bob' })
    check(
      'identity ignores host/database/user case and port type',
      identity === sameIdentity && identity !== otherUser,
      `${identity} vs ${otherUser}`,
    )

    await call('POST', '/datasources/delete', { id: importedId })
    await call('POST', '/datasources/save', {
      id: 'chinook',
      name: 'Chinook renamed',
      kind: 'sqlite',
      config: { file: importable.config.file },
      password: 'p@ss',
    })
  }

  const registryText = await readFile(join(dir, 'datasources.json'), 'utf8')
  check('registry file has no password', !/p@ss/.test(registryText))
  const secretsText = await readFile(join(dir, 'secrets.json'), 'utf8')
  check('secrets file exists', secretsText.length > 0)
  // The password must not survive as plaintext anywhere on disk: the stored
  // value is an AES-256-GCM envelope, and only secret.key can open it.
  check('secrets file has no plaintext password', !/p@ss/.test(secretsText))
  check('secrets file holds an envelope', secretsText.includes('"v1.'))
  const keyFile = await stat(join(dir, 'secret.key')).catch(() => null)
  check('secret.key exists', Boolean(keyFile && keyFile.isFile()))
  const sealedEntry = JSON.parse(secretsText).secrets.chinook
  const { loadKey, decrypt } = await import('../src/secretbox.js')
  const opened = await decrypt(await loadKey(dir), sealedEntry.password, 'chinook')
  check('the envelope decrypts back to the password', opened === 'p@ss')

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

  // A writable source names the schemas it may write to. The list is normalised
  // on the way in (quotes stripped, duplicates folded, blanks dropped) and it
  // survives a switch back to read-only, so flipping the pill twice does not
  // make the operator retype it.
  const writable = await call('POST', '/datasources/save', {
    id: 'writable-db',
    name: 'Writable db',
    kind: 'postgres',
    config: { host: '127.0.0.1', port: 5999, database: 'x', user: 'alice' },
    writableSchemas: ['"sales"', ' Sales ', '', 'billing', 'BILLING'],
  })
  check('writable schemas are stored', writable.status === 200, writable.body.error)
  check(
    'writable schemas normalise names',
    JSON.stringify(writable.body.datasource?.writableSchemas) === JSON.stringify(['sales', 'billing']),
    JSON.stringify(writable.body.datasource?.writableSchemas),
  )
  const writableDefault = await call('POST', '/datasources/save', {
    id: 'writable-default',
    name: 'Writable default',
    kind: 'sqlite',
    config: { file: 'C:/tmp/writable.db' },
  })
  check(
    'a source without writable schemas has an empty list',
    JSON.stringify(writableDefault.body.datasource?.writableSchemas) === JSON.stringify([]),
    JSON.stringify(writableDefault.body.datasource?.writableSchemas),
  )
  const writableOdd = await call('POST', '/datasources/save', {
    id: 'writable-odd',
    name: 'Writable odd',
    kind: 'sqlite',
    config: { file: 'C:/tmp/writable-odd.db' },
    writableSchemas: ['x'.repeat(80), 'ok'],
  })
  check(
    'long schema names are dropped',
    JSON.stringify(writableOdd.body.datasource?.writableSchemas) === JSON.stringify(['ok']),
    JSON.stringify(writableOdd.body.datasource?.writableSchemas),
  )

  // Unlocking without an answer is refused: a source that accepts writes and
  // names no schema would let every write through, which is the thing the
  // guard exists to prevent.
  const blind = await call('POST', '/datasources/bulk', { action: 'readOnly', ids: ['writable-default'], readOnly: false })
  check('unlocking without writable schemas is refused', blind.status === 400, blind.body.error)
  const named = await call('POST', '/datasources/bulk', {
    action: 'readOnly',
    ids: ['writable-default'],
    readOnly: false,
    writableSchemas: ['main'],
  })
  check('unlocking with writable schemas succeeds', named.status === 200, named.body.error)
  const afterUnlock = await call('GET', '/datasources')
  const unlockedRow = (afterUnlock.body.datasources || []).find((item) => item.id === 'writable-default')
  check('the source is writable', unlockedRow && unlockedRow.readOnly === false, JSON.stringify(unlockedRow && unlockedRow.readOnly))
  check(
    'the writable list survives the switch',
    JSON.stringify(unlockedRow && unlockedRow.writableSchemas) === JSON.stringify(['main']),
    JSON.stringify(unlockedRow && unlockedRow.writableSchemas),
  )
  const relock = await call('POST', '/datasources/bulk', { action: 'readOnly', ids: ['writable-default'], readOnly: true })
  check('going read-only is always allowed', relock.status === 200, relock.body.error)
  const afterRelock = await call('GET', '/datasources')
  const relockedRow = (afterRelock.body.datasources || []).find((item) => item.id === 'writable-default')
  check(
    'the writable list is kept when the source goes read-only again',
    JSON.stringify(relockedRow && relockedRow.writableSchemas) === JSON.stringify(['main']),
    JSON.stringify(relockedRow && relockedRow.writableSchemas),
  )
  await call('POST', '/datasources/delete', { id: 'writable-db' })
  await call('POST', '/datasources/delete', { id: 'writable-default' })
  await call('POST', '/datasources/delete', { id: 'writable-odd' })

  const unknown = await call('GET', '/nope')
  check('unknown route 404', unknown.status === 404)

  const grouped = await call('POST', '/datasources/save', {
    id: 'team-db',
    name: 'Team db',
    group: 'analytics',
    kind: 'sqlite',
    config: { file: 'C:/tmp/team.db' },
  })
  check('save keeps a group label', grouped.body.datasource?.group === 'analytics', grouped.body.datasource?.group)
  const tooLongGroup = await call('POST', '/datasources/save', {
    id: 'team-db-2',
    name: 'Team db 2',
    group: 'x'.repeat(49),
    kind: 'sqlite',
    config: { file: 'C:/tmp/team2.db' },
  })
  check('group length is validated', tooLongGroup.status === 400, tooLongGroup.body.error)

  const bulkGroup = await call('POST', '/datasources/bulk', { action: 'group', ids: ['team-db', 'pg1'], group: 'ops' })
  const groupedIds = ['team-db', 'pg1']
  const groupedOk =
    bulkGroup.status === 200 &&
    bulkGroup.body.affected === 2 &&
    bulkGroup.body.datasources.filter((entry) => groupedIds.includes(entry.id)).every((entry) => entry.group === 'ops')
  check(
    'bulk group moves both sources',
    groupedOk,
    JSON.stringify(bulkGroup.body.datasources?.map((entry) => `${entry.id}=${entry.group}`)),
  )
  // Becoming writable needs a schema list, so the bulk call carries one.
  const bulkReadOnly = await call('POST', '/datasources/bulk', {
    action: 'readOnly',
    ids: ['team-db'],
    readOnly: false,
    writableSchemas: ['main'],
  })
  const flipped = bulkReadOnly.body.datasources?.find((entry) => entry.id === 'team-db')
  check('bulk readOnly flips the flag', bulkReadOnly.status === 200 && flipped?.readOnly === false, String(flipped?.readOnly))
  const bulkEmpty = await call('POST', '/datasources/bulk', { action: 'group', ids: [] })
  check('bulk needs at least one id', bulkEmpty.status === 400, bulkEmpty.body.error)
  const bulkUnknownAction = await call('POST', '/datasources/bulk', { action: 'explode', ids: ['team-db'] })
  check('bulk rejects unknown actions', bulkUnknownAction.status === 400, bulkUnknownAction.body.error)
  const bulkDelete = await call('POST', '/datasources/bulk', { action: 'delete', ids: ['team-db', 'pg1'] })
  check(
    'bulk delete removes both sources',
    bulkDelete.status === 200 &&
      bulkDelete.body.affected === 2 &&
      !bulkDelete.body.datasources.some((entry) => entry.id === 'team-db' || entry.id === 'pg1'),
    JSON.stringify(bulkDelete.body.datasources?.map((entry) => entry.id)),
  )

  // Groups are user-created, renameable and deletable, and survive as empty ones.
  const groupsAfterBulk = await call('GET', '/groups')
  check('groups list keeps the created group', groupsAfterBulk.body.groups?.includes('ops'), JSON.stringify(groupsAfterBulk.body.groups))
  const emptyGroup = await call('POST', '/groups/save', { name: 'staging' })
  check('an empty group can be created', emptyGroup.status === 200 && emptyGroup.body.groups.includes('staging'), emptyGroup.body.error)
  const duplicateGroup = await call('POST', '/groups/save', { name: 'staging' })
  check('duplicate group names are rejected', duplicateGroup.status === 400, duplicateGroup.body.error)
  const renameGroup = await call('POST', '/groups/save', { name: 'operations', from: 'ops' })
  check(
    'renaming a group rewrites its members',
    renameGroup.status === 200 &&
      renameGroup.body.groups.includes('operations') &&
      !renameGroup.body.groups.includes('ops') &&
      renameGroup.body.datasources.every((entry) => entry.group !== 'ops'),
    JSON.stringify(renameGroup.body.groups),
  )
  const dropGroup = await call('POST', '/groups/delete', { name: 'operations' })
  check(
    'deleting a group ungroups its sources',
    dropGroup.status === 200 &&
      !dropGroup.body.groups.includes('operations') &&
      dropGroup.body.datasources.every((entry) => !entry.group),
    JSON.stringify(dropGroup.body.groups),
  )
  const unknownGroup = await call('POST', '/groups/delete', { name: 'nope' })
  check('deleting an unknown group is a 404', unknownGroup.status === 404, unknownGroup.body.error)

  const first = await call('POST', '/datasources/save', {
    id: 'order-a',
    name: 'Order A',
    kind: 'sqlite',
    config: { file: sqliteFile },
    readOnly: true,
  })
  await call('POST', '/datasources/save', {
    id: 'order-b',
    name: 'Order B',
    kind: 'sqlite',
    config: { file: sqliteFile },
    readOnly: true,
  })
  const before = await call('GET', '/datasources')
  const beforeOrder = before.body.datasources.map((item) => item.id)
  const reordered = await call('POST', '/datasources/reorder', { ids: [...beforeOrder].reverse() })
  const afterOrder = reordered.body.datasources.map((item) => item.id)
  check(
    'reorder stores the requested order',
    reordered.status === 200 && afterOrder[0] === beforeOrder[beforeOrder.length - 1],
    `${beforeOrder.join(',')} -> ${afterOrder.join(',')}`,
  )
  check(
    'reorder keeps every source',
    afterOrder.length === beforeOrder.length && beforeOrder.every((id) => afterOrder.includes(id)),
    afterOrder.join(','),
  )
  const partial = await call('POST', '/datasources/reorder', { ids: [afterOrder[0]] })
  check(
    'reorder keeps the sources it was not told about',
    partial.status === 200 && partial.body.datasources.length === afterOrder.length,
    String(partial.body.datasources.length),
  )
  const emptyReorder = await call('POST', '/datasources/reorder', { ids: [] })
  check('reorder needs at least one id', emptyReorder.status === 400, emptyReorder.body.error)
  await call('POST', '/datasources/delete', { id: 'order-a' })
  await call('POST', '/datasources/delete', { id: first.body.id ? 'order-b' : 'order-b' })
} finally {
  await new Promise((resolve) => server.close(resolve))
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
  // Let libuv unwind the sockets and timers before the process exits: exiting
  // straight after a failure trips an assertion inside win/async.c.
  await new Promise((resolve) => setTimeout(resolve, 250))
}
