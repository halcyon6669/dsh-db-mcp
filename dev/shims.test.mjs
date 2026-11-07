/**
 * Host-half smoke test with a stub Cordis context: checks route registration, the
 * health/reload/scan endpoints, and that the Python tools are registered on the
 * host `tools` service as `mcp__db__*`.
 *
 *   node dev/shims.test.mjs
 */
import { createServer } from 'node:http'
import { apply } from '../index.js'
import { mkdtemp } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// The host reads package.json with JSON.parse, which rejects a UTF-8 BOM. A BOM
// written by an editor shows up as "availability: missing" in the plugin card, so
// the manifest is checked here.
const manifest = (() => {
  try {
    const raw = readFileSync(new URL('../package.json', import.meta.url), 'utf8')
    if (raw.charCodeAt(0) === 0xfeff) return { ok: false, message: 'package.json starts with a BOM' }
    const parsed = JSON.parse(raw)
    return { ok: Boolean(parsed.name && parsed.version && parsed.dsh && parsed.dsh.bundle), message: `${parsed.name}@${parsed.version}, no BOM` }
  } catch (error) {
    return { ok: false, message: `package.json unreadable: ${error.message}` }
  }
})()

const dir = await mkdtemp(join(tmpdir(), 'dbmcp-shim-'))
const routes = []
const registered = []
const tools = {
  register: (definition) => {
    registered.push(definition)
    return () => {
      const index = registered.indexOf(definition)
      if (index >= 0) registered.splice(index, 1)
    }
  },
}
const services = { tools }
const ctx = {
  effect: (fn) => fn(),
  webServer: {
    register: (route) => {
      routes.push(route)
      return () => {}
    },
  },
  get: (name) => services[name],
}
apply(ctx, { runtimeDir: dir })
console.log('routes:', routes.map((route) => `${route.kind} ${route.path}`).join(', '))

const dispatch = (req, res) => {
  const url = new URL(req.url, 'http://x')
  const exact = routes.find((route) => route.kind === 'exact' && route.path === url.pathname)
  const prefix = routes
    .filter((route) => route.kind === 'prefix' && url.pathname.startsWith(route.path))
    .sort((a, b) => b.path.length - a.path.length)[0]
  const route = exact || prefix
  if (!route) {
    res.writeHead(404)
    res.end('no route')
    return
  }
  route.handler(req, res)
}
const server = createServer(dispatch)
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}/plugins/db-mcp/api`

const health = await (await fetch(`${base}/health`)).json()
console.log('health:', health.ok, health.plugin.version, health.plugin.phase, 'python:', health.python.ok)

const reload = await fetch(`${base}/reload`, { method: 'POST' })
console.log('reload:', reload.status, JSON.stringify(await reload.json()))
const health2 = await (await fetch(`${base}/health`)).json()
console.log('after reload:', health2.ok, health2.plugin.version)

const scan = await (await fetch(`${base}/dbeaver/scan`)).json()
console.log('scan:', scan.ok, scan.sources.length, scan.sources[0]?.connections.length)

// The MCP server needs the runtime venv; this temp dir has none, so the start is
// expected to fail. What matters here is that the tool definitions were built.
const start = await fetch(`${base}/mcp/start`, { method: 'POST' })
const startBody = await start.json()
const names = registered.map((definition) => definition.name).sort()
console.log('mcp start:', startBody.phase ?? startBody.error)
console.log('tools registered:', registered.length, names.join(', '))
const sample = registered.find((definition) => definition.name === 'mcp__db__list_tables')
if (sample) {
  console.log('parameters:', JSON.stringify(sample.parameters))
  console.log('output render:', JSON.stringify(sample.output.render({}, { ok: true, tables: [{ name: 'Album', type: 'table', schema: 'main' }] })))
}

const ok =
  routes.length === 2 &&
  health.ok === true &&
  health.python.ok === true &&
  reload.status === 200 &&
  health2.plugin.version === health.plugin.version &&
  scan.ok === true &&
  manifest.ok === true &&
  (registered.length === 7 || startBody.phase === 'failed')
console.log('manifest:', manifest.message)
console.log(ok ? 'shims: ok' : 'shims: FAILED')
server.close()
process.exit(ok && registered.length === 7 ? 0 : 1)
