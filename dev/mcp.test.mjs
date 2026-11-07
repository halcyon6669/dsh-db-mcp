/**
 * Integration test for the Python MCP server, driven through the same client the
 * plugin uses. Requires the runtime venv created by `POST /api/mcp/start` or the
 * manual setup described in README (`.venv` under the runtime directory).
 *
 *   node dev/mcp.test.mjs
 */
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

import { McpClient } from '../src/mcp.js'
import { renderResult } from '../src/tools.js'

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)))
const runtimeDir = process.env.DB_MCP_RUNTIME || join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'db-mcp')
const venvPython = join(runtimeDir, '.venv', 'Scripts', 'python.exe')
const python = existsSync(venvPython) ? venvPython : 'python'
const entry = join(packageDir, 'server', 'main.py')

let pass = 0
let fail = 0
function check(name, condition, detail = '') {
  if (condition) {
    pass += 1
    console.log(`  ok   ${name}`)
  } else {
    fail += 1
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

const client = new McpClient({
  command: python,
  args: [entry],
  cwd: join(packageDir, 'server'),
  env: { PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', DB_MCP_RUNTIME: runtimeDir },
})

try {
  await client.start()
  check('initialize handshake', client.serverInfo !== null, JSON.stringify(client.serverInfo))
  const names = client.tools.map((tool) => tool.name).sort()
  check('seven tools listed', names.length === 7 && names.includes('test_connection'), names.join(', '))
  check(
    'tool names',
    ['describe_table', 'explain_query', 'list_datasources', 'list_tables', 'run_query', 'sample_rows'].every((name) =>
      names.includes(name),
    ),
    names.join(', '),
  )

  const sources = await client.callTool('list_datasources', {})
  check('list_datasources ok', sources.parsed?.ok === true, sources.text?.slice(0, 300))
  const sqlite = sources.parsed?.datasources?.find((source) => source.kind === 'sqlite')
  check('a sqlite source is registered', Boolean(sqlite), JSON.stringify(sources.parsed?.datasources))

  if (sqlite) {
    const tables = await client.callTool('list_tables', { datasource: sqlite.id })
    check('list_tables ok', tables.parsed?.ok === true, tables.text?.slice(0, 300))
    const first = tables.parsed?.tables?.[0]
    check('tables returned', Boolean(first), JSON.stringify(tables.parsed?.tables?.slice(0, 5)))
    check('render produces a table listing', typeof renderResult(tables.parsed) === 'string' && renderResult(tables.parsed).length > 0)

    if (first) {
      const described = await client.callTool('describe_table', { datasource: sqlite.id, table: first.name })
      check('describe_table ok', described.parsed?.ok === true, described.text?.slice(0, 300))
      check('columns found', (described.parsed?.columns ?? []).length > 0)

      const sample = await client.callTool('sample_rows', { datasource: sqlite.id, table: first.name, limit: 3 })
      check('sample_rows ok', sample.parsed?.ok === true, sample.text?.slice(0, 300))
    }

    const query = await client.callTool('run_query', { datasource: sqlite.id, sql: 'select count(*) as n from sqlite_master', max_rows: 5 })
    check('run_query ok', query.parsed?.ok === true, query.text?.slice(0, 300))
    check('query returned a count', Array.isArray(query.parsed?.rows) && query.parsed.rows.length === 1, JSON.stringify(query.parsed?.rows))

    const blocked = await client.callTool('run_query', { datasource: sqlite.id, sql: 'delete from sqlite_master', max_rows: 5 })
    check('write refused on read-only source', blocked.parsed?.ok === false && blocked.parsed?.error?.code === 'user_error', blocked.text?.slice(0, 300))

    const unknown = await client.callTool('list_tables', { datasource: 'no-such-source' })
    check('unknown datasource reported', unknown.parsed?.ok === false && unknown.parsed?.error?.code === 'user_error', unknown.text?.slice(0, 300))

    const probe = await client.callTool('test_connection', { datasource: sqlite.id })
    check('test_connection logs in to SQLite', probe.parsed?.ok === true && /SQLite/i.test(String(probe.parsed?.message)), probe.text?.slice(0, 300))
  }

  const oracle = sources.parsed?.datasources?.find((source) => source.kind === 'oracle')
  if (oracle) {
    const probe = await client.callTool('test_connection', { datasource: oracle.id })
    check(
      'test_connection logs in to Oracle',
      probe.parsed?.ok === true && /Oracle/i.test(String(probe.parsed?.message)),
      probe.text?.slice(0, 300),
    )
    if (probe.parsed?.ok) {
      const rows = await client.callTool('run_query', { datasource: oracle.id, sql: 'select 1 as n from dual', max_rows: 3 })
      check('Oracle query returns a row', rows.parsed?.ok === true && rows.parsed?.rows?.length === 1, rows.text?.slice(0, 300))
    }

    const inline = await client.callTool('test_connection', {
      kind: 'oracle',
      config: { host: '127.0.0.1', port: 1, serviceName: 'NOPE', user: 'nobody' },
      password: 'wrong',
    })
    check(
      'test_connection reports a real login failure',
      inline.parsed?.ok === false && inline.parsed?.error?.code === 'db_error',
      inline.text?.slice(0, 300),
    )
  }
} catch (error) {
  fail += 1
  console.log(`  FAIL server start — ${error?.stack || error}`)
} finally {
  await client.stop()
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
