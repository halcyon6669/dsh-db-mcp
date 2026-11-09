// Offline unit test for the connection-string parser inside client.js.
// client.js is a browser module: it calls window.__ModuleLoader__.load({ factory })
// and only ever requires 'react'. This harness supplies both, then calls the
// parser that the module exposes as __test.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const file = path.join(here, '..', 'client.js')
const source = fs.readFileSync(file, 'utf8')

const ReactStub = {
  Fragment: 'fragment',
  createElement: (type, props, ...children) => ({ type, props, children }),
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
if (!captured) throw new Error('module did not call window.__ModuleLoader__.load')

const mod = captured.factory(requireShim)
const { parseConnectionText, uniqueId, canonicalUrl } = mod.__test

let passed = 0
const failures = []

function check(name, condition, extra) {
  if (condition) {
    passed += 1
    return
  }
  failures.push(`${name}${extra ? ` — ${extra}` : ''}`)
}

function expectParse(name, input, expected) {
  const result = parseConnectionText(input)
  if (!expected.ok) {
    check(name, result.ok === false && result.code === expected.code, `got ${JSON.stringify(result)}`)
    return
  }
  if (!result.ok) {
    check(name, false, `expected ok, got ${JSON.stringify(result)}`)
    return
  }
  const problems = []
  if (expected.kind && result.kind !== expected.kind) problems.push(`kind=${result.kind}`)
  for (const [key, value] of Object.entries(expected.config || {})) {
    if (result.config[key] !== value) problems.push(`config.${key}=${JSON.stringify(result.config[key])}`)
  }
  if (expected.password !== undefined && result.password !== expected.password) {
    problems.push(`password=${JSON.stringify(result.password)}`)
  }
  if (expected.name !== undefined && result.name !== expected.name) problems.push(`name=${JSON.stringify(result.name)}`)
  check(name, problems.length === 0, problems.join(', '))
}

expectParse('pg dsn with credentials and sslmode', 'postgresql://alice:s3cret@db.example.com:6543/orders?sslmode=require', {
  ok: true,
  kind: 'postgres',
  config: { host: 'db.example.com', port: '6543', database: 'orders', user: 'alice', sslMode: 'require' },
  password: 's3cret',
  name: 'orders',
})

expectParse('jdbc postgres defaults to 5432', 'jdbc:postgresql://localhost/appdb', {
  ok: true,
  kind: 'postgres',
  config: { host: 'localhost', port: '5432', database: 'appdb' },
  password: '',
})

expectParse('mysql dsn with charset', 'mysql://root:pw@127.0.0.1:3306/shop?charset=utf8mb4', {
  ok: true,
  kind: 'mysql',
  config: { host: '127.0.0.1', port: '3306', database: 'shop', user: 'root', charset: 'utf8mb4' },
  password: 'pw',
})

expectParse('jdbc mariadb maps to mysql', 'jdbc:mariadb://10.0.0.5:3307/legacy', {
  ok: true,
  kind: 'mysql',
  config: { host: '10.0.0.5', port: '3307', database: 'legacy' },
})

// openGauss hands over its whole cluster in the authority; the form must keep
// every node so the driver can fail over, and the URL must round-trip.
const gauss = parseConnectionText('jdbc:opengauss://h1:30100,h2:30100,h3:30100/demo?targetServerType=master')
check(
  'opengauss url keeps every node',
  gauss.ok === true && gauss.kind === 'gauss' && gauss.config.hosts?.length === 3 && gauss.config.hosts[2].port === 30100,
  JSON.stringify(gauss),
)
check('opengauss url reads the database', gauss.ok === true && gauss.config.database === 'demo', JSON.stringify(gauss.config))
check(
  'opengauss url round-trips',
  canonicalUrl({ kind: 'gauss', config: gauss.config }) === 'opengauss://h1:30100,h2:30100,h3:30100/demo',
  canonicalUrl({ kind: 'gauss', config: gauss.config }),
)

expectParse('oracle url with service name', 'oracle://system:oracle@localhost:1521/XEPDB1', {
  ok: true,
  kind: 'oracle',
  config: { host: 'localhost', port: '1521', serviceName: 'XEPDB1', user: 'system' },
  password: 'oracle',
  name: 'XEPDB1',
})

expectParse('oracle thin service form', 'jdbc:oracle:thin:@//ora.example.com:1521/ORCLPDB1', {
  ok: true,
  kind: 'oracle',
  config: { host: 'ora.example.com', port: '1521', serviceName: 'ORCLPDB1' },
})

expectParse('oracle thin SID form', 'jdbc:oracle:thin:@ora:1521:ORCL', {
  ok: true,
  kind: 'oracle',
  config: { host: 'ora', port: '1521', sid: 'ORCL', serviceName: '' },
})

expectParse(
  'oracle TNS descriptor',
  '(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=tns-host)(PORT=1522))(CONNECT_DATA=(SERVICE_NAME=svc1)))',
  { ok: true, kind: 'oracle', config: { host: 'tns-host', port: '1522', serviceName: 'svc1' }, name: 'svc1' },
)

expectParse('jdbc sqlite path', 'jdbc:sqlite:C:\\data\\app.db', {
  ok: true,
  kind: 'sqlite',
  config: { file: 'C:\\data\\app.db' },
  name: 'app',
})

expectParse('sqlite url triple slash', 'sqlite:///C:/data/chinook.db', {
  ok: true,
  kind: 'sqlite',
  config: { file: 'C:/data/chinook.db' },
  name: 'chinook',
})

expectParse('bare windows path', 'C:/data/app.sqlite', {
  ok: true,
  kind: 'sqlite',
  config: { file: 'C:/data/app.sqlite' },
})

expectParse('bare posix path', '/var/lib/things.sqlite3', {
  ok: true,
  kind: 'sqlite',
  config: { file: '/var/lib/things.sqlite3' },
})

expectParse('quoted path', '"C:\\data\\my app.db"', {
  ok: true,
  kind: 'sqlite',
  config: { file: 'C:\\data\\my app.db' },
})

expectParse('unknown scheme', 'mongodb://user:pw@host/db', { ok: false, code: 'scheme' })
expectParse('free text', 'hello world', { ok: false, code: 'unrecognized' })
expectParse('empty', '   ', { ok: false, code: 'empty' })
expectParse('unsupported jdbc', 'jdbc:sqlserver://host;databaseName=x', { ok: false, code: 'jdbc' })

check('uniqueId adds suffix', uniqueId('app', ['app']) === 'app-2', uniqueId('app', ['app']))
check('uniqueId keeps free id', uniqueId('app', ['other']) === 'app')
check('uniqueId skips taken suffix', uniqueId('app', ['app', 'app-2']) === 'app-3', uniqueId('app', ['app', 'app-2']))

check(
  'canonicalUrl omits password',
  canonicalUrl({ kind: 'postgres', config: { host: 'h', port: '5432', database: 'db', user: 'u' } }) === 'postgres://u@h:5432/db',
  canonicalUrl({ kind: 'postgres', config: { host: 'h', port: '5432', database: 'db', user: 'u' } }),
)

const sidUrl = canonicalUrl({ kind: 'oracle', config: { host: 'ora', port: '1521', sid: 'ORCL', user: 'system' } })
check('canonicalUrl keeps the Oracle SID form', sidUrl === 'jdbc:oracle:thin:@ora:1521:ORCL', sidUrl)
const sidRound = parseConnectionText(sidUrl)
check(
  'Oracle SID round-trips through canonicalUrl',
  sidRound.ok && sidRound.config.sid === 'ORCL' && !sidRound.config.serviceName,
  JSON.stringify(sidRound),
)
const svcUrl = canonicalUrl({ kind: 'oracle', config: { host: 'ora', port: '1521', serviceName: 'XEPDB1', user: 'system' } })
check('canonicalUrl uses the service form', svcUrl === 'oracle://system@ora:1521/XEPDB1', svcUrl)

const total = passed + failures.length
if (failures.length > 0) {
  console.log(`parse.test: ${passed}/${total} passed`)
  for (const failure of failures) console.log(`  FAIL ${failure}`)
  process.exit(1)
}
console.log(`parse.test: ${passed}/${total} passed`)
